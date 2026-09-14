import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { promocaoAcumulativaSchema, promocaoAcumulativaFiltroSchema,
  type PromocaoAcumulativaDto, type PromocaoAcumulativaFiltroDto } from '@apollo/shared';
import { PromocaoAcumulativaService } from './promocao-acumulativa.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** PROMOÇÃO ACUMULATIVA (`FRMCADPROMOCAOACUMULATIVA`) — RBAC: gate de tela, como no legado. */
@Controller('cadastro/promocao-acumulativa')
@UseGuards(AcessoGuard)
export class PromocaoAcumulativaController {
  constructor(private readonly svc: PromocaoAcumulativaService) {}

  @Get()
  @RequerAcesso('FRMCADPROMOCAOACUMULATIVA', 'FRMCADPROMOCAOACUMULATIVA')
  listar(@Query(new ZodValidationPipe(promocaoAcumulativaFiltroSchema)) q: PromocaoAcumulativaFiltroDto) {
    return this.svc.listar({ descricao: q.descricao ?? null, situacao: q.situacao ?? 'TODAS' });
  }

  @Post()
  @RequerAcesso('FRMCADPROMOCAOACUMULATIVA', 'FRMCADPROMOCAOACUMULATIVA')
  salvar(@Body(new ZodValidationPipe(promocaoAcumulativaSchema)) b: PromocaoAcumulativaDto) {
    return this.svc.salvar({
      idproacumulativa: b.idproacumulativa ?? null,
      idproduto: b.idproduto, qtde: b.qtde, desconto: b.desconto,
      dtini: b.dtini, dtfim: b.dtfim, empresas: b.empresas,
      atacarejo: b.atacarejo ?? 'N', usarGrupoPreco: b.usarGrupoPreco ?? false,
    });
  }

  /** a grade `dbgPromocao`: os produtos do grupo de preço, com a promoção de cada um. */
  @Get('grupo/:codgrupopreco')
  @RequerAcesso('FRMCADPROMOCAOACUMULATIVA', 'FRMCADPROMOCAOACUMULATIVA')
  produtosDoGrupo(@Param('codgrupopreco', ParseIntPipe) cod: number) {
    return this.svc.produtosDoGrupo(cod);
  }

  /** ⚠️ exige senha administrativa, como o legado (`btnExcluirClick:130`). */
  @Delete(':id')
  @RequerAcesso('FRMCADPROMOCAOACUMULATIVA', 'FRMCADPROMOCAOACUMULATIVA')
  excluir(@Param('id', ParseIntPipe) id: number, @Query('senhaOperacao') senha?: string) {
    return this.svc.excluir(id, senha ?? null);
  }

  /** o OUTRO excluir: apaga a promoção de todos os produtos do grupo de preço, sem filtro de data ou loja. */
  @Delete('grupo/:codgrupopreco')
  @RequerAcesso('FRMCADPROMOCAOACUMULATIVA', 'FRMCADPROMOCAOACUMULATIVA')
  excluirGrupo(@Param('codgrupopreco', ParseIntPipe) cod: number, @Query('senhaOperacao') senha?: string) {
    return this.svc.excluirGrupo(cod, senha ?? null);
  }
}
