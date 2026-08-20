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

/**
 * "Relatório Diferença do Balanço para Estoque" (`RelatorioDiferencaBalancoClick`, uInventario.pas:1981-2057).
 * READ-ONLY por desenho: o legado altera QTDE/QTDE_IST/DIFERENCA **no dataset em memória**, imprime e depois
 * restaura `QTDE := QTDE_IST` — e `QTDE_IST` nem existe na tabela (é campo calculado). Só as linhas com
 * `ALTERADO='T'` (as que o operador acabou de digitar na grade, antes de gravar) recebem a diferença pela cascata
 * de sinais; as demais saem com diferença 0 e quantidade 0 na impressão.
 *
 * No golden `ALTERADO` é 'N' em 79.119 de 79.190 linhas (nunca 'T'), porque o save grava por cima do 'T' que o
 * Enter pôs em memória. Para não perder o relatório, `alteradas` transporta o estado da grade: os produtos que o
 * operador tocou (e, opcionalmente, a quantidade digitada). Sem `alteradas`, o resultado é o do golden.
 */
export const relatorioDiferencaBalancoSchema = z.object({
  alteradas: z
    .array(z.object({ idproduto: z.coerce.number().int().positive(), qtde: z.coerce.number().finite().optional() }))
    .max(20000)
    .optional(),
});
export type RelatorioDiferencaBalancoDto = z.infer<typeof relatorioDiferencaBalancoSchema>;

/** "Zerar Qtde na Grade" (uInventario.pas:298-311): zera a QTDE das linhas VISÍVEIS — a grade pode estar filtrada
 * em `QTDE < 0` pelo check "filtra negativos" (uInventario.pas:334-346), e é isso que `somenteNegativos` copia. */
export const zerarQtdeInventarioSchema = z.object({ somenteNegativos: z.boolean().optional() });
export type ZerarQtdeInventarioDto = z.infer<typeof zerarQtdeInventarioSchema>;

/** "Atualizar Custo do Inventário à partir do Cadastro dos Produtos" (uInventario.pas:410-470): só as linhas
 * SELECIONADAS na grade (`cdsInventarioSELECIONAR`, campo de memória) — daí a lista explícita de produtos. */
export const atualizarCustoInventarioSchema = z.object({
  idprodutos: z.array(z.coerce.number().int().positive()).min(1).max(20000),
});
export type AtualizarCustoInventarioDto = z.infer<typeof atualizarCustoInventarioSchema>;
