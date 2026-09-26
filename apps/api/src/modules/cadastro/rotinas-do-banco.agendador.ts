import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { runWithTenant } from '../../shared/tenant/tenant-context';

type AnyDB = any;

/**
 * AS ROTINAS DO BANCO que o legado roda fora das telas e fora dos jobs (auditoria das procedures, 25/09/2026 —
 * `docs/05-migration-engineering/procedures-do-banco.md`):
 *
 * - `SP_ATUALIZA_DTCONTABIL_NF` (2014): `UPDATE NF SET DTCONTABIL = SYSDATE WHERE PROC = 'N'` — a nota ainda não processada anda com o
 *   dia, e é contabilizada no dia em que é processada. Não está no fonte de 2020 nem nos jobs: quem chama é o binário novo. Produção: as
 *   327 notas não processadas de 25/09/2026 têm DTCONTABIL = o dia; 641 das 653 entradas processadas em set/2026 ficaram com a data do
 *   processamento. Sem ela, a nota digitada num dia e processada noutro entraria no livro, no SPED e na apuração com a data da digitação.
 *
 * A cada `APOLLO_AGENDADOR_MS` (padrão 60 s) percorre os tenants; a rotina é idempotente (só mexe na nota que não está com a data de hoje,
 * no fuso da loja). `APOLLO_AGENDADOR=off` desliga (o smoke chama o `ciclo` direto).
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

  /** um ciclo por tenant; devolve quantas notas cada um teve a data contábil levada ao dia (o erro vira `erro`) */
  async ciclo(): Promise<Array<{ tenant: string; notas?: number; erro?: string }>> {
    if (this.rodando) return [];
    this.rodando = true;
    const out: Array<{ tenant: string; notas?: number; erro?: string }> = [];
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
          out.push({ tenant, notas });
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
}
