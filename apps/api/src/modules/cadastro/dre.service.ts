import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Avaliador aritmético SEGURO (sem eval): + − × ÷ e parênteses, com unário +/−. Usado nas linhas
 * de DRE tipo 'E' (fórmula), ex.: '<01>+<03>' vira '(900)+(-600)' após substituir os <cod>.
 */
function avaliarAritmetica(expr: string): number {
  const s = expr;
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const factor = (): number => {
    ws();
    if (s[i] === '(') { i++; const v = soma(); ws(); if (s[i] === ')') i++; return v; }
    if (s[i] === '+') { i++; return factor(); }
    if (s[i] === '-') { i++; return -factor(); }
    let j = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    const n = Number(s.slice(j, i));
    return Number.isFinite(n) ? n : 0;
  };
  const termo = (): number => {
    let v = factor(); ws();
    while (s[i] === '*' || s[i] === '/') { const op = s[i++]; const r = factor(); v = op === '*' ? v * r : (r === 0 ? 0 : v / r); ws(); }
    return v;
  };
  const soma = (): number => {
    let v = termo(); ws();
    while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const r = termo(); v = op === '+' ? v + r : v - r; ws(); }
    return v;
  };
  const r = soma();
  return Number.isFinite(r) ? r : 0;
}

export interface LinhaDre {
  codestrutura: number;
  codexpandido: string;
  descricao: string;
  tipo_calculo: string; // P/F/E
  classe: string; // A/S
  nivel: number;
  codpai: number | null;
  valor: number;
}

/**
 * DRE CONTÁBIL (relatório) — corte-1. Calcula a Demonstração do Resultado de um período/empresa a
 * partir do DIÁRIO + da estrutura semeada (dre_estrutura/dre_conta). Fiel a UFrmRelDREContabil:
 *  - saldo por conta = Σ(crédito) − Σ(débito) no período (sinal crédito +, débito −);
 *  - linha 'P' = Σ dos saldos das contas vinculadas;
 *  - linha 'F' = Σ das filhas (roll-up bottom-up pela hierarquia codpai);
 *  - linha 'E' = expressão sobre os totais das raízes nível-1 (<codexpandido>).
 * Período por DATALAN (CODPERIODO é NULL no legado); tenant por codempresa (fail-closed).
 */
@Injectable()
export class DreService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async calcular(dataInicio?: string, dataFim?: string): Promise<{ dataInicio: string; dataFim: string; linhas: LinhaDre[] }> {
    const emp = this.emp();
    // período obrigatório e coerente (fiel a UFrmRelDREContabil: exige as 2 datas, ini ≤ fim).
    if (!dataInicio || dataInicio === '' || !dataFim || dataFim === '') throw new BusinessRuleError('DRE_PERIODO_OBRIGATORIO');
    if (dataInicio > dataFim) throw new BusinessRuleError('DRE_PERIODO_INVALIDO', { dataInicio, dataFim });
    const ini = dataInicio;
    const fim = dataFim;
    const db = this.dbp.forTenantRead() as AnyDB;

    // saldo por conta = Σ crédito − Σ débito, no período/empresa (o núcleo confirmado no golden).
    const agg = await sql<{ conta: number; saldo: string }>`
      select conta, sum(v) as saldo from (
        select contacredito as conta,  valor as v from diario where codempresa = ${emp} and datalan between ${ini} and ${fim}
        union all
        select contadebito  as conta, -valor as v from diario where codempresa = ${emp} and datalan between ${ini} and ${fim}
      ) t group by conta
    `.execute(db);
    const saldoPorConta = new Map<number, number>();
    for (const row of agg.rows) saldoPorConta.set(Number(row.conta), Number(row.saldo));

    const estrutura = (await db.selectFrom('dre_estrutura').selectAll().where('ativo', '=', 'S').execute()) as Record<string, unknown>[];
    const vinc = (await db.selectFrom('dre_conta').selectAll().execute()) as Record<string, unknown>[];

    const valores = new Map<number, number>(); // codestrutura → valor
    const filhosDe = (cod: number) => estrutura.filter((e) => Number(e.codpai) === cod);

    // (1) linhas 'P' — soma dos saldos das contas vinculadas.
    for (const e of estrutura.filter((x) => x.tipo_calculo === 'P')) {
      const contas = vinc.filter((v) => Number(v.codestrutura) === Number(e.codestrutura)).map((v) => Number(v.codplanocontas));
      let v = 0;
      for (const c of contas) v += saldoPorConta.get(c) ?? 0;
      valores.set(Number(e.codestrutura), r2(v));
    }
    // (2) linhas 'F' — soma RECURSIVA das filhas (topológico, independe de `nivel`; cycle-safe + memoizado).
    // Funciona p/ qualquer profundidade (F-filha-de-F): uma F soma o valor já resolvido de cada filha,
    // recursando nas filhas que também são F. (Robusto contra `nivel` NULL/inconsistente do editor/import.)
    const visitando = new Set<number>();
    const somaFilhas = (cod: number): number => {
      if (valores.has(cod)) return valores.get(cod)!; // P já computado ou F memoizado
      if (visitando.has(cod)) return 0; // ciclo → 0
      visitando.add(cod);
      let v = 0;
      for (const f of filhosDe(cod)) {
        const fc = Number(f.codestrutura);
        v += f.tipo_calculo === 'F' ? somaFilhas(fc) : (valores.get(fc) ?? 0);
      }
      visitando.delete(cod);
      valores.set(cod, r2(v));
      return valores.get(cod)!;
    };
    for (const e of estrutura.filter((x) => x.tipo_calculo === 'F')) somaFilhas(Number(e.codestrutura));
    // (3) linhas 'E' — expressão sobre os totais das raízes nível-1 (por codexpandido).
    const porCodexp = new Map<string, number>();
    for (const e of estrutura) porCodexp.set(String(e.codexpandido), valores.get(Number(e.codestrutura)) ?? 0);
    for (const e of estrutura.filter((x) => x.tipo_calculo === 'E')) {
      const sub = String(e.expressao ?? '').replace(/<([^>]+)>/g, (_m, cod) => `(${porCodexp.get(String(cod).trim()) ?? 0})`);
      valores.set(Number(e.codestrutura), r2(avaliarAritmetica(sub)));
    }

    const linhas: LinhaDre[] = estrutura
      .map((e) => ({
        codestrutura: Number(e.codestrutura),
        codexpandido: String(e.codexpandido),
        descricao: String(e.descricao),
        tipo_calculo: String(e.tipo_calculo),
        classe: String(e.classe),
        nivel: Number(e.nivel),
        codpai: e.codpai != null ? Number(e.codpai) : null,
        valor: valores.get(Number(e.codestrutura)) ?? 0,
      }))
      .sort((a, b) => a.codexpandido.localeCompare(b.codexpandido));

    return { dataInicio: ini, dataFim: fim, linhas };
  }
}
