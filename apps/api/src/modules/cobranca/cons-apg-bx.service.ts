import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ConsApgBxLotesDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ApagarBaixaService } from './apagar-baixa.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * CONSULTA DE BAIXAS DO A PAGAR POR LOTE (`FRMCONSAPGBX`). **20 acessos, 7 operadores.**
 * Dossiê: `uConsAPGbx.md`. Migration 253.
 *
 * Abre um LOTE de baixa: os títulos baixados (com a flag de revertido), o movimento bancário do lote, e o
 * botão **Reverter baixa** — que desfaz o lote inteiro numa transação, como `TReversaoBaixaContasPagar`.
 *
 * ── A reversão encadeia o estorno por título que já existia ───────────────────────────────────────────
 * `ApagarBaixaService.estornarNoTrx` faz, por título, o que o legado faz por baixa: período fechado pela
 * DTPGTO, estorno contábil na mesma transação, saldo parcial, `INDR='E'`, estorno de caixa (recusa caixa
 * fechado), reabre título e adiantamento. Aqui isso roda para todos os títulos ativos do lote dentro de UMA
 * transação, e depois nasce o contra-movimento bancário de cada movimento do lote (tipo invertido, valor
 * negativo, novo IDLOTE, `idlote_reversao` = lote original) — o histórico é o do legado, palavra por palavra.
 *
 * ── O que o dado do cliente diz ───────────────────────────────────────────────────────────────────────
 * 51.589 baixas em 7.383 lotes; 4.483 reversões, SEMPRE do lote inteiro (461 lotes, 0 parciais); 100% dos
 * lotes de 2026 têm movimento bancário. Cheques: 0 linhas com lote — as grades de cheque estão mortas.
 */
@Injectable()
export class ConsApgBxService {
  constructor(private readonly dbp: DatabaseProvider, private readonly baixa: ApagarBaixaService) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** a busca F3: os lotes do período. Uma baixa sem lote (as feitas no Apollo) é um lote de um. */
  async lotes(f: ConsApgBxLotesDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const codparceiro = f.codparceiro ?? null;
    const rows = (await sql<Record<string, unknown>>`
      WITH base AS (
        SELECT coalesce(b.idlote, -b.codapgbx) AS lote, (b.idlote IS NULL) AS sem_lote,
               b.dtpgto, b.valorpg, b.juros, b.acre_desc, b.indr, b.codopbx, a.codparceiro
          FROM apagar_bx b
          JOIN apagar a ON a.codapg = b.codapg
         WHERE b.codempresa = ${emp}
           AND b.dtpgto >= ${f.dataIni}::date AND b.dtpgto < ${f.dataFim}::date + 1
           AND (${codparceiro}::integer IS NULL OR a.codparceiro = ${codparceiro}::integer)
      )
      SELECT x.lote, x.sem_lote,
             to_char(min(x.dtpgto), 'YYYY-MM-DD') AS data_pagamento,
             count(*) AS titulos,
             sum(x.valorpg) AS valor_pago,
             sum(coalesce(x.juros, 0)) AS juros,
             sum(coalesce(x.acre_desc, 0)) AS acre_desc,
             count(DISTINCT x.codparceiro) AS fornecedores,
             (SELECT string_agg(DISTINCT p.razao, ', ' ORDER BY p.razao)
                FROM base y JOIN parceiros p ON p.codparceiro = y.codparceiro WHERE y.lote = x.lote) AS razoes,
             (SELECT o.nome FROM operadores o WHERE o.codoperador = max(x.codopbx)) AS operador_baixa,
             bool_and(x.indr = 'E') AS revertido,
             bool_or(x.indr = 'E') AND NOT bool_and(x.indr = 'E') AS parcialmente_revertido
        FROM base x
       GROUP BY x.lote, x.sem_lote
      HAVING ${f.situacao} = 'todos'
          OR (${f.situacao} = 'ativos' AND NOT bool_and(x.indr = 'E'))
          OR (${f.situacao} = 'revertidos' AND bool_and(x.indr = 'E'))
       ORDER BY min(x.dtpgto) DESC, x.lote DESC
       LIMIT ${f.limite + 1}
    `.execute(db)).rows;
    const truncado = rows.length > f.limite;
    return {
      lotes: (truncado ? rows.slice(0, f.limite) : rows).map((r) => ({
        lote: Number(r.lote), semLote: r.sem_lote === true, dataPagamento: r.data_pagamento,
        titulos: Number(r.titulos), valorPago: r2(num(r.valor_pago)), juros: r2(num(r.juros)), acreDesc: r2(num(r.acre_desc)),
        fornecedores: Number(r.fornecedores), razoes: r.razoes ?? '', operadorBaixa: r.operador_baixa ?? null,
        revertido: r.revertido === true, parcialmenteRevertido: r.parcialmente_revertido === true,
      })),
      truncado,
    };
  }

  /** abre o lote: títulos (o que a GET_APAGARBX/_REVERTIDAS mostram) + movimento bancário do lote e os contra-movimentos. */
  async lote(lote: number): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const chave = lote < 0 ? sql`b.idlote IS NULL AND b.codapgbx = ${-lote}` : sql`b.idlote = ${lote}`;

    const titulos = (await sql<Record<string, unknown>>`
      SELECT b.codapgbx, a.codapg, a.duplicata, a.nrodup, a.tipodoc, p.razao AS fornecedor, a.codparceiro,
             to_char(a.dtcompra, 'YYYY-MM-DD') AS emissao, to_char(a.dtvenc, 'YYYY-MM-DD') AS vencimento,
             to_char(b.dtpgto, 'YYYY-MM-DD') AS data_pagamento,
             (a.valor + coalesce(a.vendor, 0) - coalesce(a.desconto, 0)) AS valor_documento,
             b.valorpg, coalesce(b.juros, 0) AS juros, coalesce(b.acre_desc, 0) AS acre_desc, coalesce(a.txjuros, 0) AS tx_juros,
             b.obs, o.nome AS operador_baixa, b.contabilizado,
             (b.indr = 'E') AS revertida, to_char(b.indr_data, 'YYYY-MM-DD HH24:MI') AS revertida_em, ou.nome AS revertida_por,
             n.nronf AS nota_fiscal, a.cod_desconto_titulo
        FROM apagar_bx b
        JOIN apagar a ON a.codapg = b.codapg
        LEFT JOIN parceiros p ON p.codparceiro = a.codparceiro
        LEFT JOIN operadores o ON o.codoperador = b.codopbx
        LEFT JOIN operadores ou ON ou.codoperador = b.indr_usuario
        LEFT JOIN nf n ON n.codnf = a.idnf
       WHERE b.codempresa = ${emp} AND ${chave}
       ORDER BY p.razao, a.dtvenc, a.codapg
    `.execute(db)).rows;
    if (titulos.length === 0) throw new BusinessRuleError('LOTE_NAO_ENCONTRADO', { lote });

    const movimentos = lote < 0 ? [] : (await sql<Record<string, unknown>>`
      SELECT m.codmovconta, m.codconta, c.nroconta, c.titular, m.valor, m.tipomovimento,
             to_char(m.dtemissao, 'YYYY-MM-DD') AS dtemissao, m.nrodocumento, m.historico,
             op.descricao AS operacao, fp.modalidade, m.idlote, m.idlote_reversao,
             (m.idlote_reversao IS NOT NULL) AS contra_movimento
        FROM mov_contas_bancarias m
        LEFT JOIN contas_bancarias c ON c.codconta = m.codconta
        LEFT JOIN operacoes_conta op ON op.codopconta = m.codopconta
        LEFT JOIN formas_pgto fp ON fp.idpgto = m.idpgto
       WHERE m.idempresa = ${emp} AND (m.idlote = ${lote} OR m.idlote_reversao = ${lote})
       ORDER BY m.codmovconta
    `.execute(db)).rows;

    const revertido = titulos.every((t) => t.revertida === true);
    return {
      lote, semLote: lote < 0, revertido,
      parcialmenteRevertido: !revertido && titulos.some((t) => t.revertida === true),
      titulos: titulos.map((t) => ({
        ...t, codapgbx: Number(t.codapgbx), codapg: Number(t.codapg),
        valorDocumento: r2(num(t.valor_documento)), valorpg: r2(num(t.valorpg)), juros: r2(num(t.juros)), acreDesc: r2(num(t.acre_desc)), txJuros: r2(num(t.tx_juros)),
        revertida: t.revertida === true,
      })),
      movimentos: movimentos.map((m) => ({ ...m, codmovconta: Number(m.codmovconta), valor: r2(num(m.valor)), contraMovimento: m.contra_movimento === true })),
      totais: {
        titulos: titulos.length,
        valorPago: r2(titulos.reduce((s, t) => s + num(t.valorpg), 0)),
        juros: r2(titulos.reduce((s, t) => s + num(t.juros), 0)),
        valorDocumento: r2(titulos.reduce((s, t) => s + num(t.valor_documento), 0)),
      },
    };
  }

  /**
   * Reverter o lote inteiro, numa transação — `TReversaoBaixaContasPagar.ReverteLote`. As travas do
   * `ReversaoPermitida` que o dado alcança: lote inexistente/já revertido, vínculo de desconto de títulos
   * (19 baixados no cliente); período fechado e caixa fechado são checados pelo estorno de cada título.
   */
  async reverter(lote: number): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const chave = lote < 0 ? sql`b.idlote IS NULL AND b.codapgbx = ${-lote}` : sql`b.idlote = ${lote}`;
      const ativas = (await sql<Record<string, unknown>>`
        SELECT b.codapgbx, b.codapg, a.cod_desconto_titulo
          FROM apagar_bx b JOIN apagar a ON a.codapg = b.codapg
         WHERE b.codempresa = ${emp} AND ${chave} AND coalesce(b.indr, 'I') = 'I'
         ORDER BY b.codapgbx
         FOR UPDATE OF b
      `.execute(trx)).rows;
      if (ativas.length === 0) {
        const existe = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM apagar_bx b WHERE b.codempresa = ${emp} AND ${chave}`.execute(trx)).rows[0];
        throw new BusinessRuleError(num(existe?.n) > 0 ? 'LOTE_JA_REVERTIDO' : 'LOTE_NAO_ENCONTRADO', { lote });
      }
      const comDesconto = ativas.find((b) => num(b.cod_desconto_titulo) > 0);
      if (comDesconto) throw new BusinessRuleError('VINCULO_DESCONTO_TITULO', { lote, codapg: Number(comDesconto.codapg) });

      // cada título passa pelo estorno que já existia — período fechado, contábil, saldo, caixa, adiantamento
      const revertidos: number[] = [];
      for (const b of ativas) {
        await this.baixa.estornarNoTrx(trx, emp, op, Number(b.codapg));
        revertidos.push(Number(b.codapg));
      }
      await sql`UPDATE apagar_bx SET indr_usuario = ${op}, indr_data = now()
                 WHERE codempresa = ${emp} AND codapgbx IN (${sql.join(ativas.map((b) => Number(b.codapgbx)))})`.execute(trx);

      // o contra-movimento bancário, um por movimento do lote (UReversaoBaixaContasPagar.pas:113-153)
      let contraMovimentos = 0;
      if (lote > 0) {
        const nome = op == null ? null : (await sql<{ nome: string }>`SELECT nome FROM operadores WHERE codoperador = ${op}`.execute(trx)).rows[0]?.nome;
        const historico = `Reabertura da baixa de contas a pagar, lote ${lote}, realizada pelo usuário ${nome ?? '-'}.`;
        const novoLote = Number((await sql<{ id: string }>`SELECT nextval('seq_idlote_reversao') AS id`.execute(trx)).rows[0].id);
        const ins = await sql`
          INSERT INTO mov_contas_bancarias (codconta, idempresa, valor, tipomovimento, codopconta, historico, idpgto, codoperador, origem, idlote, idlote_reversao, dtemissao, nrodocumento, indr)
          SELECT m.codconta, m.idempresa, m.valor * -1, CASE WHEN m.tipomovimento = 'C' THEN 'D' ELSE 'C' END, m.codopconta, ${historico}, m.idpgto, ${op},
                 'REV BX AP', ${novoLote}, ${lote}, now(), m.nrodocumento, 'I'
            FROM mov_contas_bancarias m
           WHERE m.idempresa = ${emp} AND m.idlote = ${lote} AND m.idlote_reversao IS NULL
        `.execute(trx);
        contraMovimentos = Number(ins.numAffectedRows ?? 0);
      }
      return { lote, titulosRevertidos: revertidos.length, codapgs: revertidos, contraMovimentos };
    });
  }
}
