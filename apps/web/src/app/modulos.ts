import {
  Tag,
  Truck,
  Receipt,
  Banknote,
  Package,
  ClipboardList,
  Users,
  FileText,
  BarChart3,
  BookOpen,
  Building,
  Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * MÓDULOS DO MENU — os mesmos do legado.
 *
 * PROCEDÊNCIA (06/10/2026): a árvore veio da tabela `MENUEXPRESS` da PRODUÇÃO
 * (`hiperpinheirao`, leitura apenas) — `MENUPAI` = módulo, `MENU` = rótulo da
 * tela, `FORMULARIO` = TForm, `ACESSOS` = uso real do cliente. São 2.397 linhas
 * / 276 telas distintas; 270 delas aparecem em um único módulo (só 4 em dois),
 * então o mapa pai→tela é confiável. As linhas de `ULTIMOACESSO` e as de pai
 * nulo são a barra de acesso rápido (rótulo e formulário saem de sincronia) e
 * foram descartadas.
 *
 * O `Config/Menu.XML` do fonte Delphi (mai/2020) traz a mesma espinha
 * (CADASTRO · MOVIMENTAÇÃO FINANCEIRA · MOVIMENTAÇÃO DE MERCADORIAS ·
 * RELATÓRIOS · VENDAS · CONTROLE DE ESTOQUE · FISCAL · CONTÁBIL · UTILITÁRIOS ·
 * INDÚSTRIA), mas é um retrato velho — o binário que o cliente roda é mais
 * novo. Onde os dois discordam, vale a PRODUÇÃO.
 *
 * Módulos pequenos da produção viram SUBGRUPO do rail a que pertencem
 * (ex.: `Financeiro` = cadastros financeiros, vira "Financeiro › Cadastros";
 * `Promocoes` vira "Produtos › Promoções"), porque o rail guarda um ícone por
 * módulo e 25 ícones não cabem. Nada foi inventado: o rótulo entre parênteses
 * em cada rota abaixo é o módulo de origem na produção.
 */
export type ModuloId =
  | 'basicas'
  | 'mercadorias'
  | 'vendas'
  | 'financeiro'
  | 'produtos'
  | 'estoque'
  | 'parceiros'
  | 'fiscal'
  | 'relatorios'
  | 'contabil'
  | 'cadastros'
  | 'utilitarios';

export type Modulo = { id: ModuloId; label: string; icon: LucideIcon };

/** Ordem do rail = ordem de USO na produção (acessos somados do módulo). */
export const MODULOS: readonly Modulo[] = [
  { id: 'basicas', label: 'Operações básicas', icon: Tag },
  { id: 'mercadorias', label: 'Mercadorias', icon: Truck },
  { id: 'vendas', label: 'Vendas', icon: Receipt },
  { id: 'financeiro', label: 'Financeiro', icon: Banknote },
  { id: 'produtos', label: 'Produtos', icon: Package },
  { id: 'estoque', label: 'Estoque', icon: ClipboardList },
  { id: 'parceiros', label: 'Parceiros', icon: Users },
  { id: 'fiscal', label: 'Fiscal', icon: FileText },
  { id: 'relatorios', label: 'Relatórios', icon: BarChart3 },
  { id: 'contabil', label: 'Contábil', icon: BookOpen },
  { id: 'cadastros', label: 'Cadastros gerais', icon: Building },
  { id: 'utilitarios', label: 'Utilitários', icon: Settings },
] as const;

export type Destino = { modulo: ModuloId; grupo?: string };

/**
 * Rota → módulo. O comentário de cada linha é a PROVA: TForm do legado,
 * acessos na produção e o módulo de origem (MENUPAI). "sem tela no menu do
 * legado" = tela que nasceu aqui (ou variante nossa de uma tela do legado);
 * nesse caso o módulo é o da tela-irmã.
 *
 * Tela nova sem linha aqui não some do menu: cai no módulo do prefixo da rota
 * (ver PREFIXO_MODULO) — mas o certo é registrar a rota nesta tabela.
 */
export const ROTA_MODULO: Record<string, Destino> = {

  /* ── basicas (1) ─────────────────────────────── */
  '/estoque/etiquetas': { modulo: 'basicas' }, // FRMETIQUETA · 1995087 acessos · Operacoes basicas

  /* ── mercadorias (10) ─────────────────────────────── */
  '/compras/manifesto-dfe': { modulo: 'mercadorias' }, // FRMMANIFESTODFE · 44832 acessos · Movimentacao de mercadorias
  '/fiscal/notas/entrada': { modulo: 'mercadorias' }, // FRMNF · 29238 acessos · Movimentacao de mercadorias
  '/compras/pedidos': { modulo: 'mercadorias' }, // FRMPEDIDOCOMPRA · 22843 acessos · Movimentacao de mercadorias
  '/estoque/ajuste-precos': { modulo: 'mercadorias' }, // FRMAJUSTEPRECOS · 931 acessos · Movimentacao de mercadorias
  '/compras/cotacao': { modulo: 'mercadorias' }, // FRMCADCOTACAO · 176 acessos · Movimentacao de mercadorias
  '/fiscal/conferencia-nf-indexador': { modulo: 'mercadorias' }, // FRMCONFERENCIANFINDEXADOR · 165 acessos · Movimentacao de mercadorias
  '/compras/cotacao-forn': { modulo: 'mercadorias' }, // FRMCADCOTACAOFORN · 139 acessos · Movimentacao de mercadorias
  '/relatorios/consulta-produto': { modulo: 'mercadorias' }, // FRMCONSPROD · 25 acessos · Movimentacao de mercadorias
  '/fiscal/notas/saida': { modulo: 'mercadorias' }, // sem tela no menu do legado · Movimentacao de mercadorias
  '/fiscal/nf-esteira': { modulo: 'mercadorias' }, // sem tela no menu do legado · Movimentacao de mercadorias

  /* ── vendas (11) ─────────────────────────────── */
  '/cobranca/fechamento-caixa': { modulo: 'vendas' }, // FRMFECHAMENTOCAIXA · 43434 acessos · Vendas
  '/relatorios/vendas': { modulo: 'vendas' }, // FRMRELVENDAS · 19114 acessos · Vendas
  '/cobranca/fechamento-sangria': { modulo: 'vendas' }, // FRMFECHAMENTOSANGRIA · 3613 acessos · Vendas
  '/vendas/historico': { modulo: 'vendas' }, // FRMCONSHISTVENDAS · 1105 acessos · Vendas
  '/relatorios/rentabilidade': { modulo: 'vendas' }, // FRMRENTABILIDADECATEGORIAS · 276 acessos · Vendas
  '/relatorios/consultoria': { modulo: 'vendas' }, // FRMCONSULTORIAATM · 136 acessos · Vendas
  '/relatorios/interseccao-produtos': { modulo: 'vendas' }, // FRMRELINTERSECCAOPRODUTOS · 120 acessos · Vendas
  '/compras/pedido-venda': { modulo: 'vendas' }, // FRMDIGITACAOPEDIDOS · 116 acessos · Vendas
  '/relatorios/analise-comportamento': { modulo: 'vendas' }, // FRMANALISECOMPORTAMENTO · 53 acessos · Vendas
  '/relatorios/vendas-dinamico': { modulo: 'vendas' }, // FRMRELATORIOVENDASDINAMICO · 39 acessos · Vendas
  '/relatorios/analise-comportamento-periodo': { modulo: 'vendas' }, // FRMRELANALISECOMPORTAMENTOPERIODO · 24 acessos · Vendas

  /* ── financeiro (31) ─────────────────────────────── */
  '/cadastro/apagar': { modulo: 'financeiro' }, // FRMAPAGAR · 15144 acessos · Movimentacao financeira
  '/cobranca/baixa-apagar': { modulo: 'financeiro' }, // FRMBAIXAAPAGAR · 6891 acessos · Movimentacao financeira
  '/financeiro/contas-correntes': { modulo: 'financeiro' }, // FRMCONTROLECONTASBANCARIAS · 6844 acessos · Movimentacao financeira
  '/cobranca/lancamento-caixa': { modulo: 'financeiro' }, // FRMMOVCAIXA · 5058 acessos · Movimentacao financeira
  '/financeiro/cartoes': { modulo: 'financeiro' }, // FRMCADCARTAO · 4346 acessos · Movimentacao financeira
  '/cadastro/areceber': { modulo: 'financeiro' }, // FRMCADARECEBER · 4301 acessos · Movimentacao financeira
  '/cobranca/baixa-receber': { modulo: 'financeiro' }, // FRMBAIXAARECEBER · 3194 acessos · Movimentacao financeira
  '/cobranca/cnab': { modulo: 'financeiro' }, // FRMCONFBOLETO · 867 acessos · Movimentacao financeira
  '/financeiro/adiantamentos': { modulo: 'financeiro' }, // FRMADIANTAMENTOFORNECEDOR · 736 acessos · Movimentacao financeira
  '/financeiro/conciliacao': { modulo: 'financeiro' }, // FRMCONCILIACAOBANCARIA · 732 acessos · Movimentacao financeira
  '/cobranca/saldo-empresa': { modulo: 'financeiro' }, // FRMSALDOEMPRESA · 610 acessos · Movimentacao financeira
  '/cobranca/agrupar-pagar': { modulo: 'financeiro' }, // FRMAGRUPACONTASAPAGAR · 472 acessos · Movimentacao financeira
  '/cobranca/agrupar-receber': { modulo: 'financeiro' }, // FRMAGRUPACONTASARECEBER · 456 acessos · Movimentacao financeira
  '/cadastro/config-conciliador': { modulo: 'financeiro' }, // FRMCADCONFIGCONCILIADOR · 79 acessos · Movimentacao financeira
  '/financeiro/desconto-titulo': { modulo: 'financeiro' }, // FRMDESCONTOTITULO · 68 acessos · Movimentacao financeira
  '/financeiro/a-receber-cliente': { modulo: 'financeiro' }, // FRMCONSCLIRCB · 64 acessos · Movimentacao financeira
  '/compras/faturamento': { modulo: 'financeiro' }, // FRMFATURAMENTO2 · 33 acessos · Movimentacao financeira
  '/cobranca/cons-apg-bx': { modulo: 'financeiro' }, // FRMCONSAPGBX · 20 acessos · Movimentacao financeira
  '/cobranca/gerar-financeiro-lote': { modulo: 'financeiro' }, // FRMGERARFINANCEIROLOTE · 7 acessos · Movimentacao financeira
  '/cobranca/lotes': { modulo: 'financeiro' }, // FRMCADLOTECOBRANCA · 6 acessos · Movimentacao financeira
  '/cobranca/cons-rcb-bx': { modulo: 'financeiro' }, // FRMCONSRCBBX · 5 acessos · Movimentacao financeira
  '/cobranca/caixa': { modulo: 'financeiro' }, // sem tela no menu do legado · Movimentacao financeira
  '/cadastro/contas-bancarias': { modulo: 'financeiro', grupo: 'Cadastros' }, // FRMCADCONTASBANCARIAS · 329 acessos · Financeiro
  '/cadastro/formas-pgto': { modulo: 'financeiro', grupo: 'Cadastros' }, // FRMCADFORMAPGTO · 242 acessos · Financeiro
  '/cadastro/bancos': { modulo: 'financeiro', grupo: 'Cadastros' }, // FRMCADBANCOS · 57 acessos · Financeiro
  '/cobranca/conf-integ-bancaria': { modulo: 'financeiro', grupo: 'Cadastros' }, // FRMCONFINTEGBANCARIA · 49 acessos · Financeiro
  '/compras/condicoes-pagto': { modulo: 'financeiro', grupo: 'Cadastros' }, // sem tela no menu do legado · Financeiro
  '/cadastro/operacoes-conta': { modulo: 'financeiro', grupo: 'Cadastros' }, // sem tela no menu do legado · Financeiro
  '/relatorios/caixa-dre': { modulo: 'financeiro', grupo: 'Caixa' }, // FRMRELATORIOCAIXA · 632 acessos · Caixa
  '/cobranca/caixa-dme': { modulo: 'financeiro', grupo: 'Caixa' }, // FRMRELATORIOCAIXADME · 9 acessos · Caixa
  '/relatorios/caixa-ops': { modulo: 'financeiro', grupo: 'Caixa' }, // sem tela no menu do legado · Caixa

  /* ── produtos (17) ─────────────────────────────── */
  '/cadastro/produtos': { modulo: 'produtos' }, // FRMCADPRODUTO · 31195 acessos · Produtos
  '/estoque/precificacao': { modulo: 'produtos' }, // FRMPRIFICACAOCUSTO · 3333 acessos · Produtos
  '/precificacao/nf': { modulo: 'produtos' }, // FRMPRECIFICACAONF · 236 acessos · Produtos
  '/cadastro/familias': { modulo: 'produtos' }, // FRMCADFAMILIAPROD · 85 acessos · Produtos
  '/cadastro/agenda-limitacao': { modulo: 'produtos' }, // FRMCADAGENDALIMITACAOVENDA · 46 acessos · Produtos
  '/cadastro/ncm': { modulo: 'produtos' }, // FRMCADNCM · 37 acessos · Produtos
  '/cadastro/cest': { modulo: 'produtos' }, // FRMCADCEST · 11 acessos · Produtos
  '/precificacao/nf-bruta': { modulo: 'produtos' }, // FRMPRECIFICACAONFBRUTA · 11 acessos · Produtos
  '/cadastro/unidades': { modulo: 'produtos' }, // FRMCADUNIDADE · 4 acessos · Produtos
  '/cadastro/marcas': { modulo: 'produtos' }, // sem tela no menu do legado · Produtos
  '/cadastro/precos': { modulo: 'produtos' }, // sem tela no menu do legado · Produtos
  '/precificacao/hist-processamento-nf': { modulo: 'produtos' }, // sem tela no menu do legado · Produtos
  '/cadastro/promocao-acumulativa': { modulo: 'produtos', grupo: 'Promoções' }, // FRMCADPROMOCAOACUMULATIVA · 199 acessos · Promocoes
  '/cadastro/promocoes': { modulo: 'produtos', grupo: 'Promoções' }, // sem tela no menu do legado · Promocoes
  '/cadastro/gestao-promocoes': { modulo: 'produtos', grupo: 'Promoções' }, // sem tela no menu do legado · Promocoes
  '/precificacao/clube-desconto': { modulo: 'produtos', grupo: 'Promoções' }, // sem tela no menu do legado · Promocoes
  '/precificacao/sugestao-promocao': { modulo: 'produtos', grupo: 'Promoções' }, // sem tela no menu do legado · Promocoes

  /* ── estoque (8) ─────────────────────────────── */
  '/estoque/scrap': { modulo: 'estoque' }, // FRMCADSCRAP · 26213 acessos · Controle de estoque
  '/relatorios/devolucao-vendas': { modulo: 'estoque' }, // FRMDEVOLUCAOVENDAS · 3573 acessos · Controle de estoque
  '/compras/devolucao': { modulo: 'estoque' }, // FRMCADPEDIDODEVOLUCAOCOMPRAS · 2529 acessos · Controle de estoque
  '/estoque/ajuste': { modulo: 'estoque' }, // FRMAJUSTEESTOQUE · 752 acessos · Controle de estoque
  '/estoque/troca': { modulo: 'estoque' }, // FRMTROCAMERCADORIAFOR · 121 acessos · Controle de estoque
  '/cadastro/congela-estoque': { modulo: 'estoque' }, // FRMCONGELAESTOQUE · 4 acessos · Controle de estoque
  '/estoque/inventario': { modulo: 'estoque' }, // sem tela no menu do legado · Controle de estoque
  '/estoque/producao': { modulo: 'estoque', grupo: 'Produção' }, // FRMCADPRODUCAO · 108 acessos · Producao

  /* ── parceiros (5) ─────────────────────────────── */
  '/cadastro/clientes': { modulo: 'parceiros' }, // FRMCADCLIENTES · 12003 acessos · Parceiros
  '/cadastro/fornecedores': { modulo: 'parceiros' }, // FRMCADCLIENTES · 12003 acessos · Parceiros
  '/cadastro/bairros': { modulo: 'parceiros' }, // sem tela no menu do legado · Parceiros
  '/cadastro/cidades': { modulo: 'parceiros' }, // sem tela no menu do legado · Parceiros
  '/relatorios/extrato-fornecedores': { modulo: 'parceiros', grupo: 'Fornecedores' }, // FRMEXTRATOFORNECEDORES · 38 acessos · Fornecedores
  '/relatorios/curva-abc-fornecedor': { modulo: 'parceiros', grupo: 'Fornecedores' }, // FRMRELCURVAABCFORNECEDOR · 11 acessos · Fornecedores

  /* ── fiscal (20) ─────────────────────────────── */
  '/compras/conferencia-nota': { modulo: 'fiscal' }, // FRMCONFERENCIANOTA · 5549 acessos · Fiscal
  '/cadastro/fechamento-diario': { modulo: 'fiscal' }, // FRMFECHAMENTODIARIO · 741 acessos · Fiscal
  '/fiscal/nf-analise': { modulo: 'fiscal' }, // FRMNFANALISE · 727 acessos · Fiscal
  '/cadastro/situacao-documento': { modulo: 'fiscal' }, // FRMCADSITUACAONF · 543 acessos · Fiscal
  '/fiscal/apuracao-icms': { modulo: 'fiscal' }, // FRMRELREGISTROS_ES · 355 acessos · Fiscal
  '/fiscal/registro-entradas': { modulo: 'fiscal' }, // FRMRELREGISTROS_ES · 355 acessos · Fiscal
  '/fiscal/registro-saidas': { modulo: 'fiscal' }, // FRMRELREGISTROS_ES · 355 acessos · Fiscal
  '/cadastro/cfop': { modulo: 'fiscal' }, // FRMCADCFOP · 349 acessos · Fiscal
  '/relatorios/faturamento': { modulo: 'fiscal' }, // FRMRELFATURAMENTO · 51 acessos · Fiscal
  '/fiscal/apuracao-piscofins': { modulo: 'fiscal' }, // FRMAPURACAOPISCOFINS · 39 acessos · Fiscal
  '/relatorios/analise-itens-nf': { modulo: 'fiscal' }, // FRMRELANALISEITENSNF · 33 acessos · Fiscal
  '/cadastro/aliquotas': { modulo: 'fiscal' }, // FRMCADALIQUOTA · 25 acessos · Fiscal
  '/cadastro/indexador-tributario': { modulo: 'fiscal' }, // FRMCADINDEXADORTRIBUTARIO · 21 acessos · Fiscal
  '/cadastro/piscofins': { modulo: 'fiscal' }, // FRMCADPISCOFINS · 13 acessos · Fiscal
  '/relatorios/entradas-financeiro': { modulo: 'fiscal' }, // FRMRELENTRADAS_FINAN · 6 acessos · Fiscal
  '/fiscal/figuras-fiscais': { modulo: 'fiscal' }, // FRMCADFIGURASFISCAIS · 6 acessos · Fiscal
  '/fiscal/config-legislacao': { modulo: 'fiscal' }, // FRMCONFIGLEGISLACAONFE · 5 acessos · Fiscal
  '/fiscal/nfe-inutilizada': { modulo: 'fiscal' }, // FRMNFE_INUTILIZADA · 2 acessos · Fiscal
  '/fiscal/reforma-ibscbs': { modulo: 'fiscal', grupo: 'IBS/CBS' }, // FRMCADCSTIBSCBS · 3 acessos · IBS CBS
  '/fiscal/apuracao-ibscbs': { modulo: 'fiscal', grupo: 'IBS/CBS' }, // sem tela no menu do legado · IBS CBS

  /* ── relatorios (27) ─────────────────────────────── */
  '/relatorios/previa-fornecedor': { modulo: 'relatorios' }, // FRMRELLISTAPRECOSFORNECEDOR · 1825 acessos · Relatorios
  '/relatorios/construtor': { modulo: 'relatorios' }, // FRMRELATORIO · 1260 acessos · Relatorios
  '/cobranca/rel-caixa': { modulo: 'relatorios' }, // FRMRELCAIXA · 513 acessos · Relatorios
  '/relatorios/cartoes': { modulo: 'relatorios' }, // FRMRELCARTOES · 382 acessos · Relatorios
  '/relatorios/compras': { modulo: 'relatorios' }, // FRMRELCOMPRAS · 204 acessos · Relatorios
  '/relatorios/produtos': { modulo: 'relatorios' }, // FRMPRODUTOSREL · 167 acessos · Relatorios
  '/relatorios/entradas-saidas': { modulo: 'relatorios' }, // FRMRELENTRADASSAIDAS · 152 acessos · Relatorios
  '/estoque/inventario-rotativo': { modulo: 'relatorios' }, // FRMRELINVENTARIOROTATIVO · 141 acessos · Relatorios
  '/relatorios/dias-estoque': { modulo: 'relatorios' }, // FRMRELDDE · 133 acessos · Relatorios
  '/financeiro/fluxo-cartoes': { modulo: 'relatorios' }, // FRMFLUXOCARTOES · 97 acessos · Relatorios
  '/relatorios/compra-venda': { modulo: 'relatorios' }, // FRMRELENTSAI · 84 acessos · Relatorios
  '/relatorios/analise-entrada-saida': { modulo: 'relatorios' }, // FRMANALISEENTRADAXSAIDA · 68 acessos · Relatorios
  '/relatorios/analise-casa-carne': { modulo: 'relatorios' }, // FRMANALISECOMPRAVENDACASACARNE · 37 acessos · Relatorios
  '/relatorios/precos-alterados': { modulo: 'relatorios' }, // FRMRELPRECOSALTERADOS · 35 acessos · Relatorios
  '/relatorios/troca-mercadoria': { modulo: 'relatorios' }, // FRMRELTROCAMERCADORIAFOR · 29 acessos · Relatorios
  '/relatorios/movimentacoes-dia': { modulo: 'relatorios' }, // FRMMOVIMENTACOESDIA · 26 acessos · Relatorios
  '/relatorios/pedidos-compra': { modulo: 'relatorios' }, // FRMRELPEDIDOCOMPRA · 23 acessos · Relatorios
  '/compras/rel-analise-pedido-nf': { modulo: 'relatorios' }, // FRMRELANALISEPEDIDONF · 20 acessos · Relatorios
  '/relatorios/financeiro': { modulo: 'relatorios' }, // FRMRELFINANCEIRO · 16 acessos · Relatorios
  '/cobranca/extrato-clientes': { modulo: 'relatorios' }, // FRMEXTRATOCLIENTES · 13 acessos · Relatorios
  '/cadastro/rel-perdas': { modulo: 'relatorios' }, // FRMRELPERDAS · 7 acessos · Relatorios
  '/cobranca/extrato-funcionario': { modulo: 'relatorios' }, // FRMRELFUNCIONARIO · 6 acessos · Relatorios
  '/contabil/dre': { modulo: 'relatorios', grupo: 'Contábeis' }, // FRMRELDRECONTABIL · 335 acessos · Relatorios
  '/contabil/balancete': { modulo: 'relatorios', grupo: 'Contábeis' }, // FRMRELBALANCETE · 14 acessos · Relatorios
  '/contabil/razao': { modulo: 'relatorios', grupo: 'Contábeis' }, // FRMRELRAZAOCONTABIL · 13 acessos · Relatorios
  '/contabil/balanco': { modulo: 'relatorios', grupo: 'Contábeis' }, // FRMRELBALANCO · 8 acessos · Relatorios
  '/contabil/diario': { modulo: 'relatorios', grupo: 'Contábeis' }, // FRMRELDIARIOCONTABIL · 4 acessos · Relatorios

  /* ── contabil (8) ─────────────────────────────── */
  '/contabil/integracao': { modulo: 'contabil' }, // FRMTRON · 797 acessos · Contabil
  '/contabil/config-integracao': { modulo: 'contabil', grupo: 'Cadastros' }, // FRMCONFIGINTEGRACAOCONTABIL · 55 acessos · Cadastro
  '/cadastro/dre-estrutura': { modulo: 'contabil', grupo: 'Cadastros' }, // FRMCONFIGDRECONTABIL · 51 acessos · Cadastro
  '/cadastro/conf-plano-contas': { modulo: 'contabil', grupo: 'Cadastros' }, // FRMCADCONFPLANOCONTAS · 45 acessos · Cadastro
  '/contabil/periodo-contabil': { modulo: 'contabil', grupo: 'Cadastros' }, // FRMCADPERIODOCONTABIL · 13 acessos · Cadastro
  '/cadastro/historico-contabil': { modulo: 'contabil', grupo: 'Cadastros' }, // FRMCADCODIGOCONTABIL · 8 acessos · Cadastro
  '/cadastro/plano-contas': { modulo: 'contabil', grupo: 'Cadastros' }, // sem tela no menu do legado · Cadastro
  '/contabil/lancamentos': { modulo: 'contabil', grupo: 'Movimentação' }, // FRMRELLANCAMENTOSCONTABEIS · 383 acessos · Movimentacao contabil

  /* ── cadastros (7) ─────────────────────────────── */
  '/cadastro/operadores': { modulo: 'cadastros' }, // FRMCADUSUARIOS · 1526 acessos · Outros
  '/cadastro/empresas': { modulo: 'cadastros' }, // FRMCADEMPRESA · 647 acessos · Outros
  '/cadastro/centro-custos': { modulo: 'cadastros' }, // FRMCADPLC · 445 acessos · Outros
  '/cadastro/operadoras': { modulo: 'cadastros' }, // FRMCADOPERADORAS · 325 acessos · Outros
  '/cadastro/perfis': { modulo: 'cadastros' }, // FRMCADPERFILOPERADOR · 48 acessos · Outros
  '/cadastro/motivos-operacao': { modulo: 'cadastros' }, // FRMCADMOTIVOOPERACOES · 33 acessos · Outros
  '/cadastro/motivos': { modulo: 'cadastros' }, // FRMMOTIVO · 7 acessos · Outros

  /* ── utilitarios (7) ─────────────────────────────── */
  '/estoque/balanca': { modulo: 'utilitarios' }, // FRMEXPORTABALANCA · 9620 acessos · Utilitarios
  '/cadastro/permissoes': { modulo: 'utilitarios' }, // FRMCTRLPERMISSOES · 897 acessos · Utilitarios
  '/cadastro/mult-atualizacao': { modulo: 'utilitarios' }, // FRMMULTATUALIZACAO · 64 acessos · Utilitarios
  '/relatorios/simulador-venda': { modulo: 'utilitarios' }, // FRMSIMULADORVENDA · 18 acessos · Utilitarios
  '/fiscal/nf-exportacao': { modulo: 'utilitarios' }, // FRMEXPORTANFE · 15 acessos · Utilitarios
  '/compras/pendencias': { modulo: 'utilitarios' }, // sem tela no menu do legado · Utilitarios
  '/cadastro/configuracoes': { modulo: 'utilitarios' }, // sem tela no menu do legado · Utilitarios
};

/** Rede de segurança: tela nova que ainda não entrou no ROTA_MODULO. */
const PREFIXO_MODULO: Record<string, ModuloId> = {
  '/compras': 'mercadorias',
  '/vendas': 'vendas',
  '/cobranca': 'financeiro',
  '/financeiro': 'financeiro',
  '/precificacao': 'produtos',
  '/estoque': 'estoque',
  '/fiscal': 'fiscal',
  '/relatorios': 'relatorios',
  '/contabil': 'contabil',
  '/cadastro': 'cadastros',
};

export function destinoDaRota(href: string): Destino {
  const direto = ROTA_MODULO[href];
  if (direto) return direto;
  const prefixo = Object.keys(PREFIXO_MODULO).find((p) => href.startsWith(`${p}/`));
  return { modulo: prefixo ? PREFIXO_MODULO[prefixo] : 'cadastros' };
}

export function moduloDaRota(href: string): ModuloId {
  return destinoDaRota(href).modulo;
}

type TelaDoMenu = { href: string; name: string; icon: LucideIcon };
type ItemDoMenu = { name: string; href?: string; icon?: LucideIcon; subitems?: ItemDoMenu[] };

/**
 * Agrupa as telas nos contextos do rail (um por módulo), na ordem de MODULOS.
 * Dentro do módulo, as telas soltas vêm primeiro (na ordem de TELAS) e os
 * subgrupos depois, colapsáveis — os dois níveis do menu do legado.
 * Módulo sem nenhuma tela convertida não vira contexto.
 */
export function contextosDoMenu(telas: readonly TelaDoMenu[]) {
  return MODULOS.map((modulo) => {
    const minhas = telas.filter((t) => moduloDaRota(t.href) === modulo.id);
    const soltas: ItemDoMenu[] = [];
    const grupos = new Map<string, ItemDoMenu[]>();
    for (const t of minhas) {
      const { grupo } = destinoDaRota(t.href);
      const item: ItemDoMenu = { name: t.name, href: t.href, icon: t.icon };
      if (!grupo) soltas.push(item);
      else grupos.set(grupo, [...(grupos.get(grupo) ?? []), item]);
    }
    const items: ItemDoMenu[] = [
      ...soltas,
      ...[...grupos].map(([name, subitems]) => ({ name, icon: modulo.icon, subitems })),
    ];
    return { id: modulo.id, label: modulo.label, icon: modulo.icon, items };
  }).filter((c) => c.items.length > 0);
}
