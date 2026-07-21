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
  refresh?: string; // refresh token OPACO (sessão plena); ausente em needsEmpresa e no token de troca-obrigatória
  needsEmpresa?: boolean;
  empresas: EmpresaDisponivel[];
  operador?: { codoperador: number; nome: string | null; login: string | null };
  empresa?: number;
  mustChangePassword?: boolean;
}

/** Renovação do access token a partir do refresh (rota pública /auth/refresh). */
export const refreshSchema = z.object({
  refresh: z.string().min(1, 'Refresh token ausente.').max(500),
});
export type RefreshDto = z.infer<typeof refreshSchema>;

/** Logout: revoga a família do refresh apresentado (opcional — sem ele, é só auditoria). */
export const logoutSchema = z.object({
  refresh: z.string().max(500).optional(),
});
export type LogoutDto = z.infer<typeof logoutSchema>;

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

/** 'HH:MM' 24h (00:00–23:59). */
const zHoraHHMM = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (use HH:MM entre 00:00 e 23:59).');

/**
 * OPERADORES_RESTRICAO_ACESSO — janela de horário PERMITIDO por operador (login gate, T1.5).
 * `diasemana` 1=domingo..7=sábado (convenção Delphi DayOfWeek, fiel à tabela homolog).
 * A janela é inclusiva e NÃO cruza a meia-noite: hora_inicial < hora_final (uma janela 22h→02h = duas linhas).
 */
export const restricaoAcessoSchema = z
  .object({
    diasemana: z.coerce.number({ message: 'Dia da semana inválido.' }).int().min(1, 'Dia da semana inválido (1=dom..7=sáb).').max(7, 'Dia da semana inválido (1=dom..7=sáb).'),
    hora_inicial: zHoraHHMM,
    hora_final: zHoraHHMM,
  })
  .superRefine((v, ctx) => {
    if (v.hora_inicial >= v.hora_final) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hora_final'], message: 'A hora final deve ser maior que a inicial (a janela não cruza a meia-noite; use duas linhas).' });
    }
  });
export type RestricaoAcessoDto = z.infer<typeof restricaoAcessoSchema>;
