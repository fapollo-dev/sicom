import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { parseOfx } from './ofx-parser';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const dia = (v: unknown) => String(v ?? '').slice(0, 10); // 'YYYY-MM-DD'

/**
 * CONCILIAÇÃO BANCÁRIA (OFX) — corte-1. `importar`: grava as linhas do extrato (já parseadas) em
 * movimentacao_bancaria_ofx, com dedup por (codconta, transacao_id, check_num). `pendentes`: extrato não-conciliado ×
 * razão interno (mov_contas_bancarias) não-conciliado da conta. `sugerir`: casamento automático por DATA(dia)+VALOR
 * (greedy 1:1, fiel ao ConciliacaoAutomatica). `conciliar`: dado N linhas OFX + N lançamentos do razão com Σ valores
 * IGUAIS, cria 1 evento CB + as 2 junções e marca os DOIS lados conciliados. Tenant fail-closed. Estorno NÃO existe
 * no legado (cópia-fiel-negativa). `importarArquivo` (corte-2) parseia o .ofx cru (ver ofx-parser). Ramos
 * A-PAGAR/A-RECEBER por IDLOTE = **feitos no corte-3 (mig 276)**: `sugerir` casa o LOTE inteiro contra um
 * movimento do extrato (soma do lote = valor da linha, mesmo dia e direção) antes do 1:1, e `conciliar`
 * recusa seleção com lote pela metade (422 LOTE_INCOMPLETO) — a trava `ValidaSelecaoLoteCompleto` do legado.
 */
@Injectable()
export class ConciliacaoBancariaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op(): number {
    const o = currentTenant().operadorId ?? null;
    if (o == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return o;
  }
  private async contaDaEmpresa(db: AnyDB, codconta: number, emp: number) {
    const c = await db.selectFrom('contas_bancarias').select('codconta').where('codconta', '=', codconta).where('idempresa', '=', emp).executeTakeFirst();
    if (!c) throw new BusinessRuleError('CONTA_NAO_ENCONTRADA', { codconta });
  }

  /** importa as linhas do extrato (dedup por FITID). Retorna quantas entraram e quantas eram duplicadas. */
  async importar(dto: { codconta: number; nomeArquivo?: string; linhas: Array<{ data: string; valor: number; credito_debito: 'C' | 'D'; descricao?: string; transacao_id?: string; check_num?: string }> }): Promise<{ codconta: number; inseridas: number; duplicadas: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.contaDaEmpresa(trx, dto.codconta, emp);
      let inseridas = 0;
      let duplicadas = 0;
      for (const l of dto.linhas) {
        // fold auditoria [BAIXA]: FITID vazio/espaços → null (senão 2 linhas '' + mesmo check_num furam o unique
        // ux_mbo_fitid com 23505 cru; null vira NULLS-DISTINCT, fiel ao legado que só deduplica com transacao_id≠''/0).
        const fit = (l.transacao_id ?? '').trim() || null;
        const chk = (l.check_num ?? '').trim() || null;
        // dedup por (conta, transacao, check) — só quando há FITID (fiel: transacao_id ≠ ''/0).
        if (fit) {
          const ex = await trx.selectFrom('movimentacao_bancaria_ofx').select('mbo_id').where('codconta', '=', dto.codconta).where('mbo_transacao_id', '=', fit).where((eb: any) => (chk ? eb('mbo_check_num', '=', chk) : eb('mbo_check_num', 'is', null))).executeTakeFirst();
          if (ex) { duplicadas++; continue; }
        }
        await trx.insertInto('movimentacao_bancaria_ofx').values({
          idempresa: emp, codconta: dto.codconta, mbo_data: l.data, mbo_valor: r2(num(l.valor)), mbo_credito_debito: l.credito_debito,
          mbo_descricao: l.descricao ?? null, mbo_transacao_id: fit, mbo_check_num: chk, mbo_conciliado: 'N',
          mbo_nome_arquivo: dto.nomeArquivo ?? null, mbo_data_importacao: sql`now()`, codoperador_importacao: op, dtcadastro: sql`now()`,
        }).execute();
        inseridas++;
      }
      return { codconta: dto.codconta, inseridas, duplicadas };
    });
  }

  /** corte-2: recebe o TEXTO do arquivo .ofx, parseia (OFX 1.x SGML / 2.x XML) e reusa `importar` (dedup por FITID).
   *  Retorna também quantas linhas o parser extraiu, para o cliente distinguir "arquivo sem transações" de "tudo duplicado". */
  async importarArquivo(dto: { codconta: number; nomeArquivo?: string; conteudo: string }): Promise<{ codconta: number; lidas: number; inseridas: number; duplicadas: number }> {
    const linhas = parseOfx(dto.conteudo);
    if (linhas.length === 0) throw new BusinessRuleError('OFX_SEM_TRANSACOES');
    const r = await this.importar({ codconta: dto.codconta, nomeArquivo: dto.nomeArquivo, linhas });
    return { ...r, lidas: linhas.length };
  }

  /** pendentes: linhas do extrato não-conciliadas × lançamentos do razão não-conciliados da conta. */
  async pendentes(codconta: number): Promise<{ ofx: Record<string, unknown>[]; mov: Record<string, unknown>[] }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.contaDaEmpresa(db, codconta, emp);
    const ofx = (await db.selectFrom('movimentacao_bancaria_ofx').select(['mbo_id', 'mbo_data', 'mbo_valor', 'mbo_credito_debito', 'mbo_descricao', 'mbo_transacao_id']).where('codconta', '=', codconta).where('idempresa', '=', emp).where(sql`coalesce(mbo_conciliado,'N')`, '=', 'N').orderBy('mbo_data').orderBy('mbo_id').limit(2000).execute()) as Record<string, unknown>[];
    const mov = (await db.selectFrom('mov_contas_bancarias').select(['codmovconta', 'data_fechamento as data', 'valor', 'tipomovimento', 'historico', 'origem', 'idlote']).where('codconta', '=', codconta).where('idempresa', '=', emp).where(sql`coalesce(mov_conciliado,'N')`, '=', 'N').orderBy('data_fechamento').orderBy('codmovconta').limit(2000).execute()) as Record<string, unknown>[];
    return { ofx, mov };
  }

  /** sugestão automática: casa (data-dia + valor + DIREÇÃO) greedy 1:1 entre extrato e razão pendentes. A direção
   *  importa (fold auditoria [MÉDIA]): um crédito do extrato (C) só casa com um crédito do razão (tipomovimento='C')
   *  — senão um depósito casaria com um saque de mesmo valor. Bucketizado (O(n+m), fold [BAIXA] perf). */
  async sugerir(codconta: number): Promise<{
    pares: Array<{ mbo_id: number; codmovconta: number; valor: number; data: string }>;
    lotes: Array<{ mbo_id: number; idlote: number; codmovcontas: number[]; valor: number; data: string }>;
  }> {
    const { ofx, mov } = await this.pendentes(codconta);
    const bucket = new Map<string, number[]>();
    for (const o of ofx) {
      const k = `${dia(o.mbo_data)}|${r2(num(o.mbo_valor))}|${String(o.mbo_credito_debito ?? '')}`;
      (bucket.get(k) ?? bucket.set(k, []).get(k)!).push(Number(o.mbo_id));
    }
    const pares: Array<{ mbo_id: number; codmovconta: number; valor: number; data: string }> = [];
    const lotes: Array<{ mbo_id: number; idlote: number; codmovcontas: number[]; valor: number; data: string }> = [];

    // corte-3 (mig 276): PRIMEIRO o LOTE inteiro. Uma baixa em lote (N títulos num pagamento só) vira UM
    // movimento no extrato — casar linha a linha não fecharia. Agrupa por (lote, dia, direção) e procura no
    // extrato uma linha com a SOMA do lote. Os lotes vêm antes para não terem suas linhas consumidas pelo 1:1.
    const porLote = new Map<string, { idlote: number; data: string; dir: string; total: number; ids: number[] }>();
    for (const m of mov) {
      const lote = m.idlote == null ? null : Number(m.idlote);
      if (lote == null) continue;
      const k = `${lote}|${dia(m.data)}|${String(m.tipomovimento ?? '')}`;
      const g = porLote.get(k) ?? { idlote: lote, data: dia(m.data), dir: String(m.tipomovimento ?? ''), total: 0, ids: [] };
      g.total = r2(g.total + num(m.valor));
      g.ids.push(Number(m.codmovconta));
      porLote.set(k, g);
    }
    const consumidos = new Set<number>();
    for (const g of porLote.values()) {
      if (g.ids.length < 2) continue; // lote de 1 linha é o caso 1:1 normal
      const arr = bucket.get(`${g.data}|${g.total}|${g.dir}`);
      if (arr && arr.length) {
        const mboId = arr.shift() as number;
        lotes.push({ mbo_id: mboId, idlote: g.idlote, codmovcontas: g.ids, valor: g.total, data: g.data });
        for (const id of g.ids) consumidos.add(id);
      }
    }

    for (const m of mov) {
      if (consumidos.has(Number(m.codmovconta))) continue;
      const k = `${dia(m.data)}|${r2(num(m.valor))}|${String(m.tipomovimento ?? '')}`;
      const arr = bucket.get(k);
      if (arr && arr.length) {
        const mboId = arr.shift() as number;
        pares.push({ mbo_id: mboId, codmovconta: Number(m.codmovconta), valor: r2(num(m.valor)), data: dia(m.data) });
      }
    }
    return { pares, lotes };
  }

  /** concilia N linhas OFX ↔ N lançamentos do razão (Σ valores iguais) → 1 evento CB + junções + marca os dois lados. */
  async conciliar(dto: { codconta: number; mboIds: number[]; codmovcontas: number[] }): Promise<{ cb_id: number; ofx: number; mov: number; total: number }> {
    const emp = this.emp();
    const op = this.op();
    const mboIds = Array.from(new Set(dto.mboIds.map(Number)));
    const movIds = Array.from(new Set(dto.codmovcontas.map(Number)));
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.contaDaEmpresa(trx, dto.codconta, emp);
      // trava + valida as linhas do extrato (da conta, não-conciliadas).
      const ofx = (await trx.selectFrom('movimentacao_bancaria_ofx').select(['mbo_id', 'mbo_valor', 'mbo_credito_debito']).where('mbo_id', 'in', mboIds).where('codconta', '=', dto.codconta).where('idempresa', '=', emp).where(sql`coalesce(mbo_conciliado,'N')`, '=', 'N').forUpdate().execute()) as Array<{ mbo_id: number; mbo_valor: unknown; mbo_credito_debito: string }>;
      if (ofx.length !== mboIds.length) throw new BusinessRuleError('OFX_LINHA_INDISPONIVEL', { esperado: mboIds.length, achado: ofx.length });
      // trava + valida os lançamentos do razão (da conta, não-conciliados).
      const mov = (await trx.selectFrom('mov_contas_bancarias').select(['codmovconta', 'valor', 'tipomovimento', 'idlote']).where('codmovconta', 'in', movIds).where('codconta', '=', dto.codconta).where('idempresa', '=', emp).where(sql`coalesce(mov_conciliado,'N')`, '=', 'N').forUpdate().execute()) as Array<{ codmovconta: number; valor: unknown; tipomovimento: string }>;
      if (mov.length !== movIds.length) throw new BusinessRuleError('MOV_LANCAMENTO_INDISPONIVEL', { esperado: movIds.length, achado: mov.length });

      // corte-3 (mig 276): **o LOTE não se concilia pela metade**. `ValidaSelecaoLoteCompleto` do legado
      // (UDMConciliacaoBancaria.pas) acusa 'O lote %d não foi conciliado totalmente' e desmarca o lote inteiro.
      // Uma baixa em lote vira UM movimento no extrato: conciliar parte casaria valor errado e deixaria o resto
      // órfão, sem o movimento do banco para casar depois. No cliente, 206.211 de 291.484 lançamentos têm lote.
      const lotesSelecionados = Array.from(new Set(mov.map((m: any) => (m.idlote == null ? null : Number(m.idlote))).filter((l): l is number => l != null)));
      for (const lote of lotesSelecionados) {
        const doLote = (await trx.selectFrom('mov_contas_bancarias').select(['codmovconta'])
          .where('codconta', '=', dto.codconta).where('idempresa', '=', emp).where('idlote', '=', lote)
          .where(sql`coalesce(mov_conciliado, 'N')`, '=', 'N').execute()) as Array<{ codmovconta: number }>;
        const faltando = doLote.map((l) => Number(l.codmovconta)).filter((id) => !movIds.includes(id));
        if (faltando.length) {
          throw new BusinessRuleError('LOTE_INCOMPLETO', { idlote: lote, selecionados: doLote.length - faltando.length, faltando });
        }
      }
      // Σ valores COM SINAL iguais (fold auditoria [MÉDIA]: débito conta negativo, crédito positivo — senão uma
      // seleção mista C/D fecharia por magnitude mas com direções trocadas). Fiel: total interno = total OFX.
      const totalOfx = r2(ofx.reduce((s, o) => s + (String(o.mbo_credito_debito) === 'D' ? -num(o.mbo_valor) : num(o.mbo_valor)), 0));
      const totalMov = r2(mov.reduce((s, m) => s + (String(m.tipomovimento) === 'D' ? -num(m.valor) : num(m.valor)), 0));
      if (totalOfx !== totalMov) throw new BusinessRuleError('CONCILIACAO_TOTAIS_DIVERGENTES', { totalOfx, totalMov });

      const cb = await trx.insertInto('conciliacao_bancaria').values({ idempresa: emp, codconta: dto.codconta, cb_data: sql`now()`, cb_operador: op }).returning('cb_id').executeTakeFirstOrThrow();
      const cbId = Number((cb as any).cb_id);
      for (const o of ofx) {
        await trx.insertInto('conciliacao_bancaria_ofx').values({ cb_id: cbId, mbo_id: o.mbo_id }).execute();
        await trx.updateTable('movimentacao_bancaria_ofx').set({ mbo_conciliado: 'S' }).where('mbo_id', '=', o.mbo_id).where('idempresa', '=', emp).execute();
      }
      for (const m of mov) {
        await trx.insertInto('conciliacao_bancaria_mov').values({ cb_id: cbId, codmovconta: m.codmovconta }).execute();
        await trx.updateTable('mov_contas_bancarias').set({ mov_conciliado: 'S' }).where('codmovconta', '=', m.codmovconta).where('idempresa', '=', emp).execute();
      }
      return { cb_id: cbId, ofx: ofx.length, mov: mov.length, total: totalOfx };
    });
  }
}
