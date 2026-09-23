/**
 * CFOP × SITUAÇÃO DA NF (`validaCFOP_SituacaoNF`, udmNF.pas:7900; UCadSituacaoNF.md C2). A situação lista os CFOPs que
 * aceita (ISITUACAO_NF); situação sem CFOP nenhum recusa qualquer CFOP, como o `Locate` do legado.
 */
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { configNaTrx } from '../compras/pedido-heranca';

type AnyDB = any;

/** os CFOPs de cada situação, lidos uma vez por chamada */
export function leitorCfopsDaSituacao(db: AnyDB): (sit: number) => Promise<Set<number>> {
  const cache = new Map<number, Set<number>>();
  return async (sit) => {
    if (!cache.has(sit)) {
      const rows = (await db.selectFrom('isituacao_nf').select('codcfop').where('idsituacao_nf', '=', sit).execute()) as Array<{ codcfop: unknown }>;
      cache.set(sit, new Set(rows.map((r) => Number(r.codcfop))));
    }
    return cache.get(sit)!;
  };
}

/** a nota inteira é conferida na ENTRADA ou com `VALIDA_CFOP_SITUACAO_NF_SAIDA='S'` (uNF.pas:14921 — na produção 'N') */
export async function conferirNotaInteira(db: AnyDB, tipo: string, emp: number | null): Promise<boolean> {
  if (tipo === 'E') return true;
  const v = await configNaTrx(db, 'VALIDA_CFOP_SITUACAO_NF_SAIDA', { empresaId: emp, operadorId: currentTenant().operadorId ?? null });
  return String(v ?? 'N').toUpperCase() === 'S';
}

/**
 * o PROCESSAMENTO (uNF.pas:14921; uProcessaNotaFiscal.pas:587 `ValidaSituacoesDosCFOPs`): com situação na nota, cada
 * item pelo CFOP da situação DELE (a do cabeçalho quando o item não tem) — o que pega a nota gravada antes da regra
 * ou o item que veio por importação.
 */
export async function validarItensNoProcessamento(db: AnyDB, codnf: number, emp: number): Promise<void> {
  const nf = (await db.selectFrom('nf').select(['tipo', 'idsituacao_nf']).where('codnf', '=', codnf).where('idempresa', '=', emp)
    .executeTakeFirst()) as { tipo?: string; idsituacao_nf?: unknown } | undefined;
  const sitNf = Number(nf?.idsituacao_nf ?? 0);
  if (!nf || !(sitNf > 0) || !(await conferirNotaInteira(db, String(nf.tipo ?? ''), emp))) return;
  const cfopsDe = leitorCfopsDaSituacao(db);
  const itens = (await db.selectFrom('nf_prod').select(['codproduto', 'cfop', 'idsituacao_nf']).where('codnf', '=', codnf).orderBy('codnfprod')
    .execute()) as Array<{ codproduto: unknown; cfop: unknown; idsituacao_nf: unknown }>;
  for (const it of itens) {
    const sitIt = Number(it.idsituacao_nf ?? 0) > 0 ? Number(it.idsituacao_nf) : sitNf;
    if (!(await cfopsDe(sitIt)).has(Number(it.cfop ?? 0))) {
      throw new BusinessRuleError('NF_ITEM_CFOP_SITUACAO', { cfop: it.cfop == null ? null : Number(it.cfop), idsituacao_nf: sitIt, codproduto: it.codproduto });
    }
  }
}
