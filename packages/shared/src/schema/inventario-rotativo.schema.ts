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

/**
 * ZERAR ESTOQUE pela grade do rotativo (`BtnZerarEstoqueClick`, uInvRotativoGrid.pas:146-292 + `ZeraEstoque`
 * :381-446). Gate duplo: **quais estoques** (loja e/ou depósito — "Informe quais estoques serão zerados.") e a
 * **liberação por login** contra a lista da config `USUARIOS_ZERAM_ESTOQUE_INVENTARIO` (id 46; no golden a lista
 * está vazia ⇒ ninguém pode, e é assim que respondemos). Para cada produto × bucket marcado o legado faz três
 * coisas: zera `ESTOQUE`/`ESTOQUE_DEP`, insere a coleta em `INVENTARIO_ROTATIVO` (`OPERACAO='SUBSTITUIR'`,
 * `DESTINO='LOJA'|'DEPOSITO'`, `QTD_ANTERIOR` = saldo, `QTD_ATUAL` = 0, `QTD_COLETADA` = 0) e grava o rastro em
 * `AJUSTE_ESTOQUE` (`OPERACAO` = 'AUMENTAR' se o saldo era negativo, senão 'DIMINUIR'; `QTDE` = |saldo|;
 * `CODMOTIVO` = 999; `ORIGEM='I'`; `IDORIGEM` = a coleta).
 */
export const zerarEstoqueRotativoSchema = z
  .object({
    idprodutos: z.array(z.coerce.number().int().positive()).min(1).max(5000),
    /** os dois checks da tela; pelo menos um é obrigatório. */
    loja: z.boolean().optional(),
    deposito: z.boolean().optional(),
    /** lote a carimbar na coleta (o legado grava NULL quando é 0). */
    lote: z.coerce.number().int().positive().optional(),
    /** liberação por login: quem autoriza precisa estar na lista da config 46. */
    login: z.string().trim().min(1),
    senha: z.string().min(1),
  })
  .refine((v) => v.loja === true || v.deposito === true, {
    message: 'Informe quais estoques serão zerados.',
    path: ['loja'],
  });
export type ZerarEstoqueRotativoDto = z.infer<typeof zerarEstoqueRotativoSchema>;

/**
 * CORTE-3 — as duas pontes de NF. O lado é `PERDAS` (diferença negativa, nota de SAÍDA, CFOP 5927/6927) ou
 * `SOBRAS` (diferença positiva, nota de ENTRADA, CFOP 1949/2949), fiel a `uNF.pas:12804-12807` e `:12958-12961`.
 * `uf_destino` é a UF do titular já carregado na nota — o legado compara com a UF da empresa para decidir entre
 * o CFOP interno e o interestadual.
 */
export const itensNfRotativoSchema = z.object({
  lotes: z.array(z.coerce.number().int().positive()).min(1).max(200),
  tipo: z.enum(['PERDAS', 'SOBRAS']),
  uf_destino: z.string().trim().length(2).toUpperCase().optional(),
});
export type ItensNfRotativoDto = z.infer<typeof itensNfRotativoSchema>;

/**
 * VINCULAR a NF gravada aos lotes — o carimbo `IMPORTADO_x='S'`/`CODNF_x` que o legado dispara no gravar
 * (`uNF.pas:5267` perdas · `:5280` sobras), sempre na linha `OPERACAO='FECHADO'` do lote.
 */
export const vincularNfRotativoSchema = z.object({
  codnf: z.coerce.number().int().positive(),
  lotes: z.array(z.coerce.number().int().positive()).min(1).max(200),
  tipo: z.enum(['PERDAS', 'SOBRAS']),
});
export type VincularNfRotativoDto = z.infer<typeof vincularNfRotativoSchema>;
