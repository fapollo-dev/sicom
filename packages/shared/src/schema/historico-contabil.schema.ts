import { z } from 'zod';

/**
 * CADASTRO DE HISTÓRICO CONTÁBIL (`FRMCADHISTORICOCONTABIL`, `uCadHistoricoContabil.pas`).
 *
 * O texto que o razão imprime em cada lançamento. Não é um rótulo fixo: cada `*` é um buraco que a
 * contabilização preenche, na ordem — `TAXA DE CARTAO BAIXADOS LOTE .: * OPERADORA .: *` vira
 * `TAXA DE CARTAO BAIXADOS LOTE .: 90886 OPERADORA .: ALELO ALIMENTACA - CODREDE 5`.
 *
 * ⚠️ quem substitui mora em `FuncoesApollo`, que não veio no fonte clonado; a regra abaixo foi reconstruída
 * do razão real do cliente (ver a migration 229 e `uTron-integracao-contabil.md` §8).
 */

/** um `*` do template: número (vira `000130582`), texto (vai cru) ou nada (vira vazio). */
export type ArgHist = string | number | null | undefined;

/**
 * preenche os `*` do template, na ordem.
 *
 * ⚠️ **número vira 9 dígitos com zeros à esquerda** (`FormatFloat('000000000')` do Delphi). Medido:
 * `A RECEBER DOCTO .: 000130582` para documento `130582` em 5.895 de 5.895 linhas da origem 14, e
 * `AGRUPAMENTO CONVENIO .: 000117847` em 15.089 de 15.089 da origem 65. Texto vai cru — é por isso que o
 * lote sai `RECEBTO LOTE .: 90790` e não `000090790`.
 *
 * ⚠️ **quebra de linha vira espaço**: o `DESCHIST` é de uma linha só.
 *
 * `*` sem argumento imprime vazio, como no legado — e argumento a mais é ignorado, porque o template manda.
 *
 * Vive no pacote compartilhado porque a API a usa para escrever o razão e a tela de cadastro a usa para
 * mostrar ao operador como o texto vai sair.
 */
export function montarDeschist(template: string | null | undefined, args: ArgHist[] = []): string | null {
  if (template == null) return null;
  let i = 0;
  return template.replace(/\*/g, () => {
    const a = args[i];
    i += 1;
    if (a == null || a === '') return '';
    if (typeof a === 'number') return Number.isFinite(a) ? String(Math.trunc(Math.abs(a))).padStart(9, '0') : '';
    return a.replace(/\r\n?|\n/g, ' ');
  });
}

/** quantos buracos o template tem — é quantos argumentos a contabilização precisa passar. */
export const contarCoringas = (t: string | null | undefined) => (t ?? '').split('*').length - 1;

export const historicoContabilSchema = z.object({
  // ⚠️ o legado deixa o texto livre, inclusive sem nenhum `*` (um rótulo fixo é um template de zero buracos)
  deschist: z.string().trim().min(1, 'informe o histórico').max(500),
  status: z.enum(['S', 'N']).default('S'),
});

export const atualizarHistoricoContabilSchema = historicoContabilSchema.partial();

export type HistoricoContabilDto = z.infer<typeof historicoContabilSchema>;
