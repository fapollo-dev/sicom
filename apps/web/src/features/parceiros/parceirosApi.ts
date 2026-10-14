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

// ── a auditoria do uCadClientes.dfm (14/10/2026) ───────────────────────────────────────────────────────────────
/** FormShow/edtCodigoExit: as abas Histórico financeiro (PERMITIR_HISTORICO) e Dados financeiros (PARCEIRO_EXIBIR_DADOS_FINANCEIROS) */
export const configsParceiros = () => req<{ permitir_historico: boolean; exibir_dados_financeiros: boolean }>('/cadastro/parceiros/apoio/configs');
export interface LinhaHistoricoVendas { dtvenda?: string | null; nropedido?: string | null; nrocupom?: number | null; razao?: string | null; idempresa?: number | null; total: number }
/** a aba HISTÓRICO DE VENDAS (btnConsHistoricoVendasClick): período, origem (V = Vendas, P = Pedidos) e as lojas (vazio = a do login) */
export const historicoVendasParceiro = (cod: number, p: { de: string; ate: string; origem: 'V' | 'P'; empresas?: string }) =>
  req<{ origem: 'V' | 'P'; empresas: number[]; linhas: LinhaHistoricoVendas[]; total: number }>(
    `/cadastro/parceiros/${cod}/historico-vendas?de=${p.de}&ate=${p.ate}&origem=${p.origem}${p.empresas ? `&empresas=${encodeURIComponent(p.empresas)}` : ''}`);
/** "Visualizar senha dados financeiros" (só com a opção VISUALIZARSENHADADOSFINANCEIROS1) */
export const senhaAutPdvParceiro = (cod: number) => req<{ codparceiro: number; senha_autpdv: string | null }>(`/cadastro/parceiros/${cod}/senha-autpdv`);
