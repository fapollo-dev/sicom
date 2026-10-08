import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { BaixaApagarGravarDto, BaixaApagarTitulosDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { assertPeriodoNaoFechado } from '../shared/periodo-contabil';
import { configNaTrx } from '../compras/pedido-heranca';
import { AdiantamentoFornService } from './adiantamento-forn.service';
import { BaixaTronContabilService } from './baixa-tron-contabil.service';
import { estornarCaixaDaBaixa, lancarCaixaDaBaixaLote, type CentrosBaixa } from './baixa-caixa';
import { novoGrupo } from './apagar-caixa';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;

/**
 * Os tipos de recurso do combo (`cbbTpRecurso`, UBaixaApagar.dfm:1008-1031) que o dado usa. Todos gravam modalidade
 * DINHEIRO; o que muda é o LIBERADO e se aceitam conta caixa (`edtCodContaExit` :1555). Cheque de terceiros (1), cheque
 * próprio (5) e devolução (6) ficam fora: CHQ_PROPRIO, CHEQUE_REP e RELACAO_CHQ_PROP têm 0 linhas em toda a história, e a
 * devolução é recusada pelo próprio legado (nenhuma forma com DESTINO 'DEV') — `uBaixaApagar-spec.md` §5.
 */
export const RECURSOS_BAIXA_APAGAR: Record<number, { rotulo: string; liberado: 'S' | 'N'; contaCaixa: boolean }> = {
  0: { rotulo: '1 - DINHEIRO', liberado: 'S', contaCaixa: true },
  2: { rotulo: '3 - DOC', liberado: 'S', contaCaixa: false },
  3: { rotulo: '4 - TRANSFERÊNCIA BANCÁRIA', liberado: 'N', contaCaixa: false },
  4: { rotulo: '5 - DÉBITO EM CONTA', liberado: 'N', contaCaixa: false },
};

interface DocLote {
  codapg: number; codempresa: number; codparceiro: number | null; duplicata: string | null; tipodoc: string | null;
  base: number; desconto: number; txjuros: number; juros: number; acreDesc: number; total: number;
  codadiantamento: number | null; emissao: string | null; ordem: number;
}

/**
 * BAIXA DE CONTAS A PAGAR — a tela do legado (`FRMBAIXAAPAGAR`, `UBaixaApagar.pas`, 8.497 acessos), no modelo dela:
 * um LOTE com N documentos e 1..N recursos, cada recurso numa conta corrente. Especificação: `uBaixaApagar-spec.md`.
 *
 * O que grava, numa transação (`btnGravarClick`, :687-802): uma MOV_CONTAS_BANCARIAS por recurso (VALOR de saída, 'D',
 * operação 0, o histórico literal), uma APAGAR_BX por documento com o pago distribuído do menor para o maior total
 * (:733-780), `QUITADA='S'`, o título-saldo da baixa parcial (um só, `ORIGEM='B'`), a quitação do adiantamento e as
 * linhas de juros/acréscimo/desconto na CAIXA. Depois do commit, com a integração AUTOMÁTICA, o contábil do lote.
 *
 * A manutenção (reabrir e regravar) reverte o lote antigo NA MESMA transação — o legado comita a reversão antes
 * (`UReversaoBaixaContasPagar.pas:312`), e isso não se copia.
 */
@Injectable()
export class BaixaApagarLoteService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly tron: BaixaTronContabilService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op(): number | null {
    return currentTenant().operadorId ?? null;
  }

  /** as empresas que o operador pode escolher (`GetMultiEmpresa` → `RELACAO_OPERADOR_EMPRESA`); a do login sempre entra */
  private async empresasPermitidas(db: AnyDB, emp: number, op: number | null): Promise<number[]> {
    const rel = op == null ? [] : ((await db.selectFrom('relacao_operador_empresa').select('codempresa').where('codoperador', '=', op).execute()) as Array<{ codempresa: number }>).map((r) => Number(r.codempresa));
    return [...new Set([emp, ...rel])];
  }

  /** "Iniciar baixa" aloca o lote na hora (`IdLoteBaixa := GetID('IDLOTE')`, :355) — o histórico padrão já o cita */
  async iniciar(): Promise<{ idlote: number }> {
    this.emp();
    const r = (await sql<{ id: string }>`SELECT nextval('seq_idlote') AS id`.execute(this.dbp.forTenant() as AnyDB)).rows[0];
    return { idlote: Number(r.id) };
  }

  /**
   * Os títulos que a pesquisa oferece (`GET_APAGAR`): abertos, sem crédito de adiantamento e não agrupados, das empresas
   * escolhidas. BLOQUEIO e "fornecedor possui débito" só colorem (:309-323). A base é VALOR + VENDOR e o acréscimo/desconto
   * já vem com `-DESCONTO` (binário novo, desde mar/2025: 419 documentos).
   */
  async titulos(f: BaixaApagarTitulosDto): Promise<Record<string, unknown>[]> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const permitidas = await this.empresasPermitidas(db, emp, this.op());
    const empresas = (f.empresas?.length ? f.empresas : [emp]).filter((e) => permitidas.includes(e));
    if (!empresas.length) throw new BusinessRuleError('EMPRESA_FORA_DO_ESCOPO', { empresas: f.empresas });
    const rows = (await sql<Record<string, unknown>>`
      SELECT a.codapg, a.duplicata AS nr_documento, a.nrparcela, p.razao AS fornecedor, a.codparceiro, a.codempresa,
             a.valor, coalesce(a.vendor, 0) AS vendor, coalesce(a.desconto, 0) AS desconto, coalesce(a.txjuros, 0) AS txjuros,
             to_char(n.dtemissao, 'YYYY-MM-DD') AS emissao, to_char(a.dtvenc, 'YYYY-MM-DD') AS vencimento, a.tipodoc,
             coalesce(a.bloqueio, 'N') AS bloqueio,
             CASE WHEN EXISTS (SELECT 1 FROM areceber r WHERE coalesce(r.quitada, 'N') = 'N' AND r.codparceiro = a.codparceiro) THEN 'S' ELSE 'N' END AS fornecedor_possui_debito
        FROM apagar a
        LEFT JOIN parceiros p ON p.codparceiro = a.codparceiro
        LEFT JOIN nf n ON n.codnf = a.idnf
       WHERE a.quitada = 'N' AND coalesce(a.adcredito, 'N') = 'N' AND coalesce(a.agrupado, 'N') = 'N'
         AND a.codempresa = ANY(${empresas}::int[])
         AND (${f.codparceiro ?? null}::int IS NULL OR a.codparceiro = ${f.codparceiro ?? null}::int)
         AND (${f.vencDe ?? null}::date IS NULL OR a.dtvenc >= ${f.vencDe ?? null}::date)
         AND (${f.vencAte ?? null}::date IS NULL OR a.dtvenc <= ${f.vencAte ?? null}::date)
         AND (${f.busca ?? null}::text IS NULL OR a.duplicata ILIKE '%' || ${f.busca ?? null}::text || '%' OR p.razao ILIKE '%' || ${f.busca ?? null}::text || '%')
         ${f.codigos?.length ? sql`AND a.codapg = ANY(${f.codigos}::int[])` : sql``}
       ORDER BY a.dtvenc, p.razao, a.codapg
       LIMIT 2000
    `.execute(db)).rows;
    return rows.map((t) => {
      const base = r2(num(t.valor) + num(t.vendor));
      return { ...t, codapg: Number(t.codapg), valor: r2(num(t.valor)), vendor: r2(num(t.vendor)), desconto: r2(num(t.desconto)), txjuros: num(t.txjuros), base, acre_desc: r2(-num(t.desconto)) };
    });
  }

  /** as contas do operador (a F3 do legado: `CONTAS_BANCARIAS_OP` do operador, conta ativa, `UBaixaApagar.pas:380-390`) */
  async contas(): Promise<Record<string, unknown>[]> {
    this.emp();
    const op = this.op();
    const rows = (await sql<Record<string, unknown>>`
      SELECT c.codconta, c.nroconta, c.titular, c.codbco, c.idempresa, coalesce(o.cbo_baixa_cp, 'S') AS cbo_baixa_cp
        FROM contas_bancarias c
        JOIN contas_bancarias_op o ON o.codconta = c.codconta AND o.codoperador = ${op}
       WHERE coalesce(c.ativo, 'S') = 'S'
       ORDER BY c.titular, c.codconta
    `.execute(this.dbp.forTenantRead() as AnyDB)).rows;
    return rows.map((c) => ({ ...c, codconta: Number(c.codconta), codbco: c.codbco == null ? null : Number(c.codbco), caixa: Number(c.codbco) === 0 }));
  }

  /** os centros de custo padrão da empresa (`SetCentroCustoPadrao`, :1702-1734) e as configs de data (:1586-1639) */
  async padroes(): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const e = (await sql<Record<string, unknown>>`SELECT codplc_juros_pagos, codplc_acrescimos_pagos, codplc_descontos_recebidos FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0] ?? {};
    const ctx = { empresaId: emp, operadorId: this.op(), modulo: 'Retaguarda' };
    return {
      ccJuros: e.codplc_juros_pagos == null ? null : Number(e.codplc_juros_pagos),
      ccAcrescimo: e.codplc_acrescimos_pagos == null ? null : Number(e.codplc_acrescimos_pagos),
      ccDesconto: e.codplc_descontos_recebidos == null ? null : Number(e.codplc_descontos_recebidos),
      diasFutura: num(await configNaTrx(db, 'QTDE_DIAS_BX_APG_FUTURA', ctx)),
      permiteRetroativa: String((await configNaTrx(db, 'PERMITE_BX_APG_DATA_RETROATIVA', ctx)) ?? 'S').toUpperCase() !== 'N',
      recursos: Object.entries(RECURSOS_BAIXA_APAGAR).map(([tipo, r]) => ({ tipo: Number(tipo), ...r })),
      empresas: await this.empresasPermitidas(db, emp, this.op()),
    };
  }

  /**
   * RECIBO do lote (`recibopagar.fr3` sobre `GET_APAGARBX WHERE LOTE = :LOTE`, UBaixaApagar.pas:843-870): a empresa, "PAGAMOS À"
   * o fornecedor (ou "Vários fornecedores"), os documentos — duplicata (ou a NF), vencimento, valor do documento (VALOR + VENDOR
   * − DESCONTO), juros, acréscimo/desconto (ACRE_DESC − DESCONTO, como a view) e o pago —, o total e o restante.
   */
  async recibo(lote: number): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const itens = (await sql<Record<string, unknown>>`
      SELECT a.duplicata, n.nronf, to_char(a.dtvenc AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS vencimento, to_char(b.dtpgto, 'YYYY-MM-DD') AS data_pagamento,
             (a.valor + coalesce(a.vendor, 0) - coalesce(a.desconto, 0)) AS valor_documento, coalesce(b.juros, 0) AS juros,
             coalesce(b.acre_desc, 0) - coalesce(a.desconto, 0) AS acres_desc, b.valorpg AS valor_pago, p.razao AS fornecedor, a.codparceiro
        FROM apagar_bx b JOIN apagar a ON a.codapg = b.codapg LEFT JOIN parceiros p ON p.codparceiro = a.codparceiro LEFT JOIN nf n ON n.codnf = a.idnf
       WHERE b.idlote = ${lote} AND coalesce(b.indr, 'I') = 'I'
       ORDER BY b.codapgbx`.execute(db)).rows;
    if (!itens.length) throw new BusinessRuleError('LOTE_NAO_ENCONTRADO', { lote });
    const e = (await sql<Record<string, unknown>>`SELECT coalesce(razao_social, nome) AS razaosocial, endereco, numero, bairro, cidade, uf, cnpj, insc, fone1 FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0] ?? {};
    const docs = itens.map((i): Record<string, any> => ({ ...i, valor_documento: r2(num(i.valor_documento)), juros: r2(num(i.juros)), acres_desc: r2(num(i.acres_desc)), valor_pago: r2(num(i.valor_pago)) }));
    const total = r2(docs.reduce((s, d) => s + d.valor_pago, 0));
    return {
      lote, empresa: e, dataPagamento: docs[0].data_pagamento,
      variosFornecedores: new Set(docs.map((d) => d.codparceiro)).size > 1, fornecedor: docs[0].fornecedor,
      documentos: docs, total, restante: r2(docs.reduce((s, d) => s + d.valor_documento, 0) - total),
    };
  }

  /**
   * MANUTENÇÃO — a entrada pela consulta de baixas (`UConsAPGbx.pas:203-290`): valida o `ReversaoPermitida` do lote (a
   * reversão roda e é desfeita), e devolve os documentos com "Calcula juro" e o acréscimo/desconto da baixa e a data do
   * pagamento. Os recursos não voltam: o usuário lança de novo. O lote novo sai do "Iniciar baixa".
   */
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
      SELECT a.codapg, a.duplicata AS nr_documento, a.nrparcela, p.razao AS fornecedor, a.codparceiro, a.codempresa,
             a.valor, coalesce(a.vendor, 0) AS vendor, coalesce(a.desconto, 0) AS desconto, coalesce(a.txjuros, 0) AS txjuros,
             to_char(n.dtemissao, 'YYYY-MM-DD') AS emissao, to_char(a.dtvenc, 'YYYY-MM-DD') AS vencimento, a.tipodoc,
             coalesce(b.acre_desc, 0) AS acre_desc, coalesce(b.juros, 0) AS juros_baixa, to_char(b.dtpgto, 'YYYY-MM-DD') AS dtpgto
        FROM apagar_bx b
        JOIN apagar a ON a.codapg = b.codapg
        LEFT JOIN parceiros p ON p.codparceiro = a.codparceiro
        LEFT JOIN nf n ON n.codnf = a.idnf
       WHERE b.idlote = ${lote} AND coalesce(b.indr, 'I') = 'I'
       ORDER BY b.codapgbx`.execute(db)).rows;
    return {
      loteAntigo: lote, dtpgto: String(rows[0]?.dtpgto ?? ''),
      documentos: rows.map((t) => ({
        ...t, codapg: Number(t.codapg), valor: r2(num(t.valor)), vendor: r2(num(t.vendor)), desconto: r2(num(t.desconto)), txjuros: num(t.txjuros),
        base: r2(num(t.valor) + num(t.vendor)), acre_desc: r2(num(t.acre_desc)), calcula_juro: num(t.juros_baixa) > 0,
      })),
    };
  }

  /** GRAVAR a baixa do lote (e, na manutenção, reverter o lote antigo antes, na mesma transação) */
  async gravar(dto: BaixaApagarGravarDto): Promise<{ idlote: number; documentos: number; valorPago: number; parcial: boolean; codapgSaldo: number | null; contabilizado: boolean }> {
    const emp = this.emp();
    const op = this.op();
    // "Nenhum documento foi informado…" / "Nenhum recurso foi informado." (:543-550) — o schema já exige os dois
    const dtpgto = dto.dtpgto.slice(0, 10);
    const db = this.dbp.forTenant() as AnyDB;
    await this.assertPeriodo(db, emp, dtpgto);

    const res = await db.transaction().execute(async (trx: AnyDB) => {
      // o lote é o que o "Iniciar baixa" alocou; não pode já ter sido usado
      const usado = (await sql<{ n: number }>`SELECT (SELECT count(*) FROM apagar_bx WHERE idlote = ${dto.idlote}) + (SELECT count(*) FROM mov_contas_bancarias WHERE idlote = ${dto.idlote}) AS n`.execute(trx)).rows[0];
      if (num(usado?.n) > 0) throw new BusinessRuleError('BAIXA_LOTE_EM_USO', { idlote: dto.idlote });
      const ultimo = (await sql<{ v: string }>`SELECT last_value AS v FROM seq_idlote`.execute(trx)).rows[0];
      if (dto.idlote <= 0 || dto.idlote > num(ultimo?.v)) throw new BusinessRuleError('BAIXA_LOTE_INVALIDO', { idlote: dto.idlote });

      // manutenção: "O lote de manutenção não foi encontrado." + ReversaoPermitida, e a reversão do lote antigo (:563-566, :691)
      if (dto.loteManutencao) await this.reverterLoteNaTrx(trx, emp, op, dto.loteManutencao);

      const docs = await this.carregarDocumentos(trx, emp, op, dto, dtpgto);
      const totalDocs = r2(docs.reduce((s, d) => s + d.total, 0));

      // centros de custo (`ValidaCentroCustos`, :1766-1802): obrigatório para a natureza com valor; o tipo da conta (:1804-1821)
      const somaJuros = r2(docs.reduce((s, d) => s + d.juros, 0));
      const somaAcre = r2(docs.reduce((s, d) => s + (d.acreDesc > 0 ? d.acreDesc : 0), 0));
      const somaDesc = r2(docs.reduce((s, d) => s + (d.acreDesc < 0 ? -d.acreDesc : 0), 0));
      const cc = await this.centros(trx, emp, dto, somaJuros, somaAcre, somaDesc);

      // os recursos (`btnPostRecursoClick`, :1092-1160, e `edtCodContaExit`, :1527-1573)
      const recursos = await this.validarRecursos(trx, op, dto, dtpgto, totalDocs);
      const totalRecursos = r2(recursos.reduce((s, r) => s + r.valor, 0));

      // "Total de recursos não confere com o total dos documentos. Deseja gerar uma baixa parcial?" (:579-685)
      const parcial = totalRecursos < totalDocs;
      if (parcial && !dto.parcial) throw new BusinessRuleError('BAIXA_TOTAL_NAO_CONFERE', { totalDocumentos: totalDocs, totalRecursos });
      if (parcial && new Set(docs.map((d) => d.codparceiro)).size > 1) throw new BusinessRuleError('BAIXA_PARCIAL_FORNECEDORES');

      // o histórico de cada recurso (`SetOperadorObs`, :1742-1764)
      const nome = op == null ? '' : String(((await trx.selectFrom('operadores').select('nome').where('codoperador', '=', op).executeTakeFirst()) as { nome?: string } | undefined)?.nome ?? '');
      const idpgto = await this.idpgtoDaEmpresa(trx, emp);
      let historicoCorrente = '';
      for (const r of recursos) {
        const texto = (r.historico ?? `REFERENTE A BAIXA DO LOTE: ${dto.idlote}`).trim();
        const historico = `${texto ? texto + ' - ' : ''}Baixa das contas a pagar realizada pelo(a) usuário(a) ${nome}.`.slice(0, 300);
        historicoCorrente = historico;
        const liberado = RECURSOS_BAIXA_APAGAR[r.tipo].liberado;
        await trx.insertInto('mov_contas_bancarias').values({
          codconta: r.codconta, idempresa: r.idempresa, valor: r.valor, tipomovimento: 'D', codopconta: 0, idpgto,
          historico, idlote: dto.idlote, dtemissao: dtpgto, dtvenc: dtpgto, liberado, dtliberacao: liberado === 'S' ? dtpgto : null,
          dtcadastro: sql`now()`,
        }).execute();
      }

      // a distribuição do pago (:733-780): do menor TOTALJUROS para o maior; os que não couberem ficam com 0 e quitados
      let baixado = totalRecursos;
      const ordem = [...docs].sort((a, b) => a.total - b.total || a.ordem - b.ordem);
      for (const d of ordem) {
        baixado = r2(baixado - d.total);
        const valorpg = baixado > 0 ? d.total : Math.max(r2(d.total + baixado), 0);
        await trx.insertInto('apagar_bx').values({
          codapg: d.codapg, codempresa: d.codempresa, valorpg, dtpgto, obs: historicoCorrente, acre_desc: d.acreDesc, juros: d.juros,
          codopbx: op, idlote: dto.idlote, indr: 'I', indr_usuario: op, indr_data: sql`now()`, data_operacao: sql`now()`,
          codplc_acredesc: d.acreDesc > 0 ? cc.acrescimo : d.acreDesc < 0 ? cc.desconto : null,
          codplc_juros: d.juros > 0 ? cc.juros : null, tx_juros: d.juros > 0 ? d.txjuros : null,
        }).execute();
        // só QUITADA (:774): o legado não carimba usuário/data de alteração — 15.432 das 15.984 baixas mantêm os antigos
        await trx.updateTable('apagar').set({ quitada: 'S', dtpgto }).where('codapg', '=', d.codapg).execute();
        await AdiantamentoFornService.marcarQuitada(trx, d.codempresa, d.codadiantamento, 'S');
      }

      // o título-saldo da parcial (:600-660): um só para o lote
      let codapgSaldo: number | null = null;
      if (parcial) codapgSaldo = await this.tituloSaldo(trx, emp, op, dto, docs, r2(totalDocs - totalRecursos), ordem[ordem.length - 1]);

      // juros, acréscimos e descontos na CAIXA (:790-792). O desconto é só o digitado: o do título já vinha no ACRE_DESC
      // (binário novo — Σ|desc| − Σ APAGAR.DESCONTO bateu em 337 dos 347 lotes)
      const descDigitado = r2(docs.reduce((s, d) => s + (d.acreDesc < 0 ? Math.max(-d.acreDesc - d.desconto, 0) : 0), 0));
      await lancarCaixaDaBaixaLote(trx, 'AP', emp, { idlote: dto.idlote, dtpgto, juros: somaJuros, acrescimo: somaAcre, desconto: descDigitado, cc });

      return { idlote: dto.idlote, documentos: docs.length, valorPago: totalRecursos, parcial, codapgSaldo };
    });

    // depois do commit, com a integração AUTOMÁTICA, o contábil do lote — com o erro engolido, como `IntegraBaixaApagar` (:1441-1451)
    const contabilizado = await this.integrarSeAutomatica(emp, res.idlote, dtpgto);
    return { ...res, contabilizado };
  }

  /** o período contábil (`ValidaPeriodoFechado`, :552 — CHAVEAMENTO_PERIODO) e o bloqueio de período da baixa do binário novo */
  private async assertPeriodo(db: AnyDB, emp: number, data: string): Promise<void> {
    await assertPeriodoNaoFechado(db, emp, data, 'bloq_baixa_apg');
    const cfg = (await sql<{ chav: string | null }>`SELECT to_char(chaveamento_periodo, 'YYYY-MM-DD') AS chav FROM config_integracao_contabil LIMIT 1`.execute(db)).rows[0];
    if (cfg?.chav && data <= cfg.chav) throw new BusinessRuleError('PERIODO_CONTABIL_CHAVEADO', { ate: cfg.chav });
  }

  private async carregarDocumentos(trx: AnyDB, emp: number, op: number | null, dto: BaixaApagarGravarDto, dtpgto: string): Promise<DocLote[]> {
    const permitidas = await this.empresasPermitidas(trx, emp, op);
    const ids = dto.documentos.map((d) => d.codapg);
    if (new Set(ids).size !== ids.length) throw new BusinessRuleError('BAIXA_DOCUMENTO_REPETIDO');
    const rows = (await sql<Record<string, unknown>>`
      SELECT a.codapg, a.codempresa, a.codparceiro, a.duplicata, a.tipodoc, a.valor, coalesce(a.vendor, 0) AS vendor,
             coalesce(a.desconto, 0) AS desconto, coalesce(a.txjuros, 0) AS txjuros, a.quitada, coalesce(a.agrupado, 'N') AS agrupado,
             coalesce(a.adcredito, 'N') AS adcredito, a.codadiantamento, to_char(a.dtvenc, 'YYYY-MM-DD') AS dtvenc,
             to_char(coalesce(n.dtemissao, a.dtcompra), 'YYYY-MM-DD') AS emissao
        FROM apagar a LEFT JOIN nf n ON n.codnf = a.idnf
       WHERE a.codapg = ANY(${ids}::int[])
       ORDER BY a.codapg
         FOR UPDATE OF a
    `.execute(trx)).rows;
    const porId = new Map(rows.map((r) => [Number(r.codapg), r]));
    return dto.documentos.map((d, ordem) => {
      const t = porId.get(d.codapg);
      if (!t || !permitidas.includes(Number(t.codempresa))) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codapg: d.codapg });
      // a pesquisa (GET_APAGAR) não oferece quitado, agrupado nem crédito de adiantamento
      if (t.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO', { codapg: d.codapg });
      if (t.agrupado === 'S') throw new BusinessRuleError('TITULO_AGRUPADO', { codapg: d.codapg });
      if (t.adcredito === 'S') throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codapg: d.codapg });
      const base = r2(num(t.valor) + num(t.vendor));
      const desconto = r2(num(t.desconto));
      const txjuros = num(t.txjuros);
      // `cdsDoctosCalcFields` (UdmBaixaApagar.pas:344-373): juro simples diário sobre o valor, só com "Calcula juro"
      let juros = 0;
      if (d.calculaJuro && txjuros > 0 && t.dtvenc && dtpgto > String(t.dtvenc)) {
        const dias = Math.round((Date.parse(dtpgto) - Date.parse(String(t.dtvenc))) / 86_400_000);
        juros = r2((txjuros / 100 / 30) * base * dias);
      }
      const acreDesc = r2(d.acreDesc ?? -desconto);
      return {
        codapg: d.codapg, codempresa: Number(t.codempresa), codparceiro: t.codparceiro == null ? null : Number(t.codparceiro),
        duplicata: t.duplicata == null ? null : String(t.duplicata), tipodoc: t.tipodoc == null ? null : String(t.tipodoc),
        base, desconto, txjuros, juros, acreDesc, total: r2(base + juros + acreDesc),
        codadiantamento: t.codadiantamento == null ? null : Number(t.codadiantamento), emissao: t.emissao == null ? null : String(t.emissao), ordem,
      };
    });
  }

  private async centros(trx: AnyDB, emp: number, dto: BaixaApagarGravarDto, juros: number, acre: number, desc: number): Promise<CentrosBaixa> {
    const e = (await sql<Record<string, unknown>>`SELECT codplc_juros_pagos AS j, codplc_acrescimos_pagos AS a, codplc_descontos_recebidos AS d FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0] ?? {};
    const escolhido = (informado: number | null | undefined, padrao: unknown) => {
      const n = Number(informado ?? padrao);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const cc: CentrosBaixa = { juros: escolhido(dto.ccJuros, e.j), acrescimo: escolhido(dto.ccAcrescimo, e.a), desconto: escolhido(dto.ccDesconto, e.d) };
    const checar = async (valor: number, codplc: number | null, erro: string, tipoProibido: number, erroTipo: string) => {
      if (valor === 0) return;
      if (codplc == null) throw new BusinessRuleError(erro);
      const p = (await sql<{ tpconta: unknown }>`SELECT tpconta FROM plc WHERE codplc = ${codplc}`.execute(trx)).rows[0];
      if (!p) throw new BusinessRuleError('BAIXA_CC_INVALIDO', { codplc });
      // "O centro de custo não pode ser uma receita." (juros/acréscimo, TPCONTA 0) / "…uma despesa." (desconto, TPCONTA 1)
      if (p.tpconta != null && Number(p.tpconta) === tipoProibido) throw new BusinessRuleError(erroTipo, { codplc });
    };
    await checar(juros, cc.juros, 'BAIXA_CC_JUROS', 0, 'BAIXA_CC_RECEITA');
    await checar(acre, cc.acrescimo, 'BAIXA_CC_ACRESCIMO', 0, 'BAIXA_CC_RECEITA');
    await checar(desc, cc.desconto, 'BAIXA_CC_DESCONTO_RECEBIDO', 1, 'BAIXA_CC_DESPESA');
    return cc;
  }

  private async validarRecursos(trx: AnyDB, op: number | null, dto: BaixaApagarGravarDto, dtpgto: string, totalDocs: number): Promise<Array<{ tipo: number; codconta: number; idempresa: number; valor: number; historico?: string | null }>> {
    const saida: Array<{ tipo: number; codconta: number; idempresa: number; valor: number; historico?: string | null }> = [];
    const jaNoLote = new Map<number, number>();
    let restante = totalDocs;
    for (const r of dto.recursos) {
      const tipo = RECURSOS_BAIXA_APAGAR[r.tipo];
      if (!tipo) throw new BusinessRuleError('BAIXA_RECURSO_TIPO_INVALIDO', { tipo: r.tipo });
      const valor = r2(num(r.valor));
      // "Valor superior ao restante da baixa!" (:1654-1669)
      if (valor > r2(restante)) throw new BusinessRuleError('BAIXA_RECURSO_EXCEDE', { valor, restante: r2(restante) });
      restante = r2(restante - valor);
      const c = (await sql<Record<string, unknown>>`
        SELECT c.codconta, c.codbco, c.idempresa, to_char(c.dtchaveamento, 'YYYY-MM-DD') AS dtchaveamento,
               o.codrelacao, coalesce(o.cbo_baixa_cp, 'S') AS cbo_baixa_cp
          FROM contas_bancarias c
          LEFT JOIN contas_bancarias_op o ON o.codconta = c.codconta AND o.codoperador = ${op}
         WHERE c.codconta = ${r.codconta} AND coalesce(c.ativo, 'S') = 'S'
         LIMIT 1`.execute(trx)).rows[0];
      // "É necessário informar a conta corrente!" / "Este Operador não tem permissão para manipular essa conta corrente."
      if (!c) throw new BusinessRuleError('CONTA_BANCARIA_NAO_ENCONTRADA', { codconta: r.codconta });
      if (c.codrelacao == null) throw new BusinessRuleError('CONTA_SEM_PERMISSAO_OPERADOR', { codconta: r.codconta });
      const caixa = Number(c.codbco) === 0;
      // "Esta conta corrente é conta caixa, não permite operações bancárias." (:1555)
      if (caixa && !tipo.contaCaixa) throw new BusinessRuleError('BAIXA_CONTA_CAIXA_OPERACAO_BANCARIA', { codconta: r.codconta });
      // "O operador não possui permissão para baixar contas a pagar nesta conta corrente." (`OperadorBaixaCP`, :1558)
      if (String(c.cbo_baixa_cp) !== 'S') throw new BusinessRuleError('BAIXA_CP_SEM_PERMISSAO_CONTA', { codconta: r.codconta });
      // `ValidaSaldoAnteriorNew` (udmPrincipal.pas:2318-2338): o chaveamento vale para qualquer conta; o saldo, só na caixa,
      // e é o DINHEIRO liberado da conta. Reforço: desconta os recursos anteriores do mesmo lote na mesma conta.
      if (c.dtchaveamento && dtpgto <= String(c.dtchaveamento)) throw new BusinessRuleError('BAIXA_CAIXA_FECHADO', { codconta: r.codconta, ate: c.dtchaveamento });
      if (caixa) {
        const saldo = r2((await this.saldoDinheiro(trx, r.codconta)) - (jaNoLote.get(r.codconta) ?? 0));
        if (valor > saldo) throw new BusinessRuleError('BAIXA_SALDO_INSUFICIENTE', { codconta: r.codconta, saldo, valor });
      }
      jaNoLote.set(r.codconta, r2((jaNoLote.get(r.codconta) ?? 0) + valor));
      saida.push({ tipo: r.tipo, codconta: r.codconta, idempresa: Number(c.idempresa), valor, historico: r.historico });
    }
    return saida;
  }

  /** `GetSaldoContaCorrente(conta, 'DINHEIRO')` (udmPrincipal.pas:3877-3928): Σ do liberado da conta na modalidade DINHEIRO */
  private async saldoDinheiro(trx: AnyDB, codconta: number): Promise<number> {
    const r = (await sql<{ saldo: unknown }>`
      SELECT coalesce(sum(CASE WHEN m.tipomovimento = 'D' THEN -m.valor ELSE m.valor END), 0) AS saldo
        FROM mov_contas_bancarias m JOIN formas_pgto f ON f.idpgto = m.idpgto
       WHERE m.codconta = ${codconta} AND coalesce(m.liberado, 'N') = 'S' AND upper(f.modalidade) = 'DINHEIRO'`.execute(trx)).rows[0];
    return r2(num(r?.saldo));
  }

  /** a forma DINHEIRO da empresa do LOGIN (`cbbTpRecursoExit`, :1245-1250); sem ela, a primeira forma da empresa (o
   *  `Locate` que falha deixa o cursor no primeiro registro — é o BOLETO da empresa 50) */
  private async idpgtoDaEmpresa(trx: AnyDB, emp: number): Promise<number | null> {
    const f = (await sql<{ idpgto: number }>`SELECT idpgto FROM formas_pgto WHERE idempresa = ${emp}
                ORDER BY (upper(modalidade) = 'DINHEIRO') DESC, idpgto LIMIT 1`.execute(trx)).rows[0];
    return f ? Number(f.idpgto) : null;
  }

  /** o título-saldo (:600-660): valor = total a baixar − recursos, vencimento informado, 1/1, `ORIGEM='B'`, SISTEMA, com o
   *  documento corrente como pai e `Duplicatas:` com os números dos documentos em ordem inversa */
  private async tituloSaldo(trx: AnyDB, emp: number, op: number | null, dto: BaixaApagarGravarDto, docs: DocLote[], valor: number, pai: DocLote): Promise<number> {
    const tx = (await sql<{ tx: unknown }>`SELECT tx_juro_apagar AS tx FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0];
    const duplicatas = [...docs].reverse().map((d) => d.duplicata ?? '').join(', ');
    const ins = (await trx.insertInto('apagar').values({
      codoperador: op, codparceiro: pai.codparceiro, quitada: 'N', codempresa: pai.codempresa, gerado: 'SISTEMA', valor,
      dtvenc: dto.parcial!.dtvenc.slice(0, 10), dtvenda: sql`current_date`,
      // a emissão do documento é a da NF (GET_APAGAR); sem NF o legado grava a data zero do Delphi (1899-12-30) — aqui, a do título
      dtcompra: pai.emissao, txjuros: tx?.tx == null ? null : num(tx.tx), nrparcela: '1/1', tipodoc: pai.tipodoc,
      codgrupo: await novoGrupo(trx), codapg_pai: pai.codapg, duplicata: pai.duplicata ?? 'DUP-001/001',
      obs: `Duplicatas:${duplicatas}`.slice(0, 255), idlote: dto.idlote, origem: 'B', agrupado: 'N',
      dtcadastro: sql`now()`, dtultimalteracao: sql`now()`, usultalteracao: op,
    }).returning('codapg').executeTakeFirstOrThrow()) as { codapg: number };
    return Number(ins.codapg);
  }

  /**
   * REVERTER o lote (`TReversaoBaixaContasPagar.ReverteLote`, `UReversaoBaixaContasPagar.pas:96-176, 273-325`), na transação
   * de quem chama — a consulta de baixas e a manutenção. `ReversaoPermitida` (`UReversaoBaixa.pas:115-170`): lote com baixa
   * ativa, período aberto, caixa aberto (o chaveamento das contas do lote), contabilizado só com a integração automática e
   * sem vínculo com desconto de títulos.
   */
  async reverterLoteNaTrx(trx: AnyDB, emp: number, op: number | null, lote: number): Promise<{ titulos: number[]; contraMovimentos: number }> {
    const ativas = (await sql<Record<string, unknown>>`
      SELECT b.codapgbx, b.codapg, b.codempresa, to_char(b.dtpgto, 'YYYY-MM-DD') AS dtpgto, b.contabilizado, a.cod_desconto_titulo, a.codadiantamento, b.codapg_gerado
        FROM apagar_bx b JOIN apagar a ON a.codapg = b.codapg
       WHERE b.idlote = ${lote} AND coalesce(b.indr, 'I') = 'I'
       ORDER BY b.codapgbx
         FOR UPDATE OF b`.execute(trx)).rows;
    if (!ativas.length) {
      const existe = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM apagar_bx WHERE idlote = ${lote}`.execute(trx)).rows[0];
      throw new BusinessRuleError(num(existe?.n) > 0 ? 'LOTE_JA_REVERTIDO' : 'LOTE_NAO_ENCONTRADO', { lote });
    }
    const permitidas = await this.empresasPermitidas(trx, emp, op);
    if (!ativas.some((b) => permitidas.includes(Number(b.codempresa)))) throw new BusinessRuleError('LOTE_NAO_ENCONTRADO', { lote });
    for (const b of ativas) await this.assertPeriodo(trx, emp, String(b.dtpgto));
    // "Não será possível reverter a baixa pois o caixa foi fechado." — o chaveamento das contas do lote
    const fechada = (await sql<{ codconta: number }>`
      SELECT m.codconta FROM mov_contas_bancarias m JOIN contas_bancarias c ON c.codconta = m.codconta
       WHERE m.idlote = ${lote} AND c.dtchaveamento IS NOT NULL AND m.dtemissao <= c.dtchaveamento LIMIT 1`.execute(trx)).rows[0];
    if (fechada) throw new BusinessRuleError('BAIXA_REVERSAO_CAIXA_FECHADO', { lote, codconta: Number(fechada.codconta) });
    const desconto = ativas.find((b) => num(b.cod_desconto_titulo) > 0);
    if (desconto) throw new BusinessRuleError('VINCULO_DESCONTO_TITULO', { lote, codapg: Number(desconto.codapg) });
    if (ativas.some((b) => String(b.contabilizado ?? '') === 'S')) {
      const e = (await trx.selectFrom('empresas').select('integracao').where('idempresa', '=', emp).executeTakeFirst()) as { integracao?: string | null } | undefined;
      if (String(e?.integracao ?? '') !== 'AUTOMATICA') throw new BusinessRuleError('BAIXA_REVERSAO_CONTABILIZADA', { lote });
    }
    await this.tron.estornarLoteNaTrx(trx, 'AP', lote);

    // por baixa: reabre o título (e tira o cartão próprio) e o adiantamento (:60-70)
    for (const b of ativas) {
      await trx.updateTable('apagar').set({ quitada: 'N', codapgcartao: null, dtpgto: null }).where('codapg', '=', Number(b.codapg)).execute();
      await AdiantamentoFornService.marcarQuitada(trx, Number(b.codempresa), b.codadiantamento, 'N');
    }
    // por movimentação do lote: REVERTIDO e o contra-movimento (tipo invertido, mesmo valor — o Apollo guarda o absoluto)
    const nome = op == null ? '' : String(((await trx.selectFrom('operadores').select('nome').where('codoperador', '=', op).executeTakeFirst()) as { nome?: string } | undefined)?.nome ?? '');
    const novoLote = Number((await sql<{ id: string }>`SELECT nextval('seq_idlote') AS id`.execute(trx)).rows[0].id);
    const ins = await sql`
      INSERT INTO mov_contas_bancarias (codconta, idempresa, valor, tipomovimento, codopconta, historico, idpgto, idlote, idlote_reversao,
                                        dtemissao, dtvenc, dtliberacao, liberado, dtcadastro)
      SELECT m.codconta, m.idempresa, m.valor, CASE WHEN m.tipomovimento = 'C' THEN 'D' ELSE 'C' END, m.codopconta,
             ${`Reabertura da baixa de contas a pagar, lote ${lote}, realizada pelo usuário ${nome}.`}, m.idpgto, ${novoLote}, ${lote},
             current_date, current_date, CASE WHEN m.liberado = 'S' THEN current_date END, m.liberado, now()
        FROM mov_contas_bancarias m
       WHERE m.idlote = ${lote} AND m.idlote_reversao IS NULL AND coalesce(m.revertido, 'N') <> 'S'`.execute(trx);
    await sql`UPDATE mov_contas_bancarias SET revertido = 'S' WHERE idlote = ${lote} AND idlote_reversao IS NULL`.execute(trx);
    // o lote: INDR='E', o saldo em aberto da parcial e as linhas da CAIXA (pelo texto)
    await sql`UPDATE apagar_bx SET indr = 'E', indr_usuario = ${op}, indr_data = now(), data_operacao = now() WHERE idlote = ${lote} AND coalesce(indr, 'I') = 'I'`.execute(trx);
    const gerados = ativas.map((b) => num(b.codapg_gerado)).filter((n) => n > 0);
    await sql`DELETE FROM apagar WHERE quitada = 'N' AND (idlote = ${lote} OR codapg = ANY(${gerados}::int[]))
                AND codapg <> ALL(${ativas.map((b) => Number(b.codapg))}::int[])`.execute(trx);
    await estornarCaixaDaBaixa(trx, 'AP', emp, lote);
    return { titulos: ativas.map((b) => Number(b.codapg)), contraMovimentos: Number(ins.numAffectedRows ?? 0) };
  }

  private async integrarSeAutomatica(emp: number, idlote: number, data: string): Promise<boolean> {
    try {
      const e = (await sql<{ integracao: string | null }>`SELECT integracao FROM empresas WHERE idempresa = ${emp}`.execute(this.dbp.forTenantRead() as AnyDB)).rows[0];
      if (String(e?.integracao ?? '') !== 'AUTOMATICA') return false;
      const r = await this.tron.integrar('AP', { dataIni: data, dataFim: data, idlote });
      return r.lancamentos > 0;
    } catch {
      return false;
    }
  }
}
