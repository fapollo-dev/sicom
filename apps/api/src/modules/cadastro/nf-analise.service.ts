import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { colunasNumericas, dataBr, registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;

export type ModeloAnalise = 'TRIBUTARIA' | 'TRIBUTARIA_PRODUTOS' | 'CONFERENCIA' | 'PRECIFICACAO' | 'PRECO_FORNECEDOR' | 'PRECO_FORNECEDOR_ITENS';
const PRECOS: ModeloAnalise[] = ['PRECIFICACAO', 'PRECO_FORNECEDOR', 'PRECO_FORNECEDOR_ITENS'];

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
  coddpto?: number | null;
  codbarra?: string | null;
  codgrupo?: number | null;
  codsubgrupo?: number | null;
  cfopPrecificacao?: boolean;
  desconsiderarTransfEntrada?: boolean;
  agrupar?: boolean;
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
    if (PRECOS.includes(modelo)) {
      const linhas = await this.precos(db, modelo, f, await empresasDoOperador(db, f.empresas));
      const num = (v: unknown) => (v == null ? 0 : Number(v));
      const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
      const porNota = new Map(linhas.map((l) => [Number(l.codnf), num(l.totalnf)]));
      return {
        modelo, linhas, truncado: false,
        totais: { notas: porNota.size, totalnf: r2([...porNota.values()].reduce((a, b) => a + b, 0)), totalprod: r2(linhas.reduce((a, l) => a + num(l.totalnf_venda), 0)), totalisento: 0, divergencia: 0 },
      };
    }

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
    if (PRECOS.includes(modelo)) return this.impressaoPrecos(db, modelo, f, empresas);
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

  /** os filtros das análises de precificação (`GeraConsulta`, opções 2, 4 e 5 — alias NF/NP/PR) */
  private async filtrosPreco(db: AnyDB, modelo: ModeloAnalise, f: FiltroAnalise, empresas: number[], comTipoENumero = true) {
    const onde = [sql`nf.idempresa = ANY(${empresas}::int[])`, sql`nf.dtcontabil::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`];
    if (comTipoENumero) {
      if (f.tipo === 'E' || f.tipo === 'S') onde.push(sql`nf.tipo = ${f.tipo}`);
      if (f.nronf) onde.push(sql`nf.nronf LIKE ${`%${f.nronf}%`}`);
    }
    if (f.razao) onde.push(sql`p.razao ILIKE ${`%${f.razao}%`}`);
    else if (f.codparceiro) onde.push(sql`nf.codparceiro = ${f.codparceiro}`);
    if (f.cfop) onde.push(sql`nf.cfop = ${String(f.cfop)}`);
    if (f.processadas === 'S') onde.push(sql`nf.proc = 'S'`);
    if (f.processadas === 'N') onde.push(sql`(nf.proc = 'N' OR nf.proc IS NULL)`);
    if (f.coddpto) onde.push(sql`pr.coddpto = ${f.coddpto}`);
    if (modelo !== 'PRECO_FORNECEDOR') {
      // produto, grupo, subgrupo e o "CFOP Precificação" só nas opções 2 e 5
      if (f.codbarra) onde.push(sql`pr.codbarra = ${f.codbarra}`);
      if (f.codgrupo) onde.push(sql`pr.codgrupo = ${f.codgrupo}`);
      if (f.codsubgrupo) onde.push(sql`pr.codsubgrupo = ${f.codsubgrupo}`);
      if (f.cfopPrecificacao) onde.push(sql`nf.cfop IN ('5405', '6405', '5402', '6402', '5102', '6102', '5403', '6403')`);
    }
    if (!f.incluirDevolucao) onde.push(sql`(coalesce(c.devolucao, 'N') <> 'S')`);
    if (f.movimentaEstoque) onde.push(sql`c.proc_qtde = 'S'`);
    // a 5 tira os CFOPs de transferência de entrada (as situações com TRANSFERENCIA_MERCADORIAS) na empresa com indexador tributário
    if (modelo === 'PRECO_FORNECEDOR_ITENS' && f.desconsiderarTransfEntrada !== false) {
      const fig = (await sql<{ f: string | null }>`SELECT figurafiscal AS f FROM empresas WHERE idempresa = ${this.emp()}`.execute(db)).rows[0]?.f ?? '';
      if (['O', 'S'].includes(String(fig).toUpperCase())) {
        onde.push(sql`nf.cfop::text NOT IN (SELECT DISTINCT i.codcfop::text FROM isituacao_nf i JOIN situacao_nf s ON s.idsituacao_nf = i.idsituacao_nf
                                             WHERE s.transferencia_mercadorias = 'S' AND i.codcfop IS NOT NULL)`);
      }
    }
    return onde;
  }

  /**
   * O `cdsNFpreco` (`sqqNFpreco`, ou o `sqqAgrupado` com "Agrupar"): os itens das notas com o custo de reposição, o preço de venda, os
   * markups, o estoque da loja e o markup fixo do preço; ordenados pelo fornecedor e a nota (opções 2 e 5) ou pela nota (opção 4).
   */
  private async precos(db: AnyDB, modelo: ModeloAnalise, f: FiltroAnalise, empresas: number[]): Promise<Array<Record<string, unknown>>> {
    const onde = sql.join(await this.filtrosPreco(db, modelo, f, empresas), sql` AND `);
    const base = sql`
      SELECT nf.nronf, nf.codnf, nf.dtemissao, nf.dtcontabil, p.razao, np.codproduto, np.descricao, np.ultcusto, pr.codbarra, np.ultvenda,
             np.vrcustorep AS vrcusto, np.quantidade, np.fatorembal, np.vrvenda, np.markup, np.markupl2, e.qtde, nf.totalnf,
             nf.codparceiro AS fornecedor, nf.cfop, nf.idempresa, ((np.quantidade * np.fatorembal) * np.vrvenda) AS totalnf_venda, mp.markupfixo
        FROM nf
        LEFT JOIN nf_prod np     ON np.codnf = nf.codnf
        LEFT JOIN produtos pr    ON pr.idproduto = np.codproduto
        LEFT JOIN parceiros p    ON p.codparceiro = nf.codparceiro
        LEFT JOIN estoque e      ON e.idproduto = np.codproduto AND e.idempresa = nf.idempresa
        LEFT JOIN cfop c         ON c.codcfop = nf.cfop
        LEFT JOIN multi_preco mp ON mp.idproduto = np.codproduto AND mp.idempresa = nf.idempresa
       WHERE ${onde}`;
    const fmt = (col: string) => sql.raw(`to_char(${col}, 'YYYY-MM-DD"T"00:00:00')`);
    const rows = f.agrupar
      ? (await sql<Record<string, unknown>>`
          SELECT nronf, ${fmt('max(dtemissao)')} AS dtemissao, ${fmt('max(dtcontabil)')} AS dtcontabil, razao, codproduto, descricao, ultcusto, codbarra,
                 ultvenda, vrcusto, sum(quantidade) AS quantidade, fatorembal, vrvenda, markup, markupl2, sum(qtde) AS qtde, sum(totalnf) AS totalnf,
                 fornecedor, cfop, idempresa, totalnf_venda, codnf, markupfixo
            FROM (${base}) t
           GROUP BY nronf, razao, codproduto, descricao, ultcusto, ultvenda, vrcusto, fatorembal, vrvenda, markup, markupl2, fornecedor, cfop,
                    idempresa, totalnf_venda, codbarra, codnf, markupfixo
           ORDER BY nronf`.execute(db)).rows
      : (await sql<Record<string, unknown>>`
          SELECT b.*, ${fmt('b.dtemissao')} AS dtemissao, ${fmt('b.dtcontabil')} AS dtcontabil FROM (${base}) b
           ORDER BY ${modelo === 'PRECO_FORNECEDOR' ? sql`b.nronf` : sql`b.fornecedor, b.nronf`}, b.codnf`.execute(db)).rows;
    return rows;
  }

  /**
   * A impressão da precificação: Notas_fiscais_analise_preco.fr3 (2), _preco_fornecedor_itens.fr3 (5) — o frxDBnfPreco — e
   * _preco_fornecedor.fr3 (4): o frxDBFornecedor do `sqqFornecedor` (as notas DISTINTAS do período, pelo fornecedor; sem o tipo e o
   * número da nota, que essa consulta não tem — fiel) com o total de venda (`sqqValor`) e o markup médio dos itens (`sqqMarkup2`); o CFOP
   * do cabeçalho de cada nota é o do registro corrente do frxDBnfPreco (o primeiro — quirk do layout). PERIODO leva o departamento.
   */
  private async impressaoPrecos(db: AnyDB, modelo: ModeloAnalise, f: FiltroAnalise, empresas: number[]) {
    const linhas = await this.precos(db, modelo, f, empresas);
    if (!linhas.length) throw new BusinessRuleError('RELATORIO_SEM_REGISTROS', {}, 'Não foi encontrado registro(s) para essa consulta...tente novamente com um novo filtro!');
    const nums = await colunasNumericas(db, ['nf', 'nf_prod', 'estoque', 'multi_preco'], ['vrcusto', 'fornecedor', 'totalnf_venda', 'quantidade', 'qtde']);
    const depto = f.coddpto
      ? (await sql<{ d: string | null }>`SELECT descricao AS d FROM familias_prod WHERE codfamilia = ${f.coddpto} AND tipo = 'D'`.execute(db)).rows[0]?.d ?? ''
      : '';
    const periodo = `Período de ${dataBr(f.dataIni)} até ${dataBr(f.dataFim)}${modelo === 'PRECIFICACAO' || modelo === 'PRECO_FORNECEDOR' || modelo === 'PRECO_FORNECEDOR_ITENS' ? `   DEPTO: ${depto}` : ''}`;
    const emp = (await sql<Record<string, unknown>>`SELECT idempresa AS codempresa, razao_social AS razaosocial FROM empresas WHERE idempresa = ${this.emp()}`.execute(db)).rows[0] ?? {};
    const datasets: Record<string, Array<Record<string, unknown>>> = {
      frxDBnfPreco: linhas.map((l) => registroFr3(l, nums)),
      frxDBDataset1: [registroFr3(emp, new Set(['codempresa']))],
    };
    if (modelo === 'PRECO_FORNECEDOR') {
      const onde = sql.join(await this.filtrosPreco(db, modelo, f, empresas, false), sql` AND `);
      const forn = (await sql<Record<string, unknown>>`
        SELECT t.*, to_char(t.dtemissao, 'YYYY-MM-DD"T"00:00:00') AS dtemissao, to_char(t.dtcontabil, 'YYYY-MM-DD"T"00:00:00') AS dtcontabil,
               (SELECT sum((i.quantidade * i.fatorembal) * i.vrvenda) FROM nf_prod i WHERE i.codnf = t.codnf) AS totalnf_venda,
               (SELECT avg(i.markupl2)::numeric(18,2) FROM nf_prod i WHERE i.codnf = t.codnf) AS markup_teste
          FROM (SELECT DISTINCT nf.nronf, nf.dtemissao, nf.dtcontabil, p.razao, nf.totalnf, nf.codnf, nf.codparceiro AS fornecedor, nf.cfop, nf.idempresa
                  FROM nf
                  LEFT JOIN nf_prod np  ON np.codnf = nf.codnf
                  LEFT JOIN produtos pr ON pr.idproduto = np.codproduto
                  LEFT JOIN parceiros p ON p.codparceiro = nf.codparceiro
                  LEFT JOIN cfop c      ON c.codcfop = nf.cfop
                 WHERE ${onde}) t
         ORDER BY t.fornecedor, t.nronf`.execute(db)).rows;
      datasets.frxDBFornecedor = forn.map((r) => registroFr3(r, new Set([...nums, 'markup_teste'])));
    }
    const arquivo = modelo === 'PRECIFICACAO' ? 'Notas_fiscais_analise_preco.fr3' : modelo === 'PRECO_FORNECEDOR' ? 'Notas_fiscais_analise_preco_fornecedor.fr3' : 'Notas_fiscais_analise_preco_fornecedor_itens.fr3';
    return {
      titulo: modelo === 'PRECIFICACAO' ? 'Análise de precificação' : modelo === 'PRECO_FORNECEDOR' ? 'Precificação agrupada por fornecedor' : 'Precificação agrupada por fornecedor — itens',
      modelo: await modeloFr3(db, arquivo),
      datasets,
      variaveis: { PERIODO: textoVariavel(periodo) },
    };
  }
}
