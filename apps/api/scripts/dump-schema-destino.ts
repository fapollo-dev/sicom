/**
 * Dump do SCHEMA DE DESTINO para o ETL do cutover: sobe o Postgres embarcado, aplica TODAS as migrations e
 * escreve `tools/cutover/schema-destino.json` com tabelas, colunas (tipo, nulabilidade, default), PKs, FKs e
 * índices únicos. É o lado "destino" do mapa coluna-a-coluna — o lado "origem" sai do dicionário do Oracle.
 *
 *   pnpm --filter @apollo/api exec tsx scripts/dump-schema-destino.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { startEmbeddedPg, PG_CONN } from '../test/embedded-db';

async function main() {
  const pg = await startEmbeddedPg();
  const pool = new Pool({ ...PG_CONN, database: `${PG_CONN.databasePrefix}pinheirao` });
  try {
    const cols = (await pool.query(`
      SELECT table_name, column_name, data_type, coalesce(character_maximum_length, numeric_precision) AS tam,
             numeric_scale AS escala, is_nullable, column_default
        FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name, ordinal_position`)).rows;
    const pks = (await pool.query(`
      SELECT tc.table_name, kcu.column_name, kcu.ordinal_position
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
       ORDER BY tc.table_name, kcu.ordinal_position`)).rows;
    const fks = (await pool.query(`
      SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
       ORDER BY tc.table_name`)).rows;
    const uniques = (await pool.query(`
      SELECT indexname, tablename, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND indexdef ILIKE '%UNIQUE%' ORDER BY tablename, indexname`)).rows;

    const porTabela: Record<string, unknown> = {};
    for (const c of cols) {
      const t = (porTabela[c.table_name] ??= { colunas: {}, pk: [], fks: [], unicos: [] }) as any;
      t.colunas[c.column_name] = {
        tipo: c.data_type, tam: c.tam == null ? null : Number(c.tam), escala: c.escala == null ? null : Number(c.escala),
        nulo: c.is_nullable === 'YES', default: c.column_default ?? null,
      };
    }
    for (const p of pks) (porTabela[p.table_name] as any)?.pk.push(p.column_name);
    for (const f of fks) (porTabela[f.table_name] as any)?.fks.push({ coluna: f.column_name, ref: `${f.ref_table}.${f.ref_column}` });
    for (const u of uniques) (porTabela[u.tablename] as any)?.unicos.push({ nome: u.indexname, def: u.indexdef });

    const saida = resolve(__dirname, '../../../tools/cutover/schema-destino.json');
    writeFileSync(saida, JSON.stringify({ gerado_por: 'dump-schema-destino.ts', tabelas: porTabela }, null, 1));
    console.log(`[schema-destino] ${Object.keys(porTabela).length} tabelas · ${cols.length} colunas · ${fks.length} FKs · ${uniques.length} índices únicos → ${saida}`);
  } finally {
    await pool.end();
    await pg.stop();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
