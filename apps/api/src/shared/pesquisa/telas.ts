import { sql, type RawBuilder, type SqlBool } from 'kysely';
import type { Operacao } from './pesquisa-sql';

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
}

/** `IN (…)` de números já validados (lojas do operador) */
export const emLista = (coluna: string, valores: number[]): RawBuilder<SqlBool> =>
  sql<SqlBool>`${sql.ref(coluna)} in (${sql.join(valores)})`;

/** a loja do login (`dmPrincipal.EmpresaCODEMPRESA`) */
const daLoja = (ctx: ContextoDosObrigatorios, coluna: string): RawBuilder<SqlBool> => sql<SqlBool>`${sql.ref(coluna)} = ${ctx.empresa ?? -1}`;
const ATIVO = { coluna: 'ativo', sim: 'S', nao: 'N' };

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
    } },
  // uNF.pas:6202-6300: TIPO da tela e a loja do login
  'fiscal/nf': { view: 'get_nf', form: 'FRMNF', titulo: 'Notas fiscais', retorno: 'codnf', extras: ['tipo'],
    abertura: { campo: 'parceiro', operacao: 'qualquer', ordenacao: 'codnf' },
    obrigatorios: (ctx) => [
      ...(ctx.extras.tipo === 'E' || ctx.extras.tipo === 'S' ? [sql<SqlBool>`${sql.ref('tipo')} = ${ctx.extras.tipo}`] : []),
      daLoja(ctx, 'idempresa')] },
  'cadastro/marcas': { view: 'get_marcas', form: 'FRMCADMARCAS', titulo: 'Marcas', retorno: 'codigo', abertura: { campo: 'codigo', operacao: 'igual' } },
  'cadastro/cidades': { view: 'get_cidades', form: 'FRMCADCIDADES', titulo: 'Cidades', retorno: 'idcidade' },
  'cadastro/familias': { view: 'get_familias_prod', form: 'FRMCADFAMILIAPROD', titulo: 'Família de produtos', retorno: 'codigo', campoAtivo: ATIVO },
  // uAPagar.pas:2630-2720: "Status das contas a pagar" nas lojas; ordena por VENCIMENTO. A view do destino não tem ADCREDITO: vai pela
  // tabela. O complemento "com centro de custo" (GET_APAGAR_CEN/GET_CP_CEN) entra com as views do corte B.
  'cadastro/apagar': { view: 'get_apagar', form: 'FRMAPAGAR', titulo: 'Contas a pagar', retorno: 'codapg', abertura: { ordenacao: 'dtvenc' },
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
    } },
  // uCadUsuarios.pas:662/679: só os operadores da loja do login (a view do destino não tem a loja: vai pela tabela)
  'cadastro/operadores': { view: 'get_operadores', form: 'FRMCADUSUARIOS', titulo: 'Operadores', retorno: 'codoperador',
    obrigatorios: (ctx) => [sql<SqlBool>`${sql.ref('codoperador')} in (select o.codoperador from operadores o where o.codempresa = ${ctx.empresa ?? -1})`] },
  'cadastro/precos': { view: 'get_preco', form: 'FRMCADTABELAPRECO', titulo: 'Tabela de preço', retorno: 'id_preco', campoAtivo: ATIVO },
  'compras/condicoes-pagto': { view: 'get_condicoes_pagto', form: 'FRMCADCONDICOESPAGTO', titulo: 'Condições de pagamento', retorno: 'codigo',
    abertura: { campo: 'codigo', operacao: 'igual' } },
  'cadastro/empresas': { view: 'get_empresas', form: 'FRMCADEMPRESA', titulo: 'Empresas', retorno: 'idempresa' },
  // uCadClientes.pas:4835-4876: o papel do menu (Clientes = CLI, Fornecedores = FRN…); o menu "Parceiros" não filtra papel
  'cadastro/parceiros': { view: 'get_parceiros', form: 'FRMCADCLIENTES', titulo: 'Parceiros', retorno: 'codparceiro',
    campoAtivo: { coluna: 'ativado', sim: 'S', nao: 'N' }, extras: ['cli', 'frn', 'tra', 'fun', 'con'],
    obrigatorios: (ctx) => (['cli', 'frn', 'tra', 'fun', 'con'] as const).filter((k) => ctx.extras[k] === 'S').map((k) => sql<SqlBool>`${sql.ref(k)} = 'S'`) },
  'cadastro/motivos-operacao': { view: 'get_motivos_operacao', form: 'FRMCADMOTIVOOPERACOES', titulo: 'Motivos de operação', retorno: 'codigo',
    abertura: { campo: 'codigo', operacao: 'igual' } },
  // o legado mostra as formas de todas as lojas (sem recorte)
  'cadastro/formas-pgto': { view: 'get_formas_pgto', form: 'FRMCADFORMAPGTO', titulo: 'Formas de pagamento', retorno: 'idpgto' },
  'cobranca/lotes-md': { view: 'get_lote_cobranca', form: 'FRMCADLOTECOBRANCA', titulo: 'Lotes de cobrança', retorno: 'codlotecob',
    abertura: { campo: 'razao', operacao: 'qualquer' } },
  // uCadAReceber.pas:1326-1349 e 2714: "CONTAS A RECEBER" nas lojas; CONSILIADO='S' quando a loja do login fecha caixa
  'cadastro/areceber': { view: 'get_areceber', form: 'FRMCADARECEBER', titulo: 'Contas a receber', retorno: 'codrcb',
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
    } },
  'cadastro/historico-contabil': { view: 'get_historico_contabil', form: 'FRMCADHISTORICOCONTABIL', titulo: 'Histórico contábil', retorno: 'codhistcontabil',
    abertura: { campo: 'codigo', operacao: 'igual' } },
  'cadastro/situacoes-nf': { view: 'get_situacao_nf', form: 'FRMCADSITUACAONF', titulo: 'Situação da nota fiscal', retorno: 'idsituacao_nf' },
  'cadastro/cfops': { view: 'get_cfop', form: 'FRMCADCFOP', titulo: 'CFOP', retorno: 'codcfop', abertura: { campo: 'codigo', operacao: 'igual' } },
  // o legado mostra as contas de todas as lojas (sem recorte)
  'cadastro/contas-bancarias': { view: 'get_contas_bancarias', form: 'FRMCADCONTASBANCARIAS', titulo: 'Contas bancárias', retorno: 'codconta', campoAtivo: ATIVO },

  // ── os LOOKUPS (o TfrmPesquisa.Create de um campo de outra tela): a view inteira, sem situação nem recorte próprio — o filtro de cada
  // campo vem do chamador como `f_<coluna>` (FRN='S', CLASSE='A'…). Abertura: o 1º campo em ordem alfabética, salvo o SetDefault.
  'lookup/parceiros': { view: 'get_parceiros', form: 'FRMPESQUISA', titulo: 'Parceiros', retorno: 'codparceiro', abertura: { campo: 'razao', operacao: 'qualquer' } },
  'lookup/produtos': { view: 'get_produtos', form: 'FRMPESQUISA', titulo: 'Produtos', retorno: 'idproduto',
    abertura: { campo: 'descricao', operacao: 'qualquer', ordenacao: 'descricao' },
    alternativa: { campo: 'codbarra', condicao: (valor) => sql<SqlBool>`${sql.ref('codbarra')} in (select c.codbarra from codauxiliar c where c.codauxiliar = ${valor.trim()})` } },
  'lookup/plc': { view: 'get_plc', form: 'FRMPESQUISA', titulo: 'Centro de custo', retorno: 'codplc' },
  'lookup/familias': { view: 'get_familias_prod', form: 'FRMPESQUISA', titulo: 'Família de produtos', retorno: 'codfamilia' },
  'lookup/plano-contas': { view: 'get_plano_contas', form: 'FRMPESQUISA', titulo: 'Plano de contas', retorno: 'codplanocontas' },
  'lookup/cfops': { view: 'get_cfop', form: 'FRMPESQUISA', titulo: 'CFOP', retorno: 'codcfop' },
  'lookup/operadores': { view: 'get_operadores', form: 'FRMPESQUISA', titulo: 'Operadores', retorno: 'codoperador' },
  'lookup/bancos': { view: 'get_bancos', form: 'FRMPESQUISA', titulo: 'Bancos', retorno: 'codigo' },
  'lookup/cidades': { view: 'get_cidades', form: 'FRMPESQUISA', titulo: 'Cidades', retorno: 'idcidade', abertura: { campo: 'cidade', operacao: 'qualquer' } },

  // UCadProduto.pas:6294-6300: abre em DESCRICAO (em qualquer lugar), ordena por DESCRICAO; o código de barras acha também pelo
  // código auxiliar. A GET_PRODUTOS da produção é por loja (IDEMPRESA e o ATIVO da MULTI_PRECO) — a do destino ainda não: corte B.
  'cadastro/produtos': { view: 'get_produtos', form: 'FRMCADPRODUTO', titulo: 'Produtos', retorno: 'idproduto', campoAtivo: ATIVO,
    abertura: { campo: 'descricao', operacao: 'qualquer', ordenacao: 'descricao' },
    alternativa: { campo: 'codbarra', condicao: (valor) => sql<SqlBool>`${sql.ref('codbarra')} in (select c.codbarra from codauxiliar c where c.codauxiliar = ${valor.trim()})` } },
};
