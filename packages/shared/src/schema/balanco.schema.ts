import { z } from 'zod';

/**
 * BALANÇO do inventário (`BALANCO`/`BALANCOITENS`) — corte-1: a foto de estoque e os dois comandos do popup de
 * `FRMINVENTARIO` que a produzem/consomem. Dossiê: `uInventario-balanco.md`.
 *
 * "Gerar Balanco à partir do Inventário" (uInventario.pas:1218): a data é a do livro do inventário e a chave
 * consultada é (DATA, CODEMPRESA). Se já existe foto nessa data, o legado pergunta *"Existe um balanço lançado
 * para essa data, deseja substituir?"* (default NO) e então **só atualiza a QTDE dos produtos que já estão na
 * foto** — produto novo não é inserido. Aqui isso é explícito: sem `substituir: true` a chamada é recusada.
 */
export const gerarBalancoSchema = z.object({
  /** o "sim" da pergunta do legado. Sem ele, existindo foto na data, a operação é recusada. */
  substituir: z.boolean().optional(),
  /** descrição opcional; o default é o do legado: `GERACAO DE INVENTARIO DATA: dd/mm/aaaa`. */
  descricao: z.string().trim().max(100).optional(),
});
export type GerarBalancoDto = z.infer<typeof gerarBalancoSchema>;

/**
 * "Importar Balanço" (uInventario.pas:1343): usa o balanço como **lista de produtos** e traz a quantidade do
 * ESTOQUE ATUAL (`estoque.qtde + estoque_dep.qtde`) — não a quantidade da foto. Apaga a folha atual do livro
 * (o legado confirma *"O inventário atual será excluído"*), daí o `confirmar`.
 */
export const importarBalancoSchema = z.object({
  codbalanco: z.coerce.number().int().positive(),
  /** o "sim" de *"O inventário atual será excluído. Deseja continuar?"* — exigido quando a folha tem linhas. */
  confirmar: z.boolean().optional(),
});
export type ImportarBalancoDto = z.infer<typeof importarBalancoSchema>;

export interface BalancoResumo {
  codbalanco: number;
  descricao: string | null;
  data: string;
  idempresa: number;
  itens: number;
}

/**
 * "Importar Balanço e Atualizar Estoque" (`ImportaBalancoSincronizar`, uInventario.pas:1485-1529): reconstrói a
 * folha a partir da foto somando o movimento do intervalo. O SENTIDO sai da comparação das datas (a do livro × a
 * da foto) e o legado espelha o intervalo: para frente `[dataFoto+1, dataLivro]` com `+entradas −saídas`; para
 * trás `[dataLivro, dataFoto−1]` com `−entradas +saídas`. **Datas iguais: o legado não abre nenhum dos dois
 * ramos** (a folha já foi apagada) — copiamos, devolvendo `sentido: 'nenhum'` e a folha vazia.
 */
export const importarBalancoSincronizarSchema = z.object({
  codbalanco: z.coerce.number().int().positive(),
  /** o "sim" de "O inventário atual será excluído" — exigido quando a folha tem linhas. */
  confirmar: z.boolean().optional(),
});
export type ImportarBalancoSincronizarDto = z.infer<typeof importarBalancoSincronizarSchema>;

/**
 * "Sincronizar Inventário (Entradas - Saídas)" (`SincronizarInventrio1Click`, uInventario.pas:2631-2705):
 * recalcula a QTDE das linhas que JÁ estão na folha (não cria linha nova) com o movimento do período; movimento
 * negativo vira **0** e produto sem movimento vira **0**. A data inicial é sugerida pela tela como o `MAX(DATA)`
 * dos balanços ativos e o operador pode trocá-la (`edtDtInicial`, uInventario.pas:1156-1158 e 2646-2651).
 */
export const sincronizarInventarioSchema = z.object({
  /** default = MAX(data) dos balanços ativos (o que a tela preenche ao abrir). Formato AAAA-MM-DD. */
  dtinicial: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (use AAAA-MM-DD).').optional(),
});
export type SincronizarInventarioDto = z.infer<typeof sincronizarInventarioSchema>;
