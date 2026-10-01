import { sql, type Kysely } from 'kysely';

type AnyDB = Kysely<any>;
export type RegistroFr3 = Record<string, unknown>;

const d2 = (x: number) => String(x).padStart(2, '0');

/** a data como o node-pg a montou (o `date` do PG vira meia-noite local): 'AAAA-MM-DDTHH:MM:SS', que o motor do .fr3 lê como TDateTime */
export const dataLocal = (d: Date): string => `${d.getFullYear()}-${d2(d.getMonth() + 1)}-${d2(d.getDate())}T${d2(d.getHours())}:${d2(d.getMinutes())}:${d2(d.getSeconds())}`;

/** 'AAAA-MM-DD' → 'dd/mm/aaaa' (o DateToStr do Delphi em pt-BR) */
export const dataBr = (iso: string | null | undefined): string => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

/**
 * O registro com as chaves como o dataset do Delphi as expõe (maiúsculas). O node-pg entrega numeric/bigint como texto: as colunas
 * numéricas (pelo tipo, `colunasNumericas`) viram número — o DisplayFormat `%2.2n` do .fr3 só formata número, e o texto numérico do
 * cadastro (CNPJ, código de barras) fica texto.
 */
export function registroFr3(r: RegistroFr3, nums: Set<string> = new Set()): RegistroFr3 {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toUpperCase(),
    v instanceof Date ? dataLocal(v) : typeof v === 'string' && v !== '' && nums.has(k.toLowerCase()) && Number.isFinite(Number(v)) ? Number(v) : v]));
}

/** as colunas numéricas das tabelas (numeric, inteiros, ponto flutuante), mais os apelidos numéricos da consulta */
export async function colunasNumericas(db: AnyDB, tabelas: string[], apelidos: string[] = []): Promise<Set<string>> {
  const r = (await sql<{ column_name: string }>`
    SELECT DISTINCT column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = ANY(${tabelas})
       AND data_type IN ('numeric', 'integer', 'bigint', 'smallint', 'double precision', 'real')`.execute(db)).rows;
  return new Set([...r.map((x) => x.column_name), ...apelidos]);
}

/** um texto para `frxReport.Variables[...]` com aspas (o `QuotedStr` do legado): a variável do FastReport é uma expressão */
export const textoVariavel = (s: string): string => `'${String(s).replace(/'/g, "''")}'`;
