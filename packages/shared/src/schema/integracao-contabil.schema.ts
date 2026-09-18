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

/**
 * Booleano vindo de QUERYSTRING.
 *
 * ⚠️ **`boolQuery` não serve aqui**: ele faz `Boolean(valor)`, e em querystring tudo chega como
 * string — então `?x=false` vira **`true`**, porque `"false"` é uma string não vazia. O filtro faz o
 * contrário do que o usuário marcou, sem erro nenhum. Foi o que aconteceu no "só os que venderam" do relatório
 * de dias de estoque, e a falha só apareceu porque o smoke cobria o caso desmarcado.
 *
 * Aqui `'false'`, `'0'`, `'n'`, `'não'` e vazio são **falso**; o resto segue a conversão normal.
 */
const boolQuery = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const t = v.trim().toLowerCase();
  if (t === '' || t === 'false' || t === '0' || t === 'n' || t === 'nao' || t === 'não') return false;
  if (t === 'true' || t === '1' || t === 's' || t === 'sim' || t === 'y') return true;
  return v;
}, z.boolean());

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
    somenteSingle: boolQuery.optional(),
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
  incluirTransferencias: boolQuery.optional(),
  incluirBonificacao: boolQuery.optional(),
  somenteMargemNegativa: boolQuery.optional(),
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

/**
 * RELATÓRIOS DE COMPRAS (`FRMRELCOMPRAS`) — os três do combo, com a árvore de categorias inteira como filtro.
 * `cfops` é lista porque o legado aceita vários (`fListaCFOP`), e é o CFOP do ITEM, não o da nota.
 */
export const relComprasSchema = z.object({
  tipo: z.enum(['CATEGORIA', 'CATEGORIA_ANALITICO', 'COMPRAS_VENDAS']),
  dataIni: dataISO,
  dataFim: dataISO,
  campoData: z.enum(['CONTABIL', 'EMISSAO', 'CHEGADA']).nullish(),
  /** só o relatório 3 usa; nos outros dois o legado desabilita o rádio (`CmbTipoRelatorioChange:203`). */
  considerar: z.enum(['COMPRAS', 'VENDAS', 'AMBOS']).nullish(),
  coddpto: z.coerce.number().int().positive().nullish(),
  codgrupo: z.coerce.number().int().positive().nullish(),
  codsubgrupo: z.coerce.number().int().positive().nullish(),
  codsecao: z.coerce.number().int().positive().nullish(),
  idproduto: z.coerce.number().int().positive().nullish(),
  codparceiro: z.coerce.number().int().positive().nullish(),
  cfops: z.union([z.array(z.string().max(4)), z.string()])
    .transform((v) => (typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : v))
    .pipe(z.array(z.string().max(4)).max(50)).nullish(),
  empresas: z.union([z.array(z.coerce.number().int().positive()), z.string()])
    .transform((v) => (typeof v === 'string' ? v.split(',').map((x) => Number(x.trim())).filter(Boolean) : v))
    .pipe(z.array(z.number().int().positive()).max(50)).nullish(),
});
export type RelComprasDto = z.infer<typeof relComprasSchema>;

/** PROMOÇÃO ACUMULATIVA (`FRMCADPROMOCAOACUMULATIVA`) — o filtro da lista. */
export const promocaoAcumulativaFiltroSchema = z.object({
  descricao: z.string().max(150).nullish(),
  /**
   * As três opções do diálogo de pesquisa (`ChamaTelaOpcoes:254`). ⚠️ "aberta" no legado é `DTFIM >= hoje`
   * — inclui a que ainda nem começou —, e não "vigente agora".
   */
  situacao: z.enum(['ABERTAS', 'FECHADAS', 'TODAS']).nullish(),
});
export type PromocaoAcumulativaFiltroDto = z.infer<typeof promocaoAcumulativaFiltroSchema>;

/**
 * O cadastro. `dtini`/`dtfim` são data **e hora** — o legado valida com a hora junto
 * (`ValidaDataHora:445`) e uma promoção pode começar às 17:35 e acabar às 02:00, como há em produção.
 * `empresas` é a lista de lojas; o serviço a normaliza para o `;1;2;` que o legado grava.
 */
export const promocaoAcumulativaSchema = z.object({
  idproacumulativa: z.coerce.number().int().positive().nullish(),
  idproduto: z.coerce.number().int().positive(),
  qtde: z.coerce.number().positive('A quantidade deve ser informada.'),
  desconto: z.coerce.number().positive('O desconto deve ser informado.'),
  // 'YYYY-MM-DDTHH:mm' ou 'YYYY-MM-DD HH:mm[:ss]' — nunca z.coerce.date (lição 17)
  dtini: z.string().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/, 'Informe data e hora de início.'),
  dtfim: z.string().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/, 'Informe data e hora de término.'),
  empresas: z.array(z.coerce.number().int().positive()).min(1, 'Deve ser informada a empresa da promoção.').max(9),
  atacarejo: z.enum(['S', 'N']).nullish(),
  /** o `chkGrupoPreco`: aplica a promoção ao grupo de preço do produto, não só a ele. */
  usarGrupoPreco: boolQuery.optional(),
});
export type PromocaoAcumulativaDto = z.infer<typeof promocaoAcumulativaSchema>;

/**
 * CONFERÊNCIA NF × INDEXADOR (`FRMCONFERENCIANFINDEXADOR`). As duas caixas de nota são de INCLUSÃO:
 * desmarcadas, escondem as processadas e as canceladas.
 */
export const conferenciaNfIndexadorSchema = z.object({
  dataIni: dataISO,
  dataFim: dataISO,
  tipo: z.enum(['E', 'S']).nullish(),
  nronf: z.string().max(20).nullish(),
  codparceiro: z.coerce.number().int().positive().nullish(),
  /** o legado aceita descrição OU código de barras no mesmo campo ("Código ou Cód. Barra"). */
  produto: z.string().max(150).nullish(),
  incluirProcessadas: boolQuery.optional(),
  incluirCanceladas: boolQuery.optional(),
  somenteDivergentes: boolQuery.optional(),
});
export type ConferenciaNfIndexadorDto = z.infer<typeof conferenciaNfIndexadorSchema>;

/** RELATÓRIOS DE PRODUTOS (`FRMPRODUTOSREL`), corte-1: os três do núcleo de estoque. */
export const produtosRelSchema = z.object({
  tipo: z.enum(['ESTOQUE_ATUAL', 'RUPTURA', 'ANALISE', 'ALTERACOES_PRECO']),
  /** o `cmbFiltro`: as quinze comparações entre a quantidade e o mínimo/máximo, na ordem do combo. */
  filtroEstoque: z.enum([
    'TODOS',
    'MENOR_IGUAL_MINIMO', 'MENOR_MINIMO', 'MAIOR_IGUAL_MINIMO', 'MAIOR_MINIMO', 'IGUAL_MINIMO',
    'MENOR_IGUAL_MAXIMO', 'MENOR_MAXIMO', 'MAIOR_IGUAL_MAXIMO', 'MAIOR_MAXIMO', 'IGUAL_MAXIMO',
    'NEGATIVA', 'ZERADA', 'MAIOR_ZERO', 'NEGATIVA_OU_ZERADA',
  ]).nullish(),
  ativo: z.enum(['S', 'N']).nullish(),
  coddpto: z.coerce.number().int().positive().nullish(),
  codgrupo: z.coerce.number().int().positive().nullish(),
  codsubgrupo: z.coerce.number().int().positive().nullish(),
  codsecao: z.coerce.number().int().positive().nullish(),
  codfor: z.coerce.number().int().positive().nullish(),
  produto: z.string().max(150).nullish(),
  diasSemVenda: z.coerce.number().int().min(0).max(3650).nullish(),
  /** só ALTERACOES_PRECO usa: a janela do histórico. */
  dataIni: dataISO.nullish(),
  dataFim: dataISO.nullish(),
});
export type ProdutosRelDto = z.infer<typeof produtosRelSchema>;

/** ENTRADAS E SAÍDAS (`FRMRELENTRADASSAIDAS`): a listagem e o comparativo por produto. */
export const relEntradasSaidasSchema = z.object({
  tipo: z.enum(['LISTAGEM', 'COMPARATIVO']),
  dataIni: dataISO,
  dataFim: dataISO,
  coddpto: z.coerce.number().int().positive().nullish(),
  codgrupo: z.coerce.number().int().positive().nullish(),
  codsubgrupo: z.coerce.number().int().positive().nullish(),
  codfor: z.coerce.number().int().positive().nullish(),
  produto: z.string().max(150).nullish(),
});
export type RelEntradasSaidasDto = z.infer<typeof relEntradasSaidasSchema>;

/**
 * PREENCHER COTAÇÃO (`FRMCADCOTACAOFORN`) — a porta aceita dois tipos de gente: operador da empresa (login)
 * ou o próprio fornecedor (código do parceiro). É a única tela em que quem opera pode ser de fora.
 */
export const cotacaoFornLoginSchema = z.object({
  comoParceiro: boolQuery,
  login: z.string().max(60).nullish(),
  codparceiro: z.coerce.number().int().positive().nullish(),
  senha: z.string().min(1, 'Informe a senha.').max(200),
}).refine((v) => (v.comoParceiro ? v.codparceiro != null : !!v.login), {
  message: 'Informe o login do operador ou o código do fornecedor.',
});
export type CotacaoFornLoginDto = z.infer<typeof cotacaoFornLoginSchema>;

/** os preços que o fornecedor informou. `porEmpresa` decide de quem é a mão registrada. */
export const cotacaoFornPreencherSchema = z.object({
  codctcforn: z.coerce.number().int().positive(),
  porEmpresa: boolQuery,
  codoperador: z.coerce.number().int().positive().nullish(),
  itens: z.array(z.object({
    codctcfit: z.coerce.number().int().positive(),
    valor: z.coerce.number().min(0, 'O valor não pode ser negativo.'),
    icms: z.coerce.number().min(0).max(100).nullish(),
    fatorembalagem: z.coerce.number().min(0).nullish(),
    valorembal: z.coerce.number().min(0).nullish(),
  })).min(1, 'Informe ao menos um item.').max(5000),
  obs: z.string().max(500).nullish(),
  datavalidade: dataISO.nullish(),
});
export type CotacaoFornPreencherDto = z.infer<typeof cotacaoFornPreencherSchema>;

export const cotacaoFornCriarSchema = z.object({
  codctc: z.coerce.number().int().positive(),
  codparceiro: z.coerce.number().int().positive(),
  datavalidade: dataISO.nullish(),
  obs: z.string().max(500).nullish(),
});
export type CotacaoFornCriarDto = z.infer<typeof cotacaoFornCriarSchema>;

/** o botão Etiquetas da Precificação de NF: enfileira os produtos marcados. */
export const etiquetasPrecificacaoNfSchema = z.object({
  idprodutos: z.array(z.coerce.number().int().positive()).min(1, 'Selecione ao menos um item.').max(3000),
});
export type EtiquetasPrecificacaoNfDto = z.infer<typeof etiquetasPrecificacaoNfSchema>;

/** LAYOUT DA GRADE por operador — o [F8] do legado, para qualquer tela. */
export const gradeLayoutSalvarSchema = z.object({
  /** o `persistId` da tela, estável entre versões (ex.: 'precificacao-nf'). */
  tela: z.string().min(1).max(80),
  /** 'default' é o layout corrente; outros ids são visões nomeadas. */
  id: z.string().min(1).max(80),
  name: z.string().max(120).nullish(),
  isPublic: boolQuery.optional(),
  state: z.unknown(),
});
export type GradeLayoutSalvarDto = z.infer<typeof gradeLayoutSalvarSchema>;

/** DIAS DE ESTOQUE / COBERTURA (`FRMRELDDE`): com o que tenho, quantos dias eu aguento. */
export const relDdeSchema = z.object({
  /** a janela de venda que dá a média diária. */
  dias: z.coerce.number().int().min(1).max(365),
  /** o filtro de ruptura: só o que cobre até N dias. */
  coberturaAte: z.coerce.number().int().min(0).max(9999).nullish(),
  /** falso = traz também o que não vendeu no período. */
  somenteVendidos: boolQuery.optional(),
  coddpto: z.coerce.number().int().positive().nullish(),
  codgrupo: z.coerce.number().int().positive().nullish(),
  codsubgrupo: z.coerce.number().int().positive().nullish(),
  codsecao: z.coerce.number().int().positive().nullish(),
  produto: z.string().max(150).nullish(),
});
export type RelDdeDto = z.infer<typeof relDdeSchema>;

/** INTERSECÇÃO DE PRODUTOS (`FRMRELINTERSECCAOPRODUTOS`): o que mais o cliente leva junto. */
export const relInterseccaoSchema = z.object({
  idproduto: z.coerce.number().int().positive(),
  dataIni: dataISO,
  dataFim: dataISO,
  /** o rádio do legado: ordenar por quantidade vendida ou por número de cupons. */
  ordenarPor: z.enum(['QTDE', 'CUPOM']).nullish(),
  /** o "Qtde itens analisados" da tela. */
  limite: z.coerce.number().int().min(1).max(5000).nullish(),
});
export type RelInterseccaoDto = z.infer<typeof relInterseccaoSchema>;

/** DIGITAÇÃO DE PEDIDOS (`FRMDIGITACAOPEDIDOS`) — o pedido de VENDA. */
export const pedidoVendaFiltroSchema = z.object({
  dataIni: dataISO,
  dataFim: dataISO,
  nropedido: z.string().max(20).nullish(),
  codparceiro: z.coerce.number().int().positive().nullish(),
  incluirCancelados: boolQuery.optional(),
});
export type PedidoVendaFiltroDto = z.infer<typeof pedidoVendaFiltroSchema>;

/** FLUXO DE CARTÕES (`FRMFLUXOCARTOES`): quanto já caiu e quanto ainda vai cair. */
export const fluxoCartoesSchema = z.object({
  dataIni: dataISO,
  dataFim: dataISO,
  codoperadora: z.coerce.number().int().positive().nullish(),
});
export type FluxoCartoesDto = z.infer<typeof fluxoCartoesSchema>;

/** FATURAMENTO POR MÊS (`FRMRELFATURAMENTO`). */
export const relFaturamentoSchema = z.object({ dataIni: dataISO, dataFim: dataISO });
export type RelFaturamentoDto = z.infer<typeof relFaturamentoSchema>;

/** ANÁLISE DE COMPRA × VENDA (`FRMRELENTSAI`): por produto, o que entrou e o que saiu. */
export const relEntSaiSchema = z.object({
  dataIni: dataISO,
  dataFim: dataISO,
  coddpto: z.coerce.number().int().positive().nullish(),
  codgrupo: z.coerce.number().int().positive().nullish(),
  codsubgrupo: z.coerce.number().int().positive().nullish(),
  idproduto: z.coerce.number().int().positive().nullish(),
  codfor: z.coerce.number().int().positive().nullish(),
  /** o `chkAgruparProdutos`: junta as empresas numa linha só por produto. */
  agruparProdutos: boolQuery.optional(),
});
export type RelEntSaiDto = z.infer<typeof relEntSaiSchema>;

/** DESCONTO DE TÍTULOS (`FRMDESCONTOTITULO`) — encontro de contas entre a receber e a pagar. */
export const descontoTituloSchema = z.object({
  dataIni: dataISO.nullish(),
  dataFim: dataISO.nullish(),
  codparceiro: z.coerce.number().int().positive().nullish(),
});
export type DescontoTituloDto = z.infer<typeof descontoTituloSchema>;

/**
 * ENCONTRO DE CONTAS — **executar** (corte-2). O operador escolhe um título a receber e um a pagar do
 * mesmo parceiro e informa o VALOR REAL de cada (quanto quer usar de cada um). O menor dos dois valores
 * reais é abatido nos dois títulos; o que sobrar de cada um vira título novo.
 */
export const descontoTituloExecutarSchema = z.object({
  codrcb: z.coerce.number().int().positive(),
  codapg: z.coerce.number().int().positive(),
  /** quanto usar do título a receber (default: o valor inteiro dele). */
  valorRealRcb: z.coerce.number().positive().optional(),
  /** quanto usar do título a pagar (default: o valor inteiro dele). */
  valorRealApg: z.coerce.number().positive().optional(),
  /** conta corrente que recebe o crédito (a receber) e o débito (a pagar) — o par soma zero. */
  codconta: z.coerce.number().int().positive().optional(),
  obs: z.string().trim().max(200).optional(),
});
export type DescontoTituloExecutarDto = z.infer<typeof descontoTituloExecutarSchema>;


/** CONSULTA A RECEBER POR CLIENTE (`FRMCONSCLIRCB`): quanto o cliente deve, com juro e atraso. */
export const consCliRcbSchema = z.object({
  codparceiro: z.coerce.number().int().positive(),
  somenteAbertos: boolQuery.optional(),
  /** dias de carência antes de o juro começar a contar. */
  tolerancia: z.coerce.number().int().min(0).max(365).nullish(),
});
export type ConsCliRcbDto = z.infer<typeof consCliRcbSchema>;

/** ANÁLISE DE ENTRADA × SAÍDA (`FRMANALISEENTRADAXSAIDA`): por fornecedor, com a saída de venda ou pedido. */
export const analiseEntradaSaidaSchema = z.object({
  dataIni: dataISO,
  dataFim: dataISO,
  /** o `rgPedVen`: a saída vem das vendas ou dos pedidos. */
  origemSaida: z.enum(['VENDAS', 'PEDIDOS']).nullish(),
  fornecedor: z.string().max(120).nullish(),
  grupo: z.string().max(120).nullish(),
  departamento: z.string().max(120).nullish(),
});
export type AnaliseEntradaSaidaDto = z.infer<typeof analiseEntradaSaidaSchema>;
