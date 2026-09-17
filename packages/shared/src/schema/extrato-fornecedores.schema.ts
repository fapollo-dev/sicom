import { z } from 'zod';

/**
 * EXTRATO DE FORNECEDORES (`FRMEXTRATOFORNECEDORES`, `UextratoFornecedores.pas`).
 *
 * O que se deve a cada fornecedor — por período, ou o **saldo numa data passada**, que é o modelo que
 * responde "quanto eu devia no fechamento do mês".
 */

/** por qual data o recorte é feito (`rgDatas`). */
export const DATAS_EXTRATO_FOR = [
  { value: 'CONTABIL', label: 'Data contábil da nota' },
  { value: 'VENCIMENTO', label: 'Vencimento' },
  { value: 'PAGAMENTO', label: 'Pagamento' },
] as const;

/**
 * os modelos do `rgModelo`. O de **cheques próprios** fica de fora: `CHQ_PROPRIO` tem **0 linhas** no cliente.
 */
export const MODELOS_EXTRATO_FOR = [
  { value: 'PERIODO', label: 'Extrato por período' },
  { value: 'ATE', label: 'Vigência a menor (até a data)' },
  { value: 'DESDE', label: 'Vigência a maior (da data em diante)' },
  { value: 'SALDO', label: 'Saldo do contas a pagar na data' },
  { value: 'SALDO2', label: 'Saldo do contas a pagar 2 (tudo comprado até a data)' },
] as const;

export const SITUACOES_EXTRATO_FOR = ['ABERTO', 'BAIXADO', 'TODOS'] as const;

export const extratoFornecedoresSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** só o modelo `PERIODO` usa as duas datas; os demais trabalham com a primeira. */
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  base: z.enum(['CONTABIL', 'VENCIMENTO', 'PAGAMENTO']).default('VENCIMENTO'),
  modelo: z.enum(['PERIODO', 'ATE', 'DESDE', 'SALDO', 'SALDO2']).default('PERIODO'),
  situacao: z.enum(SITUACOES_EXTRATO_FOR).default('TODOS'),
  /**
   * ⚠️ no legado este campo é concatenado **cru** no SQL quando não tem `%`
   * (`Filtro + ' AND PA.RAZAO ' + edtParceiro.Text`, `:126`) — injeção de SQL, e só funciona se o operador
   * digitar o operador junto (`= 'NESTLE'`). Aqui é sempre um nome, e a busca é por trecho.
   */
  parceiro: z.string().trim().max(120).optional(),
  limite: z.coerce.number().int().positive().max(20000).default(3000),
}).refine((f) => f.modelo !== 'PERIODO' || (!!f.dataFim && f.dataFim >= f.dataIni), {
  message: 'o extrato por período precisa das duas datas, e o fim não pode ser antes do início',
  path: ['dataFim'],
});

export type ExtratoFornecedoresDto = z.infer<typeof extratoFornecedoresSchema>;
