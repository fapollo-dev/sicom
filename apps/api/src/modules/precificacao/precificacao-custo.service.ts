import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { FiscalPricingService } from './preco-fiscal.service';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
/** TruncarArredondar(x,'A',2) do legado: arredonda p/ 2 casas — aplicado A CADA PASSO (não só no fim). */
const ln2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
/** formato do HISTORICO_DINAMICO do legado: vírgula + 2 casas ('11,29'). */
const fmtBr = (n: number) => n.toFixed(2).replace('.', ',');

/** os 21 campos que o legado audita nesta tela (FCamposHistorico, udmCadProduto.pas:2702-2724). */
const CAMPOS_HISTORICO = [
  'vrcusto', 'vrcustorep', 'vrvenda', 'ativo', 'ativo_compra', 'bonificacao', 'despacessorio', 'ipi', 'seguro',
  'frete', 'frete2', 'icmst', 'icme', 'vrcustocsi', 'promocao', 'vrpromo', 'markupfixo', 'markup', 'vrfcpst',
  'vrcustoajuste', 'vrvendasug',
] as const;

export interface ComponentesCusto {
  vrcusto: number;
  icme?: number; ipi?: number; frete?: number; frete2?: number; seguro?: number; // PERCENTUAIS do vrcusto
  icmst?: number; vrfcpst?: number; despacessorio?: number; vrcustoajuste?: number; bonificacao?: number; // VALORES
  fcp_saida?: number; // % FCP de SAÍDA (entra no PMZ e no débito da escada, NÃO no preço sugerido)
}

export interface PainelPrecificacao {
  // bases de custo
  vrcustoreal: number; vrcustorep: number; vrcustocsi: number;
  creditoicm: number; creditopiscofins: number;
  // preço
  pmz: number; vrvendasug: number; markup: number; vrvenda: number;
  // escada de margem (sobre o vrvenda informado)
  debitoicm: number; debitopiscofins: number; vendaliq: number;
  lucrobrutov: number; lucrobrutop: number; despopv: number;
  lucroliqv: number; lucroliqp: number; imprend: number; contsocial: number;
  margeml2v: number; margeml2: number; markdown: number;
}

/**
 * PRECIFICAÇÃO DE MERCADORIAS (FRMPRIFICACAOCUSTO) — corte-1: o PAINEL DE DERIVAÇÃO por produto × empresa.
 * `abrir`: produto + preço da empresa + parâmetros fiscais (empresa/alíquota/piscofins) + as empresas do operador.
 * `calcular`: PURO (não grava) — recomputa as 3 BASES de custo (fiel a CalcValorCusto:1426-1458, com a semântica
 * %-vs-VALOR), o PMZ, o preço SUGERIDO (motor fiscal `precoAtual`, TIPO_PRECIFICACAO='P' + margem 'F' = IRPJ/CSLL
 * embutidos) e a ESCADA DE MARGEM (MargemPrecificacao:2307-2365) sobre o preço informado. `salvar`: grava as
 * colunas do painel por empresa selecionada (+ propagação por grupo de preço) e audita os 21 campos em
 * HISTORICO_DINAMICO ('Precificação do Custo', vírgula-2dp); em MODO LOTE enfileira lote_preco e REVERTE só o
 * vrvenda (o resto do painel é gravado) — fiel a :943-967. NÃO existe trava preço<custo/PMZ no legado.
 */
@Injectable()
export class PrecificacaoCustoService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly fiscal: FiscalPricingService,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op(): number | null {
    return currentTenant().operadorId ?? null;
  }

  /** a empresa pedida tem de ser VISÍVEL ao operador nesta tela (fold auditoria: `idempresa` vinha do cliente sem
   *  checagem → leitura cross-empresa de custo/margem). Fiel ao sqqEmpresa (EMPRESAS ⋈ PERMISSOES do operador). */
  private async exigirPermissaoEmpresa(db: AnyDB, idempresa: number): Promise<void> {
    const ok = await db.selectFrom('permissoes').select('form')
      .where('form', '=', 'FRMPRIFICACAOCUSTO').where('codempresa', '=', idempresa).where('codoperador', '=', this.op())
      .executeTakeFirst();
    if (!ok) throw new BusinessRuleError('SEM_PERMISSAO_EMPRESA', { idempresa });
  }

  /** o operador pode ALTERAR o preço de venda? (grant EDTVRVENDA — fold auditoria: o legado desabilita o campo,
   *  :1362-1365; sem isso qualquer BTNGRAVAR reprecificava a loja). */
  private async podeAlterarPreco(db: AnyDB, idempresa: number): Promise<boolean> {
    const ok = await db.selectFrom('permissoes').select('form')
      .where('form', '=', 'FRMPRIFICACAOCUSTO').where('opcao', '=', 'EDTVRVENDA').where('codempresa', '=', idempresa)
      .where('codoperador', '=', this.op()).executeTakeFirst();
    return !!ok;
  }

  /** parâmetros fiscais de (produto, empresa): regime, alíquotas de saída, despesa operacional, IR/CSLL. */
  private async tributos(db: AnyDB, idproduto: number, idempresa: number) {
    const e = (await db.selectFrom('empresas').select(['classfiscal', 'uf', 'despoperacional', 'imprenda', 'contsocial', 'alqsimplesnac', 'preconf'])
      .where('idempresa', '=', idempresa).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!e) throw new BusinessRuleError('EMPRESA_NAO_ENCONTRADA', { idempresa });
    const p = (await db.selectFrom('produtos as pr')
      .leftJoin('piscofins as pc', 'pc.idpiscofins', 'pr.idpiscofins')
      .select(['pr.aliquota', 'pr.idpiscofins', 'pc.aliq_pis_ent', 'pc.aliq_cofins_ent', 'pc.aliq_pis_sai', 'pc.aliq_cofins_sai'])
      .where('pr.idproduto', '=', idproduto).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!p) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto });
    const uf = String(e.uf ?? '');
    const al = (await db.selectFrom('det_aliquota').select(['icm_efetivo'])
      .where('aliquota', '=', String(p.aliquota ?? '')).where('uf', '=', uf).executeTakeFirst()) as { icm_efetivo?: unknown } | undefined;
    const sn = String(e.classfiscal ?? '') === 'SN';
    // ICMS de saída só entra quando a ALÍQUOTA do produto é tributada ('T…'); no SN usa ALQSIMPLESNAC (escada) e
    // zera o gross-up (fiel a :1462-1466 e :2311-2314).
    const tributado = String(p.aliquota ?? '').toUpperCase().startsWith('T');
    return {
      simplesNacional: sn,
      tributado,
      icmsEfetivo: tributado ? num(al?.icm_efetivo) : 0,
      alqSimplesNac: num(e.alqsimplesnac),
      pisEnt: num(p.aliq_pis_ent), cofinsEnt: num(p.aliq_cofins_ent),
      pisSai: num(p.aliq_pis_sai), cofinsSai: num(p.aliq_cofins_sai),
      despOperacional: num(e.despoperacional),
      irpj: num(e.imprenda), csll: num(e.contsocial),
      preconf: String(e.preconf ?? 'O'),
    };
  }

  /** as 3 bases de custo + créditos (fiel a CalcValorCusto:1384-1458). */
  private bases(c: ComponentesCusto, t: Awaited<ReturnType<PrecificacaoCustoService['tributos']>>) {
    const custo = num(c.vrcusto);
    // créditos de ENTRADA só p/ Lucro Real; ICMS só se a alíquota é tributada (:1384-1408).
    const creditoicm = !t.simplesNacional && t.tributado ? ln2((num(c.icme) * custo) / 100) : 0;
    const creditopiscofins = !t.simplesNacional && t.pisEnt > 0 ? ln2(((t.pisEnt + t.cofinsEnt) * custo) / 100) : 0;
    // PERCENTUAIS do custo (:1411-1418)
    const ipi = ln2((custo * num(c.ipi)) / 100);
    const frete = ln2((custo * num(c.frete)) / 100);
    const seguro = ln2((custo * num(c.seguro)) / 100);
    const frete2v = (custo * num(c.frete2)) / 100;
    // VALORES
    const icmst = num(c.icmst), fcpst = num(c.vrfcpst), despac = num(c.despacessorio), ajuste = num(c.vrcustoajuste), bonif = num(c.bonificacao);
    const vrcustoreal = ln2(custo - creditopiscofins - creditoicm + icmst + fcpst + ipi + frete + seguro + despac + frete2v + ajuste);
    const vrcustorep = ln2(custo + (ipi + frete + seguro + despac + icmst + fcpst + frete2v + ajuste) - bonif);
    const vrcustocsi = ln2(vrcustorep - creditoicm - creditopiscofins);
    return { vrcustoreal, vrcustorep, vrcustocsi, creditoicm, creditopiscofins };
  }

  /** PAINEL COMPLETO (puro). `vrvenda` informado alimenta a escada; `markup` alimenta o preço sugerido. */
  async calcular(dto: ComponentesCusto & { idproduto: number; idempresa?: number; markup?: number; vrvenda?: number }): Promise<PainelPrecificacao> {
    const emp = dto.idempresa ?? this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.exigirPermissaoEmpresa(db, emp);
    const t = await this.tributos(db, dto.idproduto, emp);
    const b = this.bases(dto, t);
    const markup = num(dto.markup);
    const fcpSaida = num(dto.fcp_saida);

    // modo do cálculo (config viva do tenant: 'P' = gross-up fiscal; 'D'/'M' = markup simples/divisor).
    const tipo = String((await this.config.resolver('TIPO_PRECIFICACAO', { empresaId: emp })) ?? 'P').toUpperCase();
    const modoMargem = String((await this.config.resolver('MARGEM_PRECO_FINAL_OU_LIQUIDO', { empresaId: emp })) ?? 'F').toUpperCase() === 'F' ? 'final' : 'liquido';
    // base do PREÇO SUGERIDO: CSI no modo fiscal; REPOSIÇÃO em D/M (:1467-1472). O PMZ usa SEMPRE o CSI
    // (fold auditoria [BAIXA]: :1477 divide o campo ligado a VRCUSTOCSI, independente do TIPO_PRECIFICACAO).
    const baseSugerido = tipo === 'D' || tipo === 'M' ? b.vrcustorep : b.vrcustocsi;
    // alíquota de saída: ICMS efetivo + FCP de saída; zero no SN (fiel :1462-1466).
    const aliqSaidaGrossUp = t.simplesNacional ? 0 : t.icmsEfetivo + fcpSaida;
    // no SN o legado ZERA o PIS/COFINS da ESCADA (:2315) — mas os mantém no PMZ (:1474).
    const pisEscada = t.simplesNacional ? 0 : t.pisSai;
    const cofinsEscada = t.simplesNacional ? 0 : t.cofinsSai;

    const pmz = b.vrcustocsi > 0
      ? this.fiscal.pmz(b.vrcustocsi, { pis: t.pisSai, cofins: t.cofinsSai, icms: aliqSaidaGrossUp, despOperacional: t.despOperacional })
      : 0;
    // preço SUGERIDO: sem gate de markup (fold auditoria: :1479 calcula SEMPRE — margem 0 dá preço real; 9.585
    // linhas do golden têm markup 0 E sugerido > 0). FCP NÃO entra aqui (o legado chama sem o argumento, :1479).
    let vrvendasug = 0;
    if (baseSugerido > 0) {
      if (tipo === 'D') vrvendasug = ln2(baseSugerido + (baseSugerido * markup) / 100);
      else if (tipo === 'M') vrvendasug = markup < 100 ? ln2((baseSugerido / (100 - markup)) * 100) : 0;
      else vrvendasug = this.fiscal.precoAtual(baseSugerido, markup, {
        pis: t.pisSai, cofins: t.cofinsSai, icmsEfetivo: t.icmsEfetivo, fcp: 0,
        despOperacional: t.despOperacional, simplesNacional: t.simplesNacional,
        modoMargem: modoMargem as 'final' | 'liquido', irpj: t.irpj, csll: t.csll,
      } as any);
    }

    // ESCADA sobre o preço informado (MargemPrecificacao:2307-2365), com a ORDEM DE ARREDONDAMENTO do legado
    // (fold auditoria [MÉDIA]): cada débito é arredondado e a VENDA LÍQUIDA é `venda − ICM − PIS` (não
    // `venda × (1−Σ%)`) — senão o painel não fecha na casa do centavo (250−45−23,13 = 181,87, não 181,88).
    const venda = num(dto.vrvenda);
    const icmsEscada = t.simplesNacional ? t.alqSimplesNac + fcpSaida : t.icmsEfetivo + fcpSaida;
    const debitoicm = venda > 0 && (t.simplesNacional || t.tributado) ? ln2((icmsEscada * venda) / 100) : 0;
    const debitopiscofins = venda > 0 ? ln2(((pisEscada + cofinsEscada) * venda) / 100) : 0;
    const vendaliq = venda > 0 ? ln2(venda - debitoicm - debitopiscofins) : 0;
    const lucrobrutov = venda > 0 ? ln2(vendaliq - b.vrcustocsi) : 0;
    const lucrobrutop = vendaliq > 0 ? ln2((lucrobrutov / vendaliq) * 100) : 0;
    const despopv = venda > 0 ? ln2((venda * t.despOperacional) / 100) : 0;
    const lucroliqv = venda > 0 ? ln2(lucrobrutov - despopv) : 0;
    const lucroliqp = venda > 0 ? ln2((lucroliqv / venda) * 100) : 0;
    // IR/CSLL só sobre lucro POSITIVO (:2348-2352).
    const imprend = lucroliqv > 0 ? ln2((lucroliqv * t.irpj) / 100) : 0;
    const contsocial = lucroliqv > 0 ? ln2((lucroliqv * t.csll) / 100) : 0;
    const margeml2v = venda > 0 ? ln2(lucroliqv - imprend - contsocial) : 0;
    const margeml2 = venda > 0 ? ln2((margeml2v / venda) * 100) : 0;
    const markdown = venda > 0 ? ln2(((venda - b.vrcustorep) / venda) * 100) : 0;

    return {
      ...b, pmz, vrvendasug, markup, vrvenda: venda,
      debitoicm, debitopiscofins, vendaliq, lucrobrutov, lucrobrutop, despopv,
      lucroliqv, lucroliqp, imprend, contsocial, margeml2v, margeml2, markdown,
    };
  }

  /** abre o painel: produto + preço da empresa + empresas do operador (com saldo) + o painel calculado. */
  async abrir(idproduto: number, idempresa?: number): Promise<Record<string, unknown>> {
    const emp = idempresa ?? this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    await this.exigirPermissaoEmpresa(db, emp);
    const prod = (await db.selectFrom('produtos').select(['idproduto', 'codbarra', 'descricao', 'aliquota', 'codgrupopreco', 'ativo'])
      .where('idproduto', '=', idproduto).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!prod) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto });
    const mp = (await db.selectFrom('multi_preco').selectAll().where('idproduto', '=', idproduto).where('idempresa', '=', emp).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!mp) throw new BusinessRuleError('PRECO_NAO_ENCONTRADO', { idproduto, idempresa: emp });
    // empresas do OPERADOR com permissão nesta tela + saldo do produto (fiel a sqqEmpresa; o LEFT JOIN estoque do
    // legado degenera em INNER e ESCONDE a empresa sem linha de estoque — divergência CONSCIENTE: mantemos a empresa).
    const empresas = (await db.selectFrom('empresas as e')
      .innerJoin('permissoes as p', (j) => j.onRef('p.codempresa', '=', 'e.idempresa').on('p.form', '=', 'FRMPRIFICACAOCUSTO').on('p.codoperador', '=', this.op()))
      .leftJoin('estoque as s', (j) => j.onRef('s.idempresa', '=', 'e.idempresa').on('s.idproduto', '=', idproduto))
      .select(['e.idempresa', 'e.fantasia', 'e.classfiscal', sql`coalesce(s.qtde,0)`.as('qtde')])
      .groupBy(['e.idempresa', 'e.fantasia', 'e.classfiscal', 's.qtde'])
      .orderBy('e.idempresa').execute()) as Record<string, unknown>[];
    const painel = await this.calcular({
      idproduto, idempresa: emp, vrcusto: num(mp.vrcusto), icme: num(mp.icme), ipi: num(mp.ipi), frete: num(mp.frete),
      frete2: num(mp.frete2), seguro: num(mp.seguro), icmst: num(mp.icmst), vrfcpst: num(mp.vrfcpst),
      despacessorio: num(mp.despacessorio), vrcustoajuste: num(mp.vrcustoajuste), bonificacao: num(mp.bonificacao),
      markup: num(mp.markup), vrvenda: num(mp.vrvenda),
    });
    const t = await this.tributos(db, idproduto, emp);
    return { produto: prod, preco: mp, empresas, painel, modo_lote_default: t.preconf === 'L' };
  }

  /**
   * grava o painel nas empresas selecionadas (+ grupo de preço) e audita. `modoLote` → enfileira lote_preco e
   * REVERTE só o vrvenda (o resto do painel grava) — fiel a :943-967.
   */
  async salvar(dto: ComponentesCusto & { idproduto: number; empresas: number[]; markup?: number; vrvenda: number; modoLote?: boolean }): Promise<{ idproduto: number; empresas: number[]; lotes: number; historico: number }> {
    const emp = this.emp();
    const op = this.op();
    const alvosEmp = Array.from(new Set((dto.empresas?.length ? dto.empresas : [emp]).map(Number)));
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nomeOp = (await trx.selectFrom('operadores').select('nome').where('codoperador', '=', op).executeTakeFirst()) as { nome?: string } | undefined;
      const grupo = (await trx.selectFrom('produtos').select('codgrupopreco').where('idproduto', '=', dto.idproduto).executeTakeFirst()) as { codgrupopreco?: number } | undefined;
      let lotes = 0;
      let historico = 0;
      for (const e of alvosEmp) {
        // a empresa tem de ser visível ao operador nesta tela (RBAC por-empresa, fiel ao sqqEmpresa).
        const perm = await trx.selectFrom('permissoes').select('form').where('form', '=', 'FRMPRIFICACAOCUSTO').where('codempresa', '=', e).where('codoperador', '=', op).executeTakeFirst();
        if (!perm) throw new BusinessRuleError('SEM_PERMISSAO_EMPRESA', { idempresa: e });
        const antes = (await trx.selectFrom('multi_preco').selectAll().where('idproduto', '=', dto.idproduto).where('idempresa', '=', e).forUpdate().executeTakeFirst()) as Record<string, unknown> | undefined;
        if (!antes) continue; // sem linha de preço nessa empresa → nada a gravar (fiel: o UPDATE não casa)
        // PROMO: o legado apenas CONGELA o preço da empresa em promoção (:603/:943) e grava o resto. Fold auditoria
        // [MÉDIA]: antes eu lançava erro e abortava o save INTEIRO (bloqueava até corrigir custo nas outras empresas).
        const emPromocao = String(antes.promocao ?? 'N') === 'S';
        // GRANT do preço (fold [MÉDIA]): sem EDTVRVENDA o operador salva custos mas NÃO altera o preço.
        const podePreco = await this.podeAlterarPreco(trx, e);
        const painel = await this.calcular({ ...dto, idempresa: e });
        // preço a gravar: modo lote → mantém o atual (reversão); promoção/sem-grant → mantém; vrvenda<=0 → mantém
        // (fold [BAIXA]: o legado re-lê o preço do banco quando o campo vem 0, :947-952).
        const precoInformado = r4(num(dto.vrvenda));
        const manterPreco = dto.modoLote || emPromocao || !podePreco || precoInformado <= 0;
        const vendaGravada = manterPreco ? num(antes.vrvenda) : precoInformado;
        const patch: Record<string, unknown> = {
          vrcusto: r4(num(dto.vrcusto)), icme: r4(num(dto.icme)), ipi: r4(num(dto.ipi)), frete: r4(num(dto.frete)),
          frete2: r4(num(dto.frete2)), seguro: r4(num(dto.seguro)), icmst: r4(num(dto.icmst)), vrfcpst: r4(num(dto.vrfcpst)),
          despacessorio: r4(num(dto.despacessorio)), vrcustoajuste: r4(num(dto.vrcustoajuste)), bonificacao: r4(num(dto.bonificacao)),
          fcp_saida: r4(num(dto.fcp_saida)), markup: r4(num(dto.markup)), vrvenda: vendaGravada,
          vrcustoreal: painel.vrcustoreal, vrcustorep: painel.vrcustorep, vrcustocsi: painel.vrcustocsi,
          creditoicm: painel.creditoicm, creditopiscofins: painel.creditopiscofins, pmz: painel.pmz, vrvendasug: painel.vrvendasug,
          debitoicm: painel.debitoicm, debitopiscofins: painel.debitopiscofins, vendaliq: painel.vendaliq,
          lucrobrutov: painel.lucrobrutov, lucrobrutop: painel.lucrobrutop, despopv: painel.despopv,
          lucroliqv: painel.lucroliqv, lucroliqp: painel.lucroliqp, imprend: painel.imprend, contsocial: painel.contsocial,
          margeml2: painel.margeml2, margeml2v: painel.margeml2v,
        };
        // alvos de PRODUTO: o próprio + os do mesmo grupo de preço nessa empresa (propagação do legado :1097-1159).
        // Fold auditoria [ALTA]: a propagação é guardada por `rdbOnLine.Checked` (:1062) — em MODO LOTE o legado
        // NÃO toca o preço dos peers (só enfileira). Antes eu escrevia o preço ATUAL do produto principal em todos
        // os peers, repreçando o grupo justamente no modo cujo contrato é "não altera preço agora".
        let produtos: number[] = [dto.idproduto];
        if (!dto.modoLote && grupo?.codgrupopreco != null && Number(grupo.codgrupopreco) > 0) {
          const g = (await trx.selectFrom('produtos as p').innerJoin('multi_preco as m', (j) => j.onRef('m.idproduto', '=', 'p.idproduto').on('m.idempresa', '=', e))
            .select('p.idproduto').where('p.codgrupopreco', '=', Number(grupo.codgrupopreco)).execute()) as Array<{ idproduto: number }>;
          produtos = Array.from(new Set([dto.idproduto, ...g.map((r) => Number(r.idproduto))]));
        }
        for (const pid of produtos) {
          const antesP = pid === dto.idproduto ? antes : ((await trx.selectFrom('multi_preco').selectAll().where('idproduto', '=', pid).where('idempresa', '=', e).executeTakeFirst()) as Record<string, unknown> | undefined);
          if (!antesP) continue;
          // no grupo o legado seta o preço do peer E RECALCULA os derivados dele (CalcularValorCusto, :1132) —
          // fold auditoria [MÉDIA]: antes o peer ficava com pmz/margem descrevendo o preço ANTIGO. Os componentes
          // de CUSTO do peer são dele (não sobrescrevemos); só o preço vem do produto principal.
          let patchP: Record<string, unknown> = patch;
          if (pid !== dto.idproduto) {
            const pv = await this.calcular({
              idproduto: pid, idempresa: e, vrcusto: num(antesP.vrcusto), icme: num(antesP.icme), ipi: num(antesP.ipi),
              frete: num(antesP.frete), frete2: num(antesP.frete2), seguro: num(antesP.seguro), icmst: num(antesP.icmst),
              vrfcpst: num(antesP.vrfcpst), despacessorio: num(antesP.despacessorio), vrcustoajuste: num(antesP.vrcustoajuste),
              bonificacao: num(antesP.bonificacao), fcp_saida: num(antesP.fcp_saida), markup: num(antesP.markup), vrvenda: vendaGravada,
            });
            patchP = {
              vrvenda: vendaGravada, vrcustoreal: pv.vrcustoreal, vrcustorep: pv.vrcustorep, vrcustocsi: pv.vrcustocsi,
              creditoicm: pv.creditoicm, creditopiscofins: pv.creditopiscofins, pmz: pv.pmz, vrvendasug: pv.vrvendasug,
              debitoicm: pv.debitoicm, debitopiscofins: pv.debitopiscofins, vendaliq: pv.vendaliq,
              lucrobrutov: pv.lucrobrutov, lucrobrutop: pv.lucrobrutop, despopv: pv.despopv,
              lucroliqv: pv.lucroliqv, lucroliqp: pv.lucroliqp, imprend: pv.imprend, contsocial: pv.contsocial,
              margeml2: pv.margeml2, margeml2v: pv.margeml2v,
            };
          }
          await trx.updateTable('multi_preco').set(patchP).where('idproduto', '=', pid).where('idempresa', '=', e).execute();
          // auditoria: uma linha por CAMPO alterado, HISTORICO='Precificação do Custo', valores vírgula-2dp.
          for (const campo of CAMPOS_HISTORICO) {
            if (!(campo in patchP)) continue;
            const de = antesP[campo];
            const para = (patchP as Record<string, unknown>)[campo];
            const mudou = typeof para === 'number' ? num(de) !== para : String(de ?? '') !== String(para ?? '');
            if (!mudou) continue;
            await trx.insertInto('historico_dinamico').values({
              campo: campo.toUpperCase(),
              valor_anterior: typeof para === 'number' ? fmtBr(num(de)) : String(de ?? '').slice(0, 20),
              valor_atual: typeof para === 'number' ? fmtBr(num(para)) : String(para ?? '').slice(0, 20),
              tabela: 'MULTI_PRECO', data: sql`now()`, codoperador: op, chave: 'IDPRODUTO', valor_chave: String(pid),
              codempresa: e, historico: 'Precificação do Custo',
            }).execute();
            historico++;
          }
          if (dto.modoLote && precoInformado > 0 && precoInformado !== num(antes.vrvenda) && podePreco) {
            // fiel :855/:908 — só enfileira quando o preço REALMENTE mudou (e o operador pode alterá-lo).
            // MODO LOTE: o preço novo vai p/ a fila. OBS igual ao form do produto, ORIGEM NULL (fiel: esta tela não
            // escreve origem), CODOPERADOR preenchido, MARKUP só se > 0.
            const mk = r4(num(dto.markup));
            await trx.insertInto('lote_preco').values({
              idproduto: pid, codempresa: e, vrvenda: r4(num(dto.vrvenda)), ...(mk > 0 ? { markup: mk } : {}),
              processado: 'N', datalote: sql`now()`, codoperador: op,
              obs: `REFERENTE AO AJUSTE NO CADASTRO DO PRODUTO REALIZADO PELO OPERADOR: ${op ?? ''}-${(nomeOp?.nome ?? '').trim()}`.slice(0, 300),
            }).execute();
            lotes++;
          }
        }
      }
      return { idproduto: dto.idproduto, empresas: alvosEmp, lotes, historico };
    });
  }
}
