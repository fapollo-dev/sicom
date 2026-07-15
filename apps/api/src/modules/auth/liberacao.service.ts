import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';

type AnyDB = any;

/**
 * OPERADORES — LIBERAÇÃO por supervisor (uCadUsuarios §29). Corte-1: registro + consulta do LOG_LIBERACOES.
 * `registrar` grava 1 evento de liberação (grant OU negação); `listar` é a consulta auditável. O cadastro de
 * quem-libera (corte-2) e o `validar` (re-autenticação do supervisor, corte-3) reusam este serviço.
 * Schema-global (fiel ao legado — LOG_LIBERACOES não tem coluna de empresa).
 */
@Injectable()
export class LiberacaoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  /** grava um evento de liberação. usuarioLiberou = CÓDIGO do autorizador como string (fiel ao golden). */
  async registrar(
    trx: AnyDB,
    dados: { usuarioSistema?: number | null; usuarioLiberou: string; liberacao: string; computador?: string | null; estacao?: string | null },
  ): Promise<void> {
    await trx
      .insertInto('log_liberacoes')
      .values({
        usuario_sistema: dados.usuarioSistema ?? null,
        usuario_liberou: String(dados.usuarioLiberou).slice(0, 200),
        usuario_estacao: dados.estacao != null ? String(dados.estacao).slice(0, 200) : null,
        liberacao: String(dados.liberacao).slice(0, 1020),
        computador: dados.computador != null ? String(dados.computador).slice(0, 200) : null,
      })
      .execute();
  }

  /** consulta auditável (filtro por período + ação). Ordena do mais recente; teto de 500 linhas. */
  async listar(filtro: { dataInicial?: string; dataFinal?: string; liberacao?: string } = {}): Promise<Array<Record<string, unknown>>> {
    let q = (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('log_liberacoes')
      .select(['id', 'usuario_sistema', 'usuario_liberou', 'usuario_estacao', 'liberacao', 'computador', sql<string>`to_char(data_liberacao, 'YYYY-MM-DD"T"HH24:MI:SS')`.as('data_liberacao')]);
    if (filtro.dataInicial) q = q.where(sql`data_liberacao::date`, '>=', filtro.dataInicial);
    if (filtro.dataFinal) q = q.where(sql`data_liberacao::date`, '<=', filtro.dataFinal);
    if (filtro.liberacao) q = q.where('liberacao', 'ilike', `%${filtro.liberacao}%`);
    return q.orderBy('data_liberacao', 'desc').limit(500).execute();
  }
}
