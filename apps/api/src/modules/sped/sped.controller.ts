import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { gerarSpedSchema, type GerarSpedDto } from '@apollo/shared';
import { SpedEfdContribuicoesService } from './sped-efd-contribuicoes.service';
import { SpedEfdIcmsIpiService } from './sped-efd-icms-ipi.service';
import { SpedApuracaoPcService } from './sped-apuracao-pc.service';
import { ApuracaoPcConsultaService } from './apuracao-pc-consulta.service';
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
    private readonly apuracaoConsulta: ApuracaoPcConsultaService,
  ) {}

  @Post('efd-contribuicoes')
  @HttpCode(200)
  @RequerAcesso('FRMSPEDPISCOFINS', 'FRMSPEDPISCOFINS')
  gerarEfdContribuicoes(@Body(new ZodValidationPipe(gerarSpedSchema)) dto: GerarSpedDto) {
    return this.efd.gerar(dto.dtini, dto.dtfim);
  }

  /** EFD ICMS/IPI (SPED Fiscal) — corte-1: bloco 0 + C (entrada + C190) + E (apuração ICMS crédito) + 9. */
  // ⚠️ o EFD ICMS/IPI é o "GERADOR SPED FISCAL" do cliente — formulário PRÓPRIO (27 operadores, 896 acessos),
  // distinto do SPED PIS/COFINS (13). Estavam os dois sob PIS/COFINS, e quem só tinha SPED fiscal levava 403.
  @Post('efd-icms-ipi')
  @HttpCode(200)
  @RequerAcesso('FRMSPEDFISCAL', 'FRMSPEDFISCAL')
  gerarEfdIcmsIpi(@Body(new ZodValidationPipe(gerarSpedSchema)) dto: GerarSpedDto) {
    return this.efdIcmsIpi.gerar(dto.dtini, dto.dtfim);
  }

  /** as "Apurações Realizadas" da tela `FRMAPURACAOPISCOFINS`. */
  @Get('apuracao-pc')
  @RequerAcesso('FRMAPURACAOPISCOFINS', 'FRMAPURACAOPISCOFINS')
  listarApuracoesPc() {
    return this.apuracaoConsulta.listar();
  }

  /** uma apuração aberta: detalhe por tipo e o saldo por tributo (o M200/M600). */
  @Get('apuracao-pc/:cod')
  @RequerAcesso('FRMAPURACAOPISCOFINS', 'FRMAPURACAOPISCOFINS')
  obterApuracaoPc(@Param('cod', ParseIntPipe) cod: number) {
    return this.apuracaoConsulta.obter(cod);
  }

  /** o "reabrir" do legado: apaga para refazer. */
  @Delete('apuracao-pc/:cod')
  @RequerAcesso('FRMAPURACAOPISCOFINS', 'BTNEXCLUIR')
  excluirApuracaoPc(@Param('cod', ParseIntPipe) cod: number) {
    return this.apuracaoConsulta.excluir(cod);
  }

  /** apura o CRÉDITO de PIS/COFINS de entrada do período (popula apuracao_pc/_det p/ o bloco M). */
  @Post('apuracao-pc')
  @HttpCode(200)
  @RequerAcesso('FRMSPEDPISCOFINS', 'FRMSPEDPISCOFINS')
  apurarPc(@Body(new ZodValidationPipe(gerarSpedSchema)) dto: GerarSpedDto) {
    return this.apuracao.apurar(dto.dtini, dto.dtfim);
  }
}
