import { sql, type RawBuilder } from 'kysely';
import { BusinessRuleError } from '../errors/app-error';

/** os operadores do `TPesquisaRelatorio` do legado (GetTipoPesquisa) + os que o construtor somou (>=, <=, vazio, preenchido) */
export const OPERADORES_PESQUISA: Record<string, string> = {
  '=': '=', '<>': '<>', '>': '>', '>=': '>=', '<': '<', '<=': '<=',
  'contem': 'LIKE', 'comeca': 'LIKE', 'termina': 'LIKE', 'em': 'IN', 'entre': 'BETWEEN', 'vazio': 'IS NULL', 'preenchido': 'IS NOT NULL',
};

export interface CondicaoPesquisa { campo: string; operador: string; valor?: unknown }

/**
 * Uma condição vira SQL com o VALOR sempre parametrizado, com a semântica do legado (`GetParametroWhere` + `ProcessaSQL`,
 * uComunPesquisaRel.pas:228):
 *  · LIKE sensível a maiúsculas (o `UpperCase` do legado é só do nome do campo); em "Em Qualquer Lugar" o `+` do valor vira
 *    `' %'` — um curinga de palavra ("COCA+2L" acha "COCA COLA 2L");
 *  · "Contido em": a lista separada por vírgula;
 *  · valor VAZIO: em texto, "Igual a" é vazio-ou-nulo e "Diferente de" é preenchido-e-não-nulo; em data os dois viram "preenchido"
 *    (é o que o legado monta — `Aux = '='` nunca é verdadeiro lá); em número o legado quebraria a consulta, aqui é recusado.
 * O `campo` tem de vir conferido contra uma lista de campos reais (é o que fecha a injeção): aqui ele só passa por `sql.id`.
 */
export function condicaoPesquisa(c: CondicaoPesquisa, tipo?: 'texto' | 'numero' | 'data' | 'booleano'): RawBuilder<unknown> {
  const op = OPERADORES_PESQUISA[String(c.operador)];
  if (!op) throw new BusinessRuleError('OPERADOR_INVALIDO', { operador: c.operador });
  const campo = sql.id(c.campo);
  if (op === 'IS NULL') return sql`${campo} IS NULL`;
  if (op === 'IS NOT NULL') return sql`${campo} IS NOT NULL`;
  if (op === 'BETWEEN') {
    const v = Array.isArray(c.valor) ? c.valor : [];
    if (v.length !== 2) throw new BusinessRuleError('CONDICAO_ENTRE_EXIGE_DOIS_VALORES', { campo: c.campo });
    return sql`${campo} BETWEEN ${v[0]} AND ${v[1]}`;
  }
  const valor = c.valor == null ? '' : String(c.valor);
  if (op === 'LIKE') {
    const alvo = String(c.operador) === 'comeca' ? `${valor}%`
      : String(c.operador) === 'termina' ? `%${valor}`
      : `%${valor.replace(/\+/g, ' %')}%`;
    return sql`${campo}::text LIKE ${alvo}`;
  }
  if (op === 'IN') {
    const lista = valor.split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter((x) => x !== '')
      .map((x) => (/^\d{2}\/\d{2}\/\d{4}$/.test(x) ? x.split('/').reverse().join('-') : x));
    if (!lista.length) throw new BusinessRuleError('CONDICAO_SEM_VALOR', { campo: c.campo });
    return sql`${campo}::text IN (${sql.join(lista.map((x) => sql`${x}`))})`;
  }
  if (valor === '' && (op === '=' || op === '<>')) {
    if (tipo === 'texto') return op === '=' ? sql`(${campo} = '' OR ${campo} IS NULL)` : sql`(${campo} <> '' AND ${campo} IS NOT NULL)`;
    if (tipo === 'data') return sql`${campo} IS NOT NULL`;
  }
  if (valor === '' && tipo !== 'texto') throw new BusinessRuleError('CONDICAO_SEM_VALOR', { campo: c.campo });
  return sql`${campo} ${sql.raw(op)} ${c.valor}`;
}
