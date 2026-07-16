import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = any;

/**
 * PERMISSÕES (UCtrlPermissoes) corte-2 — matriz de grants FORM×OPCAO por PERFIL. O catálogo de ações vem do
 * conjunto DISTINCT já existente em PERMISSOES (o universo conhecido de form×opção; não há um registro de forms
 * separado no app). Conceder = inserir a linha (codperfil, form, opcao, codempresa); revogar = apagar.
 * Escopo por empresa (currentTenant). O acesso perfil-aware é ligado no acesso.service (modo 'ambos'/'perfil').
 */
@Injectable()
export class PermissoesService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /**
   * catálogo de ações (form×opção) conhecidas — DISTINCT sobre TODAS as empresas (universo app-wide), NÃO só a
   * corrente (fold auditoria): o universo de form×opção é do APP, não da empresa; filtrar por empresa criava um
   * chicken-and-egg (não dava p/ conceder a uma empresa uma ação sem linha prévia lá — ex. FRMCADBANCOS na emp 2).
   * O grant continua escopado à empresa corrente no setGrant. (Ideal = um registro de menu/forms dedicado, adiado.)
   */
  async catalogo(): Promise<Array<Record<string, unknown>>> {
    return (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('permissoes')
      .select(({ fn }: AnyDB) => ['form', 'opcao', fn.max('caption').as('caption'), fn.max('form_caption').as('form_caption')])
      .groupBy(['form', 'opcao'])
      .orderBy('form')
      .orderBy('opcao')
      .execute();
  }

  /** os grants (form×opção) concedidos a um perfil na empresa corrente. */
  async listarPorPerfil(codperfil: number): Promise<{ codperfil: number; grants: Array<Record<string, unknown>> }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const perf = await db.selectFrom('perfil').select('codperfil').where('codperfil', '=', codperfil).where(sql`coalesce(indr,'I')`, '<>', 'E').executeTakeFirst();
    if (!perf) throw new BusinessRuleError('PERFIL_NAO_ENCONTRADO', { codperfil });
    const grants = await db
      .selectFrom('permissoes')
      .select(['form', 'opcao'])
      .where('codperfil', '=', codperfil)
      .where('codempresa', '=', this.emp())
      .execute();
    return { codperfil, grants };
  }

  /** concede/revoga um grant FORM×OPCAO a um perfil na empresa corrente (presença = concedido, fiel ao legado). */
  async setGrant(codperfil: number, form: string, opcao: string, concedido: boolean): Promise<{ codperfil: number; form: string; opcao: string; concedido: boolean }> {
    const emp = this.emp();
    const f = form.trim().toUpperCase();
    const o = opcao.trim().toUpperCase();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const perf = await trx.selectFrom('perfil').select('codperfil').where('codperfil', '=', codperfil).where(sql`coalesce(indr,'I')`, '<>', 'E').executeTakeFirst();
      if (!perf) throw new BusinessRuleError('PERFIL_NAO_ENCONTRADO', { codperfil });
      // idempotente: apaga qualquer duplicata do par (perfil, form, opcao, empresa) antes de (re)inserir.
      await trx.deleteFrom('permissoes').where('codperfil', '=', codperfil).where(sql`upper(form)`, '=', f).where(sql`upper(opcao)`, '=', o).where('codempresa', '=', emp).execute();
      if (concedido) {
        await trx.insertInto('permissoes').values({ form: f, opcao: o, codperfil, codempresa: emp }).execute();
      }
      return { codperfil, form: f, opcao: o, concedido };
    });
  }
}
