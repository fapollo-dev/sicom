import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { assertPeriodoNaoFechado } from '../shared/periodo-contabil';

type AnyDB = Kysely<any>;

/**
 * CONTAS A RECEBER — corte-1 (cadastro/gestão do título). Módulo VERTICAL (não o engine
 * declarativo) porque ARECEBER usa CODEMPRESA (≠ IDEMPRESA que o engine assume) e tem travas
 * de estado próprias — mesma decisão do Lote de Cobrança. Molde de tenant/transação/erro dos
 * serviços da NF (`nf-faturamento.service.ts`): forTenant + BusinessRuleError→422 + fail-closed.
 *
 * Escopo: list/read (via view get_areceber, juros/total já calculados), create (título manual),
 * update/delete com TRAVAS de estado (uCadAReceber VerificaBloqueio/VerificaContabilizado):
 * QUITADA='S' / AGRUPADO='S' / CONTABILIZADO='S' / vindo de NF (IDNF) bloqueiam editar e excluir.
 * A BAIXA é o corte-2.
 */
@Injectable()
export class AreceberService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN'); // fail-closed (título é por empresa)
    return e;
  }

  /** whitelist de colunas filtráveis/ordenáveis da Pesquisa (anti-injection). */
  private static readonly PESQUISA = new Set([
    'codrcb', 'duplicata', 'razao', 'dtvenc', 'dtvenda', 'valor', 'quitada', 'tipodoc',
  ]);

  /** Listagem: view get_areceber, sempre no escopo da empresa + filtro campo/operador/valor + situação. */
  async list(query: Record<string, string | undefined>): Promise<Record<string, unknown>[]> {
    const emp = this.emp();
    let q = (this.dbp.forTenantRead() as AnyDB).selectFrom('get_areceber').selectAll().where('codempresa', '=', emp);

    // situação (F3 do legado): abertos (não quitado e não agrupado) / liquidados / agrupados / todos.
    switch (query.situacao) {
      case 'liquidados':
        q = q.where('quitada', '=', 'S');
        break;
      case 'agrupados':
        q = q.where('agrupado', '=', 'S');
        break;
      case 'abertos':
        q = q.where(sql`coalesce(quitada,'N')`, '=', 'N').where(sql`coalesce(agrupado,'N')`, '=', 'N');
        break;
      // 'todos' / ausente → sem filtro de estado
    }

    const campo = query.campo;
    if (campo && AreceberService.PESQUISA.has(campo) && query.valor != null && query.valor !== '') {
      const col = sql.ref(campo);
      const v = query.valor;
      switch (query.operador ?? 'contem') {
        case 'igual': q = q.where(col as any, '=', v); break;
        case 'comeca': q = q.where(sql`upper(${col})`, 'like', `${v.toUpperCase()}%`); break;
        default: q = q.where(sql`upper(${col})`, 'like', `%${v.toUpperCase()}%`); break;
      }
    }
    if (query.orderBy && AreceberService.PESQUISA.has(query.orderBy)) {
      q = q.orderBy(sql.ref(query.orderBy), query.orderDir === 'desc' ? 'desc' : 'asc');
    } else {
      q = q.orderBy('dtvenc', 'asc');
    }
    return q.limit(Math.min(Number(query.limite) || 200, 500)).execute();
  }

  /** Leitura por código (escopo empresa). */
  async read(id: number): Promise<Record<string, unknown> | undefined> {
    return (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('get_areceber')
      .selectAll()
      .where('codrcb', '=', id)
      .where('codempresa', '=', this.emp())
      .executeTakeFirst();
  }

  /** Colunas que o usuário edita (delta) — nunca codrcb/codempresa/estado. */
  private static readonly COLUNAS = [
    'codparceiro', 'dtvenda', 'dtvenc', 'valor', 'txjuros', 'txmulta', 'desconto_boleto',
    'nrodup', 'duplicata', 'tipodoc', 'nroped', 'nrocupom',
    'codvendedor', 'codcobrador', 'idpgto', 'codbco', 'codplc', 'idsituacao_nf', 'obs',
  ];
  private delta(dto: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const c of AreceberService.COLUNAS) if (dto[c] !== undefined) out[c] = dto[c];
    return out;
  }

  /** Cria um título MANUAL (cadastrado_manualmente='S', gerado='OPERADOR', quitada='N'). */
  async criar(dto: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const id = await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const d = this.delta(dto);
      // trava de período contábil fechado (ValidaPeriodoFechado, DTVENDA × BLOQ_RCB).
      await assertPeriodoNaoFechado(trx, emp, d.dtvenda, 'bloq_rcb');
      // txjuros default = snapshot da EMPRESAS.TXJUROPADRAO (uCadAReceber: default do padrão da empresa).
      if (d.txjuros == null) {
        const e = await trx.selectFrom('empresas').select('txjuropadrao').where('idempresa', '=', emp).executeTakeFirst();
        d.txjuros = e?.txjuropadrao ?? null;
      }
      const ins = await trx
        .insertInto('areceber')
        .values({
          ...d,
          codempresa: emp,
          quitada: 'N',
          agrupado: 'N',
          consiliado: 'S',
          cadastrado_manualmente: 'S',
          gerado: 'OPERADOR',
          usultalteracao: op,
          dtultimalteracao: sql`now()`,
          dtcadastro: sql`now()`,
        })
        .returning('codrcb')
        .executeTakeFirstOrThrow();
      return Number((ins as Record<string, unknown>).codrcb);
    });
    return this.read(id);
  }

  // origens geradas por OUTRO processo (getter ORIGEM legado) — não editáveis pela tela
  // (uCadAReceber VerificaCRCadastradaAutomaticamente :4148 / btnExcluir :3557): Q=quebra de caixa,
  // O=convênio funcionário, C=(fechamento/caixa). B (baixa parcial) e F (faturamento) têm trava própria.
  private static readonly ORIGEM_AUTO = new Set(['Q', 'O', 'C']);

  /**
   * Trava de estado + posse (uCadAReceber VerificaBloqueio :4166 / VerificaContabilizado :4083 /
   * btnExcluir :3524-3644): lê e TRAVA o título (FOR UPDATE, escopo empresa) e barra edição/exclusão de
   * título com efeito. Além de quitado/agrupado/contabilizado/de-NF: origem automática ('Q'/'O'/'C') e
   * conciliado-na-tesouraria (só quando NÃO é manual — o legado :3585 exige CADASTRADO_MANUALMENTE<>'S').
   */
  private async travarEditavel(trx: AnyDB, id: number, emp: number) {
    const t = await trx
      .selectFrom('areceber')
      .select(['codrcb', 'quitada', 'agrupado', 'contabilizado', 'idnf', 'origem', 'consiliado', 'cadastrado_manualmente', 'dtvenda'])
      .where('codrcb', '=', id)
      .where('codempresa', '=', emp)
      .forUpdate()
      .executeTakeFirst();
    if (!t) throw new BusinessRuleError('TITULO_NAO_ENCONTRADO', { codrcb: id });
    if (t.quitada === 'S') throw new BusinessRuleError('TITULO_JA_BAIXADO'); // baixado — estorne a baixa antes
    if (t.agrupado === 'S') throw new BusinessRuleError('TITULO_AGRUPADO'); // remova do agrupamento antes
    if (t.contabilizado === 'S') throw new BusinessRuleError('TITULO_CONTABILIZADO');
    if (t.idnf != null) throw new BusinessRuleError('TITULO_DE_NF', { idnf: t.idnf }); // gerido pela NF
    if (t.origem != null && AreceberService.ORIGEM_AUTO.has(String(t.origem)))
      throw new BusinessRuleError('TITULO_ORIGEM_AUTO', { origem: t.origem });
    if (t.consiliado === 'S' && t.cadastrado_manualmente !== 'S')
      throw new BusinessRuleError('TITULO_CONCILIADO');
    return t;
  }

  async atualizar(id: number, dto: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const t = await this.travarEditavel(trx, id, emp);
      // período fechado × BLOQ_RCB — o legado trava a ABERTURA da edição pela data ATUAL (uCadAReceber:3470)
      // E o SALVAR pela data nova (:965). Barrar se a DTVENDA gravada OU a nova cair em período fechado
      // (senão dá para "resgatar"/mover um título ancorado num período já fechado).
      await assertPeriodoNaoFechado(trx, emp, t.dtvenda, 'bloq_rcb');
      if (dto.dtvenda != null) await assertPeriodoNaoFechado(trx, emp, dto.dtvenda, 'bloq_rcb');
      const d = this.delta(dto);
      if (Object.keys(d).length) {
        await trx
          .updateTable('areceber')
          .set({ ...d, usultalteracao: op, dtultimalteracao: sql`now()` })
          .where('codrcb', '=', id)
          .where('codempresa', '=', emp)
          .execute();
      }
    });
    return this.read(id);
  }

  async excluir(id: number): Promise<void> {
    const emp = this.emp();
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const t = await this.travarEditavel(trx, id, emp);
      await assertPeriodoNaoFechado(trx, emp, t.dtvenda, 'bloq_rcb'); // não excluir título de período fechado
      await trx.deleteFrom('areceber').where('codrcb', '=', id).where('codempresa', '=', emp).execute();
    });
  }
}
