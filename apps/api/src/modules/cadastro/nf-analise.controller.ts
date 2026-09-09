import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { analiseNfSchema, type AnaliseNfDto } from '@apollo/shared';
import { NfAnaliseService } from './nf-analise.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * ANÁLISE DE NOTAS FISCAIS (`FRMNFANALISE`). RBAC: gate de tela — o cliente não separa por botão
 * (o "[F11] Imprimir" não é permissão própria).
 */
@Controller('fiscal/nf-analise')
@UseGuards(AcessoGuard)
export class NfAnaliseController {
  constructor(private readonly svc: NfAnaliseService) {}

  @Post()
  @HttpCode(200)
  @RequerAcesso('FRMNFANALISE', 'FRMNFANALISE')
  analisar(@Body(new ZodValidationPipe(analiseNfSchema)) body: AnaliseNfDto) {
    const { modelo, ...f } = body;
    return this.svc.analisar(modelo, f as never);
  }
}
