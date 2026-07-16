import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { ConfigService } from '../cadastro/config.service';
import { BusinessRuleError } from '../../shared/errors/app-error';

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
