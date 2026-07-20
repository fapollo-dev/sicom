import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface MovimentoRazao {
  coddiario: number;
  datalan: string; // 'YYYY-MM-DD'
  historico: string; // complemento (DESCHIST do legado não migrado)
  documento: number | null; // idorigem (ex.: CODNF / CODBX)
  contrapartida: number; // a outra conta do lançamento (partida dobrada)
  debito: number;
  credito: number;
  saldo: number; // acumulado = saldo anterior + Σ(débito − crédito), convenção débito-positivo do legado
}
export interface ContaRazao {
  codplanocontas: number;
  codiexpandido: string | null;
  descricao: string | null;
  classe: string | null;
  saldoAnterior: number;
  movimentos: MovimentoRazao[];
  totalDebito: number;
  totalCredito: number;
  saldoFinal: number;
}

/**
 * LIVRO RAZÃO contábil (uRelRazaoContabil) — corte-2 do módulo contábil. Relatório READ-ONLY sobre o DIÁRIO:
 * por conta ANALÍTICA (classe='A'), o saldo ANTERIOR (lançamentos antes do período) + cada movimento do período
 * (a linha do diário aparece na conta de débito como DÉBITO e na de crédito como CRÉDITO — partida dobrada) +
 * saldo corrente. Convenção FIEL ao legado (uRelRazaoContabil:105-195): saldo = Σdébito − Σcrédito
 * (débito-positivo), independente da natureza da conta. Filtro opcional por conta; datas via to_char (sem TZ).
 */
@Injectable()
export class RazaoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(
    dataInicio?: string,
    dataFim?: string,
    codconta?: number,
    semMovimento = false,
  ): Promise<{ dataInicio: string; dataFim: string; contas: ContaRazao[] }> {
    const emp = this.emp();
    if (!dataInicio || dataInicio === '' || !dataFim || dataFim === '') throw new BusinessRuleError('RAZAO_PERIODO_OBRIGATORIO');
    if (dataInicio > dataFim) throw new BusinessRuleError('RAZAO_PERIODO_INVALIDO', { dataInicio, dataFim });
    const ini = dataInicio;
    const fim = dataFim;
    const cc = codconta != null && Number.isFinite(Number(codconta)) ? Number(codconta) : null;
    const db = this.dbp.forTenantRead() as AnyDB;

    // SALDO ANTERIOR (datalan < ini): Σ débito − Σ crédito por conta.
    let qDeb = db.selectFrom('diario').select(['contadebito as conta', sql<number>`sum(valor)`.as('v')])
      .where('codempresa', '=', emp).where('datalan', '<', ini as never);
    if (cc != null) qDeb = qDeb.where('contadebito', '=', cc);
    let qCred = db.selectFrom('diario').select(['contacredito as conta', sql<number>`sum(valor)`.as('v')])
      .where('codempresa', '=', emp).where('datalan', '<', ini as never);
    if (cc != null) qCred = qCred.where('contacredito', '=', cc);
    const [antDeb, antCred] = await Promise.all([qDeb.groupBy('contadebito').execute(), qCred.groupBy('contacredito').execute()]);
    const saldoAnt = new Map<number, number>();
    for (const r of antDeb as any[]) saldoAnt.set(Number(r.conta), r2((saldoAnt.get(Number(r.conta)) ?? 0) + Number(r.v)));
    for (const r of antCred as any[]) saldoAnt.set(Number(r.conta), r2((saldoAnt.get(Number(r.conta)) ?? 0) - Number(r.v)));

    // MOVIMENTOS do período.
    let qMov = db.selectFrom('diario')
      .select(['coddiario', sql<string>`to_char(datalan,'YYYY-MM-DD')`.as('datalan'), 'contadebito', 'contacredito', 'valor', 'complemento', 'idorigem'])
      .where('codempresa', '=', emp).where('datalan', '>=', ini as never).where('datalan', '<=', fim as never);
    if (cc != null) qMov = qMov.where((eb: any) => eb.or([eb('contadebito', '=', cc), eb('contacredito', '=', cc)]));
    const movs = await qMov.orderBy('datalan').orderBy('coddiario').execute();

    // expande cada linha do diário nas duas contas afetadas (débito e crédito). NOTA (fold consciente): o
    // legado usa UNION (distinct) SEM a PK do lançamento, então 2 lançamentos IDÊNTICOS (mesma data/conta/valor/
    // histórico/documento) colapsavam em 1 na lista de movimentos (subcontagem — o SALDO_ANTERIOR usa SUM e não
    // sofria, deixando o relatório legado internamente inconsistente). Aqui a chave é o coddiario → ambos os
    // lançamentos reais aparecem. É a correção do bug, não divergência de regra.
    const porConta = new Map<number, MovimentoRazao[]>();
    const push = (conta: number, m: MovimentoRazao) => {
      if (!porConta.has(conta)) porConta.set(conta, []);
      porConta.get(conta)!.push(m);
    };
    for (const d of movs as any[]) {
      const hist = String(d.complemento ?? '').trim();
      const doc = d.idorigem != null ? Number(d.idorigem) : null;
      const cd = Number(d.contadebito);
      const ccr = Number(d.contacredito);
      const val = r2(Number(d.valor));
      if (cc == null || cc === cd)
        push(cd, { coddiario: Number(d.coddiario), datalan: d.datalan, historico: hist, documento: doc, contrapartida: ccr, debito: val, credito: 0, saldo: 0 });
      if (cc == null || cc === ccr)
        push(ccr, { coddiario: Number(d.coddiario), datalan: d.datalan, historico: hist, documento: doc, contrapartida: cd, debito: 0, credito: val, saldo: 0 });
    }

    // universo de contas: com saldo anterior ≠ 0 OU com movimento (semMovimento=true inclui todas as analíticas).
    const ativos = new Set<number>([...saldoAnt.keys(), ...porConta.keys()]);
    let qPc = db.selectFrom('plano_contas')
      .select(['codplanocontas', 'codiexpandido', 'descricao', 'classe'])
      .where('classe', '=', 'A');
    if (!semMovimento) {
      if (ativos.size === 0) return { dataInicio: ini, dataFim: fim, contas: [] };
      qPc = qPc.where('codplanocontas', 'in', [...ativos]);
    }
    if (cc != null) qPc = qPc.where('codplanocontas', '=', cc);
    const pcs = await qPc.execute();

    const contas: ContaRazao[] = [];
    for (const p of pcs as any[]) {
      const id = Number(p.codplanocontas);
      const sa = r2(saldoAnt.get(id) ?? 0);
      const movimentos = (porConta.get(id) ?? []).slice().sort((a, b) => (a.datalan < b.datalan ? -1 : a.datalan > b.datalan ? 1 : a.coddiario - b.coddiario));
      let saldo = sa;
      let td = 0;
      let tc = 0;
      for (const m of movimentos) {
        saldo = r2(saldo + m.debito - m.credito);
        m.saldo = saldo;
        td = r2(td + m.debito);
        tc = r2(tc + m.credito);
      }
      // pula contas sem saldo anterior E sem movimento (a menos que semMovimento peça todas).
      if (!semMovimento && sa === 0 && movimentos.length === 0) continue;
      contas.push({
        codplanocontas: id,
        codiexpandido: p.codiexpandido ?? null,
        descricao: p.descricao ?? null,
        classe: p.classe ?? null,
        saldoAnterior: sa,
        movimentos,
        totalDebito: td,
        totalCredito: tc,
        saldoFinal: r2(sa + td - tc),
      });
    }
    // ordena por código expandido (fiel ao ORDER BY 2 do legado).
    contas.sort((a, b) => String(a.codiexpandido ?? '').localeCompare(String(b.codiexpandido ?? '')));
    return { dataInicio: ini, dataFim: fim, contas };
  }
}
