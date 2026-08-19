import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  adiantamentoCriarSchema, adiantamentoEditarSchema, adiantamentoExcluirSchema, adiantamentoListarSchema,
  type AdiantamentoCriarDto, type AdiantamentoEditarDto, type AdiantamentoExcluirDto, type AdiantamentoListarDto,
} from '@apollo/shared';
import { AdiantamentoFornService } from './adiantamento-forn.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * ADIANTAMENTO A FORNECEDOR/PARCEIRO (FRMADIANTAMENTOFORNECEDOR). As 5 opções de RBAC são as do golden
 * (`select opcao, count(*) from permissoes where form='FRMADIANTAMENTOFORNECEDOR'`): o gate da tela,
 * BTNADICIONARREGISTRO/BTNGRAVAR (53 linhas/26 operadores cada) e BTNEXCLUIR (40/19 — privilégio menor).
 */
@Controller('cobranca/adiantamentos')
@UseGuards(AcessoGuard)
export class AdiantamentoFornController {
  constructor(private readonly svc: AdiantamentoFornService) {}

  @Post('listar')
  @HttpCode(200)
  @RequerAcesso('FRMADIANTAMENTOFORNECEDOR', 'FRMADIANTAMENTOFORNECEDOR')
  listar(@Body(new ZodValidationPipe(adiantamentoListarSchema)) dto: AdiantamentoListarDto) {
    return this.svc.listar(dto);
  }

  /** as situações de adiantamento (F19/F20/F21) — o combo do "adicionar", que define o TIPO. */
  @Get('situacoes')
  @RequerAcesso('FRMADIANTAMENTOFORNECEDOR', 'FRMADIANTAMENTOFORNECEDOR')
  situacoes() {
    return this.svc.situacoes();
  }

  /** as contas correntes do operador (o picker filtrado por CONTAS_BANCARIAS_OP) + saldo de cada uma. */
  @Get('contas')
  @RequerAcesso('FRMADIANTAMENTOFORNECEDOR', 'FRMADIANTAMENTOFORNECEDOR')
  contas() {
    return this.svc.contas();
  }

  @Post('criar')
  @HttpCode(200)
  @RequerAcesso('FRMADIANTAMENTOFORNECEDOR', 'BTNGRAVAR')
  criar(@Body(new ZodValidationPipe(adiantamentoCriarSchema)) dto: AdiantamentoCriarDto) {
    return this.svc.criar(dto);
  }

  @Post('editar')
  @HttpCode(200)
  @RequerAcesso('FRMADIANTAMENTOFORNECEDOR', 'BTNEDITAR')
  editar(@Body(new ZodValidationPipe(adiantamentoEditarSchema)) dto: AdiantamentoEditarDto) {
    return this.svc.editar(dto);
  }

  @Post('excluir')
  @HttpCode(200)
  @RequerAcesso('FRMADIANTAMENTOFORNECEDOR', 'BTNEXCLUIR')
  excluir(@Body(new ZodValidationPipe(adiantamentoExcluirSchema)) dto: AdiantamentoExcluirDto) {
    return this.svc.excluir(dto.codadiantamento);
  }
}
