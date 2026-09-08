import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

export interface DiaFechamento {
  data: string;
  status: string | null;
  fechado: boolean;
  codfechamento: number | null;
  nfs_pendentes: number;
}

/**
 * FECHAMENTO DIÁRIO (`FRMFECHAMENTODIARIO`, `uFechamentoDiario.pas`). Dossiê: `uFechamentoDiario-impacto.md`.
 *
 * A tela marca cada dia do mês como aberto ou fechado, por empresa. O estado mora numa coluna só:
 * `STATUS` nulo = aberto, `'F'` = fechado (`AbreDia` :122 grava null; `FechaDia` :315 grava 'F') — não há um
 * 'A' no legado, e inventá-lo quebraria o de-para na virada.
 *
 * O que o fechamento vale, medido em produção (a análise de impacto):
 *  · a **integração contábil NÃO depende** desta tabela — usa `CONFIG_INTEGRACAO_CONTABIL.CHAVEAMENTO_PERIODO`;
 *  · o **Sintegra** é o único gate duro (`Usintegra.pas:845-862`), e o cliente quase não o emite mais;
 *  · o efeito com peso é o `VerificaNFs`: fechar o dia **empurra a `DTCONTABIL`** das notas não processadas
 *    para o próximo dia aberto — 5.176 notas de 2026 têm data contábil diferente da emissão.
 */
@Injectable()
export class FechamentoDiarioService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /**
   * LISTA o mês inteiro, materializando os dias que ainda não têm linha — é o que o `cmbMesChange` (:220-255)
   * faz ao abrir a tela: percorre do primeiro ao último dia e insere o que faltar.
   *
   * ⚠️ diferença consciente: o legado GRAVA as linhas nesse momento (por isso produção tem 1.708 linhas em
   * aberto que são puro resíduo de navegação). Aqui a listagem é **de leitura**: os dias sem linha aparecem
   * como abertos, e a linha só nasce quando alguém fecha. Mesmo resultado na tela, sem sujar a tabela.
   */
  async listarMes(ano: number, mes: number): Promise<{ ano: number; mes: number; dias: DiaFechamento[] }> {
    const emp = this.emp();
    if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new BusinessRuleError('PERIODO_INVALIDO', { ano });
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw new BusinessRuleError('PERIODO_INVALIDO', { mes });
    const db = this.dbp.forTenantRead() as AnyDB;
    const ini = `${ano}-${String(mes).padStart(2, '0')}-01`;

    // uma consulta só: a série de dias do mês à esquerda, o que existe em `fechamento` à direita, e a contagem
    // de notas não processadas com data contábil naquele dia (é o que o fechamento vai empurrar).
    const rows = (await sql<Record<string, unknown>>`
      WITH dias AS (
        SELECT generate_series(${ini}::date, (${ini}::date + interval '1 month - 1 day')::date, interval '1 day')::date AS d
      )
      SELECT to_char(dias.d, 'YYYY-MM-DD') AS data,
             f.status,
             f.codfechamento,
             (SELECT count(*)::int FROM nf n
               WHERE n.idempresa = ${emp} AND n.dtcontabil::date = dias.d AND coalesce(n.proc,'N') = 'N') AS nfs_pendentes
        FROM dias
        LEFT JOIN fechamento f ON f.data = dias.d AND f.idempresa = ${emp}
       ORDER BY dias.d
    `.execute(db)).rows;

    return {
      ano, mes,
      dias: rows.map((r) => ({
        data: String(r.data),
        status: (r.status as string) ?? null,
        fechado: r.status === 'F',
        codfechamento: r.codfechamento != null ? Number(r.codfechamento) : null,
        nfs_pendentes: Number(r.nfs_pendentes ?? 0),
      })),
    };
  }

  /**
   * O `VerificaNFs` (:770-839) — a única parte com efeito em dinheiro. Ao fechar um dia, as notas ainda não
   * processadas daquele dia têm a **data contábil empurrada para o próximo dia ABERTO**, porque a data contábil
   * decide em que período a nota entra na apuração.
   *
   * ⚠️ **BUG DO LEGADO QUE NÃO COPIAMOS**: `DiaProximo` é uma variável não inicializada. Quando não existe
   * próximo dia aberto no mês, ela fica em zero e o UPDATE grava **30/12/1899**. Não é hipótese: há **1 nota em
   * produção com `DTCONTABIL = 1899-12-30`**, e a situação de risco ocorreu 2.472 vezes (dias fechados sem
   * próximo dia aberto no mês). Aqui, sem próximo dia aberto, **não se empurra nada** e a resposta diz quantas
   * notas ficaram para trás — quem fecha vê o que precisa resolver, em vez de perder a nota em 1899.
   *
   * ⚠️ e o outro achado: no "fechar mês" o legado sai antes de fazer qualquer coisa (`:794` testa
   * `STATUS='F'`, que o `FechaDia` acabou de gravar) — ou seja **o empurrão nunca roda no fecha-total**.
   * Mantido: quem fecha o mês inteiro não tem "próximo dia aberto" para onde empurrar mesmo.
   */
  private async empurrarNfs(trx: AnyDB, emp: number, dia: string, fechaTotal: boolean): Promise<{ movidas: number; para: string | null; sem_destino: number }> {
    if (fechaTotal) return { movidas: 0, para: null, sem_destino: 0 };

    const pendentes = Number((await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM nf
       WHERE idempresa = ${emp} AND dtcontabil::date = ${dia}::date AND coalesce(proc,'N') = 'N'
    `.execute(trx)).rows[0]?.n ?? 0);
    if (!pendentes) return { movidas: 0, para: null, sem_destino: 0 };

    // próximo dia ABERTO depois deste, dentro do mesmo mês (o legado varre a grade do mês)
    const prox = (await sql<{ d: string }>`
      WITH dias AS (
        SELECT generate_series(${dia}::date + 1, (date_trunc('month', ${dia}::date) + interval '1 month - 1 day')::date, interval '1 day')::date AS d
      )
      SELECT to_char(dias.d, 'YYYY-MM-DD') AS d
        FROM dias LEFT JOIN fechamento f ON f.data = dias.d AND f.idempresa = ${emp}
       WHERE coalesce(f.status, '') <> 'F'
       ORDER BY dias.d LIMIT 1
    `.execute(trx)).rows[0]?.d ?? null;

    if (!prox) return { movidas: 0, para: null, sem_destino: pendentes }; // ← onde o legado gravaria 1899

    const upd = await sql`
      UPDATE nf SET dtcontabil = ${prox}::date
       WHERE idempresa = ${emp} AND dtcontabil::date = ${dia}::date AND coalesce(proc,'N') = 'N'
    `.execute(trx);
    return { movidas: Number(upd.numAffectedRows ?? pendentes), para: prox, sem_destino: 0 };
  }

  /** marca o dia como FECHADO e empurra as notas pendentes (o `FechaDia` :315 + `VerificaNFs`). */
  async fecharDia(data: string, fechaTotal = false): Promise<{ data: string; fechado: boolean; movidas: number; para: string | null; sem_destino: number }> {
    const emp = this.emp();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nfs = await this.empurrarNfs(trx, emp, data, fechaTotal);
      await sql`
        INSERT INTO fechamento (codfechamento, data, status, idempresa)
        VALUES ((SELECT coalesce(max(codfechamento),0) + 1 FROM fechamento), ${data}::date, 'F', ${emp})
        ON CONFLICT (idempresa, data) DO UPDATE SET status = 'F'
      `.execute(trx);
      return { data, fechado: true, ...nfs };
    });
  }

  /** reabre o dia: o legado grava STATUS **nulo**, não apaga a linha (`AbreDia` :122-128). */
  async abrirDia(data: string): Promise<{ data: string; fechado: boolean }> {
    const emp = this.emp();
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await sql`
        INSERT INTO fechamento (codfechamento, data, status, idempresa)
        VALUES ((SELECT coalesce(max(codfechamento),0) + 1 FROM fechamento), ${data}::date, NULL, ${emp})
        ON CONFLICT (idempresa, data) DO UPDATE SET status = NULL
      `.execute(trx);
    });
    return { data, fechado: false };
  }

  /**
   * FECHAR ou ABRIR o mês inteiro (`btnFechaTotalClick` :183 · `btnAberturaTotalClick` :166) — o legado percorre
   * a grade dia a dia. No fechar, cada dia entra com `fechaTotal=true`, e por isso o empurrão de notas não roda
   * (ver `empurrarNfs`).
   */
  async mesInteiro(ano: number, mes: number, fechar: boolean): Promise<{ ano: number; mes: number; dias: number }> {
    const emp = this.emp();
    const { dias } = await this.listarMes(ano, mes);
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      for (const d of dias) {
        await sql`
          INSERT INTO fechamento (codfechamento, data, status, idempresa)
          VALUES ((SELECT coalesce(max(codfechamento),0) + 1 FROM fechamento), ${d.data}::date, ${fechar ? 'F' : null}, ${emp})
          ON CONFLICT (idempresa, data) DO UPDATE SET status = ${fechar ? 'F' : null}
        `.execute(trx);
      }
    });
    return { ano, mes, dias: dias.length };
  }
}
