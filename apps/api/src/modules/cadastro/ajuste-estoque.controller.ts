import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ajustarEstoqueSchema } from '@apollo/shared';
import { AjusteEstoqueService } from './ajuste-estoque.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso, RequerAcessoDeAlgum } from '../../shared/acesso/requer-acesso.decorator';

/**
 * AJUSTE DE ESTOQUE (FRMAJUSTEESTOQUE) — controller VERTICAL (o service filtra por idempresa). Leitura livre
 * (histórico); as AÇÕES (ajustar/estornar) exigem RBAC FRMAJUSTEESTOQUE.
 */
@Controller('cadastro/ajuste-estoque')
@UseGuards(AcessoGuard)
export class AjusteEstoqueController {
  constructor(private readonly svc: AjusteEstoqueService) {}

  @Get()
  listar(@Query('limite') limite?: string) {
    return this.svc.listar(limite ? Number(limite) : undefined);
  }

  /** a aba Histórico (Filtrar sem Tag: o acesso à tela) — período e produto opcionais, a loja do login. Também o "Detalhar" do
   *  kardex do produto, que abre a tela sem o gate dela (`TfrmAjusteEstoque.Create` de dentro do cadastro de produto). */
  @Get('consulta')
  @RequerAcessoDeAlgum(['FRMAJUSTEESTOQUE', 'FRMAJUSTEESTOQUE'], ['FRMCADPRODUTO', 'FRMCADPRODUTO'])
  consulta(@Query('dtini') dtini?: string, @Query('dtfim') dtfim?: string, @Query('idproduto') idproduto?: string) {
    return this.svc.consulta({ dtini, dtfim, idproduto: idproduto ? Number(idproduto) : undefined });
  }

  /** o "Imprimir" da aba Histórico (AjusteEstoque.fr3 do cliente) */
  @Get('consulta/impressao')
  @RequerAcessoDeAlgum(['FRMAJUSTEESTOQUE', 'FRMAJUSTEESTOQUE'], ['FRMCADPRODUTO', 'FRMCADPRODUTO'])
  impressaoConsulta(@Query('dtini') dtini?: string, @Query('dtfim') dtfim?: string, @Query('idproduto') idproduto?: string) {
    return this.svc.impressaoConsulta({ dtini, dtfim, idproduto: idproduto ? Number(idproduto) : undefined });
  }

  @Post()
  @HttpCode(200)
  @RequerAcesso('FRMAJUSTEESTOQUE', 'BTNOK')
  ajustar(@Body(new ZodValidationPipe(ajustarEstoqueSchema)) dto: Record<string, unknown>) {
    return this.svc.ajustar(dto as any);
  }

  @Post(':id/estornar')
  @HttpCode(200)
  @RequerAcesso('FRMAJUSTEESTOQUE', 'FRMAJUSTEESTOQUE')
  estornar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.estornar(id);
  }
}
