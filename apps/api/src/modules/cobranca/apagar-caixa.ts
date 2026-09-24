/**
 * O A PAGAR NA CAIXA GERENCIAL (`CAIXA-escritores.md` §2; a regra é do binário novo — o fonte de 2020 não tem o texto
 * "% do Documento nº" — e foi reconstruída pelo dado: VALOR e OBS batem em 8.283 de 8.304 linhas de 2026).
 *  - O RATEIO (CX_APAGAR) é por GRUPO (APAGAR.CODGRUPO) × centro de custo, pendurado no 1º título do grupo, com o valor
 *    TOTAL: no faturamento da NF, uma linha por CODCONTABILNF com CC e não adicional (TIPO = TIPOVALOR ou 'V'); no título
 *    digitado, o CC da tela; a retenção de ICMS-ST vai no CC `CENTROCUSTO_RET_ICMSST`.
 *  - A CAIXA (ORIGEM 'APAGAR') é refeita pelo GRAVAR da tela de Contas a Pagar (o faturamento passa por ela): apaga as
 *    linhas do grupo e lança, para cada título × CC, −valor × (CC ÷ Σ rateio); no último título o último CC fecha o
 *    total (base + embutidos − descontos − o que já foi lançado nele). OBS = a do título sem CR + " , 99,99% do Documento
 *    nº <título>". Título criado por rotina (previsão do manifesto, retenção) fica sem CAIXA até ser gravado na tela.
 *  - Apagar o rateio leva a CAIXA junto (a trigger `CAIXA_APAGAR` do Oracle).
 */
import { sql } from 'kysely';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;

export async function novoGrupo(trx: AnyDB): Promise<number> {
  return Number((await sql<{ id: string }>`SELECT nextval('seq_caixa_codgrupo') AS id`.execute(trx)).rows[0].id);
}

/** o rateio do faturamento da NF (CODCONTABILNF com CC, não adicional), no 1º título do grupo */
export async function rateioDoFaturamento(trx: AnyDB, codnf: number, codgrupo: number, codapg: number): Promise<number> {
  const r = await sql`
    INSERT INTO cx_apagar (codapg, codcc, valor, codgrupo, tipo, idsituacao_nf, dtultimalteracao)
    SELECT ${codapg}, c.codcc, c.valor, ${codgrupo}, coalesce(nullif(trim(c.tipovalor), ''), 'V'), NULL, now()
      FROM nf_contabil c
     WHERE c.codnf = ${codnf} AND c.codcc IS NOT NULL AND coalesce(c.adicional, 'N') <> 'S'
     ORDER BY c.codcontabilnf`.execute(trx);
  return Number(r.numAffectedRows ?? 0);
}

/** o rateio de uma linha só (título digitado, retenção): o CC com o valor do grupo */
export async function rateioUnico(trx: AnyDB, p: { codapg: number; codgrupo: number; codcc: number; valor: number; idsituacao_nf?: number | null }): Promise<void> {
  await sql`INSERT INTO cx_apagar (codapg, codcc, valor, codgrupo, tipo, idsituacao_nf, dtultimalteracao)
            VALUES (${p.codapg}, ${p.codcc}, ${r2(p.valor)}, ${p.codgrupo}, 'V', ${p.idsituacao_nf ?? null}, now())`.execute(trx);
}

/** apagar o rateio do grupo leva a CAIXA dele (a trigger CAIXA_APAGAR) */
export async function apagarRateioDoGrupo(trx: AnyDB, codgrupo: number | null | undefined): Promise<void> {
  if (codgrupo == null) return;
  await sql`DELETE FROM caixa WHERE codgrupo = ${codgrupo} AND codcxapagar IN (SELECT codcxapagar FROM cx_apagar WHERE codgrupo = ${codgrupo})`.execute(trx);
  await sql`DELETE FROM cx_apagar WHERE codgrupo = ${codgrupo}`.execute(trx);
}

/** a CAIXA do grupo inteiro, refeita (o Gravar da tela de Contas a Pagar) */
export async function refazerCaixaDoGrupo(trx: AnyDB, codgrupo: number | null | undefined, operador: number | null): Promise<number> {
  if (codgrupo == null) return 0;
  await sql`DELETE FROM caixa WHERE codgrupo = ${codgrupo} AND codcxapagar IS NOT NULL AND origem = 'APAGAR'`.execute(trx);
  const titulos = (await sql<Record<string, unknown>>`
    SELECT codapg, valor, coalesce(agrupamento, 'N') AS agrupamento, coalesce(dtcompra, dtvenda) AS data, dtvenc, idnf, tipodoc,
           codparceiro, codempresa, obs, nrparcela
      FROM apagar WHERE codgrupo = ${codgrupo} ORDER BY codapg`.execute(trx)).rows;
  const rateio = (await sql<Record<string, unknown>>`
    SELECT codcxapagar, codcc, valor, coalesce(nullif(trim(tipo), ''), 'V') AS tipo FROM cx_apagar WHERE codgrupo = ${codgrupo} ORDER BY codcxapagar`.execute(trx)).rows;
  if (!titulos.length || !rateio.length) return 0;
  const S = rateio.reduce((s, x) => s + num(x.valor), 0);
  if (S === 0) return 0;
  const SE = rateio.filter((x) => x.tipo === 'E').reduce((s, x) => s + num(x.valor), 0);
  const SD = rateio.filter((x) => x.tipo === 'D').reduce((s, x) => s + num(x.valor), 0);
  const agrup = titulos.some((t) => t.agrupamento === 'S');
  const somaT = titulos.reduce((s, t) => s + num(t.valor), 0);
  let n = 0;
  for (let i = 0; i < titulos.length; i++) {
    const t = titulos[i];
    const obsTitulo = String(t.obs ?? '').replace(/\r/g, '');
    let acum = 0;
    for (let j = 0; j < rateio.length; j++) {
      const x = rateio[j];
      const pct = num(x.valor) / S;
      let v = -r2(num(t.valor) * pct);
      if (i === titulos.length - 1 && j === rateio.length - 1) {
        // o último CC do último título fecha o total — e só aqui entram embutidos e descontos
        const base = agrup ? -(somaT - num(t.valor)) : num(t.valor);
        v = r2(-(base + SE - SD) - acum);
      }
      acum = r2(acum + v);
      await trx.insertInto('caixa').values({
        data: t.data, dtvenc: t.dtvenc, valor: v, vrtitulo: v, codplc: num(x.codcc) || null,
        codnf: num(t.idnf) > 0 ? num(t.idnf) : null, tiporecurso: t.tipodoc ?? null, codgrupo, nrparcela: t.nrparcela ?? null,
        codparceiro: t.codparceiro ?? null, idempresa: num(t.codempresa), operador, origem: 'APAGAR', idorigem: num(t.codapg),
        codcxapagar: num(x.codcxapagar),
        obs: `${obsTitulo} , ${(Math.round(pct * 10000) / 100).toFixed(2).replace('.', ',')}% do Documento nº ${num(t.codapg)}`.slice(0, 300),
      }).execute();
      n++;
    }
  }
  return n;
}
