import { Body, Controller, Get, HttpCode, Put, Query, Req, UseGuards } from '@nestjs/common';
import { confPlanoContasSchema, type ConfPlanoContasDto } from '@apollo/shared';
import { ConfPlanoContasService } from './conf-plano-contas.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CONFIGURAÇÕES DO PLANO DE CONTAS (`FRMCADCONFPLANOCONTAS`). */
@Controller('cadastro/conf-plano-contas')
@UseGuards(AcessoGuard)
export class ConfPlanoContasController {
  constructor(private readonly svc: ConfPlanoContasService) {}

  @Get()
  @RequerAcesso('FRMCADCONFPLANOCONTAS', 'FRMCADCONFPLANOCONTAS')
  obter(@Query('tipo') tipo?: string) {
    return this.svc.obter(tipo === 'R' ? 'R' : 'E');
  }

  @Put()
  @HttpCode(200)
  @RequerAcesso('FRMCADCONFPLANOCONTAS', 'BTNGRAVAR')
  gravar(@Body(new ZodValidationPipe(confPlanoContasSchema)) b: ConfPlanoContasDto, @Req() req: any) {
    return this.svc.gravar(b, req?.user?.codoperador ?? null);
  }
}
