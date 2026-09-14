/**
 * EXPORTAR A GRADE (o "Exportar Grid [F10]" do legado).
 *
 * Exporta **o que está na tela** — as linhas já filtradas e as colunas visíveis, na ordem em que aparecem.
 * É essa a promessa do botão no legado: o operador filtra, confere, e leva embora exatamente aquilo.
 *
 * O CSV sai com **`;`** como separador e **BOM UTF-8**, porque o destino é o Excel em português: com vírgula
 * ele joga tudo numa coluna só, e sem BOM ele estraga todo acento.
 */
export interface ColunaExport<T> {
  /** o cabeçalho, como aparece na grade. */
  titulo: string;
  /** o valor da célula; recebe a linha inteira. Devolva já formatado — é o que o operador vai ler. */
  valor: (linha: T) => unknown;
}

/** escapa um campo para CSV: aspas duplicadas, e o campo entre aspas quando contém separador ou quebra. */
function campo(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportarGradeCsv<T>(linhas: T[], colunas: Array<ColunaExport<T>>, nomeArquivo: string): void {
  const cabecalho = colunas.map((c) => campo(c.titulo)).join(';');
  const corpo = linhas.map((l) => colunas.map((c) => campo(c.valor(l))).join(';'));
  // BOM primeiro: sem ele o Excel lê o arquivo como latin-1 e destrói os acentos
  const texto = `﻿${[cabecalho, ...corpo].join('\r\n')}\r\n`;
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  const data = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${nomeArquivo}-${data}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
