import { z } from 'zod';

/**
 * SIMULADOR DE VENDAS (`FRMSIMULADORVENDA`, `uSimuladorVenda.pas`).
 *
 * Pega o que foi vendido num período, produto a produto, e deixa o operador mexer na grade (venda, custo, quantidade, desconto,
 * acréscimo) para ver o que teria acontecido com o lucro. O `sqqVendas` só tem o período: o campo "Descrição" da tela não filtra —
 * posiciona a grade (`Locate`).
 */
export const simuladorVendaSchema = z.object({
  dataIni: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine((f) => f.dataFim >= f.dataIni, { message: 'o fim não pode ser antes do início', path: ['dataFim'] });

export type SimuladorVendaDto = z.infer<typeof simuladorVendaSchema>;

const numSim = z.coerce.number().finite().nullish();
/** o Imprimir: o `cdsVendas` como a grade está (os valores simulados e a ordem da coluna clicada) */
export const simuladorVendaImpressaoSchema = z.object({
  linhas: z.array(z.object({
    codproduto: numSim, descricao: z.string().max(200).nullish(), codbarra: z.string().max(60).nullish(),
    vrvenda: numSim, vrcusto: numSim, qtde: numSim, desconto: numSim, acrescimo: numSim,
    total_custo: numSim, total_venda: numSim, sub_total_venda: numSim, lucro_total: numSim,
  })).min(1, 'Não foram encontradas vendas no período informado.').max(100000),
});
export type SimuladorVendaImpressaoDto = z.infer<typeof simuladorVendaImpressaoSchema>;

/**
 * ⚠️ o "Lucro %" do legado é **markup sobre o custo**, não margem sobre a venda:
 * `((venda / custo) - 1) × 100` (`CalculaLucro`, `:156`). Numa venda de 150 sobre custo 100 ele mostra
 * **50%**, não os 33,3% que a margem daria. Mantido como está — trocar mudaria todo número que o operador
 * conhece.
 */
export const lucroPercentual = (venda: number, custo: number) =>
  custo > 0 ? Math.round(((venda / custo - 1) * 100 + Number.EPSILON) * 100) / 100 : 0;
