import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { currentTenant } from '../../shared/tenant/tenant-context';

/**
 * As colunas de produto das grades da Gestão de Promoções (UDMCadPromocao: `JOIN PRODUTOS P` + `JOIN MULTI_PRECO M ON M.IDEMPRESA = C.LOJA`):
 * o código de barras, a descrição, o grupo de preço e o VRVENDA da loja ("Vr. Sem Desc.", base dos derivados de cada aba).
 */
@Controller('cadastro/promocao-produtos')
@UseGuards(AcessoGuard)
export class PromocaoProdutosController {
  constructor(private readonly dbp: DatabaseProvider) {}

  @Get()
  @RequerAcesso('FRMCADPROMOCAO', 'FRMCADPROMOCAO')
  async produtos(@Query('ids') ids?: string) {
    const lista = String(ids ?? '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
    if (!lista.length) return [];
    const emp = currentTenant().empresaId ?? -1;
    return (await sql<Record<string, unknown>>`
      SELECT p.idproduto, p.codbarra, p.descricao, p.codgrupopreco, m.vrvenda
        FROM produtos p LEFT JOIN multi_preco m ON m.idproduto = p.idproduto AND m.idempresa = ${emp}
       WHERE p.idproduto = ANY(${lista}::int[])`.execute(this.dbp.forTenantRead() as Kysely<any>)).rows
      .map((r) => ({ ...r, idproduto: Number(r.idproduto), codgrupopreco: Number(r.codgrupopreco ?? 0), vrvenda: r.vrvenda == null ? null : Number(r.vrvenda) }));
  }
}
