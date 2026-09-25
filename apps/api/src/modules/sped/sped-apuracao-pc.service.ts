import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { configNaTrx } from '../compras/pedido-heranca';

type AnyDB = Kysely<any>;

/**
 * APURAÇÃO PIS/COFINS (`UapuracaoPISCOFINS` — o "Apurar"; dossiê UapuracaoPISCOFINS.md, cortes C e D). Grava APURACAO_PC/APURACAO_PC_DET
 * como o legado: o escopo da raiz do CNPJ, CRÉDITO/ENTRADA pela fórmula do item com o ICMS fora da base, DÉBITO/NFC-e pelo VL_OPR menos
 * o ICMS, DÉBITO/SAIDA NF (ramo não reproduzido, do fonte), com APURACAO, TIPO do legado, tipo de crédito e base de crédito do catálogo,
 * as descrições e os `*_APURA`. O mesmo período não é refeito (volta o existente). As linhas `I` (receita não tributada, M400/M800) são do
 * Apollo — o legado as calcula na geração do SPED.
 */
@Injectable()
export class SpedApuracaoPcService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /**
   * O ESCOPO da apuração (`UapuracaoPISCOFINS.pas:714`, dossiê R3/R5): a raiz do CNPJ da empresa logada — as empresas 1 e 2 juntas — e
   * IDEMPRESA nulo; só com `SELECIONAR_EMPRESA_APURACAO_GERACAO_SPED_CONTRIB` = 'S' (a produção tem 'N') a apuração é da empresa.
   */
  async escopo(db: AnyDB): Promise<{ porEmpresa: boolean; emp: number; empresas: number[] }> {
    const emp = this.emp();
    const cfg = String((await configNaTrx(db, 'SELECIONAR_EMPRESA_APURACAO_GERACAO_SPED_CONTRIB', { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' })) ?? 'N')
      .toUpperCase() === 'S';
    if (cfg) return { porEmpresa: true, emp, empresas: [emp] };
    const empresas = (await sql<{ idempresa: number }>`
      SELECT e.idempresa FROM empresas e, empresas me
       WHERE me.idempresa = ${emp} AND substr(regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g'), 1, 8) = substr(regexp_replace(coalesce(me.cnpj, ''), '\D', '', 'g'), 1, 8)
       ORDER BY e.idempresa`.execute(db)).rows.map((r) => Number(r.idempresa));
    return { porEmpresa: false, emp, empresas: empresas.length ? empresas : [emp] };
  }

  async apurar(dtini: string, dtfim: string): Promise<{ codapuracao_pc: number; existente?: boolean; grupos: number; total_credito_pis: number; total_credito_cofins: number; grupos_debito: number; total_debito_pis: number; total_debito_cofins: number; grupos_isento: number; total_receita_nao_tributada: number }> {
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const { porEmpresa, emp, empresas } = await this.escopo(trx);
      const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
      // o MESMO período não é refeito (`btnVendasClick`, :676-689: "já realizada, deseja carregar?"): volta a existente; refazer = excluir antes
      const ja = (await sql<{ codapuracao_pc: number }>`
        SELECT codapuracao_pc FROM apuracao_pc
         WHERE dataini = ${dtini}::date AND datafim = ${dtfim}::date AND ${porEmpresa ? sql`idempresa = ${emp}` : sql`(idempresa IS NULL OR idempresa = ANY(${empresas}::int[]))`}
         ORDER BY codapuracao_pc LIMIT 1`.execute(trx)).rows[0];
      if (ja) {
        const t = (await sql<Record<string, unknown>>`
          SELECT count(*) FILTER (WHERE tipo = 'C')::int AS gc, count(*) FILTER (WHERE tipo = 'D')::int AS gd, count(*) FILTER (WHERE tipo = 'I')::int AS gi,
                 coalesce(sum(valorpis) FILTER (WHERE tipo = 'C'), 0) AS cp, coalesce(sum(valorcofins) FILTER (WHERE tipo = 'C'), 0) AS cc,
                 coalesce(sum(valorpis) FILTER (WHERE tipo = 'D'), 0) AS dp, coalesce(sum(valorcofins) FILTER (WHERE tipo = 'D'), 0) AS dc
            FROM apuracao_pc_det WHERE codapuracao_pc = ${ja.codapuracao_pc}`.execute(trx)).rows[0];
        return { codapuracao_pc: Number(ja.codapuracao_pc), existente: true, grupos: Number(t.gc), total_credito_pis: r2(Number(t.cp)), total_credito_cofins: r2(Number(t.cc)),
          grupos_debito: Number(t.gd), total_debito_pis: r2(Number(t.dp)), total_debito_cofins: r2(Number(t.dc)), grupos_isento: Number(t.gi), total_receita_nao_tributada: 0 };
      }
      const cab = (await trx
        .insertInto('apuracao_pc')
        .values({ idempresa: porEmpresa ? emp : null, dataini: dtini, datafim: dtfim, codoperador: op })
        .returning('codapuracao_pc')
        .executeTakeFirstOrThrow()) as { codapuracao_pc: number };
      const codapuracao_pc = Number(cab.codapuracao_pc);
      const ctxCfg = { empresaId: emp, operadorId: op, modulo: 'Retaguarda' };
      const foraDaBase = String((await configNaTrx(trx, 'FILTRAR_CFOP_CALCULO_PIS_COFINS_BASE_ENT', ctxCfg)) ?? '1407, 1556, 1653, 1908, 1910, 2556, 2910, 1949')
        .split(/[,; ]+/).map((x) => x.trim()).filter(Boolean);
      const contingencia = String((await configNaTrx(trx, 'CONSIDERA_NFCE_CONTINGENCIA_SPED_FISCAL', ctxCfg)) ?? 'N').toUpperCase() === 'S';
      const linha = (l: Record<string, unknown>) => trx.insertInto('apuracao_pc_det').values({ codapuracao_pc, ...l }).execute();

      // ── CRÉDITO / ENTRADA (`UdmapuracaoPISCOFINS.dfm:1491-1541`, dossiê R6/R7) ─────────────────────────────────────────────
      // itens das NFs de ENTRADA processadas do período (DTCONTABIL) das empresas da raiz, com o CFOP no PC_CONFIG e fora da lista de
      // exclusão, produto com situação PIS/COFINS, alíquota de entrada > 0, CST de entrada 50-56/60 e fornecedor pessoa jurídica.
      // Base do item = (VRCUSTO×QTD − VRDESCPROD) + DEPSACESS + SEGURO% + o frete do item (VRFRETE, a fatia do frete da nota — a do
      // binário novo: 882,69 da apuração 261 fecha com ela, não com o FRETE% do fonte), em NUMERIC(15,2), somada e MENOS o ICMS fiscal
      // do item tributado ('T…'), exceto CFOP de PROC_CUPOM (o 1403): 6 de 7 linhas da 261 e da 22 fecham ao centavo.
      // Uma linha por (tipo de crédito, base de crédito do CFOP — 0 sem ela —, situação, alíquotas de entrada do catálogo).
      const creditos = (await sql<Record<string, unknown>>`
        SELECT cpc.id_tipocredito, coalesce(pc.id_basecredito, 0) AS id_basecredito, pb.descricao AS descricaobase, cpc.idpiscofins, cpc.descricao AS descricaopc,
               cpc.aliq_pis_ent, cpc.aliq_cofins_ent, cpc.aliq_pis_sai, cpc.aliq_cofins_sai, cpc.cst_pis_ent, cpc.cst_cofins_ent,
               sum(x.b) AS bruta, sum(x.icm) AS icm
          FROM (
            SELECT np.cfop, coalesce(np.idpiscofins, p.idpiscofins) AS sit,
                   CAST(((np.vrcusto * np.quantidade) - coalesce(np.vrdescprod, 0)) + coalesce(np.depsacess, 0)
                        + (coalesce(np.seguro, 0) * ((np.vrcusto * np.quantidade) - coalesce(np.vrdescprod, 0))) / 100
                        + coalesce(np.vrfrete, 0) AS numeric(15,2)) AS b,
                   CASE WHEN coalesce(c.proc_cupom, 'N') = 'S' THEN 0 WHEN substr(coalesce(np.aliquota, ''), 1, 1) = 'T' THEN coalesce(np.vricm, 0) ELSE 0 END AS icm
              FROM nf_prod np
              JOIN nf n ON n.codnf = np.codnf
              LEFT JOIN parceiros pe ON pe.codparceiro = n.codparceiro
              LEFT JOIN produtos p ON p.idproduto = np.codproduto
              LEFT JOIN cfop c ON c.codcfop = np.cfop
             WHERE n.tipo = 'E' AND n.dtcontabil::date BETWEEN ${dtini}::date AND ${dtfim}::date
               AND n.idempresa = ANY(${empresas}::int[])
               AND n.nronf IS NOT NULL AND n.nronf <> '0'
               AND np.cfop IN (SELECT pcx.cfop FROM pc_config pcx)
               AND coalesce(n.cancelada, 'N') = 'N' AND coalesce(n.proc, 'N') = 'S'
               AND p.idpiscofins > 0
               AND pe.tipofj NOT IN ('F', 'R')
               AND NOT (np.cfop = ANY(${foraDaBase}::text[]))
          ) x
          JOIN piscofins cpc ON cpc.idpiscofins = x.sit
          LEFT JOIN pc_config pc ON pc.cfop = x.cfop
          LEFT JOIN pc_basecredito pb ON pb.idbasecredito = pc.id_basecredito
         WHERE cpc.aliq_pis_ent > 0 AND cpc.cst_pis_ent IN (50, 51, 52, 53, 54, 55, 56, 60)
         GROUP BY cpc.id_tipocredito, coalesce(pc.id_basecredito, 0), pb.descricao, cpc.idpiscofins, cpc.descricao, cpc.aliq_pis_ent, cpc.aliq_cofins_ent,
                  cpc.aliq_pis_sai, cpc.aliq_cofins_sai, cpc.cst_pis_ent, cpc.cst_cofins_ent
         ORDER BY 1, 2, 3, 4`.execute(trx)).rows;
      let totPis = 0;
      let totCofins = 0;
      for (const g of creditos) {
        const base = r2(Number(g.bruta) - Number(g.icm));
        const aPis = Number(g.aliq_pis_ent) || 0;
        const aCof = Number(g.aliq_cofins_ent) || 0;
        const vPis = r2((base * aPis) / 100);
        const vCof = r2((base * aCof) / 100);
        await linha({
          tipo: 'C', apuracao: 'CREDITO', tipo_origem: 'ENTRADA', id_tipocredito: g.id_tipocredito != null ? Number(g.id_tipocredito) : null,
          id_basecredito: Number(g.id_basecredito), descricaobase: g.descricaobase ?? null, idpiscofins: Number(g.idpiscofins), descricaopc: g.descricaopc ?? null,
          cst_pis: g.cst_pis_ent != null ? Number(g.cst_pis_ent) : null, cst_cofins: g.cst_cofins_ent != null ? Number(g.cst_cofins_ent) : null,
          basecalculo: base, aliqpis: aPis, valorpis: vPis, aliqcofins: aCof, valorcofins: vCof,
          // `*_APURA` (dossiê R12, regra de 2025+): a base líquida de ICMS com a alíquota cheia (a de saída do catálogo, 1,65/7,6) — no
          // crédito presumido também
          basecalculoapura: base, valorpisapura: r2((base * (Number(g.aliq_pis_sai) || 0)) / 100), valorcofinsapura: r2((base * (Number(g.aliq_cofins_sai) || 0)) / 100),
        });
        totPis += vPis;
        totCofins += vCof;
      }

      // ── DÉBITO / NFC-e (`UdmapuracaoPISCOFINS.dfm:1825-1886`, dossiê R4/R8) ──────────────────────────────────────────────────
      // as vendas das NFC-e autorizadas (contingência só com a config) do período; o VL_OPR do item (IAT 'A' arredonda, senão trunca, +
      // acréscimos − promoção − departamento − descontos) menos o ICMS do item; uma linha por situação PIS/COFINS com alíquota de saída.
      // O ramo NFC-e do legado não filtra empresa (R4) — com o escopo da raiz, também não aqui. 3 de 3 linhas da 261 e da 22 fecham.
      const d0 = String(dtini).slice(0, 10);
      const dfimNext = new Date(`${String(dtfim).slice(0, 10)}T00:00:00Z`);
      dfimNext.setUTCDate(dfimNext.getUTCDate() + 1);
      const d1 = dfimNext.toISOString().slice(0, 10);
      const nfce = (await sql<Record<string, unknown>>`
        SELECT cpc.id_tipocredito, cpc.idpiscofins, cpc.descricao AS descricaopc, cpc.aliq_pis_sai, cpc.aliq_cofins_sai, cpc.cst_pis_sai, cpc.cst_cofins_sai,
               sum(x.vl) AS vl, sum(x.icms) AS icms
          FROM (
            SELECT coalesce(v.idpiscofins, p.idpiscofins) AS sit,
                   (CASE WHEN v.iat = 'A' THEN CAST(v.qtde * v.vrvenda AS numeric(18,2)) ELSE trunc(v.qtde * v.vrvenda, 2) END)
                   + greatest(coalesce(v.desc_acre_medio, 0), 0) + greatest(coalesce(v.desc_acre_item, 0), 0)
                   - (coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0) + greatest(-coalesce(v.desc_acre_medio, 0), 0) + greatest(-coalesce(v.desc_acre_item, 0), 0)) AS vl,
                   CAST(coalesce(v.icms_valor, 0) AS numeric(13,2)) AS icms
              FROM vendas v JOIN produtos p ON p.idproduto = v.codproduto
             WHERE v.dtvenda >= ${d0} AND v.dtvenda < ${d1} AND coalesce(v.cancelado, 'N') = 'N'
               AND coalesce(v.venda_nfc, 'N') = 'S' AND v.chavenfe IS NOT NULL
               AND (coalesce(v.statusnfe, '') = 'P' OR (${contingencia} AND coalesce(v.statusnfe, '') = 'G'))
               ${porEmpresa ? sql`AND v.idempresa = ${emp}` : sql``}
          ) x
          JOIN piscofins cpc ON cpc.idpiscofins = x.sit
         WHERE cpc.aliq_pis_sai > 0
         GROUP BY cpc.id_tipocredito, cpc.idpiscofins, cpc.descricao, cpc.aliq_pis_sai, cpc.aliq_cofins_sai, cpc.cst_pis_sai, cpc.cst_cofins_sai
         ORDER BY 1, 2`.execute(trx)).rows;
      let totDebPis = 0;
      let totDebCofins = 0;
      for (const g of nfce) {
        const base = r2(Number(g.vl) - Number(g.icms));
        const aPis = Number(g.aliq_pis_sai) || 0;
        const aCof = Number(g.aliq_cofins_sai) || 0;
        const vPis = r2((base * aPis) / 100);
        const vCof = r2((base * aCof) / 100);
        await linha({
          tipo: 'D', apuracao: 'DEBITO', tipo_origem: 'NFC-e', id_tipocredito: g.id_tipocredito != null ? Number(g.id_tipocredito) : null, id_basecredito: 0,
          descricaobase: null, idpiscofins: Number(g.idpiscofins), descricaopc: g.descricaopc ?? null,
          cst_pis: g.cst_pis_sai != null ? Number(g.cst_pis_sai) : null, cst_cofins: g.cst_cofins_sai != null ? Number(g.cst_cofins_sai) : null,
          basecalculo: base, aliqpis: aPis, valorpis: vPis, aliqcofins: aCof, valorcofins: vCof,
          basecalculoapura: base, valorpisapura: vPis, valorcofinsapura: vCof,
        });
        totDebPis += vPis;
        totDebCofins += vCof;
      }

      // ── DÉBITO / SAIDA NF — o ramo que o recon não reproduziu (dossiê §4, "Não determinado" 5). Do fonte: NF de saída processada, fora
      // dos CFOPs de devolução ao fornecedor (5202/6202/5411/6411) e de cupom (5929/6929/5927), ID_BASECREDITO 1 e a descrição fixa; a
      // base líquida do ICMS do item tributado (a regra de 2025+). Agrupa por situação e alíquotas de saída do catálogo.
      const saidaNf = (await sql<Record<string, unknown>>`
        SELECT cpc.id_tipocredito, cpc.idpiscofins, cpc.descricao AS descricaopc, cpc.aliq_pis_sai, cpc.aliq_cofins_sai, cpc.cst_pis_sai, cpc.cst_cofins_sai,
               sum(x.b) AS bruta, sum(x.icm) AS icm
          FROM (
            SELECT coalesce(np.idpiscofins, p.idpiscofins) AS sit,
                   CAST((np.vrcusto * np.quantidade) - coalesce(np.vrdescprod, 0) AS numeric(15,2)) AS b,
                   CASE WHEN substr(coalesce(np.aliquota, ''), 1, 1) = 'T' THEN coalesce(np.vricm, 0) ELSE 0 END AS icm
              FROM nf_prod np JOIN nf n ON n.codnf = np.codnf LEFT JOIN produtos p ON p.idproduto = np.codproduto
             WHERE n.tipo = 'S' AND n.dtcontabil::date BETWEEN ${dtini}::date AND ${dtfim}::date AND n.idempresa = ANY(${empresas}::int[])
               AND coalesce(n.proc, 'N') = 'S' AND coalesce(n.cancelada, 'N') = 'N' AND coalesce(n.statusnfe, '') <> 'C'
               AND n.nronf IS NOT NULL AND n.nronf <> '0'
               AND NOT (np.cfop = ANY(ARRAY['5202','6202','5411','6411','5929','6929','5927']))
          ) x
          JOIN piscofins cpc ON cpc.idpiscofins = x.sit
         WHERE cpc.aliq_pis_sai > 0
         GROUP BY cpc.id_tipocredito, cpc.idpiscofins, cpc.descricao, cpc.aliq_pis_sai, cpc.aliq_cofins_sai, cpc.cst_pis_sai, cpc.cst_cofins_sai
         ORDER BY 1, 2`.execute(trx)).rows;
      for (const g of saidaNf) {
        const base = r2(Number(g.bruta) - Number(g.icm));
        const aPis = Number(g.aliq_pis_sai) || 0;
        const aCof = Number(g.aliq_cofins_sai) || 0;
        const vPis = r2((base * aPis) / 100);
        const vCof = r2((base * aCof) / 100);
        await linha({
          tipo: 'D', apuracao: 'DEBITO', tipo_origem: 'SAIDA NF', id_tipocredito: g.id_tipocredito != null ? Number(g.id_tipocredito) : null, id_basecredito: 1,
          descricaobase: 'AQUISICAO DE BENS PARA REVENDA', idpiscofins: Number(g.idpiscofins), descricaopc: g.descricaopc ?? null,
          cst_pis: g.cst_pis_sai != null ? Number(g.cst_pis_sai) : null, cst_cofins: g.cst_cofins_sai != null ? Number(g.cst_cofins_sai) : null,
          basecalculo: base, aliqpis: aPis, valorpis: vPis, aliqcofins: aCof, valorcofins: vCof,
          basecalculoapura: base, valorpisapura: vPis, valorcofinsapura: vCof,
        });
        totDebPis += vPis;
        totDebCofins += vCof;
      }
      const grupos = creditos;
      const gruposDeb = nfce;
      const gruposDebNf = saidaNf;

      // RECEITA NÃO-TRIBUTADA (isenta/alíquota-zero/monofásica → M400/M410 PIS + M800/M810). Fiel a sqqBaseIsenta:
      // a receita de SAÍDA SEM débito de PIS E de COFINS (complemento do filtro do débito), agrupada por (CST_PIS,
      // CST_COFINS, NATUREZA). Base = VL_OPR ≈ qtd×vrvenda − descontos (corte-1b fiel: falta o IAT/acréscimo e o
      // abatimento de ICMS por GET_CONFIG_ABATER_ICMS_PC — mesmo diferimento do débito). Fonte VENDAS/NFC-e.
      // CST normalizado p/ 2 dígitos com lpad (fold auditoria corte-2 [ALTA]: o Oracle guarda '6 '/'4 ' — 1 dígito
      // blank-padded; sem o lpad o domínio {04..09} nunca casa e a receita não-tributada ZERA em silêncio no cutover).
      //
      // NATUREZA (corte-2, fiel ao CASE do sqqBaseIsenta em UdmSpedPisCofins.dfm): candidata = PC_TIPOCREDITOISENTO
      // via PRODUTOS.IDTABELA; se nula OU fora do rol de naturezas da situação DO PRODUTO (P.IDPISCOFINS) → fallback
      // p/ a 1ª natureza da situação EFETIVA COALESCE(V.IDPISCOFINS, P.IDPISCOFINS) — a assimetria (validação por P,
      // fallback por V→P) é do legado, preservada. O ROWNUM=1 do Oracle não tem ORDER BY (linha ARBITRÁRIA); aqui
      // determinizamos por MIN(idtabela), o proxy da ordem de inserção que o Oracle tende a devolver em heap.
      // Nulo + CST_PIS '08' → 999, carimbado NA APURAÇÃO como no SELECT externo do legado.
      //
      // DIFERIMENTOS documentados (auditoria de paridade corte-2, não-fold):
      //  · CST da VENDA (snapshot do PDV) vs CATÁLOGO: o legado deriva o CST de PISCOFINS.CST_PIS_SAI via
      //    COALESCE(V.IDPISCOFINS, P.IDPISCOFINS) avaliado NA GERAÇÃO (cadastro atual); aqui usamos o snapshot
      //    pis_cst/cofins_cst da venda (decisão do corte-1, certificada) com default NULL→'06' — corte-3.
      //  · Elegibilidade: legado aceita contingência (GET_CONFIG_NFCE_CONTIGENCIA) e STATUSNFE='C' e NÃO filtra
      //    por alíquota; aqui statusnfe='P' + alíq PIS=0 E COFINS=0 (mesmo diferimento documentado do débito).
      //  · Escopo: legado agrega estabelecimentos por SUBSTR(CNPJ,1,10); aqui por idempresa (decisão de
      //    arquitetura do novo, consistente com débito/crédito — arquivo por empresa).
      const gruposIsentos = (await sql<{ cstpis: string; cstcofins: string; natureza: unknown; base: unknown }>`
        SELECT cstpis, cstcofins,
               CASE WHEN natureza IS NULL AND cstpis = '08' THEN 999 ELSE natureza END AS natureza,
               round(sum(vl), 2) AS base
        FROM (
          SELECT coalesce(lpad(nullif(trim(v.pis_cst),''),2,'0'),'06')    AS cstpis,
                 coalesce(lpad(nullif(trim(v.cofins_cst),''),2,'0'),'06') AS cstcofins,
                 CASE
                   WHEN i.idbasecreditoisento IS NULL
                     OR i.idbasecreditoisento NOT IN (
                          SELECT o.idbasecreditoisento FROM pc_tipocreditoisento o
                          WHERE o.idpiscofins = p.idpiscofins)
                   THEN (SELECT o2.idbasecreditoisento FROM pc_tipocreditoisento o2
                         WHERE o2.idpiscofins = coalesce(v.idpiscofins, p.idpiscofins)
                         ORDER BY o2.idtabela LIMIT 1)
                   ELSE i.idbasecreditoisento
                 END AS natureza,
                 (v.qtde * v.vrvenda - coalesce(v.desc_promocao,0) - coalesce(v.desc_departamento,0)) AS vl
          FROM vendas v
          LEFT JOIN produtos p ON p.idproduto = v.codproduto
          LEFT JOIN pc_tipocreditoisento i ON i.idtabela = p.idtabela
          WHERE v.idempresa = ANY(${empresas}::int[])
            AND coalesce(v.venda_nfc,'N') = 'S'
            AND coalesce(v.cancelado,'N') <> 'S'
            AND coalesce(v.statusnfe,'') = 'P'
            AND v.chavenfe IS NOT NULL
            AND v.dtvenda >= ${d0} AND v.dtvenda < ${d1}
            AND coalesce(v.pis_aliquota,0) = 0    -- sem débito de PIS
            AND coalesce(v.cofins_aliquota,0) = 0 -- e sem débito de COFINS
            -- ao menos um CST no domínio da receita não-tributada {04..09} (fold auditoria [ALTA]): descarta linha
            -- "suja" (CST tributado 01/49/50 rungado com alíq 0) que faria o PVA rejeitar o M400/M800.
            AND (coalesce(lpad(nullif(trim(v.pis_cst),''),2,'0'),'06')    IN ('04','05','06','07','08','09')
              OR coalesce(lpad(nullif(trim(v.cofins_cst),''),2,'0'),'06') IN ('04','05','06','07','08','09'))
        ) ven
        GROUP BY cstpis, cstcofins, natureza
      `.execute(trx)).rows as Array<{ cstpis: string; cstcofins: string; natureza: unknown; base: unknown }>;

      // perna NF mod-55 da sqqBaseIsenta (/*NF*/, fold auditoria de paridade corte-2 [MÉDIA] — simétrica com o
      // débito mod-55 que já entra): TODA linha de NF de SAÍDA elegível entra no dataset, com CST DERIVADO do
      // CFOP — 5927/5929 → 8; rol fixo (5202,6202,5411,6411,5102,6102,5403,6403) OU PC_CONFIG → CST_PIS_SAI do
      // catálogo PISCOFINS (situação efetiva COALESCE(NP.IDPISCOFINS, P.IDPISCOFINS)); senão → 8. Linha tributada
      // (CST 1 do catálogo) fica no dataset e cai fora na bucketização do gerador (como GetTotaisCSTM400). Base =
      // VRCUSTO×QTD da linha em NUMERIC(13,2) — é este ramo que alimenta o CST 08/999 real do legado. Elegibilidade
      // (subquery T): TIPO='S', PROC='S', CANCELADA='N', NRONF válido, MODELO NOT IN (22,21,6,2,57,7,8,3),
      // DTCONTABIL no período. ckbGera5929 default DESMARCADO → CFOP 5929/6929 fora (NF cupom-vinculada já veio de
      // VENDAS; a opção da tela não migra). ADIADO (fiel-conservador, como no débito): abatimento de ICMS na base
      // (GET_CONFIG_ABATER_ICMS_PC). Natureza: mesmo CASE, chaveado por NP.IDPISCOFINS.
      const gruposIsentosNf = (await sql<{ cst: unknown; natureza: unknown; base: unknown }>`
        SELECT cst,
               CASE WHEN natureza IS NULL AND cst = 8 THEN 999 ELSE natureza END AS natureza,
               round(sum(vl), 2) AS base
        FROM (
          SELECT CASE
                   WHEN np.cfop IN ('5927','5929') THEN 8
                   ELSE CASE
                     WHEN np.cfop IN ('5202','6202','5411','6411','5102','6102','5403','6403')
                       OR np.cfop IN (SELECT x.cfop FROM pc_config x)
                     THEN cpc.cst_pis_sai
                     ELSE 8
                   END
                 END AS cst,
                 CASE
                   WHEN i.idbasecreditoisento IS NULL
                     OR i.idbasecreditoisento NOT IN (
                          SELECT o.idbasecreditoisento FROM pc_tipocreditoisento o
                          WHERE o.idpiscofins = p.idpiscofins)
                   THEN (SELECT o2.idbasecreditoisento FROM pc_tipocreditoisento o2
                         WHERE o2.idpiscofins = coalesce(np.idpiscofins, p.idpiscofins)
                         ORDER BY o2.idtabela LIMIT 1)
                   ELSE i.idbasecreditoisento
                 END AS natureza,
                 cast(np.vrcusto * np.quantidade as numeric(13,2)) AS vl
          FROM nf_prod np
          LEFT JOIN produtos p ON p.idproduto = np.codproduto
          LEFT JOIN piscofins cpc ON cpc.idpiscofins = coalesce(np.idpiscofins, p.idpiscofins)
          LEFT JOIN pc_tipocreditoisento i ON i.idtabela = p.idtabela
          JOIN (
            SELECT n2.codnf
            FROM nf n2
            LEFT JOIN nf_prod np2 ON np2.codnf = n2.codnf
            WHERE n2.idempresa = ANY(${empresas}::int[])
              AND n2.tipo = 'S'
              AND coalesce(n2.proc,'N') = 'S'
              AND coalesce(n2.cancelada,'N') = 'N'
              AND n2.nronf IS NOT NULL AND n2.nronf NOT IN ('0','000000')
              AND n2.modelo NOT IN (22,21,6,2,57,7,8,3)
              AND n2.dtcontabil >= ${dtini} AND n2.dtcontabil <= ${dtfim}
              AND np2.cfop NOT IN ('5929','6929')
            GROUP BY n2.codnf
          ) t ON t.codnf = np.codnf
        ) ven
        GROUP BY cst, natureza
      `.execute(trx)).rows as Array<{ cst: unknown; natureza: unknown; base: unknown }>;

      // grava as DUAS pernas como detI (o gerador re-agrega por natureza — equivale ao GROUP BY externo do legado
      // que mescla as pernas do UNION). Fold auditoria corte-2 [MÉDIA]: grupo com base 0/negativa TAMBÉM entra —
      // o legado só descarta no gerador quando o TOTAL do CST é zero EXATO (GeraRegistroM400: if pTotalCST=0 exit)
      // e emite as linhas do dataset como estão. A MÉTRICA total_receita_nao_tributada segue GetTotaisCSTM400:
      // só CST 4/6/8/9 somam (a perna NF carrega linha CST 1 no dataset, que não vira M400 — não conta aqui).
      const M400_CSTS = new Set([4, 6, 8, 9]);
      let totIsento = 0;
      for (const g of gruposIsentos) {
        const base = Number(g.base) || 0;
        await trx
          .insertInto('apuracao_pc_det')
          .values({
            codapuracao_pc,
            tipo: 'I',
            id_tipocredito: null,
            id_basecredito: null,
            idpiscofins: null,
            // fold auditoria [BAIXA]: CST não-numérico ('AA') → null (senão Number()=NaN estoura o INSERT no integer);
            // o generator filtra o domínio {04..09}, então CST-null é inócuo (nunca vira M400/M800).
            cst_pis: Number.isFinite(Number(g.cstpis)) ? Number(g.cstpis) : null,
            cst_cofins: Number.isFinite(Number(g.cstcofins)) ? Number(g.cstcofins) : null,
            id_basecreditoisento: g.natureza != null ? Number(g.natureza) : null,
            basecalculo: base,
            aliqpis: 0,
            valorpis: 0,
            aliqcofins: 0,
            valorcofins: 0,
          })
          .execute();
        if (M400_CSTS.has(Number(g.cstpis))) totIsento += base;
      }
      for (const g of gruposIsentosNf) {
        const base = Number(g.base) || 0;
        const cstNf = g.cst != null && Number.isFinite(Number(g.cst)) ? Number(g.cst) : null;
        await trx
          .insertInto('apuracao_pc_det')
          .values({
            codapuracao_pc,
            tipo: 'I',
            id_tipocredito: null,
            id_basecredito: null,
            idpiscofins: null,
            // o dataset do legado só tem CST_PIS_SAI (o COFINS espelha o PIS na emissão) — replica nos dois.
            cst_pis: cstNf,
            cst_cofins: cstNf,
            id_basecreditoisento: g.natureza != null ? Number(g.natureza) : null,
            basecalculo: base,
            aliqpis: 0,
            valorpis: 0,
            aliqcofins: 0,
            valorcofins: 0,
          })
          .execute();
        if (cstNf != null && M400_CSTS.has(cstNf)) totIsento += base;
      }

      return {
        codapuracao_pc,
        grupos: grupos.length,
        total_credito_pis: r2(totPis),
        total_credito_cofins: r2(totCofins),
        grupos_debito: gruposDeb.length + gruposDebNf.length,
        total_debito_pis: r2(totDebPis),
        total_debito_cofins: r2(totDebCofins),
        grupos_isento: gruposIsentos.length + gruposIsentosNf.length,
        total_receita_nao_tributada: r2(totIsento),
      };
    });
  }
}
