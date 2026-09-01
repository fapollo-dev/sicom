#!/usr/bin/env python3
"""
SOMAS DE RECONCILIAÇÃO a partir do CSV já extraído.

O extrator passou o ensaio inteiro devolvendo `somas: {}` (o python-oracledb entrega NUMBER como float e o
acumulador só somava Decimal), então as 69 tabelas / 20,9M linhas foram conferidas **só por contagem** — e
contagem igual não prova valor igual: coluna deslocada, decimal truncado ou separador mal lido passam batido.
Corrigido o extrator (`fetch_decimals`), este script recalcula as somas dos CSVs que já estão em disco, para
que a reconciliação de VALORES possa rodar sem depender de uma nova janela do Oracle.

⚠️ o que isto prova e o que NÃO prova: a soma sai do CSV, então ela confere o trecho **CSV → Postgres**
(parsing, tipo, escala, truncamento). O trecho **Oracle → CSV** só é conferido quando o próprio extrator gera
o manifesto com o Oracle de pé — é isso que a reextração pendente fecha.

Uso:  python3 tools/cutover/etl/somar-csv.py f0 [f1 f2 ...]
"""
import csv, json, os, sys
from decimal import Decimal, InvalidOperation

BASE = '/Library/Apollo/tools/cutover'
csv.field_size_limit(10 ** 9)

# tipos do schema-destino que valem soma (o resto é texto, data ou booleano)
NUMERICOS = {'numeric', 'integer', 'bigint', 'smallint', 'double precision', 'real'}

dest = json.load(open(f'{BASE}/schema-destino.json'))['tabelas']

for fase in sys.argv[1:] or ['f0']:
    dir_fase = f'{BASE}/staging/{fase}'
    cam_man = f'{dir_fase}/_manifesto.json'
    if not os.path.exists(cam_man):
        print(f'⛔ {fase}: sem manifesto em {dir_fase}')
        continue
    manifesto = json.load(open(cam_man))
    print(f'=== {fase}')
    for tabela, info in manifesto.items():
        if not isinstance(info, dict) or 'pulada' in info:
            continue
        caminho = f'{dir_fase}/{tabela}.csv'
        if not os.path.exists(caminho):
            print(f'  ⛔ {tabela}: CSV ausente')
            continue
        colunas_dest = dest.get(tabela, {}).get('colunas', {})
        somas, linhas = {}, 0
        with open(caminho, newline='', encoding='utf-8') as fh:
            leitor = csv.reader(fh)
            cabecalho = next(leitor)
            # só as colunas que o DESTINO declara numéricas — somar texto que parece número (um código de barras,
            # um CNPJ) daria um "checksum" que muda de valor à toa quando a carga normaliza o campo.
            alvos = [(i, c) for i, c in enumerate(cabecalho)
                     if colunas_dest.get(c, {}).get('tipo') in NUMERICOS]
            for i, c in alvos:
                somas[c] = Decimal(0)
            for linha in leitor:
                linhas += 1
                for i, c in alvos:
                    v = linha[i] if i < len(linha) else ''
                    if v == '':
                        continue
                    try:
                        somas[c] += Decimal(v)
                    except InvalidOperation:
                        pass  # valor não-numérico numa coluna numérica: a carga vai reprovar sozinha
        if linhas != info.get('linhas'):
            print(f'  ⚠️  {tabela}: CSV tem {linhas} linhas e o manifesto diz {info.get("linhas")}')
        info['somas'] = {c: str(v) for c, v in somas.items()}
        info['somas_origem'] = 'csv'  # marca de procedência: não veio do Oracle
        print(f'  ✅ {tabela}: {len(somas)} coluna(s) somada(s) · {linhas} linhas')
    json.dump(manifesto, open(cam_man, 'w'), indent=1, ensure_ascii=False)
    print(f'  → {cam_man}')
