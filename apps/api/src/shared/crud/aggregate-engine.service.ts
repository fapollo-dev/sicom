import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { CrudEngineService } from './crud-engine.service';
import type { AggregateConfig, DetalheConfig } from './crud-config';
import { currentTenant } from '../tenant/tenant-context';
import { gravarHistorico, gravarHistoricoMarca } from './historico';

type AnyDB = any;

/**
 * Engine MESTRE-DETALHE declarativo — estende o engine base e grava o AGREGADO
 * (header + N detalhes) numa ÚNICA transação, com auditoria/histórico/outbox do
 * master herdados. Espelha o `TfrmCadMasterDet` (recon §5b): itens junto do master,
 * substituição de itens no update, exclusão em cascata em código (não via FK do banco).
 */
@Injectable()
export class AggregateEngineService extends CrudEngineService {
  /** read do agregado: master + cada detalhe (itens) anexados por chave. */
  async readAggregate(cfg: AggregateConfig, id: number) {
    const master = await this.read(cfg, id);
    if (!master) return undefined;
    const db = this.dbp.forTenantRead() as AnyDB;
    const out: Record<string, unknown> = { ...(master as Record<string, unknown>) };
    for (const det of cfg.detalhes) {
      out[det.chave] = await db
        .selectFrom(det.tabela)
        .select([det.pk, det.fk, ...det.colunas])
        .where(det.fk, '=', id)
        .orderBy(det.pk)
        .execute();
    }
    return out;
  }

  /** cria o agregado: master (delta+stamp+histórico+outbox) + itens, numa transação. */
  async createAggregate(cfg: AggregateConfig, dto: Record<string, unknown>): Promise<number> {
    const op = currentTenant().operadorId ?? null;
    if (cfg.validar) await cfg.validar({ dto, db: this.dbp.forTenantRead() }); // regra cross-row antes de gravar
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const d = this.delta(cfg, this.derivados(cfg, dto, cfg.pkGerada === false ? Number(dto[cfg.pk]) : undefined));
      // carimba o escopo de empresa (multi-tenant) — fail-closed se ausente (igual ao create base).
      if (cfg.empresaScoped) d.idempresa = this.emp();
      // derivação assíncrona/transacional (ex.: auto-numeração NRONF = MAX+1) — dentro da trx, atômica.
      if (cfg.derivarTrx) Object.assign(d, await cfg.derivarTrx({ dto: d, trx, emp: this.emp() }));
      let id: number;
      if (cfg.pkGerada === false) {
        id = Number(dto[cfg.pk]);
        await trx.insertInto(cfg.tabela).values({ ...d, [cfg.pk]: id }).execute();
      } else {
        const ins = await trx.insertInto(cfg.tabela).values(d).returning(cfg.pk).executeTakeFirstOrThrow();
        id = Number((ins as Record<string, unknown>)[cfg.pk]);
      }
      await this.stamp(trx, cfg, id, op, true);
      if (cfg.historico !== false) await gravarHistorico(trx, this.alvo(cfg), id, op, this.emp(), {}, d, 'INSERT');
      if (cfg.replica) await this.outbox(trx, cfg, 'INSERT', id);
      for (const det of cfg.detalhes) await this.inserirItens(trx, det, id, this.itens(dto, det));
      return id;
    });
  }

  /** atualiza o master (delta+stamp+histórico+outbox) e SUBSTITUI os itens, numa transação. */
  async updateAggregate(cfg: AggregateConfig, id: number, dto: Record<string, unknown>): Promise<void> {
    const op = currentTenant().operadorId ?? null;
    if (cfg.validar) await cfg.validar({ dto, id, db: this.dbp.forTenantRead() }); // regra cross-row antes de gravar
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // escopo multi-tenant (fail-closed): guarda master E cascata de detalhes (que deletam por fk).
      if (!(await this.pertenceAEmpresa(trx, cfg, id))) return;
      const d = this.delta(cfg, this.derivados(cfg, dto, id)); // derivar (ex.: flags COMPOSICAO/DECOMPOSICAO) também no update
      const antes =
        cfg.historico === false || !Object.keys(d).length
          ? {}
          : ((await trx.selectFrom(cfg.tabela).selectAll().where(cfg.pk, '=', id).executeTakeFirst()) ?? {});
      if (Object.keys(d).length) await trx.updateTable(cfg.tabela).set(d).where(cfg.pk, '=', id).execute();
      await this.stamp(trx, cfg, id, op, false);
      if (cfg.historico !== false)
        await gravarHistorico(trx, this.alvo(cfg), id, op, this.emp(), antes as Record<string, unknown>, d, 'UPDATE');
      if (cfg.replica) await this.outbox(trx, cfg, 'UPDATE', id);
      // substituição de itens (delete + insert), por detalhe — só quando o dto traz a chave
      for (const det of cfg.detalhes) {
        if (dto[det.chave] === undefined) continue;
        let itens = this.itens(dto, det);
        // colunas OWNED pelo banco (ex.: estoque.qtde, movido pela NF/F3): preserva o valor
        // ATUAL do banco em vez de regravar o (possivelmente obsoleto) valor do cliente —
        // evita LOST-UPDATE do saldo quando um save de cadastro interleava com um movimento.
        if (det.preservar?.length && det.chaveNatural?.length) {
          itens = await this.preservarColunas(trx, det, id, itens);
        }
        await trx.deleteFrom(det.tabela).where(det.fk, '=', id).execute();
        await this.inserirItens(trx, det, id, itens);
      }
    });
  }

  /**
   * Para cada item, sobrescreve as colunas `preservar` com o valor da linha EXISTENTE no banco
   * (casada por `chaveNatural` dentro da fk), lida COM LOCK (`forUpdate`) na mesma transação.
   * Assim o substitute não clobbera valores owned por outro processo (ex.: estoque.qtde da NF).
   * Itens sem linha existente (nova) ficam com o valor do dto.
   */
  private async preservarColunas(
    trx: AnyDB,
    det: DetalheConfig,
    masterId: number,
    itens: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const cols = [...(det.chaveNatural ?? []), ...(det.preservar ?? [])];
    const existentes = await trx
      .selectFrom(det.tabela)
      .select(cols)
      .where(det.fk, '=', masterId)
      .forUpdate()
      .execute();
    const mapa = new Map<string, Record<string, unknown>>();
    for (const e of existentes as Record<string, unknown>[]) mapa.set(this.chaveNat(det, e), e);
    return itens.map((it) => {
      const ex = mapa.get(this.chaveNat(det, it));
      if (!ex) return it; // linha nova → mantém o valor do dto (saldo inicial)
      const out = { ...it };
      for (const c of det.preservar ?? []) out[c] = ex[c]; // owned pelo banco → preserva
      return out;
    });
  }

  private chaveNat(det: DetalheConfig, row: Record<string, unknown>): string {
    return (det.chaveNatural ?? []).map((c) => String(row[c])).join('|');
  }

  /** exclui o agregado em CASCATA (itens primeiro, depois master), numa transação. */
  async removeAggregate(cfg: AggregateConfig, id: number): Promise<void> {
    if (cfg.validarRemocao) await cfg.validarRemocao({ id, db: this.dbp.forTenantRead() }); // guarda de exclusão (cross-row)
    const op = currentTenant().operadorId ?? null;
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // escopo multi-tenant (fail-closed): guarda master E cascata de detalhes (que deletam por fk).
      if (!(await this.pertenceAEmpresa(trx, cfg, id))) return;
      // cascata em código (como TfrmCadMasterDet) — não depende do ON DELETE CASCADE
      for (const det of cfg.detalhes) await trx.deleteFrom(det.tabela).where(det.fk, '=', id).execute();
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

  private itens(dto: Record<string, unknown>, det: DetalheConfig): Record<string, unknown>[] {
    const arr = dto[det.chave];
    return Array.isArray(arr) ? (arr as Record<string, unknown>[]) : [];
  }

  private async inserirItens(trx: AnyDB, det: DetalheConfig, masterId: number, itens: Record<string, unknown>[]) {
    if (!itens.length) return;
    const linhas = itens.map((i) => {
      const row: Record<string, unknown> = { [det.fk]: masterId };
      for (const c of det.colunas) if (i[c] !== undefined) row[c] = i[c];
      return row;
    });
    await trx.insertInto(det.tabela).values(linhas).execute();
  }
}
