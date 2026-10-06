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

/**
 * FLUXO DE CARTÕES (`FRMFLUXOCARTOES`, `udmFluxoCartoes`). Dossiê: `uFluxoCartoes.md`.
 * **98 acessos, 7 operadores.**
 *
 * Quanto a loja vendeu no cartão, **quanto já caiu na conta e quanto ainda vai cair** — por dia e, quando se
 * abre o dia, por operadora.
 *
 * O SQL do legado agrupa por `TRUNC(DTVENDA), LIBERADO` (uma linha por status), e o `btnPesquisarClick` **soma as linhas do mesmo
 * dia** no `cdsMontaGridFluxoCartao` (`Locate('DTVENDA')`): a grade tem uma linha por dia. As três colunas: TOTALVENDASMES = Σ VALOR
 * de tudo; VENDASNAORECEBIDAS só de `LIBERADO = 'N'`; VENDASRECEBIDAS só de `'S'` — o cartão com LIBERADO nulo (1.969 na produção)
 * entra no total e em nenhuma das duas. As lojas são as do `GetMultiEmpresa`; o dia é o da loja (`TRUNC` no Oracle, que guarda a hora
 * local).
 */
@Injectable()
export class FluxoCartoesService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private async lojas(db: AnyDB, empresas?: number[] | null) {
    return empresas?.length ? empresasDoOperador(db, empresas) : [this.emp()];
  }

  /** o fluxo por DIA no período (o `cdsMontaGridFluxoCartao`). */
  async porDia(f: { dataIni: string; dataFim: string; codoperadora?: number | null; empresas?: number[] | null }): Promise<{
    linhas: Array<Record<string, unknown>>;
    totais: { total: number; recebido: number; aReceber: number; dias: number };
    empresas: number[];
  }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    if (f.dataIni > f.dataFim) throw new BusinessRuleError('DATA_INICIAL_MAIOR', { dataIni: f.dataIni, dataFim: f.dataFim });
    const emps = await this.lojas(db, f.empresas);
    const dia = sql`(c.dtvenda AT TIME ZONE 'America/Sao_Paulo')::date`;

    const onde = [
      sql`c.idempresa = ANY(${emps})`,
      sql`${dia} BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`,
    ];
    if (f.codoperadora) onde.push(sql`c.codoperadora = ${f.codoperadora}`);

    const linhas = (await sql<Record<string, unknown>>`
      SELECT ${dia} AS dtvenda,
             round(sum(c.valor)::numeric, 2) AS total_vendas,
             round(sum(CASE WHEN c.liberado = 'S' THEN c.valor ELSE 0 END)::numeric, 2) AS recebidas,
             round(sum(CASE WHEN c.liberado = 'N' THEN c.valor ELSE 0 END)::numeric, 2) AS nao_recebidas,
             count(*)::int AS lancamentos
        FROM cartao c
       WHERE ${sql.join(onde, sql` AND `)}
       GROUP BY 1
       ORDER BY 1
       LIMIT 5001
    `.execute(db)).rows;

    return {
      linhas,
      totais: {
        total: r2(linhas.reduce((s, l) => s + num(l.total_vendas), 0)),
        recebido: r2(linhas.reduce((s, l) => s + num(l.recebidas), 0)),
        aReceber: r2(linhas.reduce((s, l) => s + num(l.nao_recebidas), 0)),
        dias: linhas.length,
      },
      empresas: emps,
    };
  }

  /** o detalhe de um dia, por OPERADORA (`sqqFluxoCartoesBandeiras` + o `Locate('DTVENDA;OPERADORA')`): agrupado pelo NOME da
   *  operadora, em ordem de nome (`IndexFieldNames := 'OPERADORA'`); sem cadastro, o nome vem vazio. */
  async porOperadora(data: string, empresas?: number[] | null): Promise<Array<Record<string, unknown>>> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const emps = await this.lojas(db, empresas);
    return (await sql<Record<string, unknown>>`
      SELECT (c.dtvenda AT TIME ZONE 'America/Sao_Paulo')::date AS dtvenda, o.operadora,
             round(sum(c.valor)::numeric, 2) AS total_vendas,
             round(sum(CASE WHEN c.liberado = 'S' THEN c.valor ELSE 0 END)::numeric, 2) AS recebidas,
             round(sum(CASE WHEN c.liberado = 'N' THEN c.valor ELSE 0 END)::numeric, 2) AS nao_recebidas,
             count(*)::int AS lancamentos
        FROM cartao c
        LEFT JOIN operadoras o ON o.codoperadoras = c.codoperadora
       WHERE c.idempresa = ANY(${emps}) AND (c.dtvenda AT TIME ZONE 'America/Sao_Paulo')::date = ${data}::date
       GROUP BY 1, o.operadora
       ORDER BY o.operadora NULLS FIRST
    `.execute(db)).rows;
  }

  /**
   * O Imprimir (`btnImprimirClick`): `Relatorios\Rel_Fluxo_Cartoes.fr3` com a grade (`cdsMontaGridFluxoCartao`) no `frxFluxoCartao` e as
   * variáveis DtIncial (sic), DtFinal e Empresa (o texto do `GetMultiEmpresa`, "1,2").
   */
  async impressao(f: { dataIni: string; dataFim: string; codoperadora?: number | null; empresas?: number[] | null }) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = await this.porDia(f);
    if (!r.linhas.length) throw new BusinessRuleError('FLUXO_CARTOES_SEM_DADOS', {}, 'Não existe informações para este período. Verifique!');
    const br = (d: string) => d.slice(0, 10).split('-').reverse().join('/');
    return {
      titulo: 'Fluxo de Cartões',
      modelo: await modeloFr3(db, 'Rel_Fluxo_Cartoes.fr3'),
      datasets: {
        frxFluxoCartao: r.linhas.map((l) => registroFr3({
          dtvenda: l.dtvenda, totalvendasmes: l.total_vendas, vendasnaorecebidas: l.nao_recebidas, vendasrecebidas: l.recebidas,
        }, new Set(['totalvendasmes', 'vendasnaorecebidas', 'vendasrecebidas']))),
      },
      variaveis: { DtIncial: textoVariavel(br(f.dataIni)), DtFinal: textoVariavel(br(f.dataFim)), Empresa: textoVariavel(r.empresas.join(',')) },
    };
  }
}
