/** Cliente da tela de CONFIGURAÇÕES (UConfigura): catálogo chave-valor + overrides por escopo. */
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../../shared/auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface ConfigOpcao {
  valor: string;
  label: string;
}
export interface ConfigItem {
  id: number;
  codigo: string;
  categorias: string | null;
  descricaopequena: string | null;
  descricao: string | null;
  valor: string | null; // default global
  tipovalor: string | null;
  valorespossiveis: string | null;
  config_especificas_permitidas: string | null;
  obsoleto: string | null;
  opcoes: ConfigOpcao[] | null; // enum de VALORESPOSSIVEIS (null = texto livre)
  escoposPermitidos: string[]; // Empresa/Usuario/Modulo
  valorEfetivo: string | null; // resolvido para a empresa corrente (o que a NF vê)
  overrideEmpresa: string | null; // override de Empresa da empresa corrente (null = usa default)
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: apiHeaders(init?.headers as Record<string, string>) });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body)
      ? body
      : { statusCode: res.status, code: 'ERRO', message: body?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return (res.status === 204 ? (undefined as T) : ((await res.json()) as T));
}

export function listarConfiguracoes(): Promise<ConfigItem[]> {
  return req<ConfigItem[]>(`${BASE}/cadastro/configuracoes`);
}

/** grava o override de Empresa (chave = empresa corrente). */
export function setOverrideEmpresa(codigo: string, empresa: number, valor: string): Promise<unknown> {
  return req(`${BASE}/cadastro/configuracoes/${encodeURIComponent(codigo)}/override`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tipo: 'Empresa', chave: empresa, valor }),
  });
}

/** remove o override de Empresa (volta ao default). */
export function removerOverrideEmpresa(codigo: string, empresa: number): Promise<void> {
  return req<void>(`${BASE}/cadastro/configuracoes/${encodeURIComponent(codigo)}/override?tipo=Empresa&chave=${empresa}`, {
    method: 'DELETE',
  });
}
