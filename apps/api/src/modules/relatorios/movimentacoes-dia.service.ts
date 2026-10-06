import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { MovimentacoesDiaDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { empresaParaRelatorio, registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * MOVIMENTAÇÕES DO DIA (`FRMMOVIMENTACOESDIA`). **27 acessos, 8 operadores.**
 * Dossiê: `uMovimentacoesDia.md`. Migration 247; corte 2 em 06/10/2026.
 *
 * O "o que aconteceu no período, e quem fez": pedidos, contas pagas, contas recebidas e o log de histórico. O corte 2 refez as quatro
 * consultas pelas views que o legado lê (definições lidas da produção, só leitura):
 *  - RECEBIDAS (`GET_ARECEBERBX`): a baixa do título QUITADO (`R.QUITADA = 'S'`), `INDR <> 'E'`, com o PARCEIRO por INNER JOIN e o
 *    `LEFT JOIN MOV_CONTAS_BANCARIAS` pelo lote (o lote com dois movimentos repete a baixa, como a view); o operador pelo LOGIN; a
 *    loja do título e o operador da baixa filtram; a parte `ARECEBER_BX_SALDO` da view tem 0 linhas na produção (sem tabela);
 *  - PAGAS (`GET_APAGARBX`): a baixa do título quitado, `INDR = 'I'`, DISTINCT; o valor do documento = VALOR + VENDOR − DESCONTO; o
 *    histórico em maiúsculas sem ';' nem quebra de linha; o operador pelo LOGIN;
 *  - PEDIDOS (`GET_PEDIDOSRELAT_RECURSOS`): os PAGAMENTOS do pedido (`CX_PEDIDOS`, sem DESCONTO/ACRESCIMO) juntados aos itens do pedido
 *    (não cancelado, tipo P), "Faturados" (`FATURADO = 'S'`) ou todos, pela data da venda ou do faturamento. ⚠️ O `rgFiltroFaturado`
 *    REESCREVE o filtro (`where := 'AND FATURADO = ...'`) e apaga a loja e o operador: no legado esta seção mostra todas as lojas e todos
 *    os operadores — aqui, todas as lojas que o operador alcança. O `Imprimir` deduplica por operação + vendedor + pedido e monta o
 *    resumo por operação (`cdsPgtos`, o primeiro valor de cada pedido); o total por vendedor (`TOTAL_VEND`) tem o SQL montado no fonte
 *    mas nunca executado — sai vazio;
 *  - HISTÓRICO: `HISTORICO` pelo dia, a loja, o operador e os tipos marcados (as TABELAs), em ordem de tabela.
 */
@Injectable()
export class MovimentacoesDiaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: MovimentacoesDiaDto) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const op = f.codoperador ?? null;
    const pedidas = f.empresas ? f.empresas.split(',').map((x) => Number(x.trim())).filter((x) => x > 0) : [];
    const emps = pedidas.length ? await empresasDoOperador(db, pedidas) : [emp];
    // o filtro do pedido perde a loja (o rgFiltroFaturado reescreve o where): todas as lojas que o operador alcança
    const relOp = currentTenant().operadorId == null ? [] : (await sql<{ e: number }>`SELECT codempresa AS e FROM relacao_operador_empresa WHERE codoperador = ${currentTenant().operadorId}`.execute(db)).rows.map((x) => Number(x.e));
    const todasDoOperador = [...new Set([emp, ...relOp])];

    const recebidos = (await sql<Record<string, unknown>>`
      SELECT p.razao AS cliente, x.dtpgto::date AS data_pagamento, r.dtvenda::date AS data_venda, r.dtvenc::date AS data_venceu,
             x.valorpg AS valor_pago, r.valor AS valor_documento, x.obs AS historico, o.login AS operador_baixa, r.nropedido AS nro_pedido,
             r.codempresa AS idempresa, x.codopbx AS codigo_operadorbx, r.codrcb, x.idlote, fp.modalidade
        FROM areceber_bx x
        JOIN areceber r          ON r.codrcb = x.codrcb
        JOIN parceiros p         ON p.codparceiro = r.codparceiro
        LEFT JOIN operadores o   ON o.codoperador = x.codopbx
        LEFT JOIN mov_contas_bancarias mov ON mov.idlote = x.idlote
        LEFT JOIN formas_pgto fp ON fp.idpgto = mov.idpgto
       WHERE r.quitada = 'S' AND coalesce(x.indr, 'I') <> 'E'
         AND x.dtpgto::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         AND r.codempresa = ANY(${emps})
         AND (${op}::int IS NULL OR x.codopbx = ${op}::int)
       ORDER BY x.dtpgto, p.razao
       LIMIT ${f.limite}`.execute(db)).rows;

    const pagos = (await sql<Record<string, unknown>>`
      SELECT DISTINCT r.razao AS fornecedor, a.dtpgto::date AS data_pagamento, p.dtcompra::date AS data_compra, p.dtvenc::date AS data_venceu,
             a.valorpg AS valor_pago, (p.valor + coalesce(p.vendor, 0))::numeric(13,2) - coalesce(p.desconto, 0) AS valor_documento,
             upper(replace(replace(replace(a.obs, ';', ' '), chr(10), ' '), chr(13), ' ')) AS historico,
             o.login AS operador_baixa, p.codempresa AS idempresa, a.codopbx AS codigo_operadorbx, a.codapg, a.codapgbx
        FROM apagar_bx a
        LEFT JOIN apagar p     ON p.codapg = a.codapg
        LEFT JOIN parceiros r  ON r.codparceiro = p.codparceiro
        LEFT JOIN operadores o ON o.codoperador = a.codopbx
       WHERE p.quitada = 'S' AND coalesce(a.indr, 'I') = 'I'
         AND a.dtpgto::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         AND p.codempresa = ANY(${emps})
         AND (${op}::int IS NULL OR a.codopbx = ${op}::int)
       ORDER BY 2, 1
       LIMIT ${f.limite}`.execute(db)).rows;

    const dataPed = f.dataPedido === 'FATURAMENTO' ? sql`v.dt_fatu::date` : sql`x.data::date`;
    const brutos = (await sql<Record<string, unknown>>`
      SELECT x.nropedido, v.cliente, o.codoperador AS codigo_operador, o.nome AS operador, v.idempresa, x.data::date AS data,
             coalesce(x.valor, 0) AS valor, x.operacao, v.codvendedor AS cod_vendedor, pv.razao AS vendedor, x.faturado,
             x.dt_processamento
        FROM cx_pedidos x
        LEFT JOIN pedidos v     ON v.nropedido = x.nropedido
        LEFT JOIN parceiros pv  ON pv.codparceiro = v.codvendedor
        LEFT JOIN operadores o  ON o.codoperador = v.operador
       WHERE x.operacao NOT IN ('DESCONTO', 'ACRESCIMO')
         AND v.cancelado = 'N' AND v.tipo = 'P'
         AND v.idempresa = ANY(${todasDoOperador})
         ${f.faturados === 'FATURADOS' ? sql`AND x.faturado = 'S'` : sql``}
         AND ${dataPed} BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
       ORDER BY x.nropedido, x.operacao`.execute(db)).rows;
    // o Imprimir: dedup por operação + vendedor + pedido (cdsBuscaTemp) e o resumo por operação (cdsPgtos: o 1º valor de cada pedido)
    const vistos = new Set<string>();
    const pedidos: Record<string, unknown>[] = [];
    const pgtos: Array<{ operacao: unknown; nropedido: unknown; valor: number }> = [];
    for (const b of brutos) {
      if (!pgtos.some((x) => x.operacao === b.operacao && x.nropedido === b.nropedido)) pgtos.push({ operacao: b.operacao, nropedido: b.nropedido, valor: num(b.valor) });
      const k = `${b.operacao}|${b.cod_vendedor}|${b.nropedido}`;
      if (!vistos.has(k)) { vistos.add(k); pedidos.push({ ...b, total_vend: null }); }
    }
    pedidos.sort((a, z) => String(a.nropedido).localeCompare(String(z.nropedido)) || String(a.operacao ?? '').localeCompare(String(z.operacao ?? '')));
    pgtos.sort((a, z) => String(a.operacao ?? '').localeCompare(String(z.operacao ?? '')));

    const tabelas = f.tabelas ? f.tabelas.split(',').map((x) => x.trim()).filter(Boolean) : [];
    const historico = (await sql<Record<string, unknown>>`
      SELECT h.tabela, h.coddoc, h.data, h.historico, h.codoperador, o.nome
        FROM historico h
        LEFT JOIN operadores o ON o.codoperador = h.codoperador
       WHERE h.data::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
         AND h.codempresa = ANY(${emps})
         AND (${op}::int IS NULL OR h.codoperador = ${op}::int)
         ${tabelas.length ? sql`AND h.tabela = ANY(${tabelas})` : sql``}
       ORDER BY h.tabela, h.data, h.codhist
       LIMIT ${f.limite}`.execute(db)).rows;

    const soma = (rows: Array<Record<string, unknown>>, campo: string) => r2(rows.reduce((s, r) => s + num(r[campo]), 0));
    return {
      recebidos, pagos, pedidos, pgtos, historico, empresas: emps,
      totais: {
        recebidos: { itens: recebidos.length, valor: soma(recebidos, 'valor_pago') },
        pagos: { itens: pagos.length, valor: soma(pagos, 'valor_pago') },
        pedidos: { itens: pedidos.length, valor: r2(pgtos.reduce((s, x) => s + x.valor, 0)) },
        historico: { itens: historico.length },
      },
    };
  }

  /** os tipos de histórico (o `PreencheHistoricos`: as TABELAs distintas do HISTORICO, com o rótulo do legado) */
  async tiposHistorico() {
    const db = this.dbp.forTenantRead() as AnyDB;
    const rotulo: Record<string, string> = {
      QUEBRA_CAIXA: 'Quebra de caixa', ARECEBER: 'Contas a receber', CAIXA: 'Caixa', 'PEDIDO DE COMPRA': 'Pedido de compra',
      MOV_CONTAS_BANCARIAS: 'Movimentação de contas bancárias', APAGAR: 'Contas a pagar', HIST_VOUCHER: 'Voucher', CHEQUE: 'Cheque',
      CARTAO: 'Cartão', SALDO_OPERADOR: 'Saldo do operador',
    };
    return (await sql<{ tabela: string }>`SELECT DISTINCT tabela FROM historico WHERE tabela IS NOT NULL ORDER BY tabela`.execute(db)).rows
      .map((r) => ({ tabela: r.tabela, rotulo: rotulo[r.tabela] ?? r.tabela }));
  }

  /**
   * O Imprimir (`btnImprimirClick`): `movd- movimento diario.fr3` com o `cdsBusca` deduplicado no `DBDbusca`, o `cdsPgtos` no `dbdPgtos`,
   * as recebidas no `dbdRecebidos`, as pagas no `dbdPagados`, o histórico no `frxDBDatasetHist`, a empresa no `dbdEmpresa` e o PERIODO
   * ("Período de dd/mm/aaaa até dd/mm/aaaa"). As seções marcadas só ficam visíveis (`SetaVisible`) — no layout do cliente todas já são.
   */
  async impressao(f: MovimentacoesDiaDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = await this.gerar({ ...f, limite: 10000 });
    const br = (x: string) => x.split('-').reverse().join('/');
    return {
      titulo: 'Movimento diário',
      modelo: await modeloFr3(db, 'movd- movimento diario.fr3'),
      datasets: {
        DBDbusca: r.pedidos.map((l) => registroFr3(l, new Set(['valor', 'codigo_operador', 'idempresa', 'cod_vendedor', 'total_vend']))),
        dbdPgtos: r.pgtos.map((l) => registroFr3(l, new Set(['valor']))),
        dbdRecebidos: r.recebidos.map((l) => registroFr3(l, new Set(['valor_pago', 'valor_documento', 'idempresa', 'codigo_operadorbx', 'codrcb', 'idlote']))),
        dbdPagados: r.pagos.map((l) => registroFr3(l, new Set(['valor_pago', 'valor_documento', 'idempresa', 'codigo_operadorbx', 'codapg', 'codapgbx']))),
        frxDBDatasetHist: r.historico.map((l) => registroFr3(l, new Set(['coddoc', 'codoperador']))),
        dbdEmpresa: [await empresaParaRelatorio(db, this.emp())],
      },
      variaveis: { PERIODO: textoVariavel(`Período de ${br(f.dataIni)} até ${br(f.dataFim)}`) },
    };
  }
}
