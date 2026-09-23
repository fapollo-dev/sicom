import { z } from 'zod';

/**
 * SITUAÇÃO DO DOCUMENTO (`FRMCADSITUACAONF`, UCadSituacaoNF; dossiê UCadSituacaoNF.md). A situação é a natureza do
 * documento fiscal E o catálogo das operações contábeis (`DIARIO.CODOPERACAO`): o TIPO DE OPERAÇÃO decide o tipo E/S,
 * quais abas a tela mostra e se a conta contábil é fixa (`SetTipoOperacao`, UCadSituacaoNF.pas:1445-1566).
 */

/** os 53 tipos de operação do combo (UCadSituacaoNF.dfm:124-231) + A01, que a produção tem (agenda de promoção) */
export const TIPOS_OPERACAO_SITUACAO: Record<string, string> = {
  E01: 'Estoque', E02: 'Scrap', E03: 'Serviços com retenções',
  F01: 'Fechamento de caixa', F02: 'Vendas em ECF', F03: 'Transferência bancária', F04: 'Contas a pagar',
  F05: 'Contas a receber', F06: 'Movimentação do caixa', F07: 'Baixa de contas a pagar', F08: 'Baixa de contas a receber',
  F09: 'Baixa de cartões', F10: 'Baixa de cheques', F11: 'Juros pagos', F12: 'Acréscimos pagos - baixa',
  F13: 'Descontos recebidos - baixa', F14: 'Juros recebidos - baixa', F15: 'Acréscimos recebidos - baixa',
  F16: 'Descontos concedidos - baixa', F17: 'Taxas de cartões', F18: 'Outras despesas de cartões',
  F19: 'Adiantamento à parceiros - Recebimento', F20: 'Adiantamento à parceiros - Pagamento',
  F21: 'Adiantamento à parceiros - Crédito', F22: 'Agrupamento de convênio', F23: 'Custo de vendas',
  F24: 'Custo de notas fiscais de venda', F25: 'Descontos obtidos à pagar', F26: 'Embutidos (acréscimos) à pagar',
  F27: 'A Receber de diferença de pedido de compra', F28: 'Vendas em NFC-e', O01: 'Outros',
  I01: 'ICMS em notas fiscais de entrada', I02: 'ICMS em notas fiscais de saída', I03: 'ICMS em reduções Z',
  I04: 'ICMS em NFC-e', I05: 'PIS em notas fiscais de entrada', I06: 'PIS em notas fiscais de saída',
  I07: 'PIS em reduções Z', I08: 'PIS em NFC-e', I09: 'COFINS em notas fiscais de entrada',
  I10: 'COFINS em notas fiscais de saída', I11: 'COFINS em reduções Z', I12: 'COFINS em NFC-e',
  I13: 'Retenção de PIS - Nota Fiscal', I14: 'Retenção de COFINS - Nota Fiscal', I15: 'Retenção de CSLL - Nota Fiscal',
  I16: 'Retenção de INSS - Nota Fiscal', I17: 'Retenção de IR - Nota Fiscal', I18: 'Retenção de ISSQN - Nota Fiscal',
  I19: 'Retenção de Funrural - Nota Fiscal', I20: 'Acordo Comercial - Nota Fiscal', T01: 'Transporte',
  A01: 'Agenda de promoção',
};

const set = (s: string) => new Set(s.split(' '));
const TIPO_ENTRADA = set('F04 F07 F11 F12 F16 F19 I01 I05 I09 E03 I13 I14 I15 I16 I17 I18 I19 I20 F26 F27');
const TIPO_LIVRE = set('E01 F01 F02 F03 F06 O01 T01');
const CONTA_FIXA = set('O01 I01 I02 I03 I04 I05 I06 I07 I08 I09 I10 I11 I12 F23 E02 E03 I13 I14 I15 I16 I17 I18 I19 F24 F28');
const ABA_CC_E_PARCEIROS = set('E01 F04 F05 F06 T01');
const ABA_SO_PARCEIROS = set('F19 F20 F21');
const ABA_SO_CC = set('E02 E03 I13 I14 I15 I16 I17 I18 I19 I20 F25 F26 F27');

export interface RegraTipoOperacao {
  /** o TIPO que a operação força ('E'/'S'); null = livre */
  tipoForcado: 'E' | 'S' | null;
  /** a conta contábil tem de ser Fixa ('F') */
  contaFixa: boolean;
  abas: { cfop: boolean; estoque: boolean; outras: boolean; centroCusto: boolean; parceiros: boolean };
  /** as contas de baixa da aba "Outras configurações" */
  debBaixaCP: boolean;
  credBaixaCR: boolean;
}

/** a matriz do `SetTipoOperacao` (UCadSituacaoNF.pas:1445-1566) — operação desconhecida (A01) = tudo livre */
export function regraTipoOperacao(codigo: string | null | undefined): RegraTipoOperacao {
  const c = String(codigo ?? '').toUpperCase();
  const conhecido = c in TIPOS_OPERACAO_SITUACAO && c !== 'A01';
  return {
    tipoForcado: !conhecido || TIPO_LIVRE.has(c) ? null : TIPO_ENTRADA.has(c) ? 'E' : 'S',
    contaFixa: CONTA_FIXA.has(c),
    abas: {
      cfop: c === 'E01' || c === 'E03' || c === 'T01',
      estoque: c === 'E01' || c === 'E03',
      outras: c === 'E01' || c === 'F04' || c === 'F05',
      centroCusto: ABA_CC_E_PARCEIROS.has(c) || ABA_SO_CC.has(c),
      parceiros: ABA_CC_E_PARCEIROS.has(c) || ABA_SO_PARCEIROS.has(c),
    },
    debBaixaCP: c === 'E01' || c === 'F04',
    credBaixaCR: c === 'E01' || c === 'F05',
  };
}

const opcional = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());
const num = () => z.preprocess((v) => (v === '' || v == null ? undefined : typeof v === 'string' ? Number(v) : v), z.number().int().optional());
const sn = () => opcional(z.enum(['S', 'N']));

export const situacaoNfContaSchema = z.object({
  natureza: z.enum(['C', 'D'], { message: 'Informe a natureza (crédito ou débito).' }),
  // F = Fixa · A = Automática (a conta vem do documento)
  tipo: z.enum(['F', 'A'], { message: 'Informe o tipo da conta (fixa ou automática).' }),
  codconta_contabil: num(),
  codhistorico: num(),
});

export const situacaoNfCfopSchema = z.object({ codcfop: z.coerce.number({ message: 'CFOP inválido.' }).int().positive('Informe o CFOP.') });
export const situacaoNfCcSchema = z.object({
  codplc: z.coerce.number({ message: 'Centro de custo inválido.' }).int().positive('Informe o centro de custo.'),
  dtcadastro: opcional(z.string()),
  codoperador: num(),
});
export const situacaoNfParceiroSchema = z.object({
  codparceiro: z.coerce.number({ message: 'Parceiro inválido.' }).int().positive('Informe o parceiro.'),
  dtcadastro: opcional(z.string()),
  codoperador: num(),
});

const base = z.object({
  idsituacao_nf: num(),
  descricao: z.string({ message: 'Informe a descrição da situação do documento.' }).trim()
    .min(1, 'Informe a descrição da situação do documento.').max(80), // 100 no legado; alarga com o conferidor de tamanhos
  tipo_operacao: z.string({ message: 'Informe o tipo de operação.' }).trim().toUpperCase()
    .refine((v) => v in TIPOS_OPERACAO_SITUACAO, 'Tipo de operação inválido.'),
  // E/S — e 'T' (uma situação da produção, a 2020 F03)
  tipo: opcional(z.enum(['E', 'S', 'T'])),
  nao_realiza_integracao: sn(),
  exige_pedido_compra: sn(),
  valida_estoque_disponivel: sn(),
  transferencia_mercadorias: sn(),
  permite_basecalc_maior100: sn(),
  idpgto_nfe: num(),
  codoperadoras_nfe: num(),
  // o combo de importação automática (DE/PD na entrada; DC/IN/PE/PP/PC/SC/TR/TO/VE na saída)
  importacao_auto_nf: opcional(z.string().trim().toUpperCase().max(2)),
  codplanocontas_deb_baixa_cp: num(),
  codplanocontas_cred_baixa_cr: num(),
  idsituacao_nf_financeiro: num(),
  // do binário novo (não estão no fonte de 2020): carregados e preservados
  gerar_contas_receber: sn(),
  dias_prazo: num(),
  estoque: opcional(z.string().max(2)),
  exige_mapa_carga: sn(),
  exige_scrap: sn(),
  exige_cheque: sn(),
  valida_conteudo_emb: sn(),
  codclass_trib: num(),
  ativo: sn(),
  // detalhes
  cfops: z.array(situacaoNfCfopSchema).optional(),
  centros_custo: z.array(situacaoNfCcSchema).optional(),
  parceiros: z.array(situacaoNfParceiroSchema).optional(),
  contas: z.array(situacaoNfContaSchema).optional(),
});

/** a validação do gravar (`ValidaInformacoes`, :1568): contas = nenhuma ou uma crédito e uma débito */
const validaContas = (d: { contas?: Array<{ natureza: 'C' | 'D' }> }, ctx: z.RefinementCtx) => {
  const c = d.contas ?? [];
  if (c.length && (c.length !== 2 || c.filter((x) => x.natureza === 'C').length !== 1)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ['contas'],
      message: `Informe ${c.length > 2 ? 'somente ' : ''}uma conta crédito e uma conta débito.`,
    });
  }
};

export const situacaoNfSchema = base.superRefine(validaContas);
export type CriarSituacaoNfDto = z.infer<typeof situacaoNfSchema>;
export const atualizarSituacaoNfSchema = base.partial().superRefine(validaContas);
export type AtualizarSituacaoNfDto = z.infer<typeof atualizarSituacaoNfSchema>;
export interface SituacaoNf extends CriarSituacaoNfDto {
  qtde_cfop?: number | string | null;
}
