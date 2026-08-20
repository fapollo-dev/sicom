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
