import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { RelAnalisePedidoNfDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { AnaliseMotorService } from './analise-motor.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * RELATÓRIO DE ANÁLISE PEDIDO × NF (`FRMRELANALISEPEDIDONF`). **22 acessos, 4 operadores.**
 * Dossiê: `uRelAnalisePedidoNF.md`. Migration 252.
 *
 * Lista as análises do período com notas e pedidos agregados, fornecedor(es) e comprador(es), status e
 * total/parcial. "Expandido" embute em cada análise o dossiê que o motor já devolve (divergentes, só na NF,
 * só no pedido) — é a mesma leitura de `AnaliseMotorService.dossie`, não uma segunda.
 *
 * ── O SQL do legado multiplica e depois agrega ─────────────────────────────────────────────────────────
 * `A JOIN APNN JOIN APNP` faz o produto cartesiano nota × pedido: 3 notas e 3 pedidos viram 9 linhas e o
 * `LISTAGG` lista cada nota 3 vezes. Medido: **31 análises** no cliente. Aqui cada lista é uma subconsulta
 * com DISTINCT.
 *
 * ── O INNER JOIN em OPERADORES derruba análises ────────────────────────────────────────────────────────
 * Comprador nulo ou órfão → a análise inteira sai do relatório. Medido: **24 análises ativas**. Aqui é LEFT.
 *
 * ── `MAX(comprador)` escolhe um ────────────────────────────────────────────────────────────────────────
 * **5 análises** têm pedidos de mais de um comprador; o legado mostra só o de código maior. Aqui é lista.
 */
@Injectable()
export class RelAnalisePedidoNfService {
  constructor(private readonly dbp: DatabaseProvider, private readonly motor: AnaliseMotorService) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: RelAnalisePedidoNfDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const codparceiro = f.codparceiro ?? null;
    const codcomprador = f.codcomprador ?? null;

    const rows = (await sql<Record<string, unknown>>`
      SELECT a.apn_id, to_char(a.apn_data_analise, 'YYYY-MM-DD HH24:MI') AS data_analise,
             a.apn_status, a.apn_total_parcial, a.apn_diferenca_valor, a.apn_status_finalizacao,
             a.codoperador, op.nome AS operador,
             -- a nota da análise é a referência à fila do manifesto; o número sai de lá (honrando apnn_tabela)
             (SELECT string_agg(DISTINCT coalesce(nnc.nronf, apnn.apnn_ref_nf::text), ', ' ORDER BY coalesce(nnc.nronf, apnn.apnn_ref_nf::text))
                FROM analise_pedido_nf_nf apnn
                LEFT JOIN nfe_nao_cadastradas nnc
                       ON apnn.apnn_tabela = 'NFE_NAO_CADASTRADAS' AND nnc.codnfe_naocad = apnn.apnn_ref_nf
               WHERE apnn.apn_id = a.apn_id) AS notas_fiscais,
             (SELECT string_agg(DISTINCT apnp.codpedcomp::text, ', ' ORDER BY apnp.codpedcomp::text)
                FROM analise_pedido_nf_pedido apnp WHERE apnp.apn_id = a.apn_id) AS pedidos,
             (SELECT string_agg(DISTINCT coalesce(fo.fantasia, fo.razao), ', ' ORDER BY coalesce(fo.fantasia, fo.razao))
                FROM analise_pedido_nf_pedido apnp
                JOIN pedidocompra pc ON pc.codpedcomp = apnp.codpedcomp
                LEFT JOIN parceiros fo ON fo.codparceiro = pc.codparceiro
               WHERE apnp.apn_id = a.apn_id) AS fornecedores,
             (SELECT string_agg(DISTINCT cp.nome, ', ' ORDER BY cp.nome)
                FROM analise_pedido_nf_pedido apnp
                JOIN pedidocompra pc ON pc.codpedcomp = apnp.codpedcomp
                JOIN operadores cp ON cp.codoperador = pc.codoperador
               WHERE apnp.apn_id = a.apn_id) AS compradores
        FROM analise_pedido_nf a
        LEFT JOIN operadores op ON op.codoperador = a.codoperador
       WHERE a.codempresa = ${emp}
         AND coalesce(a.apn_status, 'A') <> 'E'
         AND a.apn_data_analise >= ${f.dataIni}::date AND a.apn_data_analise < ${f.dataFim}::date + 1
         -- o filtro do legado é sobre o pedido: a análise entra se ALGUM pedido dela bate
         AND (${codparceiro}::integer IS NULL OR EXISTS (
               SELECT 1 FROM analise_pedido_nf_pedido x JOIN pedidocompra pc ON pc.codpedcomp = x.codpedcomp
                WHERE x.apn_id = a.apn_id AND pc.codparceiro = ${codparceiro}::integer))
         AND (${codcomprador}::integer IS NULL OR EXISTS (
               SELECT 1 FROM analise_pedido_nf_pedido x JOIN pedidocompra pc ON pc.codpedcomp = x.codpedcomp
                WHERE x.apn_id = a.apn_id AND pc.codoperador = ${codcomprador}::integer))
       ORDER BY compradores NULLS LAST, fornecedores NULLS LAST, pedidos, a.apn_data_analise, a.apn_id
       LIMIT ${f.limite + 1}
    `.execute(db)).rows;

    const truncado = rows.length > f.limite;
    const lista = truncado ? rows.slice(0, f.limite) : rows;

    const analises = [];
    for (const r of lista) {
      const status = String(r.apn_status ?? 'A');
      const tp = String(r.apn_total_parcial ?? '');
      const item: Record<string, unknown> = {
        apnId: Number(r.apn_id), dataAnalise: r.data_analise,
        status, statusStr: status === 'A' ? 'Em andamento' : status === 'F' ? 'Finalizado' : 'Outro',
        totalParcial: tp, totalParcialStr: tp === 'T' ? 'Total' : 'Parcial',
        diferencaValor: r2(num(r.apn_diferenca_valor)), statusFinalizacao: r.apn_status_finalizacao ?? null,
        operador: r.operador ?? null,
        notasFiscais: r.notas_fiscais ?? '', pedidos: r.pedidos ?? '',
        fornecedores: r.fornecedores ?? '', compradores: r.compradores ?? '',
      };
      if (f.expandido) {
        const d = await this.motor.dossie(Number(r.apn_id));
        item.divergentes = d.divergentes;
        item.soNaNf = d.so_na_nf;
        item.soNoPedido = d.so_no_pedido;
      }
      analises.push(item);
    }
    return { analises, total: analises.length, truncado, criterio: { comprador: 'pedidocompra.codoperador', notas: 'distintas', pedidos: 'distintos' } };
  }
}
