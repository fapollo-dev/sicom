import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { runWithTenant } from '../../shared/tenant/tenant-context';
import { FUSO_LOJA } from '../../shared/tempo/hoje';

type AnyDB = any;

/** quantos dias o GIROS refaz (de hoje − DIAS_GIROS até ontem) */
const DIAS_GIROS = 7;
/** a hora da loja a partir da qual o GIROS do dia roda (o do legado começa 05:33) */
const HORA_GIROS = '05:30';

/**
 * AS ROTINAS DO BANCO que o legado roda fora das telas e fora dos jobs (auditoria das procedures, 25/09/2026 —
 * `docs/05-migration-engineering/procedures-do-banco.md`):
 *
 * - `SP_ATUALIZA_DTCONTABIL_NF` (2014): `UPDATE NF SET DTCONTABIL = SYSDATE WHERE PROC = 'N'` — a nota ainda não processada anda com o
 *   dia, e é contabilizada no dia em que é processada. Não está no fonte de 2020 nem nos jobs: quem chama é o binário novo. Produção: as
 *   327 notas não processadas de 25/09/2026 têm DTCONTABIL = o dia; 641 das 653 entradas processadas em set/2026 ficaram com a data do
 *   processamento. Sem ela, a nota digitada num dia e processada noutro entraria no livro, no SPED e na apuração com a data da digitação.
 *
 * - **GIROS** (`GERA_MOVIMENTACAO_DIARIA`): a venda por produto e por dia (MOVIMENTACAO_DIARIA) — o que o DDE, o comparativo de mix ×
 *   giros e a cobertura leem. No legado um executável fora do fonte chama a procedure todo dia de madrugada (PROCESSOS.GIROS 05:33 →
 *   05:40) até o dia anterior; a fórmula reproduz a tabela da produção em 100% das linhas conferidas (mig 378). Roda uma vez por dia, a
 *   partir das 05:30 da loja, e refaz os últimos `DIAS_GIROS` dias: a janela do legado vem de parâmetro do executável (não observável);
 *   7 dias cobrem um servidor parado no fim de semana e corrigem a venda alterada depois (o legado deixa 3 linhas de 17/08/2026 velhas).
 *
 * A cada `APOLLO_AGENDADOR_MS` (padrão 60 s) percorre os tenants; as rotinas são idempotentes (a da nota só mexe na que não está com a
 * data de hoje, no fuso da loja; o GIROS só roda se ainda não rodou hoje). `APOLLO_AGENDADOR=off` desliga (o smoke chama o `ciclo` direto).
 */
@Injectable()
export class RotinasDoBancoAgendador implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('RotinasDoBanco');
  private timer: NodeJS.Timeout | null = null;
  private rodando = false;

  constructor(private readonly dbp: DatabaseProvider) {}

  onApplicationBootstrap(): void {
    if (String(process.env.APOLLO_AGENDADOR ?? '').toLowerCase() === 'off') return;
    const ms = Math.max(5_000, Number(process.env.APOLLO_AGENDADOR_MS ?? 60_000) || 60_000);
    this.timer = setInterval(() => void this.ciclo(), ms);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** um ciclo por tenant; devolve quantas notas cada um teve a data contábil levada ao dia e, se o GIROS rodou, quantas linhas gerou */
  async ciclo(): Promise<Array<{ tenant: string; notas?: number; giros?: number | null; erro?: string }>> {
    if (this.rodando) return [];
    this.rodando = true;
    const out: Array<{ tenant: string; notas?: number; giros?: number | null; erro?: string }> = [];
    try {
      let tenants: string[] = [];
      try {
        tenants = await this.dbp.listarTenants();
      } catch (e) {
        this.log.warn(`não foi possível listar os tenants: ${(e as Error).message}`);
        return out;
      }
      for (const tenant of tenants) {
        try {
          const notas = await runWithTenant({ tenantId: tenant }, () => this.dtcontabilDasNaoProcessadas());
          const giros = await runWithTenant({ tenantId: tenant }, () => this.giros());
          out.push({ tenant, notas, giros });
        } catch (e) {
          this.log.warn(`${tenant}: ${(e as Error).message}`);
          out.push({ tenant, erro: (e as Error).message });
        }
      }
    } finally {
      this.rodando = false;
    }
    return out;
  }

  /** `SP_ATUALIZA_DTCONTABIL_NF`: a nota não processada fica com a data contábil de hoje */
  private async dtcontabilDasNaoProcessadas(): Promise<number> {
    const r = await sql`UPDATE nf SET dtcontabil = (now() AT TIME ZONE 'America/Sao_Paulo')::date
                         WHERE proc = 'N' AND dtcontabil IS DISTINCT FROM (now() AT TIME ZONE 'America/Sao_Paulo')::date`
      .execute(this.dbp.forTenant() as AnyDB);
    return Number(r.numAffectedRows ?? 0);
  }

  /**
   * GIROS — `GERA_MOVIMENTACAO_DIARIA(IDEMPRESAINICIAL, IDEMPRESAFINAL, DTINICIAL, DTFINAL)`: apaga a janela e regrava a soma do dia por
   * produto e loja de (a) VENDAS não canceladas e (b) itens das NF de SAÍDA processadas e não canceladas nas CFOPs de venda
   * (5405, 6405, 5402, 6402, 5102, 6102, 5403, 6403), pela DTEMISSAO. O `UNION` da procedure (não `UNION ALL`) é mantido: se a venda e a
   * nota do mesmo produto no mesmo dia têm a mesma quantidade, uma delas some — é o que a tabela da produção tem.
   * Todas as lojas (o executável do legado passa a faixa de empresas; na produção só a 1 e a 2 têm linhas — as outras não vendem).
   * Sem `forcar`, roda uma vez por dia depois das 05:30 da loja: a linha GIROS de PROCESSOS é a trava (o UPDATE condicional é atômico —
   * duas instâncias do Apollo não rodam juntas). Devolve as linhas gravadas, ou null quando não era hora.
   */
  async giros(opts: { forcar?: boolean } = {}): Promise<number | null> {
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      await sql`INSERT INTO processos (nomeprocesso, status) VALUES ('GIROS', 0) ON CONFLICT (nomeprocesso) DO NOTHING`.execute(trx);
      const pega = await sql`
        UPDATE processos SET status = 1, inicioexecucao = now(), fimexecucao = NULL
         WHERE nomeprocesso = 'GIROS'
           AND (${opts.forcar === true}
                OR (to_char(now() AT TIME ZONE ${FUSO_LOJA}, 'HH24:MI') >= ${HORA_GIROS}
                    AND (inicioexecucao IS NULL OR (inicioexecucao AT TIME ZONE ${FUSO_LOJA})::date < (now() AT TIME ZONE ${FUSO_LOJA})::date)))
         RETURNING nomeprocesso`.execute(trx);
      if (!pega.rows.length) return null;
      const hoje = sql`(now() AT TIME ZONE ${FUSO_LOJA})::date`;
      const ini = sql`(${hoje} - ${DIAS_GIROS}::int)`;
      const fim = sql`(${hoje} - 1)`;
      await sql`DELETE FROM movimentacao_diaria WHERE data BETWEEN ${ini} AND ${fim}`.execute(trx);
      const r = await sql`
        INSERT INTO movimentacao_diaria (idempresa, codproduto, data, qtde)
        SELECT idempresa, codproduto, data, sum(qtde)
          FROM (SELECT v.idempresa, (v.dtvenda AT TIME ZONE ${FUSO_LOJA})::date AS data, v.codproduto, sum(v.qtde) AS qtde
                  FROM vendas v
                 WHERE v.dtvenda >= (${ini}::timestamp AT TIME ZONE ${FUSO_LOJA})        -- o dia da loja, pelo índice de DTVENDA
                   AND v.dtvenda <  ((${fim} + 1)::timestamp AT TIME ZONE ${FUSO_LOJA})
                   AND coalesce(v.cancelado, 'N') = 'N' AND v.codproduto IS NOT NULL
                 GROUP BY 1, 2, 3   -- por posição: o fuso vai como parâmetro e o Postgres não casa $1 do SELECT com $n do GROUP BY
                UNION
                SELECT n.idempresa, n.dtemissao AS data, np.codproduto, sum(np.quantidade) AS qtde
                  FROM nf n
                  JOIN nf_prod np ON np.codnf = n.codnf
                 WHERE n.dtemissao BETWEEN ${ini} AND ${fim}
                   AND n.cancelada = 'N' AND n.proc = 'S' AND n.tipo = 'S'
                   AND n.cfop IN ('5405', '6405', '5402', '6402', '5102', '6102', '5403', '6403')
                 GROUP BY n.idempresa, n.dtemissao, np.codproduto) mov
         GROUP BY idempresa, data, codproduto`.execute(trx);
      await sql`UPDATE processos SET status = 0, fimexecucao = clock_timestamp() WHERE nomeprocesso = 'GIROS'`.execute(trx);
      return Number(r.numAffectedRows ?? 0);
    });
  }
}
