import { sql } from 'kysely';
import { produtoSchema, atualizarProdutoSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { validarGravacaoProduto } from './produto-gravar';
import { validarPermissoesDoProduto } from './produto-permissoes';
import { hashPaf, hashProduto } from '../shared/hash-paf';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { capturarAlteracaoProduto } from '../sped/sped-alteracoes';
import { prepararPrecoDaSessao, sincronizarPrecoNasLojas, incluirNasLojas, espalharTributosNaUf } from './produto-lojas';

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

/** a classificação fiscal que a linha de preço guarda por loja (o `cdsMulti_Preco_Update` da tela) */
const FISCAL_DA_LINHA = ['codfigurafiscal', 'idpiscofins', 'idtabela'] as const;

/** IS DISTINCT FROM (o gatilho do Apollo, mig 127/365): vazio × vazio é igual; número compara como número (o pg devolve '9.9000') */
const vazio = (v: unknown) => v === null || v === undefined || v === '';
function distinto(x: unknown, y: unknown): boolean {
  if (vazio(x) && vazio(y)) return false;
  if (vazio(x) || vazio(y)) return true;
  if (x instanceof Date || y instanceof Date) return new Date(x as string).getTime() !== new Date(y as string).getTime();
  const nx = Number(x);
  const ny = Number(y);
  if (Number.isFinite(nx) && Number.isFinite(ny)) return Math.abs(nx - ny) > 1e-9;
  return String(x).trim() !== String(y).trim();
}
/** os campos da receita que o gatilho RECEITA_PROD_HIST compara no UPDATE */
const RECEITA_HIST = ['qtde', 'valor', 'idproduto_receita', 'servico', 'unidade', 'fatorcxprod'] as const;
/** os campos do preço que pedem etiqueta nova (o gatilho ATUALIZAPROD) */
const PRECO_DA_ETIQUETA = ['vrvenda', 'vrpromo', 'promocao', 'atacarejo_ativo'] as const;
/** os carimbos do ATUALIZAPROD — não contam como "a linha mudou" */
const CARIMBOS_DO_PRECO = new Set(['etq_impressa', 'dtultprecoalterado', 'dtultimalteracao', 'hashpaf', 'id_multi_preco', 'idproduto', 'idempresa']);

export const produtoAggregateConfig: AggregateConfig = {
  tabela: 'produtos',
  pk: 'idproduto',
  view: 'get_produtos',
  rbacForm: 'FRMCADPRODUTO',
  // a LOG do form-base (uCadMaster.pas:485): o título da tela como a produção grava — o "Registro de log" a mostra
  log: { formulario: 'Cadastro de produtos' },
  colunas: [
    // identidade
    'codbarra', 'descricao', 'descricao_resumida', 'descricao_web', 'descricao_balanca',
    // unidade / fornecedor / classificação
    'codunidade', 'unidade', 'codfor', 'idmarca',
    'codgrupo', 'codsubgrupo', 'coddpto', 'codsecao', 'codgrupopreco',
    // config fiscal (armazenada; cálculo vive em precificacao)
    'ncmsh', 'cest', 'cest_obrigatorio', 'aliquota',
    // mig 278 — a classificação tributária da reforma (cClassTrib). Sem ela na lista o cadastro não
    // consegue classificar o produto, e **44.501 dos 47.729 produtos do cliente têm classificação**.
    // Não havia perda (o master faz UPDATE parcial, não DELETE+INSERT como os detalhes), mas o campo
    // ficava inalcançável pela tela — e é ele que liga o produto ao cálculo de IBS/CBS.
    'codclass_trib',
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
    // corte P1 do produto (25/09/2026) — o que a tela do legado preenche e o Apollo não gerenciava (o "Inseriu" da LOG de 2026 lista todos; o operador
    // altera RECEITAUNIDADE 302 vezes, TPDESCPRECO2 785, VRDESCPRECO2 527, PRODUTO_NOTAVEL 164, USO_CONSUMO 16…)
    'uso_consumo', 'visivel_rel', 'imprimircomp', 'pis', 'tipopis', 'gerar_m220_m620', 'tipo_item',
    'nao_atu_produtos_entrada', 'imprime_voucher', 'produto_voucher', 'tipo_produto', 'saida_expedicao', 'gluten',
    'produto_notavel', 'produto_ancora', 'decomposicao_livre', 'nao_decompor_saida', 'decomposicao_un', 'entrada_decomposta',
    'atualiza_multipreco_decomp', 'calculo_valor_custo_decomp', 'percentual_perdas', 'receitaunidade', 'apresentacao_etiqueta', 'dias_validade_minimo', 'fator_pedidocompra',
    'descmax', 'comissao', 'taraembalagem', 'especificacao', 'tpdescpreco2', 'vrdescpreco2', 'preco2dtini', 'preco2dtfim',
    'inteiramedida', 'partedec', 'usadamedida', 'conteudo_embalagem', 'unidade_apresentacao',
  ],
  // o NewRecord do produto (binário novo): o que o legado grava num produto novo quando a tela não mexe — medido no "Inseriu" de
  // 2026 (2.354 inclusões: VISIVEL_REL 'S', RECEITAUNIDADE 'KG', APRESENTACAO_ETIQUETA 1, TIPO_ITEM 0, PIS 'S', TIPOPIS 'N', as
  // demais 'N') — e o CODOPERADOR de quem cria (2.354 de 2.354). Só no create.
  derivarTrx: async ({ dto }) => {
    const padrao: Record<string, unknown> = {
      visivel_rel: 'S', saida_expedicao: 'N', nao_atu_produtos_entrada: 'N', imprime_voucher: 'N', tipo_produto: 'N', gluten: 'N',
      decomposicao_livre: 'N', nao_decompor_saida: 'N', receitaunidade: 'KG', apresentacao_etiqueta: 1, imprimircomp: 'N',
      tipo_item: 0, pis: 'S', tipopis: 'N',
    };
    const out: Record<string, unknown> = { codoperador: currentTenant().operadorId ?? null };
    for (const [k, v] of Object.entries(padrao)) if (dto[k] === undefined) out[k] = v;
    return out;
  },
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
  // + o preço da loja da sessão (modo lote/on-line): ver produto-lojas.ts.
  validar: async ({ dto, id, db }) => {
    // as permissões de CONTROLE (campos e botões com Tag 1 — produto-permissoes.ts), antes de a linha da sessão ser preparada
    await validarPermissoesDoProduto(dto, id ?? undefined, db);
    // A LINHA DA LOJA DA SESSÃO (produto-lojas.ts): o que mudou nela e, no modo lote (HABILITA_GERACAO_LOTE_PRODUTO,
    // resolvida com o escopo Módulo), a reversão do VRVENDA/PROMOCAO no dto — fiel a UCadProduto.pas:3087-3115. Só em UPDATE.
    if (id != null) await prepararPrecoDaSessao(dto, id, db);
    // o btnGravarClick (UCadProduto.pas:2608-3070): as validações provadas vivas e as derivações do gravar — produto-gravar.ts
    await validarGravacaoProduto(dto, id ?? undefined, db);
    // Produtos filhos (EdtProdutoPaiExit, pas:2843): o produto pai deve ser DIFERENTE do próprio produto.
    if (id != null && dto.idproduto_pai != null && Number(dto.idproduto_pai) === id) {
      throw new BusinessRuleError('PRODUTO_PAI_IGUAL_FILHO', { idproduto: id });
    }
    // DESATIVAR o componente de um kit (chbATIVOClick, UCadProduto.pas:4077-4104): só na TRANSIÇÃO S→N (`ATIVO.OldValue = 'S'`) e
    // contra a composição VIGENTE do kit (`GetSQLComposicao`, udmCadProduto.pas:3294 — a CHAVECOMPOSICAO do kit casa a da linha).
    // O Apollo testava todo PUT com ativo 'N': o produto já inativo que é componente não gravava nem para corrigir o NCM.
    if (id != null && dto.ativo === 'N') {
      const atual = (await sql<{ ativo: string | null }>`SELECT ativo FROM produtos WHERE idproduto = ${id}`.execute(db)).rows[0];
      if (String(atual?.ativo ?? '') === 'S') {
        const comp = (await sql<{ idproduto: number }>`SELECT c.idproduto FROM composicao c
            JOIN produtos pcomp ON pcomp.idproduto = c.idproduto AND pcomp.chavecomposicao IS NOT DISTINCT FROM c.chavecomposicao
           WHERE c.idproduto_01 = ${id} LIMIT 1`.execute(db)).rows[0];
        if (comp) throw new BusinessRuleError('PRODUTO_EM_COMPOSICAO', { idproduto: id });
      }
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
    // o registro 0205 do SPED: a descrição ou o código de barras mudou (UCadProduto.pas:3072 → RegistroSPEED0205).
    // No UPDATE o `validar` roda na transação do save — se a gravação falhar, a alteração não fica.
    if (id != null) await capturarAlteracaoProduto(db, id, dto);
  },
  // depois de gravar: a inclusão nas lojas (MULTI_PRECO/ESTOQUE/ESTOQUE_DEP de cada empresa) e, na alteração do preço,
  // o clone nas lojas do operador + o lote/update do grupo de preço e dos filhos (produto-lojas.ts)
  aposGravarTrx: async ({ trx, id, dto, criado }) => {
    if (criado) await incluirNasLojas(trx, id);
    else {
      await sincronizarPrecoNasLojas(trx, id, dto);
      await espalharTributosNaUf(trx, id);
    }
    // o HASHPAF do produto (o BeforePost da tela, a cada gravação — `hashProduto`), com os valores gravados
    const p = (await trx.selectFrom('produtos').select(['idproduto', 'codbarra', 'descricao', 'unidade', 'aliquota', 'ativo', 'ncmsh', 'cest'])
      .where('idproduto', '=', id).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (p) await trx.updateTable('produtos').set({ hashpaf: hashProduto(p as never) }).where('idproduto', '=', id).execute();
  },
  detalhes: [
    {
      tabela: 'codauxiliar',
      pk: 'chaveaux',
      fk: 'idproduto',
      chave: 'codauxiliares',
      chaveNatural: ['codauxiliar'],
      preservarNaoGerenciadas: true,
      colunas: ['codauxiliar', 'codbarra', 'fatoremb', 'codunidade', 'operacao', 'porcentagem_valor', 'dtcadastro', 'dtalteracao'],
      // a LOG do código auxiliar (binário novo): Inseriu com a tabela 'CODAUXILIAR ' (com o espaço — 40 de 40 em 2026), Alterou e Excluiu
      log: {
        tabela: 'CODAUXILIAR', tabelaInseriu: 'CODAUXILIAR ', chave: 'IDPRODUTO', excluiu: true,
        campos: ['chaveaux', 'codauxiliar', 'codbarra', 'fatoremb', 'idproduto', 'codunidade', 'operacao', 'porcentagem_valor', 'dtcadastro', 'dtalteracao'],
      },
      // o novo nasce com DTCADASTRO/DTALTERACAO = agora e PORCENTAGEM_VALOR 100 (o dado); o alterado ganha DTALTERACAO nova
      antesDeSubstituirTrx: async ({ trx, masterId }) =>
        new Map(((await trx.selectFrom('codauxiliar').select(['codauxiliar', 'codbarra', 'fatoremb', 'codunidade', 'operacao', 'porcentagem_valor', 'dtcadastro', 'dtalteracao']).where('idproduto', '=', masterId).execute()) as Array<Record<string, unknown>>)
          .map((r) => [String(r.codauxiliar), r])),
      derivarItensTrx: async (itens, trx, _emp, header, masterId, snapshot) => {
        const antes = (snapshot as Map<string, Record<string, unknown>> | undefined) ?? new Map();
        const agora = new Date().toISOString();
        // CODAUXILIAR.CODBARRA é o código PRINCIPAL do produto (1.147 de 1.147 iguais na produção): o gatilho UPDATE_CODAUXILIAR (mig 368)
        // o acompanha quando o produto troca de código, e o item regravado aqui leva o do produto — não o que a tela carregou antes
        const h = (header ?? {}) as Record<string, unknown>;
        const principal = !vazio(h.codbarra) ? h.codbarra
          : masterId != null ? ((await trx.selectFrom('produtos').select('codbarra').where('idproduto', '=', masterId).executeTakeFirst()) as { codbarra?: unknown } | undefined)?.codbarra : undefined;
        return itens.map((it) => {
          const a = antes.get(String(it.codauxiliar));
          const codbarra = principal ?? it.codbarra;
          if (!a) return { ...it, codbarra, dtcadastro: it.dtcadastro ?? agora, dtalteracao: agora, porcentagem_valor: it.porcentagem_valor ?? 100 };
          // o código principal acompanhando o produto não é alteração da linha (o gatilho do legado só troca o CODBARRA)
          // (numérico compara como número: a tela manda 6, o banco devolve '6.000' — por texto, todo gravar carimbava a linha)
          const mudou = ['fatoremb', 'codunidade', 'operacao'].some((c) => it[c] !== undefined && distinto(a[c], it[c]));
          // as colunas que a tela não manda ficam com o que a linha tinha
          const base = { ...it, codbarra, porcentagem_valor: it.porcentagem_valor ?? a.porcentagem_valor, dtcadastro: it.dtcadastro ?? a.dtcadastro, dtalteracao: it.dtalteracao ?? a.dtalteracao };
          return mudou ? { ...base, dtalteracao: agora } : base;
        });
      },
    },
    // mig 314 — a aba "Fornecedores desassociados" (TbsFornecedoresDesassociados, UCadProduto.pas:679/1830): os
    // fornecedores de quem o produto foi tirado; as importações de itens do pedido de compra o pulam para eles
    {
      tabela: 'produtos_forn_desassociados',
      pk: 'pfd_id',
      fk: 'idproduto',
      chave: 'fornecedores_desassociados',
      chaveNatural: ['codparceiro'],
      preservarNaoGerenciadas: true,
      colunas: ['codparceiro'],
      // o fornecedor repetido é ignorado, como o Locate do BtnAdicionar (UCadProduto.pas:1852) faz
      derivarItensTrx: async (itens) => {
        const vistos = new Set<number>();
        return itens.filter((it) => {
          const c = Number(it.codparceiro);
          if (vistos.has(c)) return false;
          vistos.add(c);
          return true;
        });
      },
    },
    // F2 — MULTI_PRECO: preço/custo POR EMPRESA, na MESMA form (detalhe 1:N do agregado).
    // PK surrogate id_multi_preco; idempresa é coluna (1 linha por empresa). O cálculo
    // custo→venda é REUSADO de POST /precificacao/produto (não reescrito aqui).
    {
      tabela: 'multi_preco',
      pk: 'id_multi_preco',
      fk: 'idproduto',
      chave: 'precos',
      // a LOG do preço (UCadProduto.pas:3079/3084): o registro corrente do `cdsMulti_Preco_Update` — a linha da LOJA DA SESSÃO —, na ordem
      // do dataset (2.727 Alterou e 1.179 Inseriu em 2026)
      log: {
        tabela: 'MULTI_PRECO', chave: 'IDPRODUTO',
        campos: [
          'idproduto', 'idempresa', 'vrcustoreal', 'vrcusto', 'markup', 'vrvenda', 'promocao', 'vrpromo', 'markupfixo', 'icme', 'frete', 'seguro',
          'despacessorio', 'icmst', 'ipi', 'frete2', 'margeml', 'creditoicm', 'creditopiscofins', 'debitoicm', 'debitopiscofins', 'vendaliq',
          'lucrobrutov', 'lucrobrutop', 'despopv', 'lucroliqv', 'lucroliqp', 'imprend', 'contsocial', 'margeml2v', 'margeml2', 'vrcustofiscal',
          'vrcustorep', 'pmz', 'vrcustocsi', 'bc_reduzida', 'ippt', 'hashpaf', 'ativo', 'ativo_compra', 'vrfcpst', 'vrcustoajuste', 'fcp_saida',
          'bonificacao', 'idpiscofins', 'idtabela', 'codfigurafiscal', 'tipopis', 'aliquotasaida',
        ],
        filtro: (l) => Number(l.idempresa) === Number(currentTenant().empresaId ?? -1),
      },
      // o HASHPAF (o `cdsMultiPrecoBeforePost`): recalculado na linha que a tela grava — nova ou com preço/custo mudado; a que não mudou
      // fica com o dela (o lote de preço deixa hash velho, e regravar o produto não o refaz se a tela não postou a linha)
      antesDeSubstituirTrx: async ({ trx, masterId }) =>
        new Map(((await trx.selectFrom('multi_preco').selectAll().where('idproduto', '=', masterId).execute()) as Array<Record<string, unknown>>)
          .map((r) => [Number(r.idempresa), r])),
      derivarItensTrx: async (itens, _trx, emp, header, masterId, snapshot) => {
        const antes = (snapshot as Map<number, Record<string, unknown>> | undefined) ?? new Map();
        const h = (header ?? {}) as Record<string, unknown>;
        return itens.map((it) => {
          const a = antes.get(Number(it.idempresa));
          const mudou = !a || Number(a.vrvenda ?? 0) !== Number(it.vrvenda ?? 0) || Number(a.vrcusto ?? 0) !== Number(it.vrcusto ?? 0);
          // a classificação fiscal da linha: a da loja da sessão espelha a do produto gravado (produção: IDPISCOFINS 578 de 579, a figura
          // 557 de 579 na loja 1); nas outras lojas fica a que a linha tinha
          const fiscal: Record<string, unknown> = {};
          for (const c of FISCAL_DA_LINHA) {
            const doProduto = Number(it.idempresa) === emp ? h[c] : undefined;
            fiscal[c] = doProduto !== undefined ? doProduto : it[c] !== undefined ? it[c] : a?.[c] ?? null;
          }
          // a ALÍQUOTA: no legado o combo do cadastro é a ALIQUOTASAIDA da linha da sessão (cmbALIQUOTA em dtsMulti_Preco) e PRODUTOS.ALIQUOTA
          // vem dela pelo gatilho ATUALIZATRIBUTOS — aqui o campo único é a alíquota do produto, e a linha da sessão a espelha
          if (Number(it.idempresa) === emp && !vazio(h.aliquota)) fiscal.aliquotasaida = h.aliquota;
          // o gatilho ATUALIZAPROD, que o delete+insert do detalhe não dispara como no legado: a linha NOVA nasce com a etiqueta a imprimir e
          // os dois carimbos; na que já existia, preço/promoção/atacarejo mudado pede etiqueta nova, e qualquer mudança carimba DTULTIMALTERACAO
          // (o legado só dá UPDATE nas linhas que a tela postou). O ramo INSERT não vai para o banco: 92.471 linhas da produção têm ETQ_IMPRESSA
          // nula, e o delete+insert pediria etiqueta de todas a cada gravação
          const novo = { ...it, ...fiscal };
          const agora = new Date();
          const carimbos: Record<string, unknown> = {};
          if (!a) {
            Object.assign(carimbos, { etq_impressa: 'N', dtultprecoalterado: agora, dtultimalteracao: agora });
          } else if (PRECO_DA_ETIQUETA.some((c) => novo[c] !== undefined && distinto(a[c], novo[c]))) {
            Object.assign(carimbos, { etq_impressa: 'N', dtultprecoalterado: agora, dtultimalteracao: agora });
          } else {
            const alterou = Object.keys(novo).some((c) => !CARIMBOS_DO_PRECO.has(c) && c in a && novo[c] !== undefined && distinto(a[c], novo[c]));
            carimbos.dtultimalteracao = alterou ? agora : (a.dtultimalteracao ?? null);
          }
          return { ...novo, ...carimbos, hashpaf: mudou ? hashPaf(masterId ?? it.idproduto, it.idempresa, it.vrvenda, it.vrcusto) : (a?.hashpaf ?? null) };
        });
      },
      // o que o cadastro não gerencia (idpiscofins/idtabela/figura fiscal por loja, custo fiscal) sobrevive ao save (lição 124)
      preservarNaoGerenciadas: true,
      colunas: [
        'idempresa', 'vrcusto', 'vrcustorep', 'markup', 'vrvenda', 'vrpromo',
        'promocao', 'margeml', 'aliquotasaida', 'ativo', 'ativo_compra', 'hashpaf',
        ...FISCAL_DA_LINHA,
        // OWNED pelo banco/outros módulos — entram em `colunas` APENAS p/ serem PRESERVADAS no substitute
        // (delete+insert), como o `qtde` do estoque. Fold auditoria: sem isso, todo save do produto ZERAVA
        // etq_impressa (a etiqueta perdia o "precisa reimprimir"), dtultprecoalterado e codagenda (quebrando o
        // reverter da agenda de promoção, que casa por codagenda).
        'etq_impressa', 'dtultprecoalterado', 'codagenda', 'dtultimalteracao',
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
      // idem: quantidade congelada/entrada/pedidos, datas da última entrada e venda (lição 124)
      preservarNaoGerenciadas: true,
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
      chaveNatural: ['idproduto_01'],
      // idem (lição 124)
      preservarNaoGerenciadas: true,
      colunas: ['idproduto_01', 'qtde', 'valor', 'descricao'],
    },
    {
      tabela: 'decomposicao',
      pk: 'coddecomp',
      fk: 'idproduto',
      chave: 'decomposicoes',
      chaveNatural: ['idproduto_01'],
      // idem: gera_scrap (lição 124)
      preservarNaoGerenciadas: true,
      colunas: ['idproduto_01', 'percentual'],
    },
    {
      tabela: 'receita_prod',
      pk: 'codreceita',
      fk: 'idproduto',
      chave: 'receitas',
      chaveNatural: ['idproduto_receita'],
      // idem (lição 124)
      preservarNaoGerenciadas: true,
      // o CODRECEITA não muda ao regravar (o legado atualiza no lugar: a linha 1086 do produto 832785 vive desde 2023) — o histórico o cita
      pkEstavel: true,
      colunas: ['idproduto_receita', 'qtde', 'valor', 'unidade', 'servico', 'fatorcxprod', 'usultalteracao', 'dtcadastro', 'dtultimalteracao'],
      antesDeSubstituirTrx: async ({ trx, masterId }) =>
        (await trx.selectFrom('receita_prod').selectAll().where('idproduto', '=', masterId).orderBy('codreceita').execute()) as Array<Record<string, unknown>>,
      // o que a tela carimba (produção: USULTALTERACAO nunca nulo, DTCADASTRO sempre): a linha nova nasce com o operador e DTCADASTRO; a
      // alterada ganha o operador e DTULTIMALTERACAO; a intocada fica como estava
      derivarItensTrx: async (itens, _trx, _emp, _header, _masterId, snapshot) => {
        const antigas = (snapshot as Array<Record<string, unknown>> | undefined) ?? [];
        const op = currentTenant().operadorId ?? null;
        const agora = new Date();
        const usadas = new Set<Record<string, unknown>>();
        return itens.map((it) => {
          let a = it.codreceita != null ? antigas.find((x) => Number(x.codreceita) === Number(it.codreceita) && !usadas.has(x)) : undefined;
          if (!a) a = antigas.find((x) => Number(x.idproduto_receita) === Number(it.idproduto_receita) && !usadas.has(x));
          if (a) usadas.add(a);
          if (!a) return { ...it, usultalteracao: op, dtcadastro: agora, dtultimalteracao: null };
          const mudou = RECEITA_HIST.some((c) => it[c] !== undefined && distinto(a![c], it[c]));
          return mudou
            ? { ...it, usultalteracao: op, dtcadastro: a.dtcadastro ?? null, dtultimalteracao: agora }
            : { ...it, usultalteracao: a.usultalteracao ?? null, dtcadastro: a.dtcadastro ?? null, dtultimalteracao: a.dtultimalteracao ?? null };
        });
      },
      // o gatilho RECEITA_PROD_HIST (BEFORE I/U/D em RECEITA_PROD): o histórico de modificações da receita (lido em "Histórico de modificações –
      // Receitas", UCadProduto.pas:3414) — 'I' da linha nova, 'D' da removida (com o usuário que a gravou por último), 'U' da que mudou num
      // dos campos (comparação `<>` do legado: de/para nulo não conta). No código, não no banco: o detalhe é regravado por delete+insert, e o
      // legado registra só o que mudou (na produção, cada gravação tem só os D/I dos componentes trocados)
      aposInserirItensTrx: async ({ trx, masterId, snapshot }) => {
        const antes = new Map(((snapshot as Array<Record<string, unknown>> | undefined) ?? []).map((r) => [Number(r.codreceita), r]));
        const depois = new Map(((await trx.selectFrom('receita_prod').selectAll().where('idproduto', '=', masterId).execute()) as Array<Record<string, unknown>>)
          .map((r) => [Number(r.codreceita), r]));
        const hist = (r: Record<string, unknown>, operacao: 'I' | 'U' | 'D') => ({
          codreceita: r.codreceita, idproduto: r.idproduto, qtde: r.qtde, valor: r.valor, idproduto_receita: r.idproduto_receita, servico: r.servico,
          unidade: r.unidade, fatorcxprod: r.fatorcxprod, fatorcxprod_util: r.fatorcxprod_util, dthistorico: sql`now()`, codusuario: r.usultalteracao ?? null, operacao,
        });
        const linhas: Array<Record<string, unknown>> = [];
        for (const [cod, d] of depois) {
          const a = antes.get(cod);
          if (!a) linhas.push(hist(d, 'I'));
          else if (['codreceita', 'idproduto', ...RECEITA_HIST, 'fatorcxprod_util'].some((c) => a[c] != null && d[c] != null && distinto(a[c], d[c]))) linhas.push(hist(d, 'U'));
        }
        for (const [cod, a] of antes) if (!depois.has(cod)) linhas.push(hist(a, 'D'));
        if (linhas.length) await trx.insertInto('receita_prod_hist').values(linhas).execute();
      },
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
