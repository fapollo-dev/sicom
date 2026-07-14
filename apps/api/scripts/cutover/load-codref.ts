/**
 * CUTOVER do de-para — LOADER idempotente. Carrega as linhas LIMPAS (já de-dup'adas pelo motor) em
 * `codreferencia_for` via `INSERT ... ON CONFLICT (codfor, codref) DO UPDATE` — re-executável (re-rodar não
 * duplica; atualiza o vínculo se mudou). Usa um client `pg` (Pool) — o padrão dos scripts (smoke/cutover),
 * portável para o banco do tenant real quando existir. Verificado contra o Postgres de teste (§74).
 */
import type { CleanCodref } from './dedup-codref';

/** client mínimo compatível com pg.Pool/PoolClient. */
export interface PgLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** carrega em lotes; retorna INSERIDOS vs ATUALIZADOS (via xmax=0 do Postgres no ON CONFLICT). Idempotente. */
export async function loadCodref(pg: PgLike, rows: CleanCodref[], operador = 0, tamLote = 500): Promise<{ inseridos: number; atualizados: number; total: number }> {
  let inseridos = 0;
  let atualizados = 0;
  const COLS = 7; // idproduto, codfor, codref, tiporef, fator_embalagem, usucadastro, usultalteracao
  for (let i = 0; i < rows.length; i += tamLote) {
    const lote = rows.slice(i, i + tamLote);
    if (!lote.length) continue;
    const valores: unknown[] = [];
    const tuplas = lote.map((r, j) => {
      const b = j * COLS;
      valores.push(r.idproduto, r.codfor, r.codref, r.tiporef, r.fator_embalagem, operador, operador);
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
    });
    const text = `
      INSERT INTO codreferencia_for (idproduto, codfor, codref, tiporef, fator_embalagem, usucadastro, usultalteracao)
      VALUES ${tuplas.join(',')}
      ON CONFLICT (codfor, codref) DO UPDATE SET
        idproduto = EXCLUDED.idproduto,
        tiporef = EXCLUDED.tiporef,
        fator_embalagem = EXCLUDED.fator_embalagem,
        usultalteracao = EXCLUDED.usultalteracao,
        dtultimalteracao = now()
      RETURNING (xmax = 0) AS inserido`;
    const res = await pg.query(text, valores);
    for (const row of res.rows) (row.inserido ? inseridos++ : atualizados++);
  }
  return { inseridos, atualizados, total: inseridos + atualizados };
}
