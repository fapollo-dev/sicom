import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { AnaliseComportamentoDto, ImpostosAdicionarDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/** as nove linhas de uma "semana" (ou do total) — os nomes são os do original. */
export interface Linhas {
  faturamento: number; faturamentoVenda: number; faturamentoNf: number;
  cmv: number; rentabilidade: number; impostos: number; lucroFinal: number;
  margemBruta: number; margemFinal: number; clientes: number; ticketMedio: number;
}
export interface Semana extends Linhas { n: number; ini: string; fim: string }
export interface Bloco { chave: string; rotulo: string; ini: string; fim: string; semanas: Semana[]; total: Linhas }
/** os valores sem arredondamento (o que o cdsRelatorio do legado carrega) — para a impressão */
interface Cru { semanas: Linhas[]; total: Linhas }

const LINHAS_COMPARADAS: Array<keyof Linhas> = [
  'faturamento', 'cmv', 'rentabilidade', 'impostos', 'lucroFinal', 'margemBruta', 'margemFinal', 'clientes', 'ticketMedio',
];

/**
 * ANÁLISE DE COMPORTAMENTO DA LOJA (`FRMANALISECOMPORTAMENTO`). **53 acessos, 8 operadores.**
 * Dossiê: `uAnaliseComportamento.md`. Migration 251.
 *
 * Três blocos (mês anterior, mês atual, mesmo mês do ano anterior) × nove linhas × cinco "semanas" fixas +
 * total, e dois comparativos. O legado lê a cache do **Giros**; aqui o número é calculado com o critério
 * fechado na migration 250 — que reproduz a cache a 1 centavo em R$ 1,1 milhão.
 *
 * ── As "semanas" são blocos fixos de 7 dias ────────────────────────────────────────────────────────────
 * 1–7, 8–14, 15–21, 22–28, 29–fim. Confirmado na cache linha a linha e no valor (semana 1 de ago/2026 na
 * loja 1: 238.838,52 nos dois lados).
 *
 * ── UM critério, com ou sem filtro ─────────────────────────────────────────────────────────────────────
 * No legado, filtrar por família troca o caminho: sai da cache e monta a conta em VENDAS/NF_PROD — com um
 * `LEFT JOIN MULTI_PRECO` **sem IDEMPRESA** que multiplica as linhas por 4,265 e um `IDEMPRESA IN (1)` fixo.
 * Medido em ago/2026, loja 1: CMV de **R$ 3.518.208,52** contra R$ 805.652,00 reais. Aqui o filtro só recorta.
 *
 * ── Os impostos: a lista vazia vira PREVISÃO de 5,5% (corrigido em 06/10/2026) ─────────────────────────
 * Com contas marcadas em `IMPOSTOS`, a linha "Impostos" soma `ABS(CAIXA.VALOR)` delas na semana (as lojas marcadas). Com a lista
 * VAZIA (`aqqImpostos.RecordCount = 0`, uAnaliseComportamento.pas:478) a linha vira **"Previsão Impostos" = faturamento da semana ×
 * 5,5%**, e o Lucro Final desconta essa previsão. Na produção a IMPOSTOS tem 0 linhas: o cliente sempre viu a previsão. (O corte de
 * 09/2026 dizia "nunca teve dado, Lucro Final = Rentabilidade" — leu só o SQL do caixa.)
 *
 * ── As margens do TOTAL são a média das semanas ────────────────────────────────────────────────────────
 * Margem Bruta/Final da semana = rentabilidade (lucro) ÷ faturamento × 100 (0 se um dos dois é 0); a do TOTAL é a SOMA das cinco
 * semanas ÷ 5 (÷ 4 em mês de até 28 dias) — não a margem do mês. Nos comparativos, o TOTAL é a soma das diferenças das semanas (o
 * Ticket Médio, a diferença dos totais) e o % é sobre a base (0 quando a diferença ou a base é 0). As lojas são as do GetMultiEmpresa.
 */
@Injectable()
export class AnaliseComportamentoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /**
   * O recorte por família. Na VENDA o legado usa a família gravada na própria linha (`V.CODDPTO`…) e o
   * fornecedor do produto; a seção vem da `FAMILIAS_PROD` do departamento. Na NF, tudo vem do produto.
   */
  private familiaVenda(f: AnaliseComportamentoDto) {
    return sql`
      AND (${f.coddpto ?? null}::integer     IS NULL OR v.coddpto     = ${f.coddpto ?? null}::integer)
      AND (${f.codgrupo ?? null}::integer    IS NULL OR v.codgrupo    = ${f.codgrupo ?? null}::integer)
      AND (${f.codsubgrupo ?? null}::integer IS NULL OR v.codsubgrupo = ${f.codsubgrupo ?? null}::integer)
      AND (${f.codfor ?? null}::integer      IS NULL OR p.codfor      = ${f.codfor ?? null}::integer)
      AND (${f.codsecao ?? null}::integer    IS NULL OR fd.codsecao   = ${f.codsecao ?? null}::integer)`;
  }
  private familiaNf(f: AnaliseComportamentoDto) {
    return sql`
      AND (${f.coddpto ?? null}::integer     IS NULL OR p.coddpto     = ${f.coddpto ?? null}::integer)
      AND (${f.codgrupo ?? null}::integer    IS NULL OR p.codgrupo    = ${f.codgrupo ?? null}::integer)
      AND (${f.codsubgrupo ?? null}::integer IS NULL OR p.codsubgrupo = ${f.codsubgrupo ?? null}::integer)
      AND (${f.codfor ?? null}::integer      IS NULL OR p.codfor      = ${f.codfor ?? null}::integer)
      AND (${f.codsecao ?? null}::integer    IS NULL OR fd.codsecao   = ${f.codsecao ?? null}::integer)`;
  }

  /** a "semana" fixa do legado: 1 = dias 1–7 … 5 = 29 até o fim do mês. */
  private semanaDe(col: ReturnType<typeof sql>) {
    return sql`least(ceil(extract(day from ${col}) / 7.0), 5)::int`;
  }

  /** as linhas de uma semana (uAnaliseComportamento.pas:408-940): com a lista de impostos vazia, a PREVISÃO de 5,5% do faturamento */
  private semana(b: { venda: number; nf: number; cmv: number; impostos: number; clientes: number }, previsao: boolean) {
    const faturamento = b.venda + b.nf;
    const rentabilidade = faturamento - b.cmv;
    const impostos = previsao ? (faturamento / 100) * 5.5 : b.impostos;
    const lucroFinal = rentabilidade - impostos;
    return {
      faturamento, faturamentoVenda: b.venda, faturamentoNf: b.nf, cmv: b.cmv, rentabilidade, impostos, lucroFinal,
      margemBruta: rentabilidade === 0 || faturamento === 0 ? 0 : (rentabilidade / faturamento) * 100,
      margemFinal: lucroFinal === 0 || faturamento === 0 ? 0 : (lucroFinal / faturamento) * 100,
      clientes: b.clientes,
      // o ticket médio divide só a VENDA pelos cupons — a nota não passa pelo caixa
      ticketMedio: b.clientes > 0 ? b.venda / b.clientes : 0,
    };
  }

  private arred(l: Linhas): Linhas {
    return Object.fromEntries(Object.entries(l).map(([k, v]) => [k, k === 'clientes' ? v : r2(v)])) as unknown as Linhas;
  }

  private async bloco(db: AnyDB, emps: number[], chave: string, ano: number, mes: number, f: AnaliseComportamentoDto, previsao: boolean): Promise<Bloco & { cru: Cru }> {
    const ini = `${ano}-${pad(mes)}-01`;
    const fim = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10); // último dia do mês
    const famV = this.familiaVenda(f);
    const famN = this.familiaNf(f);

    const venda = (await sql<Record<string, unknown>>`
      SELECT ${this.semanaDe(sql`v.dtvenda`)} AS sem,
             coalesce(sum(round(v.qtde * v.vrvenda, 2) + coalesce(v.desc_acre_medio, 0) - coalesce(v.desc_promocao, 0)), 0) AS venda,
             coalesce(sum(round(v.qtde * coalesce(v.vrcusto, 0), 2)), 0) AS cmv,
             -- o número do cupom reinicia a cada dia: a chave é o par (dia, cupom)
             count(DISTINCT (v.dtvenda::date, v.nrocupom)) AS clientes
        FROM vendas v
        JOIN produtos p ON p.idproduto = v.codproduto
        LEFT JOIN familias_prod fd ON fd.codfamilia = v.coddpto
       WHERE v.idempresa = ANY(${emps})
         AND v.dtvenda >= ${ini}::date AND v.dtvenda < ${fim}::date + 1
         AND coalesce(v.cancelado, 'N') <> 'S'
         ${famV}
       GROUP BY 1
    `.execute(db)).rows;

    const nf = (await sql<Record<string, unknown>>`
      SELECT ${this.semanaDe(sql`n.dtcontabil`)} AS sem,
             coalesce(sum(round(np.quantidade * np.fatorembal * coalesce(np.vrcusto, 0), 2)), 0) AS nf
        FROM nf n
        JOIN nf_prod np ON np.codnf = n.codnf
        JOIN produtos p ON p.idproduto = np.codproduto
        LEFT JOIN familias_prod fd ON fd.codfamilia = p.coddpto
        JOIN cfop c ON c.codcfop = n.cfop
       WHERE n.idempresa = ANY(${emps}) AND n.tipo = 'S'
         AND n.dtcontabil >= ${ini}::date AND n.dtcontabil < ${fim}::date + 1
         AND coalesce(n.cancelada, 'N') <> 'S'
         AND coalesce(c.proc_financeiro, 'S') = 'S' AND coalesce(c.devolucao, 'N') = 'N'
         ${famN}
       GROUP BY 1
    `.execute(db)).rows;

    // impostos: as contas do plano marcadas em `impostos`, somadas em módulo no caixa (o legado não filtra
    // família aqui — imposto não tem departamento)
    const imp = (await sql<Record<string, unknown>>`
      SELECT ${this.semanaDe(sql`cx.data`)} AS sem, coalesce(sum(abs(cx.valor)), 0) AS impostos
        FROM caixa cx
        JOIN impostos i ON i.codplc = cx.codplc
       WHERE cx.idempresa = ANY(${emps})
         AND cx.data >= ${ini}::date AND cx.data < ${fim}::date + 1
       GROUP BY 1
    `.execute(db)).rows;

    const porSem = (rows: Record<string, unknown>[], col: string) => {
      const m = new Map<number, number>();
      for (const r of rows) m.set(Number(r.sem), num(r[col]));
      return m;
    };
    const mv = porSem(venda, 'venda'), mc = porSem(venda, 'cmv'), mcl = porSem(venda, 'clientes');
    const mn = porSem(nf, 'nf'), mi = porSem(imp, 'impostos');

    const ultimoDia = Number(fim.slice(8, 10));
    const brutas: Array<ReturnType<AnaliseComportamentoService['semana']> & { n: number; ini: string; fim: string }> = [];
    for (let n = 1; n <= 5; n++) {
      const d1 = (n - 1) * 7 + 1;
      const d2 = n === 5 ? ultimoDia : n * 7;
      const b = { venda: mv.get(n) ?? 0, nf: mn.get(n) ?? 0, cmv: mc.get(n) ?? 0, impostos: mi.get(n) ?? 0, clientes: mcl.get(n) ?? 0 };
      brutas.push({ n, ini: `${ano}-${pad(mes)}-${pad(d1)}`, fim: `${ano}-${pad(mes)}-${pad(d2)}`, ...this.semana(b, previsao) });
    }
    const soma = (k: keyof Linhas) => brutas.reduce((acc, x) => acc + x[k], 0);
    const divisor = ultimoDia > 28 ? 5 : 4;
    const vendaTotal = soma('faturamentoVenda'), clientesTotal = soma('clientes');
    const total: Linhas = {
      faturamento: soma('faturamento'), faturamentoVenda: vendaTotal, faturamentoNf: soma('faturamentoNf'), cmv: soma('cmv'),
      rentabilidade: soma('rentabilidade'), impostos: soma('impostos'), lucroFinal: soma('lucroFinal'),
      margemBruta: soma('margemBruta') / divisor, margemFinal: soma('margemFinal') / divisor,
      clientes: clientesTotal, ticketMedio: clientesTotal > 0 ? vendaTotal / clientesTotal : 0,
    };
    const semanas: Semana[] = brutas.map((x) => ({ ...this.arred(x), n: x.n, ini: x.ini, fim: x.fim }));
    return { chave, rotulo: `${MESES[mes - 1]} de ${ano}`, ini, fim, semanas, total: this.arred(total), cru: { semanas: brutas, total } };
  }

  /**
   * Dif = alvo − base; % = Dif / base (0 quando a Dif ou a base é 0). É assim no legado desta tela (a irmã, migration 250, dividia
   * pelo alvo). O TOTAL é a SOMA das diferenças das semanas — só o Ticket Médio usa a diferença dos totais (:1934).
   */
  private comparar(rotulo: string, alvo: Bloco, base: Bloco) {
    const pct = (d: number, b: number) => (d === 0 || b === 0 ? 0 : r2((d / b) * 100));
    const semanas = alvo.semanas.map((s, i) => {
      const out: Record<string, unknown> = { n: s.n };
      for (const k of LINHAS_COMPARADAS) {
        const d = r2(s[k] - base.semanas[i][k]);
        out[k] = { diferenca: d, variacao: pct(d, base.semanas[i][k]) };
      }
      return out as { n: number } & Record<string, { diferenca: number; variacao: number }>;
    });
    const total: Record<string, { diferenca: number; variacao: number }> = {};
    for (const k of LINHAS_COMPARADAS) {
      const d = k === 'ticketMedio' ? r2(alvo.total[k] - base.total[k]) : r2(semanas.reduce((acc, x) => acc + x[k].diferenca, 0));
      total[k] = { diferenca: d, variacao: pct(d, base.total[k]) };
    }
    return { rotulo, alvo: alvo.chave, base: base.chave, semanas, total };
  }

  async gerar(f: AnaliseComportamentoDto) {
    const { crus: _c, ...r } = await this.calcular(f);
    return r;
  }

  private async calcular(f: AnaliseComportamentoDto) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const pedidas = f.empresas ? f.empresas.split(',').map((x) => Number(x.trim())).filter((x) => x > 0) : [];
    const emps = pedidas.length ? await empresasDoOperador(db, pedidas) : [emp];
    const mesAnt = f.mes === 1 ? 12 : f.mes - 1;
    const anoMesAnt = f.mes === 1 ? f.ano - 1 : f.ano;
    // a lista de contas de imposto (aqqImpostos, sem filtro): vazia → a "Previsão Impostos" de 5,5%
    const previsao = Number((await sql<{ n: unknown }>`SELECT count(*) AS n FROM impostos`.execute(db)).rows[0]?.n ?? 0) === 0;

    const sem = async (chave: string, ano: number, mes: number) => {
      const { cru, ...b } = await this.bloco(db, emps, chave, ano, mes, f, previsao);
      return { b: b as Bloco, cru };
    };
    const [a1, a2, a3] = [await sem('mesAnterior', anoMesAnt, mesAnt), await sem('mesAtual', f.ano, f.mes), await sem('anoAnterior', f.ano - 1, f.mes)];
    const mesAnterior = a1.b, mesAtual = a2.b, anoAnterior = a3.b;

    return {
      referencia: { mes: f.mes, ano: f.ano }, empresas: emps,
      impostosRotulo: previsao ? 'Previsão Impostos' : 'Impostos',
      blocos: [mesAnterior, mesAtual, anoAnterior],
      comparativos: [
        this.comparar('Compar. Mês Anterior', mesAtual, mesAnterior),
        this.comparar('Compar. Ano Anterior', mesAtual, anoAnterior),
      ],
      criterio: { semanas: 'blocos fixos de 7 dias', clientes: 'cupom por dia', cmv: 'custo da venda', filtroFamilia: this.temFiltro(f) },
      crus: [a1.cru, a2.cru, a3.cru],
    };
  }

  /**
   * O Imprimir (`btnImprimirClick`): `Relatorios\Rel_Analise_comportamento_loja.fr3` com o `cdsRelatorio` como o ProcessaAnalise
   * monta — mês anterior (IDs 0, 1-9), mês atual (0, 10-18), "Compar. Mês Anterior" (sem ID) e as diferenças (19-27), o mesmo mês do
   * ano anterior (0, 28-36), "Compar. Ano Anterior" (sem ID) e as diferenças (37-45). Nos blocos, TOTAL_PERC = o total ÷ o faturamento
   * do mês (CMV, rentabilidade, impostos, lucro final); nas diferenças, cada SEMANA_n_PERC e o TOTAL_PERC sobre a base. Os gráficos:
   * `dbdGraficoFaturamento`/`dbdGraficoLucroFinal` com uma linha por mês, na ordem em que o legado acrescenta (mês anterior ID 2, atual
   * ID 3, ano anterior ID 1). Variáveis DtInicial/DtFinal (o mês atual) e Empresa (GetMultiEmpresa). O título da linha de clientes do
   * mês anterior vem da cache (`cdsConsulta.TITULO`): sem cupom na 1ª semana desse mês, sai vazio, como no legado.
   */
  async impressao(f: AnaliseComportamentoDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = await this.calcular(f);
    // os valores CRUS (o legado guarda Float sem arredondar: o TOTAL_PERC da previsão é 5,5 exato)
    const [ant, atu, anoAnt] = r.blocos.map((b, i) => ({ ...b, semanas: r.crus[i].semanas, total: r.crus[i].total })) as Array<{ rotulo: string; ini: string; fim: string; semanas: Linhas[]; total: Linhas }>;
    const pct = (a: number, b: number) => (a !== 0 && b !== 0 ? (a / b) * 100 : 0);
    const linhas: Record<string, unknown>[] = [];
    const sem = (b: { semanas: Linhas[] }, k: keyof Linhas) => Object.fromEntries(b.semanas.map((x, i) => [`semana_${i + 1}`, x[k]]));
    const bloco = (b: { rotulo: string; semanas: Linhas[]; total: Linhas }, id0: number, tituloClientes: string) => {
      linhas.push({ titulo: b.rotulo, id: 0 });
      const fat = b.total.faturamento;
      const linha = (titulo: string, d: number, k: keyof Linhas, comPerc: boolean) =>
        linhas.push({ titulo, id: id0 + d, ...sem(b, k), total: b.total[k], ...(comPerc ? { total_perc: pct(b.total[k], fat) } : {}) });
      linha('Faturamento', 0, 'faturamento', false);
      linha('CMV', 1, 'cmv', true);
      linha('Rentabilidade', 2, 'rentabilidade', true);
      linha(r.impostosRotulo, 3, 'impostos', true);
      linha('Lucro Final', 4, 'lucroFinal', true);
      linha('Margem Bruta', 5, 'margemBruta', false);
      linha('Margem Final', 6, 'margemFinal', false);
      linha(tituloClientes, 7, 'clientes', false);
      linha('Ticket Médio', 8, 'ticketMedio', false);
    };
    const NOMES: Array<[keyof Linhas, string]> = [['faturamento', 'Dif Faturamento'], ['cmv', 'Dif CMV'], ['rentabilidade', 'Dif Rentabilidade'],
      ['impostos', 'Dif Impostos'], ['lucroFinal', 'Dif Lucro Final'], ['margemBruta', 'Dif Margem Bruta'], ['margemFinal', 'Dif Margem Final'],
      ['clientes', 'Dif Num. Clientes'], ['ticketMedio', 'Dif Ticket Médio']];
    const comparativo = (titulo: string, id0: number, base: { semanas: Linhas[]; total: Linhas }) => {
      linhas.push({ titulo, id: null });
      NOMES.forEach(([k, nome], d) => {
        const row: Record<string, unknown> = { titulo: nome, id: id0 + d };
        let soma = 0;
        atu.semanas.forEach((x, i) => {
          const dif = x[k] - base.semanas[i][k];
          soma += dif;
          row[`semana_${i + 1}`] = dif;
          row[`semana_${i + 1}_perc`] = dif === 0 || base.semanas[i][k] === 0 ? 0 : (dif / base.semanas[i][k]) * 100;
        });
        const total = k === 'ticketMedio' ? atu.total[k] - base.total[k] : soma;
        row.total = total;
        row.total_perc = total === 0 || base.total[k] === 0 ? 0 : (total / base.total[k]) * 100;
        linhas.push(row);
      });
    };
    bloco(ant, 1, ant.semanas[0].clientes > 0 ? 'Num. Clientes' : '');
    bloco(atu, 10, 'Num. Clientes');
    comparativo('Compar. Mês Anterior', 19, ant);
    bloco(anoAnt, 28, 'Num. Clientes');
    comparativo('Compar. Ano Anterior', 37, anoAnt);

    const nums = new Set(['id', 'semana_1', 'semana_2', 'semana_3', 'semana_4', 'semana_5', 'total', 'semana_1_perc', 'semana_2_perc', 'semana_3_perc',
      'semana_4_perc', 'semana_5_perc', 'total_perc']);
    const grafico = (k: keyof Linhas) => ([[2, ant], [3, atu], [1, anoAnt]] as const).map(([id, b]) => registroFr3({ id, titulo: b.rotulo, total: b.total[k] }, new Set(['id', 'total'])));
    const br = (d: string) => d.slice(0, 10).split('-').reverse().join('/');
    return {
      titulo: 'Análise de comportamento da loja',
      modelo: await modeloFr3(db, 'Rel_Analise_comportamento_loja.fr3'),
      datasets: {
        dbdRelatorio: linhas.map((l) => registroFr3(l, nums)),
        dbdGraficoFaturamento: grafico('faturamento'),
        dbdGraficoLucroFinal: grafico('lucroFinal'),
      },
      variaveis: { DtInicial: textoVariavel(br(atu.ini)), DtFinal: textoVariavel(br(atu.fim)), Empresa: textoVariavel(r.empresas.join(',')) },
    };
  }

  private temFiltro(f: AnaliseComportamentoDto) {
    return f.coddpto != null || f.codgrupo != null || f.codsubgrupo != null || f.codsecao != null || f.codfor != null;
  }

  // ── manutenção da lista de contas de imposto (o painel "Impostos" da tela) ──────────────────────────
  async listarImpostos(): Promise<Record<string, unknown>[]> {
    const db = this.dbp.forTenantRead() as AnyDB;
    return (await sql<Record<string, unknown>>`
      SELECT i.codplc, coalesce(i.descricao, p.descricao) AS descricao, p.desccodplc
        FROM impostos i LEFT JOIN plc p ON p.codplc = i.codplc
       ORDER BY p.desccodplc, i.codplc
    `.execute(db)).rows;
  }

  /** o legado só acrescenta o que ainda não está na lista (`Locate` antes do `Append`). */
  async adicionarImpostos(b: ImpostosAdicionarDto): Promise<{ adicionados: number }> {
    const db = this.dbp.forTenant() as AnyDB;
    let adicionados = 0;
    for (const cod of b.codplcs) {
      const r = await sql`
        INSERT INTO impostos (codplc, descricao)
        SELECT p.codplc, p.descricao FROM plc p WHERE p.codplc = ${cod}
        ON CONFLICT (codplc) DO NOTHING
      `.execute(db);
      adicionados += Number(r.numAffectedRows ?? 0);
    }
    return { adicionados };
  }

  async removerImposto(codplc: number): Promise<{ removido: boolean }> {
    const db = this.dbp.forTenant() as AnyDB;
    const r = await sql`DELETE FROM impostos WHERE codplc = ${codplc}`.execute(db);
    return { removido: Number(r.numAffectedRows ?? 0) > 0 };
  }
}
