import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { relTicketMedioSchema, type RelTicketMedioDto } from '@apollo/shared';
import { RelTicketMedioService } from './rel-ticket-medio.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** VALOR DO TICKET MÉDIO (FRMVALORTICKETMEDIO). RBAC: gate de tela (a única opção do form no Oracle). */
@Controller('relatorios/ticket-medio')
@UseGuards(AcessoGuard)
export class RelTicketMedioController {
  constructor(private readonly svc: RelTicketMedioService) {}

  @Post('consultar')
  @HttpCode(200)
  @RequerAcesso('FRMVALORTICKETMEDIO', 'FRMVALORTICKETMEDIO')
  consultar(@Body(new ZodValidationPipe(relTicketMedioSchema)) dto: RelTicketMedioDto) {
    return this.svc.consultar(dto);
  }
}
