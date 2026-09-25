import { z } from 'zod';
import { zCnpj, zUf } from '../validators/br';

/**
 * Cadastro de EMPRESAS (legado `UCadEmpresa`, tabela EMPRESAS — 265 colunas). Corte 1:
 * núcleo cadastrais + endereço (enderEmit) + config fiscal (regime/figura/IE/série) +
 * precificação/financeiro (os campos que a NF/precificação leem). A empresa É o tenant —
 * `idempresa` (= CODEMPRESA) é DIGITADO (pkGerada:false), não carimbado.
 *
 * Adiado (dossiê UCadEmpresa.md): certificado/CSC/NFC-e/CTe/MDFe, integrações/tokens, e-mail,
 * contingência, contábil/centros-de-custo, master-details, e a camada de config chave-valor.
 *
 * Validações verbatim do legado (UCadEmpresa.pas): CNPJ válido (ExisteDocumento), ALQSIMPLESNAC
 * obrigatória se Simples (cmbCLASSFISCALChange:1438), MARGEM_CONTRIBUICAO ≥ 0 (Preenchido(8):2383).
 * Mensagens em PT (ADR-015).
 */

/** trata '' / null como ausente antes de aplicar um validador. */
const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());

/** numeric do pg volta como STRING; aceita número ou string numérica e normaliza ('' / null → ausente). */
const dec = (inner: z.ZodNumber = z.number()) =>
  z.preprocess((v) => {
    if (v === '' || v == null) return undefined;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return v;
  }, inner.optional());

const sn = z.enum(['S', 'N']);

/** regras condicionais (compartilhadas entre create e update). */
const validaEmpresa = (d: Record<string, unknown>, ctx: z.RefinementCtx) => {
  // ALQSIMPLESNAC obrigatória quando Simples Nacional (cmbCLASSFISCALChange:1438).
  if (d.classfiscal === 'SN' && (d.alqsimplesnac == null || (d.alqsimplesnac as number) <= 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe a alíquota do Simples Nacional.', path: ['alqsimplesnac'] });
  }
  // MARGEM_CONTRIBUICAO ≥ 0 (Preenchido(8):2383).
  if (d.margem_contribuicao != null && (d.margem_contribuicao as number) < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A margem de contribuição não pode ser menor que zero.', path: ['margem_contribuicao'] });
  }
};

const empresaBase = z
  .object({
    // identidade (idempresa = CODEMPRESA, digitado)
    idempresa: z
      .number({ message: 'Informe o código da empresa.' })
      .int('Código inválido.')
      .positive('Código inválido.'),
    razao_social: z.string({ message: 'Informe a razão social.' }).trim().min(1, 'Informe a razão social.').max(150),
    fantasia: opcional(z.string().trim().max(150)),
    cnpj: zCnpj, // valida DV + normaliza p/ 14 dígitos
    insc: opcional(z.string().trim().max(20)), // Inscrição Estadual
    im: opcional(z.string().trim().max(20)),
    // endereço (enderEmit)
    endereco: opcional(z.string().trim().max(100)),
    numero: opcional(z.string().trim().max(10)),
    complemento: opcional(z.string().trim().max(60)),
    bairro: opcional(z.string().trim().max(50)),
    cidade: opcional(z.string().trim().max(50)),
    uf: zUf,
    cep: opcional(z.string().trim().max(10)),
    fone1: opcional(z.string().trim().max(20)),
    idcidade: opcional(z.number().int()), // IBGE município (cMun)
    cuf: opcional(z.number().int()), // IBGE UF (cUF)
    // fiscal / regime
    classfiscal: z.enum(['LR', 'SN'], { message: "Regime inválido (use 'LR' ou 'SN')." }).default('LR'),
    figurafiscal: opcional(z.enum(['D', 'O'])),
    contribuinte_icms: opcional(sn),
    alqsimplesnac: dec(z.number().nonnegative('Alíquota do Simples inválida.')),
    serie_nfe: opcional(z.string().trim().max(3)),
    tiponfe: opcional(z.string().trim().max(1)),
    ambiente: opcional(z.enum(['1', '2'])),
    piscofis: dec(z.number().nonnegative()),
    imprenda: dec(z.number().nonnegative()),
    contsocial: dec(z.number().nonnegative()),
    aliquota_estado: dec(z.number().nonnegative()),
    // precificação / financeiro
    despoperacional: dec(z.number().nonnegative()),
    margem_venda: dec(z.number()),
    margem_contribuicao: dec(z.number()),
    txjuropadrao: dec(z.number().nonnegative()),
    tx_juro_apagar: dec(z.number().nonnegative()),
    descmax: dec(z.number().nonnegative()),
    limite_descmax: dec(z.number().nonnegative()),
    // PARÂMETROS que a produção altera (78 alterações no LOG de 2025-26) e que o Apollo lê — auditoria de esqueletos §4.15
    ccmultajuros: dec(z.number().int().positive()),          // CC de multas, juros e taxas (baixa de cartão/AP)
    codplc_juros_pagos: dec(z.number().int().positive()),
    codplc_acrescimos_pagos: dec(z.number().int().positive()),
    codplc_descontos_recebidos: dec(z.number().int().positive()),
    codplc_descontos_concedidos: dec(z.number().int().positive()),
    codparceiro: dec(z.number().int().positive()),            // o parceiro da empresa (fornecedor do SCRAP, destinatário da NF de perda)
    sincroniza_preco_nf: opcional(z.enum(['S', 'N'])),       // o preço do produto sincroniza nas lojas
    pc_curva_abc_a: dec(z.number().nonnegative()),
    pc_curva_abc_b: dec(z.number().nonnegative()),
    pc_curva_abc_c: dec(z.number().nonnegative()),
    pc_curva_comp_a: dec(z.number().nonnegative()),
    pc_curva_comp_b: dec(z.number().nonnegative()),
    pc_curva_comp_c: dec(z.number().nonnegative()),
    aream2: dec(z.number().nonnegative()),
    aream2_venda: dec(z.number().nonnegative()),
    tef_loja: opcional(z.string().trim().max(20)),
    tef_servidor: opcional(z.string().trim().max(20)),
    junta_comercial: opcional(z.string().trim().max(30)),
    codplc_nf_pdv: dec(z.number().int().positive()),
    idsituacao_nf_pdv: dec(z.number().int().positive()),
  });

export const empresaSchema = empresaBase.superRefine(validaEmpresa);
export type CriarEmpresaDto = z.infer<typeof empresaSchema>;

export const atualizarEmpresaSchema = empresaBase.partial().superRefine(validaEmpresa);
export type AtualizarEmpresaDto = z.infer<typeof atualizarEmpresaSchema>;

export interface Empresa extends CriarEmpresaDto {}
