import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

export interface FiltroDde {
  /** a janela de venda que dá a média diária. O legado chama de "dias de cálculo da cobertura". */
  dias: number;
  /** só o que tem cobertura até N dias — o filtro de ruptura. */
  coberturaAte?: number | null;
  /** falso = traz também o que NÃO vendeu no período (e por isso não tem cobertura). */
  somenteVendidos?: boolean;
  coddpto?: number | null;
  codgrupo?: number | null;
  codsubgrupo?: number | null;
  codsecao?: number | null;
  produto?: string | null;
}

/**
 * DIAS DE ESTOQUE / COBERTURA (`FRMRELDDE`, `uDDE.pas`). Dossiê: `uRelDDE.md`. **132 acessos.**
 *
 * Responde a pergunta que decide a compra: **"com o que tenho na prateleira, quantos dias eu aguento?"**
 *
 * ```
 * média diária = quantidade vendida na janela ÷ dias da janela
 * cobertura    = estoque ÷ média diária            (em dias, truncado para inteiro)
 * ```
 *
 * A venda vem de `MOVIMENTACAO_DIARIA` — a consolidação por produto e dia, **4.034.759 linhas** na produção,
 * de 2019 a ontem. Somar `vendas` (18,9 milhões) para o mesmo fim custaria uma ordem de grandeza mais; é por
 * isso que o legado mantém essa tabela, e é por isso que ela precisou entrar na carga (mig 220).
 *
 * ── Os três casos da conta (`GetSQLBaseDiasEstoque:19`) ─────────────────────────────────────────────────
 *  · **estoque negativo** ⇒ cobertura **0**. Não dá para cobrir dia nenhum com estoque que já está no
 *    vermelho, e a conta daria um número negativo sem sentido;
 *  · **vendeu no período** ⇒ `estoque ÷ (vendido ÷ dias)`;
 *  · **não vendeu** ⇒ o legado grava **`-999999`**.
 *
 * ⚠️ **`-999999` não é cobertura, é um sentinela** — o jeito do Delphi dizer "não dá para calcular" num campo
 * numérico. Repassar isso para a tela colocaria "-999999 dias" na frente do comprador, e ordenar por
 * cobertura jogaria justamente esses itens para o topo como se fossem os mais urgentes. Aqui o campo vem
 * **nulo**, com `sem_venda = true` ao lado, e a tela escreve "sem venda no período".
 *
 * ⚠️ o estoque é `ESTOQUE + ESTOQUE_DEP` (loja + depósito). Neste cliente o depósito está zerado — soma
 * zero, e fica fiel para quem usar.
 */
@Injectable()
export class RelDdeService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async gerar(f: FiltroDde): Promise<{
    dias: number;
    linhas: Array<Record<string, unknown>>;
    totais: { itens: number; semVenda: number; emRuptura: number; estoqueTotal: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    if (!(f.dias > 0)) throw new BusinessRuleError('DDE_DIAS_INVALIDO', { dias: f.dias });

    const filtros = [] as ReturnType<typeof sql>[];
    if (f.coddpto) filtros.push(sql`p.coddpto = ${f.coddpto}`);
    if (f.codgrupo) filtros.push(sql`p.codgrupo = ${f.codgrupo}`);
    if (f.codsubgrupo) filtros.push(sql`p.codsubgrupo = ${f.codsubgrupo}`);
    if (f.codsecao) filtros.push(sql`p.codsecao = ${f.codsecao}`);
    if (f.produto) filtros.push(sql`(p.descricao ILIKE ${`%${f.produto}%`} OR p.codbarra = ${f.produto})`);
    const prod = filtros.length ? sql`AND ${sql.join(filtros, sql` AND `)}` : sql``;

    const linhas = (await sql<Record<string, unknown>>`
      WITH estoque_prod AS (
        SELECT p.idproduto, p.codbarra, p.descricao, p.coddpto, p.codgrupo, p.codsubgrupo, p.codsecao,
               e.idempresa,
               -- loja + depósito, como o legado soma
               (coalesce(e.qtde, 0) + coalesce(ed.qtde, 0)) AS qtde_estoque
          FROM produtos p
          JOIN estoque e            ON e.idproduto = p.idproduto AND e.idempresa = ${emp}
          LEFT JOIN estoque_dep ed  ON ed.idproduto = p.idproduto AND ed.idempresa = e.idempresa
         WHERE 1 = 1 ${prod}
      ), vendido AS (
        SELECT m.codproduto, sum(m.qtde) AS qtde_vendida
          FROM movimentacao_diaria m
         WHERE m.idempresa = ${emp}
           AND m.data >= current_date - ${f.dias}::int
         GROUP BY m.codproduto
      )
      SELECT ep.idproduto, ep.codbarra, ep.descricao, ep.qtde_estoque,
             coalesce(v.qtde_vendida, 0) AS qtde_vendida,
             -- a média diária: é ela que dá sentido à cobertura
             CASE WHEN coalesce(v.qtde_vendida, 0) > 0
                  THEN round((v.qtde_vendida / ${f.dias}::numeric), 3) END AS media_diaria,
             -- a cobertura em dias, truncada para inteiro como o CAST(... AS NUMBER(20)) do legado
             CASE WHEN ep.qtde_estoque < 0 THEN 0
                  WHEN coalesce(v.qtde_vendida, 0) > 0
                   THEN trunc(ep.qtde_estoque / (v.qtde_vendida / ${f.dias}::numeric))
                  END AS cobertura,
             -- ⚠️ no lugar do sentinela -999999 do legado: um booleano que a tela sabe escrever
             (coalesce(v.qtde_vendida, 0) <= 0) AS sem_venda,
             d.descricao AS departamento, g.descricao AS grupo,
             sg.descricao AS subgrupo, sc.descricao AS secao,
             coalesce(mp.vrcusto, 0) AS vrcusto, coalesce(mp.vrvenda, 0) AS vrvenda,
             round((ep.qtde_estoque * coalesce(mp.vrcusto, 0))::numeric, 2) AS valor_parado
        FROM estoque_prod ep
        LEFT JOIN vendido v        ON v.codproduto = ep.idproduto
        LEFT JOIN multi_preco mp   ON mp.idproduto = ep.idproduto AND mp.idempresa = ep.idempresa
        LEFT JOIN familias_prod d  ON d.codfamilia = ep.coddpto     AND d.tipo = 'D'
        LEFT JOIN familias_prod g  ON g.codfamilia = ep.codgrupo    AND g.tipo = 'G'
        LEFT JOIN familias_prod sg ON sg.codfamilia = ep.codsubgrupo AND sg.tipo = 'S'
        LEFT JOIN familias_prod sc ON sc.codfamilia = ep.codsecao    AND sc.tipo = 'O'
       WHERE 1 = 1
         ${f.somenteVendidos ? sql`AND coalesce(v.qtde_vendida, 0) > 0` : sql``}
         ${f.coberturaAte != null
           ? sql`AND coalesce(v.qtde_vendida, 0) > 0
                 AND trunc(CASE WHEN ep.qtde_estoque < 0 THEN 0
                                ELSE ep.qtde_estoque / (v.qtde_vendida / ${f.dias}::numeric) END) <= ${f.coberturaAte}`
           : sql``}
       ORDER BY (coalesce(v.qtde_vendida, 0) <= 0), 7 NULLS LAST, ep.descricao
       LIMIT 20001
    `.execute(db)).rows;

    return {
      dias: f.dias,
      linhas,
      totais: {
        itens: linhas.length,
        semVenda: linhas.filter((l) => l.sem_venda === true).length,
        // "em ruptura" aqui é o que não cobre nem uma semana — o corte que o comprador olha primeiro
        emRuptura: linhas.filter((l) => l.cobertura != null && num(l.cobertura) <= 7).length,
        estoqueTotal: Math.round(linhas.reduce((s, l) => s + num(l.qtde_estoque), 0) * 1000) / 1000,
      },
    };
  }
}
