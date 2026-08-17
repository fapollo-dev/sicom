import { z } from 'zod';

/**
 * PRÉVIA DO FORNECEDOR / ANÁLISE DE GIRO (FRMRELLISTAPRECOSFORNECEDOR) — corte-1: periodização "15 Dias"
 * (default do .dfm, rdgPeriodo.ItemIndex=3) × visualização "Vendas"/"Entradas e Saídas" (rdgVisualizar.ItemIndex=0).
 * Os filtros do legado são TODOS de valor ÚNICO (`AND P.CODDPTO = x`, não IN) — mantido fiel.
 */
export const previaFornecedorSchema = z.object({
  /**
   * âncora do período. O legado faz `FDataAnalise := DateOf(Now())` — HOJE, sem escolha, nos 7 modos relativos;
   * só o 8º modo ("Habilita Período") deixa escolher. Aqui é opcional com default HOJE (fiel), e parametrizável
   * porque (a) é a mesma generalização que o legado já tem no 8º modo e (b) sem isso o relatório é intestável:
   * o golden tem movimento até 2024 e todo modo relativo a hoje volta vazio.
   */
  dataAnalise: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de análise inválida (AAAA-MM-DD).').optional(),
  /**
   * rdgPeriodo — as 7 periodizações de slots do legado. Default '15D' (ItemIndex=3 no .dfm). A 8ª opção do
   * legado ("Habilita Período") é outra geração de cálculo (`MontaSqlPorPeriodo`) e segue adiada.
   */
  periodizacao: z.enum(['15D', '5D', '30D', '5S', '5M', '5A', 'ANUAL']).optional(),
  visualizar: z.enum(['VENDAS', 'ENTRADAS_SAIDAS']).optional(), // rdgVisualizar (tvPedidos = corte-3)
  empresas: z.array(z.coerce.number().int().positive()).max(50).optional(),
  codfor: z.coerce.number().int().positive().optional(),        // PA.CODPARCEIRO
  idproduto: z.coerce.number().int().positive().optional(),     // P.IDPRODUTO
  departamento: z.coerce.number().int().optional(),             // P.CODDPTO
  grupo: z.coerce.number().int().optional(),                    // P.CODGRUPO
  subgrupo: z.coerce.number().int().optional(),                 // P.CODSUBGRUPO
  secao: z.coerce.number().int().optional(),                    // P.CODSECAO
  marca: z.coerce.number().int().optional(),                    // MA.IDMARCA
  /**
   * filtro ATIVO/ATIVO_COMPRA de multi_preco — os 6 modos de GetFiltroIdxAtivo (1..6). Ausente = sem filtro
   * (no legado isso corresponde a FAtivo=false, que NÃO faz o INNER JOIN em MULTI_PRECO).
   */
  ativo: z.coerce.number().int().min(1).max(6).optional(),
  /** só produtos com algum movimento no período (a tela legada lista tudo; isto é conveniência de UI). */
  somenteComGiro: z.boolean().optional(),
});
export type PreviaFornecedorDto = z.infer<typeof previaFornecedorSchema>;

/**
 * 8ª opção do `rdgPeriodo` — "Habilita Período" (`tpPorPeriodo`). É a OUTRA geração do cálculo
 * (`udmRelListaPrecosFornecedor.MontaSqlPorPeriodo` + a SQL `qryPeriodoDias` guardada no .dfm do data module):
 * em vez da matriz de slots, **uma faixa livre** = unidade × quantidade, com UMA coluna de totais por produto.
 * Diferença semântica importante e fiel: ali o join com PRODUTOS/ESTOQUE está DENTRO do agregado, então este
 * modo mostra **só o que teve movimento** (na matriz de slots o produto sem giro aparece com zero).
 */
export const previaPeriodoSchema = previaFornecedorSchema
  .omit({ periodizacao: true, somenteComGiro: true })
  .extend({
    unidade: z.enum(['DIAS', 'SEMANAS', 'MESES', 'ANOS']).optional(), // cbPeriodo (default 'Dias' no .dfm)
    quantidade: z.coerce.number().int().min(1).max(120).optional(),   // edtQtdPeriodo
    /**
     * rdgModelo (Sintético/Analítico). O ANALÍTICO abre a faixa por MÊS ou ANO (fdMesesAnalitico: a mesma união
     * com `extract(month|year …)` no SELECT e no GROUP BY) — uma linha por (produto, mês/ano). Só vale com
     * unidade MESES/ANOS: em Dias/Semanas o legado FORÇA Sintético (cbPeriodoChange desabilita e zera o rádio),
     * e aqui o service faz o mesmo downgrade silencioso (o `filtro.modelo` da resposta diz o efetivo).
     */
    modelo: z.enum(['SINTETICO', 'ANALITICO']).optional(),
  });
export type PreviaPeriodoDto = z.infer<typeof previaPeriodoSchema>;
