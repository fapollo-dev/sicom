import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { confIntegBancariaSchema, type ConfIntegBancariaDto } from '@apollo/shared';
import { ConfIntegBancariaService } from './conf-integ-bancaria.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CONFIGURAÇÃO DA INTEGRAÇÃO BANCÁRIA — BOLETO (`FRMCONFINTEGBANCARIA`). */
@Controller('cobranca/conf-integ-bancaria')
@UseGuards(AcessoGuard)
export class ConfIntegBancariaController {
  constructor(private readonly svc: ConfIntegBancariaService) {}

  private op(req: { user?: { codoperador?: number } }): number | null {
    return req?.user?.codoperador ?? null;
  }

  @Get()
  @RequerAcesso('FRMCONFINTEGBANCARIA', 'FRMCONFINTEGBANCARIA')
  listar() {
    return this.svc.listar();
  }

  @Post()
  @RequerAcesso('FRMCONFINTEGBANCARIA', 'BTNGRAVAR')
  criar(@Body(new ZodValidationPipe(confIntegBancariaSchema)) b: ConfIntegBancariaDto, @Req() req: any) {
    return this.svc.criar(b, this.op(req));
  }

  @Put(':codconf')
  @RequerAcesso('FRMCONFINTEGBANCARIA', 'BTNGRAVAR')
  atualizar(@Param('codconf', ParseIntPipe) codconf: number, @Body(new ZodValidationPipe(confIntegBancariaSchema)) b: ConfIntegBancariaDto, @Req() req: any) {
    return this.svc.atualizar(codconf, b, this.op(req));
  }

  @Delete(':codconf')
  @RequerAcesso('FRMCONFINTEGBANCARIA', 'BTNEXCLUIR')
  excluir(@Param('codconf', ParseIntPipe) codconf: number) {
    return this.svc.excluir(codconf);
  }
}
