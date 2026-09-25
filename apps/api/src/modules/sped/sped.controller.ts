import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { gerarSpedSchema, type GerarSpedDto } from '@apollo/shared';
import { SpedEfdContribuicoesService } from './sped-efd-contribuicoes.service';
import { SpedEfdIcmsIpiService } from './sped-efd-icms-ipi.service';
import { SpedApuracaoPcService } from './sped-apuracao-pc.service';
import { ApuracaoPcConsultaService } from './apuracao-pc-consulta.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

const ajusteCreditoPcSchema = z.object({
  id_tipocredito: z.coerce.number().int(),
  id_basecredito: z.coerce.number().int(),
  idpiscofins: z.coerce.number().int(),
  basecalculo: z.coerce.number(),
});
type AjusteCreditoPcDto = z.infer<typeof ajusteCreditoPcSchema>;
const configPcSchema = z.object({ cfop: z.string().trim().min(1).max(4), id_basecredito: z.coerce.number().int() });
type ConfigPcDto = z.infer<typeof configPcSchema>;

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

  /** o apoio do ajuste manual de crédito: tipos de crédito, bases de crédito e situações PIS/COFINS (os F3 da tela). */
  @Get('apuracao-pc-apoio')
  @RequerAcesso('FRMAPURACAOPISCOFINS', 'FRMAPURACAOPISCOFINS')
  apoioApuracaoPc() {
    return this.apuracaoConsulta.apoio();
  }

  /** o ajuste manual de crédito (o "Ajusta Apuração" da grade pai de Créditos): uma linha CREDITO/ENTRADA no detalhe. */
  @Post('apuracao-pc/:cod/ajustes')
  @HttpCode(201)
  @RequerAcesso('FRMAPURACAOPISCOFINS', 'FRMAPURACAOPISCOFINS')
  ajustarCreditoPc(@Param('cod', ParseIntPipe) cod: number, @Body(new ZodValidationPipe(ajusteCreditoPcSchema)) dto: AjusteCreditoPcDto) {
    return this.apuracaoConsulta.ajustarCredito(cod, dto);
  }

  /** o [DEL] no pai de Créditos: sai o pai (tipo de crédito × alíquota PIS) e as linhas dele. */
  @Delete('apuracao-pc/:cod/creditos')
  @RequerAcesso('FRMAPURACAOPISCOFINS', 'FRMAPURACAOPISCOFINS')
  excluirCreditoPc(@Param('cod', ParseIntPipe) cod: number, @Query('tipo') tipo: string | undefined, @Query('aliqpis') aliqpis: string | undefined) {
    return this.apuracaoConsulta.excluirCredito(cod, tipo == null || tipo === '' ? null : Number(tipo), Number(aliqpis ?? 0));
  }

  /** a aba Configuração da apuração: os CFOPs da base do crédito (PC_CONFIG). */
  @Get('apuracao-pc-config')
  @RequerAcesso('FRMAPURACAOPISCOFINS', 'FRMAPURACAOPISCOFINS')
  listarConfigPc() {
    return this.apuracaoConsulta.listarConfig();
  }

  @Post('apuracao-pc-config')
  @HttpCode(201)
  @RequerAcesso('FRMAPURACAOPISCOFINS', 'FRMAPURACAOPISCOFINS')
  incluirConfigPc(@Body(new ZodValidationPipe(configPcSchema)) dto: ConfigPcDto) {
    return this.apuracaoConsulta.incluirConfig(dto);
  }

  @Delete('apuracao-pc-config/:cfop')
  @RequerAcesso('FRMAPURACAOPISCOFINS', 'FRMAPURACAOPISCOFINS')
  excluirConfigPc(@Param('cfop') cfop: string) {
    return this.apuracaoConsulta.excluirConfig(cfop);
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
