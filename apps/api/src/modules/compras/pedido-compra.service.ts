import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { estadoFechamento, lojaFechada, lojaRecebeu, lojasDoPedido, novoHistorico } from './pedido-lojas';
import { SenhaOperacaoService } from '../cadastro/senha-operacao.service';
import { gravarHistorico, gravarHistoricoMarca } from '../../shared/crud/historico';
import { ConfigService } from '../cadastro/config.service';
import { LiberacaoService } from '../auth/liberacao.service';

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
    private readonly liberacao: LiberacaoService,
    private readonly senhaOp: SenhaOperacaoService, // senha administrativa da meta diária (SenhaAdministrativa('ADM'))
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

  /**
   * FECHA o pedido PARA A LOJA LOGADA (mig 303; FecharPedido, uPedidoCompra.pas:7754): marca FECHADO/DATA_FECHAMENTO/
   * CODOPERADOR só nas linhas por loja da empresa do contexto, põe o cabeçalho em 'S' (como o legado) e grava o
   * histórico 'Pedido fechado para a empresa N…'. Exige que a loja participe do pedido e ainda esteja aberta, e ≥ 1
   * item. Para o pedido de uma loja só é o fechar de antes. O LIMITE diário/semanal segue no fechar.
   */
  async fechar(codpedcomp: number, opcoes?: { senhaAdm?: string }): Promise<{ codpedcomp: number; fechado: 'S'; idempresa: number; fechamento: string }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const pc = await this.pedidoDaLoja(trx, codpedcomp, emp, ['fechado', 'operador_ult_lib_valor_max',
        sql<string>`to_char(data::date, 'YYYY-MM-DD')`.as('dia') as any]);
      const antes = await estadoFechamento(trx, codpedcomp, (pc as any).fechado);
      if (lojaFechada(antes, emp)) throw new BusinessRuleError('PEDIDO_JA_FECHADO', { codpedcomp, idempresa: emp });

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
        await this.validarLimites(trx, codpedcomp, Number((pc as any).idempresa));
      }
      await this.validarMetaDiaria(trx, codpedcomp, pc, opcoes?.senhaAdm);

      await trx
        .updateTable('pedidocompra')
        .set({ fechado: 'S', usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpedcomp', '=', codpedcomp)
        .execute();
      await sql`UPDATE pedido_compra_qtde SET fechado = 'S', data_fechamento = now(), codoperador = ${op}
                 WHERE idempresa = ${emp}
                   AND codpedcompi IN (SELECT codpedcompi FROM pedidocompra_i WHERE codpedcomp = ${codpedcomp})`.execute(trx);
      await novoHistorico(trx, codpedcomp, op, `Pedido fechado para a empresa ${emp} através da tela de pedido de compra.`);
      const depois = await estadoFechamento(trx, codpedcomp, 'S');
      return { codpedcomp, fechado: 'S' as const, idempresa: emp, fechamento: depois.tipo };
    });
  }

  /**
   * META DIÁRIA DE COMPRA POR LOJA (`mniFecharPedidoClick`, uPedidoCompra.pas:2424; mig 304): para cada loja do pedido
   * (`cdsTotalPedido`), o total de TODOS os pedidos daquela loja na data do pedido (`sqqTotalDiario`: Σ
   * PEDIDO_COMPRA_QTDE.TOTALCUSTO da loja, `TRUNC(P.DATA) = :DATA`) contra `EMPRESAS.META_COMPRA`. Meta nula/zero = sem
   * meta. Passou → "Será preciso liberação": sem senha, 422 com a loja, a meta e o total; com a senha administrativa
   * da empresa, fecha. DEFEITO DO LEGADO não copiado: lá a senha errada dá `Break` e o `FecharPedido` roda do mesmo
   * jeito — a liberação que a mensagem pede não travava nada. No cliente a meta é nula nas 5 empresas.
   */
  private async validarMetaDiaria(trx: AnyDB, codpedcomp: number, pc: Record<string, unknown>, senhaAdm?: string): Promise<void> {
    const lojas = (await this.totaisPorLoja(trx, codpedcomp, pc.empresas, pc.idempresa as number | null)).map((t) => t.idempresa);
    const excedidas: Array<{ idempresa: number; meta: number; total: number }> = [];
    for (const loja of lojas) {
      const r = (await sql<{ meta: unknown; total: unknown }>`
          SELECT (SELECT e.meta_compra FROM empresas e WHERE e.idempresa = ${loja}) AS meta,
                 (SELECT sum(q.totalcusto)
                    FROM pedido_compra_qtde q
                    JOIN pedidocompra_i i ON i.codpedcompi = q.codpedcompi
                    JOIN pedidocompra p ON p.codpedcomp = i.codpedcomp
                   WHERE q.idempresa = ${loja} AND p.data::date = ${String(pc.dia)}::date
                     AND coalesce(p.indr, 'I') <> 'E') AS total`.execute(trx)).rows[0];
      const meta = num(r?.meta);
      const total = r2(num(r?.total));
      if (meta > 0 && total > meta) excedidas.push({ idempresa: loja, meta, total });
    }
    if (!excedidas.length) return;
    if (!senhaAdm) throw new BusinessRuleError('PEDIDO_META_DIARIA_EXCEDIDA', { codpedcomp, excedidas });
    const { ok } = await this.senhaOp.verificar('admin', senhaAdm);
    if (!ok) throw new BusinessRuleError('SENHA_ADMINISTRATIVA_INVALIDA', { codpedcomp });
  }

  /**
   * o pedido, travado, se a LOJA do contexto participa dele (é a dona ou está no CSV `empresas`) — o
   * `PedidoPertenceEmpresaSelecionada` do legado. Pedido excluído (soft-delete) é inexistente.
   */
  private async pedidoDaLoja(trx: AnyDB, codpedcomp: number, emp: number, colunas: string[]): Promise<Record<string, unknown>> {
    const pc = (await trx
      .selectFrom('pedidocompra')
      .select(['codpedcomp', 'idempresa', 'empresas', ...colunas])
      .where('codpedcomp', '=', codpedcomp)
      .where(sql<boolean>`(idempresa = ${emp} OR ${String(emp)} = ANY(string_to_array(replace(coalesce(empresas, ''), ' ', ''), ',')))`)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .forUpdate()
      .executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!pc) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });
    if (!lojasDoPedido(pc.empresas, pc.idempresa as number).includes(emp)) {
      throw new BusinessRuleError('PEDIDO_LOJA_NAO_PARTICIPA', { codpedcomp, idempresa: emp });
    }
    return pc;
  }

  /** a trava de EDIÇÃO por loja (btnEditarClick, uPedidoCompra.pas:6610): todas fechadas, ou a loja logada fechada. */
  private async exigirEditavel(trx: AnyDB, codpedcomp: number, emp: number, fechadoCabecalho: unknown): Promise<void> {
    const estado = await estadoFechamento(trx, codpedcomp, fechadoCabecalho as string | null);
    if (estado.tipo === 'total') throw new BusinessRuleError('PEDIDO_FECHADO', { codpedcomp });
    if (lojaFechada(estado, emp)) throw new BusinessRuleError('PEDIDO_FECHADO_NA_EMPRESA', { codpedcomp, idempresa: emp });
  }

  /**
   * O TOTAL DE CADA LOJA do pedido (`sqqTotalPedido`, udmPedidoCompra.dfm:3939: Σ PEDIDO_COMPRA_QTDE.TOTALCUSTO por
   * IDEMPRESA), em centavos, na ordem da loja. A loja do CSV sem linha entra com zero — o legado a acrescenta ao
   * `cdsTotalPedido` com TOTALCUSTO 0 (uPedidoCompra.pas:857, :4544) e ela ganha parcelas zeradas (222 na produção,
   * 2025-26). Pedido sem linha por loja nenhuma (legado anterior à mig 303): a soma dos itens, na loja dona.
   */
  private async totaisPorLoja(trx: AnyDB, codpedcomp: number, empresas: unknown, idempresa: number | null): Promise<Array<{ idempresa: number; cents: number }>> {
    const rows = (await sql<{ idempresa: number; s: unknown }>`
        SELECT q.idempresa, sum(q.totalcusto) AS s
          FROM pedido_compra_qtde q
          JOIN pedidocompra_i i ON i.codpedcompi = q.codpedcompi
         WHERE i.codpedcomp = ${codpedcomp}
         GROUP BY q.idempresa
         ORDER BY q.idempresa`.execute(trx)).rows;
    const lojas = lojasDoPedido(empresas, idempresa);
    if (!rows.length) {
      const tot = (await trx.selectFrom('pedidocompra_i').select(({ fn }: any) => [fn.sum('totalcusto').as('s')])
        .where('codpedcomp', '=', codpedcomp).executeTakeFirst()) as { s?: unknown } | undefined;
      return [{ idempresa: lojas[0] ?? Number(idempresa), cents: Math.round(num(tot?.s) * 100) }];
    }
    const out = rows.map((r) => ({ idempresa: Number(r.idempresa), cents: Math.round(num(r.s) * 100) }));
    for (const l of lojas) if (!out.some((o) => o.idempresa === l)) out.push({ idempresa: l, cents: 0 });
    return out;
  }

  /**
   * O RATEIO (`RatearTotalNasParcelas`, uPedidoCompra.pas:8892) — POR LOJA: para cada loja do `cdsTotalPedido`,
   * VALOR = round(total DA LOJA / nº de prazos), a SOBRA na PRIMEIRA (Σ = total da loja ao centavo), a mesma data
   * para todas as lojas (base + CDn; na produção 1.521 de 1.521 parcelas têm a mesma data nas duas lojas).
   * Pedido de uma loja só = um grupo, o comportamento de sempre.
   */
  private rateioPorLoja(totais: Array<{ idempresa: number; cents: number }>, prazos: number[], baseISO: string):
    Array<{ idempresa: number; parcela: number; data: string; valor: number; dias: number }> {
    const out: Array<{ idempresa: number; parcela: number; data: string; valor: number; dias: number }> = [];
    const n = prazos.length;
    for (const t of totais) {
      const valorCents = Math.round(t.cents / n);
      const residuo = t.cents - valorCents * n;
      prazos.forEach((dias, i) => {
        const dt = new Date(`${baseISO}T00:00:00Z`);
        dt.setUTCDate(dt.getUTCDate() + dias);
        out.push({ idempresa: t.idempresa, parcela: i + 1, data: dt.toISOString().slice(0, 10), valor: (valorCents + (i === 0 ? residuo : 0)) / 100, dias });
      });
    }
    return out;
  }

  /** os prazos efetivos: CD1..CD8 do PEDIDO (override); se nenhum, os da CONDIÇÃO (codconpagto). */
  private async prazosDoPedido(trx: AnyDB, pc: Record<string, unknown>): Promise<number[]> {
    let prazos = CD_COLS.map((c) => pc[c]).filter((v) => v != null && v !== '').map((v) => Number(v));
    if (prazos.length === 0 && pc.codconpagto != null) {
      const cond = (await trx.selectFrom('condicoes_pagto').select([...CD_COLS])
        .where('codconpagto', '=', Number(pc.codconpagto)).executeTakeFirst()) as Record<string, unknown> | undefined;
      if (cond) prazos = CD_COLS.map((c) => cond[c]).filter((v) => v != null && v !== '').map((v) => Number(v));
    }
    return prazos;
  }

  /**
   * a trava de FATURADO para a loja (mig 303): no multi-loja, a nota DA LOJA vinculada ao pedido (a da loja 1 não
   * trava a loja 2); na loja só, o marcador `dtfaturamento` do cabeçalho — o comportamento de sempre.
   */
  private async faturadoNaLoja(trx: AnyDB, pc: Record<string, unknown>, codpedcomp: number, emp: number): Promise<boolean> {
    if (lojasDoPedido(pc.empresas, pc.idempresa as number).length > 1) return lojaRecebeu(trx, codpedcomp, emp);
    return pc.dtfaturamento != null;
  }

  /**
   * corte-2 — GERA as parcelas do pedido a partir da condição de pagamento (RatearTotalNasParcelas,
   * uPedidoCompra.pas:8892). Prazos (dias) = CD1..CD8 do PEDIDO (override local); se nenhum, os da CONDIÇÃO
   * (codconpagto). mig 303: o rateio é POR LOJA (`rateioPorLoja`) — cada loja parcela o PRÓPRIO total, como na
   * produção (1.083 de 1.083 pedidos multi-loja com parcela de 2025-26 têm parcelas das duas lojas). Data-base =
   * data de faturamento (ou a do pedido); VENC = base + CDn. Substitui as parcelas existentes. É uma edição: a loja
   * que dispara tem de participar e poder editar.
   */
  async gerarParcelas(codpedcomp: number): Promise<{ codpedcomp: number; parcelas: number; total: number; lojas: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const pc = await this.pedidoDaLoja(trx, codpedcomp, emp, [
        'fechado', 'dtfaturamento', 'codconpagto', ...CD_COLS,
        sql<string>`to_char(coalesce(data_faturamento, data)::date, 'YYYY-MM-DD')`.as('base') as any,
      ]);
      if (await this.faturadoNaLoja(trx, pc, codpedcomp, emp)) throw new BusinessRuleError('PEDIDO_FATURADO', { codpedcomp });
      await this.exigirEditavel(trx, codpedcomp, emp, pc.fechado); // mig 303: trava por loja

      const prazos = await this.prazosDoPedido(trx, pc);
      if (prazos.length === 0) throw new BusinessRuleError('PEDIDO_SEM_CONDICAO_PAGTO', { codpedcomp });

      // total = Σ TOTALCUSTO (078, FLIP: TOTALCUSTO = QTDE×VLREMBALAGEM, fiel ao sqqTotalPedido) — agora POR LOJA.
      const totais = await this.totaisPorLoja(trx, codpedcomp, pc.empresas, pc.idempresa as number | null);
      const totalCents = totais.reduce((s, t) => s + t.cents, 0);
      if (totalCents <= 0) throw new BusinessRuleError('PEDIDO_SEM_VALOR', { codpedcomp });

      const parcelas = this.rateioPorLoja(totais, prazos, String(pc.base));
      await trx.deleteFrom('pedidocompra_parcelas').where('codpedcomp', '=', codpedcomp).execute();
      for (const p of parcelas) {
        await trx.insertInto('pedidocompra_parcelas').values({
          codpedcomp, idempresa: p.idempresa, parcela: p.parcela, data: p.data, valor: p.valor, qtdediasaposfaturamento: p.dias,
        }).execute();
      }

      await trx
        .updateTable('pedidocompra')
        .set({ usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpedcomp', '=', codpedcomp)
        .execute();
      return { codpedcomp, parcelas: parcelas.length, total: totalCents / 100, lojas: totais.length };
    });
  }

  /**
   * corte-final — FLUXO deste pedido (parcelas MATERIALIZADAS ou PROJETADAS). O legado chama
   * `RatearTotalNasParcelas(False)` no próprio gravar (uPedidoCompra.pas:6866), então o fluxo do pedido
   * SEMPRE existe na validação — mesmo sem o operador ter clicado "Gerar parcelas". Aqui: usa as parcelas
   * persistidas se houver; senão PROJETA com o MESMO rateio por loja do gerarParcelas. Sem CDs → 1 ponto (total na
   * data-base). Total ≤ 0 → sem fluxo. mig 303: a loja que JÁ RECEBEU nota deste pedido sai do fluxo
   * (`GetValorParcela` ignora as lojas de `GetEmpresasComNF`, uPedidoCompra.pas:1725/1933) — o dinheiro dela já é
   * duplicata, não previsão.
   */
  private async fluxoDoPedido(trx: AnyDB, codpedcomp: number): Promise<Array<{ data: string; valor: number }>> {
    const comNf = new Set(((await trx.selectFrom('nf').select('idempresa').distinct()
      .where('codpedcomp', '=', codpedcomp)
      .where(sql`coalesce(cancelada, 'N')`, '<>', 'S').where(sql`coalesce(statusnfe, '')`, '<>', 'C')
      .execute()) as Array<{ idempresa: number }>).map((r) => Number(r.idempresa)));
    const parc = (await trx
      .selectFrom('pedidocompra_parcelas')
      .select([sql<string>`to_char(data::date, 'YYYY-MM-DD')`.as('d'), 'valor', 'idempresa'])
      .where('codpedcomp', '=', codpedcomp)
      .execute()) as Array<{ d: string; valor: unknown; idempresa: number | null }>;
    if (parc.length) {
      return parc.filter((p) => p.idempresa == null || !comNf.has(Number(p.idempresa)))
        .map((p) => ({ data: p.d, valor: r2(num(p.valor)) }));
    }

    // sem parcelas materializadas → projeta pelo mesmo rateio do gerarParcelas.
    const pc = (await trx
      .selectFrom('pedidocompra')
      .select(['idempresa', 'empresas', sql<string>`to_char(coalesce(data_faturamento, data)::date, 'YYYY-MM-DD')`.as('base'), 'codconpagto', ...CD_COLS])
      .where('codpedcomp', '=', codpedcomp)
      .executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!pc) return [];
    const totais = (await this.totaisPorLoja(trx, codpedcomp, pc.empresas, pc.idempresa as number | null))
      .filter((t) => !comNf.has(t.idempresa));
    const totalCents = totais.reduce((s, t) => s + t.cents, 0);
    if (totalCents <= 0) return [];
    const prazos = await this.prazosDoPedido(trx, pc);
    const baseISO = String(pc.base);
    if (prazos.length === 0) return [{ data: baseISO, valor: totalCents / 100 }];
    return this.rateioPorLoja(totais, prazos, baseISO).map((p) => ({ data: p.data, valor: p.valor }));
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

    const meu = await this.fluxoDoPedido(trx, codpedcomp);
    if (!meu.length) return; // A1: pedido sem valor → nada a projetar; com valor, o fluxo SEMPRE é validado.

    // Σ parcelas de OUTROS pedidos num intervalo (exclui o corrente — somado da memória). O escopo é o do legado
    // (`GetSQLFluxo`, udmPedidoCompra.pas:1893): parcelas de TODAS as lojas — o limite é da rede, não da loja —, fora
    // as de (pedido, loja) que já têm nota (`NOT EXISTS NF … N.IDEMPRESA = P.IDEMPRESA`). Até a mig 303 o Apollo
    // filtrava a loja dona e o `dtfaturamento` do cabeçalho, que no multi-loja marca a PRIMEIRA nota e tiraria do
    // fluxo a loja que ainda não recebeu.
    const somaOutros = async (ini: string, fim: string): Promise<number> => {
      const t = (await trx
        .selectFrom('pedidocompra_parcelas as pp')
        .innerJoin('pedidocompra as p', 'p.codpedcomp', 'pp.codpedcomp')
        .select(({ fn }: any) => [fn.sum('pp.valor').as('s')])
        .where('pp.codpedcomp', '<>', codpedcomp)
        .where(sql`coalesce(p.indr,'I')`, '<>', 'E')
        .where(sql<boolean>`NOT EXISTS (SELECT 1 FROM nf n WHERE n.codpedcomp = pp.codpedcomp AND n.idempresa = pp.idempresa
                                          AND coalesce(n.cancelada, 'N') <> 'S' AND coalesce(n.statusnfe, '') <> 'C')`)
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
  async liberarLimite(codpedcomp: number, override?: { login?: string; senha?: string }): Promise<{ codpedcomp: number; operador: number }> {
    const emp = this.emp();
    const op = this.op();
    // E8 corte-3 (ChamaLiberacaoLogin, uPedidoCompra.pas:3735): se vier login+senha, VALIDA um SUPERVISOR contra
    // USUARIOS_LIBERAM_VALOR_MAX_EXCEDIDO (+ registra LOG_LIBERACOES) e grava o CÓDIGO DO SUPERVISOR como liberador.
    // Sem login+senha → mantém o caminho RBAC do §13 (o próprio operador, grant LIBERAVALORMAX). Backward-compatible.
    let liberador = op;
    if (override?.login && override?.senha) {
      const r = await this.liberacao.validar({
        codigo: 'USUARIOS_LIBERAM_VALOR_MAX_EXCEDIDO',
        login: override.login,
        senha: override.senha,
        liberacao: `LIBERACAO DE VALOR MAXIMO DO PEDIDO DE COMPRA ${codpedcomp}`,
      });
      if (!r.liberado || r.codOperador == null) throw new BusinessRuleError('LIBERACAO_NAO_AUTORIZADA', { codpedcomp });
      liberador = r.codOperador;
    }
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const pc = await this.pedidoDaLoja(trx, codpedcomp, emp, ['fechado', 'dtfaturamento']); // mig 303: loja participante
      if (await this.faturadoNaLoja(trx, pc, codpedcomp, emp)) throw new BusinessRuleError('PEDIDO_FATURADO', { codpedcomp });
      // mig 303: a liberação vale para o fechar da loja — que já tenha fechado, não há o que liberar
      if (lojaFechada(await estadoFechamento(trx, codpedcomp, (pc as any).fechado), emp)) {
        throw new BusinessRuleError('PEDIDO_JA_FECHADO', { codpedcomp });
      }
      await trx
        .updateTable('pedidocompra')
        .set({ operador_ult_lib_valor_max: liberador, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpedcomp', '=', codpedcomp)
        .execute();
      return { codpedcomp, operador: liberador };
    });
  }

  /** proxy do `PromocaoAcumulativa` (módulo não migrado): o produto está em promoção nessa loja? */
  private async emPromocao(trx: AnyDB, idproduto: number, idempresa: number): Promise<boolean> {
    const r = (await trx.selectFrom('multi_preco').select('promocao')
      .where('idproduto', '=', idproduto).where('idempresa', '=', idempresa)
      .executeTakeFirst()) as { promocao?: string } | undefined;
    return r?.promocao === 'S';
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
  /**
   * "Atualizar preço → **Gerar Lote**" (uPedidoCompra.pas:1353/1443) — o MODO ALTERNATIVO ao on-line
   * (`atualizarPrecos`): em vez de gravar MULTI_PRECO agora, ENFILEIRA um lote_preco por (item × empresa) p/ a tela
   * de Ajuste de Preços aplicar depois. Fiel: pré-checagem `LTPRECO_PROCESSADO='S'` → recusa o 2º gerar-lote do
   * MESMO pedido; só itens cujo VRVENDA difere do preço atual; pula produto em promoção (proxy conservador
   * multi_preco.promocao='S', o mesmo de atualizarPrecos, no lugar do PromocaoAcumulativa não-migrado); OBS
   * 'REFERENTE AO PEDIDO DE NRO. <cod> ' (COM o espaço final do legado); SEM origem/codoperador/markup/promo
   * (o legado não os escreve nesta origem); vrvenda com 4 casas. No fim carimba LTPRECO_PROCESSADO='S'.
   */
  async gerarLotePreco(codpedcomp: number): Promise<{ codpedcomp: number; lotes: number; pulados_promocao: number; sem_diferenca: number }> {
    const emp = this.emp();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // a loja que participa do pedido pode atualizar os preços dele (mig 303)
      const pc = (await this.pedidoDaLoja(trx, codpedcomp, emp, ['ltpreco_processado'])) as { ltpreco_processado?: string; empresas?: string; idempresa?: number };
      if (String(pc.ltpreco_processado ?? 'N') === 'S') throw new BusinessRuleError('PEDIDO_LOTE_PRECO_JA_GERADO', { codpedcomp });

      const itens = (await trx
        .selectFrom('pedidocompra_i')
        .select(['idproduto', 'vrvenda'])
        .where('codpedcomp', '=', codpedcomp)
        .where('vrvenda', '>', 0)
        .orderBy('codpedcompi')
        .execute()) as Array<{ idproduto: number; vrvenda: unknown }>;

      // mesmo conjunto de empresas do ramo on-line: as LOJAS DO PEDIDO, ou todas com a config (mig 303).
      const todas = (await this.config.resolver('ATUALIZA_PRECO_OUTRAS_EMPRESAS', { empresaId: emp })) === 'S';
      let empresas: number[] = lojasDoPedido(pc.empresas, pc.idempresa ?? emp);
      if (todas) {
        const rows = (await trx.selectFrom('empresas').select('idempresa').execute()) as Array<{ idempresa: number }>;
        empresas = rows.map((r) => Number(r.idempresa));
      }

      let lotes = 0;
      let pulados = 0;
      let semDif = 0;
      for (const it of itens) {
        const venda = r4(num(it.vrvenda));
        // no lote, a trava da loja logada só existe no ramo das lojas do pedido (uPedidoCompra.pas:1437); o ramo
        // da config 'S' olha só a loja de destino (:1478)
        if (!todas && (await this.emPromocao(trx, it.idproduto, emp))) { pulados += empresas.length; continue; }
        for (const e of empresas) {
          const mp = (await trx
            .selectFrom('multi_preco')
            .select(['vrvenda', 'promocao'])
            .where('idproduto', '=', it.idproduto)
            .where('idempresa', '=', e)
            .executeTakeFirst()) as { vrvenda?: unknown; promocao?: string } | undefined;
          if (!mp) continue; // sem preço nessa empresa → o join do legado (PI×MP) não casa
          if (mp.promocao === 'S') { pulados++; continue; } // proxy do PromocaoAcumulativa (idem atualizarPrecos)
          if (r4(num(mp.vrvenda)) === venda) { semDif++; continue; } // fiel: só itens com VRVENDA <> MP.VRVENDA
          await trx.insertInto('lote_preco').values({
            idproduto: it.idproduto, codempresa: e, vrvenda: venda, processado: 'N', datalote: sql`now()`,
            obs: `REFERENTE AO PEDIDO DE NRO. ${codpedcomp} `, // espaço final = fiel ao literal do legado
          }).execute();
          lotes++;
        }
      }
      if (lotes > 0) {
        await trx.updateTable('pedidocompra').set({ ltpreco_processado: 'S' }).where('codpedcomp', '=', codpedcomp).execute();
      }
      return { codpedcomp, lotes, pulados_promocao: pulados, sem_diferenca: semDif };
    });
  }

  async atualizarPrecos(codpedcomp: number): Promise<{ codpedcomp: number; atualizados: number; pulados_promocao: number; sem_diferenca: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const pc = (await this.pedidoDaLoja(trx, codpedcomp, emp, [])) as { empresas?: string; idempresa?: number };

      const itens = (await trx
        .selectFrom('pedidocompra_i')
        .select(['idproduto', 'vrvenda'])
        .where('codpedcomp', '=', codpedcomp)
        .where('vrvenda', '>', 0)
        .orderBy('codpedcompi')
        .execute()) as Array<{ idproduto: number; vrvenda: unknown }>;

      // conjunto de empresas: config 'S' → TODAS; senão as LOJAS DO PEDIDO — o legado percorre `cdsTotalPedido`, as
      // lojas participantes (uPedidoCompra.pas:3504-3530). Até a mig 303 o pedido era de uma loja só e o conjunto era
      // {emp}; agora vem do CSV `empresas`.
      const todas = (await this.config.resolver('ATUALIZA_PRECO_OUTRAS_EMPRESAS', { empresaId: emp })) === 'S';
      let empresas: number[] = lojasDoPedido(pc.empresas, pc.idempresa ?? emp);
      if (todas) {
        const rows = (await trx.selectFrom('empresas').select('idempresa').execute()) as Array<{ idempresa: number }>;
        empresas = rows.map((r) => Number(r.idempresa));
      }

      let atualizados = 0;
      let pulados = 0;
      let semDif = 0;
      for (const it of itens) {
        const venda = r2(num(it.vrvenda));
        // "Se a empresa atual não pode atualizar o preço, então não pode passar valor desatualizado às demais"
        // (uPedidoCompra.pas:3508, :3548 — nos DOIS ramos): promoção na loja logada trava o produto em todas.
        if (await this.emPromocao(trx, it.idproduto, emp)) { pulados += empresas.length; continue; }
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
          'codpedcomp', 'codparceiro', 'codconpagto', 'idsituacao_nf', 'pc_tipo_frete', 'pc_valor_frete', 'obs', 'empresas',
          sql<string>`to_char(data::date, 'YYYY-MM-DD')`.as('data_iso'),
          sql<string | null>`to_char(dt_vencimento::date, 'YYYY-MM-DD')`.as('venc_iso'),
          sql<string>`to_char(now()::date, 'YYYY-MM-DD')`.as('hoje_iso'),
          ...CD_COLS,
        ])
        .where('codpedcomp', '=', codpedcomp)
        // mig 303: a loja PARTICIPANTE duplica (o pedido não tem dona no legado)
        .where(sql<boolean>`(idempresa = ${emp} OR ${String(emp)} = ANY(string_to_array(replace(coalesce(empresas, ''), ' ', ''), ',')))`)
        .where(sql`coalesce(indr,'I')`, '<>', 'E')
        .executeTakeFirst()) as Record<string, unknown> | undefined;
      if (!pc) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });

      const itens = (await trx
        .selectFrom('pedidocompra_i')
        .select(['codpedcompi', 'idproduto', 'qtde', 'fatorembalagem', 'vrcusto', 'desconto', 'descontop', 'obs', 'vrcustoliquido', 'markup', 'vrvenda', 'vrvendasug', 'margeml2', 'margeml2v', 'pmz', 'bonificacao'])
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
            usucadastro: op, // o "comprador" que decide quem libera a análise (USUCADASTRO do legado) — fold auditoria
            data: pc.data_iso as string,
            obs: `BONIFICAÇÃO REFERENTE AO PEDIDO: ${codpedcomp}`,
            fechado: 'N',
            bonificacao: 'S',
            empresas: (pc.empresas as string | null) ?? String(emp), // mig 303: as mesmas lojas (DuplicaPedido clona o cabeçalho)
          }
        : {
            idempresa: emp,
            codparceiro: pc.codparceiro as number,
            codoperador: op,
            usucadastro: op, // o "comprador" que decide quem libera a análise (USUCADASTRO do legado) — fold auditoria
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
            empresas: (pc.empresas as string | null) ?? String(emp), // mig 303: as mesmas lojas
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
        const qtde = num(it.qtde) > 0 ? num(it.qtde) : 1; // 078 FLIP: nº de embalagens (preserva no duplicar/espelho)
        const vlrembalagem = r4(fator * custo);
        const base = { codpedcomp: novo, idproduto: it.idproduto as number, qtde, fatorembalagem: fator, vrcusto: custo, vlrembalagem, qtdtotal: r4(qtde * fator), totalcusto: Math.round((qtde * vlrembalagem + Number.EPSILON) * 100) / 100 };
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
        const novoItem = (await trx.insertInto('pedidocompra_i').values(item).returning('codpedcompi').executeTakeFirstOrThrow()) as { codpedcompi: number };
        // mig 303: as quantidades POR LOJA vêm junto (DuplicaPedido copia PEDIDO_COMPRA_QTDE, udmPedidoCompra.pas:1665) —
        // sem o fechamento: o pedido novo é rascunho. Item antigo sem linha por loja cai inteiro na primeira loja.
        const origemLojas = (await trx.selectFrom('pedido_compra_qtde').select(['idempresa', 'qtde'])
          .where('codpedcompi', '=', Number(it.codpedcompi)).orderBy('idempresa').execute()) as Array<{ idempresa: number; qtde: unknown }>;
        const lojasNovo = origemLojas.length
          ? origemLojas.map((l) => ({ idempresa: Number(l.idempresa), qtde: num(l.qtde) }))
          : [{ idempresa: lojasDoPedido(pc.empresas, emp)[0] ?? emp, qtde }];
        await trx.insertInto('pedido_compra_qtde').values(lojasNovo.map((l) => ({
          codpedcompi: novoItem.codpedcompi, idempresa: l.idempresa, qtde: l.qtde, qtdtotal: r4(l.qtde * fator),
          totalcusto: Math.round((l.qtde * r4(fator * custo) + Number.EPSILON) * 100) / 100, digitacao_fechada: 'N',
        }))).execute();
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
      const pc = await this.pedidoDaLoja(trx, codpedcomp, emp, ['fechado', 'dtfaturamento', 'codparceiro']); // mig 303: loja participante
      if (await this.faturadoNaLoja(trx, pc, codpedcomp, emp)) throw new BusinessRuleError('PEDIDO_FATURADO', { codpedcomp });
      // adicionar item bloqueia só com TODAS as lojas fechadas (btnAdicionarIClick, uPedidoCompra.pas:4432)
      if ((await estadoFechamento(trx, codpedcomp, (pc as any).fechado)).tipo === 'total') {
        throw new BusinessRuleError('PEDIDO_FECHADO', { codpedcomp });
      }
      const forn = Number((pc as any).codparceiro);
      const lojasPed = lojasDoPedido((pc as any).empresas, emp);

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
        // 078 FLIP: QTDE=1 default (o comprador ajusta depois); TOTALCUSTO obrigatório (SUM ignora NULL → item some do total).
        const vlrembalagem = r4(fator * custo);
        // mig 303: pedido de uma loja só mantém a QTDE=1 de antes; no multi-loja o item entra ZERADO em cada loja —
        // o comprador distribui (é a linha zerada que o legado cria para cada loja participante)
        const multi = lojasPed.length > 1;
        const qtdeItem = multi ? 0 : 1;
        const novoItem = (await trx
          .insertInto('pedidocompra_i')
          .values({ codpedcomp, idproduto: idp, qtde: qtdeItem, fatorembalagem: fator, vrcusto: custo, vlrembalagem, qtdtotal: r4(qtdeItem * fator), totalcusto: Math.round((qtdeItem * vlrembalagem + Number.EPSILON) * 100) / 100 })
          .returning('codpedcompi')
          .executeTakeFirstOrThrow()) as { codpedcompi: number };
        await trx.insertInto('pedido_compra_qtde').values(lojasPed.map((loja, idx) => {
          const q = multi ? 0 : (idx === 0 ? 1 : 0);
          return { codpedcompi: novoItem.codpedcompi, idempresa: loja, qtde: q, qtdtotal: r4(q * fator),
            totalcusto: Math.round((q * vlrembalagem + Number.EPSILON) * 100) / 100, digitacao_fechada: 'N' };
        })).execute();
        importados++;
      }
      await trx
        .updateTable('pedidocompra')
        .set({ usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpedcomp', '=', codpedcomp)
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
  async reabrir(codpedcomp: number, override?: { login?: string; senha?: string }): Promise<{ codpedcomp: number; fechado: 'N'; idempresa: number; fechamento: string }> {
    const emp = this.emp();
    const op = this.op();
    // USUARIOS_REABREM_PEDIDO_COMPRA (uPedidoCompra.pas:7811): com a lista preenchida, só quem está nela reabre — ou
    // um deles autoriza por login e senha. Lista vazia (é o caso do cliente) = qualquer operador com o grant da tela.
    let autorizador: { cod: number; nome: string | null } | null = null;
    const permitidos = await this.config.usuariosPermitidos('USUARIOS_REABREM_PEDIDO_COMPRA');
    if (permitidos.length && !permitidos.includes(op)) {
      if (!override?.login || !override?.senha) throw new BusinessRuleError('LIBERACAO_NAO_AUTORIZADA', { codpedcomp, liberacao: 'USUARIOS_REABREM_PEDIDO_COMPRA' });
      const r = await this.liberacao.validar({
        codigo: 'USUARIOS_REABREM_PEDIDO_COMPRA', login: override.login, senha: override.senha,
        liberacao: `REABERTURA DO PEDIDO DE COMPRA ${codpedcomp}`,
      });
      if (!r.liberado || r.codOperador == null) throw new BusinessRuleError('LIBERACAO_NAO_AUTORIZADA', { codpedcomp });
      autorizador = { cod: r.codOperador, nome: null };
    }
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const pc = await this.pedidoDaLoja(trx, codpedcomp, emp, ['fechado', 'dtfaturamento']);
      const antes = await estadoFechamento(trx, codpedcomp, (pc as any).fechado);
      if (!lojaFechada(antes, emp)) throw new BusinessRuleError('PEDIDO_NAO_FECHADO', { codpedcomp, idempresa: emp });
      // recebido não reabre: no multi-loja é a nota DESTA loja (mig 303); numa loja só, o marcador de antes
      const multi = lojasDoPedido((pc as any).empresas, (pc as any).idempresa).length > 1;
      if (multi ? await lojaRecebeu(trx, codpedcomp, emp) : (pc as any).dtfaturamento != null) {
        throw new BusinessRuleError('PEDIDO_FATURADO', { codpedcomp });
      }

      // REARMA o limite (M1) na reabertura — e desfaz o fechamento SÓ da loja logada (uPedidoCompra.pas:7840)
      await trx
        .updateTable('pedidocompra')
        .set({ fechado: 'N', operador_ult_lib_valor_max: null, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpedcomp', '=', codpedcomp)
        .execute();
      await sql`UPDATE pedido_compra_qtde SET fechado = 'N', data_fechamento = NULL, codoperador = NULL
                 WHERE idempresa = ${emp}
                   AND codpedcompi IN (SELECT codpedcompi FROM pedidocompra_i WHERE codpedcomp = ${codpedcomp})`.execute(trx);
      if (autorizador) {
        const nome = (await trx.selectFrom('operadores').select('nome').where('codoperador', '=', autorizador.cod).executeTakeFirst()) as { nome?: string } | undefined;
        await novoHistorico(trx, codpedcomp, op, `Pedido reaberto para a empresa ${emp} através da tela de pedido de compra autorizado pelo operador ${nome?.nome ?? autorizador.cod}.`);
      } else {
        await novoHistorico(trx, codpedcomp, op, `Pedido reaberto para a empresa ${emp} através da tela de pedido de compra.`);
      }
      const depois = await estadoFechamento(trx, codpedcomp, 'N');
      return { codpedcomp, fechado: 'N' as const, idempresa: emp, fechamento: depois.tipo };
    });
  }

}
