import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql, type RawBuilder } from 'kysely';
import type {
  EditarDocumentoFechamentoDto, EfetivarFechamentoDto, ExcluirDocumentoFechamentoDto, InserirDocumentoFechamentoDto, LancProvCabecalhoDto, LancProvExcluirDto,
  LancProvLinhaDto, RascunhoFechamentoDto, RelatorioFechamentoDto, TurnoFechamentoDto,
} from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { configNaTrx } from '../compras/pedido-heranca';
import { FechamentoContabilService, avisoDoErro, emSavepoint, type AvisoContabil } from './fechamento-contabil.service';
import { gravarLog, historicoDeGravacao } from '../../shared/log/registro-log';
import { LiberacaoService } from '../auth/liberacao.service';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
/** o FloatToStr / AsString de um float no Delphi pt-BR: "30", "31,5", "36,42" */
const floatToStr = (v: unknown) => String(Number(v ?? 0)).replace('.', ',');
/** duas casas com vírgula — o texto do cartão no HISTORICO da edição */
const dois = (v: unknown) => num(v).toFixed(2).replace('.', ',');
/** o AsString de um TDateTime: "dd/mm/aaaa" à meia-noite, senão "dd/mm/aaaa hh:nn:ss" ('YYYY-MM-DD HH24:MI:SS' de entrada) */
const dataHoraAsString = (v: string | null) => {
  if (!v) return '';
  const [d, h] = v.split(' ');
  const dia = d.split('-').reverse().join('/');
  return !h || h === '00:00:00' ? dia : `${dia} ${h}`;
};
/** as colunas do cartão que o diálogo grava (`sqqDocsCRT`) */
const CAMPOS_CARTAO = ['valor', 'codoperadora', 'nsu', 'nsuhost', 'autorizacao', 'codrede', 'nroparcela', 'obs'];
/** as listas de liberadores que o diálogo de documentos consulta */
type LiberacaoFechamento = 'USUARIOS_PERMITIDOS_EXCLUIR_DOCUMENTOS_FECHAMENTO' | 'USUARIOS_PERMITIDOS_ALTERAR_SUP_SAN_FECHAMENTO';
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
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly contabil: FechamentoContabilService,
    private readonly liberacao: LiberacaoService,
  ) {}

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

  /**
   * o turno já foi fechado NO PDV? (`TfrmFechamentoCaixa.CaixaFechadoNoPDV`, uFechamentoCaixa.pas): a primeira linha da CAIXA_PDV
   * do operador e do PDV — pela chave, ou sem chave no dia; com `FECHAMENTO_CAIXA_SOMENTE_CHAVE`='N' (a produção) também no dia —
   * com HORASAIDA. O legado não filtra a empresa (o parâmetro vem e não é usado).
   */
  private async caixaFechadoNoPdv(db: AnyDB, c: Ctx): Promise<boolean> {
    const porData = (await this.cfg(db, 'FECHAMENTO_CAIXA_SOMENTE_CHAVE', c.emp)) === 'N';
    const r = (await sql<{ fechado: boolean }>`SELECT (cp.horasaida IS NOT NULL) AS fechado FROM caixa_pdv cp
        WHERE cp.codoperadora = ${c.op} AND cp.codpdv = ${c.pdv} ${porData ? sql`AND ${this.noDia('cp.data', c)}` : sql``}
          AND ${c.chave ? sql`cp.chave = ${c.chave}` : sql`cp.chave IS NULL AND ${this.noDia('cp.data', c)}`}
        ORDER BY cp.codcaixa LIMIT 1`.execute(db)).rows[0];
    return !!r?.fechado;
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
      // o limite da diferença acima do qual a caixa "saldo do operador" é marcada sozinha (VerificaCheckGeralSaldo)
      limiteSaldo: Number(String((await this.cfg(db, 'LIMITE_LANCAR_SALDO_AUTOMATICAMENTE_FECHAMENTO', c.emp)) ?? '0').replace(',', '.')) || 0,
      filtraPdv: String(emp?.filtrapdv ?? '') !== 'NAO',
      // `OBRIGA_FECHAR_CAIXA_PDV`='S' e o turno sem HORASAIDA no PDV: abre, mas não efetiva (Ucxaberto.pas:466 — o
      // vbbPermissaoFechar). Na produção está 'N' desde 09/07/2026 (esteve 'S' de 07/05 a 09/07/2026).
      pdvNaoFechado: modo === 'fechamento' && (await this.cfg(db, 'OBRIGA_FECHAR_CAIXA_PDV', c.emp)) === 'S' && !(await this.caixaFechadoNoPdv(db, c)),
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
               to_char(r.dtvenc AT TIME ZONE ${c.tz}, 'YYYY-MM-DD') AS dtvenc, r.codoperador, r.codparceiro, r.codpdv, p.razao, r.obs, r.idpgto, r.quitada, r.consiliado, r.txjuros, r.chave, r.origem
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
      return {
        operacao, tipo: 'SANGRIA' as const, modo: det.modo, marcacaoLivre: false, documentos: docs.map((d) => ({ ...d, sel: true })),
        conferido: r2(docs.reduce((s, d) => s + d.valor, 0)), ...(await this.manutencaoSangria(db, c, det, operacao as Fixa)),
      };
    }
    const linha = det.linhas.find((l) => l.operacao === operacao);
    if (!linha) throw new BusinessRuleError('FECHAMENTO_OPERACAO_FORA_DO_TURNO', { operacao });
    if (!linha.tipo || linha.tipo === 'DINHEIRO' || linha.idpgto == null) {
      return { operacao, tipo: linha.tipo, modo: det.modo, marcacaoLivre: false, documentos: [], conferido: 0 };
    }
    const refechada = await this.cartoesDaRefechada(c, det, linha);
    const docs = await this.listarDocs(db, c, linha.tipo, linha.idpgto, consulta, det.filtraPdv);
    const marcados = new Set(linha.documentos);
    const lista = docs.map((d) => ({ ...d, sel: marcados.has(d.codigo) }));
    return {
      operacao, tipo: linha.tipo, destino: linha.destino, idpgto: linha.idpgto, modo: det.modo, marcacaoLivre: !consulta,
      ...(await this.manutencaoDocumentos(db, c, det, linha.tipo)),
      ...(refechada ? { cartoesCriados: refechada } : {}),
      documentos: lista, conferido: r2(lista.filter((d) => d.sel).reduce((s, d) => s + d.valor, 0)),
    };
  }

  /**
   * o CARTAO da refechada (`RealizaConf`, UfinalizaFechamento.pas:2440-2485; spec `uFechamentoCaixa-corte4-spec.md` §5). Ao abrir
   * os documentos de uma forma POS (DESTINO 'CRT', não TEF) de um turno REABERTO e ainda não refechado, o legado cria o CARTAO de
   * cada venda da CX_VENDAS que não acha na lista (`Locate('NROPEDIDO;VALOR')`) — o cartão que o reabrir deixou sem par. Mas
   * compara em ponto flutuante: 19,99, 23,99, 47,98… nunca casam, e cada reabertura do diálogo duplica de novo — 145 dos 154
   * criados em 2026 são duplicatas de cartão do PDV (nenhum selecionado, conciliado ou baixado). Aqui o casamento é o certo:
   * MULTICONJUNTO de (NROPEDIDO, centavos), criando só a falta — contando os já criados, então abrir de novo não cria nada
   * (idempotente; a trava do turno evita a corrida). Fora a linha '00000' e o valor zero. Resultado esperado em 2026: 7, não 154.
   * O gatilho "reaberto" é o HISTORICO "Reabertura do caixa…" da chave (o corte 3 grava) com o turno aberto — no legado era a
   * memória da tela (`ReabriuCaixa`), que não existe no web. CODOPERADORA vai NULO — o legado grava 0, que não existe em
   * OPERADORAS (mig 332); o operador reclassifica na edição. Grava ao abrir o diálogo, como o legado (`ApplyUpdates` na hora).
   */
  private async cartoesDaRefechada(c: Ctx, det: Awaited<ReturnType<FechamentoCaixaService['montar']>>, linha: { operacao: string; tipo: TipoConferencia; destino: string | null; idpgto: number | null }): Promise<number> {
    if (linha.tipo !== 'CARTAO' || linha.destino !== 'CRT' || det.modo !== 'fechamento' || !c.chave || linha.idpgto == null) return 0;
    const idpgto = linha.idpgto;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const reaberto = (await sql`SELECT 1 FROM historico WHERE tabela = 'CAIXA' AND auxiliar = ${c.chave} AND historico LIKE 'Reabertura do caixa %' LIMIT 1`.execute(trx)).rows.length > 0;
      if (!reaberto) return 0;
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`fechamento-refechada:${c.emp}:${c.chave}`}))`.execute(trx);
      const vendas = (await sql<{ nropedido: string | null; valor: unknown; chave: string | null }>`
        SELECT cx.nropedido, (cx.valor - coalesce(cx.troco, 0)) AS valor, cx.chave FROM cx_vendas cx
         WHERE ${this.turnoWhere(c)} AND ${this.status(1)} AND upper(cx.operacao) = ${linha.operacao}
           AND coalesce(cx.nropedido, '') <> '00000' AND cx.valor <> 0
         ORDER BY cx.codcxvendas`.execute(trx)).rows;
      const chave = (ped: unknown, v: unknown) => `${String(ped ?? '').trim()}|${Math.round(num(v) * 100)}`;
      const existentes = new Map<string, number>();
      for (const d of await this.listarDocs(trx, c, 'CARTAO', idpgto, false, det.filtraPdv)) {
        const k = chave(d.nropedido, d.valor);
        existentes.set(k, (existentes.get(k) ?? 0) + 1);
      }
      let criados = 0;
      for (const v of vendas) {
        const k = chave(v.nropedido, v.valor);
        const n = existentes.get(k) ?? 0;
        if (n > 0) { existentes.set(k, n - 1); continue; }
        await sql`INSERT INTO cartao (dtvenda, valor, codoperador, codoperadora, codpdv, nropedido, idempresa, idpgto, liberado, chave)
            VALUES (${this.ini(c)}, ${r2(num(v.valor))}, ${c.op}, NULL, ${c.pdv}, ${v.nropedido}, ${c.emp}, ${idpgto}, 'N', ${v.chave})`.execute(trx);
        criados++;
      }
      return criados;
    });
  }

  // ── a manutenção dos documentos no diálogo (corte 4) ─────────────────────────────────────────────────────────────
  /**
   * o que o diálogo deixa fazer (`UConsDocs.FormShow :1200-1245`; spec `uFechamentoCaixa-corte4-spec.md` §1). Na conferência,
   * editar, inserir e excluir; no turno já fechado, nada — a não ser com `USUARIOS_PERMITIDOS_EXCLUIR_DOCUMENTOS_FECHAMENTO`='S'
   * (o global da produção), que religa tudo; mas no turno fechado também no PDV (`CAIXA_PDV.HORASAIDA`, o `ControleManutencao='P'`)
   * só a edição, e no cartão só a operadora (`AjustarComponentesAcesso`). Aqui só o cartão e o A Receber se editam e inserem
   * (cheque, devolução e recarga manuais estão mortos, spec §10) e o ticket só se exclui. `DELETAR_DOCUMENTO_FCX` 'N'/vazio
   * desliga a exclusão ("Você não tem permissões para excluir documentos."); a produção tem 'S' no Módulo Retaguarda.
   */
  private async manutencaoDocumentos(db: AnyDB, c: Ctx, det: Awaited<ReturnType<FechamentoCaixaService['montar']>>, tipo: TipoConferencia | 'SANGRIA') {
    const nada = { edicao: null as 'completa' | 'operadora' | null, insercao: false, exclusao: false, liberacaoExclusao: false };
    if (tipo !== 'CARTAO' && tipo !== 'RCB' && tipo !== 'TICKET') return nada;
    const fechadoNoPdv = det.turno.situacao !== 1 && (await this.caixaFechadoNoPdv(db, c));
    let [editar, inserir, excluir] = det.modo === 'consulta' ? [false, false, false] : [true, true, true];
    if ((await this.cfg(db, 'USUARIOS_PERMITIDOS_EXCLUIR_DOCUMENTOS_FECHAMENTO', c.emp)) === 'S') {
      [editar, inserir, excluir] = fechadoNoPdv ? [true, false, false] : [true, true, true];
    }
    const exclusao = excluir && (await this.deletarFcx(db, c.emp));
    return {
      edicao: !editar || tipo === 'TICKET' ? null : tipo === 'CARTAO' && fechadoNoPdv ? 'operadora' as const : 'completa' as const,
      insercao: inserir && tipo !== 'TICKET',
      exclusao,
      liberacaoExclusao: exclusao && (await this.liberadores(db, 'USUARIOS_PERMITIDOS_EXCLUIR_DOCUMENTOS_FECHAMENTO')).length > 0,
    };
  }

  /** os usuários 'S' de uma lista de liberadores (`GetUsuariosPermitidos`) — com algum, a ação pede o login de um deles */
  private async liberadores(db: AnyDB, codigo: LiberacaoFechamento): Promise<number[]> {
    return ((await sql<{ chave: string }>`SELECT e.chave FROM configuracoes c JOIN configuracoes_especificas e ON e.id = c.id
        WHERE c.codigo = ${codigo} AND e.tipo = 'Usuario' AND e.valor = 'S'`.execute(db)).rows)
      .map((r) => Number(r.chave)).filter((n) => Number.isFinite(n));
  }

  /** `DELETAR_DOCUMENTO_FCX` 'N'/vazio desliga toda exclusão do diálogo (`TeclaDelete :1643`) */
  private async deletarFcx(db: AnyDB, emp: number): Promise<boolean> {
    return !['', 'N', 'NAO', 'NÃO'].includes(String((await this.cfg(db, 'DELETAR_DOCUMENTO_FCX', emp)) ?? '').trim().toUpperCase());
  }

  /**
   * sangria e suprimento no diálogo (`FormShow :865-918`): nunca se editam nem se marcam; inserir só na sangria em dinheiro e no
   * suprimento; excluir nas quatro; na consulta, nada (a `USUARIOS_PERMITIDOS_EXCLUIR_DOCUMENTOS_FECHAMENTO` não vale aqui). Inserir
   * pede SEMPRE um login: o de um liberador da `USUARIOS_PERMITIDOS_ALTERAR_SUP_SAN_FECHAMENTO` (13 na produção) ou, sem lista, o de
   * qualquer usuário (`ChamaLiberacaoLogin(nil)`); excluir pede só quando há lista.
   */
  private async manutencaoSangria(db: AnyDB, c: Ctx, det: Awaited<ReturnType<FechamentoCaixaService['montar']>>, fx: Fixa) {
    const consulta = det.modo === 'consulta';
    const insercao = !consulta && (fx === 'SANGRIA EM DINHEIRO' || fx === 'SUPRIMENTO');
    const exclusao = !consulta && (await this.deletarFcx(db, c.emp));
    const lista = (insercao || exclusao) ? await this.liberadores(db, 'USUARIOS_PERMITIDOS_ALTERAR_SUP_SAN_FECHAMENTO') : [];
    return {
      edicao: null, insercao, exclusao, liberacaoInsercao: insercao, liberacaoExclusao: exclusao && lista.length > 0,
      formasSangria: insercao && fx === 'SANGRIA EM DINHEIRO' ? await this.formasSangria(db, c.emp) : [],
    };
  }

  /** as formas da sangria em dinheiro (`PreencheTipoSangria`): PERMITE_SANGRIA_PDV 'S' e DESTINO CXA */
  private async formasSangria(db: AnyDB, emp: number): Promise<Array<{ idpgto: number; modalidade: string }>> {
    return ((await sql<{ idpgto: number; modalidade: string }>`SELECT idpgto, modalidade FROM formas_pgto
        WHERE coalesce(permite_sangria_pdv, 'N') = 'S' AND idempresa = ${emp} AND destino = 'CXA' ORDER BY idpgto`.execute(db)).rows)
      .map((f) => ({ idpgto: num(f.idpgto), modalidade: String(f.modalidade ?? '') }));
  }

  /** o turno, a linha da forma e o operador logado — o começo comum de editar, inserir e excluir */
  private async prepararManutencao(trx: AnyDB, dto: TurnoFechamentoDto & { operacao: string }) {
    const c = await this.contexto(trx, dto);
    const operacao = String(dto.operacao ?? '').trim().toUpperCase();
    const det = await this.montar(trx, c);
    const linha = det.linhas.find((l) => l.operacao === operacao);
    if (!linha) throw new BusinessRuleError('FECHAMENTO_OPERACAO_FORA_DO_TURNO', { operacao });
    if (!linha.tipo || !['CARTAO', 'RCB', 'TICKET'].includes(linha.tipo) || linha.idpgto == null) throw new BusinessRuleError('FECHAMENTO_DOCUMENTO_NAO_EDITAVEL', { operacao });
    const m = await this.manutencaoDocumentos(trx, c, det, linha.tipo);
    const logado = currentTenant().operadorId ?? null;
    const nomeLogado = String((await sql<{ nome: string | null }>`SELECT nome FROM operadores WHERE codoperador = ${logado}`.execute(trx)).rows[0]?.nome ?? '');
    const doc = async (codigo: number) => {
      const d = (await this.listarDocs(trx, c, linha.tipo as 'CARTAO' | 'RCB' | 'TICKET', linha.idpgto as number, true, det.filtraPdv)).find((x) => x.codigo === codigo);
      if (!d) throw new BusinessRuleError('FECHAMENTO_DOCUMENTO_FORA_DO_TURNO', { codigo });
      return d;
    };
    return { c, det, linha: linha as typeof linha & { tipo: 'CARTAO' | 'RCB' | 'TICKET'; idpgto: number }, m, logado, nomeLogado, doc, dataCx: c.data.split('-').reverse().join('/') };
  }

  /** o cliente do documento tem de existir no cadastro — o 0 "AO CONSUMIDOR" vale (`segCliente.IsEmpty`, UManipulaFin :335) */
  private async exigirCliente(trx: AnyDB, codparceiro: unknown) {
    if (codparceiro == null || codparceiro === '' || !(await sql`SELECT 1 FROM parceiros WHERE codparceiro = ${Number(codparceiro)}`.execute(trx)).rows.length) {
      throw new BusinessRuleError('FECHAMENTO_DOCUMENTO_SEM_CLIENTE');
    }
  }

  /** as validações do TFrmCadCartao (`btnGravarClick`, UcadCartao :314): valor não zero, até 200 parcelas, operadora existente */
  private async validarCartao(trx: AnyDB, v: Record<string, unknown>) {
    if (num(v.valor) === 0) throw new BusinessRuleError('CARTAO_VALOR_OBRIGATORIO');
    if (num(v.nroparcela) > 200) throw new BusinessRuleError('CARTAO_PARCELAS_MAXIMO');
    if (!num(v.codoperadora) || !(await sql`SELECT 1 FROM operadoras WHERE codoperadoras = ${num(v.codoperadora)}`.execute(trx)).rows.length) {
      throw new BusinessRuleError('CARTAO_OPERADORA_OBRIGATORIA');
    }
  }

  // ── editar ─────────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * `UConsDocs.AlteraDocs` (:2349). `NAO_ALTERAR_DOC_FECHAMENTO_CAIXA`='S' na produção é "permitido" (as edições seguiram no
   * mesmo ritmo depois de ligada): não pede senha. Rastro: o LOG "Lançamento de Cartões" (a tela completa) e o HISTORICO
   * `ALTERACAO DO DOCUMENTO <cupom>, VALOR: DE … PARA …, NO DIA <dia do caixa> DA ECF: <pdv>, FEITO PELO OPERADOR: <código> <nome>`.
   * ⚠️ divergência: o "DE" do cartão sai com o valor anterior — o legado o gravava vazio.
   */
  async editarDocumento(dto: EditarDocumentoFechamentoDto) {
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const { c, linha, m, logado, nomeLogado, doc: docDe, dataCx } = await this.prepararManutencao(trx, dto);
      if (!m.edicao) throw new BusinessRuleError('FECHAMENTO_CAIXA_CONSULTA');
      const doc = await docDe(dto.codigo);
      const soOperadora = m.edicao === 'operadora';
      const cupom = String(doc.nrocupom ?? '').trim() || '0';
      const campos = dto.campos ?? {};
      const hist = (tabela: string, de: string, para: string) => sql`INSERT INTO historico (coddoc, tabela, historico, data, codoperador, codempresa)
          VALUES (${cupom}, ${tabela}, ${`ALTERACAO DO DOCUMENTO ${cupom}, VALOR: DE ${de} PARA ${para}, NO DIA ${dataCx} DA ECF: ${c.pdv}, FEITO PELO OPERADOR: ${logado ?? ''} ${nomeLogado}`.slice(0, 600)},
                  current_date, ${logado}, ${c.emp})`.execute(trx);

      if (linha.tipo === 'CARTAO') {
        const antes = (await sql<Record<string, unknown>>`SELECT valor, codoperadora, nsu, nsuhost, autorizacao, codrede, nroparcela, obs FROM cartao
            WHERE codvendcartao = ${dto.codigo} FOR UPDATE`.execute(trx)).rows[0];
        const editaveis = soOperadora ? ['codoperadora'] : CAMPOS_CARTAO;
        const muda: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(campos)) {
          if (v === undefined || !CAMPOS_CARTAO.includes(k)) continue;
          const igual = String(antes[k] ?? '') === String(v ?? '') || (typeof v === 'number' && Number(antes[k]) === v);
          if (igual) continue;
          if (!editaveis.includes(k)) throw new BusinessRuleError('FECHAMENTO_DOCUMENTO_CAMPO_BLOQUEADO', { campo: k });
          muda[k] = v;
        }
        const novo = { ...antes, ...muda };
        await this.validarCartao(trx, novo);
        if (Object.keys(muda).length) {
          await trx.updateTable('cartao').set({ ...muda, dtultimalteracao: sql`now()`, usultalteracao: logado }).where('codvendcartao', '=', dto.codigo).execute();
          const h = historicoDeGravacao('Alterou', antes, novo);
          if (h) await gravarLog(trx, { acao: 'Alterou', formulario: 'Lançamento de Cartões', tabela: 'CARTAO', chave: 'CODVENDCARTAO', valor: dto.codigo, historico: h, idempresa: c.emp });
          await hist('CARTAO', dois(antes.valor), dois(novo.valor));
        }
        return { tipo: 'CARTAO', codigo: dto.codigo, alterados: Object.keys(muda), soOperadora };
      }
      if (linha.tipo !== 'RCB') throw new BusinessRuleError('FECHAMENTO_DOCUMENTO_NAO_EDITAVEL', { operacao: linha.operacao });

      // A Receber: valor, vencimento, cliente e obs
      const antes = (await sql<Record<string, unknown>>`SELECT valor, to_char(dtvenc AT TIME ZONE ${c.tz}, 'YYYY-MM-DD') AS dtvenc, codparceiro, obs FROM areceber
          WHERE codrcb = ${dto.codigo} FOR UPDATE`.execute(trx)).rows[0];
      const novo = {
        valor: campos.valor ?? num(antes.valor), dtvenc: campos.dtvenc ?? antes.dtvenc,
        codparceiro: campos.codparceiro ?? antes.codparceiro, obs: campos.obs ?? antes.obs,
      };
      await this.exigirCliente(trx, novo.codparceiro);
      if (num(novo.valor) === 0) throw new BusinessRuleError('FECHAMENTO_DOCUMENTO_VALOR');
      await sql`UPDATE areceber SET valor = ${r2(num(novo.valor))}, dtvenc = ${novo.dtvenc ? sql`((${novo.dtvenc}::date)::timestamp AT TIME ZONE ${c.tz})` : sql`dtvenc`},
                codparceiro = ${num(novo.codparceiro)}, obs = ${novo.obs ?? null}, usultalteracao = ${logado}, dtultimalteracao = now()
              WHERE codrcb = ${dto.codigo}`.execute(trx);
      await hist('ARECEBER', floatToStr(antes.valor), floatToStr(novo.valor));
      return { tipo: 'RCB', codigo: dto.codigo, alterados: Object.keys(campos).filter((k) => (campos as Record<string, unknown>)[k] !== undefined), soOperadora: false };
    });
  }

  // ── inserir ────────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * `UConsDocs` Insert (:1854-2235). O documento nasce no turno — DTVENDA = o dia do caixa, CODOPERADOR = o operador do caixa,
   * o PDV, a forma e a CHAVE — e desmarcado (SEL false: a conferência o marca). Rastro: a LOG ("Contas a receber"; o cartão pela
   * tela completa, "Lançamento de Cartões") e o HISTORICO `INCLUSAO DE DOCUMENTO , VALOR: <v>, NO DIA <d> DA ECF: <pdv>, FEITO PELO
   * OPERADOR: …` (CODDOC = o cupom, '0' se vazio; DATA = só a data; no A Receber o dia é o VENCIMENTO, o `edtData` do diálogo).
   * - A Receber: ORIGEM 'F', NROCUPOM '0', QUITADA 'N', TXJUROS = a TXJUROPADRAO da empresa; o cliente padrão é o 0 "AO CONSUMIDOR"
   *   (639 dos 643 de 2026) e o vencimento, o dia do caixa + `DATA_PROMISSORIA_AVULSA` (nula na produção).
   * - Cartão (a tela completa — `TELA_LANCTO_CARTAO_DOCTO_FINALIZADORAS`='C' na empresa 1): NROPARCELA 1, LIBERADO 'N', DTCADASTRO.
   */
  async inserirDocumento(dto: InserirDocumentoFechamentoDto) {
    const fixa = String(dto.operacao ?? '').trim().toUpperCase();
    if ((FIXAS_FECHAMENTO as readonly string[]).includes(fixa)) return this.inserirSangria(dto, fixa as Fixa);
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const { c, linha, m, logado, nomeLogado, dataCx } = await this.prepararManutencao(trx, dto);
      if (!m.insercao) throw new BusinessRuleError('FECHAMENTO_CAIXA_CONSULTA');
      const campos = dto.campos ?? {};
      const hist = (tabela: string, cupom: string, valor: unknown, dia: string) => sql`INSERT INTO historico (coddoc, tabela, historico, data, codoperador, codempresa)
          VALUES (${cupom}, ${tabela}, ${`INCLUSAO DE DOCUMENTO , VALOR: ${floatToStr(valor)}, NO DIA ${dia} DA ECF: ${c.pdv}, FEITO PELO OPERADOR: ${logado ?? ''} ${nomeLogado}`.slice(0, 600)},
                  current_date, ${logado}, ${c.emp})`.execute(trx);

      if (linha.tipo === 'RCB') {
        const valor = r2(num(campos.valor));
        if (valor === 0) throw new BusinessRuleError('FECHAMENTO_DOCUMENTO_VALOR');
        const codparceiro = campos.codparceiro ?? 0;
        await this.exigirCliente(trx, codparceiro);
        const dias = num(await this.cfg(trx, 'DATA_PROMISSORIA_AVULSA', c.emp));
        const dtvenc = campos.dtvenc ?? (await sql<{ d: string }>`SELECT to_char(${c.data}::date + ${dias > 0 ? dias : 0}::int, 'YYYY-MM-DD') AS d`.execute(trx)).rows[0].d;
        const txjuros = num((await sql<{ t: unknown }>`SELECT txjuropadrao AS t FROM empresas WHERE idempresa = ${c.emp}`.execute(trx)).rows[0]?.t);
        const r = (await sql<{ codrcb: number; dtcadastro: Date }>`
          INSERT INTO areceber (valor, dtvenc, codpdv, dtvenda, codoperador, codparceiro, codempresa, obs, idpgto, quitada, txjuros, chave, origem,
                                dtcadastro, nrocupom)
          VALUES (${valor}, ((${dtvenc}::date)::timestamp AT TIME ZONE ${c.tz}), ${c.pdv}, ${this.ini(c)}, ${c.op}, ${Number(codparceiro)}, ${c.emp},
                  ${campos.obs || null}, ${linha.idpgto}, 'N', ${txjuros}, ${c.chave}, 'F', now(), '0')
          RETURNING codrcb, dtcadastro`.execute(trx)).rows[0];
        const codrcb = Number(r.codrcb);
        const h = historicoDeGravacao('Inseriu', {}, {
          valor: floatToStr(valor), dtvenc, codpdv: c.pdv, dtvenda: c.data, codoperador: c.op, codparceiro: Number(codparceiro), codempresa: c.emp,
          obs: campos.obs || null, idpgto: linha.idpgto, quitada: 'N', codrcb, txjuros: floatToStr(txjuros), chave: c.chave, origem: 'F', dtcadastro: r.dtcadastro,
        });
        if (h) await gravarLog(trx, { acao: 'Inseriu', formulario: 'Contas a receber', tabela: 'ARECEBER', chave: 'CODRCB', valor: codrcb, historico: h, idempresa: c.emp });
        await hist('ARECEBER', '0', valor, dtvenc.split('-').reverse().join('/'));
        return { tipo: 'RCB', codigo: codrcb };
      }
      if (linha.tipo !== 'CARTAO') throw new BusinessRuleError('FECHAMENTO_DOCUMENTO_NAO_EDITAVEL', { operacao: linha.operacao });

      const novo: Record<string, unknown> = {
        valor: r2(num(campos.valor)), codoperadora: campos.codoperadora ?? null, nroparcela: campos.nroparcela ?? 1,
        nsu: campos.nsu || null, nsuhost: campos.nsuhost || null, autorizacao: campos.autorizacao || null, codrede: campos.codrede ?? null, obs: campos.obs || null,
      };
      await this.validarCartao(trx, novo);
      const cupom = String(campos.nrocupom ?? '').trim() || '0';
      const nropedido = String(campos.nropedido ?? '').trim() || null;
      const r = (await sql<{ codvendcartao: number }>`
        INSERT INTO cartao (nrocupom, nropedido, valor, codoperadora, idempresa, codoperador, liberado, nroparcela, idpgto, codpdv, chave, nsu, nsuhost,
                            autorizacao, codrede, obs, dtvenda, dtcadastro, usucadastro)
        VALUES (${cupom}, ${nropedido}, ${novo.valor}, ${num(novo.codoperadora)}, ${c.emp}, ${c.op}, 'N', ${num(novo.nroparcela)}, ${linha.idpgto}, ${c.pdv},
                ${c.chave}, ${novo.nsu}, ${novo.nsuhost}, ${novo.autorizacao}, ${novo.codrede}, ${novo.obs}, ${this.ini(c)}, now(), ${logado})
        RETURNING codvendcartao`.execute(trx)).rows[0];
      const codigo = Number(r.codvendcartao);
      const h = historicoDeGravacao('Inseriu', {}, {
        codvendcartao: codigo, nrocupom: String(campos.nrocupom ?? '').trim() || null, nropedido, valor: dois(novo.valor), codoperadora: num(novo.codoperadora), idempresa: c.emp,
        codoperador: c.op, liberado: 'N', nroparcela: num(novo.nroparcela), idpgto: linha.idpgto, codpdv: c.pdv, chave: c.chave, nsu: novo.nsu, nsuhost: novo.nsuhost,
        autorizacao: novo.autorizacao, codrede: novo.codrede, obs: novo.obs, dtvenda: c.data,
      });
      if (h) await gravarLog(trx, { acao: 'Inseriu', formulario: 'Lançamento de Cartões', tabela: 'CARTAO', chave: 'CODVENDCARTAO', valor: codigo, historico: h, idempresa: c.emp });
      await hist('CARTAO', cupom, novo.valor, dataCx);
      return { tipo: 'CARTAO', codigo };
    });
  }

  // ── excluir ────────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * `UConsDocs.TeclaDelete` (:1639). Com usuários 'S' na `USUARIOS_PERMITIDOS_EXCLUIR_DOCUMENTOS_FECHAMENTO` (1, 59 e 701 na produção),
   * pede o login de um deles (`ChamaLiberacaoLogin`; LOG_LIBERACOES "EXCLUIR DOCUMENTOS", 117 em 2026). HISTORICO `EXCLUSAO DO REGISTRO
   * <NROCUPOM|CODTICKET>: <doc>, VALOR: <v>, NO DIA <data> DA ECF: <pdv>, FEITO PELO OPERADOR: …` com AUXILIAR = a chave e DATA = agora
   * (a data do A Receber é o VENCIMENTO; a do cartão, a DTVENDA com a hora — o AsString do Delphi); depois o DELETE físico.
   */
  async excluirDocumento(dto: ExcluirDocumentoFechamentoDto) {
    const fixa = String(dto.operacao ?? '').trim().toUpperCase();
    if ((FIXAS_FECHAMENTO as readonly string[]).includes(fixa)) return this.excluirSangria(dto, fixa as Fixa);
    const liberadorNecessario = await this.liberadores(this.dbp.forTenantRead() as AnyDB, 'USUARIOS_PERMITIDOS_EXCLUIR_DOCUMENTOS_FECHAMENTO');
    let liberado = false;
    if (liberadorNecessario.length) {
      if (!dto.login || !dto.senha) throw new BusinessRuleError('FECHAMENTO_EXCLUSAO_LIBERACAO');
      // a liberação é gravada fora da transação, como no legado (o LOG_LIBERACOES fica mesmo se a exclusão falhar)
      liberado = (await this.liberacao.validar({ codigo: 'USUARIOS_PERMITIDOS_EXCLUIR_DOCUMENTOS_FECHAMENTO', login: dto.login, senha: dto.senha, liberacao: 'EXCLUIR DOCUMENTOS' })).liberado;
      if (!liberado) throw new BusinessRuleError('FECHAMENTO_EXCLUSAO_NAO_LIBERADA');
    }
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const { c, linha, m, logado, nomeLogado, doc: docDe } = await this.prepararManutencao(trx, dto);
      if (!m.exclusao) throw new BusinessRuleError((await this.deletarFcx(trx, c.emp)) ? 'FECHAMENTO_CAIXA_CONSULTA' : 'FECHAMENTO_EXCLUSAO_SEM_PERMISSAO');
      await docDe(dto.codigo);
      const alvo = linha.tipo === 'CARTAO'
        ? { tabela: 'CARTAO', campo: 'NROCUPOM', sqlDoc: sql`SELECT nrocupom AS doc, valor, codpdv, to_char(dtvenda AT TIME ZONE ${c.tz}, 'YYYY-MM-DD HH24:MI:SS') AS dia FROM cartao WHERE codvendcartao = ${dto.codigo} FOR UPDATE`, del: sql`DELETE FROM cartao WHERE codvendcartao = ${dto.codigo}` }
        : linha.tipo === 'RCB'
          ? { tabela: 'ARECEBER', campo: 'NROCUPOM', sqlDoc: sql`SELECT nrocupom AS doc, valor, codpdv, to_char(dtvenc AT TIME ZONE ${c.tz}, 'YYYY-MM-DD HH24:MI:SS') AS dia FROM areceber WHERE codrcb = ${dto.codigo} FOR UPDATE`, del: sql`DELETE FROM areceber WHERE codrcb = ${dto.codigo}` }
          : { tabela: 'TICKET', campo: 'CODTICKET', sqlDoc: sql`SELECT codticket::text AS doc, valor, codpdv, to_char(data AT TIME ZONE ${c.tz}, 'YYYY-MM-DD HH24:MI:SS') AS dia FROM ticket WHERE codticket = ${dto.codigo} FOR UPDATE`, del: sql`DELETE FROM ticket WHERE codticket = ${dto.codigo}` };
      const d = (await sql<{ doc: string | null; valor: unknown; codpdv: unknown; dia: string | null }>`${alvo.sqlDoc}`.execute(trx)).rows[0];
      const doc = String(d.doc ?? '').trim() || '0';
      await sql`INSERT INTO historico (coddoc, tabela, historico, data, codoperador, codempresa, auxiliar)
          VALUES (${doc}, ${alvo.tabela}, ${`EXCLUSAO DO REGISTRO ${alvo.campo}: ${doc}, VALOR: ${floatToStr(d.valor)}, NO DIA ${dataHoraAsString(d.dia)} DA ECF: ${d.codpdv ?? ''}, FEITO PELO OPERADOR: ${logado ?? ''} ${nomeLogado}`.slice(0, 600)},
                  (now() AT TIME ZONE ${c.tz}), ${logado}, ${c.emp}, ${c.chave})`.execute(trx);
      await sql`${alvo.del}`.execute(trx);
      return { tipo: linha.tipo, codigo: dto.codigo, excluido: true, liberado };
    });
  }

  // ── sangria e suprimento manuais ───────────────────────────────────────────────────────────────────────────────
  /**
   * inserir sangria/suprimento (`UConsDocs :2025-2150`; 133 sangrias e 24 suprimentos em 2026). O login (liberador ou, sem lista,
   * qualquer usuário) é o RESPONSÁVEL; com `ENVIA_SANGRIA_SUPRIMENTO_CONTA_FISCAL`='S' (Módulo Retaguarda na produção) o dinheiro
   * vai para a conta do fiscal (`PARCEIROS.CODCONTA` do liberador, `GetCodContaFiscal`) numa MOV_CONTAS_BANCARIAS — a sangria
   * entra (+, 'C', a forma escolhida), o suprimento sai (−, 'D', a forma DINHEIRO) —, ligada pelo IDENTIFICADOR_MOVCB. A linha da
   * HIST_SANGRIA_SUPRIMENTO leva o valor positivo, o operador do caixa, quem cadastrou e, no suprimento, IDPGTO 0. Sem LOG nem
   * HISTORICO de inclusão (o legado não grava). A liberação é gravada fora da transação, como no legado.
   */
  private async inserirSangria(dto: InserirDocumentoFechamentoDto, fx: Fixa) {
    if (fx !== 'SANGRIA EM DINHEIRO' && fx !== 'SUPRIMENTO') throw new BusinessRuleError('FECHAMENTO_DOCUMENTO_NAO_EDITAVEL', { operacao: fx });
    if (!dto.login || !dto.senha) throw new BusinessRuleError('FECHAMENTO_SANGRIA_LIBERACAO');
    const lista = await this.liberadores(this.dbp.forTenantRead() as AnyDB, 'USUARIOS_PERMITIDOS_ALTERAR_SUP_SAN_FECHAMENTO');
    const lib = await this.liberacao.validar({
      codigo: 'USUARIOS_PERMITIDOS_ALTERAR_SUP_SAN_FECHAMENTO', login: dto.login, senha: dto.senha,
      liberacao: lista.length ? 'USUÁRIO NÃO PERMITIDO A INSERIR REGISTROS' : '', qualquerUsuario: lista.length === 0,
    });
    if (!lib.liberado || !lib.codOperador) throw new BusinessRuleError('FECHAMENTO_SANGRIA_INSERIR_NAO_LIBERADO');
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.contexto(trx, dto);
      const det = await this.montar(trx, c);
      if (!(await this.manutencaoSangria(trx, c, det, fx)).insercao) throw new BusinessRuleError('FECHAMENTO_CAIXA_CONSULTA');
      const campos = dto.campos ?? {};
      const sangria = fx === 'SANGRIA EM DINHEIRO';
      const valor = r2(num(campos.valor));
      let forma: { idpgto: number; modalidade: string } | undefined;
      if (sangria) {
        const formas = await this.formasSangria(trx, c.emp);
        if (!formas.length) throw new BusinessRuleError('FECHAMENTO_SANGRIA_SEM_FORMA');
        forma = campos.idpgto != null ? formas.find((f) => f.idpgto === campos.idpgto) : formas[0];
        if (!forma) throw new BusinessRuleError('FECHAMENTO_SANGRIA_FORMA');
      }
      if (valor === 0) throw new BusinessRuleError('FECHAMENTO_DOCUMENTO_VALOR');
      const logado = currentTenant().operadorId ?? null;
      let identificador: string | null = null;
      if ((await this.cfg(trx, 'ENVIA_SANGRIA_SUPRIMENTO_CONTA_FISCAL', c.emp)) === 'S') {
        const conta = num((await sql<{ codconta: unknown }>`SELECT p.codconta FROM operadores o JOIN parceiros p ON p.codparceiro = o.codparceiro
            WHERE o.codoperador = ${lib.codOperador}`.execute(trx)).rows[0]?.codconta);
        if (!conta) throw new BusinessRuleError('FECHAMENTO_SANGRIA_SEM_CONTA_FISCAL');
        const idpgtoMcb = sangria ? forma!.idpgto : num((await sql<{ idpgto: unknown }>`SELECT idpgto FROM formas_pgto WHERE upper(modalidade) = 'DINHEIRO'
            AND idempresa = ${c.emp} ORDER BY idpgto LIMIT 1`.execute(trx)).rows[0]?.idpgto);
        identificador = `{${randomUUID().toUpperCase()}}`;
        const dataCx = c.data.split('-').reverse().join('/');
        await trx.insertInto('mov_contas_bancarias').values({
          codconta: conta, idempresa: c.emp, valor: sangria ? valor : -valor, tipomovimento: sangria ? 'C' : 'D', codopconta: 0, idpgto: idpgtoMcb || null,
          historico: `${sangria ? 'Sangria realizada ' : 'Suprimento realizado '}no caixa ${c.pdv}, no dia ${dataCx} através do fechamento de caixa`,
          dtemissao: c.data, dtvenc: c.data, dtliberacao: this.ini(c), liberado: 'S', coddestino: 0, contabilizado: 'N', chave: c.chave, identificador,
        }).execute();
      }
      const r = (await sql<{ codhistsangria: number }>`
        INSERT INTO hist_sangria_suprimento (idempresa, data, idpgto, codpdv, descricao, valor, chave, codoperador, responsavel, codoperador_cadastro,
                                             identificador_movcb, tipo)
        VALUES (${c.emp}, ${this.ini(c)}, ${sangria ? forma!.idpgto : 0}, ${c.pdv}, ${String(campos.descricao ?? '').slice(0, 100) || null}, ${valor}, ${c.chave},
                ${c.op}, ${lib.codOperador}, ${logado}, ${identificador}, ${sangria ? 'SAN' : 'SUP'})
        RETURNING codhistsangria`.execute(trx)).rows[0];
      return { tipo: 'SANGRIA', codigo: Number(r.codhistsangria), responsavel: lib.codOperador, identificadorMovcb: identificador };
    });
  }

  /**
   * excluir sangria/suprimento (`TeclaDelete :1653`): o login de um liberador da `USUARIOS_PERMITIDOS_ALTERAR_SUP_SAN_FECHAMENTO`
   * quando há lista (LOG_LIBERACOES "USUÁRIO NÃO PERMITIDO A EXCLUIR REGISTROS", 90 desde 2025); o HISTORICO "EXCLUSAO DO REGISTRO
   * CODHISTSANGRIA: …" com a chave no AUXILIAR; o DELETE e a MOV_CONTAS_BANCARIAS do IDENTIFICADOR_MOVCB (`ExcluiMovimentacaoBancaria`).
   */
  private async excluirSangria(dto: ExcluirDocumentoFechamentoDto, fx: Fixa) {
    const lista = await this.liberadores(this.dbp.forTenantRead() as AnyDB, 'USUARIOS_PERMITIDOS_ALTERAR_SUP_SAN_FECHAMENTO');
    let liberado = false;
    if (lista.length) {
      if (!dto.login || !dto.senha) throw new BusinessRuleError('FECHAMENTO_SANGRIA_LIBERACAO');
      liberado = (await this.liberacao.validar({ codigo: 'USUARIOS_PERMITIDOS_ALTERAR_SUP_SAN_FECHAMENTO', login: dto.login, senha: dto.senha, liberacao: 'USUÁRIO NÃO PERMITIDO A EXCLUIR REGISTROS' })).liberado;
      if (!liberado) throw new BusinessRuleError('FECHAMENTO_SANGRIA_EXCLUIR_NAO_LIBERADO');
    }
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.contexto(trx, dto);
      const det = await this.montar(trx, c);
      if (!(await this.manutencaoSangria(trx, c, det, fx)).exclusao) {
        throw new BusinessRuleError(det.modo === 'consulta' ? 'FECHAMENTO_CAIXA_CONSULTA' : 'FECHAMENTO_EXCLUSAO_SEM_PERMISSAO');
      }
      if (!(await this.docsSangria(trx, c, fx, det.filtraPdv)).some((d) => d.codigo === dto.codigo)) throw new BusinessRuleError('FECHAMENTO_DOCUMENTO_FORA_DO_TURNO', { codigo: dto.codigo });
      const h = (await sql<{ valor: unknown; codpdv: unknown; dia: string | null; identificador_movcb: string | null }>`SELECT valor, codpdv, identificador_movcb,
          to_char(data AT TIME ZONE ${c.tz}, 'YYYY-MM-DD HH24:MI:SS') AS dia FROM hist_sangria_suprimento WHERE codhistsangria = ${dto.codigo} FOR UPDATE`.execute(trx)).rows[0];
      const logado = currentTenant().operadorId ?? null;
      const nomeLogado = String((await sql<{ nome: string | null }>`SELECT nome FROM operadores WHERE codoperador = ${logado}`.execute(trx)).rows[0]?.nome ?? '');
      await sql`INSERT INTO historico (coddoc, tabela, historico, data, codoperador, codempresa, auxiliar)
          VALUES (${String(dto.codigo)}, 'HIST_SANGRIA_SUPRIMENTO',
                  ${`EXCLUSAO DO REGISTRO CODHISTSANGRIA: ${dto.codigo}, VALOR: ${floatToStr(h.valor)}, NO DIA ${dataHoraAsString(h.dia)} DA ECF: ${h.codpdv ?? ''}, FEITO PELO OPERADOR: ${logado ?? ''} ${nomeLogado}`.slice(0, 600)},
                  (now() AT TIME ZONE ${c.tz}), ${logado}, ${c.emp}, ${c.chave})`.execute(trx);
      await sql`DELETE FROM hist_sangria_suprimento WHERE codhistsangria = ${dto.codigo}`.execute(trx);
      const mcb = h.identificador_movcb ? (await sql`DELETE FROM mov_contas_bancarias WHERE identificador = ${h.identificador_movcb}`.execute(trx)).numAffectedRows : 0n;
      return { tipo: 'SANGRIA', codigo: dto.codigo, excluido: true, liberado, movimentacoes: Number(mcb ?? 0) };
    });
  }

  // ── o lançamento provisório (UlancProv, BTNLANCPROV) ──────────────────────────────────────────────────────────
  /**
   * O LANÇAMENTO PROVISÓRIO (`TfrmLanProv`, UlancProv.pas; `DMLancProv`): a ferramenta de suporte para acertar um turno à mão —
   * na produção, 14 linhas em 2025 e 1 em 2026, todas do usuário 1 (ajustes entre modalidades, ex.: DINHEIRO −68,23 / CARTOES
   * +68,23), e 133 cabeçalhos DADOSCX desde 2020 só com o fiscal. As linhas são as de CX_VENDAS abertas do dia, do PDV e do
   * operador (`cdsLancProv`: sem filtrar a chave, como o legado); cada modalidade digitada vira uma linha '00000' com o fiscal,
   * LANC_PROVISORIO 'S', a data e o usuário (`cdsLancProvNewRecord`). O cabeçalho é a DADOSCX do dia × PDV (o código interno)
   * × operador. Os ramos de sangria e suprimento do diálogo não são usados na produção (spec §3) e ficam de fora.
   */
  private async ctxLancProv(db: AnyDB, t: TurnoFechamentoDto) {
    const c = await this.contexto(db, t);
    const codpdv = (await sql<{ codpdv: number }>`SELECT codpdv FROM pdv WHERE nropdv = ${c.pdv} AND codempresa = ${c.emp} ORDER BY codpdv LIMIT 1`.execute(db)).rows[0]?.codpdv ?? null;
    return { c, codpdv: codpdv == null ? null : Number(codpdv) };
  }

  private async linhasLancProv(db: AnyDB, c: Ctx) {
    return ((await sql<Record<string, unknown>>`
      SELECT cx.codcxvendas, upper(cx.operacao) AS operacao, cx.valor, coalesce(cx.sangrias, 0) AS sangrias, coalesce(cx.suprimentos, 0) AS suprimentos,
             cx.nropedido, cx.lanc_provisorio, cx.codfiscalcaixa
        FROM cx_vendas cx
       WHERE ${this.noDia('cx.data', c)} AND cx.nropdv = ${c.pdv} AND cx.codoperadora = ${c.op} AND cx.status IS NULL AND cx.idempresa = ${c.emp}
       ORDER BY cx.codcxvendas`.execute(db)).rows).map((r) => ({
      codcxvendas: Number(r.codcxvendas), operacao: String(r.operacao ?? ''), valor: num(r.valor), sangrias: num(r.sangrias), suprimentos: num(r.suprimentos),
      nropedido: r.nropedido ?? null, provisorio: r.lanc_provisorio === 'S', codfiscalcaixa: r.codfiscalcaixa == null ? null : Number(r.codfiscalcaixa),
    }));
  }

  async lancamentoProvisorio(t: TurnoFechamentoDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const { c, codpdv } = await this.ctxLancProv(db, t);
    const cab = codpdv == null ? undefined : (await sql<Record<string, unknown>>`
      SELECT d.coddadoscx, d.codfiscalcaixa, op.nome AS fiscal, d.gtinicial, d.gtfinal, d.vendab, d.vendal, d.cancelamentos, d.descontos
        FROM dadoscx d LEFT JOIN operadores op ON op.codoperador = d.codfiscalcaixa
       WHERE d.data::date = ${c.data}::date AND d.codpdv = ${codpdv} AND d.codoperador = ${c.op} ORDER BY d.coddadoscx LIMIT 1`.execute(db)).rows[0];
    const linhas = await this.linhasLancProv(db, c);
    const total = r2(linhas.reduce((s, l) => s + l.valor + l.sangrias - l.suprimentos, 0));
    const formas = (await sql<{ modalidade: string }>`SELECT DISTINCT upper(modalidade) AS modalidade FROM formas_pgto WHERE idempresa = ${c.emp} ORDER BY 1`.execute(db)).rows.map((f) => f.modalidade);
    return {
      cabecalho: cab ? {
        codfiscalcaixa: cab.codfiscalcaixa == null ? null : Number(cab.codfiscalcaixa), fiscal: cab.fiscal ?? null, gtinicial: cab.gtinicial == null ? null : num(cab.gtinicial),
        gtfinal: cab.gtfinal == null ? null : num(cab.gtfinal), vendab: cab.vendab == null ? null : num(cab.vendab), vendal: cab.vendal == null ? null : num(cab.vendal),
        cancelamentos: cab.cancelamentos == null ? null : num(cab.cancelamentos), descontos: cab.descontos == null ? null : num(cab.descontos),
      } : null,
      linhas, total, formas,
      // "Efetivar lançamento" só confere (`btnFechaClick`): Σ(VALOR + SANGRIAS − SUPRIMENTOS) contra a venda líquida
      confere: cab ? total === r2(num(cab.vendal)) : total === 0,
    };
  }

  /** o cabeçalho (DADOSCX): a venda bruta = GT final − GT inicial e a líquida = bruta − descontos − cancelamentos (`edtgtfinalExit`/`edtdescExit`) */
  async gravarCabecalhoLancProv(dto: LancProvCabecalhoDto) {
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const { c, codpdv } = await this.ctxLancProv(trx, dto);
      if (codpdv == null) throw new BusinessRuleError('FECHAMENTO_PDV_NAO_CADASTRADO', { pdv: c.pdv, empresa: c.emp });
      if (dto.codfiscalcaixa != null && !(await sql`SELECT 1 FROM operadores WHERE codoperador = ${dto.codfiscalcaixa}`.execute(trx)).rows.length) {
        throw new BusinessRuleError('FECHAMENTO_FISCAL_INEXISTENTE');
      }
      const vendab = dto.gtfinal == null && dto.gtinicial == null ? null : r2(num(dto.gtfinal) - num(dto.gtinicial));
      const vendal = vendab == null && dto.descontos == null && dto.cancelamentos == null ? null : r2(num(vendab) - num(dto.descontos) - num(dto.cancelamentos));
      const existe = (await sql<{ coddadoscx: number }>`SELECT coddadoscx FROM dadoscx WHERE data::date = ${c.data}::date AND codpdv = ${codpdv} AND codoperador = ${c.op}
          ORDER BY coddadoscx LIMIT 1 FOR UPDATE`.execute(trx)).rows[0];
      const valores = { codfiscalcaixa: dto.codfiscalcaixa ?? null, gtinicial: dto.gtinicial ?? null, gtfinal: dto.gtfinal ?? null, vendab, vendal,
        cancelamentos: dto.cancelamentos ?? null, descontos: dto.descontos ?? null };
      if (existe) await trx.updateTable('dadoscx').set(valores).where('coddadoscx', '=', existe.coddadoscx).execute();
      else await trx.insertInto('dadoscx').values({ ...valores, data: sql`${c.data}::date`, codpdv, codoperador: c.op }).execute();
      return this.lancamentoProvisorioNaTrx(trx, c);
    });
  }

  /** uma modalidade (`edtValorExit`): valor diferente de zero, a modalidade do cadastro e o fiscal obrigatório */
  async inserirLinhaLancProv(dto: LancProvLinhaDto) {
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.contexto(trx, dto);
      const operacao = String(dto.operacao).trim().toUpperCase();
      if (r2(num(dto.valor)) === 0) throw new BusinessRuleError('FECHAMENTO_DOCUMENTO_VALOR');
      if (!(await sql`SELECT 1 FROM formas_pgto WHERE idempresa = ${c.emp} AND upper(modalidade) = ${operacao}`.execute(trx)).rows.length) {
        throw new BusinessRuleError('FECHAMENTO_MODALIDADE_INEXISTENTE', { operacao });
      }
      if (!(await sql`SELECT 1 FROM operadores WHERE codoperador = ${dto.codfiscalcaixa}`.execute(trx)).rows.length) throw new BusinessRuleError('FECHAMENTO_FISCAL_INEXISTENTE');
      await sql`INSERT INTO cx_vendas (data, nropdv, codoperadora, codfiscalcaixa, nropedido, operacao, debito_credito, valor, chave, coo, gnf, idempresa,
                                       lanc_provisorio, lanc_provisorio_data, lanc_provisorio_usuario)
          VALUES (${this.ini(c)}, ${c.pdv}, ${c.op}, ${dto.codfiscalcaixa}, '00000', ${operacao}, 'C', ${r2(num(dto.valor))}, ${c.chave}, 0, 0, ${c.emp},
                  'S', now(), ${currentTenant().operadorId ?? null})`.execute(trx);
      return this.lancamentoProvisorioNaTrx(trx, c);
    });
  }

  /** remover uma linha da grade ("Deseja remover está modalidade?", Del) — qualquer linha aberta do turno, como o legado */
  async excluirLinhaLancProv(dto: LancProvExcluirDto) {
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.contexto(trx, dto);
      if (!(await this.linhasLancProv(trx, c)).some((l) => l.codcxvendas === dto.codcxvendas)) throw new BusinessRuleError('FECHAMENTO_DOCUMENTO_FORA_DO_TURNO', { codigo: dto.codcxvendas });
      await sql`DELETE FROM cx_vendas WHERE codcxvendas = ${dto.codcxvendas}`.execute(trx);
      return this.lancamentoProvisorioNaTrx(trx, c);
    });
  }

  private async lancamentoProvisorioNaTrx(trx: AnyDB, c: Ctx) {
    const linhas = await this.linhasLancProv(trx, c);
    return { linhas, total: r2(linhas.reduce((s, l) => s + l.valor + l.sangrias - l.suprimentos, 0)) };
  }

  // ── os diálogos de leitura: cancelamentos (F5) e descontos (F6) ────────────────────────────────────────────────
  /**
   * CANCELAMENTOS do turno (Enter em "Cancelamentos", `edtCancelamentosKeyDown` UfinalizaFechamento.pas:1019; `frmCuponsFiscais`):
   * os cupons cancelados (VENDAS CANCELADO 'S' / TIPOCANC 'C', uma linha por pedido, com o motivo e o responsável do HISTORICO_PDV)
   * e os itens cancelados (TIPOCANC 'I', com o produto e o total líquido da linha). Duas versões, como o legado:
   * - `FECHAMENTO_CAIXA_SOMENTE_CHAVE`='N' (a produção) ou turno sem chave: o dia, o operador e a chave (`sqqCupomT` do .dfm —
   *   o motivo do cupom sem filtrar o tipo);
   * - senão, só a chave — a do cancelamento quando houver (`GetSQLCupomTChaveTurno`, motivo do CANC_V), sem operador nem dia.
   * O ROWNUM <= 1 sem ordem do Oracle vira o primeiro registro (menor IDHISTORICO).
   */
  async cancelamentos(t: TurnoFechamentoDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const c = await this.contexto(db, t);
    const pdv = `${String(c.pdv).padStart(2, '0')}%`;
    const porData = !c.chave || (await this.cfg(db, 'FECHAMENTO_CAIXA_SOMENTE_CHAVE', c.emp)) === 'N';
    const cupons = (await sql<Record<string, unknown>>`
      SELECT v.nrocupom, substr(v.nropedido, 1, 2) AS pdv, v.nropedido,
             (SELECT h.motivo FROM historico_pdv h WHERE h.nropedido = v.nropedido ${porData ? sql`` : sql`AND h.tipo = 'CANC_V'`}
               ORDER BY h.idhistorico LIMIT 1) AS motivo,
             sum(v.qtde) AS qtde, sum(v.qtde * v.vrvenda) AS total,
             (SELECT h.responsavel FROM historico_pdv h WHERE h.nropedido = v.nropedido AND h.tipo = 'CANC_V' ORDER BY h.idhistorico LIMIT 1) AS responsavel
        FROM vendas v
       WHERE v.nropedido LIKE ${pdv} AND v.idempresa = ${c.emp} AND v.cancelado = 'S' AND v.tipocanc = 'C'
         AND ${porData ? sql`${this.noDia('v.dtvenda', c)} AND v.operador = ${c.op} AND ${this.daChave('v.chave', c)}` : sql`coalesce(v.chave_cancelamento, v.chave) = ${c.chave}`}
       GROUP BY v.nrocupom, substr(v.nropedido, 1, 2), v.nropedido
       ORDER BY v.nrocupom, substr(v.nropedido, 1, 2)`.execute(db)).rows;
    const itens = (await sql<Record<string, unknown>>`
      SELECT v.nrocupom, v.nroitem, v.vrvenda, v.qtde, v.codproduto, p.codbarra, p.descricao,
             (CASE WHEN v.iat = 'A' THEN round(v.qtde * v.vrvenda, 2) ELSE trunc(v.qtde * v.vrvenda * 100) / 100 END)
             + (greatest(coalesce(v.desc_acre_medio, 0), 0) + greatest(coalesce(v.desc_acre_item, 0), 0))
             - (coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0)
                + greatest(-coalesce(v.desc_acre_medio, 0), 0) + greatest(-coalesce(v.desc_acre_item, 0), 0)) AS total,
             (SELECT h.motivo FROM historico_pdv h WHERE h.nropedido = v.nropedido AND h.nroitem = v.nroitem ORDER BY h.idhistorico LIMIT 1) AS motivo,
             (SELECT h.responsavel FROM historico_pdv h WHERE h.nropedido = v.nropedido AND h.nroitem = v.nroitem ORDER BY h.idhistorico LIMIT 1) AS responsavel
        FROM vendas v JOIN produtos p ON p.idproduto = v.codproduto
       WHERE v.cancelado = 'S' AND v.tipocanc = 'I' AND ${porData ? sql`${this.noDia('v.dtvenda', c)} AND` : sql``}
             v.nropedido LIKE ${pdv} AND v.idempresa = ${c.emp} AND v.operador = ${c.op} AND ${this.daChave('v.chave', c)}
       ORDER BY v.nrocupom, v.nroitem`.execute(db)).rows;
    return {
      cupons: cupons.map((r) => ({ nrocupom: r.nrocupom, pdv: r.pdv, nropedido: r.nropedido, motivo: r.motivo ?? null, qtde: num(r.qtde), total: r2(num(r.total)), responsavel: r.responsavel ?? null })),
      itens: itens.map((r) => ({
        nrocupom: r.nrocupom, nroitem: r.nroitem, vrvenda: num(r.vrvenda), qtde: num(r.qtde), codproduto: r.codproduto, codbarra: r.codbarra ?? null,
        descricao: r.descricao ?? null, total: r2(num(r.total)), motivo: r.motivo ?? null, responsavel: r.responsavel ?? null,
      })),
    };
  }

  /**
   * VENDAS COM DESCONTOS do turno (Enter em "Descontos"/F6, `TFrmRelVendasComDescontos`, URelVendasComDescontos.pas:48-142):
   * por cupom × produto, a soma do desconto (DESC_ACRE_MEDIO + DESC_ACRE_ITEM, só as linhas com algum negativo), o RESPONSÁVEL
   * (o último DESC_I do item no HISTORICO_PDV; no desconto do cupom, o último DESC_V/DESC_C; sem registro, o operador) e o MOTIVO
   * (o último com motivo). Venda não cancelada ('N'), do dia, do operador, do PDV e da chave. Vazio: "Não foram encontrados
   * descontos nas vendas.".
   */
  async descontosDoTurno(t: TurnoFechamentoDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const c = await this.contexto(db, t);
    const ultimo = (campo: 'responsavel' | 'motivo', item: boolean) => sql`(SELECT ${sql.ref(`h.${campo}`)} FROM historico_pdv h
        WHERE h.nropedido = v.nropedido AND h.idempresa = v.idempresa ${item ? sql`AND h.nroitem = v.nroitem AND h.tipo = 'DESC_I'` : sql`AND h.tipo IN ('DESC_V', 'DESC_C')`}
          ${campo === 'motivo' ? sql`AND h.motivo IS NOT NULL` : sql``}
        ORDER BY h.idhistorico DESC LIMIT 1)`;
    const rows = (await sql<Record<string, unknown>>`
      SELECT cur.nrocupom, cur.codbarra, cur.descricao, cur.codproduto, sum(cur.desc_acre_medio + cur.desc_acre_item) AS desconto, cur.responsavel, cur.motivo
        FROM (SELECT v.nrocupom, p.codbarra, v.descricao, v.codproduto, coalesce(v.desc_acre_medio, 0) AS desc_acre_medio, coalesce(v.desc_acre_item, 0) AS desc_acre_item,
                     CASE WHEN coalesce(v.desc_acre_item, 0) < 0 THEN coalesce(${ultimo('responsavel', true)}, o.nome)
                          WHEN coalesce(v.desc_acre_medio, 0) < 0 THEN coalesce(${ultimo('responsavel', false)}, o.nome)
                          ELSE o.nome END AS responsavel,
                     CASE WHEN coalesce(v.desc_acre_item, 0) < 0 THEN ${ultimo('motivo', true)}
                          WHEN coalesce(v.desc_acre_medio, 0) < 0 THEN ${ultimo('motivo', false)} END AS motivo
                FROM vendas v JOIN operadores o ON o.codoperador = v.operador JOIN produtos p ON p.idproduto = v.codproduto
               WHERE (coalesce(v.desc_acre_medio, 0) < 0 OR coalesce(v.desc_acre_item, 0) < 0)
                 AND ${this.noDia('v.dtvenda', c)} AND v.idempresa = ${c.emp} AND v.operador = ${c.op}
                 AND v.nropedido LIKE ${`${String(c.pdv).padStart(2, '0')}%`} AND v.cancelado = 'N' AND ${this.daChave('v.chave', c)}) cur
       GROUP BY cur.nrocupom, cur.codbarra, cur.descricao, cur.codproduto, cur.responsavel, cur.motivo
       ORDER BY cur.nrocupom, cur.descricao`.execute(db)).rows;
    return rows.map((r) => ({
      nrocupom: r.nrocupom, codbarra: r.codbarra ?? null, descricao: r.descricao ?? null, codproduto: r.codproduto, desconto: r2(num(r.desconto)),
      responsavel: r.responsavel ?? null, motivo: r.motivo ?? null,
    }));
  }

  // ── o relatório "Fechamento de caixa" (MontaRel) ─────────────────────────────────────────────────────────────
  /**
   * O RELATÓRIO "FECHAMENTO DE CAIXA" (`TDmFechamentoCaixa.MontaRel`, UdmFechamentoCaixa.pas:760-996; FechamentoCaixa.fr3; spec
   * `uFechamentoCaixa-impressoes-spec.md` §e). Por turno × recurso: a VENDA (CX_VENDAS menos troco e venda balcão, mais as 3 linhas
   * de recarga/correspondente/voucher da CAIXA_PDV — saem 0,00 na produção, por paridade) contra o CAIXA gravado pelo fechamento
   * (plano de contas `tpconta` 0) e a divergência (caixa − venda sem a venda balcão; venda sem caixa ⇒ −venda). SANGRIA e
   * SUPRIMENTO não viram linha: vão para o rodapé do grupo, com o desconto das vendas e os cancelamentos da CAIXA_PDV. O grupo é
   * operador + PDV (sem a chave: dois turnos do mesmo operador no mesmo PDV somam). Totais por recurso de todos os grupos.
   * O turno é a chave (e o dia, com `FECHAMENTO_CAIXA_SOMENTE_CHAVE`='N' — a produção) ou, sem chave, o dia.
   * Como o legado: o recurso que só existe no CAIXA (a QUEBRA DE CAIXA) não casa com venda nenhuma e fica fora — incluí-lo zeraria
   * a divergência que o relatório existe para mostrar; os ramos da CAIXA_PDV não filtram a empresa. Fora (mortos, com prova):
   * tesouraria (0 linhas), "DEVOLUÇÃO EM DINHEIRO" (nenhuma forma DEV), a variante Balcão. O rótulo da sangria é "Sangria:" (a tela
   * principal do legado o trocava por "Divergência Vendas p/ Tesouraria").
   */
  async relatorioFechamento(dto: RelatorioFechamentoDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const emp = this.emp();
    const tz = (await this.cfg(db, 'FUSO_HORARIO_ACESSO', emp)) ?? 'America/Sao_Paulo';
    const porData = (await this.cfg(db, 'FECHAMENTO_CAIXA_SOMENTE_CHAVE', emp)) === 'N';
    const turnos = dto.turnos.map((t) => ({ pdv: t.nropdv, op: t.codoperadora, chave: t.chave ? String(t.chave).trim() || null : null }));
    for (const t of turnos) {
      if (!(await sql`SELECT 1 FROM pdv WHERE nropdv = ${t.pdv} AND codempresa = ${emp}`.execute(db)).rows.length) {
        throw new BusinessRuleError('FECHAMENTO_RELATORIO_PDV', { pdv: t.pdv, empresa: emp });
      }
    }
    const ctx = (t: { pdv: number; op: number; chave: string | null }): Ctx => ({ emp, tz, data: dto.data, chave: t.chave, pdv: t.pdv, op: t.op });
    // o filtro do turno (`FC:1315-1326` / `CXA:207-285`): a chave (e o dia, com FiltraData) ou, sem chave, o dia
    const doTurno = (colChave: string, colData: string, c: Ctx) =>
      c.chave ? sql`${sql.ref(colChave)} = ${c.chave} ${porData ? sql`AND ${this.noDia(colData, c)}` : sql``}` : sql`${sql.ref(colChave)} IS NULL AND ${this.noDia(colData, c)}`;

    type Linha = { chave: string | null; recurso: string; venda: number; vendaDiv: number; caixa: number; div: number; casou: boolean };
    type Grupo = { codoperadora: number; nome: string; nropdv: number; obs: string | null; linhas: Linha[]; sangria: number; suprimento: number; desconto: number; cancelamentos: number };
    const grupos = new Map<string, Grupo>();
    for (const t of turnos) {
      const c = ctx(t);
      const vendas = (await sql<{ recurso: string; nome: string | null; venda: unknown; venda_div: unknown; sangria: unknown; suprimento: unknown }>`
        SELECT upper(cx.operacao) AS recurso, max(o.nome) AS nome, sum(cx.valor - coalesce(cx.troco, 0) - coalesce(cx.venda_balcao, 0)) AS venda,
               sum(cx.valor - coalesce(cx.troco, 0)) AS venda_div,
               sum(CASE WHEN cx.operacao = 'SANGRIA' THEN cx.valor ELSE 0 END) AS sangria, sum(CASE WHEN cx.operacao = 'SUPRIMENTO' THEN cx.valor ELSE 0 END) AS suprimento
          FROM cx_vendas cx LEFT JOIN operadores o ON o.codoperador = cx.codoperadora
         WHERE cx.idempresa = ${emp} AND cx.operacao <> 'DESCONTO' AND cx.operacao <> 'ACRESCIMO'
           AND cx.nropdv = ${t.pdv} AND cx.codoperadora = ${t.op} AND ${doTurno('cx.chave', 'cx.data', c)}
         GROUP BY upper(cx.operacao)
        UNION ALL
        SELECT r.recurso, max(o.nome), sum(r.valor), sum(r.valor), 0, 0
          FROM caixa_pdv cp LEFT JOIN operadores o ON o.codoperador = cp.codoperadora
         CROSS JOIN LATERAL (VALUES ('RECARGA', coalesce(cp.recarga, 0)), ('CORRESPONDENTE', coalesce(cp.correspondente, 0)), ('VOUCHER', coalesce(cp.voucher, 0))) r(recurso, valor)
         WHERE cp.codpdv = ${t.pdv} AND cp.codoperadora = ${t.op} AND ${doTurno('cp.chave', 'cp.data', c)}
         GROUP BY r.recurso`.execute(db)).rows;
      if (!vendas.length) continue;
      const caixa = new Map(((await sql<{ recurso: string; caixa: unknown }>`
        SELECT upper(cx.tiporecurso) AS recurso, sum(cx.valor) AS caixa FROM caixa cx JOIN plc p ON p.codplc = cx.codplc AND p.tpconta = 0
         WHERE cx.idempresa = ${emp} AND cx.codpdv = ${t.pdv} AND cx.operador = ${t.op} AND ${doTurno('cx.chave', 'cx.data', c)}
         GROUP BY upper(cx.tiporecurso)`.execute(db)).rows).map((r) => [r.recurso, num(r.caixa)]));
      const k = `${t.op}|${t.pdv}`;
      const nome = String(vendas.find((v) => v.nome)?.nome ?? '');
      let g = grupos.get(k);
      if (!g) {
        const obs = (await sql<{ obs: string | null }>`SELECT obs FROM caixa_obs WHERE codoperador = ${t.op} AND nropdv = ${t.pdv} AND data::date = ${dto.data}::date
            AND coalesce(obs, '') <> '' LIMIT 1`.execute(db)).rows[0]?.obs ?? null;
        g = { codoperadora: t.op, nome, nropdv: t.pdv, obs, linhas: [], sangria: 0, suprimento: 0, desconto: 0, cancelamentos: 0 };
        grupos.set(k, g);
      }
      for (const v of vendas) {
        if (v.recurso === 'SANGRIA' || v.recurso === 'SUPRIMENTO') {
          g.sangria = r2(g.sangria + num(v.sangria));
          g.suprimento = r2(g.suprimento + num(v.suprimento));
          continue;
        }
        const cx = caixa.get(v.recurso);
        const venda = r2(num(v.venda));
        // os ramos da CAIXA_PDV no CAIXA têm chave nula e nunca casam (spec e.5): a divergência sai pela regra da venda sem caixa
        const casou = cx != null && !['RECARGA', 'CORRESPONDENTE', 'VOUCHER'].includes(v.recurso);
        const caixaV = casou ? r2(cx!) : 0;
        let div = casou ? r2(caixaV - num(v.venda_div)) : 0;
        if (venda > 0 && caixaV === 0 && div === 0) div = r2(-venda);
        g.linhas.push({ chave: t.chave, recurso: v.recurso, venda, vendaDiv: r2(num(v.venda_div)), caixa: caixaV, div, casou });
      }
    }
    // desconto das vendas e cancelamentos da CAIXA_PDV por operador + PDV, de todos os turnos escolhidos (QryDescontos/QryCancelamentos)
    for (const g of grupos.values()) {
      const dos = turnos.filter((t) => t.op === g.codoperadora && t.pdv === g.nropdv);
      for (const t of dos) {
        const c = ctx(t);
        g.desconto = r2(g.desconto + num((await sql<{ total: unknown }>`SELECT sum(coalesce(v.desc_acre_medio, 0) + coalesce(v.desc_acre_item, 0)) AS total FROM vendas v
            WHERE (coalesce(v.desc_acre_medio, 0) < 0 OR coalesce(v.desc_acre_item, 0) < 0) AND v.idempresa = ${emp} AND v.cancelado <> 'S'
              AND v.nropedido LIKE ${`${String(t.pdv).padStart(2, '0')}%`} AND v.operador = ${t.op} AND ${doTurno('v.chave', 'v.dtvenda', c)}`.execute(db)).rows[0]?.total));
        g.cancelamentos = r2(g.cancelamentos + num((await sql<{ total: unknown }>`SELECT sum(coalesce(cp.cancelamentos, 0)) AS total FROM caixa_pdv cp
            WHERE coalesce(cp.cancelamentos, 0) > 0 AND cp.idempresa = ${emp} AND cp.codpdv = ${t.pdv} AND cp.codoperadora = ${t.op}
              AND ${doTurno('cp.chave', 'cp.data', c)}`.execute(db)).rows[0]?.total));
      }
    }
    const lista = [...grupos.values()].sort((a, b) => String(a.nropdv).localeCompare(String(b.nropdv)) || a.codoperadora - b.codoperadora);
    const porRecurso = new Map<string, { recurso: string; venda: number; caixa: number; div: number }>();
    const saida = lista.map((g) => {
      g.linhas.sort((a, b) => String(a.chave ?? '').localeCompare(String(b.chave ?? '')) || a.recurso.localeCompare(b.recurso));
      for (const l of g.linhas) {
        const t = porRecurso.get(l.recurso) ?? { recurso: l.recurso, venda: 0, caixa: 0, div: 0 };
        t.venda = r2(t.venda + l.venda); t.caixa = r2(t.caixa + l.caixa); t.div = r2(t.div + l.div);
        porRecurso.set(l.recurso, t);
      }
      const totalVenda = r2(g.linhas.reduce((s2, l) => s2 + l.venda, 0));
      const totalCaixa = r2(g.linhas.reduce((s2, l) => s2 + l.caixa, 0));
      return {
        codoperadora: g.codoperadora, nome: g.nome, nropdv: g.nropdv, obs: g.obs,
        linhas: g.linhas.map((l) => ({ chave: l.chave, recurso: l.recurso, venda: l.venda, caixa: l.caixa, div: l.div })),
        totalVenda, totalCaixa, divergencia: r2(totalCaixa - totalVenda), sangria: g.sangria, suprimento: g.suprimento, desconto: g.desconto, cancelamentos: g.cancelamentos,
      };
    });
    const empresa = (await sql<Record<string, unknown>>`SELECT razao_social, fantasia, cnpj, insc, fone1 FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0] ?? {};
    const soma = (f: (g: typeof saida[number]) => number) => r2(saida.reduce((s2, g) => s2 + f(g), 0));
    return {
      data: dto.data.split('-').reverse().join('/'),
      empresa: { razao: empresa.razao_social ?? null, fantasia: empresa.fantasia ?? null, cnpj: empresa.cnpj ?? null, insc: empresa.insc ?? null, fone: empresa.fone1 ?? null },
      grupos: saida,
      totais: [...porRecurso.values()].sort((a, b) => a.recurso.localeCompare(b.recurso)),
      total: {
        venda: soma((g) => g.totalVenda), caixa: soma((g) => g.totalCaixa), divergencia: soma((g) => g.divergencia),
        sangria: soma((g) => g.sangria), suprimento: soma((g) => g.suprimento), desconto: soma((g) => g.desconto), cancelamentos: soma((g) => g.cancelamentos),
      },
    };
  }

  // ── impressões (corte 4) ───────────────────────────────────────────────────────────────────────────────────────
  /**
   * o COMPROVANTE DE QUEBRA DE CAIXA (`ImprimeComprovanteQuebraCaixa`, UdmFechamentoCaixa.pas:705; `FDQSaldoOperador` no .dfm;
   * "Comprovante de quebra de caixa.fr3"): um por SALDO_OPERADOR do turno não excluído e com GERA_SALDO. Não filtra o sinal —
   * imprime também a sobra (o valor sai negativo, como o `FormatFloat('0.00', SALDO * (-1))` do legado). Sem linha, a tela diz
   * "Não foram encontradas quebras de caixa no dia dd/mm/aaaa.".
   */
  async comprovanteQuebra(t: TurnoFechamentoDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const c = await this.contexto(db, t);
    const rows = (await sql<{ idsaldoop: number; nome: string | null; codpdv: number; dia: string; saldo: unknown }>`
      SELECT s.idsaldoop, op.nome, s.codpdv, to_char(s.datafechamento, 'DD/MM/YYYY') AS dia, s.saldo
        FROM saldo_operador s JOIN operadores op ON op.codoperador = s.codoperador
       WHERE s.codoperador = ${c.op} AND s.datafechamento = ${c.data}::date AND s.codpdv = ${c.pdv}
         AND coalesce(s.excluido, 'N') = 'N' AND coalesce(s.gera_saldo, 'S') = 'S'
         AND ${c.chave ? sql`s.chave = ${c.chave}` : sql`s.chave IS NULL`}
       ORDER BY s.idsaldoop`.execute(db)).rows;
    return {
      data: c.data.split('-').reverse().join('/'),
      quebras: rows.map((r) => {
        const valor = r2(-num(r.saldo));
        return {
          idsaldoop: Number(r.idsaldoop), nome: r.nome ?? '', codpdv: Number(r.codpdv), dia: r.dia, saldo: num(r.saldo), valor,
          texto: `Eu, ${r.nome ?? ''}, reconheço a quebra de caixa do PDV ${r.codpdv}, no dia ${r.dia}, no valor de ${valor.toFixed(2).replace('.', ',')} reais.`,
        };
      }),
    };
  }

  /**
   * o HISTÓRICO do turno (`ImprimeHistorico`, UdmFechamentoCaixa.pas:730; `sqqHistorico`; "Rel_Historico_Finalizadoras.fr3" —
   * "Histórico de alterações do fechamento de caixa"): o HISTORICO da empresa com AUXILIAR = a chave do turno, na ordem de
   * gravação, com o nome de quem fez (JOIN em OPERADORES: linha sem operador não sai, como no legado). ⚠️ correção: sem chave,
   * o legado pegava TODO o HISTORICO de AUXILIAR nulo da empresa; aqui fica o do dia do caixa.
   */
  async historicoTurno(t: TurnoFechamentoDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const c = await this.contexto(db, t);
    const rows = (await sql<{ codhist: number; historico: string | null; data: string | null; nome: string | null }>`
      SELECT s.codhist, s.historico, to_char(s.data, 'YYYY-MM-DD HH24:MI:SS') AS data, op.nome
        FROM historico s JOIN operadores op ON op.codoperador = s.codoperador
       WHERE s.codempresa = ${c.emp}
         AND ${c.chave ? sql`s.auxiliar = ${c.chave}` : sql`s.auxiliar IS NULL AND s.data::date = ${c.data}::date`}
       ORDER BY s.codhist`.execute(db)).rows;
    return rows.map((r) => ({ codhist: Number(r.codhist), data: dataHoraAsString(r.data), historico: r.historico ?? '', usuario: r.nome ?? '' }));
  }

  // ── o rascunho ─────────────────────────────────────────────────────────────────────────────────────────────────
  async salvarRascunho(dto: RascunhoFechamentoDto) {
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.contexto(trx, dto);
      return this.gravarRascunho(trx, c, dto);
    });
  }

  /** o rascunho dentro de uma transação aberta — o salvar da tela e o primeiro passo do efetivar */
  private async gravarRascunho(trx: AnyDB, c: Ctx, dto: RascunhoFechamentoDto) {
    {
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
    }
  }

  // ── EFETIVAR (corte 2) ─────────────────────────────────────────────────────────────────────────────────────────
  /**
   * `btnFechaClick` (UfinalizaFechamento.pas:234-895; dossiê "CORTE 2"). Numa transação: o rascunho com a seleção; as
   * validações do legado na ordem; o título do troco solidário/recarga/correspondente/voucher (`LancaApagar`); por linha
   * da grade com REAL > 0 a CAIXA 'FECHAMENTO' (CC do par PDV × forma em CONTACORRENTE), o MCB 'FCP' e os HISTORICOs; a
   * CONTACORRENTEOP de toda linha; com diferença, SALDO_OPERADOR — e, na quebra com o saldo marcado, o título A Receber
   * 'Q' e a CAIXA da quebra; as marcas nos documentos conferidos; o CX_VENDAS vai a F/tesouraria com o grupo; e o
   * CONSOLIDADO do rascunho (só no fechamento do mesmo dia, como o legado). A integração contábil é o corte 3.
   * Guarda que o legado não tem: o turno é travado e tem de estar aberto (3 chaves foram fechadas duas vezes em 2026).
   */
  async efetivar(dto: EfetivarFechamentoDto) {
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.contexto(trx, dto);
      const emp = c.emp;
      const logado = currentTenant().operadorId ?? null;
      const chaveOuDia = c.chave ? sql`cx.chave = ${c.chave}` : sql`cx.chave IS NULL AND ${this.noDia('cx.data', c)}`;
      const abertos = (await sql`SELECT cx.codcxvendas FROM cx_vendas cx
          WHERE ${chaveOuDia} AND cx.nropdv = ${c.pdv} AND cx.codoperadora = ${c.op} AND cx.status IS NULL AND cx.idempresa = ${emp}
          FOR UPDATE`.execute(trx)).rows;
      if (!abertos.length) throw new BusinessRuleError('FECHAMENTO_CAIXA_CONSULTA');
      c.situacao = 1;

      // o rascunho com a seleção da tela — é dele que saem o REAL e os documentos (o legado grava ao fechar a tela)
      const det = await this.gravarRascunho(trx, c, dto);
      if (det.modo === 'consulta') throw new BusinessRuleError('FECHAMENTO_CAIXA_CONSULTA');
      if (det.pdvNaoFechado) throw new BusinessRuleError('FECHAMENTO_PDV_NAO_FECHADO');
      const cfg = (k: string) => this.cfg(trx, k, emp);
      const ccOperador = (await cfg('FECHA_CAIXA_CC_OPERADOR')) === 'S';
      const enviaSangriaFiscal = (await cfg('ENVIA_SANGRIA_SUPRIMENTO_CONTA_FISCAL')) === 'S';
      const dif = det.totais.diferenca;
      const dataCx = c.data.split('-').reverse().join('/');
      const valorTxt = (n: number) => r2(n).toFixed(2).replace('.', ',');
      const palavra = (op: string) => ({ devolucao: 'devolução', convenio: 'convênio' } as Record<string, string>)[op.toLowerCase()] ?? op.toLowerCase();

      const oper = (await sql<{ nome: string | null; codparceiro: number | null }>`SELECT nome, codparceiro FROM operadores WHERE codoperador = ${c.op}`.execute(trx)).rows[0];
      const nomeOper = String(oper?.nome ?? '');
      const nomeLogado = String((await sql<{ nome: string | null }>`SELECT nome FROM operadores WHERE codoperador = ${logado}`.execute(trx)).rows[0]?.nome ?? '');
      const empresa = (await sql<Record<string, unknown>>`SELECT * FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0] ?? {};
      const pdvInterno = (await sql<{ codpdv: number }>`SELECT codpdv FROM pdv WHERE nropdv = ${c.pdv} AND codempresa = ${emp} ORDER BY codpdv LIMIT 1`.execute(trx)).rows[0]?.codpdv ?? null;
      const formas = await this.formas(trx, emp);
      const formaCompleta = async (idpgto: number) => (await sql<Record<string, unknown>>`SELECT idpgto, modalidade, destino, codcontacorrente FROM formas_pgto WHERE idpgto = ${idpgto}`.execute(trx)).rows[0];
      const ccDoPdv = async (idpgto: number): Promise<number> => {
        if (pdvInterno == null) return 0;
        const r = (await sql<{ codplc: number | null }>`SELECT codplc FROM contacorrente WHERE codpdv = ${pdvInterno} AND idpgto = ${idpgto} ORDER BY codcontacorrente LIMIT 1`.execute(trx)).rows[0];
        return num(r?.codplc);
      };

      // 1) a conta do usuário que fecha (FECHA_CAIXA_CC_OPERADOR, UF:393-402)
      let contaUsuario: number | null = null;
      if (ccOperador) {
        const r = (await sql<{ codconta: number | null }>`SELECT p.codconta FROM operadores o JOIN parceiros p ON p.codparceiro = o.codparceiro WHERE o.codoperador = ${logado}`.execute(trx)).rows[0];
        contaUsuario = num(r?.codconta) || null;
        if (!contaUsuario) throw new BusinessRuleError('FECHAMENTO_CONTA_OPERADOR');
      }
      // 2) o saldo do operador (VerificaCheckGeralSaldo, UF:255-306): marcado à mão ou pela diferença acima do limite
      const gerarSaldo = !!dto.gerarSaldo || (det.limiteSaldo !== 0 && Math.abs(dif) > det.limiteSaldo);
      let ccQuebra = 0;
      let formaQuebra: Record<string, unknown> | undefined;
      if (gerarSaldo) {
        if (!oper?.codparceiro) throw new BusinessRuleError('FECHAMENTO_OPERADOR_SEM_PARCEIRO', { nome: nomeOper });
        if (empresa.idpgto == null) throw new BusinessRuleError('FECHAMENTO_SEM_FORMA_QUEBRA');
        formaQuebra = await formaCompleta(num(empresa.idpgto));
        ccQuebra = await ccDoPdv(num(empresa.idpgto));
        if (!ccQuebra) throw new BusinessRuleError('FECHAMENTO_CC_QUEBRA', { modalidade: String(formaQuebra?.modalidade ?? '') });
      }
      // 3) cada linha com valor precisa do CC no PDV e da conta na forma (UF:417-474)
      const comValor = det.linhas.filter((l) => (l.real ?? 0) > 0);
      const plcDe = new Map<string, number>();
      for (const l of comValor) {
        const f = formas.find((x) => x.modalidade === l.operacao);
        const plc = f ? await ccDoPdv(f.idpgto) : 0;
        if (!f || !plc) throw new BusinessRuleError('FECHAMENTO_MODALIDADE_SEM_PDV', { operacao: l.operacao });
        const fc = await formaCompleta(f.idpgto);
        if (!num(fc?.codcontacorrente)) throw new BusinessRuleError('FECHAMENTO_FORMA_SEM_CONTA', { operacao: l.operacao });
        plcDe.set(l.operacao, plc);
      }
      // 4) documentos não conferidos (ValidaDocumentosNaoSelecionados, UF:308-353) — pergunta, e segue se confirmado
      if (!dto.confirmarDocumentosNaoSelecionados) {
        const pendentes: Array<{ operacao: string; documentos: number }> = [];
        for (const l of det.linhas) {
          if (!['RCB', 'CHQ', 'CHP', 'TEF', 'CRT', 'DEV'].includes(String(l.destino ?? '')) || !l.tipo || l.tipo === 'DINHEIRO' || l.idpgto == null) continue;
          const marcados = new Set(l.documentos);
          const fora = (await this.listarDocs(trx, c, l.tipo, l.idpgto, false, det.filtraPdv)).filter((d) => !marcados.has(d.codigo)).length;
          if (fora) pendentes.push({ operacao: l.operacao, documentos: fora });
        }
        if (pendentes.length) throw new BusinessRuleError('FECHAMENTO_DOCUMENTOS_NAO_SELECIONADOS', { finalizadoras: pendentes });
      }

      const codgrupo = Number((await sql<{ id: string }>`SELECT nextval('seq_caixa_codgrupo') AS id`.execute(trx)).rows[0].id);
      const instante = sql`now()`;
      const historico = (tabela: string, texto: string, coddoc: string) =>
        sql`INSERT INTO historico (tabela, historico, coddoc, codoperador, codempresa, data, auxiliar)
            VALUES (${tabela}, ${texto}, ${coddoc}, ${logado}, ${emp}, date_trunc('second', now() AT TIME ZONE ${c.tz}), ${c.chave})`.execute(trx);

      // 5) LancaApagar (UF:1876-2028): o título de cada adicional com fornecedor e CC na empresa — na produção só o troco
      //    solidário ('T'); o binário novo lança também a CAIXA 'APAGAR' do rateio
      const adicionais: Array<[string, string, number, unknown, unknown]> = [
        ['R', 'recarga', det.adicionais.recarga, empresa.codfornecedor_recarga, empresa.codplc_recarga],
        ['C', 'corespondente bancário', det.adicionais.correspondente, empresa.codfornecedor_correspondente, empresa.codplc_correspondente],
        ['V', 'voucher', det.adicionais.voucher, empresa.codfornecedor_voucher, empresa.codplc_voucher],
        ['T', 'troco solidário', det.adicionais.trocoSolidario, empresa.codfornecedor_trocosolidario, empresa.codplc_trocosolidario],
      ];
      for (const [sigla, nome, valor, fornecedor, plc] of adicionais) {
        if (!(valor > 0) || !num(fornecedor) || !num(plc)) continue;
        const grupoApg = Number((await sql<{ id: string }>`SELECT nextval('seq_caixa_codgrupo') AS id`.execute(trx)).rows[0].id);
        const obs = `Conta gerada do fechamento do caixa do operador ${nomeOper}, PDV ${c.pdv}, no dia ${dataCx} em ${nome}`;
        const apg = (await sql<{ codapg: number }>`
          INSERT INTO apagar (codparceiro, codoperador, dtcompra, dtvenc, valor, obs, codempresa, quitada, nrodup, nrparcela, dtcadastro,
                              operacao_convenio_funcionario, convenio, tipodoc, txjuros, desconto, vendor, gerado, geradocartaoproprio,
                              codgrupo, origem, codgrupo_fcx, idsituacao_nf)
          VALUES (${num(fornecedor)}, ${logado}, ${this.ini(c)}, ${this.ini(c)}, ${r2(valor)}, ${obs}, ${emp}, 'N', 1, '1/1', now(),
                  'D', 'N', 'BOLETO', 0, 0, 0, 'SISTEMA', 'N', ${grupoApg}, ${sigla}, ${codgrupo}, 0)
          RETURNING codapg`.execute(trx)).rows[0];
        await sql`UPDATE apagar SET duplicata = ${String(apg.codapg)} WHERE codapg = ${apg.codapg}`.execute(trx);
        const cxa = (await sql<{ codcxapagar: number }>`
          INSERT INTO cx_apagar (codapg, codcc, valor, codgrupo, tipo, dtultimalteracao)
          VALUES (${apg.codapg}, ${num(plc)}, ${r2(valor)}, ${grupoApg}, 'V', now()) RETURNING codcxapagar`.execute(trx)).rows[0];
        await trx.insertInto('caixa').values({
          data: this.ini(c), valor: -r2(valor), vrtitulo: -r2(valor), obs, operador: logado, codplc: num(plc), idempresa: emp,
          tiporecurso: 'BOLETO', codparceiro: num(fornecedor), nrparcela: '1/1', codgrupo: grupoApg, dtvenc: this.ini(c),
          codcxapagar: cxa.codcxapagar, origem: 'APAGAR', idorigem: apg.codapg,
        }).execute();
      }

      // 6) as linhas da grade (UF:523-733): CAIXA + HISTORICO e MCB + HISTORICO nas que têm REAL > 0; CONTACORRENTEOP em todas
      let nCaixa = 0;
      let nMcb = 0;
      for (const l of det.linhas) {
        const real = l.real ?? 0;
        const f = formas.find((x) => x.modalidade === l.operacao);
        if (real > 0) {
          const cx = (await trx.insertInto('caixa').values({
            data: this.ini(c), valor: r2(real), vrtitulo: r2(real), codfiscalcx: c.op, operador: c.op,
            obs: `Referente ao fechamento de caixa do(a) operador(a): ${nomeOper} do dia: ${dataCx}`,
            codplc: plcDe.get(l.operacao) ?? null, idempresa: emp, tiporecurso: l.operacao, codparceiro: 0, nrparcela: '1/1',
            codgrupo, codpdv: c.pdv, dtvenc: this.ini(c), gerado: 'SISTEMA', chave: c.chave, dtcadastro: instante, origem: 'FECHAMENTO',
          }).returning('codcx').executeTakeFirstOrThrow()) as { codcx: number };
          nCaixa++;
          await historico('CAIXA', `Fechamento do caixa ${c.pdv}, do operador ${nomeOper}, no dia ${dataCx}, na quantia de ${valorTxt(real)} em ${palavra(l.operacao)}.`, String(cx.codcx));

          // o MCB da linha (UF:588-681): conta da forma; no DINHEIRO a do usuário e o contado; cheque só o de fora da sangria
          if (!f) throw new BusinessRuleError('FECHAMENTO_FORMA_NAO_ENCONTRADA', { operacao: l.operacao });
          const fc = await formaCompleta(f.idpgto);
          let valorMcb = r2(real);
          let conta = num(fc?.codcontacorrente);
          let pular = false;
          if (String(fc?.destino ?? '') === 'CHQ') {
            const cheques = l.documentos.length
              ? num((await sql<{ t: string }>`SELECT sum(ch.valor) AS t FROM cheque ch LEFT JOIN hist_sangria_suprimento h ON h.identificador = ch.identificador
                   WHERE ch.codchq = ANY(${l.documentos}::int[]) AND h.identificador IS NULL`.execute(trx)).rows[0]?.t)
              : 0;
            if (!cheques) pular = true; else valorMcb = r2(cheques);
          }
          if (l.operacao === 'DINHEIRO') {
            if (ccOperador && contaUsuario) conta = contaUsuario;
            if (ccOperador && enviaSangriaFiscal) valorMcb = r2(det.dinheiroContado);
          }
          if (!pular && valorMcb !== 0) {
            const mcb = (await trx.insertInto('mov_contas_bancarias').values({
              codconta: conta, idempresa: emp, valor: valorMcb, tipomovimento: 'C', codopconta: 0, idpgto: f.idpgto,
              historico: `Fechamento do caixa ${c.pdv}, do operador ${nomeOper}, no dia ${dataCx} em ${palavra(l.operacao)}, realizado pelo(a) usuário(a) ${nomeLogado}.`,
              codoperador: c.op, nropdv_fechamento: c.pdv, data_fechamento: this.ini(c), origem: 'FCP', idorigem: cx.codcx,
              dtemissao: instante, dtvenc: instante, nrodocumento: `ECF ${c.pdv}`, liberado: 'S', chave: c.chave, idempresa_fechamento: emp,
            }).returning('codmovconta').executeTakeFirstOrThrow()) as { codmovconta: number };
            nMcb++;
            // o texto descreve a conta DA FORMA mesmo quando o dinheiro vai para a do usuário (como o legado)
            const cb = (await sql<{ nroconta: string | null; banco: string | null }>`SELECT c.nroconta, b.banco FROM contas_bancarias c LEFT JOIN bancos b ON b.codbco = c.codbco WHERE c.codconta = ${num(fc?.codcontacorrente)}`.execute(trx)).rows[0];
            await historico('MOV_CONTAS_BANCARIAS',
              `Movimentação bancária da conta nº ${String(cb?.nroconta ?? '').trim()}${cb?.banco ? ` no banco ${String(cb.banco).trim()}` : ''}, referente ao fechamento do caixa ${c.pdv}, do operador ${nomeOper}, no dia ${dataCx}, na quantia de ${valorTxt(valorMcb)} em ${palavra(l.operacao)}.`,
              String(mcb.codmovconta));
          }
        }
        // CONTACORRENTEOP (UF:687-730): o saldo da linha zera o acumulado; com o saldo do operador marcado, soma. O legado usa
        // o IDPGTO da última linha com valor nas linhas zeradas — aqui, o da própria linha.
        if (f) {
          const saldoLinha = r2(l.saldo + (l.linhaDinheiro ? det.totais.devolucaoDinheiro : 0));
          const existe = (await sql`SELECT 1 FROM contacorrenteop WHERE codoperador = ${c.op} AND idpgto = ${f.idpgto} LIMIT 1`.execute(trx)).rows.length > 0;
          if (saldoLinha === 0) {
            if (existe) await sql`UPDATE contacorrenteop SET saldo = 0 WHERE codoperador = ${c.op} AND idpgto = ${f.idpgto}`.execute(trx);
          } else if (gerarSaldo) {
            if (existe) await sql`UPDATE contacorrenteop SET saldo = coalesce(saldo, 0) + ${saldoLinha} WHERE codoperador = ${c.op} AND idpgto = ${f.idpgto}`.execute(trx);
            else await sql`INSERT INTO contacorrenteop (codoperador, idpgto, saldo) VALUES (${c.op}, ${f.idpgto}, ${saldoLinha})`.execute(trx);
          }
        }
      }

      // 7) a diferença (UF:744-791): na quebra com o saldo marcado, o título A Receber 'Q' e a CAIXA da quebra; SALDO_OPERADOR
      let codrcb: number | null = null;
      let idsaldoop: number | null = null;
      if (dif !== 0) {
        if (dif < 0 && gerarSaldo && oper?.codparceiro) {
          // a forma RCB do título: o legado pega a primeira que o banco devolver; a produção de 2026 é a BOLETO
          const fRcb = (await sql<{ idpgto: number }>`SELECT idpgto FROM formas_pgto WHERE idempresa = ${emp} AND destino = 'RCB'
              ORDER BY (upper(modalidade) = 'BOLETO') DESC, idpgto LIMIT 1`.execute(trx)).rows[0];
          const q = r2(Math.abs(dif));
          const rcb = (await sql<{ codrcb: number }>`
            INSERT INTO areceber (codparceiro, codoperador, dtvenda, dtvenc, valor, total, total_brt, obs, codempresa, quitada, nrodup,
                                  idpgto, consiliado, codplc, origem, agrupado)
            VALUES (${oper.codparceiro}, ${logado}, ${this.ini(c)}, ${this.ini(c)}, ${q}, ${q}, ${q},
                    ${`ORIGINADO DO LANÇAMENTO DE QUEBRA DE CAIXA DO(a) OPERADOR(A) ${nomeOper}, PDV ${c.pdv} NO DIA ${dataCx}`},
                    ${emp}, 'N', 1, ${fRcb?.idpgto ?? null}, 'S', ${ccQuebra}, 'Q', 'N')
            RETURNING codrcb`.execute(trx)).rows[0];
          codrcb = Number(rcb.codrcb);
          await sql`UPDATE areceber SET duplicata = ${String(codrcb)} WHERE codrcb = ${codrcb}`.execute(trx);
          await trx.insertInto('caixa').values({
            data: this.ini(c), valor: q, vrtitulo: q, operador: logado, idempresa: emp, tiporecurso: String(formaQuebra?.modalidade ?? ''),
            codconta: null, codparceiro: oper.codparceiro, nrparcela: '1', codgrupo, gerado: 'SISTEMA', codrcb, codplc: ccQuebra,
            obs: `Originado do lançamento de quebra de caixa do(a) operador(a) ${nomeOper}, PDV ${c.pdv} no dia ${dataCx}`,
            origem: 'FECHAMENTO', dtvenc: this.ini(c), dtcadastro: instante, chave: c.chave,
          }).execute();
        }
        const so = (await trx.insertInto('saldo_operador').values({
          idempresa: emp, codgrupo, codoperador: c.op, codpdv: c.pdv, datafechamento: this.ini(c), saldo: dif,
          gera_saldo: codrcb ? 'S' : 'N', codrcb, excluido: 'N', chave: c.chave, usucadastro: logado,
          valor_esperado: det.totais.fechamento, valor_real: det.totais.real, devolucao: det.totais.devolucaoDinheiro,
        }).returning('idsaldoop').executeTakeFirstOrThrow()) as { idsaldoop: number };
        idsaldoop = Number(so.idsaldoop);
        await historico('QUEBRA_CAIXA', `${dif < 0 ? 'Quebra' : 'Sobra'} de caixa referente ao fechamento do caixa ${c.pdv}, do operador ${nomeOper}, no dia ${dataCx}, na quantia de ${valorTxt(dif)}.`, '0');
      }

      // 8) as marcas nos documentos conferidos (UF:793-852)
      let nMarcas = 0;
      for (const l of det.linhas) {
        if (!l.documentos.length) continue;
        const d = String(l.destino ?? '');
        const marcar = async (tabela: string, pk: string, colConc: string, colEmp: string) => {
          const r = await sql`UPDATE ${sql.table(tabela)} SET ${sql.ref(colConc)} = 'S', dtfechamentocx = ${this.ini(c)}
              WHERE ${sql.ref(pk)} = ANY(${l.documentos}::int[]) AND ${sql.ref(colEmp)} = ${emp}`.execute(trx);
          nMarcas += Number(r.numAffectedRows ?? 0);
        };
        if (d === 'RCB') await marcar('areceber', 'codrcb', 'consiliado', 'codempresa');
        else if (d === 'CHQ' || d === 'CHP') await marcar('cheque', 'codchq', 'consiliado', 'idempresa');
        else if (d === 'TEF' || d === 'CRT') await marcar('cartao', 'codvendcartao', 'consiliado', 'idempresa');
        else if (d === 'CXA' && l.operacao === 'TICKET') await marcar('ticket', 'codticket', 'consiliado', 'idempresa');
        else if (d === 'DEV') await marcar('hist_devolucao', 'codhistdevolucao', 'conciliado', 'idempresa');
      }

      // 9) o turno fecha (uFechamentoCaixa.pas:425-434): todas as datas da chave (ou o dia, sem chave)
      await sql`UPDATE cx_vendas cx SET status = 'F', codgrupo = ${codgrupo}, tesouraria = 'S'
          WHERE cx.nropdv = ${c.pdv} AND cx.codoperadora = ${c.op} AND cx.status IS NULL AND ${chaveOuDia} AND cx.idempresa = ${emp}`.execute(trx);
      // 10) CONSOLIDADO (UF:2170-2186): o filtro do legado é a data de HOJE — só marca quem fecha no mesmo dia do caixa
      await sql`UPDATE finaliza_fechamento f SET consolidado = 'F'
          WHERE f.operador = ${c.op} AND f.idempresa = ${emp} AND f.pdv = ${c.pdv}
            AND (f.data AT TIME ZONE ${c.tz})::date = (now() AT TIME ZONE ${c.tz})::date AND ${this.daChave('f.chave', c)}`.execute(trx);

      // 11) a contabilização (corte 3, `uFechamentoCaixa.pas:436-441`): só com INTEGRACAO AUTOMATICA, num savepoint — o legado a
      //     roda calada (`MostraMensagem=False`) e o erro volta só a contabilização; o fechamento fica e o CAIXA espera o TRON
      let contabil: { lancamentos: number; avisos: AvisoContabil[] } | null = null;
      if (String(empresa.integracao ?? '') === 'AUTOMATICA') {
        const r = await emSavepoint(trx, 'contabil_fechamento', () => this.contabil.integrarNaTrx(trx, emp, { codgrupo }));
        contabil = r.ok ? { lancamentos: r.v.lancamentos, avisos: r.v.avisos } : { lancamentos: 0, avisos: [avisoDoErro(`fechamento ${codgrupo}`, r.erro)] };
      }

      c.situacao = 3;
      return { ...(await this.montar(trx, c)), efetivado: { codgrupo, caixa: nCaixa, mcb: nMcb, idsaldoop, codrcb, marcas: nMarcas, diferenca: dif, gerarSaldo, contabil } };
    });
  }

  // ── REABRIR (corte 3) ──────────────────────────────────────────────────────────────────────────────────────────
  /**
   * `btnReabrirClick` (uFechamentoCaixa.pas:504-1086; dossiê "CORTE 3" e as 114 reaberturas de 2026). Numa transação só:
   * o estorno contábil do grupo; os títulos gerados pelo fechamento (e a CAIXA do rateio deles, que no Oracle a trigger
   * `CAIXA_APAGAR` leva); a CAIXA do turno; o MCB — excluído, ou revertido com um débito (`EXCLUI_OU_LANCA_DEBITO_REABRIR_CAIXA`
   * = 'D'); o CX_VENDAS volta a aberto; as conciliações dos documentos; a quebra (título, CAIXA e o SALDO como excluído);
   * o CONSOLIDADO do rascunho (que fica); e o HISTORICO. Divergências conscientes, cada uma com o caso da produção:
   *  - o legado estorna a contabilização numa transação à parte, já comitada antes da reabertura — aqui é uma só;
   *  - com CHAVE, tudo é pela chave (o efetivar fecha todas as datas dela); o legado mistura chave e data
   *    (`FECHAMENTO_CAIXA_SOMENTE_CHAVE`='N') e a reabertura de um turno de duas datas apagava a CAIXA do outro dia e deixava o
   *    CX_VENDAS dele fechado (grupo 95631);
   *  - o estorno é sempre pelo grupo (o legado só estorna com CAIXA contabilizada e deixava o razão órfão do título);
   *  - com mais de um grupo na chave, recusa (o legado pega o primeiro); sem grupo, recusa (o legado segue sem ele);
   *  - o título da quebra JÁ BAIXADO bloqueia (o legado o apagava sem olhar; 0 dos 27 de 2026 estavam baixados);
   *  - o HISTORICO usa o nome do operador do cadastro (o legado usava o texto da tela, que chegou a sair "TODOS").
   * Fica como no legado: DTFECHAMENTOCX, TICKET, CONTACORRENTEOP, CAIXA_PDV e o rascunho não voltam.
   */
  async reabrir(dto: TurnoFechamentoDto) {
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.contexto(trx, dto);
      const emp = c.emp;
      const logado = currentTenant().operadorId ?? null;
      if (!c.op) throw new BusinessRuleError('FECHAMENTO_REABRIR_SEM_OPERADOR');
      if (!c.pdv) throw new BusinessRuleError('FECHAMENTO_REABRIR_SEM_PDV');
      const dataCx = c.data.split('-').reverse().join('/');

      // 1) a conta do DINHEIRO chaveada até o dia do caixa (:716-727)
      const chav = (await sql<{ d: string | null }>`SELECT to_char(cb.dtchaveamento, 'YYYY-MM-DD') AS d FROM formas_pgto f
          JOIN contas_bancarias cb ON cb.codconta = f.codcontacorrente WHERE f.modalidade = 'DINHEIRO' AND f.idempresa = ${emp}
          ORDER BY f.idpgto LIMIT 1`.execute(trx)).rows[0]?.d;
      if (chav && c.data <= chav) throw new BusinessRuleError('FECHAMENTO_CAIXA_CHAVEADO', { ate: chav });

      // 2) o grupo do turno (`GetGrupo`, :513-559)
      const chaveOuDia = (col: string, colData: string) => (c.chave ? sql`${sql.ref(col)} = ${c.chave}` : sql`${sql.ref(col)} IS NULL AND ${this.noDia(colData, c)}`);
      const grupos = (await sql<{ codgrupo: number }>`SELECT DISTINCT cx.codgrupo FROM cx_vendas cx
          WHERE cx.nropdv = ${c.pdv} AND cx.codoperadora = ${c.op} AND ${chaveOuDia('cx.chave', 'cx.data')} AND cx.idempresa = ${emp}
            AND coalesce(cx.codgrupo, 0) > 0 ORDER BY cx.codgrupo`.execute(trx)).rows.map((r) => num(r.codgrupo));
      if (!grupos.length) throw new BusinessRuleError('FECHAMENTO_REABRIR_NAO_FECHADO');
      if (grupos.length > 1) throw new BusinessRuleError('FECHAMENTO_REABRIR_VARIOS_GRUPOS', { grupos });
      const g = grupos[0];
      await sql`SELECT codcxvendas FROM cx_vendas WHERE codgrupo = ${g} FOR UPDATE`.execute(trx);

      // 3) contabilizado: sem integração automática, não reabre; com ela, estorna o grupo (:730-750)
      const empresa = (await sql<{ integracao: string | null }>`SELECT integracao FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0];
      const contabilizado = (await sql`SELECT 1 FROM caixa WHERE codgrupo = ${g} AND contabilizado = 'S' LIMIT 1`.execute(trx)).rows.length > 0;
      if (contabilizado && String(empresa?.integracao ?? '') !== 'AUTOMATICA') throw new BusinessRuleError('FECHAMENTO_REABRIR_CONTABILIZADO');
      const chaveamento = (await sql<{ d: string | null }>`SELECT to_char(chaveamento_periodo, 'YYYY-MM-DD') AS d FROM config_integracao_contabil LIMIT 1`.execute(trx)).rows[0]?.d;
      if (chaveamento) {
        const noChaveado = (await sql`SELECT 1 FROM diario d WHERE d.codorigem = 17 AND d.datalan <= ${chaveamento}::date
            AND (d.complemento = ${String(g)} OR (d.tipodoc = 'QUEBRA/SOBRA' AND d.idorigem IN (SELECT idsaldoop FROM saldo_operador WHERE codgrupo = ${g}))) LIMIT 1`.execute(trx)).rows.length > 0;
        if (noChaveado) throw new BusinessRuleError('PERIODO_CONTABIL_CHAVEADO', { ate: chaveamento });
      }
      const estorno = await this.contabil.estornarNaTrx(trx, emp, { codgrupo: g });

      // 4) os títulos gerados pelo fechamento (`ExcluiApagarGerado`, :561-619)
      const titulos = (await sql<Record<string, unknown>>`SELECT codapg, quitada, codgrupo, agrupado FROM apagar WHERE codgrupo_fcx = ${g} ORDER BY codapg`.execute(trx)).rows;
      for (const t of titulos) {
        const codapg = num(t.codapg);
        if (t.quitada === 'S') {
          const baixas = (await sql<Record<string, unknown>>`SELECT bx.codapgbx, mv.codmovconta, mv.origem FROM apagar_bx bx
              JOIN mov_contas_bancarias mv ON mv.idlote = bx.idlote WHERE coalesce(bx.indr, 'I') = 'I' AND bx.codapg = ${codapg}`.execute(trx)).rows;
          for (const b of baixas) {
            // só a baixa automática (recarga/correspondente) é revertida; a baixa de gente bloqueia
            if (!['REC', 'COR'].includes(String(b.origem ?? ''))) throw new BusinessRuleError('FECHAMENTO_REABRIR_APAGAR_BAIXADO', { codapg });
            await sql`DELETE FROM mov_contas_bancarias WHERE codmovconta = ${num(b.codmovconta)}`.execute(trx);
            await sql`DELETE FROM apagar_bx WHERE codapgbx = ${num(b.codapgbx)}`.execute(trx);
          }
        }
        if (t.agrupado === 'S') throw new BusinessRuleError('FECHAMENTO_REABRIR_APAGAR_AGRUPADO', { codapg });
        await sql`DELETE FROM caixa WHERE codgrupo = ${num(t.codgrupo)} AND codcxapagar IN (SELECT codcxapagar FROM cx_apagar WHERE codgrupo = ${num(t.codgrupo)})`.execute(trx);
        await sql`DELETE FROM cx_apagar WHERE codgrupo = ${num(t.codgrupo)}`.execute(trx);
        await sql`DELETE FROM apagar WHERE codapg = ${codapg}`.execute(trx);
      }

      // 5) a quebra (:947-983) — antes da CAIXA do turno, que a leva junto quando o operador é quem fechou
      const quebras = (await sql<Record<string, unknown>>`SELECT s.idsaldoop, s.codrcb, c.codcx, r.quitada,
             (SELECT count(*) FROM areceber_bx b WHERE b.codrcb = r.codrcb AND coalesce(b.indr, 'I') = 'I')::int AS baixas
          FROM saldo_operador s LEFT JOIN areceber r ON r.codrcb = s.codrcb LEFT JOIN caixa c ON c.codrcb = r.codrcb
         WHERE s.codoperador = ${c.op} AND ${c.chave ? sql`s.chave = ${c.chave}` : sql`s.chave IS NULL AND s.datafechamento = ${c.data}::date`}
           AND s.excluido = 'N' AND s.codpdv = ${c.pdv}`.execute(trx)).rows;
      for (const q of quebras) {
        if (num(q.codrcb) > 0 && (q.quitada === 'S' || num(q.baixas) > 0)) throw new BusinessRuleError('FECHAMENTO_REABRIR_QUEBRA_BAIXADA', { codrcb: num(q.codrcb) });
      }
      for (const q of quebras) {
        await sql`UPDATE saldo_operador SET excluido = 'S', codrcb = NULL WHERE idsaldoop = ${num(q.idsaldoop)}`.execute(trx);
        if (num(q.codcx) > 0) await sql`DELETE FROM caixa WHERE codcx = ${num(q.codcx)}`.execute(trx);
        if (num(q.codrcb) > 0) await sql`DELETE FROM areceber WHERE codrcb = ${num(q.codrcb)}`.execute(trx);
      }

      // 6) a CAIXA do turno (:752-767): com chave, a do operador na chave; sem chave, a do grupo
      const cxWhere = c.chave ? sql`operador = ${c.op} AND chave = ${c.chave} AND idempresa = ${emp}` : sql`codgrupo = ${g}`;
      const nCaixa = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM caixa WHERE ${cxWhere}`.execute(trx)).rows[0]?.n ?? 0);
      if (!nCaixa && !quebras.some((q) => num(q.codcx) > 0)) throw new BusinessRuleError('FECHAMENTO_REABRIR_SEM_CAIXA');

      // 7) o MCB (:769-868): excluir (E, o padrão) ou lançar o débito que o reverte (D)
      const modo = (await this.cfg(trx, 'EXCLUI_OU_LANCA_DEBITO_REABRIR_CAIXA', emp)) === 'D' ? 'D' : 'E';
      const mcbWhere = sql`m.codoperador = ${c.op} AND ${c.chave ? sql`m.chave = ${c.chave}` : sql`m.chave IS NULL AND ${this.noDia('m.data_fechamento', c)}`}
          AND m.idempresa_fechamento = ${emp} AND m.nropdv_fechamento = ${c.pdv}`;
      const nomeOper = String((await sql<{ nome: string | null }>`SELECT nome FROM operadores WHERE codoperador = ${c.op}`.execute(trx)).rows[0]?.nome ?? '');
      let nMcb = 0;
      if (modo === 'D') {
        const movs = (await sql<Record<string, unknown>>`SELECT m.codmovconta, m.nropdv_fechamento, to_char(m.data_fechamento AT TIME ZONE ${c.tz}, 'DD/MM/YYYY') AS dia,
               coalesce(o.nome, 'NÃO ENCONTRADO') AS nome, coalesce(f.modalidade, 'NÃO ENCONTRADO') AS modalidade
            FROM mov_contas_bancarias m LEFT JOIN operadores o ON o.codoperador = m.codoperador LEFT JOIN formas_pgto f ON f.idpgto = m.idpgto
           WHERE ${mcbWhere} AND m.idorigem IS NOT NULL ORDER BY m.codmovconta`.execute(trx)).rows;
        if (!movs.length) throw new BusinessRuleError('FECHAMENTO_REABRIR_SEM_MCB');
        const nomeLogado = String((await sql<{ nome: string | null }>`SELECT nome FROM operadores WHERE codoperador = ${logado}`.execute(trx)).rows[0]?.nome ?? '');
        const hoje = (await sql<{ d: string }>`SELECT to_char(now() AT TIME ZONE ${c.tz}, 'DD/MM/YYYY') AS d`.execute(trx)).rows[0].d;
        const colunas = (await sql<{ c: string }>`SELECT column_name AS c FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = 'mov_contas_bancarias'
              AND column_name NOT IN ('codmovconta', 'dtemissao', 'dtvenc', 'tipomovimento', 'valor', 'historico', 'idorigem')
            ORDER BY ordinal_position`.execute(trx)).rows.map((r) => r.c);
        for (const m of movs) {
          const historico = `Reabertura do caixa ${num(m.nropdv_fechamento)}, do operador ${m.nome}, do dia ${m.dia ?? ''}, referente a forma de pagamento "${m.modalidade}", realizado pelo(a) usuário(a) ${nomeLogado} no dia ${hoje}.`.slice(0, 300);
          const lista = sql.join(colunas.map((col) => sql.ref(col)));
          await sql`INSERT INTO mov_contas_bancarias (${lista}, dtemissao, dtvenc, tipomovimento, valor, historico, idorigem)
              SELECT ${lista}, (now() AT TIME ZONE ${c.tz})::date, (now() AT TIME ZONE ${c.tz})::date,
                     CASE WHEN tipomovimento = 'C' THEN 'D' ELSE 'C' END, -valor, ${historico}, NULL
                FROM mov_contas_bancarias WHERE codmovconta = ${num(m.codmovconta)}`.execute(trx);
          nMcb++;
        }
        await sql`UPDATE mov_contas_bancarias m SET idorigem = NULL WHERE ${mcbWhere} AND m.idorigem IS NOT NULL`.execute(trx);
      } else {
        // as duas formas antigas do histórico (:846-864) também saem
        const semChave = c.chave ? sql`m.chave = ${c.chave}` : sql`m.chave IS NULL`;
        const r = await sql`DELETE FROM mov_contas_bancarias m WHERE (${mcbWhere})
            OR ((m.historico LIKE ${`Fechamento do caixa ${c.pdv}, do operador ${nomeOper}, no dia ${dataCx}%`}
                 OR m.historico LIKE ${`% Dt: ${dataCx} cx: ${c.pdv} op: ${nomeOper}`})
                AND ${semChave} AND m.idpgto IN (SELECT idpgto FROM formas_pgto WHERE idempresa = ${emp}))`.execute(trx);
        nMcb = Number(r.numAffectedRows ?? 0);
        if (!nMcb) throw new BusinessRuleError('FECHAMENTO_REABRIR_SEM_MCB');
      }
      await sql`DELETE FROM caixa WHERE ${cxWhere}`.execute(trx);

      // 8) o turno volta a aberto e os documentos perdem a conciliação (:878-944, :985-1012)
      await sql`UPDATE cx_vendas cx SET status = NULL, codgrupo = NULL, tesouraria = NULL
          WHERE cx.nropdv = ${c.pdv} AND cx.codoperadora = ${c.op} AND ${chaveOuDia('cx.chave', 'cx.data')} AND cx.idempresa = ${emp}`.execute(trx);
      await sql`UPDATE cartao SET consiliado = NULL WHERE codoperador = ${c.op} AND ${chaveOuDia('chave', 'dtvenda')} AND idempresa = ${emp} AND codpdv = ${c.pdv}`.execute(trx);
      await sql`UPDATE areceber SET consiliado = NULL WHERE codoperador = ${c.op} AND ${chaveOuDia('chave', 'dtvenda')} AND codempresa = ${emp} AND codpdv = ${c.pdv}`.execute(trx);
      await sql`UPDATE cheque SET consiliado = NULL WHERE operador = ${c.op} AND ${chaveOuDia('chave', 'dtemissao')} AND idempresa = ${emp} AND codpdv = ${c.pdv}`.execute(trx);
      await sql`UPDATE hist_devolucao SET conciliado = NULL WHERE codoperador = ${c.op} AND ${chaveOuDia('chave', 'dtvenda')} AND idempresa = ${emp} AND codpdv = ${c.pdv}`.execute(trx);
      await sql`UPDATE finaliza_fechamento SET consolidado = NULL WHERE operador = ${c.op} AND ${chaveOuDia('chave', 'data')} AND idempresa = ${emp} AND pdv = ${c.pdv}`.execute(trx);

      // 9) o HISTORICO (:1021-1028)
      await sql`INSERT INTO historico (tabela, historico, coddoc, codoperador, codempresa, data, auxiliar)
          VALUES ('CAIXA', ${`Reabertura do caixa ${c.pdv}, do operador ${nomeOper}, no dia ${dataCx}.`}, ${String(g)}, ${logado}, ${emp},
                  date_trunc('second', now() AT TIME ZONE ${c.tz}), ${c.chave})`.execute(trx);

      c.situacao = 1;
      return { ...(await this.montar(trx, c)), reaberto: { codgrupo: g, estorno: estorno.linhas, titulos: titulos.length, quebras: quebras.length, caixa: nCaixa, mcb: nMcb, modo } };
    });
  }
}
