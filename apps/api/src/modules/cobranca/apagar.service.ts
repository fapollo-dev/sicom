import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * CONTAS A PAGAR — corte-1 (cadastro/gestão do título). Gêmea de `areceber.service.ts` (mesmo molde
 * vertical, tenant por codempresa, travas de estado). Tabela `apagar` (PK codapg), view `get_apagar`.
 * O parceiro é o FORNECEDOR. A BAIXA/pagamento é o `apagar-baixa.service.ts`.
 */
@Injectable()
export class ApagarService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private static readonly PESQUISA = new Set([
    'codapg', 'duplicata', 'razao', 'dtvenc', 'dtvenda', 'valor', 'quitada', 'tipodoc',
  ]);

  async list(query: Record<string, string | undefined>): Promise<Record<string, unknown>[]> {
    const emp = this.emp();
    let q = (this.dbp.forTenantRead() as AnyDB).selectFrom('get_apagar').selectAll().where('codempresa', '=', emp);
    switch (query.situacao) {
      case 'liquidados': q = q.where('quitada', '=', 'S'); break;
      case 'agrupados': q = q.where('agrupado', '=', 'S'); break;
      case 'abertos': q = q.where(sql`coalesce(quitada,'N')`, '=', 'N').where(sql`coalesce(agrupado,'N')`, '=', 'N'); break;
    }
    const campo = query.campo;
    if (campo && ApagarService.PESQUISA.has(campo) && query.valor != null && query.valor !== '') {
      const col = sql.ref(campo);
      const v = query.valor;
      switch (query.operador ?? 'contem') {
        case 'igual': q = q.where(col as any, '=', v); break;
        case 'comeca': q = q.where(sql`upper(${col})`, 'like', `${v.toUpperCase()}%`); break;
        default: q = q.where(sql`upper(${col})`, 'like', `%${v.toUpperCase()}%`); break;
      }
    }
    if (query.orderBy && ApagarService.PESQUISA.has(query.orderBy)) {
      q = q.orderBy(sql.ref(query.orderBy), query.orderDir === 'desc' ? 'desc' : 'asc');
    } else {
      q = q.orderBy('dtvenc', 'asc');
    }
    return q.limit(Math.min(Number(query.limite) || 200, 500)).execute();
  }

  async read(id: number): Promise<Record<string, unknown> | undefined> {
    return (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('get_apagar')
      .selectAll()
      .where('codapg', '=', id)
      .where('codempresa', '=', this.emp())
      .executeTakeFirst();
  }

  private static readonly COLUNAS = [
    'codparceiro', 'dtvenda', 'dtvenc', 'valor', 'txjuros', 'txmulta', 'desconto_boleto',
    'nrodup', 'duplicata', 'tipodoc', 'nroped', 'nrocupom',
    'idpgto', 'codbco', 'codplc', 'idsituacao_nf', 'obs',
  ];
  private delta(dto: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const c of ApagarService.COLUNAS) if (dto[c] !== undefined) out[c] = dto[c];
    return out;
  }

  async criar(dto: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const id = await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const d = this.delta(dto);
      if (d.txjuros == null) {
        const e = await trx.selectFrom('empresas').select('txjuropadrao').where('idempresa', '=', emp).executeTakeFirst();
        d.txjuros = e?.txjuropadrao ?? null;
      }
      const ins = await trx
        .insertInto('apagar')
        .values({
          ...d, codempresa: emp, quitada: 'N', agrupado: 'N', consiliado: 'S',
          cadastrado_manualmente: 'S', gerado: 'OPERADOR',
          usultalteracao: op, dtultimalteracao: sql`now()`, dtcadastro: sql`now()`,
        })
        .returning('codapg')
        .executeTakeFirstOrThrow();
      return Number((ins as Record<string, unknown>).codapg);
    });
    return this.read(id);
  }

  private static readonly ORIGEM_AUTO = new Set(['Q', 'O', 'C']);

  /** trava de estado + posse (espelha areceber): quitado/agrupado/contabilizado/de-NF/origem-auto/conciliado. */
  private async travarEditavel(trx: AnyDB, id: number, emp: number) {
    const t = await trx
      .selectFrom('apagar')
      .select(['codapg', 'quitada', 'agrupado', 'contabilizado', 'idnf', 'origem', 'consiliado', 'cadastrado_manualmente'])
      .where('codapg', '=', id)
      .where('codempresa', '=', emp)
      .forUpdate()
      .executeTakeFirst();
    if (!t) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codapg: id });
    if (t.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO'); // pago — estorne o pagamento antes
    if (t.agrupado === 'S') throw new BusinessRuleError('TITULO_AGRUPADO');
    if (t.contabilizado === 'S') throw new BusinessRuleError('TITULO_CONTABILIZADO');
    if (t.idnf != null) throw new BusinessRuleError('TITULO_DE_NF', { idnf: t.idnf });
    if (t.origem != null && ApagarService.ORIGEM_AUTO.has(String(t.origem)))
      throw new BusinessRuleError('TITULO_ORIGEM_AUTO', { origem: t.origem });
    if (t.consiliado === 'S' && t.cadastrado_manualmente !== 'S')
      throw new BusinessRuleError('TITULO_CONCILIADO');
    return t;
  }

  async atualizar(id: number, dto: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.travarEditavel(trx, id, emp);
      const d = this.delta(dto);
      if (Object.keys(d).length) {
        await trx
          .updateTable('apagar')
          .set({ ...d, usultalteracao: op, dtultimalteracao: sql`now()` })
          .where('codapg', '=', id)
          .where('codempresa', '=', emp)
          .execute();
      }
    });
    return this.read(id);
  }

  async excluir(id: number): Promise<void> {
    const emp = this.emp();
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.travarEditavel(trx, id, emp);
      await trx.deleteFrom('apagar').where('codapg', '=', id).where('codempresa', '=', emp).execute();
    });
  }
}
