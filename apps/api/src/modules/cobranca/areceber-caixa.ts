/**
 * O TÍTULO A RECEBER NA CAIXA GERENCIAL (`btnGravarClick`, uCadAReceber.pas:1066-1120; `CAIXA-escritores.md`): o
 * título digitado com centro de custo (campo habilitado: não é agrupamento, adiantamento de fornecedor, origem 'B'
 * nem veio de processo com CHAVE — `DesabilitaCentroCusto`, :1593) entra na CAIXA com o valor do documento, a data e o
 * vencimento = a data da venda, a forma de pagamento como recurso, o parceiro e a observação do título. Na INCLUSÃO
 * exige a forma; na EDIÇÃO apaga a linha do título e lança de novo; a EXCLUSÃO apaga (:3632).
 * Produção 2026: 432 linhas; data, vencimento, CC, parceiro, OBS e forma batem 432/432. O legado lança UMA linha por
 * documento com o total das parcelas (354 de 390) — no Apollo cada título é gravado sozinho, então o documento é o título.
 */
import { sql } from 'kysely';
import { currentTenant } from '../../shared/tenant/tenant-context';

type AnyDB = any;

export async function lancarCaixaDoAreceber(trx: AnyDB, codrcb: number, emp: number, modo: 'incluir' | 'editar', valorDocumento?: number): Promise<void> {
  const t = (await sql<Record<string, unknown>>`
    SELECT r.codrcb, r.valor, r.dtvenda, r.obs, r.codplc, r.codparceiro, r.idpgto, r.agrupamento, r.adfornecedor, r.origem, r.chave,
           f.modalidade
      FROM areceber r LEFT JOIN formas_pgto f ON f.idpgto = r.idpgto
     WHERE r.codrcb = ${codrcb} AND r.codempresa = ${emp}`.execute(trx)).rows[0];
  if (!t) return;
  const campoHabilitado = String(t.agrupamento ?? '') !== 'S' && String(t.adfornecedor ?? '') !== 'S'
    && String(t.origem ?? '') !== 'B' && String(t.chave ?? '') === '';
  if (!campoHabilitado || t.codplc == null || Number(t.codplc) === 0) return;
  if (modo === 'incluir' && t.idpgto == null) return; // a inclusão exige a modalidade
  if (modo === 'editar') await trx.deleteFrom('caixa').where('codrcb', '=', codrcb).execute();
  // o valor do DOCUMENTO: o título sozinho, ou o total das parcelas geradas juntas (`GetTotalDoc`)
  const v = Math.round((Number(valorDocumento ?? t.valor ?? 0) + Number.EPSILON) * 100) / 100;
  await trx.insertInto('caixa').values({
    data: t.dtvenda, valor: v, vrtitulo: v, obs: t.obs ?? null, operador: currentTenant().operadorId ?? null, codplc: Number(t.codplc),
    idempresa: emp, tiporecurso: t.modalidade ?? null, codconta: null, codparceiro: t.codparceiro ?? null, nrparcela: '1',
    codgrupo: null, dtvenc: t.dtvenda, gerado: 'SISTEMA', codrcb, origem: 'ARECEBER',
  }).execute();
}
