import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import type { RascunhoFechamentoDto, TurnoFechamentoDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { configNaTrx } from '../compras/pedido-heranca';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;

/** as quatro linhas fixas de sangria/suprimento do rascunho (`TipoSangriaSuprimentoToStr`) e a do dinheiro contado */
export const FIXAS_FECHAMENTO = ['SANGRIA EM DINHEIRO', 'SANGRIA EM CHEQUE', 'OUTRAS SANGRIAS', 'SUPRIMENTO'] as const;
type Fixa = (typeof FIXAS_FECHAMENTO)[number];
const CONTADO = 'DINHEIRO CONTADO';

/** o tipo do documento que confere a linha, pelo DESTINO da forma de pagamento (`RealizaConf :2191`) */
export type TipoConferencia = 'CARTAO' | 'RCB' | 'CHQ' | 'TICKET' | 'DEV' | 'DINHEIRO' | null;
function tipoDe(f: { destino: string | null; modalidade: string } | undefined): TipoConferencia {
  if (!f) return null;
  const d = String(f.destino ?? '');
  if (d === 'CXA') return f.modalidade.toUpperCase().includes('TICKET') ? 'TICKET' : 'DINHEIRO';
  if (d === 'RCB') return 'RCB';
  if (d === 'CHQ' || d === 'CHP') return 'CHQ';
  if (d === 'TEF' || d === 'CRT') return 'CARTAO';
  if (d === 'DEV') return 'DEV';
  return null;
}

interface Ctx {
  emp: number;
  tz: string;
  data: string;
  chave: string | null;
  pdv: number;
  op: number;
  situacao?: number;
}
interface Forma { idpgto: number; modalidade: string; destino: string | null }
interface LinhaFf { codifinfech: number; operacao: string; vrreal: number; consolidado: string | null }
interface Doc { codigo: number; valor: number; [k: string]: unknown }

/**
 * FECHAMENTO DE CAIXA — corte 1: a CONFERÊNCIA do turno do PDV e o RASCUNHO (dossiê uFechamentoCaixa-finalizacao.md).
 * Nada aqui tem efeito financeiro — o efetivar (CAIXA, MCB, SALDO_OPERADOR, marcas) é o corte 2.
 *  - `turnos`: "Caixas em aberto" (`Ucxaberto.pas:108-155`) — um turno por PDV × operador × CHAVE × status do dia;
 *  - `detalhe`: a grade do turno (`ProcessaSQL`) e a finalização (`TfrmFinalizaFechamento.FormShow`): o sistema por
 *    operação, o REAL do rascunho, sangrias/suprimento do histórico, os adicionais e a diferença;
 *  - `abrir`: abrir o turno para fechar — completa o CX_VENDAS com as modalidades que faltam (`:1583-1601`), insere a
 *    sangria/o suprimento que o PDV não registrou (`InsereSangriaSuprimento`) e o TICKET que falta (`:2254-2280`);
 *  - `documentos`: os documentos de uma operação (`UConsDocs`), marcados os do rascunho;
 *  - `salvarRascunho`: FINALIZA_FECHAMENTO + DOC_FECHAMENTO (`ProcessaFinalizaFechamento :2056-2189`).
 * Turno fechado (STATUS='F') é CONSULTA: lê o rascunho sem o filtro de consolidado, lista documentos já conciliados e
 * não grava.
 */
@Injectable()
export class FechamentoCaixaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private async cfg(db: AnyDB, codigo: string, emp: number) {
    return configNaTrx(db, codigo, { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' });
  }

  private async contexto(db: AnyDB, t: TurnoFechamentoDto): Promise<Ctx> {
    const emp = this.emp();
    const tz = (await this.cfg(db, 'FUSO_HORARIO_ACESSO', emp)) ?? 'America/Sao_Paulo';
    return { emp, tz, data: t.data, chave: t.chave ? String(t.chave).trim() || null : null, pdv: t.nropdv, op: t.codoperadora, situacao: t.situacao };
  }

  // ── pedaços de SQL ─────────────────────────────────────────────────────────────────────────────────────────────
  /** meia-noite do dia do caixa no fuso da loja (o TRUNC(DATA) do legado é o dia civil local — lição 17) */
  private ini(c: Ctx): RawBuilder<unknown> {
    return sql`((${c.data}::date)::timestamp AT TIME ZONE ${c.tz})`;
  }
  private fim(c: Ctx): RawBuilder<unknown> {
    return sql`(((${c.data}::date) + 1)::timestamp AT TIME ZONE ${c.tz})`;
  }
  private noDia(col: string, c: Ctx): RawBuilder<unknown> {
    return sql`(${sql.ref(col)} >= ${this.ini(c)} AND ${sql.ref(col)} < ${this.fim(c)})`;
  }
  private daChave(col: string, c: Ctx): RawBuilder<unknown> {
    return c.chave ? sql`${sql.ref(col)} = ${c.chave}` : sql`${sql.ref(col)} IS NULL`;
  }
  private status(situacao: number): RawBuilder<unknown> {
    if (situacao === 3) return sql`cx.tesouraria = 'S'`;
    if (situacao === 2) return sql`cx.status = 'F' AND cx.tesouraria IS NULL`;
    return sql`cx.status IS NULL AND cx.tesouraria IS NULL`;
  }
  /** o WHERE da grade (`ProcessaSQL :1785-1921`), sem o filtro de status */
  private turnoWhere(c: Ctx): RawBuilder<unknown> {
    return sql`${this.noDia('cx.data', c)} AND ${this.daChave('cx.chave', c)}
      AND cx.codoperadora = ${c.op} AND cx.nropdv = ${c.pdv}
      AND cx.operacao <> 'DESCONTO' AND cx.operacao <> 'ACRESCIMO' AND cx.operacao <> 'SANGRIA' AND cx.operacao <> 'SUPRIMENTO'
      AND cx.idempresa = ${c.emp}`;
  }

  // ── turnos do dia ──────────────────────────────────────────────────────────────────────────────────────────────
  async turnos(data: string) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const emp = this.emp();
    const c: Ctx = { emp, tz: (await this.cfg(db, 'FUSO_HORARIO_ACESSO', emp)) ?? 'America/Sao_Paulo', data, chave: null, pdv: 0, op: 0 };
    // `SQL_Com_Chave` só com FECHAMENTO_CAIXA_SOMENTE_CHAVE='S' e nenhum movimento sem chave no dia (`Ucxaberto.pas:136`);
    // na produção a configuração é 'N' e vale sempre o `SQL_Sem_Chave`
    let comChave = false;
    if ((await this.cfg(db, 'FECHAMENTO_CAIXA_SOMENTE_CHAVE', emp)) === 'S') {
      const semChave = await sql`SELECT 1 FROM cx_vendas cx WHERE cx.idempresa = ${emp} AND ${this.noDia('cx.data', c)} AND cx.chave IS NULL LIMIT 1`.execute(db);
      comChave = !semChave.rows.length;
    }
    const ddmmyy = `${data.slice(8, 10)}${data.slice(5, 7)}${data.slice(2, 4)}`;
    const rows = (await sql<Record<string, unknown>>`
      SELECT cx.nropdv, o.nome, cx.codoperadora, cx.status, cx.tesouraria, p.codpdv, cx.chave,
             to_char(cp.horaentrada AT TIME ZONE ${c.tz}, 'YYYY-MM-DD HH24:MI:SS') AS horaentrada,
             to_char(cp.horasaida AT TIME ZONE ${c.tz}, 'YYYY-MM-DD HH24:MI:SS') AS horasaida, cx.idempresa
        FROM cx_vendas cx
        LEFT JOIN operadores o ON o.codoperador = cx.codoperadora
        LEFT JOIN pdv p ON p.nropdv = cx.nropdv AND p.codempresa = cx.idempresa
        LEFT JOIN caixa_pdv cp ON cp.chave = cx.chave AND cp.codpdv = cx.nropdv AND cx.idempresa = cp.idempresa
             ${comChave ? sql`` : sql`AND (cp.data AT TIME ZONE ${c.tz})::date = (cx.data AT TIME ZONE ${c.tz})::date`}
       WHERE cx.idempresa = ${emp} AND ${comChave ? sql`substr(cx.chave, 3, 6) = ${ddmmyy}` : this.noDia('cx.data', c)}
       GROUP BY cx.nropdv, o.nome, cx.codoperadora, cx.status, cx.tesouraria, p.codpdv, cx.chave, cp.horasaida, cp.horaentrada, cx.idempresa
       ORDER BY cx.nropdv, o.nome, cp.horaentrada, cp.horasaida`.execute(db)).rows;
    return rows.map((r) => {
      // sem HORAENTRADA (PDVs de autoatendimento), a hora sai da CHAVE: PDV(2) + ddmmyy + hhmiss (`Ucxaberto.pas:380-403`)
      let horaentrada = (r.horaentrada as string | null) ?? null;
      const ch = String(r.chave ?? '');
      let horaDaChave = false;
      if (!horaentrada && /^\d{14}$/.test(ch)) {
        horaentrada = `20${ch.slice(6, 8)}-${ch.slice(4, 6)}-${ch.slice(2, 4)} ${ch.slice(8, 10)}:${ch.slice(10, 12)}:${ch.slice(12, 14)}`;
        horaDaChave = true;
      }
      const situacao = r.tesouraria === 'S' ? 3 : r.status === 'F' ? 2 : 1;
      return {
        nropdv: num(r.nropdv), nome: r.nome ?? null, codoperadora: num(r.codoperadora), status: r.status ?? null, tesouraria: r.tesouraria ?? null,
        codpdv: r.codpdv == null ? null : num(r.codpdv), chave: r.chave ?? null, horaentrada, horaDaChave, horasaida: r.horasaida ?? null,
        idempresa: num(r.idempresa), situacao, fechadoNoPdv: r.horasaida != null,
      };
    });
  }

  // ── estado do turno ────────────────────────────────────────────────────────────────────────────────────────────
  private async situacaoDo(db: AnyDB, c: Ctx): Promise<number> {
    if (c.situacao) return c.situacao;
    const r = (await sql<{ aberto: boolean | null; tes: boolean | null; n: string }>`
      SELECT bool_or(cx.status IS NULL AND cx.tesouraria IS NULL) AS aberto, bool_or(cx.tesouraria = 'S') AS tes, count(*) AS n
        FROM cx_vendas cx WHERE ${this.turnoWhere(c)}`.execute(db)).rows[0];
    if (r?.aberto) return 1;
    if (r?.tes) return 3;
    return num(r?.n) > 0 ? 2 : 1;
  }

  private async formas(db: AnyDB, emp: number): Promise<Forma[]> {
    return ((await sql<Forma>`SELECT idpgto, upper(modalidade) AS modalidade, destino FROM formas_pgto WHERE idempresa = ${emp} ORDER BY idpgto`.execute(db)).rows)
      .map((f) => ({ idpgto: num(f.idpgto), modalidade: String(f.modalidade ?? ''), destino: f.destino ?? null }));
  }

  private async grade(db: AnyDB, c: Ctx, situacao: number) {
    return (await sql<Record<string, unknown>>`
      SELECT cx.codcxvendas, to_char(cx.data AT TIME ZONE ${c.tz}, 'YYYY-MM-DD HH24:MI:SS') AS data, cx.nropdv, cx.codoperadora,
             cx.nropedido, upper(cx.operacao) AS operacao, cx.debito_credito, cx.valor AS valorb, (cx.valor - coalesce(cx.troco, 0)) AS valor,
             cx.status, cx.codgrupo, cx.sangrias, cx.suprimentos, cx.tesouraria, o.nome, cx.troco, cx.coo, cx.chave,
             coalesce(cx.venda_balcao, 0) AS venda_balcao, cx.lanc_provisorio
        FROM cx_vendas cx LEFT JOIN operadores o ON o.codoperador = cx.codoperadora
       WHERE ${this.turnoWhere(c)} AND ${this.status(situacao)}
       ORDER BY cx.data, upper(cx.operacao), cx.codoperadora, cx.nropdv, cx.codcxvendas`.execute(db)).rows;
  }

  /** a grade da finalização (`cdsFechaVendas`, uFechamentoCaixa.pas:1948-1955): uma linha por operação */
  private async agrupado(db: AnyDB, c: Ctx, situacao: number) {
    return (await sql<Record<string, unknown>>`
      SELECT upper(cx.operacao) AS operacao, sum(coalesce(cx.valor, 0)) AS valorb, sum(coalesce(cx.troco, 0)) AS troco,
             sum((coalesce(cx.valor, 0) - coalesce(cx.troco, 0) - coalesce(cx.venda_balcao, 0)) - coalesce(cx.sangrias, 0) + coalesce(cx.suprimentos, 0)) AS valor,
             sum(coalesce(cx.venda_balcao, 0)) AS venda_balcao, sum(coalesce(cx.suprimentos, 0)) AS suprimento, sum(coalesce(cx.sangrias, 0)) AS sangria
        FROM cx_vendas cx
       WHERE ${this.turnoWhere(c)} AND ${this.status(situacao)}
       GROUP BY upper(cx.operacao)
       ORDER BY 4, 1`.execute(db)).rows;
  }

  /** o rascunho do turno (`AbreFinalizaFechamento :201-226`): com chave, todas as datas da chave; sem chave, o dia */
  private async rascunho(db: AnyDB, c: Ctx, consulta: boolean): Promise<{ linhas: LinhaFf[]; docs: Map<number, number[]> }> {
    const filtro = c.chave
      ? sql`f.chave = ${c.chave}`
      : sql`${consulta ? sql`` : sql`f.consolidado IS NULL AND`} f.chave IS NULL AND ${this.noDia('f.data', c)}`;
    const linhas = ((await sql<LinhaFf>`
      SELECT f.codifinfech, upper(f.operacao) AS operacao, f.vrreal, f.consolidado
        FROM finaliza_fechamento f
       WHERE f.operador = ${c.op} AND f.pdv = ${c.pdv} AND f.idempresa = ${c.emp} AND ${filtro}
       ORDER BY f.codifinfech`.execute(db)).rows).map((l) => ({ codifinfech: num(l.codifinfech), operacao: String(l.operacao ?? ''), vrreal: num(l.vrreal), consolidado: l.consolidado ?? null }));
    const docs = new Map<number, number[]>();
    if (linhas.length) {
      const rows = (await sql<{ codifinfech: string; codigo: string }>`
        SELECT d.codifinfech, d.codigo FROM doc_fechamento d JOIN finaliza_fechamento f ON f.codifinfech = d.codifinfech
         WHERE d.codifinfech = ANY(${linhas.map((l) => l.codifinfech)}::bigint[]) AND d.operacao = upper(f.operacao)
         ORDER BY d.coddocfeh`.execute(db)).rows;
      for (const r of rows) {
        const k = num(r.codifinfech);
        docs.set(k, [...(docs.get(k) ?? []), num(r.codigo)]);
      }
    }
    return { linhas, docs };
  }

  /** o CAIXA_PDV do turno (`FormShow :1668-1718`) */
  private async caixaPdv(db: AnyDB, c: Ctx) {
    const r = (await sql<Record<string, unknown>>`
      SELECT coalesce(sum(cancelamentos), 0) AS cancelamentos, coalesce(sum(recarga), 0) AS recarga, coalesce(sum(correspondente), 0) AS correspondente,
             coalesce(sum(voucher), 0) AS voucher, coalesce(sum(fundocaixa), 0) AS fundocaixa, coalesce(sum(sangria), 0) AS sangria
        FROM caixa_pdv cp
       WHERE cp.codoperadora = ${c.op} AND cp.codpdv = ${c.pdv} AND cp.idempresa = ${c.emp} AND ${this.noDia('cp.data', c)} AND ${this.daChave('cp.chave', c)}`
      .execute(db)).rows[0] ?? {};
    return { cancelamentos: num(r.cancelamentos), recarga: num(r.recarga), correspondente: num(r.correspondente), voucher: num(r.voucher), fundocaixa: num(r.fundocaixa), sangria: num(r.sangria) };
  }

  /** o total de HIST_SANGRIA_SUPRIMENTO por tipo × destino da forma (`GetTotalSangriaSuprimento :1468-1516`) */
  private async totaisSangria(db: AnyDB, c: Ctx) {
    const r = (await sql<Record<string, unknown>>`
      SELECT coalesce(sum(h.valor) FILTER (WHERE coalesce(h.tipo, 'SAN') = 'SAN' AND fp.destino = 'CXA'), 0) AS dinheiro,
             coalesce(sum(h.valor) FILTER (WHERE coalesce(h.tipo, 'SAN') = 'SAN' AND fp.destino = 'CHQ'), 0) AS cheque,
             coalesce(sum(h.valor) FILTER (WHERE coalesce(h.tipo, 'SAN') = 'SAN' AND fp.destino NOT IN ('CXA', 'CHQ')), 0) AS outras,
             coalesce(sum(h.valor) FILTER (WHERE coalesce(h.tipo, 'SAN') = 'SUP'), 0) AS suprimento,
             coalesce(sum(h.valor) FILTER (WHERE coalesce(h.tipo, 'SAN') = 'SAN'), 0) AS san
        FROM hist_sangria_suprimento h
        LEFT JOIN formas_pgto fp ON h.idpgto = fp.idpgto AND h.idempresa = fp.idempresa
       WHERE h.codoperador = ${c.op} AND h.codpdv = ${c.pdv} AND h.idempresa = ${c.emp} AND ${this.noDia('h.data', c)} AND ${this.daChave('h.chave', c)}`
      .execute(db)).rows[0] ?? {};
    return {
      tipo: { 'SANGRIA EM DINHEIRO': num(r.dinheiro), 'SANGRIA EM CHEQUE': num(r.cheque), 'OUTRAS SANGRIAS': num(r.outras), SUPRIMENTO: num(r.suprimento) } as Record<Fixa, number>,
      san: num(r.san), sup: num(r.suprimento),
    };
  }

  /** os adicionais do total (`GetTotalHist :1544-1562`) — só quando o CAIXA_PDV não os traz */
  private async totalHist(db: AnyDB, c: Ctx, tabela: string, colOperador: string, colValor: string, colData: string): Promise<number> {
    const r = (await sql<{ total: string | null }>`
      SELECT sum(coalesce(${sql.ref(`h.${colValor}`)}, 0)) AS total FROM ${sql.table(tabela)} h
       WHERE h.idempresa = ${c.emp} AND ${sql.ref(`h.${colOperador}`)} = ${c.op} AND h.codpdv = ${c.pdv}
         AND ${this.noDia(`h.${colData}`, c)} AND ${this.daChave('h.chave', c)}`.execute(db)).rows[0];
    return num(r?.total);
  }

  /** os descontos das vendas do turno (`CarregaDescontos :909-943`) — informativos */
  private async descontos(db: AnyDB, c: Ctx): Promise<number> {
    const r = (await sql<{ total: string | null }>`
      SELECT sum(coalesce(v.desc_acre_medio, 0) + coalesce(v.desc_acre_item, 0)) AS total FROM vendas v
       WHERE (coalesce(v.desc_acre_medio, 0) < 0 OR coalesce(v.desc_acre_item, 0) < 0)
         AND v.idempresa = ${c.emp} AND v.operador = ${c.op} AND v.nropedido LIKE ${`${String(c.pdv).padStart(2, '0')}%`}
         AND v.cancelado <> 'S' AND ${this.noDia('v.dtvenda', c)} AND ${this.daChave('v.chave', c)}`.execute(db)).rows[0];
    return num(r?.total);
  }

  // ── a montagem da tela ─────────────────────────────────────────────────────────────────────────────────────────
  private async montar(db: AnyDB, c: Ctx) {
    const situacao = await this.situacaoDo(db, c);
    const grade = await this.grade(db, c, situacao);
    const modo: 'fechamento' | 'consulta' = grade.length && grade[0].status == null ? 'fechamento' : 'consulta';
    const [agr, formas, rasc, cp, hist, emp] = await Promise.all([
      this.agrupado(db, c, situacao), this.formas(db, c.emp), this.rascunho(db, c, modo === 'consulta'), this.caixaPdv(db, c),
      this.totaisSangria(db, c),
      sql<{ validacaixa: string | null; filtrapdv: string | null }>`SELECT validacaixa, filtrapdv FROM empresas WHERE idempresa = ${c.emp}`.execute(db).then((r) => r.rows[0]),
    ]);
    const doRascunho = (op: string) => rasc.linhas.find((l) => l.operacao === op);
    let dinheiroLocalizado = false;
    const linhas = agr.map((g) => {
      const operacao = String(g.operacao ?? '');
      const f = formas.find((x) => x.modalidade === operacao);
      const tipo = tipoDe(f);
      const ff = doRascunho(operacao);
      const real = ff ? ff.vrreal : null;
      const valor = num(g.valor);
      // o REAL do dinheiro vai para a PRIMEIRA linha cujo nome começa com DINHEIRO (`Locate` parcial, :1109-1119)
      const linhaDinheiro = !dinheiroLocalizado && operacao.toUpperCase().startsWith('DINHEIRO');
      if (linhaDinheiro) dinheiroLocalizado = true;
      return {
        operacao, valorb: num(g.valorb), troco: num(g.troco), venda_balcao: num(g.venda_balcao), valor, real,
        saldo: r2((real ?? 0) - Math.abs(valor)), idpgto: f?.idpgto ?? null, destino: f?.destino ?? null, tipo, linhaDinheiro,
        documentos: ff ? rasc.docs.get(ff.codifinfech) ?? [] : [],
      };
    });

    // sangria e suprimento (`PreencheSangriaSuprimento :1525-1542`): o PDV sem histórico ganha a linha automática
    const inicial: Record<Fixa, number> = { 'SANGRIA EM DINHEIRO': cp.sangria, 'SANGRIA EM CHEQUE': 0, 'OUTRAS SANGRIAS': 0, SUPRIMENTO: cp.fundocaixa };
    const fixas = {} as Record<Fixa, number>;
    const pendentes: Array<{ fixa: Fixa; valor: number }> = [];
    for (const fx of FIXAS_FECHAMENTO) {
      const totalTipo = hist.tipo[fx];
      const totalStr = fx === 'SUPRIMENTO' ? hist.sup : hist.san;
      if (inicial[fx] > 0 && totalTipo === 0 && totalStr === 0 && modo !== 'consulta') {
        fixas[fx] = inicial[fx];
        pendentes.push({ fixa: fx, valor: inicial[fx] });
      } else {
        const sel = doRascunho(fx)?.vrreal ?? 0;
        fixas[fx] = sel > 0 ? sel : totalTipo;
      }
    }
    const recarga = cp.recarga || (await this.totalHist(db, c, 'hist_recarga', 'codoperadora', 'vl_recarga', 'data'));
    const correspondente = cp.correspondente || (await this.totalHist(db, c, 'hist_correspondente', 'codoperadora', 'vl_lancamento', 'data'));
    const voucher = cp.voucher || (await this.totalHist(db, c, 'hist_voucher', 'codoperador', 'valor', 'dtvenda'));
    const trocoSolidario = await this.totalHist(db, c, 'hist_troco_solidario', 'codoperador', 'valor', 'dtvenda');

    // a devolução em dinheiro: documentos DEV do rascunho com TIPO_DEVOLUCAO 'D' (`SetDevolucaoDinheiro :2571-2597`)
    const codDev = linhas.filter((l) => l.tipo === 'DEV').flatMap((l) => l.documentos);
    const devolucaoDinheiro = codDev.length
      ? num((await sql<{ t: string }>`SELECT sum(valor) AS t FROM hist_devolucao WHERE codhistdevolucao = ANY(${codDev}::int[]) AND coalesce(tipo_devolucao, 'V') = 'D'`.execute(db)).rows[0]?.t)
      : 0;

    const totalValor = r2(linhas.reduce((s, l) => s + l.valor, 0));
    const totalReal = r2(linhas.reduce((s, l) => s + (l.real ?? 0), 0));
    const totalFechamento = r2(totalValor + recarga + correspondente + voucher + trocoSolidario);
    const nome = (await sql<{ nome: string | null }>`SELECT nome FROM operadores WHERE codoperador = ${c.op}`.execute(db)).rows[0]?.nome ?? null;
    return {
      turno: { data: c.data, chave: c.chave, nropdv: c.pdv, codoperadora: c.op, nome, situacao, idempresa: c.emp },
      modo,
      grade: grade.map((g) => ({ ...g, operacao: String(g.operacao ?? ''), nropedido: (g.nropedido as string | null) ?? null, valorb: num(g.valorb), valor: num(g.valor), troco: g.troco == null ? null : num(g.troco), venda_balcao: num(g.venda_balcao) })),
      linhas,
      fixas,
      sangriaPendente: pendentes,
      dinheiroContado: doRascunho(CONTADO)?.vrreal ?? 0,
      contadoHabilitado: String(emp?.validacaixa ?? '') !== 'N',
      filtraPdv: String(emp?.filtrapdv ?? '') !== 'NAO',
      adicionais: { recarga, correspondente, voucher, trocoSolidario },
      cancelamentos: cp.cancelamentos,
      descontos: await this.descontos(db, c),
      totais: {
        valor: totalValor, real: totalReal, saldo: r2(linhas.reduce((s, l) => s + l.saldo, 0)), fechamento: totalFechamento,
        devolucaoDinheiro, diferenca: r2(totalReal - totalFechamento + devolucaoDinheiro),
      },
      rascunho: { linhas: rasc.linhas.length, documentos: [...rasc.docs.values()].reduce((s, d) => s + d.length, 0) },
    };
  }

  async detalhe(t: TurnoFechamentoDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    return this.montar(db, await this.contexto(db, t));
  }

  // ── abrir o turno para fechar ──────────────────────────────────────────────────────────────────────────────────
  async abrir(t: TurnoFechamentoDto) {
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.contexto(trx, t);
      const situacao = await this.situacaoDo(trx, c);
      c.situacao = 1;
      // só o turno que existe (o legado abre pela lista de turnos): sem movimento aberto, nada a completar
      const existe = situacao === 1
        && (await sql`SELECT 1 FROM cx_vendas cx WHERE ${this.turnoWhere(c)} AND ${this.status(1)} LIMIT 1`.execute(trx)).rows.length > 0;
      if (!existe) {
        c.situacao = t.situacao;
        return { ...(await this.montar(trx, c)), completadas: 0, sangriasInseridas: 0, ticketsCriados: 0 };
      }
      const operadorLogado = currentTenant().operadorId ?? null;
      // 1) completar o CX_VENDAS (`CX_abertos :1583-1601` + `UdmLancProv.pas:94-100`): uma linha zerada por modalidade da
      //    empresa (DESTINO <> 'QUE') que o turno não movimentou — a comparação é com a grade aberta, em maiúsculas
      const comp = await sql`
        INSERT INTO cx_vendas (data, nropdv, codoperadora, nropedido, operacao, debito_credito, valor, idempresa, chave,
                               lanc_provisorio, lanc_provisorio_data, lanc_provisorio_usuario)
        SELECT ${this.ini(c)}, ${c.pdv}, ${c.op}, '00000', f.modalidade, 'C', 0, ${c.emp}, ${c.chave}, 'S', now(), ${operadorLogado}
          FROM formas_pgto f
         WHERE f.idempresa = ${c.emp} AND f.destino <> 'QUE'
           AND NOT EXISTS (SELECT 1 FROM cx_vendas cx WHERE ${this.turnoWhere(c)} AND ${this.status(1)} AND upper(cx.operacao) = f.modalidade)
         ORDER BY f.idpgto`.execute(trx);
      const completadas = Number(comp.numAffectedRows ?? 0);

      // 2) a sangria/o suprimento do CAIXA_PDV sem histórico (`InsereSangriaSuprimento :1838-1874`). A forma é a única
      //    modalidade '%DINHEIRO%' da empresa: com mais de uma, o subselect do legado falha e a exceção é engolida.
      const antes = await this.montar(trx, c);
      let sangriasInseridas = 0;
      if (antes.sangriaPendente.length) {
        const din = (await sql<{ idpgto: number }>`SELECT idpgto FROM formas_pgto WHERE modalidade LIKE '%DINHEIRO%' AND idempresa = ${c.emp}`.execute(trx)).rows;
        if (din.length <= 1) {
          for (const p of antes.sangriaPendente) {
            await sql`
              INSERT INTO hist_sangria_suprimento (idempresa, data, idpgto, codpdv, descricao, valor, chave, codoperador, responsavel, tipo)
              VALUES (${c.emp}, ${this.ini(c)}, ${din[0]?.idpgto ?? null}, ${c.pdv}, 'Inserido automaticamente pelo fechamento de caixa',
                      ${p.valor}, ${c.chave}, ${c.op}, ${c.op}, ${p.fixa === 'SUPRIMENTO' ? 'SUP' : 'SAN'})`.execute(trx);
            sangriasInseridas++;
          }
        }
      }

      // 3) o TICKET que falta (`RealizaConf :2254-2280`): cada venda da modalidade TICKET com valor, sem ticket do pedido.
      //    O legado cria ao abrir o diálogo do ticket; aqui, ao abrir o turno — o estado final é o mesmo para quem confere.
      let ticketsCriados = 0;
      const formas = await this.formas(trx, c.emp);
      for (const l of antes.linhas.filter((x) => x.tipo === 'TICKET')) {
        const f = formas.find((x) => x.modalidade === l.operacao);
        if (!f) continue;
        const existentes = new Set((await this.listarDocs(trx, c, 'TICKET', f.idpgto, false, antes.filtraPdv)).map((d) => String(d.nropedido ?? '')));
        for (const g of antes.grade.filter((x) => x.operacao === f.modalidade)) {
          const ped = String(g.nropedido ?? '');
          if (existentes.has(ped) || !(num(g.valor) > 0)) continue;
          await sql`
            INSERT INTO ticket (data, valor, valorliq, codoperador, codpdv, nropedido, idempresa, idpgto, liberado, chave)
            VALUES (${this.ini(c)}, ${num(g.valorb)}, ${num(g.valor)}, ${c.op}, ${c.pdv}, ${g.nropedido ?? null}, ${c.emp}, ${f.idpgto}, 'N', ${c.chave})`.execute(trx);
          existentes.add(ped);
          ticketsCriados++;
        }
      }
      return { ...(await this.montar(trx, c)), completadas, sangriasInseridas, ticketsCriados };
    });
  }

  // ── documentos de uma operação ─────────────────────────────────────────────────────────────────────────────────
  /** os documentos candidatos (`UConsDocs`): empresa, PDV, operador, forma (ou DINHEIRO), não conciliados, chave, dia */
  private async listarDocs(db: AnyDB, c: Ctx, tipo: Exclude<TipoConferencia, 'DINHEIRO' | null>, idpgto: number, consulta: boolean, filtraPdv: boolean): Promise<Doc[]> {
    const pdvOp = (colPdv: string, colOp: string) =>
      filtraPdv ? sql`${c.pdv > 0 ? sql`AND ${sql.ref(colPdv)} = ${c.pdv}` : sql``} ${c.op > 0 ? sql`AND ${sql.ref(colOp)} = ${c.op}` : sql``}` : sql``;
    const forma = (col: string) => (filtraPdv ? sql`AND (${sql.ref(col)} = ${idpgto} OR g.modalidade = 'DINHEIRO')` : sql``);
    const naoConc = (col: string) => (filtraPdv && !consulta ? sql`AND ${sql.ref(col)} IS NULL` : sql``);
    const chave = (col: string) => (filtraPdv ? sql`AND ${this.daChave(col, c)}` : sql``);
    let rows: Array<Record<string, unknown>> = [];
    if (tipo === 'CARTAO') {
      rows = (await sql<Record<string, unknown>>`
        SELECT t.codvendcartao AS codigo, t.nrocupom, to_char(t.dtvenda AT TIME ZONE ${c.tz}, 'YYYY-MM-DD HH24:MI:SS') AS dtvenda, t.valor,
               t.codoperador, t.codpdv, o.operadora, t.codoperadora, t.nropedido, t.idpgto, t.liberado, t.consiliado, t.nroparcela, t.chave,
               t.nsu, t.nsuhost, t.autorizacao, t.codrede, t.obs
          FROM cartao t LEFT JOIN operadoras o ON o.codoperadoras = t.codoperadora LEFT JOIN formas_pgto g ON g.idpgto = t.idpgto
         WHERE t.idempresa = ${c.emp} ${pdvOp('t.codpdv', 't.codoperador')} ${forma('t.idpgto')} ${naoConc('t.consiliado')} ${chave('t.chave')}
           AND ${this.noDia('t.dtvenda', c)}
         ORDER BY t.nropedido, t.codvendcartao`.execute(db)).rows;
    } else if (tipo === 'RCB') {
      rows = (await sql<Record<string, unknown>>`
        SELECT r.codrcb AS codigo, r.nrocupom, to_char(r.dtvenda AT TIME ZONE ${c.tz}, 'YYYY-MM-DD HH24:MI:SS') AS dtvenda, r.valor,
               r.dtvenc, r.codoperador, r.codparceiro, r.codpdv, p.razao, r.obs, r.idpgto, r.quitada, r.consiliado, r.txjuros, r.chave, r.origem
          FROM areceber r LEFT JOIN parceiros p ON p.codparceiro = r.codparceiro LEFT JOIN formas_pgto g ON g.idpgto = r.idpgto
         WHERE r.codempresa = ${c.emp} ${pdvOp('r.codpdv', 'r.codoperador')} ${forma('r.idpgto')} ${naoConc('r.consiliado')} ${chave('r.chave')}
           AND ${this.noDia('r.dtvenda', c)}
         ORDER BY r.nrocupom, r.codrcb`.execute(db)).rows;
    } else if (tipo === 'CHQ') {
      rows = (await sql<Record<string, unknown>>`
        SELECT ch.codchq AS codigo, ch.nrocheque, ch.titular, to_char(ch.dtemissao AT TIME ZONE ${c.tz}, 'YYYY-MM-DD') AS dtemissao, ch.valor,
               ch.operador, ch.codpdv, ch.idpgto, ch.consiliado, ch.chave,
               CASE WHEN h.identificador IS NOT NULL THEN 'S' ELSE 'N' END AS sangria
          FROM cheque ch LEFT JOIN hist_sangria_suprimento h ON h.identificador = ch.identificador LEFT JOIN formas_pgto g ON g.idpgto = ch.idpgto
         WHERE ch.idempresa = ${c.emp} ${pdvOp('ch.codpdv', 'ch.operador')} ${forma('ch.idpgto')} ${naoConc('ch.consiliado')} ${chave('ch.chave')}
           AND ${this.noDia('ch.dtemissao', c)}
         ORDER BY ch.codchq`.execute(db)).rows;
    } else if (tipo === 'TICKET') {
      // o ticket não filtra a CHAVE (`sqqDocsTkt`) e confere pelo líquido
      rows = (await sql<Record<string, unknown>>`
        SELECT t.codticket AS codigo, to_char(t.data AT TIME ZONE ${c.tz}, 'YYYY-MM-DD') AS data, t.valor AS valorbruto, t.valorliq AS valor,
               t.nropedido, t.codpdv, t.idpgto, t.codoperador, t.liberado, t.consiliado
          FROM ticket t LEFT JOIN formas_pgto g ON g.idpgto = t.idpgto
         WHERE t.idempresa = ${c.emp} ${pdvOp('t.codpdv', 't.codoperador')} ${forma('t.idpgto')} ${naoConc('t.consiliado')}
           AND ${this.noDia('t.data', c)}
         ORDER BY t.nropedido, t.codticket`.execute(db)).rows;
    } else if (tipo === 'DEV') {
      rows = (await sql<Record<string, unknown>>`
        SELECT h.codhistdevolucao AS codigo, h.nropedido, h.nrodocumento, to_char(h.dtvenda AT TIME ZONE ${c.tz}, 'YYYY-MM-DD HH24:MI:SS') AS dtvenda,
               h.valor, h.codpdv, h.codoperador, coalesce(h.tipo_devolucao, 'V') AS tipo_devolucao, h.conciliado
          FROM hist_devolucao h
         WHERE h.idempresa = ${c.emp} ${pdvOp('h.codpdv', 'h.codoperador')} ${chave('h.chave')}
           ${filtraPdv && !consulta ? sql`AND coalesce(h.conciliado, 'N') <> 'S'` : sql``}
           AND ${this.noDia('h.dtvenda', c)}
         ORDER BY h.codhistdevolucao`.execute(db)).rows;
    }
    return rows.map((r) => ({ ...r, codigo: num(r.codigo), valor: num(r.valor) }));
  }

  /** os documentos da sangria/suprimento (`UConsDocs.pas:865-918`) — sempre todos marcados */
  private async docsSangria(db: AnyDB, c: Ctx, fx: Fixa, filtraPdv: boolean): Promise<Doc[]> {
    const destino = fx === 'SANGRIA EM DINHEIRO' ? sql`AND fp.destino = 'CXA'` : fx === 'SANGRIA EM CHEQUE' ? sql`AND fp.destino = 'CHQ'`
      : fx === 'OUTRAS SANGRIAS' ? sql`AND fp.destino NOT IN ('CXA', 'CHQ')` : sql``;
    const rows = (await sql<Record<string, unknown>>`
      SELECT h.codhistsangria AS codigo, to_char(h.data AT TIME ZONE ${c.tz}, 'YYYY-MM-DD HH24:MI:SS') AS data, h.descricao, h.nrodocumento, h.valor,
             h.idpgto, fp.modalidade, h.responsavel, h.tipo
        FROM hist_sangria_suprimento h LEFT JOIN formas_pgto fp ON h.idpgto = fp.idpgto AND h.idempresa = fp.idempresa
       WHERE h.idempresa = ${c.emp}
         ${filtraPdv ? sql`${c.pdv > 0 ? sql`AND h.codpdv = ${c.pdv}` : sql``} ${c.op > 0 ? sql`AND h.codoperador = ${c.op}` : sql``}
           AND ${this.daChave('h.chave', c)} AND h.tipo = ${fx === 'SUPRIMENTO' ? 'SUP' : 'SAN'} ${destino}` : sql``}
         AND ${this.noDia('h.data', c)}
       ORDER BY h.codhistsangria`.execute(db)).rows;
    return rows.map((r) => ({ ...r, codigo: num(r.codigo), valor: num(r.valor) }));
  }

  async documentos(t: TurnoFechamentoDto, operacaoBruta: string) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const c = await this.contexto(db, t);
    const operacao = String(operacaoBruta ?? '').trim().toUpperCase();
    const det = await this.montar(db, c);
    const consulta = det.modo === 'consulta';
    if ((FIXAS_FECHAMENTO as readonly string[]).includes(operacao)) {
      const docs = await this.docsSangria(db, c, operacao as Fixa, det.filtraPdv);
      return { operacao, tipo: 'SANGRIA' as const, modo: det.modo, marcacaoLivre: false, documentos: docs.map((d) => ({ ...d, sel: true })), conferido: r2(docs.reduce((s, d) => s + d.valor, 0)) };
    }
    const linha = det.linhas.find((l) => l.operacao === operacao);
    if (!linha) throw new BusinessRuleError('FECHAMENTO_OPERACAO_FORA_DO_TURNO', { operacao });
    if (!linha.tipo || linha.tipo === 'DINHEIRO' || linha.idpgto == null) {
      return { operacao, tipo: linha.tipo, modo: det.modo, marcacaoLivre: false, documentos: [], conferido: 0 };
    }
    const docs = await this.listarDocs(db, c, linha.tipo, linha.idpgto, consulta, det.filtraPdv);
    const marcados = new Set(linha.documentos);
    const lista = docs.map((d) => ({ ...d, sel: marcados.has(d.codigo) }));
    return {
      operacao, tipo: linha.tipo, destino: linha.destino, idpgto: linha.idpgto, modo: det.modo, marcacaoLivre: !consulta,
      documentos: lista, conferido: r2(lista.filter((d) => d.sel).reduce((s, d) => s + d.valor, 0)),
    };
  }

  // ── o rascunho ─────────────────────────────────────────────────────────────────────────────────────────────────
  async salvarRascunho(dto: RascunhoFechamentoDto) {
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.contexto(trx, dto);
      const det = await this.montar(trx, c);
      if (det.modo === 'consulta') throw new BusinessRuleError('FECHAMENTO_CAIXA_CONSULTA');
      c.situacao = det.turno.situacao;

      // a seleção de cada operação conferida (`RealizaConf` → `LimpaRetorno` + os marcados): vale só o documento listado
      const selecao = new Map<string, number[]>();
      const realDe = new Map<string, number>();
      for (const e of dto.documentos) {
        const operacao = e.operacao.trim().toUpperCase();
        const pedidos = new Set(e.codigos.map(Number));
        if ((FIXAS_FECHAMENTO as readonly string[]).includes(operacao)) {
          const docs = await this.docsSangria(trx, c, operacao as Fixa, det.filtraPdv);
          selecao.set(operacao, docs.filter((d) => pedidos.has(d.codigo)).map((d) => d.codigo));
          continue;
        }
        const linha = det.linhas.find((l) => l.operacao === operacao);
        if (!linha) throw new BusinessRuleError('FECHAMENTO_OPERACAO_FORA_DO_TURNO', { operacao });
        if (!linha.tipo || linha.tipo === 'DINHEIRO' || linha.idpgto == null) continue;
        const docs = (await this.listarDocs(trx, c, linha.tipo, linha.idpgto, false, det.filtraPdv)).filter((d) => pedidos.has(d.codigo));
        selecao.set(operacao, docs.map((d) => d.codigo));
        realDe.set(operacao, r2(docs.reduce((s, d) => s + d.valor, 0)));
      }

      // o dinheiro: REAL = contado + sangria em dinheiro − suprimento (`edtDinheiroContadoExit :1109-1119`)
      const contado = det.contadoHabilitado ? r2(Number(dto.dinheiroContado) || 0) : det.dinheiroContado;
      const valorDaLinha = (l: (typeof det.linhas)[number]): number => {
        if (realDe.has(l.operacao)) return realDe.get(l.operacao)!;
        if (l.linhaDinheiro && det.contadoHabilitado) return r2(contado + det.fixas['SANGRIA EM DINHEIRO'] - det.fixas.SUPRIMENTO);
        return l.real ?? 0;
      };

      // 1) as operações duplicadas saem inteiras (`ExcluiFinalizaFechamento :1262-1302`; sem chave não apaga nada)
      if (c.chave) {
        const dup = sql`SELECT f.codifinfech FROM finaliza_fechamento f
           WHERE f.operador = ${c.op} AND f.pdv = ${c.pdv} AND f.idempresa = ${c.emp} AND f.chave = ${c.chave} AND ${this.noDia('f.data', c)}
             AND f.operacao IN (SELECT g.operacao FROM finaliza_fechamento g
                                 WHERE g.operador = ${c.op} AND g.pdv = ${c.pdv} AND g.idempresa = ${c.emp} AND g.chave = ${c.chave} AND ${this.noDia('g.data', c)}
                                 GROUP BY g.operacao HAVING count(*) > 1)`;
        await sql`DELETE FROM doc_fechamento WHERE codifinfech IN (${dup})`.execute(trx);
        await sql`DELETE FROM finaliza_fechamento WHERE codifinfech IN (${dup})`.execute(trx);
      }

      // 2) as linhas: a grade (na ordem dela), as quatro de sangria/suprimento e o dinheiro contado — todas, mesmo zeradas
      const { linhas: ff } = await this.rascunho(trx, c, false);
      const gravar: Array<[string, number]> = [
        ...det.linhas.map((l) => [l.operacao, valorDaLinha(l)] as [string, number]),
        ...FIXAS_FECHAMENTO.map((fx) => [fx, det.fixas[fx]] as [string, number]),
        [CONTADO, contado],
      ];
      const idDe = new Map<string, number>();
      for (const [operacao, vrreal] of gravar) {
        const existente = ff.find((l) => l.operacao === operacao);
        const campos = { data: this.ini(c), operador: c.op, pdv: c.pdv, idempresa: c.emp, chave: c.chave, operacao, vrreal: r2(vrreal) };
        if (existente) {
          await trx.updateTable('finaliza_fechamento').set(campos).where('codifinfech', '=', existente.codifinfech).execute();
          idDe.set(operacao, existente.codifinfech);
        } else {
          const r = (await trx.insertInto('finaliza_fechamento').values(campos).returning('codifinfech').executeTakeFirstOrThrow()) as { codifinfech: unknown };
          idDe.set(operacao, num(r.codifinfech));
        }
      }

      // 3) os documentos das operações conferidas: entra o marcado que falta, sai o desmarcado (`:2112-2163`)
      for (const [operacao, codigos] of selecao) {
        const id = idDe.get(operacao) ?? ff.find((l) => l.operacao === operacao)?.codifinfech;
        if (id == null) continue;
        const ja = new Set(((await sql<{ codigo: string }>`SELECT codigo FROM doc_fechamento WHERE codifinfech = ${id} AND operacao = ${operacao}`.execute(trx)).rows).map((r) => num(r.codigo)));
        for (const cod of codigos) {
          if (ja.has(cod)) continue;
          await trx.insertInto('doc_fechamento').values({ codigo: cod, operacao, codifinfech: id }).execute();
        }
        await sql`DELETE FROM doc_fechamento WHERE codifinfech = ${id} AND operacao = ${operacao}
                   AND NOT (codigo = ANY(${codigos.length ? codigos : [-1]}::bigint[]))`.execute(trx);
      }
      return this.montar(trx, c);
    });
  }
}
