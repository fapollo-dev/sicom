import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = any;
const REGISTROS = ['m400', 'm410', 'm800', 'm810'] as const;
type Registro = (typeof REGISTROS)[number];
export interface ContaPc { codplanocontas: number; codireduzido: string | null; descricao: string | null; codiexpandido: string | null }

/**
 * A "Configuração de contas" do SPED Contribuições (`TfrmSpedPisCofins`, QryConfiguracoesSPED — UdmSpedPisCofins.dfm:6608): a conta
 * contábil do M400, M410, M800 e M810 da LOJA DO LOGIN (CONFIGURACOES_SPED, uma linha por empresa — `AbreQryConfiguracoesSPED`: sem linha,
 * Append). O campo recebe o código reduzido da conta (a Pesquisa GET_PLANO_CONTAS com CLASSE = ANALITICA e TIPO = EMPRESA) e grava o
 * CODPLANOCONTAS. Produção: a loja 1 com as quatro na conta 183.
 */
@Injectable()
export class SpedContasPcService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async ler(): Promise<Record<Registro, ContaPc | null>> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const c = (await db.selectFrom('configuracoes_sped').selectAll().where('idempresa', '=', this.emp()).executeTakeFirst()) as Record<string, unknown> | undefined;
    const ids = REGISTROS.map((r) => Number(c?.[`codplc_${r}_pc`] ?? 0)).filter((n) => n > 0);
    const contas = ids.length
      ? new Map(((await db.selectFrom('plano_contas').select(['codplanocontas', 'codireduzido', 'descricao', 'codiexpandido']).where('codplanocontas', 'in', ids).execute()) as ContaPc[])
          .map((p) => [Number(p.codplanocontas), p]))
      : new Map<number, ContaPc>();
    const out = {} as Record<Registro, ContaPc | null>;
    for (const r of REGISTROS) {
      const id = Number(c?.[`codplc_${r}_pc`] ?? 0);
      out[r] = id > 0 ? (contas.get(id) ?? { codplanocontas: id, codireduzido: null, descricao: null, codiexpandido: null }) : null;
    }
    return out;
  }

  /** `SalvaQryConfiguracoesSPED` (o Post + ApplyUpdates); a conta tem de ser ANALÍTICA da EMPRESA (o filtro da Pesquisa do campo) */
  async gravar(dto: Partial<Record<Registro, number | null>>): Promise<Record<Registro, ContaPc | null>> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    const patch: Record<string, number | null> = {};
    for (const r of REGISTROS) {
      if (!(r in dto)) continue;
      const v = dto[r];
      if (v == null || Number(v) === 0) { patch[`codplc_${r}_pc`] = null; continue; }
      const ok = (await sql`SELECT 1 FROM rel_get_plano_contas WHERE codigo = ${Number(v)} AND classe = 'ANALITICA' AND tipo = 'EMPRESA'`.execute(db)).rows.length > 0;
      if (!ok) throw new BusinessRuleError('SPED_CONTA_INVALIDA', { registro: r.toUpperCase(), conta: v }, `A conta do registro ${r.toUpperCase()} não é uma conta analítica da empresa.`);
      patch[`codplc_${r}_pc`] = Number(v);
    }
    if (Object.keys(patch).length) {
      await db.insertInto('configuracoes_sped').values({ idempresa: emp, ...patch })
        .onConflict((oc: any) => oc.column('idempresa').doUpdateSet(patch)).execute();
    }
    return this.ler();
  }
}
