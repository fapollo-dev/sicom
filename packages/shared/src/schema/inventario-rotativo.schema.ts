import { z } from 'zod';

/**
 * INVENTÁRIO ROTATIVO (`FRMRELINVENTARIOROTATIVO` / `uRelatorioInventarioRotativo` + `UFrmLoteInventarioRotativo`)
 * — corte-1: o LOTE e seu ciclo. Dossiê: `uRelatorioInventarioRotativo.md`.
 *
 * Abrir lote (`BtnGravarClick`, UFrmLoteInventarioRotativo.pas:156-247): `NOMELOTE` é **obrigatório**
 * ("Informe o nome do lote."), a linha nasce com `OPERACAO='ABERTO'`, número de lote de sequência própria e os
 * filtros opcionais. No fonte os filtros passam por `StrToIntDef(...,0)`, mas no golden eles são **NULL** (nunca
 * 0) — então vazio grava NULL.
 */
export const criarLoteRotativoSchema = z.object({
  nomelote: z.string().trim().min(1, 'Informe o nome do lote.').max(100),
  tipo: z.enum(['R', 'G']).optional(), // R = rotativo (default do golden nos abertos), G = geral
  codgrupo: z.coerce.number().int().positive().optional(),
  codsubgrupo: z.coerce.number().int().positive().optional(),
  codsecao: z.coerce.number().int().positive().optional(),
  codforn: z.coerce.number().int().positive().optional(),
  exigeconfirmacao: z.enum(['S', 'N']).optional(),
  almoxarifado_padrao: z.string().trim().max(50).optional(),
  produtoinativo: z.enum(['S', 'N']).optional(),
  busca_inativo: z.string().trim().max(10).optional(),
  /** vários departamentos por lote (`INVENTARIO_ROTATIVO_DPTO`). */
  departamentos: z.array(z.coerce.number().int().positive()).max(500).optional(),
});
export type CriarLoteRotativoDto = z.infer<typeof criarLoteRotativoSchema>;

/** alterar o lote: o legado só regrava o CABEÇALHO (`TDB.Alterar`) — a lista de departamentos NÃO é recriada. */
export const alterarLoteRotativoSchema = criarLoteRotativoSchema.partial().extend({
  nomelote: z.string().trim().min(1, 'Informe o nome do lote.').max(100).optional(),
});
export type AlterarLoteRotativoDto = z.infer<typeof alterarLoteRotativoSchema>;

/**
 * FECHAR (`btnFecharInventarioClick`, uRelatorioInventarioRotativo.pas:227-339) — dois caminhos:
 *  - **sem lote** (o `MemInvLOTE = 0` do legado): cria um número novo, grava a linha 'FECHADO' e **carimba as
 *    coletas órfãs** da empresa (`UPDATE … WHERE LOTE IS NULL`);
 *  - **com lote**: grava 'FECHADO' copiando `NOMELOTE` e os filtros do registro 'ABERTO' e replica os
 *    departamentos.
 */
export const fecharLoteRotativoSchema = z.object({
  lote: z.coerce.number().int().positive().optional(),
});
export type FecharLoteRotativoDto = z.infer<typeof fecharLoteRotativoSchema>;

export interface LoteRotativoResumo {
  lote: number | null;
  nomelote: string | null;
  tipo: string | null;
  idempresa: number;
  aberto: boolean;
  abertura: string | null;
  fechamento: string | null;
  coletas: number;
  codinv_rotativo_aberto: number | null;
  codnf_perdas: number | null;
  codnf_sobras: number | null;
}
