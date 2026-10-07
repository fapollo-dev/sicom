import { sql, type RawBuilder, type SqlBool } from 'kysely';
import type { Operacao } from './pesquisa-sql';
import type { RegraDeCor } from './cores';

export interface ContextoDosObrigatorios {
  /** a loja do login (`dmPrincipal.EmpresaCODEMPRESA`) */
  empresa: number | null;
  operador: number | null;
  /** `dmPrincipal.GetMultiEmpresa`: as lojas marcadas, recortadas às do operador (vazio = a do login) */
  lojas: () => Promise<number[]>;
  /** a escolha da janela de opções antes da Pesquisa */
  opcao?: string;
  /** os parâmetros que a tela declara em `extras` (o resto é ignorado) */
  extras: Record<string, string>;
}

/**
 * Como cada cadastro abre a Pesquisa no legado (`TfrmCadMaster.btnPesquisaClick`, uCadMaster.pas:516-590, e os que o substituem).
 * Levantado tela a tela em tools/pesquisa/telas-pesquisa.json (com a procedência de cada item).
 */
export interface PesquisaTela {
  /** a view do destino (a `GET_<TABELA>` do legado) */
  view: string;
  /** o nome da view no legado quando não é o da do destino em maiúsculas (a chave do status da tela — VIEW_PESQ) */
  viewLegado?: string;
  /**
   * a relação que a Pesquisa LÊ quando não é a `view`: a versão integral do legado que o construtor de relatórios já tem
   * (`rel_get_*`, `get_rcb`, `get_cp`… — as mesmas colunas, nomes e multiplicidade da produção; dossiê uPesquisa-corteB-views.md)
   */
  relacao?: string;
  /** as colunas do Apollo no fim da relação (a PK, o código cru…): valem para retorno, filtros e lookups, mas não aparecem na combo de
   *  campos nem na grade */
  ocultas?: string[];
  /**
   * a relação (e as ocultas dela) quando ela muda com a escolha da janela de opções e do complemento — o A pagar lê GET_APAGAR nas
   * abertas e GET_CP nas outras, e as _CEN com "Com centro de custo" (uAPagar.pas:2651-2685); sem ela, `relacao`/`ocultas`
   */
  relacaoPorOpcao?: (opcao: string | undefined, complemento: string | undefined) => { relacao: string; ocultas?: string[]; viewLegado: string };
  /** as colunas que completam a ordem quando a relação do legado repete o código (pedido × loja, título × baixa, título × centro,
   *  parceiro × endereço): a página não troca linha de lugar entre uma consulta e outra */
  desempate?: string[];
  /** o FRM do legado (procedência) */
  form: string;
  /** "Pesquisa <comentário da view>" */
  titulo?: string;
  /** o campo de retorno (FCampoRetornoPesquisa; padrão CODIGO) — a coluna da view que volta ao cadastro */
  retorno: string;
  /** o rdgAtivo (FCampoAtivo/FValorAtivo): sem ele a situação não filtra (a tabela não tem o campo) */
  campoAtivo?: { coluna: string; sim: string; nao: string } | null;
  /** os filtros obrigatórios (lista de condições, separada do filtro do operador) */
  obrigatorios?: (ctx: ContextoDosObrigatorios) => RawBuilder<SqlBool>[] | Promise<RawBuilder<SqlBool>[]>;
  /** o texto do rodapé com o filtro obrigatório (o legado mostra o WHERE) */
  descricaoObrigatorios?: string;
  /** a janela de opções antes da Pesquisa (A pagar, A receber) */
  opcoes?: Array<{ id: string; rotulo: string; padrao?: boolean }>;
  /** o complemento da janela de opções (o `OpcoesCompl` do TfrmOpcoes — o "Com/Sem centro de custo" do A pagar) */
  complemento?: Array<{ id: string; rotulo: string; padrao?: boolean }>;
  /** os parâmetros que a tela aceita do cliente (o resto é ignorado) — ex.: o tipo da NF */
  extras?: string[];
  /** SetDefaultPesquisa: campo, valor, operação e ordenação de abertura; sem ela, o 1º campo em ordem alfabética */
  abertura?: { campo?: string; operacao?: Operacao; valor?: string; ordenacao?: string; ordemDesc?: boolean };
  /** a consulta auxiliar (`FConsAux`/`FCampoAux`, uPesquisa.pas:2234-2242): pesquisar por este campo acha também por ela (o código de
   *  barras pelo código auxiliar) */
  alternativa?: { campo: string; condicao: (valor: string) => RawBuilder<SqlBool> };
  /** as cores da grade + legenda (o `cdsColoracao` do chamador); a regra cuja coluna a view do destino não tem fica de fora até o corte B */
  cores?: RegraDeCor[];
  /** os atalhos de detalhe da grade (o `cdsDetalhes`: a tecla abre a consulta da linha — uPesquisa.pas:1867-1907) e o rótulo deles */
  detalhes?: Detalhe[];
  rotuloDetalhes?: string;
  /** o totalizador aberto com a soma (TotalizaFinanceiro — A pagar, A receber) */
  totalizador?: boolean;
}

export interface Detalhe {
  tecla: 'f8' | 'f9' | 'f10' | 'f11' | 'f12';
  /** o TEXTO_TELA da janela */
  titulo: string;
  /** a consulta do detalhe da linha (o código de retorno dela); sem consulta, o motivo */
  consulta?: (codigo: number) => RawBuilder<Record<string, unknown>>;
  indisponivel?: string;
}

/** `IN (…)` de números já validados (lojas do operador) */
export const emLista = (coluna: string, valores: number[]): RawBuilder<SqlBool> =>
  sql<SqlBool>`${sql.ref(coluna)} in (${sql.join(valores)})`;

/** a loja do login (`dmPrincipal.EmpresaCODEMPRESA`) */
const daLoja = (ctx: ContextoDosObrigatorios, coluna: string): RawBuilder<SqlBool> => sql<SqlBool>`${sql.ref(coluna)} = ${ctx.empresa ?? -1}`;
const ATIVO = { coluna: 'ativo', sim: 'S', nao: 'N' };
/** as do Apollo no fim da rel_get_produtos (mig 390) */
const OCULTAS_PRODUTO = ['idproduto', 'ncmsh'];
/**
 * As colunas do Apollo no fim de cada versão integral do legado (as da `get_*` da tela que a produção não tem): tudo o que vem depois
 * da última coluna da view da produção (`user_tab_cols`, 07/10/2026 — dossiê uPesquisa-corteB-views.md §1). A combo e a grade ficam
 * com as do legado: GET_PEDIDOCOMPRA 24, GET_APAGAR 53, GET_CP 43, GET_CP_CEN 41, GET_APAGAR_CEN 38, GET_RCB 73, GET_NF 49,
 * GET_PARCEIROS 61, GET_OPERADORES 11 (a SENHA o SEGREDO tira), GET_EMPRESAS 24 (as 4 SENHA*, idem), GET_CONTAS_BANCARIAS 13,
 * GET_FORMAS_PGTO 11, GET_LOTE_COBRANCA 5, GET_UNIDADE 5, GET_BAIRRO 5; e no corte B5/B6 GET_PLC 8, GET_CFOP 10, GET_FAMILIAS_PROD 10,
 * GET_PLANO_CONTAS 7, GET_PRECO 5, GET_MOTIVOS_OPERACAO 4, GET_HISTORICO_CONTABIL 3, GET_OPERACOES_CONTA 3 (as quatro últimas são a
 * própria view da tela, com a coluna que faltava no fim — mig 413).
 */
const OCULTAS = {
  /** rel_get_pedidocompra (mig 390): depois de VALOR_FRETE */
  pedidocompra: ['codpedcomp', 'codparceiro', 'fornecedor', 'codoperador', 'codconpagto', 'pc_tipo_frete', 'pc_valor_frete',
    'pc_nronf_cruzamento', 'idsituacao_nf', 'dtfaturamento', 'dtencerramento', 'indr', 'total', 'qtde_itens', 'empresas'],
  /** rel_get_apagar (mig 389): depois de OBS_NOTA */
  apagar: ['codapg', 'codparceiro', 'codempresa', 'consiliado', 'razao', 'duplicata', 'dtvenda', 'dtvenc', 'txjuros', 'dias_atrazo',
    'dias_tolerancia', 'juro', 'total', 'agrupado', 'contabilizado', 'tipodoc', 'origem', 'cadastrado_manualmente', 'dtpgto', 'idpgto',
    'codplc', 'idsituacao_nf'],
  /** get_cp_cen (mig 388): depois de DATA_BX — o centro do rateio que o Apollo já expunha (mig 203) */
  cpCen: ['codplc', 'descricao', 'codigo_centro_custo'],
  /** get_rcb (migs 388/399): depois de DATA_AGENDAMENTO */
  rcb: ['consilidado', 'codgrupo'],
  /** rel_get_nf (mig 389): depois de NFE_DEVOLVIDA */
  nf: ['codnf', 'nronf', 'serie', 'dtemissao', 'codparceiro', 'idsituacao_nf', 'situacao', 'statusnfe', 'proc', 'totalnf'],
  /** rel_get_parceiros (mig 390): depois de EMAIL_VENDEDOR_REPRESENTANTE */
  parceiros: ['codparceiro', 'tipofj', 'bloqued'],
  /** rel_get_operadores (mig 393): depois de ATIVO */
  operadores: ['codoperador', 'idgrupo', 'grupo', 'codparceiro', 'parceiro', 'idsupervisor', 'supervisor', 'desabilita_operacoes_basicas',
    'desabilita_desconto_pdv', 'solicitar_alteracao_senha', 'codigoauxiliar', 'indr'],
  /** rel_get_empresas (mig 393): depois de NOME_PARCEIRO */
  empresas: ['idempresa', 'razao_social', 'figurafiscal', 'serie_nfe', 'despoperacional'],
  /** rel_get_contas_bancarias (mig 393): depois de ATIVO */
  contasBancarias: ['codconta', 'codbco', 'nroconta'],
  /** rel_get_formas_pgto (mig 393): depois de DATA_INATIVO */
  formasPgto: ['idpgto', 'plccofre', 'cofre', 'codcontacorrente', 'codplanocontas', 'recebe_pdv', 'permite_sangria_pdv',
    'lanc_movimento_individual', 'tipo'],
  /** rel_get_lote_cobranca (mig 393): depois de TOTAL_LOTE */
  loteCobranca: ['codlotecob', 'codparceiro', 'data', 'razao', 'qtd_itens'],
  /** rel_get_unidade (mig 393): depois de FRACIONADO */
  unidade: ['codunidade', 'indr', 'producao'],
  /** rel_get_bairro (mig 393): depois de REGIAO */
  bairro: ['idbairro', 'indr'],
  /** rel_get_plc (mig 413): depois de OBRIGA_MOTIVO_PERDA — os campos de lookup da web gravam CODPLC e mostram DESCCODPLC */
  plc: ['codplc', 'desccodplc', 'tpconta', 'nivelconta', 'codcontabil'],
  /** rel_get_cfop (mig 413): depois de DESCODCONTABIL — o CODCFOP (char) que a NF grava, o TIPOESTADO e a DEVOLUCAO do cadastro */
  cfop: ['codcfop', 'codigo', 'tipoestado', 'devolucao'],
  /** rel_get_familias_prod (mig 393): depois de SETOR_PERDA_PADRAO */
  familias: ['codfamilia', 'descricao', 'coddpto', 'codgrupo', 'codsecao', 'codsetor', 'excluido'],
  /** rel_get_plano_contas (mig 393): depois de CLASSE */
  planoContas: ['codplanocontas', 'descricao_completa', 'natureza', 'nivel', 'codpai'],
  /** get_preco + CODIGO no fim (mig 413): a PK do Apollo */
  preco: ['id_preco'],
  /** get_motivos_operacao + PERDA_PADRAO no fim (mig 413) */
  motivosOperacao: ['codmotivoop'],
  /** get_historico_contabil + DESC_HISTORICO no fim (mig 413): os nomes e os campos da tela do Apollo */
  historicoContabil: ['codhistcontabil', 'deschist', 'coringas', 'dtultimalteracao', 'dtcadastro'],
  /** get_operacoes_conta + CODIGO no fim (mig 413) */
  operacoesConta: ['codopconta'],
};
/** UCadProduto.pas:6302-6318 (e os ~15 lookups de produto) */
/** UCadProduto.pas:6332-6393 — os atalhos da pesquisa de produto (e dos lookups de produto do pedido, da NF, da cotação…) */
const ESTOQUE_E_PRECO = (tabela: 'estoque' | 'estoque_dep') => (codigo: number) => sql<Record<string, unknown>>`
  select e.idempresa as "Empresa", e.qtde as "Qtde", e.minimo as "Minimo", e.maximo as "Maximo", m.vrcusto as "ValorCusto",
         m.vrcustorep as "ValorCustoRep", m.vrcustoreal as "ValorCustoReal", m.vrvenda as "ValorVenda"
    from ${sql.table(tabela)} e join multi_preco m on m.idproduto = e.idproduto and m.idempresa = e.idempresa
   where e.idproduto = ${codigo} order by e.idempresa`;
const DETALHES_PRODUTO: Detalhe[] = [
  { tecla: 'f8', titulo: 'Consulta de Preços', consulta: (codigo) => sql<Record<string, unknown>>`
      select idempresa as "Idempresa", vrvenda as "Vrvenda", promocao as "Promocao", vrpromo as "Vrpromo"
        from multi_preco where idproduto = ${codigo} order by idempresa` },
  { tecla: 'f9', titulo: 'Consulta dos Códigos Auxiliares', consulta: (codigo) => sql<Record<string, unknown>>`
      select c.codauxiliar as "Codauxiliar", c.fatoremb as "Fatoremb" from codauxiliar c
       where c.codbarra = (select p.codbarra from produtos p where p.idproduto = ${codigo}) order by c.codauxiliar` },
  { tecla: 'f10', titulo: 'Consulta do Estoque', consulta: ESTOQUE_E_PRECO('estoque') },
  { tecla: 'f11', titulo: 'Consulta do Estoque do Déposito', consulta: ESTOQUE_E_PRECO('estoque_dep') },
  { tecla: 'f12', titulo: 'Consulta do Estoque de Produção',
    indisponivel: 'O estoque de produção não vem para o Apollo: a ESTOQUE_PROD parou (desde 2025 todo item de NF tem ORIGEM_ESTOQUE = E; 8 saldos residuais).' },
];
const ROTULO_DETALHES_PRODUTO = '[F8] - Preços do produto  [F9] - Códigos Auxiliares [F10] - Estoque  [F11] - Estoque Depósito  [F12] - Estoque Produção';
const CORES_PRODUTO: RegraDeCor[] = [
  { coluna: 'ativo', op: '=', valor: 'N', cor: 'VERMELHO', legenda: 'Produto Inativo' },
  { coluna: 'promocao', op: '=', valor: 'S', cor: 'AZUL', legenda: 'Produto em promoção' },
];
/** a lista da situação do documento (SITUACAO_NF_PLC / SITUACAO_NF_PARCEIROS): com lista, só ela; sem lista, tudo */
const permitidosPelaSituacao = (ctx: ContextoDosObrigatorios, tabela: 'situacao_nf_plc' | 'situacao_nf_parceiros', coluna: 'codplc' | 'codparceiro'): RawBuilder<SqlBool>[] => {
  const sit = Number(ctx.extras.idsituacao_nf);
  if (!(sit > 0)) return [];
  return [sql<SqlBool>`(not exists (select 1 from ${sql.table(tabela)} x where x.idsituacao_nf = ${sit})
    or ${sql.ref(coluna)} in (select x.${sql.ref(coluna)} from ${sql.table(tabela)} x where x.idsituacao_nf = ${sit}))`];
};

/**
 * Os 26 cadastros do Apollo com Pesquisa. Onde há `relacao`, os nomes de coluna são os dela — a versão integral do legado (corte B,
 * dossiê uPesquisa-corteB-views.md), com as do Apollo `ocultas` no fim; sem ela, os da VIEW DO DESTINO (a `get_*` do Apollo), e onde
 * essa view ainda não tem a coluna do legado o filtro vai pela tabela base. A procedência de cada item (arquivo:linha do legado e o
 * V$SQL da produção) está em tools/pesquisa/telas-pesquisa.json.
 */
export const TELAS_DA_PESQUISA: Record<string, PesquisaTela> = {
  // B4: a GET_UNIDADE da produção (rel_get_unidade, mig 393) — CODIGO = CODUNIDADE, o WHERE INDR <> 'E' dentro da view
  'cadastro/unidades': { view: 'get_unidade', relacao: 'rel_get_unidade', ocultas: OCULTAS.unidade, form: 'FRMCADUNIDADE', titulo: 'Unidades',
    retorno: 'codigo', campoAtivo: ATIVO },
  // B5: a GET_OPERACOES_CONTA da produção (DESCRICAO, CODIGO, TIPO) — o CODIGO (= CODOPCONTA) no fim da view da tela (mig 413);
  // retorno CODIGO (uCadMaster.pas:1063-1064) e o 1º alfabético, CODIGO
  'cadastro/operacoes-conta': { view: 'get_operacoes_conta', ocultas: OCULTAS.operacoesConta, form: 'FRMCADOPERACOESCONTA', titulo: 'Operações de conta',
    retorno: 'codigo', abertura: { campo: 'codigo', operacao: 'igual' } },
  // frmCadBairro só existe no binário da produção (TABELA_CADASTRO/MENUEXPRESS): a situação segue o form-base (presumida). B4: a
  // GET_BAIRRO da produção (rel_get_bairro, mig 393) — CODIGO = IDBAIRRO, REGIAO decodificada (o 'O' = 'CENTRO' do legado, mantido)
  'cadastro/bairros': { view: 'get_bairro', relacao: 'rel_get_bairro', ocultas: OCULTAS.bairro, form: 'FRMCADBAIRRO', titulo: 'Bairros',
    retorno: 'codigo', campoAtivo: ATIVO },
  // B5: a GET_PLC da produção (rel_get_plc, mig 413) — o WHERE dela (DESCCODPLC com mais de 5 caracteres e não excluída: das 388
  // contas da produção, 55 ficam de fora pelo tamanho e 1 por excluída) está DENTRO da view, como lá (o legado não o mostra no rodapé); o TIPO_CONTA decodificado (RECEITA/DESPESA/
  // NEUTRA), CODIGO_EXTENSO, NIVEL_CONTA, PERDA, OBRIGA_MOTIVO_PERDA; CODIGO = CODPLC
  'cadastro/plc': { view: 'get_plc', relacao: 'rel_get_plc', ocultas: OCULTAS.plc, form: 'FRMCADPLC', titulo: 'Centro de custo', retorno: 'codigo',
    abertura: { campo: 'codigo', operacao: 'igual' } },
  'cadastro/bancos': { view: 'get_bancos', form: 'FRMCADBANCOS', titulo: 'Bancos', retorno: 'codigo' },
  'cadastro/ncm': { view: 'get_ncm', form: 'FRMCADNCM', titulo: 'NCM', retorno: 'codigo', abertura: { campo: 'codigo', operacao: 'igual' } },
  // B2: a GET_PEDIDOCOMPRA da produção (rel_get_pedidocompra, mig 390): uma linha por pedido × loja (PEDIDO_COMPRA_EMPRESA, mantida
  // pelo gatilho da mig 401), com o IDEMPRESA da loja, o FECHADO DA LOJA (PEDIDO_COMPRA_QTDE) e o FORNECEDOR_ATIVO. A janela "PEDIDO
  // DE COMPRA" (uPedidoCompra.pas:7150-7162): "Trazer somente aberto" = FECHADO = 'N' AND IDEMPRESA in (<lojas>) AND
  // FORNECEDOR_ATIVO = 'S' (:7160, o V$SQL da produção); "Trazer todos" = sem filtro nenhum. Abre em PARCEIRO / Em qualquer lugar e
  // ordena por NROPEDIDO (SetDefaultPesquisa, :762); retorno CODIGO (= CODPEDCOMP). Na produção, loja 1: 1.429 abertos × 3.982 pela
  // regra anterior (o FECHADO do cabeçalho e o CSV das lojas)
  'compras/pedidos': { view: 'get_pedidocompra', relacao: 'rel_get_pedidocompra', ocultas: OCULTAS.pedidocompra, form: 'FRMPEDIDOCOMPRA',
    titulo: 'Pedido de compra', retorno: 'codigo', desempate: ['idempresa'],
    abertura: { campo: 'parceiro', operacao: 'qualquer', ordenacao: 'nropedido' },
    opcoes: [{ id: 'abertos', rotulo: 'Trazer somente aberto', padrao: true }, { id: 'todos', rotulo: 'Trazer todos' }],
    obrigatorios: async (ctx) => (ctx.opcao !== 'abertos' ? [] : [
      sql<SqlBool>`${sql.ref('fechado')} = 'N'`, emLista('idempresa', await ctx.lojas()), sql<SqlBool>`${sql.ref('fornecedor_ativo')} = 'S'`]),
    // uPedidoCompra.pas:735-760 — o FECHADO da linha é o da loja: o pedido baixado numa loja e aberto na outra pinta só a linha da que baixou
    cores: [
      { coluna: 'fechado', op: '=', valor: 'S', cor: 'VERMELHO', legenda: 'Pedido baixado' },
      { coluna: 'bonificacao', op: '=', valor: 'S', cor: 'AZUL', legenda: 'Pedido com bonificação' },
      { coluna: 'dt_vencimento', op: '<', hoje: true, cor: 'VERDE', legenda: 'Pedido vencido' },
    ] },
  // uNF.pas:6202-6300: TIPO da tela e a loja do login (:6291); abre em PARCEIRO / Em qualquer lugar ordenando por CODIGO (:6302);
  // retorno CODIGO (= CODNF — a variável Filtro de :6288 nunca é atribuída, uPesquisa.pas:826-829 cai no CODIGO). B4: a GET_NF da
  // produção (rel_get_nf, mig 389) — 49 colunas, NRO_NF numérico e o STATUS_NFE DECODIFICADO (o operador procura "CANCELADA")
  'fiscal/nf': { view: 'get_nf', relacao: 'rel_get_nf', ocultas: OCULTAS.nf, form: 'FRMNF', titulo: 'Notas fiscais', retorno: 'codigo', extras: ['tipo'],
    abertura: { campo: 'parceiro', operacao: 'qualquer', ordenacao: 'codigo' },
    obrigatorios: (ctx) => [
      ...(ctx.extras.tipo === 'E' || ctx.extras.tipo === 'S' ? [sql<SqlBool>`${sql.ref('tipo')} = ${ctx.extras.tipo}`] : []),
      daLoja(ctx, 'idempresa')],
    // uNF.pas:6211-6283 — as 5 regras do STATUS_NFE comparam o TEXTO da GET_NF (P/C com TPEMISSAO 1 = "… NA RECEITA"/"ENVIADA A
    // RECEITA", 6/7 = "… EM CONTINGENCIA"; D = "NFE DENEGADA NA RECEITA"); depois PROCESSADA, OBS_NF e NF_IMPORTACAO_NFE
    cores: [
      { coluna: 'status_nfe', op: '=', valor: 'NFE ENVIADA A RECEITA', cor: 'AZUL', legenda: 'NFe Emitida' },
      { coluna: 'status_nfe', op: '=', valor: 'NFE CANCELADA NA RECEITA', cor: 'VERMELHO', legenda: 'NFe Cancelada' },
      { coluna: 'status_nfe', op: '=', valor: 'NFE DENEGADA NA RECEITA', cor: 'AMARELO', legenda: 'NFe Denegada' },
      { coluna: 'status_nfe', op: '=', valor: 'NFE ENVIADA EM CONTINGENCIA', cor: 'AZUL', legenda: 'NFe Emitida em contingência' },
      { coluna: 'status_nfe', op: '=', valor: 'NFE CANCELADA EM CONTINGENCIA', cor: 'VERMELHO', legenda: 'NFe Cancelada em contingência' },
      { coluna: 'processada', op: '=', valor: 'S', cor: 'VERDE', legenda: 'Notas processadas' },
      { coluna: 'obs_nf', op: '<>', valor: '', cor: 'FUSHIA', legenda: 'NFe com Obs' },
      { coluna: 'nf_importacao_nfe', op: '=', valor: 'S', cor: 'ROXO', legenda: 'NFe Importada' },
      { coluna: 'nf_importacao_nfe', op: '=', valor: 'T', cor: 'AZUL_PETROLEO', legenda: 'NFe Transferência entre lojas' },
    ] },
  'cadastro/marcas': { view: 'get_marcas', form: 'FRMCADMARCAS', titulo: 'Marcas', retorno: 'codigo', abertura: { campo: 'codigo', operacao: 'igual' } },
  'cadastro/cidades': { view: 'get_cidades', form: 'FRMCADCIDADES', titulo: 'Cidades', retorno: 'idcidade' },
  'cadastro/familias': { view: 'get_familias_prod', form: 'FRMCADFAMILIAPROD', titulo: 'Família de produtos', retorno: 'codigo', campoAtivo: ATIVO,
    // UCadFamiliaProd.pas
    cores: [{ coluna: 'ativo', op: '=', valor: 'N', cor: 'VERMELHO', legenda: 'Categoria Inativa' }] },
  // B3 — uAPagar.pas:2630-2720: a janela "Status das contas a pagar" com o complemento "Com/Sem centro de custo" (DefaultComp := 1 =
  // Sem, :2643-2644) escolhe a VIEW (:2651-2685): "Somente abertas" → GET_APAGAR (o WHERE dos abertos está dentro dela) ou
  // GET_APAGAR_CEN; as outras → GET_CP ou GET_CP_CEN (título × baixa; as _CEN, × centro do rateio) com o estado no filtro; sempre
  // CODIGO_EMPRESA in (<lojas>); retorno CODIGO (= CODAPG, :2654); SetDefault('', '', tpQualquerLugar, False, 'VENCIMENTO') (:2691) — o
  // 1º campo alfabético DA VIEW ESCOLHIDA; o VALOR é o líquido (valor + vendor − desconto). O status da tela, o F4 e a última pesquisa
  // são os da VIEW ABERTA (o `FView` — uConfigStatusTela.pas:360, uPesquisa.pas:1411/1602/2495; o FNomeConfig := 'GET_APAGAR' de :2688
  // só serve ao teste de :674). As versões integrais: rel_get_apagar (389), get_apagar_cen (397), get_cp (391), get_cp_cen (388).
  'cadastro/apagar': { view: 'get_apagar', form: 'FRMAPAGAR', titulo: 'Contas a pagar', retorno: 'codigo', abertura: { ordenacao: 'vencimento' }, totalizador: true,
    opcoes: [{ id: 'abertas', rotulo: 'Somente abertas', padrao: true }, { id: 'quitadas', rotulo: 'Somente quitadas' },
      { id: 'adiantamento', rotulo: 'Adiantamento de crédito' }, { id: 'agrupadas', rotulo: 'Agrupadas' }, { id: 'todas', rotulo: 'Todas' }],
    complemento: [{ id: 'com', rotulo: 'Com centro de custo' }, { id: 'sem', rotulo: 'Sem centro de custo', padrao: true }],
    relacaoPorOpcao: (opcao, complemento) => {
      const comCentro = complemento === 'com';
      if (opcao === 'abertas') {
        return comCentro ? { relacao: 'get_apagar_cen', viewLegado: 'GET_APAGAR_CEN' } : { relacao: 'rel_get_apagar', ocultas: OCULTAS.apagar, viewLegado: 'GET_APAGAR' };
      }
      return comCentro ? { relacao: 'get_cp_cen', ocultas: OCULTAS.cpCen, viewLegado: 'GET_CP_CEN' } : { relacao: 'get_cp', viewLegado: 'GET_CP' };
    },
    desempate: ['data_bx', 'centro_custo'],
    obrigatorios: async (ctx) => {
      const quitada = sql`coalesce(${sql.ref('quitada')}, 'N')`;
      const adcredito = sql`coalesce(${sql.ref('adcredito')}, 'N')`;
      const agrupado = sql`coalesce(${sql.ref('agrupado')}, 'N')`;
      // a condição de estado das opções sobre a GET_CP (:2659-2684); "Somente abertas" não tem — o recorte é a própria GET_APAGAR
      const estado: Record<string, RawBuilder<SqlBool>> = {
        quitadas: sql<SqlBool>`${sql.ref('quitada')} = 'S' and ${adcredito} = 'N' and ${agrupado} = 'N'`,
        adiantamento: sql<SqlBool>`${adcredito} = 'S' and ${quitada} = 'N' and ${agrupado} = 'N'`,
        agrupadas: sql<SqlBool>`${agrupado} = 'S'`,
        // "Todas" NÃO traz agrupadas nem adiantamento quitado
        todas: sql<SqlBool>`not (${adcredito} = 'S' and ${quitada} = 'S') and ${agrupado} = 'N'`,
      };
      return [emLista('codigo_empresa', await ctx.lojas()), ...(ctx.opcao && estado[ctx.opcao] ? [estado[ctx.opcao]] : [])];
    },
    // uAPagar.pas:2692-2708 — o FORNECEDOR_POSSUI_DEBITO só existe na GET_APAGAR (nas outras views a regra não casa, como no legado)
    cores: [
      { coluna: 'bloqueio', op: '=', valor: 'S', cor: 'VERMELHO', legenda: 'Compromisso bloqueado' },
      { coluna: 'fornecedor_possui_debito', op: '=', valor: 'S', cor: 'AZUL', legenda: 'Fornecedor possui débito' },
    ] },
  // uCadUsuarios.pas:662/679: só os operadores da loja do login. B4: a GET_OPERADORES da produção (rel_get_operadores, mig 393) — uma
  // linha por operador × loja (o CODIGO_EMPRESA é o RELACAO_OPERADOR_EMPRESA.CODEMPRESA), sem o SICOM e sem os excluídos (WHERE da
  // view), o TIPOOP decodificado e a TIPO_SIGLA; CODIGO = CODOPERADOR. (A view expõe o INDR do Apollo no fim: o filtro INDR = 'I' do
  // serviço dá o mesmo conjunto — na produção OPERADORES.INDR só tem I, E e nulo.)
  'cadastro/operadores': { view: 'get_operadores', relacao: 'rel_get_operadores', ocultas: OCULTAS.operadores, form: 'FRMCADUSUARIOS', titulo: 'Operadores',
    retorno: 'codigo', obrigatorios: (ctx) => [daLoja(ctx, 'codigo_empresa')] },
  // B5: a GET_PRECO da produção (CODIGO, DESCRICAO, VALOR_REAJUSTE, REAJUSTE, ATIVO) — o CODIGO (= ID_PRECO) no fim da view (mig 413)
  'cadastro/precos': { view: 'get_preco', ocultas: OCULTAS.preco, form: 'FRMCADTABELAPRECO', titulo: 'Tabela de preço', retorno: 'codigo', campoAtivo: ATIVO },
  'compras/condicoes-pagto': { view: 'get_condicoes_pagto', form: 'FRMCADCONDICOESPAGTO', titulo: 'Condições de pagamento', retorno: 'codigo',
    abertura: { campo: 'codigo', operacao: 'igual' } },
  // B4: a GET_EMPRESAS da produção (rel_get_empresas, mig 393) — CODIGO = IDEMPRESA; as SENHA* vêm nulas e o SEGREDO as tira
  'cadastro/empresas': { view: 'get_empresas', relacao: 'rel_get_empresas', ocultas: OCULTAS.empresas, form: 'FRMCADEMPRESA', titulo: 'Empresas',
    retorno: 'codigo' },
  // uCadClientes.pas:4835-4876: o papel do menu (Clientes = CLI, Fornecedores = FRN…); o menu "Parceiros" não filtra papel. B4: a
  // GET_PARCEIROS da produção (rel_get_parceiros, mig 390) — uma linha POR ENDEREÇO (o CNPJ/CIDADE de um endereço que não é o padrão
  // acha o parceiro), com ENDERECO_ATIVO, REALIZA_RETENCOES, BLOQUEADO e DATA_ULTIMA_COMPRA; CODIGO = CODPARCEIRO
  'cadastro/parceiros': { view: 'get_parceiros', relacao: 'rel_get_parceiros', ocultas: OCULTAS.parceiros, form: 'FRMCADCLIENTES', titulo: 'Parceiros',
    retorno: 'codigo', desempate: ['cod_part_sped'],
    campoAtivo: { coluna: 'ativado', sim: 'S', nao: 'N' }, extras: ['cli', 'frn', 'tra', 'fun', 'con'],
    obrigatorios: (ctx) => (['cli', 'frn', 'tra', 'fun', 'con'] as const).filter((k) => ctx.extras[k] === 'S').map((k) => sql<SqlBool>`${sql.ref(k)} = 'S'`),
    // uCadClientes.pas:3785-3810: BLOQUEADO e DATA_ULTIMA_COMPRA (há mais de 35 dias) passam a casar; o ENDERECO_ATIVADO não existe na
    // GET_PARCEIROS da produção (a coluna é ENDERECO_ATIVO — a regra nunca casa no legado, fiel)
    cores: [
      { coluna: 'bloqueado', op: '=', valor: 'S', cor: 'VERMELHO', legenda: 'Parceiro Bloqueado' },
      { coluna: 'endereco_ativado', op: '=', valor: 'N', cor: 'ROXO', legenda: 'Endereco Desativado' },
      { coluna: 'data_ultima_compra', op: 'ndias', opDias: '>', dias: 35, cor: 'AZUL', legenda: 'Data da última compra maior que 35 dias.' },
    ] },
  // B5: a GET_MOTIVOS_OPERACAO da produção (CODIGO, TIPO_OPERACAO, DESCRICAO, PERDA_PADRAO) — o PERDA_PADRAO no fim da view (mig 413)
  'cadastro/motivos-operacao': { view: 'get_motivos_operacao', ocultas: OCULTAS.motivosOperacao, form: 'FRMCADMOTIVOOPERACOES', titulo: 'Motivos de operação',
    retorno: 'codigo', abertura: { campo: 'codigo', operacao: 'igual' } },
  // o legado mostra as formas de todas as lojas (sem recorte). B4: a GET_FORMAS_PGTO da produção (rel_get_formas_pgto, mig 393) — o
  // DESTINO decodificado (CAIXA, CARTAO…), CONTA_CORRENTE = o código, CONTA_CONTABIL = o CODIREDUZIDO; CODIGO = IDPGTO
  'cadastro/formas-pgto': { view: 'get_formas_pgto', relacao: 'rel_get_formas_pgto', ocultas: OCULTAS.formasPgto, form: 'FRMCADFORMAPGTO',
    titulo: 'Formas de pagamento', retorno: 'codigo' },
  // B4: a GET_LOTE_COBRANCA da produção (rel_get_lote_cobranca, mig 393) — CODIGO = CODLOTECOB, COBRADOR, COD_COBRADOR, DATA_COBRANCA,
  // TOTAL_LOTE; sem SetDefault (UCadLoteCobranca.pas herda o form-base): abre no 1º alfabético, COBRADOR — o que a abertura em RAZAO
  // da view anterior imitava
  'cobranca/lotes-md': { view: 'get_lote_cobranca', relacao: 'rel_get_lote_cobranca', ocultas: OCULTAS.loteCobranca, form: 'FRMCADLOTECOBRANCA',
    titulo: 'Lotes de cobrança', retorno: 'codigo' },
  // uCadAReceber.pas:1326-1349: "CONTAS A RECEBER" nas lojas (IDEMPRESA in (<lojas>)); CONSILIADO='S' quando a loja do login fecha
  // caixa; as opções por TRIM(QUITADA)/TRIM(AGRUPADO). B3: a Pesquisa é sobre a GET_RCB (SetaDataset(…, 'GET_RCB', 'GET_RCB'), :2590 —
  // get_rcb, migs 388/399): título × baixa, os nomes do legado (CLIENTE, DATA_VENCIMENTO…); abre e ordena em CLIENTE
  // (SetDefaultPesquisa('CLIENTE','',tpQualquerLugar,false,'CLIENTE'), :2714); retorno CODIGO (= CODRCB)
  'cadastro/areceber': { view: 'get_areceber', viewLegado: 'GET_RCB', relacao: 'get_rcb', ocultas: OCULTAS.rcb, form: 'FRMCADARECEBER',
    titulo: 'Contas a receber', retorno: 'codigo', totalizador: true, desempate: ['data_pagamento'],
    abertura: { campo: 'cliente', operacao: 'qualquer', ordenacao: 'cliente' },
    opcoes: [{ id: 'abertos', rotulo: 'Trazer somente abertos', padrao: true }, { id: 'liquidados', rotulo: 'Trazer somente liquidados' },
      { id: 'agrupados', rotulo: 'Agrupados' }, { id: 'todos', rotulo: 'Trazer todos' }],
    obrigatorios: async (ctx) => {
      const quitada = sql`trim(${sql.ref('quitada')})`;
      const agrupado = sql`trim(${sql.ref('agrupado')})`;
      const estado: Record<string, RawBuilder<SqlBool>> = {
        abertos: sql<SqlBool>`${quitada} = 'N' and ${agrupado} = 'N'`,
        liquidados: sql<SqlBool>`${quitada} = 'S' and ${agrupado} = 'N'`,
        agrupados: sql<SqlBool>`${agrupado} = 'S'`,
      };
      return [emLista('idempresa', await ctx.lojas()),
        sql<SqlBool>`(coalesce((select e.fechamento_caixa from empresas e where e.idempresa = ${ctx.empresa ?? -1}), 'N') <> 'S' or ${sql.ref('consiliado')} = 'S')`,
        ...(ctx.opcao && estado[ctx.opcao] ? [estado[ctx.opcao]] : [])];
    },
    // uCadAReceber.pas:2611-2635: QUITADA, REGISTRO_ARQ_REMESSA e DATA_VENCIMENTO < hoje — os nomes da GET_RCB
    cores: [
      { coluna: 'quitada', op: '=', valor: 'S', cor: 'VERDE', legenda: 'Liquidada' },
      { coluna: 'registro_arq_remessa', op: '=', valor: 'S', cor: 'ROXO', legenda: 'Boletos Bancários emitidos' },
      { coluna: 'data_vencimento', op: '<', hoje: true, cor: 'VERMELHO', legenda: 'Vencida' },
    ] },
  // B5: a GET_HISTORICO_CONTABIL da produção (CODIGO, DESC_HISTORICO, STATUS) — o DESC_HISTORICO no fim da view (mig 413); retorno CODIGO
  'cadastro/historico-contabil': { view: 'get_historico_contabil', ocultas: OCULTAS.historicoContabil, form: 'FRMCADHISTORICOCONTABIL',
    titulo: 'Histórico contábil', retorno: 'codigo', abertura: { campo: 'codigo', operacao: 'igual' } },
  'cadastro/situacoes-nf': { view: 'get_situacao_nf', form: 'FRMCADSITUACAONF', titulo: 'Situação da nota fiscal', retorno: 'idsituacao_nf' },
  // B5: a GET_CFOP da produção (rel_get_cfop, mig 413) — CFOP numérico, ESTADO (DENTRO/FORA), PRECESSA_QTDE (sic), PROCESSA_*,
  // CODCONTABIL/DESCODCONTABIL; retorno CFOP (FCampoRetornoPesquisa := 'CFOP', UCadCFOP.pas:444 — a view não tem CODIGO); sem
  // SetDefault: abre no 1º alfabético, CFOP / Igual a
  'cadastro/cfops': { view: 'get_cfop', relacao: 'rel_get_cfop', ocultas: OCULTAS.cfop, form: 'FRMCADCFOP', titulo: 'CFOP', retorno: 'cfop' },
  // o legado mostra as contas de todas as lojas (sem recorte). B4: a GET_CONTAS_BANCARIAS da produção (rel_get_contas_bancarias, mig
  // 393) — JOIN BANCOS, NRO_CONTA, AGENCIA, NRO_BANCO, DATA_ABERTURA, TELEFOMNE (sic); CODIGO = CODCONTA
  'cadastro/contas-bancarias': { view: 'get_contas_bancarias', relacao: 'rel_get_contas_bancarias', ocultas: OCULTAS.contasBancarias,
    form: 'FRMCADCONTASBANCARIAS', titulo: 'Contas bancárias', retorno: 'codigo', campoAtivo: ATIVO },

  // ── os LOOKUPS (o TfrmPesquisa.Create de um campo de outra tela): a view inteira, sem situação nem recorte próprio — o filtro de cada
  // campo vem do chamador como `f_<coluna>` (FRN='S', CLASSE='ANALITICA'…). Abertura: o 1º campo em ordem alfabética, salvo o SetDefault.
  // idsituacao_nf: os parceiros permitidos pela situação do documento (GetParceirosPermitidos — uAPagar.pas:6115, uCadAReceber.pas:680,
  // uMovCaixa.pas:740); sem lista na situação, todos (a mesma regra do gravar, modules/shared/situacao-restricoes.ts). B4: a GET_PARCEIROS
  // da produção (rel_get_parceiros) — uma linha por endereço; o `campoCodigo` da web (codparceiro) e o `fixos` (cli/frn/fun/tra/con,
  // ativado, tipo_pessoa) continuam: codparceiro fica oculta no fim, e ENDERECO_ATIVO/REALIZA_RETENCOES passam a ser filtráveis
  'lookup/parceiros': { view: 'get_parceiros', relacao: 'rel_get_parceiros', ocultas: OCULTAS.parceiros, form: 'FRMPESQUISA', titulo: 'Parceiros',
    retorno: 'codigo', desempate: ['cod_part_sped'], abertura: { campo: 'razao', operacao: 'qualquer' },
    extras: ['idsituacao_nf'], obrigatorios: (ctx) => permitidosPelaSituacao(ctx, 'situacao_nf_parceiros', 'codparceiro') },
  // naoComposto: IMPRIMIRCOMP = 'N' (uCadAgendaPromocao.pas:438-439, UCadPromocao.pas:919-920 — a GET_PRODUTOS da produção dá
  // COALESCE(IMPRIMIRCOMP,'N'): o nulo entra, 804 produtos na produção);
  // ativoCompra: ATIVO_COMPRA <> 'N' (uCadCotacao.pas:833, a GET_PRODUTOS_PC do pedido); semFilho: o produto que não é filho
  // (PRODUTO_PAI IS NULL — uNF.pas:12422). A view do destino não tem as colunas: vão pela tabela (o alargamento é o corte B).
  'lookup/produtos': { view: 'get_produtos', relacao: 'rel_get_produtos', ocultas: OCULTAS_PRODUTO, form: 'FRMPESQUISA', titulo: 'Produtos', retorno: 'idproduto',
    abertura: { campo: 'descricao', operacao: 'qualquer', ordenacao: 'descricao' }, extras: ['naoComposto', 'ativoCompra', 'semFilho'],
    // a GET_PRODUTOS é por loja (SetaEmpresaObrigatoria, uPesquisa.pas:2555-2564 — toda Pesquisa sobre ela) e já traz o IMPRIMIRCOMP com
    // COALESCE(…,'N'), o ATIVO_COMPRA da loja e o PRODUTO_PAI
    obrigatorios: (ctx) => [
      daLoja(ctx, 'idempresa'),
      ...(ctx.extras.naoComposto === 'S' ? [sql<SqlBool>`${sql.ref('imprimircomp')} = 'N'`] : []),
      ...(ctx.extras.ativoCompra === 'S' ? [sql<SqlBool>`${sql.ref('ativo_compra')} <> 'N'`] : []),
      ...(ctx.extras.semFilho === 'S' ? [sql<SqlBool>`${sql.ref('produto_pai')} is null`] : []),
    ],
    alternativa: { campo: 'codbarra', condicao: (valor) => sql<SqlBool>`${sql.ref('codbarra')} in (select c.codbarra from codauxiliar c where c.codauxiliar = ${valor.trim()})` },
    cores: CORES_PRODUTO, detalhes: DETALHES_PRODUTO, rotuloDetalhes: ROTULO_DETALHES_PRODUTO },
  // B5/B6: a GET_PLC da produção (rel_get_plc, mig 413 — o DESCCODPLC com mais de 5 caracteres dentro da view); lancavel=S: só a conta
  // no tamanho da máscara da empresa, sobre o TEXTO da view (CHARACTER_LENGTH(CODIGO_EXTENSO) = Length(MASCARAPLC) — uAPagar.pas:777,
  // uCadAReceber.pas:553, UCadSituacaoNF.pas:352, uMovCaixa.pas:712-716, UCadFamiliaProd.pas:211); idsituacao_nf: os centros da
  // situação (o CODIGO IN da lista). O TIPO_CONTA do campo (RECEITA/DESPESA) vem do chamador como `f_tipo_conta`. A empresa SEM máscara
  // segue aceitando todas (o legado compara com 0 e não acharia nada; na produção as 5 lojas têm '#.##.###' — o mesmo do scrap.service)
  'lookup/plc': { view: 'get_plc', relacao: 'rel_get_plc', ocultas: OCULTAS.plc, form: 'FRMPESQUISA', titulo: 'Centro de custo', retorno: 'codigo',
    extras: ['lancavel', 'idsituacao_nf'],
    obrigatorios: (ctx) => [
      ...(ctx.extras.lancavel === 'S'
        ? [sql<SqlBool>`((select e.mascaraplc from empresas e where e.idempresa = ${ctx.empresa ?? -1}) is null
            or char_length(${sql.ref('codigo_extenso')}) = char_length((select e.mascaraplc from empresas e where e.idempresa = ${ctx.empresa ?? -1})))`]
        : []),
      ...permitidosPelaSituacao(ctx, 'situacao_nf_plc', 'codplc'),
    ] },
  // B6: a GET_FAMILIAS_PROD da produção (rel_get_familias_prod, mig 393) — o TIPO decodificado (o chamador filtra TIPO = 'DEPARTAMENTO',
  // 'GRUPO', 'SECAO', 'SETOR', 'SUBGRUPO'…), NOME, CODEMPRESA; daLoja=S: CODEMPRESA = a loja do login (UCadFamiliaProd.pas:222/238/247/259)
  'lookup/familias': { view: 'get_familias_prod', relacao: 'rel_get_familias_prod', ocultas: OCULTAS.familias, form: 'FRMPESQUISA', titulo: 'Família de produtos',
    retorno: 'codigo', extras: ['daLoja'],
    obrigatorios: (ctx) => (ctx.extras.daLoja === 'S' ? [daLoja(ctx, 'codempresa')] : []) },
  // B6: a GET_PLANO_CONTAS da produção (rel_get_plano_contas, mig 393) — TIPO (EMPRESA/REFERENCIAL), STATUS e CLASSE (ANALITICA/
  // SINTETICA) decodificados: o filtro dos campos é o texto (uCadFormaPgto.pas:291, UCadContasBancarias.pas:175, UCadSituacaoNF.pas:276,
  // uCadPLC.pas:159); CODIGO = CODPLANOCONTAS
  'lookup/plano-contas': { view: 'get_plano_contas', relacao: 'rel_get_plano_contas', ocultas: OCULTAS.planoContas, form: 'FRMPESQUISA',
    titulo: 'Plano de contas', retorno: 'codigo' },
  // B5/B6: a GET_CFOP da produção (rel_get_cfop, mig 413) — o retorno dos campos do legado é CFOP (UCadSituacaoNF.pas:398, UCadCFOP.pas:208)
  'lookup/cfops': { view: 'get_cfop', relacao: 'rel_get_cfop', ocultas: OCULTAS.cfop, form: 'FRMPESQUISA', titulo: 'CFOP', retorno: 'cfop' },
  // B6: a GET_OPERADORES da produção (rel_get_operadores, mig 393) — uma linha por operador × loja, sem o SICOM e sem os excluídos (WHERE
  // da view), o TIPOOP decodificado e a TIPO_SIGLA (o supervisor do cadastro de operadores: DESABILITADO = 'N' AND TIPO_SIGLA = 'SUP',
  // uCadUsuarios.pas:495-501); CODIGO = CODOPERADOR
  'lookup/operadores': { view: 'get_operadores', relacao: 'rel_get_operadores', ocultas: OCULTAS.operadores, form: 'FRMPESQUISA', titulo: 'Operadores',
    retorno: 'codigo', desempate: ['codigo_empresa'] },
  // o operador do controle de permissões (uCtrlPermissoes.pas:1464-1466 spdBuscaUsuario e :380-384 btnClone): CODIGO_EMPRESA = a loja
  // do login. B4: sobre a GET_OPERADORES da produção (rel_get_operadores) — a coluna da loja no lugar do subselect na relação; a view
  // já tira o SICOM e os excluídos; o `campoCodigo` da web (codoperador) fica oculto no fim
  'lookup/operadores-da-loja': { view: 'get_operadores', relacao: 'rel_get_operadores', ocultas: OCULTAS.operadores, form: 'FRMCTRLPERMISSOES',
    titulo: 'Operadores', retorno: 'codigo', obrigatorios: (ctx) => [daLoja(ctx, 'codigo_empresa')] },
  'lookup/bancos': { view: 'get_bancos', form: 'FRMPESQUISA', titulo: 'Bancos', retorno: 'codigo' },
  'lookup/cidades': { view: 'get_cidades', form: 'FRMPESQUISA', titulo: 'Cidades', retorno: 'idcidade', abertura: { campo: 'cidade', operacao: 'qualquer' } },

  // UCadProduto.pas:6294-6300: abre em DESCRICAO (em qualquer lugar), ordena por DESCRICAO; o código de barras acha também pelo
  // código auxiliar. A GET_PRODUTOS da produção é por loja (IDEMPRESA e o ATIVO da MULTI_PRECO) — a do destino ainda não: corte B.
  'cadastro/produtos': { view: 'get_produtos', relacao: 'rel_get_produtos', ocultas: OCULTAS_PRODUTO, form: 'FRMCADPRODUTO', titulo: 'Produtos', retorno: 'idproduto',
    campoAtivo: ATIVO, obrigatorios: (ctx) => [daLoja(ctx, 'idempresa')],
    abertura: { campo: 'descricao', operacao: 'qualquer', ordenacao: 'descricao' },
    alternativa: { campo: 'codbarra', condicao: (valor) => sql<SqlBool>`${sql.ref('codbarra')} in (select c.codbarra from codauxiliar c where c.codauxiliar = ${valor.trim()})` },
    cores: CORES_PRODUTO, detalhes: DETALHES_PRODUTO, rotuloDetalhes: ROTULO_DETALHES_PRODUTO },
};
