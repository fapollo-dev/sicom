/**
 * CUTOVER das senhas de operação da EMPRESA — LOADER. Aplica em `empresas.senha_{tipo}_hash` os hashes que o MOTOR
 * já calculou (o loader NÃO hasheia — o hash vem pronto em `SenhaMigrada.hash`, computado 1× no motor). Usa um
 * client `pg`-like (padrão dos scripts de cutover/smoke), portável p/ o banco do tenant real. O nome da coluna vem
 * de um ALLOWLIST fixo (COLUNA[tipo]) — nunca de input cru (sem SQL-injection). Verificado contra o Postgres de
 * teste (smoke §80).
 *
 * SEGURANÇA (fold da auditoria): por padrão só preenche coluna VAZIA (`... IS NULL`) — assim re-rodar o cutover
 * NÃO sobrescreve uma senha que o admin já redefiniu via `PUT cadastro/senha-operacao` pós go-live. Passe
 * `sobrescrever=true` p/ a carga inicial deliberada (força a regravação). Idempotente nos dois modos.
 */
import type { SenhaMigrada, TipoSenhaEmpresa } from './senha-empresa';

/** client mínimo compatível com pg.Pool/PoolClient. */
export interface PgLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

const COLUNA: Record<TipoSenhaEmpresa, string> = {
  admin: 'senha_admin_hash',
  desc: 'senha_desc_hash',
  cancel: 'senha_cancel_hash',
  gaveta: 'senha_gaveta_hash',
};

/** aplica os hashes; retorna gravadas / empresas afetadas / ignoradas (empresa inexistente OU coluna já preenchida
 * quando sobrescrever=false). `sobrescrever=false` (padrão) preenche só coluna vazia — não clobbera redefinição. */
export async function loadSenhasEmpresa(
  pg: PgLike,
  migrar: SenhaMigrada[],
  operador = 0,
  sobrescrever = false,
): Promise<{ aplicadas: number; empresasAfetadas: number; ignoradas: number }> {
  let aplicadas = 0;
  let ignoradas = 0; // empresa inexistente OU (sem sobrescrever) coluna já preenchida
  const empresas = new Set<number>();
  for (const m of migrar) {
    const col = COLUNA[m.tipo];
    if (!col) {
      ignoradas++;
      continue;
    }
    // col vem do allowlist (4 valores fixos) — seguro interpolar; hash/operador/idempresa são parametrizados.
    // sem sobrescrever: guarda `AND col IS NULL` → não regrava senha já definida (redefinição do admin).
    const guarda = sobrescrever ? '' : ` AND ${col} IS NULL`;
    const res = await pg.query(
      `UPDATE empresas SET ${col} = $1, usultalteracao = $2, dtultimalteracao = now() WHERE idempresa = $3${guarda} RETURNING idempresa`,
      [m.hash, operador, m.idempresa],
    );
    if (res.rows.length > 0) {
      aplicadas++;
      empresas.add(m.idempresa);
    } else {
      ignoradas++;
    }
  }
  return { aplicadas, empresasAfetadas: empresas.size, ignoradas };
}
