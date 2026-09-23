/**
 * LOG — o "Registros de Log" do legado (`TLog.GravaLog`, uLog.pas; FILA Achado 20). Não é log técnico: é o histórico
 * que 21 telas mostram ao usuário (botão BTNREGISTROLOG) — quem alterou o quê, com o valor anterior e o atual de cada
 * campo. O form-base grava uma linha a cada gravação de cadastro (`uCadMaster.pas:485`) e as telas gravam as suas
 * ações (o controle de permissões registra cada acesso liberado ou removido — é o ÚNICO registro de quem mudou
 * permissão de quem; a `audit_permissoes` só guarda programa e máquina).
 *
 * O formato é o que a produção tem (lido em 23/09/2026), não o do fonte de mai/2020: o HISTORICO sai em MAIÚSCULAS e
 * sem acento ("USUARIO FULANO LIBEROU A PERMISSAO …"; "ALTEROU: 23/09/2026 15:55:03 \r\nCAMPO: SEXO    VALOR
 * ANTERIOR:     VALOR ATUAL: F"). FORMULARIO é o título da tela ("Cadastro de parceiros"); TABELA e CHAVE são o nome
 * da tabela e da coluna-chave do legado; VALOR é o código do registro.
 */
import { sql } from 'kysely';
import { currentTenant } from '../tenant/tenant-context';

type AnyDB = any;
export type AcaoLog = 'Inseriu' | 'Alterou' | 'Excluiu';

const FUSO = 'America/Sao_Paulo';

/** "23/09/2026 15:55:03" — o DateTimeToStr do Delphi em pt-BR, no fuso da loja */
export function dataHoraLegado(d: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('day')}/${v('month')}/${v('year')} ${v('hour')}:${v('minute')}:${v('second')}`;
}

/** maiúsculas e sem acento — como a produção grava */
export function normalizarLog(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

/** o VarToStr do valor de um campo: data como o Delphi mostra, nulo como vazio */
function valorLegado(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const s = dataHoraLegado(v);
    return s.endsWith(' 00:00:00') ? s.slice(0, 10) : s;
  }
  if (typeof v === 'boolean') return v ? 'S' : 'N';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const ISO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATAHORA = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const NUMERO = /^-?\d+(\.\d+)?$/;

/**
 * a forma CANÔNICA de um valor para comparar antes × depois: o banco devolve numeric como texto ('5.50') e data como
 * Date; o formulário manda número (5.5) e ISO ('2026-09-23T10:00:00-03:00'). Comparar o texto cru marcaria como
 * "alterado" o que não mudou — o legado compara o valor do campo (OldValue <> NewValue).
 */
function canonico(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return `T${v.getTime()}`;
  if (typeof v === 'number') return `N${v}`;
  if (typeof v === 'string') {
    const t = v.trim();
    if (NUMERO.test(t)) return `N${Number(t)}`;
    if (ISO_DATA.test(t)) return `D${t}`;
    if (ISO_DATAHORA.test(t)) {
      const ms = Date.parse(t);
      if (!Number.isNaN(ms)) return `T${ms}`;
    }
    return `S${v}`;
  }
  if (typeof v === 'boolean') return v ? 'SS' : 'SN';
  return `J${JSON.stringify(v)}`;
}

/** o que se escreve no histórico: data como o Delphi mostra (a ISO que o formulário manda também) */
function exibir(v: unknown): string {
  if (typeof v === 'string') {
    const t = v.trim();
    if (ISO_DATA.test(t)) return `${t.slice(8, 10)}/${t.slice(5, 7)}/${t.slice(0, 4)}`;
    if (ISO_DATAHORA.test(t) && !Number.isNaN(Date.parse(t))) return valorLegado(new Date(t));
  }
  return valorLegado(v);
}

/** o campo é SENHA? (o GravaLog pula `Pos('SENHA', FieldName) > 0`) */
const ehSenha = (c: string) => /senha/i.test(c);

/**
 * o texto do histórico de uma gravação de cadastro (TLog.GravaLog com DataSet, uLog.pas:236-330):
 *  - Inseriu: cada campo preenchido → "Campo: X   Valor: V";
 *  - Alterou: cada campo que mudou → "Campo: X    Valor anterior: A    Valor atual: B";
 *  - nenhum campo → null (o legado cancela: `FRegistrou = false`).
 */
export function historicoDeGravacao(acao: AcaoLog, antes: Record<string, unknown>, depois: Record<string, unknown>, quando = new Date()): string | null {
  const linhas: string[] = [];
  for (const [c, novo] of Object.entries(depois)) {
    if (ehSenha(c)) continue;
    if (acao === 'Inseriu') {
      const s = exibir(novo);
      if (s !== '') linhas.push(`Campo: ${c.toUpperCase()}   Valor: ${s}`);
    } else if (canonico(antes[c]) !== canonico(novo)) {
      linhas.push(`Campo: ${c.toUpperCase()}    Valor anterior: ${exibir(antes[c])}    Valor atual: ${exibir(novo)}`);
    }
  }
  if (!linhas.length) return null;
  return `${acao}: ${dataHoraLegado(quando)} \r\n${linhas.join('\r\n')}`;
}

export interface RegistroLog {
  acao: AcaoLog;
  /** título da tela, como o legado grava (lblTitulo.Caption) — ex.: 'Cadastro de parceiros' */
  formulario: string;
  /** tabela e coluna-chave do legado — ex.: 'PARCEIROS' / 'CODPARCEIRO' */
  tabela: string;
  chave: string;
  valor: number | null;
  historico: string;
  /** só quando a tela passa (o form-base passa 0 = sem empresa) */
  idempresa?: number | null;
}

/** grava uma linha na LOG, na transação de quem chama (o legado grava na mesma conexão do form) */
export async function gravarLog(trx: AnyDB, r: RegistroLog): Promise<void> {
  const op = currentTenant().operadorId ?? null;
  const nome = op != null
    ? ((await trx.selectFrom('operadores').select(['nome', 'login']).where('codoperador', '=', op).executeTakeFirst()) as { nome?: string; login?: string } | undefined)
    : undefined;
  await trx.insertInto('log').values({
    idlog: sql`nextval('seq_log')`,
    acao: r.acao,
    formulario: r.formulario.slice(0, 150),
    tabela: r.tabela.toUpperCase().slice(0, 100),
    chave: r.chave.toUpperCase().slice(0, 50),
    valor: r.valor,
    codusuario: op,
    usuario: normalizarLog(String(nome?.nome ?? nome?.login ?? '')).slice(0, 100) || null,
    datahora: sql`now()`,
    historico: normalizarLog(r.historico).slice(0, 4000),
    idempresa: r.idempresa && r.idempresa > 0 ? r.idempresa : null,
  }).execute();
}

/** o que um cadastro declara para o form-base gravar a LOG (uCadMaster.pas:485) */
export interface LogConfig {
  formulario: string;
  /** tabela e chave do legado quando diferem das nossas (ex.: empresas → CODEMPRESA) */
  tabela?: string;
  chave?: string;
}

/** a gravação de cadastro: monta o texto e grava, se algum campo entrou ou mudou */
export async function gravarLogDeCadastro(
  trx: AnyDB,
  cfg: { tabela: string; pk: string; log?: LogConfig },
  acao: AcaoLog,
  id: number,
  antes: Record<string, unknown>,
  depois: Record<string, unknown>,
): Promise<void> {
  if (!cfg.log) return;
  const historico = historicoDeGravacao(acao, antes, depois);
  if (!historico) return;
  await gravarLog(trx, {
    acao, formulario: cfg.log.formulario, tabela: cfg.log.tabela ?? cfg.tabela, chave: cfg.log.chave ?? cfg.pk, valor: id, historico,
  });
}
