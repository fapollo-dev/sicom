import { z } from 'zod';
import { zCpfCnpj, zCep, zUf, zCelular, zEmail } from '../validators/br';

/**
 * Cadastro UNIFICADO de PARCEIROS (a tela viva do legado é `TfrmCadClientes` — uma só,
 * usada p/ Cliente/Fornecedor/Funcionário/Transportador/Convênio). Fase 1: NÚCLEO fiel.
 * Doc: docs/04-screen-dossier/dossiers/retaguarda/uCadClientes.md
 *
 * Achados refletidos:
 *  - Tabela ÚNICA multi-papel: 6 flags 'S'/'N' INDEPENDENTES (CLI/FRN/FUN/TRA/CON/ASS).
 *    FUN = funcionário/vendedor (NÃO fornecedor → fornecedor é FRN). Ao menos um obrigatório.
 *  - CNPJ/CPF e RG/IE vivem no ENDEREÇO (PARCEIROS_END), não no master.
 *  - IDEMPRESA é escopo multi-tenant (carimbado no servidor; não é entrada do usuário).
 * Mensagens em PT (ADR-015); validadores BR reusados de @apollo/shared.
 */

/** TIPOFJ (combo) — domínio NÃO fechado no legado ('L'/null existem em dados reais). */
export const TIPOFJ_OPCOES = [
  { value: 'F', label: 'Física' },
  { value: 'J', label: 'Jurídica' },
  { value: 'R', label: 'Rural' },
  { value: 'G', label: 'Governamental' },
  { value: 'E', label: 'Entidade' },
] as const;

/** Papéis do parceiro (flags 'S'/'N' independentes). ASS é legado morto (mantido por fidelidade). */
export const PAPEIS_PARCEIRO = [
  { campo: 'cli', label: 'Cliente' },
  { campo: 'frn', label: 'Fornecedor' },
  { campo: 'fun', label: 'Funcionário/Vendedor' },
  { campo: 'tra', label: 'Transportador' },
  { campo: 'con', label: 'Convênio' },
] as const;

/** trata '' / null como ausente (campo opcional) antes de aplicar um validador que transforma. */
const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());

const sn = (msg = "Informe 'S' ou 'N'") => z.enum(['S', 'N'], { message: msg });

/** Endereço do parceiro (PARCEIROS_END) — documento fiscal mora AQUI. */
export const enderecoParceiroSchema = z.object({
  endereco: z.string().trim().max(150).optional(),
  numero: z.string().trim().max(20).optional(),
  complemento: z.string().trim().max(100).optional(),
  bairro: z.string().trim().max(50).optional(),
  cidade: z.string().trim().max(60).optional(),
  idcidade: z.number().int().optional(),
  uf: opcional(zUf),
  cep: opcional(zCep),
  cnpj_cpf: opcional(zCpfCnpj),
  rg_insc: z.string().trim().max(30).optional(),
  telefone: opcional(zCelular),
  celular: opcional(zCelular),
  fax: z.string().trim().max(20).optional(),
  tipo_endereco: z.string().trim().max(100).optional(),
  endereco_padrao: sn().default('N'),
  ativado: sn().default('S'),
  codpais: z.number().int().optional(),
});
export type EnderecoParceiroDto = z.infer<typeof enderecoParceiroSchema>;

/** Base do master (sem o refine de papel) — reusada p/ o schema de atualização (partial). */
const parceiroBase = z.object({
  razao: z.string().trim().min(1, 'Informe a razão social / nome.').max(150),
  fantasia: z.string().trim().max(150).optional(),
  tipofj: z.enum(['F', 'J', 'R', 'G', 'E'], { message: 'Tipo de pessoa inválido' }).default('F'),
  // papéis (6 flags independentes)
  cli: sn().default('N'),
  frn: sn().default('N'),
  fun: sn().default('N'),
  tra: sn().default('N'),
  con: sn().default('N'),
  ass: sn().default('N'),
  ativado: sn().default('S'),
  bloqued: sn().default('N'),
  email: opcional(zEmail),
  dtnascimento: z.string().optional(), // ISO 'YYYY-MM-DD'
  sexo: opcional(z.enum(['M', 'F'], { message: 'Sexo inválido' })),
  estado_civil: z.string().trim().max(1).optional(),
  obs: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().max(800))
    .optional(),
  // financeiro essencial
  credito: z.number().nonnegative('Crédito inválido').optional(),
  txjuro: z.number().nonnegative('Juros inválido').optional(),
  tolerancia: z.number().int().nonnegative('Tolerância inválida').optional(),
  descpadrao: z.number().nonnegative('Desconto inválido').optional(),
  diasprazo: z.number().int().nonnegative('Dias inválido').optional(),
  codvendedor: z.number().int().optional(), // → parceiros (FUN='S')
  codconvenio: z.number().int().optional(), // → parceiros (CON='S')
  codend: z.number().int().optional(),
  // detalhe 1:N
  enderecos: z.array(enderecoParceiroSchema).optional().default([]),
});

/** Regra do legado (btnGravarClick): ao menos um papel marcado. */
const aoMenosUmPapel = (d: { cli?: string; frn?: string; fun?: string; tra?: string; con?: string }) =>
  d.cli === 'S' || d.frn === 'S' || d.fun === 'S' || d.tra === 'S' || d.con === 'S';

export const parceiroSchema = parceiroBase.superRefine((d, ctx) => {
  if (!aoMenosUmPapel(d)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Preenchimento do tipo de parceiro é obrigatório (Cliente, Fornecedor, etc.). Verifique!',
      path: ['cli'],
    });
  }
});
export type CriarParceiroDto = z.infer<typeof parceiroSchema>;

export const atualizarParceiroSchema = parceiroBase.partial();
export type AtualizarParceiroDto = z.infer<typeof atualizarParceiroSchema>;

export interface Parceiro extends CriarParceiroDto {
  codparceiro: number;
  idempresa?: number; // escopo multi-tenant (carimbado no servidor)
  tipo_pessoa?: string; // decode de TIPOFJ (via view), p/ exibição
  cnpj_cpf?: string; // do endereço padrão (via view)
  cidade?: string; // idem
  uf?: string; // idem
}

/** Retorno do proxy de CEP (GET /cadastro/cep/:cep). */
export interface CepResposta {
  cep: string;
  endereco: string;
  bairro: string;
  cidade: string;
  uf: string;
  idcidade?: number;
}
