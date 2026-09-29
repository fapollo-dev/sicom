/**
 * O PascalScript e as expressões do FastReport — o subconjunto que os modelos de etiqueta do legado usam.
 *
 * Expressões (o que vai entre colchetes no texto de um memo): campos `<frxDBDataset2."CAMPO">` ou `frxDBDataset2."CAMPO"`,
 * variáveis `<PAGINA1>`, `IIF`, `FormatFloat`, `Date`/`Time`, aritmética, comparação e concatenação com `+`.
 * Script (o `ScriptText` do relatório): `procedure X(Sender: TfrxComponent); begin ... end;` ligadas aos eventos
 * `OnBeforePrint`/`OnStartReport`, com atribuição a propriedade de objeto (`MemoVenda.Visible := True`), `if/then/else`
 * e blocos `begin/end`. É o que os 41 modelos `eti$` da produção usam (auditoria de set/2026) — nada além.
 */

export type Valor = number | string | boolean | Date | null;

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'ref'; nome: string; campo?: string } // <frxDBDataset2."CAMPO"> ou <VARIAVEL>
  | { k: 'id'; caminho: string[] } // designador: Nome, Obj.Prop, Obj.DataSet.RecNo
  | { k: 'call'; nome: string; args: Expr[] }
  | { k: 'un'; op: string; e: Expr }
  | { k: 'bin'; op: string; a: Expr; b: Expr };

export type Stmt =
  | { k: 'atrib'; alvo: string[]; e: Expr }
  | { k: 'se'; c: Expr; entao: Stmt; senao?: Stmt }
  | { k: 'bloco'; corpo: Stmt[] }
  | { k: 'chamada'; nome: string; args: Expr[] }
  | { k: 'nada' };

export interface Programa { procedimentos: Map<string, Stmt>; principal: Stmt }

/** o que o avaliador pede ao mundo de fora (o registro corrente, as variáveis, os objetos do relatório). */
export interface Ambiente {
  campo(dataset: string, campo: string): Valor;
  variavel(nome: string): Valor;
  ler(caminho: string[]): Valor;
  gravar(caminho: string[], v: Valor): void;
  agora: Date;
}

type Tok = { t: 'num' | 'str' | 'dq' | 'id' | 'ref' | 'op' | 'fim'; v: string };

const PALAVRAS = new Set(['and', 'or', 'not', 'div', 'mod', 'xor', 'if', 'then', 'else', 'begin', 'end', 'procedure', 'function', 'var', 'const', 'in']);

function tokenizar(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '{') { while (i < src.length && src[i] !== '}') i++; i++; continue; }
    if (c === '(' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === ')')) i++; i += 2; continue; }
    // referência a campo/variável: <frxDBDataset2."CAMPO">, <PAGINA1>, <Page#>
    if (c === '<') {
      const m = /^<([A-Za-z_][A-Za-z0-9_]*(?:\."[^"]*")?|[A-Za-z_][A-Za-z0-9_]*#)>/.exec(src.slice(i));
      if (m) { out.push({ t: 'ref', v: m[1] }); i += m[0].length; continue; }
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: m[0] }); i += m[0].length; continue;
    }
    if (c === '$' && /[0-9a-fA-F]/.test(src[i + 1] ?? '')) {
      const m = /^\$[0-9a-fA-F]+/.exec(src.slice(i))!;
      out.push({ t: 'num', v: String(parseInt(m[0].slice(1), 16)) }); i += m[0].length; continue;
    }
    // string Pascal: '...' com '' como aspa, e #13/#10 colados (o Delphi concatena 'a'#13#10'b')
    if (c === "'" || c === '#') {
      let s = '';
      let lido = false;
      while (i < src.length && (src[i] === "'" || (src[i] === '#' && /[0-9$]/.test(src[i + 1] ?? '')))) {
        if (src[i] === '#') {
          const m = /^#(\$[0-9a-fA-F]+|[0-9]+)/.exec(src.slice(i))!;
          s += String.fromCharCode(m[1].startsWith('$') ? parseInt(m[1].slice(1), 16) : Number(m[1]));
          i += m[0].length; lido = true; continue;
        }
        i++;
        while (i < src.length) {
          if (src[i] === "'" && src[i + 1] === "'") { s += "'"; i += 2; continue; }
          if (src[i] === "'") { i++; break; }
          s += src[i++];
        }
        lido = true;
      }
      if (lido) { out.push({ t: 'str', v: s }); continue; }
    }
    if (c === '"') {
      const j = src.indexOf('"', i + 1);
      const fim = j < 0 ? src.length : j;
      out.push({ t: 'dq', v: src.slice(i + 1, fim) }); i = fim + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*#?/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0] }); i += m[0].length; continue;
    }
    const dois = src.slice(i, i + 2);
    if ([':=', '<>', '<=', '>='].includes(dois)) { out.push({ t: 'op', v: dois }); i += 2; continue; }
    out.push({ t: 'op', v: c }); i++;
  }
  out.push({ t: 'fim', v: '' });
  return out;
}

class Parser {
  private p = 0;
  constructor(private readonly toks: Tok[]) {}
  private get t(): Tok { return this.toks[this.p]; }
  private eh(v: string): boolean { return (this.t.t === 'op' || this.t.t === 'id') && this.t.v.toLowerCase() === v; }
  private aceita(v: string): boolean { if (this.eh(v)) { this.p++; return true; } return false; }
  private espera(v: string): void { if (!this.aceita(v)) throw new Error(`esperado '${v}' e veio '${this.t.v}'`); }
  fim(): boolean { return this.t.t === 'fim'; }

  programa(): Programa {
    const procedimentos = new Map<string, Stmt>();
    let principal: Stmt = { k: 'nada' };
    while (!this.fim()) {
      if (this.eh('procedure') || this.eh('function')) {
        this.p++;
        const nome = this.t.v; this.p++;
        if (this.aceita('(')) { let n = 1; while (n > 0 && !this.fim()) { if (this.eh('(')) n++; if (this.eh(')')) n--; this.p++; } }
        if (this.aceita(':')) this.p++; // tipo de retorno de function
        this.aceita(';');
        this.pulaDeclaracoes();
        const corpo = this.bloco();
        this.aceita(';');
        procedimentos.set(nome.toLowerCase(), corpo);
        continue;
      }
      if (this.eh('var') || this.eh('const')) { this.pulaDeclaracoes(); continue; }
      if (this.eh('begin')) { principal = this.bloco(); this.aceita('.'); continue; }
      this.p++; // o que não entendemos fora de bloco é ignorado
    }
    return { procedimentos, principal };
  }

  private pulaDeclaracoes(): void {
    while (this.eh('var') || this.eh('const')) {
      this.p++;
      while (!this.fim() && !this.eh('begin') && !this.eh('procedure') && !this.eh('function')) this.p++;
    }
  }

  private bloco(): Stmt {
    this.espera('begin');
    const corpo: Stmt[] = [];
    while (!this.eh('end') && !this.fim()) {
      corpo.push(this.comando());
      if (!this.aceita(';')) break;
    }
    this.espera('end');
    return { k: 'bloco', corpo };
  }

  private comando(): Stmt {
    if (this.eh('begin')) return this.bloco();
    if (this.eh('end') || this.eh(';')) return { k: 'nada' };
    if (this.aceita('if')) {
      const c = this.expr();
      this.espera('then');
      const entao = this.eh('else') ? { k: 'nada' as const } : this.comando();
      const senao = this.aceita('else') ? this.comando() : undefined;
      return { k: 'se', c, entao, senao };
    }
    if (this.t.t === 'id') {
      const caminho = [this.t.v]; this.p++;
      while (this.eh('.') && this.toks[this.p + 1]?.t === 'id') { this.p++; caminho.push(this.t.v); this.p++; }
      if (this.aceita(':=')) return { k: 'atrib', alvo: caminho, e: this.expr() };
      const args: Expr[] = [];
      if (this.aceita('(')) { if (!this.eh(')')) do args.push(this.expr()); while (this.aceita(',')); this.espera(')'); }
      return { k: 'chamada', nome: caminho.join('.'), args };
    }
    this.p++;
    return { k: 'nada' };
  }

  expr(): Expr {
    let a = this.soma();
    while (['=', '<>', '<', '>', '<=', '>='].includes(this.t.v) && this.t.t === 'op') {
      const op = this.t.v; this.p++;
      a = { k: 'bin', op, a, b: this.soma() };
    }
    return a;
  }
  private soma(): Expr {
    let a = this.termo();
    while ((this.t.t === 'op' && (this.t.v === '+' || this.t.v === '-')) || this.eh('or') || this.eh('xor')) {
      const op = this.t.v.toLowerCase(); this.p++;
      a = { k: 'bin', op, a, b: this.termo() };
    }
    return a;
  }
  private termo(): Expr {
    let a = this.fator();
    while ((this.t.t === 'op' && (this.t.v === '*' || this.t.v === '/')) || this.eh('div') || this.eh('mod') || this.eh('and')) {
      const op = this.t.v.toLowerCase(); this.p++;
      a = { k: 'bin', op, a, b: this.fator() };
    }
    return a;
  }
  private fator(): Expr {
    const t = this.t;
    if (this.aceita('not')) return { k: 'un', op: 'not', e: this.fator() };
    if (t.t === 'op' && t.v === '-') { this.p++; return { k: 'un', op: '-', e: this.fator() }; }
    if (t.t === 'op' && t.v === '+') { this.p++; return this.fator(); }
    if (t.t === 'op' && t.v === '(') { this.p++; const e = this.expr(); this.espera(')'); return e; }
    if (t.t === 'num') { this.p++; return { k: 'num', v: Number(t.v) }; }
    if (t.t === 'str') { this.p++; return { k: 'str', v: t.v }; }
    if (t.t === 'ref') {
      this.p++;
      const m = /^([^.]+)\."(.*)"$/.exec(t.v);
      return m ? { k: 'ref', nome: m[1], campo: m[2] } : { k: 'ref', nome: t.v };
    }
    if (t.t === 'id') {
      this.p++;
      const caminho = [t.v];
      while (this.eh('.')) {
        const prox = this.toks[this.p + 1];
        if (prox?.t === 'dq') { this.p += 2; return { k: 'ref', nome: caminho.join('.'), campo: prox.v }; } // frxDBDataset2."CAMPO"
        if (prox?.t !== 'id') break;
        this.p++; caminho.push(this.t.v); this.p++;
      }
      if (this.aceita('(')) {
        const args: Expr[] = [];
        if (!this.eh(')')) do args.push(this.expr()); while (this.aceita(','));
        this.espera(')');
        return { k: 'call', nome: caminho.join('.'), args };
      }
      return { k: 'id', caminho };
    }
    throw new Error(`expressão inválida perto de '${t.v}'`);
  }
}

export function compilarScript(src: string): Programa {
  try {
    return new Parser(tokenizar(src ?? '')).programa();
  } catch {
    return { procedimentos: new Map(), principal: { k: 'nada' } };
  }
}

export function compilarExpr(src: string): Expr {
  const p = new Parser(tokenizar(src));
  const e = p.expr();
  if (!p.fim()) throw new Error('sobra na expressão');
  return e;
}

// ─── avaliação ───────────────────────────────────────────────────────────────────────────────────────────────

export const numero = (v: Valor): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  if (v == null || v === '') return 0;
  const s = String(v).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const n = Number(s.replace(/\./g, '').replace(',', '.')); // StrToFloat em pt-BR ("1.234,50")
  return Number.isFinite(n) ? n : 0;
};
const booleano = (v: Valor): boolean => (typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : typeof v === 'string' ? v.toLowerCase() === 'true' : v != null);

function comparar(a: Valor, b: Valor): number {
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (a == null && b == null) return 0;
  // Variant do Delphi: número × string numérica compara como número; string vazia × número = 0
  const x = a instanceof Date ? a.getTime() : numero(a);
  const y = b instanceof Date ? b.getTime() : numero(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function avaliar(e: Expr, amb: Ambiente, funcoes: Record<string, (args: Valor[], amb: Ambiente) => Valor>): Valor {
  switch (e.k) {
    case 'num': return e.v;
    case 'str': return e.v;
    case 'ref': return e.campo != null ? amb.campo(e.nome, e.campo) : amb.variavel(e.nome);
    case 'id': {
      if (e.caminho.length === 1) {
        const n = e.caminho[0].toLowerCase();
        if (n === 'true') return true;
        if (n === 'false') return false;
        if (n === 'null' || n === 'nil') return null;
        const f = funcoes[n];
        if (f) return f([], amb); // Date, Time, Now sem parênteses
      }
      return amb.ler(e.caminho);
    }
    case 'call': {
      const n = e.nome.toLowerCase();
      if (n === 'iif') return booleano(avaliar(e.args[0], amb, funcoes)) ? avaliar(e.args[1], amb, funcoes) : avaliar(e.args[2], amb, funcoes);
      const f = funcoes[n];
      return f ? f(e.args.map((a) => avaliar(a, amb, funcoes)), amb) : null;
    }
    case 'un': {
      const v = avaliar(e.e, amb, funcoes);
      return e.op === 'not' ? !booleano(v) : -numero(v);
    }
    case 'bin': {
      const a = avaliar(e.a, amb, funcoes);
      if (e.op === 'and') return booleano(a) && booleano(avaliar(e.b, amb, funcoes));
      if (e.op === 'or') return booleano(a) || booleano(avaliar(e.b, amb, funcoes));
      const b = avaliar(e.b, amb, funcoes);
      switch (e.op) {
        case '+': return typeof a === 'string' || typeof b === 'string' ? `${texto(a)}${texto(b)}` : numero(a) + numero(b);
        case '-': return numero(a) - numero(b);
        case '*': return numero(a) * numero(b);
        case '/': return numero(b) === 0 ? 0 : numero(a) / numero(b);
        case 'div': return numero(b) === 0 ? 0 : Math.trunc(numero(a) / numero(b));
        case 'mod': return numero(b) === 0 ? 0 : Math.trunc(numero(a)) % Math.trunc(numero(b));
        case 'xor': return booleano(a) !== booleano(b);
        case '=': return comparar(a, b) === 0;
        case '<>': return comparar(a, b) !== 0;
        case '<': return comparar(a, b) < 0;
        case '>': return comparar(a, b) > 0;
        case '<=': return comparar(a, b) <= 0;
        case '>=': return comparar(a, b) >= 0;
      }
      return null;
    }
  }
}

export function executar(s: Stmt, amb: Ambiente, funcoes: Record<string, (args: Valor[], amb: Ambiente) => Valor>, prog: Programa, prof = 0): void {
  if (prof > 50) return;
  switch (s.k) {
    case 'atrib': amb.gravar(s.alvo, avaliar(s.e, amb, funcoes)); return;
    case 'se': {
      if (booleano(avaliar(s.c, amb, funcoes))) executar(s.entao, amb, funcoes, prog, prof + 1);
      else if (s.senao) executar(s.senao, amb, funcoes, prog, prof + 1);
      return;
    }
    case 'bloco': for (const c of s.corpo) executar(c, amb, funcoes, prog, prof + 1); return;
    case 'chamada': {
      const p = prog.procedimentos.get(s.nome.toLowerCase());
      if (p) executar(p, amb, funcoes, prog, prof + 1);
      return;
    }
    default: return;
  }
}

/** VarToStr do Delphi em pt-BR: número com vírgula, data dd/mm/aaaa, booleano True/False. */
export function texto(v: Valor): string {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return floatToStr(v);
  if (v instanceof Date) return dataParaTexto(v);
  return String(v);
}

/** FloatToStr: até 15 dígitos significativos, separador decimal vírgula, sem milhar. */
export function floatToStr(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(15))).replace('.', ',');
}

const d2 = (n: number) => String(n).padStart(2, '0');
/** DateToStr/DateTimeToStr: a meia-noite sai só com a data (o TDateField do legado). */
export function dataParaTexto(d: Date): string {
  const data = `${d2(d.getDate())}/${d2(d.getMonth() + 1)}/${d.getFullYear()}`;
  return d.getHours() || d.getMinutes() || d.getSeconds() ? `${data} ${d2(d.getHours())}:${d2(d.getMinutes())}:${d2(d.getSeconds())}` : data;
}
