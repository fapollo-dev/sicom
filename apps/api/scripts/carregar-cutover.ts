/**
 * CARREGADOR do ensaio de cutover: sobe um Postgres DESCARTÁVEL com todas as migrations, carrega os CSVs que o
 * `tools/cutover/etl/extrair.py` gerou e RECONCILIA contra o manifesto (contagem e somas por coluna numérica).
 * Um ensaio que não reconcilia não prova nada — por isso o relatório é a saída, não a carga em si.
 *
 *   pnpm --filter @apollo/api exec ts-node --transpile-only scripts/carregar-cutover.ts f0
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { startEmbeddedPg, PG_CONN } from '../test/embedded-db';

// uso:  carregar-cutover.ts <fase|todas> [--manter]
//   <fase>   carrega tools/cutover/staging/<fase> (f0..f4 do plano derivado, ou um diretório avulso como `novas`)
//   todas    carrega TODAS as fases do plano-tabelas.json, em ordem, no MESMO Postgres — o ensaio de operação
//   --manter não derruba o Postgres no fim: imprime como apontar a API e fica vivo até Ctrl+C
const args = process.argv.slice(2);
const MANTER = args.includes('--manter');
const alvo = args.find((a) => !a.startsWith('--')) ?? 'f0';
const STAGING = resolve(__dirname, '../../../tools/cutover/staging');
const dirDe = (fase: string) => resolve(STAGING, fase);

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

type Rel = { fase: string; tabela: string; esperado: number | null; carregadas: number; erro: string | null; divergencias: string | null };

/** carrega UMA fase (um diretório de CSVs + manifesto): truncate, insert em lotes, reconciliação de contagem e somas. */
async function carregarFase(pool: Pool, fase: string, rel: Rel[]): Promise<void> {
  const dir = dirDe(fase);
  const manifesto = JSON.parse(readFileSync(resolve(dir, '_manifesto.json'), 'utf8')) as Record<string, any>;
  // ORDEM POR DEPENDÊNCIA (fold do 1º ensaio da F1): carregar em ordem alfabética punha `estoque` antes de
  // `produtos` e o relatório acusava 137 mil "órfãs" que eram só ordem. Ordena topologicamente pelas FKs reais.
  // a lista de tabelas vem do MANIFESTO, não do diretório: o staging acumula CSVs de extrações antigas (a f0
  // tinha 58 arquivos de um plano anterior) e carregá-los misturaria homologação com produção.
  const arquivos = Object.keys(manifesto)
    .filter((t) => !(manifesto[t] as any)?.pulada && existsSync(resolve(dir, `${t}.csv`)));
  const sobrando = readdirSync(dir).filter((f) => f.endsWith('.csv')).map((f) => f.replace(/\.csv$/, '')).filter((t) => !arquivos.includes(t));
  if (sobrando.length) console.log(`[${fase}] ${sobrando.length} CSV(s) fora do manifesto IGNORADO(s): ${sobrando.slice(0, 6).join(', ')}${sobrando.length > 6 ? '…' : ''}`);
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
  console.log(`[${fase}] ${ordem.length} tabela(s)`);
  for (const tabela of ordem) {
    const esperado = manifesto[tabela];
    const cli = await pool.connect();
    let carregadas = 0;
    let erro: string | null = null;
    let cols: string[] = [];
    const t0 = Date.now();
    try {
      await cli.query('BEGIN');
      await cli.query(`TRUNCATE ${tabela} CASCADE`); // o ensaio parte do vazio (migrations semeiam catálogos)
      // FK AUTO-REFERENTE (plano_contas.pai) e ordem entre tabelas: a carga suspende os gatilhos de FK da
      // tabela e os religa ao final — é o padrão de ETL. Sem isso a árvore de contas só entraria em ordem
      // topológica, o que é frágil de manter para cada hierarquia da base.
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
      cols = await lerCsv(resolve(dir, `${tabela}.csv`), async (l) => {
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
    const divergencias: string[] = [];
    if (!erro) {
      const n = Number((await pool.query(`SELECT count(*)::int AS n FROM ${tabela}`)).rows[0].n);
      if (n !== Number(esperado?.linhas ?? -1)) divergencias.push(`contagem ${n} × ${esperado?.linhas}`);
      // só soma o que é NUMÉRICO no DESTINO: o manifesto soma o que é NUMBER no Oracle, e há coluna que lá é
      // número e aqui é texto (a primeira rodada das 70 novas morreu num `sum(character varying)`).
      const tiposDest = new Map<string, string>(((await pool.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [tabela])).rows as Array<{ column_name: string; data_type: string }>)
        .map((c) => [c.column_name, c.data_type]));
      const NUM = new Set(['numeric', 'integer', 'bigint', 'smallint', 'double precision', 'real']);
      for (const [col, soma] of Object.entries((esperado?.somas ?? {}) as Record<string, string>)) {
        const tipo = tiposDest.get(col);
        if (!tipo) continue;
        if (!NUM.has(tipo)) { divergencias.push(`${col}: número no Oracle, ${tipo} aqui — soma não comparável`); continue; }
        try {
          const sm = (await pool.query(`SELECT coalesce(sum(${col}),0)::text AS s FROM ${tabela}`)).rows[0].s;
          if (Number(sm) !== Number(soma)) divergencias.push(`${col} Σ ${sm} × ${soma}`);
        } catch (e) {
          divergencias.push(`${col}: soma falhou (${(e as Error).message.split('\n')[0]})`);
        }
      }
    }
    const seg = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ${erro ? '⛔' : '·'} ${tabela}: ${carregadas}${esperado?.linhas != null ? `/${esperado.linhas}` : ''} em ${seg}s${erro ? ` — ${erro}` : ''}`);
    rel.push({ fase, tabela, esperado: esperado?.linhas ?? null, carregadas, erro, divergencias: divergencias.join(' · ') || null });
  }
}

async function main() {
  const fases = alvo === 'todas'
    ? Object.keys((JSON.parse(readFileSync(resolve(STAGING, '../plano-tabelas.json'), 'utf8')) as any).fases)
        .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
        .filter((f) => existsSync(resolve(dirDe(f), '_manifesto.json')))
    : [alvo];
  const inicio = Date.now();
  const pg = await startEmbeddedPg();
  const pool = new Pool({ ...PG_CONN, database: `${PG_CONN.databasePrefix}pinheirao` });
  const rel: Rel[] = [];
  try {
    for (const f of fases) await carregarFase(pool, f, rel);
    const carregadas = new Set(rel.filter((r) => !r.erro).map((r) => r.tabela));

    // PÓS-CARGA (tools/cutover/pos-carga.sql): o que o Apollo exige e o legado não tem — o TRUNCATE leva as
    // sementes das migrations, e algumas delas são PAI de dado legado (motivo 999 de 4.874 ajustes em produção).
    // Roda ANTES da conferência de órfãos, para o que ele semeia contar como pai.
    const posCarga = resolve(STAGING, '../pos-carga.sql');
    if (existsSync(posCarga)) {
      await pool.query(readFileSync(posCarga, 'utf8'));
      console.log(`[pós-carga] ${posCarga} aplicado`);
    }

    // SEQUÊNCIAS: a carga grava os ids do legado em colunas serial/identity; sem reposicionar a sequência, o
    // primeiro INSERT do app depois da virada colide com um id existente. Para cada coluna com sequência das
    // tabelas carregadas: setval(max). Item de runbook que estava faltando.
    let seqs = 0;
    for (const tabela of carregadas) {
      const cols = (await pool.query(
        `SELECT a.attname AS col, pg_get_serial_sequence($1, a.attname) AS seq
           FROM pg_attribute a
          WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND pg_get_serial_sequence($1, a.attname) IS NOT NULL`, [tabela])).rows as Array<{ col: string; seq: string }>;
      for (const c of cols) {
        await pool.query(`SELECT setval($1, coalesce((SELECT max(${c.col}) FROM ${tabela}), 0) + 1, false)`, [c.seq]);
        seqs++;
      }
    }
    console.log(`[sequências] ${seqs} reposicionada(s) no max(id) das tabelas carregadas`);

    // INTEGRIDADE no FIM (gatilhos ficaram suspensos durante a carga): órfã aqui é órfã de verdade — e só conta
    // quando a tabela-alvo também foi carregada (FK para tabela fora do ensaio não é órfã, é fronteira).
    for (const r of rel) {
      if (r.erro) continue;
      const tabela = r.tabela;
      const orfas: string[] = [];
      const fks = (await pool.query(
        `SELECT tc.constraint_name AS nome, kcu.column_name AS col, ccu.table_name AS reft, ccu.column_name AS refc,
                pg_get_constraintdef(pgc.oid) AS def
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
           JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
           JOIN pg_constraint pgc ON pgc.conname = tc.constraint_name AND pgc.conrelid = ($1::text)::regclass
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1::text`, [tabela])).rows;
      for (const fk of fks) {
        if (!carregadas.has(fk.reft)) continue;
        const orf = Number((await pool.query(
          `SELECT count(*)::int AS n FROM ${tabela} t
            WHERE t.${fk.col} IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM ${fk.reft} r WHERE r.${fk.refc} = t.${fk.col})`)).rows[0].n);
        if (orf > 0) {
          // ÓRFÃ LEGADA sob FK nossa (clube_desconto.idpromocao: 3.022 de 3.069 apontam para ids que não existem em
          // PROMOCAO; o Oracle não tem a FK). Com os gatilhos suspensos a linha entrou e o Postgres segue achando
          // a FK "validada" — estado latente que um pg_restore ou um VALIDATE denunciaria. O honesto é recriar a
          // FK como NOT VALID: continua valendo para toda linha NOVA do app, e declara que o legado não passa por
          // ela. Fica no relatório para o dono do dado decidir se limpa.
          await pool.query(`ALTER TABLE ${tabela} DROP CONSTRAINT ${fk.nome}`);
          await pool.query(`ALTER TABLE ${tabela} ADD CONSTRAINT ${fk.nome} ${fk.def} NOT VALID`);
          orfas.push(`${orf} órfã(s) em ${fk.col}→${fk.reft} (FK ${fk.nome} recriada NOT VALID)`);
        }
      }
      if (orfas.length) r.divergencias = [r.divergencias, ...orfas].filter(Boolean).join(' · ');
    }
  } finally {
    await pool.end();
    if (!MANTER) await pg.stop();
  }
  const okT = rel.filter((r) => !r.erro && !r.divergencias);
  console.log(`\n=== ENSAIO DE CARGA ${alvo.toUpperCase()} ===`);
  for (const r of rel) {
    const marca = r.erro ? '⛔' : r.divergencias ? '⚠️ ' : '✅';
    console.log(`  ${marca} ${r.fase}·${r.tabela}: ${r.carregadas}/${r.esperado}${r.erro ? ` — ${r.erro}` : ''}${r.divergencias ? ` — ${r.divergencias}` : ''}`);
  }
  const total = rel.reduce((a, r) => a + Number(r.carregadas), 0);
  const min = ((Date.now() - inicio) / 60000).toFixed(1);
  console.log(`\n${okT.length}/${rel.length} tabelas reconciliadas · ${total} linhas carregadas · ${min} min`);
  process.exitCode = okT.length === rel.length ? 0 : 1;
  if (MANTER) {
    console.log(`\n[manter] Postgres de pé em ${PG_CONN.host}:${PG_CONN.port} — aponte a API com:\n` +
      `  PGHOST=${PG_CONN.host} PGPORT=${PG_CONN.port} PGUSER=${PG_CONN.user} PGPASSWORD=${PG_CONN.password} PG_TENANT_PREFIX=${PG_CONN.databasePrefix} pnpm --filter @apollo/api dev\n` +
      `Ctrl+C aqui derruba o banco.`);
    await new Promise<never>(() => { /* fica vivo segurando o servidor */ });
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
