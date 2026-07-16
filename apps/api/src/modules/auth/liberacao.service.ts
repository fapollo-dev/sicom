import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { ConfigService } from '../cadastro/config.service';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { verificarSenha, DUMMY_HASH } from '../../shared/auth/crypto';

type AnyDB = any;

/**
 * OPERADORES — LIBERAÇÃO por supervisor (uCadUsuarios §29). Corte-1: registro + consulta do LOG_LIBERACOES.
 * `registrar` grava 1 evento de liberação (grant OU negação); `listar` é a consulta auditável. O cadastro de
 * quem-libera (corte-2) e o `validar` (re-autenticação do supervisor, corte-3) reusam este serviço.
 * Schema-global (fiel ao legado — LOG_LIBERACOES não tem coluna de empresa).
 */
/** chaves de liberação gerenciáveis (allowlist — evita PUT arbitrário em qualquer config). */
const CHAVES_LIBERACAO = new Set([
  'USUARIOS_LIBERAM_VALOR_MAX_EXCEDIDO',
  'USUARIOS_PERMITIDOS_LIBERAR_PEDIDO_COMPRA',
  'USUARIOS_REABREM_PEDIDO_COMPRA',
  'USUARIOS_PERMITIDOS_LIBERAR_PENDENCIAS_FORNECEDOR_PC',
  'USUARIOS_LIBERAM_DESCONTO_MAXIMO_EXCEDIDO',
  'USUARIOS_LIBERAM_DEVOL_VENDA_NF',
  'USUARIOS_ZERAM_INVENTARIO_ROTATIVO',
]);

@Injectable()
export class LiberacaoService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  /** grava um evento de liberação. usuarioLiberou = CÓDIGO do autorizador como string (fiel ao golden). */
  async registrar(
    trx: AnyDB,
    dados: { usuarioSistema?: number | null; usuarioLiberou: string; liberacao: string; computador?: string | null; estacao?: string | null },
  ): Promise<void> {
    await trx
      .insertInto('log_liberacoes')
      .values({
        usuario_sistema: dados.usuarioSistema ?? null,
        usuario_liberou: String(dados.usuarioLiberou).slice(0, 200),
        usuario_estacao: dados.estacao != null ? String(dados.estacao).slice(0, 200) : null,
        liberacao: String(dados.liberacao).slice(0, 1020),
        computador: dados.computador != null ? String(dados.computador).slice(0, 200) : null,
      })
      .execute();
  }

  /** consulta auditável (filtro por período + ação). Ordena do mais recente; teto de 500 linhas. */
  async listar(filtro: { dataInicial?: string; dataFinal?: string; liberacao?: string } = {}): Promise<Array<Record<string, unknown>>> {
    let q = (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('log_liberacoes')
      .select(['id', 'usuario_sistema', 'usuario_liberou', 'usuario_estacao', 'liberacao', 'computador', sql<string>`to_char(data_liberacao, 'YYYY-MM-DD"T"HH24:MI:SS')`.as('data_liberacao')]);
    if (filtro.dataInicial) q = q.where(sql`data_liberacao::date`, '>=', filtro.dataInicial);
    if (filtro.dataFinal) q = q.where(sql`data_liberacao::date`, '<=', filtro.dataFinal);
    if (filtro.liberacao) q = q.where('liberacao', 'ilike', `%${filtro.liberacao}%`);
    return q.orderBy('data_liberacao', 'desc').limit(500).execute();
  }

  /**
   * ChamaLiberacaoLogin (uCadUsuarios §29 / UFrmLiberacaoLogin): re-autentica um SUPERVISOR (login+senha) e
   * confere que ele ∈ GetUsuariosPermitidos(codigo). Sucesso → registra LOG_LIBERACOES (usuario_sistema = quem
   * PEDIU = operador da sessão; usuario_liberou = código do supervisor) e devolve {liberado, codOperador}.
   * Falha (login/senha/permissão) → {liberado:false} SEM distinguir o motivo (não vira oráculo de senha);
   * verificarSenha SEMPRE roda (timing-safe, DUMMY_HASH). Registra também a NEGAÇÃO (auditoria).
   */
  async validar(dados: { codigo: string; login: string; senha: string; liberacao: string; computador?: string | null }): Promise<{ liberado: boolean; codOperador?: number }> {
    if (!CHAVES_LIBERACAO.has(dados.codigo)) throw new BusinessRuleError('LIBERACAO_CHAVE_INVALIDA', { codigo: dados.codigo });
    const db = this.dbp.forTenant() as AnyDB; // precisa gravar (lockout + log)
    const sup = (await db
      .selectFrom('operadores')
      .select(['codoperador', 'desabilitado', 'senha_hash', 'tentativas_login', 'bloqueado_ate'])
      .where(sql`upper(login)`, '=', String(dados.login).toUpperCase())
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { codoperador: number; desabilitado?: string | null; senha_hash?: string | null; tentativas_login?: number | null; bloqueado_ate?: unknown } | undefined;

    const registrarNegacao = () =>
      this.registrar(db, { usuarioSistema: currentTenant().operadorId ?? null, usuarioLiberou: String(dados.login).slice(0, 200), liberacao: 'NEGADO: ' + dados.liberacao, computador: dados.computador ?? null });

    // corte-3c LOCKOUT reusado (fold ALTA da auditoria): o validar NÃO pode ser um canal de força-bruta que
    // burla o bloqueio por-conta do login. Conta bloqueada recusa antes da senha; janela expirada recomeça.
    if (sup?.bloqueado_ate) {
      const ate = new Date(sup.bloqueado_ate as string | number | Date).getTime();
      if (ate > Date.now()) { await registrarNegacao(); return { liberado: false }; }
      await db.updateTable('operadores').set({ tentativas_login: 0, bloqueado_ate: null }).where('codoperador', '=', sup.codoperador).execute();
      sup.tentativas_login = 0;
    }

    const senhaOk = verificarSenha(dados.senha, sup?.senha_hash ?? DUMMY_HASH); // sempre roda (anti-timing)
    const permitidos = new Set(await this.usuariosPermitidosLocal(dados.codigo));
    const liberado = !!sup && sup.desabilitado !== 'S' && senhaOk && permitidos.has(Number(sup.codoperador));

    if (!liberado) {
      // conta SENHA errada como tentativa e BLOQUEIA ao exceder (mesmo backstop do login endurecido). Só quando
      // a senha falha (não penaliza senha-certa-sem-grant, que não é força-bruta).
      if (sup && !senhaOk) {
        const max = Number(await this.config.resolver('AUTH_MAX_TENTATIVAS_LOGIN')) || 5;
        const upd = (await db.updateTable('operadores').set({ tentativas_login: sql`coalesce(tentativas_login,0) + 1` }).where('codoperador', '=', sup.codoperador).returning('tentativas_login').executeTakeFirst()) as { tentativas_login?: number } | undefined;
        if (max > 0 && Number(upd?.tentativas_login ?? 0) >= max) {
          const bloqMin = Number(await this.config.resolver('AUTH_BLOQUEIO_LOGIN_MINUTOS')) || 15;
          await db.updateTable('operadores').set({ bloqueado_ate: sql`now() + make_interval(secs => ${bloqMin * 60})` }).where('codoperador', '=', sup.codoperador).execute();
        }
      }
      await registrarNegacao();
      return { liberado: false };
    }

    // sucesso → zera o contador/desbloqueia + registra o grant (usuario_liberou = supervisor).
    if (Number(sup!.tentativas_login ?? 0) !== 0 || sup!.bloqueado_ate != null) {
      await db.updateTable('operadores').set({ tentativas_login: 0, bloqueado_ate: null }).where('codoperador', '=', sup!.codoperador).execute();
    }
    await this.registrar(db, { usuarioSistema: currentTenant().operadorId ?? null, usuarioLiberou: String(sup!.codoperador), liberacao: dados.liberacao, computador: dados.computador ?? null });
    return { liberado: true, codOperador: Number(sup!.codoperador) };
  }

  /** usa o ConfigService injetado (mesma query dedicada); helper p/ manter o validar coeso. */
  private usuariosPermitidosLocal(codigo: string): Promise<number[]> {
    return this.config.usuariosPermitidos(codigo);
  }

  /** as chaves de liberação gerenciáveis (com a descrição da config) — alimenta o seletor da tela de grants. */
  async chaves(): Promise<Array<Record<string, unknown>>> {
    return (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('configuracoes')
      .select(['codigo', 'descricao'])
      .where('codigo', 'in', [...CHAVES_LIBERACAO])
      .orderBy('codigo')
      .execute();
  }

  /** matriz operador × concedido p/ uma chave (o "cadastro de quem-libera-o-quê"). */
  async listarPermissoes(codigo: string): Promise<{ codigo: string; operadores: Array<Record<string, unknown>> }> {
    if (!CHAVES_LIBERACAO.has(codigo)) throw new BusinessRuleError('LIBERACAO_CHAVE_INVALIDA', { codigo });
    const permitidos = new Set(await this.config.usuariosPermitidos(codigo)); // grants explícitos
    const ops = (await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('operadores')
      .select(['codoperador', 'nome', 'login'])
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .orderBy('nome')
      .execute()) as Array<{ codoperador: number; nome?: string; login?: string }>;
    return { codigo, operadores: ops.map((o) => ({ ...o, concedido: permitidos.has(Number(o.codoperador)) })) };
  }

  /** concede (S) ou revoga (delete) o grant de um operador numa chave. Grava/apaga configuracoes_especificas. */
  async setPermissao(codigo: string, codoperador: number, concedido: boolean): Promise<{ codigo: string; codoperador: number; concedido: boolean }> {
    if (!CHAVES_LIBERACAO.has(codigo)) throw new BusinessRuleError('LIBERACAO_CHAVE_INVALIDA', { codigo });
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const cfg = await trx.selectFrom('configuracoes').select('id').where('codigo', '=', codigo).executeTakeFirst();
      if (!cfg) throw new BusinessRuleError('LIBERACAO_CHAVE_INVALIDA', { codigo });
      const op = await trx.selectFrom('operadores').select('codoperador').where('codoperador', '=', codoperador).where(sql`coalesce(indr,'I')`, '<>', 'E').executeTakeFirst();
      if (!op) throw new BusinessRuleError('OPERADOR_NAO_ENCONTRADO', { codoperador });
      if (concedido) {
        await trx
          .insertInto('configuracoes_especificas')
          .values({ id: cfg.id, tipo: 'Usuario', chave: String(codoperador), valor: 'S' })
          .onConflict((oc: AnyDB) => oc.columns(['id', 'tipo', 'chave']).doUpdateSet({ valor: 'S' }))
          .execute();
      } else {
        await trx.deleteFrom('configuracoes_especificas').where('id', '=', cfg.id).where('tipo', '=', 'Usuario').where('chave', '=', String(codoperador)).execute();
      }
      return { codigo, codoperador, concedido };
    });
  }
}
