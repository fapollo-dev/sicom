import { nfSchema, atualizarNfSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';

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

export const nfAggregateConfig: AggregateConfig = {
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
    // estado (eixos A/B) — defaults; travas no validar
    'proc', 'statusnfe', 'cancelada', 'confirmada', 'contabilizado',
    // contrato NFe (vazio na F1)
    'chavenfe', 'protocolo_nfe', 'protocolo_cancelamento', 'xjust', 'sequencia_nfe', 'tpemissao',
    // flags
    'rateio', 'contribuinte_icms', 'aproveitamentocredito', 'alteraestoquereversao', 'codnf_ref',
    // observações
    'obs', 'obsnf', 'complemento',
  ],
  // Totais do header por Σ dos itens (F1 btnCalcular; F2 inclui os totais fiscais). SÍNCRONO —
  // só SOMA valores já presentes no dto (o cálculo do imposto por item é async e vive no
  // NfFiscalService, via POST /fiscal/nf/recalcular). Só recalcula quando o dto traz os itens.
  derivar: (dto) => {
    const itens = dto.itens;
    if (!Array.isArray(itens)) return {};
    let totalprod = 0;
    let totaldesc = 0;
    let totalipi = 0;
    let totalicm_st = 0;
    let totalicm = 0;
    let totalbaseicm = 0;
    let totalisento = 0;
    for (const it of itens as Record<string, unknown>[]) {
      const bruto = num(it.quantidade) * num(it.vrvenda);
      totalprod += bruto;
      totaldesc += num(it.desconto) + num(it.vrdescprod);
      totalipi += num(it.vripi); // F2: vripi é o VALOR (ipi virou a alíquota %)
      totalicm_st += num(it.vricmst);
      totalicm += num(it.vricm);
      totalbaseicm += num(it.vrbasecalculo);
      const cst = Number(it.cst);
      if (cst === 40 || cst === 41) totalisento += bruto; // isento / não tributado
    }
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const totalfrete = num(dto.totalfrete);
    const totalseguro = num(dto.totalseguro);
    const totalacessorias = num(dto.totalacessorias);
    const totalnf = r2(totalprod - totaldesc + totalfrete + totalseguro + totalacessorias + totalipi + totalicm_st);
    return {
      totalprod: r2(totalprod),
      totaldesc: r2(totaldesc),
      totalipi: r2(totalipi),
      totalicm_st: r2(totalicm_st),
      totalicm: r2(totalicm),
      totalbaseicm: r2(totalbaseicm),
      totalisento: r2(totalisento),
      totalnf,
    };
  },
  // Regras cross-row do btnGravar (consultam o banco antes de gravar).
  validar: async ({ dto, id, db }) => {
    const emp = currentTenant().empresaId ?? null;

    // estado atual (update): travas de edição por estado + fallback dos campos da chave.
    let atual:
      | { proc?: string; statusnfe?: string; contabilizado?: string; nronf?: string; serie?: string; modelo?: number; tipo?: string; codparceiro?: number }
      | undefined;
    if (id != null) {
      atual = (await db
        .selectFrom('nf')
        .select(['proc', 'statusnfe', 'contabilizado', 'nronf', 'serie', 'modelo', 'tipo', 'codparceiro'])
        .where('codnf', '=', id)
        .where('idempresa', '=', emp)
        .executeTakeFirst()) as typeof atual;
      if (atual) {
        if (atual.proc === 'S') throw new BusinessRuleError('NF_PROCESSADA');
        if (atual.contabilizado === 'S') throw new BusinessRuleError('NF_CONTABILIZADA');
        if (atual.statusnfe === 'P' || atual.statusnfe === 'D') throw new BusinessRuleError('NF_ENVIADA');
      }
    }

    // duplicidade da chave fiscal: mesmo número + série + modelo + empresa + tipo + fornecedor.
    const nronf = (dto.nronf ?? atual?.nronf) as string | number | undefined;
    if (nronf != null && String(nronf).trim() !== '') {
      const serie = (dto.serie ?? atual?.serie ?? null) as string | null;
      const modelo = (dto.modelo ?? atual?.modelo ?? null) as number | null;
      const tipo = (dto.tipo ?? atual?.tipo ?? null) as string | null;
      const codparceiro = (dto.codparceiro ?? atual?.codparceiro ?? null) as number | null;
      let q = db
        .selectFrom('nf')
        .select('codnf')
        .where('nronf', '=', String(nronf))
        .where('idempresa', '=', emp)
        .where('tipo', '=', tipo)
        .where('codparceiro', '=', codparceiro);
      q = serie == null ? q.where('serie', 'is', null) : q.where('serie', '=', serie);
      q = modelo == null ? q.where('modelo', 'is', null) : q.where('modelo', '=', modelo);
      if (id != null) q = q.where('codnf', '<>', id);
      const dup = await q.executeTakeFirst();
      if (dup) throw new BusinessRuleError('NF_DUPLICADA');
    }
  },
  detalhes: [
    {
      tabela: 'nf_prod',
      pk: 'codnfprod',
      fk: 'codnf',
      chave: 'itens',
      colunas: [
        'nroitem', 'codproduto', 'codprodnota', 'quantidade', 'fatorembal', 'unidade',
        'geraestoque', 'movimenta_estoque',
        'vrvenda', 'vrcusto', 'desconto', 'vrdescprod', 'bonificacao',
        'cfop', 'ncm', 'cest', 'origem_estoque', 'aliquota', 'icms', 'cst', 'csosn',
        'bcr', 'vrbasecalculo', 'vricm', 'icme', 'mva', 'vrbasest', 'vricmst', 'streal',
        'ipi', 'vripi', 'geraicm_ipi', 'geraicm_frete', 'geraicm_acess',
        'fcp_aliquota', 'fcp_valor', 'pis', 'cstpiscofins',
        'aliqpise', 'aliqpiss', 'aliqcofinse', 'aliqcofinss',
        'frete', 'seguro', 'vroutrasdesp',
      ],
    },
    {
      tabela: 'nf_referencia',
      pk: 'codnfreferencia',
      fk: 'codnf',
      chave: 'referencias',
      colunas: ['codnf_ref', 'chave_ref', 'valor_ref'],
    },
  ],
  colunasPesquisa: ['codnf', 'nronf', 'serie', 'tipo', 'codparceiro', 'dtemissao', 'statusnfe', 'proc', 'totalnf'],
};

export const NfAggregateController = createAggregateController({
  path: 'fiscal/nf',
  config: nfAggregateConfig,
  schema: nfSchema,
  updateSchema: atualizarNfSchema,
});
