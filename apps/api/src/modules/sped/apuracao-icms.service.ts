import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ApuracaoIcmsProcessarDto, ApuracaoIcmsObterDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * APURAÇÃO DE ICMS — o processo do livro de Registro de Entradas e Saídas (`uRelRegistros_ES.pas` 3.047 linhas +
 * `uDMRelRegistros_ES.pas`), que **produz** a `APURACAO_ICMS` que o SPED (E110) consome. Dossiê:
 * `docs/04-screen-dossier/dossiers/retaguarda/uRelRegistros_ES-apuracao-icms.md`.
 *
 * TRÊS PERNAS, porque é o que o dado exige (golden): **NFC-e de saída** carrega 99,8% do detalhe
 * (1.139.084 linhas, Σ ICMS 443.501,98) contra NF de saída (2.249 / 28.604,65) e NF de entrada (14.560 /
 * 230.401,27). Sem a perna do cupom o débito de saída sairia ~94% menor — errado, não parcial.
 *
 * Os cinco filtros das notas são regra (uRelRegistros_ES.pas:1915-1935): data **CONTÁBIL** (não a de emissão),
 * `PROC='S'`, `CANCELADA='N'`, denegada (`STATUSNFE='D'`) fora e NFe sem chave ou inutilizada (`'I'`) fora — mais o
 * gate `COALESCE(CFOP.NAO_GERA_APURACAO_ICMS,'N')='N'`.
 *
 * O cabeçalho é o E110 (uDMRelRegistros_ES.pas:762-794 + os agregados do `.dfm`):
 *   TOTALCREDITO = saldoant + creditoentrada + outroscreditos + estornodebitos
 *   TOTALDEBITO  = debitosaida + outrosdebitos + estornocreditos
 *   (débito − crédito) < 0 → saldocredorseguinte = |dif| ; senão saldodevedor = |dif|
 *   arecolher = saldodevedor − deducoes
 * e `SALDOANT` é o **saldo credor da apuração do MÊS ANTERIOR** (busca por mês FECHADO — reprocessar um mês antigo
 * NÃO recalcula os seguintes, fiel ao legado).
 */
@Injectable()
export class ApuracaoIcmsService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** o gate de CFOP das três consultas — CFOP marcado fica fora da apuração. */
  private cfopEntra(alias: string) {
    return sql<boolean>`exists (select 1 from cfop c where c.codcfop = lpad(${sql.ref(alias)}::text, 4, '0')
                                 and coalesce(c.nao_gera_apuracao_icms, 'N') = 'N')`;
  }

  /**
   * O detalhe das NOTAS (entrada ou saída), por documento × CST. `CODIGO = CODNF||'NF'` e `ESPECIE='NF'`, como no
   * legado. `BASE`/`VALOR_ICMS` somam o item; `ISENTAS_NAOTRIB` e `OUTRAS` saem do que não tem base tributada
   * (CST 40/41/50 = isenta/não-tributada/suspensão · o resto sem base = outras), a mesma separação do livro.
   */
  private async detalheNotas(trx: AnyDB, emp: number, tipo: 'E' | 'S', dataini: string, datafin: string, cod: number) {
    return trx
      .insertInto('apuracao_icms_detalhes')
      .columns(['codapuracaoicms', 'tipo', 'especie', 'codigo', 'cfop', 'cst', 'base', 'valor_icms',
                'isentas_naotrib', 'outras', 'totalnf', 'icms', 'classfiscal'])
      .expression((eb: any) =>
        eb
          .selectFrom('nf as n')
          .innerJoin('nf_prod as i', 'i.codnf', 'n.codnf')
          .leftJoin('parceiros as p', 'p.codparceiro', 'n.codparceiro')
          .select([
            sql`${cod}`.as('codapuracaoicms'),
            sql`${tipo}`.as('tipo'),
            sql`'NF'`.as('especie'),
            sql`n.codnf::text || 'NF'`.as('codigo'),
            sql`nullif(i.cfop,'')::int`.as('cfop'),
            sql`i.cst`.as('cst'),
            sql`sum(case when coalesce(i.cst,0) not in (40,41,50) then coalesce(i.vrbasecalculo,0) else 0 end)`.as('base'),
            sql`sum(coalesce(i.vricm,0))`.as('valor_icms'),
            sql`sum(case when coalesce(i.cst,0) in (40,41,50) then coalesce(i.vrbasecalculo,0) + coalesce(i.quantidade,0) * coalesce(i.vrvenda,0) - coalesce(i.vrbasecalculo,0) else 0 end)`.as('isentas_naotrib'),
            sql`sum(case when coalesce(i.cst,0) not in (40,41,50) and coalesce(i.vrbasecalculo,0) = 0 then coalesce(i.quantidade,0) * coalesce(i.vrvenda,0) else 0 end)`.as('outras'),
            sql`max(coalesce(n.totalnf,0))`.as('totalnf'),
            sql`max(coalesce(i.icms,0))`.as('icms'),
            sql`max(p.classfiscal)`.as('classfiscal'),
          ])
          .where('n.idempresa', '=', emp)
          .where('n.tipo', '=', tipo)
          // a data é a CONTÁBIL
          .where(sql`n.dtcontabil`, '>=', dataini)
          .where(sql`n.dtcontabil`, '<=', datafin)
          .where(sql`coalesce(n.proc,'N')`, '=', 'S')
          .where(sql`coalesce(n.cancelada,'N')`, '=', 'N')
          .where(sql`coalesce(n.nronf,'0')`, '<>', '0')
          .where(sql<boolean>`coalesce(n.statusnfe,'X') <> 'D'`) // denegada fora
          // NFe (mod 55) só com chave e não inutilizada; outros modelos entram sem essa exigência
          .where(sql<boolean>`(n.modelo <> 55 or (n.chavenfe is not null and coalesce(n.statusnfe,'P') <> 'I'))`)
          .where(this.cfopEntra('i.cfop'))
          .groupBy(['n.codnf', 'i.cfop', 'i.cst']),
      )
      .executeTakeFirst();
  }

  /**
   * O detalhe dos CUPONS (NFC-e de saída) — a perna que carrega 99,8% do detalhe. Grão: documento (`nropedido`) ×
   * CST, com `CODIGO = <nropedido>||'NFC'` e `ESPECIE='NFC'`, espelhando o `CODNF||'NF'` das notas. Item cancelado
   * e cupom cancelado ficam fora (é venda que não existe fiscalmente).
   */
  private async detalheCupons(trx: AnyDB, emp: number, dataini: string, datafin: string, cod: number) {
    return trx
      .insertInto('apuracao_icms_detalhes')
      .columns(['codapuracaoicms', 'tipo', 'especie', 'codigo', 'cfop', 'cst', 'base', 'valor_icms',
                'isentas_naotrib', 'outras', 'totalnf', 'icms'])
      .expression((eb: any) =>
        eb
          .selectFrom('vendas as v')
          .select([
            sql`${cod}`.as('codapuracaoicms'),
            sql`'S'`.as('tipo'),
            sql`'NFC'`.as('especie'),
            sql`v.nropedido || 'NFC'`.as('codigo'),
            sql`v.cfop`.as('cfop'),
            sql`nullif(v.icms_cst,'')::int`.as('cst'),
            // no cupom a base tributada é o próprio valor do item quando há ICMS destacado
            sql`sum(case when coalesce(v.icms_valor,0) <> 0 then coalesce(v.qtde,0) * coalesce(v.vrvenda,0) else 0 end)`.as('base'),
            sql`sum(coalesce(v.icms_valor,0))`.as('valor_icms'),
            sql`sum(case when coalesce(v.icms_valor,0) = 0 and coalesce(v.aliquota,'') in ('IST','ISE','NT') then coalesce(v.qtde,0) * coalesce(v.vrvenda,0) else 0 end)`.as('isentas_naotrib'),
            sql`sum(case when coalesce(v.icms_valor,0) = 0 and coalesce(v.aliquota,'') not in ('IST','ISE','NT') then coalesce(v.qtde,0) * coalesce(v.vrvenda,0) else 0 end)`.as('outras'),
            sql`sum(coalesce(v.qtde,0) * coalesce(v.vrvenda,0))`.as('totalnf'),
            sql`0`.as('icms'),
          ])
          .where('v.idempresa', '=', emp)
          .where(sql`cast(v.dtvenda at time zone 'America/Sao_Paulo' as date)`, '>=', dataini)
          .where(sql`cast(v.dtvenda at time zone 'America/Sao_Paulo' as date)`, '<=', datafin)
          .where(sql`coalesce(v.cancelado,'N')`, '=', 'N')
          .where(sql<boolean>`coalesce(v.tipocanc,'N') <> 'C'`)
          .where(sql<boolean>`coalesce(v.statusnfe,'P') <> 'C'`) // cupom cancelado na SEFAZ fora
          // ⚠️ CUPOM EM CONTINGÊNCIA (NFC-e sem chave) **não entra na apuração** — é exatamente o que o aviso do
          // legado anuncia antes de processar ("Existem NFC-e em contigência no período, estas não entrarão na
          // apuração"), com o comentário do fonte explicando o risco ("possibilidade de sonegacao, venda
          // realizada, porem nao inclusa na apuracao de icms"). O smoke pegou: sem este filtro o débito de saída
          // vinha 1,80 maior que o esperado, incluindo o cupom sem chave.
          .where(sql<boolean>`v.chavenfe is not null`)
          .where(this.cfopEntra('v.cfop'))
          .groupBy(['v.nropedido', 'v.cfop', 'v.icms_cst']),
      )
      .executeTakeFirst();
  }

  /** o resumo por CFOP (o quadro do livro): `ICMS_CFOP` — vrcontabil/basecalculo/imposto/isentas/outras. */
  private async resumoCfop(trx: AnyDB, cod: number) {
    await trx
      .insertInto('icms_cfop')
      .columns(['codapuracaoicms', 'tipo', 'cfop', 'vrcontabil', 'basecalculo', 'imposto', 'isentas', 'outras'])
      .expression((eb: any) =>
        eb
          .selectFrom('apuracao_icms_detalhes as d')
          .select([
            'd.codapuracaoicms', 'd.tipo', sql`coalesce(d.cfop,0)`.as('cfop'),
            sql`sum(coalesce(d.totalnf,0))`.as('vrcontabil'),
            sql`sum(coalesce(d.base,0))`.as('basecalculo'),
            sql`sum(coalesce(d.valor_icms,0))`.as('imposto'),
            sql`sum(coalesce(d.isentas_naotrib,0))`.as('isentas'),
            sql`sum(coalesce(d.outras,0))`.as('outras'),
          ])
          .where('d.codapuracaoicms', '=', cod)
          .groupBy(['d.codapuracaoicms', 'd.tipo', sql`coalesce(d.cfop,0)`]),
      )
      .execute();
  }

  /** quantos cupons em CONTINGÊNCIA no período — o aviso que o legado dá antes de apurar (compliance). */
  private async contingencia(db: AnyDB, emp: number, dataini: string, datafin: string): Promise<number> {
    const r = (await db
      .selectFrom('vendas as v')
      .select(sql`count(distinct v.nropedido)::int`.as('n'))
      .where('v.idempresa', '=', emp)
      .where(sql`cast(v.dtvenda at time zone 'America/Sao_Paulo' as date)`, '>=', dataini)
      .where(sql`cast(v.dtvenda at time zone 'America/Sao_Paulo' as date)`, '<=', datafin)
      .where(sql<boolean>`coalesce(v.venda_nfc,'N') = 'S' and v.chavenfe is null`)
      .executeTakeFirst()) as { n?: number } | undefined;
    return Number(r?.n ?? 0);
  }

  async processar(dto: ApuracaoIcmsProcessarDto) {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenant() as AnyDB;
    const aviso_contingencia = await this.contingencia(db, emp, dto.dataini, dto.datafin);

    return db.transaction().execute(async (trx: AnyDB) => {
      // 1) já existe apuração deste período? (a chave do legado: dataini + datafin + empresa)
      const ja = (await trx
        .selectFrom('apuracao_icms')
        .select(['codapuracaoicms'])
        .where('idempresa', '=', emp)
        .where('dataini', '=', dto.dataini)
        .where('datafin', '=', dto.datafin)
        .forUpdate()
        .executeTakeFirst()) as { codapuracaoicms?: number } | undefined;
      if (ja && !dto.reprocessar) {
        // o "não" do legado: devolve a apuração gravada sem recalcular
        return { ...(await this.obterPorCodigo(trx, emp, Number(ja.codapuracaoicms), 0)), reprocessada: false, aviso_contingencia };
      }

      let cod: number;
      if (ja) {
        cod = Number(ja.codapuracaoicms);
        // o "sim": apaga detalhe e resumo daquele código e refaz (o legado deleta as duas tabelas)
        await trx.deleteFrom('icms_cfop').where('codapuracaoicms', '=', cod).execute();
        await trx.deleteFrom('apuracao_icms_detalhes').where('codapuracaoicms', '=', cod).execute();
      } else {
        const ins = (await trx
          .insertInto('apuracao_icms')
          .values({ idempresa: emp, dataini: dto.dataini, datafin: dto.datafin, usultalteracao: op, dtcadastro: sql`now()` })
          .returning('codapuracaoicms')
          .executeTakeFirstOrThrow()) as { codapuracaoicms: number };
        cod = Number(ins.codapuracaoicms);
      }

      // 2) as TRÊS pernas
      await this.detalheNotas(trx, emp, 'S', dto.dataini, dto.datafin, cod);
      await this.detalheCupons(trx, emp, dto.dataini, dto.datafin, cod);
      await this.detalheNotas(trx, emp, 'E', dto.dataini, dto.datafin, cod);
      await this.resumoCfop(trx, cod);

      // 3) os totais. `TotSaida` = Σ do ICMS das saídas; nas entradas o split é por regime do parceiro
      // (`CLASSFISCAL='SN'`), e o cabeçalho soma os dois de volta — o split não altera o E110.
      const tot = (await trx
        .selectFrom('apuracao_icms_detalhes')
        .select([
          sql`coalesce(sum(case when tipo='S' then valor_icms else 0 end),0)`.as('saida'),
          sql`coalesce(sum(case when tipo='E' and coalesce(classfiscal,'') <> 'SN' then valor_icms else 0 end),0)`.as('entrada'),
          sql`coalesce(sum(case when tipo='E' and coalesce(classfiscal,'') = 'SN' then valor_icms else 0 end),0)`.as('entrada_sn'),
        ])
        .where('codapuracaoicms', '=', cod)
        .executeTakeFirst()) as Record<string, unknown>;
      const totSaida = r2(num(tot.saida));
      const totEntrada = r2(num(tot.entrada));
      const totEntradaSn = r2(num(tot.entrada_sn));

      // 4) SALDOANT = saldo credor da apuração do MÊS ANTERIOR (mês fechado, não o período digitado)
      const ant = (await trx
        .selectFrom('apuracao_icms')
        .select('saldocredorseguinte')
        .where('idempresa', '=', emp)
        .where('dataini', '=', sql`date_trunc('month', ${dto.dataini}::date - interval '1 day')::date`)
        .where('datafin', '=', sql`(date_trunc('month', ${dto.dataini}::date - interval '1 day') + interval '1 month - 1 day')::date`)
        .executeTakeFirst()) as { saldocredorseguinte?: unknown } | undefined;
      const saldoAnt = r2(num(ant?.saldocredorseguinte));

      // 5) o E110
      const outrosCreditos = r2(num(dto.outroscreditos));
      const estornoDebitos = r2(num(dto.estornodebitos));
      const outrosDebitos = r2(num(dto.outrosdebitos));
      const estornoCreditos = r2(num(dto.estornocreditos));
      const deducoes = r2(num(dto.deducoes));
      const creditoEntrada = r2(totEntrada + totEntradaSn);
      const totalCredito = r2(saldoAnt + creditoEntrada + outrosCreditos + estornoDebitos);
      const totalDebito = r2(totSaida + outrosDebitos + estornoCreditos);
      const dif = r2(totalDebito - totalCredito);
      const saldoCredorSeguinte = dif < 0 ? Math.abs(dif) : 0;
      const saldoDevedor = dif < 0 ? 0 : Math.abs(dif);
      const aRecolher = r2(saldoDevedor - deducoes);

      await trx
        .updateTable('apuracao_icms')
        .set({
          saldoant: saldoAnt, creditoentrada: creditoEntrada, creditoentrada_sn: totEntradaSn,
          outroscreditos: outrosCreditos, estornodebitos: estornoDebitos, debitosaida: totSaida,
          outrosdebitos: outrosDebitos, estornocreditos: estornoCreditos,
          saldocredorseguinte: saldoCredorSeguinte, saldodevedor: saldoDevedor, deducoes, arecolher: aRecolher,
          usultalteracao: op, dtultimalteracao: sql`now()`,
        })
        .where('codapuracaoicms', '=', cod)
        .execute();

      return { ...(await this.obterPorCodigo(trx, emp, cod, 0)), reprocessada: !!ja, aviso_contingencia };
    });
  }

  /** monta o retorno: cabeçalho + resumo por CFOP + (opcional) uma amostra do detalhe. */
  private async obterPorCodigo(db: AnyDB, emp: number, cod: number, limiteDetalhe: number) {
    const cab = (await db
      .selectFrom('apuracao_icms')
      .selectAll()
      .where('codapuracaoicms', '=', cod)
      .where('idempresa', '=', emp)
      .executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!cab) throw new BusinessRuleError('APURACAO_NAO_ENCONTRADA', { codapuracaoicms: cod });
    const cfops = await db
      .selectFrom('icms_cfop')
      .select(['tipo', 'cfop', 'vrcontabil', 'basecalculo', 'imposto', 'isentas', 'outras'])
      .where('codapuracaoicms', '=', cod)
      .orderBy('tipo')
      .orderBy('cfop')
      .execute();
    const contagem = (await db
      .selectFrom('apuracao_icms_detalhes')
      .select([
        sql`count(*)::int`.as('linhas'),
        sql`count(*) filter (where tipo='S' and especie='NFC')::int`.as('cupons'),
        sql`count(*) filter (where tipo='S' and especie='NF')::int`.as('notas_saida'),
        sql`count(*) filter (where tipo='E')::int`.as('notas_entrada'),
      ])
      .where('codapuracaoicms', '=', cod)
      .executeTakeFirst()) as Record<string, unknown>;
    const detalhe = limiteDetalhe > 0
      ? await db.selectFrom('apuracao_icms_detalhes').selectAll().where('codapuracaoicms', '=', cod)
          .orderBy('tipo').orderBy('codigo').limit(limiteDetalhe).execute()
      : [];
    return { cabecalho: cab, cfops, contagem, detalhe };
  }

  /** consulta de uma apuração gravada — por código ou por período (o `PopulaDadosApuracaoICMS`). */
  async obter(dto: ApuracaoIcmsObterDto) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    let cod = dto.codapuracaoicms ?? null;
    if (cod == null) {
      const a = (await db
        .selectFrom('apuracao_icms')
        .select('codapuracaoicms')
        .where('idempresa', '=', emp)
        .where('dataini', '=', dto.dataini!)
        .where('datafin', '=', dto.datafin!)
        .executeTakeFirst()) as { codapuracaoicms?: number } | undefined;
      if (!a) throw new BusinessRuleError('APURACAO_NAO_ENCONTRADA', { dataini: dto.dataini, datafin: dto.datafin });
      cod = Number(a.codapuracaoicms);
    }
    return this.obterPorCodigo(db, emp, cod, dto.limite_detalhe ?? 200);
  }
}
