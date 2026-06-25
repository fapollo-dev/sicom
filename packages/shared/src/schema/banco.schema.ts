import { z } from 'zod';

/**
 * Schema do Cadastro de Bancos — fonte ÚNICA de validação (back ↔ front).
 *
 * Derivado do dossiê do legado `uCadBancos` (tela `frmCadBancos`, tabela `BANCOS`)
 * — ver /Library/Apollo/04-screen-dossier/dossiers/retaguarda/uCadBancos.md.
 *
 * Regras capturadas do legado:
 *  - BR-02: BANCO e CIDADE são obrigatórios (validação app-side, ANTES do banco;
 *    o legado faz ValidaObrigatorios→Abort antes do ApplyUpdates). NOT NULL é só backstop.
 *  - BR-04: AGENCIA, BANCO, CIDADE, AGENCIA_CEDENTE, CODBCOBLT entram em MAIÚSCULAS
 *    (CharCase=ecUpperCase no .dfm).
 *  - PK CODBCO é gerada por sequence (app-side no legado) → omitida na criação.
 */

/** Texto que o legado força para maiúsculas. */
const upper = (max: number) =>
  z.string().trim().transform((s) => s.toUpperCase()).pipe(z.string().max(max));

export const bancoSchema = z.object({
  // BR-02: obrigatórios
  banco: z.string().trim().min(1, 'Banco é obrigatório').pipe(upper(50)),
  cidade: z.string().trim().min(1, 'Cidade é obrigatória').pipe(upper(50)),
  // opcionais
  agencia: upper(10).optional(),
  uf: z.string().trim().length(2).toUpperCase().optional(),
  agenciaCedente: z.number().int().optional(),
  codbcoblt: z.number().int().optional(),
  convenio: z.number().int().optional(),
  carteiraCobranca: z.number().int().optional(),
  variacaoCarteira: z.number().int().optional(),
});

/** Entrada de criação (sem CODBCO — gerado por sequence). */
export type CriarBancoDto = z.infer<typeof bancoSchema>;

/** Entrada de edição: mesmos campos, todos opcionais (atualização parcial / delta). */
export const atualizarBancoSchema = bancoSchema.partial();
export type AtualizarBancoDto = z.infer<typeof atualizarBancoSchema>;

/** Registro completo como retornado pela API (inclui PK e auditoria). */
export interface Banco extends CriarBancoDto {
  codbco: number;
  usultalteracao?: number | null;
  dtultimalteracao?: string | null;
  dtcadastro?: string | null;
}
