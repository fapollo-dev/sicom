import { sql } from 'kysely';
import { chaveDeEntrada, desregistrarProcessoNf, registrarProcessoNf } from '../shared/nf-status-processo';
import { gravarLog, type CampoLog } from '../../shared/log/registro-log';
import { nfSchema, atualizarNfSchema, totaisProdutosNf, totalProdutoItem } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { estornarVinculoRotativo } from './inventario-rotativo-nf';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { debitoPisCofins } from '../shared/piscofins-rentab';
import { assertPeriodoNaoFechado } from '../shared/periodo-contabil';
import { leitorCfopsDaSituacao } from './nf-cfop-situacao';
import { normalizarItensNf } from './nf-item-padrao';
import { estornarVinculoScrap } from './nf-scrap.service';
import { estornarVinculoVendas } from './nf-vendas.service';
import { estornarDevolucaoVendas } from './nf-devolucao-vendas.service';
import { preencherRateioContabil } from './nf-rateio';
import { totalNfLegado } from './nf-total';
import { recalcularMetricasEntrada } from './nf-custo-item';
import { contextoIndexadorNf, indexadorDoItem } from './nf-indexador-item';
import { TributacaoRepository } from '../precificacao/tributacao.repository';

/** o repositório da tributação sem a injeção (o agregado é configuração): toda consulta passa a transação */
const tributacaoSemDi = new TributacaoRepository(null as never);

/** a descrição do produto, lida uma vez por produto na gravação */
function leitorDescricaoProduto(trx: any): (idproduto: number) => Promise<string | null> {
  const cache = new Map<number, string | null>();
  return async (idproduto) => {
    if (!cache.has(idproduto)) {
      const r = (await trx.selectFrom('produtos').select('descricao').where('idproduto', '=', idproduto).executeTakeFirst()) as { descricao?: string | null } | undefined;
      cache.set(idproduto, r?.descricao ?? null);
    }
    return cache.get(idproduto) ?? null;
  };
}

/** as parcelas do TOTALNF que o formulário não calcula: vêm do dto ou, no PUT que não as traz, do banco (`validar` → `_totaisNota`) */
const NF_TOTAIS_DA_FORMULA = ['valorservico', 'totalvroutros', 'totaldescfinal', 'total_icmsdeson'] as const;
const NF_PARCELAS_DO_TOTAL = [...NF_TOTAIS_DA_FORMULA, 'totalfrete', 'totalseguro', 'totalacessorias', 'totalipi_devolucao', 'total_fcp_valor_st', 'complemento', 'tipo'] as const;

/** as colunas do retrato do produto no item da NF */
const RETRATO = ['ultcusto', 'ultcustorep', 'ultvenda', 'markup', 'vrcustoreal', 'idpiscofins'] as const;

/**
 * O RETRATO DO PRODUTO no item da NF — o que o diálogo do item copia da linha de preço da loja ao sair do código do produto
 * (`TfrmItensNF.edtCodProdExit`, uItensNF.pas:2553-2571 na inclusão de ENTRADA e :2724-2743 na edição, de qualquer tipo):
 *  - ULTCUSTO, ULTCUSTOREP e ULTVENDA = MULTI_PRECO.VRCUSTO, VRCUSTOREP e VRVENDA (o preço do produto FILHO quando o item tem um,
 *    `cdsProdutos`, udmNF.pas:6235);
 *  - MARKUP = MULTI_PRECO.MARKUP na inclusão; na edição, só se o item estava com 0 (:2724);
 *  - VRCUSTOREAL = o VRCUSTO do item na nota digitada (o fonte de 2020 põe o MULTI_PRECO.VRCUSTO, :2567, mas o dado de 2026 tem
 *    VRCUSTOREAL = VRCUSTO em 1.045 de 1.047 itens — inclusive os 46 em caixa); na importada é o vUnCom do XML;
 *  - IDPISCOFINS = PRODUTOS.IDPISCOFINS (binário novo, fora do fonte de 2020: 95,4% dos itens de 2026 iguais ao do produto).
 * A inclusão de SAÍDA não tira o retrato (o ramo 'Nota de Saida', :2607, não o faz); a edição pelo diálogo tira, de qualquer tipo —
 * na produção o ULTCUSTO muda em 62.534 "Alterou" de entrada (a análise do item) e 1.863 de saída. Fora disso fica o que o item tinha.
 */
export async function retratoDoProduto(
  trx: any, emp: number | null, it: Record<string, unknown>, antiga: Record<string, unknown> | undefined,
  cab: { tipo?: string | null; nf_importacao_nfe?: string | null } | undefined,
): Promise<Record<string, unknown>> {
  const importada = String(cab?.nf_importacao_nfe ?? '').toUpperCase() === 'S';
  // o que o item já tinha (NULL inclusive, o da carga); o item novo fica com o DEFAULT da coluna (0, mig 351)
  const manter: Record<string, unknown> = Object.fromEntries(RETRATO.map((c) => [c, antiga ? antiga[c] : undefined]));
  // na nota importada, o VRCUSTOREAL do item novo é o vUnCom do XML (NFe.pas:4023), que a importação manda
  if (importada && antiga == null && it.vrcustoreal != null) manter.vrcustoreal = it.vrcustoreal;
  const cod = it.codproduto != null ? Number(it.codproduto) : null;
  const tipo = String(cab?.tipo ?? '').toUpperCase();
  const tirar = cod != null && emp != null && ((antiga == null && tipo === 'E') || (antiga != null && it.dialogo === true));
  if (!tirar) return manter;
  const mp = (await trx.selectFrom('multi_preco').select(['vrcusto', 'vrcustorep', 'vrvenda', 'markup', 'vrcustoreal'])
    .where('idproduto', '=', cod).where('idempresa', '=', emp).executeTakeFirst()) as Record<string, unknown> | undefined;
  if (!mp) return manter;
  const filho = Number(it.idproduto_filho) > 0
    ? ((await trx.selectFrom('multi_preco').select('vrvenda').where('idproduto', '=', Number(it.idproduto_filho)).where('idempresa', '=', emp).executeTakeFirst()) as { vrvenda?: unknown } | undefined)
    : undefined;
  const prod = (await trx.selectFrom('produtos').select('idpiscofins').where('idproduto', '=', cod).executeTakeFirst()) as { idpiscofins?: unknown } | undefined;
  const markupAntigo = Number(antiga?.markup ?? 0);
  return {
    ultcusto: mp.vrcusto ?? 0,
    ultcustorep: mp.vrcustorep ?? 0,
    ultvenda: filho?.vrvenda ?? mp.vrvenda ?? 0,
    markup: antiga == null || markupAntigo === 0 ? mp.markup ?? 0 : antiga.markup,
    vrcustoreal: !importada && it.vrcusto != null ? it.vrcusto : manter.vrcustoreal,
    idpiscofins: prod?.idpiscofins ?? manter.idpiscofins,
  };
}

/**
 * NOTA FISCAL (tela-coroa) — Fase 1: NÚCLEO CADASTRO, agregado mestre-detalhe via
 * AggregateEngineService: master `nf` (empresaScoped) + detalhes `nf_prod` (itens) e
 * `nf_referencia`. A tela ARMAZENA o documento + config fiscal + status inicial.
 *
 * **NÃO dispara efeito algum** (estoque/financeiro/contábil/SEFAZ): no legado o estoque é
 * movido por TRIGGER Oracle no flip PROC 'N'->'S' e o financeiro/contábil/transmissão vivem
 * em telas/serviços externos (ver dossiê uNF.md §6/§8). F1 grava com PROC='N'/STATUSNFE vazio.
 * Esses efeitos são as fases F3..F6.
 *
 * - `empresaScoped`: a NF é por empresa (IDEMPRESA carimbado/filtrado pelo engine).
 * - `derivar`: F1 = btnCalcular — recomputa os totais a partir dos itens (Σ), SEM calcular
 *   imposto (apenas soma os valores já armazenados). Só atua quando o dto traz `itens`.
 * - `validar`: regras cross-row do btnGravar do legado — travas de estado (PROC/STATUSNFE/
 *   CONTABILIZADO bloqueiam edição) + duplicidade da chave fiscal (número + fornecedor).
 */

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/**
 * A LOG da NF ("Notas fiscais de entrada"/"Notas fiscais de saída" — ~225 mil linhas por ano em produção): o form-base do legado grava
 * o cabeçalho (NF) e cada item (NF_PROD, com a chave CODNF) — Inseriu com os campos preenchidos, Alterou com os que mudaram —,
 * na ordem do dataset (as listas vêm de linhas reais da LOG de produção, set/2026). Colunas do Apollo com outro nome: o total do
 * ICMS-ST externo (`total_icmst_externo`) e o IPI do item (`vripi`, o IPI_NOTA do legado).
 */
export const NF_CAMPOS_LOG: readonly CampoLog[] = [
  'codnf', 'protocolo_nfe', 'tipo', 'nronf', 'dtemissao', 'dtcontabil', 'dtchegada', 'codparceiro',
  'codparceiro_end', 'totalnf', 'totalfrete', 'totalicm', 'totalipi', 'totalacessorias', 'totalicm_st',
  'totalrepicm', 'totalvroutros', 'totalisento', 'totalprodst', 'totalbaseicm', 'totaldesc', 'totalbaseicmt',
  'totaloutrasdesp', 'totalseguro', 'totaldescfinal', 'totalprod', 'proc', 'cancelada', 'modelo', 'serie', 'cfop',
  'tipofrete', 'idempresa', 'qtdetransp', 'pesobruto', 'pesoliquido', 'totalfrete2', 'chavenfe', 'valorservico',
  'issqn', 'valorissqn', 'qtde', 'pis_nfe', 'cofins_nfe', 'taxa_importacao_nfe', 'stexterno', 'tipoemissao',
  'nf_importacao_nfe', 'sequencia_nfe', 'validatotalnf', 'idsituacao_nf', 'rateio', 'rateio_ipi', 'rateio_st',
  'tpemissao', 'complemento', 'finalidade', 'vtoticmsufdest', 'vtoticmsufremet', 'vtotfcpufdest',
  ['TOTALICM_STEXTERNO', 'total_icmst_externo'], 'totalbase_stexterno', 'totalbaseicmsrep', 'total_icms_uf_dest_bc',
  'total_fcp_bc', 'total_fcp', 'obs', 'total_streal', 'total_icms_nota_valor', 'total_icms_nota_bc',
  'icms_st_pago_fonte', 'icms_st_apagar', 'dthorasaida', 'fisco_emit_dar_valor', 'calculapeso',
  'totalicm_stexterno_sepnf', 'versaoxml', 'indicador_presenca', 'total_fcp_valor_st', 'total_fcp_valor_st_ret',
  'imp_importadormassa', 'imp_manifesto', 'total_icmsdeson', 'total_bonificado', 'total_ret_pis', 'total_ret_cofins',
  'total_ret_csll', 'total_ret_inss', 'total_ret_issqn', 'total_ret_funrural', 'total_ret_ir',
  'perc_aliquota_ret_pis', 'perc_aliquota_ret_cofins', 'perc_aliquota_ret_csll', 'perc_aliquota_ret_inss',
  'perc_aliquota_ret_ir', 'perc_aliquota_ret_issqn', 'perc_aliquota_ret_funrural', 'total_desc_acordo',
  'base_retencao_inss', 'alteraestoquereversao', 'totalipi_devolucao', 'rateio_ipi_devolucao', 'total_desc_pedido',
  'base_ret_irrf_piscofins_csll', 'nota_neutra', 'total_vrcfop_abatido', 'perc_aliquota_ret_senar',
  'total_ret_senar', 'abater_icms_deson', 'dtprocessamento',
];
export const NF_PROD_CAMPOS_LOG: readonly CampoLog[] = [
  'codnfprod', 'codnf', 'codproduto', 'codprodnota', 'descricao', 'unidade', 'vrcusto', 'vrcustoreal', 'markup',
  'vrvenda', 'quantidade', 'fatorembal', 'cfop', 'aliquota', 'ipi', 'icms', 'cst', 'vricm', 'icme', 'bcr',
  'depsacess', 'frete', 'seguro', 'vrpis', 'vrbasecalculo', 'vrbasest', 'vricmst', 'vroutrasdesp', 'beneficio',
  'geraicm_ipi', 'geraicm_acess', 'frete2', 'markupl', 'markupl2', 'geraicm_frete', 'creditoicm', 'creditopiscofins',
  'debitoicm', 'debitopiscofins', 'vendaliq', 'lucrobrutov', 'lucrobrutop', 'despopv', 'lucroliqv', 'lucroliqp',
  'imprend', 'contsocial', 'margeml2v', 'despextra', 'streal', 'ncm', 'custo_real_unit', 'aliqpise', 'aliqcofinse',
  'aliqpiss', 'aliqcofinss', 'arredonda', 'pis', 'nroitem', 'ultcusto', 'ultvenda', 'vrcustorep', 'pmz',
  'vrvendasug', 'vrcustocsi', 'origem_estoque', 'idsituacao_nf', 'bonificacao', 'desconto', 'geraestoque',
  'vrdescprod', 'cest', 'vicmsufdest', 'vicmsufremet', 'vfcpufdest', 'vricms_stexterno', 'vrbase_stexterno',
  'produc_peso_liq_exp', 'produc_peso_bruto_exp', 'fcp_aliquota', 'fcp_bc', 'icms_uf_dest_bc', 'icms_nota_valor',
  'icms_nota_bc', 'cfop_original', 'mva_ajustado', 'icms_aliq_nota', 'icms_st_aliq_nota', 'icms_red_bc_nota',
  'icms_st_red_bc_nota', 'total_produto_nota', 'qtd_nota', ['IPI_NOTA', 'vripi'], 'seguro_nota', 'frete_nota',
  'desconto_nota', 'outras_despesas_nota', 'cst_nota', 'vl_custo', 'vl_unitario', 'vricms_stexterno_separadonf',
  'fcp_aliquota_st', 'fcp_valor_st', 'fcp_bc_st', 'fcp_aliquota_st_ret', 'fcp_valor_st_ret', 'fcp_bc_st_ret',
  'vricms_desonerado', 'ind_deduz_deson', 'item_perda_total', 'atualiza_multipreco_decomp', 'vrcustoajustenf',
  'vrbasecalculoicm_calc', 'vricm_calc', 'vrajcustodec47530', 'ipi_devolucao', 'ipi_devolucao_perc_devol',
  'ipi_devolucao_nota', 'vrsaldoflex', 'vrcomissao', 'ultcustorep', 'mva', 'nroitem_venda', 'bcpiscofinse', 'vrpise',
  'vrcofinse', 'codoperador_lib_estoqueneg', 'usoconsumo',
];
/** os campos do `cdsFaturamento` (udmNF.dfm:7184), na ordem dele — TIPOREF/CODREF não estão no dataset */
export const FATURAMENTO_CAMPOS_LOG: readonly CampoLog[] = [
  'codfaturamento', 'data', 'idnf', 'modalidade', 'valor', 'liberado', 'obs', 'codoperador', 'nrofatura', 'totalparcelasfatura',
  'nronf', 'codbco', 'duplicata', 'valor_desconto', 'valor_bonificado', 'codbarrasboleto',
];

/**
 * o `cdsFaturamentoBeforePost` (udmNF.pas:4642): `TiraAcento(RetiraCaracterEspecial(CODBARRASBOLETO))`. O `RetiraCaracterEspecial`
 * está em FuncoesApollo (fora do fonte); aqui fica o que a linha digitável pode ter — letras, dígitos e espaço. Na produção a coluna
 * nunca foi preenchida (0 de 47 mil), então não há dado que contradiga.
 */
export const limparCodBarrasBoleto = (v: unknown): string | null => {
  if (v == null || String(v) === '') return (v as null) ?? null;
  return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 ]/g, '');
};

export const formularioDaNf = (nf: Record<string, unknown>): string => (String(nf.tipo ?? '').toUpperCase() === 'S' ? 'Notas fiscais de saída' : 'Notas fiscais de entrada');

export const nfAggregateConfig: AggregateConfig = {
  log: { formulario: 'Notas fiscais de entrada', formularioDe: formularioDaNf, tabela: 'NF', chave: 'CODNF', campos: NF_CAMPOS_LOG },
  tabela: 'nf',
  pk: 'codnf',
  view: 'get_nf',
  rbacForm: 'FRMNF',
  empresaScoped: true,
  colunas: [
    // identificação
    'tipo', 'modelo', 'nronf', 'serie', 'dtemissao', 'dtcontabil', 'dtchegada', 'dthorasaida',
    'tipoemissao', 'finalidade', 'cfop', 'idsituacao_nf', 'codparceiro', 'codparceiro_end',
    'indicador_presenca', 'versaoxml',
    // transporte / volumes
    'codtransp', 'codtransp_end', 'tipofrete', 'placatransp', 'ufplacatransp', 'especie',
    'marca', 'numerotransp', 'qtdetransp', 'pesobruto', 'pesoliquido',
    // totais (derivados server-side — F1 btnCalcular)
    'totalnf', 'totalprod', 'totaldesc', 'totalfrete', 'totalseguro', 'totalacessorias',
    'totalicm', 'totalbaseicm', 'totalipi', 'totalicm_st', 'totalisento',
    // mig 308: IPI DEVOLVIDO (entra no total da nota, udmNF.pas:5557) e os totais de FCP-ST — a NF de devolução os preenche
    'totalipi_devolucao', 'total_fcp_valor_st', 'total_fcp_valor_st_ret',
    // o resto da fórmula do TOTALNF (cdsNotaCalcFields) e o cabeçalho da nota importada (ImportaNFe): os totais "da nota", que não se
    // alteram, o controle do total (VALIDATOTALNF = vNF), a origem, os volumes e a NF avulsa do fisco
    ...NF_TOTAIS_DA_FORMULA, 'validatotalnf', 'totalbaseicmt', 'total_streal', 'totalbase_stexterno', 'total_icms_nota_valor',
    'total_icms_nota_bc', 'imp_importadormassa', 'imp_manifesto', 'rateio_ipi', 'rateio_st', 'qtde',
    'fisco_emit_orgao', 'fisco_emit_cnpj', 'fisco_emit_matr', 'fisco_emit_agente', 'fisco_emit_reparticao', 'fisco_emit_uf',
    'fisco_emit_fone', 'fisco_emit_dar_nro', 'fisco_emit_dar_valor', 'fisco_emit_dar_dtemis', 'fisco_emit_dar_dtpgto',
    // ST residual (corte-4c): TOTALICM_STEXTERNO/ICMS_ST_PAGO_FONTE são inputs de cabeçalho (F2/operador);
    // ICMS_ST_APAGAR é derivado (=max(0, externo−pago_fonte)) mas fica no allowlist p/ persistir o derivado.
    'total_icmst_externo', 'icms_st_pago_fonte', 'icms_st_apagar',
    // retenção federal (corte-4c-b): computadas pelo motor calcularRetencoes (nf-fiscal.recalcular, F2) e
    // reenviadas no dto → persistidas aqui p/ o F4 gerar os títulos. Mesmo modelo de confiança dos totais fiscais.
    'total_ret_pis', 'total_ret_cofins', 'total_ret_csll', 'total_ret_ir', 'total_ret_inss', 'total_ret_issqn',
    'total_ret_funrural', 'base_ret_irrf_piscofins_csll', 'base_retencao_inss',
    // resíduo (e): snapshot da alíquota de retenção por imposto (F2 grava, F4 lê p/ a OBS estável sob drift).
    'perc_aliquota_ret_pis', 'perc_aliquota_ret_cofins', 'perc_aliquota_ret_csll', 'perc_aliquota_ret_ir',
    'perc_aliquota_ret_inss', 'perc_aliquota_ret_issqn', 'perc_aliquota_ret_funrural',
    // estado (eixos A/B) — defaults; travas no validar
    'proc', 'statusnfe', 'cancelada', 'confirmada', 'contabilizado',
    // contrato NFe (vazio na F1)
    'chavenfe', 'protocolo_nfe', 'protocolo_cancelamento', 'xjust', 'sequencia_nfe', 'tpemissao',
    // flags
    'rateio', 'contribuinte_icms', 'aproveitamentocredito', 'alteraestoquereversao', 'codnf_ref',
    // a origem da nota: 'S' importada do XML (NFe.pas:3442), 'T' das inclusões de uNF.pas:7332/7543 — o RecebimentoService carimba
    'nf_importacao_nfe',
    // vínculo com o Pedido de Compra (recebimento) — carimbado pelo RecebimentoService no create; o front
    // da NF nunca o envia (não editável na tela), então um PUT normal não o altera.
    'codpedcomp',
    // vínculo com a DEVOLUÇÃO DE COMPRA (corte-2) — carimbado IN-ROW pelo DevolucaoCompraService no create;
    // UNIQUE parcial ux_nf_cod_ped_dev_compra é o backstop anti-duplo (23505 → DEVOLUCAO_NF_JA_EMITIDA).
    'cod_ped_dev_compra',
    // observações
    'obs', 'obsnf', 'complemento',
  ],
  // Totais do header por Σ dos itens (F1 btnCalcular; F2 inclui os totais fiscais). SÍNCRONO —
  // só SOMA valores já presentes no dto (o cálculo do imposto por item é async e vive no
  // NfFiscalService, via POST /fiscal/nf/recalcular). Só recalcula quando o dto traz os itens.
  derivar: (dto) => {
    // ST residual (corte-4c) — derivado dos campos de cabeçalho (independe dos itens). Fórmula verificada
    // 1:1 no golden (uNF.pas:4817): só quando TOTALICM_STEXTERNO>0. max(0,...) é DEFENSIVO — o legado subtrai
    // cru, mas o golden não tem NENHUM caso negativo (observacionalmente idêntico) e a coluna é nonnegative.
    // SÓ emite quando os inputs ST vierem no dto: um PUT parcial (só `obs`, p.ex.) NÃO deve zerar o
    // icms_st_apagar persistido (espelha o guard-por-`itens` dos demais totais).
    const rr2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const temStInputs = dto.total_icmst_externo !== undefined || dto.icms_st_pago_fonte !== undefined;
    const stExterno = num(dto.total_icmst_externo);
    const stPagoFonte = num(dto.icms_st_pago_fonte);
    const stOut: Record<string, unknown> = temStInputs
      ? { icms_st_apagar: stExterno > 0 ? Math.max(0, rr2(stExterno - stPagoFonte)) : 0 }
      : {};

    const itens = dto.itens;
    if (!Array.isArray(itens)) return stOut;
    // o VALOR DA LINHA é o VRCUSTO (o `CalcValorNota` do legado — `nf-valor.ts` do shared, provado contra a produção):
    // TOTALPROD = Σ quantidade × VRCUSTO (arredondado/truncado por item), TOTALDESC = Σ VRDESCPROD (dinheiro)
    const { totalprod, totaldesc } = totaisProdutosNf(itens as Record<string, unknown>[]);
    let totalipi = 0;
    let totalicm_st = 0;
    let totalicm = 0;
    let totalbaseicm = 0;
    let totalisento = 0;
    for (const it of itens as Record<string, unknown>[]) {
      totalipi += num(it.vripi); // F2: vripi é o VALOR (ipi virou a alíquota %)
      totalicm_st += num(it.vricmst);
      totalicm += num(it.vricm);
      totalbaseicm += num(it.vrbasecalculo);
      // golden/legado: isento é disparado pelo CÓDIGO DE ALÍQUOTA 'IST' (udmNF.pas:4169/4299),
      // não pelo CST. (CST 40/41 correlacionam mas não são idênticos a ALIQUOTA='IST'.)
      if (String(it.aliquota) === 'IST') totalisento += totalProdutoItem(it);
    }
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    // cada parcela: a do dto; senão a que a nota já tinha (o `validar` a lê do banco no PUT)
    const doBanco = (dto._totaisNota ?? {}) as Record<string, unknown>;
    const parcela = (k: string) => (dto[k] !== undefined ? dto[k] : doBanco[k]);
    const totalnf = totalNfLegado({ totalprod, totaldesc, totalipi, totalicm_st }, parcela);
    // o total de conferência: na SAÍDA o gravar copia o total da nota (uNF.pas:4688; 771 de 771 em 2026); na ENTRADA é o "Total NF" que
    // o operador informa (ou o vNF do XML) — fica o do dto
    const validaSaida = String(dto.tipo ?? (dto._totaisNota as Record<string, unknown> | undefined)?.tipo ?? '').toUpperCase() === 'S' ? { validatotalnf: totalnf } : {};
    return {
      totalprod: r2(totalprod),
      totaldesc: r2(totaldesc),
      totalipi: r2(totalipi),
      totalicm_st: r2(totalicm_st),
      totalicm: r2(totalicm),
      totalbaseicm: r2(totalbaseicm),
      totalisento: r2(totalisento),
      totalnf,
      ...validaSaida,
      ...stOut,
    };
  },
  // Regras cross-row do btnGravar (consultam o banco antes de gravar).
  validar: async ({ dto, id, db }) => {
    const emp = currentTenant().empresaId ?? null;
    // o item completo ANTES do derivar somar os totais: ARREDONDA padrão, VRVENDA nulo = 0, DESCONTO % do VRDESCPROD
    await normalizarItensNf(db, emp, dto.itens);
    // as parcelas do TOTALNF que o PUT não trouxe: as da nota gravada (o `derivar` é síncrono e não lê o banco)
    if (id != null && Array.isArray(dto.itens) && NF_PARCELAS_DO_TOTAL.some((k) => dto[k] === undefined)) {
      dto._totaisNota = (await db.selectFrom('nf').select([...NF_PARCELAS_DO_TOTAL]).where('codnf', '=', id).executeTakeFirst()) ?? {};
    }
    // a linha do rateio sem ADICIONAL: 'S' quando a situação é de bonificação — tem CFOP 1910/2910
    // (`SituacaoDeBonificacao`, uLancamentoContabilNF.pas:762, no Exit da situação)
    if (Array.isArray(dto.contabil)) {
      for (const l of dto.contabil as Array<Record<string, unknown>>) {
        if ((l.adicional === 'S' || l.adicional === 'N') || !(Number(l.idsituacao_nf) > 0)) continue;
        const bon = await db.selectFrom('isituacao_nf').select('idisituacao_nf').where('idsituacao_nf', '=', Number(l.idsituacao_nf))
          .where('codcfop', 'in', [1910, 2910]).executeTakeFirst();
        l.adicional = bon ? 'S' : 'N';
      }
    }

    // estado atual (update): travas de edição por estado + fallback dos campos da chave.
    // Espelha NotaEletronica/btnEditar do legado: NF processada/contabilizada/enviada/
    // cancelada é read-only (editar deixaria efeitos dessincronizados).
    let atual:
      | { proc?: string; statusnfe?: string; contabilizado?: string; cancelada?: string; nronf?: string; serie?: string; modelo?: number; tipoemissao?: string; codparceiro?: number; dtcontabil?: unknown; cfop?: unknown; idsituacao_nf?: unknown; tipo?: string }
      | undefined;
    if (id != null) {
      atual = (await db
        .selectFrom('nf')
        .select(['proc', 'statusnfe', 'contabilizado', 'cancelada', 'nronf', 'serie', 'modelo', 'tipoemissao', 'codparceiro', 'dtcontabil', 'cfop', 'idsituacao_nf', 'tipo'])
        .where('codnf', '=', id)
        .where('idempresa', '=', emp)
        .executeTakeFirst()) as typeof atual;
      if (atual) {
        if (atual.proc === 'S') throw new BusinessRuleError('NF_PROCESSADA');
        // ⚠️ SEM trava de faturada: `btnEditarClick` (uNF.pas:3905-4004) só barra contabilizada, processada e dia fechado — com o
        // financeiro gerado ele só desabilita o "Gerar financeiro". É o fluxo diário: a NF importada já nasce com o A Pagar e o
        // operador ajusta antes de processar (4.436 edições em 2025, 5.816 em 2026 — auditoria g1 #2)
        if (atual.contabilizado === 'S') throw new BusinessRuleError('NF_CONTABILIZADA');
        if (atual.cancelada === 'S' || atual.statusnfe === 'C') throw new BusinessRuleError('NF_CANCELADA');
        if (atual.statusnfe === 'P' || atual.statusnfe === 'D') throw new BusinessRuleError('NF_ENVIADA');
      }
    }

    // o TOTAL NF da entrada (o "Total NF" que o operador confere com a nota em papel — uNF.pas:4644-4652): sem ele o gravar não segue
    // (nunca 0 nas 6.522 notas de entrada de 2026). A nota que um serviço cria como rascunho (o receber pedido) é conferida depois, na tela
    if (String(dto.tipo ?? atual?.tipo ?? '').toUpperCase() === 'E' && dto._origemServico !== true) {
      const informado = dto.validatotalnf !== undefined ? dto.validatotalnf
        : id != null ? ((await db.selectFrom('nf').select('validatotalnf').where('codnf', '=', id).executeTakeFirst()) as { validatotalnf?: unknown } | undefined)?.validatotalnf : undefined;
      if (!(Math.abs(num(informado)) > 0)) throw new BusinessRuleError('NF_TOTAL_NF_OBRIGATORIO');
    }

    // período contábil FECHADO (BLOQ_NF, uNF.pas:4565 ValidaPeriodoFechado) barra gravar/editar a NF na DTCONTABIL —
    // reusa o gate do bucket-A. Barra pela data GRAVADA (abrir a edição) E pela nova (salvar), como AR/AP.
    if (emp != null) {
      if (atual?.dtcontabil != null) await assertPeriodoNaoFechado(db, emp, atual.dtcontabil, 'bloq_nf');
      if (dto.dtcontabil != null) await assertPeriodoNaoFechado(db, emp, dto.dtcontabil, 'bloq_nf');
    }

    // duplicidade da chave fiscal — tupla de identidade confirmada no golden (V$SQL real):
    // (IDEMPRESA, CODPARCEIRO, MODELO, SERIE, NRONF, TIPOEMISSAO). NÃO inclui TIPO (E/S): o
    // legado não usa o tipo na chave (uNF.pas:4735/4761). USA TIPOEMISSAO (própria '0' / terceiros '1').
    const nronf = (dto.nronf ?? atual?.nronf) as string | number | undefined;
    if (nronf != null && String(nronf).trim() !== '') {
      const serie = (dto.serie ?? atual?.serie ?? null) as string | null;
      const modelo = (dto.modelo ?? atual?.modelo ?? null) as number | null;
      // default '0' (própria) quando ausente — espelha o DEFAULT da coluna nf.tipoemissao, que é o
      // valor que SERÁ inserido; o validar roda no dto (antes do insert) e precisa casar com ele.
      const tipoemissao = (dto.tipoemissao ?? atual?.tipoemissao ?? '0') as string | null;
      const codparceiro = (dto.codparceiro ?? atual?.codparceiro ?? null) as number | null;
      let q = db
        .selectFrom('nf')
        .select('codnf')
        .where('nronf', '=', String(nronf))
        .where('idempresa', '=', emp)
        .where('codparceiro', '=', codparceiro);
      q = serie == null ? q.where('serie', 'is', null) : q.where('serie', '=', serie);
      q = modelo == null ? q.where('modelo', 'is', null) : q.where('modelo', '=', modelo);
      q = tipoemissao == null ? q.where('tipoemissao', 'is', null) : q.where('tipoemissao', '=', tipoemissao);
      if (id != null) q = q.where('codnf', '<>', id);
      const dup = await q.executeTakeFirst();
      if (dup) throw new BusinessRuleError('NF_DUPLICADA');
    }

    // CFOP × SITUAÇÃO (`validaCFOP_SituacaoNF`, udmNF.pas:7900; UCadSituacaoNF.md C2): com situação na NF, o CFOP do
    // cabeçalho tem de estar entre os CFOPs dela (btnGravar, uNF.pas:4543) — situação sem CFOP nenhum recusa qualquer
    // CFOP, como o Locate do legado. No gravar, o ITEM só é cobrado na ENTRADA e quando passou pelo diálogo (digitado
    // ou com o CFOP alterado — o OK do diálogo, uItensNF.pas:1525, fica dentro do `if TIPO = 'E'`); a nota inteira é
    // cobrada no PROCESSAMENTO (`nf-cfop-situacao.ts`). O item de SAÍDA não é cobrado no diálogo: lá a regra é a base
    // de cálculo acima de 100% (C6, abaixo).
    const sitNf = Number(dto.idsituacao_nf ?? atual?.idsituacao_nf ?? 0);
    const tipoNf = String(dto.tipo ?? atual?.tipo ?? '');
    if (sitNf > 0) {
      const cfopNf = dto.cfop ?? atual?.cfop;
      if (cfopNf != null && cfopNf !== '' && !(await leitorCfopsDaSituacao(db)(sitNf)).has(Number(cfopNf))) {
        throw new BusinessRuleError('NF_CFOP_SITUACAO', { cfop: Number(cfopNf), idsituacao_nf: sitNf });
      }
    }
    if (Array.isArray(dto.itens) && (sitNf > 0 || tipoNf === 'S')) {
      // o item já gravado, casado pelo produto na ordem (como o motor casa): dá a situação própria do item (701 linhas
      // da produção diferem do cabeçalho) e diz o que mudou
      const antigos = new Map<string, Array<{ cfop: unknown; idsituacao_nf: unknown; bcr: unknown }>>();
      if (id != null) {
        for (const r of (await db.selectFrom('nf_prod').select(['codproduto', 'cfop', 'idsituacao_nf', 'bcr']).where('codnf', '=', id).orderBy('codnfprod').execute()) as Array<{ codproduto: unknown; cfop: unknown; idsituacao_nf: unknown; bcr: unknown }>) {
          const k = String(r.codproduto);
          antigos.set(k, [...(antigos.get(k) ?? []), r]);
        }
      }
      const cfopsDe = leitorCfopsDaSituacao(db);
      let permiteBcr: boolean | null = null;
      for (const it of dto.itens as Array<Record<string, unknown>>) {
        const par = antigos.get(String(it.codproduto))?.shift();
        // o item que veio de importação (scrap, rotativo, XML) não passou pelo diálogo
        if (it.importado_de) continue;
        if (tipoNf === 'E' && sitNf > 0 && it.cfop != null && it.cfop !== '' && (!par || Number(par.cfop) !== Number(it.cfop))) {
          const sitIt = [it.idsituacao_nf, par?.idsituacao_nf].map(Number).find((s) => s > 0) ?? sitNf;
          if (!(await cfopsDe(sitIt)).has(Number(it.cfop))) {
            throw new BusinessRuleError('NF_ITEM_CFOP_SITUACAO', { cfop: Number(it.cfop), idsituacao_nf: sitIt, codproduto: it.codproduto });
          }
        }
        // C6 — BASE DE CÁLCULO ACIMA DE 100% na SAÍDA (uItensNF.pas:1561): só com `PERMITE_BASECALC_MAIOR100='S'` na
        // situação da nota (`PermiteBaseDeCalcMaior100`, udmNF.pas:11593); cobrada no item digitado ou com o BCR alterado
        if (tipoNf === 'S' && Number(it.bcr ?? 0) > 100 && (!par || Number(par.bcr ?? 0) !== Number(it.bcr))) {
          if (permiteBcr == null) {
            const s0 = sitNf > 0 ? ((await db.selectFrom('situacao_nf').select('permite_basecalc_maior100').where('idsituacao_nf', '=', sitNf).executeTakeFirst()) as { permite_basecalc_maior100?: string } | undefined) : undefined;
            permiteBcr = String(s0?.permite_basecalc_maior100 ?? '') === 'S';
          }
          if (!permiteBcr) throw new BusinessRuleError('NF_BCR_MAIOR_100', { bcr: Number(it.bcr), codproduto: it.codproduto, idsituacao_nf: sitNf });
        }
      }
    }
  },
  // a SITUAÇÃO DO ITEM (UCadSituacaoNF.md C2): o item entra com a situação do cabeçalho (uNF.pas:1594, 5724, 13699,
  // 16043) — 99,5% dos itens de 2026. O item que já tinha a sua (701 linhas da produção diferem do cabeçalho) mantém:
  // a coluna não é gerenciada pelo formulário, então o motor a preserva, e aqui só se preenche a que falta.
  aposGravarTrx: async ({ trx, id, emp }) => {
    await sql`
      UPDATE nf_prod p SET idsituacao_nf = n.idsituacao_nf
        FROM nf n
       WHERE n.codnf = ${id} AND p.codnf = n.codnf AND p.idsituacao_nf IS NULL AND n.idsituacao_nf IS NOT NULL`.execute(trx);
    // o rateio contábil que o gravar do legado preenche sozinho (InserirLancamentosContabil; UCadSituacaoNF.md C3)
    await preencherRateioContabil(trx, id, emp ?? null);
    // a análise do item de entrada (custo real, reposição, CSI, PMZ, venda sugerida e a escada) e o ICMS calculado de todos os itens
    await recalcularMetricasEntrada(trx, id, 'pendentes');
    // a ESTEIRA: gravar a nota de ENTRADA com os itens repassados (ligados a produto) marca stRepasseItens (uNF.pas:5171-5181)
    const chave = await chaveDeEntrada(trx, id);
    if (chave && emp != null) {
      // o item REPASSADO (uNF.pas:4978, :5171-5181) — o proxy `codproduto > 0` marcava ~106 NFs a mais (recon do indexador, C4)
      const rep = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM nf_prod WHERE codnf = ${id} AND repassado = 'S'`.execute(trx)).rows[0];
      if (Number(rep?.n) > 0) await registrarProcessoNf(trx, 'stRepasseItens', chave, emp, currentTenant().operadorId ?? null);
    }
  },
  // Guarda de EXCLUSÃO (btnExcluir do legado, uNF.pas:4072): não apagar NF com efeitos — apagar deixaria
  // estoque movido e títulos órfãos. Exige reverter (F3) / estornar (F4) antes.
  //   • Travas de estado (proc/contabilizada/enviada/cancelada + o título existente) — uNF:4080/4085/4109 → abaixo.
  //   • Referenciada por OUTRA NF (devolução/complemento apontam p/ esta) — uNF:4145 → abaixo (F5b, tabela existe).
  //   • "Numeração gerada" (uNF:4099: NRONF≠'000000' AND STATUSNFE not null) → já coberto pelas travas de
  //     statusnfe P/C/D abaixo (própria numerada+transmitida cai nelas; própria numerada SEM status é rascunho
  //     e pode ser apagada — o MAX+1 da renumeração só abre lacuna, sem quebra de integridade).
  //   • Devolução de COMPRA emitida (uNF:4176, PEDIDO_DEVOLUCAO_COMPRA_ITENS) → módulo de compras não migrado
  //     (dossiê §10 "verificar NF com pedido de compra"): re-avaliar quando o módulo entrar.
  validarRemocao: async ({ id, db }) => {
    const emp = currentTenant().empresaId ?? null;
    const nf = (await db
      .selectFrom('nf')
      .select(['proc', 'contabilizado', 'statusnfe', 'cancelada', 'dtcontabil'])
      .where('codnf', '=', id)
      .where('idempresa', '=', emp)
      .executeTakeFirst()) as
      | { proc?: string; contabilizado?: string; statusnfe?: string; cancelada?: string; dtcontabil?: unknown }
      | undefined;
    if (!nf) return; // not-found é tratado pelo fluxo normal
    if (nf.proc === 'S') throw new BusinessRuleError('NF_PROCESSADA'); // reverter o processamento antes
    // o financeiro barra pela EXISTÊNCIA do título (btnExcluirClick, uNF.pas:4105-4121), não pelo flag: primeiro o baixado, depois qualquer um.
    // A parcela pendente (FATURAMENTO) não barra — sai junto com a nota (o detalhe).
    const fin = (await sql<{ baixa: boolean; titulo: boolean }>`SELECT
        EXISTS (SELECT 1 FROM apagar_bx b WHERE coalesce(b.indr, 'I') = 'I' AND b.codapg IN (SELECT codapg FROM apagar WHERE idnf = ${id}))
        OR EXISTS (SELECT 1 FROM areceber_bx b WHERE coalesce(b.indr, 'I') = 'I' AND b.codrcb IN (SELECT codrcb FROM areceber WHERE idnf = ${id}))
        OR EXISTS (SELECT 1 FROM apagar WHERE idnf = ${id} AND (coalesce(agrupado, 'N') = 'S' OR coalesce(quitada, 'N') = 'S' OR coalesce(contabilizado, 'N') = 'S'))
        OR EXISTS (SELECT 1 FROM areceber WHERE idnf = ${id} AND (coalesce(agrupado, 'N') = 'S' OR coalesce(quitada, 'N') = 'S' OR coalesce(contabilizado, 'N') = 'S')) AS baixa,
        EXISTS (SELECT 1 FROM apagar WHERE idnf = ${id}) OR EXISTS (SELECT 1 FROM areceber WHERE idnf = ${id}) AS titulo`.execute(db)).rows[0];
    if (fin?.baixa) throw new BusinessRuleError('NF_EXCLUSAO_FINANCEIRO_BAIXADO', { codnf: id });
    if (fin?.titulo) throw new BusinessRuleError('NF_EXCLUSAO_TEM_FINANCEIRO', { codnf: id });
    if (nf.contabilizado === 'S') throw new BusinessRuleError('NF_CONTABILIZADA');
    if (nf.cancelada === 'S' || nf.statusnfe === 'C') throw new BusinessRuleError('NF_CANCELADA');
    if (nf.statusnfe === 'P' || nf.statusnfe === 'D') throw new BusinessRuleError('NF_ENVIADA');
    if (emp != null && nf.dtcontabil != null) await assertPeriodoNaoFechado(db, emp, nf.dtcontabil, 'bloq_nf'); // não excluir NF de período fechado
    // referenciada por OUTRA NF via nf_referencia.codnf_ref (uNF.pas:4145: EXISTS NF_REFERENCIA CODNF_REF=:nf
    // com a nota-origem MODELO<>65). Apagar romperia a cadeia devolução/complemento (ponteiro órfão).
    const ref = await db
      .selectFrom('nf_referencia as r')
      .innerJoin('nf as n', 'n.codnf', 'r.codnf')
      .select('r.codnfreferencia')
      .where('r.codnf_ref', '=', id)
      .where('n.idempresa', '=', emp)
      .where(sql`coalesce(n.modelo, 0)`, '<>', 65)
      .executeTakeFirst();
    if (ref) throw new BusinessRuleError('NF_REFERENCIADA');
  },
  // EXCLUIR a nota desfaz o carimbo das pontes do inventário rotativo, como o legado faz sob `taExcluir`
  // (udmNF.pas:3406-3463) — mesma rotina do cancelamento, para não deixar lote preso a uma nota que sumiu.
  aoRemover: async ({ id, db }) => {
    const emp = currentTenant().empresaId ?? null;
    if (emp == null) return;
    const nf = (await db.selectFrom('nf').select('tipo').where('codnf', '=', id).where('idempresa', '=', emp).executeTakeFirst()) as { tipo?: string } | undefined;
    if (!nf) return;
    await estornarVinculoRotativo(db, id, nf.tipo ?? null, emp);
    // os cupons da NF de cupom voltam a "não importado" (AtualizaStatusCupomFiscal) — antes de a PEDIDO_NF sair
    await estornarVinculoVendas(db, id, nf.tipo ?? null);
    // o scrap importado nesta nota volta a "não importado" e a PEDIDO_NF da nota sai (udmNF.pas:3217; uNF.pas:4216)
    await estornarVinculoScrap(db, id, nf.tipo ?? null, true);
    // a devolução de vendas importada nesta nota volta a "não importada" (RemoveRefCuponsDevolucao, uNF.pas:4287)
    await estornarDevolucaoVendas(db, id, emp);
  },
  detalhes: [
    {
      tabela: 'nf_prod',
      pk: 'codnfprod',
      fk: 'codnf',
      chave: 'itens',
      log: { tabela: 'NF_PROD', chave: 'CODNF', campos: NF_PROD_CAMPOS_LOG },
      // 59 das 113 colunas do item não passam pela tela (os valores DA NOTA do fornecedor — base/ICMS/ST/IPI/frete
      // destacados, que a devolução devolve —, FCP-ST, ICMS desonerado, custo real, o que a coleta gravou…): salvar a
      // NF as apagaria. O motor as mantém, casando o item pelo produto (lição 124)
      chaveNatural: ['codproduto'],
      preservarNaoGerenciadas: true,
      colunas: [
        'nroitem', 'codproduto', 'idproduto_filho', 'nroitem_venda', 'codprodnota', 'quantidade', 'fatorembal', 'unidade',
        'geraestoque', 'movimenta_estoque',
        'vrvenda', 'vrcusto', 'desconto', 'vrdescprod', 'bonificacao',
        'cfop', 'ncm', 'cest', 'origem_estoque', 'aliquota', 'icms', 'cst', 'csosn',
        'bcr', 'vrbasecalculo', 'vricm', 'icme', 'mva', 'vrbasest', 'vricmst', 'streal',
        'ipi', 'vripi', 'geraicm_ipi', 'geraicm_frete', 'geraicm_acess',
        'fcp_aliquota', 'fcp_valor', 'pis', 'cstpiscofins',
        'aliqpise', 'aliqpiss', 'aliqcofinse', 'aliqcofinss',
        'debitopiscofins', // Wave 5: débito projetado de saída = round((aliqpiss+aliqcofinss)×vrvenda/100,2) — rentabilidade
        'frete', 'seguro', 'vroutrasdesp', 'depsacess', 'arredonda', 'vl_custo', 'descricao',
        // o RETRATO DO PRODUTO no item (derivado no servidor — `retratoDoProduto`): o que o cliente mandar é ignorado
        'ultcusto', 'ultcustorep', 'ultvenda', 'markup', 'vrcustoreal', 'idpiscofins',
        'vl_unitario', // o custo da unidade (VRCUSTO / FATOREMBAL), refeito a cada gravação como o legado (uNF.pas:4935)
        // a ANÁLISE do item (o OK do diálogo): 0 no item novo ou editado no diálogo = pendente; o aposGravarTrx recalcula o custo e a escada
        'custo_real_unit',
        // o INDEXADOR e o REPASSE do item de entrada (`indexadorDoItem`) — derivados no servidor
        'indexadortrib', 'repassado', 'mva_ajustado',
      ],
      // a DESCRIÇÃO que cada item tinha, para o item regravado sem ela (casada pelo produto, como a preservação)
      antesDeSubstituirTrx: async ({ trx, masterId }) =>
        trx.selectFrom('nf_prod').select(['codproduto', 'descricao', 'custo_real_unit', 'indexadortrib', 'repassado', 'mva_ajustado', ...RETRATO]).where('codnf', '=', masterId).orderBy('codnfprod').execute(),
      // congela o CUSTO do item = MULTI_PRECO.VRCUSTO corrente por (produto, empresa) no lançamento
      // (GetCustoProduto, udmNF.pas:12057). É a base do CMV; snapshot (não acompanha a deriva do MP).
      derivarItensTrx: async (itens, trx, emp, _header, _masterId, snapshot) => {
        const out: Record<string, unknown>[] = [];
        const antigas = new Map<string, Array<Record<string, unknown>>>();
        for (const a of (snapshot as Array<Record<string, unknown>> | undefined) ?? []) {
          const k = String(a.codproduto);
          antigas.set(k, [...(antigas.get(k) ?? []), a]);
        }
        const descricaoDoProduto = await leitorDescricaoProduto(trx);
        const cab = (await trx.selectFrom('nf').select(['tipo', 'nf_importacao_nfe']).where('codnf', '=', _masterId).executeTakeFirst()) as
          { tipo?: string | null; nf_importacao_nfe?: string | null } | undefined;
        const ctxIdx = String(cab?.tipo ?? '').toUpperCase() === 'E' ? await contextoIndexadorNf(trx, Number(_masterId)) : null;
        for (const it of itens) {
          const cod = it.codproduto != null ? Number(it.codproduto) : null;
          let vl = 0;
          if (cod != null && emp != null) {
            const mp = await trx
              .selectFrom('multi_preco')
              .select('vrcusto')
              .where('idproduto', '=', cod)
              .where('idempresa', '=', emp)
              .executeTakeFirst();
            vl = mp?.vrcusto != null ? Number(mp.vrcusto) : 0;
          }
          // Wave 5: PIS/COFINS débito projetado de saída (rentabilidade) das alíquotas de saída do próprio item.
          // a DESCRIÇÃO do item (NF_PROD.DESCRICAO): a que veio (a da origem — pedido, cupom, scrap — ou a digitada com
          // EDITAR_DESCRICAO_ITEM_NF='S'); senão a que o item já tinha; senão a do produto, que é o que o legado põe ao
          // escolher o produto (uItensNF.pas:2531) — na produção, 6.372 de 6.391 itens de set/2026 têm a do produto
          const antiga = antigas.get(String(cod))?.shift();
          const veio = typeof it.descricao === 'string' && it.descricao.trim() !== '' ? it.descricao : null;
          const descricao = veio ?? (String(antiga?.descricao ?? '') || null) ?? (cod != null ? await descricaoDoProduto(cod) : null);
          const retrato = await retratoDoProduto(trx, emp, it, antiga, cab);
          const fator = Number(it.fatorembal) > 0 ? Number(it.fatorembal) : 1;
          const vlUnitario = it.vrcusto != null ? Math.round((Number(it.vrcusto) / fator) * 1e4) / 1e4 : undefined;
          // o item de entrada que chega pelo diálogo (ou é novo) volta para a análise; o outro mantém a que tinha
          const analisar = String(cab?.tipo ?? '').toUpperCase() === 'E' && (antiga == null || it.dialogo === true);
          const custoReal = analisar ? 0 : antiga ? antiga.custo_real_unit : undefined;
          // o indexador: o item NOVO de entrada o consulta (a escolha do produto no diálogo / a análise da importação); o OK do diálogo de
          // um item existente refaz só o REPASSADO (o operador pode ter ajustado CST/alíquota); o resto fica o que o item tinha
          let idx: Record<string, unknown> = antiga ? { indexadortrib: antiga.indexadortrib, repassado: antiga.repassado, mva_ajustado: antiga.mva_ajustado } : {};
          if (ctxIdx && cod != null && antiga == null) idx = await indexadorDoItem(trx, ctxIdx, it, tributacaoSemDi);
          else if (ctxIdx && antiga != null && it.dialogo === true) {
            const livre = ctxIdx.figuraFiscal === 'D' || ctxIdx.liberada;
            idx.repassado = livre ? 'S' : Number(antiga.indexadortrib ?? 0) > 0 || ctxIdx.fornecedorLivre || ctxIdx.finalidade === '4' ? 'S' : ctxIdx.figuraFiscal === 'O' ? 'N' : 'S';
          }
          out.push({ ...it, ...idx, custo_real_unit: custoReal, vl_unitario: vlUnitario, vl_custo: vl, debitopiscofins: debitoPisCofins(it.vrvenda, it.aliqpiss, it.aliqcofinss), descricao: descricao?.slice(0, 120) ?? null, ...retrato });
        }
        return out;
      },
      // o OK do diálogo do item (`TfrmItensNF.GravaLog`, uItensNF.pas:4058): a descrição do item diferente da do produto vai à LOG,
      // a cada confirmação — "Usuario alterou descricao do item <NROITEM> (<a do produto>) para <A DO ITEM>". O legado passa o
      // CODOPERADOR na posição da empresa, e é o que a LOG guarda (142 de 142 em 2025-26).
      aposInserirItensTrx: async ({ trx, itens }) => {
        const descricaoDoProduto = await leitorDescricaoProduto(trx);
        for (const it of itens) {
          if (it.dialogo !== true || it.codproduto == null) continue;
          const doProduto = (await descricaoDoProduto(Number(it.codproduto))) ?? '';
          const doItem = String(it.descricao ?? '');
          if (doItem.trim().toUpperCase() === doProduto.trim().toUpperCase()) continue;
          await gravarLog(trx, {
            acao: 'Alterou', formulario: 'Itens da nota fiscal', tabela: 'NF_PROD', chave: 'CODNFPROD', valor: Number(it.codnfprod),
            historico: `Usuario alterou descricao do item ${it.nroitem ?? ''} (${doProduto}) para ${doItem.toUpperCase()}`,
            idempresa: currentTenant().operadorId ?? null,
          });
        }
      },
    },
    {
      tabela: 'nf_referencia',
      pk: 'codnfreferencia',
      fk: 'codnf',
      chaveNatural: ['codnf_ref'],
      // "todos os campos" (mig 310): o que o cadastro não gerencia sobrevive ao save (lição 124)
      preservarNaoGerenciadas: true,
      chave: 'referencias',
      colunas: ['codnf_ref', 'chave_ref', 'valor_ref', 'modelo', 'chavenfe'],
    },
    // F5 — rateio contábil (CODCONTABILNF): config armazenada na transação do agregado (sem efeito).
    // codcc = PLC (centro de custo gerencial). Soma = TOTALNF é validada no schema (validaRateioContabil).
    {
      tabela: 'nf_contabil',
      pk: 'codcontabilnf',
      fk: 'codnf',
      chaveNatural: ['idsituacao_nf', 'codcc'],
      // "todos os campos" (mig 310): o que o cadastro não gerencia sobrevive ao save (lição 124)
      preservarNaoGerenciadas: true,
      chave: 'contabil',
      colunas: ['idsituacao_nf', 'codcc', 'valor', 'adicional', 'tipovalor', 'insert_manual'],
    },
    // as PARCELAS da nota (FATURAMENTO): o `cdsFaturamento` nested, gravado no mesmo ApplyUpdates da nota (uNF.pas:4849) e
    // registrado na LOG com Inseriu, Alterou e Excluiu por linha (uNF.pas:5104-5132). A PK fica (o legado atualiza no lugar);
    // TIPOREF/CODREF, fora do dataset, sobrevivem à regravação. O título nasce da parcela no Faturamento, que a marca LIBERADO='S'.
    {
      tabela: 'faturamento',
      pk: 'codfaturamento',
      fk: 'idnf',
      chave: 'faturamento',
      pkEstavel: true,
      log: { tabela: 'FATURAMENTO', chave: 'CODNF', campos: FATURAMENTO_CAMPOS_LOG, excluiu: true },
      colunas: [
        'data', 'modalidade', 'valor', 'liberado', 'obs', 'codoperador', 'nrofatura', 'totalparcelasfatura', 'nronf', 'codbco',
        'duplicata', 'valor_desconto', 'valor_bonificado', 'codbarrasboleto',
      ],
      // o LIBERADO é do Faturamento, não da tela: a parcela que já virou título continua 'S' e a nova não nasce 'S' (senão o
      // Faturamento a pularia e o título nunca sairia) — foto das parcelas ANTES da regravação
      antesDeSubstituirTrx: async ({ trx, masterId }) =>
        (await trx.selectFrom('faturamento').select(['codfaturamento', 'liberado']).where('idnf', '=', masterId).execute()) as Array<{ codfaturamento: number; liberado: string | null }>,
      derivarItensTrx: async (itens, _trx, _emp, _header, _masterId, snapshot) => {
        const lib = new Map(((snapshot as Array<{ codfaturamento: number; liberado: string | null }> | undefined) ?? []).map((a) => [String(a.codfaturamento), a.liberado]));
        return itens.map((it) => {
          const k = it.codfaturamento != null ? String(it.codfaturamento) : null;
          const liberado = k != null && lib.has(k) ? lib.get(k) ?? null : it.liberado === 'S' ? 'N' : (it.liberado ?? null);
          return { ...it, liberado, codbarrasboleto: limparCodBarrasBoleto(it.codbarrasboleto) };
        });
      },
    },
  ],
  colunasPesquisa: ['codnf', 'nronf', 'serie', 'tipo', 'codparceiro', 'dtemissao', 'statusnfe', 'proc', 'totalnf'],
  // A2 — AUTO-NUMERAÇÃO do NRONF na EMISSÃO PRÓPRIA (SetaNroNF, uNF.pas:15787): quando não é terceiros
  // (tipoemissao≠'1') e o número não foi informado, NRONF = MAX(NRONF numérico)+1 por (idempresa,
  // modelo, série, tipoemissao). Terceiros mantêm o número digitado; própria já numerada é preservada
  // (a validação de continuidade sem-lacunas + override por senha ADM = ValidaSequenciaNFE, é da UI).
  // Roda dentro da transação do create (atômico); a UNIQUE parcial da NF barra colisão sob concorrência.
  derivarTrx: async ({ dto, trx, emp }) => {
    const tipoemissao = String(dto.tipoemissao ?? '0');
    if (tipoemissao === '1') return {}; // terceiros: número digitado
    const nronf = dto.nronf != null ? String(dto.nronf).trim() : '';
    if (nronf !== '' && nronf !== '000000') return {}; // própria já numerada → mantém
    const row = await trx
      .selectFrom('nf')
      .select(sql<number>`coalesce(max(case when nronf ~ '^[0-9]+$' then nronf::integer else 0 end), 0)`.as('maxn'))
      .where('idempresa', '=', emp)
      .where('modelo', '=', dto.modelo)
      // a série compara SEM zeros à esquerda: o legado grava '001' e para a SEFAZ '1' e '001' são a mesma série —
      // comparar o texto recomeçaria a numeração do 1 e a NF-e voltaria rejeitada por duplicidade
      .where(sql<boolean>`coalesce(nullif(ltrim(serie, '0'), ''), '0') = coalesce(nullif(ltrim(${String(dto.serie ?? '')}, '0'), ''), '0')`)
      .where('tipoemissao', '=', tipoemissao)
      .executeTakeFirst();
    return { nronf: String((Number(row?.maxn) || 0) + 1) };
  },
};

export const NfAggregateController = createAggregateController({
  path: 'fiscal/nf',
  config: nfAggregateConfig,
  schema: nfSchema,
  updateSchema: atualizarNfSchema,
});
