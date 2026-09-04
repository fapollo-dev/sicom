#!/usr/bin/env python3
"""
MAPA DE EQUIVALÊNCIAS DO RBAC — o que dá para renomear e o que precisa de decisão (§7w do plano de carga).

O app exige 176 pares (formulário, opção); 91 não existem nas permissões do cliente. Metade é só **nome
diferente para o mesmo ato** — a "opção" do legado é o nome do componente Delphi (`ENVIARNFE1` é o item de menu
"Enviar NFe"). Este script não adivinha por semelhança de string: abre o `.dfm` do formulário e lê o **Caption**
de cada componente, que é o texto que o operador vê no botão. Com o Caption ao lado, a equivalência deixa de ser
palpite.

Saída: `tools/cutover/rbac-equivalencias.md`, com os faltantes separados em
  A) formulário existe no cliente e há candidato com Caption compatível  → RENOMEAÇÃO
  B) formulário existe mas nenhum candidato                              → DECISÃO (ato sem permissão própria no legado)
  C) formulário não existe no cliente                                    → DECISÃO (tela nova/renomeada)

Uso:  python3 tools/cutover/rbac-equivalencias.py   (lê rbac-faltante.md, gerado com o Postgres carregado)
"""
import glob, os, re, sys

FONTE = '/Library/SicomGit/retaguarda-master/fonte/Units'
BASE = '/Library/Apollo/tools/cutover'

# o que cada opção NOSSA faz, em palavras do operador — é contra isto que o Caption do legado é comparado.
# Sem esta tabela o casamento viraria "parece o mesmo nome", que é exatamente o erro que causou o problema.
SENTIDO = {
    'BTNTRANSMITIR': ['enviar nfe', 'transmitir', 'enviar nf-e'],
    'BTNCANCELAR': ['cancelar nfe', 'cancelar nf-e', 'cancelar'],
    'BTNCCE': ['carta corre', 'cce'],
    'BTNFATURAR': ['faturam', 'gerar financeiro'],
    'BTNESTORNARFATURAMENTO': ['estorn', 'cancela fatur'],
    'BTNPROCESSAR': ['processar', 'processa nota', 'atualizar estoque'],
    'BTNREVERTER': ['reverter', 'estornar processamento', 'desprocessar'],
    'BTNCONTABILIZAR': ['contabiliz', 'integra'],
    'BTNESTORNARCONTABIL': ['estorn'],
    'BTNAJUSTAR': ['ajustar', 'ok', 'confirmar ajuste'],
    'BTNESTORNAR': ['estornar', 'estorno'],
    'BTNBAIXAR': ['baixar', 'baixa'],
    'BTNESTORNARBAIXA': ['estorn'],
    'BTNABRIR': ['abrir', 'abertura'],
    'BTNFECHAR': ['fechar', 'fechamento'],
    'BTNREABRIR': ['reabrir', 'reabertura'],
    'BTNMOVIMENTAR': ['movimentar', 'movimento', 'lançar'],
    'BTNGRAVAR': ['gravar', 'salvar'],
    'BTNEXCLUIR': ['excluir', 'apagar', 'deletar'],
    'BTNEDITAR': ['editar', 'alterar'],
    'BTNIMPORTAR': ['importar'],
    'BTNPERMISSOES': ['permiss'],
    'BTNAGRUPAR': ['agrupar'],
    'BTNAPLICARPRECO': ['aplicar'],
    'BTNENCERRAR': ['encerrar'],
    'BTNLANCARPRECOS': ['pre'],
    'BTNSENHAOPERACAO': ['senha'],
    'BTNGERARREMESSA': ['remessa'],
    'BTNBOLETO': ['boleto'],
}

def decodifica_dfm(valor: str) -> str:
    """Caption do Delphi é uma sequência de `'texto'` e `#NNN` (o acento fica FORA das aspas):
    `'Carta Corre'#231#227'o'` = "Carta Correção". Ler só o que está entre as primeiras aspas perde o acento —
    e foi por isso que a primeira rodada não casou `BTNCARTACORRECAO`."""
    fora = []
    for t, n in re.findall(r"'([^']*)'|#(\d+)", valor):
        fora.append(t if not n else chr(int(n)))
    return ''.join(fora).replace('&', '')


def captions_do_form(form: str) -> dict:
    """nome do componente → Caption, lidos do .dfm cujo `inherited <x>: T<FORM>` casa."""
    alvo = form.upper()
    for f in glob.glob(f'{FONTE}/*.dfm'):
        try:
            head = open(f, encoding='latin-1').read(200)
        except Exception:
            continue
        m = re.match(r'\s*(?:inherited|object)\s+\w+\s*:\s*T(\w+)', head)
        if not m or m.group(1).upper() != alvo:
            continue
        txt = open(f, encoding='latin-1').read()
        caps, atual = {}, None
        for linha in txt.split('\n'):
            mo = re.match(r'\s*(?:object|inherited)\s+(\w+)\s*:', linha)
            if mo:
                atual = mo.group(1).upper()
                continue
            mc = re.match(r'\s*Caption\s*=\s*(.+?)\s*$', linha)
            if mc and atual and atual not in caps:
                caps[atual] = decodifica_dfm(mc.group(1))
        return caps
    return {}

# ── RBAC completo do cliente (313 formulários / 1.100 pares), exportado do Postgres carregado ───────────────
import json
CLIENTE = json.load(open(f'{BASE}/rbac-cliente.json', encoding='utf-8'))

def radical(nome: str) -> str:
    """tira os prefixos/sufixos que o Delphi e nós usamos de forma diferente para a MESMA tela:
    FRMCADFAMILIAS ~ FRMCADFAMILIAPROD, FRMAGENDAPROMOCAO ~ FRMCADAGENDAPROMOCAO, FRMCADMOTIVOOPERACAO ~
    FRMCADMOTIVOOPERACOES. Sem isto, tela renomeada parece tela nova — e foi assim que 19 formulários caíram
    no balde 'não existe no cliente'."""
    r = nome.upper()
    for pre in ('FRMCAD', 'FRM'):
        if r.startswith(pre):
            r = r[len(pre):]
            break
    for suf in ('OES', 'AOS', 'OS', 'AS', 'ES', 'S'):
        if r.endswith(suf) and len(r) > len(suf) + 3:
            r = r[: -len(suf)]
            break
    return r

def forms_parecidos(form: str):
    """formulários do cliente cujo radical contém (ou está contido n)o nosso — candidatos à MESMA tela."""
    alvo = radical(form)
    out = []
    for f in CLIENTE:
        r = radical(f)
        # os DOIS radicais precisam ser longos: 'NF' está contido em 'coNFerencianota' e casava FRMCONFERENCIANOTA
        # com FRMNF. Substring curta não é evidência de ser a mesma tela.
        if r == alvo or (len(alvo) >= 6 and len(r) >= 6 and (alvo in r or r in alvo)):
            out.append((f, sum(x['n'] for x in CLIENTE[f])))
    return sorted(out, key=lambda x: -x[1])

# ── lê o relatório de faltantes ────────────────────────────────────────────────────────────────────────────
falt = {}
tem = {}
form = None
for linha in open(f'{BASE}/rbac-faltante.md', encoding='utf-8'):
    m = re.match(r'## (\w+)', linha)
    if m:
        form = m.group(1)
        continue
    if linha.startswith('- falta:') and form:
        falt[form] = [x.strip() for x in linha.split(':', 1)[1].split(',') if x.strip()]
    if linha.startswith('- cliente tem:') and form:
        tem[form] = [x.strip() for x in linha.split(':', 1)[1].split(',') if x.strip()]

A, B, C = [], [], []
RENOMEIA_FORM = []
for f, opcoes in sorted(falt.items()):
    if f not in tem:
        # antes de declarar "tela nova", procurar a MESMA tela com outro nome no cliente
        pares = forms_parecidos(f)
        if pares:
            RENOMEIA_FORM.append((f, opcoes, pares))
        else:
            C.append((f, opcoes, {}))
        continue
    caps = captions_do_form(f)
    for o in opcoes:
        pistas = SENTIDO.get(o, [o.replace('BTN', '').lower()])
        cands = []
        for cli in tem[f]:
            cap = (caps.get(cli) or '').lower()
            if any(p in cap for p in pistas):
                cands.append((cli, caps.get(cli)))
        (A if cands else B).append((f, o, cands, caps))

linhas = ['# RBAC — mapa de equivalências\n',
          'Gerado por `tools/cutover/rbac-equivalencias.py`. O `Caption` vem do `.dfm` do legado: é o texto que o',
          'operador lê no botão, e é ele que sustenta a equivalência (não a semelhança do nome).\n',
          f'## A) RENOMEAÇÃO — {len(A)} opção(ões): o cliente já concede este ato, com outro nome\n',
          '| formulário | nossa opção | opção do cliente | Caption no legado |', '|---|---|---|---|']
for f, o, cands, _ in A:
    for cli, cap in cands:
        linhas.append(f'| `{f}` | `{o}` | **`{cli}`** | {cap or "—"} |')
linhas += [f'\n## B) DECISÃO — {len(B)} opção(ões): o formulário existe, mas o ato não tem permissão própria no legado\n',
           'No Delphi estes acontecem como efeito de outro botão, sem grant separado. Não há o que herdar: alguém',
           'precisa dizer **quem pode**.\n',
           '| formulário | nossa opção | o que o cliente tem nesse formulário |', '|---|---|---|']
for f, o, _, caps in B:
    rotulos = ', '.join(f'`{c}`' + (f' ({caps[c]})' if caps.get(c) else '') for c in tem.get(f, [])[:8])
    linhas.append(f'| `{f}` | `{o}` | {rotulos} |')
linhas += [f'\n## A2) RENOMEAÇÃO DE FORMULÁRIO — {len(RENOMEIA_FORM)}: a tela existe no cliente com outro nome\n',
           'Não é tela nova: é a mesma tela batizada diferente por nós. Renomear o `rbacForm` faz os grants que já',
           'existem passarem a valer — e o número de operadores mostra o tamanho do que estava sendo perdido.\n',
           '| nosso formulário | candidato no cliente (operadores) | opções que precisamos |', '|---|---|---|']
for f, opcoes, pares in RENOMEIA_FORM:
    cands = ' · '.join(f'**`{c}`** ({n})' for c, n in pares[:3])
    linhas.append(f'| `{f}` | {cands} | {", ".join("`"+o+"`" for o in opcoes)} |')
linhas += [f'\n## C) DECISÃO — {len(C)} formulário(s) que não existem no cliente\n',
           'Tela nossa (não havia equivalente no legado) ou renomeada por nós. Nenhum operador tem grant algum aqui.\n',
           '| formulário | opções exigidas |', '|---|---|']
for f, opcoes, _ in C:
    linhas.append(f'| `{f}` | {", ".join("`"+o+"`" for o in opcoes)} |')

open(f'{BASE}/rbac-equivalencias.md', 'w', encoding='utf-8').write('\n'.join(linhas) + '\n')
print(f'A) renomear opção: {len(A)}  ·  A2) renomear formulário: {len(RENOMEIA_FORM)}  ·  B) decisão: {len(B)}  ·  C) tela realmente nova: {len(C)}')
print(f'→ {BASE}/rbac-equivalencias.md')
