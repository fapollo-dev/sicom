import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/** os rótulos que o CASE do legado mapeia — CFN e status E existem no dado e saem SEM rótulo (fiel). */
const TIPO_STR: Record<string, string> = {
  APN: 'Análise de pedido x Nota fiscal',
  RPN: 'Realizar nova análise de pedido x Nota fiscal',
};
const STATUS_STR: Record<string, string> = { A: 'Aberta', F: 'Finalizada' };

/**
 * PENDÊNCIAS DO OPERADOR (FRMPENDENCIASOPERADOR) — corte 1: a FILA de trabalho por operador.
 * Procedência: UFrmPendenciasOperador.pas + UDMPendenciasOperador (a query do .dfm).
 * A tela do legado lista as pendências do OPERADOR LOGADO; aqui o filtro de operador é explícito
 * (default: o logado) e as ações de fila são finalizar (com observação) e reabrir.
 * O fornecedor da pendência APN vem da análise vinculada — nas linhas CARREGADAS o vínculo é o APN_ID
 * do Oracle (domínio não persistido aqui) ⇒ fornecedor em branco nelas; nas pendências NOVAS o
 * complemento guarda o codnf e o fornecedor resolve pela NF (corte 2 liga a análise completa).
 */
@Injectable()
export class PendenciaOperadorService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async listar(f: { codoperador?: number; status?: string; tipo?: string }) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const op = f.codoperador ?? currentTenant().operadorId ?? null;
    let q = db.selectFrom('pendencia_operador as p')
      .leftJoin('operadores as o', 'o.codoperador', 'p.codoperador')
      .leftJoin('operadores as oo', 'oo.codoperador', 'p.codoperador_origem')
      // pendência NOVA: complemento numérico = codnf → resolve o fornecedor pela NF
      .leftJoin('nf as n', (j) => j.on(sql<boolean>`p.po_complemento ~ '^[0-9]+$' and n.codnf = p.po_complemento::int and n.idempresa = p.codempresa`))
      .leftJoin('parceiros as par', 'par.codparceiro', 'n.codparceiro')
      .select([
        'p.po_id', 'p.codoperador', sql`o.nome`.as('nome'),
        'p.po_tipo_pendencia_operador', 'p.po_status', 'p.po_complemento',
        'p.po_observacao', 'p.po_data', 'p.codempresa',
        sql`oo.nome`.as('nome_origem'),
        sql`coalesce(par.fantasia, par.razao)`.as('fornecedor'),
      ])
      .where('p.codempresa', '=', emp);
    if (op != null) q = q.where('p.codoperador', '=', Number(op));
    if (f.status) q = q.where('p.po_status', '=', f.status);
    if (f.tipo) q = q.where('p.po_tipo_pendencia_operador', '=', f.tipo);
    const rows = (await q.orderBy(sql`p.po_status`).orderBy(sql`p.po_data desc`).limit(1001).execute()) as Record<string, unknown>[];
    const truncado = rows.length > 1000;
    const linhas: Record<string, unknown>[] = (truncado ? rows.slice(0, 1000) : rows).map((r) => ({
      ...r,
      // fiel: o CASE do legado só rotula APN/RPN e A/F — os demais ficam com o código cru
      tipo_str: TIPO_STR[String(r.po_tipo_pendencia_operador)] ?? String(r.po_tipo_pendencia_operador),
      status_str: STATUS_STR[String(r.po_status)] ?? String(r.po_status),
    }));
    return {
      linhas,
      totais: {
        linhas: linhas.length,
        abertas: linhas.filter((l) => l.po_status === 'A').length,
      },
      filtro: { ...f, codoperador: op, empresa: emp, truncado, max_linhas: 1000 },
    };
  }

  /** cria uma pendência (o caminho que o Manifesto/Conferência usam no legado). */
  async criar(dto: { codoperador: number; tipo: string; complemento?: string; observacao?: string }) {
    const emp = this.emp();
    const origem = currentTenant().operadorId ?? null;
    if (!['APN', 'RPN', 'CFN'].includes(dto.tipo)) throw new BusinessRuleError('TIPO_INVALIDO', { tipo: dto.tipo });
    const db = this.dbp.forTenant() as AnyDB;
    const r = await db.insertInto('pendencia_operador').values({
      codoperador: dto.codoperador,
      po_tipo_pendencia_operador: dto.tipo,
      po_status: 'A',
      po_complemento: dto.complemento ?? null,
      po_observacao: dto.observacao ?? null,
      codempresa: emp,
      codoperador_origem: origem,
    }).returning('po_id').executeTakeFirst();
    return { ok: true, po_id: r?.po_id };
  }

  /** finaliza (com observação opcional) ou reabre uma pendência do escopo da empresa. */
  async status(poId: number, finalizar: boolean, observacao?: string) {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx) => {
      const p = await trx.selectFrom('pendencia_operador').select(['po_id', 'po_status'])
        .where('po_id', '=', poId).where('codempresa', '=', emp).forUpdate().executeTakeFirst();
      if (!p) throw new BusinessRuleError('PENDENCIA_NAO_ENCONTRADA');
      if (finalizar && p.po_status === 'F') throw new BusinessRuleError('PENDENCIA_JA_FINALIZADA');
      await trx.updateTable('pendencia_operador')
        .set({
          po_status: finalizar ? 'F' : 'A',
          ...(observacao != null ? { po_observacao: observacao.slice(0, 1000) } : {}),
        })
        .where('po_id', '=', poId).where('codempresa', '=', emp).execute();
      return { ok: true, po_id: poId, po_status: finalizar ? 'F' : 'A' };
    });
  }
}
