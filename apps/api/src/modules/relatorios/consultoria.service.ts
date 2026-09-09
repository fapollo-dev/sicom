import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
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
}
