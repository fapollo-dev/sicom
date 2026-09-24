import { gravarLogDaLinha } from '../../shared/log/registro-log';
import { formularioDaNf, NF_CAMPOS_LOG, NF_PROD_CAMPOS_LOG } from './nf.aggregate';

type AnyDB = any;
export interface FotoNf { nf: Record<string, unknown> | null; itens: Map<number, Record<string, unknown>> }

/** a foto da NF e dos itens (SELECT *) antes de uma rotina que grava direto nas tabelas (processar, reverter, sincronizar CFOP) */
export async function fotoDaNf(trx: AnyDB, codnf: number): Promise<FotoNf> {
  const nf = ((await trx.selectFrom('nf').selectAll().where('codnf', '=', codnf).executeTakeFirst()) as Record<string, unknown> | undefined) ?? null;
  const itens = new Map<number, Record<string, unknown>>();
  for (const i of (await trx.selectFrom('nf_prod').selectAll().where('codnf', '=', codnf).orderBy('codnfprod').execute()) as Record<string, unknown>[]) {
    itens.set(Number(i.codnfprod), i);
  }
  return { nf, itens };
}

/**
 * a LOG do que a rotina mudou — "Alterou" no cabeçalho (NF) e em cada item (NF_PROD, chave CODNF), só com os campos que mudaram,
 * como o form-base do legado registra o processamento (ex.: "PROC N → S", "DTPROCESSAMENTO", e no item o operador que liberou o
 * estoque negativo). O item novo vira "Inseriu"; o removido não é registrado (o legado não registra).
 */
export async function logDaDiferencaNf(trx: AnyDB, codnf: number, antes: FotoNf): Promise<void> {
  const depois = await fotoDaNf(trx, codnf);
  if (!depois.nf) return;
  const formulario = formularioDaNf(depois.nf);
  await gravarLogDaLinha(trx, { acao: 'Alterou', formulario, tabela: 'NF', chave: 'CODNF', valor: codnf, campos: NF_CAMPOS_LOG, antes: antes.nf, depois: depois.nf });
  for (const [cod, linha] of depois.itens) {
    const velho = antes.itens.get(cod);
    await gravarLogDaLinha(trx, {
      acao: velho ? 'Alterou' : 'Inseriu', formulario, tabela: 'NF_PROD', chave: 'CODNF', valor: codnf, campos: NF_PROD_CAMPOS_LOG,
      antes: velho ?? null, depois: linha,
    });
  }
}
