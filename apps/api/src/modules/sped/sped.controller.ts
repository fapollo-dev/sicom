import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { gerarSpedSchema, type GerarSpedDto } from '@apollo/shared';
import { SpedEfdContribuicoesService } from './sped-efd-contribuicoes.service';
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
  constructor(private readonly efd: SpedEfdContribuicoesService) {}

  @Post('efd-contribuicoes')
  @HttpCode(200)
  @RequerAcesso('FRMSPEDPISCOFINS', 'BTNGERAR')
  gerarEfdContribuicoes(@Body(new ZodValidationPipe(gerarSpedSchema)) dto: GerarSpedDto) {
    return this.efd.gerar(dto.dtini, dto.dtfim);
  }
}
