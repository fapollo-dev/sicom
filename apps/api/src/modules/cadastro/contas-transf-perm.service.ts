import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { TransferenciasPermitidasDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * os destinos para os quais `origem` pode transferir — ou `null` quando a origem é LIVRE (não tem linha ativa).
 *
 * ⚠️ A regra é da origem, não global (mig 295): desde que a matriz existe, nenhuma transferência do cliente saiu de
 * uma conta listada para um destino fora da lista, e as "fora" vieram todas de uma conta que não está na matriz.
 */
export async function destinosPermitidos(db: AnyDB, origem: number): Promise<number[] | null> {
  const rows = (await db
    .selectFrom('contas_banc_transf_perm')
    .select('codconta_destino')
    .where('codconta_origem', '=', origem)
    .where('ativo', '=', 'S')
    .execute()) as Array<{ codconta_destino: number }>;
  return rows.length ? rows.map((r) => Number(r.codconta_destino)) : null;
}

/**
 * TRANSFERÊNCIAS PERMITIDAS ENTRE CONTAS — a matriz de uma conta de origem (mig 295). Grava a lista inteira numa
 * transação que trava a conta de origem, como os itens do histórico: é um recurso da conta, fora do agregado do
 * cadastro, para não mexer no fluxo de gravação que já funciona.
 */
@Injectable()
export class ContasTransfPermService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async listar(codconta: number) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.exigirConta(db, codconta, emp);
    return this.lista(db, codconta);
  }

  async gravar(codconta: number, dto: TransferenciasPermitidasDto) {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.exigirConta(trx, codconta, emp, true);
      for (const d of dto.destinos) {
        // transferir para si mesma já é recusado na transferência; na matriz seria um par sem sentido
        if (d.codconta_destino === codconta) throw new BusinessRuleError('TRANSFERENCIA_MESMA_CONTA', { conta: codconta });
        // o destino tem de ser uma conta desta empresa — é o que a transferência exige das duas pontas
        await this.exigirConta(trx, d.codconta_destino, emp);
      }
      await trx.deleteFrom('contas_banc_transf_perm').where('codconta_origem', '=', codconta).execute();
      if (dto.destinos.length) {
        await trx
          .insertInto('contas_banc_transf_perm')
          .values(
            dto.destinos.map((d) => ({
              codconta_origem: codconta,
              codconta_destino: d.codconta_destino,
              ativo: d.ativo,
              usultalteracao: op,
              dtultimalteracao: sql`now()`,
            })),
          )
          .execute();
      }
      return this.lista(trx, codconta);
    });
  }

  private async lista(db: AnyDB, codconta: number) {
    const destinos = (await sql<{ codconta_destino: number; ativo: string; titular: string | null; nroconta: string | null }>`
        SELECT p.codconta_destino, p.ativo, c.titular, c.nroconta
          FROM contas_banc_transf_perm p
          LEFT JOIN contas_bancarias c ON c.codconta = p.codconta_destino
         WHERE p.codconta_origem = ${codconta}
         ORDER BY p.codconta_destino`.execute(db)).rows;
    // o que a tela precisa dizer ao operador: com linha ativa, a conta só transfere para a lista
    return { codconta, restrita: destinos.some((d) => d.ativo === 'S'), destinos };
  }

  private async exigirConta(db: AnyDB, codconta: number, emp: number, travar = false) {
    let q = db.selectFrom('contas_bancarias').select('codconta').where('codconta', '=', codconta).where('idempresa', '=', emp);
    if (travar) q = q.forUpdate();
    if (!(await q.executeTakeFirst())) throw new BusinessRuleError('CONTA_NAO_ENCONTRADA', { codconta });
  }
}
