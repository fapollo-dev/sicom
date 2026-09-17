import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { configConciliadorSchema, type ConfigConciliadorDto } from '@apollo/shared';
import { ConfigConciliadorService } from './config-conciliador.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * CONFIGURADOR DE CONCILIAÇÃO DE CARTÕES (`FRMCADCONFIGCONCILIADOR`) — RBAC: gate de tela.
 * O legado tem uma opção só para a tela inteira; quem entra, cadastra.
 */
@Controller('cadastro/config-conciliador')
@UseGuards(AcessoGuard)
export class ConfigConciliadorController {
  constructor(private readonly svc: ConfigConciliadorService) {}

  private operador(req: { user?: { codoperador?: number } }): number | null {
    return req?.user?.codoperador ?? null;
  }

  @Get()
  @RequerAcesso('FRMCADCONFIGCONCILIADOR', 'FRMCADCONFIGCONCILIADOR')
  listar() {
    return this.svc.listar();
  }

  @Get(':cicId')
  @RequerAcesso('FRMCADCONFIGCONCILIADOR', 'FRMCADCONFIGCONCILIADOR')
  obter(@Param('cicId', ParseIntPipe) cicId: number) {
    return this.svc.obter(cicId);
  }

  @Post()
  @RequerAcesso('FRMCADCONFIGCONCILIADOR', 'FRMCADCONFIGCONCILIADOR')
  criar(@Body(new ZodValidationPipe(configConciliadorSchema)) body: ConfigConciliadorDto, @Req() req: any) {
    return this.svc.criar(body, this.operador(req));
  }

  @Put(':cicId')
  @RequerAcesso('FRMCADCONFIGCONCILIADOR', 'FRMCADCONFIGCONCILIADOR')
  atualizar(
    @Param('cicId', ParseIntPipe) cicId: number,
    @Body(new ZodValidationPipe(configConciliadorSchema)) body: ConfigConciliadorDto,
    @Req() req: any,
  ) {
    return this.svc.atualizar(cicId, body, this.operador(req));
  }

  @Delete(':cicId')
  @RequerAcesso('FRMCADCONFIGCONCILIADOR', 'FRMCADCONFIGCONCILIADOR')
  excluir(@Param('cicId', ParseIntPipe) cicId: number) {
    return this.svc.excluir(cicId);
  }
}
