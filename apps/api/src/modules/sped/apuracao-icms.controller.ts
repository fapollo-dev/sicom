import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { apuracaoIcmsProcessarSchema, apuracaoIcmsObterSchema, type ApuracaoIcmsProcessarDto, type ApuracaoIcmsObterDto } from '@apollo/shared';
import { ApuracaoIcmsService } from './apuracao-icms.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * APURAÇÃO DE ICMS (FRMRELREGISTROS_ES) — o processo que produz o E110. RBAC: as duas opções reais do form no
 * golden — o gate da tela (17 linhas/7 operadores) e `BTNCONSULTA` (35/15).
 */
@Controller('fiscal/apuracao-icms')
@UseGuards(AcessoGuard)
export class ApuracaoIcmsController {
  constructor(private readonly svc: ApuracaoIcmsService) {}

  /** processa (ou reprocessa) a apuração do período. */
  @Post('processar')
  @HttpCode(200)
  @RequerAcesso('FRMRELREGISTROS_ES', 'FRMRELREGISTROS_ES')
  processar(@Body(new ZodValidationPipe(apuracaoIcmsProcessarSchema)) dto: ApuracaoIcmsProcessarDto) {
    return this.svc.processar(dto);
  }

  /** consulta uma apuração já gravada (por código ou por período). */
  @Post('obter')
  @HttpCode(200)
  @RequerAcesso('FRMRELREGISTROS_ES', 'BTNCONSULTA')
  obter(@Body(new ZodValidationPipe(apuracaoIcmsObterSchema)) dto: ApuracaoIcmsObterDto) {
    return this.svc.obter(dto);
  }

  /** o livro de apuração no layout do cliente (`Notas_fiscais_Registro_Apuracao.fr3`), com o número do livro e a folha */
  @Get(':cod/impressao')
  @RequerAcesso('FRMRELREGISTROS_ES', 'FRMRELREGISTROS_ES')
  impressao(@Param('cod', ParseIntPipe) cod: number, @Query('livro') livro?: string, @Query('folha') folha?: string) {
    return this.svc.impressao(cod, livro, folha);
  }
}
