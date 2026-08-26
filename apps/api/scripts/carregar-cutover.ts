/**
 * CARREGADOR do ensaio de cutover: sobe um Postgres DESCARTÁVEL com todas as migrations, carrega os CSVs que o
 * `tools/cutover/etl/extrair.py` gerou e RECONCILIA contra o manifesto (contagem e somas por coluna numérica).
 * Um ensaio que não reconcilia não prova nada — por isso o relatório é a saída, não a carga em si.
 *
 *   pnpm --filter @apollo/api exec ts-node --transpile-only scripts/carregar-cutover.ts f0
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { startEmbeddedPg, PG_CONN } from '../test/embedded-db';

const fase = process.argv[2] ?? 'f0';
const dir = resolve(__dirname, `../../../tools/cutover/staging/${fase}`);

/** CSV simples (o extrator escreve com csv.writer padrão: aspas duplas, sem newline embutido fora de aspas). */
function parseCsv(txt: string): string[][] {
  const linhas: string[][] = [];
  let campo = '', linha: string[] = [], aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (aspas) {
      if (c === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

async function main() {
  const manifesto = JSON.parse(readFileSync(resolve(dir, '_manifesto.json'), 'utf8')) as Record<string, any>;
  const pg = await startEmbeddedPg();
  const pool = new Pool({ ...PG_CONN, database: `${PG_CONN.databasePrefix}pinheirao` });
  const rel: Array<Record<string, unknown>> = [];
  try {
    for (const arq of readdirSync(dir).filter((f) => f.endsWith('.csv')).sort()) {
      const tabela = arq.replace(/\.csv$/, '');
      const esperado = manifesto[tabela];
      const linhas = parseCsv(readFileSync(resolve(dir, arq), 'utf8'));
      const cols = linhas.shift() ?? [];
      if (!cols.length) continue;
      const cli = await pool.connect();
      let carregadas = 0;
      let erro: string | null = null;
      try {
        await cli.query('BEGIN');
        await cli.query(`TRUNCATE ${tabela} CASCADE`); // o ensaio parte do vazio (migrations semeiam catálogos)
        for (let i = 0; i < linhas.length; i += 500) {
          const lote = linhas.slice(i, i + 500).filter((l) => l.length === cols.length);
          if (!lote.length) continue;
          const params: unknown[] = [];
          const values = lote
            .map((l) => `(${l.map((v) => { params.push(v === '' ? null : v); return `$${params.length}`; }).join(',')})`)
            .join(',');
          await cli.query(`INSERT INTO ${tabela} (${cols.join(',')}) VALUES ${values}`, params);
          carregadas += lote.length;
        }
        await cli.query('COMMIT');
      } catch (e) {
        await cli.query('ROLLBACK').catch(() => {});
        erro = (e as Error).message.split('\n')[0];
      } finally {
        cli.release();
      }
      // reconciliação: contagem e somas das colunas numéricas do manifesto
      let divergencias: string[] = [];
      if (!erro) {
        const n = Number((await pool.query(`SELECT count(*)::int AS n FROM ${tabela}`)).rows[0].n);
        if (n !== Number(esperado?.linhas ?? -1)) divergencias.push(`contagem ${n} × ${esperado?.linhas}`);
        for (const [col, soma] of Object.entries((esperado?.somas ?? {}) as Record<string, string>)) {
          const s = (await pool.query(`SELECT coalesce(sum(${col}),0)::text AS s FROM ${tabela}`)).rows[0].s;
          if (Number(s) !== Number(soma)) divergencias.push(`${col} Σ ${s} × ${soma}`);
        }
      }
      rel.push({ tabela, esperado: esperado?.linhas ?? null, carregadas, erro, divergencias: divergencias.join(' · ') || null });
    }
  } finally {
    await pool.end();
    await pg.stop();
  }
  const okT = rel.filter((r) => !r.erro && !r.divergencias);
  console.log(`\n=== ENSAIO DE CARGA ${fase.toUpperCase()} ===`);
  for (const r of rel) {
    const marca = r.erro ? '⛔' : r.divergencias ? '⚠️ ' : '✅';
    console.log(`  ${marca} ${r.tabela}: ${r.carregadas}/${r.esperado}${r.erro ? ` — ${r.erro}` : ''}${r.divergencias ? ` — ${r.divergencias}` : ''}`);
  }
  const total = rel.reduce((a, r) => a + Number(r.carregadas), 0);
  console.log(`\n${okT.length}/${rel.length} tabelas reconciliadas · ${total} linhas carregadas`);
  process.exitCode = okT.length === rel.length ? 0 : 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
