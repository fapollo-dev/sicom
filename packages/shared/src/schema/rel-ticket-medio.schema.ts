import { z } from 'zod';

/**
 * VALOR DO TICKET MÉDIO (FRMVALORTICKETMEDIO). Uma linha por dia: cupons, total vendido e a média por cupom.
 * O legado tem TRÊS modos de hora (btnProcessarClick): sem filtro (dia inteiro) · faixa CONTÍNUA dtini+hi →
 * dtfim+hf (`CbFiltroHora`) · faixa POR DIA (`cbHoraPorDia` — checkbox separado). Os três são expostos aqui, e
 * isso confirma o que a rel-vendas já indicava: a janela contínua é o comportamento default do legado.
 */
export const relTicketMedioSchema = z.object({
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inicial inválida (AAAA-MM-DD).'),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data final inválida (AAAA-MM-DD).'),
  filtrarHora: z.boolean().optional(),
  /** com filtrarHora: false = janela CONTÍNUA (default do legado); true = a faixa em CADA dia. */
  horaPorDia: z.boolean().optional(),
  horaIni: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inicial inválida (HH:MM).').optional(),
  horaFim: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora final inválida (HH:MM).').optional(),
  empresas: z.array(z.coerce.number().int().positive()).max(50).optional(),
});
export type RelTicketMedioDto = z.infer<typeof relTicketMedioSchema>;
