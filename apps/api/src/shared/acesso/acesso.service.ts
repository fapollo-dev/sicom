import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../database/database.provider';
import { currentTenant } from '../tenant/tenant-context';

/** Modo de controle (legado: CONFIGURACOES.CONTROLE_PERMISSOES). PINHEIRAO = 'usuario'. */
export type ModoPermissao = 'usuario' | 'perfil' | 'ambos';

/**
 * RBAC espelhando `TdmPrincipal.PossuiAcessoForm` (udmPrincipal.pas):
 * acesso = EXISTE linha em PERMISSOES casando FORM+OPCAO + (operador|perfil) + empresa.
 * Presença = concedido (não há flag). Nesta fatia: modo 'usuario' (default do legado);
 * perfil/ambos ficam como extensão (perfis do operador ainda não modelados).
 */
/** o modo vigente (APP_PERMISSAO_MODO), canonicalizado — valor fora da whitelist degrada p/ 'usuario' (fail-safe) */
export function modoPermissao(): ModoPermissao {
  // fold auditoria (fail-open): o `?? 'usuario'` só cobria undefined; um valor SETADO não-canônico (vazio, typo,
  // 'USUARIO') caía no else → 'ambos' (o MAIS permissivo). Agora canonicaliza (trim/lower) + whitelist; qualquer
  // valor fora de {usuario,perfil,ambos} degrada p/ o default SEGURO 'usuario' (fail-safe, não fail-open).
  const raw = String(process.env.APP_PERMISSAO_MODO ?? '').trim().toLowerCase();
  return raw === 'perfil' || raw === 'ambos' ? raw : 'usuario';
}

/**
 * as linhas de PERMISSOES do operador corrente na empresa corrente para o FORM (e a OPÇÃO, se dada), no modo vigente —
 * a mesma consulta do `GetSQLPermissaoControles`/`PossuiAcessoForm` do legado. `null` = fail-closed (sem operador/empresa,
 * ou modo perfil sem perfil).
 */
async function consultaPermissoes(db: AnyDB, form: string, opcao?: string): Promise<{ q: AnyDB } | null> {
  const { operadorId, empresaId } = currentTenant();
  if (operadorId == null || empresaId == null) return null;
  let q = db
    .selectFrom('permissoes')
    .where(sql`upper(form)`, '=', form.toUpperCase())
    .where('codempresa', '=', empresaId);
  if (opcao != null) q = q.where(sql`upper(opcao)`, '=', opcao.toUpperCase());
  const modo = modoPermissao();
  // (o builder vai embrulhado: devolvido cru por função async, a Promise tentaria 'resolvê-lo' — o Kysely proíbe)
  if (modo === 'usuario') return { q: q.where('codoperador', '=', operadorId) }; // grants DIRETOS (default do legado, PINHEIRAO)
  // perfil/ambos (corte-2): acesso via PERFIS do operador (RELACAO_OPERADOR_PERFIL). 'ambos' = próprios ∪ perfis.
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
}

type AnyDB = any;
