import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { MotivoDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * MOTIVOS DO AJUSTE DE ESTOQUE (`FRMMOTIVO`). **10 acessos, 6 operadores.** Dossiê: `uMotivo.md`. Migration 261.
 *
 * A tabela `MOTIVOS` do legado — a que `AJUSTE_ESTOQUE.CODMOTIVO` referencia por FK e a que a tela de ajuste
 * lê no combo (`GET_MOTIVOS`). **Não é `motivos_operacao`** (essa é do scrap): o Apollo tinha a FK do ajuste
 * apontada para a tabela errada, e a 261 reaponta. CadMaster de um campo (DESCRIÇÃO, em maiúsculas), exclusão
 * LÓGICA (`INDR='E'`, como o legado fez com o motivo 41 em 10/03/2025) — o histórico dos ajustes fica íntegro.
 */
@Injectable()
export class MotivosService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private op() { return currentTenant().operadorId ?? null; }

  private sel = sql`
      SELECT m.codmotivo, m.descricao, coalesce(m.indr, 'I') AS indr, m.dtultimalteracao,
             (SELECT count(*) FROM ajuste_estoque a WHERE a.codmotivo = m.codmotivo) AS ajustes
        FROM motivos m`;

  private linha(r: Record<string, unknown>) {
    return { codmotivo: Number(r.codmotivo), descricao: r.descricao, indr: r.indr, ajustes: Number(r.ajustes ?? 0), dtultimalteracao: r.dtultimalteracao ?? null };
  }

  async listar(incluirExcluidos = false) {
    const rows = (await sql<Record<string, unknown>>`${this.sel}
       WHERE (${incluirExcluidos}::boolean OR coalesce(m.indr, 'I') <> 'E')
       ORDER BY m.codmotivo`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
    return rows.map((r) => this.linha(r));
  }

  async obter(id: number) {
    const r = (await sql<Record<string, unknown>>`${this.sel} WHERE m.codmotivo = ${id}`.execute(this.dbp.forTenantRead() as AnyDB)).rows[0];
    if (!r) throw new BusinessRuleError('MOTIVO_NAO_ENCONTRADO', { codmotivo: id });
    return this.linha(r);
  }

  async criar(b: MotivoDto) {
    const r = (await sql<{ codmotivo: unknown }>`
      INSERT INTO motivos (descricao, usultalteracao, dtultimalteracao)
      VALUES (upper(${b.descricao}), ${this.op()}, now()) RETURNING codmotivo`.execute(this.dbp.forTenant() as AnyDB)).rows[0];
    return this.obter(Number(r.codmotivo));
  }

  async atualizar(id: number, b: MotivoDto) {
    const m = await this.obter(id);
    if (m.indr === 'E') throw new BusinessRuleError('MOTIVO_EXCLUIDO', { codmotivo: id });
    await sql`UPDATE motivos SET descricao = upper(${b.descricao}), usultalteracao = ${this.op()}, dtultimalteracao = now() WHERE codmotivo = ${id}`
      .execute(this.dbp.forTenant() as AnyDB);
    return this.obter(id);
  }

  /** exclusão lógica — o motivo sai do combo, os ajustes que o usaram continuam apontando para ele. */
  async excluir(id: number) {
    const m = await this.obter(id);
    if (m.indr === 'E') throw new BusinessRuleError('MOTIVO_EXCLUIDO', { codmotivo: id });
    await sql`UPDATE motivos SET indr = 'E', indr_usuario = ${this.op()}, indr_data = now() WHERE codmotivo = ${id}`.execute(this.dbp.forTenant() as AnyDB);
    return { codmotivo: id, indr: 'E', ajustes: m.ajustes };
  }
}
