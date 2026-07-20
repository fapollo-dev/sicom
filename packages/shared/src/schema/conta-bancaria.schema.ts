import { z } from 'zod';

/**
 * Cadastro de Contas Bancárias (legado `UCadContasBancarias`, tabela CONTAS_BANCARIAS).
 * Versão COMPLETA e fiel ao .dfm/.pas: todas as colunas editáveis da aba "Contas
 * Correntes" (a aba mestre-detalhe "Liberação de operadores" foi DEFERIDA — ver TODO).
 *
 * Padrão exercitado: **FK CODBCO → BANCOS** (lookup) + escopo por empresa (IDEMPRESA
 * carimbado no servidor, NÃO é entrada do usuário) + flags S/N + grupo "Boleto".
 *
 * Os nomes dos campos = nomes de COLUNA (o engine mapeia dto[coluna] direto).
 * Mensagens em PT (ADR-015).
 *
 * Paridade legado:
 *  - edtCODBCOExit: banco é obrigatório ('Favor entrar com código do banco!').
 *  - edtOBSKeyPress: OBS em MAIÚSCULAS (UpCase) → .transform.
 *  - btnGravarClick: CONVENIO, quando informado, deve ter exatamente 6 ou 7 posições
 *    ('Convênio deve ter apenas 6 ou 7 posições. Verifique.').
 *  - JvDBComboBox1 (TIPO_COBRANCA): 1=Simples, 2=Descontada, 3=Vendor, 4=Vinculada.
 *  - OnNewRecord (uRDmCadContaBancaria): IDEMPRESA := empresa atual, ATIVO := 'S'.
 *    CONTA_PROPRIA default 'N' (DEFAULT da tabela).
 *
 * TODO (Fase X): FK Plano de Contas / aba Operadores quando PLANO_CONTAS/OPERADORES migrarem.
 * (No legado: CODLANCCONTABIL é FK → PLANO_CONTAS com lookup GET_PLANO_CONTAS, e a aba
 * "Liberação de operadores" é um mestre-detalhe sobre OPERADORES. Aqui CODLANCCONTABIL é
 * só um campo texto livre, sem lookup, e não há aba de operadores.)
 */

/**
 * Tipo de cobrança do boleto (combo JvDBComboBox1, UCadContasBancarias.dfm).
 * Pares value→label EXATOS do .dfm (Values.Strings → Items.Strings, mesma ordem).
 */
export const TIPO_COBRANCA = [
  { value: '1', label: 'Simples' },
  { value: '2', label: 'Descontada' },
  { value: '3', label: 'Vendor' },
  { value: '4', label: 'Vinculada' },
] as const;

const TIPO_COBRANCA_VALUES = TIPO_COBRANCA.map((t) => t.value) as [string, ...string[]];

/** OBS em MAIÚSCULAS (edtOBSKeyPress: Key := UpCase(Key)). */
const obs = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().max(300))
  .optional();

/**
 * CONVENIO é INTEIRO; quando informado, deve ter 6 ou 7 dígitos (btnGravarClick).
 * Vazio/undefined = ok (campo opcional).
 */
const convenio = z
  .number()
  .int('Convênio inválido')
  .nonnegative('Convênio inválido')
  .optional()
  .refine((v) => v == null || [6, 7].includes(String(v).length), {
    message: 'Convênio deve ter apenas 6 ou 7 posições. Verifique.',
  });

/** Item da aba "Liberação de operadores" (CONTAS_BANCARIAS_OP): quem pode baixar CR/CP por esta conta.
 *  Defaults 'S' (fiel ao OnNewRecord do legado, uRDmCadContaBancaria.pas:98-103). */
export const contaBancariaOperadorSchema = z.object({
  codoperador: z.coerce.number({ message: 'Operador inválido' }).int().positive('Operador inválido'),
  cbo_baixa_cr: z.enum(['S', 'N'], { message: "Informe 'S' ou 'N'" }).default('S'),
  cbo_baixa_cp: z.enum(['S', 'N'], { message: "Informe 'S' ou 'N'" }).default('S'),
});
export type ContaBancariaOperadorDto = z.infer<typeof contaBancariaOperadorSchema>;

export const contaBancariaSchema = z.object({
  // FK → BANCOS (obrigatório — edtCODBCOExit). IDEMPRESA NÃO é entrada do usuário.
  codbco: z.number({ message: 'Banco é obrigatório' }).int('Banco inválido'),
  titular: z.string().trim().max(50).optional(),
  nroconta: z.string().trim().max(10).optional(),
  gerente: z.string().trim().max(50).optional(),
  dtabertura: z.string().optional(), // ISO date 'YYYY-MM-DD'
  fone1: z.string().trim().max(15).optional(),
  obs,
  // FK → PLANO_CONTAS (lookup GET_PLANO_CONTAS, filtro CLASSE='ANALITICA' AND TIPO='EMPRESA'). Validado no servidor.
  codlanccontabil: z.string().trim().max(30).optional(),
  // Grupo "Boleto" — INTEIROS (não moeda).
  convenio,
  carteira_cobranca: z.number().int('Carteira inválida').optional(),
  variacao_carteira: z.number().int('Variação inválida').optional(),
  tipo_cobranca: z.enum(TIPO_COBRANCA_VALUES, { message: 'Tipo de cobrança inválido' }).optional(),
  codigo_transmissao_cobranca: z.string().trim().max(30).optional(),
  // Grupo "Arquivo remessa".
  nroconvenio_arqrem: z.string().trim().max(12).optional(),
  // Flags S/N.
  conta_propria: z.enum(['S', 'N'], { message: "Informe 'S' ou 'N'" }).default('N'),
  exibe_rel_apuracao_caixa: z.enum(['S', 'N'], { message: "Informe 'S' ou 'N'" }).optional(),
  ativo: z.enum(['S', 'N'], { message: "Informe 'S' ou 'N'" }).default('S'),
  // aba "Liberação de operadores" (mestre-detalhe CONTAS_BANCARIAS_OP) — substituída no PUT quando vier.
  operadores: z.array(contaBancariaOperadorSchema).max(500).optional(),
});

export type CriarContaBancariaDto = z.infer<typeof contaBancariaSchema>;

export const atualizarContaBancariaSchema = contaBancariaSchema.partial();
export type AtualizarContaBancariaDto = z.infer<typeof atualizarContaBancariaSchema>;

export interface ContaBancaria extends CriarContaBancariaDto {
  codconta: number;
  idempresa?: number; // escopo multi-tenant (carimbado no servidor)
  banco?: string; // nome do banco (via join/lookup), para exibição
}
