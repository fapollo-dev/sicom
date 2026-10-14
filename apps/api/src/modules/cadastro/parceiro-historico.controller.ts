import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ParceiroHistoricoService } from './parceiro-historico.service';
import { AcessoGuard } from '../../shared/acesso/acesso.guard';
import { RequerAcesso } from '../../shared/acesso/requer-acesso.decorator';

const empresas = (s?: string) => (s ?? '').split(',').map((e) => Number(e.trim())).filter((e) => Number.isInteger(e) && e > 0);

/**
 * HISTÓRICO FINANCEIRO do parceiro (aba tsSaldoParceiros) e as impressões do cadastro de clientes — rotas de 2+ segmentos sob
 * `cadastro/parceiros` (não colidem com o GET `:id` do agregado). O histórico é leitura livre (como os demais GET de cadastro); as
 * impressões (menu sem Tag e botões com Tag 5) valem o acesso à tela FRMCADCLIENTES.
 */
@Controller('cadastro/parceiros')
@UseGuards(AcessoGuard)
export class ParceiroHistoricoController {
  constructor(private readonly svc: ParceiroHistoricoService) {}

  /** as configurações que a tela lê (FormShow/edtCodigoExit): PERMITIR_HISTORICO (a aba Histórico financeiro) e
   *  PARCEIRO_EXIBIR_DADOS_FINANCEIROS (a aba Dados financeiros) */
  @Get('apoio/configs')
  configs() {
    return this.svc.configsDaTela();
  }

  /** a aba HISTÓRICO DE VENDAS (`btnConsHistoricoVendasClick`): `?de=&ate=&origem=V|P&empresas=1,2` */
  @Get(':cod/historico-vendas')
  historicoVendas(@Param('cod', ParseIntPipe) cod: number, @Query('de') de?: string, @Query('ate') ate?: string, @Query('origem') origem?: string, @Query('empresas') emps?: string) {
    return this.svc.historicoVendas(cod, { de, ate, origem, empresas: empresas(emps) });
  }

  /** "Visualizar senha dados financeiros" (ppmBotaoOutros, Tag 1): a senha de autorização de venda no PDV, só com a opção */
  @Get(':cod/senha-autpdv')
  @RequerAcesso('FRMCADCLIENTES', 'VISUALIZARSENHADADOSFINANCEIROS1')
  senhaAutPdv(@Param('cod', ParseIntPipe) cod: number) {
    return this.svc.senhaAutPdv(cod);
  }

  /** `?status=abertos|liquidados|todos&empresas=1,2` (as lojas da grade; vazio = a do login) */
  @Get(':cod/historico-financeiro')
  historico(@Param('cod', ParseIntPipe) cod: number, @Query('status') status?: string, @Query('empresas') emps?: string) {
    return this.svc.historico(cod, status, empresas(emps));
  }

  /** o "Imprimir" do histórico financeiro (HistoricoFinanceiro.fr3) */
  @Get(':cod/impressao/historico-financeiro')
  @RequerAcesso('FRMCADCLIENTES', 'FRMCADCLIENTES')
  impressaoHistorico(@Param('cod', ParseIntPipe) cod: number, @Query('status') status?: string) {
    return this.svc.impressaoHistorico(cod, status);
  }

  /** "Ficha cadastral" (FichaCadatralParceiro.fr3) */
  @Get(':cod/impressao/ficha-cadastral')
  @RequerAcesso('FRMCADCLIENTES', 'FRMCADCLIENTES')
  impressaoFicha(@Param('cod', ParseIntPipe) cod: number) {
    return this.svc.impressaoFicha(cod);
  }

  /** "Imprimir Cartão" (Cliente_Cartao.fr3) — `?codend=` o endereço selecionado na grade (sem ele, o padrão) */
  @Get(':cod/impressao/cartao')
  @RequerAcesso('FRMCADCLIENTES', 'FRMCADCLIENTES')
  impressaoCartao(@Param('cod', ParseIntPipe) cod: number, @Query('codend') codend?: string) {
    return this.svc.impressaoCartao(cod, codend ? Number(codend) : undefined);
  }
}
