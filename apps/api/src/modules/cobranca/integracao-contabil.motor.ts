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

/** um registro do dataset que alimenta a perna AUTOMÁTICA (o `DataSetC`/`DataSetD` do legado). */
export interface RegistroDataSet {
  /** conta contábil que a perna 'A' assume (o `CODPLANOCONTAS` do dataset). */
  codplanocontas: number | null;
  valor: number;
  /** o que entra na mensagem de erro quando a conta não veio ("a conta 12", "o centro de custo X"). */
  descricao?: string;
}

export interface LancamentoContabil {
  emp: number;
  /** `CODORIGEM` do razão (51 baixa de cartão, 61 taxa, 62 outras despesas…). */
  codorigem: number;
  /** `CODOPERACAO` = a SITUAÇÃO, a chave da `itens_integracao_contabil`. */
  situacao: number;
  data: string;
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
 * O comportamento abaixo foi reconstruído do RAZÃO REAL do cliente — 1,34 milhão de linhas das origens 51/61/62
 * confrontadas com a `ITENS_INTEGRACAO_CONTABIL` — do mesmo jeito que a F5b reconstruiu o caminho da nota.
 *
 * Duas regras, e as duas saem do dado:
 *
 * 1. **FORMATO** — quando as duas pernas da IIC têm o MESMO `CODHISTORICO`, o lançamento é UMA linha
 *    balanceada (débito e crédito na mesma linha). Quando têm histórico DIFERENTE, são DUAS linhas, cada uma
 *    com um lado só e o seu próprio histórico. Medido: situação 894 (hist 96/96) → 110.053 linhas balanceadas
 *    e zero single; 895 (96/96) → 1.200.524 balanceadas e zero single; 893 (94/95) → 15.700 só-débito +
 *    15.700 só-crédito e zero balanceadas. O mesmo vale nas baixas de AR/AP do cliente (2009 hist 92/93 e
 *    2004 hist 91/221, ambas 100% single-legged) e no agrupamento de convênio (910, hist 104/105).
 *
 * 2. **CONTA** — perna `TIPO='F'` usa a conta fixa da IIC; perna `TIPO='A'` pega a conta do DATASET daquela
 *    natureza. É o "substitui pelo dataset". Prova: na situação 895 a perna de crédito é 'A' e o
 *    `CONTACREDITO` do razão bate com o `CONTAS_BANCARIAS.CODLANCCONTABIL` da forma de pagamento em
 *    **1.200.523 de 1.200.523** linhas (três contas distintas: 213, 557 e 211 — nenhuma delas fixa).
 *
 * O `LOTE_CONTABIL` é lado nosso: no cliente a tabela está VAZIA e o `DIARIO.CODLOTE` é só um número de
 * sequência por lançamento. Mantemos o cabeçalho porque as contabilizações já migradas (NF, caixa, baixa)
 * gravam-no e a nossa `diario.codlote` tem chave estrangeira para ele.
 */
export async function lancarNoDiario(trx: AnyDB, l: LancamentoContabil): Promise<number> {
  const pernas = (await trx
    .selectFrom('itens_integracao_contabil')
    .select(['natureza', 'tipo', 'codconta_contabil', 'codhistorico'])
    .where('codoperacao', '=', l.situacao)
    .execute()) as PernaIIC[];
  const d = pernas.find((p) => p.natureza === 'D');
  const c = pernas.find((p) => p.natureza === 'C');
  // espelha o `rSemContasCadastradas` / `rQtdeContasIncorretas` do legado.
  if (!d || !c) throw new BusinessRuleError('CONTAS_NAO_INFORMADAS', { situacao: l.situacao });

  const contaD = resolverConta(d, l.dataSetD, l.situacao);
  const contaC = resolverConta(c, l.dataSetC, l.situacao);
  const valor = r2(Math.abs(l.valor));

  const lote = await trx
    .insertInto('lote_contabil')
    .values({ desclote: l.desclote, datalote: sql`${l.data}::date`, codorigem: l.codorigem, codempresa: l.emp })
    .returning('codlotecontabil')
    .executeTakeFirstOrThrow();
  const codlote = Number((lote as { codlotecontabil: number | string }).codlotecontabil);

  const base = {
    datalan: sql`${l.data}::date`,
    valor,
    codorigem: l.codorigem,
    idorigem: l.idorigem,
    codoperacao: l.situacao,
    codempresa: l.emp,
    documento: l.documento,
    complemento: l.complemento,
    codlote,
  };

  if (d.codhistorico === c.codhistorico) {
    await trx.insertInto('diario').values({ ...base, contadebito: contaD, contacredito: contaC, codhist: d.codhistorico }).execute();
    return codlote;
  }
  // históricos distintos ⇒ duas linhas de um lado só, na ordem em que o legado as grava (débito primeiro).
  await trx.insertInto('diario').values({ ...base, contadebito: contaD, contacredito: null, codhist: d.codhistorico }).execute();
  await trx.insertInto('diario').values({ ...base, contadebito: null, contacredito: contaC, codhist: c.codhistorico }).execute();
  return codlote;
}

/** perna FIXA → conta da IIC; perna AUTOMÁTICA → conta do dataset (`rContaAnaliticaNaoInformada` se faltar). */
function resolverConta(p: PernaIIC, dataset: RegistroDataSet[], situacao: number): number {
  if (p.tipo === 'F') {
    if (p.codconta_contabil == null) throw new BusinessRuleError('CONTAS_NAO_INFORMADAS', { situacao });
    return Number(p.codconta_contabil);
  }
  const reg = dataset[0];
  if (!reg || reg.codplanocontas == null) {
    throw new BusinessRuleError('CONTA_ANALITICA_NAO_INFORMADA', { situacao, onde: reg?.descricao ?? null });
  }
  return Number(reg.codplanocontas);
}
