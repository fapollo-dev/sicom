import { z } from 'zod';

/**
 * ADIANTAMENTO A FORNECEDOR/PARCEIRO (FRMADIANTAMENTOFORNECEDOR) — corte-1.
 * O TIPO não é digitado: vem da SITUAÇÃO do documento (`SITUACAO_NF.TIPO_OPERACAO` F19→'C', F20→'D', F21→'E'),
 * com o radio desabilitado (uCadAdiantamentoFornecedor.pas:99-147). Quando a config
 * `INFORMA_SITUACAO_DOC_ADIANTAMENTO_PARCEIROS` está desligada, o operador escolhe o tipo no radio.
 */

/** o valor: o legado só barra ZERO (`if edtValorAdiantamento.Value = 0`); exigimos positivo — no golden o
 *  mínimo é R$ 5,00, nenhum título gerado é negativo, e um negativo inverteria o sinal do movimento. */
const valorAdiantamento = z.coerce
  .number()
  .finite({ message: 'Valor inválido.' })
  .positive({ message: 'Favor entrar com o valor do adiantamento!' })
  .max(999999999.99, { message: 'Valor acima do limite do campo (999.999.999,99).' }); // numeric(13,2)

/** data em ISO 'AAAA-MM-DD' — sem o regex, 'today'/'infinity' passariam para a timestamptz (linha fora de qualquer
 *  período contábil) e uma string inválida viraria erro do Postgres (500) em vez de 400. */
const dataIso = (campo: string) => z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, `${campo} inválida (use AAAA-MM-DD).`);

export const adiantamentoCriarSchema = z
  .object({
    idsituacao_nf: z.coerce.number().int().positive().optional(), // obrigatória quando a config está ligada
    tipo: z.enum(['C', 'D', 'E']).optional(), // só usado quando a config está DESLIGADA (radio habilitado)
    codparceiro: z.coerce.number().int().positive({ message: 'Favor entrar com código do Parceiro!' }),
    codcontacorrente: z.coerce.number().int().positive({ message: 'Favor entrar com o número da conta corrente!' }),
    dtadiantamento: dataIso('Data do adiantamento'),
    dtvencimento: dataIso('Data de vencimento'),
    valor: valorAdiantamento,
    obs: z.string().trim().max(255).optional(),
  })
  .refine((v) => v.dtvencimento >= v.dtadiantamento, {
    message: 'Favor entrar com a data de vencimento igual ou maior que a data de Adiantamento!',
    path: ['dtvencimento'],
  });
export type AdiantamentoCriarDto = z.infer<typeof adiantamentoCriarSchema>;

/** editar: parceiro/datas/valor/obs (o TIPO e a conta não mudam — o legado não permite trocá-los no update). */
export const adiantamentoEditarSchema = z
  .object({
    codadiantamento: z.coerce.number().int().positive(),
    codparceiro: z.coerce.number().int().positive({ message: 'Favor entrar com código do Parceiro!' }),
    dtadiantamento: dataIso('Data do adiantamento'),
    dtvencimento: dataIso('Data de vencimento'),
    valor: valorAdiantamento,
    obs: z.string().trim().max(255).optional(),
  })
  .refine((v) => v.dtvencimento >= v.dtadiantamento, {
    message: 'Favor entrar com a data de vencimento igual ou maior que a data de Adiantamento!',
    path: ['dtvencimento'],
  });
export type AdiantamentoEditarDto = z.infer<typeof adiantamentoEditarSchema>;

export const adiantamentoExcluirSchema = z.object({ codadiantamento: z.coerce.number().int().positive() });
export type AdiantamentoExcluirDto = z.infer<typeof adiantamentoExcluirSchema>;

export const adiantamentoListarSchema = z.object({
  codparceiro: z.coerce.number().int().positive().optional(),
  tipo: z.enum(['C', 'D', 'E']).optional(),
  quitada: z.enum(['S', 'N']).optional(),
  dtini: dataIso('Data inicial').optional(),
  dtfim: dataIso('Data final').optional(),
  limite: z.coerce.number().int().positive().max(2000).optional(),
});
export type AdiantamentoListarDto = z.infer<typeof adiantamentoListarSchema>;
