import { produtoSchema, atualizarProdutoSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';

/**
 * PRODUTO (hub do ERP) — tela de NÚCLEO, mestre-detalhe via AggregateEngineService:
 * master `produtos` (GLOBAL — sem IDEMPRESA) + detalhe `codauxiliar` (códigos de barras
 * auxiliares / embalagens, 1:N). Fase 1 = núcleo fiel: a tela ARMAZENA config; o cálculo
 * de preço/imposto vive em precificacao (reusado em F2).
 *
 * - NÃO `empresaScoped`: produtos é catálogo global.
 * - `colunas`: todas as editáveis do master (NÃO idproduto/PK, NÃO as colunas de auditoria).
 * - O detalhe `codauxiliares` é substituído (delete+insert) a cada gravação do agregado.
 */
export const produtoAggregateConfig: AggregateConfig = {
  tabela: 'produtos',
  pk: 'idproduto',
  view: 'get_produtos',
  rbacForm: 'FRMCADPRODUTO',
  colunas: [
    // identidade
    'codbarra', 'descricao', 'descricao_resumida', 'descricao_web', 'descricao_balanca',
    // unidade / fornecedor / classificação
    'codunidade', 'unidade', 'codfor', 'idmarca',
    'codgrupo', 'codsubgrupo', 'coddpto', 'codsecao', 'codgrupopreco',
    // config fiscal (armazenada; cálculo vive em precificacao)
    'ncmsh', 'cest', 'cest_obrigatorio', 'aliquota',
    'idpiscofins', 'codfigurafiscal', 'codfcp', 'mva', 'origemprod',
    // unidade/balança/validade
    'balanca', 'codbalanca', 'fatorkg', 'peso', 'fatorcx', 'validade', 'controle_validade',
    // controle / auto-relacionamento
    'ativo', 'ativo_compra', 'idproduto_pai', 'fator_filho',
    // F4 — flags de kit/BOM (derivadas por derivar() conforme presença de itens)
    'composicao', 'decomposicao', 'receita',
  ],
  // F4 — flags COMPOSICAO/DECOMPOSICAO/RECEITA derivadas da presença de itens ('N' se vazio),
  // só quando o respectivo array vem no dto (espelha o set 'N' no btnGravar do legado).
  derivar: (dto) => {
    const out: Record<string, unknown> = {};
    const tem = (v: unknown) => (Array.isArray(v) && v.length > 0 ? 'S' : 'N');
    if (dto.composicoes !== undefined) out.composicao = tem(dto.composicoes);
    if (dto.decomposicoes !== undefined) out.decomposicao = tem(dto.decomposicoes);
    if (dto.receitas !== undefined) out.receita = tem(dto.receitas);
    return out;
  },
  // F4 — regra do legado (chbATIVOClick): não desativar produto que é COMPONENTE de algum kit.
  validar: async ({ dto, id, db }) => {
    if (id != null && dto.ativo === 'N') {
      const comp = await db
        .selectFrom('composicao')
        .select('idproduto')
        .where('idproduto_01', '=', id)
        .executeTakeFirst();
      if (comp) throw new BusinessRuleError('PRODUTO_EM_COMPOSICAO', { idproduto: id });
    }
  },
  detalhes: [
    {
      tabela: 'codauxiliar',
      pk: 'chaveaux',
      fk: 'idproduto',
      chave: 'codauxiliares',
      colunas: ['codauxiliar', 'codbarra', 'fatoremb', 'codunidade', 'operacao'],
    },
    // F2 — MULTI_PRECO: preço/custo POR EMPRESA, na MESMA form (detalhe 1:N do agregado).
    // PK surrogate id_multi_preco; idempresa é coluna (1 linha por empresa). O cálculo
    // custo→venda é REUSADO de POST /precificacao/produto (não reescrito aqui).
    {
      tabela: 'multi_preco',
      pk: 'id_multi_preco',
      fk: 'idproduto',
      chave: 'precos',
      colunas: [
        'idempresa', 'vrcusto', 'vrcustorep', 'markup', 'vrvenda', 'vrpromo',
        'promocao', 'margeml', 'aliquotasaida', 'ativo', 'ativo_compra',
      ],
    },
    // F3 — ESTOQUE: saldo por empresa, na MESMA form. REGRA: qtde (saldo) é movido por
    // transação (NF/vendas/ajuste) — read-only no cadastro; só minimo/maximo/local editáveis.
    // qtde entra em `colunas` apenas p/ PRESERVAR o saldo no substitute (delete+insert) — o
    // usuário nunca o altera aqui. Movimentação/ajuste/auditoria/replicação = fases futuras.
    {
      tabela: 'estoque',
      pk: 'id_estoque',
      fk: 'idproduto',
      chave: 'estoques',
      colunas: ['idempresa', 'qtde', 'minimo', 'maximo', 'local'],
    },
    // F4 — kit/BOM (3 detalhes; cada item referencia outro produto via idproduto_01/idproduto_receita)
    {
      tabela: 'composicao',
      pk: 'codcomp',
      fk: 'idproduto',
      chave: 'composicoes',
      colunas: ['idproduto_01', 'qtde', 'valor', 'descricao'],
    },
    {
      tabela: 'decomposicao',
      pk: 'coddecomp',
      fk: 'idproduto',
      chave: 'decomposicoes',
      colunas: ['idproduto_01', 'percentual'],
    },
    {
      tabela: 'receita_prod',
      pk: 'codreceita',
      fk: 'idproduto',
      chave: 'receitas',
      colunas: ['idproduto_receita', 'qtde', 'valor', 'unidade', 'servico', 'fatorcxprod'],
    },
  ],
  colunasPesquisa: ['idproduto', 'codbarra', 'descricao', 'ncmsh', 'marca', 'aliquota', 'ativo'],
};

export const ProdutoAggregateController = createAggregateController({
  path: 'cadastro/produtos',
  config: produtoAggregateConfig,
  schema: produtoSchema,
  updateSchema: atualizarProdutoSchema,
});
