import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { colunasNumericas, dataBr, registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;

export type ModeloAnalise = 'TRIBUTARIA' | 'TRIBUTARIA_PRODUTOS' | 'CONFERENCIA';

export interface FiltroAnalise {
  dataIni: string;
  dataFim: string;
  /** 'T' todos · 'E' entrada · 'S' saída (o combo Tipo da tela). */
  tipo?: 'T' | 'E' | 'S';
  nronf?: string | null;
  codparceiro?: number | null;
  razao?: string | null;
  cfop?: number | string | null;
  /** 'S' processadas · 'N' não processadas · 'T' todas (o radio "Notas Processadas"). */
  processadas?: 'S' | 'N' | 'T';
  /** o "Incluir notas de devolução" — desmarcado, exclui os CFOPs marcados como devolução. */
  incluirDevolucao?: boolean;
  /** o "Somente diferenças": nota cujo rateio contábil não fecha com o total. */
  somenteDiferencas?: boolean;
  /** "NF que movimenta estoque": o CFOP com PROC_QTDE = 'S'. */
  movimentaEstoque?: boolean;
  /** as lojas (`GetMultiEmpresa`); vazio = a do login. */
  empresas?: number[];
}

/**
 * ANÁLISE DE NOTAS FISCAIS (`FRMNFANALISE`, `UNFAnalise.pas`). Dossiê: `uNFAnalise.md`.
 *
 * A tela de maior uso ainda não migrada fora do PDV — **704 acessos, 19 operadores, o último em 04/09/2026**.
 * É um HUB de nove análises sobre notas; este corte traz as duas que não dependem de nada além do que já
 * existe no Apollo.
 *
 * **1 — SITUAÇÃO TRIBUTÁRIA** (`sqqNF`, `UdmNFAnalise.dfm:352`): as notas do período com o total, o isento e
 * as outras despesas, por parceiro e CFOP. O que dá valor a ela é o filtro **"somente diferenças"**
 * (`UNFAnalise.pas:746`): mostra a nota cujo **rateio contábil não fecha com o total** —
 * `TOTALNF <> (SELECT sum(VALOR) FROM CODCONTABILNF WHERE CODNF = N.CODNF)`. No cliente isso pega
 * **3.037 das 49.282 notas (6,2%)**, e cada uma é um lançamento contábil que vai sair errado.
 *
 * **8 — CONFERÊNCIA DE NOTAS** (`GetSqlAnaliseConferencia` :1257): as notas que alguém ALTEROU, com o nome de
 * quem alterou (`USULTALTERACAO IS NOT NULL`). É a trilha de quem mexeu na nota depois de lançada.
 *
 * Os filtros são os da tela e valem para as duas: período por `DTCONTABIL`, tipo, número, parceiro, razão,
 * CFOP, processadas, devolução.
 *
 * ADIADO (fiel, com procedência): as outras sete opções — precificação (2, 4, 5), tributária por produto (3),
 * formas de pagamento (6), por CST (7) e ICMS-ST a recolher (9). As de precificação dependem do departamento
 * e do agrupamento por fornecedor; a 9 monta um demonstrativo de ST com 24 colunas sobre `nfe_nao_cadastradas`.
 */
@Injectable()
export class NfAnaliseService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async analisar(modelo: ModeloAnalise, f: FiltroAnalise): Promise<{
    modelo: ModeloAnalise; linhas: Array<Record<string, unknown>>;
    totais: { notas: number; totalnf: number; totalprod: number; totalisento: number; divergencia: number };
    truncado: boolean;
  }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    if (!f.dataIni || !f.dataFim) throw new BusinessRuleError('PERIODO_OBRIGATORIO');

    const onde = this.filtros(await empresasDoOperador(db, f.empresas), f);
    const LIMITE = 5000;

    // o rateio contábil da nota — é a soma que o "somente diferenças" confronta com o total.
    const rateio = sql`(SELECT coalesce(sum(e.valor), 0.01)::numeric(15,2) FROM nf_contabil e WHERE e.codnf = n.codnf)`;

    const linhas = (await sql<Record<string, unknown>>`
      SELECT n.codnf, n.nronf, to_char(n.dtemissao, 'YYYY-MM-DD') AS dtemissao,
             to_char(n.dtcontabil, 'YYYY-MM-DD') AS dtcontabil,
             n.tipo, n.cfop, c.descricao AS cfop_descricao,
             n.codparceiro, p.razao,
             coalesce(n.totalprod, 0.01) AS totalprod, n.totalnf,
             coalesce(n.totalisento, 0) AS totalisento,
             coalesce(n.totaloutrasdesp, 0) AS totaloutrasdesp,
             coalesce(n.proc, 'N') AS proc,
             ${rateio} AS rateio_contabil,
             (n.totalnf - ${rateio}) AS diferenca,
             ${modelo === 'CONFERENCIA' ? sql`o.nome` : sql`NULL::text`} AS alterado_por,
             ${modelo === 'CONFERENCIA' ? sql`to_char(n.dtultimalteracao, 'YYYY-MM-DD HH24:MI')` : sql`NULL::text`} AS alterado_em
        FROM nf n
        LEFT JOIN parceiros p ON p.codparceiro = n.codparceiro
        LEFT JOIN cfop c      ON c.codcfop = n.cfop
        LEFT JOIN operadores o ON o.codoperador = n.usultalteracao
       WHERE ${sql.join(onde, sql` AND `)}
         ${modelo === 'CONFERENCIA' ? sql`AND n.usultalteracao IS NOT NULL` : sql``}
       ORDER BY n.nronf
       LIMIT ${LIMITE + 1}
    `.execute(db)).rows;

    const truncado = linhas.length > LIMITE;
    if (truncado) linhas.length = LIMITE;

    const num = (v: unknown) => (v == null ? 0 : Number(v));
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    return {
      modelo,
      linhas,
      totais: {
        notas: linhas.length,
        totalnf: r2(linhas.reduce((s, l) => s + num(l.totalnf), 0)),
        totalprod: r2(linhas.reduce((s, l) => s + num(l.totalprod), 0)),
        totalisento: r2(linhas.reduce((s, l) => s + num(l.totalisento), 0)),
        divergencia: r2(linhas.reduce((s, l) => s + num(l.diferenca), 0)),
      },
      truncado,
    };
  }

  /** os filtros da tela, um a um (`UNFAnalise.pas:700-760`). */
  private filtros(empresas: number[], f: FiltroAnalise) {
    const onde = [
      sql`n.idempresa = ANY(${empresas}::int[])`,
      sql`n.dtcontabil::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`,
    ];
    // o combo Tipo vira `TIPO LIKE '%'` quando é "Todos" — aqui é explícito.
    if (f.tipo === 'E' || f.tipo === 'S') onde.push(sql`n.tipo = ${f.tipo}`);
    if (f.nronf) onde.push(sql`n.nronf LIKE ${`%${f.nronf}%`}`);
    if (f.codparceiro) onde.push(sql`n.codparceiro = ${f.codparceiro}`);
    if (f.razao) onde.push(sql`p.razao ILIKE ${`%${f.razao}%`}`);
    // ⚠️ `nf.cfop` é varchar(4) e `cfop.codcfop` é char(4) no destino — o CFOP é CÓDIGO, não número.
    // Comparar com inteiro dá "operator does not exist: character = integer".
    if (f.cfop) onde.push(sql`n.cfop = ${String(f.cfop)}`);
    // o radio "Notas Processadas": 0 = processadas, 1 = não (inclui nulo), 2 = todas.
    if (f.processadas === 'S') onde.push(sql`n.proc = 'S'`);
    if (f.processadas === 'N') onde.push(sql`(n.proc = 'N' OR n.proc IS NULL)`);
    // desmarcado, exclui o CFOP de devolução — e CFOP sem marca conta como "não é devolução" (:734).
    if (!f.incluirDevolucao) onde.push(sql`(coalesce(c.devolucao, 'N') <> 'S')`);
    // "NF que movimenta estoque" (`ckbNFmovimentastk`)
    if (f.movimentaEstoque) onde.push(sql`c.proc_qtde = 'S'`);
    // "somente diferenças": o rateio contábil não fecha com o total da nota (:746).
    if (f.somenteDiferencas) {
      onde.push(sql`n.totalnf <> (SELECT coalesce(sum(e.valor), 0.01)::numeric(15,2) FROM nf_contabil e WHERE e.codnf = n.codnf)`);
    }
    return onde;
  }

  /**
   * O "[F11] Imprimir" (`btnImprimirClick`, UNFAnalise.pas:278): o layout .fr3 do cliente da opção, com os datasets do UdmNFAnalise.
   *  - 1 e 3 (Notas_fiscais_analise / _produtos.fr3): o `cdsNF` com os detalhes aninhados de cada nota — CFOP, rateio contábil, ICMS
   *    (e os itens, na 3) — e os totalizadores que o `GeraConsulta` acumula nota a nota: por CFOP e por conta, o TOTAL da NOTA de cada linha
   *    (quirk fiel: não o valor da linha); por alíquota, o VALOR da linha. A conta contábil sai sem descrição (CODCONTABIL vazia na
   *    produção). PERIODO = "Período de … até …".
   *  - 8 (Notas_fiscais_analise_conferencia.fr3): o `GetSqlAnaliseConferencia` (as notas alteradas, com quem alterou), EMPRESAS e PERIODO.
   */
  async impressao(modelo: ModeloAnalise, f: FiltroAnalise) {
    const db = this.dbp.forTenantRead() as AnyDB;
    if (!f.dataIni || !f.dataFim) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    const empresas = await empresasDoOperador(db, f.empresas);
    const onde = this.filtros(empresas, f);
    const periodo = textoVariavel(`Período de ${dataBr(f.dataIni)} até ${dataBr(f.dataFim)}`);
    const semRegistro = () => new BusinessRuleError('RELATORIO_SEM_REGISTROS', {}, 'Não foi encontrado registro(s) para essa consulta...tente novamente com um novo filtro!');
    const nums = await colunasNumericas(db, ['nf', 'nf_prod', 'nf_contabil'], ['valor', 'total', 'quantidade', 'icme']);

    if (modelo === 'CONFERENCIA') {
      const linhas = (await sql<Record<string, unknown>>`
        SELECT n.codnf, to_char(n.dtcontabil, 'YYYY-MM-DD"T"00:00:00') AS dtcontabil, n.codparceiro, p.razao, n.totalnf, n.nronf, o.nome
          FROM nf n
          LEFT JOIN parceiros p  ON p.codparceiro = n.codparceiro
          LEFT JOIN operadores o ON o.codoperador = n.usultalteracao
          LEFT JOIN cfop c       ON c.codcfop = n.cfop
         WHERE n.usultalteracao IS NOT NULL AND ${sql.join(onde, sql` AND `)}
         ORDER BY n.nronf`.execute(db)).rows;
      if (!linhas.length) throw semRegistro();
      return {
        titulo: 'Análise de conferência de notas',
        modelo: await modeloFr3(db, 'Notas_fiscais_analise_conferencia.fr3'),
        datasets: { frxDBConsulta: linhas.map((l) => registroFr3(l, nums)) },
        variaveis: { PERIODO: periodo, EMPRESAS: textoVariavel(`Empresa(s):${empresas.join(',')}`) },
      };
    }

    const notas = (await sql<Record<string, unknown>>`
      SELECT n.nronf, n.codnf, to_char(n.dtemissao, 'YYYY-MM-DD"T"00:00:00') AS dtemissao, coalesce(n.totalprod, 0.01) AS totalprod, n.totalnf,
             p.razao, p.codparceiro, n.cfop, coalesce(n.totalisento, 0) AS totalisento, coalesce(n.totaloutrasdesp, 0) AS totaloutrasdesp
        FROM nf n
        LEFT JOIN parceiros p ON p.codparceiro = n.codparceiro
        LEFT JOIN cfop c      ON c.codcfop = n.cfop
       WHERE ${sql.join(onde, sql` AND `)}
       ORDER BY n.nronf, n.codnf`.execute(db)).rows;
    if (!notas.length) throw semRegistro();
    const idx = new Map(notas.map((n, i) => [Number(n.codnf), i]));
    const codnfs = [...idx.keys()];
    // o custo líquido do item: VRCUSTO menos o desconto (DESCONTO / FATOREMBAL %, arredondado a 2 casas) vezes a quantidade
    const liquido = (a: string) => sql.raw(`((${a}.vrcusto - (${a}.vrcusto * CASE coalesce(${a}.desconto, 0) WHEN 0 THEN 0 ELSE ${a}.desconto / coalesce(${a}.fatorembal, 1) END)::numeric(13,2) / 100) * ${a}.quantidade)`);
    const totalItens = sql`(SELECT coalesce(sum(${liquido('e')}), 0.01)::numeric(15,2) FROM nf_prod e WHERE e.codnf = np.codnf)`;
    const cfop = (await sql<Record<string, unknown>>`
      SELECT np.codnf, coalesce(sum(${liquido('np')}), 0.01)::numeric(15,2) AS valor, np.cfop, c.descricao, ${totalItens} AS total
        FROM nf_prod np
        LEFT JOIN cfop c ON c.codcfop::text = np.cfop::text
       WHERE np.codnf = ANY(${codnfs}::int[])
       GROUP BY np.codnf, np.cfop, c.descricao
       ORDER BY np.codnf, np.cfop`.execute(db)).rows;
    const contabil = (await sql<Record<string, unknown>>`
      SELECT np.codnf, sum(np.valor) AS valor, np.codcontabil, NULL::varchar AS descricao,
             (SELECT coalesce(sum(e.valor), 0.01)::numeric(15,2) FROM nf_contabil e WHERE e.codnf = np.codnf) AS total
        FROM nf_contabil np
       WHERE np.codnf = ANY(${codnfs}::int[])
       GROUP BY np.codnf, np.codcontabil
       ORDER BY np.codnf, np.codcontabil`.execute(db)).rows;
    const icme = (await sql<Record<string, unknown>>`
      SELECT np.codnf, coalesce(sum(${liquido('np')}), 0.01)::numeric(15,2) AS valor, np.icme, ${totalItens} AS total
        FROM nf_prod np
       WHERE np.codnf = ANY(${codnfs}::int[])
       GROUP BY np.codnf, np.icme
       ORDER BY np.codnf, np.icme`.execute(db)).rows;
    const mestre = (r: Record<string, unknown>) => ({ ...registroFr3(r, nums), __MESTRE: idx.get(Number(r.codnf)) });

    // os totalizadores do GeraConsulta (cdsTotalCFOP / cdsTotalCodContabil / cdsTotalICME), na ordem em que aparecem
    const acumular = (rows: Array<Record<string, unknown>>, chave: (r: Record<string, unknown>) => string, campo: string, base: (r: Record<string, unknown>) => Record<string, unknown>) => {
      const m = new Map<string, Record<string, unknown>>();
      for (const r of rows) {
        const k = chave(r);
        const t = m.get(k) ?? { ...base(r), TOTAL: 0 };
        t.TOTAL = Math.round((Number(t.TOTAL) + Number(r[campo] ?? 0)) * 100) / 100;
        m.set(k, t);
      }
      return [...m.values()];
    };
    const datasets: Record<string, Array<Record<string, unknown>>> = {
      frxDBDatasetNF: notas.map((n) => registroFr3(n, nums)),
      frxDBDatasetCFOP: cfop.map(mestre),
      frxDBDatasetCodCOntabil: contabil.map(mestre),
      frxDBDatasetICME: icme.map(mestre),
      frxDBDatasetCFOP_T: acumular(cfop, (r) => String(r.cfop), 'total', (r) => ({ CFOP: r.cfop, DESCRICAO: r.descricao })),
      frxDBDatasetCodCOntabil_T: acumular(contabil, (r) => String(Number(r.codcontabil ?? 0)), 'total', (r) => ({ CONTABIL: Number(r.codcontabil ?? 0), DESCRICAO: r.descricao })),
      frxDBDatasetICME_T: acumular(icme, (r) => String(Number(r.icme ?? 0)), 'valor', (r) => ({ ICME: Number(r.icme ?? 0) })),
    };
    if (modelo === 'TRIBUTARIA_PRODUTOS') {
      const prod = (await sql<Record<string, unknown>>`
        SELECT p.codbarra, p.descricao, i.quantidade * coalesce(i.fatorembal, 1) AS quantidade, i.vrbasecalculo, i.vricm, i.codnf
          FROM nf_prod i
          LEFT JOIN produtos p ON p.idproduto = i.codproduto
         WHERE i.codnf = ANY(${codnfs}::int[])
         ORDER BY i.codnf, i.nroitem NULLS LAST, i.codnfprod`.execute(db)).rows;
      datasets.frxDBDatasetProd = prod.map(mestre);
    }
    const emp = (await sql<Record<string, unknown>>`SELECT idempresa AS codempresa, razao_social AS razaosocial FROM empresas WHERE idempresa = ${this.emp()}`.execute(db)).rows[0] ?? {};
    datasets.frxDBDataset1 = [registroFr3(emp, new Set(['codempresa']))];
    return {
      titulo: modelo === 'TRIBUTARIA_PRODUTOS' ? 'Análise situação tributária por produtos' : 'Análise situação tributária',
      modelo: await modeloFr3(db, modelo === 'TRIBUTARIA_PRODUTOS' ? 'Notas_fiscais_analise_produtos.fr3' : 'Notas_fiscais_analise.fr3'),
      datasets,
      variaveis: { PERIODO: periodo },
    };
  }
}
