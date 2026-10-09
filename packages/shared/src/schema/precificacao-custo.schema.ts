import { z } from 'zod';

/**
 * PRECIFICAÇÃO DE MERCADORIAS (FRMPRIFICACAOCUSTO) — painel por produto × empresa: componentes de custo
 * (percentuais e valores) → 3 bases de custo → PMZ/preço sugerido → escada de margem. `calcular` é puro;
 * `salvar` grava por empresa selecionada (+ grupo de preço) e, em modo lote, enfileira e reverte o vrvenda.
 */
const dec = (min = 0) => z.coerce.number().min(min).optional();

export const componentesCustoSchema = z.object({
  vrcusto: z.coerce.number().min(0, 'Custo não pode ser negativo.'),
  // PERCENTUAIS (do vrcusto)
  icme: dec(), ipi: dec(), frete: dec(), frete2: dec(), seguro: dec(),
  // VALORES
  icmst: dec(), vrfcpst: dec(), despacessorio: dec(), vrcustoajuste: z.coerce.number().optional(), bonificacao: dec(),
  // o "FCP Saida" da tela (MULTI_PRECO.FCP_SAIDA, editável — entra no PMZ e no débito de ICMS)
  fcp_saida: dec(),
});

export const calcularPrecificacaoSchema = componentesCustoSchema.extend({
  idproduto: z.coerce.number().int().positive(),
  idempresa: z.coerce.number().int().positive().optional(),
  markup: dec(),
  vrvenda: dec(),
});
export type CalcularPrecificacaoDto = z.infer<typeof calcularPrecificacaoSchema>;

export const salvarPrecificacaoSchema = componentesCustoSchema.extend({
  idproduto: z.coerce.number().int().positive(),
  empresas: z.array(z.coerce.number().int().positive()).min(1, 'Selecione ao menos uma empresa.').max(200),
  markup: dec(),
  vrvenda: z.coerce.number().min(0),
  modoLote: z.boolean().optional(),
  /** a " Opcao de atualização" (rgopcao): 'individual' (o padrão do legado — só a empresa da linha) ou 'sincronizar' (as marcadas) */
  opcao: z.enum(['individual', 'sincronizar']).optional(),
  /** a empresa da linha da grade, a que a tela edita (dtsEmpresa); ausente = a da sessão */
  empresaEditada: z.coerce.number().int().positive().optional(),
  // os campos da linha de preço que a tela edita além dos componentes (todos de MULTI_PRECO)
  markupfixo: dec(),
  ativo: z.enum(['S', 'N']).optional(),
  ativo_compra: z.enum(['S', 'N']).optional(),
  promocao: z.enum(['S', 'N']).optional(),
  vrpromo: dec(),
  atacarejo_ativo: z.enum(['S', 'N']).optional(),
  margem_comissao: z.coerce.number().optional(),
  comissao: z.coerce.number().min(0).max(100, 'A comissão não pode passar de 100%.').optional(),
  usa_flex: z.enum(['S', 'N']).optional(),
  prod_exibe_forca_vendas: z.enum(['S', 'N']).optional(),
});
export type SalvarPrecificacaoDto = z.infer<typeof salvarPrecificacaoSchema>;
