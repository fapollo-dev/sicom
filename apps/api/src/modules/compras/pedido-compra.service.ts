import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { gravarHistorico, gravarHistoricoMarca } from '../../shared/crud/historico';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const numCfg = (s: string | null | undefined): number => {
  if (!s) return 0;
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const CD_COLS = ['cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8'] as const;
const ALVO_MP = { tabela: 'multi_preco', pk: 'idproduto', origem: 'FRMPEDIDOCOMPRA' };
const ALVO_PC = { tabela: 'pedidocompra', pk: 'codpedcomp', origem: 'FRMPEDIDOCOMPRA' };

/**
 * PEDIDO DE COMPRA — serviço VERTICAL das transições de ESTADO (o CRUD do agregado é o
 * AggregateEngineService). Workflow do legado: rascunho (FECHADO='N') → fechado (FECHADO='S').
 * `fechar` confirma o pedido (exige ao menos 1 item); depois disso o agregado bloqueia edição/
 * exclusão (validar/validarRemocao). `reabrir` volta p/ rascunho (bloqueado se já faturado — a NF de
 * entrada é corte futuro; a guarda fica de pé). Tenant por IDEMPRESA + operador, fail-closed.
 */
@Injectable()
export class PedidoCompraService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

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

  /** fecha o pedido (N→S): exige ≥1 item; CAS em FECHADO p/ evitar duplo-fechamento concorrente. */
  async fechar(codpedcomp: number): Promise<{ codpedcomp: number; fechado: 'S' }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const pc = await trx
        .selectFrom('pedidocompra')
        .select(['codpedcomp', 'fechado', 'operador_ult_lib_valor_max'])
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E') // pedido excluído (soft-delete) é inexistente
        .forUpdate()
        .executeTakeFirst();
      if (!pc) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });
      if ((pc as any).fechado === 'S') throw new BusinessRuleError('PEDIDO_JA_FECHADO', { codpedcomp });

      const itens = await trx
        .selectFrom('pedidocompra_i')
        .select(({ fn }: any) => [fn.count('codpedcompi').as('n')])
        .where('codpedcomp', '=', codpedcomp)
        .executeTakeFirst();
      if (Number((itens as any)?.n ?? 0) === 0) throw new BusinessRuleError('PEDIDO_SEM_ITENS', { codpedcomp });

      // corte-final: LIMITE diário/semanal de compra (ValidaValorMaximoDia/Semana, uPedidoCompra.pas:7939/7983).
      // DIVERGÊNCIA consciente: o legado valida no GRAVAR; aqui no FECHAR (o commit do pedido no novo). Já
      // liberado (operador_ult_lib_valor_max) → passa (LiberouLimiteDiario do legado).
      if ((pc as any).operador_ult_lib_valor_max == null) {
        await this.validarLimites(trx, codpedcomp, emp);
      }

      const upd = await trx
        .updateTable('pedidocompra')
        .set({ fechado: 'S', usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where((eb: any) => eb.or([eb('fechado', '<>', 'S'), eb('fechado', 'is', null)]))
        .executeTakeFirst();
      if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('PEDIDO_JA_FECHADO', { codpedcomp });
      return { codpedcomp, fechado: 'S' as const };
    });
  }

  /**
   * corte-2 — GERA as parcelas do pedido a partir da condição de pagamento (RatearTotalNasParcelas,
   * uPedidoCompra.pas:8892). Prazos (dias) = CD1..CD8 do PEDIDO (override local); se nenhum, os da CONDIÇÃO
   * (codconpagto). Para cada CDn não-nulo: 1 parcela; VALOR = round(TOTAL/nParc) com a SOBRA na PRIMEIRA
   * (Σ = total ao centavo); DATA = data_pedido + CDn dias; QTDEDIASAPOSFATURAMENTO = CDn. Substitui as
   * parcelas existentes. Bloqueado em pedido fechado/faturado (é uma edição). Single-empresa.
   */
  async gerarParcelas(codpedcomp: number): Promise<{ codpedcomp: number; parcelas: number; total: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const pc = await trx
        .selectFrom('pedidocompra')
        .select(['codpedcomp', 'fechado', 'dtfaturamento', 'data', 'data_faturamento', 'codconpagto', 'cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8'])
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E')
        .forUpdate()
        .executeTakeFirst();
      if (!pc) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });
      if ((pc as any).dtfaturamento != null) throw new BusinessRuleError('PEDIDO_FATURADO', { codpedcomp });
      if ((pc as any).fechado === 'S') throw new BusinessRuleError('PEDIDO_FECHADO', { codpedcomp });

      // prazos: CD1..CD8 do PEDIDO (override); se nenhum, os da CONDIÇÃO (codconpagto).
      const cdCols = ['cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8'] as const;
      const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
      let prazos = cdCols.map((c) => num((pc as any)[c])).filter((d): d is number => d != null);
      if (prazos.length === 0 && (pc as any).codconpagto != null) {
        const cond = await trx
          .selectFrom('condicoes_pagto')
          .select(['cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8'])
          .where('codconpagto', '=', Number((pc as any).codconpagto))
          .executeTakeFirst();
        if (cond) prazos = cdCols.map((c) => num((cond as any)[c])).filter((d): d is number => d != null);
      }
      if (prazos.length === 0) throw new BusinessRuleError('PEDIDO_SEM_CONDICAO_PAGTO', { codpedcomp });

      // total = Σ VLREMBALAGEM dos itens. NOTA (single-empresa): o legado usa TOTALCUSTO = Σ(QTDE×VLREMBALAGEM)
      // agrupado por loja (PEDIDO_COMPRA_QTDE, o split multi-loja/cross-docking = ADIADO). No modelo reduzido do
      // corte-1 (qtd=FATOREMBALAGEM, VLREMBALAGEM=fator×custo) Σ vlrembalagem é a base consistente.
      const tot = await trx
        .selectFrom('pedidocompra_i')
        .select(({ fn }: any) => [fn.sum('vlrembalagem').as('s')])
        .where('codpedcomp', '=', codpedcomp)
        .executeTakeFirst();
      const totalCents = Math.round(Number((tot as any)?.s ?? 0) * 100);
      if (totalCents <= 0) throw new BusinessRuleError('PEDIDO_SEM_VALOR', { codpedcomp });

      // rateio: valor por parcela + SOBRA na PRIMEIRA (fiel ao RatearTotalNasParcelas:8941). Σ == total.
      const n = prazos.length;
      const valorCents = Math.round(totalCents / n);
      const residuo = totalCents - valorCents * n;
      // data-base do vencimento = DATA_FATURAMENTO (legado edtDtFaturamento→DTFATURAMENTO; golden 99,2%);
      // fallback p/ a data do pedido quando não informada.
      const base = new Date(((pc as any).data_faturamento ?? (pc as any).data) as string | number | Date);

      await trx.deleteFrom('pedidocompra_parcelas').where('codpedcomp', '=', codpedcomp).execute();
      for (let i = 0; i < n; i++) {
        const dias = prazos[i];
        const dt = new Date(base.getTime());
        dt.setUTCDate(dt.getUTCDate() + dias);
        await trx
          .insertInto('pedidocompra_parcelas')
          .values({
            codpedcomp,
            idempresa: emp,
            parcela: i + 1,
            data: dt.toISOString().slice(0, 10),
            valor: (valorCents + (i === 0 ? residuo : 0)) / 100, // sobra na PRIMEIRA
            qtdediasaposfaturamento: dias,
          })
          .execute();
      }

      await trx
        .updateTable('pedidocompra')
        .set({ usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .execute();
      return { codpedcomp, parcelas: n, total: totalCents / 100 };
    });
  }

  /**
   * corte-final — FLUXO deste pedido (parcelas MATERIALIZADAS ou PROJETADAS). O legado chama
   * `RatearTotalNasParcelas(False)` no próprio gravar (uPedidoCompra.pas:6866), então o fluxo do pedido
   * SEMPRE existe na validação — mesmo sem o operador ter clicado "Gerar parcelas". Aqui: usa as parcelas
   * persistidas se houver; senão PROJETA pelas CDs efetivas (pedido→condição) + total (Σ vlrembalagem) +
   * data-base (data_faturamento ?? data), com o MESMO rateio de gerarParcelas (round(total/n), sobra na 1ª,
   * venc = base + CDn). Sem CDs → 1 ponto (total na data-base). Total ≤ 0 → sem fluxo.
   */
  private async fluxoDoPedido(trx: AnyDB, codpedcomp: number, emp: number): Promise<Array<{ data: string; valor: number }>> {
    const parc = (await trx
      .selectFrom('pedidocompra_parcelas')
      .select([sql<string>`to_char(data::date, 'YYYY-MM-DD')`.as('d'), 'valor'])
      .where('codpedcomp', '=', codpedcomp)
      .execute()) as Array<{ d: string; valor: unknown }>;
    if (parc.length) return parc.map((p) => ({ data: p.d, valor: r2(num(p.valor)) }));

    // sem parcelas materializadas → projeta pelo mesmo rateio do gerarParcelas.
    const pc = (await trx
      .selectFrom('pedidocompra')
      .select([sql<string>`to_char(coalesce(data_faturamento, data)::date, 'YYYY-MM-DD')`.as('base'), 'codconpagto', ...CD_COLS])
      .where('codpedcomp', '=', codpedcomp)
      .where('idempresa', '=', emp)
      .executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!pc) return [];
    const tot = (await trx
      .selectFrom('pedidocompra_i')
      .select(({ fn }: any) => [fn.sum('vlrembalagem').as('s')])
      .where('codpedcomp', '=', codpedcomp)
      .executeTakeFirst()) as { s?: unknown } | undefined;
    const totalCents = Math.round(num(tot?.s) * 100);
    if (totalCents <= 0) return [];

    let prazos = CD_COLS.map((c) => pc[c]).filter((v) => v != null && v !== '').map((v) => Number(v));
    if (prazos.length === 0 && pc.codconpagto != null) {
      const cond = (await trx
        .selectFrom('condicoes_pagto')
        .select([...CD_COLS])
        .where('codconpagto', '=', Number(pc.codconpagto))
        .executeTakeFirst()) as Record<string, unknown> | undefined;
      if (cond) prazos = CD_COLS.map((c) => cond[c]).filter((v) => v != null).map((v) => Number(v));
    }
    const baseISO = String(pc.base);
    if (prazos.length === 0) return [{ data: baseISO, valor: totalCents / 100 }];
    const n = prazos.length;
    const valorCents = Math.round(totalCents / n);
    const residuo = totalCents - valorCents * n;
    return prazos.map((dias, i) => {
      const dt = new Date(`${baseISO}T00:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + dias);
      return { data: dt.toISOString().slice(0, 10), valor: (valorCents + (i === 0 ? residuo : 0)) / 100 };
    });
  }

  /**
   * corte-final — LIMITES de desembolso (ValidaValorMaximoDia/Semana, uPedidoCompra.pas:7939-8036).
   * Fluxo da janela = Σ parcelas de OUTROS pedidos ABERTOS (não recebidos, não excluídos) da empresa +
   * o fluxo DESTE pedido (materializado OU projetado, via fluxoDoPedido) — espelha o legado, que exclui o
   * pedido corrente do banco e soma o rateio em memória. Modo FLUXO_CAIXA_SOMENTE_VALOR_PC='P' (as saídas
   * do financeiro/GET_FLUXOSAIDAS ficam com o fluxo VISUAL, adiado). Diário = o dia exato da parcela;
   * semanal = a semana civil dom-sáb. Limites vêm de config (0 = desligado).
   */
  private async validarLimites(trx: AnyDB, codpedcomp: number, emp: number): Promise<void> {
    // M8 (migration 077): o modo é EXCLUSIVO — TIPO_FLUXO_CAIXA_PC='D' valida SÓ o diário, 'S' SÓ o semanal,
    // outro/vazio → NENHUM (fiel a ValidaValorMaximoDia/Semana XOR, uPedidoCompra.pas:7966/8021). O curto-circuito
    // por-limite (limite=0 = desligado) é preservado zerando o limite do modo NÃO selecionado.
    const modo = String((await this.config.resolver('TIPO_FLUXO_CAIXA_PC', { empresaId: emp })) ?? '').trim().toUpperCase();
    const dia = modo === 'D' ? numCfg(await this.config.resolver('VALOR_MAXIMO_DIARIO_PC', { empresaId: emp })) : 0;
    const sem = modo === 'S' ? numCfg(await this.config.resolver('VALOR_MAXIMO_SEMANAL_PC', { empresaId: emp })) : 0;
    if (dia <= 0 && sem <= 0) return;

    const meu = await this.fluxoDoPedido(trx, codpedcomp, emp);
    if (!meu.length) return; // A1: pedido sem valor → nada a projetar; com valor, o fluxo SEMPRE é validado.

    // Σ parcelas de OUTROS pedidos abertos da empresa num intervalo (exclui o corrente — somado da memória).
    const somaOutros = async (ini: string, fim: string): Promise<number> => {
      const t = (await trx
        .selectFrom('pedidocompra_parcelas as pp')
        .innerJoin('pedidocompra as p', 'p.codpedcomp', 'pp.codpedcomp')
        .select(({ fn }: any) => [fn.sum('pp.valor').as('s')])
        .where('p.idempresa', '=', emp)
        .where('pp.codpedcomp', '<>', codpedcomp)
        .where(sql`coalesce(p.indr,'I')`, '<>', 'E')
        .where('p.dtfaturamento', 'is', null)
        .where(sql`pp.data::date`, '>=', ini)
        .where(sql`pp.data::date`, '<=', fim)
        .executeTakeFirst()) as { s?: unknown } | undefined;
      return num(t?.s);
    };
    const meuNoIntervalo = (ini: string, fim: string): number =>
      meu.filter((f) => f.data >= ini && f.data <= fim).reduce((s, f) => s + f.valor, 0);

    const violacoes: Array<{ tipo: 'diario' | 'semanal'; inicio: string; fim: string; total: number; limite: number }> = [];
    const vistas = new Set<string>();
    for (const { data: d } of meu) {
      if (dia > 0 && !vistas.has(`D${d}`)) {
        vistas.add(`D${d}`);
        const total = r2((await somaOutros(d, d)) + meuNoIntervalo(d, d));
        if (total > dia) violacoes.push({ tipo: 'diario', inicio: d, fim: d, total, limite: dia });
      }
      if (sem > 0) {
        const base = new Date(`${d}T00:00:00Z`);
        const ini = new Date(base.getTime());
        ini.setUTCDate(ini.getUTCDate() - ini.getUTCDay()); // domingo
        const fim = new Date(ini.getTime());
        fim.setUTCDate(fim.getUTCDate() + 6); // sábado
        const iniISO = ini.toISOString().slice(0, 10);
        const fimISO = fim.toISOString().slice(0, 10);
        if (!vistas.has(`S${iniISO}`)) {
          vistas.add(`S${iniISO}`);
          const total = r2((await somaOutros(iniISO, fimISO)) + meuNoIntervalo(iniISO, fimISO));
          if (total > sem) violacoes.push({ tipo: 'semanal', inicio: iniISO, fim: fimISO, total, limite: sem });
        }
      }
    }
    if (violacoes.length) throw new BusinessRuleError('PEDIDO_LIMITE_EXCEDIDO', { violacoes });
  }

  /**
   * corte-final — LIBERAÇÃO do limite (PedeSenhaValorMaximo, uPedidoCompra.pas:3735): operador com grant
   * LIBERAVALORMAX (o RBAC substitui a lista USUARIOS_LIBERAM_VALOR_MAX_EXCEDIDO + senha do legado — a senha
   * de supervisor é cifra proprietária e espera o corte de auth). Grava OPERADOR_ULT_LIB_VALOR_MAX (:3752);
   * o fechar passa a aceitar. Só em pedido ABERTO (é uma pré-autorização do fechar).
   */
  async liberarLimite(codpedcomp: number): Promise<{ codpedcomp: number; operador: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const pc = await trx
        .selectFrom('pedidocompra')
        .select(['codpedcomp', 'fechado', 'dtfaturamento'])
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E')
        .forUpdate()
        .executeTakeFirst();
      if (!pc) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });
      if ((pc as any).dtfaturamento != null) throw new BusinessRuleError('PEDIDO_FATURADO', { codpedcomp });
      if ((pc as any).fechado === 'S') throw new BusinessRuleError('PEDIDO_JA_FECHADO', { codpedcomp });
      await trx
        .updateTable('pedidocompra')
        .set({ operador_ult_lib_valor_max: op, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .execute();
      return { codpedcomp, operador: op };
    });
  }

  /**
   * corte-final — PROPAGAÇÃO DE PREÇO AO CATÁLOGO ("Atualizar preço → On-line", uPedidoCompra.pas:3444-3603).
   * Regra VIVA de alto volume (golden: 95,5% dos preços 2024+ do catálogo vêm do item do pedido). Para cada
   * item com VRVENDA>0 cujo preço difere do MULTI_PRECO: `UPDATE MULTI_PRECO SET VRVENDA` (só VRVENDA — fiel
   * :3517) + dtultprecoalterado (observado no golden via trigger) + HISTORICO_DINAMICO ('Atualização on-line
   * de preço, pedido de compra Nro: X'). GATE de promoção: o legado pula produto em PROMOCAO_ACUMULATIVA
   * (módulo ausente no novo) → proxy CONSERVADOR: pula multi_preco.promocao='S' (não sobrescrever preço de
   * produto em promoção; divergência documentada). Config ATUALIZA_PRECO_OUTRAS_EMPRESAS='S' propaga a todas
   * as empresas. LOTEPRECO (fila de etiquetas) + cascade pai/filho = ADIADOS (dossiê).
   */
  async atualizarPrecos(codpedcomp: number): Promise<{ codpedcomp: number; atualizados: number; pulados_promocao: number; sem_diferenca: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const pc = await trx
        .selectFrom('pedidocompra')
        .select(['codpedcomp'])
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E')
        .forUpdate()
        .executeTakeFirst();
      if (!pc) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });

      const itens = (await trx
        .selectFrom('pedidocompra_i')
        .select(['idproduto', 'vrvenda'])
        .where('codpedcomp', '=', codpedcomp)
        .where('vrvenda', '>', 0)
        .orderBy('codpedcompi')
        .execute()) as Array<{ idproduto: number; vrvenda: unknown }>;

      const todas = (await this.config.resolver('ATUALIZA_PRECO_OUTRAS_EMPRESAS', { empresaId: emp })) === 'S';
      let empresas: number[] = [emp];
      if (todas) {
        const rows = (await trx.selectFrom('empresas').select('idempresa').execute()) as Array<{ idempresa: number }>;
        empresas = rows.map((r) => Number(r.idempresa));
      }

      let atualizados = 0;
      let pulados = 0;
      let semDif = 0;
      for (const it of itens) {
        const venda = r2(num(it.vrvenda));
        // último item do produto vence (o loop do legado percorre em ordem; duplicatas de produto são raras)
        for (const e of empresas) {
          const mp = (await trx
            .selectFrom('multi_preco')
            .select(['id_multi_preco', 'vrvenda', 'promocao'])
            .where('idproduto', '=', it.idproduto)
            .where('idempresa', '=', e)
            .forUpdate()
            .executeTakeFirst()) as { id_multi_preco: number; vrvenda?: unknown; promocao?: string } | undefined;
          if (!mp) continue; // produto sem preço nessa empresa → nada a atualizar (fiel: o join do legado exige MULTI_PRECO)
          if (mp.promocao === 'S') {
            pulados++;
            continue;
          }
          if (r2(num(mp.vrvenda)) === venda) {
            semDif++;
            continue;
          }
          await trx
            .updateTable('multi_preco')
            .set({ vrvenda: venda, dtultprecoalterado: sql`now()` })
            .where('id_multi_preco', '=', mp.id_multi_preco)
            .execute();
          await gravarHistorico(
            trx, ALVO_MP, it.idproduto, op, e,
            { vrvenda: num(mp.vrvenda) }, { vrvenda: venda },
            `Atualização on-line de preço, pedido de compra Nro: ${codpedcomp}`,
          );
          atualizados++;
        }
      }
      return { codpedcomp, atualizados, pulados_promocao: pulados, sem_diferenca: semDif };
    });
  }

  /**
   * corte-final — DUPLICAR PEDIDO (DuplicaPedido, udmPedidoCompra.pas:1653-1853) e GERAR PEDIDO BONIFICADO
   * (espelho, uPedidoCompra.pas:7005-7058) — PATHS DISTINTOS:
   *
   * DUPLICAR (bonificar=false): novo RASCUNHO com data/data_faturamento = HOJE; clona condição/CDs/frete/
   * situação e os ITENS (com precificação); vencimento (DM:1758-1761): VENCIDO desloca mantendo o delta
   * (venc−data)+hoje, NÃO-vencido vira HOJE (M7 — o legado reseta para vData); NÃO copia parcelas nem o
   * marcador recebido; FECHADO='N'.
   *
   * BONIFICADO (bonificar=true): ESPELHO MÍNIMO (uPedidoCompra.pas:7017-7040 — M6) — só DATA = data-da-ORIGEM
   * (não hoje), CODPARCEIRO, OBS='BONIFICAÇÃO REFERENTE AO PEDIDO: X', BONIFICACAO='S' + itens (idproduto/
   * fator/custo, BONIFICACAO=100). SEM condição/CD/frete/vencimento/situação/data_faturamento (bonificação não
   * tem termos de pagamento) e SEM a analítica de precificação (mercadoria gratuita).
   *
   * DIVERGÊNCIA consciente: o "duplicar sem quantidades" do legado zera QTDE na tabela de split multi-loja
   * (adiada) — aqui a quantidade é FATOREMBALAGEM (obrigatória >0), então duplica-se sempre COM quantidades.
   */
  async duplicar(codpedcomp: number, bonificar: boolean): Promise<{ codpedcomp: number; origem: number; bonificacao: 'S' | 'N' }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const pc = (await trx
        .selectFrom('pedidocompra')
        .select([
          'codpedcomp', 'codparceiro', 'codconpagto', 'idsituacao_nf', 'pc_tipo_frete', 'pc_valor_frete', 'obs',
          sql<string>`to_char(data::date, 'YYYY-MM-DD')`.as('data_iso'),
          sql<string | null>`to_char(dt_vencimento::date, 'YYYY-MM-DD')`.as('venc_iso'),
          sql<string>`to_char(now()::date, 'YYYY-MM-DD')`.as('hoje_iso'),
          ...CD_COLS,
        ])
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E')
        .executeTakeFirst()) as Record<string, unknown> | undefined;
      if (!pc) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });

      const itens = (await trx
        .selectFrom('pedidocompra_i')
        .select(['idproduto', 'fatorembalagem', 'vrcusto', 'desconto', 'descontop', 'obs', 'vrcustoliquido', 'markup', 'vrvenda', 'vrvendasug', 'margeml2', 'margeml2v', 'pmz', 'bonificacao'])
        .where('codpedcomp', '=', codpedcomp)
        .orderBy('codpedcompi')
        .execute()) as Array<Record<string, unknown>>;
      if (!itens.length) throw new BusinessRuleError('PEDIDO_SEM_ITENS', { codpedcomp });

      // vencimento (só DUPLICAR): VENCIDO → delta (venc−data)+hoje; NÃO-vencido → HOJE (M7, DM:1758-1761).
      // BONIFICADO não tem vencimento (mercadoria gratuita, sem termos de pagamento).
      let novaVenc: string | null = null;
      if (!bonificar) {
        const vencOrig = (pc.venc_iso as string | null) ?? null;
        const hojeISO = String(pc.hoje_iso);
        if (vencOrig && vencOrig < hojeISO) {
          const delta = Math.round((new Date(`${vencOrig}T00:00:00Z`).getTime() - new Date(`${pc.data_iso}T00:00:00Z`).getTime()) / 86400000);
          const nv = new Date(`${hojeISO}T00:00:00Z`);
          nv.setUTCDate(nv.getUTCDate() + Math.max(delta, 0));
          novaVenc = nv.toISOString().slice(0, 10);
        } else if (vencOrig) {
          novaVenc = hojeISO;
        }
      }

      const header: Record<string, unknown> = bonificar
        ? {
            // M6 — espelho MÍNIMO: DATA = origem, sem condição/CD/frete/venc/situação/data_faturamento.
            idempresa: emp,
            codparceiro: pc.codparceiro as number,
            codoperador: op,
            data: pc.data_iso as string,
            obs: `BONIFICAÇÃO REFERENTE AO PEDIDO: ${codpedcomp}`,
            fechado: 'N',
            bonificacao: 'S',
          }
        : {
            idempresa: emp,
            codparceiro: pc.codparceiro as number,
            codoperador: op,
            data: sql`now()`,
            data_faturamento: sql`now()`, // DTFATURAMENTO(input)=hoje no duplicar (DM:1657-1660)
            dt_vencimento: novaVenc,
            codconpagto: (pc.codconpagto as number | null) ?? null,
            idsituacao_nf: (pc.idsituacao_nf as number | null) ?? null,
            ...Object.fromEntries(CD_COLS.map((c) => [c, pc[c] ?? null])),
            pc_tipo_frete: (pc.pc_tipo_frete as string | null) ?? null,
            pc_valor_frete: (pc.pc_valor_frete as number | null) ?? null,
            obs: (pc.obs as string | null) ?? null,
            fechado: 'N',
            bonificacao: 'N',
          };
      const ins = (await trx
        .insertInto('pedidocompra')
        .values(header)
        .returning('codpedcomp')
        .executeTakeFirstOrThrow()) as { codpedcomp: number };
      const novo = Number(ins.codpedcomp);

      for (const it of itens) {
        const fator = num(it.fatorembalagem);
        const custo = num(it.vrcusto);
        const base = { codpedcomp: novo, idproduto: it.idproduto as number, fatorembalagem: fator, vrcusto: custo, vlrembalagem: r4(fator * custo) };
        const item: Record<string, unknown> = bonificar
          ? { ...base, bonificacao: 100 } // espelho = 100% (:7033); sem precificação (mercadoria gratuita)
          : {
              ...base,
              desconto: (it.desconto as number | null) ?? null,
              descontop: (it.descontop as number | null) ?? null,
              obs: (it.obs as string | null) ?? null,
              vrcustoliquido: (it.vrcustoliquido as number | null) ?? null,
              markup: (it.markup as number | null) ?? null,
              vrvenda: (it.vrvenda as number | null) ?? null,
              vrvendasug: (it.vrvendasug as number | null) ?? null,
              margeml2: (it.margeml2 as number | null) ?? null,
              margeml2v: (it.margeml2v as number | null) ?? null,
              pmz: (it.pmz as number | null) ?? null,
              bonificacao: (it.bonificacao as number | null) ?? null,
            };
        await trx.insertInto('pedidocompra_i').values(item).execute();
      }

      await gravarHistoricoMarca(
        trx, ALVO_PC, novo, op, emp,
        bonificar ? `Pedido bonificado (espelho) gerado do pedido ${codpedcomp}` : `Duplicado do pedido ${codpedcomp}`,
      );
      return { codpedcomp: novo, origem: codpedcomp, bonificacao: bonificar ? 'S' : 'N' };
    });
  }

  /**
   * corte-final — IMPORTAR ITENS EM MASSA (ImportaItens, uPedidoCompra.pas:8242-8529). Origem: produtos
   * ASSOCIADOS ao fornecedor (PRODUTOS.CODFOR) ou já COMPRADOS dele (histórico PEDIDOCOMPRA_I). Exclui:
   * já no pedido, produtos-FILHO (idproduto_pai) e inativos (produto/multi_preco ativo_compra). Custo =
   * MULTI_PRECO.VRCUSTO (VRCUSTOREP se CUSTO_REP_PC='S' — :7284-7294); fator = de-para do fornecedor
   * (USAR_FATOR_EMBALAGEM_REFERENCIA_FORNECEDOR='S' — :7302) senão PRODUTOS.FATORCX (≥1). Variantes
   * tabela-do-fornecedor / da-NF / coletor = ADIADAS (dossiê). Cap 990 anti-boom (padrão do repo).
   */
  async importarItens(codpedcomp: number, origem: 'associados' | 'comprados'): Promise<{ codpedcomp: number; importados: number; ja_no_pedido: number; inativos: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const pc = await trx
        .selectFrom('pedidocompra')
        .select(['codpedcomp', 'fechado', 'dtfaturamento', 'codparceiro'])
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E')
        .forUpdate()
        .executeTakeFirst();
      if (!pc) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });
      if ((pc as any).dtfaturamento != null) throw new BusinessRuleError('PEDIDO_FATURADO', { codpedcomp });
      if ((pc as any).fechado === 'S') throw new BusinessRuleError('PEDIDO_FECHADO', { codpedcomp });
      const forn = Number((pc as any).codparceiro);

      const existentes = new Set(
        ((await trx.selectFrom('pedidocompra_i').select('idproduto').where('codpedcomp', '=', codpedcomp).execute()) as Array<{ idproduto: number }>)
          .map((r) => Number(r.idproduto)),
      );

      // candidatos (produtos ativos, não-filho) por origem. ATIVO/ATIVO_COMPRA vêm de PRODUTOS (M4: o legado
      // filtra COALESCE(P.ATIVO_COMPRA,'S')='S' na PRODUTOS — GetSQLProdutos:8313 —, não em MULTI_PRECO).
      let q = trx
        .selectFrom('produtos as pr')
        .select(['pr.idproduto', 'pr.fatorcx', 'pr.ativo_compra'])
        .where('pr.idproduto_pai', 'is', null)
        .where(sql`coalesce(pr.ativo,'S')`, '=', 'S');
      if (origem === 'associados') {
        q = q.where('pr.codfor', '=', forn);
      } else {
        q = q.where('pr.idproduto', 'in', (eb: any) =>
          eb
            .selectFrom('pedidocompra_i as i')
            .innerJoin('pedidocompra as p2', 'p2.codpedcomp', 'i.codpedcomp')
            .select('i.idproduto')
            .where('p2.codparceiro', '=', forn)
            .where('p2.idempresa', '=', emp)
            .where(sql`coalesce(p2.indr,'I')`, '<>', 'E'),
        );
      }
      const candidatos = ((await q.execute()) as Array<{ idproduto: number; fatorcx?: unknown; ativo_compra?: string }>).filter(
        (c) => !existentes.has(Number(c.idproduto)),
      );
      const jaNoPedido = existentes.size;
      if (candidatos.length === 0) return { codpedcomp, importados: 0, ja_no_pedido: jaNoPedido, inativos: 0 };
      if (candidatos.length > 990) throw new BusinessRuleError('PEDIDO_IMPORT_EXCESSO', { candidatos: candidatos.length });

      const useRep = (await this.config.resolver('CUSTO_REP_PC', { empresaId: emp })) === 'S';
      const useRefFator = (await this.config.resolver('USAR_FATOR_EMBALAGEM_REFERENCIA_FORNECEDOR', { empresaId: emp })) === 'S';

      const ids = candidatos.map((c) => Number(c.idproduto));
      const mps = new Map<number, { vrcusto: number; vrcustorep: number }>();
      for (const r of (await trx
        .selectFrom('multi_preco')
        .select(['idproduto', 'vrcusto', 'vrcustorep'])
        .where('idempresa', '=', emp)
        .where('idproduto', 'in', ids)
        .execute()) as any[]) {
        mps.set(Number(r.idproduto), { vrcusto: num(r.vrcusto), vrcustorep: num(r.vrcustorep) });
      }
      const fatores = new Map<number, number>();
      if (useRefFator) {
        for (const r of (await trx
          .selectFrom('codreferencia_for')
          .select(['idproduto', ({ fn }: any) => fn.max('fator_embalagem').as('fator')] as any)
          .where('codfor', '=', forn)
          .where('idproduto', 'in', ids)
          .groupBy('idproduto')
          .execute()) as any[]) {
          if (num(r.fator) > 0) fatores.set(Number(r.idproduto), num(r.fator));
        }
      }

      let importados = 0;
      let inativos = 0;
      for (const c of candidatos) {
        const idp = Number(c.idproduto);
        const mp = mps.get(idp);
        // não-importáveis (contam em `inativos`): inativo p/ compra em PRODUTOS (M4) OU sem preço na empresa
        // (B1: o legado usa INNER JOIN com MULTI_PRECO → produto sem preço não é candidato; evita item custo-0).
        if (String(c.ativo_compra ?? 'S') === 'N' || !mp) {
          inativos++;
          continue;
        }
        const custo = useRep ? (mp.vrcustorep || mp.vrcusto || 0) : (mp.vrcusto ?? 0);
        const fator = (useRefFator && fatores.get(idp)) || (num(c.fatorcx) > 0 ? num(c.fatorcx) : 1);
        await trx
          .insertInto('pedidocompra_i')
          .values({ codpedcomp, idproduto: idp, fatorembalagem: fator, vrcusto: custo, vlrembalagem: r4(fator * custo) })
          .execute();
        importados++;
      }
      await trx
        .updateTable('pedidocompra')
        .set({ usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .execute();
      return { codpedcomp, importados, ja_no_pedido: jaNoPedido, inativos };
    });
  }

  /**
   * reabre o pedido (S→N): bloqueado se já faturado (NF de entrada = corte futuro; guarda de pé).
   * REARMA o limite (M1): limpa OPERADOR_ULT_LIB_VALOR_MAX na reabertura — a liberação do legado
   * (`LiberouLimiteDiario`) é transiente e revalidada a cada gravar (uPedidoCompra.pas:699/5891), então
   * a autorização vale só para o fechar que a seguiu. Sem isso, uma liberação única viraria aval eterno
   * (reabre → infla itens → fecha sem re-checagem). A flag está fora do allowlist do agregado, logo o
   * reabrir é a única superfície de reset.
   */
  async reabrir(codpedcomp: number): Promise<{ codpedcomp: number; fechado: 'N' }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const pc = await trx
        .selectFrom('pedidocompra')
        .select(['codpedcomp', 'fechado', 'dtfaturamento'])
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E') // pedido excluído (soft-delete) é inexistente
        .forUpdate()
        .executeTakeFirst();
      if (!pc) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });
      if ((pc as any).fechado !== 'S') throw new BusinessRuleError('PEDIDO_NAO_FECHADO', { codpedcomp });
      if ((pc as any).dtfaturamento != null) throw new BusinessRuleError('PEDIDO_FATURADO', { codpedcomp });

      // CAS em FECHADO (cinto-e-suspensório com o forUpdate) — padrão do repo (caixa.reabrir).
      const upd = await trx
        .updateTable('pedidocompra')
        .set({ fechado: 'N', operador_ult_lib_valor_max: null, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .where('fechado', '=', 'S')
        .executeTakeFirst();
      if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('PEDIDO_NAO_FECHADO', { codpedcomp });
      return { codpedcomp, fechado: 'N' as const };
    });
  }
}
