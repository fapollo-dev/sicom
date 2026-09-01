#!/usr/bin/env python3
"""
ESCALA dos numéricos: confronta as casas decimais que o DADO do legado realmente usa com as que o schema de
destino declara. Nasceu de um achado do ensaio: `nf_prod` reconciliou a contagem mas seis somas não fechavam
(`desconto` Σ 222.084,06 × 222.087,81), porque o legado guarda até **6 casas** em desconto/frete/bonificação e
a nossa coluna é `numeric(13,2)` — o Postgres arredonda na carga, em silêncio, em campo que entra em cálculo
fiscal. Truncar escala é perda de dado que a contagem nunca acusa.

Mede também os dígitos INTEIROS, que é o outro lado do `numeric(p,s)`: uma coluna com precisão insuficiente não
arredonda, ela **rejeita** a linha (`numeric field overflow`).

Uso:  python3 tools/cutover/etl/escala-numerica.py [f0 f1 f2 f3 f4]
"""
import csv, json, os, sys
from decimal import Decimal, InvalidOperation

BASE = '/Library/Apollo/tools/cutover'
csv.field_size_limit(10 ** 9)
NUMERICOS = {'numeric', 'integer', 'bigint', 'smallint', 'double precision', 'real'}

dest = json.load(open(f'{BASE}/schema-destino.json'))['tabelas']
achados = []

for fase in sys.argv[1:] or ['f0', 'f1', 'f2', 'f3', 'f4']:
    dir_fase = f'{BASE}/staging/{fase}'
    if not os.path.isdir(dir_fase):
        continue
    for arquivo in sorted(os.listdir(dir_fase)):
        if not arquivo.endswith('.csv'):
            continue
        tabela = arquivo[:-4]
        colunas_dest = dest.get(tabela, {}).get('colunas', {})
        caminho = f'{dir_fase}/{arquivo}'
        with open(caminho, newline='', encoding='utf-8') as fh:
            leitor = csv.reader(fh)
            cabecalho = next(leitor)
            alvos = [(i, c) for i, c in enumerate(cabecalho)
                     if colunas_dest.get(c, {}).get('tipo') in NUMERICOS]
            if not alvos:
                continue
            # por coluna: maior nº de casas decimais e maior nº de dígitos inteiros vistos no dado
            casas = {c: 0 for _, c in alvos}
            inteiros = {c: 0 for _, c in alvos}
            amostra = {}
            for linha in leitor:
                for i, c in alvos:
                    v = linha[i] if i < len(linha) else ''
                    if not v:
                        continue
                    try:
                        d = Decimal(v)
                    except InvalidOperation:
                        continue
                    sinal, digitos, expo = d.as_tuple()
                    dec = -expo if expo < 0 else 0
                    # casas SIGNIFICATIVAS: zeros à direita não são precisão usada
                    txt = format(d, 'f')
                    if '.' in txt:
                        dec = len(txt.split('.')[1].rstrip('0'))
                    intd = len(txt.split('.')[0].lstrip('-').lstrip('0')) or 1
                    if dec > casas[c]:
                        casas[c] = dec
                        amostra[c] = v
                    inteiros[c] = max(inteiros[c], intd)
        for _, c in alvos:
            d = colunas_dest[c]
            esc = d.get('escala')
            prec = d.get('tam')
            if d['tipo'] == 'numeric' and esc is not None and casas[c] > esc:
                achados.append(('ESCALA', fase, tabela, c, f'dado usa {casas[c]} casas · coluna é numeric({prec},{esc})'
                                                          f' · ex. {amostra.get(c)}'))
            if d['tipo'] == 'numeric' and prec is not None and esc is not None and inteiros[c] > (prec - esc):
                achados.append(('PRECISAO', fase, tabela, c, f'dado tem {inteiros[c]} dígitos inteiros · '
                                                             f'numeric({prec},{esc}) comporta {prec - esc}'))

for tipo in ('PRECISAO', 'ESCALA'):
    linhas = [a for a in achados if a[0] == tipo]
    print(f'\n=== {tipo}: {len(linhas)} coluna(s)')
    for _, fase, tabela, col, det in linhas:
        print(f'  {fase} · {tabela}.{col} — {det}')
if not achados:
    print('nenhuma coluna numérica estoura a declaração do destino')
