import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { normRef } from './codref-normalize';

type AnyDB = Kysely<any>;

/**
 * DE-PARA de fornecedor (CODREFERENCIA_FOR) — cadastro/manutenção standalone (recebimento corte-5). A tabela é
 * GLOBAL (sem idempresa), mas TODO acesso é ESCOPADO por fornecedor→empresa (decisão de tenant): só de-para de
 * fornecedores da empresa corrente (JOIN parceiros WHERE idempresa=emp). codref normalizado no servidor
 * (normRef — single-source com o match do import). Fornecedor tem de ser FRN='S'. Hard-delete (fiel ao legado).
 */
@Injectable()
export class DeParaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** lista as de-para dos fornecedores DA EMPRESA (opcional filtrar por produto/fornecedor). */
  async listar(filtro: { idproduto?: number; codfor?: number } = {}): Promise<Array<Record<string, unknown>>> {
    let q = (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('codreferencia_for as c')
      .innerJoin('parceiros as p', 'p.codparceiro', 'c.codfor')
      .select([
        'c.codreferencia_for as codreferencia_for', 'c.idproduto as idproduto', 'c.codfor as codfor',
        'c.codref as codref', 'c.tiporef as tiporef', 'c.fator_embalagem as fator_embalagem',
        'p.razao as razao',
        sql<string>`case c.tiporef when 'P' then 'PLU' when 'E' then 'EAN' end`.as('tiporefd'),
      ])
      .where('p.idempresa', '=', this.emp());
    if (filtro.idproduto != null) q = q.where('c.idproduto', '=', filtro.idproduto);
    if (filtro.codfor != null) q = q.where('c.codfor', '=', filtro.codfor);
    return q.orderBy('c.codfor').orderBy('c.codref').limit(1000).execute();
  }

  /** valida que o fornecedor pertence à empresa E é FRN='S' (SegFornecedor). Retorna o codparceiro. */
  private async assertFornecedor(db: AnyDB, codfor: number): Promise<void> {
    const forn = (await db
      .selectFrom('parceiros')
      .select(['codparceiro', 'frn'])
      .where('codparceiro', '=', codfor)
      .where('idempresa', '=', this.emp())
      .executeTakeFirst()) as { frn?: string } | undefined;
    if (!forn || forn.frn !== 'S') throw new BusinessRuleError('DEPARA_FORNECEDOR_INVALIDO', { codfor });
  }

  /** carrega a linha SÓ se o fornecedor dela é da empresa (escopo cross-tenant). */
  private async carregarNoEscopo(db: AnyDB, id: number): Promise<{ codreferencia_for: number; codfor: number }> {
    const row = (await db
      .selectFrom('codreferencia_for as c')
      .innerJoin('parceiros as p', 'p.codparceiro', 'c.codfor')
      .select(['c.codreferencia_for as codreferencia_for', 'c.codfor as codfor'])
      .where('c.codreferencia_for', '=', id)
      .where('p.idempresa', '=', this.emp())
      .executeTakeFirst()) as { codreferencia_for: number; codfor: number } | undefined;
    if (!row) throw new BusinessRuleError('DEPARA_NAO_ENCONTRADO', { codreferencia_for: id });
    return row;
  }

  async criar(dto: { idproduto: number; codfor: number; codref: string; tiporef?: string; fator_embalagem?: number }): Promise<{ codreferencia_for: number }> {
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenant() as AnyDB;
    await this.assertFornecedor(db, dto.codfor);
    const codref = normRef(dto.codref);
    if (!codref) throw new BusinessRuleError('DEPARA_CODREF_INVALIDO', { codref: dto.codref });
    try {
      const ins = (await db
        .insertInto('codreferencia_for')
        .values({ idproduto: dto.idproduto, codfor: dto.codfor, codref, tiporef: dto.tiporef === 'P' ? 'P' : 'E', fator_embalagem: dto.fator_embalagem ?? null, usucadastro: op, usultalteracao: op })
        .returning('codreferencia_for')
        .executeTakeFirstOrThrow()) as { codreferencia_for: number };
      return { codreferencia_for: Number(ins.codreferencia_for) };
    } catch (e) {
      if ((e as { code?: string })?.code === '23505') throw new BusinessRuleError('DEPARA_DUPLICADO', { codfor: dto.codfor, codref });
      if ((e as { code?: string })?.code === '23503') throw new BusinessRuleError('DEPARA_PRODUTO_INVALIDO', { idproduto: dto.idproduto });
      throw e;
    }
  }

  async atualizar(id: number, dto: { codref?: string; tiporef?: string; fator_embalagem?: number }): Promise<{ codreferencia_for: number }> {
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.carregarNoEscopo(trx, id);
      const set: Record<string, unknown> = { usultalteracao: op, dtultimalteracao: sql`now()` };
      if (dto.codref !== undefined) {
        const codref = normRef(dto.codref);
        if (!codref) throw new BusinessRuleError('DEPARA_CODREF_INVALIDO', { codref: dto.codref });
        set.codref = codref;
      }
      if (dto.tiporef !== undefined) set.tiporef = dto.tiporef === 'P' ? 'P' : 'E';
      if (dto.fator_embalagem !== undefined) set.fator_embalagem = dto.fator_embalagem ?? null;
      try {
        await trx.updateTable('codreferencia_for').set(set).where('codreferencia_for', '=', id).execute();
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') throw new BusinessRuleError('DEPARA_DUPLICADO', { codreferencia_for: id });
        throw e;
      }
      return { codreferencia_for: id };
    });
  }

  async remover(id: number): Promise<void> {
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.carregarNoEscopo(trx, id);
      await trx.deleteFrom('codreferencia_for').where('codreferencia_for', '=', id).execute(); // hard-delete (fiel ao legado)
    });
  }
}
