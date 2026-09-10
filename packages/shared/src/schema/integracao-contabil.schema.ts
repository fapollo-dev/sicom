import { z } from 'zod';

/**
 * INTEGRAÇÃO CONTÁBIL (`FRMTRON`) — corte-1: baixa de cartões.
 *
 * A tela do legado tem um período (data inicial/final) e um radio com as origens; a baixa de cartões é a
 * opção 5 (`uTron.pas:2107`) e vai sempre por PERÍODO — o caminho "por lote" existe na classe
 * (`ParametrosIntegracao.Codigo > 0`) mas a tela nunca o usa. Expomos os dois: o período é o fluxo da tela,
 * o lote serve para reprocessar um lote isolado sem varrer o intervalo.
 *
 * Datas como 'YYYY-MM-DD' (lição 17: `z.coerce.date` vira meia-noite UTC e grava um dia a menos).
 */
const dataISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato AAAA-MM-DD.');

export const integracaoCartaoSchema = z
  .object({
    dataIni: dataISO,
    dataFim: dataISO,
    idlote: z.coerce.number().int().positive().nullish(),
  })
  .refine((v) => v.dataFim >= v.dataIni, { message: 'A data final não pode ser anterior à inicial.', path: ['dataFim'] });
export type IntegracaoCartaoDto = z.infer<typeof integracaoCartaoSchema>;

/**
 * corte-3 — os lançamentos por DOCUMENTO. Mesmo período da tela; `codigo` é o documento isolado (a conta a
 * pagar, o recebível, o lote da transferência ou do caixa, o grupo do convênio), o `ParametrosIntegracao.Codigo`
 * do legado. O que ele significa muda com o tipo — está documentado em cada método do serviço.
 */
export const integracaoDocumentoSchema = z
  .object({
    dataIni: dataISO,
    dataFim: dataISO,
    codigo: z.coerce.number().int().positive().nullish(),
  })
  .refine((v) => v.dataFim >= v.dataIni, { message: 'A data final não pode ser anterior à inicial.', path: ['dataFim'] });
export type IntegracaoDocumentoDto = z.infer<typeof integracaoDocumentoSchema>;

/**
 * CONSTRUTOR DE RELATÓRIOS (`FRMRELATORIO`) — a definição, campo a campo como no XML do legado.
 * O que o cliente monta: fonte, colunas (simples ou calculadas) com título/largura/ordem/total, condições e
 * ordenação. Os NOMES de campo são conferidos no servidor contra a fonte real — aqui só se valida a forma.
 */
const campoSql = z.string().min(1).max(63).regex(/^[a-z_][a-z0-9_]*$/i, 'Nome de campo inválido.');

export const colunaRelatorioSchema = z.object({
  campo: campoSql.optional(),
  calculado: z.object({
    campo1: campoSql,
    operacao: z.enum(['+', '-', '*', '/']),
    campo2: campoSql,
  }).optional(),
  titulo: z.string().max(80).optional(),
  largura: z.coerce.number().int().min(1).max(200).optional(),
  posicao: z.coerce.number().int().min(0).max(999).optional(),
  totalizar: z.boolean().optional(),
  formato: z.enum(['texto', 'moeda', 'data', 'numero']).optional(),
}).refine((c) => !!c.campo !== !!c.calculado, { message: 'Informe um campo OU uma coluna calculada.' });

export const condicaoRelatorioSchema = z.object({
  campo: campoSql,
  operador: z.enum(['=', '<>', '>', '>=', '<', '<=', 'contem', 'comeca', 'entre', 'vazio', 'preenchido']),
  valor: z.unknown().optional(),
});

export const definicaoRelatorioSchema = z.object({
  titulo: z.string().max(120).optional(),
  paisagem: z.boolean().optional(),
  agruparPor: campoSql.optional(),
  somenteAgrupamento: z.boolean().optional(),
  quebraPagina: z.boolean().optional(),
  colunas: z.array(colunaRelatorioSchema).min(1, 'Escolha ao menos uma coluna.').max(60),
  condicoes: z.array(condicaoRelatorioSchema).max(20).optional(),
  ordem: z.array(z.object({ campo: campoSql, direcao: z.enum(['asc', 'desc']).optional() })).max(6).optional(),
});
export type DefinicaoRelatorioDto = z.infer<typeof definicaoRelatorioSchema>;

export const salvarRelatorioSchema = z.object({
  codrelatoriodef: z.coerce.number().int().positive().nullish(),
  nome: z.string().min(1, 'Informe o nome do relatório.').max(120),
  fonte: campoSql,
  definicao: definicaoRelatorioSchema,
});
export type SalvarRelatorioDto = z.infer<typeof salvarRelatorioSchema>;

export const executarRelatorioSchema = z.object({
  codrelatoriodef: z.coerce.number().int().positive().nullish(),
  fonte: campoSql.optional(),
  definicao: definicaoRelatorioSchema.optional(),
  filtros: z.array(condicaoRelatorioSchema).max(20).optional(),
  limite: z.coerce.number().int().min(1).max(20000).optional(),
}).refine((v) => !!v.codrelatoriodef || (!!v.fonte && !!v.definicao), {
  message: 'Informe o relatório salvo ou a fonte e a definição.',
});
export type ExecutarRelatorioDto = z.infer<typeof executarRelatorioSchema>;

/**
 * ANÁLISE DE NOTAS FISCAIS (`FRMNFANALISE`) — os filtros da tela, para os dois modelos do corte-1.
 */
export const analiseNfSchema = z
  .object({
    modelo: z.enum(['TRIBUTARIA', 'CONFERENCIA']),
    dataIni: dataISO,
    dataFim: dataISO,
    tipo: z.enum(['T', 'E', 'S']).optional(),
    nronf: z.string().max(20).nullish(),
    codparceiro: z.coerce.number().int().positive().nullish(),
    razao: z.string().max(80).nullish(),
    cfop: z.coerce.number().int().positive().nullish(),
    processadas: z.enum(['S', 'N', 'T']).optional(),
    incluirDevolucao: z.boolean().optional(),
    somenteDiferencas: z.boolean().optional(),
  })
  .refine((v) => v.dataFim >= v.dataIni, { message: 'A data final não pode ser anterior à inicial.', path: ['dataFim'] });
export type AnaliseNfDto = z.infer<typeof analiseNfSchema>;

/** SALDO DA EMPRESA (`FRMSALDOEMPRESA`) — o período do fluxo projetado e o filtro opcional de parceiro. */
export const saldoEmpresaSchema = z
  .object({
    dataIni: dataISO,
    dataFim: dataISO,
    codparceiro: z.coerce.number().int().positive().nullish(),
  })
  .refine((v) => v.dataFim >= v.dataIni, { message: 'A data final não pode ser anterior à inicial.', path: ['dataFim'] });
export type SaldoEmpresaDto = z.infer<typeof saldoEmpresaSchema>;

/** RELATÓRIOS DE CAIXA (`FRMRELCAIXA`) — os dois modelos do corte-1 e os filtros da tela. */
export const relCaixaSchema = z
  .object({
    modelo: z.enum(['DIVERGENCIAS', 'ABERTOS']),
    dataIni: dataISO,
    dataFim: dataISO,
    codoperador: z.coerce.number().int().positive().nullish(),
    recurso: z.string().max(30).nullish(),
  })
  .refine((v) => v.dataFim >= v.dataIni, { message: 'A data final não pode ser anterior à inicial.', path: ['dataFim'] });
export type RelCaixaDto = z.infer<typeof relCaixaSchema>;

/** CONSULTORIA APOLLO (`FRMCONSULTORIAATM`) — participação e rentabilidade por nível da árvore de famílias. */
export const consultoriaSchema = z
  .object({
    nivel: z.enum(['DEPARTAMENTO', 'GRUPO', 'SECAO']),
    dataIni: dataISO,
    dataFim: dataISO,
  })
  .refine((v) => v.dataFim >= v.dataIni, { message: 'A data final não pode ser anterior à inicial.', path: ['dataFim'] });
export type ConsultoriaDto = z.infer<typeof consultoriaSchema>;

/** TOTAL POR CARTÃO (`FRMRELCARTOES`) — período por data da venda e filtro por operadora. */
export const relCartoesSchema = z
  .object({
    dataIni: dataISO,
    dataFim: dataISO,
    codoperadora: z.coerce.number().int().positive().nullish(),
  })
  .refine((v) => v.dataFim >= v.dataIni, { message: 'A data final não pode ser anterior à inicial.', path: ['dataFim'] });
export type RelCartoesDto = z.infer<typeof relCartoesSchema>;

/** LANÇAMENTOS CONTÁBEIS (`FRMRELLANCAMENTOSCONTABEIS`) — os filtros do razão por lançamento. */
export const lancamentosContabeisSchema = z
  .object({
    dataIni: dataISO,
    dataFim: dataISO,
    codorigem: z.coerce.number().int().nonnegative().nullish(),
    conta: z.coerce.number().int().positive().nullish(),
    codoperacao: z.coerce.number().int().positive().nullish(),
    documento: z.string().max(60).nullish(),
    somenteSingle: z.coerce.boolean().optional(),
  })
  .refine((v) => v.dataFim >= v.dataIni, { message: 'A data final não pode ser anterior à inicial.', path: ['dataFim'] });
export type LancamentosContabeisDto = z.infer<typeof lancamentosContabeisSchema>;

/** RENTABILIDADE POR CATEGORIAS (`FRMRENTABILIDADECATEGORIAS`) — nível, período e a despesa operacional. */
export const rentabilidadeSchema = z
  .object({
    nivel: z.enum(['DEPARTAMENTO', 'GRUPO', 'SUBGRUPO']),
    dataIni: dataISO,
    dataFim: dataISO,
    /** o percentual que o usuário digita; em branco, o serviço usa o da empresa. */
    despesaOperacional: z.coerce.number().min(0).max(100).nullish(),
  })
  .refine((v) => v.dataFim >= v.dataIni, { message: 'A data final não pode ser anterior à inicial.', path: ['dataFim'] });
export type RentabilidadeDto = z.infer<typeof rentabilidadeSchema>;

/** PRECIFICAÇÃO DE NF (`FRMPRECIFICACAONF`) — os filtros da listagem dos itens a precificar. */
export const precificacaoNfFiltroSchema = z.object({
  codnf: z.coerce.number().int().positive().nullish(),
  nronf: z.string().max(20).nullish(),
  descricao: z.string().max(80).nullish(),
  fornecedor: z.string().max(80).nullish(),
  grupo: z.string().max(80).nullish(),
  dataIni: dataISO.nullish(),
  dataFim: dataISO.nullish(),
  incluirTransferencias: z.coerce.boolean().optional(),
  incluirBonificacao: z.coerce.boolean().optional(),
  somenteMargemNegativa: z.coerce.boolean().optional(),
  /** o `rgPreco` do legado: qual custo dirige a margem. Em branco, o que a empresa tiver configurado. */
  tipoCusto: z.enum(['CSI', 'BRUTO', 'REPOSICAO']).nullish(),
});
export type PrecificacaoNfFiltroDto = z.infer<typeof precificacaoNfFiltroSchema>;

/**
 * APLICAR os preços — enfileira um lote por item e por empresa. Não muda o preço: quem muda é o
 * processamento do lote.
 */
export const aplicarPrecificacaoNfSchema = z.object({
  itens: z.array(z.object({
    idproduto: z.coerce.number().int().positive(),
    vrvenda: z.coerce.number().positive('O preço de venda tem de ser maior que zero.'),
    // ⚠️ PERCENTUAL sobre o custo (`CalcularMargem`), não a razão que a coluna MARKUP mostra ao abrir.
    // Aceita negativo: o legado grava markup negativo quando o preço fica abaixo do custo (mínimo visto em
    // produção: −98,93 em MULTI_PRECO.MARKUP), e recusar aqui inventaria uma trava que o legado não tem.
    markup: z.coerce.number().nullish(),
    nronf: z.string().max(20).nullish(),
  })).min(1, 'Selecione ao menos um item.').max(3000),
  empresas: z.array(z.coerce.number().int().positive()).max(50).nullish(),
  obs: z.string().max(120).nullish(),
  datalote: dataISO.nullish(),
});
export type AplicarPrecificacaoNfDto = z.infer<typeof aplicarPrecificacaoNfSchema>;
