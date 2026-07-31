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
      // CST_COFINS). Base = VL_OPR ≈ qtd×vrvenda − descontos (corte-1b fiel: falta o IAT/acréscimo e o abatimento de
      // ICMS por GET_CONFIG_ABATER_ICMS_PC — mesmo diferimento do débito). Fonte VENDAS/NFC-e (mod-55 não-tributada
      // = corte-1b, como a BaseIsenta do legado é NFC-e). Grava tipo='I' (o generator emite M400 por CST_PIS, M800
      // por CST_COFINS). Materialmente relevante p/ supermercado (cesta básica CST 06, monofásico CST 04).
      const gruposIsentos = (await trx
        .selectFrom('vendas')
        .select([
          sql`coalesce(nullif(trim(pis_cst),''),'06')`.as('cstpis'),
          sql`coalesce(nullif(trim(cofins_cst),''),'06')`.as('cstcofins'),
          sql`round(coalesce(sum(qtde * vrvenda - coalesce(desc_promocao,0) - coalesce(desc_departamento,0)),0),2)`.as('base'),
        ])
        .where('idempresa', '=', emp)
        .where(sql`coalesce(venda_nfc,'N')`, '=', 'S')
        .where(sql`coalesce(cancelado,'N')`, '<>', 'S')
        .where(sql`coalesce(statusnfe,'')`, '=', 'P')
        .where('chavenfe', 'is not', null)
        .where(sql`dtvenda`, '>=', d0)
        .where(sql`dtvenda`, '<', d1)
        .where(sql`coalesce(pis_aliquota,0)`, '=', 0) // sem débito de PIS
        .where(sql`coalesce(cofins_aliquota,0)`, '=', 0) // e sem débito de COFINS
        // ao menos um CST no domínio da receita não-tributada {04..09} (fold auditoria [ALTA]): descarta linha "suja"
        // (CST tributado 01/49/50 rungado com alíq 0) que não é receita isenta e faria o PVA rejeitar o M400/M800.
        .where((eb) =>
          eb.or([
            eb(sql`coalesce(nullif(trim(pis_cst),''),'06')`, 'in', ['04', '05', '06', '07', '08', '09']),
            eb(sql`coalesce(nullif(trim(cofins_cst),''),'06')`, 'in', ['04', '05', '06', '07', '08', '09']),
          ]),
        )
        .groupBy([sql`coalesce(nullif(trim(pis_cst),''),'06')`, sql`coalesce(nullif(trim(cofins_cst),''),'06')`])
        .execute()) as Array<{ cstpis: string; cstcofins: string; base: unknown }>;

      let totIsento = 0;
      for (const g of gruposIsentos) {
        const base = Number(g.base) || 0;
        if (base <= 0) continue; // só receita positiva (fiel: GeraRegistroM400 sai se pTotalCST=0)
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
            basecalculo: base,
            aliqpis: 0,
            valorpis: 0,
            aliqcofins: 0,
            valorcofins: 0,
          })
          .execute();
        totIsento += base;
      }

      return {
        codapuracao_pc,
        grupos: grupos.length,
        total_credito_pis: r2(totPis),
        total_credito_cofins: r2(totCofins),
        grupos_debito: gruposDeb.length + gruposDebNf.length,
        total_debito_pis: r2(totDebPis),
        total_debito_cofins: r2(totDebCofins),
        grupos_isento: gruposIsentos.filter((g) => (Number(g.base) || 0) > 0).length,
        total_receita_nao_tributada: r2(totIsento),
      };
    });
  }
}
