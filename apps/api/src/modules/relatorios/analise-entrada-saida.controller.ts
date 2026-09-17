import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { analiseEntradaSaidaSchema, type AnaliseEntradaSaidaDto } from '@apollo/shared';
import { AnaliseEntradaSaidaService } from './analise-entrada-saida.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/** ANÁLISE DE ENTRADA × SAÍDA (`FRMANALISEENTRADAXSAIDA`) — RBAC: gate de tela. */
@Controller('relatorios/analise-entrada-saida')
@UseGuards(AcessoGuard)
export class AnaliseEntradaSaidaController {
  constructor(private readonly svc: AnaliseEntradaSaidaService) {}

  @Get()
  @RequerAcesso('FRMANALISEENTRADAXSAIDA', 'FRMANALISEENTRADAXSAIDA')
  gerar(@Query(new ZodValidationPipe(analiseEntradaSaidaSchema)) q: AnaliseEntradaSaidaDto) {
    return this.svc.gerar({
      dataIni: q.dataIni, dataFim: q.dataFim, origemSaida: q.origemSaida ?? null,
      fornecedor: q.fornecedor ?? null, grupo: q.grupo ?? null, departamento: q.departamento ?? null,
    });
  }
}
