/**
 * CUTOVER das senhas de OPERADOR — RELATÓRIO + artefato. Lê o JSON cru do extrator (Python, READ-ONLY), roda o
 * motor (decode-13 + classifica + re-hasha) e imprime o relatório real (operadores/migradas/vazias/suspeitas). Grava
 * o artefato limpo (codoperador×hash) que o loader consome. A senha em claro nunca é impressa nem persistida.
 *
 * uso: ts-node scripts/cutover/report-senha-operador.ts <raw.json> [clean.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { cutoverSenhasOperador, type RawOperadorSenha } from './senha-operador';

const rawPath = process.argv[2];
const cleanPath = process.argv[3] ?? (rawPath ? rawPath.replace(/\.json$/, '') + '_clean.json' : '');
if (!rawPath) {
  console.error('uso: ts-node report-senha-operador.ts <raw.json> [clean.json]');
  process.exit(1);
}

const rows = JSON.parse(readFileSync(rawPath, 'utf8')) as RawOperadorSenha[];
const { migrar, report } = cutoverSenhasOperador(rows);
writeFileSync(cleanPath, JSON.stringify(migrar)); // só hashes — sem senha em claro

console.log('════════ CUTOVER senhas de OPERADOR — relatório real ════════');
console.log(`origem (operadores):     ${report.origem}`);
console.log(`operadores válidos:      ${report.operadores}`);
console.log(`senhas migradas (limpas):${report.migradas}  → ${cleanPath}`);
console.log(`senhas em branco:        ${report.vazias}`);
console.log(`senhas SUSPEITAS:        ${report.suspeitas.length}`);
console.log(`linhas inválidas:        ${report.invalidas.length}`);
for (const s of report.suspeitas) console.log(`  op ${s.codoperador}: ${s.motivo}`);
