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
    // o VALOR do item é `VRCUSTO` LÍQUIDO do desconto percentual — não `vrvenda` (fold auditoria [ALTA]): no dado
    // real da NF o `VRVENDA` é **zero** (em 2023-10: Σ qtde×vrvenda 1.255.631,33 contra Σ qtde×vrcusto
    // 1.564.040,40, com 669 de 4.851 itens com vrvenda zerado), e a fórmula do `.dfm` é
    // `(NP.VRCUSTO − VRCUSTO*DESCONTO/100) * QUANTIDADE`.
    const valorItem = sql`((coalesce(i.vrcusto,0) - coalesce(i.vrcusto,0) * coalesce(i.desconto,0) / 100) * coalesce(i.quantidade,0))`;
    // ISENTAS × OUTRAS não se separam por CST, e sim pela PRIMEIRA LETRA DA ALÍQUOTA (fold auditoria [ALTA]):
    // 'I'/'N' → isentas/não-tributadas · 'S' (substituída) → outras, somando ST e IPI. Golden: item CST 40 com
    // `ALIQUOTA='STB'` sai em OUTRAS, não em isentas; e CST 41/60/70/10 aparecem em OUTRAS no golden.
    const letra = sql`upper(substr(coalesce(i.aliquota,''),1,1))`;
    // TOTALNF é derivado dos ITENS DO GRUPO (não `max(n.totalnf)`, que repetiria a nota inteira em cada CFOP e
    // inflava o "valor contábil" do livro em ~30-60% dos documentos com mais de um grupo — fold auditoria [ALTA]).
    const totalGrupo = sql`(${valorItem} + coalesce(i.vricmst,0) + coalesce(i.ipi,0) + coalesce(i.frete,0)
                            + coalesce(i.seguro,0) + coalesce(i.vroutrasdesp,0))`;
    return trx
      .insertInto('apuracao_icms_detalhes')
      .columns(['codapuracaoicms', 'tipo', 'especie', 'codigo', 'cfop', 'cst', 'base', 'valor_icms',
                'isentas_naotrib', 'outras', 'totalnf', 'icms', 'icms_efetivo', 'classfiscal'])
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
            sql`sum(coalesce(i.vrbasecalculo,0))`.as('base'),
            sql`sum(coalesce(i.vricm,0))`.as('valor_icms'),
            sql`sum(case when ${letra} in ('I','N') then ${valorItem} else 0 end)`.as('isentas_naotrib'),
            sql`sum(case when ${letra} = 'S' then ${valorItem} + coalesce(i.vricmst,0) + coalesce(i.ipi,0) else 0 end)`.as('outras'),
            sql`sum(${totalGrupo})`.as('totalnf'),
            sql`coalesce(i.icms,0)`.as('icms'),
            // ICMS_EFETIVO = a alíquota aplicada sobre a base REDUZIDA (o golden traz 3 linhas do mesmo
            // (codigo,cfop,cst) distinguidas só por ele) — aqui: alíquota × base/(qtde×custo) quando há redução.
            // ICMS_EFETIVO = ICME × BCR/100 (a alíquota sobre a base REDUZIDA) — a coluna `BCR` é a % da base
            // reduzida (mig 026), e o golden confirma a fórmula (apuração 1485: BCR 63,58/63,57/74,84 → efetivo
            // 67,33). Sem BCR (nulo/0) o efetivo é a própria alíquota.
            sql`coalesce(i.icms,0) * coalesce(nullif(i.bcr,0), 100) / 100`.as('icms_efetivo'),
            sql`max(p.classfiscal)`.as('classfiscal'),
          ])
          .where('n.idempresa', '=', emp)
          .where('n.tipo', '=', tipo)
          .where(sql`n.dtcontabil`, '>=', dataini) // a data é a CONTÁBIL
          .where(sql`n.dtcontabil`, '<=', datafin)
          .where(sql`coalesce(n.proc,'N')`, '=', 'S')
          .where(sql`coalesce(n.cancelada,'N')`, '=', 'N')
          .where(sql`coalesce(n.nronf,'0')`, '<>', '0')
          .where(sql<boolean>`coalesce(n.statusnfe,'X') <> 'D'`) // denegada fora
          .where(sql<boolean>`(n.modelo <> 55 or (n.chavenfe is not null and coalesce(n.statusnfe,'P') <> 'I'))`)
          .where(this.cfopEntra('i.cfop'))
          // o GRÃO do legado inclui as duas alíquotas (ICMS e ICMS_EFETIVO), não só (documento, cfop, cst)
          // o GRÃO do legado inclui as DUAS alíquotas: golden 1485 tem três linhas do mesmo (codigo,cfop,cst)
          // distinguidas só pelo ICMS_EFETIVO (75,97 / 67,33 / 90,92).
          .groupBy(['n.codnf', 'i.cfop', 'i.cst', 'i.icms', 'i.bcr']),
      )
      .executeTakeFirst();
  }

  /**
   * O detalhe dos CUPONS (NFC-e de saída) — a perna que carrega 99,8% do detalhe. Grão: documento (`nropedido`) ×
   * CST, com `CODIGO = <nropedido>||'NFC'` e `ESPECIE='NFC'`, espelhando o `CODNF||'NF'` das notas. Item cancelado
   * e cupom cancelado ficam fora (é venda que não existe fiscalmente).
   */
  private async detalheCupons(trx: AnyDB, emp: number, dataini: string, datafin: string, cod: number) {
    // o legado apura o cupom a partir dos itens da NFC-e (`GetSQLNFC`, uRelRegistros_ES.pas:1798-1812):
    //   BASE = SUM(ICMS_BASE_CALCULO) · ICMS = ICMS_EFETIVO = ICMS_ALIQUOTA · **ISENTAS = OUTRAS = 0 (literal)**
    //   CODIGO = CODNFC||'NFC' · filtro: STATUSNFE='P', PROC='S', CHAVENFE não nula, cupom e item não cancelados
    // (folds auditoria [ALTA]: nós inventávamos isentas/outras no cupom, usávamos `qtde*vrvenda` como base — que
    // ignora REDUÇÃO (golden: cupom 2022377 base 22,11 contra item 37,90) — e o `nropedido` como identificador,
    // que casa com 0 de 1.400.580 linhas do golden.)
    const valorItem = sql`(coalesce(v.qtde,0) * coalesce(v.vrvenda,0))`;
    // TOTALNF do cupom segue o CASE do IAT e desconta promoção/departamento/parcelas negativas, somando as
    // positivas — a mesma fórmula da view get_hist_vendas (mig 161) e do legado (:1803-1811).
    const totalIat = sql`(case when v.iat = 'A' then cast(${valorItem} as numeric(18,2))
                               else cast(trunc(${valorItem} * 100) as numeric(18,2)) / 100 end
                          + (case when coalesce(v.desc_acre_medio,0) > 0 then coalesce(v.desc_acre_medio,0) else 0 end)
                          + (case when coalesce(v.desc_acre_item,0)  > 0 then coalesce(v.desc_acre_item,0)  else 0 end)
                          - (coalesce(v.desc_promocao,0) + coalesce(v.desc_departamento,0)
                             + (case when coalesce(v.desc_acre_medio,0) < 0 then coalesce(v.desc_acre_medio,0) * -1 else 0 end)
                             + (case when coalesce(v.desc_acre_item,0)  < 0 then coalesce(v.desc_acre_item,0)  * -1 else 0 end)))`;
    return trx
      .insertInto('apuracao_icms_detalhes')
      .columns(['codapuracaoicms', 'tipo', 'especie', 'codigo', 'cfop', 'cst', 'base', 'valor_icms',
                'isentas_naotrib', 'outras', 'totalnf', 'icms', 'icms_efetivo'])
      .expression((eb: any) =>
        eb
          .selectFrom('vendas as v')
          .select([
            sql`${cod}`.as('codapuracaoicms'),
            sql`'S'`.as('tipo'),
            sql`'NFC'`.as('especie'),
            // CODNFC quando a carga trouxer; sem ele, o nropedido (documentado na mig 165)
            sql`coalesce(v.codnfc::text, v.nropedido) || 'NFC'`.as('codigo'),
            sql`v.cfop`.as('cfop'),
            sql`nullif(v.icms_cst,'')::int`.as('cst'),
            // base = a do item (pode ser REDUZIDA); fallback só enquanto a carga não preencher
            sql`sum(coalesce(v.icms_base_calculo, case when coalesce(v.icms_valor,0) <> 0 then ${valorItem} else 0 end))`.as('base'),
            sql`sum(coalesce(v.icms_valor,0))`.as('valor_icms'),
            sql`0`.as('isentas_naotrib'), // literal no legado
            sql`0`.as('outras'),          // literal no legado
            sql`sum(${totalIat})`.as('totalnf'),
            sql`coalesce(v.icms_aliquota,0)`.as('icms'),
            sql`coalesce(v.icms_aliquota,0)`.as('icms_efetivo'),
          ])
          .where('v.idempresa', '=', emp)
          .where(sql`cast(v.dtvenda at time zone 'America/Sao_Paulo' as date)`, '>=', dataini)
          .where(sql`cast(v.dtvenda at time zone 'America/Sao_Paulo' as date)`, '<=', datafin)
          .where(sql`coalesce(v.cancelado,'N')`, '=', 'N')
          .where(sql<boolean>`coalesce(v.tipocanc,'N') <> 'C'`)
          // ⚠️ o legado exige **STATUSNFE='P'** (autorizada). O `<> 'C'` de antes admitia 40.035 NFC-e
          // **inutilizadas ('I')** com chave, além de 'U'/'G'/'R'/vazio — a perna de NF já excluía a inutilizada.
          .where(sql`coalesce(v.statusnfe,'')`, '=', 'P')
          // cupom em CONTINGÊNCIA não entra (é o que o aviso do legado anuncia); sem chave não há documento fiscal
          .where(sql<boolean>`v.chavenfe is not null`)
          .where(this.cfopEntra('v.cfop'))
          .groupBy(['v.codnfc', 'v.nropedido', 'v.cfop', 'v.icms_cst', 'v.icms_aliquota']),
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
      // `VerificaNfcContigencia` (uRelRegistros_ES.pas:3030-3034): `STATUSNFE='G' AND CHAVENFE IS NOT NULL` — a
      // NFC-e emitida em contingência (com chave, aguardando transmissão). Eu media o oposto (sem chave), que é
      // outra coisa (fold auditoria [MÉDIA]).
      .where(sql<boolean>`coalesce(v.statusnfe,'') = 'G' and v.chavenfe is not null`)
      .executeTakeFirst()) as { n?: number } | undefined;
    return Number(r?.n ?? 0);
  }

  async processar(dto: ApuracaoIcmsProcessarDto) {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenant() as AnyDB;
    const aviso_contingencia = await this.contingencia(db, emp, dto.dataini, dto.datafin);

    return db.transaction().execute(async (trx: AnyDB) => {
      // serializa por (empresa, período): o `for update` abaixo não trava nada quando a apuração AINDA NÃO existe,
      // e duas chamadas simultâneas colidiriam no UNIQUE devolvendo 500 (fold auditoria [MÉDIA]).
      await sql`select pg_advisory_xact_lock(hashtext(${`apuracao_icms:${emp}:${dto.dataini}:${dto.datafin}`}))`.execute(trx);
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

      const gravado = ja
        ? ((await trx.selectFrom('apuracao_icms')
            .select(['outroscreditos', 'estornodebitos', 'outrosdebitos', 'estornocreditos', 'deducoes', 'saldoant'])
            .where('codapuracaoicms', '=', cod).executeTakeFirst()) as Record<string, unknown> | undefined)
        : undefined;
      // 4) SALDOANT = saldo credor da apuração do MÊS ANTERIOR (mês fechado, não o período digitado)
      const ant = (await trx
        .selectFrom('apuracao_icms')
        .select('saldocredorseguinte')
        .where('idempresa', '=', emp)
        .where('dataini', '=', sql`date_trunc('month', ${dto.dataini}::date - interval '1 day')::date`)
        .where('datafin', '=', sql`(date_trunc('month', ${dto.dataini}::date - interval '1 day') + interval '1 month - 1 day')::date`)
        .executeTakeFirst()) as { saldocredorseguinte?: unknown } | undefined;
      const saldoAnt = ant != null ? r2(num(ant.saldocredorseguinte)) : r2(num(gravado?.saldoant));

      // 5) o E110
      // ⚠️ reprocessar **não apaga** os ajustes manuais nem o saldo anterior já gravados: no legado eles vivem em
      // datasets filhos e o registro é EDITADO, e o `SALDOANT` só é sobrescrito se a apuração do mês anterior
      // existir (uRelRegistros_ES.pas:2381-2393). Sem isso, reprocessar sem reenviar zeraria o quadro de ajustes
      // (fold auditoria [MÉDIA]).
      const ajuste = (doDto: number | undefined, atual: unknown) => r2(doDto != null ? num(doDto) : num(atual));
      const outrosCreditos = ajuste(dto.outroscreditos, gravado?.outroscreditos);
      const estornoDebitos = ajuste(dto.estornodebitos, gravado?.estornodebitos);
      const outrosDebitos = ajuste(dto.outrosdebitos, gravado?.outrosdebitos);
      const estornoCreditos = ajuste(dto.estornocreditos, gravado?.estornocreditos);
      const deducoes = ajuste(dto.deducoes, gravado?.deducoes);
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
