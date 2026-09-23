import { z } from 'zod';

/**
 * AGENDA DE LIMITAÇÃO DE VENDA (`FRMCADAGENDALIMITACAOVENDA`, `uCadAgendaLimitacaoVenda.pas`).
 *
 * Limita quanto de um produto cada cliente pode levar num período. No cliente é sazonal e casado com o
 * "DIA D" — o dia de promoção forte, em que a loja não quer que um atravessador leve a gôndola inteira.
 */
export const agendaLimitacaoItemSchema = z.object({
  idproduto: z.coerce.number().int().positive(),
  quantidade: z.coerce.number().positive().max(999999),
  /** `S` limita o GRUPO DE PREÇO inteiro, não só este produto — 2 dos 92 itens do cliente. */
  atualizacao_grupo: z.enum(['S', 'N']).default('N'),
  ativo: z.enum(['S', 'N']).default('S'),
});

/**
 * o período tem HORA (mig 318): no legado DTINICIO/DTFIM são TIMESTAMP e a tela preenche o início com a data (00:00) e o fim
 * com a data às 23:59 (`SetaDataPadrao`, uCadAgendaLimitacaoVenda.pas:238); na produção há agendas de 05:00 até 01:00 do dia
 * seguinte. Aceita a data sozinha (aplica esses padrões) ou data e hora ('AAAA-MM-DDTHH:mm'); devolve 'AAAA-MM-DDTHH:mm'.
 */
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DATA_HORA = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/;
const periodo = (padraoHora: string) =>
  z.string().trim().refine((v) => DATA.test(v) || DATA_HORA.test(v), 'data inválida (AAAA-MM-DD ou AAAA-MM-DDTHH:mm)')
    .transform((v) => (DATA.test(v) ? `${v}T${padraoHora}` : v.replace(' ', 'T').slice(0, 16)));

export const agendaLimitacaoSchema = z.object({
  descricao: z.string().trim().min(1).max(150),
  dtinicio: periodo('00:00'),
  dtfim: periodo('23:59'),
  tipo: z.enum(['Q']).default('Q'),
  estatus: z.enum(['A', 'F']).default('A'),
  /** as lojas participantes, no formato `;1;2;` do legado. Obrigatória: sem ela não se adiciona item. */
  empresas: z.string().trim().min(1).max(200),
  itens: z.array(agendaLimitacaoItemSchema).default([]),
})
  // `(vdDtFim = 0) or (vdDtFim <= vdDtinicio)` barra (uCadAgendaLimitacaoVenda.pas:184): o término tem de ser DEPOIS do início
  .refine((a) => a.dtfim > a.dtinicio, { message: 'o término tem de ser depois do início', path: ['dtfim'] })
  // o pesquisador do legado já exclui o que está na agenda; aqui a regra é explícita
  .refine((a) => new Set(a.itens.map((i) => i.idproduto)).size === a.itens.length, {
    message: 'o mesmo produto não entra duas vezes na agenda', path: ['itens'],
  });

/** a quantidade padrão que o legado aplica a TODOS os produtos escolhidos de uma vez (`edtQtdPadrao`). */
export const adicionarProdutosSchema = z.object({
  idprodutos: z.array(z.coerce.number().int().positive()).min(1).max(2000),
  quantidade: z.coerce.number().positive().max(999999),
});

export type AgendaLimitacaoDto = z.infer<typeof agendaLimitacaoSchema>;
export type AdicionarProdutosDto = z.infer<typeof adicionarProdutosSchema>;
