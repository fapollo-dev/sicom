import { Body, Controller, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { NfClonarService } from './nf-clonar.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

const clonarSchema = z.object({ operacao: z.enum(['CLONAR', 'TRANSFERENCIA']) });

/** CLONAR a nota / gerar a NOTA DE TRANSFERÊNCIA entre lojas (ClonaNF). Gerar nota é incluir registro na tela da NF. */
@Controller('fiscal/nf')
@UseGuards(AcessoGuard)
export class NfClonarController {
  constructor(private readonly svc: NfClonarService) {}

  @Post(':id/clonar')
  @HttpCode(201)
  @RequerAcesso('FRMNF', 'BTNADICIONARREGISTRO')
  clonar(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(clonarSchema)) body: z.infer<typeof clonarSchema>) {
    return this.svc.gerar(id, body.operacao);
  }
}
