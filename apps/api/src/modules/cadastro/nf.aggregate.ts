import { sql } from 'kysely';
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
      // golden: TOTALDESC = SUM do desconto-VALOR por item (um único campo). No migrado o desconto
      // é capturado como dinheiro em `desconto` (CurrencyField no modal). NÃO somar `vrdescprod`
      // junto (dupla contagem — ambos são dinheiro; o legado soma só um, SUM(VRDESCPROD)).
      totaldesc += num(it.desconto);
      totalipi += num(it.vripi); // F2: vripi é o VALOR (ipi virou a alíquota %)
      totalicm_st += num(it.vricmst);
      totalicm += num(it.vricm);
      totalbaseicm += num(it.vrbasecalculo);
      // golden/legado: isento é disparado pelo CÓDIGO DE ALÍQUOTA 'IST' (udmNF.pas:4169/4299),
      // não pelo CST. (CST 40/41 correlacionam mas não são idênticos a ALIQUOTA='IST'.)
      if (String(it.aliquota) === 'IST') totalisento += bruto;
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
    // Espelha NotaEletronica/btnEditar do legado: NF processada/contabilizada/faturada/enviada/
    // cancelada é read-only (editar deixaria efeitos dessincronizados).
    let atual:
      | { proc?: string; statusnfe?: string; contabilizado?: string; cancelada?: string; faturada?: string; nronf?: string; serie?: string; modelo?: number; tipoemissao?: string; codparceiro?: number }
      | undefined;
    if (id != null) {
      atual = (await db
        .selectFrom('nf')
        .select(['proc', 'statusnfe', 'contabilizado', 'cancelada', 'faturada', 'nronf', 'serie', 'modelo', 'tipoemissao', 'codparceiro'])
        .where('codnf', '=', id)
        .where('idempresa', '=', emp)
        .executeTakeFirst()) as typeof atual;
      if (atual) {
        if (atual.proc === 'S') throw new BusinessRuleError('NF_PROCESSADA');
        if (atual.faturada === 'S') throw new BusinessRuleError('NF_TEM_FATURAMENTO');
        if (atual.contabilizado === 'S') throw new BusinessRuleError('NF_CONTABILIZADA');
        if (atual.cancelada === 'S' || atual.statusnfe === 'C') throw new BusinessRuleError('NF_CANCELADA');
        if (atual.statusnfe === 'P' || atual.statusnfe === 'D') throw new BusinessRuleError('NF_ENVIADA');
      }
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
  },
  // Guarda de EXCLUSÃO (btnExcluir do legado, uNF.pas:4072): não apagar NF com efeitos — apagar deixaria
  // estoque movido e títulos órfãos. Exige reverter (F3) / estornar (F4) antes.
  //   • Travas de estado (proc/faturada/contabilizada/enviada/cancelada) — uNF:4080/4085/4109 → abaixo.
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
      .select(['proc', 'faturada', 'contabilizado', 'statusnfe', 'cancelada'])
      .where('codnf', '=', id)
      .where('idempresa', '=', emp)
      .executeTakeFirst()) as
      | { proc?: string; faturada?: string; contabilizado?: string; statusnfe?: string; cancelada?: string }
      | undefined;
    if (!nf) return; // not-found é tratado pelo fluxo normal
    if (nf.proc === 'S') throw new BusinessRuleError('NF_PROCESSADA'); // reverter o processamento antes
    if (nf.faturada === 'S') throw new BusinessRuleError('NF_TEM_FATURAMENTO'); // estornar o faturamento antes
    if (nf.contabilizado === 'S') throw new BusinessRuleError('NF_CONTABILIZADA');
    if (nf.cancelada === 'S' || nf.statusnfe === 'C') throw new BusinessRuleError('NF_CANCELADA');
    if (nf.statusnfe === 'P' || nf.statusnfe === 'D') throw new BusinessRuleError('NF_ENVIADA');
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
        'frete', 'seguro', 'vroutrasdesp', 'depsacess', 'arredonda', 'vl_custo',
      ],
      // congela o CUSTO do item = MULTI_PRECO.VRCUSTO corrente por (produto, empresa) no lançamento
      // (GetCustoProduto, udmNF.pas:12057). É a base do CMV; snapshot (não acompanha a deriva do MP).
      derivarItensTrx: async (itens, trx, emp) => {
        const out: Record<string, unknown>[] = [];
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
          out.push({ ...it, vl_custo: vl });
        }
        return out;
      },
    },
    {
      tabela: 'nf_referencia',
      pk: 'codnfreferencia',
      fk: 'codnf',
      chave: 'referencias',
      colunas: ['codnf_ref', 'chave_ref', 'valor_ref'],
    },
    // F5 — rateio contábil (CODCONTABILNF): config armazenada na transação do agregado (sem efeito).
    // codcc = PLC (centro de custo gerencial). Soma = TOTALNF é validada no schema (validaRateioContabil).
    {
      tabela: 'nf_contabil',
      pk: 'codcontabilnf',
      fk: 'codnf',
      chave: 'contabil',
      colunas: ['idsituacao_nf', 'codcc', 'valor', 'adicional', 'tipovalor', 'insert_manual'],
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
      .where('serie', '=', dto.serie)
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
