import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ItemDisponivelDevolucao } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * DEVOLUÇÃO DE COMPRA — serviço VERTICAL: o PICKER de saldo (itens de NF de entrada do fornecedor ainda
 * devolvíveis) + as transições de ESTADO (finalizar/reabrir/cancelar). O CRUD do documento é o agregado
 * (`devolucao-compra.aggregate`). corte-1 = SEM efeitos; a NF de saída (finalidade=4) e seus efeitos vêm
 * nos cortes 2/3.
 */
@Injectable()
export class DevolucaoCompraService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op(): number {
    const o = currentTenant().operadorId ?? null;
    if (o == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return o;
  }

  /**
   * PICKER (CarregaItens do legado): itens de NF de ENTRADA do fornecedor com SALDO devolvível > 0.
   * saldo = (quantidade × fatorembal da entrada) − Σ qtd_devolvida de devoluções não-canceladas. `cfop_devolucao`
   * vem do de-para CFOP.CFOP_DEVOLUCAO (null = origem sem CFOP de devolução configurado → não devolvível).
   */
  async itensDisponiveis(codparceiro: number, codnf?: number): Promise<ItemDisponivelDevolucao[]> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    let q = db
      .selectFrom('nf_prod as p')
      .innerJoin('nf as n', 'n.codnf', 'p.codnf')
      .leftJoin('produtos as pr', 'pr.idproduto', 'p.codproduto')
      .leftJoin('cfop as c', 'c.codcfop', 'p.cfop')
      .select([
        'p.codnf as codnf',
        'p.codnfprod as codnfprod',
        'p.codproduto as idproduto',
        'n.nronf as nronf',
        'p.nroitem as nroitem',
        'pr.descricao as descricao',
        'p.unidade as unidade',
        'p.fatorembal as fatorembalagem',
        'p.cfop as cfop_entrada',
        'c.cfop_devolucao as cfop_devolucao',
        'n.chavenfe as chavenfe',
        'p.vrcusto as valor_custo',
        sql<number>`coalesce(p.quantidade,0) * coalesce(p.fatorembal,1)`.as('qtd_nota_fiscal'),
        sql<number>`coalesce((
          SELECT sum(i.qtd_devolvida) FROM pedido_devolucao_compra_i i
          JOIN pedido_devolucao_compra d ON d.codpeddevcompra = i.codpeddevcompra
          WHERE i.codnf = p.codnf AND i.codnfprod = p.codnfprod
            AND d.idempresa = n.idempresa AND d.status <> 'CANCELADO' AND coalesce(d.indr,'I') <> 'E'
        ), 0)`.as('qtd_ja_devolvida'),
      ])
      .where('n.tipo', '=', 'E')
      .where('n.codparceiro', '=', codparceiro)
      .where('n.idempresa', '=', emp);
    // nota: `nf` não tem soft-delete por INDR (o cancelamento é por idsituacao_nf/estado — fora do escopo do
    // picker corte-1); listamos as NFs de entrada do fornecedor e o saldo cuida de esconder o já devolvido.
    if (codnf != null) q = q.where('p.codnf', '=', codnf);

    const rows = (await q.orderBy('p.codnf').orderBy('p.nroitem').execute()) as Array<Record<string, unknown>>;
    const num = (v: unknown) => (typeof v === 'string' ? Number(v) : (v as number)) || 0;
    return rows
      .map((r) => {
        const saldo = Math.round((num(r.qtd_nota_fiscal) - num(r.qtd_ja_devolvida) + Number.EPSILON) * 1000) / 1000;
        return { ...(r as any), saldo } as ItemDisponivelDevolucao;
      })
      .filter((r) => num(r.saldo) > 0);
  }

  /** carrega o documento com trava (forUpdate) e valida existência/empresa. */
  private async carregar(trx: AnyDB, codpeddevcompra: number, emp: number) {
    const d = await trx
      .selectFrom('pedido_devolucao_compra')
      .select(['codpeddevcompra', 'status'])
      .where('codpeddevcompra', '=', codpeddevcompra)
      .where('idempresa', '=', emp)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .forUpdate()
      .executeTakeFirst();
    if (!d) throw new BusinessRuleError('DEVOLUCAO_NAO_ENCONTRADA', { codpeddevcompra });
    return d as { codpeddevcompra: number; status: string };
  }

  private async setStatus(codpeddevcompra: number, de: string[], para: string, erroSeForaDoEstado: string) {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const d = await this.carregar(trx, codpeddevcompra, emp);
      if (!de.includes(d.status)) throw new BusinessRuleError(erroSeForaDoEstado, { status: d.status });
      const upd = await trx
        .updateTable('pedido_devolucao_compra')
        .set({ status: para, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpeddevcompra', '=', codpeddevcompra)
        .where('idempresa', '=', emp)
        .where('status', 'in', de) // CAS (cinto-e-suspensório com o forUpdate)
        .executeTakeFirst();
      if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError(erroSeForaDoEstado, { status: d.status });
      return { codpeddevcompra, status: para };
    });
  }

  /** FINALIZAR DIGITAÇÃO (EM_DIGITACAO → DIGITADO): exige ≥1 item. */
  async finalizar(codpeddevcompra: number): Promise<{ codpeddevcompra: number; status: string }> {
    const emp = this.emp();
    // exige ao menos 1 item antes de finalizar (btnFinalizar do legado).
    const n = await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('pedido_devolucao_compra_i')
      .select(({ fn }: any) => [fn.count('codpeddevcomprai').as('n')])
      .where('codpeddevcompra', '=', codpeddevcompra)
      .executeTakeFirst();
    if (Number((n as any)?.n ?? 0) === 0) throw new BusinessRuleError('DEVOLUCAO_SEM_ITENS', { codpeddevcompra });
    void emp;
    return this.setStatus(codpeddevcompra, ['EM_DIGITACAO'], 'DIGITADO', 'DEVOLUCAO_ESTADO_INVALIDO');
  }

  /** REABRIR PARA DIGITAÇÃO (DIGITADO → EM_DIGITACAO). */
  async reabrir(codpeddevcompra: number): Promise<{ codpeddevcompra: number; status: string }> {
    return this.setStatus(codpeddevcompra, ['DIGITADO'], 'EM_DIGITACAO', 'DEVOLUCAO_NAO_DIGITADA');
  }

  /** CANCELAR (EM_DIGITACAO/DIGITADO → CANCELADO): libera o saldo dos itens de volta (deixam de contar). */
  async cancelar(codpeddevcompra: number): Promise<{ codpeddevcompra: number; status: string }> {
    return this.setStatus(codpeddevcompra, ['EM_DIGITACAO', 'DIGITADO'], 'CANCELADO', 'DEVOLUCAO_NAO_CANCELAVEL');
  }
}
