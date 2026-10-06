#!/usr/bin/env python3
"""
Relatórios EMBUTIDOS no .dfm → .fr3 (XML do FastReport).

Algumas telas do legado não carregam o layout de `Relatorios\\*.fr3` (nem da RELATORIOS): imprimem o `TfrxReport` desenhado dentro do
próprio formulário (o `uRelBalanco` e o `uSimuladorVenda`). O layout está no .dfm em texto; este conversor lê o objeto `TfrxReport` e
escreve o XML que o FastReport gravaria para ele — o motor `.fr3` do Apollo lê esse XML como qualquer layout da RELATORIOS.

Uso:
  dfm-para-fr3.py <arquivo.dfm> <objeto TfrxReport> <saida.fr3>            (um layout)
  dfm-para-fr3.py --gerar-ts                                                  (regera o módulo da API com a lista EMBUTIDOS abaixo)

Mapeamentos (o que o XML do FastReport grava diferente do .dfm): Memo.UTF8W/UTF8/Strings → Text; ScriptText.Strings → ScriptText.Text;
Font.Charset (DEFAULT_CHARSET = 1), Font.Color e Color (clBlack = 0...), Font.Style e Frame.Typ (conjuntos → soma dos bits); números
com vírgula decimal; as coleções Datasets/Variables viram elementos <item/>. Imagens ({...} binário) ficam de fora — a do cabeçalho é o
logorel.jpg que o legado carrega em tempo de execução.
"""
import json
import re
import sys
from pathlib import Path

FONTES = Path('/Library/SicomGit/retaguarda-master/fonte/Units')
APOLLO = Path(__file__).resolve().parents[2]
# (formulário.objeto, arquivo .dfm) — o nome é a chave que o serviço pede em `modeloEmbutido`
EMBUTIDOS = [
    ('frmRelBalanco.frxReport1', 'uRelBalanco.dfm'),
]

CORES = {
    'clBlack': 0, 'clMaroon': 128, 'clGreen': 32768, 'clOlive': 32896, 'clNavy': 8388608, 'clPurple': 8388736, 'clTeal': 8421376,
    'clGray': 8421504, 'clSilver': 12632256, 'clRed': 255, 'clLime': 65280, 'clYellow': 65535, 'clBlue': 16711680, 'clFuchsia': 16711935,
    'clAqua': 16776960, 'clWhite': 16777215, 'clNone': 536870911, 'clDefault': 536870912, 'clWindowText': -16777208,
    'clBtnFace': -16777201, 'clWindow': -16777211, 'clHighlight': -16777203, 'clHighlightText': -16777202, 'clBtnShadow': -16777200,
    'clGrayText': -16777199, 'clInfoBk': -16777192, 'clMoneyGreen': 12639424, 'clSkyBlue': 15780518, 'clCream': 15793151,
    'clMedGray': 10789024,
}
CHARSETS = {'ANSI_CHARSET': 0, 'DEFAULT_CHARSET': 1, 'SYMBOL_CHARSET': 2, 'OEM_CHARSET': 255, 'EASTEUROPE_CHARSET': 238}
BITS = {'fsBold': 1, 'fsItalic': 2, 'fsUnderline': 4, 'fsStrikeOut': 8, 'ftLeft': 1, 'ftRight': 2, 'ftTop': 4, 'ftBottom': 8}


class Leitor:
    """o tokenizador do .dfm em texto (o formato do `ObjectBinaryToText`)"""

    def __init__(self, texto: str):
        self.s = texto
        self.i = 0

    def espaco(self):
        while self.i < len(self.s) and self.s[self.i] in ' \t\r\n':
            self.i += 1

    def ver(self, n=1):
        self.espaco()
        return self.s[self.i:self.i + n]

    def palavra(self):
        self.espaco()
        m = re.compile(r'[A-Za-z_][A-Za-z0-9_.]*').match(self.s, self.i)
        if not m:
            raise ValueError(f'identificador esperado em {self.i}: {self.s[self.i:self.i + 40]!r}')
        self.i = m.end()
        return m.group(0)

    def cadeia(self):
        """'abc'#13#10'def' + (quebra) 'ghi' — devolve a lista de code points/bytes como str"""
        out = []
        self.espaco()
        while True:
            c = self.s[self.i:self.i + 1]
            if c == "'":
                j = self.i + 1
                buf = []
                while True:
                    k = self.s.index("'", j)
                    buf.append(self.s[j:k])
                    if self.s[k + 1:k + 2] == "'":
                        buf.append("'")
                        j = k + 2
                        continue
                    self.i = k + 1
                    break
                out.append(''.join(buf))
            elif c == '#':
                m = re.compile(r'#(\d+)').match(self.s, self.i)
                out.append(chr(int(m.group(1))))
                self.i = m.end()
            else:
                break
            # a concatenação: a parte seguinte COLADA ('abc'#13'def') ou depois de um '+' (a quebra de linha do ObjectBinaryToText);
            # cadeias vizinhas separadas por espaço/linha são itens diferentes de uma lista
            if self.s[self.i:self.i + 1] in ("'", '#'):
                continue
            j = self.i
            while j < len(self.s) and self.s[j] in ' \t\r\n':
                j += 1
            if self.s[j:j + 1] == '+':
                self.i = j + 1
                self.espaco()
                continue
            break
        return ''.join(out)

    def valor(self):
        c = self.ver()
        if c in ("'", '#'):
            return ('str', self.cadeia())
        if c == '(':
            self.i += 1
            itens = []
            while self.ver() != ')':
                itens.append(self.valor())
            self.i += 1
            return ('lista', itens)
        if c == '[':
            j = self.s.index(']', self.i)
            nomes = [x.strip() for x in self.s[self.i + 1:j].split(',') if x.strip()]
            self.i = j + 1
            return ('set', nomes)
        if c == '<':
            self.i += 1
            itens = []
            while self.ver() != '>':
                assert self.palavra() == 'item'
                props = []
                while self.ver(3) != 'end' or re.match(r'end\b', self.s[self.i:]) is None:
                    nome = self.palavra()
                    self.espaco()
                    assert self.s[self.i] == '='
                    self.i += 1
                    props.append((nome, self.valor()))
                self.i += 3
                itens.append(props)
            self.i += 1
            return ('colecao', itens)
        if c == '{':
            j = self.s.index('}', self.i)
            self.i = j + 1
            return ('bin', None)
        m = re.compile(r'-?\d+(\.\d+)?([eE][-+]?\d+)?').match(self.s, self.i)
        if m and (c.isdigit() or c == '-'):
            self.i = m.end()
            return ('num', m.group(0))
        return ('id', self.palavra())

    def objeto(self):
        tipo = self.palavra()  # object | inherited | inline
        nome = self.palavra()
        self.espaco()
        assert self.s[self.i] == ':'
        self.i += 1
        classe = self.palavra()
        if self.ver() == '[':  # índice do inherited: [3]
            self.i = self.s.index(']', self.i) + 1
        props, filhos = [], []
        while True:
            w = self.ver(9)
            if re.match(r'end\b', w):
                self.i += 3
                return {'nome': nome, 'classe': classe, 'props': props, 'filhos': filhos, 'tipo': tipo}
            if re.match(r'(object|inherited|inline)\b', w):
                filhos.append(self.objeto())
                continue
            nome_p = self.palavra()
            self.espaco()
            assert self.s[self.i] == '=', (nome_p, self.s[self.i:self.i + 30])
            self.i += 1
            props.append((nome_p, self.valor()))


def achar_objeto(texto: str, nome: str):
    m = re.search(r'^\s*(object|inherited) ' + re.escape(nome) + r':', texto, re.M)
    if not m:
        raise SystemExit(f'objeto {nome} não achado')
    lt = Leitor(texto)
    lt.i = m.start()
    return lt.objeto()


def numero(v: str) -> str:
    if '.' in v or 'e' in v.lower():
        f = float(v)
        s = repr(round(f, 10))
        if s.endswith('.0'):
            s = s[:-2]
        return s.replace('.', ',')
    return v


def texto_do(v, utf8: bool) -> str:
    s = v[1]
    if utf8:  # Memo.UTF8: cada #NNN é um BYTE do UTF-8
        try:
            s = s.encode('latin1').decode('utf-8')
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return s


def atributo(nome: str, v):
    """(nome XML, valor) ou None para pular"""
    k, x = v
    base = nome.split('.')[-1]
    if k == 'lista':
        if nome.endswith('.UTF8W') or nome.endswith('.UTF8') or nome.endswith('.Strings'):
            utf8 = nome.endswith('.UTF8')
            linhas = [texto_do(i, utf8) for i in x if i[0] == 'str']
            raiz = nome.rsplit('.', 1)[0]
            alvo = 'Text' if raiz == 'Memo' else f'{raiz}.Text'
            return alvo, '\r\n'.join(linhas)
        return None
    if k == 'bin' or k == 'colecao':
        return None
    if k == 'str':
        return nome, x
    if k == 'num':
        return nome, numero(x)
    if k == 'set':
        if base in ('Style', 'Typ') or all(n in BITS for n in x):
            return nome, str(sum(BITS.get(n, 0) for n in x))
        return nome, ', '.join(x)
    if k == 'id':
        if base == 'Charset' and x in CHARSETS:
            return nome, str(CHARSETS[x])
        if x in CORES:
            return nome, str(CORES[x])
        if x == 'Null':
            return None
        return nome, x
    return None


def esc(s: str) -> str:
    return (s.replace('&', '&amp;').replace('"', '&#34;').replace('<', '&#60;').replace('>', '&#62;')
            .replace('\r', '&#13;').replace('\n', '&#10;'))


def xml_obj(o, nivel=0) -> str:
    attrs = [('Name', o['nome'])] if o['classe'] != 'TfrxReport' else []
    colecoes = []
    for nome, v in o['props']:
        if v[0] == 'colecao':
            colecoes.append((nome, v[1]))
            continue
        a = atributo(nome, v)
        if a:
            attrs.append(a)
    # banda/objeto com DataSet = form.dataset sem DataSetName: o nome do dataset é o que vem depois do ponto
    nomes = [a for a, _ in attrs]
    if 'DataSet' in nomes and 'DataSetName' not in nomes:
        ds = dict(attrs)['DataSet']
        attrs.append(('DataSetName', ds.split('.')[-1]))
    ind = '  ' * nivel
    abre = f'{ind}<{o["classe"]}' + ''.join(f' {a}="{esc(v)}"' for a, v in attrs)
    corpo = []
    for nome, itens in colecoes:
        if not itens:
            continue
        sub = []
        for props in itens:
            pa = []
            for pn, pv in props:
                a = atributo(pn, pv)
                if a:
                    pa.append(a)
            sub.append(f'{ind}    <item' + ''.join(f' {a}="{esc(v)}"' for a, v in pa) + '/>')
        corpo.append(f'{ind}  <{nome}>\n' + '\n'.join(sub) + f'\n{ind}  </{nome}>')
    for f in o['filhos']:
        corpo.append(xml_obj(f, nivel + 1))
    if not corpo:
        return abre + '/>'
    return abre + '>\n' + '\n'.join(corpo) + f'\n{ind}</{o["classe"]}>'


def converter(dfm: Path, objeto: str) -> str:
    texto = dfm.read_bytes().decode('latin1')
    o = achar_objeto(texto, objeto)
    if o['classe'] != 'TfrxReport':
        raise SystemExit(f'{objeto} é {o["classe"]}, não TfrxReport')
    return '<?xml version="1.0" encoding="utf-8" standalone="no"?>\n' + xml_obj(o) + '\n'


def gerar_ts():
    linhas = [
        '// GERADO por tools/relatorios/dfm-para-fr3.py --gerar-ts — não editar à mão.',
        '// Os relatórios que o legado desenha DENTRO do formulário (TfrxReport no .dfm, sem LoadFromFile): o XML .fr3 equivalente.',
        'export const RELATORIOS_EMBUTIDOS: Record<string, string> = {',
    ]
    for chave, dfm in EMBUTIDOS:
        xml = converter(FONTES / dfm, chave.split('.')[1])
        linhas.append(f'  {json.dumps(chave)}: {json.dumps(xml, ensure_ascii=False)},')
    linhas.append('};')
    alvo = APOLLO / 'apps/api/src/shared/relatorios/relatorios-embutidos.ts'
    alvo.write_text('\n'.join(linhas) + '\n', encoding='utf-8')
    print(f'{alvo}: {len(EMBUTIDOS)} layout(s)')


if __name__ == '__main__':
    if sys.argv[1:2] == ['--gerar-ts']:
        gerar_ts()
    else:
        dfm, objeto, saida = sys.argv[1:4]
        Path(saida).write_text(converter(Path(dfm), objeto), encoding='utf-8')
        print(saida)
