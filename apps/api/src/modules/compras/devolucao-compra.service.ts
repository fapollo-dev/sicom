import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ItemDisponivelDevolucao } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { AggregateEngineService } from '../../shared/crud/aggregate-engine.service';
import { nfAggregateConfig } from '../cadastro/nf.aggregate';
import { NfFaturamentoService } from '../cadastro/nf-faturamento.service';
import { ConfigService } from '../cadastro/config.service';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

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

/**
 * DEVOLUÇÃO DE COMPRA — serviço VERTICAL: o PICKER de saldo (itens de NF de entrada do fornecedor ainda
 * devolvíveis) + as transições de ESTADO (finalizar/reabrir/cancelar). O CRUD do documento é o agregado
 * (`devolucao-compra.aggregate`). corte-1 = SEM efeitos; a NF de saída (finalidade=4) e seus efeitos vêm
 * nos cortes 2/3.
 */
@Injectable()
export class DevolucaoCompraService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly engine: AggregateEngineService,
    private readonly fat: NfFaturamentoService,
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

  /**
   * PICKER (CarregaItens do legado): itens de NF de ENTRADA do fornecedor com SALDO devolvível > 0.
   * saldo = (quantidade × fatorembal da entrada) − Σ qtd_devolvida de devoluções não-canceladas. `cfop_devolucao`
   * vem do de-para CFOP.CFOP_DEVOLUCAO (null = origem sem CFOP de devolução configurado → não devolvível).
   */
  async itensDisponiveis(codparceiro: number, codnf?: number): Promise<ItemDisponivelDevolucao[]> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    let q = db
      .selectFrom('nf_prod as p')
      .innerJoin('nf as n', 'n.codnf', 'p.codnf')
      .leftJoin('produtos as pr', 'pr.idproduto', 'p.codproduto')
      .leftJoin('cfop as c', 'c.codcfop', 'p.cfop')
      .select([
        'p.codnf as codnf',
        'p.codnfprod as codnfprod',
        'p.codproduto as idproduto',
        'n.nronf as nronf',
        'p.nroitem as nroitem',
        'pr.descricao as descricao',
        'p.unidade as unidade',
        'p.fatorembal as fatorembalagem',
        'p.cfop as cfop_entrada',
        'c.cfop_devolucao as cfop_devolucao',
        'n.chavenfe as chavenfe',
        'p.vrcusto as valor_custo',
        sql<number>`coalesce(p.quantidade,0) * coalesce(p.fatorembal,1)`.as('qtd_nota_fiscal'),
        sql<number>`coalesce((
          SELECT sum(i.qtd_devolvida) FROM pedido_devolucao_compra_i i
          JOIN pedido_devolucao_compra d ON d.codpeddevcompra = i.codpeddevcompra
          WHERE i.codnf = p.codnf AND i.codnfprod = p.codnfprod
            AND d.idempresa = n.idempresa AND d.status <> 'CANCELADO' AND coalesce(d.indr,'I') <> 'E'
        ), 0)`.as('qtd_ja_devolvida'),
      ])
      .where('n.tipo', '=', 'E')
      .where('n.codparceiro', '=', codparceiro)
      .where('n.idempresa', '=', emp);
    // nota: `nf` não tem soft-delete por INDR (o cancelamento é por idsituacao_nf/estado — fora do escopo do
    // picker corte-1); listamos as NFs de entrada do fornecedor e o saldo cuida de esconder o já devolvido.
    if (codnf != null) q = q.where('p.codnf', '=', codnf);

    const rows = (await q.orderBy('p.codnf').orderBy('p.nroitem').execute()) as Array<Record<string, unknown>>;
    const num = (v: unknown) => (typeof v === 'string' ? Number(v) : (v as number)) || 0;
    return rows
      .map((r) => {
        const saldo = Math.round((num(r.qtd_nota_fiscal) - num(r.qtd_ja_devolvida) + Number.EPSILON) * 1000) / 1000;
        return { ...(r as any), saldo } as ItemDisponivelDevolucao;
      })
      .filter((r) => num(r.saldo) > 0);
  }

  /** carrega o documento com trava (forUpdate) e valida existência/empresa. */
  private async carregar(trx: AnyDB, codpeddevcompra: number, emp: number) {
    const d = await trx
      .selectFrom('pedido_devolucao_compra')
      .select(['codpeddevcompra', 'status'])
      .where('codpeddevcompra', '=', codpeddevcompra)
      .where('idempresa', '=', emp)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .forUpdate()
      .executeTakeFirst();
    if (!d) throw new BusinessRuleError('DEVOLUCAO_NAO_ENCONTRADA', { codpeddevcompra });
    return d as { codpeddevcompra: number; status: string };
  }

  private async setStatus(codpeddevcompra: number, de: string[], para: string, erroSeForaDoEstado: string) {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const d = await this.carregar(trx, codpeddevcompra, emp);
      if (!de.includes(d.status)) throw new BusinessRuleError(erroSeForaDoEstado, { status: d.status });
      const upd = await trx
        .updateTable('pedido_devolucao_compra')
        .set({ status: para, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpeddevcompra', '=', codpeddevcompra)
        .where('idempresa', '=', emp)
        .where('status', 'in', de) // CAS (cinto-e-suspensório com o forUpdate)
        .executeTakeFirst();
      if (Number((upd as any)?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError(erroSeForaDoEstado, { status: d.status });
      return { codpeddevcompra, status: para };
    });
  }

  /** FINALIZAR DIGITAÇÃO (EM_DIGITACAO → DIGITADO): exige ≥1 item. */
  async finalizar(codpeddevcompra: number): Promise<{ codpeddevcompra: number; status: string }> {
    const emp = this.emp();
    // exige ao menos 1 item antes de finalizar (btnFinalizar do legado).
    const n = await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('pedido_devolucao_compra_i')
      .select(({ fn }: any) => [fn.count('codpeddevcomprai').as('n')])
      .where('codpeddevcompra', '=', codpeddevcompra)
      .executeTakeFirst();
    if (Number((n as any)?.n ?? 0) === 0) throw new BusinessRuleError('DEVOLUCAO_SEM_ITENS', { codpeddevcompra });
    void emp;
    return this.setStatus(codpeddevcompra, ['EM_DIGITACAO'], 'DIGITADO', 'DEVOLUCAO_ESTADO_INVALIDO');
  }

  /** REABRIR PARA DIGITAÇÃO (DIGITADO → EM_DIGITACAO). */
  async reabrir(codpeddevcompra: number): Promise<{ codpeddevcompra: number; status: string }> {
    return this.setStatus(codpeddevcompra, ['DIGITADO'], 'EM_DIGITACAO', 'DEVOLUCAO_NAO_DIGITADA');
  }

  /** CANCELAR (EM_DIGITACAO/DIGITADO → CANCELADO): libera o saldo dos itens de volta (deixam de contar). */
  async cancelar(codpeddevcompra: number): Promise<{ codpeddevcompra: number; status: string }> {
    return this.setStatus(codpeddevcompra, ['EM_DIGITACAO', 'DIGITADO'], 'CANCELADO', 'DEVOLUCAO_NAO_CANCELAVEL');
  }

  /**
   * corte-2 — GERAR NF DE DEVOLUÇÃO (uNF.ImportaPedidoDevolucaoCompra): materializa a NF de SAÍDA finalidade=4
   * a partir do documento DIGITADO. Itens = qtd_devolvida + custo + ESPELHO fiscal RATEADO da entrada
   * (proporção qtd_devolvida/qtd_entrada); CFOP = o de devolução do item; `nf_referencia` (refNFe) = 1 por NF
   * de entrada distinta; codparceiro = fornecedor. Vincula codnf_emitida + status→NOTA_FISCAL_EMITIDA. Os
   * EFEITOS (estoque−, A RECEBER contra o fornecedor) o operador roda na própria NF (F3/F4 — máquina existente).
   * Anti-duplo: CAS-first no status (M2). Guarda: NF de origem não pode estar CANCELADA (M3).
   */
  async gerarNf(codpeddevcompra: number): Promise<{ codnf: number; codpeddevcompra: number }> {
    const emp = this.emp();
    const op = this.op();
    const db = this.dbp.forTenantRead() as AnyDB;

    const dev = (await db
      .selectFrom('pedido_devolucao_compra')
      .select(['codpeddevcompra', 'codparceiro', 'status', 'codnf_emitida', sql<string>`to_char(now()::date, 'YYYY-MM-DD')`.as('hoje_iso')])
      .where('codpeddevcompra', '=', codpeddevcompra)
      .where('idempresa', '=', emp)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { codpeddevcompra: number; codparceiro: number; status: string; codnf_emitida: number | null; hoje_iso: string } | undefined;
    if (!dev) throw new BusinessRuleError('DEVOLUCAO_NAO_ENCONTRADA', { codpeddevcompra });
    if (dev.codnf_emitida != null) throw new BusinessRuleError('DEVOLUCAO_NF_JA_EMITIDA', { codpeddevcompra });
    if (dev.status !== 'DIGITADO') throw new BusinessRuleError('DEVOLUCAO_NAO_FINALIZADA', { status: dev.status });

    // RECUPERAÇÃO/anti-duplo IN-ROW (fold ALTA/MÉDIA): já existe NF vinculada a esta devolução? (run anterior
    // que criou a NF mas morreu antes do reverse-link). Reconcilia o vínculo/estado e reporta já-emitida —
    // NUNCA recria a NF (a UNIQUE ux_nf_cod_ped_dev_compra é o backstop).
    const jaNf = (await db
      .selectFrom('nf')
      .select('codnf')
      .where('cod_ped_dev_compra', '=', codpeddevcompra)
      .where('idempresa', '=', emp)
      .executeTakeFirst()) as { codnf: number } | undefined;
    if (jaNf) {
      await (this.dbp.forTenant() as AnyDB)
        .updateTable('pedido_devolucao_compra')
        .set({ status: 'NOTA_FISCAL_EMITIDA', codnf_emitida: jaNf.codnf, usultalteracao: op, dtultimalteracao: sql`now()` })
        .where('codpeddevcompra', '=', codpeddevcompra)
        .where('idempresa', '=', emp)
        .execute();
      throw new BusinessRuleError('DEVOLUCAO_NF_JA_EMITIDA', { codpeddevcompra });
    }

    // série da NFe: a saída PRÓPRIA é NUMERADA pelo agregado (NRONF=MAX+1 por empresa/modelo/série) — a série
    // vem da EMPRESA (fold: era '1' fixa; o legado usa EmpresaSERIE), não é rascunho-sem-número.
    const empRow = (await db.selectFrom('empresas').select('serie_nfe').where('idempresa', '=', emp).executeTakeFirst()) as { serie_nfe?: string } | undefined;
    const serie = (empRow?.serie_nfe ?? '1').trim() || '1';

    // corte-3 — ParceiroZeraImpostosDeICMSSt (uDMCadPedidoDevolucaoCompra.pas:435): fornecedor com
    // DEVOLUCAO_ZERA_IMPOSTO_ICMSST='S' → zera ICMS-ST (e ICMS, p/ CFOP de ST-retido) + força CST por CFOP de origem.
    const zeraRow = (await db
      .selectFrom('parceiros')
      .select('devolucao_zera_imposto_icmsst')
      .where('codparceiro', '=', dev.codparceiro)
      .where('idempresa', '=', emp)
      .executeTakeFirst()) as { devolucao_zera_imposto_icmsst?: string } | undefined;
    const zeraIcmsSt = String(zeraRow?.devolucao_zera_imposto_icmsst ?? 'N') === 'S';

    // itens + ESPELHO fiscal da entrada (nf_prod) + chave/estado da NF de origem + fallbacks do produto.
    const itens = (await db
      .selectFrom('pedido_devolucao_compra_i as i')
      .innerJoin('nf as n', 'n.codnf', 'i.codnf')
      .leftJoin('nf_prod as p', 'p.codnfprod', 'i.codnfprod')
      .leftJoin('produtos as pr', 'pr.idproduto', 'i.idproduto')
      .select([
        'i.codnf as codnf', 'i.idproduto as idproduto', 'i.qtd_devolvida as qtd_devolvida', 'i.qtd_nota_fiscal as qtd_nota_fiscal',
        'i.valor_custo as valor_custo', 'i.cfop as cfop', 'i.unidade as unidade',
        'n.chavenfe as chave_ref',
        sql<string>`case when coalesce(n.cancelada,'N')='S' or coalesce(n.statusnfe,'')='C' then 'S' else 'N' end`.as('origem_cancelada'),
        'p.cfop as cfop_origem', 'p.bcr as bcr', // CFOP de ENTRADA (p/ ParceiroZera CST) + base reduzida %
        'p.aliquota as p_aliquota', 'p.cst as cst', 'p.icms as icms', 'p.vrbasecalculo as vrbasecalculo',
        'p.vricm as vricm', 'p.vrbasest as vrbasest', 'p.vricmst as vricmst', 'p.ipi as ipi', 'p.vripi as vripi',
        'p.fcp_valor as fcp_valor', 'p.ncm as ncm', 'p.origem_estoque as origem_estoque',
        // corte-3 (fold): desconto/frete/seguro/outras despesas da entrada (compõem o TOTALNF → valor do A Receber).
        'p.desconto as desconto', 'p.frete as frete', 'p.seguro as seguro', 'p.vroutrasdesp as vroutrasdesp',
        // PIS/COFINS de entrada (espelho — corte-3): alíquotas + CST íntegros.
        'p.pis as pis', 'p.cstpiscofins as cstpiscofins', 'p.aliqpise as aliqpise', 'p.aliqcofinse as aliqcofinse',
        'pr.aliquota as pr_aliquota', 'pr.ncmsh as ncmsh', 'pr.origemprod as origemprod', 'pr.unidade as pr_unidade',
      ])
      .where('i.codpeddevcompra', '=', codpeddevcompra)
      .where('n.idempresa', '=', emp) // fold BAIXA: filtro de tenant também no read do espelho fiscal
      .orderBy('i.codpeddevcomprai')
      .execute()) as Array<Record<string, unknown>>;
    if (!itens.length) throw new BusinessRuleError('DEVOLUCAO_SEM_ITENS', { codpeddevcompra });
    // M3: não devolver contra NF de entrada CANCELADA.
    if (itens.some((it) => String(it.origem_cancelada) === 'S')) throw new BusinessRuleError('DEVOLUCAO_ORIGEM_CANCELADA', { codpeddevcompra });

    // itens da NF de saída — quantidade = qtd_devolvida; fiscal RATEADO da entrada por qtd_devolvida/qtd_entrada.
    const nfItens: Record<string, unknown>[] = [];
    let totFrete = 0;
    let totSeguro = 0;
    let totAcess = 0; // outras despesas acessórias (compõem o header → totalnf)
    let nro = 1;
    for (const it of itens) {
      const qtdDev = num(it.qtd_devolvida);
      const qtdEnt = num(it.qtd_nota_fiscal) || qtdDev;
      const f = qtdEnt > 0 ? qtdDev / qtdEnt : 1; // fator de rateio (espelho fiscal proporcional do legado)
      const rat = (v: unknown) => r2(num(v) * f);
      // corte SPED c2: alíquota de IPI RECOMPUTADA da NF de saída (não copia a % da entrada). O VrIPI já é
      // rateado; ipi% = VrIPI×100 / VRTOTALPRODUTOS (= qtd_devolvida × custo). uNF ImportaPedidoDevolucaoCompra
      // ramo VrIPI>0: cdsItensNotaIPI := TruncarArredondar((VrIPI*100)/VRTOTALPRODUTOS,'A',2). VrIPI=0 → mantém a %.
      const vripiRat = rat(it.vripi);
      const vrProdItem = qtdDev * num(it.valor_custo); // = quantidade × vrvenda (base do ipi%)
      const item: Record<string, unknown> = {
        nroitem: nro++,
        codproduto: it.idproduto,
        quantidade: qtdDev,
        fatorembal: 1,
        unidade: (it.unidade as string) ?? (it.pr_unidade as string) ?? undefined,
        vrvenda: num(it.valor_custo),
        vrcusto: num(it.valor_custo),
        cfop: (it.cfop as string) ?? undefined,
        aliquota: (it.p_aliquota as string) ?? (it.pr_aliquota as string) ?? undefined,
        ncm: (it.ncm as string) ?? (it.ncmsh as string) ?? undefined,
        origem_estoque: (it.origem_estoque as string) ?? (it.origemprod as string) ?? undefined,
        icms: it.icms != null ? num(it.icms) : undefined, // alíquota % — ÍNTEGRA (não rateia)
        cst: it.cst != null ? Number(it.cst) : undefined,
        vrbasecalculo: rat(it.vrbasecalculo),
        vricm: rat(it.vricm),
        vrbasest: rat(it.vrbasest),
        vricmst: rat(it.vricmst),
        ipi: vripiRat > 0 && vrProdItem > 0 ? r2((vripiRat * 100) / vrProdItem) : (it.ipi != null ? num(it.ipi) : undefined), // % recomputada (c2)
        vripi: vripiRat,
        fcp_valor: rat(it.fcp_valor),
        // corte-3 (fold): desconto/frete/seguro/despesas RATEADOS (compõem o TOTALNF; raros no golden mas afetam o valor).
        desconto: rat(it.desconto),
        frete: rat(it.frete),
        seguro: rat(it.seguro),
        vroutrasdesp: rat(it.vroutrasdesp),
        // corte-3: espelho PIS/COFINS de entrada (alíquotas/CST íntegros; ~41-47% dos itens no golden).
        pis: (it.pis as string) ?? undefined,
        cstpiscofins: (it.cstpiscofins as string) ?? undefined,
        aliqpise: it.aliqpise != null ? num(it.aliqpise) : undefined,
        aliqcofinse: it.aliqcofinse != null ? num(it.aliqcofinse) : undefined,
        geraestoque: 'S',
        movimenta_estoque: 'S',
      };
      // corte-3 — ParceiroZera: por CFOP de ORIGEM (dígitos 2-4). 401/403/405 (ST retido na fonte) → zera ICMS
      // E ST, CST 060. 101/102 (tributado normal) → zera só ST, CST 000 (redução 0/100) senão 020.
      if (zeraIcmsSt) {
        const d3 = String(it.cfop_origem ?? '').slice(1, 4);
        if (d3 === '401' || d3 === '403' || d3 === '405') {
          item.icms = 0;
          item.vrbasecalculo = 0;
          item.vricm = 0;
          item.vrbasest = 0;
          item.vricmst = 0;
          item.cst = 60;
        } else if (d3 === '101' || d3 === '102') {
          item.vrbasest = 0;
          item.vricmst = 0;
          const reducao = 100 - num(it.bcr); // BCR = % da base tributada
          item.cst = reducao === 0 || reducao === 100 ? 0 : 20;
        }
      }
      totFrete += num(item.frete);
      totSeguro += num(item.seguro);
      totAcess += num(item.vroutrasdesp);
      nfItens.push(item);
    }

    // refNFe: 1 referência por NF de ENTRADA distinta (codnf_ref + chave_ref da origem).
    const refMap = new Map<number, { codnf_ref: number; chave_ref: string | null; valor_ref: null }>();
    for (const it of itens) {
      const c = Number(it.codnf);
      if (!refMap.has(c)) refMap.set(c, { codnf_ref: c, chave_ref: (it.chave_ref as string) ?? null, valor_ref: null });
    }
    const referencias = [...refMap.values()];

    // CFOP do header = o CFOP de devolução do 1º item (todos compartilham o 1º dígito 5/6 — devolução single-UF-class).
    const cfopHeader = String(nfItens[0]?.cfop ?? '5202');
    // corte SPED c1: SITUAÇÃO OPERACIONAL do header = de-para do CFOP de saída (ISITUACAO_NF; golden 17='VENDAS PDV'
    // p/ 5202/6202/5411/6411). uPedidoDevolucaoCompra.pas:362-368/541-552. INERTE p/ contábil (nf_contabil não é populado).
    const sitRow = (await db
      .selectFrom('cfop').select('idsituacao_nf_saida').where('codcfop', '=', cfopHeader).executeTakeFirst()) as { idsituacao_nf_saida?: number | null } | undefined;
    const idsituacaoNf = sitRow?.idsituacao_nf_saida != null ? Number(sitRow.idsituacao_nf_saida) : undefined;
    const dto: Record<string, unknown> = {
      tipo: 'S',
      modelo: 55, // NFe própria de saída (NUMERADA pelo agregado; a transmissão SEFAZ é F6 — adiado)
      serie, // série da empresa (fold)
      tipoemissao: '0', // própria (a NF de devolução é NOSSA saída, não de terceiros)
      finalidade: '4', // devolução
      ...(idsituacaoNf != null ? { idsituacao_nf: idsituacaoNf } : {}),
      dtemissao: dev.hoje_iso,
      dtcontabil: dev.hoje_iso,
      cfop: cfopHeader,
      codparceiro: dev.codparceiro,
      cod_ped_dev_compra: codpeddevcompra, // vínculo IN-ROW (atômico + UNIQUE anti-duplo — fold ALTA)
      // corte-3 (fold): frete/seguro/despesas entram no TOTALNF pelo header (o `derivar` do NF não os soma dos itens).
      totalfrete: r2(totFrete),
      totalseguro: r2(totSeguro),
      totalacessorias: r2(totAcess),
      itens: nfItens,
      referencias, // exigido por validaDevolucao (finalidade='4' → ≥1 documento referenciado)
    };

    // CAS-first anti-duplo (M2): DIGITADO+codnf_emitida null → NOTA_FISCAL_EMITIDA. Só UMA chamada concorrente passa.
    const marca = await (this.dbp.forTenant() as AnyDB)
      .updateTable('pedido_devolucao_compra')
      .set({ status: 'NOTA_FISCAL_EMITIDA', usultalteracao: op, dtultimalteracao: sql`now()` })
      .where('codpeddevcompra', '=', codpeddevcompra)
      .where('idempresa', '=', emp)
      .where('status', '=', 'DIGITADO')
      .where('codnf_emitida', 'is', null)
      .executeTakeFirst();
    if (Number((marca as any)?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('DEVOLUCAO_NF_JA_EMITIDA', { codpeddevcompra });

    // cria a NF com o vínculo IN-ROW (cod_ped_dev_compra) — atômico com a criação. O catch ESTREITO (fold ALTA):
    // só reverte o status se a CRIAÇÃO falhar (NF não existe); a UNIQUE (23505) numa corrida vira já-emitida.
    let codnf: number;
    try {
      codnf = await this.engine.createAggregate(nfAggregateConfig, dto);
    } catch (e) {
      await (this.dbp.forTenant() as AnyDB)
        .updateTable('pedido_devolucao_compra')
        .set({ status: 'DIGITADO' })
        .where('codpeddevcompra', '=', codpeddevcompra)
        .where('idempresa', '=', emp)
        .execute();
      if ((e as { code?: string })?.code === '23505') throw new BusinessRuleError('DEVOLUCAO_NF_JA_EMITIDA', { codpeddevcompra });
      throw e;
    }
    // NF criada (vínculo IN-ROW). Reverse-link no documento — BEST-EFFORT: se falhar (ou o processo morrer), a
    // NF NÃO é recriada (UNIQUE) e o jaNf reconcilia o codnf_emitida na próxima chamada. Nunca duplica/trava.
    await (this.dbp.forTenant() as AnyDB)
      .updateTable('pedido_devolucao_compra')
      .set({ codnf_emitida: codnf })
      .where('codpeddevcompra', '=', codpeddevcompra)
      .where('idempresa', '=', emp)
      .execute();
    return { codnf, codpeddevcompra };
  }

  /**
   * corte-3 — FATURAR a devolução → A RECEBER contra o FORNECEDOR. Vencimento default = DTEMISSAO da NF +
   * `QUANTIDADE_DIAS_GERAR_BOLETO_DEVOLUCAO` (golden PINHEIRAO: 15); título ÚNICO (1 parcela), BOLETO. Delega
   * ao F4 (`nf-faturamento.faturar`; tipo='S'→areceber com codparceiro=fornecedor). O operador pode ajustar o
   * vencimento na tela da NF (o alinhamento ao vencimento da compra original é comportamento de fluxo — divergência
   * consciente). Requer a NF já gerada (codnf_emitida).
   */
  async faturarNf(codpeddevcompra: number): Promise<{ codnf: number; parcelas: number; vencimento: string }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const dev = (await db
      .selectFrom('pedido_devolucao_compra')
      .select(['codnf_emitida'])
      .where('codpeddevcompra', '=', codpeddevcompra)
      .where('idempresa', '=', emp)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { codnf_emitida?: number | null } | undefined;
    if (!dev) throw new BusinessRuleError('DEVOLUCAO_NAO_ENCONTRADA', { codpeddevcompra });
    if (dev.codnf_emitida == null) throw new BusinessRuleError('DEVOLUCAO_SEM_NF', { codpeddevcompra });
    const codnf = Number(dev.codnf_emitida);

    const nfRow = (await db
      .selectFrom('nf')
      .select([sql<string>`to_char(dtemissao::date, 'YYYY-MM-DD')`.as('emissao')])
      .where('codnf', '=', codnf)
      .where('idempresa', '=', emp)
      .executeTakeFirst()) as { emissao?: string } | undefined;
    // config ausente → 15 (default do legado); '0' é VÁLIDO (boleto à vista) — não usar `|| 15` (engoliria o 0).
    const cfgRaw = await this.config.resolver('QUANTIDADE_DIAS_GERAR_BOLETO_DEVOLUCAO', { empresaId: emp });
    const dias = cfgRaw != null && cfgRaw !== '' ? numCfg(cfgRaw) : 15;
    const hojeIso = nfRow?.emissao ?? new Date().toISOString().slice(0, 10); // emissão da devolução = hoje

    // corte SPED c4: VENCIMENTO ANCORADO na NF de ENTRADA (DataPrimeiraParcelaNotaDevolucao, udmNF.pas:6334).
    // Quando a devolução vem de UMA ÚNICA NF de entrada (178/545 no golden), a base do vencimento é a MENOR
    // dtvenc do A Pagar dessa entrada (se hoje > essa data → hoje). >1 NF de entrada (ou entrada sem A Pagar)
    // → base = hoje. Depois soma os dias do boleto de devolução. O operador ainda pode editar na tela.
    const refs = (await db.selectFrom('nf_referencia').select('codnf_ref').where('codnf', '=', codnf).execute()) as Array<{ codnf_ref?: number }>;
    let baseIso = hojeIso;
    if (refs.length === 1 && refs[0].codnf_ref != null) {
      const menor = (await db
        .selectFrom('apagar')
        .select([sql<string>`to_char(min(dtvenc)::date, 'YYYY-MM-DD')`.as('dtvenc')])
        .where('idnf', '=', Number(refs[0].codnf_ref))
        .where('codempresa', '=', emp)
        // fold auditoria: SÓ as duplicatas do fornecedor (FATURAMENTO no legado). Exclui RESIDUAL ST (venc=DTCONTABIL,
        // à vista) e retenção federal (venc dia-fixo) — gravados no mesmo apagar/idnf com retencao<>NULL — que
        // ancorariam o boleto na data ERRADA (o RESIDUAL ST vence antes das duplicatas).
        .where('retencao', 'is', null)
        .executeTakeFirst()) as { dtvenc?: string | null } | undefined;
      // hoje > menor → hoje; senão a data da entrada (fallback hoje se a entrada não tem A Pagar).
      if (menor?.dtvenc && menor.dtvenc > hojeIso) baseIso = menor.dtvenc;
    }
    const base = new Date(`${baseIso}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() + Math.round(dias));
    const vencimento = base.toISOString().slice(0, 10);

    // tipodoc='BOLETO' (golden do A Receber da devolução); 1 parcela.
    const r = await this.fat.faturar(codnf, { numParcelas: 1, primeiroVencimento: vencimento, intervaloDias: 0, tipodoc: 'BOLETO' });
    return { codnf, parcelas: r.parcelas, vencimento };
  }
}
