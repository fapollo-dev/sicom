import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { destinosPermitidos } from './contas-transf-perm.service';
import { SenhaOperacaoService } from './senha-operacao.service';
import { configNaTrx } from '../compras/pedido-heranca';
import { estornarTransferenciaLote, integrarTransferencias } from '../cobranca/documentos-contabil.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
/** a data da movimentação é a EMISSÃO, com hora (mig 335); o fechamento de caixa antigo só tinha DATA_FECHAMENTO */
const DATA_MOV = sql`coalesce(dtemissao, data_fechamento)`;
/** o dia da movimentação no fuso da loja — para comparar com datas */
const DIA_MOV = sql`(coalesce(dtemissao, data_fechamento) AT TIME ZONE 'America/Sao_Paulo')::date`;
/** as 8 permissões por operador × conta do binário novo (`CONTAS_BANCARIAS_OP`, uControleContasBancarias-spec.md §1.1) */
export const FLAGS_CONTA = ['visualizar_saldos', 'habilitar_tranfer', 'habiltiar_libe_moviment', 'habiltiar_lanca_saldo', 'habiltiar_chavear_fec_cxa', 'habiltiar_troca_valores', 'habiltiar_detalhar_conta', 'habiltiar_conci_ofx'] as const;
export type FlagConta = (typeof FLAGS_CONTA)[number];
type ContaCompleta = { codconta: number; idempresa: number; nroconta: string | null; codbco: number; dtchaveamento: string | null };
/** o lote da transferência sai do mesmo `ID_IDLOTE` das baixas, cartão e fechamento (`GetID('IDLOTE')`) */
const novoLoteTransferencia = async (trx: AnyDB): Promise<number> =>
  Number((await sql<{ id: string }>`SELECT nextval('seq_idlote') AS id`.execute(trx)).rows[0].id);

/**
 * CONTROLE DE CONTAS CORRENTES (FRMCONTROLECONTASBANCARIAS). Movimentação da tesouraria (mov_contas_bancarias).
 * `saldo`/`extrato`: Σ com sinal (C:+ / D:−) do LIBERADO da conta, pela data de EMISSÃO. `lancarSaldo`: o lançamento de
 * saldo do legado (senha ADM, valor com sinal, modalidade, LANCAMENTO_SALDO='S'). `transferir`: as 2 pernas do legado (lote + NRODOCUMENTO 'TRANSFERENCIA'),
 * destino em qualquer loja. `estornar`: a remoção de transferência (o lote inteiro) ou a exclusão da movimentação
 * sem lote, como as duas telas do legado. Saldo-negativo travado só na transferência a partir de conta CAIXA.
 */
@Injectable()
export class ControleContasService {
  constructor(private readonly dbp: DatabaseProvider, private readonly senhaOp: SenhaOperacaoService) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op(): number | null {
    return currentTenant().operadorId ?? null;
  }

  /**
   * a conta da lista do operador (`udmControleContasBancarias.dfm:669-683`: `CONTAS_BANCARIAS_OP` do operador e conta ativa —
   * sem filtro de loja no fonte; 15 operadores veem contas de mais de uma loja) e, se pedida, a permissão da ação na conta
   * (as flags por operador × conta do binário novo; 'S' em 100% da produção hoje, mas precisam valer).
   */
  private async conta(db: AnyDB, codconta: number, flag?: FlagConta): Promise<{ codbco: number; idempresa: number }> {
    const c = (await sql<Record<string, unknown>>`
      SELECT c.codconta, c.codbco, c.idempresa, ${flag ? sql`coalesce(o.${sql.ref(flag)}, 'S')` : sql`'S'`} AS permitido
        FROM contas_bancarias c
        JOIN contas_bancarias_op o ON o.codconta = c.codconta AND o.codoperador = ${this.op()}
       WHERE c.codconta = ${codconta} AND coalesce(c.ativo, 'S') = 'S'
       LIMIT 1`.execute(db)).rows[0];
    if (!c) throw new BusinessRuleError('CONTA_CORRENTE_NAO_ENCONTRADA', { codconta });
    if (String(c.permitido) !== 'S') throw new BusinessRuleError('CONTA_ACAO_NAO_PERMITIDA', { codconta, acao: flag });
    // codbco null → −1 (NÃO tratar como CAIXA/0). CAIXA = codbco 0 (trava saldo negativo).
    return { codbco: c.codbco == null ? -1 : Number(c.codbco), idempresa: Number(c.idempresa) };
  }

  /** saldo (Σ com sinal) da conta. `ateData` (opcional) = saldo ATÉ a data (âncora do extrato com filtro). */
  private async saldoDe(db: AnyDB, codconta: number, _emp: number, ateData?: string): Promise<number> {
    // o saldo é da CONTA (o legado não tem IDEMPRESA na movimentação; a carga dá a empresa da conta)
    let q = db
      .selectFrom('mov_contas_bancarias')
      .select(sql`coalesce(sum(case when tipomovimento='D' then -valor else valor end),0)`.as('saldo'))
      .where('codconta', '=', codconta)
      // o saldo do legado conta só o LIBERADO (mig 297); N e nulo são "a prazo", à parte
      .where(sql`coalesce(liberado, 'N')`, '=', 'S');
    if (ateData) q = q.where(DIA_MOV, '<=', ateData);
    const r = (await q.executeTakeFirst()) as { saldo?: unknown } | undefined;
    return r2(num(r?.saldo));
  }

  /**
   * a LISTA de contas da tela (`udmControleContasBancarias.dfm:669-683`): as ligadas ao operador em CONTAS_BANCARIAS_OP e
   * ativas, por titular, com o chaveamento e as 8 permissões da conta (que ligam os botões).
   */
  async contas(): Promise<Record<string, unknown>[]> {
    this.emp();
    const rows = (await sql<Record<string, unknown>>`
      SELECT c.codconta, c.codbco, b.banco, c.titular, c.nroconta, c.gerente, to_char(c.dtabertura, 'YYYY-MM-DD') AS dtabertura, c.fone1, c.obs,
             to_char(c.dtchaveamento, 'YYYY-MM-DD') AS dtchaveamento, c.codoperadorchaveamento, op.nome AS operadorchaveamento, c.idempresa,
             ${sql.join(FLAGS_CONTA.map((f) => sql`coalesce(o.${sql.ref(f)}, 'S') AS ${sql.ref(f)}`))}
        FROM contas_bancarias c
        JOIN contas_bancarias_op o ON o.codconta = c.codconta AND o.codoperador = ${this.op()}
        LEFT JOIN bancos b ON b.codbco = c.codbco
        LEFT JOIN operadores op ON op.codoperador = c.codoperadorchaveamento
       WHERE coalesce(c.ativo, 'S') = 'S'
       ORDER BY c.titular, c.codconta`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
    return rows.map((c) => ({ ...c, codconta: Number(c.codconta), codbco: c.codbco == null ? null : Number(c.codbco), caixa: Number(c.codbco) === 0 }));
  }

  /** os DESTINOS da transferência: qualquer conta ativa, de qualquer loja (`SpeedButton1Click` sem filtro, Utransferencia.pas:530) */
  async destinos(): Promise<Record<string, unknown>[]> {
    this.emp();
    const rows = (await sql<Record<string, unknown>>`
      SELECT c.codconta, c.nroconta, c.titular, c.idempresa, c.codbco FROM contas_bancarias c WHERE coalesce(c.ativo, 'S') = 'S' ORDER BY c.titular, c.codconta`
      .execute(this.dbp.forTenantRead() as AnyDB)).rows;
    return rows.map((c) => ({ ...c, codconta: Number(c.codconta) }));
  }

  /**
   * o painel "Saldo" (`sqqSaldo`, `udmControleContasBancarias.dfm:759-777`, com `INNER JOIN FORMAS_PGTO`): Entradas e Saídas de
   * TUDO (liberado ou não), Total a Prazo (não liberado), Saldo Futuro (tudo) e Saldo Atual (liberado). "Posicionar saldo nesta
   * data" corta pela emissão — o legado compara com a data à meia-noite e deixa de fora o movimento do próprio dia que tem hora;
   * aqui entra o dia inteiro (divergência consciente).
   */
  async saldo(codconta: number, ateData?: string): Promise<{ codconta: number; entradas: number; saidas: number; a_prazo: number; futuro: number; saldo: number }> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.conta(db, codconta, 'visualizar_saldos');
    const r = (await sql<Record<string, unknown>>`
      SELECT coalesce(sum(CASE WHEN m.tipomovimento <> 'D' THEN m.valor ELSE 0 END), 0) AS entradas,
             coalesce(sum(CASE WHEN m.tipomovimento = 'D' THEN m.valor ELSE 0 END), 0) AS saidas,
             coalesce(sum(CASE WHEN coalesce(m.liberado, 'N') <> 'S' THEN (CASE WHEN m.tipomovimento = 'D' THEN -m.valor ELSE m.valor END) ELSE 0 END), 0) AS a_prazo,
             coalesce(sum(CASE WHEN m.liberado = 'S' THEN (CASE WHEN m.tipomovimento = 'D' THEN -m.valor ELSE m.valor END) ELSE 0 END), 0) AS saldo
        FROM mov_contas_bancarias m
        JOIN formas_pgto f ON f.idpgto = m.idpgto
       WHERE m.codconta = ${codconta}
         AND (${ateData ?? null}::date IS NULL OR (coalesce(m.dtemissao, m.data_fechamento) AT TIME ZONE 'America/Sao_Paulo')::date <= ${ateData ?? null}::date)`.execute(db)).rows[0] ?? {};
    const entradas = r2(num(r.entradas));
    const saidas = r2(num(r.saidas)); // magnitude (o legado mostra negativo)
    const aPrazo = r2(num(r.a_prazo));
    const saldo = r2(num(r.saldo));
    return { codconta, entradas, saidas, a_prazo: aPrazo, futuro: r2(saldo + aPrazo), saldo };
  }

  /**
   * DETALHAMENTO DA CONTA (`UconsMovBancaria`, FRMCONSMOVBANCARIAS): o período (padrão hoje), a data do filtro (emissão,
   * vencimento ou liberação — `TRUNC(data) BETWEEN`), Todos/Liberados/Não liberados e o documento (F3). A grade na ordem do
   * legado (`ORDER BY MOV.DTEMISSAO, MOV.CODMOVCONTA`, com a hora) e o rodapé de 7 totais (`cdsSaldoDet`, .pas:418-489): Saldo
   * anterior (liberado até a véspera do início), Entradas, Saídas, Saldo do período (liberado), Total a prazo, Saldo futuro
   * (período + a prazo) e Saldo atual (período + anterior). Com o período vazio o legado apaga o rodapé inteiro (inclusive o
   * anterior) — aqui o anterior aparece (divergência consciente).
   */
  async detalhamento(f: { codconta: number; dtini?: string; dtfim?: string; liberado?: string; dataDe?: string; documento?: string }): Promise<Record<string, unknown>> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.conta(db, f.codconta, 'habiltiar_detalhar_conta');
    const ini = (f.dtini ?? hoje()).slice(0, 10);
    const fim = (f.dtfim ?? hoje()).slice(0, 10);
    const col = f.dataDe === 'vencimento' ? sql`m.dtvenc` : f.dataDe === 'liberacao' ? sql`m.dtliberacao` : sql`coalesce(m.dtemissao, m.data_fechamento)`;
    const dia = sql`(${col} AT TIME ZONE 'America/Sao_Paulo')::date`;
    const filtroLib = f.liberado === 'LIBERADOS' ? sql`AND m.liberado = 'S'` : f.liberado === 'NAO' ? sql`AND coalesce(m.liberado, 'N') <> 'S'` : sql``;
    const doc = f.documento?.trim() ? sql`AND m.nrodocumento ILIKE ${'%' + f.documento.trim() + '%'}` : sql``;
    const sinal = sql`CASE WHEN m.tipomovimento = 'D' THEN -m.valor ELSE m.valor END`;
    const rows = (await sql<Record<string, unknown>>`
      SELECT m.codmovconta, m.idlote, m.nrodocumento, ${sinal} AS valor,
             to_char(coalesce(m.dtemissao, m.data_fechamento) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS dtemissao,
             to_char(m.dtvenc AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dtvenc, to_char(m.dtliberacao AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dtliberacao,
             coalesce(m.liberado, 'N') AS liberado, m.tipomovimento, m.historico, m.codoperador, o.nome AS operador, f.modalidade, oc.descricao AS operacao,
             m.contabilizado, m.idlote_reversao, m.revertido, m.mov_conciliado, m.origem
        FROM mov_contas_bancarias m
        LEFT JOIN operacoes_conta oc ON oc.codopconta = m.codopconta
        LEFT JOIN formas_pgto f ON f.idpgto = m.idpgto
        LEFT JOIN operadores o ON o.codoperador = m.codoperador
       WHERE m.codconta = ${f.codconta} AND ${dia} BETWEEN ${ini}::date AND ${fim}::date ${filtroLib} ${doc}
       ORDER BY coalesce(m.dtemissao, m.data_fechamento), m.codmovconta
       LIMIT 20000`.execute(db)).rows;
    const t = (await sql<Record<string, unknown>>`
      SELECT coalesce(sum(CASE WHEN ${dia} BETWEEN ${ini}::date AND ${fim}::date AND m.tipomovimento <> 'D' THEN m.valor ELSE 0 END), 0) AS entradas,
             coalesce(sum(CASE WHEN ${dia} BETWEEN ${ini}::date AND ${fim}::date AND m.tipomovimento = 'D' THEN m.valor ELSE 0 END), 0) AS saidas,
             coalesce(sum(CASE WHEN ${dia} BETWEEN ${ini}::date AND ${fim}::date AND m.liberado = 'S' THEN ${sinal} ELSE 0 END), 0) AS periodo,
             coalesce(sum(CASE WHEN ${dia} BETWEEN ${ini}::date AND ${fim}::date AND coalesce(m.liberado, 'N') <> 'S' THEN ${sinal} ELSE 0 END), 0) AS a_prazo,
             coalesce(sum(CASE WHEN ${dia} < ${ini}::date AND m.liberado = 'S' THEN ${sinal} ELSE 0 END), 0) AS anterior
        FROM mov_contas_bancarias m
       WHERE m.codconta = ${f.codconta} ${filtroLib} ${doc}`.execute(db)).rows[0] ?? {};
    const periodo = r2(num(t.periodo));
    const aPrazo = r2(num(t.a_prazo));
    const anterior = r2(num(t.anterior));
    return {
      codconta: f.codconta, dtini: ini, dtfim: fim,
      movimentos: rows.map((m) => ({ ...m, codmovconta: Number(m.codmovconta), valor: r2(num(m.valor)) })),
      totais: { anterior, entradas: r2(num(t.entradas)), saidas: r2(num(t.saidas)), periodo, a_prazo: aPrazo, futuro: r2(periodo + aPrazo), atual: r2(periodo + anterior) },
    };
  }

  /**
   * "Visualizar títulos" (UconsMovBancaria.pas:986-1061): o lote do movimento (o de reversão, se for um contra-movimento) e onde
   * ele está — baixa de A Receber, de A Pagar ou de cartão. "Movimentação não possui lançamento de baixa a receber, a pagar ou cartão."
   */
  async titulosDoMovimento(codmovconta: number): Promise<{ lote: number; tipo: 'AR' | 'AP' | 'CARTAO'; revertido: boolean }> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const m = (await sql<{ codconta: number; idlote: number | null; idlote_reversao: number | null; revertido: string | null }>`
      SELECT codconta, idlote, idlote_reversao, revertido FROM mov_contas_bancarias WHERE codmovconta = ${codmovconta}`.execute(db)).rows[0];
    if (!m) throw new BusinessRuleError('MOVIMENTO_NAO_ENCONTRADO', { codmovconta });
    await this.conta(db, Number(m.codconta), 'habiltiar_detalhar_conta');
    const lote = num(m.idlote_reversao) > 0 ? num(m.idlote_reversao) : num(m.idlote);
    const revertido = num(m.idlote_reversao) > 0 || String(m.revertido ?? '') === 'S';
    if (lote > 0) {
      if ((await sql`SELECT 1 FROM areceber_bx WHERE idlote = ${lote} LIMIT 1`.execute(db)).rows.length) return { lote, tipo: 'AR', revertido };
      if ((await sql`SELECT 1 FROM apagar_bx WHERE idlote = ${lote} LIMIT 1`.execute(db)).rows.length) return { lote, tipo: 'AP', revertido };
      // o cartão pela GET_CARTAOBX.LOTE (o recebível baixado nesse lote), como o legado — é o que a consulta do lote mostra
      if (!revertido && (await sql`SELECT 1 FROM cartao WHERE idlote = ${lote} AND liberado = 'S' LIMIT 1`.execute(db)).rows.length) return { lote, tipo: 'CARTAO', revertido };
    }
    throw new BusinessRuleError(revertido ? 'MOVIMENTO_REVERTIDO_SEM_TITULOS' : 'MOVIMENTO_SEM_TITULOS', { codmovconta });
  }

  /** extrato: movimentos da conta (mais recentes primeiro, até 5000) + saldo corrente por linha. O header usa o
   *  saldo VERDADEIRO (Σ ALL — fold auditoria [MÉDIA]: antes o header vinha do Σ das 5000 mais ANTIGAS → errado numa
   *  conta com >5000 mov.). O saldo corrente é ancorado no saldo até dtfim (após o mais recente exibido) e desce. */
  async extrato(codconta: number, dtini?: string, dtfim?: string): Promise<{ codconta: number; saldo: number; movimentos: Record<string, unknown>[] }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.conta(db, codconta, 'habiltiar_detalhar_conta');
    const saldoAtual = await this.saldoDe(db, codconta, emp); // Σ ALL = saldo corrente real (header)
    const ancora = dtfim ? await this.saldoDe(db, codconta, emp, dtfim) : saldoAtual; // saldo após o mais recente do recorte
    let q = db
      .selectFrom('mov_contas_bancarias')
      .select(['codmovconta', 'valor', 'tipomovimento', 'codopconta', 'historico', 'origem', 'idorigem', 'data_fechamento', 'mov_conciliado', 'liberado', 'nrodocumento', 'idlote', 'contabilizado',
        sql<string>`to_char(${DATA_MOV} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`.as('dtemissao'), sql<string>`to_char(${DATA_MOV} AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI')`.as('hora')])
      .where('codconta', '=', codconta);
    if (dtini) q = q.where(DIA_MOV, '>=', dtini);
    if (dtfim) q = q.where(DIA_MOV, '<=', dtfim);
    // mais recentes primeiro (limita aos 5000 últimos, não aos primeiros); dentro do dia, pela hora (mig 335)
    const rows = (await q.orderBy(DATA_MOV, 'desc').orderBy('codmovconta', 'desc').limit(5000).execute()) as Record<string, unknown>[];
    // saldo corrente: da linha mais nova (após ela = âncora) descendo p/ as mais antigas.
    let running = ancora;
    const movimentos = rows.map((m) => {
      const delta = String(m.tipomovimento) === 'D' ? -num(m.valor) : num(m.valor);
      // o que está a prazo aparece no extrato mas não mexe no saldo — a âncora (saldoDe) também não o conta
      const liberado = String(m.liberado ?? 'N') === 'S';
      const linha = { ...m, valor_com_sinal: r2(delta), a_prazo: !liberado, saldo_corrente: r2(running) };
      if (!liberado) return linha;
      running = r2(running - delta); // saldo ANTES desta linha = saldo APÓS a próxima (mais antiga)
      return linha;
    });
    return { codconta, saldo: saldoAtual, movimentos };
  }

  /**
   * os movimentos A LIBERAR da conta — a pesquisa do botão "Liberar Movimentações" (`GET_MOV_CONTAS_BANCARIAS` com
   * `LIBERADO <> 'SIM' AND CODIGO_CONTA = conta`, uControleContasBancarias.pas:211-215), em multisseleção.
   */
  async aLiberar(codconta: number): Promise<Record<string, unknown>[]> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.conta(db, codconta, 'habiltiar_libe_moviment');
    const rows = (await sql<Record<string, unknown>>`
      SELECT m.codmovconta, to_char(m.dtemissao AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dtemissao, to_char(m.dtvenc AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dtvenc,
             m.nrodocumento, CASE WHEN m.tipomovimento = 'D' THEN -m.valor ELSE m.valor END AS valor, m.historico, m.tipomovimento, m.idlote, f.modalidade
        FROM mov_contas_bancarias m LEFT JOIN formas_pgto f ON f.idpgto = m.idpgto
       WHERE m.codconta = ${codconta} AND coalesce(m.liberado, 'N') <> 'S'
       ORDER BY m.dtemissao, m.codmovconta
       LIMIT 5000`.execute(db)).rows;
    return rows.map((r) => ({ ...r, codmovconta: Number(r.codmovconta), valor: r2(num(r.valor)) }));
  }

  /**
   * LIBERAR — o botão "Liberar Movimentações" (uControleContasBancarias.pas:197-278, multisseleção) e o "Liberar Movimento" do
   * detalhamento (UconsMovBancaria.pas:769-861, uma linha): a data informada vira `DTLIBERACAO` e `LIBERADO='S'`; com
   * `MUDAR_EMISSAO_LIBERACAO_MOV='S'` também a emissão e o vencimento (produção 'N'). O cheque próprio ligado ao movimento é
   * baixado na mesma data (RELACAO_CHQ_PROP; 0 linhas hoje). A linha já liberada não é tocada — o menu do legado re-liberava e
   * sobrescrevia a data (defeito não copiado). Numa transação (o legado aplica linha a linha).
   */
  async liberar(dto: { codconta: number; codmovcontas: number[]; data: string }): Promise<{ liberados: number; ignorados: number }> {
    const emp = this.emp();
    const op = this.op();
    const data = dto.data.slice(0, 10);
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.conta(trx, dto.codconta, 'habiltiar_libe_moviment');
      const mudarEmissao = String((await configNaTrx(trx, 'MUDAR_EMISSAO_LIBERACAO_MOV', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })) ?? 'N').toUpperCase() === 'S';
      const ids = [...new Set(dto.codmovcontas)];
      const alvo = (await sql<{ codmovconta: number }>`
        SELECT codmovconta FROM mov_contas_bancarias
         WHERE codconta = ${dto.codconta} AND codmovconta = ANY(${ids}::int[]) AND coalesce(liberado, 'N') <> 'S'
           FOR UPDATE`.execute(trx)).rows.map((r) => Number(r.codmovconta));
      if (alvo.length) {
        await sql`UPDATE chq_proprio SET baixado = 'S', dtbaixa = ${data}::date
                   WHERE codchqproprio IN (SELECT codchqproprio FROM relacao_chq_prop WHERE codmovconta = ANY(${alvo}::int[]))`.execute(trx);
        await sql`UPDATE mov_contas_bancarias
                     SET liberado = 'S', dtliberacao = (${data}::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'
                         ${mudarEmissao ? sql`, dtemissao = (${data}::date)::timestamp AT TIME ZONE 'America/Sao_Paulo', dtvenc = (${data}::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'` : sql``}
                   WHERE codmovconta = ANY(${alvo}::int[])`.execute(trx);
      }
      return { liberados: alvo.length, ignorados: ids.length - alvo.length };
    });
  }

  /**
   * "Mudar data de liberação" (UconsMovBancaria.pas:870-922): só a `DTLIBERACAO` do movimento já liberado; não mexe em LIBERADO
   * nem testa chaveamento ou contabilizado (~13 usos por ano). "Não é possivel alterar a data de documentos não liberados!"
   */
  async mudarDataLiberacao(codmovconta: number, data: string): Promise<{ codmovconta: number; dtliberacao: string }> {
    this.emp();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const m = (await sql<{ codconta: number; dtliberacao: unknown }>`SELECT codconta, dtliberacao FROM mov_contas_bancarias WHERE codmovconta = ${codmovconta} FOR UPDATE`.execute(trx)).rows[0];
      if (!m) throw new BusinessRuleError('MOVIMENTO_NAO_ENCONTRADO', { codmovconta });
      await this.conta(trx, Number(m.codconta), 'habiltiar_detalhar_conta');
      if (m.dtliberacao == null) throw new BusinessRuleError('MOVIMENTO_NAO_LIBERADO', { codmovconta });
      await sql`UPDATE mov_contas_bancarias SET dtliberacao = (${data.slice(0, 10)}::date)::timestamp AT TIME ZONE 'America/Sao_Paulo' WHERE codmovconta = ${codmovconta}`.execute(trx);
      return { codmovconta, dtliberacao: data.slice(0, 10) };
    });
  }

  /**
   * LANÇAMENTO DE SALDO (`uControleContasBancarias.pas:181-195` → `UlancamentoSaldo.pas` → `ValidaSaldoAnterior(LancaMov=True,
   * VerifSaldo=False)`, udmPrincipal.pas:2131-2250): senha administrativa; valor COM SINAL (positivo = crédito); a modalidade da
   * loja (IDPGTO); histórico (padrão "SALDO INICIAL"); a data (binário novo: retroativa). Uma linha com LIBERADO 'S', emissão =
   * vencimento = liberação na data, operação 0, o operador e — binário novo — `LANCAMENTO_SALDO='S'` com `USUCAD_LANCAMENTO_SALDO`
   * (20 linhas em produção, nenhuma contabilizada: o 'N' da coluna é o movimento do ADIANTAMENTO, origem 63). Sem teste de saldo;
   * trava o chaveamento da conta. Substitui o "lançamento por operação" (CODOPCONTA>0: 0 linhas em toda a história).
   */
  async lancarSaldo(dto: { codconta: number; valor: number; idpgto: number; historico?: string; data?: string; senhaAdm: string }): Promise<{ codmovconta: number; tipomovimento: string; saldo: number }> {
    const emp = this.emp();
    const op = this.op();
    // "Favor informar a senha." / "SENHA INCORRETA, VERIFIQUE!" (uSenhaAdmin.pas) — a senha administrativa da empresa
    const { ok } = await this.senhaOp.verificar('admin', dto.senhaAdm);
    if (!ok) throw new BusinessRuleError('SENHA_ADMINISTRATIVA_INVALIDA');
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const { idempresa } = await this.conta(trx, dto.codconta, 'habiltiar_lanca_saldo');
      // "Modalidade não encontrada!" — a forma da loja
      const f = (await sql<{ idpgto: number }>`SELECT idpgto FROM formas_pgto WHERE idpgto = ${dto.idpgto} AND idempresa = ${emp}`.execute(trx)).rows[0];
      if (!f) throw new BusinessRuleError('MODALIDADE_NAO_ENCONTRADA', { idpgto: dto.idpgto });
      const data = dto.data ? dto.data.slice(0, 10) : hoje();
      const c = await this.contaCompleta(trx, dto.codconta, null);
      if (c.dtchaveamento && data <= c.dtchaveamento) throw new BusinessRuleError('CONTA_CAIXA_FECHADA', { codconta: dto.codconta, ate: c.dtchaveamento });
      const valor = r2(num(dto.valor));
      const tipo = valor > 0 ? 'C' : 'D';
      const quando = sql`(${data}::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'`;
      const ins = (await trx.insertInto('mov_contas_bancarias').values({
        codconta: dto.codconta, idempresa, valor: Math.abs(valor), tipomovimento: tipo, codopconta: 0, idpgto: dto.idpgto,
        historico: (dto.historico?.trim() || 'SALDO INICIAL').slice(0, 300), codoperador: op, liberado: 'S',
        dtemissao: quando, dtvenc: quando, dtliberacao: quando, lancamento_saldo: 'S', usucad_lancamento_saldo: op, dtcadastro: sql`now()`,
      }).returning('codmovconta').executeTakeFirstOrThrow()) as { codmovconta: number };
      return { codmovconta: Number(ins.codmovconta), tipomovimento: tipo, saldo: await this.saldoDe(trx, dto.codconta, emp) };
    });
  }

  /**
   * "Chavear Fech. Caixa" (`BitBtn2`, uControleContasBancarias.pas:117-135): a data vira `DTCHAVEAMENTO` da conta e o operador
   * `CODOPERADORCHAVEAMENTO` — sem senha, confirmação nem validação de data, como o legado. Depois disso o lançamento de saldo,
   * as baixas e a transferência recusam data até ela ("Caixa FECHADO não é permitida alteração dos documentos!").
   */
  async chavear(codconta: number, data: string): Promise<{ codconta: number; dtchaveamento: string; operador: string | null }> {
    this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.conta(trx, codconta, 'habiltiar_chavear_fec_cxa');
      await sql`UPDATE contas_bancarias SET dtchaveamento = ${data.slice(0, 10)}::date, codoperadorchaveamento = ${op} WHERE codconta = ${codconta}`.execute(trx);
      const nome = op == null ? null : String(((await trx.selectFrom('operadores').select('nome').where('codoperador', '=', op).executeTakeFirst()) as { nome?: string } | undefined)?.nome ?? '');
      return { codconta, dtchaveamento: data.slice(0, 10), operador: nome };
    });
  }

  /** as modalidades da loja para o lançamento de saldo (`GET_FORMAS_PGTO` da empresa) */
  async modalidades(): Promise<Record<string, unknown>[]> {
    const emp = this.emp();
    return (await sql<Record<string, unknown>>`SELECT idpgto, modalidade FROM formas_pgto WHERE idempresa = ${emp} ORDER BY modalidade`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
  }

  /**
   * TRANSFERÊNCIA — `TfrmTransferencia.btnFechaClick` + `Transfere` (`Utransferencia.pas:118-330`). Duas movimentações
   * com o MESMO lote (`GetID('IDLOTE')`), `NRODOCUMENTO='TRANSFERENCIA'`, emissão/vencimento/liberação na data,
   * LIBERADO 'S', operação 0, a modalidade de cada lado (`IDPGTO`). É pelo NRODOCUMENTO + lote que a integração
   * contábil (origem 19) e a remoção reconhecem a transferência.
   *
   * A conta de ORIGEM é da loja (`btnBuscaCCClick`: `IDEMPRESA = empresa`); a de DESTINO é qualquer conta
   * (`SpeedButton1Click` sem filtro) — 477 dos lotes de 2025-26 foram para conta de outra loja. Cada perna fica na
   * empresa da sua conta, como a carga faz com o dado migrado.
   *
   * O histórico segue o que o binário novo grava (o fonte de 2020 dizia ORIGEM na perna de crédito; o dado de
   * produção diz DESTINO nas duas, 475 de 476): `TRANSF. CONTA DESTINO: <nº da outra conta>` + o complemento +
   * `\r\n Lote: N` + `\r\nRealizada pelo(a) usuário(a) NOME.`. O CODOPERADOR fica nulo, como no legado.
   */
  async transferir(dto: { codorigem: number; coddestino: number; valor: number; historico?: string; data?: string; idpgtoOrigem?: number; idpgtoDestino?: number }): Promise<{ idlote: number; debito: number; credito: number; contabilizada: boolean }> {
    const emp = this.emp();
    const op = this.op();
    // "A conta de destino deve ser diferente da conta de origem." (`Utransferencia.pas:151`)
    if (dto.codorigem === dto.coddestino) throw new BusinessRuleError('TRANSFERENCIA_MESMA_CONTA', { conta: dto.codorigem });
    const res = await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // a origem é a conta selecionada na lista (`uControleContasBancarias.pas:137-154`), com a permissão de transferir
      await this.conta(trx, dto.codorigem, 'habilitar_tranfer');
      const orig = await this.contaCompleta(trx, dto.codorigem, null);
      const dest = await this.contaCompleta(trx, dto.coddestino, null);
      const ctx = { empresaId: emp, operadorId: op, modulo: 'Retaguarda' };
      // a matriz de transferências permitidas (mig 295): origem com linhas ativas só vai para os destinos listados — ligada por
      // INFORMAR_CONTAS_TRANSFERENCIA_BANCARIA (binário novo; 'S' no módulo Retaguarda da produção). Só o 'N' explícito a desliga.
      const informarContas = String((await configNaTrx(trx, 'INFORMAR_CONTAS_TRANSFERENCIA_BANCARIA', ctx)) ?? 'S').toUpperCase();
      const permitidos = informarContas === 'N' ? null : await destinosPermitidos(trx, dto.codorigem);
      if (permitidos && !permitidos.includes(dto.coddestino)) {
        throw new BusinessRuleError('TRANSFERENCIA_NAO_PERMITIDA', { origem: dto.codorigem, destino: dto.coddestino, permitidos });
      }
      // NAO_PERMITIDO_ALTERAR_DATA_TRANSF_MOV_CONTAS_BANCARIAS (por usuário) desabilita a data: vale o dia
      const travaData = await configNaTrx(trx, 'NAO_PERMITIDO_ALTERAR_DATA_TRANSF_MOV_CONTAS_BANCARIAS', ctx);
      const data = travaData === 'S' || !dto.data ? hoje() : dto.data.slice(0, 10);
      // a janela de datas do binário novo: DIAS_RETROATIVOS_TRANSF_CONTAS_CORRENTES (90 na produção) e DIAS_FUTUROS_… (30) —
      // nenhuma transferência de 2025-26 saiu dela (0 com mais de 90 dias para trás, 0 com mais de 30 para frente)
      const retro = num(await configNaTrx(trx, 'DIAS_RETROATIVOS_TRANSF_CONTAS_CORRENTES', ctx));
      const futuro = num(await configNaTrx(trx, 'DIAS_FUTUROS_TRANSF_CONTAS_CORRENTES', ctx));
      const dias = Math.round((Date.parse(data) - Date.parse(hoje())) / 86_400_000);
      if (retro > 0 && -dias > retro) throw new BusinessRuleError('TRANSFERENCIA_DATA_RETROATIVA', { data, dias: retro });
      if (futuro > 0 && dias > futuro) throw new BusinessRuleError('TRANSFERENCIA_DATA_FUTURA', { data, dias: futuro });
      // "Caixa FECHADO não é permitida alteração dos documentos!" — o chaveamento de cada conta (`:156-183`)
      for (const c of [orig, dest]) {
        if (c.dtchaveamento && data <= c.dtchaveamento) throw new BusinessRuleError('CONTA_CAIXA_FECHADA', { codconta: c.codconta, ate: c.dtchaveamento });
      }
      const valor = r2(num(dto.valor));
      // "Saldo insuficiente!" — só com a origem em conta caixa (`:185-190`)
      if (orig.codbco === 0) {
        const saldo = await this.saldoDe(trx, dto.codorigem, emp);
        if (r2(saldo - valor) < 0) throw new BusinessRuleError('SALDO_INSUFICIENTE', { codconta: dto.codorigem, saldo, valor });
      }
      const idpgtoOrigem = dto.idpgtoOrigem ?? (await this.idpgtoDinheiro(trx, emp));
      const idpgtoDestino = dto.idpgtoDestino ?? idpgtoOrigem;
      const lote = await novoLoteTransferencia(trx);
      const nome = op == null ? '' : String((await trx.selectFrom('operadores').select('nome').where('codoperador', '=', op).executeTakeFirst() as { nome?: string } | undefined)?.nome ?? '');
      const complemento = (dto.historico ?? '').trim();
      const historico = (outra: string | null) =>
        `TRANSF. CONTA DESTINO: ${outra ?? ''}${complemento ? ' ' + complemento : ''}\r\n Lote: ${lote}\r\nRealizada pelo(a) usuário(a) ${nome}.`.slice(0, 300);
      const perna = (c: ContaCompleta, tipo: 'D' | 'C', outra: ContaCompleta, idpgto: number | null) => ({
        codconta: c.codconta, idempresa: c.idempresa, valor, tipomovimento: tipo, codopconta: 0, idpgto,
        nrodocumento: 'TRANSFERENCIA', idlote: lote, historico: historico(outra.nroconta),
        dtemissao: data, dtvenc: data, liberado: 'S', dtliberacao: data, dtcadastro: sql`now()`,
      });
      const deb = (await trx.insertInto('mov_contas_bancarias').values(perna(orig, 'D', dest, idpgtoOrigem)).returning('codmovconta').executeTakeFirstOrThrow()) as { codmovconta: number };
      const cre = (await trx.insertInto('mov_contas_bancarias').values(perna(dest, 'C', orig, idpgtoDestino)).returning('codmovconta').executeTakeFirstOrThrow()) as { codmovconta: number };
      return { idlote: lote, debito: Number(deb.codmovconta), credito: Number(cre.codmovconta) };
    });
    // com a integração AUTOMÁTICA, contabiliza o lote depois de gravar — e o erro não desfaz a transferência
    // (`IntegraTransferencia`, `:258` e `:476-488`, dentro de try/except vazio)
    const contabilizada = await this.integrarTransferencia(emp, res.idlote);
    return { ...res, contabilizada };
  }

  /**
   * REMOVER — dois caminhos do legado, pela linha escolhida:
   * - transferência (`NRODOCUMENTO='TRANSFERENCIA'`, `Removertransferencia1Click`, `UconsMovBancaria.pas:925-966`): se
   *   contabilizada, com a integração AUTOMÁTICA estorna o razão do lote e segue; sem ela, "A transferência já foi
   *   contabilizada.". Apaga TODAS as movimentações do lote (`DELETE ... WHERE IDLOTE`), inclusive a perna na conta
   *   de outra loja. Não olha conciliação.
   * - qualquer outra (`TfrmCadMovContasBancarias.btnExcluirClick`, `uCadMovContasBancarias.pas:107-111`): só barra a que
   *   tem lote ("Esse documento não pode ser excluido, pois contém referencia de Lote. Verifique!").
   */
  async estornar(codmovconta: number): Promise<{ codmovconta: number; removidos: number; transferencia: boolean }> {
    const emp = this.emp();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const m = (await trx.selectFrom('mov_contas_bancarias').select(['codmovconta', 'codconta', 'nrodocumento', 'idlote', 'contabilizado']).where('codmovconta', '=', codmovconta).forUpdate().executeTakeFirst()) as { codconta?: number; nrodocumento?: string | null; idlote?: number | null; contabilizado?: string | null } | undefined;
      if (!m) throw new BusinessRuleError('MOVIMENTO_NAO_ENCONTRADO', { codmovconta });
      // a movimentação é de uma conta da lista do operador (o detalhamento abre a partir dela)
      await this.conta(trx, Number(m.codconta), 'habiltiar_detalhar_conta');
      const idlote = num(m.idlote);
      if (String(m.nrodocumento ?? '') === 'TRANSFERENCIA' && idlote > 0) {
        await trx.selectFrom('mov_contas_bancarias').select('codmovconta').where('idlote', '=', idlote).forUpdate().execute();
        if (String(m.contabilizado ?? '') === 'S') {
          const e = (await trx.selectFrom('empresas').select('integracao').where('idempresa', '=', emp).executeTakeFirst()) as { integracao?: string | null } | undefined;
          if (String(e?.integracao ?? '') !== 'AUTOMATICA') throw new BusinessRuleError('TRANSFERENCIA_CONTABILIZADA', { idlote });
          await estornarTransferenciaLote(trx, idlote);
        }
        const res = await trx.deleteFrom('mov_contas_bancarias').where('idlote', '=', idlote).executeTakeFirst();
        return { codmovconta, removidos: Number((res as any)?.numDeletedRows ?? 0), transferencia: true };
      }
      if (idlote > 0) throw new BusinessRuleError('MOVIMENTO_COM_LOTE', { codmovconta, idlote });
      const res = await trx.deleteFrom('mov_contas_bancarias').where('codmovconta', '=', codmovconta).executeTakeFirst();
      return { codmovconta, removidos: Number((res as any)?.numDeletedRows ?? 0), transferencia: false };
    });
  }

  /** a conta com o que a transferência usa; `emp` nulo = qualquer loja (o destino) */
  private async contaCompleta(db: AnyDB, codconta: number, emp: number | null): Promise<ContaCompleta> {
    let q = db.selectFrom('contas_bancarias').select(['codconta', 'codbco', 'idempresa', 'nroconta', sql<string | null>`to_char(dtchaveamento, 'YYYY-MM-DD')`.as('dtchaveamento')]).where('codconta', '=', codconta);
    if (emp != null) q = q.where('idempresa', '=', emp);
    const c = (await q.executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!c) throw new BusinessRuleError('CONTA_NAO_ENCONTRADA', { codconta });
    return {
      codconta, idempresa: Number(c.idempresa), nroconta: c.nroconta == null ? null : String(c.nroconta).trim(),
      codbco: c.codbco == null ? -1 : Number(c.codbco), dtchaveamento: c.dtchaveamento == null ? null : String(c.dtchaveamento),
    };
  }

  /** a forma DINHEIRO da loja — o que o legado posiciona antes de gravar (`cdsFormaPto.Locate('MODALIDADE','DINHEIRO')`) */
  private async idpgtoDinheiro(db: AnyDB, emp: number): Promise<number | null> {
    const f = (await sql<{ idpgto: number }>`SELECT idpgto FROM formas_pgto WHERE upper(modalidade) = 'DINHEIRO'
                ORDER BY (idempresa = ${emp}) DESC NULLS LAST, idpgto LIMIT 1`.execute(db)).rows[0];
    return f ? Number(f.idpgto) : null;
  }

  private async integrarTransferencia(emp: number, idlote: number): Promise<boolean> {
    const db = this.dbp.forTenant() as AnyDB;
    try {
      const e = (await db.selectFrom('empresas').select('integracao').where('idempresa', '=', emp).executeTakeFirst()) as { integracao?: string | null } | undefined;
      if (String(e?.integracao ?? '') !== 'AUTOMATICA') return false;
      return await db.transaction().execute(async (trx: AnyDB) => {
        const cfg = (await trx.selectFrom('config_integracao_contabil').selectAll().executeTakeFirst()) as Record<string, number | null> | undefined;
        if (!cfg) return false;
        const r = await integrarTransferencias(trx, emp, { dataIni: '1900-01-01', dataFim: '2999-12-31', codigo: idlote }, cfg);
        return r.lancamentos > 0;
      });
    } catch {
      return false;
    }
  }
}
