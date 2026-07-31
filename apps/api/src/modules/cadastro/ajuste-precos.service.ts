import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
/** formato do legado no HISTORICO_DINAMICO: vírgula + 2 decimais ('11,29') — 31.119/31.119 linhas do golden. */
const fmtBr = (n: number) => n.toFixed(2).replace('.', ',');

/**
 * AJUSTE DE PREÇOS - LOTE (FRMAJUSTEPRECOS) — o PROCESSADOR da fila lote_preco. `fila`: pendentes (PROCESSADO='N',
 * indr≠'E') da empresa por período/origem, com o preço ATUAL (multi_preco por empresa do lote) ao lado do proposto.
 * `processar` (fiel a btnProcessarClick, ordem codlotepreco ASC — lotes múltiplos aplicam do mais antigo ao mais
 * novo, o último vence): por lote, numa transação: marca PROCESSADO='S'/manual/data/operador (SEMPRE, mesmo com
 * vrvenda<=0 — fiel), grava HISTORICO_DINAMICO (campo VRVENDA, valor anterior→atual) e, se VRVENDA>0, UPDATE
 * multi_preco SET vrvenda [+markup se>0] [+promocao/vrpromo se ALTEROUPROMOCAO='S'] WHERE idproduto+idempresa do
 * lote + PROPAGAÇÃO POR GRUPO DE PREÇO (produtos.codgrupopreco — o MESMO preço p/ todos os produtos do grupo na
 * empresa). O reset de etiqueta (etq_impressa='N' + dtultprecoalterado) é o TRIGGER trg_multi_preco_preco_alterado
 * (fiel ao ATUALIZAPROD do Oracle). `excluir`: soft indr='E' (fiel ao btnExcluir). `atualizarPromo`: edição dos
 * campos de promo do lote pendente (vrvenda é read-only no grid — fiel). NENHUM cálculo de preço aqui (sem % em
 * massa/arredondamento/trava preço<custo — não existem no legado). Tenant fail-closed (lote.codempresa = emp).
 */
@Injectable()
export class AjustePrecosService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op(): number | null {
    return currentTenant().operadorId ?? null;
  }

  /** fila de lotes pendentes da empresa (período/origem opcionais), com produto + preço atual. */
  async fila(dtini?: string, dtfim?: string, origem?: 'CADASTRO' | 'PEDIDO' | 'DIVERGENTE'): Promise<Record<string, unknown>[]> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    let q = db
      .selectFrom('lote_preco as l')
      .leftJoin('produtos as p', 'p.idproduto', 'l.idproduto')
      .leftJoin('multi_preco as m', (j) => j.onRef('m.idproduto', '=', 'l.idproduto').onRef('m.idempresa', '=', 'l.codempresa'))
      .select([
        'l.codlotepreco', 'l.idproduto', 'l.codempresa', 'l.vrvenda', 'l.markup', 'l.promocao', 'l.vrpromo',
        'l.alteroupromocao', 'l.datalote', 'l.obs', 'l.origem', 'l.codoperador',
        'p.codbarra', 'p.descricao', 'p.codgrupopreco',
        sql`m.vrvenda`.as('preco_atual'), sql`m.vrcusto`.as('vrcusto'), sql`coalesce(m.promocao,'N')`.as('promocao_atual'),
      ])
      .where('l.codempresa', '=', emp)
      .where(sql`coalesce(l.processado,'N')`, '=', 'N')
      .where(sql`coalesce(l.indr,'I')`, '<>', 'E');
    // fold auditoria: comparar por DATA (::date) — fiel a `trunc(L.DATALOTE) between :DTINI AND :DTFIM`. Sem o cast,
    // dtfim='2026-07-31' virava meia-noite e DERRUBAVA todos os lotes lançados durante o próprio dia.
    if (dtini) q = q.where(sql`l.datalote::date`, '>=', dtini);
    if (dtfim) q = q.where(sql`l.datalote::date`, '<=', dtfim);
    // filtros de origem do legado (por prefixo do OBS; DIVERGENTE = vrvenda do lote ≠ preço atual).
    if (origem === 'CADASTRO') q = q.where(sql`l.obs`, 'like', 'REFERENTE AO AJUSTE NO CADASTRO DO PRODUTO%');
    if (origem === 'PEDIDO') q = q.where(sql`l.obs`, 'like', 'REFERENTE AO PEDIDO DE NRO%');
    if (origem === 'DIVERGENTE') q = q.where(sql`l.vrvenda`, '<>', sql`coalesce(m.vrvenda,0)`);
    return (await q.orderBy('l.datalote').orderBy('l.codlotepreco').limit(2000).execute()) as Record<string, unknown>[];
  }

  /** processa os lotes selecionados (ordem codlotepreco ASC, fiel). Devolve o resumo por lote. */
  async processar(ids: number[]): Promise<{ processados: number; aplicados: number; propagados: number; pulados_sem_preco: number }> {
    const emp = this.emp();
    const op = this.op();
    const ordenados = Array.from(new Set(ids.map(Number))).sort((a, b) => a - b); // ASC (o mais novo vence por último)
    let processados = 0;
    let aplicados = 0;
    let propagados = 0;
    let puladosSemPreco = 0;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      for (const id of ordenados) {
        const l = (await trx
          .selectFrom('lote_preco').selectAll()
          .where('codlotepreco', '=', id).where('codempresa', '=', emp)
          .forUpdate().executeTakeFirst()) as Record<string, unknown> | undefined;
        if (!l) throw new BusinessRuleError('LOTE_NAO_ENCONTRADO', { codlotepreco: id });
        if (String(l.processado ?? 'N') === 'S') throw new BusinessRuleError('LOTE_JA_PROCESSADO', { codlotepreco: id });
        if (String(l.indr ?? 'I') === 'E') throw new BusinessRuleError('LOTE_EXCLUIDO', { codlotepreco: id });

        // (a) marca o lote SEMPRE (fiel: o legado marca antes e só aplica se vrvenda>0).
        await trx.updateTable('lote_preco').set({ processado: 'S', processado_manual: 'S', processado_data: sql`now()`, processado_operador: op }).where('codlotepreco', '=', id).execute();
        processados++;

        const vrvenda = r4(num(l.vrvenda));
        if (vrvenda <= 0) { puladosSemPreco++; continue; }

        // conjunto-alvo: o produto do lote + (se tiver) TODOS os produtos do mesmo GRUPO DE PREÇO (propagação viva).
        const pid = Number(l.idproduto);
        const grupo = (await trx.selectFrom('produtos').select('codgrupopreco').where('idproduto', '=', pid).executeTakeFirst()) as { codgrupopreco?: number } | undefined;
        let alvos: number[] = [pid];
        if (grupo?.codgrupopreco != null && Number(grupo.codgrupopreco) > 0) {
          const doGrupo = (await trx
            .selectFrom('produtos as p')
            .innerJoin('multi_preco as m', (j) => j.onRef('m.idproduto', '=', 'p.idproduto').on('m.idempresa', '=', emp))
            .select('p.idproduto')
            .where('p.codgrupopreco', '=', Number(grupo.codgrupopreco))
            .execute()) as Array<{ idproduto: number }>;
          alvos = Array.from(new Set([pid, ...doGrupo.map((r) => Number(r.idproduto))]));
        }

        const patch: Record<string, unknown> = { vrvenda };
        if (num(l.markup) > 0) patch.markup = r4(num(l.markup)); // fiel: markup só se > 0
        if (String(l.alteroupromocao ?? 'N') === 'S') { // fiel: promo só se ALTEROUPROMOCAO='S'
          patch.promocao = String(l.promocao ?? 'N') === 'S' ? 'S' : 'N';
          patch.vrpromo = r4(num(l.vrpromo));
        }

        for (const alvo of alvos) {
          const antes = (await trx.selectFrom('multi_preco').select('vrvenda').where('idproduto', '=', alvo).where('idempresa', '=', emp).executeTakeFirst()) as { vrvenda?: unknown } | undefined;
          if (!antes) continue; // sem linha de preço na empresa → nada a aplicar (fiel: UPDATE não casa)
          // o trigger trg_multi_preco_preco_alterado reseta etq_impressa/dtultprecoalterado quando o preço muda.
          await trx.updateTable('multi_preco').set(patch).where('idproduto', '=', alvo).where('idempresa', '=', emp).execute();
          if (alvo === pid) {
            // log fiel ao SetaHistorico_Dinamico: UMA linha por LOTE, do produto DO LOTE (não dos propagados —
            // medido no golden: 31.108 de 31.112 lotes têm exatamente 1 linha), valores no formato do legado
            // (vírgula + 2 decimais) e ORIGEM NULL (esta tela não preenche origem). Só quando o valor MUDOU.
            const anteriorNum = num(antes.vrvenda);
            if (anteriorNum !== vrvenda) {
              await trx.insertInto('historico_dinamico').values({
                campo: 'VRVENDA', valor_anterior: fmtBr(anteriorNum), valor_atual: fmtBr(vrvenda),
                tabela: 'MULTI_PRECO', data: sql`now()`, codoperador: op, chave: 'IDPRODUTO', valor_chave: String(alvo),
                codempresa: emp, historico: `Atualização lote de preço Nro: ${id}`, origem: null,
              }).execute();
            }
            aplicados++;
          } else propagados++;
        }
      }
      return { processados, aplicados, propagados, pulados_sem_preco: puladosSemPreco };
    });
  }

  /** exclui (soft, indr='E') lotes PENDENTES selecionados — fiel ao btnExcluir. */
  async excluir(ids: number[]): Promise<{ excluidos: number }> {
    const emp = this.emp();
    const op = this.op();
    const res = await (this.dbp.forTenant() as AnyDB)
      .updateTable('lote_preco')
      .set({ indr: 'E', indr_usuario: op, indr_data: sql`now()` })
      .where('codlotepreco', 'in', ids.map(Number))
      .where('codempresa', '=', emp)
      .where(sql`coalesce(processado,'N')`, '=', 'N')
      .executeTakeFirst();
    return { excluidos: Number((res as any)?.numUpdatedRows ?? 0) };
  }

  /** edita os campos de PROMO de um lote pendente (vrvenda é read-only no grid — fiel). */
  async atualizarPromo(id: number, dto: { promocao?: 'S' | 'N'; vrpromo?: number; alteroupromocao?: 'S' | 'N' }): Promise<{ codlotepreco: number }> {
    const emp = this.emp();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const l = (await trx.selectFrom('lote_preco').select(['codlotepreco', 'processado', 'indr']).where('codlotepreco', '=', id).where('codempresa', '=', emp).forUpdate().executeTakeFirst()) as Record<string, unknown> | undefined;
      if (!l) throw new BusinessRuleError('LOTE_NAO_ENCONTRADO', { codlotepreco: id });
      if (String(l.processado ?? 'N') === 'S') throw new BusinessRuleError('LOTE_JA_PROCESSADO', { codlotepreco: id });
      if (String(l.indr ?? 'I') === 'E') throw new BusinessRuleError('LOTE_EXCLUIDO', { codlotepreco: id });
      const patch: Record<string, unknown> = {};
      if (dto.promocao != null) patch.promocao = dto.promocao;
      if (dto.vrpromo != null) patch.vrpromo = r4(num(dto.vrpromo));
      if (dto.alteroupromocao != null) patch.alteroupromocao = dto.alteroupromocao;
      if (Object.keys(patch).length) await trx.updateTable('lote_preco').set(patch).where('codlotepreco', '=', id).execute();
      return { codlotepreco: id };
    });
  }
}
