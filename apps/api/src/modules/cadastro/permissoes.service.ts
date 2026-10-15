import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { gravarLog, type AcaoLog } from '../../shared/log/registro-log';

type AnyDB = any;

/**
 * PERMISSÕES (`FRMCTRLPERMISSOES`) — matriz de grants FORM×OPCAO. Dossiê: `uCtrlPermissoes.md`.
 *
 * ⚠️ o corte-2 só sabia conceder por PERFIL, e o cliente concede sobretudo por **OPERADOR**: 55.251 linhas por operador
 * contra 2.438 por perfil. O modo da produção é AMBOS (`CONTROLE_PERMISSOES`: a específica do Retaguarda 'A' ganha da
 * global 'Usuario', `udmPrincipal.pas:2698-2714` — ver `acesso.service.ts` `modoPermissao`), então os dois caminhos valem.
 * Sem o caminho por operador, o administrador não conseguiria dar nem tirar acesso de ninguém depois da virada.
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

  /**
   * o perfil da aba Perfil (o SegPerfil do uCtrlPermissoes.dfm: CODPERFIL, INDR = 'I', TIPO = 'ACESSO', ATIVO = 'S'; a Pesquisa da aba,
   * spdBuscaPerfilClick :1447, filtra igual) — "Informe um perfil válido." (EdtCodPerfilExit :649). Só o perfil de acesso tem
   * permissão: na produção, 2.346 linhas em 7 perfis, todos ACESSO; o de compra e o de parceiro não passam por esta tela.
   */
  private async assertPerfilDeAcesso(db: AnyDB, codperfil: number): Promise<void> {
    const p = (await db.selectFrom('perfil').select(['tipo', 'ativo']).where('codperfil', '=', codperfil)
      .where(sql`coalesce(indr,'I')`, '<>', 'E').executeTakeFirst()) as { tipo?: string | null; ativo?: string | null } | undefined;
    if (!p) throw new BusinessRuleError('PERFIL_NAO_ENCONTRADO', { codperfil });
    if (String(p.tipo ?? '').toUpperCase() !== 'ACESSO' || String(p.ativo ?? 'S').toUpperCase() !== 'S') throw new BusinessRuleError('PERFIL_INVALIDO', { codperfil });
  }

  /** os grants (form×opção) de um perfil de acesso numa empresa (o cbbEmpresaPerfil; ausente = a da sessão). */
  async listarPorPerfil(codperfil: number, codempresa?: number): Promise<{ codperfil: number; codempresa: number; grants: Array<Record<string, unknown>> }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.assertPerfilDeAcesso(db, codperfil);
    const emp = this.empDe(codempresa);
    const grants = await db
      .selectFrom('permissoes')
      .select(['form', 'opcao'])
      .where('codperfil', '=', codperfil)
      .where('codempresa', '=', emp)
      .execute();
    return { codperfil, codempresa: emp, grants };
  }

  /**
   * concede/revoga um grant FORM×OPCAO a um perfil de acesso numa empresa (presença = concedido, fiel ao legado). Grava CAPTION/FORM_CAPTION
   * como o AdicionarPermissao (:331-332), que é o mesmo para operador e perfil.
   */
  async setGrant(codperfil: number, form: string, opcao: string, concedido: boolean, codempresa?: number): Promise<{ codperfil: number; codempresa: number; form: string; opcao: string; concedido: boolean }> {
    const emp = this.empDe(codempresa);
    const ator = currentTenant().operadorId ?? null;
    const f = form.trim().toUpperCase();
    const o = opcao.trim().toUpperCase();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.assertPerfilDeAcesso(trx, codperfil);
      // idempotente: apaga qualquer duplicata do par (perfil, form, opcao, empresa) antes de (re)inserir.
      // numDeletedRows>0 ⇒ o grant EXISTIA (p/ auditar só a mudança real, sem query extra).
      const del = await trx.deleteFrom('permissoes').where('codperfil', '=', codperfil).where(sql`upper(form)`, '=', f).where(sql`upper(opcao)`, '=', o).where('codempresa', '=', emp).executeTakeFirst();
      const existia = Number((del as any)?.numDeletedRows ?? 0) > 0;
      if (concedido) {
        const { caption, form_caption } = await this.rotulos(trx, f, o);
        // codoperador FICA NULO: operador OU perfil, nunca os dois (:314-315)
        await trx.insertInto('permissoes').values({ form: f, opcao: o, codperfil, codempresa: emp, caption, form_caption }).execute();
      } else if (o === f && existia) {
        await trx.insertInto('audit_permissoes').values({
          form: f, opcao: o, codoperador: null, codperfil, codempresa: emp, tipo: 'DELETE', programa: 'ApolloWeb', maquina: null, codoperador_acao: ator,
        }).execute();
        await this.cascataDaTela(trx, 'codperfil', codperfil, emp, f);
        const tela = (await this.rotulos(trx, f, f)).form_caption ?? f;
        await this.logPermissao(trx, 'Excluiu', { codperfil }, emp, (quem, paraO) => `${quem} removeu todas as permissões da tela  ${tela} para o ${paraO}.`);
        return { codperfil, codempresa: emp, form: f, opcao: o, concedido };
      }
      // TRILHA (AUDIT_PERMISSOES): registra só quando o estado MUDA (concede o ausente / revoga o presente),
      // na MESMA transação. TIPO fiel ao legado: 'INSERT'=concede, 'DELETE'=revoga; ATOR = operador da sessão.
      if (concedido !== existia) {
        await trx.insertInto('audit_permissoes').values({
          form: f, opcao: o, codoperador: null, codperfil, codempresa: emp,
          tipo: concedido ? 'INSERT' : 'DELETE', programa: 'ApolloWeb', maquina: null, codoperador_acao: ator,
        }).execute();
        const r = await this.rotulos(trx, f, o);
        await this.logPermissao(trx, concedido ? 'Inseriu' : 'Excluiu', { codperfil }, emp, (quem, paraO) =>
          `${quem} ${concedido ? 'liberou' : 'removeu'} a permissão ${r.form_caption ?? f} da tela ${r.caption ?? o} para o  ${paraO}.`);
      }
      return { codperfil, codempresa: emp, form: f, opcao: o, concedido };
    });
  }

  // ── CORTE-3: o caminho por OPERADOR, que é o do cliente ───────────────────────────────────────────────────

  /** empresa do pedido: a tela do legado tem seletor (`cbbEmpresaChange`); ausente = a da sessão. */
  private empDe(codempresa?: number): number {
    return codempresa != null && Number.isFinite(codempresa) ? Number(codempresa) : this.emp();
  }

  /**
   * a LOG do controle de permissões (`TfrmCtrlPermissoes.GravaLog` :951 + `GetMsgAcaoLog` :897): TABELA 'PERMISSOES',
   * CHAVE 'CODOPERADOR', VALOR = o usuário da tela (0 quando é um perfil), IDEMPRESA = a empresa da permissão. É o que
   * o "Registro de log" da tela mostra — o único registro de QUEM mudou a permissão de quem (a `audit_permissoes` só
   * guarda programa e máquina). Os textos são os do legado, com os espaços duplos dele; a gravação sai em maiúsculas
   * e sem acento, como na produção.
   */
  /**
   * tirar o "Acessar formulário" tira a tela inteira (`trvOpcoesDblClick` :1531-1535): depois do RemoverPermissao do nó de acesso, o
   * legado chama o `btnDesMarcarTodosOpcoesClick` — remove as opções marcadas da tela e grava só o "removeu todas as permissões da tela"
   * (talDesmarcarTodasOpcoes), não o "removeu a permissão". Produção: 46 registros desse texto na LOG.
   */
  private async cascataDaTela(trx: AnyDB, col: 'codoperador' | 'codperfil', alvo: number, emp: number, f: string): Promise<number> {
    const removidas = (await trx.deleteFrom('permissoes').where(col, '=', alvo).where(sql`upper(form)`, '=', f).where('codempresa', '=', emp)
      .returning(['form', 'opcao']).execute()) as Array<{ form: string; opcao: string }>;
    const ator = currentTenant().operadorId ?? null;
    for (const r of removidas) {
      await trx.insertInto('audit_permissoes').values({
        form: String(r.form).toUpperCase(), opcao: String(r.opcao).toUpperCase(), codoperador: col === 'codoperador' ? alvo : null, codperfil: col === 'codperfil' ? alvo : null,
        codempresa: emp, tipo: 'DELETE', programa: 'ApolloWeb', maquina: null, codoperador_acao: ator,
      }).execute();
    }
    return removidas.length;
  }

  private async logPermissao(
    trx: AnyDB, acao: AcaoLog, alvo: { codoperador?: number | null; codperfil?: number | null }, emp: number,
    montar: (ator: string, paraO: string) => string,
  ): Promise<void> {
    const opAtor = currentTenant().operadorId ?? null;
    const ator = opAtor != null
      ? ((await trx.selectFrom('operadores').select(['nome', 'login']).where('codoperador', '=', opAtor).executeTakeFirst()) as { nome?: string; login?: string } | undefined)
      : undefined;
    let paraO: string;
    if (alvo.codoperador != null) {
      const o = (await trx.selectFrom('operadores').select(['nome', 'login']).where('codoperador', '=', alvo.codoperador).executeTakeFirst()) as { nome?: string; login?: string } | undefined;
      paraO = `Usuário ${o?.nome ?? o?.login ?? ''} na empresa ${emp}`;
    } else {
      const p = (await trx.selectFrom('perfil').select('perfil').where('codperfil', '=', alvo.codperfil ?? -1).executeTakeFirst()) as { perfil?: string } | undefined;
      paraO = `Perfil ${p?.perfil ?? ''} na empresa ${emp}`;
    }
    await gravarLog(trx, {
      acao, formulario: 'Controle de permissões', tabela: 'PERMISSOES', chave: 'CODOPERADOR',
      valor: alvo.codoperador ?? 0, historico: montar(`Usuário ${ator?.nome ?? ator?.login ?? ''}`, paraO), idempresa: emp,
    });
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
      } else if (o === f && existia) {
        await trx.insertInto('audit_permissoes').values({
          form: f, opcao: o, codoperador: dto.codoperador, codperfil: null, codempresa: emp, tipo: 'DELETE', programa: 'ApolloWeb', maquina: null, codoperador_acao: ator,
        }).execute();
        await this.cascataDaTela(trx, 'codoperador', dto.codoperador, emp, f);
        const tela = (await this.rotulos(trx, f, f)).form_caption ?? f;
        await this.logPermissao(trx, 'Excluiu', { codoperador: dto.codoperador }, emp, (quem, paraO) => `${quem} removeu todas as permissões da tela  ${tela} para o ${paraO}.`);
        return { codoperador: dto.codoperador, codempresa: emp, form: f, opcao: o, concedido: dto.concedido };
      }
      if (dto.concedido !== existia) {
        await trx.insertInto('audit_permissoes').values({
          form: f, opcao: o, codoperador: dto.codoperador, codperfil: null, codempresa: emp,
          tipo: dto.concedido ? 'INSERT' : 'DELETE', programa: 'ApolloWeb', maquina: null, codoperador_acao: ator,
        }).execute();
        // talMarcarOpcao / talDesmarcaOpcao (:933-941): "…liberou a permissão <tela> da tela <opção> para o  …"
        const r = await this.rotulos(trx, f, o);
        await this.logPermissao(trx, dto.concedido ? 'Inseriu' : 'Excluiu', { codoperador: dto.codoperador }, emp, (quem, paraO) =>
          `${quem} ${dto.concedido ? 'liberou' : 'removeu'} a permissão ${r.form_caption ?? f} da tela ${r.caption ?? o} para o  ${paraO}.`);
      }
      return { codoperador: dto.codoperador, codempresa: emp, form: f, opcao: o, concedido: dto.concedido };
    });
  }

  /**
   * MARCAR/DESMARCAR EM LOTE — os quatro botões do legado:
   *  · «1 - Marcar todos» (`btnMarcarTodosFormClick` :472 → MarcarDesmarcar(True, True)): toda tela, toda opção; só insere o que FALTA
   *    (`ImageIndex = 1` — a linha que já existe fica como está, com o rótulo dela);
   *  · «2 - Desmarcar todos» (`btnDesMarcarTodosFormClick` :429): `DELETE FROM PERMISSOES WHERE CODOPERADOR|CODPERFIL = … AND CODEMPRESA = …`
   *    (GetSQL_Delete_todas_permissoes) — tudo do alvo na empresa;
   *  · «3 - Marcar» / «4 - Desmarcar» (`btnMarcarTodosOpcoesClick` :516 / :453): as opções da tela (`form`).
   * O "tratamento módulo indústria" do :478-493 NÃO é copiado: o `cdsMenu.Locate('DESCRICAO','INDÚSTRIA')` procura com acento uma
   * descrição que o CarregaDataSetMenu grava sem acento (RemoveAcentoCedilhaTrema: "INDUSTRIA") e nunca acha — na produção os 12
   * operadores de acesso total têm as 15 telas do menu Indústria nas lojas de segmento PADRAO (uCtrlPermissoes.pas:485 × :1586). O catálogo é o da produção (DISTINCT
   * de PERMISSOES — o binário do cliente é mais novo que o fonte: 243 pares que o fonte de 2020 não conhece).
   */
  async setLote(dto: { codoperador?: number; codperfil?: number; form?: string; concedido: boolean; codempresa?: number }): Promise<{ alterados: number }> {
    const emp = this.empDe(dto.codempresa);
    const ator = currentTenant().operadorId ?? null;
    const porOperador = dto.codoperador != null;
    const alvo = porOperador ? Number(dto.codoperador) : Number(dto.codperfil);
    const col = porOperador ? 'codoperador' : 'codperfil';
    const db = this.dbp.forTenantRead() as AnyDB;
    if (porOperador) await this.assertOperador(db, alvo);
    else await this.assertPerfilDeAcesso(db, alvo);

    let pares = (await this.catalogo()) as Array<{ form: string; opcao: string; caption: string | null; form_caption: string | null }>;
    const fu = dto.form ? dto.form.trim().toUpperCase() : null;
    if (fu) pares = pares.filter((p) => String(p.form).toUpperCase() === fu);

    let alterados = 0;
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const audit = (form: string, opcao: string, tipo: 'INSERT' | 'DELETE') => trx.insertInto('audit_permissoes').values({
        form, opcao, codoperador: porOperador ? alvo : null, codperfil: porOperador ? null : alvo,
        codempresa: emp, tipo, programa: 'ApolloWeb', maquina: null, codoperador_acao: ator,
      }).execute();
      if (dto.concedido) {
        const tem = new Set(((await trx.selectFrom('permissoes').select(['form', 'opcao']).where(col, '=', alvo).where('codempresa', '=', emp).execute()) as Array<{ form: string; opcao: string }>)
          .map((r) => `${String(r.form).toUpperCase()} ${String(r.opcao).toUpperCase()}`));
        const vistos = new Set<string>();
        for (const p of pares) {
          const f = String(p.form).toUpperCase();
          const o = String(p.opcao).toUpperCase();
          const k = `${f} ${o}`;
          if (tem.has(k) || vistos.has(k)) continue;
          vistos.add(k);
          await trx.insertInto('permissoes').values({ form: f, opcao: o, [col]: alvo, codempresa: emp, caption: p.caption ?? null, form_caption: p.form_caption ?? null }).execute();
          await audit(f, o, 'INSERT');
          alterados++;
        }
      } else {
        let q = trx.deleteFrom('permissoes').where(col, '=', alvo).where('codempresa', '=', emp);
        if (fu) q = q.where(sql`upper(form)`, '=', fu);
        const removidas = (await q.returning(['form', 'opcao']).execute()) as Array<{ form: string; opcao: string }>;
        for (const r of removidas) await audit(String(r.form).toUpperCase(), String(r.opcao).toUpperCase(), 'DELETE');
        alterados = removidas.length;
      }
      // o legado grava uma linha por clique (:446/:457/:505/:520): todas as opções de uma tela, ou o acesso total/geral
      const quemAlvo = porOperador ? { codoperador: alvo } : { codperfil: alvo };
      const acaoLog: AcaoLog = dto.concedido ? 'Inseriu' : 'Excluiu';
      if (fu) {
        const tela = (pares[0]?.form_caption as string | null | undefined) ?? (await this.rotulos(trx, fu, fu)).form_caption ?? fu;
        await this.logPermissao(trx, acaoLog, quemAlvo, emp, (quem, paraO) =>
          `${quem} ${dto.concedido ? 'liberou' : 'removeu'} todas as permissões da tela  ${tela} para o ${paraO}.`);
      } else {
        await this.logPermissao(trx, acaoLog, quemAlvo, emp, (quem, paraO) =>
          dto.concedido ? `${quem} liberou acesso total para o  ${paraO}.` : `${quem} removeu o acesso geral do ${paraO}.`);
      }
    });
    return { alterados };
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
      } else {
        // a origem vem da GET_PERFIL sem filtro (btnCloneClick :382); o destino é o perfil da aba (de acesso, ativo)
        const de = await trx.selectFrom('perfil').select('codperfil').where('codperfil', '=', dto.de).where(sql`coalesce(indr,'I')`, '<>', 'E').executeTakeFirst();
        if (!de) throw new BusinessRuleError('PERFIL_NAO_ENCONTRADO', { codperfil: dto.de });
        await this.assertPerfilDeAcesso(trx, dto.para);
      }
      const del = await trx.deleteFrom('permissoes').where(col, '=', dto.para).where('codempresa', '=', dto.para_empresa).executeTakeFirst();
      const apagados = Number((del as any)?.numDeletedRows ?? 0);
      const origem = (await trx.selectFrom('permissoes').select(['form', 'opcao'])
        .where(col, '=', dto.de).where('codempresa', '=', dto.de_empresa).execute()) as Array<{ form: string; opcao: string }>;
      for (const g of origem) {
        await trx.insertInto('permissoes').values({ form: g.form, opcao: g.opcao, [col]: dto.para, codempresa: dto.para_empresa }).execute();
      }
      // talClonar (:928): "…clonou as permissões de <Usuário|Perfil> para o  <Usuário|Perfil> <nome> na empresa N." — o
      // legado repete o TIPO onde deveria vir o nome da origem (vPermissao duas vezes); a produção grava assim
      // ("CLONOU AS PERMISSOES DE USUARIO  PARA O  USUARIO LILIA … NA EMPRESA 2.")
      const tipoTxt = dto.tipo === 'USUARIO' ? 'Usuário' : 'Perfil';
      await this.logPermissao(trx, 'Inseriu', dto.tipo === 'USUARIO' ? { codoperador: dto.para } : { codperfil: dto.para }, dto.para_empresa,
        (quem, paraO) => `${quem} clonou as permissões de ${tipoTxt}  para o  ${paraO}.`);
      await trx.insertInto('audit_permissoes').values({
        form: 'FRMCTRLPERMISSOES', opcao: 'CLONAR', codempresa: dto.para_empresa,
        codoperador: dto.tipo === 'USUARIO' ? dto.para : null, codperfil: dto.tipo === 'PERFIL' ? dto.para : null,
        tipo: 'INSERT', programa: 'ApolloWeb', maquina: null, codoperador_acao: ator,
      }).execute();
      return { copiados: origem.length, apagados };
    });
  }

  /**
   * trilha de auditoria (mais recentes primeiro) — quem alterou o quê e quando. Filtra por PERFIL ou por
   * OPERADOR: a tela por operador precisa ver o histórico dele, não o de um perfil.
   */
  async auditoria(codperfil?: number, limite = 100, codoperador?: number): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    let q = (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('audit_permissoes as a')
      .leftJoin('perfil as p', 'p.codperfil', 'a.codperfil')
      .leftJoin('operadores as o', 'o.codoperador', 'a.codoperador_acao')
      .select([
        'a.codaudit', 'a.form', 'a.opcao', 'a.codperfil', 'p.perfil as perfil_nome',
        sql`to_char(a.data,'YYYY-MM-DD HH24:MI:SS')`.as('data'), 'a.tipo',
        'a.codoperador', 'a.codoperador_acao', sql`coalesce(o.nome, o.login)`.as('ator_nome'),
      ])
      .where('a.codempresa', '=', emp);
    if (codperfil != null && Number.isFinite(codperfil)) q = q.where('a.codperfil', '=', codperfil);
    if (codoperador != null && Number.isFinite(codoperador)) q = q.where('a.codoperador', '=', codoperador);
    const lim = Number.isFinite(limite) && limite > 0 ? Math.min(limite, 500) : 100; // sanitiza (NaN/≤0 → 100)
    return q.orderBy('a.data', 'desc').orderBy('a.codaudit', 'desc').limit(lim).execute();
  }
}
