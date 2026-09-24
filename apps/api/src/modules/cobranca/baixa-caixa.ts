/**
 * JUROS, ACRÉSCIMO E DESCONTO DA BAIXA NA CAIXA GERENCIAL (`CAIXA-escritores.md` §4). A baixa de A Pagar
 * (`UBaixaApagar.pas:501-523`, :790-792) e a de A Receber (`UBaixaAreceber.pas:1260-1280`, :1767-1769) lançam uma linha
 * por natureza com valor: "Ref. juros/acréscimos/descontos … lote N", no centro de custo que a tela pede — o padrão vem
 * da empresa (`SetCCPadrao`: `EMPRESAS.CODPLC_JUROS_PAGOS`, `_ACRESCIMOS_PAGOS`, `_DESCONTOS_RECEBIDOS` no A Pagar;
 * `_JUROS_RECEBIDOS`, `_ACRESCIMOS_RECEBIDOS`, `_DESCONTOS_CONCEDIDOS` no A Receber) e é obrigatório quando a natureza
 * tem valor (`ValidaCentroCustos`). Data e vencimento = a data da baixa, DINHEIRO, parceiro 0, parcela '1', SISTEMA.
 * No A Pagar o dinheiro sai (juros e acréscimo negativos, desconto positivo); no A Receber, o contrário.
 * Produção 2026: A Receber 18/18 e 15/15; A Pagar 47/47 nos acréscimos — o desconto do A Pagar do legado soma só os
 * títulos do fornecedor em foco na grade (31/144), defeito não copiado: aqui entra o desconto da baixa inteira.
 * A reversão apaga as linhas pelo texto (`UReversaoBaixaContasPagar.pas:50-57`, `UReversaoBaixaContasReceber.pas:62`).
 */
import { sql } from 'kysely';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';

type AnyDB = any;
export type LadoBaixa = 'AP' | 'AR';
type Natureza = 'juros' | 'acrescimo' | 'desconto';

const LADO = {
  AP: {
    padrao: { juros: 'codplc_juros_pagos', acrescimo: 'codplc_acrescimos_pagos', desconto: 'codplc_descontos_recebidos' },
    obs: { juros: 'Ref. juros pgto lote', acrescimo: 'Ref. acréscimos pgto lote', desconto: 'Ref. descontos recebidos lote' },
    sinal: { juros: -1, acrescimo: -1, desconto: 1 },
    erro: { juros: 'BAIXA_CC_JUROS', acrescimo: 'BAIXA_CC_ACRESCIMO', desconto: 'BAIXA_CC_DESCONTO_RECEBIDO' },
    origem: 'BAIXA APAGAR',
  },
  AR: {
    padrao: { juros: 'codplc_juros_recebidos', acrescimo: 'codplc_acrescimos_recebidos', desconto: 'codplc_descontos_concedidos' },
    obs: { juros: 'Ref. juros recebidos lote', acrescimo: 'Ref. acréscimos recebidos lote', desconto: 'Ref. descontos concedidos lote' },
    sinal: { juros: 1, acrescimo: 1, desconto: -1 },
    erro: { juros: 'BAIXA_CC_JUROS', acrescimo: 'BAIXA_CC_ACRESCIMO', desconto: 'BAIXA_CC_DESCONTO_CONCEDIDO' },
    origem: 'BAIXA ARECEBER',
  },
} as const;

export interface CentrosBaixa { juros: number | null; acrescimo: number | null; desconto: number | null }
const r2 = (n: number) => Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;

/** o valor de cada natureza da baixa: juros, e o acréscimo/desconto líquido (ACRE_DESC > 0 / < 0) */
function valores(juros: number, acreDesc: number): Record<Natureza, number> {
  return { juros: juros > 0 ? r2(juros) : 0, acrescimo: acreDesc > 0 ? r2(acreDesc) : 0, desconto: acreDesc < 0 ? r2(-acreDesc) : 0 };
}

/** os centros de custo da baixa: o informado ou o padrão da empresa; obrigatório para a natureza com valor */
export async function centrosDaBaixa(
  trx: AnyDB, lado: LadoBaixa, emp: number,
  dto: { codplcJuros?: number; codplcAcrescimo?: number; codplcDesconto?: number }, juros: number, acreDesc: number,
): Promise<CentrosBaixa> {
  const L = LADO[lado];
  const e = ((await sql<Record<string, unknown>>`
    SELECT ${sql.ref(L.padrao.juros)} AS juros, ${sql.ref(L.padrao.acrescimo)} AS acrescimo, ${sql.ref(L.padrao.desconto)} AS desconto
      FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0] ?? {}) as Record<Natureza, unknown>;
  const escolhido = (informado: number | undefined, padrao: unknown) => {
    const n = Number(informado ?? padrao);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const cc: CentrosBaixa = {
    juros: escolhido(dto.codplcJuros, e.juros), acrescimo: escolhido(dto.codplcAcrescimo, e.acrescimo), desconto: escolhido(dto.codplcDesconto, e.desconto),
  };
  const v = valores(juros, acreDesc);
  for (const n of ['juros', 'acrescimo', 'desconto'] as const) {
    if (v[n] === 0) continue;
    if (cc[n] == null) throw new BusinessRuleError(L.erro[n]);
    const existe = (await sql`SELECT 1 FROM plc WHERE codplc = ${cc[n]}`.execute(trx)).rows.length > 0;
    if (!existe) throw new BusinessRuleError('BAIXA_CC_INVALIDO', { codplc: cc[n] });
  }
  return cc;
}

/** as colunas da baixa que guardam o centro de custo (`UBaixaApagar.pas:762-770`) */
export function colunasCentroDaBaixa(cc: CentrosBaixa, juros: number, acreDesc: number): { codplc_acredesc: number | null; codplc_juros: number | null } {
  return {
    codplc_acredesc: acreDesc > 0 ? cc.acrescimo : acreDesc < 0 ? cc.desconto : null,
    codplc_juros: juros > 0 ? cc.juros : null,
  };
}

export async function lancarCaixaDaBaixa(
  trx: AnyDB, lado: LadoBaixa, emp: number,
  p: { idlote: number; dtpgto: unknown; juros: number; acreDesc: number; cc: CentrosBaixa },
): Promise<void> {
  const L = LADO[lado];
  const v = valores(p.juros, p.acreDesc);
  for (const n of ['juros', 'acrescimo', 'desconto'] as const) {
    if (v[n] === 0 || p.cc[n] == null) continue;
    const valor = r2(v[n] * L.sinal[n]);
    await trx.insertInto('caixa').values({
      data: p.dtpgto, valor, vrtitulo: valor, obs: `${L.obs[n]} ${p.idlote}`, operador: currentTenant().operadorId ?? null,
      codplc: p.cc[n], idempresa: emp, tiporecurso: 'DINHEIRO', codconta: null, codparceiro: 0, nrparcela: '1',
      codgrupo: null, dtvenc: p.dtpgto, gerado: 'SISTEMA', idlote: p.idlote, origem: L.origem,
    }).execute();
  }
}

/** a reversão apaga as três linhas do lote pelo texto, como o legado */
export async function estornarCaixaDaBaixa(trx: AnyDB, lado: LadoBaixa, emp: number, idlote: number | null | undefined): Promise<void> {
  if (idlote == null) return;
  const L = LADO[lado];
  const textos = (['juros', 'acrescimo', 'desconto'] as const).map((n) => `${L.obs[n]} ${idlote}`.toUpperCase());
  await sql`DELETE FROM caixa WHERE idempresa = ${emp} AND upper(obs) = ANY(${textos}::text[])`.execute(trx);
}

/** o número do lote da baixa (o `ID_IDLOTE` do legado, compartilhado pelas baixas, cartão, cheque e fechamento) */
export async function novoLote(trx: AnyDB): Promise<number> {
  return Number((await sql<{ id: string }>`SELECT nextval('seq_idlote') AS id`.execute(trx)).rows[0].id);
}
