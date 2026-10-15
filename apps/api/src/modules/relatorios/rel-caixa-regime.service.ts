import { Injectable } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { empresaParaRelatorio, registroFr3 } from '../../shared/relatorios/registro-fr3';
import { colunasNvl, estruturaPlc, joinFixo, parteFixa, parteFixaGrupo, plcsOcultosDoOperador } from './rel-caixa-plc';

type AnyDB = Kysely<any>;

export interface FiltroCaixaBaixado {
  dtini: string; dtfim: string;
  /** cbbRelatorios 2/3: Caixa Baixado (emissão) ou (pagamento) */
  data: 'EMISSAO' | 'PAGAMENTO';
  empresas?: number[];
  plc?: string | null;
  obs?: string | null;
  cmv?: boolean;
  expandido?: boolean;
}

export interface FiltroCaixaAberto {
  dtini: string; dtfim: string;
  /** cbbRelatorios 4/5: Caixa Aberto (emissão) ou (vencimento) */
  data: 'EMISSAO' | 'VENCIMENTO';
  /** rdgTipoRel: 0 Sintético · 1 Analítico */
  tipo: 0 | 1;
  empresas?: number[];
  plc?: string | null;
  cmv?: boolean;
  custoReposicao?: boolean;
  expandido?: boolean;
}

/**
 * RELATÓRIO DE CAIXA — CAIXA BAIXADO (FRMRELATORIOCAIXA, `TRelCaixaBaixado`, uRelatorioCaixa.pas:1007-1355). O balancete do regime de caixa:
 * o que ENTROU — títulos recebidos (GET_ARECEBERBX, na conta do título ou no cofre da forma), cheques baixados, cartões liberados (no
 * cofre da forma do cartão) e as vendas à vista (o CAIXA das contas da CONTACORRENTE com destino CXA, "FECHAMENTO DE CAIXA") — e o que
 * SAIU: as baixas a pagar rateadas pelos centros de custo do título (CX_APAGAR, pela base do total da NF ou do grupo, líquidas de juros e
 * acréscimo/desconto) e as perdas do scrap. A data: na EMISSÃO, a da venda/emissão/compra; no PAGAMENTO, a da baixa (o à vista e o scrap
 * são sempre a data do caixa). O rdgTipoRel é forçado em Analítico (cbbRelatoriosCloseUp :852) → sempre o layout Detalhado, com
 * observação, parceiro e razão.
 * Do SetFiltro só valem aqui o código do centro de custo e a observação (o operador, o fiscal, o PDV, o tipo de conta e o campo data das
 * notas só entram no GetSQLReceitas, que está comentado no GetSQL). C.M.V.: tira a conta de CMV das despesas e, pelo
 * DesconsideraPLCPaiCMV, o grupo principal dela. E o recorte do proprietário pelo CODPLC_NVL1 (FiltraPLCProprietario :340).
 * Diferenças deliberadas, documentadas no dossiê: (1) o cartão conta UMA vez — a GET_CARTAOBX do legado repete o cartão a cada baixa
 * (LEFT JOIN CARTAO_BX): 3.144 cartões, R$ 143.411,53 em dobro na produção; (2) a observação no scrap filtra a observação do lançamento
 * (o legado usa G.OBS, sem alias G na consulta do scrap — ORA-00904 com o filtro preenchido); (3) a base zero do rateio não derruba o
 * relatório (o legado dá ORA-01476): o lançamento fica sem valor.
 */
@Injectable()
export class RelCaixaRegimeService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async consultarBaixado(f: FiltroCaixaBaixado): Promise<{ linhas: Record<string, unknown>[]; niveis: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const lojas = await empresasDoOperador(db, f.empresas);
    const { niveis, acima } = await estruturaPlc(db, emp);
    // a sessão do banco roda no fuso da loja (DatabaseProvider: TimeZone) — o ::date é o TRUNC do legado
    const periodo = (d: RawBuilder<unknown>) => sql`${d} BETWEEN ${f.dtini}::date AND ${f.dtfim}::date`;
    const emissao = f.data === 'EMISSAO';
    const pf = parteFixa(acima);
    const pg = parteFixaGrupo(acima);
    const jf = joinFixo(niveis);
    const plcLike = f.plc ? sql`AND p.desccodplc LIKE ${`${f.plc}%`}` : sql``;
    const obsLike = f.obs ? `%${f.obs}%` : null;

    // RECEITAS (GetSQLReceitasOrigem): receber + cheque + cartão, com o começo do código por fora, e o à vista
    const receber = sql`
      SELECT p.desccodplc, p.descricao, CAST(coalesce(sum(a.valor_pago), 0) AS numeric(18,2)) AS valor ${pf}, p.tpconta,
             a.obs::text AS obs, a.codigo_cliente AS codparceiro, a.cliente::text AS razao
        FROM get_areceberbx a
        JOIN areceber r ON r.codrcb = a.codigo_documento
        LEFT JOIN formas_pgto fp ON fp.idpgto = r.idpgto
        JOIN plc p ON p.codplc = coalesce(r.codplc, fp.plccofre)
        ${jf}
       WHERE ${periodo(emissao ? sql`a.data_venda` : sql`a.data_pagamento`)} AND a.idempresa = ANY(${lojas}::int[])
       GROUP BY p.desccodplc, p.descricao, p.codplc, p.codpai ${pg}, p.tpconta, a.obs, a.codigo_cliente, a.cliente`;
    const cheque = sql`
      SELECT p.desccodplc, p.descricao, CAST(coalesce(sum(c.valor), 0) AS numeric(18,2)) AS valor ${pf}, p.tpconta,
             c.observacao::text, chq.codparceiro, c.cliente::text
        FROM get_chequebx c
        JOIN cheque chq ON chq.codchq = c.codigo
        JOIN formas_pgto fp ON fp.idpgto = chq.idpgto
        JOIN plc p ON p.codplc = fp.plccofre
        ${jf}
       WHERE ${periodo(emissao ? sql`c.data_emissao` : sql`c.data_baixa`)} AND c.idempresa = ANY(${lojas}::int[])
       GROUP BY p.desccodplc, p.descricao, p.codplc, p.codpai ${pg}, p.tpconta, c.observacao, chq.codparceiro, c.cliente`;
    const cartao = sql`
      SELECT p.desccodplc, p.descricao, CAST(coalesce(sum(crt.valor), 0) AS numeric(18,2)) AS valor ${pf}, p.tpconta,
             crt.obs::text, 0, ''::text
        FROM cartao crt
        JOIN formas_pgto fp ON fp.idpgto = crt.idpgto
        JOIN plc p ON p.codplc = fp.plccofre
        ${jf}
       WHERE crt.liberado = 'S' AND ${periodo(emissao ? sql`crt.dtvenda::date` : sql`crt.dtbaixa::date`)} AND crt.idempresa = ANY(${lojas}::int[])
       GROUP BY p.desccodplc, p.descricao, p.codplc, p.codpai ${pg}, p.tpconta, crt.obs`;
    const aVista = sql`
      SELECT * FROM (
        SELECT p.desccodplc, p.descricao,
               (SELECT coalesce(sum(abs(i.valor)), 0) FROM caixa i
                 WHERE ${periodo(sql`i.data::date`)} AND i.codplc = f.codplc AND i.idempresa = ANY(${lojas}::int[])) AS valor ${pf}, p.tpconta,
               'REFERENTE À FECHAMENTOS DE CAIXA À VISTA'::text AS obs, NULL::integer AS codparceiro, 'FECHAMENTO DE CAIXA'::text AS razao
          FROM contacorrente f
          JOIN pdv d ON d.codpdv = f.codpdv
          JOIN formas_pgto o ON o.idpgto = f.idpgto
          JOIN plc p ON p.codplc = f.codplc
          ${jf}
         WHERE o.destino = 'CXA' ${plcLike}
         GROUP BY p.desccodplc, p.descricao, f.codplc, p.codpai ${pg}, p.tpconta) av
       WHERE av.valor > 0`;
    const receitas = sql`
      SELECT cur.* FROM (${receber} UNION ALL ${cheque} UNION ALL ${cartao}) cur ${f.plc ? sql`WHERE cur.desccodplc LIKE ${`${f.plc}%`}` : sql``}
      UNION ALL ${aVista}`;

    // DESPESAS (GetSQLDespesas): as baixas a pagar rateadas + o scrap, agrupadas
    const base = sql`CASE WHEN g.idnf > 0 THEN (SELECT CASE WHEN n.totalnf = 0 THEN 1 ELSE n.totalnf END FROM nf n WHERE n.codnf = g.idnf)
      ELSE (SELECT nullif(sum(w.valor) + sum(coalesce(w.vendor, 0)), 0) FROM apagar w WHERE w.codgrupo = g.codgrupo) END`;
    const pagar = sql`
      SELECT p.desccodplc, p.descricao,
             CAST(((((a.valorpg * (c.valor * 100) / ${base})) / 100)
                  - ((coalesce(a.juros, 0) * ((c.valor * 100) / ${base})) / 100)
                  - ((coalesce(a.acre_desc, 0) * ((c.valor * 100) / ${base})) / 100)) * -1 AS numeric(18,2)) AS valor ${pf}, p.tpconta,
             e.contacmv, g.obs::text AS obs, g.codparceiro, par.razao::text AS razao
        FROM apagar_bx a
        JOIN apagar g ON g.codapg = a.codapg
        JOIN cx_apagar c ON c.codgrupo = g.codgrupo
        JOIN plc p ON p.codplc = c.codcc
        ${jf}
        JOIN empresas e ON g.codempresa = e.idempresa
        LEFT JOIN parceiros par ON par.codparceiro = g.codparceiro
       WHERE ${periodo(emissao ? sql`g.dtcompra` : sql`a.dtpgto::date`)}
         AND p.desccodplc IS NOT NULL AND coalesce(a.indr, 'I') = 'I' AND g.codempresa = ANY(${lojas}::int[]) ${plcLike}
         ${obsLike ? sql`AND (g.obs LIKE ${obsLike} OR p.descricao LIKE ${obsLike})` : sql``}
         ${f.cmv ? sql`AND (p.codplc <> e.contacmv OR e.contacmv IS NULL)` : sql``}`;
    const scrap = sql`
      SELECT p.desccodplc, p.descricao, c.valor ${pf}, p.tpconta, e.contacmv, c.obs::text, par.codparceiro, par.razao::text
        FROM scrap a
        JOIN caixa c ON c.codscrap = a.codscrap
        JOIN plc p ON p.codplc = c.codplc
        JOIN empresas e ON e.idempresa = a.idempresa
        LEFT JOIN parceiros par ON par.codparceiro = a.codparceiro
        ${jf}
       WHERE ${periodo(sql`c.data::date`)} AND a.idempresa = ANY(${lojas}::int[]) ${plcLike}
         ${obsLike ? sql`AND (c.obs LIKE ${obsLike} OR p.descricao LIKE ${obsLike})` : sql``}`;
    const nvlAp = colunasNvl(acima, 'ap');
    const agrupado = sql`
      SELECT ap.desccodplc, ap.descricao, CAST(sum(ap.valor) AS numeric(18,2)) AS valor ${nvlAp}, ap.tpconta, ap.contacmv, ap.obs, ap.codparceiro, ap.razao
        FROM (${pagar} UNION ALL ${scrap}) ap
       GROUP BY ap.desccodplc, ap.descricao, ap.tpconta, ap.contacmv ${nvlAp}, ap.obs, ap.codparceiro, ap.razao`;
    const nvlCur = colunasNvl(acima, 'cur');
    const campos = sql`cur.desccodplc, cur.descricao, cur.valor ${nvlCur}, cur.tpconta, cur.obs, cur.codparceiro, cur.razao`;
    const despesas = f.cmv && niveis > 1
      ? sql`SELECT ${campos} FROM (${agrupado}) cur LEFT JOIN plc plccmv ON plccmv.codplc = cur.contacmv
             WHERE (cur.codplc_nvl1 <> (SELECT pl.codplc FROM plc pl WHERE trim(pl.desccodplc) = substr(trim(plccmv.desccodplc), 1, 1) || '.' LIMIT 1) OR cur.contacmv IS NULL)`
      : sql`SELECT ${campos} FROM (${agrupado}) cur`;

    let linhas = (await sql`${receitas} UNION ALL ${despesas} ORDER BY 1`.execute(db)).rows as Record<string, unknown>[];
    // FiltraPLCProprietario('CODPLC_NVL1')
    const ocultos = await plcsOcultosDoOperador(db);
    if (ocultos.size && niveis > 1) linhas = linhas.filter((l) => !ocultos.has(Number(l.codplc_nvl1)));
    return { linhas, niveis };
  }

  /** «Imprimir» do Baixado: o Rel_BalanceteRegimeCaixaDetalhado.fr3 (frxDBDataset2 = o resultado, frxDBDataset1 = a empresa) */
  async impressaoBaixado(f: FiltroCaixaBaixado) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = await this.consultarBaixado(f);
    const nums = new Set(['valor', 'tpconta', 'codparceiro', ...Array.from({ length: r.niveis - 1 }, (_, i) => `codplc_nvl${i + 1}`)]);
    const br = (d: string) => d.split('-').reverse().join('/');
    const regime = f.data === 'EMISSAO' ? 'Caixa Baixado (emissão)' : 'Caixa Baixado (pagamento)';
    return {
      titulo: 'Caixa',
      modelo: await modeloFr3(db, 'Rel_BalanceteRegimeCaixaDetalhado.fr3'),
      datasets: { frxDBDataset2: r.linhas.map((l) => registroFr3(l, nums)), frxDBDataset1: [await empresaParaRelatorio(db, emp)] },
      variaveis: { REGIME: `'Periodo: ${br(f.dtini)} até ${br(f.dtfim)} Regime: ${regime}'`, PLANO_CONTAS_EXPANDIDO: f.expandido ? '1' : '0', VIMPRIMECMV: `'N'` },
    };
  }

  /**
   * RELATÓRIO DE CAIXA — CAIXA ABERTO (FRMRELATORIOCAIXA, `TRelCaixaAberto`, uRelatorioCaixa.pas:1593-1811): o que ainda vai entrar e sair —
   * os títulos a pagar em aberto (QUITADA 'N' ou nula) rateados pelos centros de custo do grupo (CX_APAGAR, base Σ VALOR+VENDOR do grupo,
   * × −1), os lançamentos do CAIXA gerados pelas baixas em lote/cartão/juros/produção/adiantamento (os 6 textos do legado, literais), o
   * C.M.V. das vendas do período (com o custo de reposição, se marcado) e o que há a receber: títulos em aberto pelo TOTAL com o juro até
   * hoje (GET_ARECEBER_COM_AGRUPADOS = a get_areceber com QUITADA 'N', mig 410), cheques não baixados e cartões não liberados (no cofre da
   * forma). A data: EMISSÃO = compra/lançamento/venda/emissão; VENCIMENTO = vencimento do título, DTVENC do caixa, BOM_PARA do cheque e a
   * previsão de compensação do cartão (a da GET_CARTAO da produção: dias de fechamento da loja se > 0, senão os da operadora base, × a
   * parcela, e o fim de semana empurrado para segunda). O C.M.V. também tira a conta de CMV da empresa logada do CAIXA. Sintético agrupa
   * as despesas por conta (Rel_BalanceteRegimeCaixa.fr3); Analítico lista com observação/parceiro/razão (o Detalhado). Só o código do
   * centro de custo filtra (o legado desabilita operador/fiscal/PDV/tipo de conta). O recorte do proprietário pelo CODPLC_NVL1.
   * Diferença deliberada: com o C.M.V. marcado e a empresa sem conta de CMV o legado monta `P.CODPLC <> ` vazio (ORA-00936); aqui o filtro
   * só entra quando há a conta.
   */
  async consultarAberto(f: FiltroCaixaAberto): Promise<{ linhas: Record<string, unknown>[]; niveis: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const lojas = await empresasDoOperador(db, f.empresas);
    const { niveis, acima } = await estruturaPlc(db, emp);
    const periodo = (d: RawBuilder<unknown>) => sql`${d} BETWEEN ${f.dtini}::date AND ${f.dtfim}::date`;
    const emissao = f.data === 'EMISSAO';
    const analitico = f.tipo === 1;
    const pf = parteFixa(acima);
    const pg = parteFixaGrupo(acima);
    const jf = joinFixo(niveis);
    const plcLike = f.plc ? sql`AND p.desccodplc LIKE ${`${f.plc}%`}` : sql``;
    const contacmv = f.cmv
      ? ((await db.selectFrom('empresas').select('contacmv').where('idempresa', '=', emp).executeTakeFirst()) as { contacmv?: number | null } | undefined)?.contacmv ?? null
      : null;
    const custo = f.custoReposicao ? sql`coalesce(v.vrcustorep, v.vrcusto)` : sql`v.vrcusto`;
    const extras = (obs: RawBuilder<unknown>, cod: RawBuilder<unknown>, razao: RawBuilder<unknown>) => (analitico ? sql`, ${obs}, ${cod}, ${razao}` : sql``);
    const tp = sql`(SELECT nullif(sum(w.valor) + sum(coalesce(w.vendor, 0)), 0) FROM apagar w WHERE w.codgrupo = g.codgrupo)`;
    const fromPagar = sql`
        FROM apagar a
        LEFT JOIN cx_apagar g ON g.codgrupo = a.codgrupo
        LEFT JOIN plc p ON p.codplc = g.codcc
        LEFT JOIN parceiros par ON par.codparceiro = a.codparceiro
        ${jf}
       WHERE ${periodo(emissao ? sql`a.dtcompra` : sql`a.dtvenc::date`)} AND p.desccodplc IS NOT NULL ${plcLike}
         AND (a.quitada = 'N' OR a.quitada IS NULL) AND a.codempresa = ANY(${lojas}::int[])`;
    const caixaLote = (producao: string) => sql`
      SELECT p.desccodplc, p.descricao, i.valor ${pf}, p.tpconta ${extras(sql`i.obs::text`, sql`i.codparceiro`, sql`par.razao::text`)}
        FROM caixa i
        LEFT JOIN plc p ON p.codplc = i.codplc
        LEFT JOIN parceiros par ON par.codparceiro = i.codparceiro
        ${jf}
       WHERE (i.obs LIKE 'Referenta a baixa a pagar do lote%' OR i.obs LIKE 'Referenta a baixa de cartao do lote%' OR i.obs LIKE 'Ref. juros pgto lote%'
              OR i.obs LIKE 'Ref. a bx cartao lote%' OR i.obs LIKE ${producao} OR i.obs LIKE 'Originado do lancamento do adiantamento de parceiro com mesmo CNPJ.%')
         AND ${periodo(emissao ? sql`i.data::date` : sql`i.dtvenc`)} AND p.desccodplc IS NOT NULL ${plcLike} AND i.idempresa = ANY(${lojas}::int[])
         ${contacmv != null ? sql`AND p.codplc <> ${contacmv}` : sql``}`;
    const cmv = f.cmv ? sql`
      UNION ALL
      SELECT p.desccodplc, p.descricao, (sum(CAST(v.qtde * ${custo} AS numeric(13,2)))) * -1 AS valor ${pf}, p.tpconta ${extras(sql`NULL::text`, sql`NULL::integer`, sql`NULL::text`)}
        FROM vendas v
        LEFT JOIN empresas e ON e.idempresa = v.idempresa
        LEFT JOIN plc p ON p.codplc = e.contacmv
        ${jf}
       WHERE ${periodo(sql`v.dtvenda::date`)} AND p.desccodplc LIKE ${`${f.plc ?? ''}%`} AND v.idempresa = ANY(${lojas}::int[]) AND v.cancelado = 'N'
       GROUP BY e.contacmv, p.desccodplc, p.descricao, p.codpai ${pg}, p.tpconta` : sql``;

    // o que há a receber (GetSQLRestante): títulos, cheques e cartões em aberto, com o começo do código por fora
    const previsao = sql`(CASE extract(dow FROM pc.d) WHEN 0 THEN pc.d + 1 WHEN 6 THEN pc.d + 2 ELSE pc.d END)`;
    const receber = sql`
      SELECT p.desccodplc, p.descricao, CAST(coalesce(sum(a.total), 0) AS numeric(18,2)) AS valor ${pf}, p.tpconta
             ${extras(sql`r.obs::text`, sql`a.codparceiro`, sql`a.razao::text`)}
        FROM get_areceber a
        JOIN areceber r ON r.codrcb = a.codrcb
        JOIN plc p ON p.codplc = a.codplc
        ${jf}
       WHERE a.quitada = 'N' AND ${periodo(emissao ? sql`a.dtvenda::date` : sql`a.dtvenc::date`)} AND a.codempresa = ANY(${lojas}::int[])
       GROUP BY p.desccodplc, p.descricao, p.codplc, p.codpai ${pg}, p.tpconta ${analitico ? sql`, r.obs, a.codparceiro, a.razao` : sql``}`;
    const cheque = sql`
      SELECT p.desccodplc, p.descricao, CAST(coalesce(sum(c.valor), 0) AS numeric(18,2)) ${pf}, p.tpconta
             ${extras(sql`c.observacao::text`, sql`c.codigo_cliente`, sql`c.cliente::text`)}
        FROM get_cheque c
        JOIN formas_pgto f ON f.idpgto = c.idpgto
        JOIN plc p ON p.codplc = f.plccofre
        ${jf}
       WHERE ${periodo(emissao ? sql`c.data_emissao` : sql`c.bom_para`)} AND c.idempresa = ANY(${lojas}::int[])
       GROUP BY p.desccodplc, p.descricao, p.codplc, p.codpai ${pg}, p.tpconta ${analitico ? sql`, c.observacao, c.codigo_cliente, c.cliente` : sql``}`;
    const cartao = sql`
      SELECT p.desccodplc, p.descricao, CAST(coalesce(sum(c.valor), 0) AS numeric(18,2)) ${pf}, p.tpconta
             ${extras(sql`NULL::text`, sql`ot.codoperadoras`, sql`ot.operadora::text`)}
        FROM cartao c
        LEFT JOIN operadoras o ON o.codoperadoras = c.codoperadora
        LEFT JOIN operadoras ot ON ot.codoperadoras = CASE WHEN coalesce(o.codoperadorabase, 0) > 0 THEN o.codoperadorabase ELSE o.codoperadoras END
        LEFT JOIN operadoras_taxa otx ON otx.codoperadoras = ot.codoperadoras AND otx.idempresa = c.idempresa
        CROSS JOIN LATERAL (SELECT c.dtvenda::date + (CASE WHEN coalesce(otx.diafechamento, 0) > 0 THEN otx.diafechamento ELSE coalesce(ot.diascomp, 0) END
                                                     * coalesce(c.nroparcela, 1))::int AS d) pc
        JOIN formas_pgto f ON f.idpgto = c.idpgto
        JOIN plc p ON p.codplc = f.plccofre
        ${jf}
       WHERE coalesce(c.liberado, 'N') = 'N' AND ${periodo(emissao ? sql`c.dtvenda::date` : previsao)} AND c.idempresa = ANY(${lojas}::int[])
       GROUP BY p.desccodplc, p.descricao, p.codplc, p.codpai ${pg}, p.tpconta ${analitico ? sql`, ot.codoperadoras, ot.operadora` : sql``}`;
    const restante = sql`SELECT cur.* FROM (${receber} UNION ALL ${cheque} UNION ALL ${cartao}) cur ${f.plc ? sql`WHERE cur.desccodplc LIKE ${`${f.plc}%`}` : sql``}`;

    let consulta: RawBuilder<unknown>;
    if (analitico) {
      consulta = sql`
        SELECT p.desccodplc, p.descricao, CAST(((((a.valor) + (coalesce(a.vendor, 0))) * (g.valor * 100) / ${tp}) / 100) * (-1) AS numeric(13,2)) AS valor ${pf}, p.tpconta,
               a.obs::text AS obs, a.codparceiro, par.razao::text AS razao
        ${fromPagar}
        UNION ALL ${caixaLote('%Referente a Producao%')}
        ${cmv}
        UNION ALL ${restante}
        ORDER BY 1, 2`;
    } else {
      const nvlAux = colunasNvl(acima, 'aux');
      consulta = sql`
        SELECT aux.desccodplc, aux.descricao, CAST(sum(aux.valor) AS numeric(18,2)) AS valor ${nvlAux}, aux.tpconta
          FROM (
            SELECT p.desccodplc, p.descricao, CAST(((((sum(a.valor) + (sum(coalesce(a.vendor, 0)))) * (g.valor * 100) / ${tp})) / 100) * (-1) AS numeric(13,2)) AS valor ${pf}, p.tpconta
            ${fromPagar}
             GROUP BY p.desccodplc, p.descricao, g.valor, g.codgrupo, p.codpai, a.codparceiro, par.razao ${pg}, p.tpconta
            UNION ALL ${caixaLote('Referente a Producao%')}
            ${cmv}
          ) aux
         GROUP BY aux.desccodplc, aux.descricao ${nvlAux}, aux.tpconta
        UNION ALL ${restante}
        ORDER BY 1, 2`;
    }
    let linhas = (await consulta.execute(db)).rows as Record<string, unknown>[];
    const ocultos = await plcsOcultosDoOperador(db);
    if (ocultos.size && niveis > 1) linhas = linhas.filter((l) => !ocultos.has(Number(l.codplc_nvl1)));
    return { linhas, niveis };
  }

  /** «Imprimir» do Aberto: Sintético → Rel_BalanceteRegimeCaixa.fr3 · Analítico → Rel_BalanceteRegimeCaixaDetalhado.fr3 */
  async impressaoAberto(f: FiltroCaixaAberto) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = await this.consultarAberto(f);
    const nums = new Set(['valor', 'tpconta', 'codparceiro', ...Array.from({ length: r.niveis - 1 }, (_, i) => `codplc_nvl${i + 1}`)]);
    const br = (d: string) => d.split('-').reverse().join('/');
    const regime = f.data === 'EMISSAO' ? 'Caixa Aberto (emissão)' : 'Caixa Aberto (vencimento)';
    return {
      titulo: 'Caixa',
      modelo: await modeloFr3(db, f.tipo === 1 ? 'Rel_BalanceteRegimeCaixaDetalhado.fr3' : 'Rel_BalanceteRegimeCaixa.fr3'),
      datasets: { frxDBDataset2: r.linhas.map((l) => registroFr3(l, nums)), frxDBDataset1: [await empresaParaRelatorio(db, emp)] },
      variaveis: { REGIME: `'Periodo: ${br(f.dtini)} até ${br(f.dtfim)} Regime: ${regime}'`, PLANO_CONTAS_EXPANDIDO: f.expandido ? '1' : '0', VIMPRIMECMV: `'N'` },
    };
  }
}
