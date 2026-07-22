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
 * AGRUPAMENTO de CONTAS A RECEBER (uAgrupaContasAReceber). Consolida N títulos ABERTOS de UM cliente num único
 * título CONSOLIDADO (ORIGEM='A', valor = Σ dos membros): os originais ficam AGRUPADO='S' +
 * CODGRUPO_AGRUPAMENTO_RCB = codrcb do consolidado (somem dos "abertos", mas permanecem no sistema); o
 * consolidado é o título cobrável. `reverter` desfaz o grupo inteiro (se o consolidado não foi quitado/baixado);
 * `removerTitulo` tira um membro e abate o valor do consolidado (AtualizaValoresAgrupamento — SEM o bug do
 * legado que derivava TOTAL de VALOR: TOTAL é sempre calculado na view get_areceber). Tenant por CODEMPRESA.
 *
 * DIVERGÊNCIAS CONSCIENTES vs golden (auditoria 2 agentes, Oracle ~500 agrupamentos): (a) o consolidado usa
 * ORIGEM='A' + vínculo membro→consolidado por CODRCB; o legado usa ORIGEM=NULL + vínculo por CODGRUPO (sequência
 * separada). Modelo greenfield internamente consistente; **CUTOVER**: se ARECEBER legado for importado, remapear
 * os consolidados p/ ORIGEM='A' e os membros p/ codgrupo_agrupamento_rcb=codrcb-do-consolidado (senão os grupos
 * legados não seriam reconhecidos aqui e o consolidado legado, ORIGEM=NULL, não seria travado no travarEditavel).
 * (b) elegibilidade mais ESTRITA que a busca do legado (que só exclui AGRUPADO/QUITADA): também barra
 * CONTABILIZADO (evita duplo-contábil) e IDNF (evita agrupar título gerido pela NF) — endurecimento consciente.
 *
 * ADIADO (documentado): tabela de snapshot AGRUPARECEBER (backup p/ boleto/remessa/histórico), fluxo CONVÊNIO
 * (agrupa AR → gera A PAGAR do funcionário, CODGRUPO_AGRUPAMENTO_APG), taxa ADM, desconto, contábil do
 * agrupamento (CONTABILIZADO_AGRUPAMENTO), e o gêmeo A PAGAR (AGRUPAPAGAR) — corte-2.
 */
@Injectable()
export class AreceberAgrupamentoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** agrupa `codrcbs` (≥2, mesmo cliente, abertos) num consolidado ORIGEM='A' (valor = Σ). */
  async agrupar(dto: { codrcbs: number[]; dtvenc?: string; obs?: string }): Promise<{ codgrupo: number; consolidado: number; membros: number; total: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const ids = [...new Set((dto.codrcbs ?? []).map(Number).filter((n) => Number.isFinite(n)))];
    if (ids.length < 2) throw new BusinessRuleError('AGRUPAMENTO_MINIMO_2');

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const membros = (await trx
        .selectFrom('areceber')
        .select(['codrcb', 'codparceiro', 'valor', 'quitada', 'agrupado', 'contabilizado', 'idnf'])
        .where('codrcb', 'in', ids).where('codempresa', '=', emp)
        .forUpdate().execute()) as Array<Record<string, unknown>>;
      if (membros.length !== ids.length) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO');

      // estado POR-TÍTULO primeiro (um título inelegível é um erro do título), depois a coesão de cliente.
      for (const m of membros) {
        if (m.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO', { codrcb: m.codrcb });
        if (m.agrupado === 'S') throw new BusinessRuleError('TITULO_AGRUPADO', { codrcb: m.codrcb });
        if (m.contabilizado === 'S') throw new BusinessRuleError('TITULO_CONTABILIZADO', { codrcb: m.codrcb });
        if (m.idnf != null) throw new BusinessRuleError('TITULO_DE_NF', { codrcb: m.codrcb });
      }
      const parceiros = new Set(membros.map((m) => Number(m.codparceiro)));
      if (parceiros.size !== 1) throw new BusinessRuleError('AGRUPAMENTO_PARCEIROS_DIVERSOS');
      const codparceiro = Number(membros[0].codparceiro);
      const total = r2(membros.reduce((s, m) => s + num(m.valor), 0));
      // venc do consolidado: o informado, senão HOJE (fiel a uAgrupa:326 DTVENDA=DTVENC=now). NÃO o maior venc
      // dos membros — senão o consolidado nasceria VENCIDO e a view acumularia juros sobre a soma inteira.
      const dtvenc = dto.dtvenc ?? null;
      const e = await trx.selectFrom('empresas').select('txjuropadrao').where('idempresa', '=', emp).executeTakeFirst();

      const ins = await trx
        .insertInto('areceber')
        .values({
          codempresa: emp, codparceiro, valor: total, txjuros: (e as any)?.txjuropadrao ?? null,
          dtvenda: sql`current_date`, dtvenc: dtvenc ?? sql`current_date`, tipodoc: 'DUPLICATA', origem: 'A',
          quitada: 'N', agrupado: 'N', consiliado: 'S', cadastrado_manualmente: 'N', gerado: 'SISTEMA',
          obs: dto.obs ?? `Agrupamento de ${ids.length} títulos do cliente ${codparceiro}.`,
          data_agrupamento: sql`now()`, usultalteracao: op, dtultimalteracao: sql`now()`, dtcadastro: sql`now()`,
        })
        .returning('codrcb').executeTakeFirstOrThrow();
      const codConsolidado = Number((ins as any).codrcb);

      await trx
        .updateTable('areceber')
        .set({ agrupado: 'S', codgrupo_agrupamento_rcb: codConsolidado, data_agrupamento: sql`now()`, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codrcb', 'in', ids).where('codempresa', '=', emp).execute();

      return { codgrupo: codConsolidado, consolidado: codConsolidado, membros: ids.length, total };
    });
  }

  /** trava do consolidado: existe, é ORIGEM='A', não quitado/baixado/em-lote/contabilizado. */
  private async travarConsolidado(trx: AnyDB, emp: number, codConsolidado: number): Promise<Record<string, unknown>> {
    const c = (await trx
      .selectFrom('areceber')
      .select(['codrcb', 'valor', 'origem', 'quitada', 'contabilizado'])
      .where('codrcb', '=', codConsolidado).where('codempresa', '=', emp)
      .forUpdate().executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!c) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codrcb: codConsolidado });
    if (String(c.origem ?? '') !== 'A') throw new BusinessRuleError('NAO_E_AGRUPAMENTO', { codrcb: codConsolidado });
    if (c.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO', { codrcb: codConsolidado });
    if (c.contabilizado === 'S') throw new BusinessRuleError('TITULO_CONTABILIZADO', { codrcb: codConsolidado });
    // só baixa ATIVA (indr='I') bloqueia — o estorno marca indr='E' e mantém a linha (fiel a UBaixaAreceber);
    // sem esse filtro, um consolidado baixado-e-estornado ficaria travado p/ reverter para sempre.
    const bx = await trx.selectFrom('areceber_bx').select('codrcbbx').where('codrcb', '=', codConsolidado).where(sql`coalesce(indr,'I')`, '=', 'I').executeTakeFirst();
    if (bx) throw new BusinessRuleError('AGRUPAMENTO_BAIXADO', { codrcb: codConsolidado });
    const lote = await trx.selectFrom('itens_lotecob').select('codilotcob').where('codrcb', '=', codConsolidado).executeTakeFirst();
    if (lote) throw new BusinessRuleError('TITULO_EM_LOTE', { codrcb: codConsolidado });
    return c;
  }

  /** desfaz o agrupamento inteiro: limpa os membros (AGRUPADO='N') e apaga o consolidado. */
  async reverter(codConsolidado: number): Promise<{ revertido: true; consolidado: number; membros: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.travarConsolidado(trx, emp, codConsolidado);
      const membros = (await trx
        .selectFrom('areceber').select('codrcb')
        .where('codgrupo_agrupamento_rcb', '=', codConsolidado).where('codempresa', '=', emp)
        .execute()) as Array<{ codrcb: number }>;
      if (membros.length === 0) throw new BusinessRuleError('AGRUPAMENTO_SEM_MEMBROS', { codrcb: codConsolidado });
      await trx
        .updateTable('areceber')
        .set({ agrupado: 'N', codgrupo_agrupamento_rcb: null, data_agrupamento: null, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codgrupo_agrupamento_rcb', '=', codConsolidado).where('codempresa', '=', emp).execute();
      await trx.deleteFrom('areceber').where('codrcb', '=', codConsolidado).where('codempresa', '=', emp).execute();
      return { revertido: true as const, consolidado: codConsolidado, membros: membros.length };
    });
  }

  /** remove UM membro do grupo: libera o título (AGRUPADO='N') e abate o valor do consolidado. Não pode remover
   *  o último membro (use reverter). */
  async removerTitulo(codConsolidado: number, codMembro: number): Promise<{ consolidado: number; removido: number; novoValor: number; membrosRestantes: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const c = await this.travarConsolidado(trx, emp, codConsolidado);
      const membro = (await trx
        .selectFrom('areceber').select(['codrcb', 'valor', 'codgrupo_agrupamento_rcb'])
        .where('codrcb', '=', codMembro).where('codempresa', '=', emp)
        .forUpdate().executeTakeFirst()) as Record<string, unknown> | undefined;
      if (!membro || Number(membro.codgrupo_agrupamento_rcb) !== codConsolidado) throw new BusinessRuleError('TITULO_NAO_PERTENCE_AGRUPAMENTO', { codrcb: codMembro });

      const totalMembros = Number(((await trx
        .selectFrom('areceber').select(sql<number>`count(*)`.as('n'))
        .where('codgrupo_agrupamento_rcb', '=', codConsolidado).where('codempresa', '=', emp)
        .executeTakeFirst()) as any).n);
      if (totalMembros <= 1) throw new BusinessRuleError('AGRUPAMENTO_REMOVER_ULTIMO', { codrcb: codConsolidado }); // use reverter

      const novoValor = r2(num(c.valor) - num(membro.valor));
      await trx.updateTable('areceber').set({ valor: novoValor, usultalteracao: op, dtultimalteracao: sql`now()` }).where('codrcb', '=', codConsolidado).where('codempresa', '=', emp).execute();
      await trx.updateTable('areceber').set({ agrupado: 'N', codgrupo_agrupamento_rcb: null, data_agrupamento: null, usultalteracao: op, dtultimalteracao: sql`now()` }).where('codrcb', '=', codMembro).where('codempresa', '=', emp).execute();
      return { consolidado: codConsolidado, removido: codMembro, novoValor, membrosRestantes: totalMembros - 1 };
    });
  }

  /** lista os membros de um agrupamento (consulta). */
  async membros(codConsolidado: number): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    return (await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('areceber').select(['codrcb', 'codparceiro', 'valor', 'dtvenc', 'duplicata'])
      .where('codgrupo_agrupamento_rcb', '=', codConsolidado).where('codempresa', '=', emp)
      .orderBy('codrcb').execute()) as Array<Record<string, unknown>>;
  }
}
