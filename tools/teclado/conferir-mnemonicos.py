#!/usr/bin/env python3
"""
CONFERIDOR DE MNEMÔNICOS (ADR-010: os `&` vêm do .dfm, não são digitados).

Para cada tela do Apollo ligada a um formulário legado (a página cita o FRM no código), compara os rótulos com `&` da página
(`label="…"`, `label: '…'`) com as legendas do .dfm (TBitBtn/TButton/TSpeedButton/TLabel/TCheckBox/TRadioGroup/TGroupBox/
TTabSheet/TMenuItem/TAction): pelo TEXTO sem o `&`, normalizado.
  · mesma legenda, letra diferente     → divergente (corrigir para a do legado)
  · rótulo com `&` e a legenda do legado não tem `&` → inventado
  · legenda com `&` no legado sem rótulo correspondente no Apollo → só informa (a tela pode ter outro texto)
Sai `tools/teclado/mnemonicos.json` e um resumo.
"""
from __future__ import annotations
import json
import re
import unicodedata
from pathlib import Path

FONTES = Path('/Library/SicomGit/retaguarda-master/fonte/Units')
APOLLO = Path(__file__).resolve().parents[2]
MAPA = json.loads((Path(__file__).parent / 'mapa-teclado.json').read_text(encoding='utf-8'))
CLASSES = r'TBitBtn|TButton|TSpeedButton|TLabel|TCheckBox|TDBCheckBox|TRadioGroup|TDBRadioGroup|TGroupBox|TTabSheet|TcxTabSheet|TMenuItem|TAction|TRadioButton|TPanel|TJvXPButton|TcxButton'


def cadeia_dfm(s: str) -> str:
    """'Ati&vo'#231 + 'x' → texto"""
    out = []
    for m in re.finditer(r"'((?:[^']|'')*)'|#(\d+)", s):
        out.append(m.group(1).replace("''", "'") if m.group(1) is not None else chr(int(m.group(2))))
    return ''.join(out)


def norm(t: str) -> str:
    t = t.replace('&&', '').replace('&', '')
    t = unicodedata.normalize('NFKD', t)
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]', '', t.lower())


def letra(t: str) -> str | None:
    m = re.search(r'&([^&])', t.replace('&&', ''))
    return m.group(1).lower() if m else None


def legendas(unit: str) -> list[dict]:
    dfm = FONTES / f'{unit}.dfm'
    if not dfm.exists():
        return []
    s = dfm.read_bytes().decode('latin1')
    out = []
    for m in re.finditer(rf'(?:object|inherited)\s+(\w+)\s*:\s*({CLASSES})\b', s):
        trecho = s[m.end():m.end() + 1500]
        fim = re.search(r'\n\s*(?:object|inherited|end)\b', trecho)
        props = trecho[:fim.start()] if fim else trecho
        cap = re.search(r"Caption\s*=\s*((?:'(?:[^']|'')*'|#\d+)(?:\s*\+?\s*(?:'(?:[^']|'')*'|#\d+))*)", props)
        if not cap:
            continue
        texto = cadeia_dfm(cap.group(1))
        if not texto.strip():
            continue
        out.append({'controle': m.group(1), 'classe': m.group(2), 'caption': texto, 'letra': letra(texto), 'norm': norm(texto)})
    return out


def rotulos(pagina: Path) -> list[dict]:
    s = pagina.read_text(encoding='utf-8', errors='ignore')
    out = []
    for m in re.finditer(r"""label\s*[=:]\s*\{?\s*(["'`])((?:(?!\1).){1,80})\1""", s):
        t = m.group(2)
        out.append({'rotulo': t, 'letra': letra(t), 'norm': norm(t), 'linha': s[:m.start()].count('\n') + 1})
    return out


def main():
    feats = list((APOLLO / 'apps/web/src/features').rglob('*.tsx'))
    textos = {f: f.read_text(encoding='utf-8', errors='ignore') for f in feats}
    rel = []
    for form, v in MAPA.items():
        paginas = [f for f, t in textos.items() if re.search(r'\b' + form + r'\b', t, re.I)]
        if not paginas:
            continue
        leg = legendas(v['unit'])
        porNorm: dict[str, list[dict]] = {}
        for l in leg:
            porNorm.setdefault(l['norm'], []).append(l)
        for p in paginas:
            for r in rotulos(p):
                cands = porNorm.get(r['norm'], [])
                if not cands:
                    continue
                letras = {c['letra'] for c in cands}
                if r['letra'] in letras:
                    continue
                legado = next((c for c in cands if c['letra']), cands[0])
                tipo = 'inventado' if not any(c['letra'] for c in cands) else ('faltando' if r['letra'] is None else 'divergente')
                rel.append({'form': form, 'pagina': str(p.relative_to(APOLLO)), 'linha': r['linha'], 'rotulo': r['rotulo'],
                            'legado': legado['caption'], 'controle': legado['controle'], 'tipo': tipo})
    (Path(__file__).parent / 'mnemonicos.json').write_text(json.dumps(rel, ensure_ascii=False, indent=1), encoding='utf-8')
    from collections import Counter
    print(len(rel), 'rótulos fora do legado:', dict(Counter(r['tipo'] for r in rel)))
    for r in rel[:40]:
        print(f"  [{r['tipo']}] {r['pagina']}:{r['linha']}  {r['rotulo']!r}  ←  legado {r['legado']!r} ({r['controle']})")


if __name__ == '__main__':
    main()
