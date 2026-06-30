import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { recalcularNfSchema } from '@apollo/shared';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';
import { NfFiscalService } from './nf-fiscal.service';

/**
 * NF — Fase 2: endpoint de RECÁLCULO fiscal (POST /fiscal/nf/recalcular). PURO: recebe o dto
 * da NF (header + itens) e devolve o dto com os impostos por item preenchidos (ICMS próprio,
 * ICMS-ST, IPI) reusando o motor `precificacao` — NÃO grava (sem efeito; espelha o "Calcular
 * venda" do Produto). A persistência continua no save do agregado (NfAggregateController).
 *
 * Sem @RequerAcesso (é cálculo, como POST /precificacao/produto); o TenantMiddleware (rota
 * 'fiscal') garante o contexto p/ a réplica tenant-scoped.
 */
@Controller('fiscal/nf')
export class NfFiscalController {
  constructor(private readonly fiscal: NfFiscalService) {}

  @Post('recalcular')
  @HttpCode(200) // cálculo (não cria recurso) — 200, não o 201 default do POST
  recalcular(@Body(new ZodValidationPipe(recalcularNfSchema)) dto: Record<string, unknown>) {
    return this.fiscal.recalcular(dto);
  }
}
