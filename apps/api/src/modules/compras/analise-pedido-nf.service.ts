import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** linha de saldo por produto do pedido (qtd pedida − Σ recebida nas NFs vinculadas). */
export interface SaldoItem {
  idproduto: number;
  descricao: string | null;
  qtdPedido: number;
  qtdRecebida: number;
  saldo: number; // pode ser negativo (recebeu a MAIS = divergência, tratada na Análise/corte-2)
}

/**
 * ANÁLISE PEDIDO × NF — corte-1: SALDO do pedido de compra recebido em VÁRIAS NFs (1:N). Fiel à query de saldo do
 * legado (udmNF.dfm:17495, FDqSaldoPedidoCompra) adaptada ao modelo single-empresa do monorepo (a 078 achatou o
 * neto PEDIDO_COMPRA_QTDE em pedidocompra_i.qtdtotal):
 *
 *   qtd_pedido(produto)   = Σ pedidocompra_i.qtdtotal do produto no pedido
 *   qtd_recebida(produto) = Σ (nf_prod.quantidade × nf_prod.fatorembal) das NFs vinculadas (nf.codpedcomp),
 *                           correlacionadas POR PRODUTO (nf_prod.codproduto = pedidocompra_i.idproduto)
 *   saldo                 = qtd_pedido − qtd_recebida
 *
 * Correlação por PRODUTO (decisão de tenant, fiel ao legado — NF_PROD não tem CODPEDCOMPI). Conta TODAS as NFs
 * vinculadas não-estornadas; o filtro por status de liberação (STATUS_PEDCOMP) entra no corte-2 (Análise). Tenant
 * `idempresa` fail-closed. READ-ONLY.
 */
@Injectable()
export class AnalisePedidoNfService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** garante que o pedido existe no tenant (fail-closed) e devolve seus metadados básicos. */
  private async carregarPedido(db: AnyDB, codpedcomp: number, emp: number): Promise<{ codpedcomp: number; fechado?: string; codparceiro?: number }> {
    const p = (await db
      .selectFrom('pedidocompra')
      .select(['codpedcomp', 'fechado', 'codparceiro'])
      .where('codpedcomp', '=', codpedcomp)
      .where('idempresa', '=', emp)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { codpedcomp: number; fechado?: string; codparceiro?: number } | undefined;
    if (!p) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });
    return p;
  }

  /** saldo por produto do pedido. Lança PEDIDO_NAO_ENCONTRADO se fora do tenant. */
  async saldo(codpedcomp: number): Promise<{ codpedcomp: number; itens: SaldoItem[]; saldoTotal: number; totalmenteRecebido: boolean }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.carregarPedido(db, codpedcomp, emp);

    // qtd pedida por produto (Σ qtdtotal) + qtd recebida (subquery correlacionada por produto sobre as NFs
    // vinculadas não-estornadas). fatorembal default 1 (a NF de entrada usa fatorembal=1 pois quantidade já é
    // a qtde em unidades — mesma convenção do gerarNf/import). SQL raw (uma query): o vínculo NF↔pedido é por
    // PRODUTO (nf_prod.codproduto = pedidocompra_i.idproduto), fiel ao legado (udmNF.dfm:17495).
    const rows = (
      await sql<{ idproduto: number; descricao: string | null; qtd_pedido: unknown; qtd_recebida: unknown }>`
        select i.idproduto as idproduto,
               o.descricao as descricao,
               sum(coalesce(i.qtdtotal, i.fatorembalagem, 0)) as qtd_pedido,
               coalesce((
                 select sum(np.quantidade * coalesce(np.fatorembal, 1))
                 from nf_prod np
                 join nf n on n.codnf = np.codnf
                 where n.codpedcomp = ${codpedcomp} and n.idempresa = ${emp}
                   and coalesce(n.cancelada, 'N') <> 'S' and coalesce(n.statusnfe, '') <> 'C'
                   and np.codproduto = i.idproduto
               ), 0) as qtd_recebida
        from pedidocompra_i i
        left join produtos o on o.idproduto = i.idproduto
        where i.codpedcomp = ${codpedcomp}
        group by i.idproduto, o.descricao
        order by i.idproduto
      `.execute(db)
    ).rows;

    const itens: SaldoItem[] = rows.map((r) => {
      const qtdPedido = r3(num(r.qtd_pedido));
      const qtdRecebida = r3(num(r.qtd_recebida));
      return { idproduto: Number(r.idproduto), descricao: r.descricao ?? null, qtdPedido, qtdRecebida, saldo: r3(qtdPedido - qtdRecebida) };
    });
    const saldoTotal = r3(itens.reduce((s, it) => s + it.saldo, 0));
    // totalmente recebido = nenhum item com saldo > 0 (saldo ≤ 0 em todos; negativo = recebeu a mais).
    const totalmenteRecebido = itens.length > 0 && itens.every((it) => it.saldo <= 0);
    return { codpedcomp, itens, saldoTotal, totalmenteRecebido };
  }
}
