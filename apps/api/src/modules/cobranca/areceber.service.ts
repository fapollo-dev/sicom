import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { assertPeriodoNaoFechado } from '../shared/periodo-contabil';

type AnyDB = Kysely<any>;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** soma `days` dias a uma data ISO 'YYYY-MM-DD' (aritmética em UTC → sem drift de fuso). */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** soma `months` meses a uma data ISO, fixando o dia-do-mês (`fixedDay` ?? dia de `iso`) e clampando ao
 *  último dia do mês-alvo (fiel ao IncMonth do Delphi: 31/jan +1 mês → 28/29 fev). */
function addMonthsClamped(iso: string, months: number, fixedDay?: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dia = fixedDay ?? d;
  const idx = (m - 1) + months;
  const ty = y + Math.floor(idx / 12);
  const tm = ((idx % 12) + 12) % 12; // 0..11
  const ultimoDia = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const diaClamp = Math.min(dia, ultimoDia);
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(diaClamp).padStart(2, '0')}`;
}

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

  /**
   * T1.6 — GERA N parcelas manuais a partir de um TOTAL (uCadAReceber.btnGeraParcelasClick:700 + BuildParcelas).
   * Uma única transação: 1 trava de período (na dtvenda) + 1 default de txjuros, depois N inserts. Cada título
   * = valor da parcela (rateio round(total/N), sobra na 1ª — mesmo motor do pedido), dtvenc calculada (modo
   * intervalo-dias OU dia-fixo-mensal), duplicata "i/N". Σ parcelas == total. Devolve os títulos criados.
   */
  async gerarParcelas(dto: Record<string, unknown>): Promise<{ parcelas: number; total: number; codrcbs: number[]; titulos: Array<Record<string, unknown> | undefined> }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;

    const numparc = Number(dto.numparc);
    const total = Number(dto.total);
    const venc1 = String(dto.venc1);
    const dtvenda = String(dto.dtvenda);
    const intervalo = dto.intervalo != null ? Number(dto.intervalo) : 0;
    const diafixo = dto.diafixo != null ? Number(dto.diafixo) : undefined;
    const prefixo = dto.prefixoDuplicata != null ? String(dto.prefixoDuplicata).trim() : '';

    // datas: intervalo>0 → soma dias (diafixo é ignorado); senão → mensal no dia-do-mês de venc1 (ou diafixo),
    // clampando fim-de-mês. `vencimentos[0]` é sempre o MAIS CEDO (ambos os modos crescem).
    const vencimentos: string[] = [];
    for (let i = 0; i < numparc; i++) {
      vencimentos.push(intervalo > 0 ? addDays(venc1, i * intervalo) : addMonthsClamped(venc1, i, diafixo));
    }
    // venc≥venda (uCadAReceber:958): no modo dia-fixo, um `diafixo` menor que o dia de venc1 pode jogar a 1ª
    // parcela para ANTES da dtvenda — o schema só valida venc1, então reforça aqui sobre a data efetiva.
    if (vencimentos[0] < dtvenda.slice(0, 10)) throw new BusinessRuleError('PARCELA_VENC_ANTERIOR_VENDA', { venc: vencimentos[0], dtvenda });
    // rateio: floor(total/N) por parcela + a SOBRA (sempre ≥ 0) na PRIMEIRA (RatearTotalNasParcelas:8941).
    // floor (não round) garante que a 1ª é a MAIOR e nenhuma parcela fica ≤ 0 — round poderia deixar resíduo
    // negativo e zerar/negativar a 1ª, furando a invariante valor>0 da AR (o insert em lote burla o schema).
    // Guarda: cada parcela precisa de ≥ 1 centavo (senão AR title com valor 0). Σ == total.
    const totalCents = Math.round(total * 100);
    if (totalCents < numparc) throw new BusinessRuleError('PARCELA_VALOR_INSUFICIENTE', { total: r2(total), numparc });
    const porCents = Math.floor(totalCents / numparc);
    const residuo = totalCents - porCents * numparc; // ∈ [0, numparc-1]
    const valores: number[] = [];
    for (let i = 0; i < numparc; i++) valores.push((porCents + (i === 0 ? residuo : 0)) / 100);

    // campos de cabeçalho compartilhados (só os presentes).
    const cab: Record<string, unknown> = {};
    for (const c of ['codparceiro', 'tipodoc', 'txjuros', 'txmulta', 'desconto_boleto', 'codvendedor', 'codcobrador', 'idpgto', 'codbco', 'codplc', 'nroped', 'obs'] as const) {
      if (dto[c] !== undefined) cab[c] = dto[c];
    }

    const codrcbs = await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // trava de período contábil fechado (uma vez, na dtvenda × BLOQ_RCB).
      await assertPeriodoNaoFechado(trx, emp, dtvenda, 'bloq_rcb');
      // txjuros default = snapshot da EMPRESAS.TXJUROPADRAO (uma vez).
      if (cab.txjuros == null) {
        const e = await trx.selectFrom('empresas').select('txjuropadrao').where('idempresa', '=', emp).executeTakeFirst();
        cab.txjuros = (e as { txjuropadrao?: unknown } | undefined)?.txjuropadrao ?? null;
      }
      const ids: number[] = [];
      for (let i = 0; i < numparc; i++) {
        const dup = `${prefixo ? prefixo + ' - ' : ''}${String(i + 1).padStart(3, '0')}/${String(numparc).padStart(3, '0')}`.slice(0, 20);
        const ins = await trx
          .insertInto('areceber')
          .values({
            ...cab,
            dtvenda,
            dtvenc: vencimentos[i],
            valor: valores[i],
            nrodup: i + 1,
            duplicata: dup,
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
        ids.push(Number((ins as Record<string, unknown>).codrcb));
      }
      return ids;
    });

    const titulos = await Promise.all(codrcbs.map((id) => this.read(id)));
    return { parcelas: numparc, total: r2(total), codrcbs, titulos };
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
    if (String(t.origem ?? '') === 'A') throw new BusinessRuleError('TITULO_AGRUPAMENTO'); // consolidado — use reverter
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
