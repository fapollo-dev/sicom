import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { CaixaService } from './caixa.service';

type AnyDB = Kysely<any>;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/**
 * BAIXA/PAGAMENTO de CONTAS A PAGAR — corte-2 núcleo. Gêmea de `areceber-baixa.service.ts` (mesmo
 * molde: transação + FOR UPDATE + CAS + tenant codempresa; estorno LÓGICO via APAGAR_BX.INDR='E').
 * Já nasce com as correções auditadas em A Receber: valorpg>0 (`TITULO_VALOR_INVALIDO`) e estorno
 * por PK (codapgbx). NÃO tem a trava "em lote de cobrança" (isso é de recebíveis). Recurso DINHEIRO
 * (corte-2a): lança PAGAMENTO (saída) no caixa aberto do operador (`caixa.lancarDaBaixa`), na mesma
 * transação; o estorno desfaz o movimento. Adiado (corte-3): baixa parcial, demais recursos (cheque/
 * cartão), contábil do pagamento, período-fechado.
 */
@Injectable()
export class ApagarBaixaService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly caixa: CaixaService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async baixar(
    codapg: number,
    dto: { dtpgto?: string; juros?: number; multa?: number; desconto?: number; acrescimo?: number; valorpg?: number; recurso?: string; obs?: string },
  ): Promise<{ codapg: number; valorpg: number; juros: number; quitada: 'S' }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const t = await trx
        .selectFrom('apagar')
        .select(['codapg', 'valor', 'quitada', 'agrupado'])
        .where('codapg', '=', codapg)
        .where('codempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!t) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codapg });
      if (t.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO');
      if (t.agrupado === 'S') throw new BusinessRuleError('TITULO_AGRUPADO');

      const valor = num(t.valor);
      let juros = dto.juros;
      if (juros == null) {
        const v = await trx.selectFrom('get_apagar').select('juro').where('codapg', '=', codapg).where('codempresa', '=', emp).executeTakeFirst();
        juros = num(v?.juro);
      }
      const multa = num(dto.multa);
      const acre = r2(num(dto.acrescimo) - num(dto.desconto));
      const valorpg = r2(dto.valorpg != null ? num(dto.valorpg) : valor + juros + multa + acre);
      if (valorpg <= 0) throw new BusinessRuleError('TITULO_VALOR_INVALIDO', { valorpg });
      const dtpgto = dto.dtpgto ?? sql`current_date`;

      const bxIns = await trx
        .insertInto('apagar_bx')
        .values({
          codapg, codempresa: emp, valorpg, juros: r2(juros), multa: r2(multa), acre_desc: acre,
          dtpgto, codopbx: op, data_operacao: sql`now()`, indr: 'I', obs: dto.obs ?? null,
        })
        .returning('codapgbx').executeTakeFirstOrThrow();

      const upd = await trx
        .updateTable('apagar')
        .set({ quitada: 'S', dtpgto, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codapg', '=', codapg)
        .where('codempresa', '=', emp)
        .where('quitada', '=', 'N')
        .executeTakeFirst();
      if (Number(upd?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('TITULO_JA_BAIXADO', { codapg });

      // recurso DINHEIRO → lança PAGAMENTO (saída, com guarda de saldo≥0) no caixa aberto do operador.
      if (String(dto.recurso ?? '').toUpperCase() === 'DINHEIRO') {
        await this.caixa.lancarDaBaixa(trx, { origem: 'AP', valorpg: r2(valorpg), codapgbx: Number((bxIns as any).codapgbx), dtpgto: dto.dtpgto, obs: dto.obs ?? null });
      }

      return { codapg, valorpg: r2(valorpg), juros: r2(juros), quitada: 'S' };
    });
  }

  async estornar(codapg: number): Promise<{ codapg: number; quitada: 'N' }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const t = await trx
        .selectFrom('apagar')
        .select(['codapg', 'quitada'])
        .where('codapg', '=', codapg)
        .where('codempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!t) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codapg });
      if (t.quitada !== 'S') throw new BusinessRuleError('TITULO_NAO_BAIXADO', { codapg });

      const bx = await trx
        .selectFrom('apagar_bx')
        .select(['codapgbx', 'contabilizado'])
        .where('codapg', '=', codapg)
        .where('codempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '=', 'I')
        .forUpdate()
        .executeTakeFirst();
      if (!bx) throw new BusinessRuleError('TITULO_NAO_BAIXADO', { codapg });
      if (bx.contabilizado === 'S') throw new BusinessRuleError('BAIXA_CONTABILIZADA', { codapg });

      // estorno LÓGICO da linha lida (codapgbx) — não deleta, reabre o título.
      await trx.updateTable('apagar_bx').set({ indr: 'E', data_operacao: sql`now()` }).where('codapgbx', '=', bx.codapgbx).execute();
      // desfaz (lógico) o movimento de caixa dessa baixa, se houve (no-op se ≠ dinheiro; bloqueia se caixa fechado).
      await this.caixa.estornarDaBaixa(trx, { codapgbx: bx.codapgbx });
      const upd = await trx
        .updateTable('apagar')
        .set({ quitada: 'N', dtpgto: null, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codapg', '=', codapg)
        .where('codempresa', '=', emp)
        .where('quitada', '=', 'S')
        .executeTakeFirst();
      if (Number(upd?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('TITULO_NAO_BAIXADO', { codapg });

      return { codapg, quitada: 'N' };
    });
  }
}
