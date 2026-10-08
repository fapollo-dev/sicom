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
  // o supervisor do próprio operador: só o OPERADOR tem (ProcessaRegrasSupervisor, uCadUsuarios.pas:745-755 — o campo só habilita
  // no tipo OPE e é limpo nos outros); a escolha é um SUPERVISOR ativo (GET_OPERADORES, TIPO_SIGLA='SUP' AND DESABILITADO='N')
  idsupervisor: opcional(z.number().int()),
  desabilitado: opcional(z.enum(['S', 'N'])),
  desabilita_operacoes_basicas: opcional(z.enum(['S', 'N'])),
  desabilita_desconto_pdv: opcional(z.enum(['S', 'N'])),
  solicitar_alteracao_senha: opcional(z.enum(['S', 'N'])),
  // a SENHA do cadastro (edtSenha/edtConfSenha, uCadUsuarios.pas:423-432): obrigatória na inclusão, opcional na alteração (vazia
  // = mantém). Vai ao `senha_hash` do servidor e o operador troca no primeiro acesso; nunca volta na leitura.
  senha: opcional(z.string().min(1).max(50)),
  confirmacaoSenha: opcional(z.string().max(50)),
  // EMPRESAS-PERMITIDAS (corte-2): detalhe 1:N RELACAO_OPERADOR_EMPRESA. O legado exige ≥1 empresa
  // no gravar (uCadUsuarios.pas:444). No update parcial (.partial()) o campo é opcional — só valida se
  // enviado; omitir mantém as existentes (substitute do engine só ocorre quando a chave vem no dto).
  empresas: z
    .array(z.object({ codempresa: z.number({ message: 'Empresa inválida.' }).int().positive() }))
    .min(1, 'Informe ao menos uma empresa permitida.'),
  // MENU (cbbMenu: 1 Padrão / 2 Personalizado), CODIGOAUXILIAR (EdtCodigoAuxiliar, uCadUsuarios.dfm:404 — digitado em 24 dos 90 operadores
  // de 2026) e, do binário novo, ATIVO e BLOQUEARSUPERLIBERARPROP. (A leitura de antes — "não editadas pela tela", "0-preenchido" — era da
  // homologação.) O bloqueio de acesso continua sendo o DESABILITADO: o ATIVO só é gravado, sem efeito provado no login.
  menu: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().min(1).max(2).optional()),
  codigoauxiliar: z.preprocess((v) => (v === '' || v == null ? undefined : Number(v)), z.number().int().optional()),
  ativo: opcional(z.enum(['S', 'N'])),
  bloquearsuperliberarprop: opcional(z.enum(['S', 'N'])),
  // as abas "Perfil operador" e "Perfil de compras" (RELACAO_OPERADOR_PERFIL / _COMPRA, uCadUsuarios.pas:220-264): o Adicionar abre a
  // Pesquisa da GET_PERFIL (ATIVO='S' e o TIPO da aba) em multisseleção; gravam no Gravar do operador. Omitir = não mexe.
  perfis: z.array(z.object({ codperfil: z.number().int().positive(), perfil: z.string().nullish() })).optional(),
  perfis_compra: z.array(z.object({ codperfil: z.number().int().positive(), perfil: z.string().nullish() })).optional(),
  // a aba "Operadores supervisionados" (só do SUPERVISOR, uCadUsuarios.pas:266-300 e o DepoisGravar :557-588): os OPERADORES que ele
  // supervisiona — o Gravar põe o IDSUPERVISOR deles. Omitir = não mexe.
  supervisionados: z.array(z.object({ codoperador: z.number().int().positive(), nome: z.string().nullish() })).optional(),
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
