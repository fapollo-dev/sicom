/**
 * HISTORICO_DINAMICO — auditoria genérica de mudança de campo do form-base
 * (SetaHistorico_Dinamico). Helper compartilhado: tanto o engine CRUD declarativo
 * quanto os verticais hand-written (ex.: BANCOS) gravam pelo MESMO caminho, na
 * MESMA transação da escrita. Estrutura espelha a tabela real do legado.
 */
import { sql } from 'kysely';

// Kysely sem schema fixo (multi-tabela genérico) — mesmo padrão do engine.
type AnyDB = any;

export interface HistoricoAlvo {
  /** tabela física, ex.: 'bancos' (gravada em maiúsculas, como no legado) */
  tabela: string;
  /** coluna-chave, ex.: 'codbco' */
  pk: string;
  /** origem (nome do form), ex.: 'FRMCADBANCOS' */
  origem: string;
}

/** stringifica e trunca para 20 (limite do VALOR_* do legado). null/undefined → null. */
function hv(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v).slice(0, 20);
}

/**
 * Grava 1 linha por campo alterado (diff anterior×atual). Diferença é detectada
 * sobre as colunas presentes em `atual` (as que a escrita tocou).
 */
export async function gravarHistorico(
  trx: AnyDB,
  alvo: HistoricoAlvo,
  id: number,
  operador: number | null,
  empresa: number | null,
  anterior: Record<string, unknown>,
  atual: Record<string, unknown>,
  descricao: string,
): Promise<void> {
  const linhas = Object.keys(atual)
    .filter((c) => String(anterior[c] ?? '') !== String(atual[c] ?? ''))
    .map((c) => ({
      campo: c.toUpperCase(),
      valor_anterior: hv(anterior[c]),
      valor_atual: hv(atual[c]),
      tabela: alvo.tabela.toUpperCase(),
      codoperador: operador,
      chave: alvo.pk.toUpperCase(),
      valor_chave: String(id),
      codempresa: empresa,
      historico: descricao,
      origem: alvo.origem,
    }));
  if (linhas.length) await trx.insertInto('historico_dinamico').values(linhas).execute();
}

/** marca única (ex.: DELETE) — SetaHistorico_Dinamico(...,'DELETE'). */
export async function gravarHistoricoMarca(
  trx: AnyDB,
  alvo: HistoricoAlvo,
  id: number,
  operador: number | null,
  empresa: number | null,
  descricao: string,
): Promise<void> {
  await trx
    .insertInto('historico_dinamico')
    .values({
      campo: null,
      valor_anterior: null,
      valor_atual: null,
      tabela: alvo.tabela.toUpperCase(),
      codoperador: operador,
      chave: alvo.pk.toUpperCase(),
      valor_chave: String(id),
      codempresa: empresa,
      historico: descricao,
      origem: alvo.origem,
    })
    .execute();
}

// re-export sql para manter coesão (helpers de auditoria/now usam-no nos chamadores)
export { sql };
