import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { MovimentacoesDiaDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * MOVIMENTAÇÕES DO DIA (`FRMMOVIMENTACOESDIA`). **27 acessos, 8 operadores.**
 * Dossiê: `uMovimentacoesDia.md`. Migration 247.
 *
 * O "o que aconteceu hoje, e quem fez": **pedidos**, **contas pagas**, **contas recebidas** e o **log de
 * histórico**, os quatro no mesmo período e podendo recortar por operador. É a auditoria operacional do dia.
 *
 * ── ⚠️ As quatro consultas do legado não filtram empresa ──────────────────────────────────────────────
 * Nenhuma das quatro tem `IDEMPRESA`, e as views que elas usam (`GET_ARECEBERBX`, `GET_APAGARBX`,
 * `GET_PEDIDOSRELAT_RECURSOS`) também não. Num sistema de três lojas, "o que aconteceu hoje" virava o que
 * aconteceu nas três. Aqui as quatro são tenant-scoped.
 *
 * ── Por que não usar as views do legado ───────────────────────────────────────────────────────────────
 * `GET_ARECEBERBX` carrega o `JURO_CALCULADO` com o **default de 9% a.m.** quando o título não tem taxa — o
 * mesmo juro fantasma que rendeu **R$ 11,5 milhões** de diferença em `FRMCONSCLIRCB` (migration 227). Esta
 * tela não precisa de juro; lendo das tabelas base, ele não entra por acidente.
 */
@Injectable()
export class MovimentacoesDiaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: MovimentacoesDiaDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const op = f.codoperador ?? null;

    const recebidos = (await sql<Record<string, unknown>>`
      SELECT coalesce(p.razao, '(sem parceiro)') AS cliente,
             bx.dtpgto AS data_pagamento, r.dtvenda AS data_venda, r.dtvenc AS data_venceu,
             bx.valorpg AS valor_pago, r.valor AS valor_documento,
             trim(coalesce(bx.obs, '')) AS historico,
             coalesce(o.nome, '') AS operador_baixa, bx.codopbx AS codoperador,
             r.codrcb, bx.idlote
        FROM areceber_bx bx
        JOIN areceber r       ON r.codrcb = bx.codrcb
        LEFT JOIN parceiros p ON p.codparceiro = r.codparceiro
        LEFT JOIN operadores o ON o.codoperador = bx.codopbx
       WHERE r.codempresa = ${emp}
         AND coalesce(bx.indr, 'I') = 'I'
         AND bx.dtpgto::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         AND (${op}::int IS NULL OR bx.codopbx = ${op}::int)
       ORDER BY bx.dtpgto, p.razao
       LIMIT ${f.limite}
    `.execute(db)).rows;

    const pagos = (await sql<Record<string, unknown>>`
      SELECT coalesce(p.razao, '(sem parceiro)') AS fornecedor,
             bx.dtpgto AS data_pagamento, a.dtcompra AS data_compra, a.dtvenc AS data_venceu,
             bx.valorpg AS valor_pago, a.valor AS valor_documento,
             trim(coalesce(bx.obs, '')) AS historico,
             coalesce(o.nome, '') AS operador_baixa, bx.codopbx AS codoperador,
             a.codapg, bx.idlote
        FROM apagar_bx bx
        JOIN apagar a         ON a.codapg = bx.codapg
        LEFT JOIN parceiros p ON p.codparceiro = a.codparceiro
        LEFT JOIN operadores o ON o.codoperador = bx.codopbx
       WHERE a.codempresa = ${emp}
         AND coalesce(bx.indr, 'I') = 'I'
         AND bx.dtpgto::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         AND (${op}::int IS NULL OR bx.codopbx = ${op}::int)
       ORDER BY bx.dtpgto, p.razao
       LIMIT ${f.limite}
    `.execute(db)).rows;

    // ⚠️ no destino `pedidos` é por ITEM (o `nropedido` agrupa as linhas); o legado lia de uma view que já
    // vinha agrupada por pedido. Aqui a agregação é explícita, e o valor é a soma de qtde × preço.
    const pedidos = (await sql<Record<string, unknown>>`
      SELECT pe.nropedido,
             max(coalesce(pe.cliente, p.razao, '(sem parceiro)')) AS cliente,
             max(pe.operador) AS codoperador,
             max(coalesce(o.nome, '')) AS operador,
             min(pe.dtvenda) AS data,
             round(sum(coalesce(pe.qtde, 0) * coalesce(pe.vrvenda, 0))::numeric, 2) AS valor,
             count(*)::int AS itens,
             max(pe.tipo) AS tipo, max(pe.dt_fatu) AS dt_processamento
        FROM pedidos pe
        LEFT JOIN parceiros p  ON p.codparceiro = pe.codparceiro
        LEFT JOIN operadores o ON o.codoperador = pe.operador
       WHERE pe.idempresa = ${emp}
         AND coalesce(pe.cancelado, 'N') = 'N'
         AND coalesce(pe.tipo, 'P') = 'P'
         AND pe.dtvenda::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         AND (${op}::int IS NULL OR pe.operador = ${op}::int)
       GROUP BY pe.nropedido
       ORDER BY min(pe.dtvenda), pe.nropedido
       LIMIT ${f.limite}
    `.execute(db)).rows;

    const historico = (await sql<Record<string, unknown>>`
      SELECT h.tabela, h.coddoc, h.data, h.historico, h.codoperador,
             coalesce(o.nome, '') AS nome, h.auxiliar
        FROM historico h
        LEFT JOIN operadores o ON o.codoperador = h.codoperador
       WHERE (h.codempresa = ${emp} OR h.codempresa IS NULL)
         AND h.data::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         AND (${op}::int IS NULL OR h.codoperador = ${op}::int)
       ORDER BY h.data DESC, h.codhist DESC
       LIMIT ${f.limite}
    `.execute(db)).rows;

    const soma = (rows: Array<Record<string, unknown>>, campo: string) =>
      r2(rows.reduce((s, r) => s + num(r[campo]), 0));

    return {
      recebidos, pagos, pedidos, historico,
      totais: {
        recebidos: { itens: recebidos.length, valor: soma(recebidos, 'valor_pago') },
        pagos: { itens: pagos.length, valor: soma(pagos, 'valor_pago') },
        pedidos: { itens: pedidos.length, valor: soma(pedidos, 'valor') },
        historico: { itens: historico.length },
      },
    };
  }
}
