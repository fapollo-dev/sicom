import { z } from 'zod';

/**
 * BAIXA DE CONTAS A PAGAR (`FRMBAIXAAPAGAR`, `UBaixaApagar.pas`) — o lote do legado: N documentos e 1..N recursos, cada
 * recurso numa conta corrente. Especificação: `uBaixaApagar-spec.md`.
 */
const opcionalNum = z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive().optional());
const data = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}/, { message: 'Data inválida.' });

/** a pesquisa de títulos (`GET_APAGAR` com as empresas escolhidas) */
export const baixaApagarTitulosSchema = z.object({
  empresas: z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(z.coerce.number().int().positive()).optional()),
  codparceiro: opcionalNum,
  vencDe: z.preprocess((v) => (v === '' ? undefined : v), data.optional()),
  vencAte: z.preprocess((v) => (v === '' ? undefined : v), data.optional()),
  busca: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(60).optional()),
  /** os títulos marcados na Pesquisa (o `cdsDoctos` do legado com CODIGO IN …): o lote recebe exatamente esses */
  codigos: z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(z.coerce.number().int().positive()).max(1000).optional()),
});
export type BaixaApagarTitulosDto = z.infer<typeof baixaApagarTitulosSchema>;

export const baixaApagarGravarSchema = z.object({
  idlote: z.coerce.number().int().positive(),
  dtpgto: data,
  documentos: z.array(z.object({
    codapg: z.coerce.number().int().positive(),
    calculaJuro: z.boolean().optional(),
    /** acréscimo (+) / desconto (−); sem ele, o `-DESCONTO` do título */
    acreDesc: z.coerce.number().optional(),
  })).min(1, { message: 'Nenhum documento foi informado para realizar a baixa.' }),
  recursos: z.array(z.object({
    /** o índice do combo do legado: 0 DINHEIRO · 2 DOC · 3 TRANSFERÊNCIA BANCÁRIA · 4 DÉBITO EM CONTA */
    tipo: z.coerce.number().int(),
    codconta: z.coerce.number().int().positive({ message: 'Informe a conta corrente.' }),
    valor: z.coerce.number().positive({ message: 'Valor deve ser maior que zero!' }),
    historico: z.string().max(250).nullish(),
  })).min(1, { message: 'Nenhum recurso foi informado.' }),
  ccJuros: opcionalNum,
  ccAcrescimo: opcionalNum,
  ccDesconto: opcionalNum,
  /** "Deseja gerar uma baixa parcial?" — com SIM, a data de vencimento do título-saldo */
  parcial: z.object({ dtvenc: data }).optional(),
  /** a manutenção de lote: o lote antigo, revertido na mesma transação */
  loteManutencao: opcionalNum,
});
export type BaixaApagarGravarDto = z.infer<typeof baixaApagarGravarSchema>;

/**
 * BAIXA DE CONTAS A RECEBER (`FRMBAIXAARECEBER`, `UBaixaAreceber.pas`) — o lote: N documentos (acréscimo/desconto em % e em R$
 * por documento, mais o global rateado com a senha DESC) e 1..N recursos em conta corrente. `uBaixaAreceber-spec.md`.
 */
export const baixaReceberTitulosSchema = baixaApagarTitulosSchema.extend({
  /** a data da baixa — o desconto do cliente por prazo depende dela */
  dtpgto: z.preprocess((v) => (v === '' ? undefined : v), data.optional()),
});
export type BaixaReceberTitulosDto = z.infer<typeof baixaReceberTitulosSchema>;

export const baixaReceberGravarSchema = z.object({
  idlote: z.coerce.number().int().positive(),
  dtpgto: data,
  documentos: z.array(z.object({
    codrcb: z.coerce.number().int().positive(),
    calculaJuro: z.boolean().optional(),
    txjuros: z.coerce.number().min(0).optional(),
    /** R$ Acrés/Desc (+ acréscimo / − desconto) */
    acreDescValor: z.coerce.number().optional(),
    /** % Acrés/Desc */
    percentual: z.coerce.number().optional(),
  })).min(1, { message: 'Nenhum documento foi selecionado para realizar a baixa.' }),
  recursos: z.array(z.object({
    /** o índice do combo: 0 DINHEIRO · 2 DOC · 3 TRANSFERÊNCIA · 4 DÉBITO EM CONTA · 6 ANTECIPAÇÃO BANCÁRIA · 7 CARTAO */
    tipo: z.coerce.number().int(),
    codconta: z.coerce.number().int().positive({ message: 'É obrigatório informar a conta corrente.' }),
    valor: z.coerce.number().positive({ message: 'Valor deve ser maior que zero!' }),
    historico: z.string().max(250).nullish(),
    /** no CARTAO, a forma escolhida (PIX POS, IFOOD…) */
    idpgto: opcionalNum,
  })).min(1, { message: 'Não foi informado nenhum recurso, não é possivel continuar!' }),
  /** o acréscimo (+) / desconto (−) global, rateado pelo valor — pede a senha DESC */
  acreDescGlobal: z.coerce.number().optional(),
  senhaDesconto: z.string().max(200).optional(),
  /** o liberador do desconto máximo (USUARIOS_LIBERAM_DESCONTO_MAXIMO_EXCEDIDO) */
  liberacaoDesconto: z.object({ login: z.string().trim().max(50), senha: z.string().max(200) }).optional(),
  ccJuros: opcionalNum,
  ccAcrescimo: opcionalNum,
  ccDesconto: opcionalNum,
  parcial: z.object({ dtvenc: data }).optional(),
  loteManutencao: opcionalNum,
});
export type BaixaReceberGravarDto = z.infer<typeof baixaReceberGravarSchema>;

/** o arquivo de retorno do banco (o conteúdo em texto e o nome, que vai para o histórico do recurso) */
export const baixaReceberRetornoSchema = z.object({
  arquivo: z.string().min(1, 'Informe o conteúdo do arquivo de retorno.').max(4_000_000),
  nome: z.string().trim().max(120).optional(),
});
export type BaixaReceberRetornoDto = z.infer<typeof baixaReceberRetornoSchema>;
