import { sql, type Kysely } from 'kysely';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { argsDoHistorico, type CtxHistorico } from './historico-contabil.args';

type AnyDB = Kysely<any>;

/** uma "perna" do lançamento: de onde sai a conta contábil e qual o histórico. */
export interface PernaIIC {
  natureza: 'D' | 'C';
  tipo: 'F' | 'A';
  codconta_contabil: number | null;
  codhistorico: number | null;
}

/**
 * um registro do dataset que alimenta a perna AUTOMÁTICA (o `DataSetC`/`DataSetD` do legado). A substituição é
 * COLUNA A COLUNA: o que o dataset traz vence o parâmetro; o que ele não traz fica com o parâmetro.
 */
export interface RegistroDataSet {
  /** conta contábil que a perna 'A' assume (o `CODPLANOCONTAS` do dataset). */
  codplanocontas: number | null;
  valor: number;
  idorigem?: number;
  documento?: string;
  complemento?: string;
  /** entra na mensagem de erro quando a conta não veio ("o parceiro 12", "a conta 3"). */
  descricao?: string;
  /**
   * o que ESTE registro tem a dizer no texto do razão — mesclado por cima do contexto do lançamento, do mesmo
   * jeito que as outras colunas do dataset vencem o parâmetro (regra 3).
   *
   * ⚠️ **o texto do razão varia LINHA A LINHA**, e isso custou uma volta: das 1.723 baixas de A PAGAR com mais
   * de uma linha de histórico 91, **nenhuma** tem um texto só — cada linha traz o seu título, o seu tipo de
   * documento e o seu parceiro. No agrupamento de convênio (histórico 105) é igual: 30 lotes, zero com texto
   * único. Já no cadastro de contas a pagar (103) as 197 são constantes, porque ali as várias linhas são o
   * rateio de UM título.
   */
  ctxHist?: CtxHistorico;
}

export interface LancamentoContabil {
  emp: number;
  /** `CODORIGEM` do razão (51 baixa de cartão, 15 baixa AP, 16 baixa AR…). */
  codorigem: number;
  /** `CODOPERACAO` = a SITUAÇÃO, a chave da `itens_integracao_contabil`. */
  situacao: number;
  data: string;
  /** os valores-padrão do lançamento: valem onde o dataset não tiver a coluna. */
  valor: number;
  idorigem: number;
  documento: string;
  complemento: string;
  /** dataset da perna de CRÉDITO (o `DataSetC`) e da perna de DÉBITO (o `DataSetD`). */
  dataSetC: RegistroDataSet[];
  dataSetD: RegistroDataSet[];
  desclote: string;
  /**
   * tudo o que o texto do razão pode querer imprimir (documento, lote, parceiro, histórico da movimentação…).
   * Um contexto só serve as DUAS pernas: cada histórico escolhe dele o que precisa e na ordem que precisa —
   * é assim que a baixa de A PAGAR escreve `PAGTO LOTE .: … PARCEIRO .: …` no débito (histórico 91) e o
   * histórico da movimentação bancária no crédito (221), da mesma chamada.
   */
  ctxHist?: CtxHistorico;
}

/** um `*` do template: número (vira `000130582`), texto (vai cru) ou nada (vira vazio). */
export type ArgHist = string | number | null | undefined;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * preenche os `*` do template do histórico contábil — o que `FuncoesApollo` fazia e não veio no fonte.
 *
 * ⚠️ **número vira 9 dígitos com zeros à esquerda** (`FormatFloat('000000000')`). Medido no razão do cliente:
 * `A RECEBER DOCTO .: 000130582` para documento `130582` em **5.895/5.895** linhas da origem 14, e
 * `AGRUPAMENTO CONVENIO .: 000117847` em **15.089/15.089** da origem 65. Texto vai cru — é por isso que o
 * lote sai `RECEBTO LOTE .: 90790` e não `000090790`: quem contabiliza o passa como texto.
 *
 * `*` sem argumento imprime vazio, como no legado (o razão tem `NOTA FISCAL COMPRA .: 000000000 CNPJ  FORNECEDOR `
 * na origem 64) — e argumento a mais é ignorado, porque o template é quem manda.
 *
 * ⚠️ **quebra de linha vira espaço**: o `DESCHIST` é de uma linha só. Provado duas vezes — o histórico da
 * movimentação `'TRANSF. CONTA DESTINO: 4914-7\r\n Lote: 89642\r\nRealizada…'` sai no razão como
 * `'… 4914-7  Lote: 89642 Realizada…'`, e a observação `' REFERENTE A NOTA FISCAL 6412933 EMITIDA EM 31/07/2026\r\n'`
 * sai terminada em espaço.
 */
export function montarDeschist(template: string | null | undefined, args: ArgHist[] = []): string | null {
  if (template == null) return null;
  let i = 0;
  return template.replace(/\*/g, () => {
    const a = args[i];
    i += 1;
    if (a == null || a === '') return '';
    if (typeof a === 'number') return Number.isFinite(a) ? String(Math.trunc(Math.abs(a))).padStart(9, '0') : '';
    return a.replace(/\r\n?|\n/g, ' ');
  });
}

/**
 * MOTOR DA INTEGRAÇÃO CONTÁBIL — o `LancaDiarioContabil(..., SubstituiPeloDataSet := True)` do legado.
 *
 * ⚠️ **procedência**: a rotina em si mora num pacote que NÃO veio no fonte clonado (`FuncoesApollo`, ausente).
 * O comportamento abaixo foi reconstruído do RAZÃO REAL do cliente — 1,43 milhão de linhas das origens
 * 51/61/62 (cartões) e 15/16 (baixas de AP e AR) confrontadas com a `ITENS_INTEGRACAO_CONTABIL` — do mesmo
 * jeito que a F5b reconstruiu o caminho da nota.
 *
 * Três regras, e as três saem do dado:
 *
 * 1. **QUANTAS LINHAS cada perna gera** — perna `TIPO='F'` (conta fixa) gera UMA linha; perna `TIPO='A'` gera
 *    UMA POR REGISTRO do seu dataset. É isso que explica a assimetria da baixa de contas a pagar: as duas
 *    pernas da 2004 são automáticas, e o razão tem **42.178 linhas só-débito** (uma por baixa do lote) contra
 *    **5.417 só-crédito** (uma por movimentação bancária). Na baixa de cartão as duas pernas são fixas e por
 *    isso sai exatamente uma de cada.
 *
 * 2. **O FORMATO** — as duas pernas casam numa linha balanceada quando têm o MESMO `CODHISTORICO` **e**
 *    nenhum dos datasets tem mais de um registro; caso contrário saem separadas, cada uma com um lado só e o
 *    seu histórico. Medido: 894 (hist 96/96) → 110.053 balanceadas e zero single; 895 (96/96) → 1.200.524 e
 *    zero; 893 (**94/95**) → 15.700 só-débito + 15.700 só-crédito e ZERO balanceadas; 2009 (92/93) e 2004
 *    (91/221), 100% single. E a prova de que o dataset importa mesmo com histórico igual está na situação
 *    **464** (as duas pernas FIXAS, hist 103/103) no cadastro de contas a pagar: os 27 títulos com UMA linha
 *    de rateio saíram balanceados e os 121 com DUAS saíram como um só-débito mais um só-crédito.
 *
 * 3. **A SUBSTITUIÇÃO é coluna a coluna** — o registro do dataset manda na conta (`CODPLANOCONTAS`), no valor,
 *    no `IDORIGEM`, no `DOCUMENTO` e no `COMPLEMENTO`; onde o dataset não tem a coluna, vale o parâmetro.
 *    Prova: nas baixas de AP a perna de crédito sai da movimentação e tem `IDORIGEM` = `CODMOVCONTA`
 *    (5.411/5.411), `DOCUMENTO` = `CODMOVCONTA` (100%) e conta = `CODLANCCONTABIL` do banco (**100%**) — mas
 *    `COMPLEMENTO` = o IDLOTE do parâmetro (5.411/5.411), porque a consulta da movimentação não traz essa
 *    coluna. Na perna de débito, que sai da baixa, o `COMPLEMENTO` é o `CODAPG` do dataset (42.104/42.175).
 *
 * O `LOTE_CONTABIL` é lado nosso: no cliente a tabela está VAZIA e o `DIARIO.CODLOTE` é só um número de
 * sequência — um por LANÇAMENTO, compartilhado por todas as linhas dele (no razão há lotes com 105 linhas:
 * 104 débitos e 1 crédito). Mantemos o cabeçalho porque as contabilizações já migradas gravam-no e a nossa
 * `diario.codlote` tem chave estrangeira para ele.
 */
export async function lancarNoDiario(trx: AnyDB, l: LancamentoContabil): Promise<{ codlote: number; linhas: number }> {
  const pernas = (await trx
    .selectFrom('itens_integracao_contabil')
    .select(['natureza', 'tipo', 'codconta_contabil', 'codhistorico'])
    .where('codoperacao', '=', l.situacao)
    .execute()) as PernaIIC[];
  const d = pernas.find((p) => p.natureza === 'D');
  const c = pernas.find((p) => p.natureza === 'C');
  // espelha o `rSemContasCadastradas` / `rQtdeContasIncorretas` do legado.
  if (!d || !c) throw new BusinessRuleError('CONTAS_NAO_INFORMADAS', { situacao: l.situacao });

  // regra 1: a perna fixa é uma linha só; a automática, uma por registro do dataset.
  const linhasD = d.tipo === 'A' ? l.dataSetD : [null];
  const linhasC = c.tipo === 'A' ? l.dataSetC : [null];
  if (!linhasD.length || !linhasC.length) throw new BusinessRuleError('DATASET_VAZIO', { situacao: l.situacao });

  const lote = await trx
    .insertInto('lote_contabil')
    .values({ desclote: l.desclote, datalote: sql`${l.data}::date`, codorigem: l.codorigem, codempresa: l.emp })
    .returning('codlotecontabil')
    .executeTakeFirstOrThrow();
  const codlote = Number((lote as { codlotecontabil: number | string }).codlotecontabil);

  // o texto do razão: cada perna traz o seu template e os seus argumentos. Sem o cadastro carregado o
  // `deschist` sai nulo — é o comportamento de hoje, e nenhuma contabilização deixa de acontecer por isso.
  const templates = await carregarTemplates(trx, [d.codhistorico, c.codhistorico]);
  /** o texto de uma linha: o contexto do registro vence o do lançamento, coluna a coluna. */
  const desc = (hist: number | null, ...regs: Array<RegistroDataSet | null>) => {
    const ctx = regs.reduce<CtxHistorico>((acc, r) => (r?.ctxHist ? { ...acc, ...r.ctxHist } : acc), { ...l.ctxHist });
    return montarDeschist(templates.get(Number(hist)), argsDoHistorico(hist, ctx));
  };

  const linha = (reg: RegistroDataSet | null) => ({
    datalan: sql`${l.data}::date`,
    valor: r2(Math.abs(reg?.valor ?? l.valor)),
    codorigem: l.codorigem,
    idorigem: reg?.idorigem ?? l.idorigem,
    codoperacao: l.situacao,
    codempresa: l.emp,
    documento: reg?.documento ?? l.documento,
    complemento: reg?.complemento ?? l.complemento,
    codlote,
  });

  // regra 2: as duas pernas casam numa linha só quando têm o mesmo histórico E não há ambiguidade de quem
  // casa com quem — ou seja, quando nenhum dos dois datasets tem mais de um registro. Basta um deles ter dois
  // e o lançamento se parte, mesmo que a perna seja FIXA e continue rendendo uma linha só.
  const semAmbiguidade = l.dataSetD.length <= 1 && l.dataSetC.length <= 1;
  if (d.codhistorico === c.codhistorico && semAmbiguidade) {
    for (let i = 0; i < linhasD.length; i += 1) {
      const regD = linhasD[i];
      const regC = linhasC[i];
      await trx.insertInto('diario').values({
        ...linha(regD ?? regC),
        contadebito: resolverConta(d, regD, l.situacao),
        contacredito: resolverConta(c, regC, l.situacao),
        codhist: d.codhistorico,
        // um histórico só ⇒ um texto só, com o contexto das duas pernas (o débito por cima).
        deschist: desc(d.codhistorico, regC, regD),
      }).execute();
    }
    return { codlote, linhas: linhasD.length };
  }

  // históricos distintos (ou contagens distintas) ⇒ cada perna sai sozinha, débito primeiro.
  for (const regD of linhasD) {
    await trx.insertInto('diario').values({
      ...linha(regD), contadebito: resolverConta(d, regD, l.situacao), contacredito: null,
      codhist: d.codhistorico, deschist: desc(d.codhistorico, regD),
    }).execute();
  }
  for (const regC of linhasC) {
    await trx.insertInto('diario').values({
      ...linha(regC), contadebito: null, contacredito: resolverConta(c, regC, l.situacao),
      codhist: c.codhistorico, deschist: desc(c.codhistorico, regC),
    }).execute();
  }
  return { codlote, linhas: linhasD.length + linhasC.length };
}

/**
 * os templates dos históricos das duas pernas. A tabela é cadastro (54 linhas no cliente) e pode não estar
 * carregada; nesse caso o razão sai sem texto, como saía antes desta mudança — contabilizar não pode parar
 * por falta de um rótulo.
 */
async function carregarTemplates(trx: AnyDB, codigos: Array<number | null>): Promise<Map<number, string>> {
  const ids = [...new Set(codigos.filter((x): x is number => x != null).map(Number))];
  if (!ids.length) return new Map();
  const rows = (await trx
    .selectFrom('historico_contabil')
    .select(['codhistcontabil', 'deschist'])
    .where('codhistcontabil', 'in', ids)
    .execute()) as Array<{ codhistcontabil: number; deschist: string | null }>;
  return new Map(rows.filter((r) => r.deschist != null).map((r) => [Number(r.codhistcontabil), r.deschist as string]));
}

/** perna FIXA → conta da IIC; perna AUTOMÁTICA → conta do registro (`rContaAnaliticaNaoInformada` se faltar). */
function resolverConta(p: PernaIIC, reg: RegistroDataSet | null, situacao: number): number {
  if (p.tipo === 'F') {
    if (p.codconta_contabil == null) throw new BusinessRuleError('CONTAS_NAO_INFORMADAS', { situacao });
    return Number(p.codconta_contabil);
  }
  if (!reg || reg.codplanocontas == null) {
    throw new BusinessRuleError('CONTA_ANALITICA_NAO_INFORMADA', { situacao, onde: reg?.descricao ?? null });
  }
  return Number(reg.codplanocontas);
}
