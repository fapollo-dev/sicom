import { z } from 'zod';

/**
 * MOTIVOS_OPERACAO — lookup do motivo de operações (no legado é compartilhado com cancelamento/quebra;
 * aqui o consumidor inicial é o AJUSTE DE ESTOQUE). SOFT-DELETE (INDR), como marcas/operadores.
 */
export const motivoOperacaoSchema = z.object({
  descricao: z.string().trim().min(1, 'Informe a descrição do motivo.').max(60, 'Descrição muito longa (máx. 60).'),
  tipo_operacao: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.string().trim().max(20).optional()),
});
export type CriarMotivoOperacaoDto = z.infer<typeof motivoOperacaoSchema>;
export const atualizarMotivoOperacaoSchema = motivoOperacaoSchema.partial();
export type AtualizarMotivoOperacaoDto = z.infer<typeof atualizarMotivoOperacaoSchema>;

export interface MotivoOperacao extends CriarMotivoOperacaoDto {
  codmotivoop: number;
  indr?: string | null; // 'E' = excluído (soft-delete)
}
