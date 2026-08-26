#!/usr/bin/env python3
"""
EXTRATOR (Oracle → CSV) do ETL de cutover. Lê SOMENTE as colunas que existem nos dois lados (interseção com
`schema-destino.json`) mais as renomeações explícitas, e grava, por tabela: um CSV e um manifesto com contagem,
somas das colunas numéricas e min/max das datas — os números que o carregador vai reconciliar do outro lado.

Uso:  /Library/Developer/CommandLineTools/usr/bin/python3 tools/cutover/etl/extrair.py f0 [destino]
Oracle é SOMENTE LEITURA.
"""
import csv, json, os, sys, decimal, datetime
import oracledb

BASE = '/Library/Apollo/tools/cutover'
FASES = {
 'f0': "bancos cidades bairro cfop ncm aliquota piscofins det_aliquota figura_fiscal unidade marcas familias_prod familias_prod_area plc plano_contas condicoes_pagto operacoes_conta".split(),
}
# renomeações origem→destino que o casamento por nome não resolve (achadas pelo mapa-colunas.py)
RENOMEIA = {'aliquota': {'aliquota': 'codigo'}}

fase = (sys.argv[1] if len(sys.argv) > 1 else 'f0').lower()
saida = sys.argv[2] if len(sys.argv) > 2 else f'{BASE}/staging/{fase}'
os.makedirs(saida, exist_ok=True)
dest = json.load(open(f'{BASE}/schema-destino.json'))['tabelas']

con = oracledb.connect(user="pinheirao", password="apollo", dsn=oracledb.makedsn("192.168.1.230",1521,sid="apollo"))
con.call_timeout = 900000
cur = con.cursor()
cur.execute("select table_name from user_tables")
ora = {r[0] for r in cur.fetchall()}

manifesto = {}
for t in FASES[fase]:
    T = t.upper()
    if t not in dest or T not in ora:
        manifesto[t] = {'pulada': 'sem origem no Oracle' if t in dest else 'sem destino'}
        print(f"  ○ {t}: {manifesto[t]['pulada']}"); continue
    cur.execute("select column_name, data_type from user_tab_columns where table_name=:t", t=T)
    ori = {r[0].lower(): r[1] for r in cur.fetchall()}
    ren = RENOMEIA.get(t, {})
    # colunas a levar: as que casam por nome (ou por renomeação) com o destino
    cols = [(c, ren.get(c, c)) for c in ori if ren.get(c, c) in dest[t]['colunas']]
    if not cols:
        manifesto[t] = {'pulada': 'nenhuma coluna casa'}; print(f"  ⛔ {t}: nenhuma coluna casa"); continue
    sel = ", ".join(c for c, _ in cols)
    cur.execute(f"select {sel} from {T}")
    linhas, somas, datas = 0, {}, {}
    with open(f'{saida}/{t}.csv', 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow([d for _, d in cols])
        for row in cur:
            out = []
            for (oc, dc), v in zip(cols, row):
                if isinstance(v, decimal.Decimal):
                    somas[dc] = somas.get(dc, decimal.Decimal(0)) + v
                elif isinstance(v, (datetime.datetime, datetime.date)):
                    iso = v.isoformat()
                    d = datas.setdefault(dc, [iso, iso])
                    d[0], d[1] = min(d[0], iso), max(d[1], iso)
                    v = iso
                out.append('' if v is None else v)
            w.writerow(out); linhas += 1
    manifesto[t] = {'linhas': linhas, 'colunas': [d for _, d in cols],
                    'somas': {k: str(v) for k, v in somas.items()},
                    'datas': datas,
                    'colunas_origem_descartadas': sorted(set(ori) - {c for c, _ in cols})}
    print(f"  ✅ {t}: {linhas} linhas · {len(cols)} colunas")

json.dump(manifesto, open(f'{saida}/_manifesto.json', 'w'), indent=1, ensure_ascii=False)
print(f"\nmanifesto → {saida}/_manifesto.json")
con.close()
