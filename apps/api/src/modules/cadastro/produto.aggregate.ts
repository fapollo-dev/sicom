import { sql } from 'kysely';
import { currentTenant } from '../../shared/tenant/tenant-context';
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

/**
 * MODO "GERAR LOTE" do preço no form do produto (UCadProduto.pas:3097-3251 + NovoLotePreco:7993). Quando a config
 * HABILITA_GERACAO_LOTE_PRODUTO='S': para cada linha de preço do dto cujo vrvenda/promocao/vrpromo DIFERE do banco,
 * (a) ENFILEIRA um lote_preco (ORIGEM='P', OBS com cod-nome do operador, MARKUP só se>0, ALTEROUPROMOCAO='S' quando
 * a flag de promo mudou, PROCESSADO='N') e (b) **REVERTE** os campos de preço do dto p/ o valor do banco — fiel à
 * reversão do legado, que grava o multi_preco com o valor ANTIGO e deixa o preço novo pendente na fila.
 * Expande por GRUPO DE PREÇO (um lote por produto do grupo × empresa, :3218-3224) — redundante com a propagação do
 * consumidor, mas idempotente (mesmo valor), exatamente como o legado. Com a config 'N' (valor do golden) nada muda.
 * REVISÃO INLINE (o subagente auditor caiu em API-529; checklist verificado à mão):
 *  - reversão: o engine lê `dto[det.chave]` DEPOIS do validar → o array mutado é o que grava (provado no smoke).
 *  - reverte só vrvenda/vrpromo/promocao (idem legado :3105-3115); vrcusto/markup/margeml/ativo seguem sendo salvos.
 *  - CREATE: o engine chama validar SEM `id` (e com db read-only) → o guard `id != null` impede a emissão no insert
 *    (fiel a `State <> usInserted`).
 *  - linha de preço NOVA (sem linha no banco) → `continue`: é inclusão, não "alteração de preço" → grava direto.
 *  - salvar 2× o mesmo preço novo gera 2 lotes (o banco segue com o preço velho, então "mudou" de novo) — idêntico
 *    ao legado (OldValue é o valor do banco); o consumidor resolve por last-wins.
 *  - grupo de N produtos → N lotes e o consumidor propaga cada um pelo grupo (N×N updates do MESMO valor): custo
 *    aceito por FIDELIDADE (o legado faz igual); o estado final é o mesmo processando 1 ou todos os lotes.
 */
async function emitirLotesDePreco(dto: Record<string, unknown>, idproduto: number, trx: any): Promise<void> {
  const precos = Array.isArray(dto.precos) ? (dto.precos as Array<Record<string, unknown>>) : null;
  if (!precos || !precos.length) return;
  // resolução da config com PRECEDÊNCIA de escopo (o AggregateConfig é um objeto puro, sem DI p/ o ConfigService —
  // então a precedência é replicada aqui): override Empresa > valor global. 'Usuario' não está no whitelist desta
  // chave e 'Modulo' não tem contexto de módulo aqui (mesma limitação dos demais call-sites do resolver).
  const cfg = (await trx.selectFrom('configuracoes').select(['id', 'valor']).where('codigo', '=', 'HABILITA_GERACAO_LOTE_PRODUTO').executeTakeFirst()) as { id?: number; valor?: string } | undefined;
  if (!cfg) return;
  const empTenant = currentTenant().empresaId ?? null;
  let valor = String(cfg.valor ?? 'N');
  if (empTenant != null) {
    const ov = (await trx.selectFrom('configuracoes_especificas').select('valor')
      .where('id', '=', cfg.id).where('tipo', '=', 'Empresa').where('chave', '=', String(empTenant)).executeTakeFirst()) as { valor?: string } | undefined;
    if (ov?.valor != null) valor = String(ov.valor);
  }
  if (valor !== 'S') return; // modo On-line (default/golden): aplica direto, nada a enfileirar
  const op = currentTenant().operadorId ?? null;
  const nomeOp = (await trx.selectFrom('operadores').select('nome').where('codoperador', '=', op).executeTakeFirst()) as { nome?: string } | undefined;
  const obs = `REFERENTE AO AJUSTE NO CADASTRO DO PRODUTO REALIZADO PELO OPERADOR: ${op ?? ''}-${(nomeOp?.nome ?? '').trim()}`.slice(0, 300);
  const grupo = (await trx.selectFrom('produtos').select('codgrupopreco').where('idproduto', '=', idproduto).executeTakeFirst()) as { codgrupopreco?: number } | undefined;

  for (const linha of precos) {
    const empresa = Number(linha.idempresa);
    if (!Number.isFinite(empresa)) continue;
    const atual = (await trx.selectFrom('multi_preco').select(['vrvenda', 'vrpromo', 'promocao'])
      .where('idproduto', '=', idproduto).where('idempresa', '=', empresa).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!atual) continue; // linha NOVA de preço (insert) → não é "alteração"; segue o caminho normal
    const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
    const novoVenda = n(linha.vrvenda);
    const novoPromo = n(linha.vrpromo);
    const novaFlag = String(linha.promocao ?? 'N') === 'S' ? 'S' : 'N';
    const flagAtual = String(atual.promocao ?? 'N') === 'S' ? 'S' : 'N';
    const vendaMudou = novoVenda !== n(atual.vrvenda);
    const flagMudou = novaFlag !== flagAtual;
    if (!vendaMudou && !flagMudou && novoPromo === n(atual.vrpromo)) continue; // nada mudou nesta empresa

    // alvos: o produto + (se houver) todos os do mesmo grupo de preço COM linha de preço nessa empresa.
    let alvos: number[] = [idproduto];
    if (grupo?.codgrupopreco != null && Number(grupo.codgrupopreco) > 0) {
      const doGrupo = (await trx.selectFrom('produtos as p')
        .innerJoin('multi_preco as m', (j: any) => j.onRef('m.idproduto', '=', 'p.idproduto').on('m.idempresa', '=', empresa))
        .select('p.idproduto').where('p.codgrupopreco', '=', Number(grupo.codgrupopreco)).execute()) as Array<{ idproduto: number }>;
      alvos = Array.from(new Set([idproduto, ...doGrupo.map((r) => Number(r.idproduto))]));
    }
    const markup = n(linha.markup);
    for (const alvo of alvos) {
      await trx.insertInto('lote_preco').values({
        idproduto: alvo, codempresa: empresa, vrvenda: novoVenda,
        ...(markup > 0 ? { markup } : {}), // fiel: coluna omitida quando <= 0
        promocao: novaFlag, vrpromo: novoPromo, alteroupromocao: flagMudou ? 'S' : 'N',
        datalote: sql`now()`, obs, origem: 'P', codoperador: op, processado: 'N',
      }).execute();
    }
    // (b) REVERSÃO fiel: o multi_preco fica com o preço ANTIGO; o novo só vale quando o lote for processado.
    linha.vrvenda = atual.vrvenda;
    linha.vrpromo = atual.vrpromo;
    linha.promocao = atual.promocao;
  }
}

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
    // mig 132 — entram na PROPAGAÇÃO pai→filho (trigger trg_produtos_propaga_filhos)
    'aliqope_interna', 'coberturamaxima', 'idtabela', 'codireduzido', 'dif_preco_prod_filho_x_pai',
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
    // A OUTRA METADE da regra dos 2 ramos da propagação (fold da auditoria): o trigger não sobrescreve o
    // CODGRUPOPRECO do filho quando ele tem diferença de preço própria — porque no legado esse filho **não tem
    // grupo de preço nenhum**: `cdsPrincipalBeforePost` (UCadProduto.pas:8630-8633) faz
    // `if DIF_PRECO_PROD_FILHO_X_PAI <> 0 then CODGRUPOPRECO.Clear`. Confere no golden: 188 dos 189 filhos têm
    // codgrupopreco NULL. Sem isto, era possível gravar dif<>0 COM grupo de preço, o ramo A preservaria esse grupo
    // para sempre, e a propagação por grupo (mig 127/128) arrastaria o filho justo para o preço de que ele deveria
    // estar isento.
    if (dto.dif_preco_prod_filho_x_pai !== undefined && Number(dto.dif_preco_prod_filho_x_pai) !== 0) {
      out.codgrupopreco = null;
    }
    return out;
  },
  // F4 — regra do legado (chbATIVOClick): não desativar produto que é COMPONENTE de algum kit.
  // + MODO "GERAR LOTE" do preço (corte-2 do Ajuste de Preços): ver emitirLotesDePreco.
  validar: async ({ dto, id, db }) => {
    // MODO DO PREÇO (config HABILITA_GERACAO_LOTE_PRODUTO, fiel a UCadProduto.pas:6424): com 'S', a alteração de
    // preço/promo NÃO vai ao multi_preco — vai p/ a fila lote_preco (a tela de Ajuste de Preços aplica depois).
    // Roda aqui porque no UPDATE o `validar` recebe a TRANSAÇÃO e executa ANTES do delete+insert do detalhe — o
    // mesmo ponto em que o legado REVERTE o valor no dataset antes do post (UCadProduto.pas:3097-3115). Só em
    // UPDATE (fiel: `State <> usInserted`).
    if (id != null) await emitirLotesDePreco(dto, id, db);
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
        // ... e o PAINEL de precificação (mig 129), owned pela tela Precificação de Mercadorias. Fold auditoria
        // [ALTA]: sem preservar, um save do produto ZERAVA os 29 campos (componentes de custo E derivados) —
        // no golden 35k linhas têm ICME, 33k ICMST, 100k MARKUPFIXO. Mesma classe do fold do etq_impressa.
        'vrcustoreal', 'vrcustocsi', 'vrvendasug', 'pmz', 'markupfixo', 'icme', 'ipi', 'frete', 'frete2', 'seguro',
        'icmst', 'vrfcpst', 'despacessorio', 'vrcustoajuste', 'bonificacao', 'fcp_saida', 'creditoicm',
        'creditopiscofins', 'debitoicm', 'debitopiscofins', 'vendaliq', 'lucrobrutov', 'lucrobrutop', 'despopv',
        'lucroliqv', 'lucroliqp', 'imprend', 'contsocial', 'margeml2', 'margeml2v',
      ],
      chaveNatural: ['idempresa'],
      preservar: [
        'etq_impressa', 'dtultprecoalterado', 'codagenda',
        'vrcustoreal', 'vrcustocsi', 'vrvendasug', 'pmz', 'markupfixo', 'icme', 'ipi', 'frete', 'frete2', 'seguro',
        'icmst', 'vrfcpst', 'despacessorio', 'vrcustoajuste', 'bonificacao', 'fcp_saida', 'creditoicm',
        'creditopiscofins', 'debitoicm', 'debitopiscofins', 'vendaliq', 'lucrobrutov', 'lucrobrutop', 'despopv',
        'lucroliqv', 'lucroliqp', 'imprend', 'contsocial', 'margeml2', 'margeml2v',
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
