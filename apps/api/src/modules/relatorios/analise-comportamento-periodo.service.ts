import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { METRICAS_COMPORTAMENTO, type AnaliseComportamentoPeriodoDto, type MetricaComportamento } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { relatorioMestre } from '../../shared/relatorios/relatorio-mestre';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface Janela { nome?: string; ini: string; fim: string }

interface Metricas {
  rotulo: string; ini: string; fim: string;
  faturamento: number; faturamentoVenda: number; faturamentoNf: number;
  cmv: number; lucro: number; rentabilidade: number; tickets: number; ticketMedio: number;
}

/**
 * ANÁLISE DE COMPORTAMENTO POR PERÍODO (`FRMRELANALISECOMPORTAMENTOPERIODO`). **24 acessos, 6 operadores.**
 * Dossiê: `uRelAnaliseComportamentoPeriodo.md`. Migration 250.
 *
 * Três períodos com nome próprio, seis métricas cada, e a diferença da referência para os dois comparados.
 *
 * ── O número é calculado, não lido de cache ─────────────────────────────────────────────────────────────
 * O legado lê `ANALISE_COMP_DIA_PROD`, alimentada pelo **Giros** — processo externo que roda de madrugada e
 * não veio no fonte. O critério foi reconstruído do dado e medido contra a produção: o faturamento de venda
 * fecha **60 de 60 dias exatos** (e produto a produto), os tickets 58 de 60, e a NF em todos os dias com nota.
 *
 * ── O CMV do Giros usa o custo da madrugada seguinte ────────────────────────────────────────────────────
 * Produto 130 em 10/09/2026: a venda gravou `vrcusto = 24,33` e a cache diz 26,367 — o custo de quando o job
 * rodou. Em 90 dias × 2 lojas, 177 dos 180 batem exato e o total difere **0,027%**. Aqui o CMV sai do custo
 * gravado na linha da venda, que é o custo do que saiu.
 *
 * ── A variação é sobre a BASE, não sobre a referência ───────────────────────────────────────────────────
 * O legado faz `(Ref − Comp) / Ref`. Loja 1, ago/2026 contra ago/2025: a queda real é 31,28% e a tela mostra
 * **−45,52%** — 14,24 pontos de exagero, sistemático: subestima crescimento e infla queda.
 */
@Injectable()
export class AnaliseComportamentoPeriodoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** o recorte por família do original: produto, seção, departamento, grupo e subgrupo, todos opcionais. */
  private familia(f: AnaliseComportamentoPeriodoDto) {
    return sql`
      AND (${f.idproduto ?? null}::integer   IS NULL OR p.idproduto   = ${f.idproduto ?? null}::integer)
      AND (${f.codsecao ?? null}::integer    IS NULL OR p.codsecao    = ${f.codsecao ?? null}::integer)
      AND (${f.coddpto ?? null}::integer     IS NULL OR p.coddpto     = ${f.coddpto ?? null}::integer)
      AND (${f.codgrupo ?? null}::integer    IS NULL OR p.codgrupo    = ${f.codgrupo ?? null}::integer)
      AND (${f.codsubgrupo ?? null}::integer IS NULL OR p.codsubgrupo = ${f.codsubgrupo ?? null}::integer)`;
  }

  private temFiltroFamilia(f: AnaliseComportamentoPeriodoDto) {
    return f.idproduto != null || f.codsecao != null || f.coddpto != null || f.codgrupo != null || f.codsubgrupo != null;
  }

  private async medir(db: AnyDB, empresas: number[], j: Janela, f: AnaliseComportamentoPeriodoDto): Promise<Metricas> {
    const fam = this.familia(f);
    // custo de reposição é o checkbox do original; o default é o custo gravado na venda
    const custo = f.custoReposicao ? sql`v.vrcustorep` : sql`v.vrcusto`;

    const venda = (await sql<Record<string, unknown>>`
      SELECT coalesce(sum(round(v.qtde * v.vrvenda, 2) + coalesce(v.desc_acre_medio, 0) - coalesce(v.desc_promocao, 0)), 0) AS faturamento,
             coalesce(sum(round(v.qtde * coalesce(${custo}, 0), 2)), 0) AS cmv,
             -- ⚠️ o número do cupom REINICIA a cada dia: distinct só do número deduplica entre dias e
             -- subconta ~10% num mês (21.804 contra 24.097, medido em ago/2026 na loja 1)
             count(DISTINCT (v.dtvenda::date, v.nrocupom)) AS tickets
        FROM vendas v
        JOIN produtos p ON p.idproduto = v.codproduto
       WHERE v.idempresa = ANY(${empresas})
         AND v.dtvenda >= ${j.ini}::date AND v.dtvenda < ${j.fim}::date + 1
         AND coalesce(v.cancelado, 'N') <> 'S'
         ${fam}
    `.execute(db)).rows[0];

    // a NF só entra quando o CFOP é venda de verdade: gera financeiro e não é devolução
    const nf = (await sql<Record<string, unknown>>`
      SELECT coalesce(sum(round(np.quantidade * np.fatorembal * coalesce(np.vrcusto, 0), 2)), 0) AS faturamento
        FROM nf n
        JOIN nf_prod np ON np.codnf = n.codnf
        JOIN produtos p ON p.idproduto = np.codproduto
        JOIN cfop c ON c.codcfop = n.cfop
       WHERE n.idempresa = ANY(${empresas}) AND n.tipo = 'S'
         AND n.dtcontabil >= ${j.ini}::date AND n.dtcontabil < ${j.fim}::date + 1
         AND coalesce(n.cancelada, 'N') <> 'S'
         AND coalesce(c.proc_financeiro, 'S') = 'S' AND coalesce(c.devolucao, 'N') = 'N'
         ${fam}
    `.execute(db)).rows[0];

    const faturamentoVenda = r2(num(venda?.faturamento));
    const faturamentoNf = r2(num(nf?.faturamento));
    const faturamento = r2(faturamentoVenda + faturamentoNf);
    const cmv = r2(num(venda?.cmv));
    const tickets = Number(venda?.tickets ?? 0);
    const lucro = r2(faturamento - cmv);

    return {
      rotulo: j.nome?.trim() || `${j.ini} a ${j.fim}`,
      ini: j.ini, fim: j.fim,
      faturamento, faturamentoVenda, faturamentoNf, cmv, lucro,
      rentabilidade: faturamento > 0 ? r2((lucro / faturamento) * 100) : 0,
      tickets,
      // o ticket médio divide só a VENDA pelos cupons: a nota não passa pelo caixa
      ticketMedio: tickets > 0 ? r2(faturamentoVenda / tickets) : 0,
    };
  }

  /**
   * A diferença da referência para um comparado, métrica a métrica. A variação percentual é sobre a **base**
   * (o período comparado) — o legado divide pela referência e erra 14 pontos numa queda de 31%.
   */
  private comparar(ref: Metricas, comp: Metricas) {
    const par = (a: number, b: number) => ({
      referencia: a, comparado: b, diferenca: r2(a - b),
      variacao: b === 0 ? null : r2(((a - b) / Math.abs(b)) * 100),
    });
    return {
      rotulo: `${ref.rotulo} × ${comp.rotulo}`,
      Faturamento: par(ref.faturamento, comp.faturamento),
      CMV: par(ref.cmv, comp.cmv),
      Lucro: par(ref.lucro, comp.lucro),
      Rentabilidade: par(ref.rentabilidade, comp.rentabilidade),
      'Quantidade de tickets': par(ref.tickets, comp.tickets),
      'Valor ticket médio': par(ref.ticketMedio, comp.ticketMedio),
    };
  }

  async gerar(f: AnaliseComportamentoPeriodoDto): Promise<Record<string, unknown>> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const empresas = await empresasDoOperador(db, f.empresas ?? null);

    const referencia = await this.medir(db, empresas, f.referencia, f);
    const comparado1 = await this.medir(db, empresas, f.comparado1, f);
    const comparado2 = f.comparado2 ? await this.medir(db, empresas, f.comparado2, f) : null;

    return {
      empresas,
      periodos: comparado2 ? [referencia, comparado1, comparado2] : [referencia, comparado1],
      comparacoes: comparado2
        ? [this.comparar(referencia, comparado1), this.comparar(referencia, comparado2)]
        : [this.comparar(referencia, comparado1)],
      // o original conta ticket por CUPOM sem filtro de família e por PEDIDO com ele; aqui é sempre por cupom
      criterio: {
        tickets: 'cupom',
        cmv: f.custoReposicao ? 'custo de reposição' : 'custo da venda',
        familiaFiltrada: this.temFiltroFamilia(f),
      },
    };
  }

  /**
   * A impressão (`GeraRelatorio` → `ProcessaAnalise`, `RelAnaliseComportamentoPeriodo.fr3`): o `Cds` como o legado o monta — o bloco de
   * cada período (as seis métricas, o título visível só na linha do Faturamento), uma linha vazia entre os blocos (o script do layout
   * esconde a de título vazio) e, depois do comparado, a "Comparação entre <ref> e <comp>" com a diferença e o `GetPorcentagem` do
   * legado — `Arredonda((Ref − Comp) ÷ Ref × 100)`, sobre a REFERÊNCIA (a tela mostra a variação sobre a base; o relatório do cliente
   * imprime a dele). O `CdsGrafico` (um ponto por período em cada métrica) vai como detalhe do `CdsGrupos` (`MasterFields = 'Grupo'`):
   * um gráfico de barras por métrica na página 2.
   */
  async impressao(f: AnaliseComportamentoPeriodoDto) {
    const r = await this.gerar(f) as { empresas: number[]; periodos: Metricas[] };
    const db = this.dbp.forTenantRead() as AnyDB;
    const br = (d: string) => d.split('-').reverse().join('/');
    const janelas = [f.referencia, f.comparado1, ...(f.comparado2 ? [f.comparado2] : [])];
    const titulos = janelas.map((j) => (j.nome?.trim() ? j.nome.trim() : `${br(j.ini)} à ${br(j.fim)}`));
    const valores = (m: Metricas): Array<[string, number]> => [
      ['Faturamento', m.faturamento], ['CMV', m.cmv], ['Lucro', r2(m.faturamento - m.cmv)], ['Rentabilidade', m.rentabilidade],
      ['Quantidade de tickets', m.tickets], ['Valor ticket médio', m.ticketMedio],
    ];
    const cds: Array<Record<string, unknown>> = [];
    const grafico: Array<Record<string, unknown>> = [];
    const espaco = () => cds.push({ TituloVisivel: null, Titulo: null, Descricao: null, Valor: null, Porcentagem: null, DataI: null, DataF: null });
    const periodo = (k: number) => {
      const j = janelas[k];
      for (const [d, v] of valores(r.periodos[k])) {
        cds.push({ TituloVisivel: d === 'Faturamento' ? titulos[k] : null, Titulo: titulos[k], Descricao: d, Valor: v, Porcentagem: null, DataI: `${j.ini}T00:00:00`, DataF: `${j.fim}T00:00:00` });
        grafico.push({ Descricao: titulos[k], Valor: v, Grupo: d, __MESTRE: METRICAS_COMPORTAMENTO.indexOf(d as MetricaComportamento) });
      }
    };
    const diferenca = (k: number) => {
      const a = valores(r.periodos[0]); const b = valores(r.periodos[k]);
      a.forEach(([d, va], i) => {
        const dif = r2(va - b[i][1]);
        cds.push({ TituloVisivel: d === 'Faturamento' ? `Comparação entre ${titulos[0]} e ${titulos[k]}` : null, Titulo: `Comparação entre ${titulos[0]} e ${titulos[k]}`, Descricao: d,
          Valor: dif, Porcentagem: va !== 0 ? r2((dif / va) * 100) : 0, DataI: null, DataF: null });
      });
    };
    periodo(0); espaco();
    periodo(1); espaco();
    diferenca(1); espaco();
    if (r.periodos[2]) { periodo(2); espaco(); diferenca(2); }
    // o CdsGrafico tem IndexFieldNames = 'Grupo': cada métrica com os pontos na ordem dos períodos
    grafico.sort((x, y) => Number(x.__MESTRE) - Number(y.__MESTRE));
    return relatorioMestre(db, {
      arquivo: 'RelAnaliseComportamentoPeriodo.fr3', titulo: 'Análise do comportamento da loja por períodos', vazio: false,
      relatorio: cds, auxiliar: METRICAS_COMPORTAMENTO.map((g) => ({ Grupo: g })),
      variaveis: { empresas: r.empresas, dataIni: f.referencia.ini, dataFim: f.referencia.fim },
      extras: { DBDGrafico: grafico },
    });
  }
}
