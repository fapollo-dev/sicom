import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { RelAnalisePedidoNfDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { AnaliseMotorService } from './analise-motor.service';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { relatorioMestre } from '../../shared/relatorios/relatorio-mestre';

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

  /** o WHERE comum à consulta e à impressão: lojas, período (sem ele quando há pedido, como o binário novo), fornecedor, comprador, pedido */
  private filtro(f: RelAnalisePedidoNfDto, empresas: number[]) {
    const codparceiro = f.codparceiro ?? null;
    const codcomprador = f.codcomprador ?? null;
    const codpedcomp = f.codpedcomp ?? null;
    return sql`
         a.codempresa = ANY(${empresas})
         AND coalesce(a.apn_status, 'A') <> 'E'
         ${codpedcomp ? sql`` : sql`AND a.apn_data_analise >= ${f.dataIni}::date AND a.apn_data_analise < ${f.dataFim}::date + 1`}
         -- o filtro do legado é sobre o pedido: a análise entra se ALGUM pedido dela bate
         AND (${codparceiro}::integer IS NULL OR EXISTS (
               SELECT 1 FROM analise_pedido_nf_pedido x JOIN pedidocompra pc ON pc.codpedcomp = x.codpedcomp
                WHERE x.apn_id = a.apn_id AND pc.codparceiro = ${codparceiro}::integer))
         AND (${codcomprador}::integer IS NULL OR EXISTS (
               SELECT 1 FROM analise_pedido_nf_pedido x JOIN pedidocompra pc ON pc.codpedcomp = x.codpedcomp
                WHERE x.apn_id = a.apn_id AND pc.usucadastro = ${codcomprador}::integer))
         AND (${codpedcomp}::integer IS NULL OR EXISTS (
               SELECT 1 FROM analise_pedido_nf_pedido x WHERE x.apn_id = a.apn_id AND x.codpedcomp = ${codpedcomp}::integer))`;
  }

  async gerar(f: RelAnalisePedidoNfDto): Promise<Record<string, unknown>> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const empresas = await empresasDoOperador(db, f.empresas ?? null);
    const rows = (await sql<Record<string, unknown>>`
      SELECT a.apn_id, to_char(a.apn_data_analise, 'YYYY-MM-DD HH24:MI') AS data_analise, a.codempresa,
             a.apn_status, a.apn_total_parcial, a.apn_diferenca_valor, a.apn_status_finalizacao,
             a.codoperador, op.nome AS operador, opf.nome AS usuario_liberacao,
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
             -- o comprador é quem CADASTROU o pedido (PC.USUCADASTRO), não o codoperador: 214 dos 8.236 pedidos analisados divergem
             (SELECT string_agg(DISTINCT cp.nome, ', ' ORDER BY cp.nome)
                FROM analise_pedido_nf_pedido apnp
                JOIN pedidocompra pc ON pc.codpedcomp = apnp.codpedcomp
                JOIN operadores cp ON cp.codoperador = pc.usucadastro
               WHERE apnp.apn_id = a.apn_id) AS compradores
        FROM analise_pedido_nf a
        LEFT JOIN operadores op  ON op.codoperador = a.codoperador
        LEFT JOIN operadores opf ON opf.codoperador = a.codoperador_finalizado
       WHERE ${this.filtro(f, empresas)}
       ORDER BY a.codempresa, compradores NULLS LAST, fornecedores NULLS LAST, pedidos, a.apn_data_analise, a.apn_id
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
        operador: r.operador ?? null, usuarioLiberacao: r.usuario_liberacao ?? null, codempresa: Number(r.codempresa),
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
    return { analises, total: analises.length, truncado, empresas, criterio: { comprador: 'pedidocompra.usucadastro', notas: 'distintas', pedidos: 'distintos' } };
  }

  /**
   * A impressão (`TFrmRelMaster.GeraRelatorio` com `AnalisesPedidoNF.fr3`): o `DBDRelatorio` do binário novo (o V$SQL da produção traz
   * APN_DIFERENCA_VALOR, APN_STATUS_FINALIZACAO e o USUARIO_LIBERACAO — o operador que finalizou), agrupado por loja, comprador,
   * fornecedor, pedidos e análise (`CODPARCEIRO = MAX(PC.CODPARCEIRO)`, `CODCOMPRADOR = MAX(PC.USUCADASTRO)`, como o legado), com as
   * listas de notas e pedidos distintas e sem derrubar a análise de comprador órfão (as correções da consulta); e os três detalhes do
   * `AntesImprimir` (`QryProdutosDiv`, `QryProdutosIneNF`, `QryProdutosInePedido`, MasterFields = APN_DATA_ANALISE;APN_ID) — o
   * "Expandido" abre a análise (`GphAnalise.ExpandDrillDown`).
   */
  async impressao(f: RelAnalisePedidoNfDto) {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const empresas = await empresasDoOperador(db, f.empresas ?? null);
    const rel = (await sql<Record<string, unknown>>`
      SELECT x.* FROM (
        SELECT a.apn_id, a.apn_data_analise, a.apn_status, a.codoperador, a.codempresa, a.apn_total_parcial,
               (SELECT string_agg(DISTINCT coalesce(nnc.nronf, apnn.apnn_ref_nf::text), ', ' ORDER BY coalesce(nnc.nronf, apnn.apnn_ref_nf::text))
                  FROM analise_pedido_nf_nf apnn
                  LEFT JOIN nfe_nao_cadastradas nnc ON apnn.apnn_tabela = 'NFE_NAO_CADASTRADAS' AND nnc.codnfe_naocad = apnn.apnn_ref_nf
                 WHERE apnn.apn_id = a.apn_id) AS notas_fiscais,
               (SELECT string_agg(DISTINCT apnp.codpedcomp::text, ', ' ORDER BY apnp.codpedcomp::text)
                  FROM analise_pedido_nf_pedido apnp WHERE apnp.apn_id = a.apn_id) AS pedidos,
               CASE a.apn_status WHEN 'A' THEN 'Em andamento' WHEN 'F' THEN 'Finalizado' ELSE 'Outro' END AS apn_status_str,
               CASE a.apn_total_parcial WHEN 'T' THEN 'Total' ELSE 'Parcial' END AS apn_total_parcial_str,
               a.apn_diferenca_valor::float8 AS apn_diferenca_valor, a.apn_status_finalizacao, a.codoperador_finalizado, opf.nome AS usuario_liberacao,
               m.codparceiro, m.codcomprador, p.fantasia AS fornecedor, cp.nome AS comprador
          FROM analise_pedido_nf a
          LEFT JOIN operadores opf ON opf.codoperador = a.codoperador_finalizado
          LEFT JOIN LATERAL (SELECT max(pc.codparceiro) AS codparceiro, max(pc.usucadastro) AS codcomprador
                               FROM analise_pedido_nf_pedido x JOIN pedidocompra pc ON pc.codpedcomp = x.codpedcomp
                              WHERE x.apn_id = a.apn_id) m ON true
          LEFT JOIN parceiros p   ON p.codparceiro = m.codparceiro
          LEFT JOIN operadores cp ON cp.codoperador = m.codcomprador
         WHERE ${this.filtro(f, empresas)}) x
       ORDER BY x.codempresa, x.comprador NULLS LAST, x.fornecedor NULLS LAST, x.pedidos, x.apn_data_analise, x.apn_id`.execute(db)).rows;
    const ids = rel.map((r) => Number(r.apn_id));
    const pos = new Map(ids.map((id, i) => [id, i]));
    const detalhe = async (tabela: 'diverg' | 'ine_nf' | 'ine_pc') => {
      if (!ids.length) return [] as Array<Record<string, unknown>>;
      const campos = tabela === 'diverg'
        ? sql`d.idproduto, p.codbarra, p.descricao, p.unidade, d.apnd_quantidade_nf::float8 AS apnd_quantidade_nf, d.apnd_quantidade_pc::float8 AS apnd_quantidade_pc,
              d.apnd_valor_nf::float8 AS apnd_valor_nf, d.apnd_valor_pc::float8 AS apnd_valor_pc`
        : tabela === 'ine_nf'
          ? sql`d.idproduto, d.apnin_quantidade::float8 AS apnin_quantidade, d.apnin_valor::float8 AS apnin_valor, p.codbarra, p.descricao`
          : sql`d.idproduto, d.apnip_quantidade::float8 AS apnip_quantidade, d.apnip_valor::float8 AS apnip_valor, p.codbarra, p.descricao`;
      const rows = (await sql<Record<string, unknown>>`
        SELECT d.apn_id, a.apn_data_analise, ${campos}
          FROM ${sql.table(`analise_pedido_nf_${tabela}`)} d
          JOIN analise_pedido_nf a ON a.apn_id = d.apn_id
          JOIN produtos p ON p.idproduto = d.idproduto
         WHERE d.apn_id = ANY(${ids})
         ORDER BY a.apn_data_analise, d.apn_id, p.descricao`.execute(db)).rows;
      // o detalhe do mestre (MasterFields = APN_DATA_ANALISE;APN_ID): a linha da análise no DBDRelatorio
      return rows.map((r) => ({ ...r, __MESTRE: pos.get(Number(r.apn_id)) }));
    };
    return relatorioMestre(db, {
      arquivo: 'AnalisesPedidoNF.fr3', titulo: 'Análises de pedidos × notas fiscais', relatorio: rel,
      // o GetMultiEmpresa(True, '', True) do binário novo monta "1, 2" (o V$SQL da produção: IN (1, 2))
      variaveis: { empresas, dataIni: f.dataIni, dataFim: f.dataFim, extras: { Expandido: f.expandido ? 'S' : 'N', IDEmpresas: empresas.join(', ') } },
      extras: { DbdProdutosDiv: await detalhe('diverg'), DbdProdutosIneNF: await detalhe('ine_nf'), DbdProdutosInePedido: await detalhe('ine_pc') },
    });
  }
}
