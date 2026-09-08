import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { lancarNoDiario, type RegistroDataSet } from './integracao-contabil.motor';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
/** `TruncarArredondar(x, 'A', 2)` do legado: arredonda para 2 casas. */
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** CODORIGEM no razão (`TTipoOrigemContabil`, `UIntegracaoContabil.pas:17-27`). */
const ORIGEM = { BAIXA: 51, TAXA: 61, OUTRAS_DESPESAS: 62 } as const;

interface CartaoDoLote {
  codvendcartao: number;
  idempresa: number;
  dtbaixa: string;
  /** líquido: `VALOR − VALOR_TAXA_PAGA − VALOR_OUTRAS_DESPESAS_PAGA`. */
  valor: number;
  valor_taxa_paga: number;
  valor_outras_despesas_paga: number;
  codplc_taxa_cartao: number;
  codplc_acredesc: number;
  /** `CONTAS_BANCARIAS.CODLANCCONTABIL` da conta corrente da forma de pagamento. */
  codplanocontas: number | null;
  codconta: number | null;
}

export interface ResultadoIntegracao {
  lotes: number;
  cartoes: number;
  lancamentos: number;
  total: number;
}

/**
 * INTEGRAÇÃO CONTÁBIL (`FRMTRON`) — corte-1: **BAIXA DE CARTÕES**.
 * `UIntegracaoContabilBaixaCartao.pas` (538 linhas) · tela `uTron.pas:2107` (opção 5 do radio).
 * Dossiê: `uTron-integracao-contabil.md`. Motor compartilhado: `integracao-contabil.motor.ts`.
 *
 * É de longe o maior consumidor do razão do cliente: **1,34 milhão de linhas** nas três origens que saem do
 * mesmo fluxo — a baixa do cartão (51), a taxa da operadora (61) e as outras despesas (62) —, 77% de tudo que
 * existe em `DIARIO` e 58.879 lançamentos só em 2026.
 *
 * O ciclo é por LOTE de baixa: os cartões liberados e ainda não contabilizados do lote de um lado, a
 * movimentação bancária do mesmo lote do outro. O lançamento principal é UM por lote (pelo total líquido);
 * a taxa e as outras despesas são UM por cartão que as tenha.
 *
 * Gate de período: **não é** o fechamento diário nem `periodo_contabil` — é
 * `CONFIG_INTEGRACAO_CONTABIL.CHAVEAMENTO_PERIODO` (`UIntegracaoContabil.pas:286`), que no cliente está NULL
 * e por isso hoje não bloqueia nada. A comparação é `<=`: a data final digitada tem de ser POSTERIOR ao
 * chaveamento.
 *
 * ⚠️ **divergência consciente — multi-empresa.** O legado não filtra empresa em lugar nenhum deste fluxo
 * (`uTron.pas:2068` deixa a opção 5 fora do seletor de empresas) e tira o `IDEMPRESA` de cada lançamento da
 * própria linha do cartão, varrendo o banco inteiro. A nossa API é tenant-scoped: roda na empresa corrente.
 * No cliente isso separa **23 lotes** que hoje misturam duas empresas — que passam a ser integrados uma
 * empresa por vez, com o total do lançamento de cada uma. Nenhum valor se perde; a partição é outra.
 */
@Injectable()
export class CartaoContabilService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /**
   * `TIntegracaoContabil.PeriodoFechado` (`UIntegracaoContabil.pas:282-294`). Chaveamento NULO não bloqueia —
   * no legado a data nula vira 30/12/1899 e a comparação nunca é verdadeira; aqui é explícito.
   */
  private async assertPeriodoAberto(db: AnyDB, dataFim: string): Promise<void> {
    const cfg = (await db
      .selectFrom('config_integracao_contabil')
      .select('chaveamento_periodo')
      .executeTakeFirst()) as { chaveamento_periodo: unknown } | undefined;
    if (!cfg) throw new BusinessRuleError('CONFIG_INTEGRACAO_NAO_DEFINIDA');
    const chav = cfg.chaveamento_periodo == null ? null : String(cfg.chaveamento_periodo).slice(0, 10);
    if (chav && dataFim <= chav) throw new BusinessRuleError('PERIODO_CONTABIL_CHAVEADO', { ate: chav });
  }

  /**
   * Os lotes com baixa a integrar (`GetSQLCartaoBXLotes` :255-278). Por lote informado OU por período de
   * `DTBAIXA` — é um ou outro, como no legado.
   */
  async lotesPendentes(p: { dataIni: string; dataFim: string; idlote?: number | null }): Promise<Array<{ idlote: number; cartoes: number; total_liquido: number }>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = (await sql<Record<string, unknown>>`
      SELECT c.idlote,
             count(*)::int AS cartoes,
             sum(c.valor - coalesce(c.valor_taxa_paga,0) - coalesce(c.valor_outras_despesas_paga,0)) AS total_liquido
        FROM cartao c
       WHERE coalesce(c.contabilizado,'N') = 'N'
         AND c.liberado = 'S'
         AND c.idempresa = ${emp}
         AND c.idlote IS NOT NULL
         AND ((${p.idlote ?? null}::int IS NOT NULL AND c.idlote = ${p.idlote ?? null}::int)
           OR (${p.idlote ?? null}::int IS NULL
               AND c.dtbaixa::date BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date))
       GROUP BY c.idlote
       ORDER BY c.idlote
    `.execute(db)).rows;
    return rows.map((r) => ({ idlote: Number(r.idlote), cartoes: Number(r.cartoes), total_liquido: r2(num(r.total_liquido)) }));
  }

  /** INTEGRAR: percorre os lotes e grava o razão. Tudo numa transação só, como o legado (`uTron.pas:132`). */
  async integrar(p: { dataIni: string; dataFim: string; idlote?: number | null }): Promise<ResultadoIntegracao> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    await this.assertPeriodoAberto(db, p.dataFim);
    const lotes = await this.lotesPendentes(p);
    if (!lotes.length) return { lotes: 0, cartoes: 0, lancamentos: 0, total: 0 };

    const cfg = (await db
      .selectFrom('config_integracao_contabil')
      .select(['config_baixa_cartao', 'config_taxa_cartao', 'config_outras_desp_cartao'])
      .executeTakeFirstOrThrow()) as Record<string, number | null>;
    const sitBaixa = cfg.config_baixa_cartao;
    const sitTaxa = cfg.config_taxa_cartao;
    const sitOutras = cfg.config_outras_desp_cartao;
    if (sitBaixa == null) throw new BusinessRuleError('SITUACAO_NAO_CONFIGURADA', { qual: 'config_baixa_cartao' });

    return db.transaction().execute(async (trx: AnyDB) => {
      let cartoes = 0;
      let lancamentos = 0;
      let total = 0;
      for (const { idlote } of lotes) {
        const itens = await this.cartoesDoLote(trx, emp, idlote);
        const mov = await this.movimentacaoDoLote(trx, emp, idlote);
        // `Integrar` :331 — um lote sem os dois lados aborta a integração INTEIRA (não pula o lote).
        if (!itens.length || !mov.length) throw new BusinessRuleError('BAIXA_CARTAO_LOTE_SEM_REGISTROS', { idlote });

        const totalBaixado = r2(mov.reduce((s, m) => s + m.valor, 0));
        const valorLote = r2(itens.reduce((s, i) => s + i.valor, 0));
        // `AjustaValores` :24-93 — baixa parcial: rateia a diferença entre os cartões do lote.
        const cursor = ajustaValores(itens, valorLote, totalBaixado);

        // (1) LANÇAMENTO PRINCIPAL, um por lote. O valor é o total ANTES do rateio (`Valor := vValor`, :365):
        // o rateio mexe no dataset em memória, e como as duas pernas da 893 são FIXAS no cliente, nada do que
        // ele ajusta chega ao razão. Fica fiel para quem tiver a perna automática.
        const ref = itens[cursor];
        await lancarNoDiario(trx, {
          emp,
          codorigem: ORIGEM.BAIXA,
          situacao: sitBaixa,
          data: ref.dtbaixa,
          valor: valorLote,
          idorigem: ref.codvendcartao,
          documento: String(ref.codvendcartao),
          complemento: String(ref.codvendcartao),
          dataSetC: itens.map(regDoCartao),
          dataSetD: mov.map((m) => ({ codplanocontas: m.codplanocontas, valor: m.valor, descricao: `a conta ${m.codconta}` })),
          desclote: `Baixa de cartão — lote ${idlote}`,
        });
        lancamentos += 1;
        total = r2(total + valorLote);

        // (2) por cartão: outras despesas e depois taxas — nesta ordem (:407 e :447).
        for (const it of itens) {
          if (it.valor_outras_despesas_paga !== 0) {
            lancamentos += await this.lancarAcessorio(trx, emp, it, {
              codorigem: ORIGEM.OUTRAS_DESPESAS,
              situacao: sitOutras,
              qual: 'config_outras_desp_cartao',
              valor: Math.abs(it.valor_outras_despesas_paga),
              codplc: it.codplc_acredesc,
              erroCentroCusto: 'CENTRO_CUSTO_OUTRAS_DESPESAS_NAO_INFORMADO',
              desclote: `Outras despesas do cartão ${it.codvendcartao}`,
            });
          }
          if (it.valor_taxa_paga !== 0) {
            lancamentos += await this.lancarAcessorio(trx, emp, it, {
              codorigem: ORIGEM.TAXA,
              situacao: sitTaxa,
              qual: 'config_taxa_cartao',
              valor: Math.abs(it.valor_taxa_paga),
              codplc: it.codplc_taxa_cartao,
              erroCentroCusto: 'CENTRO_CUSTO_TAXA_NAO_INFORMADO',
              desclote: `Taxa do cartão ${it.codvendcartao}`,
            });
          }
        }

        // (3) só depois de o lançamento passar (:377-389).
        await trx.updateTable('cartao').set({ contabilizado: 'S' })
          .where('codvendcartao', 'in', itens.map((i) => i.codvendcartao)).where('idempresa', '=', emp).execute();
        await trx.updateTable('mov_contas_bancarias').set({ contabilizado: 'S' })
          .where('codmovconta', 'in', mov.map((m) => m.codmovconta)).where('idempresa', '=', emp).execute();
        cartoes += itens.length;
      }
      return { lotes: lotes.length, cartoes, lancamentos, total };
    });
  }

  /**
   * Taxa (61/`SitTaxaCartao`) e outras despesas (62/`SitOutrasDespCartao`): mesma forma, só muda de onde vem o
   * valor e qual centro de custo. `DataSetC` = o plano de contas da conta bancária (`GetSQLPLC` :1986),
   * `DataSetD` = o plano de contas do centro de custo (`GetSQLCentroCustoPLC` :1949).
   */
  private async lancarAcessorio(
    trx: AnyDB,
    emp: number,
    it: CartaoDoLote,
    a: { codorigem: number; situacao: number | null; qual: string; valor: number; codplc: number; erroCentroCusto: string; desclote: string },
  ): Promise<number> {
    if (a.situacao == null) throw new BusinessRuleError('SITUACAO_NAO_CONFIGURADA', { qual: a.qual });
    // `QryPlcCB.IsEmpty` :415/:455 — a conta bancária da forma de pagamento precisa ter plano de contas.
    if (it.codplanocontas == null) throw new BusinessRuleError('CONTA_CONTABIL_NAO_INFORMADA', { codconta: it.codconta, codvendcartao: it.codvendcartao });
    // :423/:463 — o centro de custo é obrigatório mesmo quando nenhuma das pernas é automática.
    if (!a.codplc) throw new BusinessRuleError(a.erroCentroCusto, { codvendcartao: it.codvendcartao });
    const plc = (await trx
      .selectFrom('plc as p')
      .leftJoin('plano_contas as pc', 'pc.codplanocontas', 'p.codcontabil')
      .select(['pc.codplanocontas as codplanocontas', 'p.descricao as descricao'])
      .where('p.codplc', '=', a.codplc)
      .executeTakeFirst()) as { codplanocontas: number | null; descricao: string | null } | undefined;

    await lancarNoDiario(trx, {
      emp,
      codorigem: a.codorigem,
      situacao: a.situacao,
      data: it.dtbaixa,
      valor: a.valor,
      idorigem: it.codvendcartao,
      documento: String(it.codvendcartao),
      complemento: String(it.codvendcartao),
      dataSetC: [{ codplanocontas: it.codplanocontas, valor: a.valor, descricao: `a conta ${it.codconta}` }],
      dataSetD: [{ codplanocontas: plc?.codplanocontas ?? null, valor: a.valor, descricao: `o centro de custo ${plc?.descricao ?? a.codplc}` }],
      desclote: a.desclote,
    });
    return 1;
  }

  /** `GetSQLCartaoBX` :220-253. */
  private async cartoesDoLote(trx: AnyDB, emp: number, idlote: number): Promise<CartaoDoLote[]> {
    const rows = (await sql<Record<string, unknown>>`
      SELECT c.codvendcartao, c.idempresa, to_char(c.dtbaixa, 'YYYY-MM-DD') AS dtbaixa,
             (c.valor - coalesce(c.valor_taxa_paga,0) - coalesce(c.valor_outras_despesas_paga,0)) AS valor,
             coalesce(c.valor_taxa_paga,0) AS valor_taxa_paga,
             coalesce(c.valor_outras_despesas_paga,0) AS valor_outras_despesas_paga,
             coalesce(c.codplc_taxa_cartao,0) AS codplc_taxa_cartao,
             coalesce(c.codplc_acredesc,0) AS codplc_acredesc,
             cb.codlanccontabil AS codplanocontas, cb.codconta
        FROM cartao c
        JOIN formas_pgto fp ON fp.idpgto = c.idpgto
        LEFT JOIN contas_bancarias cb ON cb.codconta = fp.codcontacorrente
       WHERE c.idlote = ${idlote}
         AND coalesce(c.contabilizado,'N') = 'N'
         AND c.liberado = 'S'
         AND c.idempresa = ${emp}
       ORDER BY c.codvendcartao
    `.execute(trx)).rows;
    return rows.map((r) => ({
      codvendcartao: Number(r.codvendcartao),
      idempresa: Number(r.idempresa),
      dtbaixa: String(r.dtbaixa),
      valor: r2(num(r.valor)),
      valor_taxa_paga: r2(num(r.valor_taxa_paga)),
      valor_outras_despesas_paga: r2(num(r.valor_outras_despesas_paga)),
      codplc_taxa_cartao: Number(r.codplc_taxa_cartao),
      codplc_acredesc: Number(r.codplc_acredesc),
      codplanocontas: r.codplanocontas == null ? null : Number(r.codplanocontas),
      codconta: r.codconta == null ? null : Number(r.codconta),
    }));
  }

  /**
   * `GetSQLMovimentacao` :1960-1983 com o `/*FILTRO_ADICIONAL*​/` que a baixa de cartão injeta:
   * `AND M.VALOR > 0` (:301). É o que separa o CRÉDITO da baixa das saídas do mesmo lote — no cliente há
   * 21.523 movimentações positivas contra 42.639 negativas nos lotes de cartão.
   * O filtro de "DEVOLUÇÃO DE CHEQUE" vem do legado e pega 1 linha no banco inteiro; entra por fidelidade.
   */
  private async movimentacaoDoLote(trx: AnyDB, emp: number, idlote: number): Promise<Array<{ codmovconta: number; valor: number; codplanocontas: number | null; codconta: number }>> {
    const rows = (await sql<Record<string, unknown>>`
      SELECT m.codmovconta, abs(m.valor) AS valor, cb.codlanccontabil AS codplanocontas, m.codconta
        FROM mov_contas_bancarias m
        JOIN contas_bancarias cb ON cb.codconta = m.codconta
       WHERE m.idlote = ${idlote}
         AND coalesce(m.contabilizado,'N') = 'N'
         AND m.idempresa = ${emp}
         AND NOT (upper(coalesce(m.historico,'.')) LIKE '%DEVOLUÇÃO DE CHEQUE%')
         AND m.valor > 0
       ORDER BY m.codmovconta
    `.execute(trx)).rows;
    return rows.map((r) => ({
      codmovconta: Number(r.codmovconta),
      valor: r2(num(r.valor)),
      codplanocontas: r.codplanocontas == null ? null : Number(r.codplanocontas),
      codconta: Number(r.codconta),
    }));
  }

  /**
   * ESTORNAR (`Estornar` :95-218). Desfaz as três origens de uma vez: apaga o razão, devolve
   * `CARTAO.CONTABILIZADO` e `MOV_CONTAS_BANCARIAS.CONTABILIZADO` para nulo.
   *
   * Pela TELA (`Codigo = 0`) o legado apaga o razão em bloco, por período: `DELETE FROM DIARIO WHERE CODORIGEM
   * IN (51,61,62) AND TRUNC(DATALAN) BETWEEN ini AND fim` (:195). Por lote, apaga linha a linha. Mantivemos os
   * dois caminhos — o de período também limita à empresa do tenant.
   */
  async estornar(p: { dataIni: string; dataFim: string; idlote?: number | null }): Promise<{ lotes: number; cartoes: number; linhas: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    await this.assertPeriodoAberto(db, p.dataFim);

    return db.transaction().execute(async (trx: AnyDB) => {
      // os cartões contabilizados que TÊM lançamento no alvo (`GetSQLCartoesBX` :96-126).
      const alvo = (await sql<Record<string, unknown>>`
        SELECT c.codvendcartao, c.idlote
          FROM cartao c
         WHERE coalesce(c.contabilizado,'N') = 'S'
           AND c.liberado = 'S'
           AND c.idempresa = ${emp}
           AND c.codvendcartao IN (
                 SELECT d.idorigem FROM diario d
                  WHERE d.codorigem IN (51,61,62) AND d.codempresa = ${emp}
                    AND (${p.idlote ?? null}::int IS NOT NULL
                          OR d.datalan BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date))
           AND (${p.idlote ?? null}::int IS NULL OR c.idlote = ${p.idlote ?? null}::int)
         ORDER BY c.idlote, c.codvendcartao
      `.execute(trx)).rows;
      if (!alvo.length) return { lotes: 0, cartoes: 0, linhas: 0 };

      const ids = alvo.map((r) => Number(r.codvendcartao));
      const lotes = Array.from(new Set(alvo.map((r) => Number(r.idlote))));

      let linhas = 0;
      if (p.idlote != null) {
        // por lote: apaga o razão dos cartões e o do lançamento das movimentações do lote (:159 e :175).
        const movIds = (await trx.selectFrom('mov_contas_bancarias').select('codmovconta')
          .where('idlote', '=', p.idlote).where('idempresa', '=', emp).execute()) as Array<{ codmovconta: number }>;
        const chaves = ids.concat(movIds.map((m) => Number(m.codmovconta)));
        const del = await trx.deleteFrom('diario')
          .where('codorigem', 'in', [51, 61, 62]).where('codempresa', '=', emp)
          .where('idorigem', 'in', chaves).execute();
        linhas = Number(del[0]?.numDeletedRows ?? 0);
      } else {
        const del = await trx.deleteFrom('diario')
          .where('codorigem', 'in', [51, 61, 62]).where('codempresa', '=', emp)
          .where('datalan', '>=', sql`${p.dataIni}::date`).where('datalan', '<=', sql`${p.dataFim}::date`).execute();
        linhas = Number(del[0]?.numDeletedRows ?? 0);
      }
      // lotes contábeis órfãos (cabeçalho nosso, não do legado — o cliente deixa `LOTE_CONTABIL` vazia).
      await sql`DELETE FROM lote_contabil l WHERE l.codorigem IN (51,61,62) AND l.codempresa = ${emp}
                  AND NOT EXISTS (SELECT 1 FROM diario d WHERE d.codlote = l.codlotecontabil)`.execute(trx);

      await trx.updateTable('cartao').set({ contabilizado: null }).where('codvendcartao', 'in', ids).where('idempresa', '=', emp).execute();
      await trx.updateTable('mov_contas_bancarias').set({ contabilizado: null }).where('idlote', 'in', lotes).where('idempresa', '=', emp).execute();
      return { lotes: lotes.length, cartoes: ids.length, linhas };
    });
  }
}

/**
 * `AjustaValores` (`UIntegracaoContabilBaixaCartao.pas:24-93`) — quando a soma dos cartões não bate com o que
 * de fato entrou no banco (baixa parcial), rateia a diferença proporcionalmente entre eles e joga o resíduo
 * na primeira linha que o comporte. Muta a lista em memória, como o legado muta o dataset.
 *
 * Devolve o índice em que o CURSOR do legado ficou parado — e isso não é detalhe: o `IDORIGEM` do lançamento
 * principal sai do registro corrente (`:363`). Sem rateio o cursor termina no ÚLTIMO cartão do lote; com
 * rateio o laço do resíduo dá `First` e sai no primeiro que couber. Prova no razão do cliente: dos 15.700
 * lançamentos da origem 51, **10.105 têm `IDORIGEM` = último cartão do lote e 6.721 = o primeiro**.
 */
export function ajustaValores(itens: Array<{ valor: number }>, pValor: number, pTotalBaixado: number): number {
  const ultimo = Math.max(0, itens.length - 1);
  if (pTotalBaixado === 0) throw new BusinessRuleError('TOTAL_BAIXADO_ZERO');
  if (pTotalBaixado === pValor) return ultimo;

  const paraBaixo = pValor > pTotalBaixado;
  const diferenca = paraBaixo ? pValor - pTotalBaixado : pTotalBaixado - pValor;

  let novoTotal = 0;
  for (const it of itens) {
    const rateio = r2((it.valor / pValor) * diferenca);
    if (rateio > 0) it.valor = r2(paraBaixo ? it.valor - rateio : it.valor + rateio);
    novoTotal = r2(novoTotal + it.valor);
  }

  if (novoTotal !== pTotalBaixado) {
    for (let i = 0; i < itens.length; i += 1) {
      if (novoTotal > pTotalBaixado) {
        // sobra: desconta da primeira linha que aguente o desconto inteiro; senão segue procurando.
        if (itens[i].valor > novoTotal - pTotalBaixado) {
          itens[i].valor = r2(itens[i].valor - (novoTotal - pTotalBaixado));
          return i;
        }
      } else {
        // falta: soma tudo na primeira linha e para.
        itens[i].valor = r2(itens[i].valor + (pTotalBaixado - novoTotal));
        return i;
      }
    }
  }
  return ultimo;
}

const regDoCartao = (c: CartaoDoLote): RegistroDataSet => ({
  codplanocontas: c.codplanocontas,
  valor: c.valor,
  descricao: `a conta ${c.codconta}`,
});
