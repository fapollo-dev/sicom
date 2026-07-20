import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { CaixaService } from './caixa.service';
import { BaixaContabilService } from './baixa-contabil.service';
import { SenhaOperacaoService } from '../cadastro/senha-operacao.service';
import { assertPeriodoNaoFechado } from '../shared/periodo-contabil';

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
 * Recurso DINHEIRO (corte-2a): lança RECEBIMENTO no caixa aberto do operador (`caixa.lancarDaBaixa`),
 * na mesma transação; o estorno desfaz o movimento (`caixa.estornarDaBaixa`).
 * Corte-3a (baixa PARCIAL): se valorpg<total, gera título-saldo ORIGEM='B' (o estorno o remove).
 * Corte-3b (contábil DINHEIRO): auto-disparo best-effort `contabil.contabilizarNoTrx` (D 183/C cliente,
 * CODORIGEM=16); o estorno reverte o DIÁRIO (`contabil.estornarNoTrx`) — destrava o antigo BAIXA_CONTABILIZADA.
 * Corte-2 (recurso BANCO): depósito direto (NÃO toca o caixa) → contábil D conta-do-banco (contas_bancarias.
 * codlanccontabil) / C cliente. Adiado: cheque/cartão (tabelas CHEQUE/CARTAO ausentes); juros/desconto separados
 * (INÓCUO — o cliente é creditado o valorpg cheio); permuta/saldo/troco; adiantamento.
 */
@Injectable()
export class AreceberBaixaService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly caixa: CaixaService,
    private readonly contabil: BaixaContabilService,
    private readonly senhaOp: SenhaOperacaoService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /**
   * GATE de senha de operação de DESCONTO (E7, UBaixaAreceber.edtDesc_AcreExit → SenhaAdministrativa('DESC')):
   * QUALQUER acréscimo/desconto líquido ≠ 0 exige a senha de DESCONTO da empresa. Verificado ANTES da
   * transação (fail-fast, sem segurar locks). Fiel ao legado, MENOS os backdoors mestres (SYSAPOLLO<data>/
   * SENHARETAGUARDA), já eliminados no épico de auth. Sem senha configurada → verificar retorna ok:false
   * (o legado também bloqueia o desconto quando SENHADESC está vazia).
   */
  private async exigirSenhaDesconto(acreDesc: number, senha?: string): Promise<void> {
    if (acreDesc === 0) return; // sem desconto/acréscimo → não pede senha
    if (!senha) throw new BusinessRuleError('SENHA_OPERACAO_REQUERIDA', { tipo: 'desc' });
    const { ok } = await this.senhaOp.verificar('desc', senha);
    if (!ok) throw new BusinessRuleError('SENHA_OPERACAO_INVALIDA', { tipo: 'desc' });
  }

  /** auto-disparo contábil da baixa (best-effort): regra de negócio (inelegível/config/período) NÃO
   * aborta a baixa — só pula o lançamento (fiel ao legado, que avisa no log de integração). */
  private async tentarContabilizar(trx: AnyDB, emp: number, p: { codbx: number; codparceiro: number | null; valor: number; data: unknown; op: number | null; contaMoney?: number | null }): Promise<void> {
    try {
      await this.contabil.contabilizarNoTrx(trx, emp, { origem: 'AR', ...p });
    } catch (e) {
      if (!(e instanceof BusinessRuleError)) throw e; // erro real (DB) aborta tudo; regra de negócio, não.
    }
  }

  /** conta contábil do banco (contas_bancarias.codlanccontabil) p/ o recurso BANCO. 422 se a CONTA BANCÁRIA
   * não existe no tenant. Devolve null (→ contábil pulado best-effort) se o banco não tem codlanccontabil, ou
   * se ele aponta p/ conta ausente no plano_contas — evita que um FK error (config do banco) aborte a baixa. */
  private async contaBanco(trx: AnyDB, emp: number, codconta: number): Promise<number | null> {
    const b = await trx.selectFrom('contas_bancarias').select('codlanccontabil').where('codconta', '=', codconta).where('idempresa', '=', emp).executeTakeFirst();
    if (!b) throw new BusinessRuleError('CONTA_BANCARIA_NAO_ENCONTRADA', { codconta });
    const n = Number((b as any).codlanccontabil);
    if ((b as any).codlanccontabil == null || !Number.isFinite(n)) return null; // banco sem conta contábil mapeada
    const pc = await trx.selectFrom('plano_contas').select('codplanocontas').where('codplanocontas', '=', n).executeTakeFirst();
    return pc ? n : null; // conta mapeada mas ausente no plano → pula (não corrompe a baixa com FK error)
  }

  async baixar(
    codrcb: number,
    dto: { dtpgto?: string; juros?: number; multa?: number; desconto?: number; acrescimo?: number; valorpg?: number; dtvencSaldo?: string; recurso?: string; codconta?: number; obs?: string; senhaOperacao?: string },
  ): Promise<{ codrcb: number; valorpg: number; juros: number; quitada: 'S'; parcial: boolean; saldoTitulo: number | null }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    // trava de período fechado (UBaixaAreceber:1319 ValidaPeriodoFechado; DTPGTO × BLOQ_BAIXA_RCB) — fora da trx.
    await assertPeriodoNaoFechado(this.dbp.forTenantRead() as AnyDB, emp, dto.dtpgto ?? new Date().toISOString().slice(0, 10), 'bloq_baixa_rcb');
    // GATE de senha (E7): acréscimo/desconto líquido ≠ 0 exige a senha de DESCONTO da empresa (fora da trx).
    await this.exigirSenhaDesconto(r2(num(dto.acrescimo) - num(dto.desconto)), dto.senhaOperacao);
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // lê e TRAVA o título (escopo empresa).
      const t = await trx
        .selectFrom('areceber')
        .select(['codrcb', 'valor', 'quitada', 'agrupado', 'codparceiro', 'dtvenda', 'dtvenc', 'txjuros', 'tipodoc'])
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
      const total = r2(valor + juros + multa + acre); // total devido (base da baixa/parcial)
      const valorpg = r2(dto.valorpg != null ? num(dto.valorpg) : total);
      // o valor recebido tem de ser > 0 (uCadAReceber/UBaixaAreceber :1345: "o valor da conta deve ser
      // maior que zero"): impede quitar título sem dinheiro (ex.: desconto ≥ valor+juros).
      if (valorpg <= 0) throw new BusinessRuleError('TITULO_VALOR_INVALIDO', { valorpg });
      // pagou a MAIS que o total: o legado gera TROCO/crédito (MOSTRAR_TROCO_BAIXA_CR, UBaixaAreceber.pas:1499);
      // troco é corte-3 — até lá, REJEITA (não grava recebimento fantasma sem gerar o troco).
      if (valorpg > total) throw new BusinessRuleError('TITULO_VALOR_EXCEDE', { valorpg, total });
      const parcial = valorpg < total; // pagou menos que o total → gera título-saldo (UBaixaAreceber.pas:1403)
      const dtpgto = dto.dtpgto ?? sql`current_date`;

      const bxIns = await trx
        .insertInto('areceber_bx')
        .values({
          codrcb, codempresa: emp, valorpg, juros: r2(juros), multa: r2(multa), acre_desc: acre,
          dtpgto, codopbx: op, data_operacao: sql`now()`, indr: 'I', obs: dto.obs ?? null,
        })
        .returning('codrcbbx').executeTakeFirstOrThrow();

      // quita o título — CAS (quitada='N') p/ idempotência anti-corrida.
      const upd = await trx
        .updateTable('areceber')
        .set({ quitada: 'S', dtpgto, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codrcb', '=', codrcb)
        .where('codempresa', '=', emp)
        .where('quitada', '=', 'N')
        .executeTakeFirst();
      if (Number(upd?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('TITULO_JA_BAIXADO', { codrcb });

      // BAIXA PARCIAL: gera um NOVO título com o SALDO (total − pago), ORIGEM='B' (UBaixaAreceber.pas:1449),
      // e vincula à baixa (codrcb_gerado) p/ o estorno poder removê-lo. Herda cliente/datas/juros do original.
      let saldoTitulo: number | null = null;
      if (parcial) {
        const saldo = r2(total - valorpg);
        const sIns = await trx
          .insertInto('areceber')
          .values({
            // herda cliente/emissão/juros do original; DTVENC = data renegociada (UBaixaAreceber.pas:1433
            // prompta nova data — Oracle: saldo nasce com DTVENC = dia da baixa, não o vencimento original),
            // default = dtpgto. TIPODOC forçado 'DUPLICATA' (:1456; Oracle 135/135). cadastrado_manualmente
            // fica no DEFAULT 'N' = "não-manual" (convenção do monorepo p/ SISTEMA, 043:45; legado grava NULL —
            // mesma semântica remapeada). NRODUP/DUPLICATA/IDPGTO/DOCNF = corte boleto.
            codparceiro: (t as any).codparceiro, codempresa: emp, valor: saldo,
            dtvenda: (t as any).dtvenda, dtvenc: dto.dtvencSaldo ?? dtpgto, txjuros: (t as any).txjuros, tipodoc: 'DUPLICATA',
            origem: 'B', gerado: 'SISTEMA', quitada: 'N', agrupado: 'N', consiliado: 'S',
            obs: `Documento gerado da baixa parcial do título ${codrcb}.`,
            usultalteracao: op, dtultimalteracao: sql`now()`, dtcadastro: sql`now()`,
          })
          .returning('codrcb').executeTakeFirstOrThrow();
        saldoTitulo = Number((sIns as any).codrcb);
        await trx.updateTable('areceber_bx').set({ codrcb_gerado: saldoTitulo }).where('codrcbbx', '=', Number((bxIns as any).codrcbbx)).execute();
      }

      // recurso DINHEIRO → RECEBIMENTO no caixa aberto (mesma trx) + contábil (CODORIGEM=16: D 183 CAIXA / C cliente).
      // recurso BANCO → depósito direto (NÃO toca o caixa) + contábil (D conta-do-banco / C cliente).
      const recurso = String(dto.recurso ?? '').toUpperCase();
      if (recurso === 'DINHEIRO') {
        await this.caixa.lancarDaBaixa(trx, { origem: 'AR', valorpg: r2(valorpg), codrcbbx: Number((bxIns as any).codrcbbx), dtpgto: dto.dtpgto, obs: dto.obs ?? null });
        await this.tentarContabilizar(trx, emp, { codbx: Number((bxIns as any).codrcbbx), codparceiro: (t as any).codparceiro ?? null, valor: r2(valorpg), data: dtpgto, op });
      } else if (recurso === 'BANCO') {
        const contaMoney = await this.contaBanco(trx, emp, num(dto.codconta)); // 422 se conta inexistente
        if (contaMoney != null) await this.tentarContabilizar(trx, emp, { codbx: Number((bxIns as any).codrcbbx), codparceiro: (t as any).codparceiro ?? null, valor: r2(valorpg), data: dtpgto, op, contaMoney });
      }

      return { codrcb, valorpg: r2(valorpg), juros: r2(juros), quitada: 'S', parcial, saldoTitulo };
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
        .select(['codrcbbx', 'codrcb_gerado', 'dtpgto'])
        .where('codrcb', '=', codrcb)
        .where('codempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '=', 'I')
        .forUpdate()
        .executeTakeFirst();
      if (!bx) throw new BusinessRuleError('TITULO_NAO_BAIXADO', { codrcb });

      // período fechado × BLOQ_BAIXA_RCB — o legado barra a REVERSÃO da baixa em período fechado
      // (UReversaoBaixa.pas:119/137, por DtEmissao do movimento). Gate na DTPGTO da baixa revertida.
      await assertPeriodoNaoFechado(trx, emp, bx.dtpgto, 'bloq_baixa_rcb');

      // estorno contábil da baixa (corte-3b): se foi contabilizada, reverte o DIÁRIO na mesma transação
      // (destrava o antigo bloqueio BAIXA_CONTABILIZADA — espelha NF reverter / caixa reabrir). No-op se não houve.
      await this.contabil.estornarNoTrx(trx, emp, 'AR', bx.codrcbbx, op);

      // se a baixa foi PARCIAL, remove o título-saldo gerado (senão reabrir o original duplicaria a
      // dívida). SÓ deleta um saldo INTOCADO: qualquer baixa no saldo (ativa OU estornada) bloqueia —
      // deletar deixaria caixa_mov órfão (codrcbbx sem FK) e apagaria histórico. Também barra agrupado/em-lote.
      if ((bx as any).codrcb_gerado != null) {
        const codSaldo = Number((bx as any).codrcb_gerado);
        const saldo = await trx
          .selectFrom('areceber').select(['codrcb', 'agrupado'])
          .where('codrcb', '=', codSaldo).where('codempresa', '=', emp)
          .forUpdate().executeTakeFirst();
        if (saldo) {
          const saldoBx = await trx.selectFrom('areceber_bx').select('codrcbbx').where('codrcb', '=', codSaldo).executeTakeFirst();
          if (saldoBx) throw new BusinessRuleError('REVERSAO_PARCIAL_SALDO_BAIXADO', { codrcb: codSaldo });
          if ((saldo as any).agrupado === 'S') throw new BusinessRuleError('TITULO_AGRUPADO', { codrcb: codSaldo });
          const saldoEmLote = await trx.selectFrom('itens_lotecob').select('codilotcob').where('codrcb', '=', codSaldo).executeTakeFirst();
          if (saldoEmLote) throw new BusinessRuleError('TITULO_EM_LOTE', { codrcb: codSaldo });
          await trx.deleteFrom('areceber').where('codrcb', '=', codSaldo).where('codempresa', '=', emp).execute();
        }
      }

      // ESTORNO LÓGICO: marca EXATAMENTE a baixa lida (codrcbbx) como 'E' — não deleta (preserva
      // histórico) e não toca outras baixas ativas do mesmo título (modelo 1:N; a guarda de
      // `contabilizado` acima valida a MESMA linha que este UPDATE vira), reabre o título.
      await trx
        .updateTable('areceber_bx')
        .set({ indr: 'E', data_operacao: sql`now()` })
        .where('codrcbbx', '=', bx.codrcbbx)
        .execute();
      // desfaz (lógico) o movimento de caixa dessa baixa, se houve (no-op se recurso ≠ dinheiro;
      // bloqueia se o caixa já foi fechado). Atômico com o estorno do título.
      await this.caixa.estornarDaBaixa(trx, { codrcbbx: bx.codrcbbx });
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
