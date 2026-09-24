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

/**
 * EDITAR UM DOCUMENTO no diálogo de documentos (`UConsDocs.AlteraDocs`, corte 4): o cartão (valor, operadora, NSU,
 * autorização, rede, parcela, obs — no turno fechado no PDV, só a operadora) e o A Receber (valor, vencimento, cliente, obs).
 * 15.678 edições de cartão em 2026, quase todas a reclassificação da operadora "CARTAO A CLASSIFICAR".
 */
const num2 = z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().optional());
const camposDocumento = z.object({
  valor: num2,
  codoperadora: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().optional()),
  nsu: z.string().max(10).optional(),
  nsuhost: z.string().max(30).optional(),
  autorizacao: z.string().max(30).optional(),
  codrede: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().optional()),
  nroparcela: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().optional()),
  obs: z.string().max(1000).optional(),
  dtvenc: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  codparceiro: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().optional()),
  /** só na inserção do cartão (a tela completa aceita o cupom e o pedido) */
  nrocupom: z.string().max(20).optional(),
  nropedido: z.string().max(20).optional(),
  /** só na sangria/suprimento: a forma da sangria em dinheiro e a descrição */
  idpgto: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().optional()),
  descricao: z.string().max(100).optional(),
});
export const editarDocumentoFechamentoSchema = turnoFechamentoSchema.extend({
  operacao: z.string().min(1).max(30),
  codigo: z.coerce.number().int().positive(),
  campos: camposDocumento,
});
export type EditarDocumentoFechamentoDto = z.infer<typeof editarDocumentoFechamentoSchema>;

/** INSERIR um documento no diálogo (Insert do UConsDocs, corte 4): o A Receber ORIGEM 'F', o cartão da tela completa, a sangria e o suprimento */
export const inserirDocumentoFechamentoSchema = turnoFechamentoSchema.extend({
  operacao: z.string().min(1).max(30),
  campos: camposDocumento,
  /** a sangria/suprimento pede sempre o login de quem libera (o responsável) */
  login: z.string().max(60).optional(),
  senha: z.string().max(100).optional(),
});
export type InserirDocumentoFechamentoDto = z.infer<typeof inserirDocumentoFechamentoSchema>;

/** EXCLUIR um documento (Del do UConsDocs): com liberadores configurados, o login e a senha de um deles */
export const excluirDocumentoFechamentoSchema = turnoFechamentoSchema.extend({
  operacao: z.string().min(1).max(30),
  codigo: z.coerce.number().int().positive(),
  login: z.string().max(60).optional(),
  senha: z.string().max(100).optional(),
});
export type ExcluirDocumentoFechamentoDto = z.infer<typeof excluirDocumentoFechamentoSchema>;

/**
 * LANÇAMENTO PROVISÓRIO do turno (`UlancProv`, BTNLANCPROV; corte 4): o cabeçalho em DADOSCX (fiscal de caixa, GT inicial e
 * final, cancelamentos e descontos — a venda bruta e a líquida são calculadas) e as linhas de modalidade em CX_VENDAS.
 */
const valorOpc = z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().optional());
export const lancProvCabecalhoSchema = turnoFechamentoSchema.extend({
  codfiscalcaixa: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().optional()),
  gtinicial: valorOpc,
  gtfinal: valorOpc,
  cancelamentos: valorOpc,
  descontos: valorOpc,
});
export type LancProvCabecalhoDto = z.infer<typeof lancProvCabecalhoSchema>;
export const lancProvLinhaSchema = turnoFechamentoSchema.extend({
  operacao: z.string().min(1).max(30),
  valor: z.coerce.number(),
  codfiscalcaixa: z.coerce.number().int().positive(),
});
export type LancProvLinhaDto = z.infer<typeof lancProvLinhaSchema>;
export const lancProvExcluirSchema = turnoFechamentoSchema.extend({ codcxvendas: z.coerce.number().int().positive() });
export type LancProvExcluirDto = z.infer<typeof lancProvExcluirSchema>;

/**
 * O RELATÓRIO "FECHAMENTO DE CAIXA" (`MontaRel` + FechamentoCaixa.fr3; corte 4): um turno (a tela, Imprimir › "Fechamento de
 * caixa", RBAC FECHAMENTOCAIXA1) ou vários (os marcados em "Caixas em aberto"), do mesmo dia.
 */
export const relatorioFechamentoSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  turnos: z.array(z.object({
    nropdv: z.coerce.number().int().positive(),
    codoperadora: z.coerce.number().int().positive(),
    chave: z.preprocess((v) => (v === '' ? null : v), z.string().max(20).nullable().optional()),
  })).min(1).max(200),
});
export type RelatorioFechamentoDto = z.infer<typeof relatorioFechamentoSchema>;
