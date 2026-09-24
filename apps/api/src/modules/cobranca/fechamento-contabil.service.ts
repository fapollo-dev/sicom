import { Injectable } from '@nestjs/common';
import { sql, type RawBuilder } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { AppError, BusinessRuleError } from '../../shared/errors/app-error';
import { mensagemPt } from '../../shared/errors/all-exceptions.filter';
import { configNaTrx } from '../compras/pedido-heranca';
import { lancarNoDiario, type RegistroDataSet } from './integracao-contabil.motor';
import { DocumentosContabilService } from './documentos-contabil.service';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;

/** `tocFechamentoCaixa` (`UIntegracaoContabil.pas:17`) e o TIPODOC que separa a quebra/sobra das formas na origem 17 */
const ORIGEM_FECHAMENTO = 17;
const QUEBRA_SOBRA = 'QUEBRA/SOBRA';
const pdv3 = (n: unknown) => String(Math.trunc(num(n))).padStart(3, '0');

export interface FiltroFechamentoContabil { codgrupo?: number | null; dataIni?: string; dataFim?: string }
export interface AvisoContabil { documento: string; codigo: string; mensagem: string }
export interface ResultadoFechamentoContabil {
  fechamentos: number;
  lancamentos: number;
  total: number;
  /** o que falhou por dentro sem derrubar o fechamento — o título da quebra (CR) e o do troco (CP) */
  avisos: AvisoContabil[];
}

/** o texto de um erro para o aviso — a mensagem do catálogo quando o código tem uma */
export function avisoDoErro(documento: string, e: unknown): AvisoContabil {
  const codigo = e instanceof AppError ? e.code : 'ERRO';
  const det = e instanceof AppError && e.details ? ` ${JSON.stringify(e.details)}` : '';
  return { documento, codigo, mensagem: `${mensagemPt(codigo) ?? (e instanceof Error ? e.message : String(e))}${det}` };
}

/** um trecho que pode falhar sem levar a transação junto — o `StartTransaction` aninhado do FireDAC (savepoint) */
export async function emSavepoint<T>(trx: AnyDB, nome: string, fn: () => Promise<T>): Promise<{ ok: true; v: T } | { ok: false; erro: unknown }> {
  await sql.raw(`SAVEPOINT ${nome}`).execute(trx);
  try {
    const v = await fn();
    await sql.raw(`RELEASE SAVEPOINT ${nome}`).execute(trx);
    return { ok: true, v };
  } catch (erro) {
    await sql.raw(`ROLLBACK TO SAVEPOINT ${nome}`).execute(trx);
    return { ok: false, erro };
  }
}

/**
 * CONTABILIZAÇÃO DO FECHAMENTO DE CAIXA — `TIntegracaoFechamentoCaixa` (`UIntegracaoContabilFechamentoCaixa.pas`),
 * corte 3 do fechamento (dossiê `uFechamentoCaixa-finalizacao.md`, "CORTE 3"). Dois chamadores, como no legado:
 *  - o EFETIVAR do fechamento (`uFechamentoCaixa.pas:436-441`), por CODGRUPO, com `EMPRESAS.INTEGRACAO='AUTOMATICA'`,
 *    dentro da transação do fechamento e num savepoint — a falha volta só a contabilização e o fechamento fica
 *    gravado, com o CAIXA pendente para o TRON;
 *  - o TRON, opção 8 (`uTron.pas:855/2269`), por período, tudo ou nada.
 * Por grupo (todos com a prova de 100% na produção de 2026):
 *  - R1: cada CAIXA do grupo fora da forma QUE → situação `CONFIG_FECHAMENTOCAIXA` (2010), débito automático na conta
 *    da forma (`FORMAS_PGTO.CODPLANOCONTAS`), origem 17, IDORIGEM = CODCX, DOCUMENTO = a forma, COMPLEMENTO = o grupo
 *    (13.755 de 13.755);
 *  - R2: a sobra → `CONFIG_SOBRACAIXA` (2019), TIPODOC 'QUEBRA/SOBRA', IDORIGEM = IDSALDOOP (1.588 de 1.588);
 *  - R3: a quebra sem título → `CONFIG_FALTACAIXA` (2002) (1.795 de 1.795);
 *  - R4: a quebra com título → a contabilização do CONTAS A RECEBER do título, situação `CONFIG_QUEBRACAIXARCB` (785),
 *    na data do caixa; o SALDO fica sem marca (175 de 175);
 *  - R5: os títulos do troco solidário/recarga/voucher/correspondente → a do CONTAS A PAGAR, na data do caixa.
 * Sem CAIXA ligada ao CX_VENDAS do grupo, nada roda (nem o saldo): é o `rNenhumaEncontrada` do legado.
 */
@Injectable()
export class FechamentoContabilService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly docs: DocumentosContabilService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private async tz(db: AnyDB, emp: number): Promise<string> {
    return (await configNaTrx(db, 'FUSO_HORARIO_ACESSO', { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' })) ?? 'America/Sao_Paulo';
  }

  private async assertPeriodoAberto(db: AnyDB, dataFim: string): Promise<void> {
    const cfg = (await db.selectFrom('config_integracao_contabil').select('chaveamento_periodo').executeTakeFirst()) as { chaveamento_periodo: unknown } | undefined;
    if (!cfg) throw new BusinessRuleError('CONFIG_INTEGRACAO_NAO_DEFINIDA');
    const chav = cfg.chaveamento_periodo == null ? null : String(cfg.chaveamento_periodo).slice(0, 10);
    if (chav && dataFim <= chav) throw new BusinessRuleError('PERIODO_CONTABIL_CHAVEADO', { ate: chav });
  }

  // ── TRON, opção 8 ─────────────────────────────────────────────────────────────────────────────────────────────
  async integrar(p: { dataIni: string; dataFim: string; codigo?: number | null }): Promise<ResultadoFechamentoContabil> {
    const emp = this.emp();
    return (this.dbp.forTenant() as AnyDB).transaction().execute((trx: AnyDB) =>
      this.integrarNaTrx(trx, emp, { codgrupo: p.codigo ?? null, dataIni: p.dataIni, dataFim: p.dataFim }));
  }

  async estornar(p: { dataIni: string; dataFim: string; codigo?: number | null }): Promise<{ linhas: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    await this.assertPeriodoAberto(db, p.dataFim);
    return db.transaction().execute((trx: AnyDB) => this.estornarNaTrx(trx, emp, { codgrupo: p.codigo ?? null, dataIni: p.dataIni, dataFim: p.dataFim }));
  }

  // ── Integrar (`:334-568`) ─────────────────────────────────────────────────────────────────────────────────────
  async integrarNaTrx(trx: AnyDB, emp: number, f: FiltroFechamentoContabil): Promise<ResultadoFechamentoContabil> {
    const cfg = (await trx.selectFrom('config_integracao_contabil').selectAll().executeTakeFirst()) as Record<string, number | null> | undefined;
    if (!cfg) throw new BusinessRuleError('CONFIG_INTEGRACAO_NAO_DEFINIDA');
    const tz = await this.tz(trx, emp);
    const dia = (col: string) => sql`(${sql.ref(col)} AT TIME ZONE ${tz})::date`;
    const porGrupo = f.codgrupo != null && f.codgrupo > 0;

    // `GetSQLFechamentos` (:291-319): o grupo só entra com CAIXA ligada ao CX_VENDAS (operador, forma e PDV)
    const grupos = (await sql<{ codgrupo: number }>`
      SELECT DISTINCT cx.codgrupo
        FROM cx_vendas cx
        JOIN operadores o ON o.codoperador = cx.codoperadora
        JOIN caixa c ON c.codgrupo = cx.codgrupo AND c.operador = cx.codoperadora AND c.tiporecurso = cx.operacao AND c.codpdv = cx.nropdv
       WHERE coalesce(c.contabilizado, 'N') = 'N' AND c.codgrupo IS NOT NULL
         AND ${porGrupo ? sql`c.codgrupo = ${f.codgrupo}` : sql`${dia('c.data')} BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date AND c.idempresa = ${emp}`}
       ORDER BY cx.codgrupo`.execute(trx)).rows.map((r) => num(r.codgrupo));

    const res: ResultadoFechamentoContabil = { fechamentos: 0, lancamentos: 0, total: 0, avisos: [] };
    const situacao = (chave: string) => {
      const s = cfg[chave];
      if (!s) throw new BusinessRuleError('SITUACAO_NAO_CONFIGURADA', { qual: chave });
      return Number(s);
    };

    for (const g of grupos) {
      // R1 — `GetSQLFechamentoCaixa` (:255-289): uma linha por CAIXA do grupo, fora da forma QUE
      const caixas = (await sql<Record<string, unknown>>`
        SELECT to_char(${dia('c.data')}, 'YYYY-MM-DD') AS data, c.codcx, coalesce(c.valor, 0) AS valor, c.tiporecurso, c.idempresa,
               c.codpdv, o.nome, f.idpgto, f.codplanocontas
          FROM caixa c
          JOIN operadores o ON o.codoperador = c.operador
          LEFT JOIN LATERAL (SELECT fp.idpgto, fp.codplanocontas, fp.destino FROM formas_pgto fp
                              WHERE fp.modalidade = c.tiporecurso AND fp.idempresa = c.idempresa ORDER BY fp.idpgto LIMIT 1) f ON true
         WHERE coalesce(c.contabilizado, 'N') = 'N' AND c.codgrupo = ${g} AND coalesce(f.destino, 'CXA') <> 'QUE'
         ORDER BY c.codcx`.execute(trx)).rows;
      // a data do lançamento é a do CAIXA (o dia do caixa), não a do fechamento (:389-392)
      let dataFechamento: string | null = caixas.length ? String(caixas[0].data) : null;
      for (const c of caixas) {
        const valor = r2(num(c.valor));
        const reg: RegistroDataSet = {
          codplanocontas: c.codplanocontas == null ? null : Number(c.codplanocontas), valor,
          descricao: `a forma de pagamento número ${c.idpgto ?? ''} da empresa ${c.idempresa}`,
        };
        await lancarNoDiario(trx, {
          emp: num(c.idempresa), codorigem: ORIGEM_FECHAMENTO, situacao: situacao('config_fechamentocaixa'), data: String(c.data), valor,
          idorigem: num(c.codcx), documento: String(c.tiporecurso ?? ''), complemento: String(g), tipodoc: null,
          dataSetD: [reg], dataSetC: [reg], desclote: `Fechamento de caixa ${g}`,
          ctxHist: { pdv: pdv3(c.codpdv), operadorNome: String(c.nome ?? ''), especie: String(c.tiporecurso ?? '') },
        });
        await sql`UPDATE caixa SET contabilizado = 'S' WHERE codcx = ${num(c.codcx)}`.execute(trx);
        res.lancamentos++;
        res.total = r2(res.total + valor);
      }

      // R2/R3/R4 — `GetSQLDivergenciaCaixa` (:228-253)
      const saldos = (await sql<Record<string, unknown>>`
        SELECT s.idsaldoop, to_char(s.datafechamento, 'YYYY-MM-DD') AS data, s.saldo, s.codpdv, s.codoperador, s.idempresa, o.nome, s.codrcb
          FROM saldo_operador s
          LEFT JOIN operadores o ON o.codoperador = s.codoperador
         WHERE coalesce(s.excluido, 'N') = 'N' AND coalesce(s.contabilizado, 'N') = 'N' AND s.codgrupo = ${g}
         ORDER BY s.idsaldoop`.execute(trx)).rows;
      for (const s of saldos) {
        if (!dataFechamento) dataFechamento = s.data == null ? null : String(s.data);
        const saldo = num(s.saldo);
        const idsaldoop = num(s.idsaldoop);
        let sit: number;
        let valor: number;
        let operacao: string;
        if (saldo > 0) {
          sit = situacao('config_sobracaixa');
          valor = saldo;
          operacao = 'Sobra';
        } else {
          if (num(s.codrcb) > 0) {
            // R4: o título da quebra vai pelo contas a receber, na data do caixa; o SALDO não é marcado (o `Continue`)
            const cr = await emSavepoint(trx, 'contabil_quebra_rcb', () => this.docs.integrarDocumentoNaTrx(trx, 'CR', num(s.codrcb), dataFechamento));
            if (cr.ok) res.lancamentos += cr.v.lancamentos;
            else res.avisos.push(avisoDoErro(`título ${num(s.codrcb)} (quebra de caixa)`, cr.erro));
            continue;
          }
          sit = situacao('config_faltacaixa');
          valor = -saldo;
          operacao = 'Quebra';
        }
        await lancarNoDiario(trx, {
          emp: num(s.idempresa), codorigem: ORIGEM_FECHAMENTO, situacao: sit, data: String(dataFechamento), valor: r2(valor),
          idorigem: idsaldoop, documento: `${operacao} de caixa PDV ${num(s.codpdv)}, operador ${num(s.codoperador)}`,
          complemento: null, tipodoc: QUEBRA_SOBRA, dataSetD: [], dataSetC: [], desclote: `${operacao} de caixa ${idsaldoop}`,
          // ⚠️ o histórico da quebra (103 na produção) imprime no legado o A PAGAR cujo CODAPG é igual ao IDSALDOOP — um título
          // sem relação nenhuma com a quebra (1.290 das 1.795 linhas de 2026). Divergência consciente: sai sem título,
          // `APAGAR DOCTO .: 000000000  `, como já saem as outras 466.
          ctxHist: { pdv: pdv3(s.codpdv), operadorNome: String(s.nome ?? ''), documento: 0, parceiro: '', obs: '' },
        });
        await sql`UPDATE saldo_operador SET contabilizado = 'S' WHERE idsaldoop = ${idsaldoop}`.execute(trx);
        res.lancamentos++;
        res.total = r2(res.total + r2(valor));
      }

      // R5 — `GetSQLCPFechamento` (:209-226): os títulos gerados pelo fechamento
      const titulos = (await sql<{ codapg: number }>`
        SELECT codapg FROM apagar WHERE origem IN ('R', 'C', 'V', 'T') AND coalesce(contabilizado, 'N') = 'N' AND codgrupo_fcx = ${g}
         ORDER BY codapg`.execute(trx)).rows.map((r) => num(r.codapg));
      for (const codapg of titulos) {
        const cp = await emSavepoint(trx, 'contabil_fechamento_cp', () => this.docs.integrarDocumentoNaTrx(trx, 'CP', codapg, dataFechamento));
        if (cp.ok) res.lancamentos += cp.v.lancamentos;
        else res.avisos.push(avisoDoErro(`título ${codapg} (a pagar do fechamento)`, cp.erro));
      }
      res.fechamentos++;
    }
    return res;
  }

  // ── Estornar (`:25-207`) — por grupo (a reabertura) ou por período (o TRON) ─────────────────────────────────────
  async estornarNaTrx(trx: AnyDB, emp: number, f: FiltroFechamentoContabil): Promise<{ linhas: number }> {
    const porGrupo = f.codgrupo != null && f.codgrupo > 0;
    const g = porGrupo ? Number(f.codgrupo) : 0;
    const noPeriodo = (alias: string) => sql`${sql.ref(`${alias}.codempresa`)} = ${emp} AND ${sql.ref(`${alias}.datalan`)} BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`;
    // ⚠️ divergência consciente no modo por período: o legado desmarca a CAIXA e apaga a origem 17 inteira do período. Aqui só
    // as linhas do fechamento — a da forma (sem TIPODOC, COMPLEMENTO = o grupo) e a da quebra/sobra: o IDORIGEM da quebra/sobra
    // é o IDSALDOOP e desmarcaria a CAIXA de mesmo número (de outra origem, como o lançamento de caixa, que também usa a flag),
    // e a origem 17 do Apollo também guarda a divergência do caixa da retaguarda (`caixa-contabil.service`)
    const daForma = sql`d.tipodoc IS NULL AND d.complemento ~ '^[0-9]+$'`;
    const lotes: number[] = [];
    const apagar = async (where: RawBuilder<unknown>) => {
      const r = (await sql<{ codlote: number | null }>`DELETE FROM diario d WHERE ${where} RETURNING d.codlote`.execute(trx)).rows;
      lotes.push(...r.map((x) => num(x.codlote)).filter((n) => n > 0));
      return r.length;
    };
    let linhas = 0;
    if (porGrupo) {
      await sql`UPDATE caixa SET contabilizado = NULL WHERE codcx IN (
                  SELECT d.idorigem FROM diario d WHERE d.codorigem = ${ORIGEM_FECHAMENTO} AND d.complemento = ${String(g)})`.execute(trx);
      await sql`UPDATE saldo_operador SET contabilizado = NULL WHERE codgrupo = ${g} AND idsaldoop IN (
                  SELECT d.idorigem FROM diario d WHERE d.codorigem = ${ORIGEM_FECHAMENTO} AND d.tipodoc = ${QUEBRA_SOBRA})`.execute(trx);
      linhas += await apagar(sql`d.codorigem = ${ORIGEM_FECHAMENTO} AND d.complemento = ${String(g)}`);
      linhas += await apagar(sql`d.codorigem = ${ORIGEM_FECHAMENTO} AND d.tipodoc = ${QUEBRA_SOBRA}
                                 AND d.idorigem IN (SELECT idsaldoop FROM saldo_operador WHERE codgrupo = ${g})`);
    } else {
      await sql`UPDATE caixa SET contabilizado = NULL WHERE codcx IN (
                  SELECT d.idorigem FROM diario d WHERE d.codorigem = ${ORIGEM_FECHAMENTO} AND ${daForma} AND ${noPeriodo('d')})`.execute(trx);
      await sql`UPDATE saldo_operador SET contabilizado = NULL WHERE idsaldoop IN (
                  SELECT d.idorigem FROM diario d WHERE d.codorigem = ${ORIGEM_FECHAMENTO} AND d.tipodoc = ${QUEBRA_SOBRA} AND ${noPeriodo('d')})`.execute(trx);
      linhas += await apagar(sql`d.codorigem = ${ORIGEM_FECHAMENTO} AND ${noPeriodo('d')} AND ((${daForma}) OR d.tipodoc = ${QUEBRA_SOBRA})`);
    }
    // o título da quebra (origem 14) e os do fechamento (origem 13): desmarca e apaga linha a linha
    const quebras = sql`SELECT s.codrcb FROM saldo_operador s WHERE s.codrcb IS NOT NULL AND coalesce(s.excluido, 'N') = 'N' ${porGrupo ? sql`AND s.codgrupo = ${g}` : sql``}`;
    const rcb = (await sql<{ coddiario: number; idorigem: number }>`
      SELECT d.coddiario, d.idorigem FROM diario d WHERE d.codorigem = 14 AND d.idorigem IN (${quebras}) ${porGrupo ? sql`` : sql`AND ${noPeriodo('d')}`}`.execute(trx)).rows;
    for (const d of rcb) {
      await sql`UPDATE areceber SET contabilizado = NULL WHERE codrcb = ${num(d.idorigem)}`.execute(trx);
      linhas += await apagar(sql`d.coddiario = ${num(d.coddiario)}`);
    }
    const doFechamento = sql`SELECT a.codapg FROM apagar a WHERE a.origem IN ('R', 'C', 'V', 'T') ${porGrupo ? sql`AND a.codgrupo_fcx = ${g}` : sql`AND a.codempresa = ${emp}`}`;
    const apg = (await sql<{ coddiario: number; idorigem: number }>`
      SELECT d.coddiario, d.idorigem FROM diario d WHERE d.codorigem = 13 AND d.idorigem IN (${doFechamento}) ${porGrupo ? sql`` : sql`AND ${noPeriodo('d')}`}`.execute(trx)).rows;
    for (const d of apg) {
      await sql`UPDATE apagar SET contabilizado = NULL WHERE codapg = ${num(d.idorigem)}`.execute(trx);
      linhas += await apagar(sql`d.coddiario = ${num(d.coddiario)}`);
    }
    if (lotes.length) {
      await sql`DELETE FROM lote_contabil l WHERE l.codlotecontabil = ANY(${[...new Set(lotes)]}::int[])
                  AND NOT EXISTS (SELECT 1 FROM diario d WHERE d.codlote = l.codlotecontabil)`.execute(trx);
    }
    return { linhas };
  }
}
