import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

// CODORIGEM do fechamento de caixa no DIÁRIO (tocFechamentoCaixa, UIntegracaoContabil.pas:17-23).
const CODORIGEM_CAIXA = 17;
const CODORIGEM_TESOURARIA = 19; // INTEGRAÇÃO DE TRANSFERÊNCIAS (Oracle ORIGEM_CONTABIL) — caixa→tesouraria
const SIT_SOBRA = 2019; // CONFIG_SOBRACAIXA → D 183 CAIXA CENTRAL / C 541 SOBRA DE CAIXA
const SIT_QUEBRA = 2002; // CONFIG_FALTACAIXA (quebra-sem-título) → D 148 / C 183 CAIXA CENTRAL
const SIT_TRANSFERENCIA = 2020; // codoperacao da transferência de tesouraria (Oracle DIARIO CODORIGEM 19, 100%)
const HIST_TRANSFERENCIA = 86; // codhist herdado da IIC(2020) (Oracle)
const CONTA_CAIXA = 183; // 183 CAIXA CENTRAL (a conta operacional do caixa)
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * CAIXA corte-2d — CONTÁBIL da quebra/sobra do fechamento. Reconstrói TIntegracaoFechamentoCaixa
 * (UIntegracaoContabilFechamentoCaixa.pas) para a DIVERGÊNCIA, no molde de `nf-contabilizacao.service`:
 * lança 1 partida no DIÁRIO pela situação (contas FIXAS da ITENS_INTEGRACAO_CONTABIL), gate
 * EMPRESAS.INTEGRACAO='AUTOMATICA', período contábil aberto, idempotente (caixa_sessao.contabilizado)
 * e reversível (estorno na reabertura). SOBRA→2019; QUEBRA-sem-título→2002.
 *
 * ADIADO (bloqueado por dependência ausente): fechamento-por-modalidade (situação 2010, crédito na
 * transitória 200 alimentada pelo PDV — fora do escopo retaguarda) e quebra-COM-título (785, delega
 * ao contábil de A Receber, inexistente no monorepo). Ver dossiê uCaixa.md §3.
 */
@Injectable()
export class CaixaContabilService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** período contábil FECHADO barra contabilização/estorno (mesma regra da NF). Fail-open. */
  private async assertPeriodoAberto(trx: AnyDB, emp: number, data: unknown): Promise<void> {
    if (data == null) return;
    const fechado = await trx
      .selectFrom('periodo_contabil').select('competencia_contabil')
      .where('codempresa', '=', emp).where('status', '=', 'S').where('bloq_nf', '=', 'S')
      .where('data_inicio', '<=', data).where('data_fim', '>=', data)
      .executeTakeFirst();
    if (fechado) throw new BusinessRuleError('PERIODO_FECHADO', { data });
  }

  /** as duas linhas (D/C) da IIC para a situação (contas fixas 'F'). */
  private async iicDC(trx: AnyDB, situacao: number): Promise<{ d: number; c: number }> {
    const iic = await trx
      .selectFrom('itens_integracao_contabil')
      .select(['natureza', 'tipo', 'codconta_contabil'])
      .where('codoperacao', '=', situacao)
      .execute();
    const d = (iic as Record<string, unknown>[]).find((x) => x.natureza === 'D');
    const c = (iic as Record<string, unknown>[]).find((x) => x.natureza === 'C');
    if (!d?.codconta_contabil || !c?.codconta_contabil) throw new BusinessRuleError('CONTAS_NAO_INFORMADAS', { situacao });
    return { d: Number(d.codconta_contabil), c: Number(c.codconta_contabil) };
  }

  /**
   * Contabiliza o fechamento: (1) a DIVERGÊNCIA (sobra 2019 / quebra-sem-título 2002 — corte-2d) e (2) a
   * TESOURARIA do DINHEIRO (corte-2d-b): registra o dinheiro recebido no caixa (net das baixas AR/AP em
   * dinheiro, contabilizado em 183) como TRANSFERÊNCIA p/ a tesouraria — 1 linha no razão MOV_CONTAS_BANCARIAS
   * (ORIGEM='FCP', operacional) + 1 partida no DIÁRIO (CODORIGEM=19, codoperacao=2020). Para DINHEIRO a conta
   * contábil da tesouraria = a MESMA 183 (FORMAS_PGTO(DINHEIRO).codplanocontas=183; e codcontacorrente→
   * codlanccontabil=183) → a partida é um WASH D183/C183: contabilmente inócua, fiel ao legado (o dinheiro
   * fica em 183; muda só a sub-conta operacional, rastreada na MCB). 183 NÃO zera por caixa (acumula, como no
   * legado). Só ocorre com netDin>0 (o legado nunca gera saída 'D' no FCP). Ambos numa transação; reversível na
   * reabertura (estornarNoTrx apaga 17 E 19 + MCB). fundo/suprimento/sangria (CODORIGEM 64), fechamento por
   * modalidade (2010, PDV) e tesouraria multi-forma (cartão/banco → conta ≠ 183) = ADIADOS (recon).
   */
  async contabilizarFechamento(codcaixa: number): Promise<{ codcaixa: number; situacao: number | null; contadebito: number | null; contacredito: number | null; valor: number; tesouraria: { contadebito: number; contacredito: number; valor: number } | null }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const s = await trx
        .selectFrom('caixa_sessao')
        .select(['codcaixa', 'status', 'diferenca', 'codrcb_quebra', 'dtfechamento', 'contabilizado'])
        .where('codcaixa', '=', codcaixa).where('codempresa', '=', emp)
        .forUpdate().executeTakeFirst();
      if (!s) throw new BusinessRuleError('CAIXA_NAO_ENCONTRADO', { codcaixa });
      if ((s as any).status !== 'F') throw new BusinessRuleError('CAIXA_NAO_FECHADO', { codcaixa });
      if ((s as any).contabilizado === 'S') throw new BusinessRuleError('CAIXA_JA_CONTABILIZADA', { codcaixa });

      // gate: só integra quando a empresa é AUTOMATICA (EMPRESAS.INTEGRACAO).
      const empc = await trx.selectFrom('empresas').select('integracao').where('idempresa', '=', emp).executeTakeFirst();
      if ((empc as any)?.integracao !== 'AUTOMATICA') throw new BusinessRuleError('INTEGRACAO_NAO_AUTOMATICA', { codcaixa });
      await this.assertPeriodoAberto(trx, emp, (s as any).dtfechamento);

      const dif = num((s as any).diferenca);
      // quebra-COM-título: a divergência já virou um título A Receber → contábil delegado ao AR (785, CODORIGEM 14);
      // bloqueia o fechamento contábil inteiro (fiel ao corte-2d) até o título ser resolvido.
      if (dif < 0 && (s as any).codrcb_quebra != null) throw new BusinessRuleError('CAIXA_CONTABIL_QUEBRA_TITULO', { codcaixa });

      const netDin = await this.netDinheiroCaixa(trx, emp, codcaixa); // saldo de 183 do caixa (baixas AR−AP)
      // fechamento FCP só registra ENTRADA de dinheiro na tesouraria (netDin>0); netDin≤0 (caixa net-pagou) não é
      // modelado no legado (MCB FCP é 100% 'C'). Nada a contabilizar se não há divergência nem entrada de dinheiro.
      if (dif === 0 && netDin <= 0) throw new BusinessRuleError('CAIXA_SEM_DIFERENCA', { codcaixa });

      const dt = (s as any).dtfechamento;
      const lote = await trx
        .insertInto('lote_contabil')
        .values({ desclote: `CAIXA ${codcaixa}`, datalote: dt, codorigem: CODORIGEM_CAIXA, codempresa: emp })
        .returning('codlotecontabil').executeTakeFirstOrThrow();
      const codlote = Number((lote as any).codlotecontabil);

      // (1) DIVERGÊNCIA (corte-2d) — 1 partida por sobra/quebra-sem-título.
      let situacao: number | null = null, divD: number | null = null, divC: number | null = null, divValor = 0;
      if (dif !== 0) {
        situacao = dif > 0 ? SIT_SOBRA : SIT_QUEBRA;
        divValor = r2(Math.abs(dif));
        const { d, c } = await this.iicDC(trx, situacao);
        divD = d; divC = c;
        await trx.insertInto('diario').values({
          datalan: dt, contadebito: d, contacredito: c, valor: divValor,
          codorigem: CODORIGEM_CAIXA, idorigem: codcaixa, codoperacao: situacao, codempresa: emp,
          codhist: null, complemento: dif > 0 ? 'Sobra de caixa' : 'Quebra de caixa', codlote,
        }).execute();
      }

      // (2) TESOURARIA do DINHEIRO (corte-2d-b) — registra a entrada de dinheiro na tesouraria (netDin>0).
      let tesouraria: { contadebito: number; contacredito: number; valor: number } | null = null;
      if (netDin > 0) {
        const forma = await this.formaDinheiro(trx, emp); // { idpgto, conta (=183 p/ dinheiro), codcontacorrente }
        const valorTes = r2(netDin);
        // transferência caixa→tesouraria: D conta-da-tesouraria / C 183 CAIXA. P/ dinheiro conta=183 → WASH (inócua).
        await trx.insertInto('diario').values({
          datalan: dt, contadebito: forma.conta, contacredito: CONTA_CAIXA, valor: valorTes,
          codorigem: CODORIGEM_TESOURARIA, idorigem: codcaixa, codoperacao: SIT_TRANSFERENCIA, codempresa: emp,
          codhist: HIST_TRANSFERENCIA, complemento: `Tesouraria do caixa ${codcaixa} (dinheiro)`, codlote,
        }).execute();
        // razão de tesouraria (MCB) — o registro OPERACIONAL do dinheiro na conta da tesouraria (ORIGEM='FCP').
        await trx.insertInto('mov_contas_bancarias').values({
          codconta: forma.codcontacorrente, idempresa: emp, valor: valorTes, tipomovimento: 'C',
          codopconta: 0, historico: `Fechamento do caixa ${codcaixa} em DINHEIRO`, idpgto: forma.idpgto,
          codoperador: op, nropdv_fechamento: codcaixa, data_fechamento: dt, origem: 'FCP',
          idorigem: codcaixa, contabilizado: null, indr: 'I', dtcadastro: sql`now()`,
        }).execute();
        tesouraria = { contadebito: forma.conta, contacredito: CONTA_CAIXA, valor: valorTes };
      }

      const upd = await trx
        .updateTable('caixa_sessao')
        .set({ contabilizado: 'S', usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codcaixa', '=', codcaixa).where('codempresa', '=', emp)
        .where((eb: any) => eb.or([eb('contabilizado', '<>', 'S'), eb('contabilizado', 'is', null)]))
        .executeTakeFirst();
      if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('CAIXA_JA_CONTABILIZADA', { codcaixa });

      return { codcaixa, situacao, contadebito: divD, contacredito: divC, valor: divValor, tesouraria };
    });
  }

  /** saldo de 183 CAIXA CENTRAL deste caixa = Σ(baixa AR dinheiro, D 183, CODORIGEM 16) − Σ(baixa AP, C 183, 15).
   * Robusto ao gate AUTOMATICA (lê o que REALMENTE foi ao DIÁRIO, via os codrcbbx/codapgbx do caixa). */
  private async netDinheiroCaixa(trx: AnyDB, emp: number, codcaixa: number): Promise<number> {
    const bxs = await trx.selectFrom('caixa_mov').select(['codrcbbx', 'codapgbx'])
      .where('codcaixa', '=', codcaixa).where('codempresa', '=', emp).where(sql`coalesce(indr,'I')`, '=', 'I').execute();
    const rcb = (bxs as any[]).map((b) => b.codrcbbx).filter((x) => x != null);
    const apg = (bxs as any[]).map((b) => b.codapgbx).filter((x) => x != null);
    let arTot = 0, apTot = 0;
    if (rcb.length) {
      const r = await trx.selectFrom('diario').select(sql<number>`coalesce(sum(valor),0)`.as('t'))
        .where('codorigem', '=', 16).where('codempresa', '=', emp).where('contadebito', '=', CONTA_CAIXA)
        .where('idorigem', 'in', rcb).executeTakeFirst();
      arTot = num((r as any)?.t);
    }
    if (apg.length) {
      const r = await trx.selectFrom('diario').select(sql<number>`coalesce(sum(valor),0)`.as('t'))
        .where('codorigem', '=', 15).where('codempresa', '=', emp).where('contacredito', '=', CONTA_CAIXA)
        .where('idorigem', 'in', apg).executeTakeFirst();
      apTot = num((r as any)?.t);
    }
    return r2(arTot - apTot);
  }

  /** a forma DINHEIRO da empresa: conta contábil da tesouraria (codplanocontas = 183 p/ dinheiro; p/ DINHEIRO
   * também = codcontacorrente→codlanccontabil) + codcontacorrente (conta operacional da MCB) + idpgto. */
  private async formaDinheiro(trx: AnyDB, emp: number): Promise<{ idpgto: number; conta: number; codcontacorrente: number | null }> {
    const f = await trx
      .selectFrom('formas_pgto')
      .select(['idpgto', 'codcontacorrente', 'codplanocontas'])
      .where('idempresa', '=', emp).where(sql`upper(modalidade)`, '=', 'DINHEIRO')
      .executeTakeFirst();
    if (!f || (f as any).codplanocontas == null) throw new BusinessRuleError('CAIXA_TESOURARIA_SEM_CONTA', { emp });
    return { idpgto: Number((f as any).idpgto), conta: Number((f as any).codplanocontas), codcontacorrente: (f as any).codcontacorrente ?? null };
  }

  /** Estorno standalone (endpoint): valida contabilizado + período, e reverte. */
  async estornarFechamento(codcaixa: number): Promise<{ codcaixa: number; estornado: true }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const s = await trx
        .selectFrom('caixa_sessao').select(['codcaixa', 'contabilizado', 'dtfechamento'])
        .where('codcaixa', '=', codcaixa).where('codempresa', '=', emp)
        .forUpdate().executeTakeFirst();
      if (!s) throw new BusinessRuleError('CAIXA_NAO_ENCONTRADO', { codcaixa });
      if ((s as any).contabilizado !== 'S') throw new BusinessRuleError('CAIXA_NAO_CONTABILIZADA', { codcaixa });
      await this.assertPeriodoAberto(trx, emp, (s as any).dtfechamento);
      await this.estornarNoTrx(trx, emp, codcaixa, op);
      return { codcaixa, estornado: true as const };
    });
  }

  /**
   * Estorno do DIÁRIO do fechamento DENTRO de uma transação já aberta (usado pela REABERTURA do caixa).
   * DELETE por (CODORIGEM=17, IDORIGEM=codcaixa) + lotes órfãos + zera caixa_sessao.contabilizado.
   * Idempotente (no-op se não houver lançamento).
   */
  async estornarNoTrx(trx: AnyDB, emp: number, codcaixa: number, op: number | null): Promise<void> {
    // apaga AS DUAS pernas do fechamento: divergência (CODORIGEM 17) E tesouraria (CODORIGEM 19).
    const lotes = await trx
      .selectFrom('diario').select('codlote').distinct()
      .where('codorigem', 'in', [CODORIGEM_CAIXA, CODORIGEM_TESOURARIA]).where('idorigem', '=', codcaixa).where('codempresa', '=', emp)
      .execute();
    await trx.deleteFrom('diario').where('codorigem', 'in', [CODORIGEM_CAIXA, CODORIGEM_TESOURARIA]).where('idorigem', '=', codcaixa).where('codempresa', '=', emp).execute();
    const ids = (lotes as Record<string, unknown>[]).map((l) => Number(l.codlote)).filter((n) => Number.isFinite(n));
    if (ids.length) await trx.deleteFrom('lote_contabil').where('codlotecontabil', 'in', ids).execute();
    // razão de tesouraria (MOV_CONTAS_BANCARIAS) do fechamento — remove junto (fechamento não aconteceu).
    await trx.deleteFrom('mov_contas_bancarias').where('nropdv_fechamento', '=', codcaixa).where('idempresa', '=', emp).where('origem', '=', 'FCP').execute();
    await trx
      .updateTable('caixa_sessao').set({ contabilizado: null, usultalteracao: op, dtultimalteracao: sql`now()` })
      .where('codcaixa', '=', codcaixa).where('codempresa', '=', emp).execute();
  }
}
