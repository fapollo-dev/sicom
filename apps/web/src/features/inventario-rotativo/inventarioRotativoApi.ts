/**
 * Fetcher do INVENTÁRIO ROTATIVO (FRMRELINVENTARIOROTATIVO): lotes com o estado derivado, abrir/alterar/fechar e
 * o zerar-estoque da grade (que exige liberação por login). Headers/envelope no padrão dos demais.
 */
import { isErroResposta, type ErroResposta, type LoteRotativoResumo } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: apiHeaders() });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: (body as any)?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export type { LoteRotativoResumo };

/** GET — lotes da empresa; `aberto` é DERIVADO (existe ABERTO e não existe FECHADO). */
export function listarLotesRotativo(): Promise<{ itens: LoteRotativoResumo[] }> {
  return req('/cadastro/inventario-rotativo', { method: 'GET' });
}
/** POST — abre o lote (nome obrigatório; filtros vazios gravam NULL, como no golden). */
export function criarLoteRotativo(body: Record<string, unknown>): Promise<{ codinv_rotativo: number; lote: number }> {
  return req('/cadastro/inventario-rotativo', { method: 'POST', body: JSON.stringify(body) });
}
/** PUT — altera só o cabeçalho do lote aberto (o legado não recria os departamentos). */
export function alterarLoteRotativo(codinv: number, body: Record<string, unknown>): Promise<{ codinv_rotativo: number }> {
  return req(`/cadastro/inventario-rotativo/${codinv}`, { method: 'PUT', body: JSON.stringify(body) });
}
/** POST fechar — sem `lote` cria número novo e carimba as coletas órfãs; com `lote` copia o cabeçalho do aberto. */
export function fecharLoteRotativo(body: { lote?: number }): Promise<{ lote: number; coletas_carimbadas: number; ja_fechado: boolean; departamentos: number }> {
  return req('/cadastro/inventario-rotativo/fechar', { method: 'POST', body: JSON.stringify(body) });
}
/** POST zerar-estoque — loja e/ou depósito, com liberação por login (config USUARIOS_ZERAM_ESTOQUE_INVENTARIO). */
export function zerarEstoqueRotativo(body: { idprodutos: number[]; loja?: boolean; deposito?: boolean; lote?: number; login: string; senha: string }): Promise<{ zerados: number; ajustes: number; coletas: number; liberado_por: number | null }> {
  return req('/cadastro/inventario-rotativo/zerar-estoque', { method: 'POST', body: JSON.stringify(body) });
}
