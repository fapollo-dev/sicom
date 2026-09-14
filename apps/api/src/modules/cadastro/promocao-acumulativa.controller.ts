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
    return this.svc.listar({ descricao: q.descricao ?? null, vigentes: q.vigentes ?? false });
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

  @Delete(':id')
  @RequerAcesso('FRMCADPROMOCAOACUMULATIVA', 'FRMCADPROMOCAOACUMULATIVA')
  excluir(@Param('id', ParseIntPipe) id: number) {
    return this.svc.excluir(id);
  }
}
