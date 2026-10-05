import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;

export interface LinhaCartoes {
  idempresa: number;
  operadora: string | null; administradora: string | null; codadm: number | null;
  diascomp: number; txadm: number;
  valor: number; valor_liquido: number;
  credito: number; debito: number; alimentacao: number;
  credito_bruto: number; debito_bruto: number; alimentacao_bruto: number;
}

/**
 * TOTAL POR CARTÃO (`FRMRELCARTOES`, `uRelCartoes.pas`). Dossiê: `uRelCartoes.md`.
 * 382 acessos, 7 operadores, o último em 02/09/2026.
 *
 * Soma as vendas em cartão do período por **operadora** (e a administradora dela, que é um parceiro), com o
 * bruto e o **líquido da taxa** — e separa por tipo de operadora (`:140-160`):
 *
 * | `OPERADORAS.TIPO` | coluna |
 * |---|---|
 * | `'C'` | crédito |
 * | `'D'` | débito |
 * | qualquer outra coisa (inclusive nulo) | **alimentação** |
 *
 * O "resto vira alimentação" é literal no legado (`CASE WHEN 'C' THEN 0 WHEN 'D' THEN 0 ELSE …`) — voucher,
 * vale e o que mais existir caem ali. Copiado como está.
 *
 * O líquido é `VALOR − VALOR × TXADM / 100`, com `COALESCE(TXADM, 0)`: operadora sem taxa cadastrada aqui
 * assume **zero** — diferente do saldo da empresa, que usa `coalesce(txadm, 0.1)`. São dois pontos do legado
 * com defaults diferentes para a mesma coisa, e cada um foi copiado do seu lugar.
 */
export interface FiltroCartoes {
  dataIni: string; dataFim: string; codoperadora?: number | null;
  operadora?: string | null; modoOperadora?: 'igual' | 'comeca' | 'termina' | 'contem' | 'diferente' | null; empresas?: number[] | null;
}

@Injectable()
export class RelCartoesService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async total(p: FiltroCartoes): Promise<{
    linhas: LinhaCartoes[];
    empresas: number[];
    totais: { valor: number; valor_liquido: number; taxa: number; credito: number; debito: number; alimentacao: number };
  }> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const oper = p.codoperadora ?? null;
    const empresas = await empresasDoOperador(db, p.empresas ?? null);
    // o edtOperadora: o texto como digitado contra UPPER(O.OPERADORA) — '=' / '<>' exatos, '%' do começo/fim/ambos no LIKE (SetaFiltro)
    const txt = (p.operadora ?? '').replace(/[%=]|<>/g, '');
    const filtroOperadora = !txt ? sql``
      : p.modoOperadora === 'diferente' ? sql`AND upper(o.operadora) <> ${txt}`
      : p.modoOperadora === 'comeca' ? sql`AND upper(o.operadora) LIKE ${`${txt}%`}`
      : p.modoOperadora === 'termina' ? sql`AND upper(o.operadora) LIKE ${`%${txt}`}`
      : p.modoOperadora === 'contem' ? sql`AND upper(o.operadora) LIKE ${`%${txt}%`}`
      : sql`AND upper(o.operadora) = ${txt}`;

    const rows = (await sql<Record<string, unknown>>`
      SELECT c.idempresa, o.operadora, p.fantasia AS administradora, o.codadm,
             coalesce(o.diascomp, 0) AS diascomp, o.txadm,
             sum(c.valor)::numeric(15,2) AS valor,
             sum(c.valor - (c.valor * coalesce(o.txadm, 0) / 100))::numeric(15,2) AS valor_liquido,
             sum(CASE WHEN o.tipo = 'C' THEN c.valor - (c.valor * coalesce(o.txadm,0)/100) ELSE 0 END)::numeric(15,2) AS credito,
             sum(CASE WHEN o.tipo = 'D' THEN c.valor - (c.valor * coalesce(o.txadm,0)/100) ELSE 0 END)::numeric(15,2) AS debito,
             -- o que não é 'C' nem 'D' (inclusive nulo) cai em ALIMENTAÇÃO — é literal no legado
             sum(CASE WHEN o.tipo IN ('C','D') THEN 0 ELSE c.valor - (c.valor * coalesce(o.txadm,0)/100) END)::numeric(15,2) AS alimentacao,
             sum(CASE WHEN o.tipo = 'C' THEN c.valor ELSE 0 END)::numeric(15,2) AS credito_bruto,
             sum(CASE WHEN o.tipo = 'D' THEN c.valor ELSE 0 END)::numeric(15,2) AS debito_bruto,
             sum(CASE WHEN o.tipo IN ('C','D') THEN 0 ELSE c.valor END)::numeric(15,2) AS alimentacao_bruto
        FROM cartao c
        LEFT JOIN operadoras o ON o.codoperadoras = c.codoperadora
        LEFT JOIN parceiros p  ON p.codparceiro = o.codadm
       WHERE c.dtvenda::date BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date
         AND c.idempresa = ANY(${empresas})
         AND (${oper}::int IS NULL OR c.codoperadora = ${oper}::int)
         ${filtroOperadora}
       GROUP BY c.idempresa, o.operadora, p.fantasia, o.codadm, coalesce(o.diascomp, 0), o.txadm
       -- ORDER BY IDEMPRESA, CODADM (o legado); a operadora desempata
       ORDER BY c.idempresa, o.codadm NULLS LAST, o.operadora
    `.execute(db)).rows;

    const n = (v: unknown) => Number(v ?? 0);
    const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
    const soma = (k: string) => r2(rows.reduce((s, l) => s + n(l[k]), 0));
    const valor = soma('valor');
    const liquido = soma('valor_liquido');

    return {
      empresas,
      linhas: rows.map((l) => ({
        idempresa: Number(l.idempresa),
        operadora: (l.operadora as string) ?? null,
        administradora: (l.administradora as string) ?? null,
        codadm: l.codadm == null ? null : Number(l.codadm),
        diascomp: Number(l.diascomp ?? 0), txadm: l.txadm == null ? (null as unknown as number) : n(l.txadm),
        valor: n(l.valor), valor_liquido: n(l.valor_liquido),
        credito: n(l.credito), debito: n(l.debito), alimentacao: n(l.alimentacao),
        credito_bruto: n(l.credito_bruto), debito_bruto: n(l.debito_bruto), alimentacao_bruto: n(l.alimentacao_bruto),
      })),
      totais: {
        valor, valor_liquido: liquido,
        taxa: r2(valor - liquido),   // o que a operadora fica — é o número que o gerente procura
        credito: soma('credito'), debito: soma('debito'), alimentacao: soma('alimentacao'),
      },
    };
  }

  /**
   * A impressão (`btnImprimirClick`): `Rel_Total_Cartao.fr3` com o `cdsConsulta` (os nomes do GetSQL: OPERADORA, FANTASIA, CODADM,
   * DIASCOMP, IDEMPRESA, TXADM e os VALOR_*) agrupado por loja, e as variáveis DtInicial, DtFinal e Empresa (as lojas do
   * GetMultiEmpresa). Sem dados: "Não há dados no filtro informado. Verifique!".
   */
  async impressao(p: FiltroCartoes) {
    const r = await this.total(p);
    if (!r.linhas.length) throw new BusinessRuleError('RELATORIO_SEM_DADOS', {}, 'Não há dados no filtro informado. Verifique!');
    const db = this.dbp.forTenantRead() as AnyDB;
    const br = (d: string) => d.split('-').reverse().join('/');
    return {
      titulo: 'Total por cartão',
      modelo: await modeloFr3(db, 'Rel_Total_Cartao.fr3'),
      datasets: {
        frxDBDataset1: r.linhas.map((l) => registroFr3({
          operadora: l.operadora, fantasia: l.administradora, codadm: l.codadm, diascomp: l.diascomp, idempresa: l.idempresa, txadm: l.txadm,
          valor: l.valor, valor_liquido: l.valor_liquido, valor_credito: l.credito, valor_debito: l.debito, valor_alimentacao: l.alimentacao,
          valor_credito_bruto: l.credito_bruto, valor_debito_bruto: l.debito_bruto, valor_alimentacao_bruto: l.alimentacao_bruto,
        })),
      },
      variaveis: { DtInicial: textoVariavel(br(p.dataIni)), DtFinal: textoVariavel(br(p.dataFim)), Empresa: textoVariavel(r.empresas.join(',')) },
    };
  }
}
