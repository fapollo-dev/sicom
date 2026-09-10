import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
export type NivelRent = 'DEPARTAMENTO' | 'GRUPO' | 'SUBGRUPO';
const CAMPO: Record<NivelRent, string> = { DEPARTAMENTO: 'coddpto', GRUPO: 'codgrupo', SUBGRUPO: 'codsubgrupo' };

export interface LinhaRentabilidade {
  categoria: string | null; codcategoria: number | null;
  venda: number; icms_venda: number; piscofins_venda: number; venda_liquida: number;
  custo: number; credito_icms: number; credito_piscofins: number; encargos: number; custo_liquido: number;
  despesa_operacional: number;
  lucro_bruto: number; ir: number; csll: number; lucro_liquido: number; margem: number;
}

/**
 * RENTABILIDADE POR CATEGORIAS (`FRMRENTABILIDADECATEGORIAS`, `uRentabilidadeCategorias.pas` 1.217 linhas).
 * Dossiê: `uRentabilidadeCategorias.md`. 275 acessos.
 *
 * É a rentabilidade **depois do imposto e da despesa** — não confundir com a Consultoria
 * (`FRMCONSULTORIAATM`), que faz venda menos custo e para por aí. Aqui a conta desce até o lucro líquido:
 *
 * ```
 * venda líquida = venda − ICMS da venda − PIS/COFINS da saída
 * custo líquido = custo − crédito de ICMS − crédito de PIS/COFINS
 *                       + ICMS-ST + FCP-ST + despesas acessórias − bonificação
 *                       + frete + frete2 + seguro + IPI          (os quatro em % sobre o custo)
 * lucro bruto   = venda líquida − custo líquido − despesa operacional
 * lucro líquido = lucro bruto − IR − CSLL                        (nunca negativos: piso zero)
 * ```
 *
 * As regras que não se adivinha, e de onde vieram (`uRentabilidadeCategorias.dfm:1706`):
 *  · **PIS/COFINS da saída não se aplica ao Simples**: `CLASSFISCAL = 'SN'` zera a parcela;
 *  · **o crédito de PIS/COFINS da entrada** é zerado para `'SN'`, `'ME'` **e `'LP'`** — três regimes, não um;
 *  · **o crédito de ICMS só existe se o produto é TRIBUTADO**: `SUBSTR(PRODUTOS.ALIQUOTA,1,1) = 'T'`;
 *  · ICMS-ST, FCP-ST, acessórias e bonificação entram **por unidade** (× quantidade); frete, seguro e IPI
 *    entram **em percentual** sobre o custo — a mesma tabela mistura as duas formas;
 *  · a **despesa operacional** é o percentual que o usuário digita; em branco, usa o da empresa
 *    (`EMPRESAS.DESPOPERACIONAL`, `:346-348`);
 *  · **IR e CSLL têm piso zero**: prejuízo não gera imposto negativo (`CASE WHEN … < 0 THEN 0`).
 *
 * ⚠️ o legado agrega os percentuais com `AVG` e os valores com `SUM` dentro do mesmo GROUP BY — ou seja, a
 * alíquota de uma categoria é a MÉDIA das alíquotas dos produtos vendidos nela, não a ponderada pelo valor.
 * Copiado como está: mudar isso mudaria o número que o cliente confere há anos.
 */
@Injectable()
export class RentabilidadeCategoriasService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  async calcular(p: { nivel: NivelRent; dataIni: string; dataFim: string; despesaOperacional?: number | null }): Promise<{
    nivel: NivelRent; despesaOperacionalUsada: number | null;
    linhas: LinhaRentabilidade[];
    totais: { venda: number; venda_liquida: number; custo_liquido: number; lucro_bruto: number; lucro_liquido: number; margem: number };
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const campo = CAMPO[p.nivel];
    if (!campo) throw new BusinessRuleError('NIVEL_INVALIDO', { nivel: p.nivel });
    const despInformada = p.despesaOperacional == null ? null : Number(p.despesaOperacional);

    const rows = (await sql<Record<string, unknown>>`
      WITH base AS (
        SELECT f.codfamilia AS codcategoria,
               coalesce(f.descricao, 'Sem categoria') AS categoria,
               e.classfiscal, coalesce(e.imprenda, 0) AS imprenda, coalesce(e.contsocial, 0) AS contsocial,
               coalesce(e.despoperacional, 0) AS desp_empresa,
               sum(CASE WHEN v.iat = 'A' THEN round((v.qtde * v.vrvenda)::numeric, 2)
                        ELSE trunc((v.qtde * v.vrvenda)::numeric * 100) / 100 END) AS venda,
               sum(round((v.qtde * v.vrcusto)::numeric, 2)) AS custo,
               sum(v.qtde) AS qtde,
               -- ⚠️ o legado agrega alíquota com AVG (média simples entre os produtos), não ponderada
               avg(coalesce(al.icm_efetivo, 0)) AS icm_efetivo,
               max(coalesce(ps.aliq_pis_sai, 0)) AS pis_sai,
               max(coalesce(ps.aliq_cofins_sai, 0)) AS cofins_sai,
               max(coalesce(ps.aliq_pis_ent, 0)) AS pis_ent,
               max(coalesce(ps.aliq_cofins_ent, 0)) AS cofins_ent,
               -- o crédito de ICMS só vale para produto TRIBUTADO ('T*')
               avg(CASE WHEN substr(coalesce(pr.aliquota, ''), 1, 1) = 'T' THEN coalesce(m.icme, 0) ELSE 0 END) AS icme,
               avg(coalesce(m.icmst, 0)) AS icmst, avg(coalesce(m.vrfcpst, 0)) AS vrfcpst,
               avg(coalesce(m.despacessorio, 0)) AS despacessorio, avg(coalesce(m.bonificacao, 0)) AS bonificacao,
               avg(coalesce(m.frete, 0)) AS frete, avg(coalesce(m.frete2, 0)) AS frete2,
               avg(coalesce(m.seguro, 0)) AS seguro, avg(coalesce(m.ipi, 0)) AS ipi
          FROM vendas v
          JOIN empresas e            ON e.idempresa = v.idempresa
          LEFT JOIN produtos pr      ON pr.idproduto = v.codproduto
          LEFT JOIN familias_prod f  ON f.codfamilia = pr.${sql.ref(campo)}
          -- ⚠️ o ICMS efetivo é POR UF (AL.UF = :UF, dfm:1706): a mesma alíquota tem valor diferente por
          -- estado, e o legado passa a UF da empresa como parâmetro.
          LEFT JOIN det_aliquota al  ON al.aliquota = pr.aliquota AND al.uf = e.uf
          LEFT JOIN piscofins ps     ON ps.idpiscofins = pr.idpiscofins
          LEFT JOIN multi_preco m    ON m.idproduto = v.codproduto AND m.idempresa = v.idempresa
         WHERE v.dtvenda::date BETWEEN ${p.dataIni}::date AND ${p.dataFim}::date
           AND coalesce(v.cancelado, 'N') = 'N'
           AND v.idempresa = ${emp}
         GROUP BY f.codfamilia, f.descricao, e.classfiscal, e.imprenda, e.contsocial, e.despoperacional
      ), calc AS (
        SELECT b.*,
               -- a despesa operacional: a informada na tela, ou a da empresa
               coalesce(${despInformada}::numeric, b.desp_empresa) AS desp_pct,
               -- venda: ICMS efetivo e PIS/COFINS de saída (o Simples não paga PIS/COFINS na saída)
               (CASE WHEN b.icm_efetivo > 0 THEN b.venda * b.icm_efetivo / 100 ELSE 0 END) AS icms_venda,
               (CASE WHEN b.classfiscal = 'SN' THEN 0
                     WHEN b.pis_sai = 0 THEN 0
                     ELSE (b.pis_sai + b.cofins_sai) * b.venda / 100 END) AS piscofins_venda,
               -- custo: créditos (SN, ME e LP não creditam PIS/COFINS) e os encargos
               (b.custo * b.icme / 100) AS credito_icms,
               (CASE WHEN b.classfiscal IN ('SN','ME','LP') THEN 0
                     WHEN b.pis_ent = 0 THEN 0
                     ELSE (b.pis_ent + b.cofins_ent) * b.custo / 100 END) AS credito_piscofins,
               (b.qtde * b.icmst) + (b.qtde * b.vrfcpst) + (b.qtde * b.despacessorio) - (b.qtde * b.bonificacao)
                 + (b.custo * b.frete / 100) + (b.custo * b.frete2 / 100)
                 + (b.custo * b.seguro / 100) + (b.custo * b.ipi / 100) AS encargos
          FROM base b
      )
      SELECT categoria, codcategoria,
             venda::numeric(15,2), custo::numeric(15,2),
             icms_venda::numeric(15,2), piscofins_venda::numeric(15,2),
             (venda - icms_venda - piscofins_venda)::numeric(15,2) AS venda_liquida,
             credito_icms::numeric(15,2), credito_piscofins::numeric(15,2), encargos::numeric(15,2),
             (custo - credito_icms - credito_piscofins + encargos)::numeric(15,2) AS custo_liquido,
             (venda * desp_pct / 100)::numeric(15,2) AS despesa_operacional,
             imprenda, contsocial,
             ((venda - icms_venda - piscofins_venda)
              - (custo - credito_icms - credito_piscofins + encargos)
              - (venda * desp_pct / 100))::numeric(15,2) AS lucro_bruto
        FROM calc
       ORDER BY 3 DESC
    `.execute(db)).rows;

    const n = (v: unknown) => Number(v ?? 0);
    const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

    const linhas: LinhaRentabilidade[] = rows.map((l) => {
      const bruto = n(l.lucro_bruto);
      // IR e CSLL com PISO ZERO: prejuízo não gera imposto negativo (`:1708-1712`)
      const ir = r2(Math.max(0, (bruto * n(l.imprenda)) / 100));
      const csll = r2(Math.max(0, (bruto * n(l.contsocial)) / 100));
      const liquido = r2(bruto - ir - csll);
      const vendaLiq = n(l.venda_liquida);
      return {
        categoria: (l.categoria as string) ?? null,
        codcategoria: l.codcategoria == null ? null : Number(l.codcategoria),
        venda: n(l.venda), icms_venda: n(l.icms_venda), piscofins_venda: n(l.piscofins_venda),
        venda_liquida: vendaLiq,
        custo: n(l.custo), credito_icms: n(l.credito_icms), credito_piscofins: n(l.credito_piscofins),
        encargos: n(l.encargos), custo_liquido: n(l.custo_liquido),
        despesa_operacional: n(l.despesa_operacional),
        lucro_bruto: r2(bruto), ir, csll, lucro_liquido: liquido,
        margem: vendaLiq === 0 ? 0 : r2((liquido / vendaLiq) * 100),
      };
    });

    const soma = (f: (l: LinhaRentabilidade) => number) => r2(linhas.reduce((s, l) => s + f(l), 0));
    const vendaLiqTot = soma((l) => l.venda_liquida);
    const liquidoTot = soma((l) => l.lucro_liquido);
    return {
      nivel: p.nivel,
      despesaOperacionalUsada: despInformada,
      linhas,
      totais: {
        venda: soma((l) => l.venda), venda_liquida: vendaLiqTot,
        custo_liquido: soma((l) => l.custo_liquido),
        lucro_bruto: soma((l) => l.lucro_bruto), lucro_liquido: liquidoTot,
        margem: vendaLiqTot === 0 ? 0 : r2((liquidoTot / vendaLiqTot) * 100),
      },
    };
  }
}
