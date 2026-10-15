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
}
