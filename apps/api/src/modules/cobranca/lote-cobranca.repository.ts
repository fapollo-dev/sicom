import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError, UnauthorizedTenantError } from '../../shared/errors/app-error';
import type { ItemLoteDto } from '@apollo/shared';

interface HeaderCols {
  codparceiro?: number;
  data?: string;
}

type AnyDB = any;

/**
 * Repository MESTRE-DETALHE (LOTE_COBRANCA + ITENS_LOTECOB).
 * O agregado (header + itens) é gravado/excluído numa ÚNICA transação — espelha
 * `TfrmCadMasterDet` (form-base): valida/grava itens junto do master; exclusão
 * em cascata. (No alvo a transação é escopada ao caso de uso, não global.)
 */
@Injectable()
export class LoteCobrancaRepository {
  constructor(private readonly dbp: DatabaseProvider) {}

  list() {
    return this.dbp.forTenantRead().selectFrom('get_lote_cobranca').selectAll().execute();
  }

  async read(cod: number) {
    const db = this.dbp.forTenantRead();
    const header = await db
      .selectFrom('lote_cobranca')
      .selectAll()
      .where('codlotecob', '=', cod)
      .executeTakeFirst();
    if (!header) return undefined;
    const itens = await db
      .selectFrom('itens_lotecob')
      .select(['codilotcob', 'codrcb'])
      .where('codlotecob', '=', cod)
      .orderBy('codilotcob')
      .execute();
    return { ...header, itens };
  }

  /**
   * Read ENRIQUECIDO (legado-fiel): master + RAZAO do "Cobrador" + itens com TODAS as
   * colunas exibidas no grid (live-join ARECEBER→PARCEIROS→PARCEIROS_END) e JUROS/TOTAL
   * computados pela carência PARCEIROS.TOLERANCIA — lendo a view GET_ITENS_LOTECOB
   * (uDMCadLoteCobranca.dfm). É o que a tela completa consome.
   */
  async readEnriched(cod: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    // master + razao via get_lote_cobranca (LEFT JOIN parceiros) — mantém shape do header.
    const header = await db
      .selectFrom('get_lote_cobranca')
      .select(['codlotecob', 'codparceiro', 'data', 'razao'])
      .where('codlotecob', '=', cod)
      .executeTakeFirst();
    if (!header) return undefined;
    const itens = await db
      .selectFrom('get_itens_lotecob')
      .selectAll()
      .where('codlotecob', '=', cod)
      .orderBy('codilotcob')
      .execute();
    return { ...header, itens };
  }

  /**
   * Valida o "Cobrador": codparceiro DEVE existir em PARCEIROS com FUN='S' (espelha o
   * SegFornecedor do legado, ErrorMessage 'Fornecedor não encontrado…'). Caso contrário,
   * regra de negócio → BusinessRuleError (envelope ADR-015, nunca 500).
   */
  async assertCobradorValido(codparceiro: number): Promise<void> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const row = await db
      .selectFrom('parceiros')
      .select('codparceiro')
      .where('codparceiro', '=', codparceiro)
      .where('fun', '=', 'S')
      .executeTakeFirst();
    if (!row) throw new BusinessRuleError('FORNECEDOR_NAO_ENCONTRADO', { codparceiro });
  }

  /**
   * Lista os "Cobradores" (parceiros FUN='S') para o lookup do campo Cobrador — espelha o
   * F3/SegFornecedor do legado (filtro PARCEIROS.FUN='S'). Retorna codparceiro + razao.
   */
  listCobradores() {
    return (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('parceiros')
      .select(['codparceiro', 'razao'])
      .where('fun', '=', 'S')
      .orderBy('razao')
      .execute();
  }

  /**
   * Picker GET_ARECEBER (btnAddIten → frmPesquisa 'GET_ARECEBER'): documentos disponíveis
   * para adicionar ao lote, SEMPRE escopados à empresa do contexto (fail-closed: sem
   * empresaId, lança). Espelha o filtro legado IDEMPRESA = EmpresaCODEMPRESA e, quando há
   * fechamento de caixa, CONSILIADO='S'. Opcionalmente remove os codrcb já no lote.
   */
  async listAreceber(opts: { consiliado?: 'S' | 'N'; excluirDoLote?: number } = {}) {
    const empresaId = currentTenant().empresaId;
    if (empresaId == null) throw new UnauthorizedTenantError(); // fail-closed (403)
    const db = this.dbp.forTenantRead() as AnyDB;
    let q = db.selectFrom('get_areceber').selectAll().where('codempresa', '=', empresaId);
    if (opts.consiliado) q = q.where('consiliado', '=', opts.consiliado);
    if (opts.excluirDoLote != null) {
      q = q.where(
        'codrcb',
        'not in',
        db.selectFrom('itens_lotecob').select('codrcb').where('codlotecob', '=', opts.excluirDoLote),
      );
    }
    return q.orderBy('codrcb').execute();
  }

  /** Cria o agregado: header + N itens, numa transação. Retorna codlotecob. */
  async create(header: HeaderCols, itens: ItemLoteDto[]): Promise<number> {
    const operadorId = currentTenant().operadorId ?? null;
    return this.dbp.forTenant().transaction().execute(async (trx) => {
      const ins = await trx
        .insertInto('lote_cobranca')
        .values(header as any)
        .returning('codlotecob')
        .executeTakeFirstOrThrow();
      const cod = Number(ins.codlotecob);
      await trx
        .updateTable('lote_cobranca')
        .set({ usultalteracao: operadorId, dtultimalteracao: sql`now()`, dtcadastro: sql`now()` } as any)
        .where('codlotecob', '=', cod)
        .execute();
      if (itens.length) {
        await trx
          .insertInto('itens_lotecob')
          .values(itens.map((i) => ({ codlotecob: cod, codrcb: i.codrcb })))
          .execute();
      }
      return cod;
    });
  }

  /** Atualiza header e SUBSTITUI os itens (delete+insert), numa transação. */
  async update(cod: number, header: HeaderCols, itens: ItemLoteDto[]): Promise<void> {
    const operadorId = currentTenant().operadorId ?? null;
    await this.dbp.forTenant().transaction().execute(async (trx) => {
      if (Object.keys(header).length) {
        await trx.updateTable('lote_cobranca').set(header as any).where('codlotecob', '=', cod).execute();
      }
      await trx
        .updateTable('lote_cobranca')
        .set({ usultalteracao: operadorId, dtultimalteracao: sql`now()` } as any)
        .where('codlotecob', '=', cod)
        .execute();
      await trx.deleteFrom('itens_lotecob').where('codlotecob', '=', cod).execute();
      if (itens.length) {
        await trx
          .insertInto('itens_lotecob')
          .values(itens.map((i) => ({ codlotecob: cod, codrcb: i.codrcb })))
          .execute();
      }
    });
  }

  /** Exclui o agregado em cascata (itens + header). */
  async remove(cod: number): Promise<void> {
    await this.dbp.forTenant().transaction().execute(async (trx) => {
      await trx.deleteFrom('itens_lotecob').where('codlotecob', '=', cod).execute();
      await trx.deleteFrom('lote_cobranca').where('codlotecob', '=', cod).execute();
    });
  }
}
