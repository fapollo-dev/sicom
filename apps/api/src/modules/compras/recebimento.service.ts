import { Injectable } from '@nestjs/common';
import { chaveDeEntrada, desregistrarProcessoNf, registrarProcessoNf } from '../shared/nf-status-processo';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { AggregateEngineService } from '../../shared/crud/aggregate-engine.service';
import { nfAggregateConfig } from '../cadastro/nf.aggregate';
import { NfParcelasService } from '../cadastro/nf-parcelas.service';
import { NfFaturamentoService } from '../cadastro/nf-faturamento.service';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { UFS } from '@apollo/shared';
import { pedidoParaReceber } from './pedido-lojas';
import { parseNfeXml, type NfeItemParsed } from './nfe-xml.parser';
import { itemImportado, type ProdutoImportacao } from './nfe-item-importacao';
import { normRef, digEan } from './codref-normalize';
import { AnalisePedidoNfService } from './analise-pedido-nf.service';
import { configNaTrx } from './pedido-heranca';
import { recalcularMetricasEntrada } from '../cadastro/nf-custo-item';
import { hojeNaLoja } from '../../shared/tempo/hoje';

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
    private readonly analise: AnalisePedidoNfService,
    private readonly parcelas: NfParcelasService,
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
   * gera uma NF de entrada rascunho do pedido; retorna { codnf, codpedcomp }. RECEBIMENTO PARCIAL 1:N (Wave 4):
   * pode ser chamado VÁRIAS vezes — cada chamada recebe o SALDO restante (ou as `quantidades` explícitas ≤ saldo).
   * Quando o saldo zera, a NF é marcada 'Total' (senão 'Parcial'). Bloqueia quando não há mais saldo.
   */
  async gerarNf(
    codpedcomp: number,
    opts: { modelo?: number; serie?: string; cfop?: string; quantidades?: Array<{ idproduto: number; quantidade: number }> } = {},
  ): Promise<{ codnf: number; codpedcomp: number; statusQtd: 'Total' | 'Parcial' }> {
    const emp = this.emp();
    const op = this.op();
    const db = this.dbp.forTenantRead() as AnyDB;

    // guarda: a LOJA participa do pedido e está FECHADA nele (feche antes de receber — por loja desde a mig 303;
    // a nota leva a quantidade da loja, udmNF.dfm:15370). `data::date` (não JS Date) → sem shift de fuso.
    const pedido = (await pedidoParaReceber(db, codpedcomp, emp, [
      'codparceiro',
      sql<string>`to_char(data::date, 'YYYY-MM-DD')`.as('data_iso') as any,
      'dtfaturamento',
      'idsituacao_nf', // corte-final: a situação-NF classificada no pedido é carregada à NF de entrada
    ])) as unknown as { codpedcomp: number; codparceiro: number; data_iso: string; fechado?: string; dtfaturamento?: unknown; idsituacao_nf?: number | null };

    // SALDO por produto (1:N): qtd pedida − Σ recebida nas NFs já vinculadas. Se nada resta → totalmente recebido.
    const { itens: saldoItens, totalmenteRecebido } = await this.analise.saldo(codpedcomp);
    if (totalmenteRecebido) throw new BusinessRuleError('PEDIDO_TOTALMENTE_RECEBIDO', { codpedcomp });
    const saldoPorProduto = new Map<number, number>(saldoItens.map((s) => [s.idproduto, s.saldo]));
    // quantidades explícitas (parcial dirigido pelo operador) — clamp a >0. Duplicatas do MESMO produto são SOMADAS
    // (fold auditoria [BAIXA]: antes era last-wins silencioso, perdendo a intenção do operador); o TOTAL por produto
    // é validado ≤ saldo (senão RECEBIMENTO_EXCEDE_SALDO).
    const explicito = new Map<number, number>();
    for (const q of opts.quantidades ?? []) {
      const qn = num(q.quantidade);
      if (qn <= 0) continue;
      const pid = Number(q.idproduto);
      explicito.set(pid, (explicito.get(pid) ?? 0) + qn);
    }
    for (const [pid, total] of explicito) {
      const saldoProd = saldoPorProduto.get(pid) ?? 0;
      if (total > saldoProd + 1e-6) throw new BusinessRuleError('RECEBIMENTO_EXCEDE_SALDO', { idproduto: pid, quantidade: total, saldo: saldoProd });
    }

    const itens = (await db
      .selectFrom('pedidocompra_i')
      .select(['codpedcompi', 'idproduto', 'qtde', 'fatorembalagem', 'qtdtotal', 'vrcusto', 'desconto'])
      .where('codpedcomp', '=', codpedcomp)
      .orderBy('codpedcompi')
      .execute()) as Array<{ idproduto: number; qtde: unknown; fatorembalagem: unknown; qtdtotal: unknown; vrcusto: unknown; desconto: unknown }>;
    if (!itens.length) throw new BusinessRuleError('PEDIDO_SEM_ITENS', { codpedcomp });

    // pré-preenche a NF com o SALDO por produto (alocação greedy quando o mesmo produto tem >1 linha no pedido).
    // Se `quantidades` foi informado, recebe só esses produtos, no valor pedido (≤ saldo). Itens sem saldo (ou
    // fora da seleção explícita) são PULADOS. Config fiscal do PRODUTO (aliquota/ncm/unidade/origem); R$ fiscais no F2.
    const cfop = (opts.cfop ?? '1102').trim();
    const restante = new Map<number, number>(saldoPorProduto); // saldo alocável por produto (decrementa por linha)
    const usarExplicito = explicito.size > 0;
    const nfItens: Record<string, unknown>[] = [];
    let nro = 1;
    for (const it of itens) {
      const pid = Number(it.idproduto);
      if (usarExplicito && !explicito.has(pid)) continue; // seleção explícita: só os produtos escolhidos
      const disponivel = restante.get(pid) ?? 0;
      if (disponivel <= 0) continue; // produto já totalmente recebido → pula
      const alvo = usarExplicito ? Math.min(explicito.get(pid) ?? 0, disponivel) : disponivel;
      const quantidade = Math.round((alvo + Number.EPSILON) * 1000) / 1000;
      if (quantidade <= 0) continue;
      restante.set(pid, disponivel - quantidade);
      if (usarExplicito) explicito.set(pid, (explicito.get(pid) ?? 0) - quantidade);
      const prod = (await db
        .selectFrom('produtos')
        .select(['aliquota', 'ncmsh', 'unidade', 'origemprod'])
        .where('idproduto', '=', pid)
        .executeTakeFirst()) as { aliquota?: string; ncmsh?: string; unidade?: string; origemprod?: string } | undefined;
      const custo = num(it.vrcusto);
      nfItens.push({
        nroitem: nro++,
        codproduto: pid,
        quantidade, // SALDO (unidades) — 1:N; fatorembal=1 pois quantidade já é a qtde em unidades
        fatorembal: 1,
        unidade: prod?.unidade ?? undefined,
        // o valor da linha é o VRCUSTO (nf-valor.ts); VRVENDA é o preço de venda — nulo aqui vira 0 no gravar
        vrcusto: custo, // SEED: o custo do pedido; o real vem da NF do fornecedor (ajuste na NF)
        vrdescprod: it.desconto != null ? num(it.desconto) : undefined, // o desconto em DINHEIRO do item do pedido
        cfop,
        aliquota: prod?.aliquota ?? undefined,
        ncm: prod?.ncmsh ?? undefined,
        origem_estoque: prod?.origemprod ?? undefined,
        geraestoque: 'S',
        movimenta_estoque: 'S',
      });
    }
    if (!nfItens.length) throw new BusinessRuleError('PEDIDO_TOTALMENTE_RECEBIDO', { codpedcomp }); // nada a receber nesta remessa

    // esta remessa fecha o saldo? (todo produto do saldo foi zerado por esta NF) → 'Total', senão 'Parcial'.
    const statusQtd: 'Total' | 'Parcial' = saldoItens.every((s) => (restante.get(s.idproduto) ?? 0) <= 1e-6) ? 'Total' : 'Parcial';

    const dataISO = pedido.data_iso; // 'YYYY-MM-DD' (data::date, sem shift de fuso). dtemissao=dtcontabil ⇒ válido.
    const dto: Record<string, unknown> = {
      tipo: 'E',
      modelo: opts.modelo ?? 1,
      serie: (opts.serie ?? '1').trim(),
      tipoemissao: '1',
      dtemissao: dataISO,
      dtcontabil: dataISO,
      codparceiro: pedido.codparceiro,
      codpedcomp, // vínculo (nfAggregateConfig.colunas) — gravado atômico com a NF; 1:N (sem UNIQUE desde a 087)
      itens: nfItens,
    };
    if (pedido.idsituacao_nf != null) dto.idsituacao_nf = pedido.idsituacao_nf;

    // TRAVA de edição do pedido: carimba dtfaturamento na PRIMEIRA remessa (CAS IS NULL). Em remessas seguintes o
    // dtfaturamento já está setado → o CAS não atualiza (0 linhas), o que é ESPERADO no 1:N (não bloqueia). Só
    // DESFAZEMOS a marca no erro se fomos NÓS que a setamos (esta remessa). O anti-over-receipt é o SALDO (acima);
    // a janela concorrente (2 remessas simultâneas) pode gerar over-receipt → tratado como divergência na Análise
    // (corte-2), fiel ao legado (que não trava qtd, só avisa). Documentado (§ dossiê).
    const marca = await (this.dbp.forTenant() as AnyDB)
      .updateTable('pedidocompra')
      .set({ dtfaturamento: sql`now()`, usultalteracao: op, dtultimalteracao: sql`now()` })
      .where('codpedcomp', '=', codpedcomp) // a posse e o fechamento da loja já foram validados (pedidoParaReceber)
      .where('dtfaturamento', 'is', null)
      .executeTakeFirst();
    const nosSetamos = Number((marca as any)?.numUpdatedRows ?? 0) > 0; // true só na 1ª remessa

    let codnf: number;
    try {
      // o rascunho da NF do pedido: o operador confere o TOTAL NF na tela antes de processar
      codnf = await this.engine.createAggregate(nfAggregateConfig, { ...dto, _origemServico: true });
    } catch (e) {
      // a NF NÃO foi criada → desfaz a marca só se fomos nós (1ª remessa); em remessa seguinte o marcador é de outra NF.
      if (nosSetamos) {
        await (this.dbp.forTenant() as AnyDB)
          .updateTable('pedidocompra').set({ dtfaturamento: null })
          .where('codpedcomp', '=', codpedcomp).execute();
      }
      throw e;
    }
    // NF criada (committed). Marcar Total/Parcial é metadado da Análise → best-effort FORA do catch de undo (fold
    // auditoria [MÉDIA]: se falhasse DENTRO do try, o undo do dtfaturamento reabriria o pedido com a NF já vinculada).
    try {
      await (this.dbp.forTenant() as AnyDB)
        .updateTable('nf').set({ status_qtd_pedcomp: statusQtd }).where('codnf', '=', codnf).where('idempresa', '=', emp).execute();
      // o cruzamento com o pedido marca a esteira (stCruzamentoPedido, UanalisaPedComp_NF.pas:726)
      const chCr = await chaveDeEntrada(this.dbp.forTenant() as AnyDB, codnf);
      if (chCr) await registrarProcessoNf(this.dbp.forTenant() as AnyDB, 'stCruzamentoPedido', chCr, emp, currentTenant().operadorId ?? null);
    } catch (e) {
      console.error('[recebimento] falha ao marcar status_qtd_pedcomp (gerar-nf prosseguiu)', { codnf, erro: (e as Error)?.message });
    }
    return { codnf, codpedcomp, statusQtd };
  }

  /**
   * IMPORT do XML da NFe do fornecedor → NF de entrada VALORADA (corte-2). Fiel a TNFe.ImportaNFe (NFe.pas):
   * parse do XML → NF de entrada (TIPO='E', MODELO do XML, TIPOEMISSAO='1' terceiros, NF_IMPORTACAO_NFE via
   * chave/protocolo) com os valores fiscais REAIS do XML (base/ICMS/ST/IPI em R$ — NÃO recalcula, o XML é a
   * verdade); fornecedor casado por CNPJ (parceiros_end); itens casados por EAN (produtos.codbarra/codauxiliar).
   * Itens NÃO casados BLOQUEIAM o import (lista de pendências — espelha o frmProdNC do legado). Draft-only
   * (PROC='N'): o FATO (estoque/A Pagar) é o F3/F4 na NF. Vínculo opcional ao pedido (reusa CAS-first do corte-1).
   *
   * O valor da linha é o VRCUSTO = vUnCom (TOTALPROD do `derivar` = vProd do XML) e o VRVENDA é o preço de venda do
   * produto no MULTI_PRECO, como o legado grava (udmNF.pas:10600; `nf-valor.ts` do shared). Divergências CONSCIENTES
   * do legado: o CFOP é ajustado saída→entrada (5→1/6→2/7→3); a de-para de
   * fornecedor (CODREFERENCIA_FOR). **Corte-4:** as duplicatas do XML (`<cobr><dup>`) geram os títulos A Pagar
   * AUTOMATICAMENTE (fiel a NFe.pas:3457) — 1 por `<dup>`, valores/vencimentos reais. Adiados: análise
   * Pedido×NF (link automático), SEFAZ, retenções/ST, `<pag>`/forma, gate por CFOP.
   */
  async importarXml(dto: { xml: string; codpedcomp?: number }): Promise<{
    codnf: number; chave: string; codparceiro: number; codpedcomp: number | null; itens: number;
    totalnf: number; totalXml: number; divergencia: boolean; titulosApagar: number; parcelas: number;
  }> {
    const emp = this.emp();
    const op = this.op();
    const nfe = parseNfeXml(dto.xml); // valida estrutura + chave (DV)
    const db = this.dbp.forTenantRead() as AnyDB;

    // a nota tem de ser DESTA loja (ImportaNFe, NFe.pas:3398-3418): o CNPJ do destinatário é o da loja da sessão; sendo o de outra loja,
    // o legado troca a empresa logada — aqui a tela troca e importa de novo; de loja nenhuma, recusa como o legado
    const cnpjLoja = String(((await db.selectFrom('empresas').select('cnpj').where('idempresa', '=', emp).executeTakeFirst()) as { cnpj?: string } | undefined)?.cnpj ?? '').replace(/\D/g, '');
    if (nfe.destCnpj && cnpjLoja && nfe.destCnpj !== cnpjLoja) {
      const outra = (await db.selectFrom('empresas').select(['idempresa', 'fantasia']).where(sql`regexp_replace(cnpj, '[^0-9]', '', 'g')`, '=', nfe.destCnpj).executeTakeFirst()) as
        { idempresa: number; fantasia?: string } | undefined;
      if (outra) throw new BusinessRuleError('NFE_DESTINATARIO_OUTRA_LOJA', { cnpj: nfe.destCnpj, idempresa: Number(outra.idempresa), loja: outra.fantasia ?? null });
      throw new BusinessRuleError('NFE_DESTINATARIO_DIVERGE', { cnpj: nfe.destCnpj, cnpjLoja });
    }

    // fornecedor pelo CNPJ do endereço, parceiro ATIVADO (NFe.pas:3176): grava o parceiro E o endereço, e o que não era fornecedor passa a
    // ser (`UPDATE PARCEIROS SET FRN = 'S'`, :3189 — o Apollo recusava). Sem cadastro, o legado abre o cadastro de parceiro já preenchido
    // (`ImportaParceiro`, :2933) e o operador grava: aqui a recusa leva os dados para a tela preencher o cadastro
    const forn = (await db
      .selectFrom('parceiros as p')
      .innerJoin('parceiros_end as e', 'e.codparceiro', 'p.codparceiro')
      .select(['p.codparceiro', 'p.frn', 'e.codend'])
      .where(sql`regexp_replace(e.cnpj_cpf, '[^0-9]', '', 'g')`, '=', nfe.emitCnpj)
      .where(sql`coalesce(p.ativado, 'S')`, '=', 'S')
      .orderBy('e.codend')
      .executeTakeFirst()) as { codparceiro: number; frn?: string; codend?: number } | undefined;
    if (!forn) {
      throw new BusinessRuleError('NFE_FORNECEDOR_NAO_ENCONTRADO', {
        cnpj: nfe.emitCnpj,
        parceiro: { razao: (nfe.emitNome ?? '').toUpperCase(), fantasia: (nfe.emit.xFant ?? '').toUpperCase(), frn: 'S', tipofj: nfe.emitCnpj.length === 14 ? 'J' : 'F',
          cnpj_cpf: nfe.emitCnpj, rg_insc: nfe.emit.IE ?? null, endereco: nfe.emit.xLgr ?? null, bairro: nfe.emit.xBairro ?? null, cidade: nfe.emit.xMun ?? null,
          idcidade: nfe.emit.cMun ?? null, uf: nfe.emit.UF ?? null, cep: nfe.emit.CEP ?? null, telefone: nfe.emit.fone ?? null },
      });
    }
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
        // a mesma referência pode estar em mais de um produto (mig 337): vence a mais recente
        for (const r of (await db.selectFrom('codreferencia_for').select(['codref', 'idproduto']).where('codfor', '=', codparceiro).where('codref', 'in', refs).orderBy('codreferencia_for').execute()) as any[]) {
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

    // o que o item importado copia do produto (ImportaNFe, NFe.pas:3913-3977): código de barras, fatores, NCM/CEST, PIS e as
    // alíquotas do PISCOFINS do cadastro — 1 query.
    const idsCasados = Array.from(new Set(matchByIdx.values()));
    const attrs = new Map<number, ProdutoImportacao>();
    if (idsCasados.length) {
      for (const r of (await db.selectFrom('produtos as p').leftJoin('piscofins as pc', 'pc.idpiscofins', 'p.idpiscofins')
        .select(['p.idproduto', 'p.aliquota', 'p.unidade', 'p.origemprod', 'p.codbarra', 'p.fatorcx', 'p.fatorkg', 'p.ncmsh', 'p.cest', 'p.pis',
          'pc.idpiscofins as tem_pc', 'pc.aliq_pis_ent', 'pc.aliq_pis_sai', 'pc.aliq_cofins_ent', 'pc.aliq_cofins_sai'])
        .where('p.idproduto', 'in', idsCasados).execute()) as any[]) {
        attrs.set(Number(r.idproduto), { ...r, tem_piscofins: r.tem_pc != null });
      }
    }
    const resolvidos = nfe.itens.map((it, i) => ({ it, idproduto: matchByIdx.get(i) as number }));

    // CFOPs de entrada (ajustados) têm de existir no catálogo (FK nf_prod.cfop/nf.cfop) — upsert dos distintos.
    const cfops = new Set<string>(resolvidos.map((r) => this.cfopEntrada(r.it.cfopXml)));
    await this.garantirCfops(cfops);

    // itens da NF: valores fiscais REAIS do XML; o valor da linha é o vUnCom (VRCUSTO), o VRVENDA é o preço de venda
    const precos = new Map<number, number>();
    const ids = [...new Set(resolvidos.map((r) => Number(r.idproduto)))];
    if (ids.length) {
      for (const m of (await db.selectFrom('multi_preco').select(['idproduto', 'vrvenda']).where('idempresa', '=', emp).where('idproduto', 'in', ids).execute()) as Array<{ idproduto: unknown; vrvenda: unknown }>) {
        precos.set(Number(m.idproduto), num(m.vrvenda));
      }
    }
    // o ICM efetivo da UF da loja (DET_ALIQUOTA) e o fator do item no manifesto da chave (NFE_NAO_CADASTRADAS_ITENS)
    const ufLoja = String(((await db.selectFrom('empresas').select('uf').where('idempresa', '=', emp).executeTakeFirst()) as { uf?: string } | undefined)?.uf ?? '').trim();
    const detAliq = (await db.selectFrom('det_aliquota').select(['aliquota', 'icm_efetivo']).where('uf', '=', ufLoja).execute()) as Array<{ aliquota: string; icm_efetivo: unknown }>;
    const efetivoPorAliq = new Map(detAliq.map((d) => [String(d.aliquota).trim(), d.icm_efetivo == null ? null : num(d.icm_efetivo)]));
    const manifesto = (await db.selectFrom('nfe_nao_cadastradas_itens').select(['idproduto', 'nroitem', 'fatorembal'])
      .where('chavenfe', '=', nfe.chave).where('fatorembal', '>', 0).execute()) as Array<{ idproduto: unknown; nroitem: unknown; fatorembal: unknown }>;
    const fatorManifesto = (idproduto: number, nItem: number): number | null => {
      const doProduto = manifesto.filter((m) => Number(m.idproduto) === idproduto);
      const m = doProduto.find((x) => Number(x.nroitem) === nItem) ?? doProduto[0];
      return m ? num(m.fatorembal) : null;
    };
    const atualizarNcmCest = String((await configNaTrx(db, 'ATUALIZAR_NCMCEST_PRODUTO_XMLNFE', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })) ?? 'N').toUpperCase() === 'S';
    const remessaDeposito = ['5906', '1906', '1905'].includes(this.cfopEntrada(nfe.itens[0].cfopXml));
    const extras: Array<Record<string, unknown>> = [];
    const nfItens: Record<string, unknown>[] = resolvidos.map((r, idx) => {
      const prod = attrs.get(Number(r.idproduto)) ?? {};
      const aliq = String(prod.aliquota ?? '').trim();
      const { item, extras: ex } = itemImportado({ ...r.it, nItem: r.it.nItem || idx + 1 }, Number(r.idproduto), prod, {
        icmEfetivo: aliq ? efetivoPorAliq.get(aliq) ?? null : null,
        aliquotaPeloIcms: aliq ? null : detAliq.find((d) => d.icm_efetivo != null && Math.abs(num(d.icm_efetivo) - r.it.pICMS) < 1e-9)?.aliquota ?? null,
        fatorManifesto: fatorManifesto(Number(r.idproduto), r.it.nItem || idx + 1),
        atualizarNcmCest,
        remessaDeposito,
        vrvenda: precos.get(Number(r.idproduto)) ?? 0,
        cfop: this.cfopEntrada(r.it.cfopXml),
        freteTotalNota: num(nfe.total.vFrete),
      });
      extras.push({ nroitem: item.nroitem, ...ex });
      return item;
    });

    // TRANSPORTADORA (NFe.pas:3243-3340): com CNPJ e nome no XML, a do cadastro pelo CNPJ (marcada TRA='S' se não era) com o endereço, a
    // placa e a UF; sem cadastro, o legado abre o cadastro já preenchido e aborta se o operador não gravar — aqui a recusa leva os dados
    const tr = nfe.transp.transporta;
    let transp: { codtransp: number; codtransp_end: number | null; tra?: string } | undefined;
    if (tr && tr.cnpjCpf && tr.xNome) {
      transp = (await db.selectFrom('parceiros as p').innerJoin('parceiros_end as e', 'e.codparceiro', 'p.codparceiro')
        .select(['p.codparceiro as codtransp', 'e.codend as codtransp_end', 'p.tra'])
        .where(sql`regexp_replace(e.cnpj_cpf, '[^0-9]', '', 'g')`, '=', tr.cnpjCpf).orderBy('e.codend').executeTakeFirst()) as typeof transp;
      if (!transp) {
        const cidadeTr = tr.xMun || (nfe.emit.xMun ?? '').toUpperCase() || null;
        const ufTr = tr.UF || nfe.transp.veic?.UF || nfe.emit.UF || null;
        // o cadastro da tela confere cidade × UF no IBGE (uCadClientes :2041): o XML da transportadora só traz o nome do município
        const ufIbge = UFS.find((u) => u.sigla === String(ufTr ?? '').toUpperCase());
        // sem acento dos dois lados: o XML traz "São Luís", a tabela do IBGE "SAO LUIS"
        const semAcento = String(cidadeTr ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
        const cid = cidadeTr && ufIbge
          ? ((await db.selectFrom('cidades').select('idcidade')
              .where(sql`upper(translate(cidade, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))`, '=', semAcento)
              .where('iduf', '=', ufIbge.iduf).executeTakeFirst()) as { idcidade?: number } | undefined)
          : undefined;
        throw new BusinessRuleError('NFE_TRANSPORTADORA_NAO_ENCONTRADA', {
          cnpj: tr.cnpjCpf,
          parceiro: { razao: tr.xNome.toUpperCase(), fantasia: tr.xNome.toUpperCase(), tra: 'S', tipofj: tr.cnpjCpf.length === 14 ? 'J' : 'F', cnpj_cpf: tr.cnpjCpf,
            rg_insc: tr.IE ?? null, endereco: tr.xEnder || 'NÃO INFORMADO', bairro: 'NÃO INFORMADO', cep: '99999999',
            cidade: cidadeTr, uf: ufTr, idcidade: cid?.idcidade ?? null,
            placa: nfe.transp.veic?.placa ?? null, ufplaca: nfe.transp.veic?.UF ?? null },
        });
      }
    }
    // o pedido que a análise do manifesto vinculou à chave (GetMaiorPedidoCompraPelaChaveNFe, UAnalisePedidosNF.pas:495): o maior pedido
    // da análise FINALIZADA mais recente — só o cabeçalho, como no legado
    const pedidoDoManifesto = dto.codpedcomp != null ? null : Number(((await sql<{ codpedcomp: number }>`
        SELECT max(p.codpedcomp) AS codpedcomp
          FROM analise_pedido_nf a
          JOIN analise_pedido_nf_nf n     ON n.apn_id = a.apn_id
          JOIN analise_pedido_nf_pedido p ON p.apn_id = a.apn_id
          JOIN nfe_nao_cadastradas c      ON c.codnfe_naocad = n.apnn_ref_nf
         WHERE c.chavenfe = ${nfe.chave} AND a.apn_status = 'F'
         GROUP BY a.apn_id ORDER BY a.apn_id DESC LIMIT 1`.execute(db)).rows[0]?.codpedcomp ?? 0)) || null;
    const semAcento = (v: string | undefined, max: number) => (v ? v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 ]/g, '').slice(0, max) || undefined : undefined);
    const vol = nfe.transp.vol;
    const avulsa = nfe.procEmi === '1' ? nfe.avulsa : undefined;

    // DTCONTABIL = data do IMPORT (hoje), não a emissão — fiel ao legado (cdsNF.DTCONTABIL:=Now, NFe.pas:3373;
    // no golden 80% dos imports têm DTCONTABIL≠DTEMISSAO). É a competência do lançamento (entra no dia que chega).
    const hojeISO = hojeNaLoja();
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
      // a nota veio do XML (NFe.pas:3442): trava a base do ICMS da nota na tela e decide o VRCUSTOREAL do item (6.124 notas em 2026)
      nf_importacao_nfe: 'S',
      // o cabeçalho do ImportaNFe (NFe.pas:3150-3450; na produção, 100% das importadas com FINALIDADE, DTHORASAIDA, PRESENÇA e
      // VALIDATOTALNF = TOTALNF; IMP_MANIFESTO 'S' e IMP_IMPORTADORMASSA 'N' em 6.051 de 6.125)
      codparceiro_end: forn.codend ?? undefined,
      finalidade: nfe.finNFe,
      dthorasaida: nfe.dhSaiEnt,
      indicador_presenca: Number(nfe.indPres ?? 9) || 9,
      versaoxml: nfe.versao,
      rateio: 'N',
      rateio_ipi: 'N',
      rateio_st: 'N',
      imp_importadormassa: 'N',
      imp_manifesto: 'S',
      validatotalnf: nfe.total.vNF,
      totalbaseicmt: nfe.total.vBCST,
      total_streal: nfe.total.vST,
      totalbase_stexterno: nfe.total.vBCST,
      total_icms_nota_valor: nfe.total.vICMS,
      total_icms_nota_bc: nfe.total.vBC,
      total_fcp_valor_st: nfe.total.vFCPST,
      total_fcp_valor_st_ret: nfe.total.vFCPSTRet,
      total_icmsdeson: nfe.total.vICMSDeson,
      tipofrete: nfe.transp.modFrete || '9',
      ...(transp ? { codtransp: Number(transp.codtransp), codtransp_end: transp.codtransp_end ?? undefined, placatransp: nfe.transp.veic?.placa, ufplacatransp: nfe.transp.veic?.UF } : {}),
      ...(vol ? { qtde: vol.qVol, pesoliquido: vol.pesoL, pesobruto: vol.pesoB, especie: semAcento(vol.esp, 60), marca: semAcento(vol.marca, 10) } : {}),
      ...(avulsa ? {
        fisco_emit_orgao: avulsa.xOrgao, fisco_emit_cnpj: avulsa.CNPJ, fisco_emit_matr: avulsa.matr, fisco_emit_agente: avulsa.xAgente,
        fisco_emit_reparticao: avulsa.repEmi, fisco_emit_uf: avulsa.UF, fisco_emit_fone: avulsa.fone, fisco_emit_dar_nro: avulsa.nDAR,
        fisco_emit_dar_valor: avulsa.vDAR, fisco_emit_dar_dtemis: avulsa.dEmi, fisco_emit_dar_dtpgto: avulsa.dPag,
      } : {}),
      ...(pedidoDoManifesto ? { codpedcomp: pedidoDoManifesto } : {}),
      // frete/seguro/acessórias no header (o derivar os lê do dto p/ compor TOTALNF)
      totalfrete: nfe.total.vFrete || undefined,
      totalseguro: nfe.total.vSeg || undefined,
      totalacessorias: nfe.total.vOutro || undefined,
      itens: nfItens,
      // as PARCELAS do <cobr><dup> (FATURAMENTO) nascem com a nota, como no ImportaNFe (NFe.pas:3457-3475): o título sai delas
      // depois, no Faturamento — a importação não cria A Pagar
      faturamento: NfParcelasService.parcelasDoXml('E', nfe.nNF || null, nfe.duplicatas, op),
    };
    if (dto.codpedcomp != null) dtoNf.codpedcomp = dto.codpedcomp;

    const codpedcomp = dto.codpedcomp ?? null;
    // o fornecedor passa a ser fornecedor e a transportadora, transportadora (ExecutaSQL do legado, sem LOG — NFe.pas:3189, :3249)
    const dbw = this.dbp.forTenant() as AnyDB;
    if (forn.frn !== 'S') await dbw.updateTable('parceiros').set({ frn: 'S' }).where('codparceiro', '=', codparceiro).execute();
    if (transp && transp.tra !== 'S') await dbw.updateTable('parceiros').set({ tra: 'S' }).where('codparceiro', '=', Number(transp.codtransp)).execute();
    const codnf = await this.persistirComVinculo(dtoNf, codpedcomp, emp, op, codparceiro);
    // os valores DA NOTA que a tela não gerencia (os `*_NOTA`, CFOP_ORIGINAL, MVA_AJUSTADO, FCP-ST, desonerado…): no item já criado —
    // e preservados nos saves seguintes da NF (preservarNaoGerenciadas). São o lado "nota" da devolução de compra e da conferência.
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      for (const e of extras) {
        const { nroitem, mva_ajustado, ...cols } = e;
        await trx.updateTable('nf_prod').set(cols).where('codnf', '=', codnf).where('nroitem', '=', Number(nroitem)).execute();
        // o pMVAST da nota vai ao MVA_AJUSTADO só do item SEM indexador — com ele, vale o MVA ajustado da análise (uItensNF.pas:992)
        await trx.updateTable('nf_prod').set({ mva_ajustado }).where('codnf', '=', codnf).where('nroitem', '=', Number(nroitem))
          .where(sql`coalesce(indexadortrib, 0)`, '=', 0).execute();
      }
      // a ANÁLISE automática dos itens (uItensNF.pas:3890 → btnOkClick): com o item completo — o FCP-ST, o IPI devolvido e a base do ST
      // externo entram no custo
      await recalcularMetricasEntrada(trx, codnf, 'todos');
    });

    // RASTREABILIDADE (grupo `rastro` do XML → NF_PROD_LOTE): fiel a NFe.pas:4212-4225, que percorre os rastros do
    // item e decide entre EDITAR e INSERIR por (CODNFPROD, LOTE). Aqui o upsert usa a mesma chave. Não valida lote
    // em branco nem validade absurda: 38.914 das 56.521 linhas do golden têm LOTE vazio e 5 têm validade no ano
    // 4790. Best-effort — o XML já está gravado e a NF importada não pode cair por causa do rastro.
    try {
      const comRastro = resolvidos
        .map((r, idx) => ({ nroitem: r.it.nItem || idx + 1, idproduto: r.idproduto, rastro: r.it.rastro ?? [] }))
        .filter((x) => x.rastro.length);
      if (comRastro.length) {
        const dbRastro = this.dbp.forTenant() as AnyDB;
        // FOLD (auditoria): tudo-ou-nada. O bloco é best-effort por desenho (o XML já está salvo e a NF não pode
        // cair por causa do rastro), mas SEM transação um `dVal` inválido no meio deixava metade dos lotes
        // gravados e a NF com rastreabilidade fiscal parcial, sem ninguém saber.
        await dbRastro.transaction().execute(async (db2: AnyDB) => {
        const itensGravados = (await db2
          .selectFrom('nf_prod')
          .select(['codnfprod', 'nroitem'])
          .where('codnf', '=', codnf)
          .execute()) as Array<{ codnfprod: number; nroitem: number }>;
        const porItem = new Map<number, number>(itensGravados.map((i) => [Number(i.nroitem), Number(i.codnfprod)]));
        for (const x of comRastro) {
          const codnfprod = porItem.get(x.nroitem);
          if (codnfprod == null) continue;
          for (const l of x.rastro) {
            // FOLD (auditoria de paridade): `NFe.pas:4217-4218` é `if Locate('CODNFPROD;LOTE') then **Continue**`
            // — o legado PULA o rastro que já existe; nunca o edita. O `DO UPDATE` daqui sobrescrevia validade e
            // fabricação de um lote já gravado. E não há unicidade no banco (o golden tem 1.833 pares repetidos,
            // 1.818 deles com validades diferentes), então o "já existe?" é um NOT EXISTS, não um ON CONFLICT.
            await sql`
              INSERT INTO nf_prod_lote (codnfprod, idempresa, idproduto, lote, dtvalidade, dtfabricacao)
              SELECT ${codnfprod}, ${emp}, ${x.idproduto}, ${l.nLote || null}, ${l.dVal ?? null}::date, ${l.dFab ?? null}::date
              WHERE NOT EXISTS (
                SELECT 1 FROM nf_prod_lote e
                 WHERE e.codnfprod = ${codnfprod} AND coalesce(e.lote,'') = coalesce(${l.nLote || null}::varchar,'')
              )
            `.execute(db2);
          }
        }
        });
      }
    } catch (e) {
      console.error('[recebimento] falha ao gravar rastreabilidade de lote (prosseguiu)', { codnf, erro: (e as Error)?.message });
    }

    // marca Total/Parcial na NF importada vinculada (fold auditoria: o gerarNf setava, o import não). Best-effort:
    // após esta NF, o saldo do pedido zerou? → 'Total', senão 'Parcial'. Metadado informativo (não derruba o import).
    if (codpedcomp != null) {
      try {
        const { totalmenteRecebido } = await this.analise.saldo(codpedcomp);
        await (this.dbp.forTenant() as AnyDB)
          .updateTable('nf').set({ status_qtd_pedcomp: totalmenteRecebido ? 'Total' : 'Parcial' }).where('codnf', '=', codnf).where('idempresa', '=', emp).execute();
        const chCr2 = await chaveDeEntrada(this.dbp.forTenant() as AnyDB, codnf);
        if (chCr2) await registrarProcessoNf(this.dbp.forTenant() as AnyDB, 'stCruzamentoPedido', chCr2, emp, currentTenant().operadorId ?? null);
      } catch (e) {
        console.error('[recebimento] falha ao marcar status_qtd_pedcomp no import (prosseguiu)', { codnf, erro: (e as Error)?.message });
      }
    }

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
        await this.inserirFormasPagamento(codnf, emp, op, nfe.formasPagamento, nfe.vTroco);
      } catch (e) {
        console.error('[recebimento] falha ao guardar nf_forma_pagamento (import prosseguiu)', { codnf, erro: (e as Error)?.message });
      }
    }

    // a importação NÃO cria título (NFe.pas não chama o financeiro): as duplicatas viraram PARCELAS da nota (o `faturamento` do
    // dto acima) e o A Pagar sai delas no Faturamento. O auto-título que ficava aqui (gate CFOP.GERA_FINANCEIRO_AUTO) não é do
    // import no legado — é do PROCESSAR (`GerarFinanceiroAutomaticamente`, udmNF.pas:8112) — e nenhum CFOP da produção o liga.
    const titulosApagar = 0;
    const parcelas = nfe.duplicatas.length;

    return { codnf, chave: nfe.chave, codparceiro, codpedcomp, itens: nfItens.length, totalnf, totalXml: nfe.total.vNF, divergencia, titulosApagar, parcelas };
  }

  /**
   * REGRAVAR AS PARCELAS do XML guardado (`nfe_xml`) — o "recuperar XML" do legado (uNF.pas:6383) passa pelo mesmo ImportaNFe e
   * refaz as parcelas do `<cobr><dup>`. Só sem título por IDNF (com título as parcelas já foram faturadas → NF_JA_FATURADA).
   * Sem `<cobr>` (à vista) → NF_SEM_DUPLICATAS. Sem gate de finalidade: o legado grava as parcelas de qualquer nota importada
   * (o título é que depende do CFOP, no Faturamento).
   */
  async refaturarXml(codnf: number): Promise<{ codnf: number; parcelas: number; total: number }> {
    const emp = this.emp();
    const linha = (await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('nfe_xml').select('xml').where('codnf', '=', codnf).where('idempresa', '=', emp).executeTakeFirst()) as { xml?: string } | undefined;
    if (!linha?.xml) throw new BusinessRuleError('NFE_XML_NAO_ENCONTRADO', { codnf }); // sem XML armazenado → nada a refazer
    const nfe = parseNfeXml(linha.xml);
    if (nfe.duplicatas.length === 0) throw new BusinessRuleError('NF_SEM_DUPLICATAS', { codnf }); // à vista (sem <cobr>)
    const r = await (this.dbp.forTenant() as AnyDB).transaction().execute((trx: AnyDB) => this.parcelas.regravarDoXml(trx, codnf, nfe.duplicatas));
    return { codnf, ...r };
  }

  /**
   * DE-PARA (corte-3): vincula o(s) código(s) do fornecedor ao nosso produto (resolve as pendências do import).
   * Por vínculo grava DOIS registros quando presentes — 'E' (cEAN) e 'P' (cProd) — espelhando o legado
   * (frmProdNC/InsereRefFornecedorXML). Upsert por (idproduto, codfor, codref) (mig 337): re-resolver é idempotente. Depois o
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
        .where('codparceiro', '=', dto.codfor).executeTakeFirst()) as { frn?: string } | undefined;
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
            // a unicidade é por produto (mig 337): a mesma referência do fornecedor pode apontar outro produto, como no legado
            .onConflict((oc: any) =>
              oc.columns(['idproduto', 'codfor', 'codref']).doUpdateSet({ tiporef: l.tiporef, fator_embalagem: v.fator ?? null, usultalteracao: op, dtultimalteracao: sql`now()` }),
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
    formas: Array<{ tPag: string; vPag: number; cAut?: string; tpIntegra?: string; tBand?: string }>,
    vTroco = 0,
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
      // a operadora do CARTÃO DE CRÉDITO fora do caixa (GetIdOperadora, NFe.pas:2895): pela bandeira no nome da operadora ativa
      let codoperadoras: number | null = null;
      if (f.tPag === '03' && idpgto != null && idpgto !== cxa) {
        const bandeira = ({ '01': 'VISA', '02': 'MASTERCARD', '03': 'AMERICAN EXPRESS', '04': 'SOROCRED' } as Record<string, string>)[String(f.tBand ?? '').padStart(2, '0')] ?? 'OUTROS';
        const opr = (await db.selectFrom('operadoras').select('codoperadoras').where(sql`coalesce(ativo, 'S')`, '=', 'S')
          .where(sql`upper(operadora)`, 'like', `%${bandeira}%`).orderBy('codoperadoras').executeTakeFirst()) as { codoperadoras?: number } | undefined;
        codoperadoras = opr?.codoperadoras ?? null;
      }
      // o TROCO do XML vai à PRIMEIRA forma (NFe.pas:3519-3524); INTEGRADO pelo tpIntegra (:3509)
      await db
        .insertInto('nf_forma_pagamento')
        .values({ codnf, idempresa: emp, idpgto, tpag: (f.tPag || '').slice(0, 2) || null, vrpgto: num(f.vPag), numero_aut: f.cAut ?? null,
          integrado: String(f.tpIntegra ?? '') === '1' ? 'S' : 'N', codoperadoras, vrtroco: n === 0 && vTroco > 0 ? vTroco : 0, codoperador: op, dtcadastro: sql`now()` })
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
    // a loja participa e está fechada no pedido (mig 303 — o recebimento é por loja)
    const pedido = (await pedidoParaReceber(this.dbp.forTenantRead() as AnyDB, codpedcomp, emp, ['codparceiro', 'dtfaturamento'])) as { codparceiro?: number; fechado?: string; dtfaturamento?: unknown };
    if (Number(pedido.codparceiro) !== codparceiro) throw new BusinessRuleError('NFE_FORNECEDOR_DIVERGE_PEDIDO', { codpedcomp });
    // RECEBIMENTO 1:N (Wave 4): o import pode vincular VÁRIAS NFs ao mesmo pedido (o fornecedor entrega em remessas).
    // Bloqueia só quando não há mais saldo (todos os produtos já recebidos). Over-receipt (XML > saldo) NÃO bloqueia
    // aqui — é divergência tratada na Análise (corte-2), fiel ao legado.
    const { totalmenteRecebido } = await this.analise.saldo(codpedcomp);
    if (totalmenteRecebido) throw new BusinessRuleError('PEDIDO_TOTALMENTE_RECEBIDO', { codpedcomp });

    // TRAVA de edição do pedido: carimba dtfaturamento na 1ª remessa (CAS IS NULL); nas seguintes já está setado
    // (0 linhas, esperado no 1:N). Só desfaz no erro se fomos nós que setamos.
    const marca = await (this.dbp.forTenant() as AnyDB)
      .updateTable('pedidocompra')
      .set({ dtfaturamento: sql`now()`, usultalteracao: op, dtultimalteracao: sql`now()` })
      .where('codpedcomp', '=', codpedcomp) // a posse e o fechamento da loja já foram validados (pedidoParaReceber)
      .where('dtfaturamento', 'is', null)
      .executeTakeFirst();
    const nosSetamos = Number((marca as any)?.numUpdatedRows ?? 0) > 0;
    try {
      return await this.engine.createAggregate(nfAggregateConfig, dto);
    } catch (e) {
      if (nosSetamos) {
        await (this.dbp.forTenant() as AnyDB)
          .updateTable('pedidocompra').set({ dtfaturamento: null })
          .where('codpedcomp', '=', codpedcomp).execute();
      }
      // fold auditoria [BAIXA]: re-import do mesmo documento (ux_nf_natural) → erro específico, não 409 genérico.
      if ((e as { code?: string })?.code === '23505') throw new BusinessRuleError('NF_DUPLICADA');
      throw e;
    }
  }
}
