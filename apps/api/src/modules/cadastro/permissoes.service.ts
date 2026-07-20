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
    const ator = currentTenant().operadorId ?? null;
    const f = form.trim().toUpperCase();
    const o = opcao.trim().toUpperCase();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const perf = await trx.selectFrom('perfil').select('codperfil').where('codperfil', '=', codperfil).where(sql`coalesce(indr,'I')`, '<>', 'E').executeTakeFirst();
      if (!perf) throw new BusinessRuleError('PERFIL_NAO_ENCONTRADO', { codperfil });
      // idempotente: apaga qualquer duplicata do par (perfil, form, opcao, empresa) antes de (re)inserir.
      // numDeletedRows>0 ⇒ o grant EXISTIA (p/ auditar só a mudança real, sem query extra).
      const del = await trx.deleteFrom('permissoes').where('codperfil', '=', codperfil).where(sql`upper(form)`, '=', f).where(sql`upper(opcao)`, '=', o).where('codempresa', '=', emp).executeTakeFirst();
      const existia = Number((del as any)?.numDeletedRows ?? 0) > 0;
      if (concedido) {
        await trx.insertInto('permissoes').values({ form: f, opcao: o, codperfil, codempresa: emp }).execute();
      }
      // TRILHA (AUDIT_PERMISSOES): registra só quando o estado MUDA (concede o ausente / revoga o presente),
      // na MESMA transação. TIPO fiel ao legado: 'INSERT'=concede, 'DELETE'=revoga; ATOR = operador da sessão.
      if (concedido !== existia) {
        await trx.insertInto('audit_permissoes').values({
          form: f, opcao: o, codoperador: null, codperfil, codempresa: emp,
          tipo: concedido ? 'INSERT' : 'DELETE', programa: 'ApolloWeb', maquina: null, codoperador_acao: ator,
        }).execute();
      }
      return { codperfil, form: f, opcao: o, concedido };
    });
  }

  /** trilha de auditoria dos grants de um perfil (mais recentes primeiro) — quem alterou o quê e quando. */
  async auditoria(codperfil?: number, limite = 100): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    let q = (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('audit_permissoes as a')
      .leftJoin('perfil as p', 'p.codperfil', 'a.codperfil')
      .leftJoin('operadores as o', 'o.codoperador', 'a.codoperador_acao')
      .select([
        'a.codaudit', 'a.form', 'a.opcao', 'a.codperfil', 'p.perfil as perfil_nome',
        sql`to_char(a.data,'YYYY-MM-DD HH24:MI:SS')`.as('data'), 'a.tipo',
        'a.codoperador_acao', sql`coalesce(o.nome, o.login)`.as('ator_nome'),
      ])
      .where('a.codempresa', '=', emp);
    if (codperfil != null && Number.isFinite(codperfil)) q = q.where('a.codperfil', '=', codperfil);
    const lim = Number.isFinite(limite) && limite > 0 ? Math.min(limite, 500) : 100; // sanitiza (NaN/≤0 → 100)
    return q.orderBy('a.data', 'desc').orderBy('a.codaudit', 'desc').limit(lim).execute();
  }
}
