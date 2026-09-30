/**
 * A impressão de um relatório do legado (.fr3 da RELATORIOS + os datasets que o servidor monta) numa janela nova, como o
 * `Imprimir(frxReport)` do legado: a janela abre SÍNCRONA no clique (o bloqueador de popups engole a aberta depois do await) e
 * recebe as páginas desenhadas pelo motor do FastReport (`render.ts`).
 */
import { isErroResposta, type ErroResposta } from '@apollo/shared';
import { apiHeaders, handle401 } from '../auth/session';
import { documentoDeImpressao, type Conjuntos } from './render';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** o que o servidor devolve: o .fr3, os datasets pelo UserName e as variáveis que o legado atribui (`frxReport.Variables[...]`) */
export interface RelatorioFr3 { titulo: string; modelo: string; datasets: Conjuntos; variaveis?: Record<string, string>; textos?: Record<string, string> }

export async function buscarRelatorio(path: string, corpo?: unknown): Promise<RelatorioFr3> {
  const res = await fetch(`${BASE}${path}`, corpo === undefined ? { method: 'GET', headers: apiHeaders() } : { method: 'POST', headers: apiHeaders(), body: JSON.stringify(corpo) });
  handle401(res);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const envelope: ErroResposta = isErroResposta(body) ? body : { statusCode: res.status, code: 'ERRO', message: (body as { message?: string })?.message ?? res.statusText };
    throw Object.assign(new Error(envelope.code ?? res.statusText), { envelope, status: res.status, body });
  }
  return (await res.json()) as RelatorioFr3;
}

/** abre a janela no clique e desenha o relatório quando os dados chegam; erro fecha a janela e sobe para a tela mostrar */
export async function imprimirRelatorio(path: string, corpo?: unknown): Promise<void> {
  const win = window.open('', '_blank', 'width=1000,height=760');
  try {
    const r = await buscarRelatorio(path, corpo);
    const doc = documentoDeImpressao([{ modelo: 'relatorio', registros: r.datasets, variaveis: r.variaveis, textos: r.textos }], { relatorio: r.modelo }, new Date(), r.titulo);
    if (doc.avisos.length) throw new Error(doc.avisos.join('\n'));
    if (!win) throw new Error('O navegador bloqueou a janela de impressão.');
    win.document.open();
    win.document.write(doc.html);
    win.document.close();
  } catch (e) {
    win?.close();
    throw e;
  }
}
