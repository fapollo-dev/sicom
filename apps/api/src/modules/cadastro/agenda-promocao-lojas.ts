import { sql } from 'kysely';

type AnyDB = any;

/**
 * AS LOJAS DA AGENDA DE PROMOÇÃO (mig 312). No legado a lista mora em CADA ITEM (`AGENDA_PROMOCAO_ITENS.EMPRESAS`,
 * '1, 2'): é ela que o AtualizaAtivo percorre para ligar o preço loja a loja (uCadAgendaPromocao.pas:232) e a que a
 * checagem de sobreposição compara (:1613). O form preenche todos os itens com a mesma lista — a das empresas
 * selecionadas ao incluir (cdsAgendaPromocaoBeforeInsert) —, e é o que o dado mostra: nenhuma agenda de 2026 tem dois
 * itens com listas diferentes. A `agenda_promocao_empresa` é a mesma lista para o app de gestão.
 */

/** '1, 2' — o formato do legado (espaço depois da vírgula), ordenado e sem repetição */
export function csvLojas(lojas: number[]): string {
  return [...new Set(lojas.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).join(', ');
}

/** lê a lista do item; vazia → as da agenda (fallback) */
export function lojasDoCsv(csv: unknown, fallback: number[]): number[] {
  const l = String(csv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number);
  return l.length ? [...new Set(l)].sort((a, b) => a - b) : fallback;
}

/** as lojas de uma agenda gravada: as dos itens; sem itens com lista, as da `agenda_promocao_empresa`; senão a dona */
export async function lojasDaAgenda(db: AnyDB, codagenda: number): Promise<number[]> {
  const r = (await sql<{ lojas: number[] | null }>`
      SELECT agenda_promocao_lojas(a.codagenda, a.idempresa) AS lojas FROM agenda_promocao a WHERE a.codagenda = ${codagenda}`
    .execute(db)).rows[0];
  return (r?.lojas ?? []).map(Number);
}
