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
