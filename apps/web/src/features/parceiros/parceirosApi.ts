/**
 * Fetchers específicos da tela unificada de PARCEIROS que NÃO cabem no
 * `createResourceApi` genérico (cujo `listar` só repassa `PesquisaParams`):
 *  - `buscarCep` → GET /cadastro/cep/:cep (proxy de CEP do legado; autofill do
 *    endereço). Bate em rede EXTERNA via API — por isso os testes web não o exercem.
 *
 * O CRUD agregado de parceiros (master + endereços) usa o `createResourceApi(
 * 'cadastro/parceiros')` padrão pelo pilar <CadMaster>; os LOOKUPs de vendedor/convênio
 * usam `useResourceOptions` com o filtro de flag — nada disso precisa de fetcher dedicado.
 */
import { isErroResposta, type CepResposta, type ErroResposta } from '@apollo/shared';

import { apiHeaders, handle401 } from '../../shared/auth/session';
const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** Mesma semântica do `req` do resourceApi (envelope ErroResposta — ADR-015). */
async function req<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body)
      ? body
      : { statusCode: res.status, code: 'ERRO', message: body?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), {
      envelope,
      status: res.status,
      body,
    });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** só dígitos do CEP (o proxy aceita com/sem máscara; normalizamos por garantia). */
const soDigitosCep = (cep: string) => (cep ?? '').replace(/\D/g, '');

/**
 * Consulta o proxy de CEP (GET /cadastro/cep/:cep) — autofill de endereço/bairro/
 * cidade/uf/idcidade. Lança o envelope PT padrão em CEP inválido/não-encontrado
 * (apresentado via `useMensagem`). Rede externa: não é coberto pelos testes web.
 */
export function buscarCep(cep: string): Promise<CepResposta> {
  return req<CepResposta>(`/cadastro/cep/${soDigitosCep(cep)}`);
}
