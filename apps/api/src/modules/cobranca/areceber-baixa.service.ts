import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/**
 * BAIXA (recebimento) de CONTAS A RECEBER — corte-2 NÚCLEO. Serviço stateful no molde dos serviços
 * da NF (`nf-faturamento.service.ts`): transação única + FOR UPDATE + CAS + BusinessRuleError→422 +
 * tenant por codempresa (fail-closed).
 *
 * `baixar`: quita o título TOTAL (uma linha ARECEBER_BX INDR='I' + ARECEBER.QUITADA='S'), com juros
 * (default = fórmula legada da view get_areceber) + multa + acréscimo/desconto. Guardas: já quitado,
 * agrupado, e EM LOTE de cobrança (itens_lotecob) — não baixar aqui p/ não dessincronizar o lote.
 * `estornar`: ESTORNO LÓGICO (ARECEBER_BX.INDR='E', não deleta — preserva histórico) + reabre o título.
 * Adiado (corte-3, dossiê §6): baixa PARCIAL (novo título ORIGEM='B'), 10 recursos (caixa/cheque/
 * cartão/permuta/saldo/troco), contábil da baixa, adiantamento.
 */
@Injectable()
export class AreceberBaixaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async baixar(
    codrcb: number,
    dto: { dtpgto?: string; juros?: number; multa?: number; desconto?: number; acrescimo?: number; valorpg?: number; obs?: string },
  ): Promise<{ codrcb: number; valorpg: number; juros: number; quitada: 'S' }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // lê e TRAVA o título (escopo empresa).
      const t = await trx
        .selectFrom('areceber')
        .select(['codrcb', 'valor', 'quitada', 'agrupado'])
        .where('codrcb', '=', codrcb)
        .where('codempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!t) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codrcb });
      if (t.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO');
      if (t.agrupado === 'S') throw new BusinessRuleError('TITULO_AGRUPADO'); // baixa do agrupamento = corte-3
      // título em LOTE de cobrança não pode ser baixado por aqui (dessincronizaria o lote).
      const emLote = await trx.selectFrom('itens_lotecob').select('codilotcob').where('codrcb', '=', codrcb).executeTakeFirst();
      if (emLote) throw new BusinessRuleError('TITULO_EM_LOTE');

      const valor = num(t.valor);
      // juros default = fórmula do legado (view get_areceber.juro, carência por PARCEIROS.TOLERANCIA).
      let juros = dto.juros;
      if (juros == null) {
        const v = await trx.selectFrom('get_areceber').select('juro').where('codrcb', '=', codrcb).where('codempresa', '=', emp).executeTakeFirst();
        juros = num(v?.juro);
      }
      const multa = num(dto.multa);
      const acre = r2(num(dto.acrescimo) - num(dto.desconto)); // acréscimo (+) / desconto (−)
      const valorpg = r2(dto.valorpg != null ? num(dto.valorpg) : valor + juros + multa + acre);
      // o valor recebido tem de ser > 0 (uCadAReceber/UBaixaAreceber :1345: "o valor da conta deve ser
      // maior que zero"): impede quitar título sem dinheiro (ex.: desconto ≥ valor+juros).
      if (valorpg <= 0) throw new BusinessRuleError('TITULO_VALOR_INVALIDO', { valorpg });
      const dtpgto = dto.dtpgto ?? sql`current_date`;

      await trx
        .insertInto('areceber_bx')
        .values({
          codrcb, codempresa: emp, valorpg, juros: r2(juros), multa: r2(multa), acre_desc: acre,
          dtpgto, codopbx: op, data_operacao: sql`now()`, indr: 'I', obs: dto.obs ?? null,
        })
        .execute();

      // quita o título — CAS (quitada='N') p/ idempotência anti-corrida.
      const upd = await trx
        .updateTable('areceber')
        .set({ quitada: 'S', dtpgto, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codrcb', '=', codrcb)
        .where('codempresa', '=', emp)
        .where('quitada', '=', 'N')
        .executeTakeFirst();
      if (Number(upd?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('TITULO_JA_BAIXADO', { codrcb });

      return { codrcb, valorpg: r2(valorpg), juros: r2(juros), quitada: 'S' };
    });
  }

  async estornar(codrcb: number): Promise<{ codrcb: number; quitada: 'N' }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const t = await trx
        .selectFrom('areceber')
        .select(['codrcb', 'quitada'])
        .where('codrcb', '=', codrcb)
        .where('codempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!t) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codrcb });
      if (t.quitada !== 'S') throw new BusinessRuleError('TITULO_NAO_BAIXADO', { codrcb });

      // baixa ativa (INDR='I'); barra se já contabilizada (estorno contábil = corte-3).
      const bx = await trx
        .selectFrom('areceber_bx')
        .select(['codrcbbx', 'contabilizado'])
        .where('codrcb', '=', codrcb)
        .where('codempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '=', 'I')
        .forUpdate()
        .executeTakeFirst();
      if (!bx) throw new BusinessRuleError('TITULO_NAO_BAIXADO', { codrcb });
      if (bx.contabilizado === 'S') throw new BusinessRuleError('BAIXA_CONTABILIZADA', { codrcb });

      // ESTORNO LÓGICO: marca EXATAMENTE a baixa lida (codrcbbx) como 'E' — não deleta (preserva
      // histórico) e não toca outras baixas ativas do mesmo título (modelo 1:N; a guarda de
      // `contabilizado` acima valida a MESMA linha que este UPDATE vira), reabre o título.
      await trx
        .updateTable('areceber_bx')
        .set({ indr: 'E', data_operacao: sql`now()` })
        .where('codrcbbx', '=', bx.codrcbbx)
        .execute();
      const upd = await trx
        .updateTable('areceber')
        .set({ quitada: 'N', dtpgto: null, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codrcb', '=', codrcb)
        .where('codempresa', '=', emp)
        .where('quitada', '=', 'S')
        .executeTakeFirst();
      if (Number(upd?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('TITULO_NAO_BAIXADO', { codrcb });

      return { codrcb, quitada: 'N' };
    });
  }
}
