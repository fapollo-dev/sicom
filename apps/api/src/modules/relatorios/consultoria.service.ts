import { Injectable } from '@nestjs/common';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { empresaParaRelatorio, registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
export type NivelArvore = 'DEPARTAMENTO' | 'GRUPO' | 'SECAO';

/** o nível da árvore de famílias: o campo do produto que aponta para `familias_prod`. */
const CAMPO: Record<NivelArvore, string> = {
  DEPARTAMENTO: 'coddpto',   // tipo 'D' — 34 no cliente
  GRUPO: 'codgrupo',         // tipo 'G' — 92
  SECAO: 'codsubgrupo',      // tipo 'S' — 520
};

export interface LinhaConsultoria {
  nivel: string | null; codnivel: number | null;
  venda: number; custo: number; lucro: number; rentabilidade: number;
  cupons: number; participacao: number;
}

/**
 * CONSULTORIA APOLLO (`FRMCONSULTORIAATM`, `uConsultoriaATM.pas` 1.240 linhas).
 * Dossiê: `uConsultoriaATM.md`. 440 acessos no cliente.
 *
 * ⚠️ **a tela não tem lista fixa de relatórios**: ela varre o diretório e monta o combo com os arquivos
 * `Relatorios\at&m_*.fr3` que encontrar (`:389`). Em produção existem **15 layouts distintos**, e todos giram
 * em torno da mesma coisa — **participação e rentabilidade por nível da árvore de famílias**: participação de
 * setores, de seções, de grupos, ranking por família, rentabilidade da família, faturamento × rentabilidade.
 *
 * Por isso o corte-1 não porta "um relatório": porta **o cálculo**, parametrizado pelo nível
 * (`ParticipacaoSetor`, `:469`). Um só serviço responde departamento, grupo e seção.
 *
 * As contas, uma a uma (`:519-560`):
 *  · **acréscimo** = a parte POSITIVA de `DESC_ACRE_MEDIO` e `DESC_ACRE_ITEM`;
 *  · **desconto** = `DESC_PROMOCAO + DESC_DEPARTAMENTO` mais a parte NEGATIVA daqueles dois, invertida;
 *  · **venda** = `QTDE × VRVENDA`, e aqui mora o detalhe: quando o item é por PESO (`IAT = 'A'`) o valor é
 *    arredondado, senão é **truncado no centavo** (`TRUNC(x * 100) / 100`) — é assim que o PDV fecha;
 *  · **custo** = `QTDE × VRCUSTO`;
 *  · **resultado** = venda + acréscimo − desconto · **lucro** = resultado − custo ·
 *    **rentabilidade** = lucro / custo × 100 (sobre o CUSTO, não sobre a venda);
 *  · **cupons** = `NROPEDIDO` distintos.
 *
 * A participação de cada linha no total é nossa — o legado a calcula no layout, e sem ela a tela chamada
 * "participação de setores" não mostra participação nenhuma.
 *
 * ADIADO (fiel): o modo "Vendas e Notas Fiscais" (`rdgPesquisa = 1`), que faz UNION com `NF_PROD` para somar
 * o que saiu por nota; os gráficos; e a previsão (`PREVISAO`), que é outro epic.
 */
@Injectable()
export class ConsultoriaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async participacao(p: { nivel: NivelArvore; dataIni: string; dataFim: string }): Promise<{
    nivel: NivelArvore; linhas: LinhaConsultoria[];
    totais: { venda: number; custo: number; lucro: number; rentabilidade: number; cupons: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const campo = CAMPO[p.nivel];
    if (!campo) throw new BusinessRuleError('NIVEL_INVALIDO', { nivel: p.nivel });

    const rows = (await sql<Record<string, unknown>>`
      WITH por_cupom AS (
        SELECT f.codfamilia AS codnivel,
               coalesce(f.descricao, 'Sem nome') AS nivel,
               v.nropedido,
               -- acréscimo: só a parte positiva dos dois campos
               sum(greatest(coalesce(v.desc_acre_medio, 0), 0) + greatest(coalesce(v.desc_acre_item, 0), 0)) AS acrescimo,
               -- desconto: promoção + departamento + a parte negativa daqueles dois, invertida
               sum(coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0)
                   + abs(least(coalesce(v.desc_acre_medio, 0), 0)) + abs(least(coalesce(v.desc_acre_item, 0), 0))) AS desconto,
               -- venda: item por PESO ('A') arredonda; os demais TRUNCAM no centavo, como o PDV
               sum(CASE WHEN v.iat = 'A' THEN round((v.qtde * v.vrvenda)::numeric, 2)
                        ELSE trunc((v.qtde * v.vrvenda)::numeric * 100) / 100 END) AS venda,
               sum(round((v.qtde * v.vrcusto)::numeric, 2)) AS custo
          FROM vendas v
          LEFT JOIN produtos p       ON p.idproduto = v.codproduto
          LEFT JOIN familias_prod f  ON f.codfamilia = p.${sql.ref(campo)}
         WHERE v.dtvenda::date BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date
           AND coalesce(v.cancelado, 'N') = 'N'
           AND v.idempresa = ${emp}
         GROUP BY f.codfamilia, f.descricao, v.nropedido
      )
      SELECT nivel, codnivel,
             sum(venda + acrescimo - desconto)::numeric(18,2) AS venda,
             sum(custo)::numeric(18,2) AS custo,
             sum((venda + acrescimo - desconto) - custo)::numeric(18,2) AS lucro,
             (sum((venda + acrescimo - desconto) - custo) / nullif(sum(custo), 0) * 100)::numeric(18,2) AS rentabilidade,
             count(DISTINCT nropedido) AS cupons
        FROM por_cupom
       GROUP BY nivel, codnivel
       ORDER BY 3 DESC
    `.execute(db)).rows;

    const n = (v: unknown) => Number(v ?? 0);
    const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
    const totalVenda = r2(rows.reduce((s, l) => s + n(l.venda), 0));
    const totalCusto = r2(rows.reduce((s, l) => s + n(l.custo), 0));
    const totalLucro = r2(totalVenda - totalCusto);

    return {
      nivel: p.nivel,
      linhas: rows.map((l) => ({
        nivel: l.nivel as string, codnivel: l.codnivel == null ? null : Number(l.codnivel),
        venda: n(l.venda), custo: n(l.custo), lucro: n(l.lucro), rentabilidade: n(l.rentabilidade),
        cupons: Number(l.cupons ?? 0),
        // a participação é nossa: sem ela a tela "participação de setores" não mostra participação.
        participacao: totalVenda === 0 ? 0 : r2((n(l.venda) / totalVenda) * 100),
      })),
      totais: {
        venda: totalVenda, custo: totalCusto, lucro: totalLucro,
        rentabilidade: totalCusto === 0 ? 0 : r2((totalLucro / totalCusto) * 100),
        cupons: rows.reduce((s, l) => s + Number(l.cupons ?? 0), 0),
      },
    };
  }

  // ════ A TELA DO LEGADO (corte 2): o combo dos layouts `at&m_*`, o "Tipo Consulta" e as três rotinas com SQL (uConsultoriaATM.pas) ════

  /**
   * O `CmbRelatorio` (FormCreate :345-402): os arquivos `Relatorios\at&m_*` — aqui os da RELATORIOS —, sem os dois da "rentabilidade da
   * família" (têm tela própria: Vendas › Rentabilidade por categoria — `RemoveRelatorioUsadoEmOutraTela`) e sem o "faturamento x
   * rentabilidade", MORTO com prova: depende da previsão diária digitada no frmPrevisao (tabela PREVISAO), que tem **0 linhas** na
   * produção — o relatório nunca rodou. O rótulo é o do legado: sem "at&m", sem ".fr3", "_" → " ".
   */
  async layouts(): Promise<Array<{ arquivo: string; nome: string }>> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = (await sql<{ nome: string }>`
      SELECT DISTINCT nome_relatorio AS nome FROM relatorios
       WHERE lower(nome_relatorio) LIKE 'at&m\_%' ESCAPE '\' AND coalesce(indr, 'I') <> 'E'`.execute(db)).rows;
    const fora = new Set(['at&m_rentabilidade_da_familia.fr3', 'at&m_rentabilidade_da_familia_simp.fr3', 'at&m_faturamento_x_rentabilidade.fr3']);
    return rows.map((r) => r.nome).filter((n) => !fora.has(n.toLowerCase()))
      // a ordem do diretório do Windows (NTFS compara em maiúsculas: "dos_setores.fr3" vem antes de "dos_setores_analitico")
      .sort((a, b) => (a.toUpperCase() < b.toUpperCase() ? -1 : a.toUpperCase() > b.toUpperCase() ? 1 : 0))
      .map((arquivo) => ({ arquivo, nome: arquivo.replace(/_/g, ' ').replace(/at&m/gi, '').replace(/\.fr3$/i, '').trim() }));
  }

  /**
   * PARTICIPAÇÃO DOS SETORES (`ParticipacaoSetor`, :469-702): por departamento (a DESCRICAO da família do CODDPTO do produto) — venda
   * (o item por peso arredonda, os demais truncam no centavo) + acréscimo − desconto, custo, lucro e cupons; no "Vendas e Notas Fiscais"
   * soma as notas de venda (CFOP 5102/6102/5402/6402/5403/6403/5405/6405, processadas, não canceladas) e o sem departamento vira "Sem
   * nome". Por linha: % do faturamento (RESULTADO1), % do lucro (RESULTADO3), markup (MARGEM = (venda / custo − 1) × 100) e markdown
   * ((venda − custo) / venda × 100), arredondados a 2; e a PERDA do departamento — o custo do scrap do período (o VR_CUSTO do item, ou o
   * custo da loja quando o item não tem), das contas de perda que aparecem no relatório (NAO_MOSTRAR_SCRAP_REL_PARTSET ≠ 'S'), filtrado
   * pelo centro de custo da tela —, e o % de perda geral (PERC_PERDA).
   */
  async participacaoSetores(f: { dataIni: string; dataFim: string; tipo: 0 | 1; empresas?: number[]; plc?: string | null }) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const lojas = await empresasDoOperador(db, f.empresas);
    const d1 = sql`${f.dataIni}::date`;
    const d2 = sql`${f.dataFim}::date`;
    const vendas = sql`
      SELECT dpto,
             CAST(sum(t_total_venda + t_acrescimo - t_desconto) AS numeric(18,2)) AS resultado2,
             CAST(sum(t_total_custo) AS numeric(18,2)) AS total_custo,
             CAST(sum((t_total_venda + t_acrescimo - t_desconto) - t_total_custo) AS numeric(18,2)) AS resultado4,
             count(DISTINCT nropedido) AS qtde_cupom
        FROM (SELECT d.descricao AS dpto,
                     sum(CASE WHEN coalesce(v.desc_acre_medio, 0) > 0 THEN coalesce(v.desc_acre_medio, 0) ELSE 0 END
                         + CASE WHEN coalesce(v.desc_acre_item, 0) > 0 THEN coalesce(v.desc_acre_item, 0) ELSE 0 END) AS t_acrescimo,
                     sum(coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0)
                         + CASE WHEN coalesce(v.desc_acre_medio, 0) < 0 THEN coalesce(v.desc_acre_medio, 0) * -1 ELSE 0 END
                         + CASE WHEN coalesce(v.desc_acre_item, 0) < 0 THEN coalesce(v.desc_acre_item, 0) * -1 ELSE 0 END) AS t_desconto,
                     sum(CASE WHEN v.iat = 'A' THEN CAST(v.qtde * v.vrvenda AS numeric(18,2)) ELSE CAST(trunc((v.qtde * v.vrvenda) * 100) AS numeric(18,2)) / 100 END) AS t_total_venda,
                     sum(CAST(v.qtde * v.vrcusto AS numeric(13,2))) AS t_total_custo,
                     v.nropedido
                FROM vendas v
                LEFT JOIN produtos p ON p.idproduto = v.codproduto
                LEFT JOIN familias_prod d ON p.coddpto = d.codfamilia
               WHERE v.dtvenda::date BETWEEN ${d1} AND ${d2} AND v.cancelado = 'N' AND v.idempresa = ANY(${lojas}::int[])
               GROUP BY d.descricao, v.idempresa, v.nropedido) x
       GROUP BY dpto`;
    const notas = sql`
      SELECT d.descricao AS dpto,
             CAST(sum(total_venda + acrescimo - desc_promocao) AS numeric(18,2)) AS resultado2,
             CAST(sum(total_custo) AS numeric(18,2)) AS total_custo,
             CAST(sum((total_venda + acrescimo - desc_promocao) - total_custo) AS numeric(18,2)) AS resultado4,
             count(DISTINCT codnf) AS qtde_cupom
        FROM (SELECT np.codproduto,
                     sum(CAST(trunc((coalesce(np.quantidade, 0) * CASE WHEN coalesce(np.vrvenda, 0) = 0 THEN coalesce(np.vrcusto, 0) ELSE coalesce(np.vrvenda, 0) END) * 100) AS numeric(18,2)) / 100) AS total_venda,
                     CAST(sum(coalesce(np.quantidade, 0) * coalesce(np.vrcusto, 0)) - sum((coalesce(np.quantidade, 0) * coalesce(np.fatorembal, 1)) * coalesce(np.vl_custo, 0)) AS numeric(18,2)) AS total_custo,
                     CAST(sum(coalesce(np.vrdescprod, 0)) AS numeric(18,2)) AS desc_promocao,
                     CAST(sum(coalesce(np.frete, 0) + coalesce(np.vroutrasdesp, 0) + coalesce(np.depsacess, 0)) AS numeric(18,2)) AS acrescimo,
                     np.codnf
                FROM nf v
                JOIN nf_prod np ON v.codnf = np.codnf
               WHERE v.dtemissao BETWEEN ${d1} AND ${d2} AND v.proc = 'S' AND v.tipo = 'S'
                 AND np.cfop IN ('5405', '6405', '5402', '6402', '5102', '6102', '5403', '6403') AND v.cancelada = 'N'
                 AND v.idempresa = ANY(${lojas}::int[])
               GROUP BY np.codnf, np.codproduto) v
        LEFT JOIN produtos p ON v.codproduto = p.idproduto
        LEFT JOIN familias_prod d ON p.coddpto = d.codfamilia
       GROUP BY d.descricao`;
    const consulta = f.tipo === 1
      ? sql`SELECT coalesce(dpto, 'Sem nome') AS dpto, sum(resultado2) AS resultado2, sum(resultado4) AS resultado4, sum(total_custo) AS total_custo,
                   sum(qtde_cupom) AS qtde_cupom
              FROM (${vendas} UNION ALL ${notas}) u GROUP BY 1 ORDER BY 1`
      : sql`${vendas} ORDER BY dpto`;
    const rows = (await consulta.execute(db)).rows as Array<Record<string, unknown>>;
    if (!rows.length) throw new BusinessRuleError('CONSULTORIA_SEM_VENDAS', {}, 'Não existe vendas no periodo indicado!');
    const n = (v: unknown) => Number(v ?? 0);
    const totalLucro = rows.reduce((s, l) => s + n(l.resultado4), 0);
    const totalFat = rows.reduce((s, l) => s + n(l.resultado2), 0);

    // a perda: o scrap do período por departamento (sqqCodCC → o CODPLC do código extenso da tela)
    let codplc: number | null = null;
    if (f.plc) codplc = ((await sql<{ codplc: number }>`SELECT codplc FROM plc WHERE desccodplc = ${f.plc} LIMIT 1`.execute(db)).rows[0]?.codplc) ?? -1;
    const perdas = (await sql<{ descricao: string | null; custo: unknown }>`
      SELECT f.codfamilia, f.descricao,
             CASE WHEN sum(i.vr_custo) IS NULL THEN CAST(sum(i.qtde * m.vrcusto) AS numeric(13,2)) ELSE CAST(sum(i.qtde * i.vr_custo) AS numeric(13,2)) END AS custo
        FROM scrap s
        LEFT JOIN scrap_item i ON i.codscrap = s.codscrap
        LEFT JOIN produtos p ON p.idproduto = i.idproduto
        LEFT JOIN familias_prod f ON f.codfamilia = p.coddpto
        LEFT JOIN multi_preco m ON m.idproduto = i.idproduto
        JOIN plc ON plc.codplc = s.codplc AND coalesce(plc.nao_mostrar_scrap_rel_partset, 'N') = 'N' AND m.idempresa = s.idempresa
       WHERE s.dt_cadastro::date BETWEEN ${d1} AND ${d2} AND f.tipo = 'D' AND s.idempresa = ANY(${lojas}::int[])
         ${codplc != null ? sql`AND s.codplc IN (${codplc})` : sql``}
       GROUP BY f.codfamilia, f.descricao`.execute(db)).rows;
    const r2a = (x: number) => Math.round((x + (x >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
    const linhas = rows.map((l) => {
      const fat = n(l.resultado2); const custo = n(l.total_custo); const lucro = n(l.resultado4);
      // o Locate('DESCRICAO', DPTO) do legado: a primeira família com a mesma descrição
      const perca = n(perdas.find((p) => p.descricao === l.dpto)?.custo);
      return {
        setores: l.dpto == null ? null : String(l.dpto),
        resultado1: totalFat ? (fat / totalFat) * 100 : 0,
        resultado2: fat,
        resultado3: totalLucro ? (lucro / totalLucro) * 100 : 0,
        resultado4: lucro,
        perca,
        margem: custo > 0 ? r2a(((fat / custo) - 1) * 100) : 0,
        markdown: fat > 0 ? r2a(((fat - custo) / fat) * 100) : 0,
        qtde_cupom: n(l.qtde_cupom),
        total_custo: custo,
      };
    });
    const totalPart = linhas.reduce((s, l) => s + l.resultado2, 0);
    const totalPerda = linhas.reduce((s, l) => s + l.perca, 0);
    return { linhas, percPerda: totalPerda > 0 && totalPart ? (totalPerda / totalPart) * 100 : 0 };
  }

  /**
   * RANKING GERAL POR FAMÍLIAS (`RankingFamilias`, :1006-1238): por seção (a família do CODSUBGRUPO da venda) — quantidade, custo, venda
   * (+ acréscimo − desconto), o markup da loja (MARGSIS, a média), os impostos (ICMS da saída pela alíquota efetiva da UF da empresa − o
   * ICMS da entrada nas tributadas, + ST + PIS/COFINS débito − crédito) e o lucro final; o mesmo período 30 dias antes dá a margem
   * anterior, o lucro e o imposto anteriores. Fornecedor (`edtFornecedor`, maiúsculas, com o filtro do frmFiltro: igual, começa,
   * termina, contém, diferente) e o "Vendas e Notas Fiscais" (as notas de venda, FINALIDADE 1). Ordem: o lucro final, do maior.
   * Diferenças deliberadas, no dossiê: o PESO (lucro final / lucro total) e a PARTICIPAÇÃO (o acumulado / lucro total) valem para toda
   * família — o legado só os preenche quando a família vendeu também no período anterior (estão dentro do `Locate` do anterior) —, e o
   * acumulado segue a ordem do relatório (o legado acumulava na ordem em que o GROUP BY devolvia).
   */
  async rankingFamilias(f: { dataIni: string; dataFim: string; tipo: 0 | 1; empresas?: number[]; fornecedor?: string | null; filtroFornecedor?: 'igual' | 'comeca' | 'termina' | 'contem' | 'diferente' | null }) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const lojas = await empresasDoOperador(db, f.empresas);
    const uf = String(((await sql<{ uf: string | null }>`SELECT uf FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0]?.uf) ?? '');
    const forn = (f.fornecedor ?? '').trim().toUpperCase().replace(/[%=]|<>/g, '');
    const filtroForn = !forn ? sql``
      : f.filtroFornecedor === 'diferente' ? sql`AND upper(fo.razao) <> ${forn}`
      : f.filtroFornecedor === 'comeca' ? sql`AND upper(fo.razao) LIKE ${`${forn}%`}`
      : f.filtroFornecedor === 'termina' ? sql`AND upper(fo.razao) LIKE ${`%${forn}`}`
      : f.filtroFornecedor === 'contem' ? sql`AND upper(fo.razao) LIKE ${`%${forn}%`}`
      : sql`AND upper(fo.razao) = ${forn}`;
    const meio = (base: RawBuilder<unknown>) => sql`
      SELECT CAST(((venda + acrescimo - desc_promocao) * icms) / 100 AS numeric(18,2)) AS icmstotal,
             CAST((custo * icme) / 100 AS numeric(18,2)) AS icmetotal,
             (CAST(((venda + acrescimo - desc_promocao) * icms) / 100 AS numeric(18,2)) - CAST((custo * icme) / 100 AS numeric(18,2)))
               + (CAST(st AS numeric(18,2)) + CAST(piscofins AS numeric(18,2))) AS impostototal,
             v.*
        FROM (${base}) v`;
    const consulta = (ini: RawBuilder<unknown>, fim: RawBuilder<unknown>) => {
      const deVendas = sql`
        SELECT s.codfamilia, s.descricao, m.markup AS margsis, v.qtde AS qtde, CAST(v.qtde * v.vrcusto AS numeric(18,2)) AS custo,
               CASE WHEN v.iat = 'A' THEN CAST(v.qtde * v.vrvenda AS numeric(18,2)) ELSE CAST(trunc((v.qtde * v.vrvenda) * 100) AS numeric(18,2)) / 100 END AS venda,
               (CASE WHEN coalesce(v.desc_acre_medio, 0) > 0 THEN coalesce(v.desc_acre_medio, 0) ELSE 0 END
                + CASE WHEN coalesce(v.desc_acre_item, 0) > 0 THEN coalesce(v.desc_acre_item, 0) ELSE 0 END) AS acrescimo,
               (coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0)
                + CASE WHEN coalesce(v.desc_acre_medio, 0) < 0 THEN coalesce(v.desc_acre_medio, 0) * -1 ELSE 0 END
                + CASE WHEN coalesce(v.desc_acre_item, 0) < 0 THEN coalesce(v.desc_acre_item, 0) * -1 ELSE 0 END) AS desc_promocao,
               CASE WHEN substr(p.aliquota, 1, 1) = 'T' THEN coalesce(m.icme, 0) ELSE 0 END AS icme,
               al.icm_efetivo AS icms,
               v.qtde * coalesce(m.icmst, 0) AS st,
               v.qtde * (coalesce(m.debitopiscofins, 0) - coalesce(m.creditopiscofins, 0)) AS piscofins,
               ((v.qtde * v.vrcusto) * coalesce(m.frete, 0)) / 100 AS frete,
               CAST(((v.qtde * v.vrcusto) * coalesce(m.despacessorio, 0)) / 100 AS numeric(13,2)) AS despacess,
               CAST(((v.qtde * v.vrcusto) * coalesce(m.ipi, 0)) / 100 AS numeric(13,2)) AS ipi
          FROM vendas v
          LEFT JOIN produtos p ON p.idproduto = v.codproduto
          LEFT JOIN parceiros fo ON fo.codparceiro = p.codfor
          LEFT JOIN multi_preco m ON m.idproduto = v.codproduto AND m.idempresa = v.idempresa
          LEFT JOIN familias_prod s ON s.codfamilia = v.codsubgrupo
          LEFT JOIN det_aliquota al ON p.aliquota = al.aliquota AND al.uf = ${uf}
         WHERE v.dtvenda::date BETWEEN ${ini} AND ${fim} AND v.cancelado = 'N' AND v.idempresa = ANY(${lojas}::int[]) ${filtroForn}`;
      const deNotas = sql`
        SELECT s.codfamilia, s.descricao, m.markup AS margsis, np.quantidade AS qtde,
               CAST((coalesce(np.quantidade, 0) * coalesce(np.vrcusto, 0)) - ((coalesce(np.quantidade, 0) * coalesce(np.fatorembal, 1)) * coalesce(np.vl_custo, 0)) AS numeric(18,2)) AS custo,
               CAST(trunc((coalesce(np.quantidade, 0) * CASE WHEN coalesce(np.vrvenda, 0) = 0 THEN coalesce(np.vrcusto, 0) ELSE coalesce(np.vrvenda, 0) END) * 100) AS numeric(18,2)) / 100 AS venda,
               CAST(coalesce(np.frete, 0) + coalesce(np.vroutrasdesp, 0) + coalesce(np.depsacess, 0) AS numeric(18,2)) AS acrescimo,
               CAST(coalesce(np.vrdescprod, 0) AS numeric(18,2)) AS desc_promocao,
               CASE WHEN substr(p.aliquota, 1, 1) = 'T' THEN coalesce(m.icme, 0) ELSE 0 END AS icme,
               al.icm_efetivo AS icms,
               np.quantidade * coalesce(m.icmst, 0) AS st,
               np.quantidade * (coalesce(m.debitopiscofins, 0) - coalesce(m.creditopiscofins, 0)) AS piscofins,
               ((np.quantidade * coalesce(np.vl_custo, np.vrcusto)) * coalesce(m.frete, 0)) / 100 AS frete,
               CAST(((np.quantidade * coalesce(np.vl_custo, np.vrcusto)) * coalesce(m.despacessorio, 0)) / 100 AS numeric(13,2)) AS despacess,
               CAST(((np.quantidade * coalesce(np.vl_custo, np.vrcusto)) * coalesce(m.ipi, 0)) / 100 AS numeric(13,2)) AS ipi
          FROM nf v
          JOIN nf_prod np ON v.codnf = np.codnf
          LEFT JOIN produtos p ON p.idproduto = np.codproduto
          LEFT JOIN parceiros fo ON fo.codparceiro = p.codfor
          LEFT JOIN multi_preco m ON m.idproduto = np.codproduto AND m.idempresa = v.idempresa
          LEFT JOIN familias_prod s ON s.codfamilia = p.codsubgrupo
          LEFT JOIN det_aliquota al ON p.aliquota = al.aliquota AND al.uf = ${uf}
         WHERE v.dtemissao BETWEEN ${ini} AND ${fim} AND v.proc = 'S' AND v.tipo = 'S' AND v.finalidade = 1
           AND np.cfop IN ('5102', '6102', '5402', '6402', '5403', '6403', '5405', '6405') AND v.cancelada = 'N'
           AND v.idempresa = ANY(${lojas}::int[]) ${filtroForn}`;
      return sql`
        SELECT codfamilia, descricao, CAST(avg(margsis) AS numeric(18,2)) AS margsis, CAST(sum(qtde) AS numeric(18,2)) AS qtde,
               CAST(sum(custo) AS numeric(18,2)) AS custo, CAST(sum(venda + acrescimo - desc_promocao) AS numeric(18,2)) AS venda,
               CAST(sum((venda + acrescimo - desc_promocao) - custo) AS numeric(18,2)) AS lucro,
               CAST(sum(impostototal) AS numeric(18,2)) AS impostototal,
               CAST(sum(((venda + acrescimo - desc_promocao) - custo) - impostototal) AS numeric(18,2)) AS lucrototal
          FROM (${meio(deVendas)} ${f.tipo === 1 ? sql`UNION ALL ${meio(deNotas)}` : sql``}) x
         GROUP BY codfamilia, descricao`;
    };
    const atual = (await consulta(sql`${f.dataIni}::date`, sql`${f.dataFim}::date`).execute(db)).rows as Array<Record<string, unknown>>;
    const anterior = (await consulta(sql`${f.dataIni}::date - 30`, sql`${f.dataFim}::date - 30`).execute(db)).rows as Array<Record<string, unknown>>;
    const n = (v: unknown) => Number(v ?? 0);
    const geral = atual.reduce((s, l) => s + n(l.lucrototal), 0);
    const linhas = atual.map((l) => {
      const venda = n(l.venda); const custo = n(l.custo); const imposto = n(l.impostototal);
      const ant = anterior.find((a) => n(a.codfamilia) === n(l.codfamilia) && a.codfamilia != null);
      return {
        familia: l.descricao == null ? null : String(l.descricao),
        margsis: n(l.margsis), qtde: n(l.qtde), vlcusto: custo, vlvenda: venda, vllucro: venda - custo,
        margatual: venda > 0 ? ((venda - custo) / venda) * 100 : 0,
        impost: imposto, lucrofin: (venda - custo) - imposto,
        margante: ant && n(ant.venda) !== 0 ? (n(ant.lucro) / n(ant.venda)) * 100 : 0,
        lucro_ant: ant ? n(ant.lucro) : 0, imposto_ant: ant ? n(ant.impostototal) : 0,
        peso: geral > 0 ? ((n(l.lucro) - imposto) / geral) * 100 : 0,
        acumul: 0, participacao: 0,
      };
    }).sort((a, b) => b.lucrofin - a.lucrofin);
    let acumul = 0;
    for (const l of linhas) { acumul += l.lucrofin; l.acumul = acumul; l.participacao = geral ? (acumul / geral) * 100 : 0; }
    return { linhas, geral };
  }

  /** «Imprimir» (btnImprimirClick :204-269): a rotina do layout escolhido e o layout da RELATORIOS com as variáveis do legado */
  async impressao(f: { arquivo: string; dataIni: string; dataFim: string; tipo: 0 | 1; empresas?: number[]; plc?: string | null; fornecedor?: string | null;
    filtroFornecedor?: 'igual' | 'comeca' | 'termina' | 'contem' | 'diferente' | null }) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const nome = f.arquivo.toLowerCase();
    if (nome.includes('rentabilidade_da_familia_totais')) throw new BusinessRuleError('CONSULTORIA_RELATORIO_INDISPONIVEL', {}, 'Relatório não disponível.');
    const disponiveis = new Set((await this.layouts()).map((l) => l.arquivo.toLowerCase()));
    if (!disponiveis.has(nome)) throw new BusinessRuleError('RELATORIO_MODELO_NAO_ENCONTRADO', { arquivo: f.arquivo }, 'O arquivo do relatório não foi encontrado.');
    let part: Awaited<ReturnType<ConsultoriaService['participacaoSetores']>> | null = null;
    let rank: Awaited<ReturnType<ConsultoriaService['rankingFamilias']>> | null = null;
    // os layouts de participação leem o RxMemoryData4 (o ParticipacaoSetor) — o legado só o recalculava no "participacao dos setores"
    // e os demais imprimiam o que tinha ficado na memória; aqui cada um recalcula (o centro de custo só vale no "participacao dos setores")
    if (nome.includes('participacao')) part = await this.participacaoSetores({ ...f, plc: nome === 'at&m_participacao_dos_setores.fr3' ? f.plc : null });
    else if (nome.includes('ranking_geral_por_familias')) rank = await this.rankingFamilias(f);
    const br = (d: string) => d.split('-').reverse().join('/');
    const menos30 = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - 30); return x.toISOString().slice(0, 10); };
    const virg = (x: number) => x.toFixed(2).replace('.', ',');
    const nums = new Set(['resultado1', 'resultado2', 'resultado3', 'resultado4', 'perca', 'margem', 'markdown', 'qtde_cupom', 'total_custo',
      'margsis', 'qtde', 'vlcusto', 'vlvenda', 'vllucro', 'margatual', 'impost', 'lucrofin', 'margante', 'lucro_ant', 'imposto_ant', 'peso', 'acumul', 'participacao']);
    return {
      titulo: 'Consultoria Apollo',
      modelo: await modeloFr3(db, f.arquivo),
      datasets: {
        frxDBDataset4: (part?.linhas ?? []).map((l) => registroFr3(l as unknown as Record<string, unknown>, nums)),
        frxDBDataset2: (rank?.linhas ?? []).map((l) => registroFr3(l as unknown as Record<string, unknown>, nums)),
        frxDBDataset1: [], frxDBDataset3: [],
        frxDBDatasetEmpresa: [await empresaParaRelatorio(db, emp)],
      },
      variaveis: {
        TOTALLUCRO: textoVariavel(virg(rank?.geral ?? 0)),
        DATAI: textoVariavel(br(f.dataIni)), DATAF: textoVariavel(br(f.dataFim)),
        DATAI_ANT: textoVariavel(br(menos30(f.dataIni))), DATAF_ANT: textoVariavel(br(menos30(f.dataFim))),
        PERIODO: textoVariavel(`Periodo de ${br(f.dataIni)} até ${br(f.dataFim)}`),
        PERC_PERDA: String(part?.percPerda ?? 0),
      },
    };
  }
}
