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
/** a GET_OPERADORES da produção: `WHERE O.LOGIN <> 'SICOM'` */
const semSicom = sql<SqlBool>`${sql.ref('login')} <> 'SICOM'`;
/** `CODIGO_EMPRESA = <loja do login>` na GET_OPERADORES = o operador está na RELACAO_OPERADOR_EMPRESA da loja */
const daLojaPelaRelacao = (ctx: ContextoDosObrigatorios): RawBuilder<SqlBool> =>
  sql<SqlBool>`${sql.ref('codoperador')} in (select r.codoperador from relacao_operador_empresa r where r.codempresa = ${ctx.empresa ?? -1})`;

/**
 * Os 26 cadastros do Apollo com Pesquisa. Os nomes de coluna são os da VIEW DO DESTINO (a `get_*` do Apollo); onde a view do destino
 * ainda não tem a coluna do legado, o filtro vai pela tabela base (o alargamento das views é o corte B do dossiê). A procedência de
 * cada item (arquivo:linha do legado e o V$SQL da produção) está em tools/pesquisa/telas-pesquisa.json.
 */
export const TELAS_DA_PESQUISA: Record<string, PesquisaTela> = {
  'cadastro/unidades': { view: 'get_unidade', form: 'FRMCADUNIDADE', titulo: 'Unidades', retorno: 'codigo', campoAtivo: ATIVO },
  'cadastro/operacoes-conta': { view: 'get_operacoes_conta', form: 'FRMCADOPERACOESCONTA', titulo: 'Operações de conta', retorno: 'codopconta',
    abertura: { campo: 'codopconta', operacao: 'igual' } },
  // frmCadBairro só existe no binário da produção (TABELA_CADASTRO/MENUEXPRESS): a situação segue o form-base (presumida)
  'cadastro/bairros': { view: 'get_bairro', form: 'FRMCADBAIRRO', titulo: 'Bairros', retorno: 'idbairro', campoAtivo: ATIVO },
  // a GET_PLC da produção só mostra as contas com DESCCODPLC de mais de 5 caracteres (55 ficam de fora)
  'cadastro/plc': { view: 'get_plc', form: 'FRMCADPLC', titulo: 'Centro de custo', retorno: 'codigo', abertura: { campo: 'codigo', operacao: 'igual' },
    obrigatorios: () => [sql<SqlBool>`length(coalesce(${sql.ref('desccodplc')}, '')) > 5`], descricaoObrigatorios: 'contas com mais de 5 caracteres' },
  'cadastro/bancos': { view: 'get_bancos', form: 'FRMCADBANCOS', titulo: 'Bancos', retorno: 'codigo' },
  'cadastro/ncm': { view: 'get_ncm', form: 'FRMCADNCM', titulo: 'NCM', retorno: 'codigo', abertura: { campo: 'codigo', operacao: 'igual' } },
  // uPedidoCompra.pas:7150-7162: a janela "PEDIDO DE COMPRA" — aberto = FECHADO='N' nas lojas (o FORNECEDOR_ATIVO='S' entra com a view do corte B)
  'compras/pedidos': { view: 'get_pedidocompra', form: 'FRMPEDIDOCOMPRA', titulo: 'Pedido de compra', retorno: 'codpedcomp',
    abertura: { campo: 'fornecedor', operacao: 'qualquer', ordenacao: 'codpedcomp' },
    opcoes: [{ id: 'abertos', rotulo: 'Trazer somente aberto', padrao: true }, { id: 'todos', rotulo: 'Trazer todos' }],
    obrigatorios: async (ctx) => {
      if (ctx.opcao !== 'abertos') return [];
      const lojas = await ctx.lojas();
      // o pedido multi-loja: a dona ou uma das lojas da lista (o legado tem uma linha por pedido × loja)
      return [sql<SqlBool>`${sql.ref('fechado')} = 'N'`,
        sql<SqlBool>`(${sql.ref('idempresa')} in (${sql.join(lojas)}) or exists (select 1 from unnest(string_to_array(replace(coalesce(${sql.ref('empresas')}, ''), ' ', ''), ',')) e where e ~ '^[0-9]+$' and e::int in (${sql.join(lojas)})))`];
    },
    // uPedidoCompra.pas:735-760
    cores: [
      { coluna: 'fechado', op: '=', valor: 'S', cor: 'VERMELHO', legenda: 'Pedido baixado' },
      { coluna: 'bonificacao', op: '=', valor: 'S', cor: 'AZUL', legenda: 'Pedido com bonificação' },
      { coluna: 'dt_vencimento', op: '<', hoje: true, cor: 'VERDE', legenda: 'Pedido vencido' },
    ] },
  // uNF.pas:6202-6300: TIPO da tela e a loja do login
  'fiscal/nf': { view: 'get_nf', form: 'FRMNF', titulo: 'Notas fiscais', retorno: 'codnf', extras: ['tipo'],
    abertura: { campo: 'parceiro', operacao: 'qualquer', ordenacao: 'codnf' },
    obrigatorios: (ctx) => [
      ...(ctx.extras.tipo === 'E' || ctx.extras.tipo === 'S' ? [sql<SqlBool>`${sql.ref('tipo')} = ${ctx.extras.tipo}`] : []),
      daLoja(ctx, 'idempresa')],
    // uNF.pas:6211-6283 — o STATUS_NFE decodificado da GET_NF (P/C com TPEMISSAO 1 ou 6/7, D); a cor só depende do código
    cores: [
      { coluna: 'statusnfe', op: '=', valor: 'P', cor: 'AZUL', legenda: 'NFe Emitida' },
      { coluna: 'statusnfe', op: '=', valor: 'C', cor: 'VERMELHO', legenda: 'NFe Cancelada' },
      { coluna: 'statusnfe', op: '=', valor: 'D', cor: 'AMARELO', legenda: 'NFe Denegada' },
      { coluna: 'statusnfe', op: '=', valor: 'P', cor: 'AZUL', legenda: 'NFe Emitida em contingência' },
      { coluna: 'statusnfe', op: '=', valor: 'C', cor: 'VERMELHO', legenda: 'NFe Cancelada em contingência' },
      { coluna: 'proc', op: '=', valor: 'S', cor: 'VERDE', legenda: 'Notas processadas' },
      { coluna: 'obs_nf', op: '<>', valor: '', cor: 'FUSHIA', legenda: 'NFe com Obs' },
      { coluna: 'nf_importacao_nfe', op: '=', valor: 'S', cor: 'ROXO', legenda: 'NFe Importada' },
      { coluna: 'nf_importacao_nfe', op: '=', valor: 'T', cor: 'AZUL_PETROLEO', legenda: 'Transferência entre lojas' },
    ] },
  'cadastro/marcas': { view: 'get_marcas', form: 'FRMCADMARCAS', titulo: 'Marcas', retorno: 'codigo', abertura: { campo: 'codigo', operacao: 'igual' } },
  'cadastro/cidades': { view: 'get_cidades', form: 'FRMCADCIDADES', titulo: 'Cidades', retorno: 'idcidade' },
  'cadastro/familias': { view: 'get_familias_prod', form: 'FRMCADFAMILIAPROD', titulo: 'Família de produtos', retorno: 'codigo', campoAtivo: ATIVO,
    // UCadFamiliaProd.pas
    cores: [{ coluna: 'ativo', op: '=', valor: 'N', cor: 'VERMELHO', legenda: 'Categoria Inativa' }] },
  // uAPagar.pas:2630-2720: "Status das contas a pagar" nas lojas; ordena por VENCIMENTO. A view do destino não tem ADCREDITO: vai pela
  // tabela. O complemento "com centro de custo" (GET_APAGAR_CEN/GET_CP_CEN) entra com as views do corte B.
  'cadastro/apagar': { view: 'get_apagar', form: 'FRMAPAGAR', titulo: 'Contas a pagar', retorno: 'codapg', abertura: { ordenacao: 'dtvenc' }, totalizador: true,
    opcoes: [{ id: 'abertas', rotulo: 'Somente abertas', padrao: true }, { id: 'quitadas', rotulo: 'Somente quitadas' },
      { id: 'adiantamento', rotulo: 'Adiantamento de crédito' }, { id: 'agrupadas', rotulo: 'Agrupadas' }, { id: 'todas', rotulo: 'Todas' }],
    obrigatorios: async (ctx) => {
      const adcredito = sql`(select coalesce(a.adcredito, 'N') from apagar a where a.codapg = ${sql.ref('get_apagar.codapg')})`;
      const quitada = sql`coalesce(${sql.ref('quitada')}, 'N')`;
      const agrupado = sql`coalesce(${sql.ref('agrupado')}, 'N')`;
      const estado: Record<string, RawBuilder<SqlBool>> = {
        abertas: sql<SqlBool>`${quitada} = 'N' and ${adcredito} = 'N' and ${agrupado} = 'N'`,
        quitadas: sql<SqlBool>`${quitada} = 'S' and ${adcredito} = 'N' and ${agrupado} = 'N'`,
        adiantamento: sql<SqlBool>`${adcredito} = 'S' and ${quitada} = 'N' and ${agrupado} = 'N'`,
        agrupadas: sql<SqlBool>`${agrupado} = 'S'`,
        // "Todas" NÃO traz agrupadas nem adiantamento quitado
        todas: sql<SqlBool>`not (${adcredito} = 'S' and ${quitada} = 'S') and ${agrupado} = 'N'`,
      };
      return [emLista('codempresa', await ctx.lojas()), ...(ctx.opcao && estado[ctx.opcao] ? [estado[ctx.opcao]] : [])];
    },
    // uAPagar.pas:2692-2708
    cores: [
      { coluna: 'bloqueio', op: '=', valor: 'S', cor: 'VERMELHO', legenda: 'Compromisso bloqueado' },
      { coluna: 'fornecedor_possui_debito', op: '=', valor: 'S', cor: 'AZUL', legenda: 'Fornecedor possui débito' },
    ] },
  // uCadUsuarios.pas:662/679: só os operadores da loja do login. O CODIGO_EMPRESA da GET_OPERADORES da produção é o
  // RELACAO_OPERADOR_EMPRESA.CODEMPRESA (LEFT JOIN — uma linha por operador × loja), e a view tira o login SICOM
  'cadastro/operadores': { view: 'get_operadores', form: 'FRMCADUSUARIOS', titulo: 'Operadores', retorno: 'codoperador',
    obrigatorios: (ctx) => [semSicom, daLojaPelaRelacao(ctx)] },
  'cadastro/precos': { view: 'get_preco', form: 'FRMCADTABELAPRECO', titulo: 'Tabela de preço', retorno: 'id_preco', campoAtivo: ATIVO },
  'compras/condicoes-pagto': { view: 'get_condicoes_pagto', form: 'FRMCADCONDICOESPAGTO', titulo: 'Condições de pagamento', retorno: 'codigo',
    abertura: { campo: 'codigo', operacao: 'igual' } },
  'cadastro/empresas': { view: 'get_empresas', form: 'FRMCADEMPRESA', titulo: 'Empresas', retorno: 'idempresa' },
  // uCadClientes.pas:4835-4876: o papel do menu (Clientes = CLI, Fornecedores = FRN…); o menu "Parceiros" não filtra papel
  'cadastro/parceiros': { view: 'get_parceiros', form: 'FRMCADCLIENTES', titulo: 'Parceiros', retorno: 'codparceiro',
    campoAtivo: { coluna: 'ativado', sim: 'S', nao: 'N' }, extras: ['cli', 'frn', 'tra', 'fun', 'con'],
    obrigatorios: (ctx) => (['cli', 'frn', 'tra', 'fun', 'con'] as const).filter((k) => ctx.extras[k] === 'S').map((k) => sql<SqlBool>`${sql.ref(k)} = 'S'`),
    // uCadClientes.pas:3785-3810: o ENDERECO_ATIVADO não existe na GET_PARCEIROS da produção (a regra nunca casa no legado — fiel)
    cores: [
      { coluna: 'bloqued', op: '=', valor: 'S', cor: 'VERMELHO', legenda: 'Parceiro Bloqueado' },
      { coluna: 'endereco_ativado', op: '=', valor: 'N', cor: 'ROXO', legenda: 'Endereco Desativado' },
      { coluna: 'data_ultima_compra', op: 'ndias', opDias: '>', dias: 35, cor: 'AZUL', legenda: 'Data da última compra maior que 35 dias.' },
    ] },
  'cadastro/motivos-operacao': { view: 'get_motivos_operacao', form: 'FRMCADMOTIVOOPERACOES', titulo: 'Motivos de operação', retorno: 'codigo',
    abertura: { campo: 'codigo', operacao: 'igual' } },
  // o legado mostra as formas de todas as lojas (sem recorte)
  'cadastro/formas-pgto': { view: 'get_formas_pgto', form: 'FRMCADFORMAPGTO', titulo: 'Formas de pagamento', retorno: 'idpgto' },
  'cobranca/lotes-md': { view: 'get_lote_cobranca', form: 'FRMCADLOTECOBRANCA', titulo: 'Lotes de cobrança', retorno: 'codlotecob',
    abertura: { campo: 'razao', operacao: 'qualquer' } },
  // uCadAReceber.pas:1326-1349 e 2714: "CONTAS A RECEBER" nas lojas; CONSILIADO='S' quando a loja do login fecha caixa
  'cadastro/areceber': { view: 'get_areceber', viewLegado: 'GET_RCB', form: 'FRMCADARECEBER', titulo: 'Contas a receber', retorno: 'codrcb', totalizador: true,
    abertura: { campo: 'razao', operacao: 'qualquer', ordenacao: 'razao' },
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
      return [emLista('codempresa', await ctx.lojas()),
        sql<SqlBool>`(coalesce((select e.fechamento_caixa from empresas e where e.idempresa = ${ctx.empresa ?? -1}), 'N') <> 'S' or ${sql.ref('consiliado')} = 'S')`,
        ...(ctx.opcao && estado[ctx.opcao] ? [estado[ctx.opcao]] : [])];
    },
    // uCadAReceber.pas:2612-2636 (DATA_VENCIMENTO < hoje)
    cores: [
      { coluna: 'quitada', op: '=', valor: 'S', cor: 'VERDE', legenda: 'Liquidada' },
      { coluna: 'registro_arq_remessa', op: '=', valor: 'S', cor: 'ROXO', legenda: 'Boletos Bancários emitidos' },
      { coluna: 'dtvenc', op: '<', hoje: true, cor: 'VERMELHO', legenda: 'Vencida' },
    ] },
  'cadastro/historico-contabil': { view: 'get_historico_contabil', form: 'FRMCADHISTORICOCONTABIL', titulo: 'Histórico contábil', retorno: 'codhistcontabil',
    abertura: { campo: 'codigo', operacao: 'igual' } },
  'cadastro/situacoes-nf': { view: 'get_situacao_nf', form: 'FRMCADSITUACAONF', titulo: 'Situação da nota fiscal', retorno: 'idsituacao_nf' },
  'cadastro/cfops': { view: 'get_cfop', form: 'FRMCADCFOP', titulo: 'CFOP', retorno: 'codcfop', abertura: { campo: 'codigo', operacao: 'igual' } },
  // o legado mostra as contas de todas as lojas (sem recorte)
  'cadastro/contas-bancarias': { view: 'get_contas_bancarias', form: 'FRMCADCONTASBANCARIAS', titulo: 'Contas bancárias', retorno: 'codconta', campoAtivo: ATIVO },

  // ── os LOOKUPS (o TfrmPesquisa.Create de um campo de outra tela): a view inteira, sem situação nem recorte próprio — o filtro de cada
  // campo vem do chamador como `f_<coluna>` (FRN='S', CLASSE='A'…). Abertura: o 1º campo em ordem alfabética, salvo o SetDefault.
  // idsituacao_nf: os parceiros permitidos pela situação do documento (GetParceirosPermitidos — uAPagar.pas:6115, uCadAReceber.pas:680,
  // uMovCaixa.pas:740); sem lista na situação, todos (a mesma regra do gravar, modules/shared/situacao-restricoes.ts)
  'lookup/parceiros': { view: 'get_parceiros', form: 'FRMPESQUISA', titulo: 'Parceiros', retorno: 'codparceiro', abertura: { campo: 'razao', operacao: 'qualquer' },
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
  // a GET_PLC da produção (DESCCODPLC com mais de 5 caracteres); lancavel=S: só a conta no tamanho da máscara da empresa
  // (CHARACTER_LENGTH(CODIGO_EXTENSO) = máscara — uAPagar.pas:771-778, uCadAReceber.pas:547-553, uCadFormaPgto.pas:239-241,
  // uMovCaixa.pas:712-716, UCadFamiliaProd.pas:209-211; o mesmo do scrap.service); idsituacao_nf: os centros da situação
  'lookup/plc': { view: 'get_plc', form: 'FRMPESQUISA', titulo: 'Centro de custo', retorno: 'codplc', extras: ['lancavel', 'idsituacao_nf'],
    obrigatorios: (ctx) => [
      sql<SqlBool>`length(coalesce(${sql.ref('desccodplc')}, '')) > 5`,
      ...(ctx.extras.lancavel === 'S'
        ? [sql<SqlBool>`(select e.mascaraplc from empresas e where e.idempresa = ${ctx.empresa ?? -1}) is null
            or char_length(coalesce(${sql.ref('desccodplc')}, '')) = char_length((select e.mascaraplc from empresas e where e.idempresa = ${ctx.empresa ?? -1}))`]
        : []),
      ...permitidosPelaSituacao(ctx, 'situacao_nf_plc', 'codplc'),
    ] },
  // daLoja=S: as famílias da empresa do login (CODEMPRESA = empresa — UCadFamiliaProd.pas:222/238/247/259)
  'lookup/familias': { view: 'get_familias_prod', form: 'FRMPESQUISA', titulo: 'Família de produtos', retorno: 'codfamilia', extras: ['daLoja'],
    obrigatorios: (ctx) => (ctx.extras.daLoja === 'S'
      ? [sql<SqlBool>`${sql.ref('codfamilia')} in (select f.codfamilia from familias_prod f where f.idempresa = ${ctx.empresa ?? -1})`] : []) },
  'lookup/plano-contas': { view: 'get_plano_contas', form: 'FRMPESQUISA', titulo: 'Plano de contas', retorno: 'codplanocontas' },
  'lookup/cfops': { view: 'get_cfop', form: 'FRMPESQUISA', titulo: 'CFOP', retorno: 'codcfop' },
  'lookup/operadores': { view: 'get_operadores', form: 'FRMPESQUISA', titulo: 'Operadores', retorno: 'codoperador', obrigatorios: () => [semSicom] },
  // o operador do controle de permissões (uCtrlPermissoes.pas:1464-1466 spdBuscaUsuario e :380-384 btnClone): CODIGO_EMPRESA = a loja do login
  'lookup/operadores-da-loja': { view: 'get_operadores', form: 'FRMCTRLPERMISSOES', titulo: 'Operadores', retorno: 'codoperador',
    obrigatorios: (ctx) => [semSicom, daLojaPelaRelacao(ctx)] },
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
