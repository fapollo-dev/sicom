import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from './config.service';
import { NfContabilizacaoService } from './nf-contabilizacao.service';

type AnyDB = any;
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/**
 * NF — Fase 3: PROCESSAMENTO (movimento de estoque). A fase mais perigosa.
 *
 * No legado o flip NF.PROC 'N'->'S' dispara a trigger Oracle ESTOQUE_NOTAS, que move o saldo
 * (entrada soma, saída baixa). Aqui o movimento é feito EM CÓDIGO, numa ÚNICA transação atômica
 * (estoque + kardex + flip de PROC) — ganho sobre a trigger, cujo financeiro nem era atômico.
 *
 * Regra verbatim do legado (caso comum loja — dossiê uNF.md §6):
 *  - gatilho: PROC 'N'->'S' (processar) / 'S'->'N' (reverter), COALESCE(ALTERAESTOQUEREVERSAO,'S')='S'
 *  - QTDEX = QUANTIDADE * FATOREMBAL; entrada (+QTDEX) / saída (−QTDEX); estorno = inverso
 *  - UPDATE ESTOQUE SET QTDE = QTDE + QTDEX WHERE IDPRODUTO=x AND IDEMPRESA=emp (loja)
 *  - guarda: na trigger é só GERAESTOQUE='S' (= GERAQTDE OR DEPOSITO OR PRODUCAO; MOVIMENTA_ESTOQUE
 *    é carregado mas não gateia o ramo loja). Aqui exigimos GERAQTDE & GERAESTOQUE & MOVIMENTA_ESTOQUE
 *    = 'S' — MAIS restritivo (conservador): só PULA o movimento, nunca o inventa.
 *
 * Estoque negativo: gateado por config PERMITE_PROC_NF_ESTOQUE_NEG (udmNF.pas:11643) — 'S' (default
 * legado, confirmado no golden PINHEIRAO) PERMITE saldo negativo; 'N' bloqueia (NF_ESTOQUE_NEGATIVO,
 * com rollback atômico). Incremento SEMPRE relativo (`qtde = qtde + delta`, nunca absoluto) +
 * `.forUpdate()` → à prova de corrida. CAS no flip (`WHERE proc=<esperado>`) → idempotente.
 *
 * Adiado (F3b+, dossiê §10): ORIGEM 'D'/'P'/'X' (depósito/produção/almox), local/congelado,
 * composição/decomposição (kit), **override de negativo por SENHA** (UsuarioAutorizouComSenha,
 * uNF:11659) + **escopo Grupo** do whitelist, conferência, e os efeitos financeiro (F4)/contábil
 * (F5). O corte 1 move SÓ a loja (ESTOQUE.QTDE), sem gatear por ORIGEM_ESTOQUE.
 */
@Injectable()
export class NfProcessamentoService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
    private readonly contab: NfContabilizacaoService,
  ) {}

  async processar(codnf: number): Promise<void> {
    await this.mover(codnf, 'processar');
    // AUTO-DISPARO contábil (F5b-fase3): entrada AUTOMATICA integra no processar (udmNF.pas:7778);
    // saída M55 é barrada aqui (exige statusnfe='P') e integra no transmitir. Best-effort (não aborta).
    await this.contab.tentarContabilizar(codnf);
  }
  reverter(codnf: number): Promise<void> {
    return this.mover(codnf, 'reverter');
  }

  private async mover(codnf: number, modo: 'processar' | 'reverter'): Promise<void> {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN'); // fail-closed (saldo é por empresa)

    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // lê e TRAVA o header (escopo empresa). Bloqueios de estado por modo.
      const nf = await trx
        .selectFrom('nf')
        .select([
          'codnf', 'tipo', 'proc', 'cancelada', 'statusnfe', 'contabilizado',
          'totalnf', 'totalicm_st', 'totalfrete', 'totalseguro', 'totalacessorias',
        ])
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });

      if (modo === 'processar') {
        if (nf.cancelada === 'S') throw new BusinessRuleError('NF_CANCELADA', { codnf });
        if (nf.proc === 'S') throw new BusinessRuleError('NF_JA_PROCESSADA', { codnf });
        // reconciliação (ValidaTotalICMSStNota, uProcessaNotaFiscal.pas:564): recomputa os totais
        // dos itens e confere contra o header ANTES de mover estoque (evita processar total adulterado).
        await this.reconciliarTotais(trx, codnf, emp, nf);
      } else {
        if (nf.proc !== 'S') throw new BusinessRuleError('NF_NAO_PROCESSADA', { codnf });
        // reverter bloqueado se já enviada à SEFAZ (uNF.pas:8945) — 'T' (terceiros importada) e 'D'
        // (DENEGADA) liberam: a denegada é fiscalmente inválida e precisa voltar a editável p/ reemissão
        // (uNF.pas:8939 bloqueava 'D' por não haver caminho de estorno; migrado abre-o).
        if (nf.statusnfe && nf.statusnfe !== 'T' && nf.statusnfe !== 'D') throw new BusinessRuleError('NF_ENVIADA', { codnf });
        // reverter + contabilizada (uNF.pas:8949): se a empresa é AUTOMATICA, ESTORNA o contábil e segue;
        // senão bloqueia (o operador tem de estornar o contábil manualmente antes).
        if (nf.contabilizado === 'S') {
          const empc = await trx.selectFrom('empresas').select('integracao').where('idempresa', '=', emp).executeTakeFirst();
          if (empc?.integracao === 'AUTOMATICA') await this.contab.estornarNoTrx(trx, codnf, emp, op);
          else throw new BusinessRuleError('NF_CONTABILIZADA', { codnf });
        }
      }

      // sentido: entrada soma / saída baixa; estorno = inverso.
      const base = nf.tipo === 'E' ? 1 : -1;
      const sinal = modo === 'processar' ? base : -base;
      await this.aplicarMovimentoItens(trx, codnf, String(nf.tipo), sinal, modo === 'reverter' ? 'NF-REV' : 'NF', op, emp);

      // flip de estado com compare-and-set (anti-corrida/replay).
      const novoProc = modo === 'processar' ? 'S' : 'N';
      const procEsperado = modo === 'processar' ? 'N' : 'S';
      const set: Record<string, unknown> = {
        proc: novoProc,
        dtprocessamento: modo === 'processar' ? sql`now()` : null,
        usultalteracao: op,
        dtultimalteracao: sql`now()`,
      };
      // reverter uma DENEGADA limpa o status fiscal → a nota volta a editável p/ reemissão (a chave da
      // denegada não serve; a reemissão gera nova). Só neste caso — 'T' e demais preservam o status.
      if (modo === 'reverter' && nf.statusnfe === 'D') {
        set.statusnfe = null;
        set.chavenfe = null;
        set.protocolo_nfe = null;
      }
      const r = await trx
        .updateTable('nf')
        .set(set)
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .where('proc', '=', procEsperado)
        .executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) === 0) {
        throw new BusinessRuleError(modo === 'processar' ? 'NF_JA_PROCESSADA' : 'NF_NAO_PROCESSADA', { codnf });
      }
    });
  }

  /**
   * Reconciliação server-side antes de processar (ValidaTotalICMSStNota, uProcessaNotaFiscal.pas:564):
   * recomputa os totais a partir dos itens gravados (MESMA fórmula do `nf.aggregate.derivar`) e confere
   * contra o header, com tolerância de ±0,01 (o legado usa FormatFloat '0.00'). Como `recalcular` é PURO
   * (não grava), esta é a barreira que impede processar uma NF com total/ICMS-ST adulterado ou defasado.
   * TOTAL sempre; ICMS-ST só quando EMPRESAS.FIGURAFISCAL='D' (paridade fiel).
   */
  private async reconciliarTotais(trx: AnyDB, codnf: number, emp: number, nf: Record<string, unknown>): Promise<void> {
    const itens = await trx
      .selectFrom('nf_prod')
      .select(['quantidade', 'vrvenda', 'desconto', 'vripi', 'vricmst'])
      .where('codnf', '=', codnf)
      .execute();
    let totalprod = 0;
    let totaldesc = 0;
    let totalipi = 0;
    let totalicmSt = 0;
    for (const it of itens as Record<string, unknown>[]) {
      totalprod += num(it.quantidade) * num(it.vrvenda);
      totaldesc += num(it.desconto);
      totalipi += num(it.vripi);
      totalicmSt += num(it.vricmst);
    }
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const totalnfRec = r2(
      totalprod - totaldesc + num(nf.totalfrete) + num(nf.totalseguro) + num(nf.totalacessorias) + totalipi + totalicmSt,
    );
    if (Math.abs(num(nf.totalnf) - totalnfRec) > 0.01) {
      throw new BusinessRuleError('NF_TOTAL_DIVERGENTE', { informado: num(nf.totalnf), calculado: totalnfRec });
    }
    // ICMS-ST só quando FIGURAFISCAL='D' (uProcessaNotaFiscal.pas:564-585).
    const ef = await trx.selectFrom('empresas').select('figurafiscal').where('idempresa', '=', emp).executeTakeFirst();
    if (ef?.figurafiscal === 'D' && Math.abs(num(nf.totalicm_st) - r2(totalicmSt)) > 0.01) {
      throw new BusinessRuleError('NF_ST_DIVERGENTE', { informado: num(nf.totalicm_st), calculado: r2(totalicmSt) });
    }
  }

  /**
   * Estorno de estoque do CANCELAMENTO da NFe (F6), DENTRO da transação do cancelamento.
   * Golden: uma NF cancelada tem o kardex zerado por um estorno compensatório (o movimento
   * original é preservado, um novo registro de estorno é adicionado → saldo volta ao original).
   * Como o `reverter` é bloqueado em nota enviada à SEFAZ, o estorno só pode vir do cancelamento.
   * NÃO faz flip de PROC (o movimento original é preservado; só compensa o saldo). `tipo` E/S
   * define o sinal original; o estorno aplica o inverso.
   */
  async estornarEstoquePorCancelamento(trx: AnyDB, codnf: number, tipo: string, op: number | null, emp: number): Promise<void> {
    const base = tipo === 'E' ? 1 : -1;
    await this.aplicarMovimentoItens(trx, codnf, tipo, -base, 'NF-CANC', op, emp);
  }

  /**
   * Move o estoque dos itens de uma NF numa transação já aberta (`trx`). Guarda fiel à trigger
   * ESTOQUE_NOTAS: move quando `GERAESTOQUE='S' AND MOVIMENTA_ESTOQUE='S'` (2 flags de NF_PROD —
   * a trigger NÃO gateia por PRODUTOS.GERAQTDE). QTDEX = QUANTIDADE×FATOREMBAL; upsert RELATIVO
   * (`qtde = qtde + delta`); bloqueia negativo (conservador — o banco legado não impedia); grava
   * kardex (historico_prod) com saldo anterior/novo e origem.
   */
  private async aplicarMovimentoItens(
    trx: AnyDB,
    codnf: number,
    tipo: string,
    sinal: number,
    origem: 'NF' | 'NF-REV' | 'NF-CANC',
    op: number | null,
    emp: number,
  ): Promise<void> {
    // Gate PERMITE_PROC_NF_ESTOQUE_NEG (udmNF.pas:11643): 'S' (default legado, golden PINHEIRAO) PERMITE
    // saldo negativo; 'N' bloqueia. Resolvido uma vez por movimento (Empresa/Usuario/Modulo/default).
    // Adiado: override por senha (UsuarioAutorizouComSenha, uNF:11659) e escopo Grupo.
    const permiteNegativo = await this.config.ligado('PERMITE_PROC_NF_ESTOQUE_NEG', {
      empresaId: emp,
      operadorId: op ?? undefined,
    });

    const itens = await trx
      .selectFrom('nf_prod')
      .select(['codproduto', 'quantidade', 'fatorembal', 'geraestoque', 'movimenta_estoque'])
      .where('codnf', '=', codnf)
      .execute();

    for (const it of itens as Record<string, unknown>[]) {
      // guarda fiel à trigger (2 flags de NF_PROD; sem PRODUTOS.GERAQTDE).
      if (it.geraestoque !== 'S' || it.movimenta_estoque !== 'S') continue;
      const qtdex = num(it.quantidade) * (num(it.fatorembal) || 1); // qtde efetiva
      if (qtdex === 0) continue;
      const delta = sinal * qtdex;
      const cod = Number(it.codproduto);

      // saldo atual TRAVADO (linha pode não existir → 0).
      const ant = await trx
        .selectFrom('estoque')
        .select('qtde')
        .where('idproduto', '=', cod)
        .where('idempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      const saldoAnt = num(ant?.qtde);
      const saldoNovo = Math.round((saldoAnt + delta) * 1000) / 1000;

      // bloqueio de negativo gateado por config (udmNF.pas:11643): só bloqueia se PERMITE_PROC_NF_ESTOQUE_NEG='N'.
      if (!permiteNegativo && saldoNovo < 0) {
        throw new BusinessRuleError('NF_ESTOQUE_NEGATIVO', { idproduto: cod, saldo: saldoAnt, qtde: qtdex });
      }

      // upsert RELATIVO (resolve linha ausente + concorrência) — nunca grava saldo absoluto.
      await trx
        .insertInto('estoque')
        .values({ idproduto: cod, idempresa: emp, qtde: delta, minimo: 0, maximo: 0 })
        .onConflict((oc: AnyDB) =>
          oc.columns(['idproduto', 'idempresa']).doUpdateSet({ qtde: sql`estoque.qtde + ${delta}` }),
        )
        .execute();

      // kardex (mesma transação).
      const historico =
        origem === 'NF-REV'
          ? `ESTORNO DE ESTOQUE; REF. A REVERSAO DA NOTA COD: ${codnf}`
          : origem === 'NF-CANC'
            ? `ESTORNO DE ESTOQUE; REF. AO CANCELAMENTO DA NOTA COD: ${codnf}`
            : `${tipo === 'E' ? 'ENTRADA' : 'SAIDA'} DE ESTOQUE; REF. NOTA COD: ${codnf}`;
      await trx
        .insertInto('historico_prod')
        .values({
          idproduto: cod,
          idempresa: emp,
          tipo,
          qtde: Math.abs(qtdex),
          saldo_anterior: saldoAnt,
          saldo_novo: saldoNovo,
          origem,
          codnf,
          historico,
          codoperador: op,
        })
        .execute();
    }
  }
}
