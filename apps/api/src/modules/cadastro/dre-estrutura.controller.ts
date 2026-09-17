import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { dreContaVinculoSchema, dreEstruturaSchema, type DreContaVinculoDto, type DreEstruturaDto } from '@apollo/shared';
import { DreEstruturaService } from './dre-estrutura.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * CONFIGURADOR DO DRE CONTÁBIL (`FRMCONFIGDRECONTABIL`).
 * Ver é o gate de tela; mexer na árvore exige `BTNGRAVAR` — é o que muda todo relatório de resultado.
 */
@Controller('cadastro/dre-estrutura')
@UseGuards(AcessoGuard)
export class DreEstruturaController {
  constructor(private readonly svc: DreEstruturaService) {}

  private operador(req: { user?: { codoperador?: number } }): number | null {
    return req?.user?.codoperador ?? null;
  }

  @Get()
  @RequerAcesso('FRMCONFIGDRECONTABIL', 'FRMCONFIGDRECONTABIL')
  arvore() {
    return this.svc.arvore();
  }

  @Get(':cod/contas')
  @RequerAcesso('FRMCONFIGDRECONTABIL', 'FRMCONFIGDRECONTABIL')
  contas(@Param('cod', ParseIntPipe) cod: number) {
    return this.svc.contas(cod);
  }

  @Post()
  @RequerAcesso('FRMCONFIGDRECONTABIL', 'BTNGRAVAR')
  criar(@Body(new ZodValidationPipe(dreEstruturaSchema)) body: DreEstruturaDto, @Req() req: any) {
    return this.svc.criar(body, this.operador(req));
  }

  @Put(':cod')
  @RequerAcesso('FRMCONFIGDRECONTABIL', 'BTNGRAVAR')
  atualizar(
    @Param('cod', ParseIntPipe) cod: number,
    @Body(new ZodValidationPipe(dreEstruturaSchema)) body: DreEstruturaDto,
    @Req() req: any,
  ) {
    return this.svc.atualizar(cod, body, this.operador(req));
  }

  @Delete(':cod')
  @RequerAcesso('FRMCONFIGDRECONTABIL', 'BTNEXCLUIR')
  excluir(@Param('cod', ParseIntPipe) cod: number) {
    return this.svc.excluir(cod);
  }

  @Post('contas')
  @HttpCode(200)
  @RequerAcesso('FRMCONFIGDRECONTABIL', 'BTNGRAVAR')
  vincular(@Body(new ZodValidationPipe(dreContaVinculoSchema)) body: DreContaVinculoDto) {
    return this.svc.vincularContas(body);
  }
}
