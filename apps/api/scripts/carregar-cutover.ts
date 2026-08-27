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

/**
 * CSV em STREAMING (fold do ensaio da F2): a versão anterior lia o arquivo inteiro e dava heap out of memory com
 * os 461 MB da fase — o XML das notas vem embutido. Aqui o arquivo é lido em pedaços e as linhas completas são
 * entregues por callback; o estado de aspas atravessa os pedaços, então XML com quebra de linha continua íntegro.
 */
async function lerCsv(caminho: string, onLinha: (l: string[]) => Promise<void> | void, onCabecalho?: (c: string[]) => void): Promise<string[]> {
  const { createReadStream } = await import('node:fs');
  let campo = '', linha: string[] = [], aspas = false, cabecalho: string[] | null = null;
  const stream = createReadStream(caminho, { encoding: 'utf8', highWaterMark: 1 << 20 });
  for await (const pedaco of stream as AsyncIterable<string>) {
    for (let i = 0; i < pedaco.length; i++) {
      const c = pedaco[i];
      if (aspas) {
        if (c === '"') { if (pedaco[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
        else campo += c;
      } else if (c === '"') aspas = true;
      else if (c === ',') { linha.push(campo); campo = ''; }
      else if (c === '\n') {
        linha.push(campo); campo = '';
        if (!cabecalho) { cabecalho = linha; onCabecalho?.(cabecalho); } else await onLinha(linha);
        linha = [];
      } else if (c !== '\r') campo += c;
    }
  }
  if (campo || linha.length) { linha.push(campo); if (!cabecalho) cabecalho = linha; else await onLinha(linha); }
  return cabecalho ?? [];
}

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
    // ORDEM POR DEPENDÊNCIA (fold do 1º ensaio da F1): carregar em ordem alfabética punha `estoque` antes de
    // `produtos` e o relatório acusava 137 mil "órfãs" que eram só ordem. Ordena topologicamente pelas FKs reais.
    const arquivos = readdirSync(dir).filter((f) => f.endsWith('.csv')).map((f) => f.replace(/\.csv$/, ''));
    const deps = new Map<string, Set<string>>();
    for (const t of arquivos) {
      const r = await pool.query(
        `SELECT DISTINCT ccu.table_name AS ref
           FROM information_schema.table_constraints tc
           JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1 AND ccu.table_name <> $1`, [t]);
      deps.set(t, new Set(r.rows.map((x: any) => x.ref).filter((x: string) => arquivos.includes(x))));
    }
    const ordem: string[] = [];
    const pend = new Set(arquivos);
    while (pend.size) {
      const prontos = [...pend].filter((t) => [...(deps.get(t) ?? [])].every((d) => !pend.has(d))).sort();
      if (!prontos.length) { ordem.push(...[...pend].sort()); break; } // ciclo: mantém o resto (gatilhos suspensos)
      for (const t of prontos) { ordem.push(t); pend.delete(t); }
    }
    for (const tabela0 of ordem) {
      const arq = `${tabela0}.csv`;
      const tabela = tabela0;
      const esperado = manifesto[tabela];
      const cli = await pool.connect();
      let carregadas = 0;
      let erro: string | null = null;
      let cols: string[] = [];
      try {
        await cli.query('BEGIN');
        await cli.query(`TRUNCATE ${tabela} CASCADE`); // o ensaio parte do vazio (migrations semeiam catálogos)
        // FK AUTO-REFERENTE (plano_contas.pai) e ordem entre tabelas: a carga suspende os gatilhos de FK da
        // tabela e os religa ao final, VALIDANDO — é o padrão de ETL. Sem isso a árvore de contas só entraria
        // em ordem topológica, o que é frágil de manter para cada hierarquia da base.
        await cli.query(`ALTER TABLE ${tabela} DISABLE TRIGGER ALL`);
        let buffer: string[][] = [];
        const descarrega = async () => {
          const lote = buffer.filter((l) => l.length === cols.length);
          buffer = [];
          if (!lote.length) return;
          const params: unknown[] = [];
          const values = lote
            .map((l) => `(${l.map((v) => { params.push(v === '' ? null : v); return `$${params.length}`; }).join(',')})`)
            .join(',');
          await cli.query(`INSERT INTO ${tabela} (${cols.join(',')}) VALUES ${values}`, params);
          carregadas += lote.length;
        };
        // ⚠️ o cabeçalho tem de chegar ANTES do primeiro lote: sem isso `cols` fica vazio durante o stream, o
        // filtro `l.length === cols.length` descarta tudo e só o resto final entra (foi o que o 1º ensaio da F2
        // mostrou: 74 de 980.574 em balancoitens — exatamente o resto da divisão por 500).
        cols = await lerCsv(resolve(dir, arq), async (l) => {
          buffer.push(l);
          if (buffer.length >= 500) await descarrega();
        }, (c) => { cols = c; });
        await descarrega();
        await cli.query(`ALTER TABLE ${tabela} ENABLE TRIGGER ALL`);
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
          const sm = (await pool.query(`SELECT coalesce(sum(${col}),0)::text AS s FROM ${tabela}`)).rows[0].s;
          if (Number(sm) !== Number(soma)) divergencias.push(`${col} Σ ${sm} × ${soma}`);
        }
      }
      rel.push({ tabela, esperado: esperado?.linhas ?? null, carregadas, erro, divergencias: divergencias.join(' · ') || null });
    }

    // INTEGRIDADE no FIM da fase (gatilhos ficaram suspensos durante a carga): órfã aqui é órfã de verdade.
    for (const r of rel) {
      if (r.erro) continue;
      const tabela = String(r.tabela);
      const orfas: string[] = [];
      {
        const fks = (await pool.query(
          `SELECT kcu.column_name AS col, ccu.table_name AS reft, ccu.column_name AS refc
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
             JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1`, [tabela])).rows;
        for (const fk of fks) {
          // FK cross-fase não é órfã: a tabela-alvo simplesmente não faz parte desta fase (a F1 referencia
          // `unidade`, que é da F0). No Oracle esses órfãos reais são 3 e 7 — o alarme de 43 mil era artefato.
          if (!ordem.includes(fk.reft)) continue;
          const orf = Number((await pool.query(
            `SELECT count(*)::int AS n FROM ${tabela} t
              WHERE t.${fk.col} IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM ${fk.reft} r WHERE r.${fk.refc} = t.${fk.col})`)).rows[0].n);
          if (orf > 0) orfas.push(`${orf} órfã(s) em ${fk.col}→${fk.reft}`);
        }
      }
      if (orfas.length) r.divergencias = [r.divergencias, ...orfas].filter(Boolean).join(' · ');
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
