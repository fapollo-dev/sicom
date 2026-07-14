/**
 * CUTOVER do de-para — RELATÓRIO + artefato limpo. Lê o JSON cru do extrator (Python, READ-ONLY do Oracle),
 * aplica `normRef` ao codbarra do produto (single-source com o runtime), roda o motor de de-dup e imprime o
 * relatório real (16.229 → limpas/descartadas/colisões) + os grupos AMBÍGUOS p/ revisão do operador; grava as
 * linhas limpas num JSON (o artefato que o loader consome no cutover real). NÃO escreve em banco algum.
 *
 * uso: ts-node scripts/cutover/report-codref.ts <raw.json> [clean.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { normRef } from '../../src/modules/compras/codref-normalize';
import { dedupCodref, type RawCodref } from './dedup-codref';

const rawPath = process.argv[2];
const cleanPath = process.argv[3] ?? rawPath.replace(/\.json$/, '') + '_clean.json';
if (!rawPath) {
  console.error('uso: ts-node report-codref.ts <raw.json> [clean.json]');
  process.exit(1);
}

interface RawExtract {
  codreferencia_for: number; idproduto: number | null; codref: string | null; codfor: number | null;
  tiporef: string | null; fator_embalagem: number | null; produto_existe: boolean; produto_ativo: boolean;
  produto_codbarra: string | null; fornecedor_valido: boolean;
}

const rows: RawCodref[] = (JSON.parse(readFileSync(rawPath, 'utf8')) as RawExtract[]).map((r) => ({
  codreferencia_for: r.codreferencia_for,
  idproduto: r.idproduto,
  codref: r.codref,
  codfor: r.codfor,
  tiporef: r.tiporef,
  fator_embalagem: r.fator_embalagem,
  produto_existe: r.produto_existe,
  produto_ativo: r.produto_ativo,
  produto_codbarra_norm: r.produto_codbarra ? normRef(r.produto_codbarra) : null, // normaliza igual ao runtime
  fornecedor_valido: r.fornecedor_valido,
}));

const { keep, report } = dedupCodref(rows);
writeFileSync(cleanPath, JSON.stringify(keep));

// fila de REVISÃO: todos os grupos ambíguos (não só os 15 impressos) — o operador confere o vínculo escolhido.
const revisaoPath = cleanPath.replace(/\.json$/, '') + '_ambiguos.csv';
const csv = ['codfor;codref;escolhido;candidatos'];
for (const g of report.ambiguos) {
  csv.push(`${g.codfor};${g.codref};${g.escolhido};${g.candidatos.map((c) => `${c.idproduto}${c.ativo ? '' : '(inativo)'}`).join('|')}`);
}
writeFileSync(revisaoPath, csv.join('\n'));

console.log('════════ CUTOVER de-para (CODREFERENCIA_FOR) — relatório real ════════');
console.log(`origem:              ${report.origem}`);
console.log(`limpas (migram):     ${report.limpas}  → ${cleanPath}`);
console.log(`descartadas:         sujas=${report.descartadas.sujas}  SEM GTIN=${report.descartadas.semGtin}  colisão(excedentes)=${report.descartadas.colisaoExcedente}`);
console.log(`colisões:            grupos=${report.colisoes.grupos}  auto-resolvidas(codbarra)=${report.colisoes.autoResolvidas}  ambíguas(revisão)=${report.colisoes.ambiguas}`);
console.log(`conferência:         ${report.limpas} + ${report.descartadas.sujas} + ${report.descartadas.semGtin} + ${report.descartadas.colisaoExcedente} = ${report.limpas + report.descartadas.sujas + report.descartadas.semGtin + report.descartadas.colisaoExcedente} (== origem ${report.origem}?)`);
console.log('\n── grupos AMBÍGUOS (tiebreak aplicado; revisar) ──');
for (const g of report.ambiguos.slice(0, 15)) {
  console.log(`  (codfor ${g.codfor}, codref ${g.codref}) → escolhido ${g.escolhido}; candidatos: ${g.candidatos.map((c) => `${c.idproduto}${c.ativo ? '' : '(inativo)'}`).join(', ')}`);
}
if (report.ambiguos.length > 15) console.log(`  … +${report.ambiguos.length - 15} grupos`);
console.log(`\nfila de revisão completa (${report.ambiguos.length} grupos) → ${revisaoPath}`);
