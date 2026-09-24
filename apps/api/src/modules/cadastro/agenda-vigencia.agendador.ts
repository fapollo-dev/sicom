import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { runWithTenant } from '../../shared/tenant/tenant-context';
import { AgendaPromocaoService } from './agenda-promocao.service';

/**
 * O AGENDADOR DA VIGÊNCIA DA AGENDA DE PROMOÇÃO — o papel do serviço `ServerRemessaDS.exe` do legado (fora do fonte do
 * retaguarda): liga a promoção no MULTI_PRECO na hora do início, religa depois de cada gravação (gravar uma agenda
 * EXECUTANDO a devolve para ABERTA) e fecha a agenda no fim, desligando o preço. Produção 2025-26: 1.144 das 1.153 agendas
 * executadas pelo serviço, 1.138 chegaram a FECHADA; a 31185 ligou nas lojas 1 e 2 às 05:00:48 com PROGRAMA=ServerRemessaDS.exe.
 * Até a auditoria de esqueletos (24/09/2026) nada chamava `processarVigencia` fora do botão — a agenda não ligava no início e a
 * aplicada à mão não desligava no fim.
 *
 * A cada `APOLLO_AGENDADOR_MS` (padrão 60 s) percorre os tenants (`DatabaseProvider.listarTenants`) e processa a vigência de
 * cada um no seu contexto. Um ciclo por vez (sem sobreposição); o erro de um tenant não para os outros. `APOLLO_AGENDADOR=off`
 * desliga (o smoke desliga — ele testa o `ciclo` direto).
 */
@Injectable()
export class AgendaVigenciaAgendador implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('AgendaVigencia');
  private timer: NodeJS.Timeout | null = null;
  private rodando = false;

  constructor(private readonly dbp: DatabaseProvider, private readonly svc: AgendaPromocaoService) {}

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

  /** um ciclo: a vigência de cada tenant; devolve o que fez por tenant (o erro vira `erro`) */
  async ciclo(): Promise<Array<{ tenant: string; aplicadas?: number; desaplicadas?: number; erro?: string }>> {
    if (this.rodando) return [];
    this.rodando = true;
    const out: Array<{ tenant: string; aplicadas?: number; desaplicadas?: number; erro?: string }> = [];
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
          const r = await runWithTenant({ tenantId: tenant }, () => this.svc.processarVigencia({ sistema: true }));
          if (r.aplicadas || r.desaplicadas) this.log.log(`${tenant}: ${r.aplicadas} agenda(s) ligada(s), ${r.desaplicadas} desligada(s)`);
          out.push({ tenant, ...r });
        } catch (e) {
          this.log.warn(`${tenant}: ${(e as Error).message}`);
          out.push({ tenant, erro: (e as Error).message });
        }
      }
      return out;
    } finally {
      this.rodando = false;
    }
  }
}
