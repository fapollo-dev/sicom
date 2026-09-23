import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ItensHistoricoContabilDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * OS ITENS DO HISTÓRICO CONTÁBIL — a grade de detalhe do cadastro (`uCadHistoricoContabil.dfm:359`). Mig 294.
 *
 * Cada linha diz qual campo preenche um `*` do texto do razão, **na ordem**. No legado a grade é um dataset
 * aninhado do mestre (`cdsCadHistoricoContabilsqqItens_Historico`) e é gravada junto com ele, a lista inteira;
 * aqui é um recurso próprio do histórico, gravado também como lista inteira numa transação, para não mexer no
 * cadastro do mestre, que já funciona.
 *
 * ⚠️ Mudar a ordem muda o livro: é a ordem dos itens que o razão segue, não o rótulo do template (histórico 62:
 * o CFOP sai no rótulo "CNPJ"). Por isso a tela mostra o texto como vai sair antes de gravar.
 */
@Injectable()
export class HistoricoContabilItensService {
  constructor(private readonly dbp: DatabaseProvider) {}

  async listar(codhistcontabil: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.exigirHistorico(db, codhistcontabil);
    return this.listarCom(db, codhistcontabil);
  }

  async gravar(codhistcontabil: number, dto: ItensHistoricoContabilDto) {
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // trava o mestre: duas gravações da grade ao mesmo tempo misturariam as listas
      await this.exigirHistorico(trx, codhistcontabil, true);
      await trx.deleteFrom('itens_historico_contabil').where('codhistcontabil', '=', codhistcontabil).execute();
      if (dto.itens.length) {
        await trx
          .insertInto('itens_historico_contabil')
          .values(
            dto.itens.map((i) => ({
              codhistcontabil,
              ordem: i.ordem,
              tabela: i.tabela.toUpperCase(),
              campo: i.campo.toUpperCase(),
              tipo_dados: i.tipo_dados ?? null,
              status: i.status,
              usultalteracao: op,
              dtultimalteracao: sql`now()`,
            })),
          )
          .execute();
      }
      return this.listarCom(trx, codhistcontabil);
    });
  }

  private async listarCom(db: AnyDB, codhistcontabil: number) {
    const itens = await db
      .selectFrom('itens_historico_contabil')
      .select(['coditemhistcontabil', 'ordem', 'tabela', 'campo', 'tipo_dados', 'status'])
      .where('codhistcontabil', '=', codhistcontabil)
      .orderBy('ordem')
      .orderBy('coditemhistcontabil')
      .execute();
    return { codhistcontabil, itens };
  }

  private async exigirHistorico(db: AnyDB, codhistcontabil: number, travar = false) {
    let q = db.selectFrom('historico_contabil').select('codhistcontabil').where('codhistcontabil', '=', codhistcontabil);
    if (travar) q = q.forUpdate();
    const h = await q.executeTakeFirst();
    if (!h) throw new BusinessRuleError('HISTORICO_CONTABIL_NAO_ENCONTRADO', { codhistcontabil });
  }
}
