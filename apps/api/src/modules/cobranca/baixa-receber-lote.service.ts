import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { BaixaReceberGravarDto, BaixaReceberTitulosDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { assertPeriodoNaoFechado } from '../shared/periodo-contabil';
import { configNaTrx } from '../compras/pedido-heranca';
import { ConfigService } from '../cadastro/config.service';
import { SenhaOperacaoService } from '../cadastro/senha-operacao.service';
import { LiberacaoService } from '../auth/liberacao.service';
import { AdiantamentoFornService } from './adiantamento-forn.service';
import { BaixaTronContabilService } from './baixa-tron-contabil.service';
import { estornarCaixaDaBaixa, lancarCaixaDaBaixaLote, type CentrosBaixa } from './baixa-caixa';
import { lerRetornoCnab } from './cnab-remessa.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;

/**
 * Os tipos de recurso do combo (`cbbTpRecurso`, UBaixaAreceber.dfm:982-1017) que a produção usa (§3 da spec): o texto vai
 * para `MOV_CONTAS_BANCARIAS.RECURSO` (binário novo). CARTAO grava a forma escolhida (PIX POS, IFOOD…) com LIBERADO 'N' e
 * sem linha em CARTAO — como o dado vivo desde abr/2024. Cheque, cheque pré, permuta e SALDO ficam fora (0 uso em 2025-26).
 */
export const RECURSOS_BAIXA_RECEBER: Record<number, { rotulo: string; modalidade: string; destino: string; liberado: 'S' | 'N'; caixa: boolean; banco: boolean }> = {
  0: { rotulo: '1 - DINHEIRO', modalidade: 'DINHEIRO', destino: 'CXA', liberado: 'S', caixa: true, banco: true },
  2: { rotulo: '3 - DOC', modalidade: 'DINHEIRO', destino: 'CXA', liberado: 'S', caixa: false, banco: true },
  3: { rotulo: '4 - TRANSFERÊNCIA BANCÁRIA', modalidade: 'DINHEIRO', destino: 'CXA', liberado: 'N', caixa: false, banco: true },
  4: { rotulo: '5 - DÉBITO EM CONTA', modalidade: 'DINHEIRO', destino: 'CXA', liberado: 'N', caixa: false, banco: true },
  6: { rotulo: '7 - ANTECIPAÇÃO BANCÁRIA', modalidade: 'DINHEIRO', destino: 'CXA', liberado: 'S', caixa: false, banco: true },
  7: { rotulo: '8 - CARTAO', modalidade: 'CARTAO', destino: 'CRT', liberado: 'N', caixa: true, banco: true },
};

interface DocLote {
  codrcb: number; codempresa: number; codparceiro: number | null; valor: number; txjuros: number; juros: number; acreDesc: number;
  total: number; codadiantamento: number | null; dtvenda: string | null; docnf: string | null; valorPercMulta: unknown; ordem: number;
}

/**
 * BAIXA DE CONTAS A RECEBER — a tela do legado (`FRMBAIXAARECEBER`, `UBaixaAreceber.pas`), no modelo dela: um LOTE com N
 * documentos e 1..N recursos em contas correntes. Especificação: `uBaixaAreceber-spec.md` (958 lotes em 2025-26, todos com
 * MOV_CONTAS_BANCARIAS — sem ela o contábil do legado recusa o lote).
 *
 * Numa transação (`btnGravarClick`, :1543-1803): MCB por recurso (C, valor positivo, operação 0, RECURSO, o histórico com o
 * sufixo do operador), ARECEBER_BX por documento com o pago distribuído do menor para o maior total, `QUITADA`/`ANTECIPADO`,
 * adiantamento, a cascata do agrupamento, o título-saldo da parcial (DENTRO da transação — o legado o grava antes, `:1466`) e
 * a CAIXA de juros/acréscimo/desconto. Depois do commit, com a integração AUTOMÁTICA, o contábil do lote.
 */
@Injectable()
export class BaixaReceberLoteService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly tron: BaixaTronContabilService,
    private readonly config: ConfigService,
    private readonly senhaOp: SenhaOperacaoService,
    private readonly liberacao: LiberacaoService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op(): number | null {
    return currentTenant().operadorId ?? null;
  }
  private async empresasPermitidas(db: AnyDB, emp: number, op: number | null): Promise<number[]> {
    const rel = op == null ? [] : ((await db.selectFrom('relacao_operador_empresa').select('codempresa').where('codoperador', '=', op).execute()) as Array<{ codempresa: number }>).map((r) => Number(r.codempresa));
    return [...new Set([emp, ...rel])];
  }

  /** o lote alocado no "Iniciar baixa" (`IdLoteBaixa := GetID('IDLOTE')`, :976) */
  async iniciar(): Promise<{ idlote: number }> {
    this.emp();
    const r = (await sql<{ id: string }>`SELECT nextval('seq_idlote') AS id`.execute(this.dbp.forTenant() as AnyDB)).rows[0];
    return { idlote: Number(r.id) };
  }

  /**
   * A pesquisa (`GET_RCB`, :891-896): abertos, não agrupados, das empresas escolhidas e — com `EMPRESAS.FECHAMENTO_CAIXA='S'` —
   * só os conciliados. O desconto do cliente por prazo (`DIASPRAZO`/`DESCPADRAO`, :949-956) vem calculado para a data dada.
   */
  async titulos(f: BaixaReceberTitulosDto): Promise<Record<string, unknown>[]> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const permitidas = await this.empresasPermitidas(db, emp, this.op());
    const empresas = (f.empresas?.length ? f.empresas : [emp]).filter((e) => permitidas.includes(e));
    if (!empresas.length) throw new BusinessRuleError('EMPRESA_FORA_DO_ESCOPO', { empresas: f.empresas });
    const fech = (await sql<{ f: string | null }>`SELECT fechamento_caixa AS f FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0];
    const soConciliados = String(fech?.f ?? '') === 'S';
    const data = (f.dtpgto ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })).slice(0, 10);
    const rows = (await sql<Record<string, unknown>>`
      SELECT r.codrcb, r.duplicata, p.razao AS cliente, r.codparceiro, r.codempresa, r.valor, coalesce(r.txjuros, 0) AS txjuros,
             to_char(r.dtvenda AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS emissao, to_char(r.dtvenc AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS vencimento, r.nroped, r.docnf,
             CASE WHEN coalesce(p.diasprazo, 0) > 0 AND coalesce(p.descpadrao, 0) > 0 AND (r.dtvenda AT TIME ZONE 'America/Sao_Paulo')::date + p.diasprazo::int >= ${data}::date
                  THEN round(r.valor * p.descpadrao / 100, 2) ELSE 0 END AS desconto_cliente
        FROM areceber r
        LEFT JOIN parceiros p ON p.codparceiro = r.codparceiro
       WHERE r.quitada = 'N' AND coalesce(r.agrupado, 'N') = 'N'
         AND r.codempresa = ANY(${empresas}::int[])
         AND (${soConciliados} = false OR r.consiliado = 'S')
         AND (${f.codparceiro ?? null}::int IS NULL OR r.codparceiro = ${f.codparceiro ?? null}::int)
         AND (${f.vencDe ?? null}::date IS NULL OR r.dtvenc >= ${f.vencDe ?? null}::date)
         AND (${f.vencAte ?? null}::date IS NULL OR r.dtvenc <= ${f.vencAte ?? null}::date)
         AND (${f.busca ?? null}::text IS NULL OR r.duplicata ILIKE '%' || ${f.busca ?? null}::text || '%' OR p.razao ILIKE '%' || ${f.busca ?? null}::text || '%')
       ORDER BY r.dtvenc, p.razao, r.codrcb
       LIMIT 2000
    `.execute(db)).rows;
    return rows.map((t) => ({ ...t, codrcb: Number(t.codrcb), valor: r2(num(t.valor)), txjuros: num(t.txjuros), desconto_cliente: r2(num(t.desconto_cliente)), vencido: String(t.vencimento ?? '') < data }));
  }

  /**
   * ARQUIVO RETORNO (`ProcessarArquivoRetorno`, :2596-2775) — 410 lotes e 80% do valor recebido em 2025-26 (conta 182, Itaú 400,
   * arquivos `CN*.RET`). Não grava: devolve os documentos para a grade — nosso número → CODRCB (últimos 9 dígitos), só os não
   * quitados, o acréscimo/desconto = recebido − documento, a data da baixa = a do arquivo. O legado não filtra empresa na busca
   * (`WHERE G.CODIGO IN (…)`); aqui, as empresas do operador.
   */
  async retorno(dto: { arquivo: string; nome?: string }): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const { banco, dataArquivo, boletos } = lerRetornoCnab(dto.arquivo);
    const permitidas = await this.empresasPermitidas(db, emp, this.op());
    const codrcbs = Array.from(new Set(boletos.map((b) => Number(b.nosso_numero.slice(-9)) || 0).filter((n) => n > 0)));
    const rows = (await sql<Record<string, unknown>>`
      SELECT r.codrcb, r.duplicata, p.razao AS cliente, r.codparceiro, r.codempresa, r.valor, coalesce(r.txjuros, 0) AS txjuros,
             to_char(r.dtvenda AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS emissao, to_char(r.dtvenc AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS vencimento, r.nroped
        FROM areceber r LEFT JOIN parceiros p ON p.codparceiro = r.codparceiro
       WHERE r.codrcb = ANY(${codrcbs.length ? codrcbs : [0]}::int[]) AND coalesce(r.quitada, 'N') <> 'S' AND r.codempresa = ANY(${permitidas}::int[])
       ORDER BY r.codrcb`.execute(db)).rows;
    // "Os boletos não foram encontrados no sistema ou já foram baixados." (:2710-2711)
    if (!rows.length) throw new BusinessRuleError('RETORNO_TITULOS_NAO_ENCONTRADOS', { codrcbs });
    const porCod = new Map<number, (typeof boletos)[number]>();
    for (const b of boletos) porCod.set(Number(b.nosso_numero.slice(-9)) || 0, b);
    const documentos = rows.map((t) => {
      const b = porCod.get(Number(t.codrcb))!;
      return {
        ...t, codrcb: Number(t.codrcb), valor: r2(num(t.valor)), txjuros: num(t.txjuros), desconto_cliente: 0,
        // :2724-2730 — a diferença entre o recebido e o documento vira acréscimo/desconto do documento
        acre_desc: r2(b.valor_recebido - b.valor_documento), valor_recebido: b.valor_recebido,
      };
    });
    const achados = new Set(documentos.map((d) => d.codrcb));
    return {
      banco, dtpgto: dataArquivo, nomeArquivo: dto.nome ?? null, documentos,
      naoEncontrados: boletos.filter((b) => !achados.has(Number(b.nosso_numero.slice(-9)) || 0)).map((b) => ({ nosso_numero: b.nosso_numero, valor_recebido: b.valor_recebido })),
    };
  }

  /** as contas do operador (F3: `ATIVO<>'N'` com linha em CONTAS_BANCARIAS_OP, :1016-1026) e as formas de cartão da loja */
  async contas(): Promise<{ contas: Record<string, unknown>[]; formasCartao: Record<string, unknown>[] }> {
    const emp = this.emp();
    const op = this.op();
    const db = this.dbp.forTenantRead() as AnyDB;
    const contas = (await sql<Record<string, unknown>>`
      SELECT c.codconta, c.nroconta, c.titular, c.codbco, c.idempresa, coalesce(o.cbo_baixa_cr, 'S') AS cbo_baixa_cr, coalesce(c.conta_propria, 'N') AS conta_propria
        FROM contas_bancarias c
        JOIN contas_bancarias_op o ON o.codconta = c.codconta AND o.codoperador = ${op}
       WHERE coalesce(c.ativo, 'S') <> 'N'
       ORDER BY c.titular, c.codconta`.execute(db)).rows;
    const formasCartao = (await sql<Record<string, unknown>>`
      SELECT idpgto, modalidade, destino FROM formas_pgto WHERE idempresa = ${emp} AND destino IN ('CRT', 'TEF') ORDER BY modalidade`.execute(db)).rows;
    return {
      contas: contas.map((c) => ({ ...c, codconta: Number(c.codconta), caixa: Number(c.codbco) === 0 })),
      formasCartao: formasCartao.map((f) => ({ ...f, idpgto: Number(f.idpgto) })),
    };
  }

  /** os CCs padrão (`SetCentroCustoPadrao`, :2777-2809), as configs e os tipos de recurso */
  async padroes(): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const e = (await sql<Record<string, unknown>>`SELECT codplc_juros_recebidos, codplc_acrescimos_recebidos, codplc_descontos_concedidos FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0] ?? {};
    const ctx = { empresaId: emp, operadorId: this.op(), modulo: 'Retaguarda' };
    return {
      ccJuros: e.codplc_juros_recebidos == null ? null : Number(e.codplc_juros_recebidos),
      ccAcrescimo: e.codplc_acrescimos_recebidos == null ? null : Number(e.codplc_acrescimos_recebidos),
      ccDesconto: e.codplc_descontos_concedidos == null ? null : Number(e.codplc_descontos_concedidos),
      diasFutura: num(await configNaTrx(db, 'QTDE_DIAS_BX_RCB_FUTURA', ctx)),
      mostrarTroco: String((await configNaTrx(db, 'MOSTRAR_TROCO_BAIXA_CR', ctx)) ?? 'N').toUpperCase() === 'S',
      recursos: Object.entries(RECURSOS_BAIXA_RECEBER).map(([tipo, r]) => ({ tipo: Number(tipo), rotulo: r.rotulo, liberado: r.liberado, caixa: r.caixa, banco: r.banco })),
      empresas: await this.empresasPermitidas(db, emp, this.op()),
    };
  }

  async gravar(dto: BaixaReceberGravarDto): Promise<{ idlote: number; documentos: number; valorPago: number; parcial: boolean; codrcbSaldo: number | null; contabilizado: boolean }> {
    const emp = this.emp();
    const op = this.op();
    const dtpgto = dto.dtpgto.slice(0, 10);
    const db = this.dbp.forTenant() as AnyDB;
    await this.assertPeriodo(db, emp, dtpgto);
    // a senha DESC só vale para o campo GLOBAL de acréscimo/desconto (`edtDesc_AcreExit`, :675-699); os campos por documento
    // não pedem senha
    const global = r2(num(dto.acreDescGlobal));
    if (global !== 0) {
      if (!dto.senhaDesconto) throw new BusinessRuleError('SENHA_OPERACAO_REQUERIDA', { tipo: 'desc' });
      const { ok } = await this.senhaOp.verificar('desc', dto.senhaDesconto);
      if (!ok) throw new BusinessRuleError('SENHA_OPERACAO_INVALIDA', { tipo: 'desc' });
    }

    const res = await db.transaction().execute(async (trx: AnyDB) => {
      const usado = (await sql<{ n: number }>`SELECT (SELECT count(*) FROM areceber_bx WHERE idlote = ${dto.idlote}) + (SELECT count(*) FROM mov_contas_bancarias WHERE idlote = ${dto.idlote}) AS n`.execute(trx)).rows[0];
      if (num(usado?.n) > 0) throw new BusinessRuleError('BAIXA_LOTE_EM_USO', { idlote: dto.idlote });
      const ultimo = (await sql<{ v: string }>`SELECT last_value AS v FROM seq_idlote`.execute(trx)).rows[0];
      if (dto.idlote <= 0 || dto.idlote > num(ultimo?.v)) throw new BusinessRuleError('BAIXA_LOTE_INVALIDO', { idlote: dto.idlote });

      if (dto.loteManutencao) await this.reverterLoteNaTrx(trx, emp, op, dto.loteManutencao);

      const docs = await this.carregarDocumentos(trx, emp, op, dto, dtpgto, global);
      // "O valor da conta deve ser maior que zero." (:1343-1353)
      const zerado = docs.find((d) => d.total <= 0);
      if (zerado) throw new BusinessRuleError('BAIXA_VALOR_CONTA_ZERO', { codrcb: zerado.codrcb });
      const totalDocs = r2(docs.reduce((s, d) => s + d.total, 0));

      // a liberação do desconto máximo (`DescontoValidado`, :420-492) — sem o vazamento do liberador entre lotes do legado
      const liberador = await this.descontoValidado(trx, emp, op, docs, totalDocs, dto);

      const somaJuros = r2(docs.reduce((s, d) => s + d.juros, 0));
      const somaAcre = r2(docs.reduce((s, d) => s + (d.acreDesc > 0 ? d.acreDesc : 0), 0));
      const somaDesc = r2(docs.reduce((s, d) => s + (d.acreDesc < 0 ? -d.acreDesc : 0), 0));
      const cc = await this.centros(trx, emp, dto, somaJuros, somaAcre, somaDesc);

      const recursos = await this.validarRecursos(trx, emp, op, dto, dtpgto, totalDocs);
      const totalRecursos = r2(recursos.reduce((s, r) => s + r.valor, 0));
      const parcial = totalRecursos < totalDocs;
      if (parcial && !dto.parcial) throw new BusinessRuleError('BAIXA_TOTAL_NAO_CONFERE', { totalDocumentos: totalDocs, totalRecursos });
      if (parcial && new Set(docs.map((d) => d.codparceiro)).size > 1) throw new BusinessRuleError('BAIXA_PARCIAL_CLIENTES');

      // os recursos (`SetOperadorObs`, :2822-2844) e o INSERT da movimentação (:1572-1573)
      const nome = op == null ? '' : String(((await trx.selectFrom('operadores').select('nome').where('codoperador', '=', op).executeTakeFirst()) as { nome?: string } | undefined)?.nome ?? '');
      let historicoCorrente = '';
      for (const r of recursos) {
        const texto = (r.historico ?? `BAIXA DO LOTE ${dto.idlote}`).trim();
        const historico = `${texto ? texto + ' - ' : ''}Baixa das contas a receber realizada pelo(a) usuário(a) ${nome}.`.slice(0, 300);
        historicoCorrente = historico;
        await trx.insertInto('mov_contas_bancarias').values({
          codconta: r.codconta, idempresa: r.idempresa, valor: r.valor, tipomovimento: 'C', codopconta: 0, idpgto: r.idpgto,
          historico, idlote: dto.idlote, dtemissao: dtpgto, dtvenc: dtpgto, liberado: r.liberado,
          dtliberacao: r.liberado === 'S' ? (r.contaPropria ? sql`now()` : dtpgto) : null, recurso: RECURSOS_BAIXA_RECEBER[r.tipo].rotulo,
          dtcadastro: sql`now()`,
        }).execute();
      }

      // ARECEBER_BX em ordem crescente de total, com o pago corrido (:1595, :1709-1750)
      let baixado = totalRecursos;
      const ordem = [...docs].sort((a, b) => a.total - b.total || a.ordem - b.ordem);
      const obs = `DOCUMENTO BAIXADO NO LOTE: ${dto.idlote} - ${historicoCorrente.trim()}`.slice(0, 300);
      for (const d of ordem) {
        baixado = r2(baixado - d.total);
        const valorpg = baixado > 0 ? d.total : Math.max(r2(d.total + baixado), 0);
        await trx.insertInto('areceber_bx').values({
          codrcb: d.codrcb, codempresa: d.codempresa, valorpg, dtpgto, obs, acre_desc: d.acreDesc, juros: d.juros,
          tx_juros: d.juros > 0 ? d.txjuros : null, codopbx: op, idlote: dto.idlote, codoperador_liberacao_desconto: liberador,
          codplc_acredesc: d.acreDesc > 0 ? cc.acrescimo : d.acreDesc < 0 ? cc.desconto : null, codplc_juros: d.juros > 0 ? cc.juros : null,
          valor_perc_multa: d.valorPercMulta ?? null, indr: 'I', indr_usuario: op, indr_data: sql`now()`, data_operacao: sql`now()`,
        }).execute();
        // `sqqUpdate` (UdmbaixaAreceber.dfm:2199-2205): QUITADA e ANTECIPADO
        await trx.updateTable('areceber').set({ quitada: 'S', antecipado: 'N', dtpgto }).where('codrcb', '=', d.codrcb).execute();
        await AdiantamentoFornService.marcarQuitada(trx, d.codempresa, d.codadiantamento, 'S');
        await this.cascataAgrupamento(trx, d.codrcb, 'S');
      }

      let codrcbSaldo: number | null = null;
      if (parcial) codrcbSaldo = await this.tituloSaldo(trx, emp, op, dto, r2(totalDocs - totalRecursos), ordem[ordem.length - 1]);

      // CAIXA: juros (+), acréscimos (+), descontos (−) — no A Receber a soma do lote inteiro (:1767-1769)
      await lancarCaixaDaBaixaLote(trx, 'AR', emp, { idlote: dto.idlote, dtpgto, juros: somaJuros, acrescimo: somaAcre, desconto: somaDesc, cc });
      return { idlote: dto.idlote, documentos: docs.length, valorPago: totalRecursos, parcial, codrcbSaldo };
    });

    const contabilizado = await this.integrarSeAutomatica(emp, res.idlote, dtpgto);
    return { ...res, contabilizado };
  }

  private async assertPeriodo(db: AnyDB, emp: number, data: string): Promise<void> {
    await assertPeriodoNaoFechado(db, emp, data, 'bloq_baixa_rcb');
    const cfg = (await sql<{ chav: string | null }>`SELECT to_char(chaveamento_periodo, 'YYYY-MM-DD') AS chav FROM config_integracao_contabil LIMIT 1`.execute(db)).rows[0];
    if (cfg?.chav && data <= cfg.chav) throw new BusinessRuleError('PERIODO_CONTABIL_CHAVEADO', { ate: cfg.chav });
  }

  /**
   * Os documentos e o cálculo de cada um (`dbGridDadosColExit`, :2340-2436): ACREDESC = % × valor + R$ − desconto do cliente +
   * o rateio do acréscimo/desconto global pelo valor (o resíduo no último); juro simples diário só com "Calcula juro".
   */
  private async carregarDocumentos(trx: AnyDB, emp: number, op: number | null, dto: BaixaReceberGravarDto, dtpgto: string, global: number): Promise<DocLote[]> {
    const permitidas = await this.empresasPermitidas(trx, emp, op);
    const ids = dto.documentos.map((d) => d.codrcb);
    if (new Set(ids).size !== ids.length) throw new BusinessRuleError('BAIXA_DOCUMENTO_REPETIDO');
    const rows = (await sql<Record<string, unknown>>`
      SELECT r.codrcb, r.codempresa, r.codparceiro, r.valor, coalesce(r.txjuros, 0) AS txjuros, r.quitada, coalesce(r.agrupado, 'N') AS agrupado,
             r.codadiantamento, to_char(r.dtvenc AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dtvenc, to_char(r.dtvenda AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dtvenda, r.docnf, r.valor_perc_multa,
             CASE WHEN coalesce(p.diasprazo, 0) > 0 AND coalesce(p.descpadrao, 0) > 0 AND (r.dtvenda AT TIME ZONE 'America/Sao_Paulo')::date + p.diasprazo::int >= ${dtpgto}::date
                  THEN round(r.valor * p.descpadrao / 100, 2) ELSE 0 END AS desconto_cliente
        FROM areceber r LEFT JOIN parceiros p ON p.codparceiro = r.codparceiro
       WHERE r.codrcb = ANY(${ids}::int[])
       ORDER BY r.codrcb
         FOR UPDATE OF r`.execute(trx)).rows;
    const porId = new Map(rows.map((r) => [Number(r.codrcb), r]));
    const totalValor = r2(dto.documentos.reduce((s, d) => s + num(porId.get(d.codrcb)?.valor), 0));
    // "O valor do desconto não pode ser maior que a soma das contas." (:690-695)
    if (global < 0 && -global > totalValor) throw new BusinessRuleError('BAIXA_DESCONTO_EXCEDE_CONTAS', { desconto: -global, total: totalValor });
    let rateado = 0;
    return dto.documentos.map((d, ordem) => {
      const t = porId.get(d.codrcb);
      if (!t || !permitidas.includes(Number(t.codempresa))) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codrcb: d.codrcb });
      if (t.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO', { codrcb: d.codrcb });
      if (t.agrupado === 'S') throw new BusinessRuleError('TITULO_AGRUPADO', { codrcb: d.codrcb });
      const valor = r2(num(t.valor));
      const ultimo = ordem === dto.documentos.length - 1;
      const parteGlobal = global === 0 ? 0 : ultimo ? r2(global - rateado) : r2((global * valor) / (totalValor || 1));
      rateado = r2(rateado + parteGlobal);
      const acreDesc = r2(num(d.percentual) * valor / 100 + num(d.acreDescValor) - num(t.desconto_cliente) + parteGlobal);
      const txjuros = d.txjuros != null ? num(d.txjuros) : num(t.txjuros);
      let juros = 0;
      if (d.calculaJuro && txjuros > 0 && t.dtvenc && dtpgto > String(t.dtvenc)) {
        const dias = Math.round((Date.parse(dtpgto) - Date.parse(String(t.dtvenc))) / 86_400_000);
        juros = r2(((txjuros / 30) * valor / 100) * dias);
      }
      return {
        codrcb: d.codrcb, codempresa: Number(t.codempresa), codparceiro: t.codparceiro == null ? null : Number(t.codparceiro), valor, txjuros, juros, acreDesc,
        total: r2(valor + acreDesc + juros), codadiantamento: t.codadiantamento == null ? null : Number(t.codadiantamento),
        dtvenda: t.dtvenda == null ? null : String(t.dtvenda), docnf: t.docnf == null ? null : String(t.docnf), valorPercMulta: t.valor_perc_multa, ordem,
      };
    });
  }

  /**
   * `DescontoValidado` (:420-492): com desconto no lote, `PORCENTUAL_MAXIMO_DESCONTO` = 0 e liberadores definidos → sempre pede o
   * login de um liberador (`USUARIOS_LIBERAM_DESCONTO_MAXIMO_EXCEDIDO`); com % > 0, só quando o desconto passa do % do total.
   * Devolve o liberador (gravado em `CODOPERADOR_LIBERACAO_DESCONTO`) ou nulo.
   */
  private async descontoValidado(trx: AnyDB, emp: number, op: number | null, docs: DocLote[], totalDocs: number, dto: BaixaReceberGravarDto): Promise<number | null> {
    const totalDesconto = r2(docs.reduce((s, d) => s + d.acreDesc, 0));
    if (totalDesconto >= 0) return null;
    const pct = num(await configNaTrx(trx, 'PORCENTUAL_MAXIMO_DESCONTO', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' }));
    const liberadores = await this.config.usuariosPermitidos('USUARIOS_LIBERAM_DESCONTO_MAXIMO_EXCEDIDO');
    const totalContas = r2(totalDocs + Math.abs(totalDesconto));
    let pedir = false;
    if (pct === 0 && liberadores.length > 0) pedir = true;
    else if (pct > 0 && Math.abs(totalDesconto) > r2(totalContas * pct / 100)) {
      if (!liberadores.length) throw new BusinessRuleError('BAIXA_DESCONTO_SEM_LIBERADOR');
      pedir = true;
    }
    if (!pedir) return null;
    if (!dto.liberacaoDesconto?.login || !dto.liberacaoDesconto?.senha) throw new BusinessRuleError('BAIXA_DESCONTO_LIBERACAO_REQUERIDA');
    const r = await this.liberacao.validar({
      codigo: 'USUARIOS_LIBERAM_DESCONTO_MAXIMO_EXCEDIDO', login: dto.liberacaoDesconto.login, senha: dto.liberacaoDesconto.senha,
      liberacao: 'O usuário informado não tem permissão para liberar o desconto.',
    });
    if (!r.liberado) throw new BusinessRuleError('BAIXA_DESCONTO_LIBERACAO_NEGADA');
    return r.codOperador ?? null;
  }

  private async centros(trx: AnyDB, emp: number, dto: BaixaReceberGravarDto, juros: number, acre: number, desc: number): Promise<CentrosBaixa> {
    const e = (await sql<Record<string, unknown>>`SELECT codplc_juros_recebidos AS j, codplc_acrescimos_recebidos AS a, codplc_descontos_concedidos AS d FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0] ?? {};
    const escolhido = (informado: number | null | undefined, padrao: unknown) => {
      const n = Number(informado ?? padrao);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const cc: CentrosBaixa = { juros: escolhido(dto.ccJuros, e.j), acrescimo: escolhido(dto.ccAcrescimo, e.a), desconto: escolhido(dto.ccDesconto, e.d) };
    // `ValidaCentroCustos` (:2852-2889)
    const checar = async (valor: number, codplc: number | null, erro: string) => {
      if (valor === 0) return;
      if (codplc == null) throw new BusinessRuleError(erro);
      if (!(await sql`SELECT 1 FROM plc WHERE codplc = ${codplc}`.execute(trx)).rows.length) throw new BusinessRuleError('BAIXA_CC_INVALIDO', { codplc });
    };
    await checar(juros, cc.juros, 'BAIXA_CC_JUROS');
    await checar(acre, cc.acrescimo, 'BAIXA_CC_ACRESCIMO');
    await checar(desc, cc.desconto, 'BAIXA_CC_DESCONTO_CONCEDIDO');
    return cc;
  }

  private async validarRecursos(trx: AnyDB, emp: number, op: number | null, dto: BaixaReceberGravarDto, dtpgto: string, totalDocs: number):
    Promise<Array<{ tipo: number; codconta: number; idempresa: number; valor: number; historico?: string | null; idpgto: number | null; liberado: 'S' | 'N'; contaPropria: boolean }>> {
    const saida: Array<{ tipo: number; codconta: number; idempresa: number; valor: number; historico?: string | null; idpgto: number | null; liberado: 'S' | 'N'; contaPropria: boolean }> = [];
    let restante = totalDocs;
    for (const r of dto.recursos) {
      const tipo = RECURSOS_BAIXA_RECEBER[r.tipo];
      if (!tipo) throw new BusinessRuleError('BAIXA_RECURSO_TIPO_INVALIDO', { tipo: r.tipo });
      const valor = r2(num(r.valor));
      // o excesso do recurso vira acréscimo global na tela (MOSTRAR_TROCO_BAIXA_CR='N', :804-837); aqui chega já somado
      if (valor > r2(restante)) throw new BusinessRuleError('BAIXA_RECURSO_EXCEDE', { valor, restante: r2(restante) });
      restante = r2(restante - valor);
      // "É obrigatório informar o histórico da baixa." (:2008-2009)
      if (r.historico != null && !String(r.historico).trim()) throw new BusinessRuleError('BAIXA_HISTORICO_OBRIGATORIO');
      const c = (await sql<Record<string, unknown>>`
        SELECT c.codconta, c.codbco, c.idempresa, to_char(c.dtchaveamento, 'YYYY-MM-DD') AS dtchaveamento, coalesce(c.conta_propria, 'N') AS conta_propria,
               o.codrelacao, coalesce(o.cbo_baixa_cr, 'S') AS cbo_baixa_cr
          FROM contas_bancarias c
          LEFT JOIN contas_bancarias_op o ON o.codconta = c.codconta AND o.codoperador = ${op}
         WHERE c.codconta = ${r.codconta} AND coalesce(c.ativo, 'S') <> 'N'
         LIMIT 1`.execute(trx)).rows[0];
      if (!c) throw new BusinessRuleError('CONTA_BANCARIA_NAO_ENCONTRADA', { codconta: r.codconta });
      if (c.codrelacao == null) throw new BusinessRuleError('CONTA_SEM_PERMISSAO_OPERADOR', { codconta: r.codconta });
      const caixa = Number(c.codbco) === 0;
      // "Esta conta corrente é conta caixa, não permite operações bancárias!" (:524-528)
      if (caixa && !tipo.caixa) throw new BusinessRuleError('BAIXA_CONTA_CAIXA_OPERACAO_BANCARIA', { codconta: r.codconta });
      if (!caixa && !tipo.banco) throw new BusinessRuleError('BAIXA_CONTA_BANCO_OPERACAO_CAIXA', { codconta: r.codconta });
      // "O operador não possui permissão para baixar contas a receber nesta conta corrente." (`OperadorBaixaCR`, :530-534)
      if (String(c.cbo_baixa_cr) !== 'S') throw new BusinessRuleError('BAIXA_CR_SEM_PERMISSAO_CONTA', { codconta: r.codconta });
      // o chaveamento (`ValidaSaldoAnterior`, udmPrincipal.pas:2189-2204) — na conta do recurso: o legado olha a conta da forma
      // do título, defeito não copiado. Sem teste de saldo (VerifSaldo=False).
      if (c.dtchaveamento && dtpgto <= String(c.dtchaveamento)) throw new BusinessRuleError('CONTA_CAIXA_FECHADA', { codconta: r.codconta, ate: c.dtchaveamento });
      const idpgto = await this.formaDoRecurso(trx, emp, tipo, r.idpgto);
      // `ContaInterna` (CONTA_PROPRIA='S') libera na hora (:376-395)
      const contaPropria = String(c.conta_propria) === 'S';
      saida.push({ tipo: r.tipo, codconta: r.codconta, idempresa: Number(c.idempresa), valor, historico: r.historico, idpgto, liberado: contaPropria ? 'S' : tipo.liberado, contaPropria });
    }
    return saida;
  }

  /** `LocalizaFormaPgto(MODALIDADE, DESTINO)` (:2312-2322): modalidade na loja, destino na loja, modalidade em qualquer loja;
   *  no CARTAO, a forma escolhida (CRT/TEF da loja) */
  private async formaDoRecurso(trx: AnyDB, emp: number, tipo: (typeof RECURSOS_BAIXA_RECEBER)[number], escolhida?: number | null): Promise<number | null> {
    if (tipo.modalidade === 'CARTAO' && escolhida) {
      const f = (await sql<{ idpgto: number }>`SELECT idpgto FROM formas_pgto WHERE idpgto = ${escolhida} AND destino IN ('CRT', 'TEF')`.execute(trx)).rows[0];
      if (!f) throw new BusinessRuleError('BAIXA_FORMA_CARTAO_INVALIDA', { idpgto: escolhida });
      return Number(f.idpgto);
    }
    const destinos = tipo.modalidade === 'CARTAO' ? ['CRT', 'TEF'] : [tipo.destino];
    const f = (await sql<{ idpgto: number }>`
      SELECT idpgto FROM formas_pgto
       WHERE (upper(modalidade) = ${tipo.modalidade} AND idempresa = ${emp})
          OR (destino = ANY(${destinos}::text[]) AND idempresa = ${emp})
          OR upper(modalidade) = ${tipo.modalidade}
       ORDER BY (upper(modalidade) = ${tipo.modalidade} AND idempresa = ${emp}) DESC, (idempresa = ${emp}) DESC, array_position(${destinos}::text[], destino::text), idpgto
       LIMIT 1`.execute(trx)).rows[0];
    if (!f) throw new BusinessRuleError('BAIXA_SEM_FORMA_PAGAMENTO');
    return Number(f.idpgto);
  }

  /** `AtualizaAgrupamento` (:236-259): o consolidado leva o QUITADA aos membros do seu CODGRUPO */
  private async cascataAgrupamento(trx: AnyDB, codrcb: number, quitada: 'S' | 'N'): Promise<void> {
    const c = (await sql<{ agrupamento: string | null; codgrupo: unknown }>`SELECT agrupamento, codgrupo FROM areceber WHERE codrcb = ${codrcb}`.execute(trx)).rows[0];
    if (c?.agrupamento !== 'S' || !num(c.codgrupo)) return;
    await sql`UPDATE areceber SET quitada = ${quitada} WHERE agrupado = 'S' AND codgrupo_agrupamento_rcb = ${num(c.codgrupo)}`.execute(trx);
  }

  /** o título-saldo da parcial (:1441-1464) — aqui dentro da transação */
  private async tituloSaldo(trx: AnyDB, emp: number, op: number | null, dto: BaixaReceberGravarDto, valor: number, doc: DocLote): Promise<number> {
    const tx = (await sql<{ tx: unknown }>`SELECT txjuropadrao AS tx FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0];
    const rcb = (await sql<{ idpgto: number }>`SELECT idpgto FROM formas_pgto WHERE destino = 'RCB' ORDER BY (idempresa = ${emp}) DESC, idpgto LIMIT 1`.execute(trx)).rows[0];
    const ins = (await trx.insertInto('areceber').values({
      codoperador: op, codparceiro: doc.codparceiro, quitada: 'N', codempresa: doc.codempresa, gerado: 'SISTEMA', valor,
      dtvenc: dto.parcial!.dtvenc.slice(0, 10), dtvenda: doc.dtvenda, txjuros: tx?.tx == null ? null : num(tx.tx), idpgto: rcb ? Number(rcb.idpgto) : null,
      tipodoc: 'DUPLICATA', duplicata: 'DUP-001/001', idlote: dto.idlote, obs: `Documento gerado da baixa parcial do lote: ${dto.idlote}`,
      consiliado: 'S', docnf: doc.docnf, origem: 'B', agrupado: 'N', dtcadastro: sql`now()`, dtultimalteracao: sql`now()`, usultalteracao: op,
    }).returning('codrcb').executeTakeFirstOrThrow()) as { codrcb: number };
    return Number(ins.codrcb);
  }

  /**
   * RECIBO do lote (`Config\\recibo.fr3` sobre `GET_ARECEBERBX WHERE LOTE = :LOTE`, UBaixaAreceber.pas:1842-1850): a empresa,
   * "RECEBEMOS DO(A) SR(A)(S)" o cliente, os documentos (duplicata, data da venda, vencimento, valor, juros, acréscimo/desconto,
   * pago), o total, o restante e as três notas do rodapé.
   */
  async recibo(lote: number): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const itens = (await sql<Record<string, unknown>>`
      SELECT r.duplicata, to_char(r.dtvenda AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS data_venda, to_char(r.dtvenc AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS vencimento,
             to_char(x.dtpgto, 'YYYY-MM-DD') AS data_pagamento, r.valor AS valor_documento, coalesce(x.juros, 0) AS juros, coalesce(x.acre_desc, 0) AS acres_desc,
             x.valorpg AS valor_pago, p.razao AS cliente
        FROM areceber_bx x JOIN areceber r ON r.codrcb = x.codrcb LEFT JOIN parceiros p ON p.codparceiro = r.codparceiro
       WHERE x.idlote = ${lote} AND coalesce(x.indr, 'I') <> 'E'
       ORDER BY x.codrcbbx`.execute(db)).rows;
    if (!itens.length) throw new BusinessRuleError('LOTE_NAO_ENCONTRADO', { lote });
    const e = (await sql<Record<string, unknown>>`SELECT coalesce(razao_social, nome) AS razaosocial, endereco, numero, bairro, cidade, uf, cnpj, insc, fone1 FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0] ?? {};
    const docs = itens.map((i): Record<string, any> => ({ ...i, valor_documento: r2(num(i.valor_documento)), juros: r2(num(i.juros)), acres_desc: r2(num(i.acres_desc)), valor_pago: r2(num(i.valor_pago)) }));
    const total = r2(docs.reduce((s, d) => s + d.valor_pago, 0));
    return { lote, empresa: e, dataPagamento: docs[0].data_pagamento, cliente: docs[0].cliente, documentos: docs, total, restante: r2(docs.reduce((s, d) => s + d.valor_documento, 0) - total) };
  }

  /** MANUTENÇÃO (`UconsRCBbx.pas:278-380`): valida sem reverter e devolve os documentos com o acréscimo/desconto e o juro da baixa */
  async manutencao(lote: number): Promise<{ loteAntigo: number; dtpgto: string; documentos: Record<string, unknown>[] }> {
    const emp = this.emp();
    const op = this.op();
    const db = this.dbp.forTenant() as AnyDB;
    const desfazer = new Error('desfazer');
    try {
      await db.transaction().execute(async (trx: AnyDB) => {
        await this.reverterLoteNaTrx(trx, emp, op, lote);
        throw desfazer;
      });
    } catch (e) {
      if (e !== desfazer) throw e;
    }
    const rows = (await sql<Record<string, unknown>>`
      SELECT r.codrcb, r.duplicata, p.razao AS cliente, r.codparceiro, r.codempresa, r.valor, coalesce(r.txjuros, 0) AS txjuros,
             to_char(r.dtvenda AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS emissao, to_char(r.dtvenc AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS vencimento, r.nroped,
             coalesce(b.acre_desc, 0) AS acre_desc, coalesce(b.juros, 0) AS juros_baixa, to_char(b.dtpgto, 'YYYY-MM-DD') AS dtpgto
        FROM areceber_bx b JOIN areceber r ON r.codrcb = b.codrcb LEFT JOIN parceiros p ON p.codparceiro = r.codparceiro
       WHERE b.idlote = ${lote} AND coalesce(b.indr, 'I') = 'I'
       ORDER BY b.codrcbbx`.execute(db)).rows;
    return {
      loteAntigo: lote, dtpgto: String(rows[0]?.dtpgto ?? ''),
      documentos: rows.map((t) => ({ ...t, codrcb: Number(t.codrcb), valor: r2(num(t.valor)), txjuros: num(t.txjuros), acre_desc: r2(num(t.acre_desc)), calcula_juro: num(t.juros_baixa) > 0, desconto_cliente: 0 })),
    };
  }

  /**
   * REVERTER o lote (`TReversaoBaixaContasReceber.ReverteLote`, `UReversaoBaixaContasReceber.pas:273-353`) na transação de quem
   * chama. `ReversaoPermitida`: baixa ativa, período, caixa fechado (chaveamento das contas do lote), contabilizado só com a
   * integração automática, desconto de títulos.
   */
  async reverterLoteNaTrx(trx: AnyDB, emp: number, op: number | null, lote: number): Promise<{ titulos: number[]; contraMovimentos: number }> {
    const ativas = (await sql<Record<string, unknown>>`
      SELECT b.codrcbbx, b.codrcb, b.codempresa, to_char(b.dtpgto, 'YYYY-MM-DD') AS dtpgto, b.contabilizado, r.cod_desconto_titulo, r.codadiantamento, b.codrcb_gerado
        FROM areceber_bx b JOIN areceber r ON r.codrcb = b.codrcb
       WHERE b.idlote = ${lote} AND coalesce(b.indr, 'I') = 'I'
       ORDER BY b.codrcbbx
         FOR UPDATE OF b`.execute(trx)).rows;
    if (!ativas.length) {
      const existe = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM areceber_bx WHERE idlote = ${lote}`.execute(trx)).rows[0];
      throw new BusinessRuleError(num(existe?.n) > 0 ? 'LOTE_JA_REVERTIDO' : 'LOTE_NAO_ENCONTRADO', { lote });
    }
    const permitidas = await this.empresasPermitidas(trx, emp, op);
    if (!ativas.some((b) => permitidas.includes(Number(b.codempresa)))) throw new BusinessRuleError('LOTE_NAO_ENCONTRADO', { lote });
    for (const b of ativas) await this.assertPeriodo(trx, emp, String(b.dtpgto));
    // "Movimentação não encontrada." (DeletaBaixa :129-135)
    const movs = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM mov_contas_bancarias WHERE idlote = ${lote} AND idlote_reversao IS NULL`.execute(trx)).rows[0].n);
    if (!movs) throw new BusinessRuleError('BAIXA_MOVIMENTACAO_NAO_ENCONTRADA', { lote });
    const fechada = (await sql<{ codconta: number }>`
      SELECT m.codconta FROM mov_contas_bancarias m JOIN contas_bancarias c ON c.codconta = m.codconta
       WHERE m.idlote = ${lote} AND c.dtchaveamento IS NOT NULL AND m.dtemissao <= c.dtchaveamento LIMIT 1`.execute(trx)).rows[0];
    if (fechada) throw new BusinessRuleError('BAIXA_REVERSAO_CAIXA_FECHADO', { lote, codconta: Number(fechada.codconta) });
    const desconto = ativas.find((b) => num(b.cod_desconto_titulo) > 0);
    if (desconto) throw new BusinessRuleError('VINCULO_DESCONTO_TITULO', { lote, codrcb: Number(desconto.codrcb) });
    if (ativas.some((b) => String(b.contabilizado ?? '') === 'S')) {
      const e = (await trx.selectFrom('empresas').select('integracao').where('idempresa', '=', emp).executeTakeFirst()) as { integracao?: string | null } | undefined;
      if (String(e?.integracao ?? '') !== 'AUTOMATICA') throw new BusinessRuleError('BAIXA_REVERSAO_CONTABILIZADA', { lote });
    }
    await this.tron.estornarLoteNaTrx(trx, 'AR', lote);

    // por título: QUITADA 'N', ANTECIPADO nulo; o adiantamento REABRE (o legado grava 'S', defeito não copiado); o agrupamento
    for (const b of ativas) {
      await trx.updateTable('areceber').set({ quitada: 'N', antecipado: null, dtpgto: null }).where('codrcb', '=', Number(b.codrcb)).execute();
      await AdiantamentoFornService.marcarQuitada(trx, Number(b.codempresa), b.codadiantamento, 'N');
      await this.cascataAgrupamento(trx, Number(b.codrcb), 'N');
    }
    const nome = op == null ? '' : String(((await trx.selectFrom('operadores').select('nome').where('codoperador', '=', op).executeTakeFirst()) as { nome?: string } | undefined)?.nome ?? '');
    const novoLote = Number((await sql<{ id: string }>`SELECT nextval('seq_idlote') AS id`.execute(trx)).rows[0].id);
    // o espelho de cada movimentação (DeletaBaixa :137-163): datas de hoje só na conta própria
    const ins = await sql`
      INSERT INTO mov_contas_bancarias (codconta, idempresa, valor, tipomovimento, codopconta, historico, idpgto, idlote, idlote_reversao,
                                        dtemissao, dtvenc, dtliberacao, liberado, recurso, dtcadastro)
      SELECT m.codconta, m.idempresa, m.valor, CASE WHEN m.tipomovimento = 'C' THEN 'D' ELSE 'C' END, m.codopconta,
             ${`Reabertura da baixa de contas a receber, lote ${lote}, realizada pelo usuário ${nome}.`}, m.idpgto, ${novoLote}, ${lote},
             CASE WHEN c.conta_propria = 'S' THEN current_date ELSE m.dtemissao END, CASE WHEN c.conta_propria = 'S' THEN current_date ELSE m.dtvenc END,
             m.dtliberacao, m.liberado, m.recurso, now()
        FROM mov_contas_bancarias m JOIN contas_bancarias c ON c.codconta = m.codconta
       WHERE m.idlote = ${lote} AND m.idlote_reversao IS NULL AND coalesce(m.revertido, 'N') <> 'S'`.execute(trx);
    await sql`UPDATE mov_contas_bancarias SET revertido = 'S' WHERE idlote = ${lote} AND idlote_reversao IS NULL`.execute(trx);
    // o título-saldo da parcial e as baixas dele (`DELETE_BAIXA_PARCIAL`/`DELETE_RCB_PARCIAL`: OBS "…PARCIAL DO LOTE: n…" ou IDLOTE = n)
    const reabertos = ativas.map((b) => Number(b.codrcb));
    const gerados = ativas.map((b) => num(b.codrcb_gerado)).filter((n) => n > 0);
    const saldos = (await sql<{ codrcb: number }>`
      SELECT codrcb FROM areceber
       WHERE (upper(obs) LIKE ${`%PARCIAL DO LOTE: ${lote}%`} OR idlote = ${lote} OR codrcb = ANY(${gerados}::int[]))
         AND codrcb <> ALL(${reabertos}::int[])`.execute(trx)).rows.map((r) => Number(r.codrcb));
    if (saldos.length) {
      await sql`DELETE FROM areceber_bx WHERE codrcb = ANY(${saldos}::int[])`.execute(trx);
      await sql`DELETE FROM areceber WHERE codrcb = ANY(${saldos}::int[])`.execute(trx);
    }
    await sql`UPDATE areceber_bx SET indr = 'E', indr_usuario = ${op}, indr_data = now(), data_operacao = now() WHERE idlote = ${lote} AND coalesce(indr, 'I') = 'I'`.execute(trx);
    await sql`DELETE FROM cheque WHERE idlotebxrcb = ${lote}`.execute(trx);
    await estornarCaixaDaBaixa(trx, 'AR', emp, lote);
    return { titulos: reabertos, contraMovimentos: Number(ins.numAffectedRows ?? 0) };
  }

  private async integrarSeAutomatica(emp: number, idlote: number, data: string): Promise<boolean> {
    try {
      const e = (await sql<{ integracao: string | null }>`SELECT integracao FROM empresas WHERE idempresa = ${emp}`.execute(this.dbp.forTenantRead() as AnyDB)).rows[0];
      if (String(e?.integracao ?? '') !== 'AUTOMATICA') return false;
      const r = await this.tron.integrar('AR', { dataIni: data, dataFim: data, idlote });
      return r.lancamentos > 0;
    } catch {
      return false;
    }
  }
}
