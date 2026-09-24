import { z } from 'zod';

/**
 * FECHAMENTO DE CAIXA — corte 1, a CONFERÊNCIA do turno do PDV e o RASCUNHO (`uFechamentoCaixa.pas` +
 * `UfinalizaFechamento.pas`; dossiê uFechamentoCaixa-finalizacao.md). O turno é (data do caixa, CHAVE, PDV, operador):
 * a CHAVE (PDV + ddmmyy + hhmiss) pode faltar — 96 linhas de 2026 no legado —, e aí o filtro é "CHAVE IS NULL".
 */
const chave = z.preprocess((v) => (v === '' || v == null ? null : String(v).trim()), z.string().max(14).nullable());

export const turnoFechamentoSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Informe a data do caixa.' }),
  chave: chave.optional(),
  nropdv: z.coerce.number().int(),
  codoperadora: z.coerce.number().int(),
  /** 1 aberto · 2 fechado no caixa · 3 fechado na tesouraria (o combo de status do legado). Sem ele, o do turno. */
  situacao: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().min(1).max(3).optional()),
});
export type TurnoFechamentoDto = z.infer<typeof turnoFechamentoSchema>;

/**
 * O rascunho (`ProcessaFinalizaFechamento`): os documentos CONFERIDOS por operação e o dinheiro contado. Operação
 * que não vem na lista fica como estava (o legado só refaz a seleção da modalidade que o usuário abriu). O REAL de
 * cada linha é calculado no servidor pela soma dos documentos, como a tela do legado faz ao fechar o diálogo.
 */
export const rascunhoFechamentoSchema = turnoFechamentoSchema.extend({
  dinheiroContado: z.preprocess((v) => (v === '' || v == null ? 0 : v), z.coerce.number()),
  documentos: z.array(z.object({
    operacao: z.string().min(1).max(30),
    codigos: z.array(z.coerce.number().int()).max(5000),
  })).max(100).default([]),
});
export type RascunhoFechamentoDto = z.infer<typeof rascunhoFechamentoSchema>;

/**
 * EFETIVAR o fechamento (`btnFechaClick`, UfinalizaFechamento.pas:234-895): grava o rascunho com a mesma seleção e fecha
 * o turno numa transação. `gerarSaldo` é a caixa "saldo do operador" (`CkSaldoOperador`) — marcada sozinha quando a
 * diferença passa do limite da empresa. `confirmarDocumentosNaoSelecionados` responde à pergunta do legado
 * ("possui documentos que não foram selecionados. Deseja continuar?").
 */
export const efetivarFechamentoSchema = rascunhoFechamentoSchema.extend({
  gerarSaldo: z.preprocess((v) => v === true || v === 'S' || v === 'true', z.boolean()).optional(),
  confirmarDocumentosNaoSelecionados: z.preprocess((v) => v === true || v === 'S' || v === 'true', z.boolean()).optional(),
});
export type EfetivarFechamentoDto = z.infer<typeof efetivarFechamentoSchema>;
