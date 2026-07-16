import { z } from 'zod';

/**
 * PERFIL (UCadPerfilOperador) — perfis de RBAC. Um perfil agrupa grants (PERMISSOES por CODPERFIL) e é
 * atribuído a operadores (RELACAO_OPERADOR_PERFIL). Mensagens PT (ADR-015). GLOBAL (sem empresa, fiel ao golden).
 */
export const perfilSchema = z.object({
  perfil: z.string({ message: 'Informe o nome do perfil.' }).trim().min(1, 'Informe o nome do perfil.').max(100),
  ativo: z.enum(['S', 'N']).optional(),
  tipo: z.string().trim().max(20).optional(),
});
export type CriarPerfilDto = z.infer<typeof perfilSchema>;
export const atualizarPerfilSchema = perfilSchema.partial();
export type AtualizarPerfilDto = z.infer<typeof atualizarPerfilSchema>;

export interface Perfil {
  codperfil?: number;
  perfil: string;
  ativo?: string | null;
  tipo?: string | null;
  qtde_operadores?: number | string | null;
}

/** Atribuir/desatribuir um perfil a um operador (relacao_operador_perfil). */
export const relacaoOperadorPerfilSchema = z.object({
  codoperador: z.coerce.number({ message: 'Operador inválido.' }).int().positive(),
  codperfil: z.coerce.number({ message: 'Perfil inválido.' }).int().positive(),
  atribuido: z.boolean(),
});
export type RelacaoOperadorPerfilDto = z.infer<typeof relacaoOperadorPerfilSchema>;
