import { Injectable } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { CFOPS_PADRAO_CURVA_ABC_FORNECEDOR, type RelCurvaAbcFornecedorDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const br = (d: string) => d.split('-').reverse().join('/');

/** uma linha da curva: o `cdsConsulta` do legado + a classificação que o script do .fr3 calcula ao imprimir */
export interface LinhaCurvaAbcFornecedor {
  codparceiro: number; razao: string | null; idempresa: number;
  pc_curva_abc_a: number; pc_curva_abc_b: number; pc_curva_abc_c: number;
  qtde: number; totalnf: number; qtde_ven?: number | null; total_venda?: number | null;
  perc: number; perc_acumulado: number; abc: string;
}

/**
 * CURVA ABC POR FORNECEDOR (`FRMRELCURVAABCFORNECEDOR`, uRelCurvaABCFornecedor.pas). **11 acessos, 4 operadores, último 30/09/2026.**
 * A curva das COMPRAS — a FILA a dava como "coberta" pela curva ABC de vendas, e não é.
 *
 * O `GeraConsulta` (:309-396), fiel:
 *  - as notas de ENTRADA processadas e não canceladas (`TIPO = 'E'`, `PROC = 'S'`, `CANCELADA = 'N'`) das lojas (GetMultiEmpresa) no
 *    período pela data contábil ou de emissão, com o CFOP da nota na lista (a padrão 1102/2102/1403/2403 + as escolhidas);
 *  - por NOTA: o TOTALNF e a soma de `QUANTIDADE × FATOREMBAL` dos itens (o JOIN com NF_PROD tira a nota sem item); depois, por
 *    fornecedor × loja, a soma dos dois, com as faixas da loja (`EMPRESAS.PC_CURVA_ABC_A/B/C`), em ordem de TOTALNF decrescente;
 *  - "Mostrar vendas": as VENDAS não canceladas do mesmo período (pela DTVENDA) e lojas dos produtos cujo fornecedor (`CODFOR`) é o da
 *    linha — a quantidade e o total líquido (o item arredondado no IAT 'A' e truncado nos outros, + acréscimos − descontos);
 *  - o fornecedor: a razão com o modo do `TfrmFiltro` (`=`, começa, termina, contém — LIKE, como o Oracle, sensível a maiúsculas).
 *
 * A classificação vem do script do .fr3 (`MasterData1OnBeforePrint`, duas passadas): o % de cada linha sobre o total da lista, o
 * acumulado, e A até o corte A da loja da linha, B até A+B, C até A+B+C — a 1ª linha é sempre A, e acima de A+B+C a linha repete a
 * letra da anterior (o script não tem o `else`). O Apollo mostra a mesma conta na grade.
 */
@Injectable()
export class RelCurvaAbcFornecedorService {
  constructor(private readonly dbp: DatabaseProvider) {}

  async gerar(f: RelCurvaAbcFornecedorDto): Promise<{ linhas: LinhaCurvaAbcFornecedor[]; empresas: number[]; cfops: number[]; totais: Record<string, number> }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const empresas = await empresasDoOperador(db, f.empresas);
    const cfops = f.cfops?.length ? [...new Set(f.cfops)] : [...CFOPS_PADRAO_CURVA_ABC_FORNECEDOR];
    const dataNf = f.tipoData === 'emissao' ? sql.ref('n.dtemissao') : sql.ref('n.dtcontabil');
    const fornecedor = this.filtroFornecedor(f);
    const vendas = f.mostrarSaidas
      ? sql`, (SELECT v.qtde FROM ven v WHERE v.codparceiro = t.codparceiro AND v.idempresa = t.idempresa) AS qtde_ven,
             (SELECT v.total_venda FROM ven v WHERE v.codparceiro = t.codparceiro AND v.idempresa = t.idempresa) AS total_venda`
      : sql``;
    const ven = f.mostrarSaidas
      ? sql`WITH ven AS (
          SELECT fo.codparceiro, v.idempresa,
                 CAST(sum(v.qtde) AS numeric(18,2)) AS qtde,
                 sum(CASE WHEN v.iat = 'A' THEN CAST(coalesce(v.qtde, 0) * coalesce(v.vrvenda, 0) AS numeric(18,2))
                          ELSE CAST(trunc(coalesce(v.qtde, 0) * coalesce(v.vrvenda, 0) * 100) AS numeric(18,2)) / 100 END)
                 + sum((CASE WHEN coalesce(v.desc_acre_medio, 0) > 0 THEN coalesce(v.desc_acre_medio, 0) ELSE 0 END)
                     + (CASE WHEN coalesce(v.desc_acre_item, 0) > 0 THEN coalesce(v.desc_acre_item, 0) ELSE 0 END))
                 - sum(coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0)
                     + (CASE WHEN coalesce(v.desc_acre_medio, 0) < 0 THEN coalesce(v.desc_acre_medio, 0) * -1 ELSE 0 END)
                     + (CASE WHEN coalesce(v.desc_acre_item, 0) < 0 THEN coalesce(v.desc_acre_item, 0) * -1 ELSE 0 END)) AS total_venda
            FROM vendas v
            LEFT JOIN produtos p ON p.idproduto = v.codproduto
            LEFT JOIN parceiros fo ON fo.codparceiro = p.codfor
           WHERE v.dtvenda::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
             AND v.idempresa = ANY(${empresas}::integer[]) AND v.cancelado = 'N'
             ${fornecedor ? sql`AND ${this.razaoLike(sql.ref('fo.razao'), fornecedor)}` : sql``}
           GROUP BY fo.codparceiro, v.idempresa) `
      : sql``;
    const rows = (await sql<Record<string, unknown>>`
      ${ven}
      SELECT t.codparceiro, t.razao, t.idempresa, t.pc_curva_abc_a, t.pc_curva_abc_b, t.pc_curva_abc_c,
             sum(t.qtde) AS qtde, sum(t.totalnf) AS totalnf ${vendas}
        FROM (SELECT n.codnf, n.totalnf, fo.codparceiro, fo.razao, n.idempresa,
                     e.pc_curva_abc_a, e.pc_curva_abc_b, e.pc_curva_abc_c,
                     CAST(sum(coalesce(np.quantidade * coalesce(np.fatorembal, 1), 0)) AS numeric(18,2)) AS qtde
                FROM nf n
                JOIN nf_prod np ON np.codnf = n.codnf
                JOIN parceiros fo ON fo.codparceiro = n.codparceiro
                JOIN empresas e ON e.idempresa = n.idempresa
               WHERE ${dataNf}::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
                 AND n.tipo = 'E' AND n.proc = 'S' AND n.cancelada = 'N'
                 AND n.cfop::text = ANY(${cfops.map(String)}::text[])
                 AND n.idempresa = ANY(${empresas}::integer[])
                 ${fornecedor ? sql`AND ${this.razaoLike(sql.ref('fo.razao'), fornecedor)}` : sql``}
               GROUP BY n.codnf, n.totalnf, fo.codparceiro, fo.razao, n.idempresa, e.pc_curva_abc_a, e.pc_curva_abc_b, e.pc_curva_abc_c) t
       GROUP BY t.codparceiro, t.razao, t.idempresa, t.pc_curva_abc_a, t.pc_curva_abc_b, t.pc_curva_abc_c
       ORDER BY sum(t.totalnf) DESC, t.razao, t.codparceiro, t.idempresa
    `.execute(db)).rows;
    const linhas = classificar(rows.map((r) => ({
      codparceiro: Number(r.codparceiro), razao: (r.razao as string) ?? null, idempresa: Number(r.idempresa),
      pc_curva_abc_a: num(r.pc_curva_abc_a), pc_curva_abc_b: num(r.pc_curva_abc_b), pc_curva_abc_c: num(r.pc_curva_abc_c),
      qtde: num(r.qtde), totalnf: num(r.totalnf),
      ...(f.mostrarSaidas ? { qtde_ven: r.qtde_ven == null ? null : num(r.qtde_ven), total_venda: r.total_venda == null ? null : num(r.total_venda) } : {}),
    })));
    return {
      linhas, empresas, cfops,
      totais: {
        fornecedores: linhas.length, qtde: linhas.reduce((s, l) => s + l.qtde, 0), totalnf: linhas.reduce((s, l) => s + l.totalnf, 0),
        ...(f.mostrarSaidas ? { qtde_ven: linhas.reduce((s, l) => s + num(l.qtde_ven), 0), total_venda: linhas.reduce((s, l) => s + num(l.total_venda), 0) } : {}),
      },
    };
  }

  /**
   * O Imprimir (btnImprimirClick :133-186): "Curva ABC por Fornecedor.fr3" ou, com "Mostrar vendas", "Curva ABC por Fornecedor com
   * saidas.fr3" (o PERSONALIZADO do cliente vence o DEFAULT), o `cdsConsulta` no `dbdConsulta` e as variáveis DtInicial, DtFinal e
   * Empresa (a lista do GetMultiEmpresa). Sem linha: "Não há movimento no filtro informado. Verifique!".
   */
  async impressao(f: RelCurvaAbcFornecedorDto) {
    const r = await this.gerar(f);
    if (!r.linhas.length) throw new BusinessRuleError('SEM_MOVIMENTO', {}, 'Não há movimento no filtro informado. Verifique!');
    const db = this.dbp.forTenantRead() as AnyDB;
    const nums = new Set(['codparceiro', 'idempresa', 'pc_curva_abc_a', 'pc_curva_abc_b', 'pc_curva_abc_c', 'qtde', 'totalnf', 'qtde_ven', 'total_venda']);
    return {
      titulo: 'Curva ABC por fornecedor',
      modelo: await modeloFr3(db, f.mostrarSaidas ? 'Curva ABC por Fornecedor com saidas.fr3' : 'Curva ABC por Fornecedor.fr3'),
      datasets: {
        dbdConsulta: r.linhas.map((l) => registroFr3({
          codparceiro: l.codparceiro, razao: l.razao, idempresa: l.idempresa,
          pc_curva_abc_a: l.pc_curva_abc_a, pc_curva_abc_b: l.pc_curva_abc_b, pc_curva_abc_c: l.pc_curva_abc_c,
          qtde: l.qtde, totalnf: l.totalnf, ...(f.mostrarSaidas ? { qtde_ven: l.qtde_ven, total_venda: l.total_venda } : {}),
        }, nums)),
      },
      // `frxReport1.Variables[...] := QuotedStr(...)`: a variável é uma expressão — o texto vai entre aspas
      variaveis: { DtInicial: textoVariavel(br(f.dataIni)), DtFinal: textoVariavel(br(f.dataFim)), Empresa: textoVariavel(r.empresas.join(',')) },
    };
  }

  /** o texto do fornecedor no modo escolhido — `F.RAZAO LIKE …` / `F.RAZAO = …` do SetaFiltro (:420-444) */
  private filtroFornecedor(f: RelCurvaAbcFornecedorDto): { modo: RelCurvaAbcFornecedorDto['modoFornecedor']; texto: string } | null {
    const texto = String(f.fornecedor ?? '').replace(/[%=<>]/g, '').trim();
    return texto ? { modo: f.modoFornecedor, texto } : null;
  }

  private razaoLike(col: RawBuilder<unknown>, filtro: { modo: string; texto: string }) {
    // o `_` segue curinga, como no LIKE do Oracle; a barra é literal lá e escape no PG
    const t = filtro.texto.replace(/\\/g, '\\\\');
    if (filtro.modo === 'igual') return sql`${col} = ${filtro.texto}`;
    const padrao = filtro.modo === 'comeca' ? `${t}%` : filtro.modo === 'termina' ? `%${t}` : `%${t}%`;
    return sql`${col} LIKE ${padrao}`;
  }
}

/** a conta do script do .fr3 (MasterData1OnBeforePrint), sobre a lista já em ordem de TOTALNF decrescente */
export function classificar(rows: Array<Omit<LinhaCurvaAbcFornecedor, 'perc' | 'perc_acumulado' | 'abc'>>): LinhaCurvaAbcFornecedor[] {
  const total = rows.reduce((s, r) => s + r.totalnf, 0);
  let acumulado = 0;
  let letra = '';
  return rows.map((r, i) => {
    const perc = total ? (r.totalnf * 100) / total : 0;
    acumulado += perc;
    const a = r.pc_curva_abc_a;
    const b = a + r.pc_curva_abc_b;
    const c = b + r.pc_curva_abc_c;
    if (i === 0 || acumulado <= a) letra = 'A';
    else if (acumulado <= b) letra = 'B';
    else if (acumulado <= c) letra = 'C';
    return { ...r, perc, perc_acumulado: acumulado, abc: letra };
  });
}
