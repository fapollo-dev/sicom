import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RazaoService } from './razao.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

/**
 * LIVRO RAZÃO contábil (uRelRazaoContabil) — relatório READ-ONLY do DIÁRIO por conta/período. Path
 * `cadastro/razao`. RBAC FRMRELRAZAOCONTABIL. Query: dataInicio, dataFim, codconta? (filtro), semMovimento?.
 */
@Controller('cadastro/razao')
@UseGuards(AcessoGuard)
export class RazaoController {
  constructor(private readonly svc: RazaoService) {}

  @Get()
  @RequerAcesso('FRMRELRAZAOCONTABIL', 'BTNVISUALIZAR')
  gerar(@Query() q: Record<string, string>) {
    const cc = q.codconta != null && q.codconta !== '' ? Number(q.codconta) : undefined;
    return this.svc.gerar(q.dataInicio, q.dataFim, cc, q.semMovimento === 'true' || q.semMovimento === '1');
  }
}
