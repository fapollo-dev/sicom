import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { AnaliseComportamentoDto, ImpostosAdicionarDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/** as nove linhas de uma "semana" (ou do total) — os nomes são os do original. */
interface Linhas {
  faturamento: number; faturamentoVenda: number; faturamentoNf: number;
  cmv: number; rentabilidade: number; impostos: number; lucroFinal: number;
  margemBruta: number; margemFinal: number; clientes: number; ticketMedio: number;
}
interface Semana extends Linhas { n: number; ini: string; fim: string }
interface Bloco { chave: string; rotulo: string; ini: string; fim: string; semanas: Semana[]; total: Linhas }

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
 * ── A "Previsão de Impostos" nunca teve dado ───────────────────────────────────────────────────────────
 * Soma `ABS(CAIXA.VALOR)` das contas marcadas em `IMPOSTOS`; no cliente a tabela tem 0 linhas. A regra é
 * viva (a tela mantém a lista), então a manutenção vem junto.
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

  private derivadas(b: { venda: number; nf: number; cmv: number; impostos: number; clientes: number }): Linhas {
    const faturamento = r2(b.venda + b.nf);
    const rentabilidade = r2(faturamento - b.cmv);
    const lucroFinal = r2(rentabilidade - b.impostos);
    return {
      faturamento, faturamentoVenda: r2(b.venda), faturamentoNf: r2(b.nf),
      cmv: r2(b.cmv), rentabilidade, impostos: r2(b.impostos), lucroFinal,
      // o legado zera a margem quando a rentabilidade OU o faturamento é zero
      margemBruta: rentabilidade === 0 || faturamento === 0 ? 0 : r2((rentabilidade / faturamento) * 100),
      margemFinal: lucroFinal === 0 || faturamento === 0 ? 0 : r2((lucroFinal / faturamento) * 100),
      clientes: b.clientes,
      // o ticket médio divide só a VENDA pelos cupons — a nota não passa pelo caixa
      ticketMedio: b.clientes > 0 ? r2(b.venda / b.clientes) : 0,
    };
  }

  private async bloco(db: AnyDB, emp: number, chave: string, ano: number, mes: number, f: AnaliseComportamentoDto): Promise<Bloco> {
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
       WHERE v.idempresa = ${emp}
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
       WHERE n.idempresa = ${emp} AND n.tipo = 'S'
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
       WHERE cx.idempresa = ${emp}
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
    const semanas: Semana[] = [];
    const tot = { venda: 0, nf: 0, cmv: 0, impostos: 0, clientes: 0 };
    for (let n = 1; n <= 5; n++) {
      const d1 = (n - 1) * 7 + 1;
      const d2 = n === 5 ? ultimoDia : n * 7;
      const b = { venda: mv.get(n) ?? 0, nf: mn.get(n) ?? 0, cmv: mc.get(n) ?? 0, impostos: mi.get(n) ?? 0, clientes: mcl.get(n) ?? 0 };
      tot.venda += b.venda; tot.nf += b.nf; tot.cmv += b.cmv; tot.impostos += b.impostos; tot.clientes += b.clientes;
      semanas.push({ n, ini: `${ano}-${pad(mes)}-${pad(d1)}`, fim: `${ano}-${pad(mes)}-${pad(d2)}`, ...this.derivadas(b) });
    }
    return { chave, rotulo: `${MESES[mes - 1]} de ${ano}`, ini, fim, semanas, total: this.derivadas(tot) };
  }

  /** Dif = alvo − base; % = Dif / base. É assim no legado desta tela (a irmã, migration 250, dividia pelo alvo). */
  private comparar(rotulo: string, alvo: Bloco, base: Bloco) {
    const dif = (a: Linhas, b: Linhas) => {
      const out: Record<string, { diferenca: number; variacao: number | null }> = {};
      for (const k of LINHAS_COMPARADAS) {
        const d = r2(a[k] - b[k]);
        out[k] = { diferenca: d, variacao: d === 0 || b[k] === 0 ? null : r2((d / b[k]) * 100) };
      }
      return out;
    };
    return {
      rotulo, alvo: alvo.chave, base: base.chave,
      semanas: alvo.semanas.map((s, i) => ({ n: s.n, ...dif(s, base.semanas[i]) })),
      total: dif(alvo.total, base.total),
    };
  }

  async gerar(f: AnaliseComportamentoDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const mesAnt = f.mes === 1 ? 12 : f.mes - 1;
    const anoMesAnt = f.mes === 1 ? f.ano - 1 : f.ano;

    const mesAnterior = await this.bloco(db, emp, 'mesAnterior', anoMesAnt, mesAnt, f);
    const mesAtual = await this.bloco(db, emp, 'mesAtual', f.ano, f.mes, f);
    const anoAnterior = await this.bloco(db, emp, 'anoAnterior', f.ano - 1, f.mes, f);

    return {
      referencia: { mes: f.mes, ano: f.ano },
      blocos: [mesAnterior, mesAtual, anoAnterior],
      comparativos: [
        this.comparar('Compar. Mês Anterior', mesAtual, mesAnterior),
        this.comparar('Compar. Ano Anterior', mesAtual, anoAnterior),
      ],
      criterio: { semanas: 'blocos fixos de 7 dias', clientes: 'cupom por dia', cmv: 'custo da venda', filtroFamilia: this.temFiltro(f) },
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
