import { produtoSchema, atualizarProdutoSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';

/**
 * Unidade do produto (= PARA do fator de conversão, read-only no legado). Prioriza a unidade do dto
 * (novo valor sendo gravado); se o PUT parcial não a traz, busca a persistida por PK. Usado pelo dedup
 * (validar) E pela derivação do detalhe (derivarItensTrx) — MESMA precedência p/ a chave casar com o gravado.
 */
async function unidadeDoProduto(
  dto: { unidade?: unknown },
  id: number | null,
  db: any,
): Promise<string | undefined> {
  if (dto.unidade != null) return String(dto.unidade);
  if (id == null) return undefined;
  const p = await db
    .selectFrom('produtos')
    .select('unidade')
    .where('idproduto', '=', id)
    .executeTakeFirst();
  return (p?.unidade as string | undefined) ?? undefined;
}

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
    'ativo', 'ativo_compra', 'idproduto_pai', 'fator_filho', 'geraqtde',
    // F4 — flags de kit/BOM (derivadas por derivar() conforme presença de itens)
    'composicao', 'decomposicao', 'receita',
    // aba "Outros" (tshOutros) — 14 flags S/N de comportamento (todas da mig 113; servico é produto-nível,
    // distinto de receita_prod.servico). prod_sem_gtin/vasilhame/cotacao foram achado de paridade.
    'servico', 'servicoatende', 'item_cozinha', 'impressora_terminal', 'retirapromo', 'realizatroca',
    'imobilizado', 'atacado', 'exibesicomanda', 'vende_site', 'altera_descricao_cotacao',
    'prod_sem_gtin', 'vasilhame', 'cotacao',
    // F4b — nutricional (rotulagem)
    'valorenergetico', 'carboidrato', 'proteina', 'gorduratotal', 'gordurasaturada', 'gorduratrans',
    'fibra', 'sodio', 'acucares_totais', 'acucares_adicionados',
    'vd_valorenergetico', 'vd_carboidrato', 'vd_proteina', 'vd_gorduratotal', 'vd_gordurasaturada',
    'vd_gorduratrans', 'vd_fibra', 'vd_sodio',
    'unporcao', 'qtde_porcao', 'desc_porcao', 'acucar_adcionado', 'gordura_saturada', 'altoem_sodio',
    'expdadosnutricionais', 'codinfanutri',
    // F4b — logística (dimensões + paletização)
    'comprimento_produto', 'comprimento_caixa', 'comprimento_pallet',
    'largura_produto', 'largura_caixa', 'largura_pallet',
    'altura_produto', 'altura_caixa', 'altura_pallet',
    'pesoliq_produto', 'pesoliq_caixa', 'pesoliq_pallet',
    'pesobruto_produto', 'pesobruto_caixa', 'pesobruto_pallet',
    'pallet_caixas_por_camada', 'pallet_camadas_por_pallet', 'pallet_caixas_por_pallet',
    'pallet_empilhamento', 'pallet_produtos_por_caixa', 'pallet_produtos_por_pallet', 'fatorcx_prod',
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
    // Produtos filhos (EdtProdutoPaiExit, pas:2843): o produto pai deve ser DIFERENTE do próprio produto.
    if (id != null && dto.idproduto_pai != null && Number(dto.idproduto_pai) === id) {
      throw new BusinessRuleError('PRODUTO_PAI_IGUAL_FILHO', { idproduto: id });
    }
    if (id != null && dto.ativo === 'N') {
      const comp = await db
        .selectFrom('composicao')
        .select('idproduto')
        .where('idproduto_01', '=', id)
        .executeTakeFirst();
      if (comp) throw new BusinessRuleError('PRODUTO_EM_COMPOSICAO', { idproduto: id });
    }
    // Fator de conversão: unicidade por (DE,PARA) dentro do produto (fiel ao RetornarValores do legado;
    // golden tem 0 duplicados). PARA = unidade do produto; DE≠unidade e FATOR>0 são guardas de ENTRADA
    // na web (golden tem 21 linhas com DE=PARA e 1 com FATOR=0) — o servidor só barra o duplicado real.
    const fatores = dto.fatoresConversao as Array<{ de?: string; para?: string }> | undefined;
    if (Array.isArray(fatores) && fatores.length) {
      // dedup pela MESMA chave que será GRAVADA: PARA é derivado da unidade do produto (unidade do dto,
      // ou a persistida quando o PUT não a traz) — precedência `unidade ?? item.para` idêntica ao derivarItensTrx.
      const unidade = await unidadeDoProduto(dto, id ?? null, db);
      const vistos = new Set<string>();
      for (const f of fatores) {
        const de = (f.de ?? '').trim().toUpperCase();
        const para = ((unidade ?? f.para) ?? '').trim().toUpperCase();
        const chave = `${de}|${para}`;
        if (vistos.has(chave)) throw new BusinessRuleError('FATOR_CONVERSAO_DUPLICADO', { de, para });
        vistos.add(chave);
      }
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
        // OWNED pelo banco/outros módulos — entram em `colunas` APENAS p/ serem PRESERVADAS no substitute
        // (delete+insert), como o `qtde` do estoque. Fold auditoria: sem isso, todo save do produto ZERAVA
        // etq_impressa (a etiqueta perdia o "precisa reimprimir"), dtultprecoalterado e codagenda (quebrando o
        // reverter da agenda de promoção, que casa por codagenda).
        'etq_impressa', 'dtultprecoalterado', 'codagenda',
      ],
      chaveNatural: ['idempresa'],
      preservar: ['etq_impressa', 'dtultprecoalterado', 'codagenda'],
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
      // `qtde` (saldo) é OWNED pelo movimento (NF/F3), não pelo cadastro: no substitute, o engine
      // PRESERVA o saldo atual do banco (casado por idempresa) em vez de regravar o valor obsoleto
      // do cliente — evita lost-update quando um save de produto interleava com um processar de NF.
      chaveNatural: ['idempresa'],
      preservar: ['qtde'],
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
    // Fator de conversão de unidades (tabFatorConversao) — FK é `codproduto` (nome fiel ao legado).
    // PARA é DERIVADO da unidade do produto (read-only no legado; golden PARA=unidade 100%): copiada do
    // header (dto master, sempre enviado pela form) em cada linha; fallback = o `para` que a linha trouxe.
    {
      tabela: 'fator_conversao',
      pk: 'codfatorconv',
      fk: 'codproduto',
      chave: 'fatoresConversao',
      colunas: ['de', 'para', 'fator'],
      // PARA autoritativo = unidade do produto (header.unidade ou, se o PUT não a trouxer, a persistida via
      // masterId). Garante PARA nunca nulo (coluna NOT NULL, espelha Oracle) e casa com a chave do dedup.
      derivarItensTrx: async (itens, trx, _emp, header, masterId) => {
        const unidade = await unidadeDoProduto(header ?? {}, masterId ?? null, trx);
        return itens.map((it) => ({ ...it, para: unidade ?? it.para }));
      },
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
