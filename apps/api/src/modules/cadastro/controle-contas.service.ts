import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { destinosPermitidos } from './contas-transf-perm.service';
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
 * `saldo`/`extrato`: Σ com sinal (C:+ / D:−) do LIBERADO da conta, pela data de EMISSÃO. `lancar`: 1 linha (operação
 * C/D → tipomovimento, VALOR magnitude). `transferir`: as 2 pernas do legado (lote + NRODOCUMENTO 'TRANSFERENCIA'),
 * destino em qualquer loja. `estornar`: a remoção de transferência (o lote inteiro) ou a exclusão da movimentação
 * sem lote, como as duas telas do legado. Saldo-negativo travado só na transferência a partir de conta CAIXA.
 */
@Injectable()
export class ControleContasService {
  constructor(private readonly dbp: DatabaseProvider) {}

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

  /** operações manuais disponíveis (catálogo C/D, exclui a 0=TRANSFERENCIA interna). */
  async operacoes(): Promise<Array<{ codopconta: number; descricao: string; tipo: string }>> {
    return (await (this.dbp.forTenantRead() as AnyDB).selectFrom('operacoes_conta').select(['codopconta', 'descricao', 'tipo']).where('codopconta', '>', 0).orderBy('descricao').execute()) as Array<{ codopconta: number; descricao: string; tipo: string }>;
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

  /** lançamento MANUAL (1 linha). A operação define o tipomovimento (C/D); VALOR gravado como magnitude. Sem teste de
   *  saldo: o lançamento do legado chama `ValidaSaldoAnterior(..., VerifSaldo=False)` (`UlancamentoSaldo.pas:54`) e o
   *  cadastro de movimentação não testa (`uCadMovContasBancarias.pas:115-131`). Com operação, LIBERADO 'S' na data. */
  async lancar(dto: { codconta: number; codopconta: number; valor: number; historico?: string; idpgto?: number; data?: string }): Promise<{ codmovconta: number; tipomovimento: string; saldo: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const { idempresa } = await this.conta(trx, dto.codconta, 'habiltiar_lanca_saldo');
      const oc = (await trx.selectFrom('operacoes_conta').select(['codopconta', 'tipo']).where('codopconta', '=', dto.codopconta).where('codopconta', '>', 0).executeTakeFirst()) as { tipo?: string } | undefined;
      if (!oc) throw new BusinessRuleError('OPERACAO_NAO_ENCONTRADA', { codopconta: dto.codopconta });
      const tipo = String(oc.tipo) === 'D' ? 'D' : 'C';
      const valor = r2(num(dto.valor));
      const data = dto.data ? dto.data.slice(0, 10) : hoje();
      const ins = (await trx.insertInto('mov_contas_bancarias').values({
        codconta: dto.codconta, idempresa, valor, tipomovimento: tipo, codopconta: dto.codopconta, origem: null, idorigem: null,
        // a modalidade do lançamento (`IDPGTO`, localizada pelo nome, udmPrincipal.pas:2140-2183); sem ela, a DINHEIRO da loja —
        // o painel do legado só soma movimento com forma (INNER JOIN FORMAS_PGTO)
        historico: dto.historico ?? null, idpgto: dto.idpgto ?? (await this.idpgtoDinheiro(trx, emp)), codoperador: op, dtcadastro: sql`now()`,
        dtemissao: data, dtvenc: data, liberado: 'S', dtliberacao: data,
      }).returning('codmovconta').executeTakeFirstOrThrow()) as { codmovconta: number };
      return { codmovconta: Number(ins.codmovconta), tipomovimento: tipo, saldo: await this.saldoDe(trx, dto.codconta, emp) };
    });
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
      // a matriz de transferências permitidas (mig 295): origem com linhas ativas só vai para os destinos listados
      const permitidos = await destinosPermitidos(trx, dto.codorigem);
      if (permitidos && !permitidos.includes(dto.coddestino)) {
        throw new BusinessRuleError('TRANSFERENCIA_NAO_PERMITIDA', { origem: dto.codorigem, destino: dto.coddestino, permitidos });
      }
      // NAO_PERMITIDO_ALTERAR_DATA_TRANSF_MOV_CONTAS_BANCARIAS (por usuário) desabilita a data: vale o dia
      const travaData = await configNaTrx(trx, 'NAO_PERMITIDO_ALTERAR_DATA_TRANSF_MOV_CONTAS_BANCARIAS', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' });
      const data = travaData === 'S' || !dto.data ? hoje() : dto.data.slice(0, 10);
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
