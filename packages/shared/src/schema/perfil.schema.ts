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

/** Conceder/revogar um grant FORM×OPCAO a um perfil (UCtrlPermissoes, corte-2). */
export const permissaoGrantSchema = z.object({
  codperfil: z.coerce.number({ message: 'Perfil inválido.' }).int().positive(),
  form: z.string().trim().min(1, 'Informe a tela (form).').max(60),
  opcao: z.string().trim().min(1, 'Informe a opção.').max(60),
  concedido: z.boolean(),
});
export type PermissaoGrantDto = z.infer<typeof permissaoGrantSchema>;

/**
 * PERMISSÃO POR OPERADOR (`FRMCTRLPERMISSOES` no modo `CONTROLE_PERMISSOES='Usuario'`, que é o do cliente:
 * 55.251 linhas por operador contra 2.438 por perfil). A empresa é explícita porque a tela do legado tem
 * seletor de empresa (`cbbEmpresaChange`) — a permissão é por (form, opção, operador, EMPRESA).
 * A exclusividade operador × perfil é do legado (`uCtrlPermissoes.pas:314-315`): uma linha nunca tem os dois.
 */
export const permissaoOperadorGrantSchema = z.object({
  codoperador: z.coerce.number({ message: 'Operador inválido.' }).int().positive(),
  form: z.string().trim().min(1, 'Informe a tela (form).').max(60),
  opcao: z.string().trim().min(1, 'Informe a opção.').max(60),
  concedido: z.boolean(),
  /** empresa do grant; ausente = a da sessão. */
  codempresa: z.coerce.number().int().positive().optional(),
});
export type PermissaoOperadorGrantDto = z.infer<typeof permissaoOperadorGrantSchema>;

/**
 * MARCAR/DESMARCAR EM LOTE (`btnMarcarTodosFormClick` / `btnMarcarTodosOpcoesClick`). `form` ausente = todos os
 * formulários do catálogo; presente = todas as opções daquele formulário.
 * ⚠️ o legado, ao marcar TODOS, exclui os formulários do menu INDÚSTRIA quando a empresa não é industrial
 * (`uCtrlPermissoes.pas:478-493`) — o gate vive no serviço, não aqui.
 */
export const permissaoLoteSchema = z.object({
  codoperador: z.coerce.number().int().positive().optional(),
  codperfil: z.coerce.number().int().positive().optional(),
  form: z.string().trim().max(60).optional(),
  concedido: z.boolean(),
  codempresa: z.coerce.number().int().positive().optional(),
}).refine((v) => (v.codoperador == null) !== (v.codperfil == null), {
  message: 'Informe o operador OU o perfil (nunca os dois) — é a regra do legado.',
  path: ['codoperador'],
});
export type PermissaoLoteDto = z.infer<typeof permissaoLoteSchema>;

/**
 * CLONAR PERMISSÕES (`btnCopiarParaClick` → `SP_REPLICA_PERMISSAO`). Copia de um operador/perfil para outro,
 * podendo trocar de empresa. ⚠️ é **destrutivo**: o legado APAGA tudo do destino antes de copiar.
 */
export const permissaoClonarSchema = z.object({
  tipo: z.enum(['USUARIO', 'PERFIL']),
  de: z.coerce.number({ message: 'Informe a origem.' }).int().positive(),
  de_empresa: z.coerce.number().int().positive(),
  para: z.coerce.number({ message: 'Informe o destino.' }).int().positive(),
  para_empresa: z.coerce.number().int().positive(),
}).refine((v) => !(v.de === v.para && v.de_empresa === v.para_empresa), {
  message: 'A origem e o destino são o mesmo — nada a clonar.',
  path: ['para'],
});
export type PermissaoClonarDto = z.infer<typeof permissaoClonarSchema>;
