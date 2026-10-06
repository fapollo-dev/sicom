import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { RegistroEsDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { dataBr, empresaParaRelatorio, registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/**
 * REGISTRO DE ENTRADAS / REGISTRO DE SAÍDAS — o `FRMRELREGISTROS_ES` aberto pelos menus 186 (entradas, 140 acessos, vivo) e 187
 * (saídas), `RegistroEntradaSaida` (uRelRegistros_ES.pas:1401). Não grava nada: lista as notas do período e o resultado de cada uma.
 *
 *  - AS NOTAS (`cdsNF`): NF do tipo, pela data CONTÁBIL, processada, não cancelada, não denegada, com número (≠ '0', ≠ '000000') e série
 *    ≠ 'D', da empresa do login; em ordem de chegada e número. Nas saídas o fonte une a Redução Z (`REDUCAOZ`, 0 linhas na produção).
 *  - O RESULTADO DE CADA NOTA (o `cdsCFOP_ICMS_IMP`, aninhado na nota): o `sqqCFOP_ICMS` do DM (uDMRelRegistros_ES.dfm) com o
 *    `:CODIGO` da nota — por CFOP, CST, alíquota e efetivo. **É o SQL do fonte (2020)**: este modo não grava nada, então não há
 *    golden para provar se o binário novo também o mudou (a apuração mudou — dossiê §8); o vigia do V$SQL está ligado.
 *  - ALÍQUOTAS (`cdsICMS`, só nas entradas): o imposto creditado somado por alíquota, na ordem em que aparecem.
 */
@Injectable()
export class RegistroEsService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private filtroNotas(emp: number, f: RegistroEsDto) {
    return sql`n.nronf <> '0' AND n.nronf IS NOT NULL AND (n.statusnfe <> 'D' OR n.statusnfe IS NULL) AND n.tipo = ${f.tipo}
      AND n.dtcontabil BETWEEN ${f.dataini}::date AND ${f.datafin}::date AND n.idempresa = ${emp}
      AND n.proc = 'S' AND n.cancelada = 'N' AND n.nronf NOT IN ('000000') AND n.serie NOT IN ('D')`;
  }

  async consultar(f: RegistroEsDto) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const notas = (await sql<Record<string, unknown>>`
      SELECT DISTINCT nullif(regexp_replace(n.nronf, '\\D', '', 'g'), '')::numeric AS nronf, n.codnf::text || 'NF' AS codigo,
             n.dtemissao::date AS dtemissao, n.totalnf AS total, n.obs, n.dtcontabil AS dtchegada, n.serie, p.razao, p.codparceiro,
             e.uf, 'NF' AS especie
        FROM nf n
        LEFT JOIN parceiros p ON p.codparceiro = n.codparceiro
        LEFT JOIN parceiros_end e ON e.codend = n.codparceiro_end
       WHERE ${this.filtroNotas(emp, f)}
       ORDER BY 6, 1`.execute(db)).rows;
    const detalhe = notas.length ? await this.detalhe(db, emp, f) : [];
    // o cdsICMS: só nas entradas (o laço do `case TipoRel of rentrada`), o VALOR_ICMS somado por alíquota na ordem das notas
    const icms: Array<{ icms: number; valor: number }> = [];
    if (f.tipo === 'E') {
      const ordem = new Map(notas.map((n, i) => [String(n.codigo), i]));
      const linhas = [...detalhe].sort((a, b) => (ordem.get(String(a.codigo)) ?? 0) - (ordem.get(String(b.codigo)) ?? 0));
      for (const d of linhas) {
        const k = num(d.icms);
        const it = icms.find((x) => x.icms === k);
        if (it) it.valor = Math.round((it.valor + num(d.valor_icms)) * 100) / 100;
        else icms.push({ icms: k, valor: num(d.valor_icms) });
      }
    }
    return { notas, detalhe, icms };
  }

  /**
   * O `sqqCFOP_ICMS` (uDMRelRegistros_ES.dfm) para todas as notas do período de uma vez (no legado, uma consulta por nota pelo
   * `:CODIGO`). Três níveis como no fonte: o grupo dos itens (com as flags que decidem cada coluna), o arredondamento por ARREDONDA
   * (ROUND ou TRUNC em 2 casas — o marcador TRUNK vira TRUNC) e a soma por CFOP/CST/alíquota/efetivo.
   */
  private async detalhe(db: AnyDB, emp: number, f: RegistroEsDto) {
    const val = sql`((i.vrcusto - cast((i.vrcusto * cast(coalesce(i.desconto, 0) as numeric(15,6))) / 100 as numeric(15,6))) * cast(i.quantidade as numeric(13,3)))`;
    const pct = (col: string) => sql`((cast(coalesce(${sql.ref(`i.${col}`)}, 0) as numeric(13,3)) * cast(${val} as numeric(15,2))) / 100)`;
    const ipi = sql`((cast(coalesce(i.ipi, 0) as numeric(13,3)) * ${val}) / 100)`;
    const letra = sql`substr(i.aliquota, 1, 1)`;
    const c3 = sql`substr(i.cfop, 2, 3)`;
    // a zeragem do ICMS: cupom, ST (x401/x403/x933/x556) e x101/x102 com CST 40/90; fora delas, só a alíquota T conta
    const zera = sql`(c.proc_cupom = 'S' or ${c3} in ('401','403','933','556') or (${c3} in ('102','101') and i.cst in (40, 90)))`;
    const efetivo = sql`cast(case when ${zera} then 0 when ${letra} = 'T' then cast((i.icme * i.bcr) / 100 as numeric(13,2)) else 0 end as numeric(13,2))`;
    const deps = sql`sum(coalesce(i.depsacess, 0))`;
    const rows = (await sql<Record<string, unknown>>`
      SELECT icms_efetivo, icms, cst, sum(valor_icms) AS valor_icms, sum(base) AS base, cfop, especie,
             sum(isentas_naotrib) AS isentas_naotrib, sum(outras) AS outras, tipo, sum(totalnf) AS totalnf, codigo, classfiscal
        FROM (
          SELECT icms_efetivo, icms, cst, sum(valor_icms) AS valor_icms, sum(base) AS base, cfop, especie,
                 cast(case arredonda when 'S' then sum(round(isentas_naotrib, 2)) else sum(trunc(isentas_naotrib, 2)) end as numeric(15,2)) AS isentas_naotrib,
                 cast(case arredonda when 'S' then sum(round(outras, 2)) else sum(trunc(outras, 2)) end as numeric(15,2)) AS outras,
                 tipo,
                 cast(case arredonda when 'S' then sum(round(totalnf, 2)) else sum(trunc(totalnf, 2)) end as numeric(15,2)) AS totalnf,
                 codigo, classfiscal
            FROM (
              SELECT ${efetivo} AS icms_efetivo,
                     cast(case when ${zera} then 0 when ${letra} = 'T' then i.icme else 0 end as numeric(13,2)) AS icms,
                     i.cst,
                     cast(case when ${zera} then 0 when ${letra} = 'T' then sum(i.vricm) else 0 end as numeric(13,2)) AS valor_icms,
                     cast(case when ${zera} then 0 when ${letra} = 'T' then sum(i.vrbasecalculo) else 0 end as numeric(13,2)) AS base,
                     nullif(i.cfop, '')::int AS cfop, 'NF' AS especie,
                     case when c.proc_cupom = 'S' then 0 else case ${letra}
                       when 'I' then sum(${val}) + ${deps}
                       when 'N' then sum(${val}) + ${deps}
                       when 'T' then sum(${val}) + ${deps} - sum(i.vrbasecalculo)
                       else 0 end end AS isentas_naotrib,
                     case when c.proc_cupom = 'S' then sum(${val}) + sum(coalesce(i.vricmst, 0)) + sum(coalesce(i.fcp_valor_st, 0)) + sum(${pct('ipi')}) + ${deps}
                     else case ${letra}
                       when 'I' then sum(${pct('ipi')}) + case i.geraicm_acess when 'S' then 0 else ${deps} end + case i.geraicm_frete when 'S' then 0 else sum(${pct('frete')}) end
                       when 'S' then sum(${val}) + sum(coalesce(i.vricmst, 0)) + sum(${pct('ipi')}) + ${deps} + sum(${pct('frete')}) + sum(${pct('seguro')})
                       when 'T' then sum(${pct('ipi')}) + case i.geraicm_acess when 'S' then 0 else ${deps} end + case i.geraicm_frete when 'S' then 0 else sum(${pct('frete')}) end
                       else 0 end end AS outras,
                     n.tipo,
                     sum(${val}) + sum(coalesce(i.vricmst, 0)) + sum(coalesce(i.fcp_valor_st, 0)) + sum(${ipi}) + ${deps}
                       + sum(${pct('frete')}) + sum(${pct('seguro')}) + sum(coalesce(i.fcp_valor_st, 0)) AS totalnf,
                     n.codnf::text || 'NF' AS codigo, p.classfiscal, i.arredonda
                FROM nf_prod i
                LEFT JOIN nf n ON n.codnf = i.codnf
                LEFT JOIN parceiros p ON p.codparceiro = n.codparceiro
                LEFT JOIN cfop c ON c.codcfop = i.cfop
               WHERE ${this.filtroNotas(emp, f)}
               GROUP BY ${efetivo}, i.icme, i.cst, i.cfop, n.tipo, n.totalnf, c.proc_cupom, n.codnf, ${letra}, i.geraicm_acess, i.geraicm_frete,
                        p.classfiscal, i.arredonda
          ) g
          GROUP BY icms_efetivo, icms, cst, cfop, especie, tipo, codigo, classfiscal, arredonda
        ) a
       GROUP BY icms_efetivo, icms, cst, cfop, especie, tipo, codigo, classfiscal
       ORDER BY codigo, cfop, cst, icms, icms_efetivo`.execute(db)).rows;
    return rows;
  }

  /**
   * O livro impresso (`btnImprimirClick`, :426): `Relatorios\Notas_fiscais_Registro_Entrada.fr3` / `..._Saida.fr3` com o
   * frxDBDatasetNF (as notas), o frxDBDatasetCFOP_ICMS (o resultado aninhado em cada nota), o frxDBDatasetICMS (as alíquotas, nas
   * entradas), a empresa e as variáveis LIVRO, FOLHA e MES.
   */
  async impressao(f: RegistroEsDto) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = await this.consultar(f);
    if (!r.notas.length) throw new BusinessRuleError('REGISTRO_SEM_NOTAS', {}, 'Não há notas no período.');
    const pos = new Map(r.notas.map((n, i) => [String(n.codigo), i]));
    const nums = new Set(['nronf', 'total', 'codparceiro', 'icms_efetivo', 'icms', 'cst', 'valor_icms', 'base', 'cfop', 'isentas_naotrib', 'outras', 'totalnf']);
    return {
      titulo: `${f.tipo === 'E' ? 'Registro de entradas' : 'Registro de saídas'} ${dataBr(f.dataini)} a ${dataBr(f.datafin)}`,
      modelo: await modeloFr3(db, f.tipo === 'E' ? 'Notas_fiscais_Registro_Entrada.fr3' : 'Notas_fiscais_Registro_Saida.fr3'),
      datasets: {
        frxDBDatasetNF: r.notas.map((n) => registroFr3(n, nums)),
        frxDBDatasetCFOP_ICMS: r.detalhe.map((d) => ({ ...registroFr3(d, nums), __MESTRE: pos.get(String(d.codigo)) })),
        frxDBDatasetICMS: r.icms.map((x) => ({ ICMS: x.icms, VALOR: x.valor })),
        frxDBDataset2: [await empresaParaRelatorio(db, emp)],
      },
      variaveis: {
        LIVRO: textoVariavel(f.livro?.trim() || '1'), FOLHA: textoVariavel(f.folha?.trim() || '1'),
        MES: textoVariavel(`MES OU PERÍODO: ${dataBr(f.dataini)} até ${dataBr(f.datafin)}`),
      },
    };
  }
}
