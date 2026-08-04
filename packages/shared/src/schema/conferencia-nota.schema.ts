import { z } from 'zod';

/**
 * CONFERÊNCIA DE NOTA FISCAL (FRMCONFERENCIANOTA) — corte-1: aprovar / cancelar os itens conferidos.
 * A aprovação exige LIBERAÇÃO: login+senha de um autorizador da config USUARIOS_APROVAM_CONFERENCIA_NOTA
 * (fiel a `UsuarioLiberadoParaAprovacao`), e é o código DELE que fica em `codoperador_aprova_coleta`.
 */
export const conferenciaAprovarSchema = z.object({
  codnf: z.coerce.number().int().positive(),
  /** codnfprod dos itens marcados na grade (o `SELECIONAR` do legado). */
  itens: z.array(z.coerce.number().int().positive()).min(1, 'Selecione ao menos um item.').max(5000),
  login: z.string().trim().min(1, 'Informe o usuário autorizador.').max(50),
  senha: z.string().min(1, 'Informe a senha do autorizador.').max(200),
  computador: z.string().trim().max(60).optional(),
});
export type ConferenciaAprovarDto = z.infer<typeof conferenciaAprovarSchema>;

export const conferenciaCancelarSchema = z.object({
  codnf: z.coerce.number().int().positive(),
  itens: z.array(z.coerce.number().int().positive()).min(1, 'Selecione ao menos um item.').max(5000),
});
export type ConferenciaCancelarDto = z.infer<typeof conferenciaCancelarSchema>;
