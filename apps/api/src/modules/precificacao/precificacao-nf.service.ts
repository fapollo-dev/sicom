import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { PrecificacaoCustoService } from './precificacao-custo.service';

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
}

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
 *  · **markup na LISTAGEM** = `VRVENDA / custo unitário` — razão (`uPrecificacaoNF.pas:941`);
 *  · ⚠️ **o markup EDITADO é PERCENTUAL**, `((preço − custo) × 100) / custo` (`CalcularMargem`,
 *    `uDMPrecificacaoNF:377`), e é ele que vai para o lote. **A mesma coluna muda de unidade quando o
 *    operador digita** — incoerência do legado, provada no dado: dos 2.952 lotes que esta tela gerou em
 *    produção, 1.182 estão em faixa de razão (nunca editados) e 1.358 em faixa de percentual. Copiada como
 *    está, mas com as duas colunas rotuladas na tela em vez de uma só ambígua;
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
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async listar(f: FiltroPrecificacaoNf): Promise<{
    linhas: Array<Record<string, unknown>>;
    totais: { itens: number; margemNegativa: number; custoTotal: number };
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

    const linhas = (await sql<Record<string, unknown>>`
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
             p.ultcusto, p.vrcustorep, p.vrcustocsi, p.desconto,
             p.pmz, p.vrvendasug, p.aliquota,
             p.seguro, p.frete, p.frete2, p.ipi, p.despextra, p.depsacess, p.vroutrasdesp,
             p.vricmst, p.streal, p.bonificacao, p.arredonda,
             m.vrvenda, m.vrvenda AS preco_venda,
             coalesce(m.markupfixo, 0) AS markupfixo, coalesce(m.vrpromo, 0) AS vrpromo,
             -- markup da LISTAGEM: preço de venda ÷ custo unitário. É RAZÃO — e vira percentual assim que
             -- o operador edita (ver o cabeçalho da classe). Fiel ao trecho MARGEM do legado.
             CASE WHEN coalesce(p.vrcusto,0) > 0 AND coalesce(m.vrvenda,0) > 0
                   AND (p.vrcusto - (coalesce(p.desconto,0)/100 * p.vrcusto)) > 0
                  THEN (m.vrvenda / ((p.vrcusto - (coalesce(p.desconto,0)/100 * p.vrcusto))
                                     / coalesce(nullif(p.fatorembal,0), 1)))::numeric(13,4)
                  ELSE 0 END AS markup,
             -- ⚠️ o ICMS vem pela UF de onde a mercadoria VEIO (o endereço do fornecedor na nota)
             (SELECT DISTINCT da.icm_efetivo
                FROM det_aliquota da
               WHERE da.aliquota = p.aliquota
                 AND da.uf = (SELECT pe.uf FROM parceiros_end pe WHERE pe.codend = nf.codparceiro_end)) AS icms,
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
        LEFT JOIN produtos pr     ON pr.idproduto = p.codproduto
        LEFT JOIN multi_preco m   ON m.idproduto = p.codproduto AND m.idempresa = nf.idempresa
        LEFT JOIN parceiros pa    ON pa.codparceiro = nf.codparceiro
        LEFT JOIN familias_prod fam ON fam.codfamilia = pr.codgrupo
        LEFT JOIN cfop c          ON c.codcfop = nf.cfop
       WHERE ${sql.join(onde, sql` AND `)}
       ORDER BY nf.nronf, pr.descricao
       LIMIT 3001
    `.execute(db)).rows;

    // a margem negativa é o que a tela pinta de vermelho: vender abaixo do que custou
    const comMargem: Array<Record<string, unknown>> = linhas.map((l) => {
      const custoU = num(l.vrcusto);
      const venda = num(l.vrvenda);
      return { ...l, margem_negativa: custoU > 0 && venda > 0 && venda < custoU };
    });
    const filtradas = f.somenteMargemNegativa ? comMargem.filter((l) => l.margem_negativa) : comMargem;

    return {
      linhas: filtradas,
      totais: {
        itens: filtradas.length,
        margemNegativa: comMargem.filter((l) => l.margem_negativa).length,
        custoTotal: r2(filtradas.reduce((s, l) => s + num(l.vrcusto) * num(l.quantidade), 0)),
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
