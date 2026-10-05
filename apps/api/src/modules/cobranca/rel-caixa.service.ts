import { Injectable } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { configNaTrx } from '../compras/pedido-heranca';
import { relatorioMestre, type FiltroMestre } from '../../shared/relatorios/relatorio-mestre';

type AnyDB = Kysely<any>;
type Linha = Record<string, unknown>;
export type ModeloCaixa = 'DIVERGENCIAS' | 'VOUCHER' | 'APURACAO' | 'ABERTOS' | 'PEDIDOS';

/** o `CmbTipoRelatorio` (URelCaixa.dfm): a ordem do combo, o layout de cada classe de UCaixa.pas e os níveis do `IRelNiveis` */
export const MODELOS_CAIXA: Record<ModeloCaixa, { indice: number; arquivo: string; niveis: number; niveisPadrao: number }> = {
  DIVERGENCIAS: { indice: 0, arquivo: 'Caixa1 - Divergências de caixa.fr3', niveis: 3, niveisPadrao: 2 },
  VOUCHER: { indice: 1, arquivo: 'Caixa2 - Voucher.fr3', niveis: 0, niveisPadrao: 0 },
  APURACAO: { indice: 2, arquivo: 'Caixa3 - Apuração do caixa.fr3', niveis: 3, niveisPadrao: 2 },
  ABERTOS: { indice: 3, arquivo: 'Caixa4 - Caixas abertos.fr3', niveis: 1, niveisPadrao: 1 },
  PEDIDOS: { indice: 4, arquivo: 'Relatorio_Pedidos.fr3', niveis: 0, niveisPadrao: 0 },
};

export interface FiltroCaixa extends FiltroMestre {
  modelo: ModeloCaixa;
  codoperador?: number | null;
  codpdv?: number | null;
  /** o `CmbTipoRecurso` — só nas divergências e na apuração (`CmbTipoRelatorioChange`) */
  recurso?: string | null;
  /** apuração: "Imprime resumo das contas correntes" e "Somente contas movimentadas" */
  resumoCC?: boolean;
  somenteCCMovimentadas?: boolean;
}

/**
 * RELATÓRIOS DE CAIXA (`FRMRELCAIXA`, `URelCaixa.pas` + as classes de `UCaixa.pas`; o form herda o `TFrmRelMaster`). Dossiê: `uRelCaixa.md`.
 * Os cinco modelos do combo, cada um com o `GetSQL` da sua classe (o `QryRelatorio` → `DBDRelatorio`), o `GetSQLAuxiliar` quando há
 * (`DbdAuxiliar`) e, na apuração, o resumo por modalidade (`ProcessaResumoApuracao` → `DBResumoApuracao`) e o das contas correntes
 * (`GetResumoCC` → `DBDResumoCC`). Filtros do `MontaFiltroSQL`: o operador (`O.CODOPERADOR`), o PDV (`C.CODPDV`), o recurso (`C.TIPORECURSO`),
 * as lojas do `GetMultiEmpresa` e o período em `TRUNC(<prefixo>.<campo data>)` — o dia da loja (`FUSO_HORARIO_ACESSO`).
 *
 * ⚠️ O filtro de recurso nas DIVERGÊNCIAS: o legado o põe também na subconsulta de CX_VENDAS, que não tem TIPORECURSO (ORA-00904: a
 * tela respondia "Ocorreu um erro durante a impressão do relatório."). Aqui vale a intenção: o recurso filtra a operação do PDV.
 */
@Injectable()
export class RelCaixaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** o contexto da consulta: lojas, fuso e os pedaços de filtro */
  private async ctx(db: AnyDB, f: FiltroCaixa) {
    const emp = this.emp();
    const empresas = await empresasDoOperador(db, f.empresas ?? null);
    const tz = String((await configNaTrx(db, 'FUSO_HORARIO_ACESSO', { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' })) ?? 'America/Sao_Paulo');
    // o fuso entra como literal (validado): com parâmetro, o GROUP BY não reconhece a mesma expressão do SELECT
    const tzLit = sql.lit(/^[A-Za-z0-9_/+-]+$/.test(tz) ? tz : 'America/Sao_Paulo');
    const dia = (col: string): RawBuilder<unknown> => sql`(${sql.ref(col)} AT TIME ZONE ${tzLit})::date`;
    const periodo = (col: string): RawBuilder<unknown> => sql`${dia(col)} BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`;
    const op = f.codoperador ?? null;
    const pdv = f.codpdv ?? null;
    const rec = f.modelo === 'DIVERGENCIAS' || f.modelo === 'APURACAO' ? (f.recurso?.trim() || null) : null;
    const dataIniSql = sql`${f.dataIni}::date`;
    const dataFimSql = sql`${f.dataFim}::date`;
    return { emp, empresas, tz, dia, periodo, op, pdv, rec, dataIniSql, dataFimSql };
  }

  /** o modelo pedido: as linhas do QryRelatorio e os conjuntos auxiliares do modelo */
  async consultar(f: FiltroCaixa): Promise<{ modelo: ModeloCaixa; relatorio: Linha[]; auxiliar: Linha[]; resumoApuracao: Linha[]; resumoCC: Linha[]; empresas: number[] }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const c = await this.ctx(db, f);
    let relatorio: Linha[] = [];
    let auxiliar: Linha[] = [];
    let resumoApuracao: Linha[] = [];
    let resumoCC: Linha[] = [];
    if (f.modelo === 'DIVERGENCIAS') {
      relatorio = await this.divergencias(db, c);
      // GetSQLAuxiliar: o total por recurso das linhas
      const porRec = new Map<string, Linha>();
      for (const l of relatorio) {
        const k = String(l.tiporecurso ?? '');
        const a = porRec.get(k) ?? { tiporecurso: l.tiporecurso, valor_caixa: 0, valor_cx_vendas: 0, divergencia: 0 };
        for (const campo of ['valor_caixa', 'valor_cx_vendas', 'divergencia']) a[campo] = r2(num(a[campo]) + num(l[campo]));
        porRec.set(k, a);
      }
      auxiliar = [...porRec.values()];
    } else if (f.modelo === 'VOUCHER') {
      relatorio = await this.voucher(db, c);
    } else if (f.modelo === 'APURACAO') {
      relatorio = await this.apuracao(db, c);
      auxiliar = await this.contasInternas(db, c);
      resumoApuracao = await this.resumoApuracao(db, c, relatorio, auxiliar);
      if (f.resumoCC) resumoCC = await this.resumoContas(db, c, f.dataIni, !!f.somenteCCMovimentadas);
    } else if (f.modelo === 'ABERTOS') {
      relatorio = await this.abertos(db, c);
    } else {
      relatorio = await this.pedidos(db, c);
    }
    return { modelo: f.modelo, relatorio, auxiliar, resumoApuracao, resumoCC, empresas: c.empresas };
  }

  /**
   * O "Imprimir" (`TFrmRelMaster.GeraRelatorio`): o layout da classe com o `DBDRelatorio`, o `DbdAuxiliar` e o `DBDVariaveisAdicionais`
   * (IDEmpresas, DataInicial, DataFinal, NiveisExpandidos, Tabela + ImprimirResumoCC/SomenteCCMovimentadas/SomenteResumoCC da apuração),
   * mais o `DBResumoApuracao` e o `DBDResumoCC` na apuração. Vazio: "Não foram encontrados registros para imprimir o relatório." — a
   * apuração só recusa quando o relatório, as contas internas e o resumo das contas estão todos vazios (`AntesImprimir`).
   */
  async impressao(f: FiltroCaixa, niveis?: number | null) {
    const r = await this.consultar(f);
    const m = MODELOS_CAIXA[f.modelo];
    const vazio = f.modelo === 'APURACAO' ? !r.relatorio.length && !r.auxiliar.length && !r.resumoCC.length : !r.relatorio.length;
    const db = this.dbp.forTenantRead() as AnyDB;
    return relatorioMestre(db, {
      arquivo: m.arquivo, titulo: `Relatórios de caixa — ${m.arquivo.replace(/\.fr3$/i, '')}`, vazio,
      relatorio: r.relatorio, auxiliar: r.auxiliar,
      variaveis: {
        empresas: r.empresas, dataIni: f.dataIni, dataFim: f.dataFim, niveis: niveis ?? m.niveisPadrao, tabela: 0,
        extras: f.modelo === 'APURACAO' ? { ImprimirResumoCC: f.resumoCC ? 'S' : 'N', SomenteCCMovimentadas: f.somenteCCMovimentadas ? 'S' : 'N', SomenteResumoCC: false } : {},
      },
      extras: f.modelo === 'APURACAO' ? { DBResumoApuracao: r.resumoApuracao, DBDResumoCC: r.resumoCC } : {},
    });
  }

  // ── os modelos ──────────────────────────────────────────────────────────────────────────────────────────────
  /** os ramos da CAIXA_PDV (recarga, correspondente, voucher) que as divergências e a apuração somam (`AdicionaCaixaPDV`) */
  private ramoCaixaPdv(c: Awaited<ReturnType<RelCaixaService['ctx']>>, tipo: 'RECARGA' | 'CORRESPONDENTE' | 'VOUCHER', comChave: boolean): RawBuilder<unknown> {
    return sql`
      SELECT c.idempresa, e.fantasia, c.codoperadora AS operador, o.nome, ${c.dia('c.data')} AS data, ${tipo}::varchar AS tiporecurso, c.codpdv,
             ${comChave ? sql`c.chave,` : sql``} 0::numeric AS valor_caixa, c.${sql.ref(tipo.toLowerCase())} AS valor_cx_vendas
        FROM caixa_pdv c
        JOIN operadores o ON o.codoperador = c.codoperadora
        JOIN empresas   e ON e.idempresa   = c.idempresa
       WHERE c.codpdv IS NOT NULL AND coalesce(c.${sql.ref(tipo.toLowerCase())}, 0) <> 0
         AND ${c.periodo('c.data')} AND c.idempresa = ANY(${c.empresas}::int[])
         AND (${c.op}::int IS NULL OR o.codoperador = ${c.op}::int) AND (${c.pdv}::int IS NULL OR c.codpdv = ${c.pdv}::int)
         AND (${c.rec}::text IS NULL OR ${tipo}::text = ${c.rec}::text)`;
  }

  /** `TDivergenciasCaixa.GetSQL` (UCaixa.pas:96): PDV × caixa por empresa, operador, dia, recurso e PDV, só o que diverge */
  private async divergencias(db: AnyDB, c: Awaited<ReturnType<RelCaixaService['ctx']>>): Promise<Linha[]> {
    const rows = (await sql<Linha>`
      SELECT cur2.*, cur2.valor_caixa - cur2.valor_cx_vendas AS divergencia
        FROM (
          SELECT cur.idempresa, cur.fantasia, cur.operador, cur.nome, cur.data, cur.tiporecurso, cur.codpdv,
                 (cur.valor_caixa + (SELECT coalesce(sum(h.valor), 0) FROM hist_devolucao h
                                      WHERE coalesce(h.tipo_devolucao, 'V') = 'D' AND h.codpdv = cur.codpdv AND h.idempresa = cur.idempresa
                                        AND h.codoperador = cur.operador AND ${c.dia('h.dtvenda')} = cur.data AND cur.tiporecurso = 'DINHEIRO')) AS valor_caixa,
                 cur.valor_cx_vendas
            FROM (
              SELECT v.idempresa, e.fantasia, v.codoperadora AS operador, o.nome, v.data, v.operacao AS tiporecurso, v.nropdv AS codpdv,
                     coalesce(cx.valor_caixa, 0) AS valor_caixa, coalesce(v.valor_cx_vendas, 0) AS valor_cx_vendas
                FROM (SELECT c.idempresa, c.nropdv, c.operacao, c.codoperadora, ${c.dia('c.data')} AS data, sum(c.valor - coalesce(c.troco, 0)) AS valor_cx_vendas
                        FROM cx_vendas c
                       WHERE c.status = 'F' AND upper(c.operacao) NOT IN ('DESCONTO', 'ACRESCIMO', 'SANGRIA', 'SUPRIMENTO')
                         AND ${c.periodo('c.data')} AND c.idempresa = ANY(${c.empresas}::int[])
                         AND (${c.op}::int IS NULL OR c.codoperadora = ${c.op}::int) AND (${c.pdv}::int IS NULL OR c.nropdv = ${c.pdv}::int)
                         AND (${c.rec}::text IS NULL OR c.operacao = ${c.rec}::text)
                       GROUP BY c.idempresa, c.nropdv, c.operacao, c.codoperadora, ${c.dia('c.data')}) v
                JOIN operadores o ON o.codoperador = v.codoperadora
                JOIN empresas   e ON e.idempresa   = v.idempresa
                LEFT JOIN (SELECT c.idempresa, c.codpdv AS nropdv, c.tiporecurso AS operacao, c.operador AS codoperadora, ${c.dia('c.data')} AS data, sum(c.valor) AS valor_caixa
                             FROM caixa c LEFT JOIN plc pl ON pl.codplc = c.codplc
                            WHERE pl.tpconta = 0 AND c.codpdv IS NOT NULL AND ${c.periodo('c.data')}
                              AND (${c.op}::int IS NULL OR c.operador = ${c.op}::int) AND (${c.pdv}::int IS NULL OR c.codpdv = ${c.pdv}::int)
                              AND (${c.rec}::text IS NULL OR c.tiporecurso = ${c.rec}::text) AND c.idempresa = ANY(${c.empresas}::int[])
                            GROUP BY c.idempresa, c.codpdv, c.tiporecurso, c.operador, ${c.dia('c.data')}) cx
                       ON v.idempresa = cx.idempresa AND v.nropdv = cx.nropdv AND v.operacao = cx.operacao AND v.codoperadora = cx.codoperadora AND v.data = cx.data
               WHERE (v.valor_cx_vendas <> 0 OR cx.valor_caixa <> 0)
              UNION ALL ${this.ramoCaixaPdv(c, 'RECARGA', false)}
              UNION ALL ${this.ramoCaixaPdv(c, 'CORRESPONDENTE', false)}
              UNION ALL ${this.ramoCaixaPdv(c, 'VOUCHER', false)}
            ) cur
        ) cur2
       WHERE (cur2.valor_caixa - cur2.valor_cx_vendas) <> 0
       ORDER BY cur2.fantasia, cur2.idempresa, cur2.nome, cur2.data, cur2.tiporecurso`.execute(db)).rows;
    return rows.map(numerico(['valor_caixa', 'valor_cx_vendas', 'divergencia', 'idempresa', 'operador', 'codpdv']));
  }

  /** `TVoucher.GetSQL` (:306): o histórico de voucher do período (a venda e o cancelamento, modalidade 99) */
  private async voucher(db: AnyDB, c: Awaited<ReturnType<RelCaixaService['ctx']>>): Promise<Linha[]> {
    const rows = (await sql<Linha>`
      SELECT CASE WHEN hv.tipomodalidade = 99 THEN 'CANCELAMENTO' ELSE 'VENDA' END AS operacao, hv.codhistvoucher, hv.idempresa,
             to_char(hv.dtvenda AT TIME ZONE ${c.tz}, 'YYYY-MM-DD"T"HH24:MI:SS') AS dtvenda,
             CASE WHEN hv.valor IS NULL OR hv.valor = 0 THEN CASE WHEN hv.tipomodalidade = 99 THEN -52.90 ELSE 52.90 END ELSE hv.valor END AS valor,
             hv.codpdv, hv.codoperador, hv.codoperadora, hv.operadora, hv.nsu, hv.nsuhost, hv.autorizacao, hv.modalidadeoperadora,
             hv.nomeprodutositef, hv.qtdeprodutositef, hv.nomefornecedorsitef, hv.chave, o.nome, o.login
        FROM hist_voucher hv
        LEFT JOIN operadores o ON o.codoperador = hv.codoperador
       WHERE coalesce(hv.stregistro, 'A') <> 'E' AND ${c.periodo('hv.dtvenda')}
         AND (${c.op}::int IS NULL OR o.codoperador = ${c.op}::int) AND (${c.pdv}::int IS NULL OR hv.codpdv = ${c.pdv}::int)
         AND hv.idempresa = ANY(${c.empresas}::int[])
       ORDER BY hv.dtvenda`.execute(db)).rows;
    return rows.map(numerico(['valor', 'idempresa', 'codpdv', 'codoperador', 'codoperadora', 'qtdeprodutositef', 'codhistvoucher']));
  }

  /** `TApuracaoCaixa.GetSQL` (:433): o caixa (contas de caixa) por empresa, operador, PDV, chave, dia e recurso, com o PDV da mesma chave */
  private async apuracao(db: AnyDB, c: Awaited<ReturnType<RelCaixaService['ctx']>>): Promise<Linha[]> {
    const rows = (await sql<Linha>`
      SELECT cur2.*, (cur2.operador::text || cur2.codpdv::text)::varchar(20) AS operadorcodpdv, cur2.valor_caixa - cur2.valor_cx_vendas AS divergencia
        FROM (
          SELECT cur.idempresa, cur.fantasia, cur.operador, cur.nome, cur.codpdv, cur.chave, cur.data, cur.tiporecurso, cur.valor_caixa, cur.valor_cx_vendas
            FROM (
              SELECT c.idempresa, e.fantasia, c.operador, o.nome, ${c.dia('c.data')} AS data, c.tiporecurso, c.codpdv, c.chave, sum(c.valor) AS valor_caixa,
                     (SELECT sum(v.valor - coalesce(v.troco, 0)) FROM cx_vendas v
                       WHERE ${c.dia('v.data')} = ${c.dia('c.data')} AND v.codoperadora = c.operador AND upper(v.operacao) = upper(c.tiporecurso)
                         AND v.nropdv = c.codpdv AND v.chave = c.chave AND v.status = 'F' AND upper(v.operacao) NOT IN ('DESCONTO', 'ACRESCIMO')
                         AND v.idempresa = c.idempresa
                       GROUP BY upper(v.operacao)) AS valor_cx_vendas
                FROM caixa c
                JOIN operadores o ON o.codoperador = c.operador
                JOIN empresas   e ON e.idempresa   = c.idempresa
                LEFT JOIN plc  pl ON pl.codplc     = c.codplc
               WHERE pl.tpconta = 0 AND c.codpdv IS NOT NULL AND ${c.periodo('c.data')}
                 AND (${c.op}::int IS NULL OR o.codoperador = ${c.op}::int) AND (${c.pdv}::int IS NULL OR c.codpdv = ${c.pdv}::int)
                 AND (${c.rec}::text IS NULL OR c.tiporecurso = ${c.rec}::text) AND c.idempresa = ANY(${c.empresas}::int[])
               GROUP BY c.idempresa, e.fantasia, c.operador, o.nome, c.data, c.tiporecurso, c.codpdv, c.chave
              UNION ALL ${this.ramoCaixaPdv(c, 'RECARGA', true)}
              UNION ALL ${this.ramoCaixaPdv(c, 'CORRESPONDENTE', true)}
              UNION ALL ${this.ramoCaixaPdv(c, 'VOUCHER', true)}
            ) cur
        ) cur2
       ORDER BY cur2.fantasia, cur2.idempresa, cur2.nome, cur2.codpdv, cur2.chave, cur2.data, cur2.tiporecurso`.execute(db)).rows;
    return rows.map(numerico(['valor_caixa', 'valor_cx_vendas', 'divergencia', 'idempresa', 'operador', 'codpdv']));
  }

  /** `TApuracaoCaixa.GetSQLAuxiliar` (:543): as contas internas marcadas para a apuração, por modalidade (sem as transferências) */
  private async contasInternas(db: AnyDB, c: Awaited<ReturnType<RelCaixaService['ctx']>>): Promise<Linha[]> {
    const rows = (await sql<Linha>`
      SELECT titular, codconta, nroconta, banco, modalidade, sum(valor) AS valor, sum(saida) AS saida, sum(entrada) AS entrada
        FROM (SELECT cb.titular, m.codconta, cb.nroconta, b.banco, coalesce(fp.modalidade, 'DINHEIRO') AS modalidade, sum(m.valor) AS valor,
                     sum(CASE WHEN m.valor < 0 THEN abs(m.valor) ELSE 0 END) AS saida, sum(CASE WHEN m.valor > 0 THEN m.valor ELSE 0 END) AS entrada
                FROM mov_contas_bancarias m
                JOIN contas_bancarias cb ON cb.codconta = m.codconta
                LEFT JOIN bancos b ON b.codbco = cb.codbco
                LEFT JOIN formas_pgto fp ON fp.idpgto = m.idpgto
               WHERE coalesce(cb.exibe_rel_apuracao_caixa, 'N') = 'S' AND coalesce(m.nrodocumento, '.') <> 'TRANSFERENCIA'
                 AND m.dtemissao BETWEEN ${c.dataIniSql} AND ${c.dataFimSql}
                 AND (${c.rec}::text IS NULL OR coalesce(fp.modalidade, 'DINHEIRO') = ${c.rec}::text)
               GROUP BY cb.titular, m.codconta, cb.nroconta, b.banco, coalesce(fp.modalidade, 'DINHEIRO'), m.idpgto) x
       GROUP BY titular, codconta, nroconta, banco, modalidade
       ORDER BY titular, codconta, modalidade`.execute(db)).rows;
    return rows.map(numerico(['valor', 'saida', 'entrada', 'codconta']));
  }

  /**
   * `ProcessaResumoApuracao` (URelCaixa.pas:338): por modalidade — "Total PDV" (o caixa), "Total contas internas", "Total PDV + Contas
   * internas", "Outras informações" (descontos do PDV, negativos, e cancelamentos — o `QryDescCanc`) e "Adiantamentos a Receber" (os
   * adiantamentos de parceiro tipo D do período, negativos, por conta) — na ordem ORDENACAO;MODALIDADE.
   */
  private async resumoApuracao(db: AnyDB, c: Awaited<ReturnType<RelCaixaService['ctx']>>, relatorio: Linha[], auxiliar: Linha[]): Promise<Linha[]> {
    const res = new Map<string, Linha>();
    const add = (modalidade: string, tipo: string, valor: number, entrada: number, saida: number, ordenacao: number) => {
      const k = `${modalidade}|${tipo}`;
      const l = res.get(k) ?? { modalidade, tipo, ordenacao, valor: 0, entrada: 0, saida: 0 };
      l.valor = r2(num(l.valor) + valor); l.entrada = r2(num(l.entrada) + entrada); l.saida = r2(num(l.saida) + saida);
      res.set(k, l);
    };
    for (const l of relatorio) {
      add(String(l.tiporecurso ?? ''), 'Total PDV', num(l.valor_caixa), 0, 0, 1);
      add(String(l.tiporecurso ?? ''), 'Total PDV + Contas internas', num(l.valor_caixa), 0, 0, 4);
    }
    for (const a of auxiliar) {
      add(String(a.modalidade ?? ''), 'Total contas internas', num(a.valor), num(a.entrada), num(a.saida), 3);
      add(String(a.modalidade ?? ''), 'Total PDV + Contas internas', num(a.valor), num(a.entrada), num(a.saida), 4);
    }
    // QryDescCanc: os descontos das vendas (o PDV vira o prefixo do pedido) e os cancelamentos da CAIXA_PDV, com os mesmos filtros
    const dc = (await sql<{ total_desconto: unknown; total_cancelamentos: unknown }>`
      SELECT (SELECT sum(coalesce(v.desc_acre_medio, 0) + coalesce(v.desc_acre_item, 0)) FROM vendas v LEFT JOIN operadores o ON o.codoperador = v.operador
               WHERE (coalesce(v.desc_acre_medio, 0) < 0 OR coalesce(v.desc_acre_item, 0) < 0) AND v.cancelado <> 'S'
                 AND (${c.op}::int IS NULL OR o.codoperador = ${c.op}::int) AND (${c.pdv}::int IS NULL OR v.nropedido LIKE lpad(${c.pdv}::text, 2, '0') || '%')
                 AND v.idempresa = ANY(${c.empresas}::int[]) AND ${c.periodo('v.dtvenda')}) AS total_desconto,
             (SELECT sum(coalesce(v.cancelamentos, 0)) FROM caixa_pdv v LEFT JOIN operadores o ON o.codoperador = v.codoperadora
               WHERE coalesce(v.cancelamentos, 0) > 0 AND (${c.op}::int IS NULL OR o.codoperador = ${c.op}::int) AND (${c.pdv}::int IS NULL OR v.codpdv = ${c.pdv}::int)
                 AND v.idempresa = ANY(${c.empresas}::int[]) AND ${c.periodo('v.data')}) AS total_cancelamentos`.execute(db)).rows[0];
    add('Descontos PDV', 'Outras informações', num(dc?.total_desconto) * -1, 0, 0, 2);
    add('Cancelamentos PDV', 'Outras informações', num(dc?.total_cancelamentos), 0, 0, 2);
    // QryAReceberAdiantamento: os adiantamentos tipo D do período, por conta corrente
    const ad = (await sql<{ titular: string | null; valor: unknown }>`
      SELECT cb.titular, cb.codconta, cb.nroconta, 'DINHEIRO - ' || 'A RECEBER' AS modalidade, sum(mov.valor) AS valor
        FROM adiantamento_forn ad
        JOIN contas_bancarias cb ON cb.codconta = ad.codcontacorrente
        JOIN mov_contas_bancarias mov ON mov.codmovconta = ad.codmovconta
       WHERE ad.idempresa = ANY(${c.empresas}::int[]) AND ${c.periodo('ad.dtadiantamento')} AND ad.tipo = 'D'
       GROUP BY cb.titular, cb.codconta, cb.nroconta`.execute(db)).rows;
    for (const a of ad) add(String(a.titular ?? ''), 'Adiantamentos a Receber', num(a.valor) * -1, 0, 0, 3);
    return [...res.values()].sort((a, b) => num(a.ordenacao) - num(b.ordenacao) || String(a.modalidade).localeCompare(String(b.modalidade)));
  }

  /** `TApuracaoCaixa.GetResumoCC` (:370): por conta corrente — entradas, saídas, saldo liberado e pendente e o saldo anterior ao período */
  private async resumoContas(db: AnyDB, c: Awaited<ReturnType<RelCaixaService['ctx']>>, dataIni: string, somenteMovimentadas: boolean): Promise<Linha[]> {
    const rows = (await sql<Linha>`
      WITH mov AS (
        SELECT m.codconta,
               coalesce(sum(CASE WHEN valor > 0 THEN valor ELSE 0 END), 0) AS entradas,
               coalesce(sum(CASE WHEN valor < 0 THEN valor ELSE 0 END), 0) AS saidas,
               coalesce(sum(CASE WHEN liberado = 'S' THEN valor ELSE 0 END), 0) AS saldo_periodo,
               coalesce(sum(CASE WHEN liberado <> 'S' OR liberado IS NULL THEN valor ELSE 0 END), 0) AS saldo_periodo_pendente
          FROM mov_contas_bancarias m
         WHERE ${somenteMovimentadas ? sql`m.dtemissao BETWEEN ${c.dataIniSql} AND ${c.dataFimSql}` : sql`true`}
         GROUP BY m.codconta)
      SELECT c.titular, c.nroconta, cur.codconta, cur.entradas, cur.saidas, cur.saldo_periodo, cur.saldo_periodo_pendente,
             (SELECT sum(m.valor) FROM mov_contas_bancarias m
               WHERE m.dtemissao BETWEEN cur.emissao AND (${dataIni}::date - 1) AND m.codconta = cur.codconta AND liberado = 'S') AS saldo_anterior
        FROM (SELECT m.codconta, min(m.dtemissao) AS emissao, mov.entradas, mov.saidas, mov.saldo_periodo, mov.saldo_periodo_pendente
                FROM mov_contas_bancarias m JOIN mov ON mov.codconta = m.codconta
               GROUP BY m.codconta, mov.entradas, mov.saidas, mov.saldo_periodo, mov.saldo_periodo_pendente) cur
        LEFT JOIN contas_bancarias c ON c.codconta = cur.codconta
       ORDER BY c.titular, c.nroconta`.execute(db)).rows;
    return rows.map(numerico(['entradas', 'saidas', 'saldo_periodo', 'saldo_periodo_pendente', 'saldo_anterior', 'codconta']));
  }

  /** `TCaixasAbertos.GetSQL` (:634): as sessões do período ainda não recolhidas à tesouraria */
  private async abertos(db: AnyDB, c: Awaited<ReturnType<RelCaixaService['ctx']>>): Promise<Linha[]> {
    const rows = (await sql<Linha>`
      SELECT c.idempresa, c.nropdv, o.nome, c.codoperadora, c.status, c.tesouraria, p.codpdv, c.chave,
             to_char(cp.horaentrada AT TIME ZONE ${c.tz}, 'YYYY-MM-DD"T"HH24:MI:SS') AS horaentrada,
             to_char(cp.horasaida AT TIME ZONE ${c.tz}, 'YYYY-MM-DD"T"HH24:MI:SS') AS horasaida, ${c.dia('c.data')} AS data
        FROM cx_vendas c
        LEFT JOIN operadores o ON o.codoperador = c.codoperadora
        LEFT JOIN pdv        p ON p.nropdv = c.nropdv AND p.codempresa = c.idempresa
        LEFT JOIN caixa_pdv cp ON cp.chave = c.chave AND cp.codpdv = c.nropdv AND ${c.dia('cp.data')} = ${c.dia('c.data')} AND c.idempresa = cp.idempresa
       WHERE coalesce(c.tesouraria, 'N') <> 'S' AND c.idempresa = ANY(${c.empresas}::int[]) AND ${c.periodo('c.data')}
         AND (${c.op}::int IS NULL OR o.codoperador = ${c.op}::int) AND (${c.pdv}::int IS NULL OR c.nropdv = ${c.pdv}::int)
       GROUP BY c.idempresa, c.nropdv, o.nome, c.codoperadora, c.status, c.tesouraria, p.codpdv, c.chave, cp.horasaida, cp.horaentrada, ${c.dia('c.data')}
       ORDER BY ${c.dia('c.data')}, c.idempresa, c.nropdv, o.nome, cp.horaentrada, cp.horasaida`.execute(db)).rows;
    return rows.map(numerico(['idempresa', 'nropdv', 'codoperadora', 'codpdv']));
  }

  /**
   * `TCaixaPedidos.GetSQL` (:683): os recebimentos do PDV que vieram de pedido (VENDAS.PEDIDONRO → PEDIDOS), com o nº do e-commerce.
   * PEDIDO_ECOMMERCE está vazia na produção e não existe no destino: o NROECOMERCE sai nulo, como o LEFT JOIN vazio.
   */
  private async pedidos(db: AnyDB, c: Awaited<ReturnType<RelCaixaService['ctx']>>): Promise<Linha[]> {
    const rows = (await sql<Linha>`
      SELECT DISTINCT c.nropedido, NULL::varchar AS nroecomerce, c.nropdv, to_char(c.data AT TIME ZONE ${c.tz}, 'YYYY-MM-DD"T"HH24:MI:SS') AS data, c.valor,
             v.operador, o.nome, v.codparceiro, a.fantasia
        FROM cx_vendas c
        JOIN vendas v ON v.nropedido = c.nropedido AND v.idempresa = c.idempresa
        JOIN pedidos p ON p.nropedido = substr(v.nropedido, 1, 2) || v.pedidonro AND p.idempresa = c.idempresa
        LEFT JOIN operadores o ON o.codoperador = v.operador
        LEFT JOIN parceiros  a ON a.codparceiro = v.codparceiro
       WHERE c.idempresa = ANY(${c.empresas}::int[]) AND c.valor > 0 AND ${c.periodo('c.data')}
         AND (${c.op}::int IS NULL OR v.operador = ${c.op}::int) AND (${c.pdv}::int IS NULL OR c.nropdv = ${c.pdv}::int)
       ORDER BY c.nropdv`.execute(db)).rows;
    return rows.map(numerico(['valor', 'nropdv', 'operador', 'codparceiro']));
  }

  /** o `PreencheRecurso`: os recursos do CAIXA mais os três da CAIXA_PDV, em ordem */
  async recursos(): Promise<string[]> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = (await sql<{ tiporecurso: string }>`
      SELECT tiporecurso FROM (SELECT DISTINCT tiporecurso FROM caixa WHERE tiporecurso IS NOT NULL
                               UNION ALL SELECT 'CORRESPONDENTE' UNION ALL SELECT 'RECARGA' UNION ALL SELECT 'VOUCHER') x
       ORDER BY tiporecurso`.execute(db)).rows;
    return rows.map((r) => r.tiporecurso);
  }
}

const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const r2 = (x: number) => Math.round((x + (x >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
/** o node-pg entrega numeric como texto: as colunas de valor viram número; a data (date) vira 'AAAA-MM-DD' */
const numerico = (campos: string[]) => (r: Linha): Linha => {
  const o: Linha = { ...r };
  for (const k of campos) if (o[k] != null && o[k] !== '') o[k] = num(o[k]);
  for (const [k, v] of Object.entries(o)) if (v instanceof Date) o[k] = `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return o;
};
