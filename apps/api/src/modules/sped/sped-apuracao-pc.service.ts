import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * APURAÇÃO PIS/COFINS (EFD-Contribuições bloco M). CRÉDITO de ENTRADA (corte-2a): NFs de entrada migrados
 * (nf_prod.bcpiscofinse/vrpise/vrcofinse), agrupado por (CST, alíquota) → apuracao_pc_det TIPO='C'. DÉBITO de
 * SAÍDA (corte-1 do PDV): itens de VENDAS (NFC-e) do período → apuracao_pc_det TIPO='D'. A consolidação
 * (M200/M600, valor a recolher = débito − crédito) sai no bloco M do SPED. Idempotente por período (delete-then-
 * insert). COD_CRED/NAT_BC_CRED usam defaults ('101'/1) — a classificação completa do crédito é refino.
 */
@Injectable()
export class SpedApuracaoPcService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async apurar(dtini: string, dtfim: string): Promise<{ codapuracao_pc: number; grupos: number; total_credito_pis: number; total_credito_cofins: number; grupos_debito: number; total_debito_pis: number; total_debito_cofins: number; grupos_isento: number; total_receita_nao_tributada: number }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      // idempotente: remove a apuração anterior do mesmo período (cascade no detalhe).
      await trx.deleteFrom('apuracao_pc').where('idempresa', '=', emp).where('dataini', '=', dtini).where('datafim', '=', dtfim).execute();
      const cab = (await trx
        .insertInto('apuracao_pc')
        .values({ idempresa: emp, dataini: dtini, datafim: dtfim, codoperador: op })
        .returning('codapuracao_pc')
        .executeTakeFirstOrThrow()) as { codapuracao_pc: number };
      const codapuracao_pc = Number(cab.codapuracao_pc);

      // CRÉDITO de entrada agregado por (CST, alíquota PIS/COFINS) a partir dos itens dos NFs de entrada do período
      // (processados, não cancelados). Base/valor = os já valorados do import do XML (mig 089). Só linhas com crédito.
      const grupos = (await trx
        .selectFrom('nf_prod as np')
        .innerJoin('nf as n', 'n.codnf', 'np.codnf')
        .select([
          // fold auditoria [BAIXA]: CST nulo → default '50' (crédito básico) — o M105 exige CST_PIS preenchido.
          sql`coalesce(nullif(trim(np.cstpiscofins),''),'50')`.as('cst'),
          sql`coalesce(np.aliqpise,0)`.as('aliqpis'),
          sql`coalesce(np.aliqcofinse,0)`.as('aliqcofins'),
          sql`round(coalesce(sum(np.bcpiscofinse),0),2)`.as('basecalculo'),
          sql`round(coalesce(sum(np.vrpise),0),2)`.as('valorpis'),
          sql`round(coalesce(sum(np.vrcofinse),0),2)`.as('valorcofins'),
        ])
        .where('n.idempresa', '=', emp)
        .where('n.tipo', '=', 'E')
        .where(sql`coalesce(n.proc,'N')`, '=', 'S')
        .where(sql`coalesce(n.cancelada,'N')`, '<>', 'S')
        .where(sql`coalesce(n.statusnfe,'')`, '<>', 'C')
        .where(sql`n.dtcontabil`, '>=', dtini)
        .where(sql`n.dtcontabil`, '<=', dtfim)
        .where((eb) => eb.or([eb('np.vrpise', '>', 0), eb('np.vrcofinse', '>', 0)]))
        .groupBy([sql`coalesce(nullif(trim(np.cstpiscofins),''),'50')`, sql`coalesce(np.aliqpise,0)`, sql`coalesce(np.aliqcofinse,0)`])
        .execute()) as Array<{ cst: number | null; aliqpis: unknown; aliqcofins: unknown; basecalculo: unknown; valorpis: unknown; valorcofins: unknown }>;

      let totPis = 0;
      let totCofins = 0;
      for (const g of grupos) {
        await trx
          .insertInto('apuracao_pc_det')
          .values({
            codapuracao_pc,
            tipo: 'C',
            id_tipocredito: '101',
            id_basecredito: 1,
            idpiscofins: null,
            cst_pis: g.cst != null ? Number(g.cst) : null,
            basecalculo: Number(g.basecalculo) || 0,
            aliqpis: Number(g.aliqpis) || 0,
            valorpis: Number(g.valorpis) || 0,
            aliqcofins: Number(g.aliqcofins) || 0,
            valorcofins: Number(g.valorcofins) || 0,
          })
          .execute();
        totPis += Number(g.valorpis) || 0;
        totCofins += Number(g.valorcofins) || 0;
      }

      // DÉBITO de SAÍDA (corte-1 do PDV): itens de VENDAS (NFC-e) do período, agrupados por (CST_PIS, alíq PIS,
      // alíq COFINS). Base = Σ pis_bcalculo já computado no PDV; valor RE-DERIVADO no grupo round(Σbase×alíq/100,2)
      // (fiel ao APURACAO_PC_DET do legado: RoundTo(BASECALCULO*ALIQ/100,-2) por CST/alíq). Elegibilidade fiel-
      // conservadora: NFC-e autorizada (venda_nfc='S', statusnfe='P', chavenfe não-nulo), item não cancelado, tributado.
      // ADIADO corte-1b: (a) base = VL_OPR reconstruído (IAT/descontos/abatimento-ICMS por GET_CONFIG_ABATER_ICMS_PC)
      // em vez de pis_bcalculo puro; (b) NFC-e em CONTINGÊNCIA (statusnfe='G') também é devida (hoje só 'P' — pode
      // subcontar em período com contingência). 'C' (cancelada) fica de fora (fiel ao legado).
      const d0 = String(dtini).slice(0, 10);
      const dfimNext = new Date(`${String(dtfim).slice(0, 10)}T00:00:00Z`);
      dfimNext.setUTCDate(dfimNext.getUTCDate() + 1);
      const d1 = dfimNext.toISOString().slice(0, 10); // limite superior EXCLUSIVO = dia seguinte a dtfim
      const gruposDeb = (await trx
        .selectFrom('vendas')
        .select([
          sql`coalesce(nullif(trim(pis_cst),''),'01')`.as('cst'),
          sql`coalesce(pis_aliquota,0)`.as('aliqpis'),
          sql`coalesce(cofins_aliquota,0)`.as('aliqcofins'),
          sql`round(coalesce(sum(pis_bcalculo),0),2)`.as('basecalculo'),
        ])
        .where('idempresa', '=', emp)
        .where(sql`coalesce(venda_nfc,'N')`, '=', 'S')
        .where(sql`coalesce(cancelado,'N')`, '<>', 'S')
        .where(sql`coalesce(statusnfe,'')`, '=', 'P')
        .where('chavenfe', 'is not', null)
        // intervalo SEMIABERTO por DATA [d0, d1) — cobre o dia inteiro (sem perder 23:59:59.x) e tolera input com hora.
        .where(sql`dtvenda`, '>=', d0)
        .where(sql`dtvenda`, '<', d1)
        .where((eb) => eb.or([eb('pis_aliquota', '>', 0), eb('cofins_aliquota', '>', 0)]))
        .groupBy([sql`coalesce(nullif(trim(pis_cst),''),'01')`, sql`coalesce(pis_aliquota,0)`, sql`coalesce(cofins_aliquota,0)`])
        .execute()) as Array<{ cst: unknown; aliqpis: unknown; aliqcofins: unknown; basecalculo: unknown }>;

      let totDebPis = 0;
      let totDebCofins = 0;
      const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
      for (const g of gruposDeb) {
        const base = Number(g.basecalculo) || 0;
        const aPis = Number(g.aliqpis) || 0;
        const aCof = Number(g.aliqcofins) || 0;
        const vPis = r2((base * aPis) / 100);
        const vCof = r2((base * aCof) / 100);
        await trx
          .insertInto('apuracao_pc_det')
          .values({
            codapuracao_pc,
            tipo: 'D',
            id_tipocredito: null,
            id_basecredito: null,
            idpiscofins: null,
            cst_pis: g.cst != null ? Number(g.cst) : null,
            basecalculo: base,
            aliqpis: aPis,
            valorpis: vPis,
            aliqcofins: aCof,
            valorcofins: vCof,
          })
          .execute();
        totDebPis += vPis;
        totDebCofins += vCof;
      }

      // DÉBITO de SAÍDA por NF-e mod-55 (SAÍDA-NF-mod55): itens das NFs tipo='S' processadas do período. A saída
      // não grava base/valor de PIS/COFINS (só as alíquotas aliqpiss/aliqcofinss) → base = Σ(qtd×vrvenda − desconto)
      // e valor = round(base×alíq/100,2), mesma mecânica do débito de VENDAS. Agrupa por (CST, alíq PIS, alíq COFINS)
      // e alimenta o M200/M600 JUNTO com o PDV. ADIADO (fiel-conservador): abatimento de ICMS na base (GET_CONFIG_
      // ABATER_ICMS_PC) e descontos rateados — o corte usa a base bruta de venda.
      const gruposDebNf = (await trx
        .selectFrom('nf_prod as np')
        .innerJoin('nf as n', 'n.codnf', 'np.codnf')
        .select([
          sql`coalesce(nullif(trim(np.cstpiscofins),''),'01')`.as('cst'),
          sql`coalesce(np.aliqpiss,0)`.as('aliqpis'),
          sql`coalesce(np.aliqcofinss,0)`.as('aliqcofins'),
          sql`round(coalesce(sum(np.quantidade*np.vrvenda - coalesce(np.desconto,0)),0),2)`.as('basecalculo'),
        ])
        .where('n.idempresa', '=', emp)
        .where('n.tipo', '=', 'S')
        .where('n.modelo', '=', 55) // só mod-55; NFC-e mod-65 (PDV) já vem de `vendas` (evita double-count)
        .where(sql`coalesce(n.proc,'N')`, '=', 'S')
        .where(sql`coalesce(n.cancelada,'N')`, '<>', 'S')
        .where(sql`coalesce(n.statusnfe,'')`, '<>', 'C')
        .where(sql`n.dtcontabil`, '>=', dtini)
        .where(sql`n.dtcontabil`, '<=', dtfim)
        .where((eb) => eb.or([eb('np.aliqpiss', '>', 0), eb('np.aliqcofinss', '>', 0)]))
        .groupBy([sql`coalesce(nullif(trim(np.cstpiscofins),''),'01')`, sql`coalesce(np.aliqpiss,0)`, sql`coalesce(np.aliqcofinss,0)`])
        .execute()) as Array<{ cst: unknown; aliqpis: unknown; aliqcofins: unknown; basecalculo: unknown }>;
      for (const g of gruposDebNf) {
        const base = Number(g.basecalculo) || 0;
        const aPis = Number(g.aliqpis) || 0;
        const aCof = Number(g.aliqcofins) || 0;
        const vPis = r2((base * aPis) / 100);
        const vCof = r2((base * aCof) / 100);
        await trx
          .insertInto('apuracao_pc_det')
          .values({ codapuracao_pc, tipo: 'D', id_tipocredito: null, id_basecredito: null, idpiscofins: null, cst_pis: g.cst != null ? Number(g.cst) : null, basecalculo: base, aliqpis: aPis, valorpis: vPis, aliqcofins: aCof, valorcofins: vCof })
          .execute();
        totDebPis += vPis;
        totDebCofins += vCof;
      }

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
          WHERE v.idempresa = ${emp}
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
            WHERE n2.idempresa = ${emp}
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
