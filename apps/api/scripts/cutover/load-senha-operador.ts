/**
 * CUTOVER das senhas de OPERADOR — LOADER. Aplica em `operadores.senha_hash` os hashes que o MOTOR já calculou e
 * marca `solicitar_alteracao_senha='S'` (a senha atual entra 1× e a troca é obrigatória no 1º acesso — decisão do
 * épico de AUTH, dossiê uCadUsuarios §5). O loader NÃO hasheia (o hash vem pronto). Client `pg`-like (padrão dos
 * scripts de cutover/smoke). Verificado contra o Postgres de teste (smoke §82).
 *
 * SEGURANÇA (mesmo fold da EMPRESA): por padrão só preenche coluna VAZIA (`senha_hash IS NULL`) — re-rodar NÃO
 * sobrescreve uma senha já trocada pelo operador. `sobrescrever=true` força a regravação (carga inicial deliberada).
 */
import type { SenhaOperadorMigrada } from './senha-operador';

export interface PgLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export async function loadSenhasOperador(
  pg: PgLike,
  migrar: SenhaOperadorMigrada[],
  sobrescrever = false,
): Promise<{ aplicadas: number; ignoradas: number }> {
  let aplicadas = 0;
  let ignoradas = 0; // operador inexistente OU (sem sobrescrever) senha já definida
  for (const m of migrar) {
    const guarda = sobrescrever ? '' : ' AND senha_hash IS NULL';
    const res = await pg.query(
      `UPDATE operadores SET senha_hash = $1, solicitar_alteracao_senha = 'S', dtultimalteracao = now()
       WHERE codoperador = $2${guarda} RETURNING codoperador`,
      [m.hash, m.codoperador],
    );
    if (res.rows.length > 0) aplicadas++;
    else ignoradas++;
  }
  return { aplicadas, ignoradas };
}
