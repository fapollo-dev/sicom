import { BusinessRuleError } from '../../shared/errors/app-error';

/**
 * O `MontaRelatorio` do construtor (uRelatorio.pas:1603): o relatório não tem layout próprio — o legado carrega
 * `Config\RelatorioGeral_SemGrupo.fr3` (sem agrupamento), `RelatorioGeral_ComGrupo.fr3` ou `RelatorioGeral_ComSalto.fr3` (com quebra
 * de página por grupo) e cria em código os objetos de cada coluna: o título no PageHeader (no GroupHeader quando salta página), o campo
 * no MasterData, o SUM no ReportSummary e no GroupFooter, o cabeçalho do grupo com a concatenação dos campos dele. Aqui o mesmo, sobre o
 * XML do modelo: as bandas acham-se pelo nome que o legado usa no `FindObject` e os objetos entram com as propriedades que ele atribui.
 */

/** o tipo do campo no cdsDados (o que decide alinhamento e formato no legado) */
export type TipoCampoFr3 = 'inteiro' | 'decimal' | 'data' | 'texto';

export interface ColunaFr3 {
  /** o nome do campo no `frxDBDatasetDados` */
  campo: string;
  /** o campo da fonte (o laço do legado compara com o do grupo) */
  origem: string;
  titulo: string;
  /** o TAMANHO efetivo (o `ProcessaSQL` já resolveu o limite/máximo) */
  tamanho: number;
  tipo: TipoCampoFr3;
  totalizar: boolean;
}

export interface OpcoesRelatorioGeral {
  titulo: string;
  paisagem: boolean;
  quebraPagina: boolean;
  somenteAgrupamento: boolean;
  /** as colunas na ordem do cdsDados (todas, inclusive a do grupo — o laço do legado pula só o último campo do grupo) */
  colunas: ColunaFr3[];
  /** os campos do grupo (cdsAgrupar), na ordem: o nome no dataset, o campo da fonte e o tipo */
  grupo: Array<{ campo: string; origem: string; tipo: TipoCampoFr3 }>;
  /** o tamanho (Field.Size) do campo do grupo — o desconto do TotalRel */
  tamanhoCampoGrupo: number;
  textoWhere: string;
  empresa: { fantasia: string; logradouro: string };
  totalRegistros: number;
}

const num = (n: number): string => {
  const r = Math.round(n * 100000) / 100000;
  return String(r).replace('.', ',');
};
const xmlAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&#34;').replace(/</g, '&#60;').replace(/>/g, '&#62;').replace(/\r?\n/g, '&#13;&#10;');

/** Font.Size → Font.Height (pixels a 96 dpi, negativo) */
const altura = (pt: number) => -Math.round((pt * 96) / 72);

interface Memo {
  nome: string; left: number; top: number; width?: number; height: number; texto: string;
  fonte?: { nome: string; pt: number; negrito?: boolean; cor?: number };
  hAlign?: 'haLeft' | 'haRight' | 'haCenter'; wordWrap?: boolean; autoWidth?: boolean;
  formato?: { str: string; kind: 'fkNumeric' | 'fkDateTime' }; hideZeros?: boolean; dataset?: string;
}

function memoXml(m: Memo): string {
  const a: string[] = [`Name="${m.nome}"`, `Left="${num(m.left)}"`, `Top="${num(m.top)}"`, `Width="${num(m.width ?? 0)}"`, `Height="${num(m.height)}"`, 'ShowHint="False"'];
  if (m.autoWidth) a.push('AutoWidth="True"');
  if (m.dataset) a.push(`DataSet="${m.dataset}"`, `DataSetName="${m.dataset}"`);
  if (m.formato) a.push(`DisplayFormat.FormatStr="${xmlAttr(m.formato.str)}"`, `DisplayFormat.Kind="${m.formato.kind}"`);
  if (m.fonte) {
    a.push('Font.Charset="1"', `Font.Color="${m.fonte.cor ?? 0}"`, `Font.Height="${altura(m.fonte.pt)}"`, `Font.Name="${m.fonte.nome}"`, `Font.Style="${m.fonte.negrito ? 1 : 0}"`);
  }
  if (m.hAlign) a.push(`HAlign="${m.hAlign}"`);
  if (m.hideZeros) a.push('HideZeros="True"');
  if (m.fonte) a.push('ParentFont="False"');
  if (m.wordWrap === false) a.push('WordWrap="False"');
  a.push(`Text="${xmlAttr(m.texto)}"`);
  return `<TfrxMemoView ${a.join(' ')}/>`;
}

const linhaXml = (nome: string, left: number, top: number, width: number): string =>
  `<TfrxLineView Name="${nome}" Left="${num(left)}" Top="${num(top)}" Width="${num(width)}" Height="0" ShowHint="False" Frame.Typ="4"/>`;

/** o XML do modelo, com operações por nome de banda/objeto */
class Modelo {
  constructor(public xml: string) {}

  private abertura(tagOuNome: string): { ini: number; fim: number; tag: string; fechado: boolean } | null {
    const re = new RegExp(`<(Tfrx\\w+) Name="${tagOuNome}"[^>]*?(/?)>`);
    const m = re.exec(this.xml);
    if (!m) return null;
    return { ini: m.index, fim: m.index + m[0].length, tag: m[1], fechado: m[2] === '/' };
  }

  existe(nome: string): boolean { return this.abertura(nome) != null; }

  /** muda (ou cria) um atributo do objeto */
  atributo(nome: string, attr: string, valor: string): void {
    const a = this.abertura(nome);
    if (!a) return;
    let tag = this.xml.slice(a.ini, a.fim);
    const re = new RegExp(`\\s${attr.replace(/\./g, '\\.')}="[^"]*"`);
    tag = re.test(tag) ? tag.replace(re, ` ${attr}="${valor}"`) : tag.replace(/\s*(\/?)>$/, ` ${attr}="${valor}"$1>`);
    this.xml = this.xml.slice(0, a.ini) + tag + this.xml.slice(a.fim);
  }

  /** o `Banda.Clear`: tira os objetos da banda */
  limpar(nome: string): void {
    const a = this.abertura(nome);
    if (!a || a.fechado) return;
    const fecha = this.xml.indexOf(`</${a.tag}>`, a.fim);
    if (fecha < 0) return;
    this.xml = this.xml.slice(0, a.fim) + this.xml.slice(fecha);
  }

  /** o `TfrxMemoView.Create(Banda)`: o objeto entra no fim da banda */
  inserir(nome: string, filho: string): void {
    const a = this.abertura(nome);
    if (!a) return;
    if (a.fechado) {
      const tag = this.xml.slice(a.ini, a.fim).replace(/\s*\/>$/, '>');
      this.xml = `${this.xml.slice(0, a.ini)}${tag}${filho}</${a.tag}>${this.xml.slice(a.fim)}`;
      return;
    }
    const fecha = this.xml.indexOf(`</${a.tag}>`, a.fim);
    this.xml = this.xml.slice(0, fecha) + filho + this.xml.slice(fecha);
  }

  lerAtributo(nome: string, attr: string): string | null {
    const a = this.abertura(nome);
    if (!a) return null;
    const m = new RegExp(`\\s${attr.replace(/\./g, '\\.')}="([^"]*)"`).exec(this.xml.slice(a.ini, a.fim));
    return m ? m[1] : null;
  }
}

/** as dimensões da página em unidades do FastReport (96 dpi): (papel − margens) × 3,7795 */
const PX_MM = 96 / 25.4;

export function montarRelatorioGeral(modelo: string, o: OpcoesRelatorioGeral): string {
  const m = new Modelo(modelo);
  const comGrupo = o.grupo.length > 0;
  const ds = 'frxDBDatasetDados';
  const somente = o.somenteAgrupamento && comGrupo;
  const salto = o.quebraPagina && comGrupo;

  // as alturas das bandas
  let alturaGH = 0;
  if (comGrupo) {
    alturaGH = salto ? 30 : 15;
    if (somente) alturaGH = 0;
    m.atributo('GrupoHeader', 'Height', num(alturaGH));
    m.atributo('GroupFooterDados', 'Height', '16');
  }
  m.atributo('MasterDataDados', 'Height', somente ? '0' : '15');
  m.atributo('MasterDataDados', 'DataSet', ds);
  m.atributo('MasterDataDados', 'DataSetName', ds);
  const alturaPH = salto ? 130 : 16;
  m.atributo('PageHeaderDados', 'Height', num(alturaPH));
  if (salto) m.atributo('GrupoHeader', 'StartNewPage', 'True');
  m.atributo('ReportSummaryDados', 'Height', '15');

  // retrato/paisagem (TotalRel: a soma dos TAMANHOs menos o tamanho do campo do grupo)
  const total = o.colunas.reduce((s, c) => s + c.tamanho, 0);
  const totalRel = comGrupo && o.colunas.some((c) => c.origem === o.grupo[o.grupo.length - 1].origem) ? total - o.tamanhoCampoGrupo : total;
  if (totalRel > 157) {
    throw new BusinessRuleError('RELATORIO_ULTRAPASSA_MARGEM', { total: totalRel },
      'As colunas ultrapassam a margem da folha. \nRetrato: 113, Paisagem: 157. Verifique!');
  }
  const paisagem = total > 113 || o.paisagem;
  const pagina = /<TfrxReportPage Name="([^"]+)"/.exec(m.xml)?.[1] ?? 'PageDados';
  const margem = (k: string) => Number(String(m.lerAtributo(pagina, k) ?? '10').replace(',', '.'));
  if (paisagem) {
    m.atributo(pagina, 'PaperWidth', '297'); m.atributo(pagina, 'PaperHeight', '210'); m.atributo(pagina, 'PaperSize', '9'); m.atributo(pagina, 'Orientation', 'poLandscape');
  } else {
    m.atributo(pagina, 'PaperWidth', '210'); m.atributo(pagina, 'PaperHeight', '297'); m.atributo(pagina, 'PaperSize', '9');
  }
  const larguraPagina = ((paisagem ? 297 : 210) - margem('LeftMargin') - margem('RightMargin')) * PX_MM;

  m.limpar('MasterDataDados');
  m.limpar('ReportSummaryDados');
  if (comGrupo) {
    m.limpar('GrupoHeader');
    m.limpar('GroupFooterDados');
    if (o.colunas.some((c) => c.totalizar) && !somente) {
      m.inserir('GroupFooterDados', memoXml({ nome: 'GrooupFooterTituloTotal', left: 0, top: 0, height: 16, autoWidth: true, wordWrap: false, texto: 'Total: ',
        fonte: { nome: 'tahoma', pt: 8, negrito: true, cor: 0 } }));
    }
  }
  const titulo = salto ? 'PageHeaderDados' : 'ReportTitleDados';

  // as condições (cdsWhere): "Campo: valor, …"
  let fimWhere: number | null = null;
  if (o.textoWhere) {
    m.inserir(titulo, memoXml({ nome: 'MemoCabecalho_where', left: 0, top: 100, height: 19, autoWidth: true, texto: o.textoWhere, hAlign: 'haLeft',
      fonte: { nome: 'tahoma', pt: 10, negrito: true } }));
    fimWhere = 119;
  }
  // o título do relatório: o MemoCabecalho2 do modelo; sem ele, um novo abaixo das condições
  if (o.titulo) {
    if (m.existe('MemoCabecalho2')) m.atributo('MemoCabecalho2', 'Text', xmlAttr(o.titulo));
    else m.inserir(titulo, memoXml({ nome: 'MemoCabecalho2', left: 0, top: fimWhere ?? 0, height: 19, autoWidth: true, texto: o.titulo, fonte: { nome: 'tahoma', pt: 10, negrito: true } }));
  }
  // a linha embaixo do cabeçalho da página
  m.inserir('PageHeaderDados', linhaXml('LineCabecalho', 0, salto ? alturaPH + 5 : alturaPH, larguraPagina));
  let leftTexto = comGrupo ? 10 : 0;

  if (o.colunas.some((c) => c.totalizar)) {
    m.inserir('ReportSummaryDados', linhaXml('LineSumaryCabecalho', 0, 0, larguraPagina));
    m.inserir('ReportSummaryDados', memoXml({ nome: 'MemoSumaryTitulo', left: 0, top: 0, height: 15, autoWidth: true, wordWrap: false, texto: 'Total: ',
      fonte: { nome: 'tahoma', pt: 8, negrito: true, cor: 0x000080 } }));
  }

  // o agrupamento: a Condition é a concatenação dos campos; o cabeçalho, os valores separados por espaço
  if (comGrupo) {
    const ref = (g: { campo: string; tipo: TipoCampoFr3 }) => (g.tipo === 'texto' ? `<${ds}."${g.campo}">` : `VarToStr(<${ds}."${g.campo}">)`);
    const exp = o.grupo.map(ref).join(' + ');
    const tit = o.grupo.map((g) => `${ref(g)} + chr(32) `).join('+');
    m.atributo('GrupoHeader', 'Condition', xmlAttr(exp));
    if (!somente) {
      m.inserir('GrupoHeader', memoXml({ nome: 'MemoCampoGrupo', left: 0, top: 5, width: larguraPagina, height: alturaGH, dataset: ds, texto: `[(${tit})]`,
        fonte: { nome: 'tahoma', pt: 8, negrito: true } }));
    }
  }

  const ultimoGrupo = comGrupo ? o.grupo[o.grupo.length - 1] : null;
  const numerico = (t: TipoCampoFr3) => t === 'inteiro' || t === 'decimal';
  o.colunas.forEach((c, i) => {
    if (ultimoGrupo && c.origem === ultimoGrupo.origem) return;
    let width = c.tamanho * 6.5;
    if (c.totalizar) width += 20;
    const leftCol = somente ? leftTexto + width + 10 : leftTexto;
    // o título da coluna
    m.inserir(salto ? 'GrupoHeader' : 'PageHeaderDados', memoXml({ nome: `MemoTitulo${i}`, left: leftCol, top: salto ? alturaGH - 15 : alturaPH - 20, width, height: alturaPH,
      wordWrap: false, texto: c.titulo, fonte: { nome: 'tahoma', pt: 8, negrito: true }, hAlign: numerico(c.tipo) ? 'haRight' : undefined }));
    // o campo
    if (!somente) {
      m.inserir('MasterDataDados', memoXml({ nome: `MemoCampo${i}`, left: leftTexto, top: 0, width, height: 15, dataset: ds, texto: `[${ds}."${c.campo}"]`,
        fonte: { nome: 'tahoma', pt: 8 }, hAlign: numerico(c.tipo) ? 'haRight' : undefined,
        formato: c.tipo === 'decimal' ? { str: '%2.2n', kind: 'fkNumeric' } : c.tipo === 'data' ? { str: 'dd/mm/yyyy', kind: 'fkDateTime' } : undefined,
        hideZeros: c.tipo === 'data' }));
    }
    if (c.totalizar) {
      const soma = `[SUM(<${ds}."${c.campo}">,MasterDataDados)]`;
      m.inserir('ReportSummaryDados', memoXml({ nome: `MemoSumary${i}`, left: leftCol, top: 0, width, height: 15, texto: soma,
        fonte: { nome: 'tahoma', pt: 8, negrito: true, cor: 0x000080 }, formato: { str: '%2.2n', kind: 'fkNumeric' }, hAlign: 'haRight' }));
      if (comGrupo) {
        m.inserir('GroupFooterDados', memoXml({ nome: `GrooupFooter${i}`, left: leftCol, top: 0, width, height: 16, texto: soma,
          fonte: { nome: 'tahoma', pt: 8, negrito: true, cor: 0 }, formato: { str: '%2.2n', kind: 'fkNumeric' }, hAlign: 'haRight' }));
        if (somente) {
          // "mostrar apenas os dados agrupados": o valor do grupo no rodapé, à esquerda, com a largura do campo do grupo
          const colGrupo = o.colunas.find((x) => x.origem === ultimoGrupo?.origem);
          const wGrupo = colGrupo ? colGrupo.tamanho * 6.5 : 0;
          m.inserir('GroupFooterDados', memoXml({ nome: `GrooupFooter${i}DET`, left: 0, top: 0, width: wGrupo, height: 16, texto: `[${ds}."${ultimoGrupo?.campo}"]` }));
          if (i === 1) {
            // o índice 1 do laço do legado: o título do campo do grupo à esquerda e as colunas totalizadas depois dele
            const novoLeft = leftTexto + wGrupo + 10;
            m.atributo(`GrooupFooter${i}`, 'Left', num(novoLeft));
            m.atributo(`MemoTitulo${i}`, 'Left', num(novoLeft));
            m.atributo(`MemoSumary${i}`, 'Left', num(novoLeft));
            m.inserir(salto ? 'GrupoHeader' : 'PageHeaderDados', memoXml({ nome: `MemoTitulo${i}GROUP`, left: 0, top: salto ? alturaGH - 15 : alturaPH - 20, width: wGrupo,
              height: alturaPH, wordWrap: false, texto: colGrupo?.titulo ?? c.campo, fonte: { nome: 'tahoma', pt: 8, negrito: true },
              hAlign: colGrupo && numerico(colGrupo.tipo) ? 'haRight' : undefined }));
          }
        }
      }
    }
    leftTexto += width + 4;
  });

  // o total de registros, a empresa (o legado troca os textos do modelo pelos dados da loja)
  m.atributo('MemoTotalRegistros', 'AutoWidth', 'True');
  m.atributo('MemoTotalRegistros', 'Text', xmlAttr(`Total de Registros: ${o.totalRegistros}`));
  m.atributo('frxDBDataset1RAZAOSOCIAL', 'Text', xmlAttr(o.empresa.fantasia));
  m.atributo('frxDBDataset1LOGRADOURO', 'Text', xmlAttr(o.empresa.logradouro));
  return m.xml;
}
