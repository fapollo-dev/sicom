import { z } from 'zod';

/**
 * CONFIGURAÇÃO DA INTEGRAÇÃO BANCÁRIA — BOLETO (`FRMCONFINTEGBANCARIA`, `uConfIntegBancaria.pas`).
 *
 * É o cadastro que o CNAB de cobrança lê para montar a remessa: qual banco, qual conta, qual layout e qual
 * o sequencial do próximo arquivo.
 */
export const LAYOUTS_REMESSA = ['C400', 'C240'] as const;
/** `B` boleto (cobrança) · `P` pagamento (a pagar) — as duas abas do "Tipo Integração" do legado. */
export const TIPOS_INTEG_BANCARIA = ['B', 'P'] as const;

export const confIntegBancariaSchema = z.object({
  codempresa: z.coerce.number().int().positive(),
  codbco: z.coerce.number().int().positive(),
  agencia: z.string().trim().max(10).nullish(),
  nrconta: z.string().trim().max(10).nullish(),
  /** o código FEBRABAN ('341' Itaú, '001' BB) — não é o código interno do banco. */
  codfornbco: z.string().trim().max(20).nullish(),
  /** `S` gera arquivo de homologação bancária; `N` nas 3 do cliente. */
  arqteste: z.enum(['S', 'N']).default('N'),
  layoutremessa: z.enum(LAYOUTS_REMESSA).default('C400'),
  codempresa_arquivo: z.coerce.number().int().positive().nullish(),
  dias_baixa_boleto: z.coerce.number().int().min(0).max(999).nullish(),
  tipo_integ_bancaria: z.enum(TIPOS_INTEG_BANCARIA).default('B'),
  identempresabco: z.string().trim().max(20).nullish(),
  /**
   * ⚠️ o sequencial do PRÓXIMO arquivo de remessa. É **estado**, não configuração: o CNAB o incrementa a
   * cada remessa gerada. O legado deixa editar (o campo está na tela), e nós também — mas a tela avisa.
   */
  sequenciaremessa: z.coerce.number().int().min(0).default(0),
  /** o texto impresso no boleto; aceita `$(Multa)` e `$(Juros)`, que o gerador substitui. */
  obs_boleto: z.string().max(600).nullish(),
  iniciais_arquivo: z.string().trim().max(5).nullish(),
  nosso_numero_inicial: z.coerce.number().int().min(0).nullish(),
  habilitar_bolecode: z.enum(['S', 'N']).default('N'),
});

export type ConfIntegBancariaDto = z.infer<typeof confIntegBancariaSchema>;

/** os placeholders que o texto do boleto aceita — o gerador os troca pelos valores do título. */
export const PLACEHOLDERS_BOLETO = ['$(Multa)', '$(Juros)'] as const;
