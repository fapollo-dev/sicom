import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type TipoEntradasSaidas = 'LISTAGEM' | 'COMPARATIVO';

export interface FiltroEntradasSaidas {
  tipo: TipoEntradasSaidas;
  dataIni: string;
  dataFim: string;
  coddpto?: number | null;
  codgrupo?: number | null;
  codsubgrupo?: number | null;
  codfor?: number | null;
  produto?: string | null;
  /** o edtCodProd do legado (o código do produto) */
  codproduto?: number | null;
  /** as lojas do `GetMultiEmpresa` (recortadas às do operador; vazio = a do login) */
  empresas?: number[] | null;
  /** edtHora1/edtHora2 — ver `periodoComparativo` */
  horaIni?: string | null;
  horaFim?: string | null;
}

/** as CFOPs de saída que o comparativo do binário novo conta (a captura do V$SQL) */
const CFOP_SAIDA = ['5102', '5202', '5402', '5403', '5405', '5411', '5927', '6102', '6202', '6402', '6403', '6404', '6405', '6411', '6927'];
/** as CFOPs de entrada que ele NÃO conta (devoluções, transferências de ativo, retornos) */
const CFOP_ENTRADA_FORA = ['2411', '2202', '2204', '1202', '1204', '1411', '2553', '1553', '1209', '1918', '2209', '2918'];

/**
 * ENTRADAS E SAÍDAS (`FRMRELENTRADASSAIDAS`, `uRelEntradasSaidas.pas` 635 linhas + `.dfm` 3.644).
 * Dossiê: `uRelEntradasSaidas.md`. **148 acessos, 20 operadores.**
 *
 * Dois relatórios:
 *  1. **Listagem** — as notas de entrada e de saída do período, item a item;
 *  2. **Comparativo** — por produto e loja, pelo SQL do BINÁRIO NOVO capturado na produção (ver `comparativo`); o que
 *     segue abaixo (desconto, nota não processada) vale para a LISTAGEM, que ainda é a do fonte de 2020.
 *
 * ── ⚠️ O BUG DO DESCONTO, e ele custa 179 mil reais por ano ───────────────────────────────────────────
 * O legado calcula o valor do item como `(QUANTIDADE × VRCUSTO) − NP.DESCONTO` (`aqqRelE`, `.dfm:896`).
 * **`NF_PROD.DESCONTO` é PERCENTUAL, não valor** — e o dado prova de três formas (produção, 14/09/2026):
 *  · o máximo é exatamente **100** e a mediana **13,36**, em 17.014 itens com desconto;
 *  · `QUANTIDADE × VRCUSTO × DESCONTO/100` bate **casa a casa** com `VRDESCPROD`, que é o valor em reais;
 *  · a própria tela de Relatórios de Compras usa a mesma coluna como percentual.
 *
 * Numa nota de 12.874,40 com 24,31% de desconto, o legado subtrai **24,31** em vez de **3.130,40**. Somando
 * só as entradas de 2026 (59.929 itens): o legado devolve **19.389.175,03** onde o certo é **19.210.180,10**
 * — **178.994,93 a mais**. Aqui usamos `VRDESCPROD`, o valor em reais, e a tela avisa que o número vai
 * diferir do sistema antigo.
 *
 * ── ⚠️ A NOTA NÃO PROCESSADA ficava contada duas vezes ────────────────────────────────────────────────
 * O `WHERE` do legado é só `TIPO = 'E' AND DTCONTABIL BETWEEN` — **não filtra `PROC` nem `CANCELADA`**. Só
 * que o próprio comparativo tem a coluna `VABERTO`, que soma exatamente as notas com `PROC = 'N'`: a mesma
 * mercadoria aparecia como **entrada do período** e como **"a entrar"**, e viraria entrada de novo no dia em
 * que a nota fosse processada. Nota não processada **não movimentou estoque**. Aqui o movimento exige
 * `PROC = 'S'` e o "a entrar" continua mostrando o que está a caminho — cada coisa contada uma vez só.
 */
@Injectable()
export class RelEntradasSaidasService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: FiltroEntradasSaidas): Promise<{
    tipo: TipoEntradasSaidas;
    linhas: Array<Record<string, unknown>>;
    totais: { entrada: number; saida: number; diferenca: number; itens: number };
    empresas?: number[];
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    if (f.dataIni > f.dataFim) throw new BusinessRuleError('DATA_INICIAL_MAIOR', { dataIni: f.dataIni, dataFim: f.dataFim });

    const filtrosProduto = [] as ReturnType<typeof sql>[];
    if (f.coddpto) filtrosProduto.push(sql`p.coddpto = ${f.coddpto}`);
    if (f.codgrupo) filtrosProduto.push(sql`p.codgrupo = ${f.codgrupo}`);
    if (f.codsubgrupo) filtrosProduto.push(sql`p.codsubgrupo = ${f.codsubgrupo}`);
    if (f.codfor) filtrosProduto.push(sql`p.codfor = ${f.codfor}`);
    if (f.produto) filtrosProduto.push(sql`(p.descricao ILIKE ${`%${f.produto}%`} OR p.codbarra = ${f.produto})`);
    const prodFiltro = filtrosProduto.length ? sql`AND ${sql.join(filtrosProduto, sql` AND `)}` : sql``;

    // ⚠️ o valor LÍQUIDO do item usa VRDESCPROD (reais), não DESCONTO (percentual) — ver o cabeçalho
    const valorEntrada = sql`((np.quantidade * np.vrcusto) - coalesce(np.vrdescprod, 0))`;

    if (f.tipo === 'LISTAGEM') {
      const linhas = (await sql<Record<string, unknown>>`
        SELECT nf.tipo, nf.codnf, nf.nronf, nf.dtcontabil::date AS dtcontabil,
               g.descricao AS grupo, p.descricao, np.codproduto,
               np.quantidade,
               round((${valorEntrada})::numeric, 2) AS valor,
               -- o que o sistema antigo mostraria: percentual subtraído como se fosse reais
               round(((np.quantidade * np.vrcusto) - coalesce(np.desconto, 0))::numeric, 2) AS valor_legado,
               pa.razao AS parceiro
          FROM nf
          JOIN nf_prod np       ON np.codnf = nf.codnf
          LEFT JOIN produtos p  ON p.idproduto = np.codproduto
          LEFT JOIN familias_prod g ON g.codfamilia = p.codgrupo AND g.tipo = 'G'
          LEFT JOIN parceiros pa ON pa.codparceiro = nf.codparceiro
         WHERE nf.idempresa = ${emp}
           AND nf.tipo IN ('E', 'S')
           AND coalesce(nf.cancelada, 'N') = 'N'
           -- movimento é o que JÁ ENTROU: a não processada aparece no "a entrar" do comparativo
           AND coalesce(nf.proc, 'N') = 'S'
           AND nf.dtcontabil::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           ${prodFiltro}
         ORDER BY nf.tipo, nf.dtcontabil, nf.nronf, p.descricao
         LIMIT 20001
      `.execute(db)).rows;

      const soma = (t: string) => r2(linhas.filter((l) => l.tipo === t).reduce((s, l) => s + num(l.valor), 0));
      const entrada = soma('E');
      const saida = soma('S');
      return { tipo: f.tipo, linhas, totais: { entrada, saida, diferenca: r2(saida - entrada), itens: linhas.length } };
    }

    return this.comparativo(db, emp, f);
  }

  /**
   * ── COMPARATIVO — o SQL que o BINÁRIO NOVO roda, capturado no V$SQL da produção em 06/10/2026 (sql_id 8atxanr5aywa0,
   * `docs/05-migration-engineering/capturas-vsql/entradas-saidas-8atxanr5aywa0.sql`). O fonte de mai/2020 era outro, e o Apollo tinha
   * sido escrito dele (com correções próprias). O que a produção faz:
   *  - TRÊS pernas: NF de SAÍDA (as CFOPs de `CFOP_SAIDA`), NF de ENTRADA (menos as de `CFOP_ENTRADA_FORA`) — ambas processadas e não
   *    canceladas, pela data contábil — e as VENDAS do PDV (não canceladas), que o Apollo não contava;
   *  - quantidade da nota = QUANTIDADE × FATOREMBAL; valor da nota = QUANTIDADE × VRCUSTO (a saída de NF vale pelo CUSTO, e a entrada
   *    não desconta nada — o binário novo tirou a subtração do DESCONTO); o valor da venda segue o IAT;
   *  - por produto e LOJA: as somas, as médias (valor ÷ quantidade, 3 casas), as diferenças, os estoques (loja, depósito, total), o
   *    custo de reposição e o preço atual com markup e margem, a ÚLTIMA NF de entrada processada do produto na loja (número e emissão,
   *    sem limite de período), departamento/grupo/subgrupo/seção, fornecedor e a última data com movimento; ordem LOJA, DESCRIÇÃO.
   *  - os filtros do fonte (`VerificaFiltro`, :483): entradas por N.CODPARCEIRO, saídas e vendas por P.CODFOR; departamento, grupo,
   *    subgrupo e o produto em todas — no lugar onde a captura mostra a cláusula das lojas (antes do `PROC = 'S'`).
   * O "a entrar" (VABERTO) do fonte de 2020 não existe mais no binário novo.
   */
  private async comparativo(db: AnyDB, emp: number, f: FiltroEntradasSaidas) {
    const emps = f.empresas?.length ? await empresasDoOperador(db, f.empresas) : [emp];
    const { ini, fim } = this.periodoComparativo(f);
    const filtro = (forn: 'n.codparceiro' | 'p.codfor', prod: 'np.codproduto' | 'n.codproduto') => {
      const fr: ReturnType<typeof sql>[] = [];
      if (f.codfor) fr.push(sql`AND ${sql.ref(forn)} = ${f.codfor}`);
      if (f.coddpto) fr.push(sql`AND p.coddpto = ${f.coddpto}`);
      if (f.codgrupo) fr.push(sql`AND p.codgrupo = ${f.codgrupo}`);
      if (f.codsubgrupo) fr.push(sql`AND p.codsubgrupo = ${f.codsubgrupo}`);
      if (f.codproduto) fr.push(sql`AND ${sql.ref(prod)} = ${f.codproduto}`);
      fr.push(sql`AND n.idempresa = ANY(${emps})`);
      return sql.join(fr, sql` `);
    };
    const cadastro = sql`mp.ativo AS ativo_venda, mp.ativo_compra, p.codbarra, p.descricao, mp.vrcustorep, mp.vrvenda, p.fatorcx,
           d.descricao AS departamento, g.descricao AS grupo, sg.descricao AS subgrupo, se.descricao AS sessao, p.codfor, par.razao AS descricao_forn`;
    const familias = sql`LEFT JOIN familias_prod d ON d.codfamilia = p.coddpto
           LEFT JOIN familias_prod g ON g.codfamilia = p.codgrupo
           LEFT JOIN familias_prod sg ON sg.codfamilia = p.codsubgrupo
           LEFT JOIN familias_prod se ON se.codfamilia = p.codsecao
           LEFT JOIN parceiros par ON par.codparceiro = p.codfor`;
    const linhas = (await sql<Record<string, unknown>>`
      WITH mov AS (
        SELECT 'SAIDA - NF' AS origem, ${cadastro}, n.dtcontabil::date AS dtvenda, np.codproduto,
               0 AS qtde_entrada, 0 AS valor_entrada, (np.quantidade * np.fatorembal) AS qtde_saida,
               (np.quantidade * coalesce(np.vrcusto, 0)) AS valor_saida, n.idempresa
          FROM nf n
          LEFT JOIN nf_prod np ON np.codnf = n.codnf
          LEFT JOIN produtos p ON p.idproduto = np.codproduto
          LEFT JOIN multi_preco mp ON mp.idproduto = p.idproduto AND mp.idempresa = n.idempresa
          ${familias}
         WHERE n.tipo = 'S' AND n.dtcontabil BETWEEN ${ini}::date AND ${fim}::date
           AND n.cfop = ANY(${CFOP_SAIDA}) AND coalesce(n.cancelada, 'N') = 'N'
           ${filtro('p.codfor', 'np.codproduto')} AND n.proc = 'S'
        UNION ALL
        SELECT 'ENTRADA - NF', ${cadastro}, n.dtcontabil::date, np.codproduto,
               (np.quantidade * np.fatorembal), (np.quantidade * np.vrcusto), 0, 0, n.idempresa
          FROM nf n
          LEFT JOIN nf_prod np ON np.codnf = n.codnf
          LEFT JOIN produtos p ON p.idproduto = np.codproduto
          LEFT JOIN multi_preco mp ON mp.idproduto = p.idproduto AND mp.idempresa = n.idempresa
          ${familias}
         WHERE n.tipo = 'E' AND n.dtcontabil BETWEEN ${ini}::date AND ${fim}::date
           AND coalesce(n.cancelada, 'N') = 'N' AND n.cfop <> ALL(${CFOP_ENTRADA_FORA})
           ${filtro('n.codparceiro', 'np.codproduto')} AND n.proc = 'S'
        UNION ALL
        SELECT 'VENDAS - PDV', ${cadastro}, cast(n.dtvenda AT TIME ZONE 'America/Sao_Paulo' AS date), n.codproduto,
               0, 0, n.qtde,
               CASE WHEN n.iat = 'A' THEN cast(n.qtde * n.vrvenda AS numeric(18,2))
                    ELSE cast(trunc((n.qtde * n.vrvenda) * 100) AS numeric(18,2)) / 100 END,
               n.idempresa
          FROM vendas n
          LEFT JOIN produtos p ON p.idproduto = n.codproduto
          LEFT JOIN multi_preco mp ON mp.idproduto = p.idproduto AND mp.idempresa = n.idempresa
          ${familias}
         WHERE cast(n.dtvenda AT TIME ZONE 'America/Sao_Paulo' AS date) BETWEEN ${ini}::date AND ${fim}::date
           AND coalesce(n.cancelado, 'N') = 'N'
           ${filtro('p.codfor', 'n.codproduto')}
      ),
      curr AS (
        SELECT ativo_venda, ativo_compra, codbarra, dtvenda, codproduto, descricao, idempresa,
               sum(qtde_entrada) AS qtde_entrada, sum(valor_entrada) AS valor_entrada, sum(qtde_saida) AS qtde_saida, sum(valor_saida) AS valor_saida,
               vrcustorep, vrvenda, fatorcx, origem, departamento, grupo, subgrupo, sessao, codfor, descricao_forn
          FROM mov
         GROUP BY ativo_venda, ativo_compra, codbarra, dtvenda, codproduto, descricao, idempresa, vrcustorep, vrvenda, fatorcx, origem,
                  departamento, grupo, subgrupo, sessao, codfor, descricao_forn
      )
      SELECT curr.ativo_venda, curr.ativo_compra, curr.codbarra, max(curr.dtvenda) AS dtvenda, curr.codproduto, curr.descricao,
             sum(curr.qtde_entrada) AS qtde_entrada, cast(sum(curr.valor_entrada) AS numeric(15,3)) AS valor_entrada,
             CASE WHEN sum(curr.valor_entrada) > 0 AND sum(curr.qtde_entrada) > 0
                  THEN cast(sum(curr.valor_entrada) / sum(curr.qtde_entrada) AS numeric(15,3)) ELSE 0 END AS media_custo,
             sum(curr.qtde_saida) AS qtde_saida, sum(curr.valor_saida) AS valor_saida,
             CASE WHEN sum(curr.valor_saida) > 0 AND sum(curr.qtde_saida) > 0
                  THEN cast(sum(curr.valor_saida) / sum(curr.qtde_saida) AS numeric(15,3)) ELSE 0 END AS media_venda,
             cast(sum(curr.qtde_saida - curr.qtde_entrada) AS numeric(15,3)) AS qtde_dif,
             cast(sum(curr.valor_saida - curr.valor_entrada) AS numeric(15,3)) AS valor_dif,
             (SELECT sum(cast(coalesce(e.qtde, 0) AS numeric(15,3))) FROM estoque e WHERE e.idproduto = curr.codproduto AND e.idempresa = curr.idempresa) AS qtde_estoque_loja,
             (SELECT sum(cast(coalesce(ed.qtde, 0) AS numeric(15,3))) FROM estoque_dep ed WHERE ed.idproduto = curr.codproduto AND ed.idempresa = curr.idempresa) AS qtde_estoque_deposito,
             (SELECT sum(cast(coalesce(e.qtde, 0) AS numeric(15,3))) FROM estoque e WHERE e.idproduto = curr.codproduto AND e.idempresa = curr.idempresa)
             + (SELECT sum(cast(coalesce(ed.qtde, 0) AS numeric(15,3))) FROM estoque_dep ed WHERE ed.idproduto = curr.codproduto AND ed.idempresa = curr.idempresa) AS qtde_estoque_total,
             curr.idempresa, em.fantasia, curr.vrcustorep, curr.vrvenda, curr.fatorcx,
             cast(((curr.vrvenda - curr.vrcustorep) / nullif(curr.vrcustorep, 0)) * 100 AS numeric(15,2)) AS markup,
             cast(((curr.vrvenda - curr.vrcustorep) / nullif(curr.vrvenda, 0)) * 100 AS numeric(15,2)) AS margem,
             (SELECT x.nronf FROM nf x WHERE x.codnf = (SELECT max(nf.codnf) FROM nf_prod np JOIN nf ON np.codnf = nf.codnf
                WHERE np.codproduto = curr.codproduto AND nf.idempresa = curr.idempresa AND nf.tipo = 'E' AND nf.proc = 'S')) AS ultima_nf_entrada,
             (SELECT x.dtemissao FROM nf x WHERE x.codnf = (SELECT max(nf.codnf) FROM nf_prod np JOIN nf ON np.codnf = nf.codnf
                WHERE np.codproduto = curr.codproduto AND nf.idempresa = curr.idempresa AND nf.tipo = 'E' AND nf.proc = 'S')) AS data_ultima_nf_entrada,
             curr.departamento, curr.grupo, curr.subgrupo, curr.sessao AS secao, curr.codfor, curr.descricao_forn
        FROM curr
        LEFT JOIN empresas em ON em.idempresa = curr.idempresa
       GROUP BY curr.ativo_venda, curr.ativo_compra, curr.codbarra, curr.codproduto, curr.descricao, curr.idempresa, em.fantasia,
                curr.vrcustorep, curr.vrvenda, curr.fatorcx, curr.departamento, curr.grupo, curr.subgrupo, curr.sessao, curr.codfor, curr.descricao_forn
       ORDER BY curr.idempresa, curr.descricao
       LIMIT 20001
    `.execute(db)).rows;

    const entrada = r2(linhas.reduce((s, l) => s + num(l.valor_entrada), 0));
    const saida = r2(linhas.reduce((s, l) => s + num(l.valor_saida), 0));
    return { tipo: f.tipo, linhas, totais: { entrada, saida, diferenca: r2(saida - entrada), itens: linhas.length }, empresas: emps };
  }

  /**
   * O período do comparativo. O legado passa `D1 = data + edtHora1` e `D2 = data + edtHora2` e compara com `TRUNC(data)`: o dia
   * truncado é meia-noite, então uma hora inicial depois de 00:00 TIRA o primeiro dia inteiro, e a final não tira nada (meia-noite do
   * último dia já está antes de qualquer hora). É o que a consulta da produção faz com os dois campos visíveis da tela.
   */
  private periodoComparativo(f: FiltroEntradasSaidas) {
    const hi = f.horaIni ?? '00:00';
    const ini = hi > '00:00' ? new Date(Date.parse(`${f.dataIni}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : f.dataIni;
    return { ini, fim: f.dataFim };
  }

  /**
   * O Imprimir (`btnImprimirClick`) do comparativo: `Relatorios\Rel_EntradasESaidas_Comparativo.fr3` com o `cdsRelComparativo` no
   * `frxDBDRelComparativo`, e as variáveis DtInicial/DtFinal, Empresas ("(1,2)"), OutrosFiltros (`FiltrosUtilizados`: o nome de cada
   * filtro preenchido, com ';', ou "Sem outros filtros;") e os dois rádios CCusto/CVenda, que o script do layout usa para trocar a coluna
   * de custo (médio × reposição) e a de venda (média × atual). Sem linhas, a mensagem do `GeraConsulta`.
   */
  async impressao(f: FiltroEntradasSaidas, custo: number, venda: number) {
    if (f.tipo !== 'COMPARATIVO') {
      throw new BusinessRuleError('ENTRADAS_SAIDAS_LISTAGEM_SEM_SQL', {},
        'A impressão da listagem aguarda o SQL do sistema atual (o layout do cliente lê campos que o fonte não tem).');
    }
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = await this.gerar(f);
    if (!r.linhas.length) {
      throw new BusinessRuleError('ENTRADAS_SAIDAS_SEM_DADOS', {}, 'Não foram encontrados dados para construir o relatório. Verifique a pesquisa!');
    }
    const nome = async (q: ReturnType<typeof sql>) => {
      const x = (await sql<{ n: string | null }>`${q}`.execute(db)).rows[0];
      return x?.n ?? '';
    };
    const familia = (cod: number) => nome(sql`SELECT descricao AS n FROM familias_prod WHERE codfamilia = ${cod}`);
    let filtros = '';
    if (f.codfor) { const n = await nome(sql`SELECT razao AS n FROM parceiros WHERE codparceiro = ${f.codfor}`); if (n) filtros += `Fornecedor: ${n};`; }
    if (f.coddpto) { const n = await familia(f.coddpto); if (n) filtros += `Depto: ${n};`; }
    if (f.codgrupo) { const n = await familia(f.codgrupo); if (n) filtros += `Grupo: ${n};`; }
    if (f.codsubgrupo) { const n = await familia(f.codsubgrupo); if (n) filtros += `SubGrupo: ${n};`; }
    if (f.codproduto) { const n = await nome(sql`SELECT descricao AS n FROM produtos WHERE idproduto = ${f.codproduto}`); if (n) filtros += `Produto: ${n};`; }
    if (!filtros) filtros = 'Sem outros filtros;';
    const br = (d: string) => d.slice(0, 10).split('-').reverse().join('/');
    const nums = new Set(['qtde_entrada', 'valor_entrada', 'media_custo', 'qtde_saida', 'valor_saida', 'media_venda', 'qtde_dif', 'valor_dif',
      'qtde_estoque_loja', 'qtde_estoque_deposito', 'qtde_estoque_total', 'idempresa', 'vrcustorep', 'vrvenda', 'fatorcx', 'markup', 'margem',
      'codproduto', 'codfor']);
    return {
      titulo: 'Entradas e saídas - comparativo',
      modelo: await modeloFr3(db, 'Rel_EntradasESaidas_Comparativo.fr3'),
      datasets: { frxDBDRelComparativo: r.linhas.map((l) => registroFr3(l, nums)) },
      variaveis: {
        DtInicial: textoVariavel(br(f.dataIni)), DtFinal: textoVariavel(br(f.dataFim)),
        Empresas: textoVariavel(`(${(r.empresas ?? []).join(',')})`), OutrosFiltros: textoVariavel(filtros),
        CCusto: String(custo), CVenda: String(venda),
      },
    };
  }
}
