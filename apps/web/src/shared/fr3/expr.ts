/**
 * O PascalScript e as expressões do FastReport — o subconjunto que os modelos do legado (etiquetas e relatórios) usam.
 *
 * Expressões (o que vai entre colchetes no texto de um memo): campos `<frxDBDataset2."CAMPO">` ou `frxDBDataset2."CAMPO"`,
 * variáveis `<PAGINA1>`, `IIF`, `FormatFloat`, `Date`/`Time`, aritmética, comparação e concatenação com `+`.
 * Script (o `ScriptText` do relatório): `procedure X(Sender: TfrxComponent); begin ... end;` ligadas aos eventos
 * `OnBeforePrint`/`OnStartReport`, com atribuição a propriedade de objeto (`MemoVenda.Visible := True`), `if/then/else`
 * e blocos `begin/end`. É o que os 41 modelos `eti$` da produção usam (auditoria de set/2026). Os relatórios (as conferências
 * da NF) somam as agregadas do FastReport — `SUM(<ds."CAMPO">, MasterData1)`, `AVG`, `MIN`, `MAX`, `COUNT(MasterData1)` —,
 * que o motor do relatório resolve sobre as linhas já impressas da banda (`Ambiente.agregado`).
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
  | { k: 'enquanto'; c: Expr; corpo: Stmt }
  | { k: 'para'; v: string[]; de: Expr; ate: Expr; desce: boolean; corpo: Stmt }
  | { k: 'tente'; corpo: Stmt[]; fim: Stmt[]; excecao: Stmt[] | null }
  | { k: 'caso'; e: Expr; ramos: Array<{ vals: Expr[]; corpo: Stmt }>; senao?: Stmt }
  | { k: 'nada' };

export interface Programa {
  procedimentos: Map<string, Stmt>; principal: Stmt; parametros?: Map<string, string[]>;
  /** as variáveis locais de cada procedimento com o tipo declarado (`var Pagina: Integer;`) */
  locais?: Map<string, Array<{ nome: string; tipo: string }>>;
}

/** o que o avaliador pede ao mundo de fora (o registro corrente, as variáveis, os objetos do relatório). */
export interface Ambiente {
  campo(dataset: string, campo: string): Valor;
  variavel(nome: string): Valor;
  ler(caminho: string[]): Valor;
  gravar(caminho: string[], v: Valor): void;
  /** SUM/AVG/MIN/MAX/COUNT: os argumentos chegam sem avaliar (a expressão roda linha a linha da banda) */
  agregado?(funcao: string, args: Expr[]): Valor;
  /** os procedimentos do motor que o script chama (`Inc(Linha)`, `Engine.NewPage`, `Engine.ShowBand(Banda)`); true = tratado */
  procedimento?(nome: string, args: Expr[]): boolean;
  /** as funções de objeto do relatório (`MasterData1.DataSet.HasField('X')`); undefined = não é dela */
  funcao?(nome: string, args: Valor[]): Valor | undefined;
  /** o nome é um objeto do relatório (o argumento `MasterData1` de `VerificaFP(MasterData1, …)` passa a referência, não o valor) */
  ehObjeto?(nome: string): boolean;
  agora: Date;
}

const AGREGADAS = new Set(['sum', 'avg', 'min', 'max', 'count']);

type Tok = { t: 'num' | 'str' | 'dq' | 'id' | 'ref' | 'op' | 'fim'; v: string };

const PALAVRAS = new Set(['and', 'or', 'not', 'div', 'mod', 'xor', 'if', 'then', 'else', 'begin', 'end', 'procedure', 'function', 'var', 'const', 'in', 'while', 'do',
  'for', 'to', 'downto', 'try', 'finally', 'except', 'case', 'of']);

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
    const parametros = new Map<string, string[]>();
    const locais = new Map<string, Array<{ nome: string; tipo: string }>>();
    let principal: Stmt = { k: 'nada' };
    while (!this.fim()) {
      if (this.eh('procedure') || this.eh('function')) {
        this.p++;
        const nome = this.t.v; this.p++;
        // os parâmetros: `(A: TfrxMasterData; B, C: string; var D: Currency)` — os nomes antes de cada ':'
        const params: string[] = [];
        if (this.aceita('(')) {
          let n = 1; let grupo: string[] = []; let tipo = false;
          while (n > 0 && !this.fim()) {
            if (this.eh('(')) n++;
            else if (this.eh(')')) { n--; if (n === 0) { this.p++; break; } }
            else if (n === 1 && this.eh(':')) { params.push(...grupo); grupo = []; tipo = true; }
            else if (n === 1 && this.eh(';')) { tipo = false; }
            else if (n === 1 && !tipo && this.t.t === 'id' && !['var', 'const', 'out'].includes(this.t.v.toLowerCase())) grupo.push(this.t.v);
            this.p++;
          }
        }
        parametros.set(nome.toLowerCase(), params);
        if (this.aceita(':')) this.p++; // tipo de retorno de function
        this.aceita(';');
        locais.set(nome.toLowerCase(), this.declaracoes());
        const corpo = this.bloco();
        this.aceita(';');
        procedimentos.set(nome.toLowerCase(), corpo);
        continue;
      }
      if (this.eh('var') || this.eh('const')) { this.pulaDeclaracoes(); continue; }
      if (this.eh('begin')) { principal = this.bloco(); this.aceita('.'); continue; }
      this.p++; // o que não entendemos fora de bloco é ignorado
    }
    return { procedimentos, principal, parametros, locais };
  }

  /** `var A, B: Integer; C: String;` — os nomes com o tipo (as seções `const` são puladas) */
  private declaracoes(): Array<{ nome: string; tipo: string }> {
    const out: Array<{ nome: string; tipo: string }> = [];
    while (this.eh('var') || this.eh('const')) {
      const ehVar = this.eh('var');
      this.p++;
      let grupo: string[] = [];
      while (!this.fim() && !this.eh('begin') && !this.eh('procedure') && !this.eh('function') && !this.eh('var') && !this.eh('const')) {
        if (ehVar && this.eh(':')) {
          this.p++;
          const tipo = this.t.t === 'id' ? this.t.v.toLowerCase() : '';
          for (const n of grupo) out.push({ nome: n, tipo });
          grupo = [];
        } else if (ehVar && this.t.t === 'id' && !this.eh(',') ) {
          // só os nomes antes do ':' (o tipo já foi consumido acima)
          grupo.push(this.t.v);
        }
        if (this.eh(';')) grupo = [];
        this.p++;
      }
    }
    return out;
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
    if (this.aceita('while')) {
      const c = this.expr();
      this.espera('do');
      return { k: 'enquanto', c, corpo: this.comando() };
    }
    // `for I := 0 to Lista.Count - 1 do …` (o layout de trocas do pedido de compra liga as colunas por loja assim)
    if (this.aceita('for')) {
      const v = [this.t.v]; this.p++;
      this.espera(':=');
      const de = this.expr();
      const desce = this.aceita('downto');
      if (!desce) this.espera('to');
      const ate = this.expr();
      this.espera('do');
      return { k: 'para', v, de, ate, desce, corpo: this.comando() };
    }
    // `case <expr> of 1: …; 2, 3: …; else … end` (os "níveis expandidos" dos layouts do TFrmRelMaster abrem os grupos assim)
    if (this.aceita('case')) {
      const e = this.expr();
      this.espera('of');
      const ramos: Array<{ vals: Expr[]; corpo: Stmt }> = [];
      let senao: Stmt | undefined;
      while (!this.eh('end') && !this.fim()) {
        if (this.aceita('else')) {
          const corpo: Stmt[] = [];
          while (!this.eh('end') && !this.fim()) { corpo.push(this.comando()); if (!this.aceita(';')) break; }
          senao = { k: 'bloco', corpo };
          break;
        }
        const vals = [this.expr()];
        while (this.aceita(',')) vals.push(this.expr());
        this.espera(':');
        ramos.push({ vals, corpo: this.comando() });
        this.aceita(';');
      }
      this.espera('end');
      return { k: 'caso', e, ramos, senao };
    }
    // `try … finally … end` / `try … except … end`
    if (this.aceita('try')) {
      const lista = (...fins: string[]) => {
        const out: Stmt[] = [];
        while (!fins.some((f) => this.eh(f)) && !this.fim()) { out.push(this.comando()); if (!this.aceita(';')) break; }
        return out;
      };
      const corpo = lista('finally', 'except', 'end');
      let fim: Stmt[] = [];
      let excecao: Stmt[] | null = null;
      if (this.aceita('finally')) fim = lista('end');
      else if (this.aceita('except')) excecao = lista('end');
      this.espera('end');
      return { k: 'tente', corpo, fim, excecao };
    }
    if (this.t.t === 'id') {
      const caminho = [this.t.v]; this.p++;
      while (this.eh('.') && this.toks[this.p + 1]?.t === 'id') { this.p++; caminho.push(this.t.v); this.p++; }
      if (this.aceita(':=')) return { k: 'atrib', alvo: caminho, e: this.expr() };
      const args: Expr[] = [];
      if (this.aceita('(')) { if (!this.eh(')')) do args.push(this.expr()); while (this.aceita(',')); this.espera(')'); }
      // o typecast do Pascal no lado esquerdo: `TfrxMemoView(Sender).Visible := False` grava no objeto do argumento
      if (this.eh('.') && this.toks[this.p + 1]?.t === 'id' && args.length === 1 && args[0].k === 'id') {
        const alvo = [...args[0].caminho];
        while (this.eh('.') && this.toks[this.p + 1]?.t === 'id') { this.p++; alvo.push(this.t.v); this.p++; }
        if (this.aceita(':=')) return { k: 'atrib', alvo, e: this.expr() };
        return { k: 'nada' };
      }
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
      // o item de uma lista (`ListaCampos[I]`): a função de objeto `<nome>[]` do ambiente
      if (this.aceita('[')) {
        const i = this.expr();
        this.espera(']');
        return { k: 'call', nome: `${caminho.join('.')}[]`, args: [i] };
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
  // `Comp <> nil`: o objeto achado (o nome dele) não é nil
  if ((a == null && typeof b === 'string' && b !== '') || (b == null && typeof a === 'string' && a !== '')) return a == null ? -1 : 1;
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
      if (AGREGADAS.has(n) && amb.agregado) return amb.agregado(n, e.args);
      const f = funcoes[n];
      if (f) return f(e.args.map((a) => avaliar(a, amb, funcoes)), amb);
      return amb.funcao?.(n, e.args.map((a) => avaliar(a, amb, funcoes))) ?? null;
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

/** o valor inicial da variável pelo tipo declarado (o FastScript zera Integer/Double, String vazia, Boolean falso) */
function valorDoTipo(tipo: string): Valor {
  if (/^(integer|int64|byte|word|cardinal|longint|longword|smallint|shortint|double|extended|real|single|currency|comp)$/.test(tipo)) return 0;
  if (/^(string|ansistring|widestring|shortstring|char|widechar)$/.test(tipo)) return '';
  if (tipo === 'boolean') return false;
  return null;
}

/** a atribuição a uma variável tipada converte (o `Pagina := <FOLHA>` com FOLHA = '1' guarda o número 1, e `Pagina + 1` dá 2) */
function converterAoTipo(tipo: string, v: Valor): Valor {
  if (/^(integer|int64|byte|word|cardinal|longint|longword|smallint|shortint)$/.test(tipo)) {
    const n = typeof v === 'string' ? Number(v.trim().replace(',', '.') || 0) : Number(v ?? 0);
    return Number.isFinite(n) ? Math.round(n) : v;
  }
  if (/^(double|extended|real|single|currency|comp)$/.test(tipo)) {
    const n = typeof v === 'string' ? Number(v.trim().replace(',', '.') || 0) : Number(v ?? 0);
    return Number.isFinite(n) ? n : v;
  }
  if (/^(string|ansistring|widestring|shortstring|char|widechar)$/.test(tipo)) return texto(v);
  if (tipo === 'boolean') return booleano(v);
  return v;
}

/** os tipos das locais do procedimento em execução (o topo é o atual) */
const pilhaDeLocais: Array<Map<string, string>> = [];

/**
 * Roda um procedimento do script com as variáveis locais dele: cada uma nasce com o valor do tipo a cada chamada e o valor que o
 * mesmo nome tinha fora volta no fim — sem isso a local vira global e guarda o valor da chamada anterior.
 */
export function executarComLocais(prog: Programa, nome: string, corpo: Stmt, amb: Ambiente,
  funcoes: Record<string, (args: Valor[], amb: Ambiente) => Valor>, prof = 0): void {
  const locais = prog.locais?.get(nome.toLowerCase()) ?? [];
  const antes = locais.map((l) => { try { return amb.ler([l.nome]); } catch { return null; } });
  locais.forEach((l) => amb.gravar([l.nome], valorDoTipo(l.tipo)));
  pilhaDeLocais.push(new Map(locais.map((l) => [l.nome.toLowerCase(), l.tipo])));
  try { executar(corpo, amb, funcoes, prog, prof); } finally {
    pilhaDeLocais.pop();
    locais.forEach((l, i) => amb.gravar([l.nome], antes[i]));
  }
}

export function executar(s: Stmt, amb: Ambiente, funcoes: Record<string, (args: Valor[], amb: Ambiente) => Valor>, prog: Programa, prof = 0): void {
  if (prof > 50) return;
  switch (s.k) {
    case 'atrib': {
      const v = avaliar(s.e, amb, funcoes);
      const tipo = s.alvo.length === 1 ? pilhaDeLocais[pilhaDeLocais.length - 1]?.get(s.alvo[0].toLowerCase()) : undefined;
      amb.gravar(s.alvo, tipo ? converterAoTipo(tipo, v) : v);
      return;
    }
    case 'se': {
      if (booleano(avaliar(s.c, amb, funcoes))) executar(s.entao, amb, funcoes, prog, prof + 1);
      else if (s.senao) executar(s.senao, amb, funcoes, prog, prof + 1);
      return;
    }
    case 'bloco': for (const c of s.corpo) executar(c, amb, funcoes, prog, prof + 1); return;
    case 'chamada': {
      const p = prog.procedimentos.get(s.nome.toLowerCase());
      if (p) {
        // os argumentos ligados aos parâmetros (o objeto vai por referência: o nome dele); o valor anterior do nome volta depois
        const params = prog.parametros?.get(s.nome.toLowerCase()) ?? [];
        const antes = params.map((nm) => { try { return amb.ler([nm]); } catch { return null; } });
        params.forEach((nm, i) => {
          const a = s.args[i];
          if (!a) return;
          const v = a.k === 'id' && a.caminho.length === 1 && amb.ehObjeto?.(a.caminho[0]) ? a.caminho[0] : avaliar(a, amb, funcoes);
          amb.gravar([nm], v);
        });
        try { executarComLocais(prog, s.nome, p, amb, funcoes, prof + 1); } finally { params.forEach((nm, i) => amb.gravar([nm], antes[i])); }
      } else amb.procedimento?.(s.nome.toLowerCase(), s.args);
      return;
    }
    case 'enquanto': {
      // guarda contra laço infinito de script: o relatório não trava a tela
      for (let i = 0; i < 10000 && booleano(avaliar(s.c, amb, funcoes)); i++) executar(s.corpo, amb, funcoes, prog, prof + 1);
      return;
    }
    case 'para': {
      const de = Math.trunc(numero(avaliar(s.de, amb, funcoes)));
      const ate = Math.trunc(numero(avaliar(s.ate, amb, funcoes)));
      for (let i = de, n = 0; (s.desce ? i >= ate : i <= ate) && n < 10000; i += s.desce ? -1 : 1, n++) {
        amb.gravar(s.v, i);
        executar(s.corpo, amb, funcoes, prog, prof + 1);
      }
      return;
    }
    case 'caso': {
      const v = avaliar(s.e, amb, funcoes);
      const igual = (x: Valor) => (typeof v === 'number' || typeof x === 'number' ? numero(v) === numero(x) : texto(v) === texto(x));
      const r = s.ramos.find((ramo) => ramo.vals.some((x) => igual(avaliar(x, amb, funcoes))));
      if (r) executar(r.corpo, amb, funcoes, prog, prof + 1);
      else if (s.senao) executar(s.senao, amb, funcoes, prog, prof + 1);
      return;
    }
    case 'tente': {
      try {
        for (const c of s.corpo) executar(c, amb, funcoes, prog, prof + 1);
      } catch (e) {
        if (!s.excecao) throw e;
        for (const c of s.excecao) executar(c, amb, funcoes, prog, prof + 1);
      } finally {
        for (const c of s.fim) executar(c, amb, funcoes, prog, prof + 1);
      }
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
