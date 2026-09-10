import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { PrecificacaoCustoService } from './precificacao-custo.service';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** os CFOPs que contam como ENTRADA de mercadoria para o "último custo de reposição" (`dfm:424`). */
const CFOP_ENTRADA = ['1403', '2403', '1101', '2101', '1102', '2102', '1401', '2401', '1910', '2910', '1949', '2949', '1407', '2407'];
/** bonificação — excluída por padrão, porque mercadoria de graça não forma preço (`uPrecificacaoNF.pas:916`). */
const CFOP_BONIFICACAO = ['1910', '2910'];

export interface FiltroPrecificacaoNf {
  codnf?: number | null;
  nronf?: string | null;
  descricao?: string | null;
  fornecedor?: string | null;
  grupo?: string | null;
  dataIni?: string | null;
  dataFim?: string | null;
  incluirTransferencias?: boolean;
  incluirBonificacao?: boolean;
  /** só o que está com margem negativa — o que a tela pinta de vermelho. */
  somenteMargemNegativa?: boolean;
  /** o `rgPreco`: qual custo dirige a margem. Em branco, o que a configuração da empresa mandar. */
  tipoCusto?: TipoCusto | null;
}

/**
 * Os três tipos de custo do `rgPreco` (`uDMPrecificacaoNF:12`). **Cada um muda a fórmula da margem E a do
 * preço** — não é um filtro de exibição.
 */
export type TipoCusto = 'CSI' | 'BRUTO' | 'REPOSICAO';

/**
 * PRECIFICAÇÃO DE NF (`FRMPRECIFICACAONF`, `uPrecificacaoNF.pas` + `uDMPrecificacaoNF`).
 * Dossiê: `uPrecificacaoNF.md`. 236 acessos, 17 operadores.
 *
 * **É onde o preço de venda nasce.** Quando a mercadoria chega, esta tela lista os itens da nota com o custo
 * que veio nela, o preço que está valendo hoje e o sugerido — e o operador aplica, item a item ou em bloco.
 *
 * ⚠️ **ela não altera o preço**: grava um LOTE DE PREÇO (`lote_preco`, `PROCESSADO='N'`,
 * `uPrecificacaoNF.pas:996`). Quem muda o preço de fato é o processamento do lote, que também gera etiqueta e
 * carga de PDV. Essa separação é o que permite conferir antes de a loja mudar de preço, e foi mantida.
 *
 * As contas que vêm do legado:
 *  · **custo unitário** = `(VRCUSTO − desconto% × VRCUSTO) / FATOREMBAL` — o fator de embalagem é o que
 *    converte o custo da caixa para o custo da unidade que se vende, e vale **1** quando é zero ou nulo;
 *  · **quantidade** = `QUANTIDADE × FATOREMBAL`, pelo mesmo motivo, ao contrário;
 *  · ⚠️ **o markup é SEMPRE PERCENTUAL, e tem TRÊS semânticas** — uma por tipo de custo do `rgPreco`. A
 *    consulta traz `VRVENDA / custo` (razão), mas esse valor **nunca chega aos olhos do operador**:
 *    `btnVisualizar:412` percorre todas as linhas assim que a consulta abre e sobrescreve a coluna com
 *    `CalcularMargem`. O que se vê, e o que vai para o lote, é:
 *      · **BRUTO** → `((preço − VRCUSTO) × 100) / VRCUSTO`;
 *      · **REPOSIÇÃO** → o mesmo contra o custo de reposição;
 *      · **CSI** → não é markup nenhum: é a **margem líquida %**, com a escada fiscal inteira (ICMS e
 *        PIS/COFINS de saída, custo CSI, despesa operacional, IR e CSLL com piso zero). É daí que vem o
 *        nome da configuração `MARGEM_LIQUIDA_PRECIFICACAO_NF`;
 *  · **ICMS** sai de `DET_ALIQUOTA.ICM_EFETIVO` pela **UF do endereço do FORNECEDOR na nota**
 *    (`PARCEIROS_END.CODEND = NF.CODPARCEIRO_END`) — ⚠️ **não** pela UF da empresa, que é como a
 *    Rentabilidade por Categorias faz. São duas telas com a mesma coluna e origens diferentes, de propósito:
 *    aqui interessa de onde a mercadoria VEIO;
 *  · **último custo de reposição** = o `VRCUSTOREP` da última nota de ENTRADA processada e não cancelada
 *    daquele produto, com CFOP na lista de entrada e **excluindo a própria nota**.
 *
 * A escada de margem (PMZ, preço sugerido, lucro) **não é reimplementada aqui**: é a mesma do
 * `PrecificacaoCustoService`, que já a portou do `FRMPRIFICACAOCUSTO`. Esta tela alimenta aquele cálculo com
 * os componentes que vieram na nota.
 */
@Injectable()
export class PrecificacaoNfService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly custo: PrecificacaoCustoService,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async listar(f: FiltroPrecificacaoNf): Promise<{
    tipoCusto: TipoCusto;
    mostrarEtiquetas: boolean;
    linhas: Array<Record<string, unknown>>;
    totais: {
      itens: number; margemNegativa: number; custoTotal: number;
      mediaMargem: number; lucroCB: number; lucroRep: number; lucroCSI: number;
    };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;

    const onde = [sql`nf.idempresa = ${emp}`, sql`nf.tipo = 'E'`];
    if (f.codnf) onde.push(sql`p.codnf = ${f.codnf}`);
    if (f.nronf) onde.push(sql`nf.nronf LIKE ${`%${f.nronf}%`}`);
    if (f.descricao) onde.push(sql`pr.descricao ILIKE ${`%${f.descricao}%`}`);
    if (f.fornecedor) onde.push(sql`pa.razao ILIKE ${`%${f.fornecedor}%`}`);
    // o grupo é o nível 'G' da árvore, e o legado casa por DESCRIÇÃO (`:906`)
    if (f.grupo) onde.push(sql`(fam.descricao ILIKE ${`%${f.grupo}%`} AND fam.tipo = 'G')`);
    if (f.dataIni && f.dataFim) onde.push(sql`nf.dtemissao::date BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`);
    // transferência não é compra: não reprecifica (`:911`)
    if (!f.incluirTransferencias) onde.push(sql`coalesce(c.proc_transf, 'N') = 'N'`);
    // bonificação é mercadoria de graça: não forma preço (`:916`)
    if (!f.incluirBonificacao) onde.push(sql`coalesce(nf.cfop, '') <> ALL(${CFOP_BONIFICACAO})`);

    // o `rgPreco` abre no que a empresa configurou: 'S' em MARGEM_LIQUIDA_PRECIFICACAO_NF ⇒ custo CSI
    // (e o botão de etiquetas some); qualquer outro valor ⇒ custo bruto (`uPrecificacaoNF.pas:871`).
    // No cliente hoje vale 'B' ⇒ bruto, etiquetas visíveis (lido na produção em 10/09/2026).
    const margemLiq = String((await this.config.resolver('MARGEM_LIQUIDA_PRECIFICACAO_NF', { empresaId: emp })) ?? 'B').toUpperCase();
    const tipoCusto: TipoCusto = f.tipoCusto ?? (margemLiq === 'S' ? 'CSI' : 'BRUTO');

    const linhas = (await sql<Record<string, unknown>>`
      WITH item AS (
        SELECT nf.idempresa, nf.codnf, nf.nronf, to_char(nf.dtemissao, 'YYYY-MM-DD') AS dtemissao,
               p.codnfprod, p.codproduto AS idproduto, p.codprodnota, pr.descricao, pr.codbarra,
               -- a quantidade em unidades de VENDA (a nota traz a da embalagem)
               (p.quantidade * coalesce(nullif(p.fatorembal, 0), 1)) AS quantidade,
               coalesce(nullif(p.fatorembal, 0), 1) AS fatorembal,
               -- o custo unitário: desconto aplicado e dividido pelo fator de embalagem
               CASE WHEN coalesce(p.vrcusto, 0) > 0
                    THEN ((p.vrcusto - (coalesce(p.desconto,0) / 100 * p.vrcusto))
                          / coalesce(nullif(p.fatorembal, 0), 1))::numeric(13,4)
                    ELSE 0 END AS vrcusto,
               p.ultcusto, p.desconto, p.pmz, p.vrvendasug, p.aliquota AS aliquota_nf,
               p.despextra, p.vroutrasdesp, p.streal, p.arredonda,
               m.vrvenda, m.vrvenda AS preco_venda,
               coalesce(m.markupfixo, 0) AS markupfixo, coalesce(m.vrpromo, 0) AS vrpromo,
               coalesce(m.promocao, 'N') AS promocao, pr.codgrupopreco AS grupo_preco,
               -- os componentes do custo saem do MULTI_PRECO do produto NAQUELA empresa, não da nota
               coalesce(m.icme,0) AS icme, coalesce(m.icmst,0) AS icmst, coalesce(m.vrfcpst,0) AS vrfcpst,
               coalesce(m.ipi,0) AS ipi_pct, coalesce(m.frete,0) AS frete_pct, coalesce(m.frete2,0) AS frete2_pct,
               coalesce(m.seguro,0) AS seguro_pct, coalesce(m.despacessorio,0) AS despacessorio,
               coalesce(m.bonificacao,0) AS bonificacao, coalesce(m.vrcustoajuste,0) AS vrcustoajuste,
               coalesce(pr.aliquota,'') AS aliquota, e.classfiscal, coalesce(e.alqsimplesnac,0) AS alqsimplesnac,
               coalesce(e.despoperacional,0) AS despoperacional, coalesce(e.imprenda,0) AS imprenda,
               coalesce(e.contsocial,0) AS contsocial, e.uf AS uf_empresa,
               coalesce(ps.aliq_pis_sai,0) AS pis_sai, coalesce(ps.aliq_cofins_sai,0) AS cofins_sai,
               coalesce(ps.aliq_pis_ent,0) AS pis_ent, coalesce(ps.aliq_cofins_ent,0) AS cofins_ent,
               -- ⚠️ DOIS ICMS na mesma tela, de propósito: ESTE é o exibido, pela UF de onde a mercadoria
               -- VEIO (o endereço do fornecedor na nota).
               (SELECT DISTINCT da.icm_efetivo
                  FROM det_aliquota da
                 WHERE da.aliquota = p.aliquota
                   AND da.uf = (SELECT pe.uf FROM parceiros_end pe WHERE pe.codend = nf.codparceiro_end)) AS icms,
               -- ...e ESTE é o que entra na margem líquida, pela UF da EMPRESA (CalculaValorMargem:820)
               (SELECT DISTINCT da2.icm_efetivo
                  FROM det_aliquota da2
                 WHERE da2.aliquota = pr.aliquota AND da2.uf = e.uf) AS icm_saida_empresa,
               pa.codparceiro, pa.razao AS parceiro_razao, pa.fantasia AS parceiro_fantasia,
               -- o último custo de reposição: a última nota de ENTRADA processada do produto, fora esta
               (SELECT max(np2.vrcustorep)
                  FROM nf_prod np2
                  JOIN nf nf2 ON nf2.codnf = np2.codnf
                 WHERE np2.codproduto = p.codproduto
                   AND np2.codnf <> p.codnf
                   AND nf2.tipo = 'E'
                   AND coalesce(nf2.proc, 'N') = 'S'
                   AND coalesce(nf2.cancelada, 'N') = 'N'
                   AND nf2.cfop = ANY(${CFOP_ENTRADA})) AS ult_custo_rep
          FROM nf_prod p
          JOIN nf nf                ON nf.codnf = p.codnf
          JOIN empresas e           ON e.idempresa = nf.idempresa
          LEFT JOIN produtos pr     ON pr.idproduto = p.codproduto
          LEFT JOIN piscofins ps    ON ps.idpiscofins = pr.idpiscofins
          LEFT JOIN multi_preco m   ON m.idproduto = p.codproduto AND m.idempresa = nf.idempresa
          LEFT JOIN parceiros pa    ON pa.codparceiro = nf.codparceiro
          LEFT JOIN familias_prod fam ON fam.codfamilia = pr.codgrupo
          LEFT JOIN cfop c          ON c.codcfop = nf.cfop
         WHERE ${sql.join(onde, sql` AND `)}
      ), comp AS (
        -- os componentes, um a um, como o legado os monta (CalculaValorCusto:423). Repare na mistura:
        -- IPI, frete, frete2 e seguro entram em PERCENTUAL sobre o custo; despesa acessória, ICMS-ST, FCP-ST
        -- e o ajuste entram em VALOR. Errar a forma de um deles erra o custo — e o preço.
        SELECT i.*,
               CASE WHEN i.classfiscal = 'SN' THEN 0
                    WHEN substr(i.aliquota, 1, 1) = 'T' THEN i.icme * i.vrcusto / 100
                    ELSE 0 END AS v_icme,
               -- ⚠️ o crédito de PIS/COFINS da ENTRADA só existe no LUCRO REAL ('LR') — é o inverso da
               -- Rentabilidade por Categorias, que zera para SN/ME/LP. Fiel a :478.
               CASE WHEN i.classfiscal = 'SN' THEN 0
                    WHEN i.classfiscal = 'LR' AND i.pis_ent > 0
                     THEN round(((i.pis_ent + i.cofins_ent) * i.vrcusto / 100)::numeric, 2)
                    ELSE 0 END AS v_pis,
               CASE WHEN i.ipi_pct    > 0 THEN i.vrcusto * i.ipi_pct    / 100 ELSE 0 END AS v_ipi,
               CASE WHEN i.frete_pct  > 0 THEN i.vrcusto * i.frete_pct  / 100 ELSE 0 END AS v_frete,
               CASE WHEN i.seguro_pct > 0 THEN i.vrcusto * i.seguro_pct / 100 ELSE 0 END AS v_seguro,
               (i.vrcusto * i.frete2_pct / 100) AS v_frete2,
               CASE WHEN i.despacessorio > 0 THEN i.despacessorio ELSE 0 END AS v_despac,
               CASE WHEN i.vrfcpst       > 0 THEN i.vrfcpst       ELSE 0 END AS v_fcpst,
               CASE WHEN i.vrcustoajuste <> 0 THEN i.vrcustoajuste ELSE 0 END AS v_ajuste
          FROM item i
      ), custos AS (
        SELECT c.*,
               -- custo REAL: subtrai os créditos
               round((c.vrcusto - c.v_pis - c.v_icme + c.icmst + c.v_fcpst + c.v_ipi + c.v_frete
                      + c.v_seguro + c.v_despac + c.v_frete2 + c.v_ajuste)::numeric, 2) AS custo_real,
               -- custo de REPOSIÇÃO: NÃO subtrai crédito, e desconta a bonificação
               round((c.vrcusto + (c.v_ipi + c.v_frete + c.v_seguro + c.v_despac + c.icmst + c.v_fcpst
                      + c.v_frete2 + c.v_ajuste) - c.bonificacao)::numeric, 2) AS custo_rep
          FROM comp c
      ), csi AS (
        -- custo CSI = custo de reposição menos os créditos (:524)
        SELECT x.*, (x.custo_rep - x.v_icme - x.v_pis) AS custo_csi FROM custos x
      ), margem AS (
        SELECT y.*,
               -- a escada da MARGEM LÍQUIDA (CalculaValorMargem:775), usada quando o tipo é CSI. O Simples
               -- paga a alíquota única sobre a venda; os demais, o ICMS efetivo pela UF DA EMPRESA, e só se
               -- o produto for tributado ('T*').
               (CASE WHEN y.classfiscal = 'SN' THEN y.alqsimplesnac * y.preco_venda / 100
                     WHEN substr(y.aliquota,1,1) = 'T' THEN coalesce(y.icm_saida_empresa,0) * y.preco_venda / 100
                     ELSE 0 END) AS m_icm,
               (CASE WHEN y.classfiscal = 'SN' THEN 0
                     WHEN y.pis_sai > 0 THEN (y.pis_sai + y.cofins_sai) * y.preco_venda / 100
                     ELSE 0 END) AS m_pis
          FROM csi y
      )
      SELECT z.*,
             -- markup/margem conforme o tipo de custo escolhido. Nos três casos é PERCENTUAL.
             CASE
               WHEN ${tipoCusto} = 'BRUTO'
                 THEN CASE WHEN z.vrcusto > 0
                           THEN round((((z.preco_venda - z.vrcusto) * 100) / z.vrcusto)::numeric, 2) ELSE 0 END
               WHEN ${tipoCusto} = 'REPOSICAO'
                 THEN CASE WHEN z.custo_rep > 0
                           THEN round((((z.preco_venda - z.custo_rep) * 100) / z.custo_rep)::numeric, 2) ELSE 0 END
               ELSE CASE WHEN z.preco_venda > 0
                         THEN round(((((z.preco_venda - z.m_icm - z.m_pis - z.custo_csi)
                                       - (z.preco_venda * z.despoperacional / 100))
                                      - GREATEST((z.preco_venda - z.m_icm - z.m_pis - z.custo_csi)
                                                 - (z.preco_venda * z.despoperacional / 100), 0)
                                        * (z.imprenda + z.contsocial) / 100
                                     ) / z.preco_venda * 100)::numeric, 2) ELSE 0 END
             END AS markup,
             -- MARKDOWN é campo calculado do dataset: margem sobre a VENDA, contra o custo de reposição
             CASE WHEN z.preco_venda > 0
                  THEN round((((z.preco_venda - z.custo_rep) / z.preco_venda) * 100)::numeric, 2)
                  ELSE 0 END AS markdown
        FROM margem z
       ORDER BY z.nronf, z.descricao
       LIMIT 3001
    `.execute(db)).rows;

    // a margem negativa é o que a tela pinta de vermelho: vender abaixo do que custou
    const comMargem: Array<Record<string, unknown>> = linhas.map((l) => {
      const custoU = num(l.vrcusto);
      const venda = num(l.vrvenda);
      return { ...l, margem_negativa: custoU > 0 && venda > 0 && venda < custoU };
    });
    const filtradas = f.somenteMargemNegativa ? comMargem.filter((l) => l.margem_negativa) : comMargem;

    // O RODAPÉ (`btnVisualizar:420`): "Produtos Listados", "Margem Média" e um "Lucro Bruto" que TROCA DE
    // CAMPO conforme o `rgPreco` — `LUCROCB`, `LUCROREP` ou `LUCROCSI`. São três agregados do dataset
    // (`uDMPrecificacaoNF.dfm:390-420`), e o rótulo é o mesmo nos três: quem olha só o número não sabe
    // contra qual custo ele foi feito. Devolvemos os três, e a tela diz qual está mostrando.
    const somaL = (custo: (l: Record<string, unknown>) => number) =>
      r2(filtradas.reduce((acc, l) => acc + (num(l.preco_venda) * num(l.quantidade) - custo(l) * num(l.quantidade)), 0));
    const mediaMargem = filtradas.length === 0 ? 0
      : r2(filtradas.reduce((acc, l) => acc + num(l.markup), 0) / filtradas.length);

    return {
      tipoCusto,
      /** `MARGEM_LIQUIDA_PRECIFICACAO_NF <> 'S'` ⇒ o botão de etiquetas aparece (`:871`). */
      mostrarEtiquetas: margemLiq !== 'S',
      linhas: filtradas,
      totais: {
        itens: filtradas.length,
        margemNegativa: comMargem.filter((l) => l.margem_negativa).length,
        custoTotal: r2(filtradas.reduce((s, l) => s + num(l.vrcusto) * num(l.quantidade), 0)),
        mediaMargem,
        lucroCB: somaL((l) => num(l.vrcusto)),
        lucroRep: somaL((l) => num(l.custo_rep)),
        lucroCSI: somaL((l) => num(l.custo_csi)),
      },
    };
  }

  /**
   * Recalcula um item com os componentes que vieram NA NOTA — reusando a escada do
   * `PrecificacaoCustoService`, que já é a do `FRMPRIFICACAOCUSTO`. Não há uma segunda implementação da
   * margem no Apollo, e não deve haver.
   */
  async recalcular(codnfprod: number, p: { markup?: number | null; vrvenda?: number | null }) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const i = (await sql<Record<string, unknown>>`
      SELECT p.codproduto AS idproduto,
             CASE WHEN coalesce(p.vrcusto,0) > 0
                  THEN ((p.vrcusto - (coalesce(p.desconto,0)/100 * p.vrcusto))
                        / coalesce(nullif(p.fatorembal,0), 1))::numeric(13,4)
                  ELSE 0 END AS vrcusto,
             p.frete, p.frete2, p.seguro, p.ipi, p.vricmst, p.depsacess, p.bonificacao, p.aliquota,
             nf.codparceiro_end
        FROM nf_prod p JOIN nf nf ON nf.codnf = p.codnf
       WHERE p.codnfprod = ${codnfprod} AND nf.idempresa = ${emp}
    `.execute(db)).rows[0];
    if (!i) throw new BusinessRuleError('ITEM_NF_NAO_ENCONTRADO', { codnfprod });

    // o ICMS de crédito é o da UF de origem da mercadoria — a mesma regra da listagem
    const icm = (await sql<{ icm_efetivo: number }>`
      SELECT da.icm_efetivo FROM det_aliquota da
       WHERE da.aliquota = ${i.aliquota}
         AND da.uf = (SELECT pe.uf FROM parceiros_end pe WHERE pe.codend = ${i.codparceiro_end})
       LIMIT 1
    `.execute(db)).rows[0];

    return this.custo.calcular({
      idproduto: Number(i.idproduto), idempresa: emp,
      vrcusto: num(i.vrcusto),
      icme: num(icm?.icm_efetivo), ipi: num(i.ipi), frete: num(i.frete), frete2: num(i.frete2), seguro: num(i.seguro),
      icmst: num(i.vricmst), despacessorio: num(i.depsacess), bonificacao: num(i.bonificacao),
      markup: p.markup == null ? undefined : Number(p.markup),
      vrvenda: p.vrvenda == null ? undefined : Number(p.vrvenda),
    });
  }

  /**
   * APLICAR VALORES (`InsereAjustePreco`, `:951`) — enfileira um lote de preço por item selecionado, para
   * uma ou mais empresas. **Não muda o preço**: `processado = 'N'`, e quem muda é o processamento do lote.
   */
  async aplicar(dto: {
    itens: Array<{ idproduto: number; vrvenda: number; markup?: number | null; nronf?: string | null }>;
    empresas?: number[] | null;
    obs?: string | null;
    datalote?: string | null;
  }): Promise<{ lotes: number; empresas: number[] }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenant() as AnyDB;
    if (!dto.itens?.length) throw new BusinessRuleError('PRECIFICACAO_SEM_ITENS');

    const alvo = dto.empresas?.length ? dto.empresas : [emp];
    // a empresa de destino tem de existir — o legado abre a lista e recusa se não achar (`:960`)
    const existem = (await db.selectFrom('empresas').select('idempresa').where('idempresa', 'in', alvo).execute()) as Array<{ idempresa: number }>;
    if (existem.length !== alvo.length) throw new BusinessRuleError('EMPRESA_NAO_ENCONTRADA', { empresas: alvo });

    return db.transaction().execute(async (trx: AnyDB) => {
      let lotes = 0;
      for (const e of alvo) {
        for (const it of dto.itens) {
          if (!(it.vrvenda > 0)) throw new BusinessRuleError('PRECO_INVALIDO', { idproduto: it.idproduto, vrvenda: it.vrvenda });
          await trx.insertInto('lote_preco').values({
            idproduto: it.idproduto,
            vrvenda: r2(it.vrvenda),
            markup: it.markup == null ? null : r4(it.markup),
            datalote: dto.datalote ? sql`${dto.datalote}::date` : sql`current_date`,
            processado: 'N',
            // texto fixo do legado, com o número da nota (`InsereAjustePreco`, `:1013`)
            obs: dto.obs ?? `REFERENTE A PRECIFICAÇÃO NOTA FISCAL DE NRO. ${it.nronf ?? ''}`.trim(),
            codempresa: e,
            codoperador: op,
            origem: 'PRECIFICACAO_NF',
          }).execute();
          lotes += 1;
        }
      }
      return { lotes, empresas: alvo };
    });
  }
}
