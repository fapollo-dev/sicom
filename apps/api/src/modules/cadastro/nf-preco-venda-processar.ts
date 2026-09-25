/**
 * O PREÇO DE VENDA no processar da NF de ENTRADA — `UpdateProdutos` (udmNF.pas:7352-7503, :7644-7697) com os padrões do
 * `TfrmEstoqueNF.FormShow` (uEstoqueNF.pas:1750-1770, :1835). Recon: `uEstoqueNF-UpdateProdutos.md` §1.2 e §2.5.
 *  - o item marca "Atualizar preço de venda? [F7]" (ALTERAPRECO) — padrão: o CFOP do CABEÇALHO com ATUALIZA_VENDA_NF = 'S' (na produção
 *    'N' em todos os CFOPs usados: o operador marca à mão — 29 itens em 2026);
 *  - modo: On-line (padrão), Gerar lote (EMPRESAS.PRECONF = 'L'), Não atualizar; BLOQUEAR_ATUALIZA_PRECO_ONLINE_NF = 'S' força o lote e
 *    desliga o on-line (a produção: 'S' no módulo Retaguarda — on-line 0 desde 2023);
 *  - Individual (só a loja da nota) ou Sincronizar empresas (EMPRESAS.SINCRONIZA_PRECO_NF = 'S' — todas as lojas);
 *  - LOTE: LOTEPRECO 'REFERENTE A NOTA FISCAL DE NRO. X' com o VRVENDA do item (4 casas), para o produto ou para o GRUPO DE PREÇO inteiro
 *    (sem olhar ENTRADA_ATUALIZAR_PRECO_GRUPO), um por loja no Sincronizar; com GERA_LOTE_PROD_ALTERADO = 'S' só se o preço (2 casas) difere
 *    do da loja da nota; e os lotes dos FILHOS (`GeraLoteFilho`); a loja em promoção fica de fora (e, no Sincronizar, a da nota barra todas);
 *  - ON-LINE: o VRVENDA da linha de preço da loja da nota = o do item; o grupo de preço só com ENTRADA_ATUALIZAR_PRECO_GRUPO; no Sincronizar
 *    o UPDATE em cada loja sem promoção; os filhos (`AtualizaPrecoFilho`) recebem custo, custo de reposição e venda do pai; o histórico
 *    dinâmico 'Processamento da NF Nro: X' (uma linha por loja no Sincronizar).
 * A promoção acumulativa (`PromocaoAcumulativa`, FuncoesApollo — fora do fonte) usa o mesmo proxy do pedido de compra: MULTI_PRECO.PROMOCAO.
 */
import { sql } from 'kysely';
import { configNaTrx } from '../compras/pedido-heranca';
import { gerarLotesFilhos } from '../precificacao/lote-filho';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = any;
const n = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const r4 = (x: number) => Math.round((x + Number.EPSILON) * 1e4) / 1e4;
const floatToStr = (v: unknown) => String(Number(n(v).toPrecision(15))).replace('.', ',');

export type ModoPreco = 'online' | 'lote' | 'nenhum';
export interface PedidoPrecoProcessar { modo?: ModoPreco; sincronizar?: boolean; itens?: number[] }
export interface OpcoesPrecoProcessar { modo: ModoPreco; sincronizar: boolean; onlineBloqueado: boolean; itens: Set<number> }

/** os padrões da tela de processar e o que o operador pediu por cima */
export async function opcoesDePreco(trx: AnyDB, codnf: number, emp: number, op: number | null, pedido?: PedidoPrecoProcessar): Promise<OpcoesPrecoProcessar> {
  const nf = (await trx.selectFrom('nf').select(['cfop']).where('codnf', '=', codnf).executeTakeFirst()) as { cfop?: unknown } | undefined;
  const cfop = (await trx.selectFrom('cfop').select('atualiza_venda_nf').where(sql`codcfop::text`, '=', String(nf?.cfop ?? '')).executeTakeFirst()) as
    { atualiza_venda_nf?: string } | undefined;
  const empresa = (await trx.selectFrom('empresas').select(['preconf', 'sincroniza_preco_nf']).where('idempresa', '=', emp).executeTakeFirst()) as
    { preconf?: string; sincroniza_preco_nf?: string } | undefined;
  const onlineBloqueado = String((await configNaTrx(trx, 'BLOQUEAR_ATUALIZA_PRECO_ONLINE_NF', { empresaId: emp, operadorId: op, modulo: 'Retaguarda' })) ?? 'N').toUpperCase() === 'S';
  let modo: ModoPreco = pedido?.modo ?? (String(empresa?.preconf ?? '').toUpperCase() === 'L' ? 'lote' : 'online');
  if (onlineBloqueado && modo === 'online') {
    if (pedido?.modo === 'online') throw new BusinessRuleError('NF_PRECO_ONLINE_BLOQUEADO');
    modo = 'lote';
  }
  const sincronizar = pedido?.sincronizar ?? String(empresa?.sincroniza_preco_nf ?? '').toUpperCase() === 'S';
  let itens: Set<number>;
  if (pedido?.itens) itens = new Set(pedido.itens.map(Number));
  else if (String(cfop?.atualiza_venda_nf ?? '').toUpperCase() === 'S') {
    itens = new Set(((await trx.selectFrom('nf_prod').select('codnfprod').where('codnf', '=', codnf).execute()) as Array<{ codnfprod: number }>).map((r) => Number(r.codnfprod)));
  } else itens = new Set();
  return { modo, sincronizar, onlineBloqueado, itens };
}

async function emPromocao(trx: AnyDB, idproduto: number, idempresa: number): Promise<boolean> {
  const r = (await trx.selectFrom('multi_preco').select('promocao').where('idproduto', '=', idproduto).where('idempresa', '=', idempresa).executeTakeFirst()) as
    { promocao?: string } | undefined;
  return r?.promocao === 'S';
}

/** os produtos do grupo de preço (ou só o produto) */
async function produtosDoGrupo(trx: AnyDB, idproduto: number, codgrupopreco: number | null): Promise<number[]> {
  if (!(n(codgrupopreco) > 0)) return [idproduto];
  const rows = (await trx.selectFrom('produtos').select('idproduto').where('codgrupopreco', '=', Number(codgrupopreco)).orderBy('idproduto').execute()) as Array<{ idproduto: number }>;
  return rows.length ? rows.map((r) => Number(r.idproduto)) : [idproduto];
}

/**
 * `AtualizaPrecoFilho` (UAtualizacaoPrecoFilho.pas:75-185): os filhos do pai (ou de cada produto do grupo) na loja recebem o custo, o custo
 * de reposição e a venda calculados do pai (`CalculaPrecoFilho` — o FATOR_FILHO é descartado no fonte); histórico 'Alteração de preço do
 * produto pai' na venda. O filtro do fonte (DIF ≠ 0 e TPDIF preenchido) caiu no binário novo, como no lote do filho (lote-filho.ts).
 */
async function atualizarFilhosOnline(trx: AnyDB, pais: number[], empresa: number, op: number | null): Promise<void> {
  for (const pai of pais) {
    const mp = (await trx.selectFrom('multi_preco').select(['vrcusto', 'vrcustorep', 'vrvenda']).where('idproduto', '=', pai).where('idempresa', '=', empresa).executeTakeFirst()) as
      Record<string, unknown> | undefined;
    if (!mp) continue;
    const filhos = (await sql<Record<string, unknown>>`
      SELECT f.idproduto, coalesce(f.dif_preco_prod_filho_x_pai, 0) AS dif, f.tpdif_preco_prod_filho_x_pai AS tp, mf.vrcusto, mf.vrcustorep, mf.vrvenda
        FROM produtos f JOIN multi_preco mf ON mf.idproduto = f.idproduto AND mf.idempresa = ${empresa}
       WHERE f.idproduto_pai = ${pai}`.execute(trx)).rows;
    for (const f of filhos) {
      const custo = n(mp.vrcusto);
      const custoRep = n(mp.vrcustorep);
      const vendaPai = n(mp.vrvenda);
      const venda = String(f.tp ?? '') === 'D' ? vendaPai + n(f.dif) : vendaPai + (vendaPai * n(f.dif)) / 100;
      if (r4(n(f.vrcusto)) === r4(custo) && r4(n(f.vrcustorep)) === r4(custoRep) && r4(n(f.vrvenda)) === r4(venda)) continue;
      if (r4(n(f.vrvenda)) !== r4(venda)) {
        await trx.insertInto('historico_dinamico').values({
          campo: 'VRVENDA', valor_anterior: String(n(f.vrvenda)), valor_atual: String(r4(venda)), tabela: 'MULTI_PRECO', data: sql`now()`, codoperador: op,
          codempresa: empresa, chave: 'IDPRODUTO', valor_chave: String(f.idproduto), historico: 'Alteração de preço do produto pai',
        }).execute();
      }
      await trx.updateTable('multi_preco').set({ vrcusto: r4(custo), vrcustorep: r4(custoRep), vrvenda: r4(venda) })
        .where('idproduto', '=', Number(f.idproduto)).where('idempresa', '=', empresa).execute();
    }
  }
}

/**
 * aplica o preço de venda de UM item (a linha de preço da loja da nota é gravada por quem chama — devolve o VRVENDA dela quando muda)
 */
export async function precoDeVendaDoItem(
  trx: AnyDB, ctx: { emp: number; op: number | null; nronf: string; empresas: number[]; atualizarGrupoCfg: boolean; geraLoteSoAlterado: boolean },
  it: Record<string, unknown>, prod: { codgrupopreco?: unknown }, mpNota: Record<string, unknown>, opcoes: OpcoesPrecoProcessar,
): Promise<{ vrvendaNota?: number }> {
  if (opcoes.modo === 'nenhum' || !opcoes.itens.has(Number(it.codnfprod))) return {};
  const idp = Number(it.codproduto);
  const venda = n(it.vrvenda);
  const temGrupo = n(prod.codgrupopreco) > 0;
  const alvosEmpresa = opcoes.sincronizar ? ctx.empresas : [ctx.emp];
  if (opcoes.modo === 'lote') {
    // o lote vai para o grupo de preço inteiro quando o produto tem grupo — sem olhar a config (udmNF.pas:7447)
    const produtos = await produtosDoGrupo(trx, idp, temGrupo ? Number(prod.codgrupopreco) : null);
    const promoNota = await emPromocao(trx, idp, ctx.emp);
    for (const e of alvosEmpresa) {
      if (promoNota || (opcoes.sincronizar && (await emPromocao(trx, idp, e)))) continue;
      // GERA_LOTE_PROD_ALTERADO compara com o preço da loja DA NOTA, em 2 casas (udmNF.pas:7428-7434)
      if (ctx.geraLoteSoAlterado && r2(venda) === r2(n(mpNota.vrvenda))) continue;
      for (const p of produtos) {
        await trx.insertInto('lote_preco').values({
          idproduto: p, vrvenda: r4(venda), datalote: sql`now()`, processado: 'N', obs: `REFERENTE A NOTA FISCAL DE NRO. ${ctx.nronf.trim()}`, codempresa: e,
        }).execute();
        await gerarLotesFilhos(trx, p, e, venda, null);
      }
    }
    return {};
  }
  // ON-LINE
  const grupoOnline = temGrupo && ctx.atualizarGrupoCfg;
  const antes = (await trx.selectFrom('multi_preco').select(['vrvenda', 'idempresa']).where('idproduto', '=', idp).orderBy('idempresa').execute()) as
    Array<{ vrvenda: unknown; idempresa: number }>;
  const alvos = grupoOnline ? await produtosDoGrupo(trx, idp, Number(prod.codgrupopreco)) : [idp];
  if (!opcoes.sincronizar) {
    if (grupoOnline) {
      await trx.updateTable('multi_preco').set({ vrvenda: r2(venda) }).where('idproduto', 'in', alvos).where('idempresa', '=', ctx.emp).execute();
      await atualizarFilhosOnline(trx, alvos, ctx.emp, ctx.op);
    }
  } else if (!(await emPromocao(trx, idp, ctx.emp))) {
    for (const e of ctx.empresas) {
      if (await emPromocao(trx, idp, e)) continue;
      await trx.updateTable('multi_preco').set({ vrvenda: r2(venda) }).where('idproduto', 'in', alvos).where('idempresa', '=', e).execute();
      await atualizarFilhosOnline(trx, grupoOnline ? alvos : [idp], e, ctx.op);
    }
  }
  // o histórico da aplicação (udmNF.pas:7644-7697): no Sincronizar uma linha por loja que tinha preço; no Individual, a da nota
  const hist = (anterior: unknown, empresa: number) => trx.insertInto('historico_dinamico').values({
    campo: 'VRVENDA', valor_anterior: floatToStr(anterior), valor_atual: floatToStr(venda), tabela: 'MULTI_PRECO', data: sql`now()`, codoperador: ctx.op,
    codempresa: empresa, chave: 'IDPRODUTO', valor_chave: String(idp), historico: `Processamento da NF Nro: ${ctx.nronf}`,
  }).execute();
  if (opcoes.sincronizar) for (const a of antes) await hist(a.vrvenda, Number(a.idempresa));
  else {
    const a = antes.find((x) => Number(x.idempresa) === ctx.emp);
    if (a) await hist(a.vrvenda, ctx.emp);
  }
  return { vrvendaNota: venda };
}
