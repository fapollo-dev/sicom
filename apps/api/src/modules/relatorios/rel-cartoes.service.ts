import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

export interface LinhaCartoes {
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
@Injectable()
export class RelCartoesService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async total(p: { dataIni: string; dataFim: string; codoperadora?: number | null }): Promise<{
    linhas: LinhaCartoes[];
    totais: { valor: number; valor_liquido: number; taxa: number; credito: number; debito: number; alimentacao: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const oper = p.codoperadora ?? null;

    const rows = (await sql<Record<string, unknown>>`
      SELECT o.operadora, p.fantasia AS administradora, o.codadm,
             coalesce(o.diascomp, 0) AS diascomp, coalesce(o.txadm, 0) AS txadm,
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
         AND c.idempresa = ${emp}
         AND (${oper}::int IS NULL OR c.codoperadora = ${oper}::int)
       GROUP BY o.operadora, p.fantasia, o.codadm, o.diascomp, o.txadm
       ORDER BY o.codadm NULLS LAST, o.operadora
    `.execute(db)).rows;

    const n = (v: unknown) => Number(v ?? 0);
    const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
    const soma = (k: string) => r2(rows.reduce((s, l) => s + n(l[k]), 0));
    const valor = soma('valor');
    const liquido = soma('valor_liquido');

    return {
      linhas: rows.map((l) => ({
        operadora: (l.operadora as string) ?? null,
        administradora: (l.administradora as string) ?? null,
        codadm: l.codadm == null ? null : Number(l.codadm),
        diascomp: Number(l.diascomp ?? 0), txadm: n(l.txadm),
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
}
