import { z } from 'zod';

/**
 * CONFIGURAÇÃO DA INTEGRAÇÃO CONTÁBIL (`FRMCONFIGINTEGRACAOCONTABIL`, `UFrmConfigIntegracaoContabil.pas`).
 *
 * É o painel que diz, para cada EVENTO do sistema, qual **situação** o razão deve usar. Sem ele o motor da
 * integração não sabe em que contas lançar uma baixa de cartão, um desconto obtido ou o ICMS de uma nota —
 * e é por isso que `CONTAS_NAO_INFORMADAS` é o erro mais comum de quem nunca configurou.
 *
 * A tabela tem uma linha só. Cada campo aponta para `SITUACAO_NF.IDSITUACAO_NF`, que por sua vez é a chave da
 * `ITENS_INTEGRACAO_CONTABIL` — as duas pernas (débito e crédito) de cada lançamento.
 *
 * Os grupos abaixo são as abas do legado, na mesma ordem e com os mesmos rótulos.
 */
export interface CampoConfigIC { campo: string; label: string; grupo: string; sub?: string }

export const CAMPOS_CONFIG_IC: CampoConfigIC[] = [
  // ── Vendas e fechamento de caixa
  { campo: 'config_correspondente', label: 'Correspondente', grupo: 'Vendas e fechamento de caixa' },
  { campo: 'config_fechamentocaixa', label: 'Fechamento de caixa', grupo: 'Vendas e fechamento de caixa' },
  { campo: 'config_faltacaixa', label: 'Quebra de caixa sem contas a receber', grupo: 'Vendas e fechamento de caixa' },
  { campo: 'config_quebracaixarcb', label: 'Quebra de caixa com contas a receber', grupo: 'Vendas e fechamento de caixa' },
  { campo: 'config_recarga', label: 'Recarga', grupo: 'Vendas e fechamento de caixa' },
  { campo: 'config_sobracaixa', label: 'Sobra de caixa', grupo: 'Vendas e fechamento de caixa' },
  { campo: 'config_vendapdv', label: 'Venda PDV', grupo: 'Vendas e fechamento de caixa' },
  { campo: 'config_voucher', label: 'Voucher', grupo: 'Vendas e fechamento de caixa' },
  { campo: 'config_custo_vendas', label: 'Custo de venda', grupo: 'Vendas e fechamento de caixa' },
  { campo: 'config_custo_nf_venda', label: 'Custo de nota fiscal de venda', grupo: 'Vendas e fechamento de caixa' },
  { campo: 'config_troco_solidario', label: 'Troco solidário', grupo: 'Vendas e fechamento de caixa' },
  { campo: 'config_nfce', label: 'Vendas NFC-e', grupo: 'Vendas e fechamento de caixa' },
  // ── Financeiro · Contas a pagar
  { campo: 'config_acrescimos_pagos', label: 'Acréscimos pagos', grupo: 'Financeiro', sub: 'Contas a pagar' },
  { campo: 'config_baixa_apg', label: 'Baixa de contas a pagar', grupo: 'Financeiro', sub: 'Contas a pagar' },
  { campo: 'config_contapagaravulsa', label: 'Contas a pagar avulsas', grupo: 'Financeiro', sub: 'Contas a pagar' },
  { campo: 'config_contapagaravulsasemcc', label: 'Contas a pagar avulsas sem centro de custo', grupo: 'Financeiro', sub: 'Contas a pagar' },
  { campo: 'config_contareceberavulsa', label: 'Contas a receber avulsas', grupo: 'Financeiro', sub: 'Contas a pagar' },
  { campo: 'config_contareceberavulsasemcc', label: 'Contas a receber avulsas sem centro de custo', grupo: 'Financeiro', sub: 'Contas a pagar' },
  { campo: 'config_descontos_recebidos', label: 'Descontos recebidos', grupo: 'Financeiro', sub: 'Contas a pagar' },
  { campo: 'config_juros_pagos', label: 'Juros pagos', grupo: 'Financeiro', sub: 'Contas a pagar' },
  { campo: 'config_descontos_apg', label: 'Descontos', grupo: 'Financeiro', sub: 'Contas a pagar' },
  { campo: 'config_embutidos_apg', label: 'Embutidos', grupo: 'Financeiro', sub: 'Contas a pagar' },
  // ── Financeiro · Contas a receber
  { campo: 'config_baixa_rcb', label: 'Baixa de contas a receber', grupo: 'Financeiro', sub: 'Contas a receber' },
  { campo: 'config_juros_recebidos', label: 'Juros recebidos', grupo: 'Financeiro', sub: 'Contas a receber' },
  { campo: 'config_acrescimos_recebidos', label: 'Acréscimos recebidos', grupo: 'Financeiro', sub: 'Contas a receber' },
  { campo: 'config_descontos_concedidos', label: 'Descontos concedidos', grupo: 'Financeiro', sub: 'Contas a receber' },
  { campo: 'config_areceber_conv_func', label: 'Convênio de funcionários no lançamento de contas a pagar', grupo: 'Financeiro', sub: 'Contas a receber' },
  { campo: 'config_agrupamento_convenio', label: 'Agrupamento de convênio', grupo: 'Financeiro', sub: 'Contas a receber' },
  // ── Financeiro · Cheques
  { campo: 'config_baixa_cheque', label: 'Baixa de cheques', grupo: 'Financeiro', sub: 'Cheques' },
  { campo: 'config_acresc_receb_chq', label: 'Acréscimos recebidos', grupo: 'Financeiro', sub: 'Cheques' },
  { campo: 'config_desc_conc_chq', label: 'Descontos concedidos', grupo: 'Financeiro', sub: 'Cheques' },
  // ── Financeiro · Cartões
  { campo: 'config_baixa_cartao', label: 'Baixa de cartões', grupo: 'Financeiro', sub: 'Cartões' },
  { campo: 'config_outras_desp_cartao', label: 'Outras despesas pagas', grupo: 'Financeiro', sub: 'Cartões' },
  { campo: 'config_taxa_cartao', label: 'Taxas de cartões pagas', grupo: 'Financeiro', sub: 'Cartões' },
  // ── Movimentações bancárias
  { campo: 'config_transferencia_bancaria', label: 'Transferências bancárias', grupo: 'Movimentações bancárias' },
  // ── Fiscal · ICMS
  { campo: 'config_icms_entradas_nf', label: 'Entrada de nota fiscal', grupo: 'Fiscal', sub: 'ICMS' },
  { campo: 'config_icms_saidas_nf', label: 'Saída de nota fiscal', grupo: 'Fiscal', sub: 'ICMS' },
  { campo: 'config_icms_saidas_reducaoz', label: 'Redução Z', grupo: 'Fiscal', sub: 'ICMS' },
  { campo: 'config_icms_nfce', label: 'NFC-e', grupo: 'Fiscal', sub: 'ICMS' },
  // ── Fiscal · PIS
  { campo: 'config_pis_saidas_nf', label: 'Saída de nota fiscal', grupo: 'Fiscal', sub: 'PIS' },
  { campo: 'config_pis_entradas_nf', label: 'Entrada de nota fiscal', grupo: 'Fiscal', sub: 'PIS' },
  { campo: 'config_pis_saidas_reducaoz', label: 'Redução Z', grupo: 'Fiscal', sub: 'PIS' },
  { campo: 'config_pis_nfce', label: 'NFC-e', grupo: 'Fiscal', sub: 'PIS' },
  // ── Fiscal · COFINS
  { campo: 'config_cofins_saidas_nf', label: 'Saída de nota fiscal', grupo: 'Fiscal', sub: 'COFINS' },
  { campo: 'config_cofins_entradas_nf', label: 'Entrada de nota fiscal', grupo: 'Fiscal', sub: 'COFINS' },
  { campo: 'config_cofins_saidas_reducaoz', label: 'Redução Z', grupo: 'Fiscal', sub: 'COFINS' },
  { campo: 'config_cofins_nfce', label: 'NFC-e', grupo: 'Fiscal', sub: 'COFINS' },
  // ── Fiscal · Retenções
  { campo: 'config_retencao_pis_nf', label: 'Retenção de PIS', grupo: 'Fiscal', sub: 'Retenções' },
  { campo: 'config_retencao_cofins_nf', label: 'Retenção COFINS', grupo: 'Fiscal', sub: 'Retenções' },
  { campo: 'config_retencao_csll_nf', label: 'Retenção CSLL', grupo: 'Fiscal', sub: 'Retenções' },
  { campo: 'config_retencao_inss_nf', label: 'Retenção INSS', grupo: 'Fiscal', sub: 'Retenções' },
  { campo: 'config_retencao_ir_nf', label: 'Retenção IR', grupo: 'Fiscal', sub: 'Retenções' },
  { campo: 'config_retencao_funrural_nf', label: 'Retenção FUNRURAL', grupo: 'Fiscal', sub: 'Retenções' },
  { campo: 'config_retencao_issqn_nf', label: 'Retenção ISSQN', grupo: 'Fiscal', sub: 'Retenções' },
  { campo: 'config_retencao_icmsst', label: 'Retenção ICMS ST', grupo: 'Fiscal', sub: 'Retenções' },
  { campo: 'config_retencao_senar_nf', label: 'Retenção SENAR', grupo: 'Fiscal', sub: 'Retenções' },
  // ── Fiscal · Outros
  { campo: 'config_acordo_comer_desc_nf', label: 'Acordo comercial (desconto em nota fiscal)', grupo: 'Fiscal', sub: 'Outros' },
  { campo: 'config_dif_pedcompra_nf', label: 'A receber de diferença de pedido de compra NF', grupo: 'Fiscal', sub: 'Outros' },
];

const situacao = z.coerce.number().int().positive().nullable().optional();

export const configIntegracaoContabilSchema = z.object({
  ...Object.fromEntries(CAMPOS_CONFIG_IC.map((c) => [c.campo, situacao])),
  /**
   * ⚠️ o gate de período da integração — e ele **não é** o fechamento diário nem `periodo_contabil`. A
   * comparação do legado é `<=`: a data final digitada tem de ser POSTERIOR ao chaveamento. No cliente está
   * NULO, e por isso hoje não bloqueia nada.
   */
  chaveamento_periodo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
} as Record<string, z.ZodTypeAny>);

export type ConfigIntegracaoContabilDto = Record<string, number | string | null | undefined>;
