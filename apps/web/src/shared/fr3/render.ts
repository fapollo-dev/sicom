/**
 * IMPRESSÃO DOS MODELOS DO LEGADO (.fr3) — o motor do FastReport, no subconjunto que os modelos da produção usam: as etiquetas
 * (`eti$`) e os relatórios que o legado imprime com um frxDBDataset por tabela (as conferências da NF: `dbdNota` +
 * `dbdItensNota`, com as agregadas `SUM`/`AVG`/`COUNT` no rodapé).
 *
 * O legado imprime a etiqueta carregando `Relatorios\eti$ - <modelo>.fr3` no TfrxReport (Uetiqueta.pas:1398-1452); a
 * produção guarda esses arquivos na tabela RELATORIOS (1.227 linhas; 41 modelos `eti$`). Aqui o mesmo arquivo é lido e
 * desenhado em HTML no tamanho do papel: páginas (`TfrxReportPage`, papel em mm), bandas (`ReportTitle`, `PageHeader`,
 * `MasterData` com colunas, `PageFooter`, `ReportSummary`) e objetos (memo, código de barras, linha, forma, figura) nas
 * coordenadas do arquivo — a unidade do FastReport é o pixel de 96 dpi, a mesma do CSS. O script PascalScript dos
 * eventos `OnBeforePrint`/`OnStartReport` roda antes de cada banda (ver `expr.ts`), como no motor do FastReport: todos
 * os eventos dos objetos da banda rodam e só então a banda vai para a página; Text e geometria voltam ao original
 * depois (TfrxView.AfterPrint), a visibilidade não.
 *
 * Paginação: as bandas empilham do alto da área útil; a que não cabe no que sobra da página abre página nova. O modelo
 * da loja (GONDULA PINHEIRAO, 99,8% das 78 mil impressões de 2026) tem papel 105×30 mm e banda de 24,8 mm: uma
 * etiqueta por página, que é como a impressora de etiquetas corta.
 *
 * Os dados: uma lista de registros (a etiqueta: todo `<ds."CAMPO">` lê o registro corrente, qualquer que seja o ds) ou um
 * conjunto por nome de frxDBDataset (`{ dbdNota: [...], dbdItensNota: [...] }`). A MasterData percorre o conjunto do seu
 * `DataSet` (o prefixo do form — "frmNF.dbdItensNota" — cai); os outros ficam no primeiro registro, como o cursor parado de um
 * TDataSet que o relatório não percorre. `[TotalPages#]` faz duas passadas (o DoublePass do FastReport).
 */
import { avaliar, compilarExpr, compilarScript, executar, numero, texto, type Ambiente, type Expr, type Programa, type Valor } from './expr';
import { aplicarDisplayFormat, formatDateTime, formatDelphi, formatFloat, type Separadores } from './formato';
import { desenhar } from './barras';

const PX_MM = 96 / 25.4;

interface No { tag: string; a: Record<string, string>; filhos: No[]; pai?: No }

const n = (s: string | undefined, d = 0): number => {
  if (s == null || s === '') return d;
  const v = Number(String(s).replace(',', '.'));
  return Number.isFinite(v) ? v : d;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function parse(xml: string): No {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('arquivo .fr3 inválido');
  const conv = (el: Element, pai?: No): No => {
    const a: Record<string, string> = {};
    for (const at of Array.from(el.attributes)) a[at.name] = at.value.replace(/\r\n/g, '\n');
    const no: No = { tag: el.tagName, a, filhos: [], pai };
    for (const c of Array.from(el.children)) no.filhos.push(conv(c, no));
    return no;
  };
  return conv(doc.documentElement);
}

// ─── cores e fontes do Delphi ─────────────────────────────────────────────────────────────────────────────────────

const SISTEMA: Record<number, string> = { 5: '#ffffff', 8: '#000000', 13: '#0078d7', 14: '#ffffff', 15: '#f0f0f0', 16: '#a0a0a0', 17: '#6d6d6d', 18: '#000000', 20: '#ffffff' };
/** TColor → CSS. Inteiro BGR; $FF0000xx = cor do sistema; clNone ($1FFFFFFF) e clDefault ($20000000) = transparente. */
export function cor(v: string | number | undefined | null, padrao: string | null = null): string | null {
  if (v == null || v === '') return padrao;
  const c = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(c)) return padrao;
  if (c === 0x1fffffff || c === 0x20000000) return null;
  const u = c >>> 0;
  if (u >>> 24 === 0xff || u >>> 24 === 0x80) return SISTEMA[u & 0xff] ?? '#000000';
  const r = u & 0xff, g = (u >> 8) & 0xff, b = (u >> 16) & 0xff;
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

interface Fonte { nome: string; px: number; estilo: number; cor: string }
function fonte(no: No | undefined): Fonte {
  if (!no) return { nome: 'Arial', px: 13, estilo: 0, cor: '#000000' };
  if (no.a['Font.Name'] != null && no.a['ParentFont'] !== 'True') {
    const h = n(no.a['Font.Height'], -13);
    return { nome: no.a['Font.Name'].replace(/^@/, ''), px: h < 0 ? -h : h * 0.82, estilo: n(no.a['Font.Style']), cor: cor(no.a['Font.Color'], '#000000') ?? '#000000' };
  }
  return fonte(no.pai);
}
const familia = (nome: string) => {
  const extra = /franklin/i.test(nome) ? ', "Franklin Gothic Medium", "Arial Narrow"' : /courier/i.test(nome) ? ', "Courier New", monospace' : '';
  return `"${nome.replace(/"/g, '')}"${extra}, Arial, Helvetica, sans-serif`;
};
function cssFonte(f: Fonte): string {
  return `font-family:${esc(familia(f.nome))};font-size:${f.px.toFixed(2)}px;${f.estilo & 1 ? 'font-weight:bold;' : ''}${f.estilo & 2 ? 'font-style:italic;' : ''}${f.estilo & 12 ? `text-decoration:${f.estilo & 4 ? 'underline ' : ''}${f.estilo & 8 ? 'line-through' : ''};` : ''}color:${f.cor};`;
}

// ─── figura (Picture.PropData) ────────────────────────────────────────────────────────────────────────────────────

function figura(propData: string | undefined): string | null {
  if (!propData) return null;
  const hex = propData.replace(/\s/g, '').toUpperCase();
  const acha = (sig: string) => { for (let i = hex.indexOf(sig); i >= 0; i = hex.indexOf(sig, i + 1)) if (i % 2 === 0) return i; return -1; };
  let ini = acha('FFD8FF');
  let mime = 'image/jpeg';
  if (ini < 0) { ini = acha('89504E470D0A1A0A'); mime = 'image/png'; }
  if (ini < 0) { const b = acha('07544269746D6170'); if (b >= 0) { ini = b + 16 + 8; mime = 'image/bmp'; } }
  if (ini < 0) return null;
  let bin = '';
  for (let i = ini; i + 1 < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return `data:${mime};base64,${btoa(bin)}`;
}

// ─── o motor ──────────────────────────────────────────────────────────────────────────────────────────────────────

const BANDAS = new Set(['TfrxReportTitle', 'TfrxPageHeader', 'TfrxMasterData', 'TfrxPageFooter', 'TfrxReportSummary', 'TfrxHeader', 'TfrxFooter', 'TfrxChild', 'TfrxColumnHeader', 'TfrxColumnFooter', 'TfrxDetailData', 'TfrxGroupHeader', 'TfrxGroupFooter']);
const PAGINAS = new Set(['TfrxReportPage', 'TfrxDMPPage']);

interface Estado { no: No; Visible: boolean; Left: number; Top: number; Width: number; Height: number; Text: string; final: string | null; feito: boolean; extras: Record<string, Valor> }

export type Registro = Record<string, unknown>;
/** os registros de cada frxDBDataset do relatório, pelo UserName */
export type Conjuntos = Record<string, Registro[]>;

/** o nome do dataset sem o prefixo do form ("frmNF.dbdItensNota" → "dbditensnota") */
const nomeDs = (s: string | undefined): string => (s ?? '').slice((s ?? '').lastIndexOf('.') + 1).toLowerCase();

export interface PaginaSaida { chave: string; larguraMm: number; alturaMm: number; margem: [number, number, number, number]; html: string[] }

class Relatorio {
  private readonly raiz: No;
  private readonly prog: Programa;
  private readonly estados = new Map<string, Estado>();
  private readonly locais = new Map<string, Valor>();
  /** as TStringList do script (`TStringList.Create`): a variável guarda o identificador da lista */
  private readonly listas = new Map<string, string[]>();
  private readonly variaveis = new Map<string, Valor>();
  private readonly exprs = new Map<string, Expr | null>();
  private readonly unico: Registro[] | null;
  private readonly conjuntos = new Map<string, Registro[]>();
  /** o cursor de cada dataset (o único, quando os dados vêm como lista, fica na chave '') */
  private readonly cursor = new Map<string, number>();
  /** as linhas já impressas por banda de dados (as agregadas somam sobre elas) e o dataset de cada banda */
  private readonly impressas = new Map<string, number[]>();
  private readonly dsDaBanda = new Map<string, string>();
  private recno = 0;
  /** o [Line#]: a linha da banda de dados, que recomeça a cada grupo */
  private linhaBanda = 0;
  /** a banda em desenho (as agregadas de um GroupFooter somam só o grupo) e onde cada grupo começou nas linhas impressas */
  private bandaAtual: No | null = null;
  private readonly inicioGrupo = new Map<No, Map<string, number>>();
  private pagina = 0;
  /** o objeto do evento em curso (o `Sender` do script) */
  private remetente = '';
  /** a banda de dados passou do último registro (`MasterData1.DataSet.Eof`) */
  private eof = false;
  /** a página em montagem, para o script mexer nela (`Engine.NewPage`, `Engine.ShowBand`) */
  private ctx: { y: () => number; novaPagina: () => void; mostrarBanda: (nome: string) => void } | null = null;
  private readonly funcoes: Record<string, (args: Valor[], amb: Ambiente) => Valor>;
  private readonly amb: Ambiente;

  constructor(xml: string, dados: Registro[] | Conjuntos, private readonly agora: Date, variaveisExtras: Record<string, string> = {}, private readonly totalPaginas = 0,
    textos: Record<string, string> = {}) {
    this.raiz = parse(xml);
    this.unico = Array.isArray(dados) ? dados : null;
    if (!Array.isArray(dados)) for (const [k, v] of Object.entries(dados)) this.conjuntos.set(nomeDs(k), v ?? []);
    this.prog = compilarScript(this.raiz.a['ScriptText.Text'] ?? '');
    const indexar = (no: No) => {
      const nome = no.a.Name;
      // só os objetos do relatório (Tfrx*): o <item Name="DtInicial"> das variáveis não é objeto e esconderia a variável
      if (nome && no.tag.startsWith('Tfrx')) this.estados.set(nome.toLowerCase(), {
        no, Visible: no.a.Visible !== 'False', Left: n(no.a.Left), Top: n(no.a.Top), Width: n(no.a.Width), Height: n(no.a.Height),
        Text: no.a.Text ?? '', final: null, feito: false, extras: {},
      });
      no.filhos.forEach(indexar);
    };
    indexar(this.raiz);
    // o texto que o legado põe no objeto antes de imprimir (`TfrxMemoView(frxReport.FindObject('MemoFaturamento')).Text := ...`)
    for (const [nome, t] of Object.entries(textos)) { const e = this.estados.get(nome.toLowerCase()); if (e) e.Text = t; }
    const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const hora = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}:${String(agora.getSeconds()).padStart(2, '0')}`;
    this.funcoes = {
      date: () => hoje, time: () => hora, now: () => agora,
      formatfloat: ([f, v]) => formatFloat(texto(f), Number(v) || 0),
      formatdatetime: ([f, v]) => (v instanceof Date ? formatDateTime(texto(f), v) : texto(v)),
      format: ([f, v]) => formatDelphi(texto(f), v),
      floattostr: ([v]) => texto(Number(v) || 0), inttostr: ([v]) => String(Math.trunc(Number(v) || 0)),
      strtofloat: ([v]) => Number(String(v).replace(/\./g, '').replace(',', '.')) || 0, strtoint: ([v]) => Math.trunc(Number(v) || 0),
      strtofloatdef: ([v, d]) => { const x = Number(String(v).replace(/\./g, '').replace(',', '.')); return Number.isFinite(x) ? x : (d as number); },
      trim: ([v]) => texto(v).trim(), uppercase: ([v]) => texto(v).toUpperCase(), lowercase: ([v]) => texto(v).toLowerCase(),
      copy: ([s, i, k]) => texto(s).substr(Math.max(0, (Number(i) || 1) - 1), Number(k) || 0),
      length: ([s]) => texto(s).length, pos: ([a, s]) => texto(s).indexOf(texto(a)) + 1,
      round: ([v]) => Math.round(Number(v) || 0), trunc: ([v]) => Math.trunc(Number(v) || 0), abs: ([v]) => Math.abs(Number(v) || 0),
      frac: ([v]) => (Number(v) || 0) % 1, int: ([v]) => Math.trunc(Number(v) || 0),
      datetostr: ([v]) => (v instanceof Date ? formatDateTime('dd/mm/yyyy', v) : texto(v)), timetostr: ([v]) => (v instanceof Date ? formatDateTime('hh:nn:ss', v) : texto(v)),
      vartostr: ([v]) => texto(v), inttostrdef: ([v]) => String(Math.trunc(Number(v) || 0)),
    };
    this.amb = {
      agora,
      campo: (ds, campo) => this.campo(ds, campo),
      variavel: (nome) => this.variavel(nome),
      ler: (c) => this.ler(c),
      gravar: (c, v) => this.gravar(c, v),
      agregado: (f, args) => this.agregado(f, args),
      procedimento: (nome, args) => this.procedimento(nome, args),
      funcao: (nome, args) => this.funcaoDeObjeto(nome, args),
    };
    // variáveis do relatório (<Variables>): o valor é uma expressão ('S' entre aspas)
    for (const v of this.raiz.filhos.filter((x) => x.tag === 'Variables').flatMap((x) => x.filhos)) {
      if (v.a.Name) this.variaveis.set(v.a.Name.toLowerCase(), this.avaliarTexto(v.a.Value ?? ''));
    }
    for (const [k, v] of Object.entries(variaveisExtras)) this.variaveis.set(k.toLowerCase(), this.avaliarTexto(v));
  }

  private avaliarTexto(src: string): Valor {
    try { return avaliar(compilarExpr(src), this.amb, this.funcoes); } catch { return src; }
  }

  private linhas(ds: string): Registro[] {
    return this.unico ?? this.conjuntos.get(nomeDs(ds)) ?? [];
  }

  private registroDe(ds: string): Registro {
    const chave = this.unico ? '' : nomeDs(ds);
    return this.linhas(ds)[this.cursor.get(chave) ?? 0] ?? {};
  }

  private posicionar(ds: string, i: number): void {
    this.cursor.set(this.unico ? '' : nomeDs(ds), i);
  }

  private campo(ds: string, nome: string): Valor {
    const reg = this.registroDe(ds);
    const k = Object.keys(reg).find((x) => x.toUpperCase() === nome.toUpperCase());
    const v = k != null ? reg[k] : null;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+)?$/.test(v)) {
      // a data é TDateField (meia-noite); a data-hora (TSQLTimeStampField: o kardex, a venda) guarda a hora — sem DisplayFormat o
      // FastReport a mostra com a hora, e o 'dd/mm/yyyy hh:mm:ss' do layout precisa dela
      const [a, m, d] = v.slice(0, 10).split('-').map(Number);
      const [hh, mi, ss] = (v.slice(11, 19) || '00:00:00').split(':').map((x) => Number(x) || 0);
      return new Date(a, m - 1, d, hh, mi, ss);
    }
    return (v as Valor) ?? null;
  }

  private variavel(nome: string): Valor {
    const k = nome.toLowerCase();
    if (k === 'page#' || k === 'page') return this.pagina;
    if (k === 'totalpages#' || k === 'totalpages') return this.totalPaginas || this.pagina;
    if (k === 'line#' || k === 'line') return this.linhaBanda;
    if (k === 'date') return this.funcoes.date([], this.amb);
    if (k === 'time') return this.funcoes.time([], this.amb);
    if (this.variaveis.has(k)) return this.variaveis.get(k)!;
    return null;
  }

  /** o `Sender` do script é o objeto do evento em curso */
  private resolver(c: string[]): string[] {
    if (c.length && c[0].toLowerCase() === 'sender' && this.remetente) return [this.remetente, ...c.slice(1)];
    // a variável que guarda um objeto (`Comp := PageHeader1.FindObject(...)`; `TfrxMemoView(Comp).Visible := True`)
    if (c.length > 1 && !this.estados.has(c[0].toLowerCase())) {
      const ref = this.locais.get(c[0].toLowerCase());
      if (typeof ref === 'string' && this.estados.has(ref.toLowerCase())) return [ref, ...c.slice(1)];
    }
    return c;
  }

  private lista(nomeVar: string): string[] | undefined {
    const h = this.locais.get(nomeVar.toLowerCase());
    return typeof h === 'string' ? this.listas.get(h) : undefined;
  }

  private ler(caminho: string[]): Valor {
    if (caminho.join('.').toLowerCase() === 'tstringlist.create') {
      const h = `\u0001lista${this.listas.size + 1}`;
      this.listas.set(h, []);
      return h;
    }
    const [o, ...resto] = this.resolver(caminho);
    const e = this.estados.get(o.toLowerCase());
    if (!e && resto.length === 1 && resto[0].toLowerCase() === 'count' && this.lista(o)) return this.lista(o)!.length;
    if (!e) return this.locais.get(o.toLowerCase()) ?? this.variavel(o);
    const prop = resto.join('.').toLowerCase();
    // o RecNo do TfrxDataSet conta do zero (o [Line#] conta do um)
    if (prop.endsWith('dataset.recno') || prop === 'recno') return Math.max(0, this.recno - 1);
    if (prop.endsWith('dataset.eof') || prop === 'eof') return this.eof;
    if (prop === 'visible') return e.Visible;
    if (prop === 'text' || prop === 'memo.text' || prop === 'lines.text') return e.final ?? e.Text;
    if (prop === 'left' || prop === 'top' || prop === 'width' || prop === 'height') return e[(prop[0].toUpperCase() + prop.slice(1)) as 'Left'];
    return e.extras[prop] ?? null;
  }

  private gravar(caminho: string[], v: Valor): void {
    const [o, ...resto] = this.resolver(caminho);
    const e = this.estados.get(o.toLowerCase());
    if (!e || !resto.length) { this.locais.set(o.toLowerCase(), v); return; }
    const prop = resto.join('.').toLowerCase();
    if (prop === 'visible') e.Visible = !!v;
    else if (prop === 'text' || prop === 'memo.text' || prop === 'lines.text') {
      // o objeto já passou pelo GetData nesta banda: o texto novo entra como está (o FastReport não reexpande)
      if (e.feito) e.final = texto(v); else e.Text = texto(v);
    } else if (prop === 'left' || prop === 'top' || prop === 'width' || prop === 'height') e[(prop[0].toUpperCase() + prop.slice(1)) as 'Left'] = Number(v) || 0;
    else e.extras[prop] = v;
  }

  /**
   * As agregadas do FastReport: a expressão roda em cada linha já impressa da banda (`SUM(<ds."X">, MasterData1)`); `COUNT(Banda)`
   * conta as linhas. Sem a banda no argumento, vale a primeira banda de dados do relatório.
   */
  private agregado(f: string, args: Expr[]): Valor {
    const nomeBanda = (e: Expr | undefined) => (e?.k === 'id' ? e.caminho.join('.') : e?.k === 'ref' && e.campo == null ? e.nome : '').toLowerCase();
    const banda = (f === 'count' ? nomeBanda(args[0]) : nomeBanda(args[1])) || [...this.dsDaBanda.keys()][0] || '';
    const todas = this.impressas.get(banda) ?? [];
    // no rodapé de um grupo, a agregada é do grupo (o FastReport zera os acumuladores no cabeçalho do grupo)
    const inicio = this.bandaAtual?.tag === 'TfrxGroupFooter' ? this.inicioGrupo.get(this.bandaAtual)?.get(banda) : undefined;
    const linhas = inicio != null ? todas.slice(inicio) : todas;
    if (f === 'count') return linhas.length;
    const ds = this.dsDaBanda.get(banda) ?? '';
    const chave = this.unico ? '' : nomeDs(ds);
    const antes = this.cursor.get(chave) ?? 0;
    const valores: number[] = [];
    for (const i of linhas) {
      this.posicionar(ds, i);
      let v: Valor = null;
      try { v = avaliar(args[0], this.amb, this.funcoes); } catch { v = null; }
      valores.push(numero(v));
    }
    this.cursor.set(chave, antes);
    if (f === 'sum') return valores.reduce((a, b) => a + b, 0);
    if (f === 'avg') return valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : 0;
    if (!valores.length) return 0;
    return f === 'min' ? Math.min(...valores) : Math.max(...valores);
  }

  /** `Banda.DataSet.HasField('CAMPO')`: o dataset da banda tem o campo (o legado troca o layout conforme a consulta que o alimenta) */
  private funcaoDeObjeto(nome: string, args: Valor[]): Valor | undefined {
    const item = /^(\w+)\[\]$/.exec(nome);
    if (item) return this.lista(item[1])?.[Math.trunc(Number(args[0]) || 0)] ?? null;
    // `Banda.FindObject('Nome')`: o objeto (pelo nome) ou nil
    if (/^\w+\.findobject$/.test(nome)) { const e = this.estados.get(texto(args[0] ?? '').toLowerCase()); return e ? e.no.a.Name ?? null : null; }
    const m = /^(\w+)\.dataset\.hasfield$/.exec(nome);
    if (!m) return undefined;
    const banda = this.estados.get(m[1]);
    const ds = banda ? banda.no.a.DataSetName || banda.no.a.DataSet || '' : '';
    const campo = texto(args[0] ?? '').toUpperCase();
    return this.linhas(ds).some((r) => Object.keys(r).some((k) => k.toUpperCase() === campo));
  }

  /** os procedimentos do motor que o script chama: `Inc`/`Dec`, `Engine.NewPage`, `Engine.ShowBand(Banda)` */
  private procedimento(nome: string, args: Expr[]): boolean {
    if (nome === 'inc' || nome === 'dec') {
      if (args[0]?.k !== 'id') return false;
      const passo = args[1] ? numero(avaliar(args[1], this.amb, this.funcoes)) : 1;
      this.gravar(args[0].caminho, numero(this.ler(args[0].caminho)) + (nome === 'inc' ? passo : -passo));
      return true;
    }
    // `Banda.DataSet.GetFieldList(Lista)`: os campos do dataset da banda, na ordem (os nomes como o Delphi expõe — maiúsculas)
    const gl = /^(\w+)\.dataset\.getfieldlist$/.exec(nome);
    if (gl) {
      const lista = args[0]?.k === 'id' ? this.lista(args[0].caminho.join('.')) : undefined;
      const banda = this.estados.get(gl[1]);
      const ds = banda ? banda.no.a.DataSetName || banda.no.a.DataSet || '' : '';
      if (lista) { lista.length = 0; lista.push(...Object.keys(this.linhas(ds)[0] ?? {}).map((k) => k.toUpperCase())); }
      return true;
    }
    if (/\.free$/.test(nome)) return true;
    if (nome === 'engine.newpage') { this.ctx?.novaPagina(); return true; }
    if (nome === 'engine.showband') {
      const a = args[0];
      const alvo = a?.k === 'id' ? a.caminho.join('.') : a ? String(avaliar(a, this.amb, this.funcoes) ?? '') : '';
      if (alvo) this.ctx?.mostrarBanda(alvo);
      return true;
    }
    return false;
  }

  private evento(no: No, nomeEvento = 'OnBeforePrint'): void {
    const proc = no.a[nomeEvento];
    if (!proc) return;
    const corpo = this.prog.procedimentos.get(proc.toLowerCase());
    if (!corpo) return;
    const antes = this.remetente;
    this.remetente = no.a.Name ?? '';
    try { executar(corpo, this.amb, this.funcoes, this.prog); } catch { /* erro de script: segue como o preview */ }
    this.remetente = antes;
  }

  private estado(no: No): Estado | undefined { return no.a.Name ? this.estados.get(no.a.Name.toLowerCase()) : undefined; }

  /** o texto do memo; o memo ligado a campo (DataField) sem texto mostra o campo. */
  private modeloDoTexto(e: Estado, o: No): string {
    return e.Text || (o.a.DataField ? `[<${nomeDs(o.a.DataSetName || o.a.DataSet) || 'frxDBDataset2'}."${o.a.DataField}">]` : '');
  }

  /** expande os [ ] do texto de um memo com o DisplayFormat dele. */
  private expandir(tpl: string, no: No): string {
    const sep: Separadores = { decimal: no.a['DisplayFormat.DecimalSeparator'] || ',', milhar: no.a['DisplayFormat.ThousandSeparator'] || '.' };
    let out = '';
    let i = 0;
    while (i < tpl.length) {
      if (tpl[i] !== '[') { out += tpl[i++]; continue; }
      let prof = 0;
      let j = i;
      let aspas = false;
      for (; j < tpl.length; j++) {
        const c = tpl[j];
        if (c === "'") aspas = !aspas;
        if (aspas) continue;
        if (c === '[') prof++;
        else if (c === ']' && --prof === 0) break;
      }
      if (j >= tpl.length) { out += tpl.slice(i); break; }
      const src = tpl.slice(i + 1, j);
      let e = this.exprs.get(src);
      if (e === undefined) { try { e = compilarExpr(src); } catch { e = null; } this.exprs.set(src, e); }
      if (e) {
        let v: Valor = null;
        try { v = avaliar(e, this.amb, this.funcoes); } catch { v = null; }
        out += aplicarDisplayFormat(v, no.a['DisplayFormat.Kind'], no.a['DisplayFormat.FormatStr'], sep);
      }
      i = j + 1;
    }
    return out;
  }

  // ─── HTML dos objetos ───

  private htmlObjeto(no: No, e: Estado): string {
    if (!e.Visible) return '';
    const box = `left:${e.Left.toFixed(2)}px;top:${e.Top.toFixed(2)}px;width:${e.Width.toFixed(2)}px;height:${e.Height.toFixed(2)}px;`;
    const tag = no.tag;
    if (tag === 'TfrxMemoView' || tag === 'TfrxSysMemoView' || tag === 'TfrxDMPMemoView' || tag === 'TfrxRichView') {
      const f = tag === 'TfrxDMPMemoView' ? { nome: 'Courier New', px: 14, estilo: 0, cor: '#000000' } : fonte(no);
      const fundo = cor(no.a['Fill.BackColor'] ?? no.a.Color);
      const ft = n(no.a['Frame.Typ']);
      const fw = n(no.a['Frame.Width'], 1);
      const fc = cor(no.a['Frame.Color'], '#000000') ?? '#000000';
      const borda = ft ? `${ft & 1 ? `border-left:${fw}px solid ${fc};` : ''}${ft & 2 ? `border-right:${fw}px solid ${fc};` : ''}${ft & 4 ? `border-top:${fw}px solid ${fc};` : ''}${ft & 8 ? `border-bottom:${fw}px solid ${fc};` : ''}` : '';
      const ha = { haRight: 'right', haCenter: 'center', haBlock: 'justify' }[no.a.HAlign ?? ''] ?? 'left';
      const va = { vaCenter: 'center', vaBottom: 'flex-end' }[no.a.VAlign ?? ''] ?? 'flex-start';
      const gx = n(no.a.GapX, 2);
      const gy = n(no.a.GapY, 1);
      const ls = n(no.a.LineSpacing, 2);
      const quebra = no.a.WordWrap === 'False' ? 'pre' : 'pre-wrap';
      const conteudo = esc(e.final ?? '');
      const interno = `display:flex;flex-direction:column;justify-content:${va};text-align:${ha};padding:${gy}px ${gx}px;white-space:${quebra};line-height:${(f.px * 1.15 + ls).toFixed(2)}px;${cssFonte(f)}`;
      const rot = n(no.a.Rotation) % 360;
      if (rot === 90 || rot === 270 || rot === 180) {
        const [w, h] = rot === 180 ? [e.Width, e.Height] : [e.Height, e.Width];
        const tr = rot === 90 ? `translateY(${e.Height}px) rotate(-90deg)` : rot === 270 ? `translateX(${e.Width}px) rotate(90deg)` : `translate(${e.Width}px,${e.Height}px) rotate(180deg)`;
        return `<div class="o" style="${box}${fundo ? `background:${fundo};` : ''}${borda}"><div style="position:absolute;left:0;top:0;width:${w.toFixed(2)}px;height:${h.toFixed(2)}px;transform-origin:0 0;transform:${tr};${interno}overflow:hidden">${conteudo}</div></div>`;
      }
      return `<div class="o" style="${box}${fundo ? `background:${fundo};` : ''}${borda}${interno}overflow:hidden">${conteudo}</div>`;
    }
    if (tag === 'TfrxBarCodeView') return this.htmlBarras(no, e);
    if (tag === 'TfrxLineView') {
      const x2 = e.Left + e.Width, y2 = e.Top + e.Height;
      const sw = n(no.a['Frame.Width'], 1);
      const c = cor(no.a['Frame.Color'] ?? no.a.Color, '#000000') ?? '#000000';
      const minX = Math.min(e.Left, x2) - sw, minY = Math.min(e.Top, y2) - sw;
      const w = Math.abs(e.Width) + 2 * sw, h = Math.abs(e.Height) + 2 * sw;
      return `<svg class="o" style="left:${minX.toFixed(2)}px;top:${minY.toFixed(2)}px;overflow:visible" width="${w.toFixed(2)}" height="${h.toFixed(2)}"><line x1="${(e.Left - minX).toFixed(2)}" y1="${(e.Top - minY).toFixed(2)}" x2="${(x2 - minX).toFixed(2)}" y2="${(y2 - minY).toFixed(2)}" stroke="${c}" stroke-width="${sw}"/></svg>`;
    }
    if (tag === 'TfrxShapeView') {
      const sw = n(no.a['Frame.Width'], 1);
      const c = cor(no.a['Frame.Color'], '#000000') ?? '#000000';
      const fundo = cor(no.a['Fill.BackColor'] ?? no.a.Color) ?? 'none';
      const W = e.Width, H = e.Height;
      const forma = no.a.Shape ?? 'skRectangle';
      let desenho: string;
      if (forma === 'skEllipse') desenho = `<ellipse cx="${W / 2}" cy="${H / 2}" rx="${Math.max(0, W / 2 - sw / 2)}" ry="${Math.max(0, H / 2 - sw / 2)}"/>`;
      else if (forma === 'skTriangle') desenho = `<polygon points="${W / 2},${sw / 2} ${W - sw / 2},${H - sw / 2} ${sw / 2},${H - sw / 2}"/>`;
      else if (forma === 'skDiamond') desenho = `<polygon points="${W / 2},${sw / 2} ${W - sw / 2},${H / 2} ${W / 2},${H - sw / 2} ${sw / 2},${H / 2}"/>`;
      else if (forma === 'skDiagonal1') desenho = `<line x1="0" y1="${H}" x2="${W}" y2="0"/>`;
      else if (forma === 'skDiagonal2') desenho = `<line x1="0" y1="0" x2="${W}" y2="${H}"/>`;
      else {
        const r = forma === 'skRoundRectangle' ? Math.min(W, H) / Math.max(1, n(no.a.Curve, 2) * 2) : 0;
        desenho = `<rect x="${sw / 2}" y="${sw / 2}" width="${Math.max(0, W - sw)}" height="${Math.max(0, H - sw)}" rx="${r}" ry="${r}"/>`;
      }
      return `<svg class="o" style="${box}overflow:visible" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}"><g fill="${fundo}" stroke="${c}" stroke-width="${sw}">${desenho}</g></svg>`;
    }
    if (tag === 'TfrxPictureView') {
      const src = figura(no.a['Picture.PropData']);
      if (!src) return '';
      const ajuste = no.a.Stretched === 'False' ? (no.a.Center === 'True' ? 'none' : 'none') : no.a.KeepAspectRatio === 'False' ? 'fill' : 'contain';
      return `<img class="o" style="${box}object-fit:${ajuste};${no.a.Center === 'True' ? 'object-position:center;' : 'object-position:left top;'}" src="${src}" alt=""/>`;
    }
    if (tag === 'TfrxCheckBoxView') {
      // marcado pelo script (`CheckBox1.Checked := True`), pelo campo ou pela propriedade do arquivo
      let marcado: unknown = e.extras.checked;
      if (marcado == null && no.a.DataField) marcado = this.campo(no.a.DataSetName || no.a.DataSet || '', no.a.DataField);
      if (marcado == null && no.a.Expression) marcado = this.avaliarTexto(no.a.Expression);
      if (marcado == null) marcado = no.a.Checked !== 'False';
      const sim = marcado === true || ['T', 'S', 'TRUE', '1', 'Y'].includes(String(marcado).toUpperCase());
      const cc = cor(no.a.CheckColor, '#000000') ?? '#000000';
      const marca = sim ? (no.a.CheckStyle === 'csCross' ? '✗' : no.a.CheckStyle === 'csLineCross' ? '╳' : '✓') : (no.a.UncheckStyle === 'usCross' ? '✗' : '');
      const lado = Math.min(e.Width, e.Height);
      return `<div class="o" style="${box}display:flex;align-items:center;justify-content:center;border:1px solid #000;color:${cc};font-size:${(lado * 0.8).toFixed(1)}px;line-height:1">${marca}</div>`;
    }
    if (tag === 'TfrxGradientView') {
      const a = cor(no.a.BeginColor, '#ffffff'), b = cor(no.a.EndColor, '#000000');
      const dir = no.a.Style === 'gsHorizontal' ? 'to right' : 'to bottom';
      return `<div class="o" style="${box}background:linear-gradient(${dir},${a},${b})"></div>`;
    }
    return '';
  }

  private htmlBarras(no: No, e: Estado): string {
    let valor = '';
    if (no.a.Expression) valor = texto(this.avaliarTexto(no.a.Expression));
    else if (no.a.DataField) valor = texto(this.campo(no.a.DataSetName || no.a.DataSet || '', no.a.DataField));
    else valor = no.a.Text ?? '';
    const zoom = n(no.a.Zoom, 1);
    const d = desenhar(no.a.BarType ?? '', valor.trim(), no.a.CalcCheckSum === 'True', n(no.a.WideBarRatio, 2));
    if (!d) return '';
    const mostra = no.a.ShowText !== 'False';
    const f = fonte(no);
    const fs = f.px;
    const recuo = (d.recuo ?? 0) * zoom;
    const W = recuo + d.modulos.length * zoom;
    const H = e.Height;
    const zonaTexto = mostra ? fs + 2 : 0;
    const hBarra = Math.max(1, H - zonaTexto);
    const hGuarda = mostra && d.guardas ? Math.max(1, H - zonaTexto / 2) : hBarra;
    let rects = '';
    for (let i = 0; i < d.modulos.length; i++) {
      if (d.modulos[i] !== '1') continue;
      let k = i;
      while (k + 1 < d.modulos.length && d.modulos[k + 1] === '1' && (!d.guardas || d.guardas.has(k + 1) === d.guardas.has(i))) k++;
      const h = d.guardas?.has(i) ? hGuarda : hBarra;
      rects += `<rect x="${(recuo + i * zoom).toFixed(2)}" y="0" width="${((k - i + 1) * zoom).toFixed(2)}" height="${h.toFixed(2)}"/>`;
      i = k;
    }
    let textos = '';
    if (mostra && d.texto) {
      for (const t of d.texto) {
        const x = recuo + t.x * zoom;
        const w = t.w * zoom;
        textos += `<text x="${(x + w / 2).toFixed(2)}" y="${(H - 1).toFixed(2)}" text-anchor="middle" font-family="${esc(familia(f.nome))}" font-size="${fs.toFixed(2)}"${t.s.length > 1 ? ` textLength="${(w * 0.92).toFixed(2)}" lengthAdjust="spacing"` : ''}>${esc(t.s)}</text>`;
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(2)}" height="${H.toFixed(2)}" viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}" fill="#000">${rects}${textos}</svg>`;
    const rot = n(no.a.Rotation) % 360;
    if (rot === 90 || rot === 270) {
      const tr = rot === 90 ? `translateY(${W}px) rotate(-90deg)` : `translateX(${H}px) rotate(90deg)`;
      return `<div class="o" style="left:${e.Left.toFixed(2)}px;top:${e.Top.toFixed(2)}px;width:${H.toFixed(2)}px;height:${W.toFixed(2)}px"><div style="position:absolute;left:0;top:0;transform-origin:0 0;transform:${tr}">${svg}</div></div>`;
    }
    return `<div class="o" style="left:${e.Left.toFixed(2)}px;top:${e.Top.toFixed(2)}px;width:${W.toFixed(2)}px;height:${H.toFixed(2)}px">${svg}</div>`;
  }

  /**
   * Uma passada de banda (TfrxEngine.ShowBand): eventos, GetData e o HTML; depois restaura Text/geometria e roda o OnAfterPrint. Sem
   * `y`, a banda vai para a altura corrente da página DEPOIS do evento — o evento pode ter aberto página (`Engine.NewPage`) ou desenhado
   * outras bandas antes dela (`Engine.ShowBand`).
   */
  private banda(b: No, x: number, y?: number): { html: string; altura: number } | null {
    const anterior = this.bandaAtual;
    this.bandaAtual = b;
    try { return this.desenharBanda(b, x, y); } finally { this.bandaAtual = anterior; }
  }

  private desenharBanda(b: No, x: number, y?: number): { html: string; altura: number } | null {
    const eb = this.estado(b);
    this.evento(b);
    if (eb && !eb.Visible) return null;
    const yy = y ?? this.ctx?.y() ?? 0;
    const objetos = b.filhos.filter((c) => c.a.Name && !BANDAS.has(c.tag));
    const salvos = objetos.map((o) => { const e = this.estado(o)!; return { e, Left: e.Left, Top: e.Top, Width: e.Width, Height: e.Height, Text: e.Text }; });
    for (const o of objetos) {
      const e = this.estado(o)!;
      this.evento(o);
      e.feito = true;
      if (e.Visible && /Memo|Rich/.test(o.tag)) e.final = this.expandir(this.modeloDoTexto(e, o), o);
    }
    const altura = eb ? eb.Height : n(b.a.Height);
    const html = `<div class="b" style="left:${x.toFixed(2)}px;top:${yy.toFixed(2)}px;width:${n(b.a.Width).toFixed(2)}px;height:${altura.toFixed(2)}px">${objetos.map((o) => this.htmlObjeto(o, this.estado(o)!)).join('')}</div>`;
    for (const s of salvos) { Object.assign(s.e, { Left: s.Left, Top: s.Top, Width: s.Width, Height: s.Height, Text: s.Text }); s.e.final = null; s.e.feito = false; }
    this.evento(b, 'OnAfterPrint');
    return { html, altura };
  }

  gerar(): PaginaSaida[] {
    const saida: PaginaSaida[] = [];
    try { executar(this.prog.principal, this.amb, this.funcoes, this.prog); } catch { /* script principal */ }
    this.evento(this.raiz, 'OnStartReport');
    // as páginas de sub-relatório (`TfrxSubreport Page="Page2"`) não saem sozinhas: as bandas delas rodam dentro da banda do subrelatório
    const paginasDeSub = new Set<string>();
    const juntarSubs = (no: No) => { if (no.tag === 'TfrxSubreport' && no.a.Page) paginasDeSub.add(no.a.Page.toLowerCase()); no.filhos.forEach(juntarSubs); };
    juntarSubs(this.raiz);
    for (const pg of this.raiz.filhos.filter((c) => PAGINAS.has(c.tag) && !paginasDeSub.has((c.a.Name ?? '').toLowerCase()))) {
      const ep = this.estado(pg);
      if (ep && !ep.Visible) continue;
      const W = n(pg.a.PaperWidth, 210), H = n(pg.a.PaperHeight, 297);
      const m: [number, number, number, number] = [n(pg.a.LeftMargin, pg.tag === 'TfrxDMPPage' ? 0 : 10), n(pg.a.TopMargin, pg.tag === 'TfrxDMPPage' ? 0 : 10), n(pg.a.RightMargin, pg.tag === 'TfrxDMPPage' ? 0 : 10), n(pg.a.BottomMargin, pg.tag === 'TfrxDMPPage' ? 0 : 10)];
      const util = (H - m[1] - m[3]) * PX_MM;
      const chave = `p${String(W).replace(/[^0-9]/g, '_')}x${String(H).replace(/[^0-9]/g, '_')}`;
      const bandas = pg.filhos.filter((c) => BANDAS.has(c.tag)).sort((a, b) => n(a.a.Top) - n(b.a.Top));
      const soltos = pg.filhos.filter((c) => !BANDAS.has(c.tag) && c.a.Name);
      const cab = bandas.filter((b) => b.tag === 'TfrxPageHeader');
      // ColumnHeader: logo abaixo do cabeçalho de toda página; ColumnFooter: no fim de toda página, depois do último dado
      const cabColuna = bandas.filter((b) => b.tag === 'TfrxColumnHeader');
      const rodColuna = bandas.filter((b) => b.tag === 'TfrxColumnFooter');
      const rod = bandas.filter((b) => b.tag === 'TfrxPageFooter');
      const titulo = bandas.filter((b) => b.tag === 'TfrxReportTitle');
      const resumo = bandas.filter((b) => b.tag === 'TfrxReportSummary');
      const alturaRod = rod.reduce((s, b) => s + n(b.a.Height), 0) + rodColuna.reduce((s, b) => s + n(b.a.Height), 0);
      const c = { atual: null as PaginaSaida | null, y: 0, fechando: false };
      const emitir = (html: string) => c.atual!.html.push(html);
      // definido mais abaixo (precisa do processador das bandas); o título da primeira página sai antes
      let subrelatorios: (b: No, y0: number, altura: number) => void = () => undefined;
      const mostrar = (b: No) => { const y0 = c.y; const r = this.banda(b, n(b.a.Left)); if (r) { emitir(r.html); c.y += r.altura; subrelatorios(b, y0, r.altura); } };
      const fechar = () => {
        if (!c.atual || c.fechando) return;
        c.fechando = true;
        for (const b of rodColuna) mostrar(b);
        this.fecharPagina(c.atual, rod, soltos, util);
        c.fechando = false;
      };
      const novaPagina = () => {
        fechar();
        this.pagina++;
        c.atual = { chave, larguraMm: W, alturaMm: H, margem: m, html: [] };
        saida.push(c.atual);
        c.y = 0;
        this.evento(pg);
        for (const b of cab) mostrar(b);
        for (const b of cabColuna) mostrar(b);
      };
      this.ctx = {
        y: () => c.y,
        novaPagina,
        mostrarBanda: (nome) => { const b = bandas.find((x) => (x.a.Name ?? '').toLowerCase() === nome.toLowerCase()); if (b) mostrar(b); },
      };
      // a banda cabe no que sobra da página (acima do rodapé); na página vazia sempre cabe
      const cabe = (h: number) => c.y + h <= util - alturaRod + 0.5 || c.y === 0;
      this.cursor.clear();
      this.recno = 0;
      this.eof = false;
      novaPagina();
      for (const b of titulo) mostrar(b);
      // as bandas de dados: a MasterData percorre o seu dataset; a DetailData logo abaixo dela (antes da próxima MasterData) roda a cada
      // linha do mestre — só as linhas do detalhe com `__MESTRE` = a linha do mestre, quando o dataset traz a ligação
      // o processador das bandas de dados de uma página (a principal, ou a de um sub-relatório rodando dentro de uma banda)
      const criarProcessador = (bandasP: No[]) => {
        const dadosP = bandasP.filter((b) => b.tag === 'TfrxMasterData');
        const todosDados = bandasP.filter((x) => x.tag === 'TfrxMasterData' || x.tag === 'TfrxDetailData');
        const detalhesDe = (b: No) => {
          const proximo = dadosP.find((d) => n(d.a.Top) > n(b.a.Top));
          return bandasP.filter((x) => x.tag === 'TfrxDetailData' && n(x.a.Top) > n(b.a.Top) && (!proximo || n(x.a.Top) < n(proximo.a.Top)));
        };
        const processar = (b: No, mestre?: number) => {
          const cols = Math.max(1, Math.trunc(n(b.a.Columns, 1)));
          const cw = n(b.a.ColumnWidth), gap = n(b.a.ColumnGap);
          const ds = b.a.DataSetName || b.a.DataSet || '';
          const todas = ds ? this.linhas(ds) : [];
          const indices = ds
            ? todas.map((_, i) => i).filter((i) => mestre == null || !('__MESTRE' in (todas[i] ?? {})) || Number(todas[i].__MESTRE) === mestre)
            : Array.from({ length: Math.trunc(n(b.a.RowCount)) }, (_, i) => i);
          const nomeBanda = (b.a.Name ?? '').toLowerCase();
          const impressas = this.impressas.get(nomeBanda) ?? [];
          this.impressas.set(nomeBanda, impressas);
          this.dsDaBanda.set(nomeBanda, ds);
          let col = 0;
          let alturaLinha = 0;
          // o Header/Footer e os grupos da banda são os que estão logo acima/abaixo dela, sem outra banda de dados no meio
          const entre = (de: number, ate: number) => !todosDados.some((d) => d !== b && n(d.a.Top) > de && n(d.a.Top) < ate);
          const header = bandasP.filter((x) => x.tag === 'TfrxHeader' && n(x.a.Top) < n(b.a.Top) && entre(n(x.a.Top), n(b.a.Top))).pop();
          const footer = bandasP.find((x) => x.tag === 'TfrxFooter' && n(x.a.Top) > n(b.a.Top) && entre(n(b.a.Top), n(x.a.Top)));
          const mostrarHeader = () => {
            if (!header) return;
            if (!cabe(n(header.a.Height) + n(b.a.Height))) novaPagina();
            mostrar(header);
          };
          // os grupos: GroupHeader acima (de fora para dentro, pela ordem de Top) e GroupFooter abaixo (de dentro para fora)
          const cabGrupo = bandasP.filter((x) => x.tag === 'TfrxGroupHeader' && n(x.a.Top) < n(b.a.Top) && entre(n(x.a.Top), n(b.a.Top)));
          const rodGrupo = bandasP.filter((x) => x.tag === 'TfrxGroupFooter' && n(x.a.Top) > n(b.a.Top) && entre(n(b.a.Top), n(x.a.Top)));
          const grupos = cabGrupo.map((h, k) => ({ h, f: rodGrupo[cabGrupo.length - 1 - k] as No | undefined, valor: undefined as string | undefined }));
          const condicao = (h: No): string => { try { return texto(avaliar(compilarExpr(h.a.Condition ?? ''), this.amb, this.funcoes)); } catch { return ''; } };
          // fecha os grupos do mais interno até `ate`, com o cursor na última linha do grupo (o FastReport volta um registro)
          const fecharGrupos = (ate: number, ultima: number) => {
            if (ds) this.posicionar(ds, ultima);
            for (let k = grupos.length - 1; k >= ate; k--) {
              const f = grupos[k].f;
              if (!f) continue;
              if (!cabe(n(f.a.Height))) novaPagina();
              mostrar(f);
            }
          };
          const temLinhas = indices.length > 0;
          if (temLinhas || b.a.PrintIfDetailEmpty === 'True') mostrarHeader();
          this.linhaBanda = 0;
          let anterior = -1;
          for (let k = 0; k < indices.length; k++) {
            const i = indices[k];
            if (ds) this.posicionar(ds, i);
            this.recno = i + 1;
            if (grupos.length) {
              const valores = grupos.map((g) => condicao(g.h));
              const nivel = k === 0 ? 0 : valores.findIndex((v, j) => v !== grupos[j].valor);
              if (nivel >= 0) {
                if (k > 0) { fecharGrupos(nivel, anterior); if (ds) this.posicionar(ds, i); }
                for (let j = nivel; j < grupos.length; j++) {
                  const g = grupos[j];
                  g.valor = valores[j];
                  // onde cada banda de dados estava quando o grupo começou: a agregada do rodapé soma dali em diante
                  if (g.f) this.inicioGrupo.set(g.f, new Map([...this.impressas].map(([nome, l]) => [nome, l.length])));
                  if (g.h.a.StartNewPage === 'True' && k > 0) novaPagina();
                  if (!cabe(n(g.h.a.Height) + n(b.a.Height))) novaPagina();
                  mostrar(g.h);
                }
                this.linhaBanda = 0;
              }
            }
            this.linhaBanda++;
            if (col === 0 && !cabe(n(b.a.Height))) {
              novaPagina();
              if (header?.a.ReprintOnNewPage === 'True') mostrarHeader();
              for (const g of grupos) if (g.h.a.ReprintOnNewPage === 'True') mostrar(g.h);
            }
            const x = n(b.a.Left) + (cols > 1 ? col * (cw + gap) : 0);
            impressas.push(i);
            const y0 = c.y;
            const r = this.banda(b, x);
            if (!r) { impressas.pop(); continue; }
            anterior = i;
            emitir(r.html);
            alturaLinha = Math.max(alturaLinha, r.altura);
            col++;
            if (col >= cols) { col = 0; c.y += alturaLinha; alturaLinha = 0; }
            if (cols === 1) { subrelatorios(b, y0, r.altura); if (ds) this.posicionar(ds, i); }
            if (b.tag === 'TfrxMasterData') {
              const detalhes = detalhesDe(b);
              if (detalhes.length) {
                if (col > 0) { c.y += alturaLinha; alturaLinha = 0; col = 0; }
                const linhaMestre = this.linhaBanda;
                for (const d of detalhes) processar(d, i);
                if (ds) this.posicionar(ds, i);
                this.recno = i + 1;
                this.linhaBanda = linhaMestre;
              }
            }
          }
          if (col > 0) c.y += alturaLinha;
          if (mestre == null) this.eof = true;
          if (grupos.length && anterior >= 0) fecharGrupos(0, anterior);
          if (footer && (temLinhas || b.a.PrintIfDetailEmpty === 'True')) {
            if (!cabe(n(footer.a.Height))) novaPagina();
            mostrar(footer);
          }
        };
        return { dados: dadosP, processar };
      };
      const principal = criarProcessador(bandas);
      // `TfrxSubreport` numa banda: as bandas da página dele correm a partir da posição do objeto; a banda cresce até o fim delas
      subrelatorios = (b: No, y0: number, altura: number) => {
        const subs = b.filhos.filter((o) => o.tag === 'TfrxSubreport' && o.a.Page).sort((a, z) => n(a.a.Top) - n(z.a.Top));
        if (!subs.length) return;
        // o estado da banda de fora (Eof, [Line#], RecNo) não muda por causa do sub-relatório
        const [eof, linha, recno] = [this.eof, this.linhaBanda, this.recno];
        let fim = y0;
        for (const sr of subs) {
          const e = this.estado(sr);
          if (e && !e.Visible) continue;
          const pagina = this.raiz.filhos.find((p) => PAGINAS.has(p.tag) && (p.a.Name ?? '').toLowerCase() === (sr.a.Page ?? '').toLowerCase());
          if (!pagina) continue;
          c.y = Math.max(y0 + n(sr.a.Top), fim);
          const sub = criarProcessador(pagina.filhos.filter((x) => BANDAS.has(x.tag)).sort((a, z) => n(a.a.Top) - n(z.a.Top)));
          for (const d of sub.dados) sub.processar(d);
          fim = c.y;
        }
        c.y = Math.max(fim, y0 + altura);
        [this.eof, this.linhaBanda, this.recno] = [eof, linha, recno];
      };
      for (const b of principal.dados) principal.processar(b);
      this.eof = true;
      for (const b of resumo) {
        if (!cabe(n(b.a.Height))) novaPagina();
        mostrar(b);
      }
      fechar();
      this.ctx = null;
    }
    return saida;
  }

  private fecharPagina(p: PaginaSaida, rod: No[], soltos: No[], util: number): void {
    let y = util - rod.reduce((s, b) => s + n(b.a.Height), 0);
    for (const b of rod) { const r = this.banda(b, n(b.a.Left), y); if (r) { p.html.push(r.html); y += r.altura; } }
    // objetos soltos na página (fora de banda): saem em toda página, na posição do arquivo
    for (const o of soltos) {
      const e = this.estado(o)!;
      this.evento(o);
      e.feito = true;
      if (e.Visible && /Memo|Rich/.test(o.tag)) e.final = this.expandir(this.modeloDoTexto(e, o), o);
      p.html.push(this.htmlObjeto(o, e));
      e.final = null; e.feito = false;
    }
  }
}

export interface TrabalhoImpressao { modelo: string; registros: Registro[] | Conjuntos; variaveis?: Record<string, string>; textos?: Record<string, string> }

/** as páginas de um trabalho de impressão (um Imprimir(frxReport1) do legado). */
export function paginasDoModelo(xml: string, dados: Registro[] | Conjuntos, agora = new Date(), variaveis: Record<string, string> = {}, textos: Record<string, string> = {}): PaginaSaida[] {
  // [TotalPages#] pede a contagem antes: a primeira passada só conta as páginas (o DoublePass do FastReport)
  const total = /TotalPages#/i.test(xml) ? new Relatorio(xml, dados, agora, variaveis, 0, textos).gerar().length : 0;
  return new Relatorio(xml, dados, agora, variaveis, total, textos).gerar();
}

/** o documento HTML da impressão: cada tamanho de papel vira uma @page nomeada, uma etiqueta/folha por página. */
export function documentoDeImpressao(trabalhos: TrabalhoImpressao[], modelos: Record<string, string>, agora = new Date(), titulo = 'Etiquetas'): { html: string; paginas: number; avisos: string[] } {
  const paginas: PaginaSaida[] = [];
  const avisos: string[] = [];
  for (const t of trabalhos) {
    const xml = modelos[t.modelo];
    if (!xml) { avisos.push(`Modelo "${t.modelo}" não encontrado.`); continue; }
    try { paginas.push(...paginasDoModelo(xml, t.registros, agora, t.variaveis, t.textos)); } catch (e) { avisos.push(`Modelo "${t.modelo}": ${(e as Error).message}`); }
  }
  const tamanhos = new Map<string, PaginaSaida>();
  for (const p of paginas) tamanhos.set(p.chave, p);
  const css = [
    '*{box-sizing:border-box;margin:0;padding:0}',
    'html,body{background:#e8e8e8}',
    'body{padding:12px;display:flex;flex-direction:column;align-items:center;gap:10px}',
    '.pg{position:relative;overflow:hidden;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25)}',
    '.ar{position:absolute}',
    '.b{position:absolute}',
    '.o{position:absolute;box-sizing:border-box}',
    '@page{margin:0}',
    ...[...tamanhos.values()].map((p) => `@page ${p.chave}{size:${p.larguraMm}mm ${p.alturaMm}mm;margin:0}`),
    '@media print{html,body{background:none}body{padding:0;display:block}.pg{box-shadow:none}.pg+.pg{break-before:page}}',
  ].join('\n');
  const corpo = paginas.map((p) => `<section class="pg" style="width:${p.larguraMm}mm;height:${p.alturaMm}mm;page:${p.chave}"><div class="ar" style="left:${p.margem[0]}mm;top:${p.margem[1]}mm;width:${(p.larguraMm - p.margem[0] - p.margem[2]).toFixed(3)}mm;height:${(p.alturaMm - p.margem[1] - p.margem[3]).toFixed(3)}mm">${p.html.join('')}</div></section>`).join('\n');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${css}</style></head><body>${corpo}<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script></body></html>`;
  return { html, paginas: paginas.length, avisos };
}
