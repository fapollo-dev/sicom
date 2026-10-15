import { Injectable } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { empresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { empresaParaRelatorio, registroFr3 } from '../../shared/relatorios/registro-fr3';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;

export interface FiltroCaixaCompetencia {
  dtini: string; dtfim: string;
  /** cbbRelatorios 0/1: Competência (emissão) ou (vencimento) */
  regime: 'EMISSAO' | 'VENCIMENTO';
  /** rdgRelatorio: 0 Totalizado · 1 Recursos · 2 Recursos totalizado · 3 Agrupado geral */
  modelo: 0 | 1 | 2 | 3;
  /** rdgTipoRel no modelo Recursos ("Ordenação por centro de custo"): 0 pelo código · 1 pela descrição */
  ordenacao?: 0 | 1;
  empresas?: number[];
  codoperador?: number | null; codfiscal?: number | null; codpdv?: number | null;
  /** edtPLC: o começo do código do centro de custo (DESCCODPLC LIKE 'x%') */
  plc?: string | null;
  /** cbbTpConta: 0 receita · 1 despesa · 2 neutra */
  tpconta?: 0 | 1 | 2 | null;
  obs?: string | null;
  cmv?: boolean; taxasCartao?: boolean; notasFiscais?: boolean; custoReposicao?: boolean;
  /** RgpFiltroData (só na emissão): a data da nota que filtra o lançamento com nota */
  dataNota?: 'DTCONTABIL' | 'DTEMISSAO';
  /** chkPlanoContasExpandido (Totalizado e Recursos totalizado): a variável PLANO_CONTAS_EXPANDIDO do layout */
  expandido?: boolean;
}

const LAYOUT: Record<number, string> = {
  0: 'Rel_CaixaTotalizado.fr3', 1: 'cx_Recursos_Caixa.fr3', 2: 'Rel_RecursosTotalizado.fr3', 3: 'cx_Totalizado_Geral_Caixa.fr3',
};

/**
 * RELATÓRIO DE CAIXA — COMPETÊNCIA (FRMRELATORIOCAIXA, `TRelCompetencia`, uRelatorioCaixa.pas:1810-2220). O livro-caixa (CAIXA) do período
 * por centro de custo, com a hierarquia do plano gerencial nos níveis da máscara da empresa (EMPRESAS.MASCARAPLC — '#.##.###' na
 * produção: o nível 1 e o 2 acima da conta, `GetJoinFixo`/`GetParteFixaSQL`), crédito/débito pelo TPCONTA (0 receita · 1 despesa · 2
 * neutra = 0) e os filtros do `SetFiltro` (operador, fiscal de caixa, PDV, lojas do GetMultiEmpresa, observação/descrição, código do
 * centro de custo, tipo de conta). A data: na EMISSÃO, a da nota do lançamento (DTCONTABIL ou DTEMISSAO, RgpFiltroData) ou a do
 * lançamento; no VENCIMENTO, o DTVENC. Fica de fora o lançamento "DUPLICATA GERADA REFERENTE A BAIXA PARCIAL".
 * Opções (cada uma uma perna em UNION ALL, como o legado):
 *  · C.M.V. (`ckCmv`): tira a conta de CMV da empresa (e, pelo `DesconsideraPLCPaiCMV`, todo o grupo principal dela) e soma o custo das
 *    vendas — na emissão, Σ(qtde × custo) das vendas do período (`GetSQLCMVEmissao`); no vencimento, o custo proporcional ao que entrou
 *    no caixa (à vista pela data do caixa, a prazo pelo vencimento da parcela — `GetSQLCMVVencimento`); "custo de reposição" troca o custo;
 *  · Taxas de cartão (`cbTaxasCartao`, só na emissão): tira a conta de taxas e soma −Σ(valor × TXADM da operadora/loja) dos cartões;
 *  · Notas fiscais (`cbNF`): soma o TOTALNF das notas de venda (CFOP 5102/6102/5402/6402/5403/6403/5405/6405) com título, na conta de
 *    cofre da forma de pagamento.
 * E o recorte do `FiltraPLCProprietario` (:268): quem não é PRO não vê os centros de custo marcados APENAS_PROPRIETARIO — a conta, os
 * de baixo (até 3 níveis) e os de cima delas, como a lista do legado.
 */
@Injectable()
export class RelCaixaCompetenciaService {
  constructor(private readonly dbp: DatabaseProvider, private readonly config: ConfigService) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async consultar(f: FiltroCaixaCompetencia): Promise<{ linhas: Record<string, unknown>[]; niveis: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const lojas = await empresasDoOperador(db, f.empresas);
    const tz = String((await this.config.resolver('FUSO_HORARIO_ACESSO', { empresaId: emp })) ?? 'America/Sao_Paulo');
    const mascara = String(((await db.selectFrom('empresas').select('mascaraplc').where('idempresa', '=', emp).executeTakeFirst()) as { mascaraplc?: string } | undefined)?.mascaraplc ?? '#.##.###');
    const niveis = Math.max(1, mascara.split('.').filter((x) => x !== '').length);
    const acima = Array.from({ length: niveis - 1 }, (_, i) => i + 1); // 1..niveis-1
    // as colunas timestamptz viram o dia da loja; as date (NF.DTEMISSAO/DTCONTABIL, CAIXA.DTVENC) já são o dia
    const dia = (col: RawBuilder<unknown>) => sql`(${col} AT TIME ZONE ${tz})::date`;
    const noPeriodo = (d: RawBuilder<unknown>) => sql`${d} BETWEEN ${f.dtini}::date AND ${f.dtfim}::date`;
    const entre = (col: RawBuilder<unknown>) => noPeriodo(dia(col));
    const custo = f.custoReposicao ? sql`coalesce(v.vrcustorep, v.vrcusto)` : sql`v.vrcusto`;
    const emissao = f.regime === 'EMISSAO';

    // a hierarquia do plano gerencial: P2 é o pai da conta, P1 o avô… (GetJoinFixo) e as colunas _NVLn (GetParteFixaSQL, com o LIMITEPLC
    // que o layout da produção lê)
    const joinFixo = (alias = 'p') => sql.join(acima.slice().reverse().map((i) => sql.raw(
      `LEFT JOIN plc p${i} ON p${i}.codplc = ${i === niveis - 1 ? alias : `p${i + 1}`}.codpai`)), sql.raw(' '));
    const parteFixa = sql.raw(acima.map((i) => `, p${i}.codplc AS codplc_nvl${i}, p${i}.descricao AS descricao_nvl${i}, p${i}.desccodplc AS desccodplc_nvl${i}, p${i}.limiteplc AS limiteplc_nvl${i}`).join(''));
    const tpcontaTxt = (col: string) => sql.raw(`CASE WHEN ${col} = 0 THEN 'C' WHEN ${col} = 1 THEN 'D' WHEN ${col} = 2 THEN 'N' END`);
    const tp = f.tpconta == null ? null : sql`p.tpconta = ${f.tpconta}`;
    const plcLike = f.plc ? sql`p.desccodplc LIKE ${`${f.plc}%`}` : null;
    const obsUp = f.obs ? `%${f.obs.toUpperCase()}%` : null;
    const e = (xs: Array<RawBuilder<unknown> | null>) => sql.join(xs.filter((x): x is RawBuilder<unknown> => x != null).map((x) => sql`AND ${x}`), sql.raw(' '));

    // (1) o livro-caixa (GetSQLCompetencia + o SetFiltro)
    const filtroData = emissao
      ? noPeriodo(sql`coalesce(${sql.ref(f.dataNota === 'DTEMISSAO' ? 'nf.dtemissao' : 'nf.dtcontabil')}, ${dia(sql`c.data`)})`)
      : noPeriodo(sql`c.dtvenc`);
    let principal: RawBuilder<unknown> = sql`
      SELECT coalesce(nf.dtcontabil, ${dia(sql`c.data`)}) AS data, c.operador, c.codplc, c.tiporecurso, c.obs, pa.razao, nf.nronf,
             p.desccodplc, p.descricao, p.codpai, ${tpcontaTxt('p.tpconta')} AS tpconta,
             CAST(CASE WHEN p.tpconta IN (0, 1) THEN c.valor WHEN p.tpconta = 2 THEN 0 END AS numeric(18,2)) AS valor_somar,
             CAST(coalesce(CASE WHEN p.tpconta = 0 THEN c.valor WHEN p.tpconta IN (1, 2) THEN 0 END, 0) AS numeric(18,2)) AS total_credito,
             CAST(coalesce(CASE WHEN p.tpconta = 1 THEN c.valor WHEN p.tpconta IN (0, 2) THEN 0 END, 0) AS numeric(18,2)) AS total_debito,
             CAST(c.valor AS numeric(18,2)) AS valor ${parteFixa}, p.limiteplc, o.nome, emp.contacmv, c.codcx
        FROM caixa c
        JOIN plc p ON p.codplc = c.codplc
        ${joinFixo()}
        LEFT JOIN operadores o ON o.codoperador = c.operador
        LEFT JOIN parceiros pa ON pa.codparceiro = c.codparceiro
        LEFT JOIN nf ON nf.codnf = c.codnf
        LEFT JOIN empresas emp ON emp.idempresa = c.idempresa
       WHERE ${filtroData}
         AND c.idempresa = ANY(${lojas}::int[])
         ${e([
           f.codoperador ? sql`c.operador = ${f.codoperador}` : null,
           f.codfiscal ? sql`c.codfiscalcx = ${f.codfiscal}` : null,
           f.codpdv ? sql`c.codpdv = ${f.codpdv}` : null,
           obsUp ? sql`(upper(c.obs) LIKE ${obsUp} OR upper(p.descricao) LIKE ${obsUp})` : null,
           plcLike, tp,
           sql`(NOT (c.obs LIKE '%DUPLICATA GERADA REFERENTE A BAIXA PARCIAL%') OR c.obs IS NULL)`,
           f.cmv ? sql`(c.codplc <> emp.contacmv OR emp.contacmv IS NULL)` : null,
           f.taxasCartao && emissao ? sql`(c.codplc <> emp.codplc_taxas_cartao OR emp.codplc_taxas_cartao IS NULL)` : null,
         ])}`;
    // DesconsideraPLCPaiCMV: sem o grupo principal da conta de CMV (o nível 1 cuja DESCCODPLC é o 1º dígito da conta de CMV + '.')
    if (f.cmv && niveis > 1) {
      principal = sql`SELECT cur.* FROM (${principal}) cur LEFT JOIN plc plccmv ON plccmv.codplc = cur.contacmv
        WHERE (cur.codplc_nvl1 <> (SELECT pl.codplc FROM plc pl WHERE trim(pl.desccodplc) = substr(trim(plccmv.desccodplc), 1, 1) || '.' LIMIT 1) OR cur.contacmv IS NULL)`;
    }
    const pernas: RawBuilder<unknown>[] = [principal];

    // (2) o C.M.V.
    if (f.cmv) {
      if (emissao) {
        pernas.push(sql`
          SELECT NULL::date AS data, NULL::numeric AS operador, emp.contacmv AS codplc, NULL AS tiporecurso, NULL AS obs, NULL AS razao, NULL AS nronf,
                 p.desccodplc, p.descricao, p.codpai, ${tpcontaTxt('p.tpconta')} AS tpconta,
                 CAST(CASE WHEN p.tpconta IN (0, 1) THEN CAST(sum(CAST(v.qtde * ${custo} AS numeric(13,2))) * -1 AS numeric(13,2)) WHEN p.tpconta = 2 THEN 0 END AS numeric(18,2)),
                 CAST(coalesce(CASE WHEN p.tpconta = 0 THEN CAST(sum(CAST(v.qtde * ${custo} AS numeric(13,2))) * -1 AS numeric(13,2)) WHEN p.tpconta IN (1, 2) THEN 0 END, 0) AS numeric(18,2)),
                 CAST(coalesce(CASE WHEN p.tpconta = 1 THEN CAST(sum(CAST(v.qtde * ${custo} AS numeric(13,2))) * -1 AS numeric(13,2)) WHEN p.tpconta IN (0, 2) THEN 0 END, 0) AS numeric(18,2)),
                 CAST(sum(CAST(v.qtde * ${custo} AS numeric(13,2))) * -1 AS numeric(13,2)) ${parteFixa}, p.limiteplc, NULL AS nome, NULL::numeric AS contacmv, NULL::numeric AS codcx
            FROM vendas v
            LEFT JOIN empresas emp ON emp.idempresa = v.idempresa
            LEFT JOIN plc p ON p.codplc = emp.contacmv
            ${joinFixo()}
           WHERE ${entre(sql`v.dtvenda`)} AND v.idempresa = ANY(${lojas}::int[]) AND v.cancelado = 'N'
             ${e([plcLike, f.obs ? sql`p.descricao LIKE ${`%${f.obs}%`}` : null, tp])}
           GROUP BY emp.contacmv, p.desccodplc, p.descricao, p.codpai, p.tpconta, p.limiteplc
             ${sql.raw(acima.map((i) => `, p${i}.codplc, p${i}.descricao, p${i}.desccodplc, p${i}.limiteplc`).join(''))}`);
      } else {
        // GetSQLCMVVencimento: o custo de cada venda na proporção do que entrou — à vista (destino CXA) pela data do caixa; a prazo pela
        // parcela do CAIXA (mesmo CODGRUPO) que vence no período
        const venda = sql`CASE WHEN v.iat = 'A' THEN CAST(v.qtde * v.vrvenda AS numeric(18,2)) ELSE CAST(trunc((v.qtde * v.vrvenda) * 100) AS numeric(18,2)) / 100 END
              + (CASE WHEN coalesce(v.desc_acre_medio, 0) > 0 THEN coalesce(v.desc_acre_medio, 0) ELSE 0 END + CASE WHEN coalesce(v.desc_acre_item, 0) > 0 THEN coalesce(v.desc_acre_item, 0) ELSE 0 END)
              - (coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0)
                 + CASE WHEN coalesce(v.desc_acre_medio, 0) < 0 THEN coalesce(v.desc_acre_medio, 0) * -1 ELSE 0 END
                 + CASE WHEN coalesce(v.desc_acre_item, 0) < 0 THEN coalesce(v.desc_acre_item, 0) * -1 ELSE 0 END)`;
        const interno = (filtroCx: RawBuilder<unknown>, filtroVenda: RawBuilder<unknown> | null) => sql`
          SELECT ven.contacmv, ven.desccodplc, ven.descricao, ven.codpai, ven.tpconta, CAST(sum(ven.custo * ven.valor / nullif(ven.total_venda, 0)) AS numeric(18,2)) AS valor_somar
            FROM (SELECT v.nropedido, v.idempresa, emp.contacmv, p.desccodplc, p.descricao, p.codpai, p.tpconta, vrcx.valor,
                         sum(v.qtde * ${custo}) AS custo, sum(${venda}) AS total_venda
                    FROM empresas emp
                    JOIN plc p ON p.codplc = emp.contacmv
                    JOIN vendas v ON emp.idempresa = v.idempresa
                    JOIN (SELECT cx.nropedido, cx.idempresa, sum(cx.valor - coalesce(cx.troco, 0)) AS valor
                            FROM cx_vendas cx
                            JOIN formas_pgto fp ON cx.operacao = fp.modalidade AND cx.idempresa::numeric = fp.idempresa::numeric
                           WHERE cx.idempresa = ANY(${lojas}::int[]) AND ${filtroCx}
                           GROUP BY cx.nropedido, cx.idempresa) vrcx ON vrcx.nropedido = v.nropedido AND vrcx.idempresa::numeric = v.idempresa::numeric
                   WHERE v.idempresa = ANY(${lojas}::int[]) ${filtroVenda ? sql`AND ${filtroVenda}` : sql``} AND v.cancelado = 'N'
                     ${e([plcLike, f.obs ? sql`p.descricao LIKE ${`%${f.obs}%`}` : null, tp])}
                   GROUP BY v.nropedido, v.idempresa, emp.contacmv, p.desccodplc, p.descricao, p.codpai, p.tpconta, vrcx.valor) ven
           GROUP BY ven.contacmv, ven.desccodplc, ven.descricao, ven.codpai, ven.tpconta`;
        const comum = (inner: RawBuilder<unknown>) => sql`
          SELECT NULL::date AS data, NULL::numeric AS operador, ven2.contacmv, NULL AS tiporecurso, NULL AS obs, NULL AS razao, NULL AS nronf,
                 ven2.desccodplc, ven2.descricao, ven2.codpai, ${tpcontaTxt('ven2.tpconta')} AS tpconta,
                 CAST(CASE WHEN ven2.tpconta = 0 THEN valor_somar WHEN ven2.tpconta = 1 THEN valor_somar * -1 WHEN ven2.tpconta = 2 THEN 0 END AS numeric(18,2)) AS valor_somar,
                 CAST(coalesce(CASE WHEN ven2.tpconta = 0 THEN valor_somar WHEN ven2.tpconta IN (1, 2) THEN 0 END, 0) AS numeric(18,2)) AS total_credito,
                 CAST(coalesce(CASE WHEN ven2.tpconta = 1 THEN valor_somar * -1 WHEN ven2.tpconta IN (0, 2) THEN 0 END, 0) AS numeric(18,2)) AS total_debito,
                 CAST(CASE WHEN ven2.tpconta = 0 THEN valor_somar WHEN ven2.tpconta = 1 THEN valor_somar * -1 WHEN ven2.tpconta = 2 THEN 0 END AS numeric(18,2)) AS valor,
                 NULL AS nome, NULL::numeric AS codcx
            FROM (${inner}) ven2`;
        const aVista = comum(interno(sql`fp.destino = 'CXA' AND ${entre(sql`cx.data`)}`, entre(sql`v.dtvenda`)));
        const aPrazo = comum(interno(sql`fp.destino <> 'CXA' AND cx.codgrupo IN (SELECT c.codgrupo FROM caixa c WHERE c.idempresa = cx.idempresa AND c.codgrupo = cx.codgrupo AND ${entre(sql`c.dtvenc`)})`, null));
        pernas.push(sql`
          SELECT pv.data, pv.operador, pv.contacmv AS codplc, pv.tiporecurso, pv.obs, pv.razao, pv.nronf, pv.desccodplc, pv.descricao, pv.codpai, pv.tpconta,
                 sum(pv.valor_somar), sum(pv.total_credito), sum(pv.total_debito), sum(pv.valor) ${parteFixa}, p.limiteplc, pv.nome, pv.contacmv, pv.codcx
            FROM (${aVista} UNION ALL ${aPrazo}) pv
            LEFT JOIN plc p ON p.desccodplc = pv.desccodplc AND p.codplc = pv.contacmv
            ${joinFixo('pv')}
           GROUP BY pv.data, pv.operador, pv.contacmv, pv.tiporecurso, pv.obs, pv.razao, pv.nronf, pv.desccodplc, pv.descricao, pv.codpai, pv.tpconta, pv.nome, pv.codcx, p.limiteplc
             ${sql.raw(acima.map((i) => `, p${i}.codplc, p${i}.descricao, p${i}.desccodplc, p${i}.limiteplc`).join(''))}`);
      }
    }

    // (3) as taxas de cartão (GetSQLTaxasCartao — só na emissão)
    if (f.taxasCartao && emissao) {
      const tx = sql`CAST(sum((ct.valor * (CASE WHEN coalesce(otx.txadm, 0) > 0 THEN coalesce(otx.txadm, 0) ELSE coalesce(ot.txadm, 0) END)) / 100) * -1 AS numeric(18,2))`;
      pernas.push(sql`
        SELECT NULL::date AS data, NULL::numeric AS operador, p.codplc, 'CARTAO' AS tiporecurso, NULL AS obs, NULL AS razao, NULL AS nronf,
               p.desccodplc, p.descricao, p.codpai, 'D' AS tpconta, ${tx}, 0, ${tx}, ${tx} ${parteFixa}, p.limiteplc, NULL AS nome, NULL::numeric, NULL::numeric
          FROM cartao ct
          JOIN empresas emp ON emp.idempresa = ct.idempresa
          JOIN plc p ON p.codplc = emp.codplc_taxas_cartao
          JOIN operadoras op ON op.codoperadoras = ct.codoperadora
          JOIN operadoras ot ON ot.codoperadoras = CASE WHEN coalesce(op.codoperadorabase, 0) > 0 THEN op.codoperadorabase ELSE op.codoperadoras END
          LEFT JOIN operadoras_taxa otx ON otx.codoperadoras = ot.codoperadoras AND otx.idempresa = ct.idempresa
          ${joinFixo()}
         WHERE ${entre(sql`ct.dtvenda`)} AND ct.idempresa = ANY(${lojas}::int[])
           ${e([f.codoperador ? sql`ct.codoperador = ${f.codoperador}` : null, f.codpdv ? sql`ct.codpdv = ${f.codpdv}` : null, plcLike, tp])}
         GROUP BY p.codplc, p.desccodplc, p.descricao, p.codpai, p.limiteplc
           ${sql.raw(acima.map((i) => `, p${i}.codplc, p${i}.descricao, p${i}.desccodplc, p${i}.limiteplc`).join(''))}`);
    }

    // (4) as notas fiscais de venda com título (GetSQLNotasFiscais)
    if (f.notasFiscais) {
      pernas.push(sql`
        SELECT n.dtemissao AS data, NULL::numeric AS operador, p.codplc, NULL AS tiporecurso, n.obs, pa.razao, n.nronf,
               p.desccodplc, p.descricao, p.codpai, 'C' AS tpconta, CAST(n.totalnf AS numeric(18,2)), CAST(n.totalnf AS numeric(18,2)), CAST(0 AS numeric(18,2)),
               CAST(n.totalnf AS numeric(18,2)) ${parteFixa}, p.limiteplc, o.nome, NULL::numeric, NULL::numeric
          FROM nf n
          JOIN areceber r ON r.idnf = n.codnf
          JOIN formas_pgto fp ON fp.idpgto = r.idpgto
          JOIN plc p ON fp.plccofre = p.codplc
          ${joinFixo()}
          LEFT JOIN operadores o ON o.codoperador = n.codvendedor
          LEFT JOIN parceiros pa ON pa.codparceiro = n.codparceiro
          LEFT JOIN empresas emp ON emp.idempresa = n.idempresa
         WHERE n.cfop IN ('5102', '6102', '5402', '6402', '5403', '6403', '5405', '6405')
           AND ${emissao ? noPeriodo(sql`n.dtemissao`) : entre(sql`r.dtvenc`)}
           AND n.idempresa = ANY(${lojas}::int[])
           ${e([
             f.codoperador ? sql`n.codvendedor = ${f.codoperador}` : null,
             obsUp ? sql`(upper(n.obs) LIKE ${obsUp} OR upper(p.descricao) LIKE ${obsUp})` : null,
             plcLike, tp,
             f.cmv ? sql`(p.codplc <> emp.contacmv OR emp.contacmv IS NULL)` : null,
             f.taxasCartao ? sql`(p.codplc <> emp.codplc_taxas_cartao OR emp.codplc_taxas_cartao IS NULL)` : null,
           ])}`);
    }

    // o ORDER BY de cada modelo (8 = DESCCODPLC, 1 = DATA, 4 = TIPORECURSO, 9 = DESCRICAO)
    const ordem = f.modelo === 0 ? 'ORDER BY 8, 1' : f.modelo === 3 ? 'ORDER BY 9' : f.modelo === 1 && f.ordenacao === 1 ? 'ORDER BY 4, 9' : 'ORDER BY 4, 8';
    const consulta = sql`${sql.join(pernas, sql.raw(' UNION ALL '))} ${sql.raw(ordem)}`;
    let linhas = (await consulta.execute(db)).rows as Record<string, unknown>[];

    // FiltraPLCProprietario: quem não é PRO não vê os centros de custo de proprietário
    const op = currentTenant().operadorId ?? null;
    const tipoop = op == null ? null : ((await db.selectFrom('operadores').select('tipoop').where('codoperador', '=', op).executeTakeFirst()) as { tipoop?: string } | undefined)?.tipoop;
    if (String(tipoop ?? '') !== 'PRO') {
      const lista = await this.plcsDeProprietario(db);
      if (lista.size) linhas = linhas.filter((l) => !lista.has(Number(l.codplc)));
    }
    return { linhas, niveis };
  }

  /** a lista do SetListaCodPLCProprietario (:243): a conta de proprietário, as abaixo dela (até 3 níveis) e as de cima de cada uma */
  private async plcsDeProprietario(db: AnyDB): Promise<Set<number>> {
    const rows = (await sql<{ a: number | null; b: number | null; c: number | null; d: number | null }>`
      SELECT p4.codplc AS a, p3.codplc AS b, p2.codplc AS c, p1.codplc AS d
        FROM plc p4 LEFT JOIN plc p3 ON p4.codpai = p3.codplc LEFT JOIN plc p2 ON p3.codpai = p2.codplc LEFT JOIN plc p1 ON p2.codpai = p1.codplc
       WHERE p4.apenas_proprietario = 'S' OR p3.apenas_proprietario = 'S' OR p2.apenas_proprietario = 'S' OR p1.apenas_proprietario = 'S'`.execute(db)).rows;
    const s = new Set<number>();
    for (const r of rows) for (const v of [r.a, r.b, r.c, r.d]) if (v != null) s.add(Number(v));
    return s;
  }

  /** «Imprimir» (btnImprimirClick :232): o layout do modelo com o frxDBDatasetCaixa, a empresa e as variáveis do legado */
  async impressao(f: FiltroCaixaCompetencia) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = await this.consultar(f);
    if (!r.linhas.length) throw new BusinessRuleError('RELATORIO_SEM_REGISTROS', {}, 'Dados não encontrados com os Filtros informados, Verifique!');
    const nums = new Set(['operador', 'codplc', 'codpai', 'valor_somar', 'total_credito', 'total_debito', 'valor', 'contacmv', 'codcx', 'limiteplc',
      ...Array.from({ length: r.niveis - 1 }, (_, i) => [`codplc_nvl${i + 1}`, `limiteplc_nvl${i + 1}`]).flat()]);
    const linhas = r.linhas.map((l) => registroFr3(l, nums));
    const br = (d: string) => d.split('-').reverse().join('/');
    const regime = f.regime === 'EMISSAO' ? 'Competencia (emissão)' : 'Competencia (vencimento)';
    return {
      titulo: 'Caixa',
      modelo: await modeloFr3(db, LAYOUT[f.modelo] ?? LAYOUT[0]),
      datasets: { frxDBDatasetCaixa: linhas, frxDBDataset1: [await empresaParaRelatorio(db, emp)] },
      variaveis: { REGIME: `'Periodo: ${br(f.dtini)} até ${br(f.dtfim)} Regime: ${regime}'`, PLANO_CONTAS_EXPANDIDO: f.expandido && (f.modelo === 0 || f.modelo === 2) ? '1' : '0', VIMPRIMECMV: `'N'` },
    };
  }
}
