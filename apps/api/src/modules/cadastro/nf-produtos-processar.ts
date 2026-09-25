/**
 * O que PROCESSAR uma NF de ENTRADA faz aos produtos — `TDMNF.UpdateProdutos` (udmNF.pas:6778-7898), chamado pelo `TfrmEstoqueNF`
 * (recon e cortes em `docs/04-screen-dossier/dossiers/retaguarda/uEstoqueNF-UpdateProdutos.md`):
 *  - o par no HISTORICO_PROCESSAMENTO_NF por item com linha de preço na loja: 'PRODUTO' = a linha de preço ANTES e 'PROCESSAMENTO' = os
 *    valores da nota (udmNF.pas:6803-7024; 61.741 de 61.741 itens de entrada de 2026 têm o par; as fórmulas batem 99,9-100%);
 *  - entrada normal (CFOP da nota não é transferência nem devolução): na PRODUTOS o fornecedor (ATUALIZA_FORNEC_PRODUTO_PROCESSAR_NF, 'S'
 *    no módulo Retaguarda — 925 de 926 trocas acontecem), o PIS e a alteração; o FATORCX NÃO (o binário novo não grava: 576 de 576);
 *  - na linha de preço, SEMPRE (udmNF.pas:7514-7571): custo fiscal, ST, FCP-ST, seguro, frete, markup, ICME efetivo, despesas, IPI, frete 2,
 *    créditos, débitos, a escada, CSI, PMZ, venda sugerida, bonificação e ajuste;
 *  - o CUSTO (VRCUSTO = o contábil, VRCUSTOREAL, VRCUSTOREP) só com as 3 chaves: "altera custo" (a entrada), NF_PROD.ATUALIZA_MULTIPRECO_
 *    DECOMP = 'S' e CFOP(item).ALTERA_CUSTO_NF = 'S' (udmNF.pas:7507-7510) — e o histórico dinâmico 'NF de Entrada' (VRCUSTO) e
 *    'Processamento da NF Nro: X' (VRCUSTOREAL), como o binário novo grava; as linhas "Alteracao do Valor de Custo…" vêm do gatilho
 *    (mig 354).
 * Transferência: só o histórico (o dado: 0 de 231 itens com o custo alterado, apesar da config). Devolução: só o histórico. Reverter não
 * desfaz nada disto (uNF.pas:8913-9186). O preço de venda (lote/on-line) é o `nf-preco-venda-processar.ts`; o operador pode desmarcar o
 * "altera custo" de um item na tela de processar (a chave ESTO; padrão marcada na entrada, uEstoqueNF.pas:1838).
 */
import { sql } from 'kysely';
import { configNaTrx } from '../compras/pedido-heranca';
import { custoDoItemNaEntrada, arred, type EmpresaCusto } from './nf-custo-item';
import { opcoesDePreco, precoDeVendaDoItem, type PedidoPrecoProcessar } from './nf-preco-venda-processar';

type AnyDB = any;
const n = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};
const BONIFICACAO = ['1910', '2910', '5910', '6910'];
const div = (a: number, b: number) => (b > 0 ? a / b : 0);
/** o número como o `FloatToStr` do Delphi escreve no histórico da aplicação (vírgula, até 15 dígitos significativos) */
const floatToStr = (v: unknown) => String(Number(n(v).toPrecision(15))).replace('.', ',');

/** o que o operador escolhe na tela de processar (`TfrmEstoqueNF`): o preço de venda e os itens sem "altera custo" */
export interface OpcoesProcessarEntrada { precos?: PedidoPrecoProcessar; semAlterarCusto?: number[] }

export async function atualizarProdutosDaEntrada(trx: AnyDB, codnf: number, emp: number, op: number | null, opcoes: OpcoesProcessarEntrada = {}): Promise<void> {
  const nf = (await trx.selectFrom('nf').select(['tipo', 'cfop', 'codparceiro', 'nronf', 'nf_importacao_nfe', 'totalprod']).where('codnf', '=', codnf).executeTakeFirst()) as
    Record<string, unknown> | undefined;
  if (!nf || String(nf.tipo) !== 'E') return;
  const cfopNota = (await trx.selectFrom('cfop').select(['proc_transf', 'devolucao']).where(sql`codcfop::text`, '=', String(nf.cfop ?? '')).executeTakeFirst()) as
    { proc_transf?: string; devolucao?: string } | undefined;
  const transferencia = String(cfopNota?.proc_transf ?? '') === 'S';
  const devolucao = !transferencia && String(cfopNota?.devolucao ?? '') === 'S';
  const empresa = ((await trx.selectFrom('empresas').select(['classfiscal', 'despfederativas', 'despoperacional', 'alqsimplesnac', 'imprenda', 'contsocial', 'uf'])
    .where('idempresa', '=', emp).executeTakeFirst()) ?? {}) as EmpresaCusto;
  const ctxCfg = { empresaId: emp, operadorId: op, modulo: 'Retaguarda' };
  const aproveitamento = String((await configNaTrx(trx, 'APROVEITAMENTO_CREDITO_ICMSST_NF', ctxCfg)) ?? 'N').toUpperCase() === 'S';
  const trocaFornecedor = String((await configNaTrx(trx, 'ATUALIZA_FORNEC_PRODUTO_PROCESSAR_NF', ctxCfg)) ?? 'N').toUpperCase() === 'S';
  const precos = await opcoesDePreco(trx, codnf, emp, op, opcoes.precos);
  const semCusto = new Set((opcoes.semAlterarCusto ?? []).map(Number));
  const ctxPreco = {
    emp, op, nronf: String(nf.nronf ?? ''),
    empresas: ((await trx.selectFrom('empresas').select('idempresa').orderBy('idempresa').execute()) as Array<{ idempresa: number }>).map((r) => Number(r.idempresa)),
    atualizarGrupoCfg: String((await configNaTrx(trx, 'ENTRADA_ATUALIZAR_PRECO_GRUPO', ctxCfg)) ?? 'N').toUpperCase() === 'S',
    geraLoteSoAlterado: String((await configNaTrx(trx, 'GERA_LOTE_PROD_ALTERADO', ctxCfg)) ?? 'N').toUpperCase() === 'S',
  };
  const itens = (await trx.selectFrom('nf_prod as np').leftJoin('cfop as c', (j: any) => j.on(sql`c.codcfop::text`, '=', sql`np.cfop::text`))
    .selectAll('np').select(['c.altera_custo_nf']).where('np.codnf', '=', codnf).orderBy('np.codnfprod').execute()) as Array<Record<string, unknown>>;
  const umItem = String(nf.nf_importacao_nfe ?? '') === 'S' && itens.length === 1 ? n(nf.totalprod) : null;
  const cfopNotaX910 = BONIFICACAO.includes(String(nf.cfop ?? ''));
  for (const it of itens) {
    const idp = Number(it.codproduto);
    const mp = (await trx.selectFrom('multi_preco').selectAll().where('idproduto', '=', idp).where('idempresa', '=', emp).executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!mp) continue; // só o produto com linha de preço na loja da nota (udmNF.pas:7320)
    const prod = (await trx.selectFrom('produtos as p').leftJoin('unidade as u', 'u.codunidade', 'p.codunidade')
      .select(['p.fatorcx', 'p.codfor', 'p.unidade', 'p.codgrupopreco', 'u.sigla']).where('p.idproduto', '=', idp).executeTakeFirst()) as Record<string, unknown> | undefined;
    const c = custoDoItemNaEntrada(it, empresa, { cfopNota: nf.cfop, aproveitamentoCreditoIcmsSt: aproveitamento, totalProdNotaUmItem: umItem });
    const qtd = n(it.quantidade) * (n(it.fatorembal) || 1);
    const q = c.qtdetotal || qtd;
    const esto = semCusto.has(Number(it.codnfprod)) ? 'N' : 'S';
    const alteraPreco = precos.modo !== 'nenhum' && precos.itens.has(Number(it.codnfprod));
    const deco = String(it.atualiza_multipreco_decomp ?? '') === 'S' ? 'S' : 'N';
    const cfopCusto = String(it.altera_custo_nf ?? '') === 'S' ? 'S' : 'N';
    const alteraCusto = esto === 'S' && deco === 'S' && cfopCusto === 'S' ? 'S' : 'N';
    const custoReal = n(it.custo_real_unit) || c.tempvrcusto;
    const csi = n(it.vrcustocsi) || c.tempvrcustocsi;
    const pmz = n(it.pmz) || c.temppmz;
    const vendaSug = n(it.vrvendasug);
    const bonifItemX910 = BONIFICACAO.includes(String(it.cfop ?? ''));
    const flagsItem = { geraestoque: it.geraestoque ?? null, usuconsumo: it.usoconsumo ?? 'N', origem_estoque: it.origem_estoque ?? null };
    // 'PRODUTO': a linha de preço como estava (udmNF.pas:6846-6900)
    await trx.insertInto('historico_processamento_nf').values({
      idempresa: emp, historico: 'PRODUTO', dthistorico: sql`now()`, usuhistorico: op, codnf, codnfprod: Number(it.codnfprod), codproduto: idp,
      codparceiro: prod?.codfor ?? null, unidade: String(prod?.sigla ?? prod?.unidade ?? '').trim() || null, fatorembal: prod?.fatorcx ?? null,
      vrcusto: mp.vrcusto, vrcustoreal: mp.vrcustoreal, vrcustorep: mp.vrcustorep, vrcustofiscal: mp.vrcustofiscal, vrcustocsi: mp.vrcustocsi, vrcustoajuste: mp.vrcustoajuste,
      pmz: mp.pmz, vrvenda: mp.vrvenda, vrvendasug: mp.vrvendasug, markup: mp.markup, margeml: mp.margeml, margeml2: mp.margeml2, margeml2v: mp.margeml2v, vendaliq: mp.vendaliq,
      lucrobrutov: mp.lucrobrutov, lucrobrutop: mp.lucrobrutop, despopv: mp.despopv, lucroliqv: mp.lucroliqv, lucroliqp: mp.lucroliqp, imprend: mp.imprend, contsocial: mp.contsocial,
      icme: mp.icme, icmst: mp.icmst, ipi: mp.ipi, vrfcpst: mp.vrfcpst, frete: mp.frete, frete2: mp.frete2, seguro: mp.seguro, despacessorio: mp.despacessorio,
      bonificacao: mp.bonificacao, creditoicm: mp.creditoicm, creditopiscofins: mp.creditopiscofins, debitoicm: mp.debitoicm, debitopiscofins: mp.debitopiscofins, ...flagsItem,
    }).execute();
    // 'PROCESSAMENTO': os valores da nota (udmNF.pas:6902-7023), um segundo depois
    const st = n(it.vricmst) > 0 && n(it.streal) === 0 ? n(it.vricmst) : n(it.streal);
    await trx.insertInto('historico_processamento_nf').values({
      idempresa: emp, historico: 'PROCESSAMENTO', dthistorico: sql`now() + interval '1 second'`, usuhistorico: op, codnf, codnfprod: Number(it.codnfprod), codproduto: idp,
      codparceiro: nf.codparceiro ?? null, unidade: it.unidade ?? null, fatorembal: it.fatorembal ?? null,
      vrcusto: arred(c.vrcustofinalc, 4), vrcustoreal: custoReal, vrcustorep: n(it.vrcustorep), vrcustofiscal: n(it.vrcusto), vrcustocsi: arred(csi, 4),
      vrcustoajuste: n(it.vrcustoajustenf), pmz: arred(pmz, 4), vrvenda: n(it.vrvenda), vrvendasug: vendaSug, markup: n(it.markup), margeml: n(it.markupl), margeml2: n(it.markupl2),
      margeml2v: n(it.margeml2v), vendaliq: n(it.vendaliq), lucrobrutov: n(it.lucrobrutov), lucrobrutop: n(it.lucrobrutop), despopv: n(it.despopv), lucroliqv: n(it.lucroliqv),
      lucroliqp: n(it.lucroliqp), imprend: n(it.imprend), contsocial: n(it.contsocial), icme: c.tempicmeefetivo, icmst: arred(div(st, q), 4), ipi: n(it.ipi),
      vrfcpst: arred(div(n(it.fcp_valor_st), q), 4), frete: n(it.frete), frete2: n(it.frete2), seguro: n(it.seguro), despacessorio: arred(div(n(it.depsacess), q), 4),
      bonificacao: cfopNotaX910 || bonifItemX910 ? 0 : n(it.bonificacao), creditoicm: c.creditoIcm, creditopiscofins: c.creditoPis, debitoicm: n(it.debitoicm),
      debitopiscofins: n(it.debitopiscofins), existealteracaocusto: alteraCusto, alteracustodeco: deco, alteracustoesto: esto, alteracustocfop: cfopCusto,
      existealteracaovenda: alteraPreco ? 'S' : 'N', alteravendaonline: alteraPreco && precos.modo === 'online' ? 'S' : 'N',
      alteravendalote: alteraPreco && precos.modo === 'lote' ? 'S' : 'N', ...flagsItem,
    }).execute();
    if (transferencia || devolucao) continue;

    // PRODUTOS (udmNF.pas:7336-7349): o fornecedor com a config, o PIS e a alteração — o FATORCX não (binário novo)
    await trx.updateTable('produtos').set({
      ...(trocaFornecedor && nf.codparceiro != null ? { codfor: Number(nf.codparceiro) } : {}),
      // o PIS do item (que no legado sempre vem do produto, uItensNF.pas:2574) — o item sem o flag não apaga o do produto
      ...(it.pis === 'S' || it.pis === 'N' ? { pis: it.pis } : {}), dtultimalteracao: sql`now()`, usultalteracao: op,
    }).where('idproduto', '=', idp).execute();

    // MULTI_PRECO da loja (udmNF.pas:7514-7571): o que muda sempre
    const set: Record<string, unknown> = {
      vrcustofiscal: n(it.vrcusto), icmst: arred(div(n(it.vricmst), qtd), 4), vrfcpst: arred(div(n(it.fcp_valor_st), qtd), 4), seguro: n(it.seguro), frete: n(it.frete),
      markup: n(it.markup), icme: c.tempicmeefetivo, despacessorio: arred(div(n(it.depsacess), qtd), 4), ipi: n(it.ipi), frete2: n(it.frete2), margeml: n(it.markupl),
      creditoicm: c.creditoIcm, creditopiscofins: c.creditoPis, debitoicm: n(it.debitoicm), debitopiscofins: n(it.debitopiscofins), vendaliq: n(it.vendaliq),
      lucrobrutov: n(it.lucrobrutov), lucrobrutop: n(it.lucrobrutop), despopv: n(it.despopv), lucroliqv: n(it.lucroliqv), lucroliqp: n(it.lucroliqp), imprend: n(it.imprend),
      contsocial: n(it.contsocial), margeml2v: n(it.margeml2v), margeml2: n(it.markupl2), vrcustocsi: arred(csi, 4), pmz: arred(pmz, 4), vrvendasug: vendaSug,
      vrcustoajuste: arred(div(n(it.vrcustoajustenf), qtd), 4), dtultimalteracao: sql`now()`, codusualt: op,
    };
    if (bonifItemX910) set.bonificacao = 0;
    else if (!cfopNotaX910) set.bonificacao = n(it.bonificacao);
    if (mp.vrvenda == null) set.vrvenda = 0;
    // o PREÇO DE VENDA (udmNF.pas:7363-7503): lote ou on-line, com o que o operador marcou
    const pv = await precoDeVendaDoItem(trx, ctxPreco, it, { codgrupopreco: prod?.codgrupopreco }, mp, precos);
    if (pv.vrvendaNota !== undefined) set.vrvenda = pv.vrvendaNota;
    // o CUSTO, com as 3 chaves (udmNF.pas:7178-7192, :7507-7510)
    if (alteraCusto === 'S') {
      const vrcusto = arred(c.vrcustofinalc, 4);
      const vrcustoreal = arred(custoReal, 4);
      const vrcustorep = arred(n(it.vrcustorep) || c.tempvrcustorep, 4);
      Object.assign(set, { vrcusto, vrcustoreal, vrcustorep });
      const hist = (campo: string, anterior: unknown, atual: string, historico: string, origem: string | null) => trx.insertInto('historico_dinamico').values({
        campo, valor_anterior: floatToStr(anterior), valor_atual: atual, tabela: 'MULTI_PRECO', data: sql`now()`, codoperador: op, codempresa: emp,
        chave: 'IDPRODUTO', valor_chave: String(idp), historico, origem,
      }).execute();
      if (n(mp.vrcusto) !== vrcusto) await hist('VRCUSTO', mp.vrcusto, floatToStr(c.vrcustofinalc), 'NF de Entrada', 'frmNF');
      if (n(mp.vrcustoreal) !== vrcustoreal) await hist('VRCUSTOREAL', mp.vrcustoreal, floatToStr(custoReal), `Processamento da NF Nro: ${String(nf.nronf ?? '').trim()}`, null);
    }
    await trx.updateTable('multi_preco').set(set).where('idproduto', '=', idp).where('idempresa', '=', emp).execute();
  }
}
