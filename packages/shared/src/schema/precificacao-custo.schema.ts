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
});
export type SalvarPrecificacaoDto = z.infer<typeof salvarPrecificacaoSchema>;
