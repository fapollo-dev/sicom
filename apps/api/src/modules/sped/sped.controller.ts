import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { gerarSpedSchema, type GerarSpedDto } from '@apollo/shared';
import { SpedEfdContribuicoesService } from './sped-efd-contribuicoes.service';
import { SpedEfdIcmsIpiService } from './sped-efd-icms-ipi.service';
import { SpedApuracaoPcService } from './sped-apuracao-pc.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * SPED (fiscal) — geração dos arquivos. Corte-1: EFD-Contribuições SCAFFOLD (bloco 0 + 9). RBAC FRMSPEDPISCOFINS.
 * O TenantMiddleware cobre 'fiscal' (identidade/empresa do token). Retorna o texto do arquivo (parcial).
 */
@Controller('fiscal/sped')
@UseGuards(AcessoGuard)
export class SpedController {
  constructor(
    private readonly efd: SpedEfdContribuicoesService,
    private readonly efdIcmsIpi: SpedEfdIcmsIpiService,
    private readonly apuracao: SpedApuracaoPcService,
  ) {}

  @Post('efd-contribuicoes')
  @HttpCode(200)
  @RequerAcesso('FRMSPEDPISCOFINS', 'BTNGERAR')
  gerarEfdContribuicoes(@Body(new ZodValidationPipe(gerarSpedSchema)) dto: GerarSpedDto) {
    return this.efd.gerar(dto.dtini, dto.dtfim);
  }

  /** EFD ICMS/IPI (SPED Fiscal) — corte-1: bloco 0 + C (entrada + C190) + E (apuração ICMS crédito) + 9. */
  @Post('efd-icms-ipi')
  @HttpCode(200)
  @RequerAcesso('FRMSPEDPISCOFINS', 'BTNGERAR')
  gerarEfdIcmsIpi(@Body(new ZodValidationPipe(gerarSpedSchema)) dto: GerarSpedDto) {
    return this.efdIcmsIpi.gerar(dto.dtini, dto.dtfim);
  }

  /** apura o CRÉDITO de PIS/COFINS de entrada do período (popula apuracao_pc/_det p/ o bloco M). */
  @Post('apuracao-pc')
  @HttpCode(200)
  @RequerAcesso('FRMSPEDPISCOFINS', 'BTNGERAR')
  apurarPc(@Body(new ZodValidationPipe(gerarSpedSchema)) dto: GerarSpedDto) {
    return this.apuracao.apurar(dto.dtini, dto.dtfim);
  }
}
