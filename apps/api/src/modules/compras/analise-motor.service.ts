import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { ConfigService } from '../cadastro/config.service';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/** o legado grava número com vírgula em algumas configs ('0,00') — Number() precisa do ponto. */
const cfgNum = (v: unknown) => Number(String(v ?? '0').replace(',', '.')) || 0;

/**
 * decide se um produto é DIVERGENTE entre pedido e nota — `AnalisaProdutosDivergencia`
 * (UAnalisePedidosNF.pas). É a regra central do corte, e ela tem duas assimetrias que importam:
 *
 *  · **quantidade** só conta quando a análise é TOTAL (numa parcial a nota traz parte do pedido, então diferença
 *    de quantidade é esperada). Para produto vendido por **KG** existe tolerância PERCENTUAL
 *    (`DIFERENCA_MAXIMA_ACEITA_QTDE_KG`, calculada sobre o MAIOR dos dois); para as outras unidades **qualquer**
 *    diferença é divergência.
 *  · **valor**: acima (NF > pedido) a tolerância é em **VALOR ABSOLUTO** (`VARIACAO_POSITIVA_NF`); abaixo
 *    (NF < pedido) é em **PERCENTUAL** sobre o custo do pedido (`VARIACAO_NEGATIVA_NF`). Trocar uma pela outra
 *    passa despercebido com tolerância 0 (o caso do golden) e explode quando alguém configurar.
 *
 * A comparação de valor só acontece quando a de quantidade não pegou (o `else if` do legado).
 */
export function ehDivergente(
  p: { custoPedido: number; qtdPedido: number; custoNf: number; qtdNf: number; unidade: string },
  tol: { positivaValor: number; negativaPerc: number; qtdeKgPerc: number },
  total: boolean,
): boolean {
  const dif = p.custoNf - p.custoPedido;
  const qtdDifere = total && p.qtdPedido !== p.qtdNf;
  if (dif === 0 && !qtdDifere) return false; // fora do escopo da análise (o guard do legado)
  if (qtdDifere) {
    if (String(p.unidade ?? '').toUpperCase() === 'KG') {
      const maior = Math.max(p.qtdPedido, p.qtdNf);
      const menor = Math.min(p.qtdPedido, p.qtdNf);
      const perc = maior > 0 ? ((maior - menor) / maior) * 100 : 0;
      return perc > tol.qtdeKgPerc;
    }
    return true; // unidade que não é KG: qualquer diferença de quantidade é divergência
  }
  if (dif > 0) return dif > tol.positivaValor;               // acima: tolerância em VALOR
  const perc = p.custoPedido !== 0 ? Math.abs(dif / p.custoPedido) * 100 : 0;
  return perc > tol.negativaPerc;                            // abaixo: tolerância em PERCENTUAL
}

/**
 * MOTOR da ANÁLISE PEDIDO × NF (corte-2b) — `TAnalisePedidosNF` (UAnalisePedidosNF.pas): cria a análise e a
 * PROCESSA, gravando as 3 listas que a tela mostra (o corte-2a já lia): divergências, itens que estão na NF e
 * não no pedido, e itens que estão no pedido e não na NF.
 *
 * As duas fontes da comparação (fiéis às queries do legado):
 *  · **PEDIDO** (`GetQryProdutosPedido`): custo médio PONDERADO = `Σ(vrcusto × qtdtotal) / Σ(qtdtotal)` e
 *    quantidade = `Σ(qtdtotal)`, agrupado por produto — sobre os pedidos vinculados à análise. (No legado a
 *    quantidade vem de PEDIDO_COMPRA_QTDE por empresa; aqui de `pedidocompra_i.qtdtotal`, a projeção
 *    single-empresa que a mig 078 documentou.)
 *  · **NOTA** (`GetQryProdutosNF`): os itens do XML da fila do manifesto (`nfe_nao_cadastradas_itens`, ligados
 *    pela CHAVENFE), com o custo unitário **RATEADO**: `vrunitariotrib + (frete + seguro + outros + ICMS-ST +
 *    FCP-ST + IPI) / (fatorembal × quantidade)`, também ponderado por `Σ(fatorembal × quantidade)`. Quando
 *    `fatorembal × quantidade` é 0 o legado usa o `vrunitariotrib` puro (sem rateio) — copiado.
 *
 * O corte-2c (declarado) fica com: o fluxo RPN (`GeraNovaAnalise` a partir de uma análise antiga), "liberar
 * análise" (que finaliza a pendência e grava ANALISE_PEDIDO_NF_CR), excluir, `FechaPedidoCompra`,
 * `GeraPendenciaAnalista`/`GeraPendenciaComprador` e a impressão.
 */
@Injectable()
export class AnaliseMotorService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** as 3 tolerâncias (todas 0 no golden ⇒ qualquer diferença é divergência). */
  private async tolerancias(emp: number) {
    const [pos, neg, kg] = await Promise.all([
      this.config.resolver('VARIACAO_POSITIVA_NF', { empresaId: emp }),
      this.config.resolver('VARIACAO_NEGATIVA_NF', { empresaId: emp }),
      this.config.resolver('DIFERENCA_MAXIMA_ACEITA_QTDE_KG', { empresaId: emp }),
    ]);
    return { positivaValor: cfgNum(pos), negativaPerc: cfgNum(neg), qtdeKgPerc: cfgNum(kg) };
  }

  /** produtos do PEDIDO da análise: custo médio ponderado + quantidade total, por produto. */
  private async produtosPedido(db: AnyDB, apnId: number) {
    return (await db.selectFrom('analise_pedido_nf_pedido as ap')
      .innerJoin('pedidocompra_i as i', 'i.codpedcomp', 'ap.codpedcomp')
      .innerJoin('produtos as pr', 'pr.idproduto', 'i.idproduto')
      .select([
        'i.idproduto', sql`pr.codbarra`.as('codbarra'), sql`pr.descricao`.as('descricao'), sql`pr.unidade`.as('unidade'),
        sql`sum(round(coalesce(i.vrcusto,0) * coalesce(i.qtdtotal,0), 2)) / (case when sum(coalesce(i.qtdtotal,0)) > 0 then sum(coalesce(i.qtdtotal,0)) else 1 end)`.as('vrcusto'),
        sql`sum(coalesce(i.qtdtotal,0))`.as('qtdtotal'),
      ])
      .where('ap.apn_id', '=', apnId)
      .groupBy(['i.idproduto', 'pr.codbarra', 'pr.descricao', 'pr.unidade'])
      .execute()) as Array<Record<string, unknown>>;
  }

  /** produtos da NOTA da análise: custo unitário com rateio de frete/seguro/outros/ST/FCP-ST/IPI, ponderado. */
  private async produtosNf(db: AnyDB, apnId: number) {
    const emb = sql`(coalesce(nnci.fatorembal,0) * coalesce(nnci.quantidade,0))`;
    const unit = sql`case when ${emb} > 0
      then round((coalesce(nnci.vrunitariotrib,0)
        + coalesce(nnci.vrfrete,0) / ${emb} + coalesce(nnci.vrseg,0) / ${emb}
        + coalesce(nnci.vroutro,0) / ${emb} + coalesce(nnci.vricmst,0) / ${emb}
        + coalesce(nnci.vrfcpst,0) / ${emb} + coalesce(nnci.ipi_nota,0) / ${emb})::numeric, 2)
      else round(coalesce(nnci.vrunitariotrib,0)::numeric, 2) end`;
    return (await db.selectFrom('analise_pedido_nf_nf as an')
      .innerJoin('nfe_nao_cadastradas as nnc', (j) => j.onRef('nnc.codnfe_naocad', '=', 'an.apnn_ref_nf').on(sql<boolean>`an.apnn_tabela = 'NFE_NAO_CADASTRADAS'`))
      .innerJoin('nfe_nao_cadastradas_itens as nnci', 'nnci.chavenfe', 'nnc.chavenfe')
      .innerJoin('produtos as pr', 'pr.idproduto', 'nnci.idproduto')
      .select([
        'nnci.idproduto', sql`pr.codbarra`.as('codbarra'), sql`pr.descricao`.as('descricao'), sql`pr.unidade`.as('unidade'),
        sql`sum(${unit} * ${emb}) / (case when sum(${emb}) > 0 then sum(${emb}) else 1 end)`.as('vrcusto'),
        sql`sum(${emb})`.as('qtdtotal'),
      ])
      .where('an.apn_id', '=', apnId)
      .groupBy(['nnci.idproduto', 'pr.codbarra', 'pr.descricao', 'pr.unidade'])
      .execute()) as Array<Record<string, unknown>>;
  }

  /**
   * CRIA a análise (`NovaAnalise`): cabeçalho + os pedidos + as notas escolhidos. `apn_total_parcial` decide se
   * a diferença de QUANTIDADE conta ('T' total) ou não ('P' parcial). Exige ao menos 1 pedido e 1 nota — as
   * mesmas validações do form ("Selecione pelo menos um pedido." / "A nota fiscal não foi informada.").
   */
  async criar(dto: { codpedcomps: number[]; refs_nf: number[]; total_parcial?: 'T' | 'P' }) {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    if (!dto.codpedcomps.length) throw new BusinessRuleError('ANALISE_SEM_PEDIDO');
    if (!dto.refs_nf.length) throw new BusinessRuleError('ANALISE_SEM_NOTA');
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      const peds = (await trx.selectFrom('pedidocompra').select('codpedcomp')
        .where('codpedcomp', 'in', dto.codpedcomps).where('idempresa', '=', emp).execute()) as Array<{ codpedcomp: number }>;
      if (peds.length !== dto.codpedcomps.length) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO');
      const notas = (await trx.selectFrom('nfe_nao_cadastradas').select('codnfe_naocad')
        .where('codnfe_naocad', 'in', dto.refs_nf).where('idempresa', '=', emp).execute()) as Array<{ codnfe_naocad: number }>;
      if (notas.length !== dto.refs_nf.length) throw new BusinessRuleError('NOTA_NAO_ENCONTRADA');

      const apn = (await trx.insertInto('analise_pedido_nf').values({
        apn_id: sql`coalesce((select max(apn_id) from analise_pedido_nf), 0) + 1`,
        apn_data_analise: sql`now()`, apn_status: 'A', codoperador: op, codempresa: emp,
        apn_total_parcial: dto.total_parcial ?? 'T',
      }).returning('apn_id').executeTakeFirstOrThrow()) as { apn_id: number };
      const apnId = Number(apn.apn_id);
      await trx.insertInto('analise_pedido_nf_pedido')
        .values(dto.codpedcomps.map((c) => ({ apn_id: apnId, codpedcomp: c }))).execute();
      await trx.insertInto('analise_pedido_nf_nf')
        .values(dto.refs_nf.map((r) => ({ apn_id: apnId, apnn_ref_nf: r, apnn_tabela: 'NFE_NAO_CADASTRADAS' }))).execute();
      return { apn_id: apnId, pedidos: dto.codpedcomps.length, notas: dto.refs_nf.length, total_parcial: dto.total_parcial ?? 'T' };
    });
  }

  /**
   * PROCESSA a análise (`ProcessarAnalise`): limpa o resultado anterior e grava as 3 listas — divergências
   * (produto nos dois lados, fora da tolerância), itens só na NF e itens só no pedido. Idempotente.
   */
  async processar(apnId: number) {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    const tol = await this.tolerancias(emp);
    return db.transaction().execute(async (trx: AnyDB) => {
      const cab = (await trx.selectFrom('analise_pedido_nf').select(['apn_id', 'apn_total_parcial'])
        .where('apn_id', '=', apnId).where('codempresa', '=', emp).forUpdate()
        .executeTakeFirst()) as { apn_id: number; apn_total_parcial?: string } | undefined;
      if (!cab) throw new BusinessRuleError('ANALISE_NAO_ENCONTRADA', { apn_id: apnId });
      const total = String(cab.apn_total_parcial ?? 'T') === 'T';

      const [ped, nf] = await Promise.all([this.produtosPedido(trx, apnId), this.produtosNf(trx, apnId)]);
      const nfPorProd = new Map(nf.map((r) => [Number(r.idproduto), r]));
      const pedPorProd = new Map(ped.map((r) => [Number(r.idproduto), r]));

      // reprocessar é idempotente (o legado exclui as análises antes de gravar de novo)
      await trx.deleteFrom('analise_pedido_nf_diverg').where('apn_id', '=', apnId).execute();
      await trx.deleteFrom('analise_pedido_nf_ine_nf').where('apn_id', '=', apnId).execute();
      await trx.deleteFrom('analise_pedido_nf_ine_pc').where('apn_id', '=', apnId).execute();

      const divs: Array<Record<string, unknown>> = [];
      for (const p of ped) {
        const n = nfPorProd.get(Number(p.idproduto));
        if (!n) continue; // sem par na NF → é "inexistente na NF", não divergência
        const dados = {
          custoPedido: Number(p.vrcusto) || 0, qtdPedido: Number(p.qtdtotal) || 0,
          custoNf: Number(n.vrcusto) || 0, qtdNf: Number(n.qtdtotal) || 0,
          unidade: String(p.unidade ?? ''),
        };
        if (!ehDivergente(dados, tol, total)) continue;
        divs.push({
          apn_id: apnId, idproduto: Number(p.idproduto),
          apnd_quantidade_nf: dados.qtdNf, apnd_quantidade_pc: dados.qtdPedido,
          apnd_valor_nf: dados.custoNf, apnd_valor_pc: dados.custoPedido,
        });
      }
      if (divs.length) await trx.insertInto('analise_pedido_nf_diverg').values(divs).execute();

      // itens que vieram na NOTA e não estavam no pedido
      const ineNf = nf.filter((n) => !pedPorProd.has(Number(n.idproduto)))
        .map((n) => ({ apn_id: apnId, idproduto: Number(n.idproduto), apnin_quantidade: Number(n.qtdtotal) || 0, apnin_valor: Number(n.vrcusto) || 0 }));
      if (ineNf.length) await trx.insertInto('analise_pedido_nf_ine_nf').values(ineNf).execute();

      // itens que estavam no PEDIDO e não vieram na nota
      const inePc = ped.filter((p) => !nfPorProd.has(Number(p.idproduto)))
        .map((p) => ({ apn_id: apnId, idproduto: Number(p.idproduto), apnip_quantidade: Number(p.qtdtotal) || 0, apnip_valor: Number(p.vrcusto) || 0 }));
      if (inePc.length) await trx.insertInto('analise_pedido_nf_ine_pc').values(inePc).execute();

      // a diferença de valor da análise: o que a NF cobra além do que o pedido previa, nos itens divergentes
      const difValor = divs.reduce((s, d) => s + (Number(d.apnd_valor_nf) * Number(d.apnd_quantidade_nf) - Number(d.apnd_valor_pc) * Number(d.apnd_quantidade_pc)), 0);
      await trx.updateTable('analise_pedido_nf')
        .set({ apn_status: divs.length || ineNf.length || inePc.length ? 'E' : 'F', apn_diferenca_valor: Math.round(difValor * 100) / 100 })
        .where('apn_id', '=', apnId).execute();

      return {
        apn_id: apnId, total_parcial: total ? 'T' : 'P',
        produtos_pedido: ped.length, produtos_nf: nf.length,
        divergencias: divs.length, inexistentes_nf: ineNf.length, inexistentes_pc: inePc.length,
        diferenca_valor: Math.round(difValor * 100) / 100,
        status: divs.length || ineNf.length || inePc.length ? 'E' : 'F',
        tolerancias: tol,
      };
    });
  }

  /**
   * quem pode LIBERAR (`OperadorLiberaAnalise`): o operador **que criou algum dos pedidos** da análise, ou
   * quem está na lista de MASTERS (o E8 `USUARIOS_PERMITIDOS_LIBERAR_PEDIDO_COMPRA`, o mesmo grant que dá
   * visibilidade de fila no corte-2a).
   */
  private async podeLiberar(db: AnyDB, apnId: number, op: number | null): Promise<{ pode: boolean; master: boolean; compradores: number[] }> {
    const peds = (await db.selectFrom('analise_pedido_nf_pedido as ap')
      .innerJoin('pedidocompra as pc', 'pc.codpedcomp', 'ap.codpedcomp')
      .select([sql`distinct pc.codoperador`.as('codoperador')])
      .where('ap.apn_id', '=', apnId).execute()) as Array<{ codoperador?: number | null }>;
    const compradores = peds.map((p) => Number(p.codoperador)).filter((n) => n > 0);
    // master = está no E8 (o mesmo grant que dá visibilidade de fila no corte-2a)
    let master = false;
    if (op != null) {
      const r = await sql<{ ok: boolean }>`
        select exists (select 1 from configuracoes c
                       join configuracoes_especificas ce on ce.id = c.id
                       where c.codigo = 'USUARIOS_PERMITIDOS_LIBERAR_PEDIDO_COMPRA'
                         and ce.tipo = 'Usuario' and ce.valor = 'S'
                         and ce.chave ~ '^[0-9]{1,9}$' and ce.chave::int = ${op}) as ok
      `.execute(db);
      master = Boolean(r.rows[0]?.ok);
    }
    return { pode: master || (op != null && compradores.includes(Number(op))), master, compradores };
  }

  /**
   * LIBERA a análise — `BtnLiberaAnaliseClick` + `Finaliza` (UFrmAnalisePedidosNF.pas:420-470):
   *  1. o operador precisa poder liberar (criador de algum pedido ou master);
   *  2. com **vários compradores** nos pedidos, **só o master** libera ("Apenas o usuário master poderá liberar
   *     a análise pois existem vários compradores nos pedidos");
   *  3. **com divergência é obrigatório gerar o financeiro** ("Para liberar a análise com divergência, deverá
   *     gerar o financeiro") — o legado abre a tela de A RECEBER e grava o título contra o fornecedor pela
   *     diferença, registrando o vínculo em ANALISE_PEDIDO_NF_CR;
   *  4. finaliza a análise (status 'F'), finaliza a PENDÊNCIA vinculada e fecha o pedido — a análise **TOTAL**
   *     fecha sempre; a **PARCIAL** pergunta ao operador (aqui: o parâmetro `fechar_pedido`).
   */
  async liberar(apnId: number, dto: { fechar_pedido?: boolean; gerar_financeiro?: boolean } = {}) {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      const cab = (await trx.selectFrom('analise_pedido_nf')
        .select(['apn_id', 'apn_status', 'apn_total_parcial', 'apn_diferenca_valor'])
        .where('apn_id', '=', apnId).where('codempresa', '=', emp).forUpdate()
        .executeTakeFirst()) as Record<string, unknown> | undefined;
      if (!cab) throw new BusinessRuleError('ANALISE_NAO_ENCONTRADA', { apn_id: apnId });
      if (String(cab.apn_status ?? '') === 'F') throw new BusinessRuleError('ANALISE_JA_FINALIZADA');

      const { pode, master, compradores } = await this.podeLiberar(trx, apnId, op);
      if (!pode) throw new BusinessRuleError('ANALISE_SEM_PERMISSAO_LIBERAR');
      if (compradores.length > 1 && !master) throw new BusinessRuleError('ANALISE_VARIOS_COMPRADORES');

      const divs = Number(((await trx.selectFrom('analise_pedido_nf_diverg')
        .select(sql`count(*)::int`.as('n')).where('apn_id', '=', apnId).executeTakeFirst()) as { n?: number } | undefined)?.n ?? 0);
      let codrcb: number | null = null;
      if (divs > 0) {
        if (!dto.gerar_financeiro) throw new BusinessRuleError('ANALISE_EXIGE_FINANCEIRO', { divergencias: divs });
        // o título é contra o FORNECEDOR do pedido, pela diferença apurada
        const forn = (await trx.selectFrom('analise_pedido_nf_pedido as ap')
          .innerJoin('pedidocompra as pc', 'pc.codpedcomp', 'ap.codpedcomp')
          .select(['pc.codparceiro']).where('ap.apn_id', '=', apnId).limit(1)
          .executeTakeFirst()) as { codparceiro?: number } | undefined;
        if (!forn?.codparceiro) throw new BusinessRuleError('FORNECEDOR_NAO_ENCONTRADO');
        const valor = Math.abs(Number(cab.apn_diferenca_valor) || 0);
        if (!(valor > 0)) throw new BusinessRuleError('ANALISE_DIFERENCA_ZERADA');
        const rcb = (await trx.insertInto('areceber').values({
          codempresa: emp, codparceiro: Number(forn.codparceiro), valor,
          dtvenda: sql`now()`, dtvenc: sql`now()`, tipodoc: 'DP', quitada: 'N',
          obs: `Contas a receber gerada da análise entre pedidos e notas fiscais (análise ${apnId})`,
        }).returning('codrcb').executeTakeFirstOrThrow()) as { codrcb: number };
        codrcb = Number(rcb.codrcb);
        await trx.insertInto('analise_pedido_nf_cr').values({ apn_id: apnId, codrcb }).execute();
      }

      // finaliza a análise e a pendência que aponta para ela
      await trx.updateTable('analise_pedido_nf')
        .set({ apn_status: 'F', apn_status_finalizacao: 'F', codoperador_finalizado: op })
        .where('apn_id', '=', apnId).execute();
      const pend = (await trx.updateTable('pendencia_operador')
        .set({ po_status: 'F' })
        .where('codempresa', '=', emp)
        .where('po_tipo_pendencia_operador', 'in', ['APN', 'RPN'])
        .where(sql<boolean>`po_complemento ~ '^[0-9]{1,9}$' and po_complemento::int = ${apnId}`)
        .where('po_status', '=', 'A')
        .returning('po_id').execute()) as Array<{ po_id: number }>;

      // FECHA O PEDIDO: total sempre; parcial só se o operador pedir
      const total = String(cab.apn_total_parcial ?? 'T') === 'T';
      const fechar = dto.fechar_pedido ?? total;
      let pedidosFechados = 0;
      if (fechar) {
        const notas = (await trx.selectFrom('analise_pedido_nf_nf as an')
          .leftJoin('nfe_nao_cadastradas as nnc', 'nnc.codnfe_naocad', 'an.apnn_ref_nf')
          .select([sql`nnc.nronf`.as('nronf')]).where('an.apn_id', '=', apnId).execute()) as Array<{ nronf?: string }>;
        const cruzamento = notas.map((n) => String(n.nronf ?? '')).filter(Boolean).join(', ').slice(0, 500);
        const peds = (await trx.selectFrom('analise_pedido_nf_pedido').select('codpedcomp')
          .where('apn_id', '=', apnId).execute()) as Array<{ codpedcomp: number }>;
        const ids = peds.map((p) => Number(p.codpedcomp));
        if (ids.length) {
          await trx.updateTable('pedidocompra')
            .set({ importado: 'S', fechado: 'S', pc_nronf_cruzamento: cruzamento })
            .where('codpedcomp', 'in', ids).where('idempresa', '=', emp).execute();
          await trx.updateTable('pedidocompra_i')
            .set({ fechado: 'S', data_fechamento: sql`current_date`, codoperador_fechamento: op })
            .where('codpedcomp', 'in', ids).execute();
          pedidosFechados = ids.length;
        }
      }
      return {
        apn_id: apnId, status: 'F', codrcb, divergencias: divs,
        pendencias_finalizadas: pend.map((p) => Number(p.po_id)),
        pedido_fechado: fechar, pedidos: pedidosFechados, liberado_como_master: master,
      };
    });
  }

  /**
   * REFAZER a análise (o fluxo **RPN** — `GeraNovaAnalise`, UFrmPendenciasOperador.pas:167): cria uma análise
   * NOVA com os mesmos pedidos e notas da antiga, processa, **finaliza a pendência** que pediu a nova análise e
   * devolve o novo id (o legado então abre a análise nova). A antiga fica como está — o histórico não se apaga.
   */
  async refazer(apnId: number) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const antiga = (await db.selectFrom('analise_pedido_nf').select(['apn_id', 'apn_total_parcial'])
      .where('apn_id', '=', apnId).where('codempresa', '=', emp).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!antiga) throw new BusinessRuleError('ANALISE_NAO_ENCONTRADA', { apn_id: apnId });
    const peds = (await db.selectFrom('analise_pedido_nf_pedido').select('codpedcomp').where('apn_id', '=', apnId).execute()) as Array<{ codpedcomp: number }>;
    const notas = (await db.selectFrom('analise_pedido_nf_nf').select('apnn_ref_nf').where('apn_id', '=', apnId).execute()) as Array<{ apnn_ref_nf: number }>;
    if (!peds.length) throw new BusinessRuleError('ANALISE_SEM_PEDIDO');
    if (!notas.length) throw new BusinessRuleError('ANALISE_SEM_NOTA');

    const nova = await this.criar({
      codpedcomps: peds.map((p) => Number(p.codpedcomp)),
      refs_nf: notas.map((n) => Number(n.apnn_ref_nf)),
      total_parcial: (String(antiga.apn_total_parcial ?? 'T') === 'P' ? 'P' : 'T'),
    });
    const proc = await this.processar(nova.apn_id);
    // a pendência que pediu a nova análise (RPN apontando a ANTIGA) se encerra
    const trx = this.dbp.forTenant() as AnyDB;
    const pend = (await trx.updateTable('pendencia_operador').set({ po_status: 'F' })
      .where('codempresa', '=', emp).where('po_tipo_pendencia_operador', '=', 'RPN')
      .where(sql<boolean>`po_complemento ~ '^[0-9]{1,9}$' and po_complemento::int = ${apnId}`)
      .where('po_status', '=', 'A').returning('po_id').execute()) as Array<{ po_id: number }>;
    return { apn_id_nova: nova.apn_id, apn_id_antiga: apnId, processamento: proc, pendencias_finalizadas: pend.map((p) => Number(p.po_id)) };
  }
}
