/**
 * CUTOVER do de-para de fornecedor (CODREFERENCIA_FOR → codreferencia_for) — MOTOR DE DE-DUP (função pura).
 *
 * O legado nunca teve unicidade sobre (CODFOR, CODREF); o app novo tem `UNIQUE (codfor, codref)` (migration
 * 063), mais estrito. Este motor colapsa a ambiguidade do golden (77 grupos / 155 excedentes) de forma
 * DETERMINÍSTICA e AUDITÁVEL, reusando o MESMO `normRef` do runtime (senão a chave do de-para divergiria do
 * match do import de XML). Recon Oracle: 16.229 linhas → 21 sujas + 106 'SEM GTIN' fora; ~16k singletons;
 * 12 colisões auto-resolvem (codref == codbarra do produto); ~47 ambíguas (tiebreak + relatório p/ revisão).
 *
 * É PURO (sem I/O): o extrator (Python, READ-ONLY) enriquece cada linha com o codbarra/ativo do produto e a
 * validade do fornecedor; este motor decide o que migra. O loader aplica `INSERT ... ON CONFLICT` idempotente.
 */
import { normRef } from '../../src/modules/compras/codref-normalize';

/** Linha crua do Oracle já ENRIQUECIDA pelo extrator (joins produtos/parceiros resolvidos). */
export interface RawCodref {
  codreferencia_for: number; // surrogate legado (tiebreak: maior = mais recente)
  idproduto: number | null;
  codref: string | null; // código do fornecedor CRU (ainda não normalizado)
  codfor: number | null;
  tiporef: string | null; // 'E' | 'P' | null
  fator_embalagem: number | null;
  produto_existe: boolean; // idproduto existe em produtos
  produto_ativo: boolean; // produtos.ativo <> 'N'
  produto_codbarra_norm: string | null; // normRef(produtos.codbarra) — p/ auto-resolver colisão
  fornecedor_valido: boolean; // codfor existe em parceiros E frn='S'
}

export interface CleanCodref {
  codfor: number;
  codref: string; // JÁ normalizado (normRef)
  idproduto: number;
  tiporef: 'E' | 'P';
  fator_embalagem: number; // default 1 (98,3% nulo no golden)
  legacy_id: number; // codreferencia_for de origem (rastreabilidade)
}

export interface GrupoAmbiguo {
  codfor: number;
  codref: string;
  escolhido: number; // idproduto mantido (tiebreak)
  candidatos: Array<{ idproduto: number; legacy_id: number; ativo: boolean }>;
}

export interface DedupReport {
  origem: number;
  limpas: number;
  descartadas: { sujas: number; semGtin: number; colisaoExcedente: number };
  colisoes: { grupos: number; autoResolvidas: number; ambiguas: number };
  ambiguos: GrupoAmbiguo[]; // para revisão do operador
}

const SUJA = Symbol('suja');
const SEMGTIN = Symbol('semgtin');

/** motivo de descarte de uma linha (ou null se é candidata válida). */
function motivoDescarte(r: RawCodref): typeof SUJA | typeof SEMGTIN | null {
  if (r.codfor == null || !r.fornecedor_valido) return SUJA;
  if (r.idproduto == null || !r.produto_existe) return SUJA;
  const raw = (r.codref ?? '').trim();
  if (raw.toUpperCase() === 'SEM GTIN') return SEMGTIN; // sentinela textual: N produtos no mesmo balde
  if (normRef(raw) === '') return SUJA; // codref nulo/branco → sem chave de de-para
  return null;
}

/** tiebreak entre candidatos de uma colisão: ativo vence inativo; entre iguais, maior legacy_id (mais recente). */
function melhor(cands: RawCodref[]): RawCodref {
  return [...cands].sort((a, b) => {
    if (a.produto_ativo !== b.produto_ativo) return a.produto_ativo ? -1 : 1;
    return b.codreferencia_for - a.codreferencia_for;
  })[0];
}

export function dedupCodref(rows: RawCodref[]): { keep: CleanCodref[]; report: DedupReport } {
  let sujas = 0;
  let semGtin = 0;
  const validas: RawCodref[] = [];
  for (const r of rows) {
    const m = motivoDescarte(r);
    if (m === SUJA) sujas++;
    else if (m === SEMGTIN) semGtin++;
    else validas.push(r);
  }

  // agrupa pelas linhas válidas por (codfor, codref NORMALIZADO) — a chave da UNIQUE nova.
  const grupos = new Map<string, RawCodref[]>();
  for (const r of validas) {
    const k = `${r.codfor}\u0000${normRef(r.codref ?? '')}`;
    (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(r);
  }

  const keep: CleanCodref[] = [];
  const ambiguos: GrupoAmbiguo[] = [];
  let colisaoExcedente = 0;
  let gruposColisao = 0;
  let autoResolvidas = 0;

  const emitir = (r: RawCodref): CleanCodref => ({
    codfor: r.codfor!,
    codref: normRef(r.codref ?? ''),
    idproduto: r.idproduto!,
    tiporef: r.tiporef === 'P' ? 'P' : 'E', // NULL → 'E' (default do legado)
    fator_embalagem: r.fator_embalagem && r.fator_embalagem > 0 ? r.fator_embalagem : 1,
    legacy_id: r.codreferencia_for,
  });

  for (const cands of grupos.values()) {
    if (cands.length === 1) {
      keep.push(emitir(cands[0]));
      continue;
    }
    // COLISÃO (multi-produto no mesmo codfor+codref)
    gruposColisao++;
    const chave = normRef(cands[0].codref ?? '');
    const porCodbarra = cands.filter((c) => c.produto_codbarra_norm && c.produto_codbarra_norm === chave);
    let escolhido: RawCodref;
    if (porCodbarra.length === 1) {
      // AUTO-RESOLVE: exatamente 1 candidato tem o código como seu PRÓPRIO codbarra → é o dono legítimo.
      escolhido = porCodbarra[0];
      autoResolvidas++;
    } else {
      // AMBÍGUO: tiebreak determinístico + registra p/ revisão do operador.
      escolhido = melhor(porCodbarra.length > 1 ? porCodbarra : cands);
      ambiguos.push({
        codfor: escolhido.codfor!,
        codref: chave,
        escolhido: escolhido.idproduto!,
        candidatos: cands.map((c) => ({ idproduto: c.idproduto!, legacy_id: c.codreferencia_for, ativo: c.produto_ativo })),
      });
    }
    keep.push(emitir(escolhido));
    colisaoExcedente += cands.length - 1;
  }

  return {
    keep,
    report: {
      origem: rows.length,
      limpas: keep.length,
      descartadas: { sujas, semGtin, colisaoExcedente },
      colisoes: { grupos: gruposColisao, autoResolvidas, ambiguas: ambiguos.length },
      ambiguos,
    },
  };
}
