import { Injectable } from '@nestjs/common';
import { conferirParcelasNoProcessamento } from './nf-parcelas.service';
import { chaveDeEntrada, desregistrarProcessoNf, registrarProcessoNf } from '../shared/nf-status-processo';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from './config.service';
import { NfFaturamentoService } from './nf-faturamento.service';
import { NfContabilizacaoService } from './nf-contabilizacao.service';
import { assertPeriodoNaoFechado } from '../shared/periodo-contabil';
import { validarItensNoProcessamento } from './nf-cfop-situacao';
import { totaisProdutosNf } from '@apollo/shared';
import { gerarCaixaDaNf, reverterCaixaDaNf } from './nf-caixa';
import { configNaTrx } from '../compras/pedido-heranca';
import { fotoDaNf, logDaDiferencaNf } from './nf-log';
import { atualizarProdutosDaEntrada } from './nf-produtos-processar';
import { contextoIndexadorNf, indexadorDoItem } from './nf-indexador-item';
import { recalcularMetricasEntrada } from './nf-custo-item';
import { retratoDoProduto } from './nf.aggregate';
import { TributacaoRepository } from '../precificacao/tributacao.repository';
import { validarTravasEntradaNoProcessamento } from './nf-travas-processamento';
import { LiberacaoService } from '../auth/liberacao.service';

type AnyDB = any;

/**
 * GERAESTOQUE/MOVIMENTA_ESTOQUE = PROC_QTDE do CFOP do item ('S' só com 'S' — o NULL não move, como os 15 CFOPs sem valor da produção),
 * ORIGEM_ESTOQUE 'E' e USOCONSUMO 'S' quando o produto é de uso/consumo (o produto 'N' não muda o que o item tinha — o provider do legado
 * não grava o valor igual ao `COALESCE(N.USOCONSUMO,'N')`, udmNF.dfm:2643).
 */
async function flagsDoItemNoProcessar(trx: AnyDB, codnf: number): Promise<void> {
  await sql`
    UPDATE nf_prod p SET
      geraestoque       = CASE WHEN c.proc_qtde = 'S' THEN 'S' ELSE 'N' END,
      movimenta_estoque = CASE WHEN c.proc_qtde = 'S' THEN 'S' ELSE 'N' END,
      origem_estoque    = 'E',
      usoconsumo        = CASE WHEN pr.uso_consumo = 'S' THEN 'S' ELSE p.usoconsumo END
      FROM nf_prod x
      LEFT JOIN cfop c      ON c.codcfop::text = x.cfop::text
      LEFT JOIN produtos pr ON pr.idproduto = x.codproduto
     WHERE x.codnfprod = p.codnfprod AND p.codnf = ${codnf}`.execute(trx);
}
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
    private readonly faturamento: NfFaturamentoService,
    private readonly liberacao: LiberacaoService,
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

  /**
   * SINCRONIZAR CFOP, ALÍQUOTA e CST dos itens (menu uNF.pas:16401 → uSincronizaCFOPNotaFiscal). A tela mostra os valores distintos
   * de cada um nos itens, com o "novo" igual ao "atual", e o operador troca os que quiser. No OK (btnOKClick, :318-345):
   *  - todo CFOP novo tem de existir no cadastro (`CFOPValido`, :325 — "CFOP inválido ou não cadastrado");
   *  - aplica CFOP, depois ALÍQUOTA, depois CST (AtualizarCFOP/ALIQUOTA/CST, :96-300): cada item cujo valor é o "atual" de uma linha
   *    recebe o "novo" UMA vez (o `cdsItensAlterados*` impede que a troca 5102↔5405 volte ao que era) e é marcado SINCRONIZADO_x = 'S'
   *    — como as grades trazem todos os valores da nota, todo item sai marcado nos três, mudado ou não (12.856 itens de entrada em
   *    2026, iguais nos três flags);
   *  - loja do Simples com a alíquota nova NTB: o CSOSN do item vira 400 (:190).
   * O legado aplica no dataset e manda GRAVAR; aqui grava direto, com as travas de edição da NF. Não recalcula imposto (o operador
   * usa "Recalcular" depois, como no legado). Retorna quantos itens tiveram o CFOP trocado e quantos foram sincronizados.
   */
  async sincronizarCfop(
    codnf: number,
    mapa: Array<{ de?: string; para?: string }>,
    aliquotas: Array<{ de?: string; para?: string }> = [],
    csts: Array<{ de?: string | number; para?: string | number }> = [],
  ): Promise<{ codnf: number; itens: number; sincronizados: number }> {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    const pares = <T>(lista: Array<{ de?: T; para?: T }>, norm: (v: unknown) => string) =>
      (Array.isArray(lista) ? lista : []).map((m) => ({ de: norm(m?.de), para: norm(m?.para) })).filter((m) => m.de !== '' && m.para !== '');
    const texto = (v: unknown) => String(v ?? '').trim();
    const numCst = (v: unknown) => (texto(v) === '' || !Number.isFinite(Number(texto(v))) ? '' : String(Number(texto(v))));
    const pCfop = pares(mapa, texto);
    const pAliq = pares(aliquotas, (v) => texto(v).toUpperCase());
    const pCst = pares(csts, numCst);
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = await trx
        .selectFrom('nf')
        .select(['codnf', 'proc', 'contabilizado', 'statusnfe', 'cancelada', 'dtcontabil'])
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
      // trava de edição (espelha nf.aggregate.validar): NF com efeito é read-only.
      if (nf.proc === 'S') throw new BusinessRuleError('NF_PROCESSADA', { codnf });
      // (sem trava de faturada: o menu do legado só olha o PROC — uNF.pas:16401-16410; auditoria g1 #12)
      if (nf.contabilizado === 'S') throw new BusinessRuleError('NF_CONTABILIZADA', { codnf });
      if (nf.cancelada === 'S' || nf.statusnfe === 'C') throw new BusinessRuleError('NF_CANCELADA', { codnf });
      if (nf.statusnfe === 'P' || nf.statusnfe === 'D') throw new BusinessRuleError('NF_ENVIADA', { codnf });
      if (nf.dtcontabil != null) await assertPeriodoNaoFechado(trx, emp, nf.dtcontabil, 'bloq_nf'); // período fechado
      // valida os CFOP-alvo contra o catálogo (CFOPValido, uSincronizaCFOPNotaFiscal.pas:325) e as alíquotas (o combo da grade é a tabela)
      const alvos = [...new Set(pCfop.map((p) => p.para))];
      const existentes = alvos.length ? ((await trx.selectFrom('cfop').select('codcfop').where('codcfop', 'in', alvos).execute()) as Array<{ codcfop: string }>).map((r) => String(r.codcfop)) : [];
      const invalido = alvos.find((a) => !existentes.includes(a));
      if (invalido) throw new BusinessRuleError('NF_CFOP_INVALIDO', { cfop: invalido });
      const aliqAlvos = [...new Set(pAliq.map((p) => p.para))];
      const aliqExist = aliqAlvos.length ? ((await trx.selectFrom('aliquota').select('codigo').where('codigo', 'in', aliqAlvos).execute()) as Array<{ codigo: string }>).map((r) => String(r.codigo).trim()) : [];
      const aliqInv = aliqAlvos.find((a) => !aliqExist.includes(a));
      if (aliqInv) throw new BusinessRuleError('NF_ALIQUOTA_INVALIDA', { aliquota: aliqInv });
      const sn = String(((await trx.selectFrom('empresas').select('classfiscal').where('idempresa', '=', emp).executeTakeFirst()) as { classfiscal?: string } | undefined)?.classfiscal ?? '').trim() === 'SN';
      const fotoLog = await fotoDaNf(trx, codnf);
      const itens = (await trx.selectFrom('nf_prod').select(['codnfprod', 'cfop', 'aliquota', 'cst', 'csosn']).where('codnf', '=', codnf).orderBy('codnfprod').execute()) as
        Array<{ codnfprod: number; cfop: unknown; aliquota: unknown; cst: unknown; csosn: unknown }>;
      // cada item recebe o "novo" da primeira linha cujo "atual" é o seu valor ORIGINAL — a troca A↔B não volta (cdsItensAlterados*)
      const trocar = (atual: string, lista: Array<{ de: string; para: string }>) => lista.find((p) => p.de === atual)?.para;
      let trocados = 0;
      for (const it of itens) {
        const cfop = trocar(texto(it.cfop), pCfop);
        const aliqAtual = texto(it.aliquota).toUpperCase();
        const aliq = trocar(aliqAtual, pAliq) ?? aliqAtual;
        const cst = trocar(String(Number(it.cst ?? 0)), pCst);
        const set: Record<string, unknown> = { sincronizado_cfop: 'S', sincronizado_aliq: 'S', sincronizado_cst: 'S' };
        if (cfop != null && cfop !== texto(it.cfop)) { set.cfop = cfop; trocados++; }
        if (aliq !== aliqAtual) set.aliquota = aliq;
        if (sn && aliq === 'NTB') set.csosn = '400';
        if (cst != null) set.cst = Number(cst);
        await trx.updateTable('nf_prod').set(set).where('codnfprod', '=', it.codnfprod).execute();
      }
      await trx.updateTable('nf').set({ usultalteracao: op, dtultimalteracao: sql`now()` }).where('codnf', '=', codnf).where('idempresa', '=', emp).execute();
      await logDaDiferencaNf(trx, codnf, fotoLog);
      return { codnf, itens: trocados, sincronizados: itens.length };
    });
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
          'totalnf', 'totalicm_st', 'totalfrete', 'totalseguro', 'totalacessorias', 'totalipi_devolucao',
        ])
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      const fotoLog = await fotoDaNf(trx, codnf);
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });

      if (modo === 'processar') {
        if (nf.cancelada === 'S') throw new BusinessRuleError('NF_CANCELADA', { codnf });
        if (nf.proc === 'S') throw new BusinessRuleError('NF_JA_PROCESSADA', { codnf });
        // reconciliação (ValidaTotalICMSStNota, uProcessaNotaFiscal.pas:564): recomputa os totais
        // dos itens e confere contra o header ANTES de mover estoque (evita processar total adulterado).
        await this.reconciliarTotais(trx, codnf, emp, nf);
        // CFOP de cada item × a situação dele (uNF.pas:14921; UCadSituacaoNF.md C2)
        await validarItensNoProcessamento(trx, codnf, emp);
        // o indexador, o TOTAL NF digitado e os itens não repassados (uNF.pas:14937-15051)
        await validarTravasEntradaNoProcessamento(trx, codnf);
        // Σ parcelas (FATURAMENTO) = base da nota, quando o CFOP gera financeiro e ainda não há título (uEstoqueNF.pas:833)
        await conferirParcelasNoProcessamento(trx, codnf, emp, op);
      } else {
        if (nf.proc !== 'S') throw new BusinessRuleError('NF_NAO_PROCESSADA', { codnf });
        // reverter bloqueado se já enviada à SEFAZ (uNF.pas:8945) — 'T' (terceiros importada) e 'D'
        // (DENEGADA) liberam: a denegada é fiscalmente inválida e precisa voltar a editável p/ reemissão
        // (uNF.pas:8939 bloqueava 'D' por não haver caminho de estorno; migrado abre-o).
        if (nf.statusnfe && nf.statusnfe !== 'T' && nf.statusnfe !== 'D') throw new BusinessRuleError('NF_ENVIADA', { codnf });
        // reverter a NF com financeiro (uNF.pas:9171 → `CancelaFaturamento(codnf, tipo, 'R')`, :6668): o legado NÃO barra. Com
        // `ESTORNA_FINANCEIRO_NF`='S' exclui o financeiro se nada foi baixado/agrupado/contabilizado (senão avisa e mantém); com
        // 'N' (a produção) MANTÉM os títulos e marca a pendência (`AdicionaPendenciaFinanceiro`: STATUS_PENDENCIA 'R' pela IDNF).
        // O Apollo recusava — 295 reversões em 2025 e 151 em 2026 tinham financeiro (auditoria g1 #15).
        await this.faturamento.cancelaFaturamentoNaTrx(trx, codnf, String(nf.tipo), 'R', emp, op);
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
      // as FLAGS DO ITEM que o processar grava antes de mover (UpdateProdutos, udmNF.pas:7287-7317): move estoque o item cujo CFOP
      // tem PROC_QTDE 'S' (o operador não edita as colunas — PERMITE_EDICAO_PROC_ESTOQUE 'N' no Retaguarda); ORIGEM_ESTOQUE 'E' (loja);
      // USOCONSUMO do produto. O Apollo gravava GERAESTOQUE 'S' fixo na importação: 2.856 itens de uso/consumo/serviço de 2026 (CFOP
      // 1556/2556/1949/1933/1407…) entrariam no estoque
      if (modo === 'processar') await flagsDoItemNoProcessar(trx, codnf);
      await this.aplicarMovimentoItens(trx, codnf, String(nf.tipo), sinal, modo === 'reverter' ? 'NF-REV' : 'NF', op, emp);
      // a entrada nos PRODUTOS (UpdateProdutos): o histórico do processamento, a linha de preço e o custo — reverter não desfaz
      if (modo === 'processar') await atualizarProdutosDaEntrada(trx, codnf, emp, op);

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
      // o CAIXA gerencial da NF (GerarLancamentosDeCaixa / ReverteLancamentosDeCaixa; UCadSituacaoNF.md C4) — o
      // legado gera depois do commit do processamento; aqui na mesma transação, para não sobrar caixa de nota não processada
      if (modo === 'processar') await gerarCaixaDaNf(trx, codnf, emp, op);
      // retenções, RESIDUAL ST e o financeiro automático nascem no processar, como no legado (udmNF.pas:7771-7775)
      if (modo === 'processar') await this.faturamento.aposProcessar(trx, codnf, emp, op);
      else await reverterCaixaDaNf(trx, codnf, emp);
      // a LOG do processamento/reversão: o que mudou no cabeçalho e nos itens ("Alterou NF — PROC N→S", …)
      await logDaDiferencaNf(trx, codnf, fotoLog);
      // a ESTEIRA da nota de entrada: processar marca stProcessarFaturar (udmNF.pas:7752), reverter a desmarca (uNF.pas:9164)
      const chave = await chaveDeEntrada(trx, codnf);
      if (chave) {
        if (modo === 'processar') await registrarProcessoNf(trx, 'stProcessarFaturar', chave, emp, op);
        else await desregistrarProcessoNf(trx, 'stProcessarFaturar', chave);
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
      .select(['quantidade', 'vrcusto', 'vrdescprod', 'arredonda', 'vripi', 'vricmst'])
      .where('codnf', '=', codnf)
      .execute();
    // a mesma fórmula do `derivar` do agregado: o valor da linha é o VRCUSTO e o desconto é o VRDESCPROD (nf-valor.ts)
    const { totalprod, totaldesc } = totaisProdutosNf(itens as Record<string, unknown>[]);
    let totalipi = 0;
    let totalicmSt = 0;
    for (const it of itens as Record<string, unknown>[]) {
      totalipi += num(it.vripi);
      totalicmSt += num(it.vricmst);
    }
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const totalnfRec = r2(
      totalprod - totaldesc + num(nf.totalfrete) + num(nf.totalseguro) + num(nf.totalacessorias) + totalipi + totalicmSt
      + num(nf.totalipi_devolucao), // o IPI devolvido entra no total da nota (udmNF.pas:5557), como no `derivar`
    );
    // ⚠️ o TOTALNF não é conferido: o legado só confere o ICMS-ST (`ValidaTotalICMSStNota`, uProcessaNotaFiscal.pas:564-585) —
    // 643 NFs de entrada (2025) e 459 (2026) da produção não fecham com a fórmula e cairiam ao reprocessar (auditoria g1 #17).
    void totalnfRec;
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

  /**
   * A ANÁLISE AUTOMÁTICA dos itens de entrada — o [F7] "repasse automático" da tela de análise (`UAnalisaItemNF.pas:541-636`), ou o [F8]
   * de um item só (`:638-670`): cada item passa pelo diálogo com `AlteraFigura` + `AnalisaAutomatico` e é confirmado sozinho — relê o
   * produto (o retrato da linha de preço), consulta o INDEXADOR de novo (CST/ICME/BCR/MVA/MVA ajustado/INDEXADORTRIB/REPASSADO), refaz o
   * ST externo, a base/ICMS e o custo (a análise do OK). Travas do legado: F7 com `BLOQUEIA_ANALISE_AUTOMATICA_ITENS_NF` = 'S' ("Análise
   * automática de itens não está liberada!"); nota processada ("Nota processada não permite análise de itens!"); a tela só abre com a
   * SITUAÇÃO da nota na loja 'O' ou com `OBRIGA_SITUACAONF_ANALISA_ITEM_NF` (uNF.pas:2815). O legado anda item a item e guarda o ponto
   * de parada em NF.ULT_CODNFPROD_REPASSE (zerado no fim); aqui é uma transação só — termina com 0. A saída ainda não está convertida
   * (o indexador da saída vive no recálculo fiscal).
   */
  async repasseAutomatico(codnf: number, codnfprod?: number): Promise<{ codnf: number; itens: number; comIndexador: number; repassados: number }> {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const ctxCfg = { empresaId: emp, operadorId: op, modulo: 'Retaguarda' };
      if (codnfprod == null && String((await configNaTrx(trx, 'BLOQUEIA_ANALISE_AUTOMATICA_ITENS_NF', ctxCfg)) ?? 'N').toUpperCase() === 'S') {
        throw new BusinessRuleError('NF_ANALISE_AUTOMATICA_BLOQUEADA');
      }
      const nf = (await trx.selectFrom('nf')
        .select(['codnf', 'tipo', 'proc', 'contabilizado', 'statusnfe', 'cancelada', 'dtcontabil', 'idsituacao_nf', 'nf_importacao_nfe'])
        .where('codnf', '=', codnf).where('idempresa', '=', emp).forUpdate().executeTakeFirst()) as Record<string, unknown> | undefined;
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
      nf.figurafiscal = ((await trx.selectFrom('empresas').select('figurafiscal').where('idempresa', '=', emp).executeTakeFirst()) as { figurafiscal?: unknown } | undefined)?.figurafiscal;
      if (nf.proc === 'S') throw new BusinessRuleError('NF_PROCESSADA', { codnf });
      if (nf.contabilizado === 'S') throw new BusinessRuleError('NF_CONTABILIZADA', { codnf });
      if (nf.cancelada === 'S' || nf.statusnfe === 'C') throw new BusinessRuleError('NF_CANCELADA', { codnf });
      if (nf.statusnfe === 'P' || nf.statusnfe === 'D') throw new BusinessRuleError('NF_ENVIADA', { codnf });
      if (nf.dtcontabil != null) await assertPeriodoNaoFechado(trx, emp, nf.dtcontabil, 'bloq_nf');
      if (String(nf.tipo) !== 'E') throw new BusinessRuleError('NF_ANALISE_SO_ENTRADA', { codnf });
      const obrigaSituacao = String(nf.figurafiscal ?? '').trim().toUpperCase() === 'O'
        || String((await configNaTrx(trx, 'OBRIGA_SITUACAONF_ANALISA_ITEM_NF', ctxCfg)) ?? 'N').toUpperCase() === 'S';
      if (obrigaSituacao && !(Number(nf.idsituacao_nf) > 0)) throw new BusinessRuleError('NF_ANALISE_SEM_SITUACAO', { codnf });
      const ctx = await contextoIndexadorNf(trx, codnf);
      let q = trx.selectFrom('nf_prod').selectAll().where('codnf', '=', codnf);
      if (codnfprod != null) q = q.where('codnfprod', '=', codnfprod);
      const itens = (await q.orderBy('codnfprod').execute()) as Array<Record<string, unknown>>;
      if (codnfprod != null && !itens.length) throw new BusinessRuleError('NF_ITEM_NAO_ENCONTRADO', { codnf, codnfprod });
      const trib = new TributacaoRepository(null as never);
      let comIndexador = 0;
      for (const it of itens) {
        const idx = ctx ? await indexadorDoItem(trx, ctx, it, trib) : {};
        if (Number(idx.indexadortrib ?? 0) > 0) comIndexador++;
        const retrato = await retratoDoProduto(trx, emp, { ...it, dialogo: true }, it, nf as never);
        // CUSTO_REAL_UNIT 0 = o item volta para a análise do OK (ST externo, base/ICMS, custo e escada) logo abaixo
        await trx.updateTable('nf_prod').set({ ...idx, ...retrato, custo_real_unit: 0 }).where('codnfprod', '=', Number(it.codnfprod)).execute();
      }
      await recalcularMetricasEntrada(trx, codnf, 'pendentes');
      await trx.updateTable('nf').set({ ult_codnfprod_repasse: 0 }).where('codnf', '=', codnf).execute();
      const rep = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM nf_prod WHERE codnf = ${codnf} AND repassado = 'S'`.execute(trx)).rows[0];
      const chave = await chaveDeEntrada(trx, codnf);
      if (chave && Number(rep?.n) > 0) await registrarProcessoNf(trx, 'stRepasseItens', chave, emp, op);
      return { codnf, itens: itens.length, comIndexador, repassados: Number(rep?.n ?? 0) };
    });
  }


  /**
   * LIBERAR A NF DO USO DO INDEXADOR (menu `LiberarNFdousodeindexadorClick`, uNF.pas:17780-17829) — alterna: 'S' com o operador que
   * liberou em CODOPERADOR_LIB_NF_INDEX, ou 'N' e limpa. Barra a nota processada; exige `LIBERA_NF_USO_INDEXADOR` = 'S' para o usuário
   * (na produção só o usuário 1) e o login de liberação do PRÓPRIO usuário da sessão (a lista do `ChamaLiberacaoLogin` é só ele) —
   * LOG_LIBERACOES "LIBERAR NOTA FISCAL DO USO DO INDEXADOR". Liberada, a nota se comporta como a loja 'D' (sem consulta, REPASSADO 'S',
   * ST externo pelo ramo 'D', sem a ValidaIndexadores); o legado avisa para repassar os itens — o [F7].
   */
  async liberarIndexador(codnf: number, cred: { login?: string; senha?: string; computador?: string | null }): Promise<{ codnf: number; libera_nf_indexador: 'S' | 'N' }> {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null || op == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    const db = this.dbp.forTenant() as AnyDB;
    const nf = (await db.selectFrom('nf').select(['codnf', 'proc', 'libera_nf_indexador']).where('codnf', '=', codnf).where('idempresa', '=', emp).executeTakeFirst()) as
      Record<string, unknown> | undefined;
    if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
    if (nf.proc === 'S') throw new BusinessRuleError('NF_PROCESSADA', { codnf });
    const cfg = await configNaTrx(db, 'LIBERA_NF_USO_INDEXADOR', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' });
    if (String(cfg ?? 'N').toUpperCase() !== 'S') throw new BusinessRuleError('NF_LIBERAR_INDEXADOR_SEM_PERMISSAO');
    const lib = await this.liberacao.validar({ codigo: 'LIBERA_NF_USO_INDEXADOR', login: String(cred?.login ?? ''), senha: String(cred?.senha ?? ''),
      liberacao: 'LIBERAR NOTA FISCAL DO USO DO INDEXADOR', computador: cred?.computador ?? null, permitidos: [op] });
    if (!lib.liberado) throw new BusinessRuleError('NF_LIBERAR_INDEXADOR_NEGADO');
    const liberar = String(nf.libera_nf_indexador ?? '') !== 'S';
    await db.updateTable('nf').set(liberar ? { libera_nf_indexador: 'S', codoperador_lib_nf_index: op } : { libera_nf_indexador: 'N', codoperador_lib_nf_index: null })
      .where('codnf', '=', codnf).execute();
    return { codnf, libera_nf_indexador: liberar ? 'S' : 'N' };
  }

}
