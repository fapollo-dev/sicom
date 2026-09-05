import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = any;

/**
 * PERMISSÕES (`FRMCTRLPERMISSOES`) — matriz de grants FORM×OPCAO. Dossiê: `uCtrlPermissoes.md`.
 *
 * ⚠️ o corte-2 só sabia conceder por PERFIL, e o cliente concede por **OPERADOR**: a config
 * `CONTROLE_PERMISSOES` vale 'Usuario' em produção, com 55.251 linhas por operador contra 2.438 por perfil (que
 * nesse modo o legado nem consulta, `udmPrincipal.pas:2698-2714`). Sem o caminho por operador, o administrador
 * não conseguiria dar nem tirar acesso de ninguém depois da virada. Corte-3 fecha isso.
 *
 * Regras do legado que valem para os dois caminhos:
 *  · a chave é (form, opção, operador|perfil, **empresa**) e a verificação é fail-closed (`:3971-4000`);
 *  · sem opção, a opção é o próprio nome do formulário — o "gate da tela" (`:3976`);
 *  · **exclusividade**: `Operador := iif(tipo=Perfil,0,Operador); CodPerfil := iif(Operador=0,CodPerfil,0)`
 *    (`uCtrlPermissoes.pas:314-315`) — uma linha nunca tem operador E perfil;
 *  · a gravação leva **CAPTION** (rótulo do botão) e **FORM_CAPTION** (nome da tela), `:331-332`. O rótulo mora
 *    no dado, e é o que a tela mostra; sem ele a linha aparece sem nome.
 *
 * O catálogo de ações vem do DISTINCT já existente em PERMISSOES (o universo conhecido de form×opção; não há um
 * registro de forms separado no app). Conceder = inserir a linha; revogar = apagar. O acesso perfil-aware é
 * ligado no acesso.service (modo 'ambos'/'perfil').
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

  // ── CORTE-3: o caminho por OPERADOR, que é o do cliente ───────────────────────────────────────────────────

  /** empresa do pedido: a tela do legado tem seletor (`cbbEmpresaChange`); ausente = a da sessão. */
  private empDe(codempresa?: number): number {
    return codempresa != null && Number.isFinite(codempresa) ? Number(codempresa) : this.emp();
  }

  private async assertOperador(db: AnyDB, codoperador: number): Promise<void> {
    const op = await db.selectFrom('operadores').select('codoperador').where('codoperador', '=', codoperador)
      .where(sql`coalesce(indr,'I')`, '<>', 'E').executeTakeFirst();
    if (!op) throw new BusinessRuleError('OPERADOR_NAO_ENCONTRADO', { codoperador });
  }

  /** os grants de um OPERADOR numa empresa. */
  async listarPorOperador(codoperador: number, codempresa?: number): Promise<{ codoperador: number; codempresa: number; grants: Array<Record<string, unknown>> }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.assertOperador(db, codoperador);
    const emp = this.empDe(codempresa);
    const grants = await db.selectFrom('permissoes').select(['form', 'opcao'])
      .where('codoperador', '=', codoperador).where('codempresa', '=', emp).execute();
    return { codoperador, codempresa: emp, grants };
  }

  /** rótulos conhecidos de um par (o catálogo já os traz; aqui é para gravar junto, como o legado faz). */
  private async rotulos(db: AnyDB, form: string, opcao: string): Promise<{ caption: string | null; form_caption: string | null }> {
    const r = await db.selectFrom('permissoes')
      .select(({ fn }: AnyDB) => [fn.max('caption').as('caption'), fn.max('form_caption').as('form_caption')])
      .where(sql`upper(form)`, '=', form).where(sql`upper(opcao)`, '=', opcao).executeTakeFirst();
    return { caption: (r?.caption as string) ?? null, form_caption: (r?.form_caption as string) ?? null };
  }

  /**
   * concede/revoga um grant a um OPERADOR (presença = concedido, fiel ao legado). Grava CAPTION/FORM_CAPTION
   * quando o catálogo os conhece — sem isso a linha aparece sem rótulo na tela (nossa e a do legado).
   */
  async setGrantOperador(dto: { codoperador: number; form: string; opcao: string; concedido: boolean; codempresa?: number }): Promise<{ codoperador: number; codempresa: number; form: string; opcao: string; concedido: boolean }> {
    const emp = this.empDe(dto.codempresa);
    const ator = currentTenant().operadorId ?? null;
    const f = dto.form.trim().toUpperCase();
    const o = dto.opcao.trim().toUpperCase();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.assertOperador(trx, dto.codoperador);
      const del = await trx.deleteFrom('permissoes').where('codoperador', '=', dto.codoperador)
        .where(sql`upper(form)`, '=', f).where(sql`upper(opcao)`, '=', o).where('codempresa', '=', emp).executeTakeFirst();
      const existia = Number((del as any)?.numDeletedRows ?? 0) > 0;
      if (dto.concedido) {
        const { caption, form_caption } = await this.rotulos(trx, f, o);
        // codperfil FICA NULO: a exclusividade do legado (:314-315) é operador OU perfil, nunca os dois.
        await trx.insertInto('permissoes').values({ form: f, opcao: o, codoperador: dto.codoperador, codempresa: emp, caption, form_caption }).execute();
      }
      if (dto.concedido !== existia) {
        await trx.insertInto('audit_permissoes').values({
          form: f, opcao: o, codoperador: dto.codoperador, codperfil: null, codempresa: emp,
          tipo: dto.concedido ? 'INSERT' : 'DELETE', programa: 'ApolloWeb', maquina: null, codoperador_acao: ator,
        }).execute();
      }
      return { codoperador: dto.codoperador, codempresa: emp, form: f, opcao: o, concedido: dto.concedido };
    });
  }

  /**
   * MARCAR/DESMARCAR EM LOTE (`btnMarcarTodosFormClick` :472 · `btnMarcarTodosOpcoesClick` :516).
   * `form` presente = todas as opções daquele formulário; ausente = o catálogo inteiro.
   *
   * ⚠️ QUIRK COPIADO: ao marcar TODOS, o legado **exclui os formulários do menu INDÚSTRIA** quando a empresa não
   * é `SEGMENTO='INDUSTRIA'` (`:478-493`) — "marcar todos" nunca dá as telas de indústria a um supermercado.
   * Aqui o filtro é pelo prefixo/nome do formulário, porque não temos a árvore de menu do legado; está declarado
   * como aproximação e não como cópia da árvore.
   */
  async setLote(dto: { codoperador?: number; codperfil?: number; form?: string; concedido: boolean; codempresa?: number }): Promise<{ alterados: number; ignorados_industria: number }> {
    const emp = this.empDe(dto.codempresa);
    const ator = currentTenant().operadorId ?? null;
    const porOperador = dto.codoperador != null;
    const alvo = porOperador ? Number(dto.codoperador) : Number(dto.codperfil);
    const db = this.dbp.forTenantRead() as AnyDB;
    if (porOperador) await this.assertOperador(db, alvo);

    const segmento = ((await db.selectFrom('empresas').select('segmento').where('idempresa', '=', emp).executeTakeFirst()) as { segmento?: string } | undefined)?.segmento ?? null;
    const industrial = String(segmento ?? '').toUpperCase() === 'INDUSTRIA';

    let pares = (await this.catalogo()) as Array<{ form: string; opcao: string; caption: string | null; form_caption: string | null }>;
    if (dto.form) {
      const f = dto.form.trim().toUpperCase();
      pares = pares.filter((p) => String(p.form).toUpperCase() === f);
    }
    let ignorados = 0;
    if (!dto.form && !industrial) {
      const antes = pares.length;
      pares = pares.filter((p) => !/INDUSTRIA|PRODUCAO_IND/i.test(`${p.form} ${p.form_caption ?? ''}`));
      ignorados = antes - pares.length;
    }

    let alterados = 0;
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      for (const p of pares) {
        const f = String(p.form).toUpperCase();
        const o = String(p.opcao).toUpperCase();
        const col = porOperador ? 'codoperador' : 'codperfil';
        const del = await trx.deleteFrom('permissoes').where(col, '=', alvo)
          .where(sql`upper(form)`, '=', f).where(sql`upper(opcao)`, '=', o).where('codempresa', '=', emp).executeTakeFirst();
        const existia = Number((del as any)?.numDeletedRows ?? 0) > 0;
        if (dto.concedido) {
          await trx.insertInto('permissoes').values({
            form: f, opcao: o, [col]: alvo, codempresa: emp, caption: p.caption ?? null, form_caption: p.form_caption ?? null,
          }).execute();
        }
        if (dto.concedido !== existia) {
          alterados++;
          await trx.insertInto('audit_permissoes').values({
            form: f, opcao: o, codoperador: porOperador ? alvo : null, codperfil: porOperador ? null : alvo,
            codempresa: emp, tipo: dto.concedido ? 'INSERT' : 'DELETE', programa: 'ApolloWeb', maquina: null, codoperador_acao: ator,
          }).execute();
        }
      }
    });
    return { alterados, ignorados_industria: ignorados };
  }

  /**
   * CLONAR permissões — o `SP_REPLICA_PERMISSAO` que a tela chama em `btnCopiarParaClick` (:389). Lida no
   * Oracle, a procedure faz exatamente isto:
   *   DELETE FROM PERMISSOES WHERE <alvo> = :para AND CODEMPRESA = :paraEmp
   *   INSERT (FORM, OPCAO, <alvo>, CODEMPRESA) ← SELECT FORM, OPCAO ... <alvo> = :de AND CODEMPRESA = :deEmp
   * Três fidelidades que importam: é **destrutivo** (o destino é apagado antes — cópia, não união), é
   * **cross-empresa**, e **não leva CAPTION/FORM_CAPTION** (a procedure do legado também não leva).
   */
  async clonar(dto: { tipo: 'USUARIO' | 'PERFIL'; de: number; de_empresa: number; para: number; para_empresa: number }): Promise<{ copiados: number; apagados: number }> {
    const ator = currentTenant().operadorId ?? null;
    const col = dto.tipo === 'USUARIO' ? 'codoperador' : 'codperfil';
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      if (dto.tipo === 'USUARIO') {
        await this.assertOperador(trx, dto.de);
        await this.assertOperador(trx, dto.para);
      }
      const del = await trx.deleteFrom('permissoes').where(col, '=', dto.para).where('codempresa', '=', dto.para_empresa).executeTakeFirst();
      const apagados = Number((del as any)?.numDeletedRows ?? 0);
      const origem = (await trx.selectFrom('permissoes').select(['form', 'opcao'])
        .where(col, '=', dto.de).where('codempresa', '=', dto.de_empresa).execute()) as Array<{ form: string; opcao: string }>;
      for (const g of origem) {
        await trx.insertInto('permissoes').values({ form: g.form, opcao: g.opcao, [col]: dto.para, codempresa: dto.para_empresa }).execute();
      }
      // a tela do legado grava log da clonagem (`GravaLog(doInserir, talClonar)`); aqui vai uma linha de trilha.
      await trx.insertInto('audit_permissoes').values({
        form: 'FRMCTRLPERMISSOES', opcao: 'CLONAR', codempresa: dto.para_empresa,
        codoperador: dto.tipo === 'USUARIO' ? dto.para : null, codperfil: dto.tipo === 'PERFIL' ? dto.para : null,
        tipo: 'INSERT', programa: 'ApolloWeb', maquina: null, codoperador_acao: ator,
      }).execute();
      return { copiados: origem.length, apagados };
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
