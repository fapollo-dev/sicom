import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { relCurvaAbcFornecedorSchema, type RelCurvaAbcFornecedorDto } from '@apollo/shared';
import { RelCurvaAbcFornecedorService } from './rel-curva-abc-fornecedor.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** CURVA ABC POR FORNECEDOR (`FRMRELCURVAABCFORNECEDOR`) — a PERMISSOES só tem o gate da tela (o Imprimir não tem opção própria). */
@Controller('relatorios/curva-abc-fornecedor')
@UseGuards(AcessoGuard)
export class RelCurvaAbcFornecedorController {
  constructor(private readonly svc: RelCurvaAbcFornecedorService) {}

  @Post()
  @HttpCode(200)
  @RequerAcesso('FRMRELCURVAABCFORNECEDOR', 'FRMRELCURVAABCFORNECEDOR')
  gerar(@Body(new ZodValidationPipe(relCurvaAbcFornecedorSchema)) dto: RelCurvaAbcFornecedorDto) { return this.svc.gerar(dto); }

  @Post('impressao')
  @HttpCode(200)
  @RequerAcesso('FRMRELCURVAABCFORNECEDOR', 'FRMRELCURVAABCFORNECEDOR')
  impressao(@Body(new ZodValidationPipe(relCurvaAbcFornecedorSchema)) dto: RelCurvaAbcFornecedorDto) { return this.svc.impressao(dto); }
}
