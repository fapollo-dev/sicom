/**
 * As travas do PROCESSAR da nota que dependem do indexador e do total de conferência — `TfrmNF.Processamento`
 * (uNF.pas:14937-15081), na ordem dele:
 *  1. `ValidaIndexadores` (:14937-14967): loja 'O', terceiros (TIPOEMISSAO 1), fornecedor que não é livre de indexador, NF não liberada
 *     do indexador, CFOP da nota fora de 1152/1409/2401, nota IMPORTADA ('S') com algum item de INDEXADORTRIB nulo ou 0 → "Existe(m)
 *     item(ns) sem indexador tributário configurado";
 *  2. o TOTAL NF digitado (VALIDATOTALNF) confere com o total da nota, em 2 casas, na entrada de terceiros fora da finalidade 2
 *     (:15003-15009) — 6.494 de 6.494 processadas em 2026 conferem;
 *  3. loja 'D', terceiros, fora da devolução (finalidade 4) e da importação 'T': algum item REPASSADO 'N' → "Não é permitido
 *     processamento sem repassar todos os itens!" (:15011-15030). No legado ela depende de uma chave do ConfigDB.xml da ESTAÇÃO
 *     ("BLOQUEAR PROCESSAMENTO NF SEM REPASSAR ITENS"), que sem a chave vale ligada — é o que vale aqui;
 *  4. loja 'O'/'S', fora da finalidade 4 e da 'T': algum item REPASSADO 'N' → a mesma mensagem (:15032-15051). NULL passa (o filtro do
 *     ClientDataSet não pega nulo) — o item nunca analisado passa por esta e é pego pela 1.
 * E a SAÍDA tem a sua `ValidaIndexadores` (:14969-14995): loja 'O', destinatário que não é livre, NF não liberada, fora da devolução de
 * compra e CFOP da nota 5102/6102/5403/6403/5949/6949, com algum item de INDEXADORTRIB nulo ou 0 — a mesma mensagem.
 */
import { BusinessRuleError } from '../../shared/errors/app-error';
import { sql } from 'kysely';

type AnyDB = any;
const n = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : 0;
};

export async function validarTravasDoIndexadorNoProcessamento(trx: AnyDB, codnf: number): Promise<void> {
  const nf = (await trx.selectFrom('nf as n')
    .leftJoin('empresas as e', 'e.idempresa', 'n.idempresa')
    .leftJoin('parceiros as p', 'p.codparceiro', 'n.codparceiro')
    .select(['n.tipo', 'n.tipoemissao', 'n.cfop', 'n.finalidade', 'n.nf_importacao_nfe', 'n.libera_nf_indexador', 'n.validatotalnf', 'n.totalnf',
      'n.cod_ped_dev_compra', 'e.figurafiscal', 'p.retira_fornindex'])
    .where('n.codnf', '=', codnf).executeTakeFirst()) as Record<string, unknown> | undefined;
  if (!nf) return;
  const figura = String(nf.figurafiscal ?? 'D').trim().toUpperCase();
  if (String(nf.tipo) === 'S') {
    if (figura === 'O' && String(nf.retira_fornindex ?? '') !== 'S' && String(nf.libera_nf_indexador ?? '') !== 'S' && !(n(nf.cod_ped_dev_compra) > 0)
      && [5102, 6102, 5403, 6403, 5949, 6949].includes(n(nf.cfop))) {
      const sem = ((await trx.selectFrom('nf_prod').select(['nroitem', 'indexadortrib']).where('codnf', '=', codnf).orderBy('nroitem').execute()) as
        Array<{ nroitem: unknown; indexadortrib: unknown }>).filter((i) => !(n(i.indexadortrib) > 0)).map((i) => n(i.nroitem));
      if (sem.length) throw new BusinessRuleError('NF_ITEM_SEM_INDEXADOR', { itens: sem });
    }
    return;
  }
  if (String(nf.tipo) !== 'E') return;
  const terceiros = String(nf.tipoemissao ?? '').trim() === '1';
  const importacao = String(nf.nf_importacao_nfe ?? '').trim().toUpperCase();
  const finalidade = String(nf.finalidade ?? '').trim();
  const itens = (await trx.selectFrom('nf_prod').select(['nroitem', 'indexadortrib', 'repassado']).where('codnf', '=', codnf).orderBy('nroitem').execute()) as
    Array<{ nroitem: unknown; indexadortrib: unknown; repassado: unknown }>;
  // 1. ValidaIndexadores
  if (figura === 'O' && terceiros && String(nf.retira_fornindex ?? '') !== 'S' && String(nf.libera_nf_indexador ?? '') !== 'S'
    && ![1152, 1409, 2401].includes(n(nf.cfop)) && importacao === 'S') {
    const sem = itens.filter((i) => !(n(i.indexadortrib) > 0)).map((i) => n(i.nroitem));
    if (sem.length) throw new BusinessRuleError('NF_ITEM_SEM_INDEXADOR', { itens: sem });
  }
  // 2. o total de conferência
  if (terceiros && finalidade !== '2' && n(nf.validatotalnf).toFixed(2) !== n(nf.totalnf).toFixed(2)) {
    throw new BusinessRuleError('NF_TOTAL_NF_DIVERGENTE', { informado: n(nf.validatotalnf), total: n(nf.totalnf) });
  }
  // 3 e 4. os itens não repassados
  const naoRepassados = itens.filter((i) => String(i.repassado ?? '') === 'N').map((i) => n(i.nroitem));
  const foraDaIsencao = finalidade !== '4' && importacao !== 'T';
  if (naoRepassados.length && foraDaIsencao && (figura !== 'D' || terceiros)) {
    throw new BusinessRuleError('NF_ITENS_NAO_REPASSADOS', { itens: naoRepassados });
  }
}

/**
 * As travas da DECOMPOSIÇÃO no processar (`TfrmNF.Processamento`, uNF.pas:14810-14817), antes das demais:
 *  1. só na entrada, `ValidaProdutosComEntradaEmDecomposicao` (:16887-16912): o 1º item (na ordem da nota) cujo produto tem
 *     ENTRADA_DECOMPOSTA='S' — um pai que ainda não foi trocado pelos filhos — bloqueia. Sem isto, o processamento moveria o
 *     estoque do PAI (na produção, 0 itens assim nas entradas de 2026: o legado nunca deixa passar);
 *  2. na entrada e na saída, `ValidaProdutosComDecomposicao` (:16846-16885 → `ProdutoComDecomposicaoValida`, udmNF.pas:11730-11756):
 *     cada item cujo produto tem DECOMPOSICAO='S' e cadastro em DECOMPOSICAO com algum PERCENTUAL <= 0 ou soma ≠ 100,00 entra na
 *     lista (um código por item, na ordem da nota). Produto sem linhas no cadastro passa.
 */
export async function validarDecomposicaoNoProcessamento(trx: AnyDB, codnf: number): Promise<void> {
  const nf = (await trx.selectFrom('nf').select(['tipo']).where('codnf', '=', codnf).executeTakeFirst()) as { tipo: unknown } | undefined;
  if (!nf) return;
  const itens = (await sql<{ codproduto: number; descricao: string | null; entrada_decomposta: string | null; decomposicao: string | null }>`
    SELECT i.codproduto, i.descricao, p.entrada_decomposta, p.decomposicao
      FROM nf_prod i LEFT JOIN produtos p ON p.idproduto = i.codproduto
     WHERE i.codnf = ${codnf}
     ORDER BY i.nroitem NULLS LAST, i.codnfprod`.execute(trx)).rows;
  if (String(nf.tipo) === 'E') {
    const pai = itens.find((i) => String(i.entrada_decomposta ?? '') === 'S');
    if (pai) {
      throw new BusinessRuleError('NF_ENTRADA_EM_DECOMPOSICAO', { codproduto: pai.codproduto, descricao: pai.descricao },
        `Produto: ${pai.descricao ?? ''}, com entrada em decomposição. Os produtos da decomposição deverão ser lançados à nota. Altere a nota fiscal para iniciar a decomposição.`);
    }
  }
  const comDecomposicao = itens.filter((i) => String(i.decomposicao ?? 'N') === 'S');
  if (!comDecomposicao.length) return;
  const cadastro = (await sql<{ idproduto: number; linhas: number; negativos: number; total: string | null }>`
    SELECT idproduto, COUNT(*)::int AS linhas, COUNT(*) FILTER (WHERE COALESCE(percentual, 0) <= 0)::int AS negativos, SUM(percentual) AS total
      FROM decomposicao WHERE idproduto = ANY(${[...new Set(comDecomposicao.map((i) => Number(i.codproduto)))]}::int[])
     GROUP BY idproduto`.execute(trx)).rows;
  const porProduto = new Map(cadastro.map((c) => [Number(c.idproduto), c]));
  const invalidos = comDecomposicao.map((i) => Number(i.codproduto)).filter((cod) => {
    const c = porProduto.get(cod);
    return !!c && c.linhas > 0 && (c.negativos > 0 || n(c.total).toFixed(2) !== '100.00');
  });
  if (invalidos.length) {
    throw new BusinessRuleError('NF_DECOMPOSICAO_INVALIDA', { produtos: invalidos },
      `Os produtos ${invalidos.join(',')} estão com erros na decomposição. Verifique o cadastro do produto para continuar com o processamento da nota fiscal!`);
  }
}
