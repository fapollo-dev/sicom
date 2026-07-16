import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = any;

/**
 * PERFIL — atribuição de perfis a operadores (RELACAO_OPERADOR_PERFIL). Matriz operador→perfis: lista todos
 * os perfis ativos com o flag `atribuido`, e o set grava/apaga o vínculo (idempotente via UNIQUE parcial).
 * O acesso efetivo (grants dos perfis) é ligado no acesso.service no corte-2.
 */
@Injectable()
export class PerfilRelacaoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  /** matriz: todos os perfis ativos + se o operador os tem. */
  async listar(codoperador: number): Promise<{ codoperador: number; perfis: Array<Record<string, unknown>> }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const op = await db.selectFrom('operadores').select('codoperador').where('codoperador', '=', codoperador).where(sql`coalesce(indr,'I')`, '<>', 'E').executeTakeFirst();
    if (!op) throw new BusinessRuleError('OPERADOR_NAO_ENCONTRADO', { codoperador });
    const atribuidos = new Set(
      ((await db.selectFrom('relacao_operador_perfil').select('codperfil').where('codoperador', '=', codoperador).where(sql`coalesce(indr,'I')`, '<>', 'E').execute()) as Array<{ codperfil: number }>).map((r) => Number(r.codperfil)),
    );
    const perfis = (await db.selectFrom('perfil').select(['codperfil', 'perfil', 'ativo']).where(sql`coalesce(indr,'I')`, '<>', 'E').orderBy('perfil').execute()) as Array<{ codperfil: number; perfil: string; ativo: string }>;
    return { codoperador, perfis: perfis.map((p) => ({ ...p, atribuido: atribuidos.has(Number(p.codperfil)) })) };
  }

  /** atribui (S) ou remove (soft-delete) o vínculo operador↔perfil. */
  async set(codoperador: number, codperfil: number, atribuido: boolean): Promise<{ codoperador: number; codperfil: number; atribuido: boolean }> {
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const oper = await trx.selectFrom('operadores').select('codoperador').where('codoperador', '=', codoperador).where(sql`coalesce(indr,'I')`, '<>', 'E').executeTakeFirst();
      if (!oper) throw new BusinessRuleError('OPERADOR_NAO_ENCONTRADO', { codoperador });
      const perf = await trx.selectFrom('perfil').select('codperfil').where('codperfil', '=', codperfil).where(sql`coalesce(indr,'I')`, '<>', 'E').executeTakeFirst();
      if (!perf) throw new BusinessRuleError('PERFIL_NAO_ENCONTRADO', { codperfil });
      if (atribuido) {
        // reativa um vínculo soft-deletado OU cria; o UNIQUE parcial (indr<>E) garante 1 ativo.
        const ex = await trx.selectFrom('relacao_operador_perfil').select(['codrelacao', 'indr']).where('codoperador', '=', codoperador).where('codperfil', '=', codperfil).executeTakeFirst();
        if (ex) {
          await trx.updateTable('relacao_operador_perfil').set({ indr: 'I', usultalteracao: op, dtultimalteracao: sql`now()` }).where('codrelacao', '=', (ex as any).codrelacao).execute();
        } else {
          await trx.insertInto('relacao_operador_perfil').values({ codoperador, codperfil, usucadastro: op, indr: 'I' }).execute();
        }
      } else {
        await trx.updateTable('relacao_operador_perfil').set({ indr: 'E', usultalteracao: op, dtultimalteracao: sql`now()` }).where('codoperador', '=', codoperador).where('codperfil', '=', codperfil).where(sql`coalesce(indr,'I')`, '<>', 'E').execute();
      }
      return { codoperador, codperfil, atribuido };
    });
  }
}
