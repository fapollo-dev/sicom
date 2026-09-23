import { Injectable } from '@nestjs/common';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';
import { FiscalPricingService } from '../precificacao/preco-fiscal.service';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
/** o `Arredonda(x, -2, rmNearest)` do legado, a cada passo */
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface PrecoItemEntrada {
  idproduto: number;
  vrcusto: number;
  markup?: number | null;
  vrvenda?: number | null;
  /** % ICMS de entrada e % ICMS efetivo de saída do ITEM (herdados; o modal deixa editar) */
  icme?: number | null;
  icm_efetivo?: number | null;
  fcp_saida?: number | null;
}

export interface PrecoItem {
  creditoicm: number; creditopiscofins: number; vrcustoliquido: number;
  vrvendasug: number; pmz: number; icm_efetivo: number;
  debitoicm: number; debitopiscofins: number; vendaliq: number;
  lucrobrutov: number; lucrobrutop: number; despopv: number; lucroliqv: number; lucroliqp: number;
  imprend: number; contsocial: number; margeml2v: number; margeml2: number;
}

/**
 * O PREÇO DO ITEM do pedido de compra — o modal `uPrecificacaoProdutos` (`CalcValorCusto`:1254 e
 * `MargemPrecificacao`:1097), com as regras que a PRODUÇÃO pratica, medidas em 4.000 itens de jun-set/2026:
 *
 *  - créditos de entrada: ICMS = ICME% × custo (se o ICMS efetivo do item > 0; SN = 0); PIS/COFINS de entrada ×
 *    custo só no Lucro Real;
 *  - **custo líquido = custo − créditos, SEM somar a composição** (91% dos itens). O fonte de mai/2020 soma IPI, frete,
 *    seguro, despesa e ST com `CUSTO_CHEIO_PC='S'`, mas o custo herdado já é o de REPOSIÇÃO (`CUSTO_REP_PC='S'`), que
 *    traz a composição: o binário da produção não soma de novo. A composição fica no item como a foto herdada;
 *  - PMZ = custo líquido ÷ (100 − PIS/COFINS de saída − ICMS efetivo − FCP − despesa operacional) × 100;
 *  - escada sobre a venda: débito de ICMS = (ICMS efetivo + FCP) × venda (SN: alíquota do Simples), débito de
 *    PIS/COFINS = saída × venda, **venda líquida = venda − débitos** (99,8%; o fonte subtrairia a composição de novo),
 *    lucro bruto = venda líquida − custo líquido (99%), despesa operacional da empresa, lucro líquido, IR e CSLL da
 *    empresa sobre o lucro positivo, margem final (98-99%);
 *  - venda SUGERIDA pelo markup: o motor do catálogo (`TMargemPreco`, gross-up com IR/CSLL no modo "preço final" do
 *    cliente). ⚠️ A sugerida GRAVADA nos itens bate com ela a 1 centavo em só 45% — é calculada num momento que o dado
 *    não guarda (antes da negociação do custo); fica a fórmula que o Apollo já validou no catálogo.
 */
@Injectable()
export class PedidoItemPrecoService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
    private readonly fiscal: FiscalPricingService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async precificar(d: PrecoItemEntrada): Promise<PrecoItem> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const e = (await db.selectFrom('empresas').select(['classfiscal', 'uf', 'despoperacional', 'imprenda', 'contsocial', 'alqsimplesnac'])
      .where('idempresa', '=', emp).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!e) throw new BusinessRuleError('EMPRESA_NAO_ENCONTRADA', { idempresa: emp });
    const p = (await db.selectFrom('produtos as pr')
      .leftJoin('piscofins as pc', 'pc.idpiscofins', 'pr.idpiscofins')
      .select(['pr.aliquota', 'pc.aliq_pis_ent', 'pc.aliq_cofins_ent', 'pc.aliq_pis_sai', 'pc.aliq_cofins_sai'])
      .where('pr.idproduto', '=', d.idproduto).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!p) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto: d.idproduto });

    const sn = String(e.classfiscal ?? '') === 'SN';
    const lr = String(e.classfiscal ?? '') === 'LR';
    // ICMS efetivo: o do ITEM (herdado de DET_ALIQUOTA pela UF da empresa; o modal deixa editar)
    let icmEf = d.icm_efetivo;
    if (icmEf == null) {
      const al = (await db.selectFrom('det_aliquota').select(['icm_efetivo'])
        .where('aliquota', '=', String(p.aliquota ?? '')).where('uf', '=', String(e.uf ?? '')).executeTakeFirst()) as { icm_efetivo?: unknown } | undefined;
      icmEf = String(p.aliquota ?? '').toUpperCase().startsWith('T') ? num(al?.icm_efetivo) : 0;
    }
    const icmsEf = num(icmEf);
    const fcp = num(d.fcp_saida);
    const pisEnt = num(p.aliq_pis_ent), cofinsEnt = num(p.aliq_cofins_ent);
    const pisSai = num(p.aliq_pis_sai), cofinsSai = num(p.aliq_cofins_sai);
    const despOp = num(e.despoperacional), irpj = num(e.imprenda), csll = num(e.contsocial);
    const custo = num(d.vrcusto);

    // créditos de entrada (CalcValorCusto:1265-1282)
    const creditoicm = !sn && icmsEf > 0 ? r2((num(d.icme) * custo) / 100) : 0;
    const creditopiscofins = !sn && lr && pisEnt > 0 ? r2(((pisEnt + cofinsEnt) * custo) / 100) : 0;
    const vrcustoliquido = r2(custo - creditopiscofins - creditoicm);

    // PMZ (:1328-1333)
    const margemZero = 100 - ((pisSai + cofinsSai) + (icmsEf + fcp) + despOp);
    const pmz = margemZero > 0 ? r2((vrcustoliquido / margemZero) * 100) : 0;

    // venda sugerida pelo markup — o motor do catálogo (TMargemPreco)
    const tipo = String((await this.config.resolver('TIPO_PRECIFICACAO', { empresaId: emp })) ?? 'P').toUpperCase();
    const modo = String((await this.config.resolver('MARGEM_PRECO_FINAL_OU_LIQUIDO', { empresaId: emp })) ?? 'F').toUpperCase().startsWith('L') ? 'liquido' : 'final';
    const markup = num(d.markup);
    let vrvendasug = 0;
    if (vrcustoliquido > 0) {
      if (tipo === 'D') vrvendasug = r2(vrcustoliquido + (vrcustoliquido * markup) / 100);
      else if (tipo === 'M') vrvendasug = markup < 100 ? r2((vrcustoliquido / (100 - markup)) * 100) : 0;
      else {
        try {
          vrvendasug = this.fiscal.precoAtual(vrcustoliquido, markup, {
            pis: pisSai, cofins: cofinsSai, icmsEfetivo: icmsEf, fcp: 0, despOperacional: despOp,
            simplesNacional: sn, modoMargem: modo, irpj, csll,
          } as any);
        } catch { vrvendasug = 0; }
      }
    }

    // escada sobre a venda informada (MargemPrecificacao:1097-1153)
    const venda = num(d.vrvenda);
    const debitoicm = venda > 0 ? r2(sn ? (num(e.alqsimplesnac) * venda) / 100 : icmsEf > 0 ? ((icmsEf + fcp) * venda) / 100 : 0) : 0;
    const debitopiscofins = venda > 0 && !sn && pisSai > 0 ? r2(((pisSai + cofinsSai) * venda) / 100) : 0;
    const vendaliq = venda > 0 ? r2(venda - debitoicm - debitopiscofins) : 0;
    const lucrobrutov = venda > 0 ? r2(vendaliq - vrcustoliquido) : 0;
    const lucrobrutop = vendaliq > 0 ? r2((lucrobrutov / vendaliq) * 100) : 0;
    const despopv = venda > 0 ? r2((venda * despOp) / 100) : 0;
    const lucroliqv = venda > 0 ? r2(lucrobrutov - despopv) : 0;
    const lucroliqp = venda > 0 ? r2((lucroliqv / venda) * 100) : 0;
    const imprend = lucroliqv > 0 ? r2((lucroliqv * irpj) / 100) : 0;
    const contsocial = lucroliqv > 0 ? r2((lucroliqv * csll) / 100) : 0;
    const margeml2v = venda > 0 ? r2(lucroliqv - imprend - contsocial) : 0;
    const margeml2 = venda > 0 ? r2((margeml2v / venda) * 100) : 0;

    return {
      creditoicm, creditopiscofins, vrcustoliquido, vrvendasug, pmz, icm_efetivo: icmsEf,
      debitoicm, debitopiscofins, vendaliq, lucrobrutov, lucrobrutop, despopv, lucroliqv, lucroliqp,
      imprend, contsocial, margeml2v, margeml2,
    };
  }
}
