import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { NfLoteDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

export interface NfLoteRow {
  codnfprodlote: number; codnfprod: number; idempresa: number; idproduto: number;
  lote: string | null; dtvalidade: string | null; dtfabricacao: string | null;
}

/**
 * LOTES/VALIDADE de um ITEM da NF — `uNFLoteValidade` (sub-tela do item, aberta pelo `btnLotesValidades` de
 * `uItensNF.pas:1286-1305`). É a segunda porta de `NF_PROD_LOTE`; a primeira é a importação de XML (grupo
 * `rastro`, `recebimento.service.ts`), que grava sem passar por aqui.
 *
 * O que é regra da tela e está copiado (`btnGravarClick`, uNFLoteValidade.pas:142-185):
 *  · lote obrigatório e data de vencimento obrigatória, mensagens literais (no schema);
 *  · **unicidade (LOTE, CODNFPROD) é da TELA**, não do banco (`RetornarValores('NF_PROD_LOTE','LOTE;CODNFPROD')`,
 *    :164 → "Lote já cadastrado para este item de nota fiscal."). O banco não tem índice de propósito (mig 172:
 *    o golden traz 1.833 pares repetidos vindos do XML) — então o que se DIGITA não duplica, o que vem do XML pode;
 *  · empresa, produto e item são carimbados pela tela a partir da nota/item correntes (:176-178), nunca vêm do
 *    usuário; o id é sequência (:181, `GetID`).
 *  · excluir é livre, só com confirmação (:126-140) — a tela não olha PROC nem status da nota.
 * O dataset filtra por `CODNFPROD` (udmNF.dfm:18717-18725).
 */
@Injectable()
export class NfLoteService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** o item tem de ser da nota, e a nota da empresa (fail-closed). Devolve o produto do item. */
  private async item(db: AnyDB, codnf: number, codnfprod: number, emp: number): Promise<{ idproduto: number }> {
    const it = (await db
      .selectFrom('nf_prod as p')
      .innerJoin('nf as n', 'n.codnf', 'p.codnf')
      .select(['p.codproduto'])
      .where('p.codnfprod', '=', codnfprod)
      .where('p.codnf', '=', codnf)
      .where('n.idempresa', '=', emp)
      .executeTakeFirst()) as { codproduto?: number } | undefined;
    if (!it) throw new BusinessRuleError('NF_ITEM_NAO_ENCONTRADO', { codnf, codnfprod });
    return { idproduto: Number(it.codproduto) };
  }

  /** as linhas do item, na conexão de quem chama — dentro da transação o insert recém-feito já aparece. */
  private async linhas(db: AnyDB, codnfprod: number, codnfprodlote?: number): Promise<NfLoteRow[]> {
    let q = db
      .selectFrom('nf_prod_lote')
      .select(['codnfprodlote', 'codnfprod', 'idempresa', 'idproduto', 'lote',
        sql<string | null>`to_char(dtvalidade,'YYYY-MM-DD')`.as('dtvalidade'),
        sql<string | null>`to_char(dtfabricacao,'YYYY-MM-DD')`.as('dtfabricacao')])
      .where('codnfprod', '=', codnfprod);
    if (codnfprodlote != null) q = q.where('codnfprodlote', '=', codnfprodlote);
    return (await q.orderBy('codnfprodlote').execute()) as NfLoteRow[];
  }

  async listar(codnf: number, codnfprod: number): Promise<{ itens: NfLoteRow[] }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.item(db, codnf, codnfprod, emp);
    return { itens: await this.linhas(db, codnfprod) };
  }

  /** "Lote já cadastrado para este item de nota fiscal." — comparação exata da tela (:164). */
  private async assertUnico(db: AnyDB, codnfprod: number, lote: string, ignorar?: number): Promise<void> {
    let q = db.selectFrom('nf_prod_lote').select('codnfprodlote')
      .where('codnfprod', '=', codnfprod).where('lote', '=', lote);
    if (ignorar != null) q = q.where('codnfprodlote', '<>', ignorar);
    if (await q.executeTakeFirst()) throw new BusinessRuleError('NF_LOTE_DUPLICADO', { codnfprod, lote });
  }

  async criar(codnf: number, codnfprod: number, dto: NfLoteDto): Promise<NfLoteRow> {
    const emp = this.emp();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const { idproduto } = await this.item(trx, codnf, codnfprod, emp);
      await this.assertUnico(trx, codnfprod, dto.lote);
      const r = (await trx
        .insertInto('nf_prod_lote')
        .values({ codnfprod, idempresa: emp, idproduto, lote: dto.lote, dtvalidade: sql`${dto.dtvalidade}::date`, dtfabricacao: dto.dtfabricacao ? sql`${dto.dtfabricacao}::date` : null })
        .returning('codnfprodlote')
        .executeTakeFirstOrThrow()) as { codnfprodlote: number };
      return (await this.linhas(trx, codnfprod, Number(r.codnfprodlote)))[0];
    });
  }

  async alterar(codnf: number, codnfprod: number, codnfprodlote: number, dto: NfLoteDto): Promise<NfLoteRow> {
    const emp = this.emp();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.item(trx, codnf, codnfprod, emp);
      await this.assertUnico(trx, codnfprod, dto.lote, codnfprodlote);
      const r = await trx
        .updateTable('nf_prod_lote')
        .set({ lote: dto.lote, dtvalidade: sql`${dto.dtvalidade}::date`, dtfabricacao: dto.dtfabricacao ? sql`${dto.dtfabricacao}::date` : null })
        .where('codnfprodlote', '=', codnfprodlote)
        .where('codnfprod', '=', codnfprod)
        .executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('NF_LOTE_NAO_ENCONTRADO', { codnfprodlote });
      return (await this.linhas(trx, codnfprod, codnfprodlote))[0];
    });
  }

  async excluir(codnf: number, codnfprod: number, codnfprodlote: number): Promise<void> {
    const emp = this.emp();
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.item(trx, codnf, codnfprod, emp);
      const r = await trx.deleteFrom('nf_prod_lote').where('codnfprodlote', '=', codnfprodlote).where('codnfprod', '=', codnfprod).executeTakeFirst();
      if (Number(r?.numDeletedRows ?? 0) === 0) throw new BusinessRuleError('NF_LOTE_NAO_ENCONTRADO', { codnfprodlote });
    });
  }
}
