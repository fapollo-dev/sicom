import { z } from 'zod';

/**
 * AUTH (OPERADORES corte-3) — login + troca de senha. O login é escopado por EMPRESA (fiel ao legado:
 * `WHERE LOGIN=:u AND SENHA=:cifrada AND CODEMPRESA=:emp` + RELACAO_OPERADOR_EMPRESA). `empresa` é opcional:
 * se o operador tem só 1 empresa vinculada, o servidor a resolve; se tem várias e nenhuma foi informada, o
 * login responde `needsEmpresa` com a lista (o cliente escolhe e reenvia). O tenant vem do header `x-tenant-id`
 * (seletor do banco), não do corpo. ENDURECIMENTO consciente do legado (que não tinha política): mínimo de
 * 6 caracteres na NOVA senha; backdoors (dev/mestra por data) NÃO reimplementados.
 */

export const loginSchema = z.object({
  // .max(50) espelha o cadastro (operador.schema) — sem isso um login gigante inflaria o log de auditoria de
  // falha (login_tentativa) sob body-limit de 5 MB (storage-DoS). Rejeitado no pipe antes de tocar o serviço.
  login: z.string().trim().min(1, 'Informe o usuário.').max(50, 'Usuário inválido.'),
  senha: z.string().min(1, 'Informe a senha.').max(200, 'Senha inválida.'),
  empresa: z.coerce.number().int().positive().optional(),
});
export type LoginDto = z.infer<typeof loginSchema>;

/** Mínimo da nova senha (endurecimento — o legado só exigia "não vazio"). */
export const SENHA_MIN = 6;

export const trocarSenhaSchema = z
  .object({
    senhaAtual: z.string().min(1, 'Informe a senha atual.'),
    senhaNova: z.string().min(SENHA_MIN, `A nova senha deve ter ao menos ${SENHA_MIN} caracteres.`),
    confirmacao: z.string().min(1, 'Confirme a nova senha.'),
  })
  .superRefine((d, ctx) => {
    if (d.senhaNova !== d.confirmacao) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmacao'], message: 'A nova senha e a confirmação não conferem.' });
    }
    if (d.senhaNova === d.senhaAtual) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['senhaNova'], message: 'A nova senha deve ser diferente da atual.' });
    }
  });
export type TrocarSenhaDto = z.infer<typeof trocarSenhaSchema>;

/** Empresa disponível para o operador no login (quando precisa escolher). */
export interface EmpresaDisponivel {
  idempresa: number;
  nome?: string | null;
}

/** Resposta do login: token + identidade, OU needsEmpresa quando há várias empresas a escolher. */
export interface LoginResposta {
  token?: string;
  needsEmpresa?: boolean;
  empresas: EmpresaDisponivel[];
  operador?: { codoperador: number; nome: string | null; login: string | null };
  empresa?: number;
  mustChangePassword?: boolean;
}

/** Liberação por supervisor — set de grant por-usuário (corte-2). */
export const liberacaoPermissaoSchema = z.object({
  codigo: z.string().trim().min(1, 'Informe a chave de liberação.').max(100),
  codoperador: z.coerce.number({ message: 'Operador inválido.' }).int().positive('Operador inválido.'),
  concedido: z.boolean(),
});
export type LiberacaoPermissaoDto = z.infer<typeof liberacaoPermissaoSchema>;

/** Liberação por supervisor — validar login+senha do supervisor (ChamaLiberacaoLogin, corte-3). */
export const liberacaoValidarSchema = z.object({
  codigo: z.string().trim().min(1, 'Informe a chave de liberação.').max(100),
  login: z.string().trim().min(1, 'Informe o login do supervisor.').max(50),
  senha: z.string().min(1, 'Informe a senha do supervisor.').max(200),
  liberacao: z.string().trim().min(1).max(1000),
  computador: z.string().trim().max(200).optional(),
});
export type LiberacaoValidarDto = z.infer<typeof liberacaoValidarSchema>;
export interface RetornoLiberacao { liberado: boolean; codOperador?: number }
