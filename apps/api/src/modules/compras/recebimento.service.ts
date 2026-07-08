import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { AggregateEngineService } from '../../shared/crud/aggregate-engine.service';
import { nfAggregateConfig } from '../cadastro/nf.aggregate';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/**
 * RECEBIMENTO — gera uma NF de ENTRADA (rascunho) a partir de um PEDIDO DE COMPRA (corte-1).
 *
 * Fidelidade (recon Oracle): o "recebimento" real do legado é o IMPORT do XML da NFe do fornecedor casado ao
 * pedido — a NF carrega o FATO (quantidades/custos/fiscal REAIS do XML, que DIFEREM do pedido). O import de XML
 * é um épico à parte (adiado). Aqui o corte-1 gera a NF de entrada PRÉ-PREENCHIDA com os itens do pedido como
 * RASCUNHO EDITÁVEL (sugestão) — o operador ajusta ao documento real do fornecedor e roda F2→F3→F4 na tela da NF.
 *
 * O efeito (estoque/A Pagar) NÃO é reimplementado aqui: é 100% do processamento da própria NF (flip PROC 'N'→'S'
 * = F3 move estoque; faturamento = F4 gera A Pagar) — exatamente como o legado (nenhuma lógica de recebimento no
 * banco; nenhum trigger em PEDIDOCOMPRA). Vínculo = `nf.codpedcomp` (só cabeçalho; itens correlacionam por produto).
 *
 * Guardas: pedido tem de estar FECHADO (confirmado antes de receber) e ainda não recebido (sem NF vinculada nem
 * dtfaturamento). Gera a NF (com o vínculo, atômico via createAggregate) e marca `pedido.dtfaturamento` (que
 * trava edição/exclusão/reabertura via as guardas do pedido). Tenant `idempresa`+operador fail-closed.
 */
@Injectable()
export class RecebimentoService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly engine: AggregateEngineService,
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

  /** gera a NF de entrada rascunho do pedido; retorna { codnf, codpedcomp }. */
  async gerarNf(
    codpedcomp: number,
    opts: { modelo?: number; serie?: string; cfop?: string } = {},
  ): Promise<{ codnf: number; codpedcomp: number }> {
    const emp = this.emp();
    const op = this.op();
    const db = this.dbp.forTenantRead() as AnyDB;

    // guarda: pedido existe, está FECHADO e ainda não foi recebido (erros claros no caso comum).
    // `data::date` (não JS Date) → evita o shift de fuso ao derivar dtemissao/dtcontabil da NF.
    const pedido = (await db
      .selectFrom('pedidocompra')
      .select([
        'codpedcomp',
        'codparceiro',
        sql<string>`to_char(data::date, 'YYYY-MM-DD')`.as('data_iso'),
        'fechado',
        'dtfaturamento',
      ])
      .where('codpedcomp', '=', codpedcomp)
      .where('idempresa', '=', emp)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as
      | { codpedcomp: number; codparceiro: number; data_iso: string; fechado?: string; dtfaturamento?: unknown }
      | undefined;
    if (!pedido) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });
    if (pedido.fechado !== 'S') throw new BusinessRuleError('PEDIDO_NAO_FECHADO', { codpedcomp }); // feche antes de receber
    if (pedido.dtfaturamento != null) throw new BusinessRuleError('PEDIDO_JA_RECEBIDO', { codpedcomp });
    // guarda robusta de duplo-recebimento: já existe NF vinculada? (UNIQUE ux_nf_codpedcomp é o backstop de DB)
    const jaTem = await db
      .selectFrom('nf')
      .select('codnf')
      .where('codpedcomp', '=', codpedcomp)
      .where('idempresa', '=', emp)
      .executeTakeFirst();
    if (jaTem) throw new BusinessRuleError('PEDIDO_JA_RECEBIDO', { codpedcomp });

    const itens = (await db
      .selectFrom('pedidocompra_i')
      .select(['codpedcompi', 'idproduto', 'fatorembalagem', 'vrcusto', 'desconto'])
      .where('codpedcomp', '=', codpedcomp)
      .orderBy('codpedcompi')
      .execute()) as Array<{ idproduto: number; fatorembalagem: unknown; vrcusto: unknown; desconto: unknown }>;
    if (!itens.length) throw new BusinessRuleError('PEDIDO_SEM_ITENS', { codpedcomp });

    // pré-preenche cada item da NF a partir do item do pedido + config fiscal DO PRODUTO (aliquota/ncm/unidade/
    // origem). Os valores fiscais em R$ (icms/base/ipi/...) ficam para o F2 (recalcular) — não aqui.
    // CFOP: '1102' (compra p/ comercialização, NÃO-ST) é um default NEUTRO — o CFOP real da entrada depende do
    // regime do item (no golden 1403/ST é o mais frequente) e vem da NF do fornecedor; o operador AJUSTA na NF.
    const cfop = (opts.cfop ?? '1102').trim();
    const nfItens: Record<string, unknown>[] = [];
    let nro = 1;
    for (const it of itens) {
      const prod = (await db
        .selectFrom('produtos')
        .select(['aliquota', 'ncmsh', 'unidade', 'origemprod'])
        .where('idproduto', '=', it.idproduto)
        .executeTakeFirst()) as { aliquota?: string; ncmsh?: string; unidade?: string; origemprod?: string } | undefined;
      const custo = num(it.vrcusto);
      nfItens.push({
        nroitem: nro++,
        codproduto: it.idproduto,
        quantidade: num(it.fatorembalagem), // FATOREMBALAGEM do pedido = quantidade pedida
        fatorembal: 1, // pedido já traz a qtde direta; base de estoque = quantidade × fatorembal (não duplicar)
        unidade: prod?.unidade ?? undefined,
        // SEED do rascunho: usamos o CUSTO como valor unitário da entrada (base do TOTALPROD = custo). No legado
        // VRVENDA carrega o PREÇO DE VENDA (difere do custo em ~100% dos casos) — o real vem da NF; ajuste na NF.
        vrvenda: custo,
        vrcusto: custo,
        desconto: it.desconto != null ? num(it.desconto) : undefined,
        cfop,
        aliquota: prod?.aliquota ?? undefined, // código (F2 resolve a alíquota real por UF)
        ncm: prod?.ncmsh ?? undefined,
        origem_estoque: prod?.origemprod ?? undefined,
        geraestoque: 'S',
        movimenta_estoque: 'S',
      });
    }

    const dataISO = pedido.data_iso; // 'YYYY-MM-DD' (data::date, sem shift de fuso). dtemissao=dtcontabil ⇒ válido.
    const dto: Record<string, unknown> = {
      tipo: 'E',
      modelo: opts.modelo ?? 1, // rascunho manual: mod.1 (o real via XML = mod.55, terceiros — adiado/bloqueado manualmente)
      serie: (opts.serie ?? '1').trim(),
      tipoemissao: '1', // terceiros: a NF é do fornecedor (não auto-numera NRONF)
      dtemissao: dataISO,
      dtcontabil: dataISO,
      codparceiro: pedido.codparceiro,
      codpedcomp, // vínculo (nfAggregateConfig.colunas) — gravado atômico com a NF
      itens: nfItens,
    };

    // SERIALIZAÇÃO anti-duplo-recebimento (CAS-first): marca o pedido como recebido ANTES de criar a NF. O
    // legado usa DTFATURAMENTO+IMPORTADO como marcador; o modelo migrado NÃO tem IMPORTADO, então reusa
    // `dtfaturamento` como o marcador "recebido/tem-NF" (carimbado na GERAÇÃO — o legado carimba no faturamento;
    // divergência consciente). O CAS `dtfaturamento IS NULL` garante que só UMA chamada concorrente prossegue
    // (as guardas do pedido passam a bloquear edição/exclusão/reabertura). Se a criação da NF falhar, DESFAZ.
    const marca = await (this.dbp.forTenant() as AnyDB)
      .updateTable('pedidocompra')
      .set({ dtfaturamento: sql`now()`, usultalteracao: op, dtultimalteracao: sql`now()` })
      .where('codpedcomp', '=', codpedcomp)
      .where('idempresa', '=', emp)
      .where('fechado', '=', 'S')
      .where('dtfaturamento', 'is', null)
      .executeTakeFirst();
    if (Number((marca as any)?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('PEDIDO_JA_RECEBIDO', { codpedcomp });

    try {
      // cria a NF (rascunho, PROC='N') numa transação — engine carimba idempresa, deriva totais, grava itens.
      // O UNIQUE parcial ux_nf_codpedcomp é o backstop de DB (23505 → PEDIDO_JA_RECEBIDO).
      const codnf = await this.engine.createAggregate(nfAggregateConfig, dto);
      return { codnf, codpedcomp };
    } catch (e) {
      // DESFAZ a marca (pedido volta a fechado, re-tentável) — não deixa pedido "recebido" sem NF.
      await (this.dbp.forTenant() as AnyDB)
        .updateTable('pedidocompra')
        .set({ dtfaturamento: null })
        .where('codpedcomp', '=', codpedcomp)
        .where('idempresa', '=', emp)
        .execute();
      if ((e as { code?: string })?.code === '23505') throw new BusinessRuleError('PEDIDO_JA_RECEBIDO', { codpedcomp });
      throw e;
    }
  }
}
