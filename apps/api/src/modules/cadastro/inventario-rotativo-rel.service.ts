import { Injectable } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { InvRotRelatorioDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { dataBr, registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
type Frag = RawBuilder<unknown>;
const LOCAL = sql`'America/Sao_Paulo'`;
const juntar = (fs: Frag[]) => (fs.length ? sql.join(fs, sql` `) : sql``);

/**
 * O RELATÓRIO do inventário rotativo — `btnImprimirClick` (o "Imprimir") e o "Grid" (o mesmo dado numa grade), uRelatorioInventarioRotativo.pas:450,
 * com as cinco consultas do DM (`UDMRelatorioInventarioRotativo.dfm`): DETALHADO (todas as operações, `aqqInventario`), RESUMIDO (só a
 * última operação por produto, `aqqInventarioResumo`), NÃO COLETADOS (`aqqProdsInexistentes`), SÓ DEPÓSITO (`aqqColetadosDeposito`) e
 * SÓ ÁREA DE VENDA (`aqqColetadosLoja`). O filtro é o `GetFiltro` (:1112) — operador, fornecedor, departamento, grupo, subgrupo, seção,
 * o lote do status (aberto/fechado), os produtos escolhidos e o tipo de estoque (0 depósito · 1 loja · 2 ambos, o `TTipoEstoque`).
 */
@Injectable()
export class InventarioRotativoRelService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /**
   * A grade de lotes (`radioInventarioClick`): ABERTO = as coletas soltas (lote nulo, uma linha "lote 0") e os lotes com nome sem a linha
   * FECHADO (`sqqInvAberto`); FECHADO = as linhas FECHADO do período, pela data do fechamento (`sqqInvFechado`, D2 = fim + 1).
   */
  async lotes(f: { status: 'ABERTO' | 'FECHADO'; dataini?: string; datafin?: string }) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    if (f.status === 'ABERTO') {
      return { itens: (await sql<Record<string, unknown>>`
        SELECT coalesce(lote, 0) AS lote, nomelote, min((data AT TIME ZONE ${LOCAL})::date) AS abertura, NULL::date AS fechamento, codnf_perdas, codnf_sobras
          FROM inventario_rotativo WHERE idempresa = ${emp} AND lote IS NULL
         GROUP BY lote, nomelote, codnf_perdas, codnf_sobras
        UNION ALL
        SELECT i.lote, i.nomelote, min((i.data AT TIME ZONE ${LOCAL})::date), NULL::date, i.codnf_perdas, i.codnf_sobras
          FROM inventario_rotativo i
         WHERE i.idempresa = ${emp} AND i.lote > 0 AND i.nomelote IS NOT NULL
           AND (SELECT count(*) FROM inventario_rotativo rot WHERE rot.lote = i.lote AND rot.idempresa = i.idempresa AND rot.operacao = 'FECHADO') = 0
           AND i.operacao <> 'FECHADO'
         GROUP BY i.lote, i.nomelote, i.codnf_perdas, i.codnf_sobras`.execute(db)).rows };
    }
    if (!f.dataini || !f.datafin) throw new BusinessRuleError('INV_ROT_PERIODO', {}, 'Informe o período do fechamento.');
    return { itens: (await sql<Record<string, unknown>>`
      SELECT ir.lote, (ir.data AT TIME ZONE ${LOCAL})::date AS fechamento,
             (SELECT min((x.data AT TIME ZONE ${LOCAL})::date) FROM inventario_rotativo x WHERE x.lote = ir.lote) AS abertura,
             ir.nomelote, ir.codnf_perdas, ir.codnf_sobras
        FROM inventario_rotativo ir
       WHERE (ir.data AT TIME ZONE ${LOCAL})::date >= ${f.dataini}::date AND (ir.data AT TIME ZONE ${LOCAL})::date < (${f.datafin}::date + 1)
         AND ir.idempresa = ${emp} AND ir.operacao = 'FECHADO'
       ORDER BY ir.data DESC`.execute(db)).rows };
  }

  /**
   * "Agrupar lotes" só existe no DETALHADO (`AtivarAgruparLotes`, :341): nas outras opções o check fica invisível e MARCADO
   * (`checked := not Visible`) — por isso o resumido fechado sai "Lote: Todos" e o fechado das opções de destino não filtra o lote.
   */
  private agrupar(f: InvRotRelatorioDto): boolean { return f.opcao === 'DETALHADO' ? !!f.agrupar : true; }

  /** o `GetFiltro` (:1112) em partes, porque cada opção monta o seu com elas */
  private partes(f: InvRotRelatorioDto) {
    const base: Frag[] = [];
    if (f.codfor) base.push(sql`AND p.codfor = ${f.codfor}`);
    if (f.coddpto) base.push(sql`AND p.coddpto = ${f.coddpto}`);
    if (f.codgrupo) base.push(sql`AND p.codgrupo = ${f.codgrupo}`);
    if (f.codsubgrupo) base.push(sql`AND p.codsubgrupo = ${f.codsubgrupo}`);
    if (f.codsecao != null) base.push(sql`AND p.codsecao = ${f.codsecao}`);
    const operador: Frag[] = f.codoperador != null ? [sql`AND i.operador = ${f.codoperador}`] : [];
    const status: Frag[] = [];
    if (f.opcao !== 'NAO_COLETADOS') {
      if (f.status === 'ABERTO') {
        status.push(f.lote === 0 ? sql`AND (coalesce(i.lote, 0) = 0 OR i.lote IS NULL)` : sql`AND i.lote = ${f.lote}`);
      } else {
        // o legado avisa e segue com o filtro VAZIO (o `Exit` do GetFiltro devolve ''): imprimiria a empresa inteira — aqui para no aviso
        if (f.lote === 0) throw new BusinessRuleError('INV_ROT_SEM_LOTE', {}, 'Selecione um LOTE para gerar relatório de Inventário Fechado !');
        if (f.opcao === 'RESUMIDO') status.push(sql`AND i.lote IN (${sql.join(f.lotes ?? [])})`);
        if (!this.agrupar(f) && f.opcao !== 'RESUMIDO') status.push(sql`AND i.lote = ${f.lote}`);
      }
    }
    const prodsI: Frag[] = f.produtos?.length ? [sql`AND i.idproduto IN (${sql.join(f.produtos)})`] : [];
    const prodsP: Frag[] = f.produtos?.length ? [sql`AND p.idproduto IN (${sql.join(f.produtos)})`] : [];
    const destino: Frag[] = [];
    if (f.opcao === 'DETALHADO' || f.opcao === 'RESUMIDO') {
      if (f.tipoEstoque === 0) destino.push(sql`AND i.destino = 'DEPOSITO'`);
      if (f.tipoEstoque === 1) destino.push(sql`AND i.destino = 'LOJA'`);
      if (f.tipoEstoque === 2) destino.push(sql`AND i.destino IN ('LOJA','DEPOSITO')`);
    }
    // a ordem do GetFiltro: operador, fornecedor…seção, status/lote, produtos, destino
    return { base, operador, status, prodsI, prodsP, destino, filtro: [...operador, ...base, ...status, ...prodsI, ...destino] };
  }

  async consultar(f0: InvRotRelatorioDto): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    // o login digitado vira o CODOPERADOR (`edtLoginExit`): "Operador não encontrado"
    let f = f0;
    if (f0.login?.trim()) {
      const op = (await sql<{ codoperador: number }>`SELECT codoperador FROM operadores WHERE login = ${f0.login.trim()}`.execute(db)).rows[0];
      if (!op) throw new BusinessRuleError('INV_ROT_OPERADOR', {}, 'Operador não encontrado');
      f = { ...f0, codoperador: Number(op.codoperador) };
    }
    if (f.opcao === 'RESUMIDO' && f.status === 'FECHADO' && !(f.lotes ?? []).length)
      throw new BusinessRuleError('INV_ROT_SEM_LOTE', {}, 'Selecione uma opção de lote !');
    const { base, prodsP, filtro } = this.partes(f);
    const familias = sql`LEFT JOIN familias_prod d ON d.codfamilia = p.coddpto
      LEFT JOIN familias_prod g ON g.codfamilia = p.codgrupo
      LEFT JOIN familias_prod sg ON sg.codfamilia = p.codsubgrupo`;

    if (f.opcao === 'DETALHADO') {
      const data = this.agrupar(f) ? sql`AND (i.data AT TIME ZONE ${LOCAL})::date BETWEEN ${f.dataini}::date AND ${f.datafin}::date` : sql``;
      return (await sql<Record<string, unknown>>`
        SELECT i.lote, i.idempresa, i.codinv_rotativo, i.idproduto, i.qtd_anterior, i.qtd_atual,
               CASE WHEN coalesce(i.qtd_coletada, 0) <> 0 THEN i.qtd_coletada WHEN i.operacao = 'SUBSTITUIR' THEN i.qtd_atual
                    ELSE i.qtd_atual - i.qtd_anterior END AS qtd_coletada,
               i.qtd_atual - i.qtd_anterior AS diferenca_qtd, (i.qtd_atual - i.qtd_anterior) * m.vrcusto AS diferenca_valor,
               b.qtde AS estoque, ed.qtde AS estoque_dep, i.data, i.destino, i.operador, i.operacao, m.vrcusto, p.codbarra, p.descricao,
               d.descricao AS depto, g.descricao AS grupo, sg.descricao AS subgrupo, p.coddpto, p.codgrupo, p.codsubgrupo, p.ativo, p.ativo_compra
          FROM inventario_rotativo i
          LEFT JOIN multi_preco m ON m.idproduto = i.idproduto AND m.idempresa = i.idempresa
          LEFT JOIN produtos p ON p.idproduto = i.idproduto
          LEFT JOIN estoque b ON b.idproduto = i.idproduto AND b.idempresa = i.idempresa
          LEFT JOIN estoque_dep ed ON ed.idproduto = i.idproduto AND ed.idempresa = i.idempresa
          ${familias}
         WHERE i.idempresa = ${emp} ${data} ${juntar(filtro)}
         ORDER BY i.codinv_rotativo`.execute(db)).rows;
    }

    if (f.opcao === 'RESUMIDO') {
      // o /*FILTRO_LOTE*/ (em todas as ocorrências): lote 0 = as soltas; aberto = o lote; fechado = os lotes marcados
      const fl = (a: string) => f.lote === 0 ? sql`AND coalesce(${sql.ref(`${a}.lote`)}, 0) = 0`
        : f.status === 'ABERTO' ? sql`AND ${sql.ref(`${a}.lote`)} = ${f.lote}` : sql`AND ${sql.ref(`${a}.lote`)} IN (${sql.join(f.lotes ?? [])})`;
      return (await sql<Record<string, unknown>>`
        SELECT t.idempresa, t.idproduto, p.codbarra, p.descricao, t.lote,
               sum(t.qtd_anterior) AS qtd_anterior, sum(t.qtd_coletada) AS qtd_coletada, sum(t.qtd_coletada - t.qtd_anterior) AS diferenca_qtd,
               sum((t.qtd_coletada - t.qtd_anterior) * m.vrcusto) AS diferenca_valor, sum(i.qtd_atual) AS qtd_atual, i.codinv_rotativo,
               sum(b.qtde) AS estoque, sum(de.qtde) AS estoque_dep, i.destino, i.operador, i.operacao, sum(m.vrcusto) AS vrcusto,
               d.descricao AS depto, g.descricao AS grupo, sg.descricao AS subgrupo, p.coddpto, p.codgrupo, p.codsubgrupo, p.ativo, p.ativo_compra, i.data
          FROM (SELECT i.*,
                       (SELECT sum(x.qtd_coletada) FROM inventario_rotativo x
                         WHERE x.idproduto = i.idproduto AND x.codinv_rotativo >= col.col_codinv_rotativo AND x.idempresa = ${emp} ${fl('x')}) AS qtd_coletada,
                       (SELECT y.qtd_anterior FROM inventario_rotativo y WHERE y.codinv_rotativo = ant.ant_codinv_rotativo) AS qtd_anterior
                  FROM (SELECT i.idempresa, i.idproduto, min(i.codinv_rotativo) AS codinv_rotativo_ini, max(i.codinv_rotativo) AS codinv_rotativo_fin, i.lote
                          FROM inventario_rotativo i
                         WHERE i.idempresa = ${emp} ${fl('i')} AND i.operacao <> 'FECHADO'
                         GROUP BY i.lote, i.idproduto, i.idempresa) i
                  LEFT JOIN (SELECT coalesce(lote, 0) AS lote, idproduto, idempresa, max(codinv_rotativo) AS col_codinv_rotativo
                               FROM inventario_rotativo WHERE operacao = 'SUBSTITUIR' AND idempresa = ${emp}
                              GROUP BY lote, idproduto, idempresa) col
                         ON coalesce(col.lote, 0) = coalesce(i.lote, 0) AND col.idproduto = i.idproduto AND col.idempresa = i.idempresa
                  LEFT JOIN (SELECT coalesce(lote, 0) AS lote, idproduto, idempresa, min(codinv_rotativo) AS ant_codinv_rotativo
                               FROM inventario_rotativo WHERE operacao = 'SUBSTITUIR' AND idempresa = ${emp}
                              GROUP BY lote, idproduto, idempresa) ant
                         ON coalesce(ant.lote, 0) = coalesce(i.lote, 0) AND ant.idproduto = i.idproduto AND ant.idempresa = i.idempresa) t
          JOIN inventario_rotativo i ON t.codinv_rotativo_fin = i.codinv_rotativo
          LEFT JOIN produtos p ON p.idproduto = t.idproduto
          LEFT JOIN multi_preco m ON m.idproduto = t.idproduto AND m.idempresa = t.idempresa
          LEFT JOIN estoque b ON b.idproduto = t.idproduto AND b.idempresa = t.idempresa
          LEFT JOIN estoque_dep de ON de.idproduto = t.idproduto AND de.idempresa = t.idempresa
          ${familias}
         WHERE 1 = 1 ${juntar(filtro)}
         GROUP BY t.lote, t.idproduto, t.idempresa, t.qtd_coletada, t.qtd_anterior, i.qtd_atual, i.codinv_rotativo, b.qtde, de.qtde,
                  i.data, i.destino, i.operador, i.operacao, m.vrcusto, p.codbarra, p.descricao, d.descricao, g.descricao, sg.descricao,
                  p.coddpto, p.codgrupo, p.codsubgrupo, p.ativo, p.ativo_compra
         ORDER BY t.lote, p.descricao`.execute(db)).rows;
    }

    if (f.opcao === 'NAO_COLETADOS') {
      const lote = f.lote === 0 ? sql`AND i.idempresa = i.idempresa AND (coalesce(i.lote, 0) = 0 OR i.lote IS NULL)` : sql`AND i.lote = ${f.lote}`;
      const tipoEst = f.tipoEstoque === 1 ? sql`AND i.destino = 'LOJA'` : f.tipoEstoque === 0 ? sql`AND i.destino = 'DEPOSITO'` : sql`AND i.destino IN ('LOJA','DEPOSITO')`;
      // o filtro de fora não tem o operador (a tabela da coleta não está lá) e os produtos escolhidos viram P.IDPRODUTO
      const fora = [...base, ...prodsP];
      // os departamentos das coletas do lote (sem nenhum: "Nenhuma coleta foi encontrada.")
      const dptos = (await sql<{ coddpto: number | null }>`
        SELECT DISTINCT p.coddpto FROM inventario_rotativo i JOIN produtos p ON p.idproduto = i.idproduto
         WHERE i.idempresa = ${emp} ${lote} ${juntar(fora)} ${tipoEst}`.execute(db)).rows;
      if (!dptos.length) throw new BusinessRuleError('INV_ROT_SEM_COLETA', {}, 'Nenhuma coleta foi encontrada.');
      const ds = dptos.map((d) => d.coddpto).filter((x): x is number => x != null);
      const porDpto = sql`AND (${ds.length ? sql.join(ds.map((c) => sql`p.coddpto = ${c}`), sql` OR `) : sql`1 = 2`} OR 1 = 2)`;
      return (await sql<Record<string, unknown>>`
        SELECT nf.dtultimacompra, p.*, 'N'::varchar(1) AS sel FROM (
          SELECT 0 AS idempresa, p.codbarra, p.descricao, 0 AS qtd_anterior, 0 AS qtd_coletada, 0 AS qtd_atual, b.qtde AS estoque, de.qtde AS estoque_dep,
                 0 AS diferenca_qtd, p.idproduto, m.vrcusto, 0 AS diferenca_valor, '' AS operacao, d.descricao AS depto, g.descricao AS grupo,
                 sg.descricao AS subgrupo, now() AS data, '' AS destino, 0 AS operador, 0 AS codinvrotativo, p.coddpto, p.codgrupo, p.codsubgrupo,
                 p.ativo, p.ativo_compra, coalesce((p.ultimavenda AT TIME ZONE ${LOCAL})::date, DATE '0001-01-01') AS dtultimavenda
            FROM produtos p
            ${familias}
            LEFT JOIN estoque b ON b.idproduto = p.idproduto AND b.idempresa = ${emp}
            LEFT JOIN estoque_dep de ON de.idproduto = p.idproduto AND de.idempresa = ${emp}
            LEFT JOIN multi_preco m ON m.idproduto = p.idproduto AND m.idempresa = ${emp}
           WHERE coalesce(m.ativo, 'S') = 'S' AND coalesce(m.ativo_compra, 'S') = 'S'
             AND p.idproduto NOT IN (SELECT i.idproduto FROM inventario_rotativo i JOIN produtos p2 ON p2.idproduto = i.idproduto
                                      WHERE i.idempresa = ${emp} ${lote} ${juntar(filtro)} ${tipoEst})
             ${juntar(fora)} ${porDpto}
        ) p
        LEFT JOIN (SELECT max(nf.dtcontabil) AS dtultimacompra, np.codproduto FROM nf LEFT JOIN nf_prod np ON nf.codnf = np.codnf
                    WHERE nf.tipo = 'E' AND nf.proc = 'S' AND nf.idempresa = ${emp} GROUP BY np.codproduto) nf ON nf.codproduto = p.idproduto
        ORDER BY p.descricao`.execute(db)).rows;
    }

    // SÓ DEPÓSITO / SÓ ÁREA DE VENDA: os coletados num destino e não no outro
    const loja = f.opcao === 'AREA_VENDA';
    const fl = (a: string) => f.lote === 0
      ? sql`${sql.ref(`${a}.idempresa`)} = i.idempresa AND (coalesce(${sql.ref(`${a}.lote`)}, 0) = 0 OR ${sql.ref(`${a}.lote`)} IS NULL)`
      : sql`${sql.ref(`${a}.lote`)} = ${f.lote}`;
    const destino = loja ? 'LOJA' : 'DEPOSITO';
    const outro = loja ? 'DEPOSITO' : 'LOJA';
    return (await sql<Record<string, unknown>>`
      SELECT * FROM (
        SELECT t.*, (t.qtd_coletada - t.qtd_anterior) AS diferenca_qtd, (t.qtd_coletada - t.qtd_anterior) * m.vrcusto AS diferenca_valor,
               i.qtd_atual, i.codinv_rotativo, b.qtde AS estoque, ${loja ? sql`e.qtde AS estoque_dep,` : sql``}
               i.data, i.destino, i.operador, i.operacao, m.vrcusto, p.codbarra, p.descricao,
               d.descricao AS depto, g.descricao AS grupo, sg.descricao AS subgrupo, p.coddpto, p.codgrupo, p.codsubgrupo, p.ativo, p.ativo_compra
          FROM (SELECT i.idempresa, ${loja ? sql`i.lote,` : sql``} i.idproduto, min(i.codinv_rotativo) AS codinv_rotativo_ini, max(i.codinv_rotativo) AS codinv_rotativo_fin,
                       coalesce((SELECT sum(x.qtd_coletada) FROM inventario_rotativo x
                                  WHERE x.idproduto = i.idproduto
                                    AND x.codinv_rotativo >= (SELECT max(z.codinv_rotativo) FROM inventario_rotativo z
                                                               WHERE z.idproduto = i.idproduto AND z.operacao = 'SUBSTITUIR' AND ${fl('z')})
                                    AND ${fl('x')}), 0) AS qtd_coletada,
                       (SELECT y.qtd_anterior FROM inventario_rotativo y
                         WHERE y.codinv_rotativo = (SELECT min(w.codinv_rotativo) FROM inventario_rotativo w
                                                     WHERE w.idproduto = i.idproduto AND w.operacao = 'SUBSTITUIR' AND ${fl('w')})) AS qtd_anterior
                  FROM inventario_rotativo i
                 WHERE ${fl('i')} AND i.idempresa = ${emp} AND i.operacao <> 'FECHADO'
                 GROUP BY i.idempresa, ${loja ? sql`i.lote,` : sql``} i.idproduto) t
          JOIN inventario_rotativo i ON t.codinv_rotativo_fin = i.codinv_rotativo
          LEFT JOIN produtos p ON p.idproduto = t.idproduto
          LEFT JOIN multi_preco m ON m.idproduto = t.idproduto AND m.idempresa = t.idempresa
          LEFT JOIN estoque b ON b.idproduto = t.idproduto AND b.idempresa = t.idempresa
          ${loja ? sql`LEFT JOIN estoque_dep e ON e.idproduto = t.idproduto AND e.idempresa = t.idempresa` : sql``}
          ${familias}
         WHERE 1 = 1 ${juntar(filtro)}
      ) r
      WHERE r.idproduto NOT IN (SELECT i.idproduto FROM inventario_rotativo i LEFT JOIN produtos p ON p.idproduto = i.idproduto
                                 WHERE 1 = 1 ${juntar(filtro)} AND i.destino = ${outro})
        AND r.destino = ${destino}
      ORDER BY r.descricao`.execute(db)).rows;
  }

  /**
   * O livro impresso: `InvRotDetalhado.fr3` (frxDBDataset1), `InvRotResumido.fr3` (frxDBDataset2 — o resumido e as duas opções de
   * destino) e `InvRotProdutos.fr3` (frxDBDataset1 — os não coletados). O grupo por lote (GHLote/GFLote) só aparece, recolhível, com
   * "Agrupar lotes" no detalhado e no resumido; TITULO (`GetTituloRelatorio`), LOJA = a razão da empresa, PERIODO = 'ini  à  fim'.
   */
  async impressao(f: InvRotRelatorioDto) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const linhas = await this.consultar(f);
    const arquivo = f.opcao === 'DETALHADO' ? 'InvRotDetalhado.fr3' : f.opcao === 'NAO_COLETADOS' ? 'InvRotProdutos.fr3' : 'InvRotResumido.fr3';
    const ds = f.opcao === 'DETALHADO' || f.opcao === 'NAO_COLETADOS' ? 'frxDBDataset1' : 'frxDBDataset2';
    let modelo = await modeloFr3(db, arquivo);
    if (f.opcao === 'DETALHADO' || f.opcao === 'RESUMIDO') {
      const v = this.agrupar(f) ? 'True' : 'False';
      const marca = (xml: string, nome: string, attrs: Record<string, string>) => xml.replace(new RegExp(`<(TfrxGroup(?:Header|Footer)) Name="${nome}"([^>]*)>`), (_m, tag: string, resto: string) => {
        let r = resto;
        for (const [k, val] of Object.entries(attrs)) r = new RegExp(` ${k}="[^"]*"`).test(r) ? r.replace(new RegExp(` ${k}="[^"]*"`), ` ${k}="${val}"`) : `${r} ${k}="${val}"`;
        return `<${tag} Name="${nome}"${r}>`;
      });
      modelo = marca(marca(modelo, 'GHLote', { Visible: v, DrillDown: v }), 'GFLote', { Visible: v });
    }
    const lote = f.lote === 0 ? '0' : String(f.lote);
    const titulo = f.opcao === 'DETALHADO'
      ? (f.status === 'ABERTO' ? 'Relatório Inventário Rotativo - Detalhado' : `Relatório Inventário Rotativo - Detalhado${this.agrupar(f) ? ' -Lote : TODOS ' : ` - Lote: ${lote}`}`)
      : f.opcao === 'RESUMIDO'
        ? (f.status === 'ABERTO' ? 'Relatório Inventário Rotativo - Resumido' : `Relatório Inventário Rotativo - Resumido - Lote: ${this.agrupar(f) ? 'Todos' : lote}`)
        : f.opcao === 'NAO_COLETADOS' ? 'Produtos inexistentes na coleta'
          : f.opcao === 'DEPOSITO' ? 'Produtos existentes somente no Depósito' : 'Produtos existentes somente na Loja';
    const razao = (await sql<{ razao_social: string | null }>`SELECT razao_social FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0]?.razao_social ?? '';
    const nums = new Set(['lote', 'idempresa', 'codinv_rotativo', 'idproduto', 'qtd_anterior', 'qtd_atual', 'qtd_coletada', 'diferenca_qtd', 'diferenca_valor',
      'estoque', 'estoque_dep', 'operador', 'vrcusto', 'coddpto', 'codgrupo', 'codsubgrupo', 'codinvrotativo', 'codinv_rotativo_ini', 'codinv_rotativo_fin']);
    return {
      titulo,
      modelo,
      datasets: { [ds]: linhas.map((l) => registroFr3(l, nums)) },
      variaveis: {
        TITULO: textoVariavel(titulo), LOJA: textoVariavel(razao),
        PERIODO: textoVariavel(`${f.dataini ? dataBr(f.dataini) : '  /  /    '}  à  ${f.datafin ? dataBr(f.datafin) : '  /  /    '}`),
      },
    };
  }
}
