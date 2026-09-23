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

/**
 * OS ITENS DO HISTÓRICO (`ITENS_HISTORICO_CONTABIL`, a grade de detalhe de `uCadHistoricoContabil.dfm:359`):
 * **qual campo preenche cada `*`, na ORDEM**. Migration 294.
 *
 * ⚠️ É a regra, não documentação — o razão prova. No histórico 62 o template tem três `*` e os itens são
 * `NRO_NF`, `CFOP`, `CNPJ_CPF`, `PARCEIRO`; o razão grava `…COMPRA .: 007922433 CNPJ.: 1403 PARCEIRO.:23.814.940/…`
 * — o CFOP cai no rótulo "CNPJ" e o CNPJ no rótulo "PARCEIRO", exatamente na ordem dos itens, e não na dos
 * rótulos. Montando o texto pelos itens, as notas batem em **32.731 de 32.894** linhas do razão (99,5%); o
 * resto é parceiro renomeado depois do lançamento (o razão guarda o nome da época).
 *
 * Item a mais que `*` é ignorado (o 63 tem cinco itens e um `*`): o template manda, como em `montarDeschist`.
 */
export interface ItemHistoricoContabil {
  ordem: number | null;
  tabela: string | null;
  campo: string | null;
  status?: string | null;
}

/**
 * os argumentos do template, tirados dos itens na ORDEM, perguntando a `valor` o que cada campo vale.
 *
 * ⚠️ item com `STATUS='N'` sai da lista (e o seguinte sobe um `*`). Os 144 itens da produção estão todos em
 * `S`, então o dado não decide o caso do `N`; seguimos a leitura natural de um campo "ativo" — decisão nossa,
 * sem prova, registrada aqui para ser revista se um `N` aparecer.
 */
export function argsPelosItens(
  itens: readonly ItemHistoricoContabil[],
  valor: (tabela: string, campo: string) => ArgHist,
): ArgHist[] {
  return itens
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => (it.status ?? 'S') !== 'N')
    .sort((a, b) => (a.it.ordem ?? Number.MAX_SAFE_INTEGER) - (b.it.ordem ?? Number.MAX_SAFE_INTEGER) || a.i - b.i)
    .map(({ it }) => valor(String(it.tabela ?? '').trim().toUpperCase(), String(it.campo ?? '').trim().toUpperCase()));
}

export const itemHistoricoContabilSchema = z.object({
  ordem: z.coerce.number().int().min(1).max(99),
  // o legado grava o NOME do dataset, não o da tabela física: 'MOVIMENTO DE CAIXA', 'ADIANTAMENTO PARA PARCEIROS'
  tabela: z.string().trim().min(1, 'informe a tabela').max(200),
  campo: z.string().trim().min(1, 'informe o campo').max(200),
  tipo_dados: z.string().trim().max(20).nullish(),
  status: z.enum(['S', 'N']).default('S'),
});

export const itensHistoricoContabilSchema = z
  .object({ itens: z.array(itemHistoricoContabilSchema).max(30) })
  // duas linhas na mesma ordem deixariam o `*` ambíguo — qual das duas preenche?
  .refine((v) => new Set(v.itens.map((i) => i.ordem)).size === v.itens.length, {
    message: 'duas linhas com a mesma ordem',
    path: ['itens'],
  });

export type ItemHistoricoContabilDto = z.infer<typeof itemHistoricoContabilSchema>;
export type ItensHistoricoContabilDto = z.infer<typeof itensHistoricoContabilSchema>;
