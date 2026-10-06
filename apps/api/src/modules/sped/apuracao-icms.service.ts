import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ApuracaoIcmsProcessarDto, ApuracaoIcmsObterDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { configNaTrx } from '../compras/pedido-heranca';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { dataBr, dataLocal, empresaParaRelatorio, registroFr3, textoVariavel } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * APURAÇÃO DE ICMS — o processo do livro de Registro de Entradas e Saídas (`uRelRegistros_ES.pas` 3.047 linhas +
 * `uDMRelRegistros_ES.pas`), que **produz** a `APURACAO_ICMS` que o SPED (E110) consome. Dossiê:
 * `docs/04-screen-dossier/dossiers/retaguarda/uRelRegistros_ES-apuracao-icms.md`.
 *
 * DUAS ESPÉCIES nas saídas (NF e NFC-e) e as NF de entrada; a terceira perna do fonte, a REDUÇÃO Z (`REDUCAOZ`/`REDUCAOZ_ALIQ`,
 * espécie 'MR'), é morta: a tabela tem 0 linhas na produção (06/10/2026). Os filtros das notas são os do marcador FILTRO NF do fonte
 * (data CONTÁBIL, `PROC='S'`, `CANCELADA='N'`, NRONF ≠ '0', denegada fora; na saída, NF-e com chave e não inutilizada) e as regras
 * de cada coluna são as do binário que a produção roda (ver `detalheNotas`).
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

  /**
   * O detalhe das NOTAS (entrada ou saída) — o `FDqCFOP_ICMS` (uDMRelRegistros_ES.dfm) com o marcador FILTRO NF de cada perna
   * (uRelRegistros_ES.pas:1975 saída, :2121 entrada), **na versão do binário que a produção roda**. O fonte é de mai/2020 e a
   * produção grava outra coisa; a regra abaixo foi reconstruída do dado e conferida linha a linha contra o `APURACAO_ICMS_DETALHES`
   * gravado (dez/2025 e jan/2026, as duas empresas): todas as colunas batem em 1.650 de 1.658 linhas, o ICMS soma exatamente o
   * crédito e o débito gravados (12.877,83 · 10.790,64 · 16.718,21), e as 8 que sobram são notas alteradas depois da apuração.
   * O que mudou do fonte para o binário novo (dossiê §8):
   *  - BASE/VALOR do ICMS: zera com CFOP de cupom (`PROC_CUPOM`), x403/x933/x556 e x101/x102 com CST 40/90, e com a alíquota
   *    **I/N** — no fonte só a alíquota "T" contava e o x401 também zerava (o crédito do 1401/1910 com ST entra);
   *  - a alíquota (ICMS) é o `ICME` e o ICMS_EFETIVO é o **`BCR`** arredondado — e o x403 não os zera (só cupom, x933/x556, x101/x102);
   *  - o FRETE soma o **valor** (`VRFRETE`, coluna que o fonte não tem), não mais o percentual `FRETE` × valor.
   * O grão é (documento, CFOP, CST, alíquota, efetivo, ARREDONDA): o `ARREDONDA` do item separa linhas, como no `GROUP BY` do fonte.
   * Nota sem endereço (`INNER JOIN PARCEIROS_END`) e CFOP marcado (`NAO_GERA_APURACAO_ICMS`) ficam fora.
   */
  private async detalheNotas(trx: AnyDB, emp: number, tipo: 'E' | 'S', dataini: string, datafin: string, cod: number) {
    // o valor do item: custo líquido do desconto percentual × quantidade, com os CASTs do legado
    const val = sql`((i.vrcusto - cast((i.vrcusto * cast(coalesce(i.desconto, 0) as numeric(15,6))) / 100 as numeric(15,6))) * cast(i.quantidade as numeric(13,3)))`;
    // IPI e SEGURO são PERCENTUAIS sobre o valor do item (no IPI do valor contábil o valor não é arredondado antes)
    const pct = (col: string) => sql`((cast(coalesce(${sql.ref(`i.${col}`)}, 0) as numeric(13,3)) * cast(${val} as numeric(15,2))) / 100)`;
    const ipi = sql`((cast(coalesce(i.ipi, 0) as numeric(13,3)) * ${val}) / 100)`;
    const letra = sql`substr(i.aliquota, 1, 1)`;
    const c3 = sql`substr(i.cfop, 2, 3)`;
    const zeraValor = sql`(c.proc_cupom = 'S' or ${c3} in ('403','933','556') or (${c3} in ('102','101') and i.cst in (40, 90)))`;
    const zeraAliquota = sql`(c.proc_cupom = 'S' or ${c3} in ('933','556') or (${c3} in ('102','101') and i.cst in (40, 90)))`;
    const aliquota = sql`case when ${zeraAliquota} then 0 when ${letra} in ('I','N') then 0 else i.icme end`;
    const efetivo = sql`case when ${zeraAliquota} then 0 else round(i.bcr, 2) end`;
    const filtroTipo = tipo === 'S'
      // a saída exige a NF-e com chave e não inutilizada (o modelo ≠ 55 passa)
      ? sql`and n.tipo = 'S' and ((n.modelo = 55 and n.chavenfe is not null and coalesce(n.statusnfe, 'P') <> 'I') or n.modelo <> 55)`
      : sql`and n.tipo = 'E'`;
    await sql`
      INSERT INTO apuracao_icms_detalhes (codapuracaoicms, tipo, especie, codigo, cfop, cst, base, valor_icms, isentas_naotrib, outras,
                                          totalnf, icms, icms_efetivo, classfiscal)
      SELECT ${cod}, ${tipo}, 'NF', n.codnf::text || 'NF', nullif(i.cfop, '')::int, i.cst,
             round(sum(case when ${zeraValor} then 0 when ${letra} in ('I','N') then 0 else coalesce(i.vrbasecalculo, 0) end), 2),
             round(sum(case when ${zeraValor} then 0 when ${letra} in ('I','N') then 0 else coalesce(i.vricm, 0) end), 2),
             round(sum(case when c.proc_cupom = 'S' then 0 when ${letra} in ('I','N') then ${val} + coalesce(i.depsacess, 0) else 0 end), 2),
             round(sum(case when c.proc_cupom = 'S' then ${val} + coalesce(i.vricmst, 0) + ${pct('ipi')} + coalesce(i.depsacess, 0)
                            when ${letra} = 'S' then ${val} + coalesce(i.vricmst, 0) + ${ipi} + coalesce(i.depsacess, 0) + coalesce(i.vrfrete, 0) + ${pct('seguro')}
                            else 0 end + coalesce(i.fcp_valor_st, 0)), 2),
             round(sum(${val} + coalesce(i.vricmst, 0) + ${ipi} + coalesce(i.depsacess, 0) + coalesce(i.vrfrete, 0) + ${pct('seguro')} + coalesce(i.fcp_valor_st, 0)), 2),
             ${aliquota}, ${efetivo}, max(p.classfiscal)
        FROM nf_prod i
        JOIN cfop c ON c.codcfop = i.cfop AND coalesce(c.nao_gera_apuracao_icms, 'N') = 'N'
        LEFT JOIN nf n ON n.codnf = i.codnf
        JOIN parceiros_end pe ON pe.codend = n.codparceiro_end
        LEFT JOIN parceiros p ON p.codparceiro = n.codparceiro
       WHERE n.nronf <> '0' AND n.nronf IS NOT NULL AND (n.statusnfe <> 'D' OR n.statusnfe IS NULL)
         AND n.dtcontabil BETWEEN ${dataini}::date AND ${datafin}::date AND n.idempresa = ${emp}
         AND n.proc = 'S' AND n.cancelada = 'N' ${filtroTipo}
       GROUP BY n.codnf, i.cfop, i.cst, ${aliquota}, ${efetivo}, i.arredonda`.execute(trx);
  }

  /**
   * O detalhe dos CUPONS (NFC-e de saída) — o `GetSQLNFC` (uRelRegistros_ES.pas:1798-1823), que a produção reproduz (jan/2026:
   * 50.122 linhas e R$ 1.381.934,76 contra 50.127 e R$ 1.381.951,71 gravados — a diferença são cupons transmitidos depois).
   * BASE = Σ ICMS_BASE_CALCULO · VALOR = Σ ICMS_VALOR · ICMS = ICMS_EFETIVO = ICMS_ALIQUOTA · ISENTAS = OUTRAS = 0 (literal) ·
   * CODIGO = CODNFC||'NFC'. Entra a NFC-e autorizada (`STATUSNFE='P'`) com chave, e a em contingência (`'G'`) só quando a
   * configuração `CONSIDERA_NFCE_CONTINGENCIA_SPED_FISCAL` é 'S' (a view GET_CONFIG_NFCE_CONTIGENCIA); item cancelado fora.
   * **Sem o filtro de CFOP**: o `GetSQLNFC` não junta a tabela CFOP (o `NAO_GERA_APURACAO_ICMS` vale só para as notas).
   */
  private async detalheCupons(trx: AnyDB, emp: number, dataini: string, datafin: string, cod: number) {
    const contingencia = String((await configNaTrx(trx, 'CONSIDERA_NFCE_CONTINGENCIA_SPED_FISCAL',
      { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' })) ?? 'N').toUpperCase() === 'S';
    const valorItem = sql`(coalesce(v.qtde,0) * coalesce(v.vrvenda,0))`;
    // TOTALNF do cupom segue o CASE do IAT e desconta promoção/departamento/parcelas negativas, somando as positivas
    const totalIat = sql`(case when v.iat = 'A' then cast(${valorItem} as numeric(18,2))
                               else cast(trunc(${valorItem} * 100) as numeric(18,2)) / 100 end
                          + (case when coalesce(v.desc_acre_medio,0) > 0 then coalesce(v.desc_acre_medio,0) else 0 end)
                          + (case when coalesce(v.desc_acre_item,0)  > 0 then coalesce(v.desc_acre_item,0)  else 0 end)
                          - (coalesce(v.desc_promocao,0) + coalesce(v.desc_departamento,0)
                             + (case when coalesce(v.desc_acre_medio,0) < 0 then coalesce(v.desc_acre_medio,0) * -1 else 0 end)
                             + (case when coalesce(v.desc_acre_item,0)  < 0 then coalesce(v.desc_acre_item,0)  * -1 else 0 end)))`;
    await sql`
      INSERT INTO apuracao_icms_detalhes (codapuracaoicms, tipo, especie, codigo, cfop, cst, base, valor_icms, isentas_naotrib, outras,
                                          totalnf, icms, icms_efetivo)
      SELECT ${cod}, 'S', 'NFC', coalesce(v.codnfc::text, v.nropedido) || 'NFC', v.cfop, nullif(v.icms_cst, '')::int,
             sum(coalesce(v.icms_base_calculo, 0)), sum(coalesce(v.icms_valor, 0)), 0, 0, sum(${totalIat}),
             v.icms_aliquota, v.icms_aliquota
        FROM vendas v
       WHERE v.idempresa = ${emp}
         AND cast(v.dtvenda at time zone 'America/Sao_Paulo' as date) BETWEEN ${dataini}::date AND ${datafin}::date
         AND coalesce(v.cancelado, 'N') = 'N'
         AND v.chavenfe IS NOT NULL
         AND (coalesce(v.statusnfe, '') = 'P' OR (${contingencia} AND coalesce(v.statusnfe, '') = 'G'))
       GROUP BY v.codnfc, v.nropedido, v.cfop, v.icms_cst, v.icms_aliquota`.execute(trx);
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
    // os totalizadores da tela (`GetSqTotalizaCfop`, :1375): entradas, devoluções de fornecedor, saídas e devoluções de cliente
    // pelo VRCONTABIL do resumo por CFOP; % compra × saída = entradas ÷ saídas × 100
    const tot = (await sql<Record<string, unknown>>`
      SELECT coalesce(sum(CASE WHEN substr(cfop::text,1,1) IN ('1','2','3') AND cfop NOT IN (1202,2202,1411,2411) THEN vrcontabil END),0) AS entradas,
             coalesce(sum(CASE WHEN cfop IN (5202,6202,5411,6411) THEN vrcontabil END),0) AS devfor,
             coalesce(sum(CASE WHEN substr(cfop::text,1,1) IN ('5','6','7') AND cfop NOT IN (5202,6202,5411,6411) THEN vrcontabil END),0) AS saidas,
             coalesce(sum(CASE WHEN cfop IN (1202,2202,1411,2411) THEN vrcontabil END),0) AS devcli
        FROM icms_cfop WHERE codapuracaoicms = ${cod}`.execute(db)).rows[0] ?? {};
    const totais = {
      entradas: num(tot.entradas), saidas: num(tot.saidas), devfor: num(tot.devfor), devcli: num(tot.devcli),
      perc_compra_saida: num(tot.saidas) !== 0 ? (num(tot.entradas) / num(tot.saidas)) * 100 : 0,
    };
    return { cabecalho: cab, cfops, contagem, detalhe, totais };
  }

  /**
   * IMPRESSÃO do livro de apuração (`btnImprimirClick`, :426) — `Relatorios\Notas_fiscais_Registro_Apuracao.fr3`:
   *  - frxDBDatasetTemp = o detalhe da apuração (o `cdsTemp`, índice TIPO;CFOP) — os rodapés por CFOP somam as cinco colunas;
   *  - frxDBDatasetCFOP / frxDBDatasetCFOPE = as saídas / as entradas, com as linhas 5000/6000/7000 e 1000/2000/3000 zeradas que o
   *    `SetaCFOP` (:1729) acrescenta para cada grupo de primeiro dígito sair mesmo vazio (os subtotais do sub-relatório);
   *  - frxDBDataset2 = a empresa; as variáveis LIVRO e FOLHA (vazias → '1'), MES e o quadro do E110 (DEBITOS…SALDOCREDPERSEG, com
   *    SUBTOTALCREDITOS = crédito de entrada + outros créditos + estorno de débitos).
   * O legado, para uma apuração já gravada, refaz as saídas e as entradas do sub-relatório com o SQL do fonte (`PopulaDadosApuracaoICMS`);
   * aqui elas saem do detalhe gravado — o mesmo que o processamento usa, e sem o SQL antigo que a produção já não roda.
   */
  async impressao(cod: number, livro?: string, folha?: string) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const cab = (await db.selectFrom('apuracao_icms').selectAll().where('codapuracaoicms', '=', cod).where('idempresa', '=', emp)
      .executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!cab) throw new BusinessRuleError('APURACAO_NAO_ENCONTRADA', { codapuracaoicms: cod });
    const det = (await sql<Record<string, unknown>>`
      SELECT tipo, cfop, especie, codigo, cst, icms, icms_efetivo, base, valor_icms, isentas_naotrib, outras, totalnf, classfiscal
        FROM apuracao_icms_detalhes WHERE codapuracaoicms = ${cod}
       ORDER BY tipo, cfop, codapuracaoicmsdetalhes`.execute(db)).rows;
    const nums = new Set(['cfop', 'cst', 'icms', 'icms_efetivo', 'base', 'valor_icms', 'isentas_naotrib', 'outras', 'totalnf']);
    const linhas = det.map((r) => registroFr3(r, nums));
    // o SetaCFOP: CFOP = dígito × 1000 e os demais campos '000' (0 nos numéricos)
    const seta = (d: number) => ({ TIPO: '000', CFOP: d * 1000, ESPECIE: '000', CODIGO: '000', CST: 0, ICMS: 0, ICMS_EFETIVO: 0, BASE: 0,
      VALOR_ICMS: 0, ISENTAS_NAOTRIB: 0, OUTRAS: 0, TOTALNF: 0, CLASSFISCAL: '000' });
    const porCfop = (rs: Record<string, unknown>[]) => rs.map((r, i) => ({ r, i }))
      .sort((a, b) => Number(a.r.CFOP) - Number(b.r.CFOP) || a.i - b.i).map((x) => x.r);
    const saidas = porCfop([...linhas.filter((r) => r.TIPO === 'S'), seta(5), seta(6), seta(7)]);
    const entradas = porCfop([...linhas.filter((r) => r.TIPO === 'E'), seta(1), seta(2), seta(3)]);
    const v = (k: string) => num(cab[k]);
    const valores: Record<string, number> = {
      DEBITOS: v('debitosaida'), OUTROSDEBITOS: v('outrosdebitos'), ESTORNOCREDITOS: v('estornocreditos'),
      TOTALDEBITOS: r2(v('debitosaida') + v('outrosdebitos') + v('estornocreditos')),
      CREDITOS: v('creditoentrada'), OUTROSCREDITOS: v('outroscreditos'), ESTORNODEBITOS: v('estornodebitos'),
      SUBTOTALCREDITOS: r2(v('creditoentrada') + v('outroscreditos') + v('estornodebitos')),
      SALDOCREDPERANT: v('saldoant'),
      TOTALCREDITOS: r2(v('saldoant') + v('creditoentrada') + v('outroscreditos') + v('estornodebitos')),
      SALDODEVEDOR: v('saldodevedor'), DEDUCOES: v('deducoes'), ARECOLHER: v('arecolher'), SALDOCREDPERSEG: v('saldocredorseguinte'),
    };
    const br = (d: unknown) => dataBr(d instanceof Date ? dataLocal(d).slice(0, 10) : String(d ?? '').slice(0, 10));
    return {
      titulo: `Livro de apuração do ICMS ${br(cab.dataini)} a ${br(cab.datafin)}`,
      modelo: await modeloFr3(db, 'Notas_fiscais_Registro_Apuracao.fr3'),
      datasets: { frxDBDatasetTemp: linhas, frxDBDatasetCFOP: saidas, frxDBDatasetCFOPE: entradas, frxDBDataset2: [await empresaParaRelatorio(db, emp)] },
      variaveis: {
        LIVRO: textoVariavel(String(livro ?? '').trim() || '1'), FOLHA: textoVariavel(String(folha ?? '').trim() || '1'),
        MES: textoVariavel(`MES OU PERÍODO: ${br(cab.dataini)} até ${br(cab.datafin)}`),
        ...Object.fromEntries(Object.entries(valores).map(([k, n]) => [k, String(n)])),
      },
    };
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
