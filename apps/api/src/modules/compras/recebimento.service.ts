import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { AggregateEngineService } from '../../shared/crud/aggregate-engine.service';
import { nfAggregateConfig } from '../cadastro/nf.aggregate';
import { NfFaturamentoService } from '../cadastro/nf-faturamento.service';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { parseNfeXml, type NfeItemParsed } from './nfe-xml.parser';
import { normRef, digEan } from './codref-normalize';

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
    private readonly fat: NfFaturamentoService,
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
        'idsituacao_nf', // corte-final: a situação-NF classificada no pedido é carregada à NF de entrada
      ])
      .where('codpedcomp', '=', codpedcomp)
      .where('idempresa', '=', emp)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as
      | { codpedcomp: number; codparceiro: number; data_iso: string; fechado?: string; dtfaturamento?: unknown; idsituacao_nf?: number | null }
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
      .select(['codpedcompi', 'idproduto', 'qtde', 'fatorembalagem', 'qtdtotal', 'vrcusto', 'desconto'])
      .where('codpedcomp', '=', codpedcomp)
      .orderBy('codpedcompi')
      .execute()) as Array<{ idproduto: number; qtde: unknown; fatorembalagem: unknown; qtdtotal: unknown; vrcusto: unknown; desconto: unknown }>;
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
        // 078 FLIP: quantidade = QTDTOTAL (= QTDE×FATOREMBALAGEM, unidades totais pedidas); fallback fatorembalagem
        // p/ linhas legadas sem qtdtotal materializado (QTDE=1 → qtdtotal=fatorembalagem, mesmo valor).
        quantidade: num(it.qtdtotal) > 0 ? num(it.qtdtotal) : num(it.fatorembalagem),
        fatorembal: 1, // qtdtotal já é a qtde em unidades; base de estoque = quantidade × fatorembal (não duplicar)
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
    if (pedido.idsituacao_nf != null) dto.idsituacao_nf = pedido.idsituacao_nf; // situação do pedido → NF

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

  /**
   * IMPORT do XML da NFe do fornecedor → NF de entrada VALORADA (corte-2). Fiel a TNFe.ImportaNFe (NFe.pas):
   * parse do XML → NF de entrada (TIPO='E', MODELO do XML, TIPOEMISSAO='1' terceiros, NF_IMPORTACAO_NFE via
   * chave/protocolo) com os valores fiscais REAIS do XML (base/ICMS/ST/IPI em R$ — NÃO recalcula, o XML é a
   * verdade); fornecedor casado por CNPJ (parceiros_end); itens casados por EAN (produtos.codbarra/codauxiliar).
   * Itens NÃO casados BLOQUEIAM o import (lista de pendências — espelha o frmProdNC do legado). Draft-only
   * (PROC='N'): o FATO (estoque/A Pagar) é o F3/F4 na NF. Vínculo opcional ao pedido (reusa CAS-first do corte-1).
   *
   * Divergências CONSCIENTES do legado: VRVENDA = custo (vUnCom) e não MULTI_PRECO/varejo (assim TOTALPROD do
   * `derivar` = vProd do XML — reconciliação); o CFOP é ajustado saída→entrada (5→1/6→2/7→3); a de-para de
   * fornecedor (CODREFERENCIA_FOR). **Corte-4:** as duplicatas do XML (`<cobr><dup>`) geram os títulos A Pagar
   * AUTOMATICAMENTE (fiel a NFe.pas:3457) — 1 por `<dup>`, valores/vencimentos reais. Adiados: análise
   * Pedido×NF (link automático), SEFAZ, retenções/ST, `<pag>`/forma, gate por CFOP.
   */
  async importarXml(dto: { xml: string; codpedcomp?: number }): Promise<{
    codnf: number; chave: string; codparceiro: number; codpedcomp: number | null; itens: number;
    totalnf: number; totalXml: number; divergencia: boolean; titulosApagar: number;
  }> {
    const emp = this.emp();
    const op = this.op();
    const nfe = parseNfeXml(dto.xml); // valida estrutura + chave (DV)
    const db = this.dbp.forTenantRead() as AnyDB;

    // fornecedor por CNPJ (o CNPJ vive em parceiros_end.cnpj_cpf, não em parceiros) + FRN='S'.
    const forn = (await db
      .selectFrom('parceiros as p')
      .innerJoin('parceiros_end as e', 'e.codparceiro', 'p.codparceiro')
      .select(['p.codparceiro', 'p.frn'])
      .where(sql`regexp_replace(e.cnpj_cpf, '[^0-9]', '', 'g')`, '=', nfe.emitCnpj)
      .where('p.idempresa', '=', emp)
      .executeTakeFirst()) as { codparceiro: number; frn?: string } | undefined;
    if (!forn) throw new BusinessRuleError('NFE_FORNECEDOR_NAO_ENCONTRADO', { cnpj: nfe.emitCnpj });
    if (forn.frn !== 'S') throw new BusinessRuleError('PEDIDO_FORNECEDOR_INVALIDO', { codparceiro: forn.codparceiro });
    const codparceiro = Number(forn.codparceiro);

    // limites anti-DoS (SEFAZ: ≤ 990 itens; parcelas na prática ≤ ~120) — evita N+1 gigante num request.
    if (nfe.itens.length > 990) throw new BusinessRuleError('NFE_ITENS_EXCESSO', { itens: nfe.itens.length });
    if (nfe.duplicatas.length > 990) throw new BusinessRuleError('NFE_ITENS_EXCESSO', { duplicatas: nfe.duplicatas.length });
    if (nfe.formasPagamento.length > 990) throw new BusinessRuleError('NFE_ITENS_EXCESSO', { formas: nfe.formasPagamento.length });

    // casa produtos por EAN em LOTE (2 queries: produtos + codauxiliar) — sem N+1. `codbarra` NÃO é único →
    // EAN com >1 produto é AMBÍGUO e cai p/ a de-para (abaixo); 0 match idem. O que a de-para não resolver
    // BLOQUEIA (lista de pendências → tela de vínculo do operador, espelha o frmProdNC).
    const norm = (e: string) => (e ?? '').trim();
    const eans = Array.from(
      new Set(nfe.itens.map((it) => norm(it.cEAN)).filter((e) => e && e.toUpperCase() !== 'SEM GTIN').map((e) => digEan(e)).filter(Boolean)),
    );
    const porEan = new Map<string, Set<number>>(); // codbarra → idprodutos (produtos ∪ codauxiliar)
    const add = (codbarra: unknown, idproduto: unknown) => {
      const k = String(codbarra); const s = porEan.get(k) ?? new Set<number>(); s.add(Number(idproduto)); porEan.set(k, s);
    };
    if (eans.length) {
      for (const r of (await db.selectFrom('produtos').select(['codbarra', 'idproduto']).where('codbarra', 'in', eans).execute()) as any[]) add(r.codbarra, r.idproduto);
      for (const r of (await db.selectFrom('codauxiliar').select(['codbarra', 'idproduto']).where('codbarra', 'in', eans).execute()) as any[]) if (r.codbarra != null) add(r.codbarra, r.idproduto);
    }
    const naoCasados: Array<{ _idx: number; nItem: number; cProd: string; cEAN: string; xProd: string; ncm?: string; motivo: string }> = [];
    const matchByIdx = new Map<number, number>(); // índice do item → idproduto
    nfe.itens.forEach((it, i) => {
      const e = norm(it.cEAN);
      const digits = digEan(e);
      const ids = digits && e.toUpperCase() !== 'SEM GTIN' ? porEan.get(digits) : undefined;
      if (ids && ids.size === 1) return void matchByIdx.set(i, [...ids][0]);
      const motivo = ids && ids.size > 1 ? 'código de barras ambíguo (múltiplos produtos)' : 'sem produto com este código de barras';
      naoCasados.push({ _idx: i, nItem: it.nItem, cProd: it.cProd, cEAN: e || 'SEM GTIN', xProd: it.xProd, ncm: it.ncm, motivo });
    });

    // DE-PARA de fornecedor (CODREFERENCIA_FOR): resolve os ainda-não-casados por CODREF = cProd OU cEAN,
    // escopado ao fornecedor (CODFOR = codparceiro). Precedência fiel ao legado (GetProduto): EAN/codbarra
    // primeiro (acima), de-para depois. TIPOREF é descritivo (não filtra o match). 1 query em lote (sem N+1).
    if (naoCasados.length) {
      const refs = Array.from(new Set(naoCasados.flatMap((nc) => [normRef(nc.cProd), normRef(nc.cEAN)]).filter(Boolean)));
      const porRef = new Map<string, number>(); // codref → idproduto
      if (refs.length) {
        for (const r of (await db.selectFrom('codreferencia_for').select(['codref', 'idproduto']).where('codfor', '=', codparceiro).where('codref', 'in', refs).execute()) as any[]) {
          porRef.set(String(r.codref), Number(r.idproduto));
        }
      }
      const restam: typeof naoCasados = [];
      for (const nc of naoCasados) {
        const hit = porRef.get(normRef(nc.cProd)) ?? porRef.get(normRef(nc.cEAN));
        if (hit != null) matchByIdx.set(nc._idx, hit);
        else restam.push(nc);
      }
      if (restam.length) {
        throw new BusinessRuleError('NFE_PRODUTOS_NAO_CASADOS', { codparceiro, itens: restam.map(({ _idx, ...pub }) => pub) });
      }
    }

    // atributos dos produtos casados (aliquota/unidade/origem) — 1 query.
    const idsCasados = Array.from(new Set(matchByIdx.values()));
    const attrs = new Map<number, { aliquota?: string; unidade?: string; origemprod?: string }>();
    if (idsCasados.length) {
      for (const r of (await db.selectFrom('produtos').select(['idproduto', 'aliquota', 'unidade', 'origemprod']).where('idproduto', 'in', idsCasados).execute()) as any[]) {
        attrs.set(Number(r.idproduto), { aliquota: r.aliquota, unidade: r.unidade, origemprod: r.origemprod });
      }
    }
    const resolvidos = nfe.itens.map((it, i) => {
      const idproduto = matchByIdx.get(i) as number;
      const a = attrs.get(idproduto) ?? {};
      return { it, idproduto, aliquota: a.aliquota, unidade: a.unidade, origemprod: a.origemprod };
    });

    // CFOPs de entrada (ajustados) têm de existir no catálogo (FK nf_prod.cfop/nf.cfop) — upsert dos distintos.
    const cfops = new Set<string>(resolvidos.map((r) => this.cfopEntrada(r.it.cfopXml)));
    await this.garantirCfops(cfops);

    // itens da NF: valores fiscais REAIS do XML. vrvenda=custo (vUnCom) p/ TOTALPROD do derivar = vProd do XML.
    const nfItens: Record<string, unknown>[] = resolvidos.map((r, idx) => {
      const it = r.it;
      const u = (r.unidade ?? it.uCom ?? '').slice(0, 2) || undefined;
      return {
        nroitem: it.nItem || idx + 1,
        codproduto: r.idproduto,
        codprodnota: it.cProd || undefined, // código do fornecedor (base de futura de-para CODREFERENCIA_FOR)
        quantidade: it.qCom,
        fatorembal: 1,
        unidade: u,
        vrvenda: it.vUnCom,
        vrcusto: it.vUnCom,
        desconto: it.vDesc || undefined,
        cfop: this.cfopEntrada(it.cfopXml),
        ncm: it.ncm ?? undefined,
        cest: it.cest ?? undefined,
        origem_estoque: r.origemprod ?? it.origem ?? undefined, // origem do PRODUTO (legado); XML como fallback
        aliquota: r.aliquota ?? undefined, // código local (do produto); F2 não é necessário (imposto veio do XML)
        cst: it.cst != null ? Number(it.cst) : undefined,
        csosn: it.csosn ?? undefined,
        vrbasecalculo: it.vBC || undefined,
        icms: it.pICMS || undefined,
        vricm: it.vICMS || undefined,
        vrbasest: it.vBCST || undefined,
        vricmst: it.vICMSST || undefined,
        mva: it.pMVAST || undefined,
        ipi: it.pIPI || undefined,
        vripi: it.vIPI || undefined,
        cstpiscofins: it.cstPisCofins ?? undefined,
        aliqpise: it.pPIS || undefined,
        aliqcofinse: it.pCOFINS || undefined,
        geraestoque: 'S',
        movimenta_estoque: 'S',
      };
    });

    // DTCONTABIL = data do IMPORT (hoje), não a emissão — fiel ao legado (cdsNF.DTCONTABIL:=Now, NFe.pas:3373;
    // no golden 80% dos imports têm DTCONTABIL≠DTEMISSAO). É a competência do lançamento (entra no dia que chega).
    const hojeISO = new Date().toISOString().slice(0, 10);
    const dtoNf: Record<string, unknown> = {
      tipo: 'E',
      modelo: nfe.modelo,
      serie: nfe.serie || '1',
      nronf: nfe.nNF || undefined,
      tipoemissao: '1', // terceiros (NF do fornecedor)
      dtemissao: nfe.dhEmiISO,
      dtcontabil: hojeISO,
      dtchegada: nfe.dhEmiISO,
      cfop: this.cfopEntrada(nfe.itens[0].cfopXml), // header = 1º item ajustado
      codparceiro,
      chavenfe: nfe.chave,
      protocolo_nfe: nfe.protocolo ?? undefined,
      // frete/seguro/acessórias no header (o derivar os lê do dto p/ compor TOTALNF)
      totalfrete: nfe.total.vFrete || undefined,
      totalseguro: nfe.total.vSeg || undefined,
      totalacessorias: nfe.total.vOutro || undefined,
      itens: nfItens,
    };
    if (dto.codpedcomp != null) dtoNf.codpedcomp = dto.codpedcomp;

    const codpedcomp = dto.codpedcomp ?? null;
    const codnf = await this.persistirComVinculo(dtoNf, codpedcomp, emp, op, codparceiro);

    // reconciliação: o derivar computou TOTALNF; compara com vNF do XML (a verdade legal) — avisa se diverge.
    // Tolerância = 0,02 + 0,01×nItens: absorve o arredondamento por-item (Σ(qCom×vUnCom) desvia do vProd em
    // centavos que acumulam); assim o flag só dispara em divergência REAL (ex.: vICMSDeson/vII não mapeados),
    // não em ruído de arredondamento. É AVISO (não bloqueia) — o vNF do XML permanece a verdade legal.
    const nf = (await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('nf').select('totalnf').where('codnf', '=', codnf).executeTakeFirst()) as { totalnf?: unknown } | undefined;
    const totalnf = num(nf?.totalnf);
    const divergencia = Math.abs(totalnf - nfe.total.vNF) > 0.02 + 0.01 * nfe.itens.length;

    // guarda o XML cru (nfe_xml) ANTES de faturar — assim o XML fica preservado mesmo se o faturamento
    // falhar (a NF fica não-faturada + XML salvo → o operador refatura pelo F4). Best-effort (não derruba).
    try {
      await (this.dbp.forTenant() as AnyDB)
        .insertInto('nfe_xml')
        .values({ codnf, idempresa: emp, chavenfe: nfe.chave, modelo: nfe.modelo, ambiente: nfe.tpAmb, xml: dto.xml, simulado: 'N', dtcadastro: sql`now()` })
        .execute();
    } catch (e) {
      console.error('[recebimento] falha ao guardar nfe_xml (import prosseguiu)', { codnf, erro: (e as Error)?.message });
    }

    // CORTE-4b: forma de pagamento do XML (<pag>) → NF_FORMA_PAGAMENTO (informativo; NÃO afeta o título A
    // Pagar). Best-effort (não derruba o import). tPag → DESTINO (fallback CXA) → IDPGTO de FORMAS_PGTO.
    if (nfe.formasPagamento.length > 0) {
      try {
        await this.inserirFormasPagamento(codnf, emp, op, nfe.formasPagamento);
      } catch (e) {
        console.error('[recebimento] falha ao guardar nf_forma_pagamento (import prosseguiu)', { codnf, erro: (e as Error)?.message });
      }
    }

    // CORTE-4: gera o A Pagar das DUPLICATAS do XML. Mapa fiel ao GeraApagar do legado (uAPagar.pas:4843):
    // 1 título por <dup>, valor/venc reais. DIVERGÊNCIA de fluxo consciente: o legado gera no PROCESSAMENTO
    // (F3); aqui geramos no IMPORT (o XML já traz as parcelas exatas). GATES fiéis: (1) finalidade 2/3/4 não
    // faturam (udmNF.pas:9107); (2) CFOP.GERA_FINANCEIRO_AUTO='S' (corte-4b, CFOPGeraFinanceiroAutomatico,
    // udmNF.pas:9902 — no golden só o 1102). Sem <cobr> (à vista) → nada. Transação SEPARADA; CAS evita duplicar.
    let titulosApagar = 0;
    const finFatura = !['2', '3', '4'].includes(nfe.finNFe); // 1=normal fatura; 2/3/4 não
    const cfopHeader = this.cfopEntrada(nfe.itens[0].cfopXml);
    const cfopRow = (await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('cfop').select('gera_financeiro_auto').where('codcfop', '=', cfopHeader).executeTakeFirst()) as { gera_financeiro_auto?: string } | undefined;
    const cfopGera = cfopRow?.gera_financeiro_auto === 'S'; // só CFOP explicitamente ligado auto-gera
    if (nfe.duplicatas.length > 0 && finFatura && cfopGera) {
      const r = await this.fat.faturarComParcelas(codnf, nfe.duplicatas);
      titulosApagar = r.parcelas;
    }

    return { codnf, chave: nfe.chave, codparceiro, codpedcomp, itens: nfItens.length, totalnf, totalXml: nfe.total.vNF, divergencia, titulosApagar };
  }

  /**
   * RECEBIMENTO resíduo (b) — REFATURAR do XML: regenera os títulos A Pagar EXATOS das duplicatas do `<cobr><dup>`
   * a partir do XML já armazenado (`nfe_xml`), para quando o faturamento do import não rodou (auto-gate off, ou
   * falhou) — cenário anotado no importarXml. Reusa `faturarComParcelas` (mesmos títulos/travas/estorno do F4);
   * a trava `carregarNfFaturavel` (dentro de faturarComParcelas) bloqueia se a NF já está faturada. Sem `<cobr>`
   * (à vista) → NF_SEM_DUPLICATAS. Fiel a: o legado gera o financeiro no F3 a partir do documento; aqui a fonte
   * é o XML preservado (a verdade das parcelas do fornecedor).
   */
  async refaturarXml(codnf: number): Promise<{ codnf: number; tabela: 'areceber' | 'apagar'; parcelas: number; total: number }> {
    const emp = this.emp();
    const linha = (await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('nfe_xml').select('xml').where('codnf', '=', codnf).where('idempresa', '=', emp).executeTakeFirst()) as { xml?: string } | undefined;
    if (!linha?.xml) throw new BusinessRuleError('NFE_XML_NAO_ENCONTRADO', { codnf }); // sem XML armazenado → nada a refaturar
    const nfe = parseNfeXml(linha.xml);
    // GATE DE FINALIDADE (fold auditoria): finalidade 2/3/4 (complementar/ajuste/devolução) NÃO gera financeiro
    // do fornecedor — o import já suprime (finFatura) e o legado sai cedo (udmNF.pas:9107 `if FINALIDADE=4 then Exit`).
    // O refaturar dispensa o gate de CFOP (é seu propósito) mas NÃO o de finalidade.
    if (['2', '3', '4'].includes(nfe.finNFe)) throw new BusinessRuleError('NF_FINALIDADE_SEM_FINANCEIRO', { codnf, finalidade: nfe.finNFe });
    if (nfe.duplicatas.length === 0) throw new BusinessRuleError('NF_SEM_DUPLICATAS', { codnf }); // à vista (sem <cobr>)
    return this.fat.faturarComParcelas(codnf, nfe.duplicatas);
  }

  /**
   * DE-PARA (corte-3): vincula o(s) código(s) do fornecedor ao nosso produto (resolve as pendências do import).
   * Por vínculo grava DOIS registros quando presentes — 'E' (cEAN) e 'P' (cProd) — espelhando o legado
   * (frmProdNC/InsereRefFornecedorXML). Upsert por (codfor, codref): re-resolver é idempotente. Depois o
   * operador reimporta e o match casa sozinho. Tenant+operador fail-closed; fornecedor tem de ser FRN='S'.
   */
  async vincularProdutos(dto: {
    codfor: number;
    vinculos: Array<{ idproduto: number; cEAN?: string; cProd?: string; fator?: number }>;
  }): Promise<{ codfor: number; gravados: number }> {
    const emp = this.emp();
    const op = this.op();
    // TUDO numa transação: ou grava todos os vínculos ou nenhum (sem de-para parcial se um item falhar).
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // fornecedor tem de existir na empresa e ser fornecedor (FRN='S') — mesma guarda do import.
      const forn = (await trx
        .selectFrom('parceiros').select(['codparceiro', 'frn'])
        .where('codparceiro', '=', dto.codfor).where('idempresa', '=', emp).executeTakeFirst()) as { frn?: string } | undefined;
      if (!forn || forn.frn !== 'S') throw new BusinessRuleError('PEDIDO_FORNECEDOR_INVALIDO', { codparceiro: dto.codfor });

      let gravados = 0;
      for (const v of dto.vinculos) {
        // produto tem de existir (FK + erro claro em vez de 23503 cru).
        const prod = await trx.selectFrom('produtos').select('idproduto').where('idproduto', '=', v.idproduto).executeTakeFirst();
        if (!prod) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto: v.idproduto });
        const linhas: Array<{ codref: string; tiporef: 'E' | 'P' }> = [];
        const ean = normRef(v.cEAN ?? '');
        const cprod = normRef(v.cProd ?? '');
        if (ean) linhas.push({ codref: ean, tiporef: 'E' });
        if (cprod && cprod !== ean) linhas.push({ codref: cprod, tiporef: 'P' });
        if (!linhas.length) throw new BusinessRuleError('DEPARA_SEM_CODIGO', { idproduto: v.idproduto });
        for (const l of linhas) {
          await trx
            .insertInto('codreferencia_for')
            .values({ idproduto: v.idproduto, codfor: dto.codfor, codref: l.codref, tiporef: l.tiporef, fator_embalagem: v.fator ?? null, usucadastro: op, dtcadastro: sql`now()` })
            .onConflict((oc: any) =>
              oc.columns(['codfor', 'codref']).doUpdateSet({ idproduto: v.idproduto, tiporef: l.tiporef, usultalteracao: op, dtultimalteracao: sql`now()` }),
            )
            .execute();
          gravados++;
        }
      }
      return { codfor: dto.codfor, gravados };
    });
  }

  /** CFOP da NF de entrada: ajusta o 1º dígito do CFOP do fornecedor (saída) p/ entrada (5→1, 6→2) — fiel ao
   *  legado (NFe.pas só mapeia 5→1/6→2). 7xxx (exportação) não ocorre em NFe de compra → mantido como veio. */
  private cfopEntrada(cfopXml: string): string {
    const c = (cfopXml ?? '').replace(/\D/g, '');
    if (c.length !== 4) return c || '1102';
    const map: Record<string, string> = { '5': '1', '6': '2' };
    return (map[c[0]] ?? c[0]) + c.slice(1);
  }

  /** garante que cada CFOP (ajustado) exista no catálogo (FK) — upsert idempotente. */
  private async garantirCfops(cfops: Set<string>): Promise<void> {
    const db = this.dbp.forTenant() as AnyDB;
    for (const c of cfops) {
      if (!/^\d{4}$/.test(c)) continue;
      await db
        .insertInto('cfop')
        .values({ codcfop: c, descricao: `CFOP ${c} (import NFe)` })
        .onConflict((oc: any) => oc.column('codcfop').doNothing())
        .execute();
    }
  }

  /** tPag do XML → DESTINO de FORMAS_PGTO (single-code, fiel ao GetIdFormaPagamento; fallback CXA).
   *  As listas do legado ('TEF, CRT'/'CHQ, CHP'/'DEV, QUE') nunca casam a coluna CHAR(3) → usamos single-code. */
  private tpagDestino(tPag: string): string {
    const m: Record<string, string> = { '01': 'CXA', '02': 'CHQ', '03': 'TEF', '04': 'TEF', '05': 'RCB', '17': 'PIX' };
    return m[(tPag ?? '').trim()] ?? 'CXA'; // dinheiro/boleto/sem-pagto/outros → CXA (fallback do legado)
  }

  /** grava as formas de pagamento do XML em NF_FORMA_PAGAMENTO (informativo). Resolve IDPGTO por DESTINO
   *  (escopado à empresa; menor idpgto por destino; fallback CXA). Batch: 1 query nas formas da empresa. */
  private async inserirFormasPagamento(
    codnf: number,
    emp: number,
    op: number,
    formas: Array<{ tPag: string; vPag: number; cAut?: string }>,
  ): Promise<number> {
    const db = this.dbp.forTenant() as AnyDB;
    const destinos = new Set<string>(formas.map((f) => this.tpagDestino(f.tPag)));
    destinos.add('CXA'); // fallback sempre disponível
    const porDestino = new Map<string, number>();
    for (const r of (await db
      .selectFrom('formas_pgto').select(['idpgto', 'destino'])
      .where('idempresa', '=', emp).where('destino', 'in', [...destinos]).where(sql`coalesce(inativo,'N')`, '<>', 'S')
      .orderBy('idpgto').execute()) as any[]) {
      if (!porDestino.has(String(r.destino))) porDestino.set(String(r.destino), Number(r.idpgto)); // menor idpgto por destino
    }
    const cxa = porDestino.get('CXA') ?? null;
    let n = 0;
    for (const f of formas) {
      const idpgto = porDestino.get(this.tpagDestino(f.tPag)) ?? cxa; // fallback CXA
      await db
        .insertInto('nf_forma_pagamento')
        .values({ codnf, idempresa: emp, idpgto, tpag: (f.tPag || '').slice(0, 2) || null, vrpgto: num(f.vPag), numero_aut: f.cAut ?? null, integrado: 'N', codoperador: op, dtcadastro: sql`now()` })
        .execute();
      n++;
    }
    return n;
  }

  /** cria a NF (standalone ou vinculada ao pedido). Vinculada = CAS-first + guardas do corte-1 + undo na falha. */
  private async persistirComVinculo(
    dto: Record<string, unknown>,
    codpedcomp: number | null,
    emp: number,
    op: number,
    codparceiro: number,
  ): Promise<number> {
    if (codpedcomp == null) {
      // standalone: a NF nasce sem vínculo. Dedup = chave natural (nronf derivado da chave → sempre presente);
      // se a corrida escapar do validar, o índice ux_nf_natural barra no insert (23505 → NF_DUPLICADA).
      try {
        return await this.engine.createAggregate(nfAggregateConfig, dto);
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') throw new BusinessRuleError('NF_DUPLICADA');
        throw e;
      }
    }
    const pedido = (await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('pedidocompra')
      .select(['codparceiro', 'fechado', 'dtfaturamento'])
      .where('codpedcomp', '=', codpedcomp)
      .where('idempresa', '=', emp)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { codparceiro?: number; fechado?: string; dtfaturamento?: unknown } | undefined;
    if (!pedido) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp });
    if (pedido.fechado !== 'S') throw new BusinessRuleError('PEDIDO_NAO_FECHADO', { codpedcomp });
    if (pedido.dtfaturamento != null) throw new BusinessRuleError('PEDIDO_JA_RECEBIDO', { codpedcomp });
    if (Number(pedido.codparceiro) !== codparceiro) throw new BusinessRuleError('NFE_FORNECEDOR_DIVERGE_PEDIDO', { codpedcomp });

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
      return await this.engine.createAggregate(nfAggregateConfig, dto);
    } catch (e) {
      await (this.dbp.forTenant() as AnyDB)
        .updateTable('pedidocompra').set({ dtfaturamento: null })
        .where('codpedcomp', '=', codpedcomp).where('idempresa', '=', emp).execute();
      if ((e as { code?: string })?.code === '23505') throw new BusinessRuleError('PEDIDO_JA_RECEBIDO', { codpedcomp });
      throw e;
    }
  }
}
