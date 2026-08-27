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
 'f1': "empresas configuracoes configuracoes_especificas operadores perfil permissoes parceiros parceiros_end parceiros_bancos produtos composicao decomposicao receita_prod codauxiliar codreferencia_for multi_preco estoque contas_bancarias formas_pgto".split(),
 'f0': "bancos cidades bairro cfop ncm aliquota piscofins det_aliquota figura_fiscal unidade marcas familias_prod familias_prod_area plc plano_contas condicoes_pagto operacoes_conta".split(),
}
# renomeações origem→destino que o casamento por nome não resolve (achadas pelo mapa-colunas.py)
RENOMEIA = {
 'aliquota': {'aliquota': 'codigo'},
 # §7e: o código do Oracle NÃO entra na PK (lá é por venda/cupom, não por linha) — vira coluna de referência
 'vendas': {'codvendas': 'codvendas_legado'},
 'cx_vendas': {'codcxvendas': 'codcxvendas_legado'},
 # o legado chama a empresa de CODEMPRESA; aqui a coluna é idempresa nessas duas
 'empresas': {'codempresa': 'idempresa', 'razaosocial': 'razao_social'},
 'parceiros': {'codempresa': 'idempresa'},
}
# colunas CONSTANTES que o destino exige e a origem não tem (§7b: sem `origem_legado='S'` o índice parcial de
# login rejeita os 15 operadores com login repetido do cliente)
CONSTANTES = {'operadores': {'origem_legado': 'S'}, 'parceiros_end': {'origem_legado': 'S'}}
# transformações de carga declaradas (expressão Oracle aplicada na extração)
# - empresas.cnpj vem FORMATADO no legado (00.000.000/0000-00, 18 chars) e aqui a coluna guarda só dígitos
TRANSFORMA = {'empresas': {'cnpj': "regexp_replace({c}, '[^0-9]', '')",
                           'insc': "regexp_replace({c}, '[^0-9A-Za-z]', '')",
                           'cep':  "regexp_replace({c}, '[^0-9]', '')"}}

# FILTROS de carga declarados: linha que o destino não aceita e que não vale afrouxar o app para receber.
# `codreferencia_for.codref` tem 4 nulos em 16.229 e o de-para exige o código (o app quebra com nulo).
FILTROS = {'codreferencia_for': 'codref is not null'}

# PKs naturais que a origem repete: a carga fica com a ÚLTIMA linha por chave e CONTA o descarte (§7e)
DEDUP = {'det_aliquota': ['aliquota', 'uf'], 'caixa_pdv': ['codcaixa'],
         # o de-para do fornecedor NÃO é 1:1 no legado (76 chaves com produtos diferentes), mas o UPSERT do
         # recebimento depende da unicidade: a carga fica com a última referência de cada (codfor, codref).
         'codreferencia_for': ['codfor', 'codref']}

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
    tr = TRANSFORMA.get(t, {})
    sel = ", ".join((tr[c].format(c=c) + f" as {c}") if c in tr else c for c, _ in cols)
    chave = DEDUP.get(t)
    if chave:
        # ROW_NUMBER pela PK física (ROWID) — determinístico e sem depender de coluna de data
        ordem = ", ".join(chave)
        cols_alias = ", ".join(c for c, _ in cols)
        cur.execute(f"select {cols_alias} from (select {sel}, row_number() over (partition by {ordem} order by rowid desc) rn from {T}) where rn = 1")
    else:
        onde = FILTROS.get(t)
        cur.execute(f"select {sel} from {T}" + (f" where {onde}" if onde else ""))
    linhas, somas, datas = 0, {}, {}
    with open(f'{saida}/{t}.csv', 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        const = CONSTANTES.get(t, {})
        w.writerow([d for _, d in cols] + list(const))
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
            w.writerow(out + list(const.values())); linhas += 1
    if FILTROS.get(t):
        cur.execute(f"select count(*) from {T}")
        bruto = cur.fetchone()[0]
        if bruto != linhas:
            print(f"       ↳ filtro '{FILTROS[t]}': {bruto - linhas} linha(s) descartada(s) de {bruto}")
    if chave:
        cur.execute(f"select count(*) from {T}")
        bruto = cur.fetchone()[0]
        if bruto != linhas:
            print(f"       ↳ dedup por ({', '.join(chave)}): {bruto - linhas} linha(s) descartada(s) de {bruto}")
    manifesto[t] = {'linhas': linhas, 'dedup': chave, 'colunas': [d for _, d in cols] + list(CONSTANTES.get(t, {})),
                    'somas': {k: str(v) for k, v in somas.items()},
                    'datas': datas,
                    'colunas_origem_descartadas': sorted(set(ori) - {c for c, _ in cols})}
    print(f"  ✅ {t}: {linhas} linhas · {len(cols)} colunas")

json.dump(manifesto, open(f'{saida}/_manifesto.json', 'w'), indent=1, ensure_ascii=False)
print(f"\nmanifesto → {saida}/_manifesto.json")
con.close()
