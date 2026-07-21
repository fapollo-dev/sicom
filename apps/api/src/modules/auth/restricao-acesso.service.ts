import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { RestricaoAcessoDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = any;

/**
 * OPERADORES_RESTRICAO_ACESSO — CADASTRO das janelas de horário de acesso por operador (T1.5).
 * A CHECAGEM (login gate) vive no AuthService.assertHorarioPermitido; este serviço só gerencia as janelas
 * (listar/adicionar/remover). Soft-delete via `indr='E'` (padrão do legado). RBAC = FRMCADOPERADOR (a mesma
 * tela do operador). Schema-per-tenant (a tabela `operadores` é por tenant).
 */
@Injectable()
export class RestricaoAcessoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private db(): AnyDB {
    return this.dbp.forTenant() as AnyDB;
  }

  /** garante que o operador existe e está ativo (não excluído) — mesma regra do cadastro. */
  private async assertOperador(db: AnyDB, codoperador: number): Promise<void> {
    const op = await db
      .selectFrom('operadores')
      .select('codoperador')
      .where('codoperador', '=', codoperador)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst();
    if (!op) throw new BusinessRuleError('OPERADOR_NAO_ENCONTRADO', { codoperador });
  }

  /** janelas ATIVAS do operador, ordenadas por dia/hora. */
  async listar(codoperador: number): Promise<Array<{ codrestricao_acesso: number; codoperador: number; diasemana: number; hora_inicial: string; hora_final: string }>> {
    const db = this.db();
    await this.assertOperador(db, codoperador);
    return (await db
      .selectFrom('operadores_restricao_acesso')
      .select(['codrestricao_acesso', 'codoperador', 'diasemana', 'hora_inicial', 'hora_final'])
      .where('codoperador', '=', codoperador)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .orderBy('diasemana')
      .orderBy('hora_inicial')
      .execute()) as any;
  }

  /** adiciona uma janela (dia + faixa 'HH:MM'). O schema já valida formato e hora_inicial < hora_final. */
  async adicionar(codoperador: number, dto: RestricaoAcessoDto): Promise<{ codrestricao_acesso: number }> {
    const db = this.db();
    await this.assertOperador(db, codoperador);
    const usu = currentTenant().operadorId ?? null;
    const row = (await db
      .insertInto('operadores_restricao_acesso')
      .values({
        codoperador,
        diasemana: dto.diasemana,
        hora_inicial: dto.hora_inicial,
        hora_final: dto.hora_final,
        indr: 'I',
        usucadastro: usu,
      })
      .returning('codrestricao_acesso')
      .executeTakeFirstOrThrow()) as { codrestricao_acesso: number };
    return { codrestricao_acesso: Number(row.codrestricao_acesso) };
  }

  /** remove (soft-delete) uma janela do operador. Só afeta se ainda ativa e pertence ao operador. */
  async remover(codoperador: number, id: number): Promise<{ removido: boolean }> {
    const db = this.db();
    await this.assertOperador(db, codoperador); // contrato consistente com listar/adicionar (404 p/ operador inexistente)
    const usu = currentTenant().operadorId ?? null;
    const res = (await db
      .updateTable('operadores_restricao_acesso')
      .set({ indr: 'E', usultalteracao: usu, dtultimalteracao: sql`now()` })
      .where('codrestricao_acesso', '=', id)
      .where('codoperador', '=', codoperador)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { numUpdatedRows?: bigint } | undefined;
    return { removido: Number(res?.numUpdatedRows ?? 0) > 0 };
  }
}
