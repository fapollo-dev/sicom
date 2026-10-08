import { createContext, type ReactNode } from 'react';

/**
 * O CADASTRO ABERTO PELA PESQUISA (o Ins / F2 do frmPesquisa — `CreateForm`, uPesquisa.pas:875-931, :1534-1567): o `<CadMaster>` de
 * outra tela renderizado por cima da Pesquisa. Com este contexto ele abre em INCLUSÃO (Ins) ou no REGISTRO da linha (F2), avisa quem o
 * abriu ao gravar e fecha no "Sair" — sem que cada tela de cadastro precise saber disso.
 */
export interface CadMasterEmbutidoCtx {
  inicial: { novo: true } | { id: number };
  onGravou: (registro: Record<string, unknown>) => void;
  onFechar: () => void;
}
export const CadMasterEmbutido = createContext<CadMasterEmbutidoCtx | null>(null);

/**
 * os cadastros que a Pesquisa sabe abrir, por recurso (o par VIEW → FORM da `TABELA_CADASTRO` do legado, que na produção é suja — 51
 * nomes de instância numerada, 26 com TABELA = 'GET_'; aqui um mapa estático). Quem registra é a camada da aplicação (`app/`), para o
 * `shared` não depender das telas. `form` = o formulário cujo acesso o legado exige (`PossuiAcessoForm`).
 */
export interface CadastroDaPesquisa {
  form: string;
  titulo: string;
  /** a PK do registro gravado — o código com que a grade da Pesquisa passa a mostrar só o novo */
  pk: string;
  render: (ctx: { fixos?: Record<string, string | number> }) => ReactNode;
}
const cadastros = new Map<string, CadastroDaPesquisa>();
export function registrarCadastroDaPesquisa(recursos: string[], c: CadastroDaPesquisa): void {
  for (const r of recursos) cadastros.set(r, c);
}
export function cadastroDaPesquisa(recurso: string): CadastroDaPesquisa | null {
  return cadastros.get(recurso) ?? null;
}
