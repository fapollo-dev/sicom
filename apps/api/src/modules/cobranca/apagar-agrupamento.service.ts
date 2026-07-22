import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * AGRUPAMENTO de CONTAS A PAGAR (uAgrupaContasAPagar) — GÊMEO do AR (areceber-agrupamento.service). Consolida N
 * títulos ABERTOS de UM fornecedor num título CONSOLIDADO (ORIGEM='A', valor = Σ): os originais ficam
 * AGRUPADO='S' + CODGRUPO_AGRUPAMENTO_APG = codapg do consolidado (somem dos "abertos"). `reverter` desfaz o
 * grupo (se o consolidado não foi quitado/pago); `removerTitulo` tira um membro e abate o valor. TOTAL é
 * derivado na view get_apagar (valor + juro) → SEM o bug do legado (TOTAL=VALOR±delta). Tenant por CODEMPRESA.
 *
 * Divergências CONSCIENTES (iguais ao AR, ver areceber-agrupamento.service): consolidado ORIGEM='A' + vínculo por
 * CODAPG (golden: ORIGEM=NULL + CODGRUPO) → CUTOVER remapear se APAGAR legado for importado; elegibilidade mais
 * estrita (barra CONTABILIZADO/IDNF). AP NÃO tem "em-lote" (lote de cobrança é só recebível). dtvenc do
 * consolidado = HOJE (não max dos membros). ADIADO: snapshot AGRUPAPAGAR, convênio, taxa ADM/desconto.
 */
@Injectable()
export class ApagarAgrupamentoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** agrupa `codapgs` (≥2, mesmo fornecedor, abertos) num consolidado ORIGEM='A' (valor = Σ). */
  async agrupar(dto: { codapgs: number[]; dtvenc?: string; obs?: string }): Promise<{ codgrupo: number; consolidado: number; membros: number; total: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const ids = [...new Set((dto.codapgs ?? []).map(Number).filter((n) => Number.isFinite(n)))];
    if (ids.length < 2) throw new BusinessRuleError('AGRUPAMENTO_MINIMO_2');

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const membros = (await trx
        .selectFrom('apagar')
        .select(['codapg', 'codparceiro', 'valor', 'quitada', 'agrupado', 'contabilizado', 'idnf'])
        .where('codapg', 'in', ids).where('codempresa', '=', emp)
        .forUpdate().execute()) as Array<Record<string, unknown>>;
      if (membros.length !== ids.length) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO');

      // estado POR-TÍTULO primeiro (erro do título), depois a coesão de fornecedor.
      for (const m of membros) {
        if (m.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO', { codapg: m.codapg });
        if (m.agrupado === 'S') throw new BusinessRuleError('TITULO_AGRUPADO', { codapg: m.codapg });
        if (m.contabilizado === 'S') throw new BusinessRuleError('TITULO_CONTABILIZADO', { codapg: m.codapg });
        if (m.idnf != null) throw new BusinessRuleError('TITULO_DE_NF', { codapg: m.codapg });
      }
      const fornecedores = new Set(membros.map((m) => Number(m.codparceiro)));
      if (fornecedores.size !== 1) throw new BusinessRuleError('AGRUPAMENTO_PARCEIROS_DIVERSOS');

      const codparceiro = Number(membros[0].codparceiro);
      const total = r2(membros.reduce((s, m) => s + num(m.valor), 0));
      const dtvenc = dto.dtvenc ?? null; // HOJE por default (não max dos membros — evita nascer vencido)
      const e = await trx.selectFrom('empresas').select('txjuropadrao').where('idempresa', '=', emp).executeTakeFirst();

      const ins = await trx
        .insertInto('apagar')
        .values({
          codempresa: emp, codparceiro, valor: total, txjuros: (e as any)?.txjuropadrao ?? null,
          dtvenda: sql`current_date`, dtvenc: dtvenc ?? sql`current_date`, tipodoc: 'DUPLICATA', origem: 'A',
          quitada: 'N', agrupado: 'N', consiliado: 'S', cadastrado_manualmente: 'N', gerado: 'SISTEMA',
          obs: dto.obs ?? `Agrupamento de ${ids.length} títulos do fornecedor ${codparceiro}.`,
          data_agrupamento: sql`now()`, usultalteracao: op, dtultimalteracao: sql`now()`, dtcadastro: sql`now()`,
        })
        .returning('codapg').executeTakeFirstOrThrow();
      const codConsolidado = Number((ins as any).codapg);

      await trx
        .updateTable('apagar')
        .set({ agrupado: 'S', codgrupo_agrupamento_apg: codConsolidado, data_agrupamento: sql`now()`, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codapg', 'in', ids).where('codempresa', '=', emp).execute();

      return { codgrupo: codConsolidado, consolidado: codConsolidado, membros: ids.length, total };
    });
  }

  /** trava do consolidado: existe, ORIGEM='A', não quitado/pago-ativo/contabilizado. (AP não tem em-lote.) */
  private async travarConsolidado(trx: AnyDB, emp: number, codConsolidado: number): Promise<Record<string, unknown>> {
    const c = (await trx
      .selectFrom('apagar')
      .select(['codapg', 'valor', 'origem', 'quitada', 'contabilizado'])
      .where('codapg', '=', codConsolidado).where('codempresa', '=', emp)
      .forUpdate().executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!c) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codapg: codConsolidado });
    if (String(c.origem ?? '') !== 'A') throw new BusinessRuleError('NAO_E_AGRUPAMENTO', { codapg: codConsolidado });
    if (c.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO', { codapg: codConsolidado });
    if (c.contabilizado === 'S') throw new BusinessRuleError('TITULO_CONTABILIZADO', { codapg: codConsolidado });
    // só pagamento ATIVO (indr='I') bloqueia — o estorno marca indr='E' e mantém a linha.
    const bx = await trx.selectFrom('apagar_bx').select('codapgbx').where('codapg', '=', codConsolidado).where(sql`coalesce(indr,'I')`, '=', 'I').executeTakeFirst();
    if (bx) throw new BusinessRuleError('AGRUPAMENTO_BAIXADO', { codapg: codConsolidado });
    return c;
  }

  /** desfaz o agrupamento inteiro: limpa os membros (AGRUPADO='N') e apaga o consolidado. */
  async reverter(codConsolidado: number): Promise<{ revertido: true; consolidado: number; membros: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.travarConsolidado(trx, emp, codConsolidado);
      const membros = (await trx
        .selectFrom('apagar').select('codapg')
        .where('codgrupo_agrupamento_apg', '=', codConsolidado).where('codempresa', '=', emp)
        .execute()) as Array<{ codapg: number }>;
      if (membros.length === 0) throw new BusinessRuleError('AGRUPAMENTO_SEM_MEMBROS', { codapg: codConsolidado });
      await trx
        .updateTable('apagar')
        .set({ agrupado: 'N', codgrupo_agrupamento_apg: null, data_agrupamento: null, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codgrupo_agrupamento_apg', '=', codConsolidado).where('codempresa', '=', emp).execute();
      await trx.deleteFrom('apagar').where('codapg', '=', codConsolidado).where('codempresa', '=', emp).execute();
      return { revertido: true as const, consolidado: codConsolidado, membros: membros.length };
    });
  }

  /** remove UM membro do grupo: libera o título (AGRUPADO='N') e abate o valor do consolidado. Não o último. */
  async removerTitulo(codConsolidado: number, codMembro: number): Promise<{ consolidado: number; removido: number; novoValor: number; membrosRestantes: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.travarConsolidado(trx, emp, codConsolidado);
      const membro = (await trx
        .selectFrom('apagar').select(['codapg', 'valor', 'codgrupo_agrupamento_apg'])
        .where('codapg', '=', codMembro).where('codempresa', '=', emp)
        .forUpdate().executeTakeFirst()) as Record<string, unknown> | undefined;
      if (!membro || Number(membro.codgrupo_agrupamento_apg) !== codConsolidado) throw new BusinessRuleError('TITULO_NAO_PERTENCE_AGRUPAMENTO', { codapg: codMembro });

      const totalMembros = Number(((await trx
        .selectFrom('apagar').select(sql<number>`count(*)`.as('n'))
        .where('codgrupo_agrupamento_apg', '=', codConsolidado).where('codempresa', '=', emp)
        .executeTakeFirst()) as any).n);
      if (totalMembros <= 1) throw new BusinessRuleError('AGRUPAMENTO_REMOVER_ULTIMO', { codapg: codConsolidado });

      const novoValor = r2(num(c.valor) - num(membro.valor));
      await trx.updateTable('apagar').set({ valor: novoValor, usultalteracao: op, dtultimalteracao: sql`now()` }).where('codapg', '=', codConsolidado).where('codempresa', '=', emp).execute();
      await trx.updateTable('apagar').set({ agrupado: 'N', codgrupo_agrupamento_apg: null, data_agrupamento: null, usultalteracao: op, dtultimalteracao: sql`now()` }).where('codapg', '=', codMembro).where('codempresa', '=', emp).execute();
      return { consolidado: codConsolidado, removido: codMembro, novoValor, membrosRestantes: totalMembros - 1 };
    });
  }

  /** lista os membros de um agrupamento consolidado (consulta). */
  async membros(codConsolidado: number): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    return (await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('apagar').select(['codapg', 'codparceiro', 'valor', 'dtvenc', 'duplicata'])
      .where('codgrupo_agrupamento_apg', '=', codConsolidado).where('codempresa', '=', emp)
      .orderBy('codapg').execute()) as Array<Record<string, unknown>>;
  }
}
