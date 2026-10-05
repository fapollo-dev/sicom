import { Injectable } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { relatorioMestre } from '../../shared/relatorios/relatorio-mestre';

type AnyDB = Kysely<any>;
type Linha = Record<string, unknown>;

export type TipoRelTroca = 'AGRUPADO' | 'ANALITICO' | 'SINTETICO';
export type StatusRelTroca = 'ABERTO' | 'FECHADO' | 'TODOS';

export interface FiltroRelTroca {
  /** o `RgpTipoRelatorio`: Analítico Agrupado (padrão), Analítico, Sintético */
  tipo?: TipoRelTroca | null;
  dataIni?: string | null;
  dataFim?: string | null;
  codtroca?: number | null;
  codfor?: number | null;
  /** o `RgpStatus` (padrão "Todos") */
  status?: StatusRelTroca | null;
  idproduto?: number | null;
  coddpto?: number | null;
  codgrupo?: number | null;
  codsubgrupo?: number | null;
  empresas?: number[] | null;
  /**
   * aberto pela tela da troca (`TfrmTrocaMercadoriaFor.btnImprimirClick` → `Create(Self, CODTROCA, DATA)`): só a troca, sem o filtro de
   * data, de lojas e de fornecedor, e o `IDEmpresas` = a loja do login
   */
  daTroca?: boolean;
}

const NUM = ['qtde', 'vrcusto', 'qtde_edicao', 'total', 'vrvenda'];
const numeros = (ls: Linha[]): Linha[] => ls.map((l) => {
  const o = { ...l };
  for (const k of NUM) if (k in o && o[k] != null) o[k] = Number(o[k]);
  return o;
});

/**
 * RELATÓRIO DE TROCA DE MERCADORIAS COM O FORNECEDOR (`FRMRELTROCAMERCADORIAFOR`, `uRelTrocaMercadoriaFor.pas`, herda o TFrmRelMaster).
 * Dossiê: `uRelTrocaMercadoriaFor.md`. **29 acessos.**
 *
 * O SQL do `TRelatorio.create` (TROCA ⟕ ITENS_TROCA ⟕ ITENS_TROCA_QTDE ⟕ NF_PROD ⟕ NF ⟕ PRODUTOS ⟕ PARCEIROS ⟕ EMPRESAS, o VRVENDA da
 * MULTI_PRECO da loja da troca), com os filtros do `MontaFiltroSQL`, e três layouts: `TrocaMercadoria_Analitico_Agrup.fr3`
 * (`ORDER BY T.DATA, P.RAZAO, T.CODTROCA`), `TrocaMercadoria_Analitico.fr3` e `TrocaMercadoria_Sintetico.fr3` (o legado não ordena;
 * aqui troca e item). A grade (`AntesImprimir` → `TfrmRelGrid`, "Exibe grade" marcado de fábrica) agrega por tipo.
 *
 * ⚠️ **ITENS_TROCA_QTDE é ITENS_TROCA** (produção, 05/10/2026: CODITENSQTDE = CODITENSTROCA, CODEMPRESA = a da troca e QTDE iguais
 * em 309/309; STATUS 'F' ⟺ FECHADO 'S'; `conferir-tabelas-fora.py`): o destino tem só o item. A ligação da nota de devolução
 * (`NF_PROD.CODITENSQTDE_TROCA = ITQ.CODITENSQTDE`) é, portanto, com o CODITENSTROCA. O STATUS aberto do legado vem nulo em 129 e
 * 'A' em 1 — tudo "Aberta" no `COALESCE(STATUS, 'A')` da grade e do filtro; aqui 'A'.
 */
@Injectable()
export class RelTrocaMercadoriaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private async contexto(db: AnyDB, f: FiltroRelTroca): Promise<{ empresas: number[]; dataIni: string; dataFim: string }> {
    if (f.daTroca) {
      const emp = currentTenant().empresaId ?? null;
      if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
      if (!f.codtroca) throw new BusinessRuleError('TROCA_OBRIGATORIA', {}, 'Informe a troca.');
      // o EdtDatInicial/EdtDatFinal = a data da troca (FData)
      const t = (await sql<{ data: string | null }>`SELECT to_char(data, 'YYYY-MM-DD') AS data FROM troca WHERE codtroca = ${f.codtroca} AND idempresa = ${emp}`.execute(db)).rows[0];
      if (!t) throw new BusinessRuleError('TROCA_NAO_ENCONTRADA', { codtroca: f.codtroca });
      const d = t.data ?? '1899-12-30';
      return { empresas: [emp], dataIni: d, dataFim: d };
    }
    // o OnExitData do TFrmRelMaster: "Favor informar a data."
    if (!f.dataIni || !f.dataFim) throw new BusinessRuleError('DATA_OBRIGATORIA', {}, 'Favor informar a data.');
    return { empresas: await empresasDoOperador(db, f.empresas ?? null), dataIni: f.dataIni, dataFim: f.dataFim };
  }

  /** o `GetSQLPadrao` + o `FiltroPrincipal` do `MontaFiltroSQL` */
  private base(f: FiltroRelTroca, empresas: number[], dataIni: string, dataFim: string): RawBuilder<unknown> {
    const filtros: RawBuilder<unknown>[] = [];
    if (f.codtroca) filtros.push(sql`AND t.codtroca = ${f.codtroca}`);
    if (f.daTroca) {
      // FCodigo > 0: nem data, nem lojas, nem fornecedor
    } else {
      filtros.push(sql`AND t.data BETWEEN ${dataIni}::date AND ${dataFim}::date`);
      filtros.push(sql`AND t.idempresa = ANY(${empresas})`);
      if (f.codfor) filtros.push(sql`AND t.codparceiro = ${f.codfor}`);
    }
    // o status da troca é o do PRIMEIRO item (`ROWNUM = 1`); troca sem item não entra em "Aberto" nem em "Fechado"
    const statusTroca = sql`(SELECT CASE WHEN q.fechado = 'S' THEN 'F' ELSE 'A' END FROM itens_troca q
                              WHERE q.codtroca = t.codtroca AND coalesce(q.idempresa, t.idempresa) = t.idempresa ORDER BY q.coditenstroca LIMIT 1)`;
    if (f.status === 'ABERTO') filtros.push(sql`AND ${statusTroca} <> 'F'`);
    else if (f.status === 'FECHADO') filtros.push(sql`AND ${statusTroca} = 'F'`);
    if (f.idproduto) filtros.push(sql`AND i.idproduto = ${f.idproduto}`);
    if (f.coddpto) filtros.push(sql`AND prod.coddpto = ${f.coddpto}`);
    if (f.codgrupo) filtros.push(sql`AND prod.codgrupo = ${f.codgrupo}`);
    if (f.codsubgrupo) filtros.push(sql`AND prod.codsubgrupo = ${f.codsubgrupo}`);
    // ITQ (o ITENS_TROCA_QTDE do legado) existe quando há item e a loja dele é a da troca
    const itq = sql`(i.coditenstroca IS NOT NULL AND coalesce(i.idempresa, t.idempresa) = t.idempresa)`;
    return sql`
      SELECT t.codtroca, t.codparceiro, t.data, p.razao, t.idempresa AS codempresa, t.descricao AS descricao_troca,
             coalesce(e.fantasia, e.razao_social) AS empresa,
             i.coditenstroca, i.idproduto, i.qtde, i.vrcusto, prod.codbarra, prod.descricao,
             CASE WHEN ${itq} THEN coalesce(i.qtde, 0) ELSE 0 END AS qtde_edicao,
             CASE WHEN ${itq} THEN CASE WHEN i.fechado = 'S' THEN 'F' ELSE 'A' END END AS status,
             np.codnf, n.nronf,
             (CASE WHEN ${itq} THEN coalesce(i.qtde, 0) ELSE 0 END * coalesce(i.vrcusto, 0)) AS total,
             (SELECT m.vrvenda FROM multi_preco m WHERE m.idproduto = i.idproduto AND m.idempresa = t.idempresa) AS vrvenda
        FROM troca t
        LEFT JOIN itens_troca i  ON i.codtroca = t.codtroca
        LEFT JOIN nf_prod np     ON ${itq} AND np.coditensqtde_troca = i.coditenstroca
        LEFT JOIN nf n           ON n.codnf = np.codnf
        LEFT JOIN produtos prod  ON prod.idproduto = i.idproduto
        LEFT JOIN parceiros p    ON p.codparceiro = t.codparceiro
        LEFT JOIN empresas e     ON e.idempresa = t.idempresa
       WHERE 1 = 1 ${sql.join(filtros, sql` `)}`;
  }

  /** o DBDRelatorio na ordem de cada classe */
  private async registros(db: AnyDB, f: FiltroRelTroca, ctx: { empresas: number[]; dataIni: string; dataFim: string }): Promise<Linha[]> {
    const b = this.base(f, ctx.empresas, ctx.dataIni, ctx.dataFim);
    const ordem = (f.tipo ?? 'AGRUPADO') === 'AGRUPADO' ? sql`x.data, x.razao, x.codtroca, x.coditenstroca` : sql`x.codtroca, x.coditenstroca`;
    return numeros((await sql<Linha>`SELECT * FROM (${b}) x ORDER BY ${ordem}`.execute(db)).rows);
  }

  /** a grade do `AntesImprimir` (o `MontaSQLGrid` / `MontaSQLGridAux` de cada tipo) */
  async gerar(f: FiltroRelTroca): Promise<{ tipo: TipoRelTroca; linhas: Linha[]; itens: Linha[]; empresas: number[] }> {
    const tipo: TipoRelTroca = f.tipo ?? 'AGRUPADO';
    const db = this.dbp.forTenantRead() as AnyDB;
    const ctx = await this.contexto(db, f);
    const rs = await this.registros(db, { ...f, tipo }, ctx);
    const st = (s: unknown) => (String(s ?? 'A') === 'F' ? 'Fechada' : 'Aberta');
    const item = (r: Linha) => ({ codtroca: r.codtroca, coditenstroca: r.coditenstroca, codbarra: r.codbarra, descricao: r.descricao, status: st(r.status),
      qtde: r.qtde_edicao, vrcusto: r.vrcusto, vrvenda: r.vrvenda, total: r.total });
    if (tipo === 'AGRUPADO') {
      // SELECT CODTROCA, CODEMPRESA, DATA, CODPARCEIRO CODIGO, RAZAO FORNECEDOR, DESCRICAO_TROCA, SUM(TOTAL) … ORDER BY CODTROCA
      const m = new Map<number, Linha>();
      for (const r of rs) {
        const k = Number(r.codtroca);
        const a = m.get(k) ?? { codtroca: r.codtroca, codempresa: r.codempresa, data: r.data, codigo: r.codparceiro, fornecedor: r.razao, descricao_troca: r.descricao_troca, total: 0 };
        a.total = Math.round((Number(a.total) + Number(r.total ?? 0)) * 10000) / 10000;
        m.set(k, a);
      }
      return { tipo, linhas: [...m.values()].sort((a, b) => Number(a.codtroca) - Number(b.codtroca)), itens: rs.map(item), empresas: ctx.empresas };
    }
    if (tipo === 'ANALITICO') {
      return { tipo, linhas: rs.map((r) => ({ ...item(r), data: r.data, codparceiro: r.codparceiro, razao: r.razao, empresa: r.empresa, descricao_troca: r.descricao_troca })), itens: [], empresas: ctx.empresas };
    }
    // sintético: SUM(QTDE_EDICAO), SUM(VRCUSTO), SUM(TOTAL) GROUP BY CODBARRA, DESCRICAO, VRVENDA, STATUS
    const g = new Map<string, Linha>();
    for (const r of rs) {
      const k = JSON.stringify([r.codbarra, r.descricao, r.vrvenda, r.status]);
      const a = g.get(k) ?? { codbarra: r.codbarra, descricao: r.descricao, status: st(r.status), qtde: 0, vrcusto: 0, vrvenda: r.vrvenda, total: 0 };
      a.qtde = Number(a.qtde) + Number(r.qtde_edicao ?? 0);
      a.vrcusto = Math.round((Number(a.vrcusto) + Number(r.vrcusto ?? 0)) * 10000) / 10000;
      a.total = Math.round((Number(a.total) + Number(r.total ?? 0)) * 10000) / 10000;
      g.set(k, a);
    }
    return { tipo, linhas: [...g.values()], itens: [], empresas: ctx.empresas };
  }

  /** a impressão (`GeraRelatorio` do TFrmRelMaster) no layout do tipo */
  async impressao(f: FiltroRelTroca) {
    const tipo: TipoRelTroca = f.tipo ?? 'AGRUPADO';
    const db = this.dbp.forTenantRead() as AnyDB;
    const ctx = await this.contexto(db, f);
    const arquivo = { AGRUPADO: 'TrocaMercadoria_Analitico_Agrup.fr3', ANALITICO: 'TrocaMercadoria_Analitico.fr3', SINTETICO: 'TrocaMercadoria_Sintetico.fr3' }[tipo];
    return relatorioMestre(db, {
      arquivo, titulo: 'Troca de mercadorias', relatorio: await this.registros(db, { ...f, tipo }, ctx),
      variaveis: { empresas: ctx.empresas, dataIni: ctx.dataIni, dataFim: ctx.dataFim },
    });
  }
}
