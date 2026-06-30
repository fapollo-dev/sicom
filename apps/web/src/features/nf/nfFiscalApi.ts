/**
 * Fetcher do RECÁLCULO fiscal da NF (F2 — REUSO do motor, não reescrita). A tela ARMAZENA a
 * config fiscal por item; o cálculo (ICMS próprio + ICMS-ST + IPI) é REUSADO de
 * `POST /fiscal/nf/recalcular`, que no back reusa o módulo `precificacao` (DET_ALIQUOTA +
 * INDEXADOR + FiscalPricingService). PURO: devolve o dto com os itens enriquecidos, NÃO grava.
 * Mesma semântica de headers/BASE e envelope `ErroResposta` (ADR-015) do `precificacaoApi`.
 */
import { isErroResposta, type ErroResposta, type CriarNfDto } from '@apollo/shared';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const HEADERS = {
  'content-type': 'application/json',
  'x-tenant-id': 'pinheirao',
  'x-operador-id': '7',
  'x-empresa-id': '1',
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: HEADERS });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body)
      ? body
      : { statusCode: res.status, code: 'ERRO', message: body?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return (await res.json()) as T;
}

/**
 * Recalcula os impostos por item REUSANDO o motor do back. Recebe o dto atual da NF (header
 * + itens) e devolve o MESMO dto com os campos fiscais por item preenchidos
 * (vrbasecalculo/vricm/cst/icme/bcr/vripi e, p/ ST, vrbasest/vricmst). Lança o envelope PT em
 * erro (alíquota/indexador não cadastrados → 422), apresentado via `useMensagem`. Não testado
 * em web (rede via API, mesma política do `precificarProduto`).
 */
export function recalcularNf(dto: CriarNfDto): Promise<CriarNfDto> {
  return req<CriarNfDto>('/fiscal/nf/recalcular', { method: 'POST', body: JSON.stringify(dto) });
}
