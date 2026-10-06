import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { empresaParaRelatorio, registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * ANÁLISE DE ENTRADA × SAÍDA (`FRMANALISEENTRADAXSAIDA`, `uAnaliseEntradaXSaida.pas`).
 * Dossiê: `uAnaliseEntradaXSaida.md`. **68 acessos, 9 operadores.**
 *
 * Por **fornecedor** e produto: quanto entrou pela nota e quanto saiu — e a saída pode vir de **pedidos** ou
 * de **vendas**, escolha do operador (`rgPedVen`). Só quantidade, sem valor: a pergunta aqui é de giro, não
 * de dinheiro.
 *
 * É a terceira tela da família, e cada uma responde a uma pergunta diferente:
 *  · `uRelEntradasSaidas.md` — lista as notas e compara totais;
 *  · `uRelEntSai.md` — por produto, entrada NF × venda, **com valores**;
 *  · esta — por **fornecedor**, e deixa escolher **pedido** em vez de venda.
 *
 * ── ⚠️ Os filtros do legado ANULAM o LEFT JOIN, e o produto some sem aviso ─────────────────────────────
 * O SQL original faz `LEFT JOIN PARCEIROS P`, `LEFT JOIN FAMILIAS_PROD D` (grupo) e `E` (departamento) — e
 * depois filtra no `WHERE`:
 *
 * ```sql
 * AND P.RAZAO LIKE :RAZAO AND D.DESCRICAO LIKE :DESCRICAO AND E.DESCRICAO LIKE :DEPTO
 * ```
 *
 * Com o filtro vazio o parâmetro vira `'%%'` — mas **`NULL LIKE '%%'` é falso**. Então todo produto **sem
 * fornecedor, sem grupo ou sem departamento** desaparece do relatório, mesmo sem filtro nenhum. O `LEFT
 * JOIN` é anulado pelo próprio `WHERE`.
 *
 * Medido na produção em 17/09/2026: **4.502 produtos sem grupo** e **4.520 sem departamento** (de 47.711) —
 * e em agosto/2026 isso derrubaria **652 linhas de venda, 38 produtos, R$ 7.111,31**. Pouco em valor, mas
 * invisível: o operador não tem como saber que sumiu.
 *
 * Aqui o filtro só se aplica **quando preenchido**, e o produto sem cadastro aparece com o rótulo
 * `(SEM FORNECEDOR)`, `(SEM GRUPO)` ou `(SEM DEPARTAMENTO)` — que é o que faz alguém ir arrumar o cadastro.
 *
 * O resto é o `sqqAnalise` (udmAnaliseEntradaXSaida.dfm) como ele é (auditoria de 06/10/2026):
 *  · ENTRADA = Σ NF_PROD.QUANTIDADE das notas de entrada da LOJA DO LOGIN no período da DTCONTABIL — sem filtro de PROC nem de
 *    CANCELADA (a nota cancelada conta; na produção, 1 nota de entrada cancelada em 2025-26);
 *  · SAÍDA = Σ QTDE das VENDAS ou dos PEDIDOS não cancelados da loja no período — o "Pedidos" só os de **TIPO 'P'** (53 de 2.208 linhas
 *    desde 2025; os nulos são antigos, e há 'O' e 'T'); o rádio do legado abre em "Pedidos";
 *  · as famílias pelo CODFAMILIA, sem o tipo; o fornecedor do PRODUTO (não o emitente da nota); o filtro de fornecedor em maiúsculas
 *    (`CharCase`), os de grupo e departamento como digitados (`LIKE`, que diferencia maiúsculas);
 *  · os dois ramos em UNION ALL, ORDER BY departamento, grupo, fornecedor — a impressão lista cada ramo (o produto com entrada e saída
 *    sai em duas linhas no layout com itens); a grade do Apollo soma os dois por produto.
 */
@Injectable()
export class AnaliseEntradaSaidaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** os dois ramos do `sqqAnalise` (entrada pela NF, saída pela venda ou pedido), na ordem do legado */
  private async uniao(db: AnyDB, f: FiltroAnalise): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    if (f.dataIni > f.dataFim) throw new BusinessRuleError('DATA_INICIAL_MAIOR', { dataIni: f.dataIni, dataFim: f.dataFim });
    const origem = f.origemSaida ?? 'PEDIDOS';
    // ⚠️ os filtros só entram QUANDO PREENCHIDOS — senão anulariam o LEFT JOIN (ver o cabeçalho)
    const like = (col: ReturnType<typeof sql>, v?: string | null) => (v && v.trim() ? [sql`${col} LIKE ${`%${v.trim()}%`}`] : []);
    const filtros = sql.join([
      sql`TRUE`,
      ...like(sql`pa.razao`, f.fornecedor ? f.fornecedor.toUpperCase() : f.fornecedor),
      ...like(sql`g.descricao`, f.grupo),
      ...like(sql`d.descricao`, f.departamento),
    ], sql` AND `);
    const saida = origem === 'PEDIDOS' ? sql`pedidos` : sql`vendas`;
    const tipo = origem === 'PEDIDOS' ? sql`AND j.tipo = 'P'` : sql``;
    return (await sql<Record<string, unknown>>`
      SELECT * FROM (
        SELECT p.codfor, coalesce(pa.razao, '(SEM FORNECEDOR)') AS fornecedor, p.codbarra, p.descricao AS produto,
               p.codgrupo, coalesce(g.descricao, '(SEM GRUPO)') AS desc_grupo, sum(np.quantidade) AS qtd_entrada, 0::numeric AS qtd_saida,
               p.coddpto, coalesce(d.descricao, '(SEM DEPARTAMENTO)') AS depto, 0 AS ramo
          FROM nf
          LEFT JOIN nf_prod np      ON np.codnf = nf.codnf
          LEFT JOIN produtos p      ON p.idproduto = np.codproduto
          LEFT JOIN familias_prod g ON g.codfamilia = p.codgrupo
          LEFT JOIN familias_prod d ON d.codfamilia = p.coddpto
          LEFT JOIN parceiros pa    ON pa.codparceiro = p.codfor
         WHERE nf.dtcontabil::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           AND nf.tipo = 'E' AND nf.idempresa = ${emp} AND ${filtros}
         GROUP BY p.codfor, pa.razao, p.codbarra, p.descricao, p.codgrupo, g.descricao, p.coddpto, d.descricao
        UNION ALL
        SELECT p.codfor, coalesce(pa.razao, '(SEM FORNECEDOR)'), p.codbarra, p.descricao, p.codgrupo, coalesce(g.descricao, '(SEM GRUPO)'),
               0, sum(j.qtde), p.coddpto, coalesce(d.descricao, '(SEM DEPARTAMENTO)'), 1
          FROM ${saida} j
          LEFT JOIN produtos p      ON p.idproduto = j.codproduto
          LEFT JOIN familias_prod g ON g.codfamilia = p.codgrupo
          LEFT JOIN familias_prod d ON d.codfamilia = p.coddpto
          LEFT JOIN parceiros pa    ON pa.codparceiro = p.codfor
         WHERE j.dtvenda::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date
           AND j.idempresa = ${emp} AND j.cancelado = 'N' ${tipo} AND ${filtros}
         GROUP BY p.codfor, pa.razao, p.codbarra, p.descricao, p.codgrupo, g.descricao, p.coddpto, d.descricao
      ) u
      ORDER BY u.depto, u.desc_grupo, u.fornecedor, u.produto, u.ramo
      LIMIT 40001`.execute(db)).rows.map((r) => ({ ...r, qtd_entrada: num(r.qtd_entrada), qtd_saida: num(r.qtd_saida) }));
  }

  async gerar(f: FiltroAnalise): Promise<{
    origemSaida: 'VENDAS' | 'PEDIDOS';
    linhas: Array<Record<string, unknown>>;
    totais: { itens: number; entrada: number; saida: number };
  }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const origem = f.origemSaida ?? 'PEDIDOS';
    // a grade: os dois ramos somados por produto
    const m = new Map<string, Record<string, unknown>>();
    for (const r of await this.uniao(db, f)) {
      const k = [r.codfor, r.fornecedor, r.codbarra, r.produto, r.codgrupo, r.desc_grupo, r.coddpto, r.depto].join('|');
      const a = m.get(k) ?? { codfor: r.codfor, fornecedor: r.fornecedor, codbarra: r.codbarra, produto: r.produto, codgrupo: r.codgrupo,
        desc_grupo: r.desc_grupo, coddpto: r.coddpto, depto: r.depto, qtd_entrada: 0, qtd_saida: 0 };
      a.qtd_entrada = num(a.qtd_entrada) + num(r.qtd_entrada);
      a.qtd_saida = num(a.qtd_saida) + num(r.qtd_saida);
      m.set(k, a);
    }
    const linhas: Array<Record<string, unknown>> = [...m.values()].map((l) => ({ ...l, diferenca: num(l.qtd_saida) - num(l.qtd_entrada) }));
    return {
      origemSaida: origem,
      linhas,
      totais: {
        itens: linhas.length,
        entrada: r2(linhas.reduce((s, l) => s + num(l.qtd_entrada), 0)),
        saida: r2(linhas.reduce((s, l) => s + num(l.qtd_saida), 0)),
      },
    };
  }

  /**
   * O "Imprimir" (`btnImprimirClick`): `extr - AnaliseEntradaXSaidaComItens.fr3` (com "Mostrar itens") ou `extr - AnaliseEntradaXSaida.fr3`
   * (só os totais por departamento, grupo e fornecedor) com o `frxDBAnalise` (os dois ramos, como o legado lista) e o `frxDBEmpresa`;
   * variáveis DtIncial (sic), DtFinal e Titulo. Sem dados: "Não existem informações no período informado para impressão. Verifique!".
   */
  async impressao(f: FiltroAnalise & { mostrarItens?: boolean }) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = await this.uniao(db, f);
    if (!rows.length) throw new BusinessRuleError('RELATORIO_SEM_REGISTROS', {}, 'Não existem informações no período informado para impressão. Verifique!');
    const dmy = (d: string) => d.split('-').reverse().join('/');
    return {
      titulo: 'Análise Entradas X Saídas',
      modelo: await modeloFr3(db, f.mostrarItens ? 'extr - AnaliseEntradaXSaidaComItens.fr3' : 'extr - AnaliseEntradaXSaida.fr3'),
      datasets: {
        frxDBAnalise: rows.map(({ ramo: _r, ...r }) => registroFr3(r, new Set(['codfor', 'codgrupo', 'coddpto']))),
        frxDBEmpresa: [await empresaParaRelatorio(db, this.emp())],
      },
      variaveis: { DtIncial: textoVariavel(dmy(f.dataIni)), DtFinal: textoVariavel(dmy(f.dataFim)), Titulo: textoVariavel('Análise Entradas X Saídas') },
    };
  }
}

interface FiltroAnalise {
  dataIni: string; dataFim: string;
  origemSaida?: 'VENDAS' | 'PEDIDOS' | null;
  fornecedor?: string | null; grupo?: string | null; departamento?: string | null;
}
