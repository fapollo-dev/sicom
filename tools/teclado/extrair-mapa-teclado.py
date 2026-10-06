#!/usr/bin/env python3
"""
MAPA DE TECLADO DO LEGADO (ADR-010) — extraído do .pas/.dfm, não digitado.

Para cada formulário do retaguarda: a classe-base, as teclas tratadas no `FormKeyDown`/`FormKeyUp`/`FormKeyPress` (F-keys, Esc,
Ctrl/Alt/Shift+tecla) com o comando que cada uma dispara, os `ShortCut` de TAction/TMenuItem do .dfm e os botões `Default`/`Cancel`.
Sai em `tools/teclado/mapa-teclado.json` — a camada de teclado do Apollo e o dossiê consomem esse mapa.

Uso:  python3 tools/teclado/extrair-mapa-teclado.py
"""
from __future__ import annotations
import json
import re
from pathlib import Path

FONTES = Path('/Library/SicomGit/retaguarda-master/fonte/Units')
SAIDA = Path(__file__).resolve().parent / 'mapa-teclado.json'

VK = {**{f'VK_F{i}': f'F{i}' for i in range(1, 13)}, 'VK_ESCAPE': 'Esc', 'VK_RETURN': 'Enter', 'VK_DELETE': 'Del',
      'VK_INSERT': 'Ins', 'VK_UP': 'Up', 'VK_DOWN': 'Down', 'VK_LEFT': 'Left', 'VK_RIGHT': 'Right', 'VK_TAB': 'Tab',
      'VK_SPACE': 'Space', 'VK_HOME': 'Home', 'VK_END': 'End', 'VK_PRIOR': 'PgUp', 'VK_NEXT': 'PgDn', 'VK_ADD': 'NumPlus',
      'VK_SUBTRACT': 'NumMinus', 'VK_MULTIPLY': 'NumMult'}
COD = {**{112 + i: f'F{i + 1}' for i in range(12)}, 27: 'Esc', 13: 'Enter', 46: 'Del', 45: 'Ins', 38: 'Up', 40: 'Down',
       37: 'Left', 39: 'Right', 9: 'Tab', 32: 'Space', 33: 'PgUp', 34: 'PgDn', 107: 'NumPlus', 109: 'NumMinus', 106: 'NumMult'}
for c in range(65, 91):
    COD[c] = chr(c)
for c in range(48, 58):
    COD[c] = chr(c)


def texto(p: Path) -> str:
    return p.read_bytes().decode('latin1')


def tecla_de(tok: str) -> str | None:
    t = tok.strip().upper()
    if t in VK:
        return VK[t]
    m = re.fullmatch(r"ORD\('(.)'\)", t)
    if m:
        return m.group(1)
    if t.isdigit() and int(t) in COD:
        return COD[int(t)]
    if t in ('#13', "#13"):
        return 'Enter'
    if t == '#27':
        return 'Esc'
    return None


def shortcut_dfm(v: int) -> str:
    """o ShortCut serializado do VCL: tecla | scShift 0x2000 | scCtrl 0x4000 | scAlt 0x8000"""
    mods = []
    if v & 0x4000:
        mods.append('Ctrl')
    if v & 0x8000:
        mods.append('Alt')
    if v & 0x2000:
        mods.append('Shift')
    k = v & 0xFF
    return '+'.join(mods + [COD.get(k, f'#{k}')])


def corpo_procedure(src: str, classe: str, nome: str) -> str | None:
    m = re.search(rf'procedure\s+{re.escape(classe)}\.{nome}\s*\(', src, re.I)
    if not m:
        return None
    ini = m.start()
    prox = re.search(r'\n(procedure|function|constructor|destructor)\s+\w+\.', src[m.end():], re.I)
    fim = m.end() + prox.start() if prox else len(src)
    return src[ini:fim]


def regras_de_tecla(corpo: str) -> list[dict]:
    """as teclas tratadas e o comando de cada uma — por `case Key of` e por `if Key = X`"""
    out: list[dict] = []
    limpo = re.sub(r'//[^\n]*', '', corpo)
    limpo = re.sub(r'\{[^}]*\}', '', limpo)
    # if (Key = VK_F9) [and (Shift = [ssCtrl])] then <comando>
    for m in re.finditer(r"\bkey\s*(?:=|in)\s*(\[[^\]]*\]|[\w#']+(?:\([^)]*\))?)", limpo, re.I):
        alvo = m.group(1)
        teclas = [t for t in (tecla_de(x) for x in re.split(r'[\[\],]', alvo)) if t]
        if not teclas:
            continue
        resto = limpo[m.end():m.end() + 400]
        shift = re.search(r"shift\s*=\s*\[([^\]]*)\]", limpo[max(0, m.start() - 120):m.end() + 160], re.I)
        mods = [s.strip()[2:].capitalize() for s in shift.group(1).split(',')] if shift and shift.group(1).strip() else []
        cmd = re.search(r'then\s*(begin)?\s*([^;]*;)', resto, re.I)
        out.append({'teclas': teclas, 'mods': mods, 'comando': re.sub(r'\s+', ' ', cmd.group(2)).strip() if cmd else ''})
    # case Key of  VK_F2: ...;  113: begin ... end;  — com begin/end/case/try aninhados
    for cm in re.finditer(r'case\s+key\s+of', limpo, re.I):
        i, prof, ini_item, itens = cm.end(), 0, cm.end(), []
        toks = re.finditer(r"\b(begin|case|try|record|end)\b|;|'[^']*'", limpo[cm.end():], re.I)
        fim = len(limpo)
        for t in toks:
            w = t.group(0).lower()
            pos = cm.end() + t.start()
            if w in ('begin', 'case', 'try', 'record'):
                prof += 1
            elif w == 'end':
                if prof == 0:
                    fim = pos
                    itens.append(limpo[ini_item:pos])
                    break
                prof -= 1
            elif w == ';' and prof == 0:
                itens.append(limpo[ini_item:pos + 1])
                ini_item = pos + 1
        for item in itens:
            mm = re.match(r'\s*([\w#\', ]+?)\s*:(?!=)\s*(.*)$', item, re.S)
            if not mm:
                continue
            teclas = [t for t in (tecla_de(x) for x in mm.group(1).split(',')) if t]
            if not teclas:
                continue
            cmd = re.sub(r'\s+', ' ', mm.group(2)).strip()
            cmd = re.sub(r'^begin\s*|\s*end\s*;?$', '', cmd, flags=re.I)
            mods_m = re.search(r"shift\s*=\s*\[([^\]]*)\]", cmd, re.I)
            mods = [x.strip()[2:].capitalize() for x in mods_m.group(1).split(',')] if mods_m and mods_m.group(1).strip() else []
            out.append({'teclas': teclas, 'mods': mods, 'comando': cmd[:300]})
    # dedup
    vistos, uniq = set(), []
    for r in out:
        k = (tuple(r['teclas']), tuple(r['mods']), r['comando'][:80])
        if k not in vistos:
            vistos.add(k)
            uniq.append(r)
    return uniq


def units_do_projeto() -> set[str]:
    """as units que o Retaguarda.dpr compila (as cópias `_Old`/backup ficam fora)"""
    dpr = texto(FONTES.parent / 'Retaguarda.dpr')
    return {m.group(1).lower() for m in re.finditer(r"(\w+)\s+in\s+'[^']*'", dpr)}


def main():
    forms: dict[str, dict] = {}
    projeto = units_do_projeto()
    for pas in sorted(FONTES.glob('*.pas')):
        if pas.stem.lower() not in projeto:
            continue
        src = texto(pas)
        dfm = pas.with_suffix('.dfm')
        dsrc = texto(dfm) if dfm.exists() else ''
        nome_form = re.search(r'^(?:object|inherited)\s+(\w+)\s*:\s*(T\w+)', dsrc, re.M)
        cm = None
        if nome_form:
            cm = re.search(rf'^\s*({re.escape(nome_form.group(2))})\s*=\s*class\s*\((T\w+)\)', src, re.M | re.I)
        if not cm:
            cm = re.search(r'^\s*(T\w+)\s*=\s*class\s*\((T\w+)\)', src, re.M | re.I)
        if not cm:
            continue
        classe, base = cm.group(1), cm.group(2)
        form = (nome_form.group(1) if nome_form else classe[1:]).upper()
        eventos = {}
        for ev in ('FormKeyDown', 'FormKeyUp', 'FormKeyPress'):
            corpo = corpo_procedure(src, classe, ev)
            if corpo:
                eventos[ev] = regras_de_tecla(corpo)
        atalhos = []
        for m in re.finditer(r'object\s+(\w+)\s*:\s*(TAction|TMenuItem)\b(.*?)\n\s*end\b', dsrc, re.S):
            sc = re.search(r'ShortCut\s*=\s*(\d+)', m.group(3))
            if sc and int(sc.group(1)):
                cap = re.search(r"Caption\s*=\s*'([^']*)'", m.group(3))
                ac = re.search(r'OnClick\s*=\s*(\w+)|OnExecute\s*=\s*(\w+)', m.group(3))
                atalhos.append({'controle': m.group(1), 'tipo': m.group(2), 'tecla': shortcut_dfm(int(sc.group(1))),
                                'caption': cap.group(1) if cap else '', 'evento': (ac.group(1) or ac.group(2)) if ac else ''})
        botoes = []
        for m in re.finditer(r'object\s+(\w+)\s*:\s*(TBitBtn|TButton|TSpeedButton)\b(.*?)\n\s*end\b', dsrc, re.S):
            props = m.group(3)
            cap = re.search(r"Caption\s*=\s*'([^']*)'", props)
            d = 'Default = True' in props
            c = 'Cancel = True' in props
            if d or c or (cap and '&' in cap.group(1)):
                botoes.append({'controle': m.group(1), 'caption': cap.group(1) if cap else '', 'default': d, 'cancel': c})
        forms[form] = {'unit': pas.stem, 'classe': classe, 'base': base, 'teclas': eventos, 'atalhos': atalhos, 'botoes': botoes}
    SAIDA.write_text(json.dumps(forms, ensure_ascii=False, indent=1), encoding='utf-8')
    com = {k: v for k, v in forms.items() if any(v['teclas'].get(e) for e in v['teclas']) or v['atalhos']}
    print(f'{len(forms)} formulários; {len(com)} com teclas próprias → {SAIDA}')


if __name__ == '__main__':
    main()
