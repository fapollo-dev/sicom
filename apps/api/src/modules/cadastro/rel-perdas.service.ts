import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { RelPerdasDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/**
 * RELATÓRIO DE PERDAS (`FRMRELPERDAS`). **17 acessos, 4 operadores.** Dossiê: `uRelPerdas.md`. Migration 255.
 *
 * Sobre `scrap`/`scrap_item`. ANALÍTICO: um item por linha + resumo por centro de custo. SINTÉTICO: por produto
 * (custo médio ponderado = Σ total / Σ qtde, como o legado) + total por empresa. Os filtros do original.
 *
 * ── O número que não pode passar em silêncio ────────────────────────────────────────────────────────────
 * Em 2026 um único scrap (16155) vale **91,1%** das perdas do ano — um item de 139.502 kg de "MUCHIBA KG" onde
 * a média dos outros scraps do produto é 393 kg. O legado imprime o total e pronto; aqui `totais.maiorItem`
 * traz o item e a participação dele.
 */
@Injectable()
export class RelPerdasService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** os filtros do legado — os do cabeçalho em `s`, os do item em `si`, os do produto em `p`. */
  private filtros(f: RelPerdasDto) {
    const o = (v: number | undefined) => v ?? null;
    return sql`
      AND (${o(f.codscrap)}::integer    IS NULL OR s.codscrap     = ${o(f.codscrap)}::integer)
      AND (${o(f.codparceiro)}::integer IS NULL OR s.codparceiro  = ${o(f.codparceiro)}::integer)
      AND (${o(f.codplc)}::integer      IS NULL OR s.codplc       = ${o(f.codplc)}::integer)
      AND (${o(f.idproduto)}::integer   IS NULL OR si.idproduto   = ${o(f.idproduto)}::integer)
      AND (${o(f.codsetor)}::integer    IS NULL OR si.codsetor    = ${o(f.codsetor)}::integer)
      AND (${o(f.codmotivoop)}::integer IS NULL OR si.codmotivoop = ${o(f.codmotivoop)}::integer)
      AND (${o(f.codfor)}::integer      IS NULL OR si.codfor      = ${o(f.codfor)}::integer)
      AND (${o(f.coddpto)}::integer     IS NULL OR p.coddpto      = ${o(f.coddpto)}::integer)
      AND (${o(f.codgrupo)}::integer    IS NULL OR p.codgrupo     = ${o(f.codgrupo)}::integer)
      AND (${o(f.codsubgrupo)}::integer IS NULL OR p.codsubgrupo  = ${o(f.codsubgrupo)}::integer)`;
  }

  async gerar(f: RelPerdasDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const filtros = this.filtros(f);
    const periodo = sql`s.idempresa = ${emp} AND s.dt_cadastro >= ${f.dataIni}::date AND s.dt_cadastro < ${f.dataFim}::date + 1`;

    // o maior item do recorte e o total — o alerta do 91% vale para os dois tipos
    const tot = (await sql<Record<string, unknown>>`
      SELECT count(*) AS itens, count(DISTINCT s.codscrap) AS scraps,
             coalesce(sum(si.qtde), 0) AS qtde, coalesce(sum(si.qtde * coalesce(si.vr_custo, 0)), 0) AS custo
        FROM scrap s JOIN scrap_item si ON si.codscrap = s.codscrap JOIN produtos p ON p.idproduto = si.idproduto
       WHERE ${periodo} ${filtros}
    `.execute(db)).rows[0];
    const maior = (await sql<Record<string, unknown>>`
      SELECT s.codscrap, to_char(s.dt_cadastro, 'YYYY-MM-DD') AS data, si.idproduto, p.descricao, si.qtde, si.vr_custo,
             (si.qtde * coalesce(si.vr_custo, 0)) AS total
        FROM scrap s JOIN scrap_item si ON si.codscrap = s.codscrap JOIN produtos p ON p.idproduto = si.idproduto
       WHERE ${periodo} ${filtros}
       ORDER BY (si.qtde * coalesce(si.vr_custo, 0)) DESC LIMIT 1
    `.execute(db)).rows[0];
    const custoTotal = num(tot?.custo);
    const totais = {
      itens: Number(tot?.itens ?? 0), scraps: Number(tot?.scraps ?? 0), qtde: r3(num(tot?.qtde)), custo: r2(custoTotal),
      maiorItem: maior ? {
        codscrap: Number(maior.codscrap), data: maior.data, idproduto: Number(maior.idproduto), descricao: maior.descricao,
        qtde: r3(num(maior.qtde)), vrCusto: r2(num(maior.vr_custo)), total: r2(num(maior.total)),
        participacao: custoTotal > 0 ? r2((num(maior.total) / custoTotal) * 100) : 0,
      } : null,
    };

    if (f.tipo === 'analitico') {
      const itens = (await sql<Record<string, unknown>>`
        SELECT s.codscrap, to_char(s.dt_cadastro, 'YYYY-MM-DD') AS data, s.codplc, pl.desccodplc, pl.descricao AS centro_custo,
               s.codparceiro, pa.razao AS parceiro, s.obs, s.importado, s.mov_estoque,
               si.codscrapitem, si.idproduto, p.codbarra, p.descricao, si.qtde, coalesce(si.vr_custo, 0) AS vr_custo,
               (si.qtde * coalesce(si.vr_custo, 0)) AS total, si.origem, si.faturado, si.motivo,
               si.codfor, fo.razao AS fornecedor, fs.descricao AS setor, mo.descricao AS motivo_perda, fd.descricao AS departamento
          FROM scrap s
          JOIN scrap_item si ON si.codscrap = s.codscrap
          JOIN produtos p ON p.idproduto = si.idproduto
          LEFT JOIN plc pl ON pl.codplc = s.codplc
          LEFT JOIN parceiros pa ON pa.codparceiro = s.codparceiro
          LEFT JOIN parceiros fo ON fo.codparceiro = si.codfor
          LEFT JOIN familias_prod fs ON fs.codfamilia = si.codsetor
          LEFT JOIN motivos_operacao mo ON mo.codmotivoop = si.codmotivoop
          LEFT JOIN familias_prod fd ON fd.codfamilia = p.coddpto
         WHERE ${periodo} ${filtros}
         ORDER BY s.dt_cadastro, s.codscrap, p.descricao
         LIMIT ${f.limite + 1}
      `.execute(db)).rows;
      const centros = (await sql<Record<string, unknown>>`
        SELECT s.codplc, pl.desccodplc, pl.descricao AS centro_custo, fd.descricao AS departamento,
               sum(si.qtde * coalesce(si.vr_custo, 0)) AS total, count(*) AS itens
          FROM scrap s JOIN scrap_item si ON si.codscrap = s.codscrap JOIN produtos p ON p.idproduto = si.idproduto
          LEFT JOIN plc pl ON pl.codplc = s.codplc
          LEFT JOIN familias_prod fd ON fd.codfamilia = p.coddpto
         WHERE ${periodo} ${filtros}
         GROUP BY s.codplc, pl.desccodplc, pl.descricao, fd.descricao
         ORDER BY pl.desccodplc, fd.descricao
      `.execute(db)).rows;
      const truncado = itens.length > f.limite;
      return {
        tipo: 'analitico', truncado,
        itens: (truncado ? itens.slice(0, f.limite) : itens).map((r) => ({
          ...r, codscrap: Number(r.codscrap), idproduto: Number(r.idproduto), qtde: r3(num(r.qtde)), vrCusto: r2(num(r.vr_custo)), total: r2(num(r.total)),
        })),
        centrosCusto: centros.map((c) => ({ codplc: c.codplc == null ? null : Number(c.codplc), desccodplc: c.desccodplc, centroCusto: c.centro_custo, departamento: c.departamento, itens: Number(c.itens), total: r2(num(c.total)) })),
        totais,
      };
    }

    const produtos = (await sql<Record<string, unknown>>`
      SELECT s.idempresa, e.fantasia, si.idproduto, p.codbarra, p.descricao,
             sum(si.qtde) AS qtde,
             CASE WHEN sum(si.qtde) <> 0 THEN sum(si.qtde * coalesce(si.vr_custo, 0)) / sum(si.qtde) ELSE 0 END AS vr_custo,
             sum(si.qtde * coalesce(si.vr_custo, 0)) AS total,
             si.codfor, fo.razao AS fornecedor, fs.descricao AS setor, mo.descricao AS motivo_perda, fd.descricao AS departamento
        FROM scrap s
        JOIN scrap_item si ON si.codscrap = s.codscrap
        JOIN produtos p ON p.idproduto = si.idproduto
        LEFT JOIN empresas e ON e.idempresa = s.idempresa
        LEFT JOIN parceiros fo ON fo.codparceiro = si.codfor
        LEFT JOIN familias_prod fs ON fs.codfamilia = si.codsetor
        LEFT JOIN motivos_operacao mo ON mo.codmotivoop = si.codmotivoop
        LEFT JOIN familias_prod fd ON fd.codfamilia = p.coddpto
       WHERE ${periodo} ${filtros}
       GROUP BY s.idempresa, e.fantasia, si.idproduto, p.codbarra, p.descricao, si.codfor, fo.razao, fs.descricao, mo.descricao, fd.descricao
       ORDER BY s.idempresa, p.descricao
       LIMIT ${f.limite + 1}
    `.execute(db)).rows;
    const truncado = produtos.length > f.limite;
    return {
      tipo: 'sintetico', truncado,
      produtos: (truncado ? produtos.slice(0, f.limite) : produtos).map((r) => ({
        ...r, idempresa: Number(r.idempresa), idproduto: Number(r.idproduto), qtde: r3(num(r.qtde)), vrCusto: r2(num(r.vr_custo)), total: r2(num(r.total)),
      })),
      totais,
    };
  }
}
