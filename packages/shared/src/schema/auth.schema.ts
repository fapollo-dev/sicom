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
  login: z.string().trim().min(1, 'Informe o usuário.'),
  senha: z.string().min(1, 'Informe a senha.'),
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
