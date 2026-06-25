import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../database/database.provider';
import { currentTenant } from '../tenant/tenant-context';
import type { CrudConfig, PesquisaQuery } from './crud-config';
import { gravarHistorico, gravarHistoricoMarca, type HistoricoAlvo } from './historico';

type AnyDB = Kysely<any>;

/**
 * Engine CRUD genérico: implementa, a partir de uma CrudConfig, o mesmo contrato
 * que o form-base TfrmCadMaster dá a toda tela — sem o vertical copiado por entidade.
 * Herda: carimbo de auditoria, soft/hard-delete, outbox de replicação, view de listagem.
 * (As convenções de coluna são uniformes no legado: usultalteracao/dtultimalteracao/
 * dtcadastro; indr/indr_usuario/indr_data; por isso um engine genérico serve.)
 */
@Injectable()
export class CrudEngineService {
  constructor(protected readonly dbp: DatabaseProvider) {}

  protected delta(cfg: CrudConfig, dto: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const c of cfg.colunas) if (dto[c] !== undefined) out[c] = dto[c];
    return out;
  }

  /** aplica campos derivados (BeforePost do legado) sobre o dto antes do delta. */
  protected derivados(cfg: CrudConfig, dto: Record<string, unknown>, id?: number): Record<string, unknown> {
    return cfg.derivar ? { ...dto, ...cfg.derivar(dto, id) } : dto;
  }

  read(cfg: CrudConfig, id: number) {
    let q = (this.dbp.forTenantRead() as AnyDB)
      .selectFrom(cfg.tabela)
      .selectAll()
      .where(cfg.pk, '=', id);
    // paridade BR-05/G-05: carregar por código NÃO reabre registro excluído (INDR='E').
    if (cfg.softDelete) q = q.where(sql`coalesce(indr, 'I')`, '<>', 'E');
    return q.executeTakeFirst();
  }

  /** Listagem da Pesquisa: filtro campo+operador+valor + ordenação, sobre a view GET_*. */
  list(cfg: CrudConfig, query?: PesquisaQuery) {
    let q = (this.dbp.forTenantRead() as AnyDB).selectFrom(cfg.view).selectAll();

    // filtro rdgAtivo (F6): ativos (INDR='I') · inativos (INDR='E') · todos.
    // 'incluirExcluidos' do legado mapeia para 'todos'.
    if (cfg.softDelete) {
      const situacao = query?.situacao ?? (query?.incluirExcluidos ? 'todos' : 'ativos');
      if (situacao === 'ativos') q = q.where(sql`coalesce(indr, 'I')`, '=', 'I');
      else if (situacao === 'inativos') q = q.where(sql`coalesce(indr, 'I')`, '=', 'E');
      // 'todos' → sem filtro de situação
    }

    // filtro campo+operador+valor (campo SEMPRE em whitelist — anti-injection)
    const cols = cfg.colunasPesquisa ?? [];
    if (query?.campo && query.valor != null && query.valor !== '' && cols.includes(query.campo)) {
      const col = sql.ref(query.campo);
      const v = query.valor;
      switch (query.operador ?? 'contem') {
        case 'contem':
          q = q.where(sql`upper(${col})`, 'like', `%${v.toUpperCase()}%`);
          break;
        case 'comeca':
          q = q.where(sql`upper(${col})`, 'like', `${v.toUpperCase()}%`);
          break;
        case 'igual':
          q = q.where(col as any, '=', v);
          break;
        case 'diferente':
          q = q.where(col as any, '<>', v);
          break;
        case 'maior':
          q = q.where(col as any, '>', v);
          break;
        case 'menor':
          q = q.where(col as any, '<', v);
          break;
      }
    }

    // ordenação (coluna em whitelist)
    if (query?.orderBy && cols.includes(query.orderBy)) {
      q = q.orderBy(sql.ref(query.orderBy), query.orderDir === 'desc' ? 'desc' : 'asc');
    }

    q = q.limit(Math.min(query?.limite ?? 200, 500)); // teto de segurança
    return q.execute();
  }

  async create(cfg: CrudConfig, dto: Record<string, unknown>): Promise<number> {
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx) => {
      const d = this.delta(cfg, this.derivados(cfg, dto, cfg.pkGerada === false ? Number(dto[cfg.pk]) : undefined));
      let id: number;
      if (cfg.pkGerada === false) {
        // chave natural: a PK vem do dto (usuário digitou); insere junto, sem sequence.
        id = Number(dto[cfg.pk]);
        await trx.insertInto(cfg.tabela).values({ ...d, [cfg.pk]: id }).execute();
      } else {
        const ins = await trx
          .insertInto(cfg.tabela)
          .values(d)
          .returning(cfg.pk)
          .executeTakeFirstOrThrow();
        id = Number((ins as Record<string, unknown>)[cfg.pk]);
      }
      await this.stamp(trx, cfg, id, op, true);
      if (cfg.historico !== false) await gravarHistorico(trx, this.alvo(cfg), id, op, this.emp(), {}, d, 'INSERT');
      if (cfg.replica) await this.outbox(trx, cfg, 'INSERT', id);
      return id;
    });
  }

  async update(cfg: CrudConfig, id: number, dto: Record<string, unknown>): Promise<void> {
    const op = currentTenant().operadorId ?? null;
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx) => {
      const d = this.delta(cfg, this.derivados(cfg, dto, id));
      // lê o estado anterior ANTES do update (diff campo-a-campo p/ o histórico)
      const antes =
        cfg.historico === false || !Object.keys(d).length
          ? {}
          : ((await trx.selectFrom(cfg.tabela).selectAll().where(cfg.pk, '=', id).executeTakeFirst()) ?? {});
      if (Object.keys(d).length) await trx.updateTable(cfg.tabela).set(d).where(cfg.pk, '=', id).execute();
      await this.stamp(trx, cfg, id, op, false);
      if (cfg.historico !== false)
        await gravarHistorico(trx, this.alvo(cfg), id, op, this.emp(), antes as Record<string, unknown>, d, 'UPDATE');
      if (cfg.replica) await this.outbox(trx, cfg, 'UPDATE', id);
    });
  }

  async remove(cfg: CrudConfig, id: number): Promise<void> {
    const op = currentTenant().operadorId ?? null;
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx) => {
      if (cfg.softDelete) {
        await trx
          .updateTable(cfg.tabela)
          .set({ indr: 'E', indr_usuario: op, indr_data: sql`now()` })
          .where(cfg.pk, '=', id)
          .execute();
      } else {
        await trx.deleteFrom(cfg.tabela).where(cfg.pk, '=', id).execute();
      }
      if (cfg.historico !== false) await gravarHistoricoMarca(trx, this.alvo(cfg), id, op, this.emp(), 'DELETE');
      if (cfg.replica) await this.outbox(trx, cfg, 'DELETE', id);
    });
  }

  protected async stamp(trx: AnyDB, cfg: CrudConfig, id: number, op: number | null, isInsert: boolean) {
    if (cfg.audit === false) return;
    await trx
      .updateTable(cfg.tabela)
      .set({
        usultalteracao: op,
        dtultimalteracao: sql`now()`,
        ...(isInsert ? { dtcadastro: sql`now()` } : {}),
      })
      .where(cfg.pk, '=', id)
      .execute();
  }

  /** alvo do histórico a partir da config (tabela/pk/origem). */
  protected alvo(cfg: CrudConfig): HistoricoAlvo {
    return { tabela: cfg.tabela, pk: cfg.pk, origem: cfg.rbacForm };
  }
  protected emp(): number | null {
    return currentTenant().empresaId ?? null;
  }

  protected async outbox(trx: AnyDB, cfg: CrudConfig, tipo: 'INSERT' | 'UPDATE' | 'DELETE', id: number) {
    const tab = cfg.tabela.toUpperCase();
    await trx
      .insertInto('outbox')
      .values({
        tipo,
        tabela: tab,
        chave: id,
        campochave: cfg.pk.toUpperCase(),
        instrucao:
          tipo === 'DELETE'
            ? `DELETE FROM ${tab} WHERE ${cfg.pk.toUpperCase()} =${id}`
            : `SELECT * FROM ${tab} WHERE ${cfg.pk.toUpperCase()} =${id}`,
      })
      .execute();
  }
}
