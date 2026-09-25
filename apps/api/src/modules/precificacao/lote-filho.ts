import { sql } from 'kysely';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

/**
 * PREÇO DOS PRODUTOS FILHOS (`TAtualizacaoPrecoFilho.GeraLoteFilho`, chamado em `InsereAjustePreco:1019`).
 *
 * Precificar o pai enfileira lote **para os filhos também**. É a parte da tela que mexe em preço de produto
 * que o operador não está vendo — CHUCHU KG sobe, CHUCHU PICADO KG vai junto.
 *
 * A conta (`CalculaPrecoFilho:187`):
 * ```
 * tipo 'D'      → preço do filho = preço do pai + diferença        (valor absoluto)
 * qualquer outro→ preço do filho = preço do pai × (1 + diferença/100)
 * ```
 * Sem diferença configurada, o filho fica **com o preço do pai** — e é isso que o cliente usa hoje.
 *
 * ⛔ **`FATOR_FILHO` não multiplica nada.** `CalculaPrecoFilho` abre com `pFatorFilho := 1;` e o `iif`
 * original está comentado: o campo é lido, passado e descartado na primeira linha. Em produção os 200
 * produtos com pai têm fator 1, então ninguém percebeu. Copiado como está — ligar o fator agora mudaria
 * preço sem ninguém ter pedido.
 *
 * ⚠️ **o filtro do fonte não vale mais** (ver a migration 212): o fonte de 2020 só considera filho com
 * `DIF <> 0 AND TPDIF IS NOT NULL`; a produção de 2026 tem 670 lotes de filho e **nenhum** com DIF. A
 * fórmula do fonte está certa, o filtro é que caiu no binário novo — e o dado, que é vivo, decide.
 *
 * Como no legado, só enfileira **se o preço mudar** — senão a fila encheria de lote inócuo a cada
 * precificação.
 */
/**
 * `op`: o operador — o binário novo grava o CODOPERADOR no lote do filho (49 de 49 de set/2026) e o VRCUSTO_ANTERIOR = o custo da linha
 * de preço do filho (49 de 49)
 */
export async function gerarLotesFilhos(trx: AnyDB, idprodutoPai: number, empresa: number, novoPrecoPai: number, origem: string | null, op: number | null = null): Promise<number> {
  const filhos = (await sql<Record<string, unknown>>`
    SELECT f.idproduto,
           coalesce(f.dif_preco_prod_filho_x_pai, 0) AS dif,
           f.tpdif_preco_prod_filho_x_pai AS tp,
           coalesce(mf.vrvenda, 0) AS vrvenda_filho,
           mf.vrcusto AS vrcusto_filho
      FROM produtos f
      LEFT JOIN multi_preco mf ON mf.idproduto = f.idproduto AND mf.idempresa = ${empresa}
     WHERE f.idproduto_pai = ${idprodutoPai}
  `.execute(trx)).rows;

  let n = 0;
  for (const f of filhos) {
    // ⚠️ a base é o preço NOVO que está sendo aplicado ao pai, não o que está valendo — quem chama passa o preço do
    // grid/do cadastro para `GeraLoteFilho`. Usar o vigente prenderia o filho no preço velho.
    const pai = novoPrecoPai;
    const dif = num(f.dif);
    const novoPreco = r2(String(f.tp ?? '') === 'D' ? pai + dif : pai + (pai * dif) / 100);
    if (novoPreco <= 0) continue;
    // o legado compara com o preço atual do filho e só enfileira o que muda
    if (Math.abs(novoPreco - num(f.vrvenda_filho)) < 0.005) continue;
    await trx.insertInto('lote_preco').values({
      idproduto: Number(f.idproduto),
      vrvenda: novoPreco,
      datalote: sql`now()`,
      processado: 'N',
      // texto fixo do legado (`InsereLote:310`); o lote do filho não leva markup — o operador e o custo anterior, sim (binário novo)
      obs: 'REFERENTE A ALTERAÇÃO DE PREÇO DO PRODUTO PAI',
      codempresa: empresa,
      origem,
      codoperador: op,
      vrcusto_anterior: f.vrcusto_filho ?? null,
    }).execute();
    n += 1;
  }
  return n;
}
