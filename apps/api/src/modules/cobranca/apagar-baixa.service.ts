import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { CaixaService } from './caixa.service';
import { BaixaContabilService } from './baixa-contabil.service';

type AnyDB = Kysely<any>;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/**
 * BAIXA/PAGAMENTO de CONTAS A PAGAR — corte-2 núcleo. Gêmea de `areceber-baixa.service.ts` (mesmo
 * molde: transação + FOR UPDATE + CAS + tenant codempresa; estorno LÓGICO via APAGAR_BX.INDR='E').
 * Já nasce com as correções auditadas em A Receber: valorpg>0 (`TITULO_VALOR_INVALIDO`) e estorno
 * por PK (codapgbx). NÃO tem a trava "em lote de cobrança" (isso é de recebíveis). Recurso DINHEIRO
 * (corte-2a): lança PAGAMENTO (saída) no caixa aberto do operador (`caixa.lancarDaBaixa`), na mesma
 * transação; o estorno desfaz o movimento. Corte-3a: pagamento PARCIAL (título-saldo ORIGEM='B').
 * Corte-3b: contábil DINHEIRO (auto-disparo `contabil.contabilizarNoTrx`, D fornecedor/C 183, CODORIGEM=15;
 * estorno reverte). Adiado (corte-3): demais recursos (cheque/cartão), contábil banco + juros/desconto.
 */
@Injectable()
export class ApagarBaixaService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly caixa: CaixaService,
    private readonly contabil: BaixaContabilService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** auto-disparo contábil do pagamento (best-effort; espelha AR). */
  private async tentarContabilizar(trx: AnyDB, emp: number, p: { codbx: number; codparceiro: number | null; valor: number; data: unknown; op: number | null }): Promise<void> {
    try {
      await this.contabil.contabilizarNoTrx(trx, emp, { origem: 'AP', ...p });
    } catch (e) {
      if (!(e instanceof BusinessRuleError)) throw e;
    }
  }

  async baixar(
    codapg: number,
    dto: { dtpgto?: string; juros?: number; multa?: number; desconto?: number; acrescimo?: number; valorpg?: number; dtvencSaldo?: string; recurso?: string; obs?: string },
  ): Promise<{ codapg: number; valorpg: number; juros: number; quitada: 'S'; parcial: boolean; saldoTitulo: number | null }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const t = await trx
        .selectFrom('apagar')
        .select(['codapg', 'valor', 'quitada', 'agrupado', 'codparceiro', 'dtvenda', 'dtvenc', 'txjuros', 'tipodoc'])
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
      const total = r2(valor + juros + multa + acre); // total devido (base do pagamento/parcial)
      const valorpg = r2(dto.valorpg != null ? num(dto.valorpg) : total);
      if (valorpg <= 0) throw new BusinessRuleError('TITULO_VALOR_INVALIDO', { valorpg });
      // pagou a MAIS que o total: troco/crédito é corte-3 — até lá, REJEITA (espelha AR; não grava pagamento fantasma).
      if (valorpg > total) throw new BusinessRuleError('TITULO_VALOR_EXCEDE', { valorpg, total });
      const parcial = valorpg < total; // pagou menos que o total → gera título-saldo (espelha UBaixaAreceber.pas:1403)
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

      // PAGAMENTO PARCIAL: gera um NOVO título com o SALDO (total − pago), ORIGEM='B', e vincula à baixa
      // (codapg_gerado) p/ o estorno poder removê-lo. Herda fornecedor/datas/juros do original.
      let saldoTitulo: number | null = null;
      if (parcial) {
        const saldo = r2(total - valorpg);
        const sIns = await trx
          .insertInto('apagar')
          .values({
            // espelha AR: DTVENC = data renegociada (default dtpgto), TIPODOC forçado 'DUPLICATA',
            // cadastrado_manualmente no DEFAULT 'N' (convenção monorepo p/ SISTEMA, 045). NRODUP/DUPLICATA/IDPGTO/DOCNF = corte boleto.
            codparceiro: (t as any).codparceiro, codempresa: emp, valor: saldo,
            dtvenda: (t as any).dtvenda, dtvenc: dto.dtvencSaldo ?? dtpgto, txjuros: (t as any).txjuros, tipodoc: 'DUPLICATA',
            origem: 'B', gerado: 'SISTEMA', quitada: 'N', agrupado: 'N', consiliado: 'S',
            obs: `Documento gerado do pagamento parcial do título ${codapg}.`,
            usultalteracao: op, dtultimalteracao: sql`now()`, dtcadastro: sql`now()`,
          })
          .returning('codapg').executeTakeFirstOrThrow();
        saldoTitulo = Number((sIns as any).codapg);
        await trx.updateTable('apagar_bx').set({ codapg_gerado: saldoTitulo }).where('codapgbx', '=', Number((bxIns as any).codapgbx)).execute();
      }

      // recurso DINHEIRO → lança PAGAMENTO (saída, com guarda de saldo≥0) no caixa aberto do operador e
      // contabiliza o pagamento (auto-disparo best-effort, CODORIGEM=15: D fornecedor / C 183 CAIXA).
      if (String(dto.recurso ?? '').toUpperCase() === 'DINHEIRO') {
        await this.caixa.lancarDaBaixa(trx, { origem: 'AP', valorpg: r2(valorpg), codapgbx: Number((bxIns as any).codapgbx), dtpgto: dto.dtpgto, obs: dto.obs ?? null });
        await this.tentarContabilizar(trx, emp, { codbx: Number((bxIns as any).codapgbx), codparceiro: (t as any).codparceiro ?? null, valor: r2(valorpg), data: dtpgto, op });
      }

      return { codapg, valorpg: r2(valorpg), juros: r2(juros), quitada: 'S', parcial, saldoTitulo };
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
        .select(['codapgbx', 'codapg_gerado'])
        .where('codapg', '=', codapg)
        .where('codempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '=', 'I')
        .forUpdate()
        .executeTakeFirst();
      if (!bx) throw new BusinessRuleError('TITULO_NAO_BAIXADO', { codapg });

      // estorno contábil do pagamento (corte-3b): reverte o DIÁRIO na mesma transação (no-op se não houve).
      await this.contabil.estornarNoTrx(trx, emp, 'AP', bx.codapgbx, op);

      // se o pagamento foi PARCIAL, remove o título-saldo gerado (senão reabrir o original duplicaria a
      // dívida). SÓ deleta um saldo INTOCADO: qualquer baixa no saldo (ativa OU estornada) bloqueia
      // (evita caixa_mov órfão e perda de histórico). Também barra agrupado. AP não usa lote de cobrança.
      if ((bx as any).codapg_gerado != null) {
        const codSaldo = Number((bx as any).codapg_gerado);
        const saldo = await trx
          .selectFrom('apagar').select(['codapg', 'agrupado'])
          .where('codapg', '=', codSaldo).where('codempresa', '=', emp)
          .forUpdate().executeTakeFirst();
        if (saldo) {
          const saldoBx = await trx.selectFrom('apagar_bx').select('codapgbx').where('codapg', '=', codSaldo).executeTakeFirst();
          if (saldoBx) throw new BusinessRuleError('REVERSAO_PARCIAL_SALDO_BAIXADO', { codapg: codSaldo });
          if ((saldo as any).agrupado === 'S') throw new BusinessRuleError('TITULO_AGRUPADO', { codapg: codSaldo });
          await trx.deleteFrom('apagar').where('codapg', '=', codSaldo).where('codempresa', '=', emp).execute();
        }
      }

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
