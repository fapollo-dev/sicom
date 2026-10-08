import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../database/database.provider';
import { currentTenant } from '../tenant/tenant-context';
import { SenhaOperacaoService } from '../../modules/cadastro/senha-operacao.service';

/** Modo de controle (legado: CONFIGURACOES.CONTROLE_PERMISSOES) — U(suario) · P(erfil) · A(mbos). */
export type ModoPermissao = 'usuario' | 'perfil' | 'ambos';

/**
 * RBAC espelhando `TdmPrincipal.PossuiAcessoForm` (udmPrincipal.pas:2867-2925):
 * acesso = EXISTE linha em PERMISSOES casando FORM+OPCAO + (operador|perfil) + empresa.
 * Presença = concedido (não há flag).
 */
/**
 * o modo vigente — o `GetConfigControlePermissao` (udmPrincipal.pas:2698-2713): `COALESCE(CE.VALOR, C.VALOR)` da config
 * CONTROLE_PERMISSOES; '' / 'Usuario' / 'U' → usuário, 'Perfil' / 'P' → perfil, 'Ambos' / 'A' → os dois (UNION).
 *
 * ⚠️ PRODUÇÃO = AMBOS (08/10/2026). A config global diz 'Usuario', mas a específica do módulo Retaguarda diz 'A', e o COALESCE
 * do legado fica com ela. O dado vivo confirma: a VANICE (op 50) abriu a Agenda de Promoção 1.422 vezes (nov/2023 a set/2026)
 * sem nenhuma linha própria de FRMCADAGENDAPROMOCAO — a tela vem do perfil COMPRADOR GERAL —, e o menu barra quem não passa
 * no `PossuiAcessoForm(FormName, FormName)` (uMenuSuperior.pas:702). Até aqui o Apollo fixava 'usuario' e tirava dela a tela.
 *
 * `APP_PERMISSAO_MODO` continua como OVERRIDE (testes/operação): valor canônico manda; valor torto degrada p/ 'usuario'
 * (fail-safe — fold auditoria: antes caía em 'ambos'). Sem env, manda a config; config ausente ou fora de P/U/A → 'usuario'.
 */
export async function modoPermissao(db: AnyDB): Promise<ModoPermissao> {
  const env = String(process.env.APP_PERMISSAO_MODO ?? '').trim().toLowerCase();
  if (env) return env === 'perfil' || env === 'ambos' ? env : 'usuario';
  // a específica permitida da config é só a de MÓDULO (CONFIGESPECIFICASPERMITIDAS = 'Modulo'); o módulo é o Retaguarda
  const r = (await sql<{ valor: string | null }>`
      SELECT coalesce(ce.valor, c.valor) AS valor FROM configuracoes c
        LEFT JOIN configuracoes_especificas ce ON ce.id = c.id AND ce.tipo = 'Modulo' AND ce.chave = 'Retaguarda'
       WHERE c.codigo = 'CONTROLE_PERMISSOES' LIMIT 1`.execute(db)).rows[0];
  const v = String(r?.valor ?? '').trim().toUpperCase();
  if (v === 'P' || v === 'PERFIL') return 'perfil';
  if (v === 'A' || v === 'AMBOS') return 'ambos';
  return 'usuario';
}

/**
 * as linhas de PERMISSOES do operador corrente na empresa corrente (ou na `empresa` dada) para o FORM (e a OPÇÃO, se dada),
 * no modo vigente — a mesma consulta do `GetSQLPermissaoControles`/`PossuiAcessoForm` do legado. `null` = fail-closed (sem
 * operador/empresa, ou modo perfil sem perfil).
 *
 * Divergência consciente: o `GetCodPerfilVincOperador` do legado (udmPrincipal.pas:4046) NÃO filtra o vínculo excluído
 * (INDR='E') — tirar o perfil do operador na tela não lhe tira o acesso. O Apollo filtra: tirar é tirar. Produção 08/10/2026:
 * 20 vínculos excluídos; o maior efeito é o JOAO LUCAS (op 23), que no legado ainda alcança 154 telas pela DIRETORIA retirada em 2021.
 */
async function consultaPermissoes(db: AnyDB, form: string, opcao?: string, empresa?: number): Promise<{ q: AnyDB } | null> {
  const { operadorId, empresaId } = currentTenant();
  const emp = empresa ?? empresaId;
  if (operadorId == null || emp == null) return null;
  let q = db
    .selectFrom('permissoes')
    .where(sql`upper(form)`, '=', form.toUpperCase())
    .where('codempresa', '=', emp);
  if (opcao != null) q = q.where(sql`upper(opcao)`, '=', opcao.toUpperCase());
  const modo = await modoPermissao(db);
  // (o builder vai embrulhado: devolvido cru por função async, a Promise tentaria 'resolvê-lo' — o Kysely proíbe)
  if (modo === 'usuario') return { q: q.where('codoperador', '=', operadorId) }; // só os grants DIRETOS
  // perfil/ambos: acesso via PERFIS do operador (RELACAO_OPERADOR_PERFIL). 'ambos' = próprios ∪ perfis.
  const perfis = (
    (await db
      .selectFrom('relacao_operador_perfil')
      .select('codperfil')
      .where('codoperador', '=', operadorId)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .execute()) as Array<{ codperfil: number }>
  ).map((r) => Number(r.codperfil));
  if (modo === 'perfil') return perfis.length ? { q: q.where('codperfil', 'in', perfis) } : null;
  return { q: q.where((eb: AnyDB) => eb.or([eb('codoperador', '=', operadorId), ...(perfis.length ? [eb('codperfil', 'in', perfis)] : [])])) };
}

/** o operador tem a OPÇÃO do FORM? (a permissão de tela, de botão ou de campo — presença = concedido) */
export async function opcaoConcedida(db: AnyDB, form: string, opcao: string): Promise<boolean> {
  const c = await consultaPermissoes(db, form, opcao);
  if (!c) return false;
  return !!(await c.q.select(sql`1`.as('ok')).executeTakeFirst());
}

/** a OPÇÃO do FORM numa empresa que não é a do login (as telas que gravam em várias lojas), no modo vigente */
export async function opcaoConcedidaNaEmpresa(db: AnyDB, form: string, opcao: string, empresa: number): Promise<boolean> {
  const c = await consultaPermissoes(db, form, opcao, empresa);
  if (!c) return false;
  return !!(await c.q.select(sql`1`.as('ok')).executeTakeFirst());
}

/** todas as OPÇÕES do FORM concedidas ao operador corrente (em maiúsculas) — o que a tela usa para habilitar os controles */
export async function opcoesConcedidas(db: AnyDB, form: string): Promise<Set<string>> {
  const c = await consultaPermissoes(db, form);
  if (!c) return new Set();
  const rows = (await c.q.select(sql<string>`upper(opcao)`.as('opcao')).distinct().execute()) as Array<{ opcao: string }>;
  return new Set(rows.map((r) => String(r.opcao)));
}

@Injectable()
export class AcessoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  async possuiAcesso(form: string, opcao: string): Promise<boolean> {
    return opcaoConcedida(this.dbp.forTenantRead(), form, opcao);
  }

  /** as opções do FORM concedidas ao operador corrente (a tela desabilita/oculta o controle que não está aqui) */
  async opcoesDoForm(form: string): Promise<string[]> {
    return [...(await opcoesConcedidas(this.dbp.forTenantRead(), form))].sort();
  }

  /**
   * `SenhaAdministrativa('ADM')` do legado (uSenhaAdmin.pas) para a tela de configurações. `DESABILITA_OPERACOES_BASICAS`
   * barra antes (Configuraes1Click); depois, a senha ADM da empresa — pelo `SenhaOperacaoService`, com o lockout dele,
   * como os outros pontos que pedem a senha administrativa (meta diária do pedido, parcelas da NF, controle de contas).
   * O legado também aceita a SENHARETAGUARDA de qualquer operador e `SYSAPOLLO<dia><mês>`: são as senhas-mestras que o
   * Apollo decidiu não reimplementar (shared/auth/crypto.ts).
   */
  async senhaAdministrativa(senha: string | undefined): Promise<'ok' | 'ausente' | 'invalida' | 'operacoes_basicas'> {
    const { operadorId } = currentTenant();
    const op = (await (this.dbp.forTenantRead() as AnyDB).selectFrom('operadores').select(['desabilita_operacoes_basicas'])
      .where('codoperador', '=', operadorId ?? -1).executeTakeFirst()) as { desabilita_operacoes_basicas: string | null } | undefined;
    if (op?.desabilita_operacoes_basicas === 'S') return 'operacoes_basicas';
    if (!senha) return 'ausente';
    const { ok } = await new SenhaOperacaoService(this.dbp).verificar('admin', senha);
    return ok ? 'ok' : 'invalida';
  }
}

type AnyDB = any;
