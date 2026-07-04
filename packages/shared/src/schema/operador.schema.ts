import { z } from 'zod';

/**
 * OPERADORES (uCadUsuarios "Cadastro de usuários") — corte-1 núcleo cadastral. Operador GLOBAL
 * (o legado não tem coluna de empresa; vínculo empresa via ponte, adiado). PK `codoperador` é
 * DIGITADA (pkGerada:false). `idgrupo` é DERIVADO de `tipoop` no service (não vem do cliente).
 * Senha, empresas-permitidas, perfis, supervisionados e biometria = cortes seguintes.
 * Validações: LOGIN único (:408, via índice parcial). ENDURECIMENTOS conscientes (o legado só exige
 * a PK e compara login case-sensitive): NOME/LOGIN obrigatórios; login único case-INsensitive. Ver dossiê.
 */

const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());

const stripNulls = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const x = stripNulls(val);
      if (x !== undefined) o[k] = x;
    }
    return o;
  }
  return v === null ? undefined : v;
};

/** Tipo do operador (cbbTipo, uCadUsuarios.dfm:201) — deriva o grupo (IDGRUPO). */
export const OPERADOR_TIPO_OPCOES = [
  { value: 'USU', label: 'Usuário' },
  { value: 'OPE', label: 'Operador' },
  { value: 'SUP', label: 'Supervisor' },
  { value: 'FOR', label: 'Fornecedor' },
  { value: 'PRO', label: 'Proprietário' },
  { value: 'ASU', label: 'Analista de Suporte' },
  { value: 'ANS', label: 'Analista de Sistema' },
] as const;

/** TIPOOP → IDGRUPO (uCadUsuarios.pas:451-462). */
export const TIPOOP_IDGRUPO: Record<string, number> = {
  USU: 1, OPE: 2, SUP: 3, FOR: 4, PRO: 5, ASU: 6, ANS: 7,
};

const TIPO_VALUES = OPERADOR_TIPO_OPCOES.map((t) => t.value) as [string, ...string[]];

const operadorBase = z.object({
  // chave natural DIGITADA (obrigatória no insert; no update vem da URL).
  codoperador: z.number({ message: 'Código do operador inválido.' }).int('Código inválido.').positive('Código inválido.'),
  nome: z.string().trim().min(1, 'Informe o nome do operador.').max(30, 'Nome muito longo (máx. 30).'),
  login: z.string().trim().min(1, 'Informe o login.').max(50, 'Login muito longo (máx. 50).'),
  tipoop: opcional(z.enum(TIPO_VALUES, { message: 'Tipo de operador inválido.' })),
  codparceiro: opcional(z.number().int()),
  idsupervisor: opcional(z.number().int()), // sem UI no corte-1 (fluxo supervisionados = corte-2)
  desabilitado: opcional(z.enum(['S', 'N'])),
  desabilita_operacoes_basicas: opcional(z.enum(['S', 'N'])),
  desabilita_desconto_pdv: opcional(z.enum(['S', 'N'])),
  solicitar_alteracao_senha: opcional(z.enum(['S', 'N'])),
  // EMPRESAS-PERMITIDAS (corte-2): detalhe 1:N RELACAO_OPERADOR_EMPRESA. O legado exige ≥1 empresa
  // no gravar (uCadUsuarios.pas:444). No update parcial (.partial()) o campo é opcional — só valida se
  // enviado; omitir mantém as existentes (substitute do engine só ocorre quando a chave vem no dto).
  empresas: z
    .array(z.object({ codempresa: z.number({ message: 'Empresa inválida.' }).int().positive() }))
    .min(1, 'Informe ao menos uma empresa permitida.'),
  // ATIVO e CODIGOAUXILIAR são colunas reais mas NÃO editadas pela tela legada (o bloqueio é
  // DESABILITADO; a situação é INDR; CODIGOAUXILIAR está 0-preenchido no Oracle) → fora do delta.
});

export const operadorSchema = z.preprocess(stripNulls, operadorBase);
export const atualizarOperadorSchema = z.preprocess(stripNulls, operadorBase.partial());

export type CriarOperadorDto = z.infer<typeof operadorBase>;

/** Registro devolvido pela API (view get_operadores). */
export interface Operador {
  codoperador: number;
  nome?: string;
  login?: string;
  tipoop?: string;
  idgrupo?: number;
  grupo?: string;
  codparceiro?: number;
  parceiro?: string;
  idsupervisor?: number;
  supervisor?: string;
  desabilitado?: string;
  desabilita_operacoes_basicas?: string;
  desabilita_desconto_pdv?: string;
  solicitar_alteracao_senha?: string;
  codigoauxiliar?: number;
  ativo?: string;
  indr?: string;
  empresas?: { codrelacao?: number; codoperador?: number; codempresa: number }[];
}
