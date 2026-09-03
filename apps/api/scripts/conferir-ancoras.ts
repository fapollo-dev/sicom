/**
 * CONTAGENS-ÂNCORA, metade 2 de 2 (passo 4.1 do RUNBOOK-DA-VIRADA): compara o que
 * `tools/cutover/conferir-ancoras.py` contou no ORACLE com o Postgres já carregado.
 *
 * A reconciliação da carga confere CSV → Postgres; esta fecha o outro lado — Oracle → Postgres — que é o número
 * que o cliente reconhece na hora do go/no-go. Onde a extração aplica FILTRO declarado, a diferença é esperada e
 * sai anotada; diferença SEM explicação é parada de virada (sai com código 1).
 *
 *   pnpm --filter @apollo/api exec ts-node --transpile-only scripts/conferir-ancoras.ts [porta]
 *
 * O Postgres precisa estar de pé — é o do `carregar-cutover.ts todas --manter` (porta 5433 por default).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const PORTA = Number(process.argv[2] ?? 5433);
const ARQ = resolve(__dirname, '../../../tools/cutover/ancoras-oracle.json');

async function main() {
  const { host, contagens, com_filtro } = JSON.parse(readFileSync(ARQ, 'utf8')) as {
    host: string; contagens: Record<string, number | null>; com_filtro: string[];
  };
  const filtradas = new Set(com_filtro);
  // a contagem do Oracle AGORA não é a régua certa: entre a extração e esta conferência a loja continuou
  // operando (na primeira rodada deu vendas +6.802, historico_prod +7.915 — um dia de movimento, não perda de
  // carga). A régua é o MANIFESTO: quanto a extração leu. `Oracle agora` fica como terceira coluna, medindo o
  // quanto a base andou — que numa virada real, com o legado congelado, tem de ser ZERO.
  const manifesto: Record<string, number> = {};
  for (const f of ['f0', 'f1', 'f2', 'f3', 'f4']) {
    const arq = resolve(__dirname, `../../../tools/cutover/staging/${f}/_manifesto.json`);
    if (!existsSync(arq)) continue;
    for (const [t, v] of Object.entries(JSON.parse(readFileSync(arq, 'utf8')) as Record<string, any>)) {
      if (v?.linhas != null) manifesto[t] = Number(v.linhas);
    }
  }
  const pool = new Pool({ host: '127.0.0.1', port: PORTA, user: 'apollo', password: 'apollo', database: 'apollo_tenant_pinheirao' });
  const fmt = (n: number) => n.toLocaleString('pt-BR');
  let alerta = 0;
  console.log(`ÂNCORAS · Oracle (${host}) × Postgres (porta ${PORTA})\n`);
  console.log(`${'tabela'.padEnd(20)}${'EXTRAÍDO'.padStart(15)}${'POSTGRES'.padStart(15)}${'ORACLE agora'.padStart(15)}  situação`);
  try {
    for (const [t, o] of Object.entries(contagens)) {
      if (o == null) { console.log(`${t.padEnd(20)}${'ERRO'.padStart(15)}`); alerta++; continue; }
      let p: number;
      try {
        p = Number((await pool.query(`SELECT count(*)::bigint AS n FROM ${t}`)).rows[0].n);
      } catch (e) {
        console.log(`${t.padEnd(20)}${fmt(o).padStart(15)}${'?'.padStart(15)}  ${(e as Error).message.split('\n')[0]}`);
        alerta++; continue;
      }
      const ext = manifesto[t];
      let situacao: string;
      if (ext == null) situacao = 'sem manifesto — não dá para conferir';
      else if (p === ext) {
        const andou = o - ext;
        situacao = andou === 0 ? 'igual (e o legado não andou)' : `igual ao extraído · o legado andou +${fmt(andou)} desde a extração`;
      } else if (filtradas.has(t)) situacao = `diferença ${ext - p} — filtro declarado na extração`;
      else { situacao = `⚠️ CARGA PERDEU ${ext - p} linha(s)`; alerta++; }
      console.log(`${t.padEnd(20)}${(ext != null ? fmt(ext) : '—').padStart(15)}${fmt(p).padStart(15)}${fmt(o).padStart(15)}  ${situacao}`);
    }
  } finally {
    await pool.end();
  }
  console.log(alerta
    ? `\n⛔ PARADA DE VIRADA: ${alerta} âncora(s) com perda na carga`
    : '\n✅ todas as âncoras conferem com o que foi extraído.\n   ⚠️ na virada REAL a coluna "ORACLE agora" tem de ser idêntica à "EXTRAÍDO" — se o legado andou, ele não estava congelado (§1 do runbook).');
  process.exitCode = alerta ? 1 : 0;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
