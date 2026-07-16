/**
 * CUTOVER das senhas de operação da EMPRESA — RELATÓRIO + artefato. Lê o JSON cru do extrator (Python, READ-ONLY
 * do Oracle), roda o motor (decode-13 + classifica + re-hasha) e imprime o relatório real (empresas / migradas /
 * vazias / suspeitas). Grava o artefato limpo (empresa×tipo×hash) que o loader consome. A senha EM CLARO nunca é
 * impressa nem persistida (o motor já entrega só hashes). NÃO escreve em banco algum.
 *
 * uso: ts-node scripts/cutover/report-senha-empresa.ts <raw.json> [clean.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { cutoverSenhasEmpresa, type RawEmpresaSenha } from './senha-empresa';

const rawPath = process.argv[2];
const cleanPath = process.argv[3] ?? (rawPath ? rawPath.replace(/\.json$/, '') + '_clean.json' : '');
if (!rawPath) {
  console.error('uso: ts-node report-senha-empresa.ts <raw.json> [clean.json]');
  process.exit(1);
}

const rows = JSON.parse(readFileSync(rawPath, 'utf8')) as RawEmpresaSenha[];
const { migrar, report } = cutoverSenhasEmpresa(rows);
writeFileSync(cleanPath, JSON.stringify(migrar)); // artefato p/ o loader (só hashes — sem senha em claro)

console.log('════════ CUTOVER senhas de operação (EMPRESAS) — relatório real ════════');
console.log(`origem (empresas lidas): ${report.origem}`);
console.log(`empresas válidas:        ${report.empresas}`);
console.log(`senhas migradas (limpas):${report.migradas}  → ${cleanPath}`);
console.log(`senhas em branco:        ${report.vazias}`);
console.log(`senhas SUSPEITAS:        ${report.suspeitas.length}  (decode com controle — corrompidas, admin redefine)`);
console.log(`linhas inválidas:        ${report.invalidas.length}`);
console.log('\n── SUSPEITAS (empresa × tipo; senha em claro NÃO é exibida) ──');
for (const s of report.suspeitas) console.log(`  emp ${s.codempresa} · ${s.tipo}: ${s.motivo}`);
