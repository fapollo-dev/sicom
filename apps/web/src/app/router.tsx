import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { BancosCadMaster } from '../features/cadastro-bancos/BancosCadMaster';
import { MarcasCadMaster } from '../features/marcas/MarcasCadMaster';
import { BairrosCadMaster } from '../features/bairros/BairrosCadMaster';
import { CidadesCadMaster } from '../features/cidades/CidadesCadMaster';
import { PrecosCadMaster } from '../features/precos/PrecosCadMaster';
import { NcmCadMaster } from '../features/ncm/NcmCadMaster';
import { CfopCadMaster } from '../features/cfop/CfopCadMaster';
import { OperacoesContaCadMaster } from '../features/operacoes-conta/OperacoesContaCadMaster';
import { ContasBancariasCadMaster } from '../features/contas-bancarias/ContasBancariasCadMaster';
import { LotesCobrancaCadMaster } from '../features/lotes-md/LotesCobrancaCadMaster';
import { ContasReceberCadMaster } from '../features/areceber/ContasReceberCadMaster';
import { ContasPagarCadMaster } from '../features/apagar/ContasPagarCadMaster';
import { PlanoContasCadMaster } from '../features/plano-contas/PlanoContasCadMaster';
import { DreRelatorio } from '../features/dre/DreRelatorio';
import { RazaoRelatorio } from '../features/razao/RazaoRelatorio';
import { CaixaPage } from '../features/caixa/CaixaPage';
import { OperadoresCadMaster } from '../features/operadores/OperadoresCadMaster';
import { FormasPgtoCadMaster } from '../features/formas-pgto/FormasPgtoCadMaster';
import { ParceirosCadMaster } from '../features/parceiros/ParceirosCadMaster';
import { ProdutoCadMaster } from '../features/produtos/ProdutoCadMaster';
import { NfCadMaster } from '../features/nf/NfCadMaster';
import { PedidoCompraCadMaster } from '../features/pedido-compra/PedidoCompraCadMaster';
import { CondicoesPagtoCadMaster } from '../features/condicoes-pagto/CondicoesPagtoCadMaster';
import { DevolucaoCompraCadMaster } from '../features/devolucao-compra/DevolucaoCompraCadMaster';
import { CotacaoPage } from '../features/cotacao/CotacaoPage';
import { AgendaPromocaoCadMaster } from '../features/agenda-promocao/AgendaPromocaoCadMaster';
import { PromocaoCadMaster } from '../features/promocao/PromocaoCadMaster';
import { PerfilCadMaster } from '../features/perfil/PerfilCadMaster';
import { CtrlPermissoesPage } from '../features/perfil/CtrlPermissoesPage';
import { FechamentoDiarioPage } from '../features/fechamento-diario/FechamentoDiarioPage';
import { IntegracaoContabilPage } from '../features/integracao-contabil/IntegracaoContabilPage';
import { RelatoriosPage } from '../features/relatorio-construtor/RelatoriosPage';
import { ConstrutorPage } from '../features/relatorio-construtor/ConstrutorPage';
import { NfAnalisePage } from '../features/nf-analise/NfAnalisePage';
import { SaldoEmpresaPage } from '../features/saldo-empresa/SaldoEmpresaPage';
import { RelCaixaPage } from '../features/rel-caixa/RelCaixaPage';
import { ConsultoriaPage } from '../features/consultoria/ConsultoriaPage';
import { RelCartoesPage } from '../features/rel-cartoes/RelCartoesPage';
import { LancamentosContabeisPage } from '../features/lancamentos-contabeis/LancamentosContabeisPage';
import { RentabilidadePage } from '../features/rentabilidade/RentabilidadePage';
import { PrecificacaoNfPage } from '../features/precificacao-nf/PrecificacaoNfPage';
import { RelComprasPage } from '../features/rel-compras/RelComprasPage';
import { PromocaoAcumulativaPage } from '../features/promocao-acumulativa/PromocaoAcumulativaPage';
import { ConferenciaNfIndexadorPage } from '../features/conferencia-nf-indexador/ConferenciaNfIndexadorPage';
import { ConfigConciliadorPage } from '../features/config-conciliador/ConfigConciliadorPage';
import { HistoricoContabilCadMaster } from '../features/historico-contabil/HistoricoContabilCadMaster';
import { MultAtualizacaoPage } from '../features/mult-atualizacao/MultAtualizacaoPage';
import { ConfigIntegracaoContabilPage } from '../features/config-integracao-contabil/ConfigIntegracaoContabilPage';
import { DreEstruturaPage } from '../features/dre-estrutura/DreEstruturaPage';
import { AgendaLimitacaoPage } from '../features/agenda-limitacao/AgendaLimitacaoPage';
import { ConfIntegBancariaPage } from '../features/conf-integ-bancaria/ConfIntegBancariaPage';
import { ConfPlanoContasPage } from '../features/conf-plano-contas/ConfPlanoContasPage';
import { RelFinanceiroPage } from '../features/rel-financeiro/RelFinanceiroPage';
import { SimuladorVendaPage } from '../features/simulador-venda/SimuladorVendaPage';
import { ApuracaoPisCofinsPage } from '../features/apuracao-piscofins/ApuracaoPisCofinsPage';
import { ExtratoFornecedoresPage } from '../features/extrato-fornecedores/ExtratoFornecedoresPage';
import { AnaliseCasaCarnePage } from '../features/analise-casa-carne/AnaliseCasaCarnePage';
import { RelVendasDinamicoPage } from '../features/rel-vendas-dinamico/RelVendasDinamicoPage';
import { RelPrecosAlteradosPage } from '../features/rel-precos-alterados/RelPrecosAlteradosPage';
import { RelAnaliseItensNfPage } from '../features/rel-analise-itens-nf/RelAnaliseItensNfPage';
import { FaturamentoPage } from '../features/faturamento/FaturamentoPage';
import { MovimentacoesDiaPage } from '../features/movimentacoes-dia/MovimentacoesDiaPage';
import { ConsultaProdutoPage } from '../features/consulta-produto/ConsultaProdutoPage';
import { AnaliseComportamentoPeriodoPage } from '../features/analise-comportamento-periodo/AnaliseComportamentoPeriodoPage';
import { AnaliseComportamentoPage } from '../features/analise-comportamento/AnaliseComportamentoPage';
import { RelAnalisePedidoNfPage } from '../features/rel-analise-pedido-nf/RelAnalisePedidoNfPage';
import { ConsApgBxPage } from '../features/cons-apg-bx/ConsApgBxPage';
import { ConsRcbBxPage } from '../features/cons-rcb-bx/ConsRcbBxPage';
import { RelPerdasPage } from '../features/rel-perdas/RelPerdasPage';
import { PeriodoContabilPage } from '../features/periodo-contabil/PeriodoContabilPage';
import { PisCofinsPage } from '../features/piscofins/PisCofinsPage';
import { ExtratoClientesPage } from '../features/extrato-clientes/ExtratoClientesPage';
import { BalancetePage } from '../features/balancete/BalancetePage';
import { ExportaNfePage } from '../features/exporta-nfe/ExportaNfePage';
import { CestPage } from '../features/cest/CestPage';
import { MotivosPage } from '../features/motivos/MotivosPage';
import { RelEntradasFinanPage } from '../features/rel-entradas-finan/RelEntradasFinanPage';
import { ExtratoFuncionarioPage } from '../features/extrato-funcionario/ExtratoFuncionarioPage';
import { CaixaDmePage } from '../features/caixa-dme/CaixaDmePage';
import { RelBalancoPage } from '../features/rel-balanco/RelBalancoPage';
import { GerarFinanceiroLotePage } from '../features/gerar-financeiro-lote/GerarFinanceiroLotePage';
import { FiguraFiscalPage } from '../features/figura-fiscal/FiguraFiscalPage';
import { ConfigLegislacaoPage } from '../features/config-legislacao/ConfigLegislacaoPage';
import { CongelaEstoquePage } from '../features/congela-estoque/CongelaEstoquePage';
import { RelDiarioContabilPage } from '../features/rel-diario-contabil/RelDiarioContabilPage';
import { NfeInutilizadaPage } from '../features/nfe-inutilizada/NfeInutilizadaPage';
import { PrecificacaoNfBrutaPage } from '../features/precificacao-nf-bruta/PrecificacaoNfBrutaPage';
import { IndexadorTributarioPage } from '../features/indexador-tributario/IndexadorTributarioPage';
import { ProdutosRelPage } from '../features/produtos-rel/ProdutosRelPage';
import { RelEntradasSaidasPage } from '../features/rel-entradas-saidas/RelEntradasSaidasPage';
import { CotacaoFornPage } from '../features/cotacao-forn/CotacaoFornPage';
import { RelDdePage } from '../features/rel-dde/RelDdePage';
import { RelInterseccaoPage } from '../features/rel-interseccao/RelInterseccaoPage';
import { PedidoVendaPage } from '../features/pedido-venda/PedidoVendaPage';
import { FluxoCartoesPage } from '../features/fluxo-cartoes/FluxoCartoesPage';
import { RelFaturamentoPage } from '../features/rel-faturamento/RelFaturamentoPage';
import { RelEntSaiPage } from '../features/rel-ent-sai/RelEntSaiPage';
import { DescontoTituloPage } from '../features/desconto-titulo/DescontoTituloPage';
import { ConsCliRcbPage } from '../features/cons-cli-rcb/ConsCliRcbPage';
import { AnaliseEntradaSaidaPage } from '../features/analise-entrada-saida/AnaliseEntradaSaidaPage';
import { EmpresasCadMaster } from '../features/empresas/EmpresasCadMaster';
import { AjusteEstoquePage } from '../features/ajuste-estoque/AjusteEstoquePage';
import { InventarioPage } from '../features/inventario/InventarioPage';
import { InventarioRotativoPage } from '../features/inventario-rotativo/InventarioRotativoPage';
import { ScrapPage } from '../features/scrap/ScrapPage';
import { ProducaoPage } from '../features/producao/ProducaoPage';
import { EtiquetaPage } from '../features/etiqueta/EtiquetaPage';
import { ControleContasPage } from '../features/controle-contas/ControleContasPage';
import { AdiantamentoFornPage } from '../features/adiantamento-forn/AdiantamentoFornPage';
import { HistVendasPage } from '../features/hist-vendas/HistVendasPage';
import { ApuracaoIcmsPage } from '../features/apuracao-icms/ApuracaoIcmsPage';
import { ExportaBalancaPage } from '../features/exporta-balanca/ExportaBalancaPage';
import { AjustePrecosPage } from '../features/ajuste-precos/AjustePrecosPage';
import { PrecificacaoCustoPage } from '../features/precificacao-custo/PrecificacaoCustoPage';
import { RelVendasHubPage } from '../features/rel-vendas-hub/RelVendasHubPage';
import { PreviaFornecedorPage } from '../features/previa-fornecedor/PreviaFornecedorPage';
import { ConferenciaNotaPage } from '../features/conferencia-nota/ConferenciaNotaPage';
import { RelFinalizadorasPage } from '../features/rel-finalizadoras/RelFinalizadorasPage';
import { RelTicketMedioPage } from '../features/rel-ticket-medio/RelTicketMedioPage';
import { RelCaixaDrePage } from '../features/rel-caixa-dre/RelCaixaDrePage';
import { RelSemMovimentoPage } from '../features/rel-sem-movimento/RelSemMovimentoPage';
import { RelCurvaAbcPage } from '../features/rel-curva-abc/RelCurvaAbcPage';
import { RelVendasDataPage } from '../features/rel-vendas-data/RelVendasDataPage';
import { RelVendasDepartamentoPage } from '../features/rel-vendas-departamento/RelVendasDepartamentoPage';
import { RelVendasHoraPage } from '../features/rel-vendas-hora/RelVendasHoraPage';
import { RelFormasPgtoPage } from '../features/rel-formas-pgto/RelFormasPgtoPage';
import { RelVendasOperadorPage } from '../features/rel-vendas-operador/RelVendasOperadorPage';
import { RelCaixaOpsPage } from '../features/rel-caixa-ops/RelCaixaOpsPage';
import { RelCanceladosPage } from '../features/rel-cancelados/RelCanceladosPage';
import { RelVendasExtrasPage } from '../features/rel-vendas-extras/RelVendasExtrasPage';
import { ManifestoDfePage } from '../features/manifesto-dfe/ManifestoDfePage';
import { PendenciasPage } from '../features/pendencias/PendenciasPage';
import { CartaoPage } from '../features/cartao/CartaoPage';
import { OperadorasPage } from '../features/cartao/OperadorasPage';
import { TrocaPage } from '../features/troca/TrocaPage';
import { ConciliacaoBancariaPage } from '../features/conciliacao/ConciliacaoBancariaPage';
import { CnabRemessaPage } from '../features/cnab/CnabRemessaPage';
import { MotivosOperacaoCadMaster } from '../features/motivos-operacao/MotivosOperacaoCadMaster';
import { ConfiguracoesPage } from '../features/configuracoes/ConfiguracoesPage';

// Rotas = telas (uma TForm = uma rota), todas no pilar <CadMaster>/<CadMasterDet>,
// dentro da casca AppShell (<Outlet>). Consolidado — sem List/Form standalone.
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> }, // público (fora da guarda/AppLayout)
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <Navigate to="/cadastro/bancos" replace /> },
      { path: '/cadastro/bancos', element: <BancosCadMaster /> },
      { path: '/cadastro/marcas', element: <MarcasCadMaster /> },
      { path: '/cadastro/bairros', element: <BairrosCadMaster /> },
      { path: '/cadastro/cidades', element: <CidadesCadMaster /> },
      { path: '/cadastro/precos', element: <PrecosCadMaster /> },
      { path: '/cadastro/ncm', element: <NcmCadMaster /> },
      { path: '/cadastro/cfop', element: <CfopCadMaster /> },
      { path: '/cadastro/operacoes-conta', element: <OperacoesContaCadMaster /> },
      { path: '/cadastro/contas-bancarias', element: <ContasBancariasCadMaster /> },
      { path: '/cadastro/empresas', element: <EmpresasCadMaster /> },
      { path: '/cadastro/operadores', element: <OperadoresCadMaster /> },
      { path: '/cadastro/formas-pgto', element: <FormasPgtoCadMaster /> },
      // tela UNIFICADA de parceiros — mesmo componente, papel diferente
      { path: '/cadastro/clientes', element: <ParceirosCadMaster papel="cliente" /> },
      { path: '/cadastro/fornecedores', element: <ParceirosCadMaster papel="fornecedor" /> },
      { path: '/cadastro/produtos', element: <ProdutoCadMaster /> },
      { path: '/cobranca/lotes', element: <LotesCobrancaCadMaster /> }, // mestre-detalhe
      { path: '/cadastro/areceber', element: <ContasReceberCadMaster /> }, // contas a receber (cortes 1+2)
      { path: '/cadastro/apagar', element: <ContasPagarCadMaster /> }, // contas a pagar (gêmea)
      { path: '/cobranca/caixa', element: <CaixaPage /> }, // caixa (sessão + movimento manual, corte-1)
      { path: '/estoque/ajuste', element: <AjusteEstoquePage /> }, // ajuste de estoque (move o saldo + kardex)
      { path: '/estoque/inventario', element: <InventarioPage /> }, // inventário (contagem física; sobrescreve o saldo)
      { path: '/estoque/inventario-rotativo', element: <InventarioRotativoPage /> }, // rotativo: lote (abrir/fechar) + zerar estoque
      { path: '/estoque/scrap', element: <ScrapPage /> }, // scrap/perdas (documento de perda; baixa do saldo + kardex)
      { path: '/estoque/troca', element: <TrocaPage /> }, // troca c/ fornecedor (avariados saem; baixa do saldo + kardex)
      { path: '/estoque/producao', element: <ProducaoPage /> }, // produção/manufatura (explode receita → baixa ingredientes + entra acabado)
      { path: '/estoque/etiquetas', element: <EtiquetaPage /> }, // etiquetas de preço (fila do coletor + preço/promo MULTI_PRECO + imprimir Code-128)
      { path: '/estoque/balanca', element: <ExportaBalancaPage /> }, // exporta PLUs p/ balança Toledo (TXITENS/CADASTRO/ITENSMGV download)
      { path: '/estoque/ajuste-precos', element: <AjustePrecosPage /> },
      { path: '/estoque/precificacao', element: <PrecificacaoCustoPage /> },
      { path: '/relatorios/vendas', element: <RelVendasHubPage /> }, // HUB FRMRELVENDAS: combo de modelo → variante embutida
      { path: '/relatorios/previa-fornecedor', element: <PreviaFornecedorPage /> },
      { path: '/compras/conferencia-nota', element: <ConferenciaNotaPage /> },
      { path: '/compras/manifesto-dfe', element: <ManifestoDfePage /> }, // manifesto do destinatário — corte 1 local
      { path: '/compras/pendencias', element: <PendenciasPage /> }, // fila de pendências do operador
      { path: '/relatorios/finalizadoras', element: <RelFinalizadorasPage /> },
      { path: '/relatorios/ticket-medio', element: <RelTicketMedioPage /> },
      { path: '/relatorios/caixa-dre', element: <RelCaixaDrePage /> },
      { path: '/relatorios/sem-movimento', element: <RelSemMovimentoPage /> },
      { path: '/relatorios/vendas-data', element: <RelVendasDataPage /> }, // rel 02: fechamento diário
      { path: '/relatorios/vendas-departamento', element: <RelVendasDepartamentoPage /> }, // rel 38: dia × departamento
      { path: '/relatorios/vendas-hora', element: <RelVendasHoraPage /> }, // rel 07: perfil por hora × caixas abertos
      { path: '/relatorios/formas-pgto', element: <RelFormasPgtoPage /> }, // rel 08: participação por finalizadora
      { path: '/relatorios/vendas-operador', element: <RelVendasOperadorPage /> }, // rel 06/19/25/36/46: família operador/vendedor
      { path: '/relatorios/caixa-ops', element: <RelCaixaOpsPage /> }, // rel 04/05: sangrias/suprimentos + liberações do PDV
      { path: '/relatorios/cancelados', element: <RelCanceladosPage /> }, // rel 28/30/32: cancelamentos + descontos do PDV
      { path: '/relatorios/vendas-extras', element: <RelVendasExtrasPage /> }, // rel 21/22/26/33/39: complementares
      { path: '/relatorios/curva-abc', element: <RelCurvaAbcPage /> }, // rel 09: classificação A/B/C por faturamento acumulado // rel 13: o que não girou // DRE de caixa por conta gerencial // 4º relatório: cupons × média por dia // 3º relatório: vendas × formas de pagamento // aprovar/cancelar a conferência do coletor // 2º relatório: giro produto × 15 dias // 1º relatório: produtos vendidos no período // precificação de mercadorias (painel custo→PMZ→preço por produto×empresa) // ajuste de preços - lote (processa a fila lote_preco → multi_preco)
      { path: '/financeiro/cartoes', element: <CartaoPage /> }, // recebíveis de cartão (consulta + cadastro; líquido/venc computados)
      { path: '/cadastro/operadoras', element: <OperadorasPage /> }, // administradora/adquirente + taxa por-empresa
      { path: '/financeiro/conciliacao', element: <ConciliacaoBancariaPage /> }, // conciliação bancária OFX × razão interno
      { path: '/cobranca/cnab', element: <CnabRemessaPage /> }, // boleto + remessa CNAB (Itaú 400) dos títulos a receber
      { path: '/financeiro/contas-correntes', element: <ControleContasPage /> }, // controle de contas correntes (lançamento manual + transferência + estorno)
      { path: '/financeiro/adiantamentos', element: <AdiantamentoFornPage /> }, // adiantamento a fornecedor/parceiro (movimento na conta + título gerado)
      { path: '/vendas/historico', element: <HistVendasPage /> }, // consulta de histórico de vendas (um cupom: itens + finalizadores)
      { path: '/fiscal/apuracao-icms', element: <ApuracaoIcmsPage /> }, // apuração de ICMS (livro de entradas/saídas + E110)
      { path: '/cadastro/motivos-operacao', element: <MotivosOperacaoCadMaster /> }, // motivos de operação do SCRAP (o do ajuste é /cadastro/motivos)
      { path: '/cadastro/plano-contas', element: <PlanoContasCadMaster /> }, // plano de contas (árvore)
      { path: '/contabil/dre', element: <DreRelatorio /> }, // relatório DRE (calculado do diário)
      { path: '/contabil/razao', element: <RazaoRelatorio /> }, // livro razão (movimentos do diário por conta)
      // tela-coroa NF — mesmo componente, tipo diferente (Entrada/Saída), como Parceiros (papel)
      { path: '/fiscal/notas/entrada', element: <NfCadMaster tipo="E" /> },
      { path: '/fiscal/notas/saida', element: <NfCadMaster tipo="S" /> },
      // pedido de compra (mestre-detalhe) — documento de intenção; o FATO nasce na NF de entrada
      { path: '/compras/pedidos', element: <PedidoCompraCadMaster /> },
      { path: '/compras/condicoes-pagto', element: <CondicoesPagtoCadMaster /> }, // lookup do pedido (corte-2)
      { path: '/compras/devolucao', element: <DevolucaoCompraCadMaster /> }, // devolução de compra (documento, corte-1)
      { path: '/compras/cotacao', element: <CotacaoPage /> }, // cotação de compra (RFQ): preços → apuração → gerar pedidos
      { path: '/cadastro/promocoes', element: <AgendaPromocaoCadMaster /> }, // agenda de promoção (corte-1, sem efeito)
      { path: '/cadastro/gestao-promocoes', element: <PromocaoCadMaster /> }, // Gestão de Promoções (UCadPromocao): corte-1 Preço Fixo
      { path: '/cadastro/perfis', element: <PerfilCadMaster /> }, // perfis & permissões (RBAC editor)
      { path: '/cadastro/permissoes', element: <CtrlPermissoesPage /> }, // FRMCTRLPERMISSOES — por OPERADOR (o modo do cliente)
      { path: '/cadastro/fechamento-diario', element: <FechamentoDiarioPage /> }, // FRMFECHAMENTODIARIO
      { path: '/contabil/integracao', element: <IntegracaoContabilPage /> }, // FRMTRON — integração contábil
      { path: '/relatorios/construtor', element: <RelatoriosPage /> }, // FRMRELATORIO — relatórios do cliente
      { path: '/relatorios/construtor/novo', element: <ConstrutorPage /> }, // FRMCADASTRORELATORIO — montar
      { path: '/relatorios/construtor/:cod/editar', element: <ConstrutorPage /> },
      { path: '/fiscal/nf-analise', element: <NfAnalisePage /> }, // FRMNFANALISE
      { path: '/cobranca/saldo-empresa', element: <SaldoEmpresaPage /> }, // FRMSALDOEMPRESA
      { path: '/cobranca/rel-caixa', element: <RelCaixaPage /> }, // FRMRELCAIXA
      { path: '/relatorios/consultoria', element: <ConsultoriaPage /> }, // FRMCONSULTORIAATM
      { path: '/relatorios/cartoes', element: <RelCartoesPage /> }, // FRMRELCARTOES
      { path: '/contabil/lancamentos', element: <LancamentosContabeisPage /> }, // FRMRELLANCAMENTOSCONTABEIS
      { path: '/relatorios/rentabilidade', element: <RentabilidadePage /> }, // FRMRENTABILIDADECATEGORIAS
      { path: '/precificacao/nf', element: <PrecificacaoNfPage /> }, // FRMPRECIFICACAONF
      { path: '/relatorios/compras', element: <RelComprasPage /> }, // FRMRELCOMPRAS
      { path: '/cadastro/promocao-acumulativa', element: <PromocaoAcumulativaPage /> }, // FRMCADPROMOCAOACUMULATIVA
      { path: '/fiscal/conferencia-nf-indexador', element: <ConferenciaNfIndexadorPage /> }, // FRMCONFERENCIANFINDEXADOR
      { path: '/cadastro/config-conciliador', element: <ConfigConciliadorPage /> }, // FRMCADCONFIGCONCILIADOR
      { path: '/cadastro/historico-contabil', element: <HistoricoContabilCadMaster /> }, // FRMCADHISTORICOCONTABIL
      { path: '/cadastro/mult-atualizacao', element: <MultAtualizacaoPage /> }, // FRMMULTATUALIZACAO
      { path: '/contabil/config-integracao', element: <ConfigIntegracaoContabilPage /> }, // FRMCONFIGINTEGRACAOCONTABIL
      { path: '/cadastro/dre-estrutura', element: <DreEstruturaPage /> }, // FRMCONFIGDRECONTABIL
      { path: '/cadastro/agenda-limitacao', element: <AgendaLimitacaoPage /> }, // FRMCADAGENDALIMITACAOVENDA
      { path: '/cobranca/conf-integ-bancaria', element: <ConfIntegBancariaPage /> }, // FRMCONFINTEGBANCARIA
      { path: '/cadastro/conf-plano-contas', element: <ConfPlanoContasPage /> }, // FRMCADCONFPLANOCONTAS
      { path: '/relatorios/financeiro', element: <RelFinanceiroPage /> }, // FRMRELFINANCEIRO
      { path: '/relatorios/simulador-venda', element: <SimuladorVendaPage /> }, // FRMSIMULADORVENDA
      { path: '/fiscal/apuracao-piscofins', element: <ApuracaoPisCofinsPage /> }, // FRMAPURACAOPISCOFINS
      { path: '/relatorios/extrato-fornecedores', element: <ExtratoFornecedoresPage /> }, // FRMEXTRATOFORNECEDORES
      { path: '/relatorios/analise-casa-carne', element: <AnaliseCasaCarnePage /> }, // FRMANALISECOMPRAVENDACASACARNE
      { path: '/relatorios/vendas-dinamico', element: <RelVendasDinamicoPage /> }, // FRMRELATORIOVENDASDINAMICO
      { path: '/relatorios/precos-alterados', element: <RelPrecosAlteradosPage /> }, // FRMRELPRECOSALTERADOS
      { path: '/relatorios/analise-itens-nf', element: <RelAnaliseItensNfPage /> }, // FRMRELANALISEITENSNF
      { path: '/compras/faturamento', element: <FaturamentoPage /> }, // FRMFATURAMENTO2
      { path: '/relatorios/movimentacoes-dia', element: <MovimentacoesDiaPage /> }, // FRMMOVIMENTACOESDIA
      { path: '/relatorios/consulta-produto', element: <ConsultaProdutoPage /> }, // FRMCONSPROD + FRMPOSICAOPRODUTO
      { path: '/relatorios/analise-comportamento-periodo', element: <AnaliseComportamentoPeriodoPage /> }, // FRMRELANALISECOMPORTAMENTOPERIODO
      { path: '/relatorios/analise-comportamento', element: <AnaliseComportamentoPage /> }, // FRMANALISECOMPORTAMENTO
      { path: '/compras/rel-analise-pedido-nf', element: <RelAnalisePedidoNfPage /> }, // FRMRELANALISEPEDIDONF
      { path: '/cobranca/cons-apg-bx', element: <ConsApgBxPage /> }, // FRMCONSAPGBX
      { path: '/cobranca/cons-rcb-bx', element: <ConsRcbBxPage /> }, // FRMCONSRCBBX
      { path: '/cadastro/rel-perdas', element: <RelPerdasPage /> }, // FRMRELPERDAS
      { path: '/contabil/periodo-contabil', element: <PeriodoContabilPage /> }, // FRMCADPERIODOCONTABIL
      { path: '/cadastro/piscofins', element: <PisCofinsPage /> }, // FRMCADPISCOFINS
      { path: '/cobranca/extrato-clientes', element: <ExtratoClientesPage /> }, // FRMEXTRATOCLIENTES
      { path: '/contabil/balancete', element: <BalancetePage /> }, // FRMRELBALANCETE
      { path: '/fiscal/nf-exportacao', element: <ExportaNfePage /> }, // FRMEXPORTANFE
      { path: '/cadastro/cest', element: <CestPage /> }, // FRMCADCEST
      { path: '/cadastro/motivos', element: <MotivosPage /> }, // FRMMOTIVO (motivos do AJUSTE; ≠ motivos-operacao)
      { path: '/relatorios/entradas-financeiro', element: <RelEntradasFinanPage /> }, // FRMRELENTRADAS_FINAN
      { path: '/cobranca/extrato-funcionario', element: <ExtratoFuncionarioPage /> }, // FRMRELFUNCIONARIO
      { path: '/cobranca/caixa-dme', element: <CaixaDmePage /> }, // FRMRELATORIOCAIXADME
      { path: '/contabil/balanco', element: <RelBalancoPage /> }, // FRMRELBALANCO
      { path: '/cobranca/gerar-financeiro-lote', element: <GerarFinanceiroLotePage /> }, // FRMGERARFINANCEIROLOTE
      { path: '/fiscal/figuras-fiscais', element: <FiguraFiscalPage /> }, // FRMCADFIGURASFISCAIS
      { path: '/fiscal/config-legislacao', element: <ConfigLegislacaoPage /> }, // FRMCONFIGLEGISLACAONFE
      { path: '/cadastro/congela-estoque', element: <CongelaEstoquePage /> }, // FRMCONGELAESTOQUE
      { path: '/contabil/diario', element: <RelDiarioContabilPage /> }, // FRMRELDIARIOCONTABIL
      { path: '/fiscal/nfe-inutilizada', element: <NfeInutilizadaPage /> }, // FRMNFE_INUTILIZADA
      { path: '/precificacao/nf-bruta', element: <PrecificacaoNfBrutaPage /> }, // FRMPRECIFICACAONFBRUTA
      { path: '/cadastro/indexador-tributario', element: <IndexadorTributarioPage /> }, // FRMCADINDEXADORTRIBUTARIO
      { path: '/relatorios/produtos', element: <ProdutosRelPage /> }, // FRMPRODUTOSREL
      { path: '/relatorios/entradas-saidas', element: <RelEntradasSaidasPage /> }, // FRMRELENTRADASSAIDAS
      { path: '/compras/cotacao-forn', element: <CotacaoFornPage /> }, // FRMCADCOTACAOFORN
      { path: '/relatorios/dias-estoque', element: <RelDdePage /> }, // FRMRELDDE
      { path: '/relatorios/interseccao-produtos', element: <RelInterseccaoPage /> }, // FRMRELINTERSECCAOPRODUTOS
      { path: '/compras/pedido-venda', element: <PedidoVendaPage /> }, // FRMDIGITACAOPEDIDOS
      { path: '/financeiro/fluxo-cartoes', element: <FluxoCartoesPage /> }, // FRMFLUXOCARTOES
      { path: '/relatorios/faturamento', element: <RelFaturamentoPage /> }, // FRMRELFATURAMENTO
      { path: '/relatorios/compra-venda', element: <RelEntSaiPage /> }, // FRMRELENTSAI
      { path: '/financeiro/desconto-titulo', element: <DescontoTituloPage /> }, // FRMDESCONTOTITULO
      { path: '/financeiro/a-receber-cliente', element: <ConsCliRcbPage /> }, // FRMCONSCLIRCB
      { path: '/relatorios/analise-entrada-saida', element: <AnaliseEntradaSaidaPage /> }, // FRMANALISEENTRADAXSAIDA
      { path: '/cadastro/configuracoes', element: <ConfiguracoesPage /> }, // configurações (UConfigura): chave-valor por empresa
    ],
  },
]);
