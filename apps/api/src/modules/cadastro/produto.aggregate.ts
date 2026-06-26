import { produtoSchema, atualizarProdutoSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';

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
  ],
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
  ],
  colunasPesquisa: ['idproduto', 'codbarra', 'descricao', 'ncmsh', 'marca', 'aliquota', 'ativo'],
};

export const ProdutoAggregateController = createAggregateController({
  path: 'cadastro/produtos',
  config: produtoAggregateConfig,
  schema: produtoSchema,
  updateSchema: atualizarProdutoSchema,
});
