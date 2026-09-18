import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ConsRcbBxLotesDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { AreceberBaixaService } from './areceber-baixa.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * CONSULTA DE BAIXAS DO A RECEBER POR LOTE (`FRMCONSRCBBX`). **17 acessos, 4 operadores.**
 * Dossiê: `uConsRCBbx.md`. Migration 254. Gêmea de `cons-apg-bx.service.ts` (migration 253) — mesmo desenho,
 * mesmas travas, o estorno por título que já existia encadeado numa transação para o lote inteiro.
 *
 * Diferenças do lado de recebíveis: a observação editável da baixa (`OBS_EDITAVEL`), os dias de atraso na
 * baixa (data do pagamento − vencimento, no mínimo zero, como o `DIAS_ATRAZO` do legado) e o histórico do
 * contra-movimento ("…contas a receber…"). O que o legado mostrava e está morto no cliente fica de fora:
 * "BAIXA COM SALDO" (0 linhas), permutas (0) e cheques (0 com lote).
 */
@Injectable()
export class ConsRcbBxService {
  constructor(private readonly dbp: DatabaseProvider, private readonly baixa: AreceberBaixaService) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async lotes(f: ConsRcbBxLotesDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const codparceiro = f.codparceiro ?? null;
    const rows = (await sql<Record<string, unknown>>`
      WITH base AS (
        SELECT coalesce(b.idlote, -b.codrcbbx) AS lote, (b.idlote IS NULL) AS sem_lote,
               b.dtpgto, b.valorpg, b.juros, b.acre_desc, b.indr, b.codopbx, a.codparceiro
          FROM areceber_bx b
          JOIN areceber a ON a.codrcb = b.codrcb
         WHERE b.codempresa = ${emp}
           AND b.dtpgto >= ${f.dataIni}::date AND b.dtpgto < ${f.dataFim}::date + 1
           AND (${codparceiro}::integer IS NULL OR a.codparceiro = ${codparceiro}::integer)
      )
      SELECT x.lote, x.sem_lote,
             to_char(min(x.dtpgto), 'YYYY-MM-DD') AS data_pagamento,
             count(*) AS titulos, sum(x.valorpg) AS valor_pago,
             sum(coalesce(x.juros, 0)) AS juros, sum(coalesce(x.acre_desc, 0)) AS acre_desc,
             count(DISTINCT x.codparceiro) AS clientes,
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
        clientes: Number(r.clientes), razoes: r.razoes ?? '', operadorBaixa: r.operador_baixa ?? null,
        revertido: r.revertido === true, parcialmenteRevertido: r.parcialmente_revertido === true,
      })),
      truncado,
    };
  }

  async lote(lote: number): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const chave = lote < 0 ? sql`b.idlote IS NULL AND b.codrcbbx = ${-lote}` : sql`b.idlote = ${lote}`;
    const titulos = (await sql<Record<string, unknown>>`
      SELECT b.codrcbbx, a.codrcb, a.duplicata, a.tipodoc, p.razao AS cliente, a.codparceiro,
             to_char(a.dtvenda, 'YYYY-MM-DD') AS emissao, to_char(a.dtvenc, 'YYYY-MM-DD') AS vencimento,
             to_char(b.dtpgto, 'YYYY-MM-DD') AS data_pagamento,
             -- DIAS_ATRAZO do legado: pagamento − vencimento, nunca negativo
             greatest(0, (b.dtpgto::date - a.dtvenc::date)) AS dias_atraso,
             a.valor AS valor_documento, b.valorpg, coalesce(b.juros, 0) AS juros, coalesce(b.multa, 0) AS multa,
             coalesce(b.acre_desc, 0) AS acre_desc, b.obs, b.obs_editavel, o.nome AS operador_baixa, b.contabilizado,
             (b.indr = 'E') AS revertida, to_char(b.indr_data, 'YYYY-MM-DD HH24:MI') AS revertida_em, ou.nome AS revertida_por
        FROM areceber_bx b
        JOIN areceber a ON a.codrcb = b.codrcb
        LEFT JOIN parceiros p ON p.codparceiro = a.codparceiro
        LEFT JOIN operadores o ON o.codoperador = b.codopbx
        LEFT JOIN operadores ou ON ou.codoperador = b.indr_usuario
       WHERE b.codempresa = ${emp} AND ${chave}
       ORDER BY a.dtvenc, p.razao, a.codrcb
    `.execute(db)).rows;
    if (titulos.length === 0) throw new BusinessRuleError('LOTE_NAO_ENCONTRADO', { lote });
    const movimentos = lote < 0 ? [] : (await sql<Record<string, unknown>>`
      SELECT m.codmovconta, m.codconta, c.nroconta, c.titular, m.valor, m.tipomovimento,
             to_char(m.dtemissao, 'YYYY-MM-DD') AS dtemissao, m.nrodocumento, m.historico,
             op.descricao AS operacao, fp.modalidade, m.idlote, m.idlote_reversao, (m.idlote_reversao IS NOT NULL) AS contra_movimento
        FROM mov_contas_bancarias m
        LEFT JOIN contas_bancarias c ON c.codconta = m.codconta
        LEFT JOIN operacoes_conta op ON op.codopconta = m.codopconta
        LEFT JOIN formas_pgto fp ON fp.idpgto = m.idpgto
       WHERE m.idempresa = ${emp} AND (m.idlote = ${lote} OR m.idlote_reversao = ${lote})
       ORDER BY m.codmovconta
    `.execute(db)).rows;
    const revertido = titulos.every((t) => t.revertida === true);
    return {
      lote, semLote: lote < 0, revertido, parcialmenteRevertido: !revertido && titulos.some((t) => t.revertida === true),
      titulos: titulos.map((t) => ({
        ...t, codrcbbx: Number(t.codrcbbx), codrcb: Number(t.codrcb), diasAtraso: Number(t.dias_atraso ?? 0),
        valorDocumento: r2(num(t.valor_documento)), valorpg: r2(num(t.valorpg)), juros: r2(num(t.juros)), multa: r2(num(t.multa)), acreDesc: r2(num(t.acre_desc)),
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

  /** a observação editável (BtnGravarObsClick): só a linha de `ARECEBER_BX` — a de saldo não existe no cliente. */
  async gravarObs(codrcbbx: number, obs: string): Promise<{ codrcbbx: number }> {
    const emp = this.emp();
    const r = await sql`UPDATE areceber_bx SET obs_editavel = ${obs} WHERE codempresa = ${emp} AND codrcbbx = ${codrcbbx}`.execute(this.dbp.forTenant() as AnyDB);
    if (Number(r.numAffectedRows ?? 0) === 0) throw new BusinessRuleError('BAIXA_NAO_ENCONTRADA', { codrcbbx });
    return { codrcbbx };
  }

  async reverter(lote: number): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const chave = lote < 0 ? sql`b.idlote IS NULL AND b.codrcbbx = ${-lote}` : sql`b.idlote = ${lote}`;
      const ativas = (await sql<Record<string, unknown>>`
        SELECT b.codrcbbx, b.codrcb, a.cod_desconto_titulo
          FROM areceber_bx b JOIN areceber a ON a.codrcb = b.codrcb
         WHERE b.codempresa = ${emp} AND ${chave} AND coalesce(b.indr, 'I') = 'I'
         ORDER BY b.codrcbbx FOR UPDATE OF b
      `.execute(trx)).rows;
      if (ativas.length === 0) {
        const existe = (await sql<{ n: number }>`SELECT count(*)::int AS n FROM areceber_bx b WHERE b.codempresa = ${emp} AND ${chave}`.execute(trx)).rows[0];
        throw new BusinessRuleError(num(existe?.n) > 0 ? 'LOTE_JA_REVERTIDO' : 'LOTE_NAO_ENCONTRADO', { lote });
      }
      const comDesconto = ativas.find((b) => num(b.cod_desconto_titulo) > 0);
      if (comDesconto) throw new BusinessRuleError('VINCULO_DESCONTO_TITULO', { lote, codrcb: Number(comDesconto.codrcb) });

      const revertidos: number[] = [];
      for (const b of ativas) {
        await this.baixa.estornarNoTrx(trx, emp, op, Number(b.codrcb));
        revertidos.push(Number(b.codrcb));
      }
      await sql`UPDATE areceber_bx SET indr_usuario = ${op}, indr_data = now()
                 WHERE codempresa = ${emp} AND codrcbbx IN (${sql.join(ativas.map((b) => Number(b.codrcbbx)))})`.execute(trx);

      let contraMovimentos = 0;
      if (lote > 0) {
        const nome = op == null ? null : (await sql<{ nome: string }>`SELECT nome FROM operadores WHERE codoperador = ${op}`.execute(trx)).rows[0]?.nome;
        const historico = `Reabertura da baixa de contas a receber, lote ${lote}, realizada pelo usuário ${nome ?? '-'}.`;
        const novoLote = Number((await sql<{ id: string }>`SELECT nextval('seq_idlote_reversao') AS id`.execute(trx)).rows[0].id);
        const ins = await sql`
          INSERT INTO mov_contas_bancarias (codconta, idempresa, valor, tipomovimento, codopconta, historico, idpgto, codoperador, origem, idlote, idlote_reversao, dtemissao, nrodocumento, indr)
          SELECT m.codconta, m.idempresa, m.valor * -1, CASE WHEN m.tipomovimento = 'C' THEN 'D' ELSE 'C' END, m.codopconta, ${historico}, m.idpgto, ${op},
                 'REV BX AR', ${novoLote}, ${lote}, now(), m.nrodocumento, 'I'
            FROM mov_contas_bancarias m
           WHERE m.idempresa = ${emp} AND m.idlote = ${lote} AND m.idlote_reversao IS NULL
        `.execute(trx);
        contraMovimentos = Number(ins.numAffectedRows ?? 0);
      }
      return { lote, titulosRevertidos: revertidos.length, codrcbs: revertidos, contraMovimentos };
    });
  }
}
