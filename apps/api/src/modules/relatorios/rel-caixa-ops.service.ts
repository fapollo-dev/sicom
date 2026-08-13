import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FiltroCaixaOps {
  dtini: string; dtfim: string;
  horaIni?: string; horaFim?: string; filtrarHora?: boolean;
}

/**
 * OPERAÇÕES DE CAIXA do hub FRMRELVENDAS — duas variantes:
 *
 *   rel 04 `VendasSangria` → relação de SANGRIAS e SUPRIMENTOS. O legado tem DUAS GERAÇÕES e escolhe em
 *   RUNTIME (consulta USER_TAB_COLUMNS pela tabela HIST_SANGRIA_SUPRIMENTO; uVendas.pas, função interna
 *   `ExisteTabelaHistSangria`). No tenant a tabela EXISTE (34.087 linhas) ⇒ portada SÓ a geração viva
 *   (`GetSqlhistSangria`); o fallback via CX_VENDAS é o caminho morto da pré-migração do próprio legado.
 *   Fidelidades: TIPO 'SAN'→SANGRIA / 'SUP'→SUPRIMENTO (ELSE '' — tipo fora do par vira rótulo VAZIO, mas o
 *   WHERE já limita aos dois); `VALOR > 0` no WHERE; junta PDV por **CODPDV** (≠ da rel 07, que casa por
 *   NROPDV); e o `MIN(CODHISTSANGRIA) ... GROUP BY <todas as colunas exibidas>` é um DEDUP de linhas
 *   idênticas — duas sangrias iguais no mesmo segundo viram UMA linha no legado. Copiado.
 *
 *   rel 05 `HistorioLiberacaoPDV` → o log de liberações/eventos do PDV (HISTORICO_PDV, 284.609 linhas).
 *   `COALESCE(RESPONSAVEL, USUARIO)` — 14 nulos no golden justificam o fallback. Ordem: data, pdv, sequencial.
 */
@Injectable()
export class RelCaixaOpsService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private async ctx(f: FiltroCaixaOps) {
    const emp = this.emp();
    if (!f.dtini || !f.dtfim) throw new BusinessRuleError('PERIODO_OBRIGATORIO');
    if (String(f.dtini) > String(f.dtfim)) throw new BusinessRuleError('PERIODO_INVERTIDO', { dtini: f.dtini, dtfim: f.dtfim });
    const tz = String((await this.config.resolver('FUSO_HORARIO_ACESSO', { empresaId: emp })) ?? 'America/Sao_Paulo');
    const fimExcl = new Date(`${f.dtfim}T00:00:00Z`);
    if (Number.isNaN(fimExcl.getTime())) throw new BusinessRuleError('PERIODO_INVALIDO', { dtfim: f.dtfim });
    fimExcl.setUTCDate(fimExcl.getUTCDate() + 1);
    return { emp, tz, ate: fimExcl.toISOString().slice(0, 10), db: this.dbp.forTenantRead() as AnyDB };
  }

  private periodo<Q extends { where: (...a: any[]) => Q }>(q: Q, f: FiltroCaixaOps, tz: string, ate: string, col: string): Q {
    if (f.filtrarHora && f.horaIni && f.horaFim) {
      return q.where(sql.raw(col) as any, '>=', sql`(${`${f.dtini} ${f.horaIni}`}::timestamp at time zone ${tz})`)
        .where(sql.raw(col) as any, '<=', sql`(${`${f.dtfim} ${f.horaFim}`}::timestamp at time zone ${tz})`);
    }
    return q.where(sql.raw(col) as any, '>=', sql`(${f.dtini}::timestamp at time zone ${tz})`)
      .where(sql.raw(col) as any, '<', sql`(${ate}::timestamp at time zone ${tz})`);
  }

  /** rel 04 — sangrias e suprimentos (a geração HIST_SANGRIA_SUPRIMENTO, a viva). */
  async sangrias(f: FiltroCaixaOps) {
    const { emp, tz, ate, db } = await this.ctx(f);
    let q = db
      .selectFrom('hist_sangria_suprimento as a')
      .leftJoin('pdv as b', (j) => j.on(sql<boolean>`b.codpdv = a.codpdv and b.codempresa = a.idempresa`))
      .leftJoin('operadores as c', 'c.codoperador', 'a.codoperador')
      .select([
        // MIN(cod) + GROUP BY de tudo = dedup de linhas idênticas, fiel
        sql`min(a.codhistsangria)`.as('codhistsangria'),
        sql`to_char(a.data at time zone ${tz}, 'YYYY-MM-DD')`.as('data'),
        sql`to_char(a.data at time zone ${tz}, 'HH24:MI:SS')`.as('hora'),
        sql`a.codoperador`.as('codoperadora'),
        sql`c.nome`.as('usuario'),
        sql`a.codpdv`.as('nropdv'),
        sql`b.descricao`.as('descricao_pdv'),
        sql`case when a.tipo = 'SAN' then a.valor else 0 end`.as('sangrias'),
        sql`case when a.tipo = 'SUP' then a.valor else 0 end`.as('suprimentos'),
        sql`case when a.tipo = 'SAN' then 'SANGRIA' when a.tipo = 'SUP' then 'SUPRIMENTO' else '' end`.as('operacao'),
        sql`a.descricao`.as('descricao_hist'),
      ])
      .where('a.idempresa', '=', emp)
      .where(sql<boolean>`a.tipo in ('SAN','SUP')`)
      .where(sql<boolean>`a.valor > 0`);
    q = this.periodo(q, f, tz, ate, 'a.data');
    // balde/hora têm parâmetro (fuso) ⇒ ordinais no GROUP BY (lição 29)
    q = q.groupBy([sql`2`, sql`3`, 'a.codoperador', sql`c.nome`, 'a.codpdv', sql`b.descricao`, sql`8`, sql`9`, sql`10`, sql`a.descricao`])
      .orderBy(sql`2`).orderBy('a.codpdv').orderBy(sql`c.nome`).orderBy(sql`3`);
    const rows = (await q.execute()) as Record<string, unknown>[];
    const linhas = rows.map((r) => ({ ...r, sangrias: r2(num(r.sangrias)), suprimentos: r2(num(r.suprimentos)) }));
    return {
      linhas,
      totais: {
        linhas: linhas.length,
        sangrias: r2(linhas.reduce((s, l) => s + num(l.sangrias), 0)),
        suprimentos: r2(linhas.reduce((s, l) => s + num(l.suprimentos), 0)),
      },
      filtro: { ...f, empresa: emp, fuso: tz },
    };
  }

  /** rel 05 — histórico de liberações do PDV. */
  async liberacoes(f: FiltroCaixaOps) {
    const { emp, tz, ate, db } = await this.ctx(f);
    let q = db
      .selectFrom('historico_pdv as v')
      .leftJoin('parceiros as c', 'c.codparceiro', 'v.codparceiro')
      .select([
        sql`v.codpdv`.as('codecf'),
        sql`v.idhistorico`.as('sequencial'),
        'v.historico',
        sql`coalesce(v.responsavel, v.usuario)`.as('responsavel'),
        'v.usuario', 'v.codparceiro',
        sql`c.razao`.as('razao'),
        'v.nrocupom',
        sql`to_char(v.data at time zone ${tz}, 'YYYY-MM-DD')`.as('data'),
        sql`to_char(v.data at time zone ${tz}, 'HH24:MI:SS')`.as('hora'),
        'v.motivo',
      ])
      .where('v.idempresa', '=', emp);
    q = this.periodo(q, f, tz, ate, 'v.data');
    const rows = (await q
      .orderBy(sql`9`).orderBy('v.codpdv').orderBy('v.idhistorico')
      .limit(20001).execute()) as Record<string, unknown>[];
    const truncado = rows.length > 20000;
    const linhas = truncado ? rows.slice(0, 20000) : rows;
    return {
      linhas,
      totais: { linhas: linhas.length, pdvs: new Set(linhas.map((l) => l.codecf)).size },
      filtro: { ...f, empresa: emp, fuso: tz, truncado, max_linhas: 20000 },
    };
  }
}
