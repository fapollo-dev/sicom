import { sql, type Kysely } from 'kysely';
import { BusinessRuleError } from '../../shared/errors/app-error';

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
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

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
      }).execute();
    }
    return { codlote, linhas: linhasD.length };
  }

  // históricos distintos (ou contagens distintas) ⇒ cada perna sai sozinha, débito primeiro.
  for (const regD of linhasD) {
    await trx.insertInto('diario').values({
      ...linha(regD), contadebito: resolverConta(d, regD, l.situacao), contacredito: null, codhist: d.codhistorico,
    }).execute();
  }
  for (const regC of linhasC) {
    await trx.insertInto('diario').values({
      ...linha(regC), contadebito: null, contacredito: resolverConta(c, regC, l.situacao), codhist: c.codhistorico,
    }).execute();
  }
  return { codlote, linhas: linhasD.length + linhasC.length };
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
