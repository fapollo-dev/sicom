#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CONFERIDOR DE DEFAULTS — a regra que o banco do legado aplica na INCLUSÃO quando a coluna não vem no INSERT
(`ALL_TAB_COLUMNS.DATA_DEFAULT`) × o DEFAULT da mesma coluna no destino (`schema-destino.json`).

Uma coluna com DEFAULT no Oracle e sem DEFAULT (ou com outro) no Postgres nasce diferente em toda linha que o Apollo
inclui sem citá-la: 'S' vira NULL, 0 vira NULL, SYSDATE vira NULL. O conferidor lista as divergências das tabelas do
destino; cada uma é candidata — pode ser que o Apollo sempre grave a coluna (aí o DEFAULT é indiferente).

25/09/2026: 0 divergências — o Oracle tem só 111 DEFAULTs (o resto da regra de inclusão é o NewRecord/ZeroToFields das telas) e
a mig 345 já os trouxe. Fica como guarda: DEFAULT novo que o binário da produção criar aparece aqui.

Uso (só leitura no Oracle):  python3 tools/cutover/conferir-defaults.py [--json]
"""
import json
import re
import sys

import oracledb

BASE = '/Library/Apollo/tools/cutover'
ORACLE = dict(user='pinheirao', password='apollo', dsn='hiperpinheirao.ddns.com.br:1521/apollo')


def norm_ora(v):
    if v is None:
        return None
    s = str(v).strip().rstrip(';').strip()
    if s.upper() in ('NULL', ''):
        return None
    s = re.sub(r'\s+', ' ', s)
    if s.upper() in ('SYSDATE', 'CURRENT_TIMESTAMP', 'SYSTIMESTAMP', 'CURRENT_DATE'):
        return 'AGORA'
    m = re.fullmatch(r"'(.*)'", s)
    if m:
        return m.group(1)
    try:
        return float(s)
    except ValueError:
        return s.upper()


def norm_pg(v):
    if v is None:
        return None
    s = str(v).strip()
    if s.upper().startswith('NULL'):
        return None
    if re.search(r'now\(\)|current_timestamp|current_date|localtimestamp', s, re.I):
        return 'AGORA'
    if s.startswith('nextval('):
        return 'SEQ'
    m = re.fullmatch(r"'(.*)'::[\w ]+(\(\d+(,\d+)?\))?", s)
    if m:
        return m.group(1)  # string com aspas continua string ('06' não é 6 — no Oracle também não)
    s = re.sub(r'::[\w ]+(\(\d+(,\d+)?\))?$', '', s).strip('()')
    try:
        return float(s)
    except ValueError:
        return s.upper()


def main():
    destino = json.load(open(f'{BASE}/schema-destino.json'))['tabelas']
    c = oracledb.connect(**ORACLE)
    cu = c.cursor()
    cu.execute('SET TRANSACTION READ ONLY')
    cu.execute("SELECT table_name, column_name, data_default FROM user_tab_columns WHERE data_default IS NOT NULL")
    ora = {}
    for t, col, dd in cu:
        ora[(t.lower(), col.lower())] = norm_ora(dd)
    divs = []
    for (t, col), dv in sorted(ora.items()):
        if dv is None or t not in destino:
            continue
        cd = destino[t]['colunas'].get(col)
        if cd is None:
            continue  # coluna fora do destino: é outro conferidor
        pv = norm_pg(cd.get('default'))
        if pv == 'SEQ':
            continue
        if pv != dv:
            divs.append({'tabela': t, 'coluna': col, 'oracle': dv, 'postgres': pv})
    if '--json' in sys.argv:
        print(json.dumps(divs, ensure_ascii=False, indent=1))
    else:
        for d in divs:
            print(f"{d['tabela']}.{d['coluna']}: oracle={d['oracle']!r} postgres={d['postgres']!r}")
        print(f'{len(divs)} divergências')


if __name__ == '__main__':
    main()
