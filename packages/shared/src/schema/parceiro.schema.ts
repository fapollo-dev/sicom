import { z } from 'zod';
import { zCpfCnpj, zCep, zUf, zCelular, zEmail } from '../validators/br';
import { inscricaoEstadualValida, ieIsenta } from '../validators/inscricao-estadual';

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

/**
 * CONTRIBUINTE_ICMS — código Sintegra (NÃO é S/N!). Itens VERBATIM do .dfm (cbbContribuinteICMS).
 */
export const CONTRIBUINTE_ICMS_OPCOES = [
  { value: '1', label: '1 - Contribuinte ICMS (informar a IE do destinatário)' },
  { value: '2', label: '2 - Contribuinte isento de Inscrição no cadastro de Contribuintes do ICMS' },
  { value: '9', label: '9 - Não Contribuinte (pode ou não possuir IE)' },
] as const;

/** CLASSFISCAL — regime tributário (cmbCLASSFISCAL). */
export const CLASSFISCAL_OPCOES = [
  { value: 'ME', label: 'ME - Microempresa' },
  { value: 'LR', label: 'LR - Lucro Real' },
  { value: 'SN', label: 'SN - Simples Nacional' },
  { value: 'LP', label: 'LP - Lucro Presumido' },
] as const;

/** IRRF / classificação de retenção (cmbClassIR: ''/I/F/R). */
export const IRRF_OPCOES = [
  { value: 'I', label: 'IRRF retido na fonte' },
  { value: 'F', label: 'Funrural' },
  { value: 'R', label: 'Retém PIS/COFINS' },
] as const;

/** APURACAO (cmbApuracao: M/A). */
export const APURACAO_OPCOES = [
  { value: 'M', label: 'Mensal' },
  { value: 'A', label: 'Anual' },
] as const;

/** CLASSIFICACAO / tipo de figura (cmbTpFigura: F/I/C/S). */
export const CLASSIFICACAO_OPCOES = [
  { value: 'F', label: 'Fornecedor/Atacado' },
  { value: 'I', label: 'Indústria' },
  { value: 'C', label: 'Comércio' },
  { value: 'S', label: 'Simples Nacional' },
] as const;

/** Flags de retenção de ENTRADA (aba "Retenções Nota fiscal"). Só as que a tela expõe. */
export const RETENCOES_PARCEIRO = [
  { campo: 'habilita_retencao_pis_nf', label: 'PIS' },
  { campo: 'habilita_retencao_cofins_nf', label: 'COFINS' },
  { campo: 'habilita_retencao_csll_nf', label: 'CSLL' },
  { campo: 'habilita_retencao_ir_nf', label: 'IR' },
  { campo: 'habilita_retencao_inss_nf', label: 'INSS' },
  { campo: 'habilita_retencao_issqn_nf', label: 'ISSQN' },
  { campo: 'habilita_retencao_funrural_nf', label: 'FUNRURAL' },
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

/** Dados bancários do parceiro (PARCEIROS_BANCOS). codbco → BANCOS (lookup). */
export const bancoParceiroSchema = z.object({
  codbco: z.number().int().optional(), // FK → bancos
  agencia: z.string().trim().max(15).optional(),
  nrconta: z.string().trim().max(20).optional(),
});
export type BancoParceiroDto = z.infer<typeof bancoParceiroSchema>;

/** Forma de pagamento liberada (PARCEIROS_PGTO). idpgto → FORMAS_PGTO (lookup F3). */
export const pgtoParceiroSchema = z.object({
  idpgto: z.number().int().optional(),
  modalidade: z.string().trim().max(60).optional(),
});
export type PgtoParceiroDto = z.infer<typeof pgtoParceiroSchema>;

/** Relacionamento/contato (PARCEIROS_REL). */
export const relParceiroSchema = z.object({
  nome: z.string().trim().max(150).optional(),
  doc1: z.string().trim().max(30).optional(),
  doc2: z.string().trim().max(30).optional(),
  tiporel: z.string().trim().max(50).optional(),
  telefone: opcional(zCelular),
  celular: opcional(zCelular),
  endereco: z.string().trim().max(150).optional(),
});
export type RelParceiroDto = z.infer<typeof relParceiroSchema>;

/** Vendedor vinculado (PARCEIROS_VENDEDORES). codvendedor → parceiros (FUN='S'). */
export const vendedorParceiroSchema = z.object({
  codvendedor: z.number().int().optional(),
});
export type VendedorParceiroDto = z.infer<typeof vendedorParceiroSchema>;

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
  // F2 — abas condicionais por papel
  venc_prev: z.number().int().optional(), // Fornecedor
  dtultcompra: z.string().optional(), // Fornecedor (ISO date)
  classfornecedor: z.number().int().optional(), // Fornecedor
  codref: z.string().trim().max(16).optional(), // Fornecedor
  codcontabil_for: z.string().trim().max(30).optional(), // Fornecedor
  limite_especial: z.number().nonnegative().optional(), // Cliente
  codcontabil: z.string().trim().max(30).optional(), // Cliente
  renda: z.number().nonnegative().optional(), // Funcionário
  cargo: z.string().trim().max(60).optional(), // Funcionário
  empresatrabalha: z.string().trim().max(100).optional(), // Funcionário
  // F3 — CONFIGURAÇÃO fiscal (a tela ARMAZENA; cálculo vive a jusante em NF/financeiro).
  estrangeiro: sn().default('N'),
  contribuinte_icms: opcional(z.enum(['1', '2', '9'], { message: 'Contribuinte ICMS inválido' })), // código Sintegra (NÃO S/N)
  classfiscal: opcional(z.enum(['ME', 'LR', 'SN', 'LP'], { message: 'Classificação fiscal inválida' })),
  envianfe: sn().optional(),
  devolucao_zera_imposto_icmsst: sn().optional(),
  irrf: opcional(z.enum(['I', 'F', 'R'], { message: 'IRRF inválido' })),
  apuracao: opcional(z.enum(['M', 'A'], { message: 'Apuração inválida' })),
  classificacao: opcional(z.enum(['F', 'I', 'C', 'S'], { message: 'Classificação inválida' })),
  // Flags de retenção de ENTRADA (checkbox S/N). Alíquotas IR/ISSQN (a tela só edita estas 2).
  habilita_retencao_pis_nf: sn().optional(),
  habilita_retencao_cofins_nf: sn().optional(),
  habilita_retencao_csll_nf: sn().optional(),
  habilita_retencao_ir_nf: sn().optional(),
  habilita_retencao_inss_nf: sn().optional(),
  habilita_retencao_issqn_nf: sn().optional(),
  habilita_retencao_funrural_nf: sn().optional(),
  perc_aliquota_ir: z.number().nonnegative('Alíquota IR inválida').optional(),
  perc_aliquota_issqn: z.number().nonnegative('Alíquota ISSQN inválida').optional(),
  codparceiro_ent_issqn: z.number().int().optional(), // FK → parceiros (TIPOFJ='E')
  // detalhes 1:N (engine de agregado grava todos numa transação)
  enderecos: z.array(enderecoParceiroSchema).optional().default([]),
  bancos: z.array(bancoParceiroSchema).optional().default([]),
  pgtos: z.array(pgtoParceiroSchema).optional().default([]),
  relacionamentos: z.array(relParceiroSchema).optional().default([]),
  vendedores: z.array(vendedorParceiroSchema).optional().default([]),
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
  // IE por UF (legado edtIERGExit): valida só quando NÃO é pessoa física e a IE não é isenta.
  if (d.tipofj && d.tipofj !== 'F') {
    (d.enderecos ?? []).forEach((e, i) => {
      const ie = (e.rg_insc ?? '').trim();
      if (ie && !ieIsenta(ie) && e.uf && !inscricaoEstadualValida(e.uf, ie)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Inscrição Estadual inválida para a UF informada.',
          path: ['enderecos', i, 'rg_insc'],
        });
      }
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
