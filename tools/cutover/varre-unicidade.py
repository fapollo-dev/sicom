#!/usr/bin/env python3
"""
VARREDURA DE UNICIDADE — pré-requisito do ensaio de carga (cutover).

Lê TODAS as unicidades declaradas nas nossas migrations (`CREATE UNIQUE INDEX` e `UNIQUE(...)` dentro de
`CREATE TABLE`) e confronta cada uma com o dado real do Oracle. Existe porque uma unicidade nossa é uma
**afirmação sobre o dado do cliente** — e a auditoria de 2026-08-26 mostrou duas inventadas que o golden viola
(`nf_prod_lote` e `ux_inventario_produto`, ~24 mil linhas). Índice único inventado NÃO aparece no smoke, que
cria dado limpo: só explode na carga.

Uso (Oracle é SOMENTE LEITURA):
    /Library/Developer/CommandLineTools/usr/bin/python3 tools/cutover/varre-unicidade.py

Saída: violações (grupos e linhas), as que passam, as tabelas que não existem no Oracle (nossas) e as
expressões que o script não avalia sozinho (revisão manual).
"""
import re, os, glob
import oracledb

MIG = '/Library/Apollo/apps/api/migrations'
alvos = []  # (origem, tabela, [colunas], expressao?)

# 1) CREATE UNIQUE INDEX ... ON tab (cols)
for f in sorted(glob.glob(f'{MIG}/*.sql')):
    txt = open(f, encoding='utf-8').read()
    for m in re.finditer(r'CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)\s*\(([^;]*?)\)\s*(?:WHERE[^;]*)?;', txt, re.I | re.S):
        nome, tab, cols = m.group(1), m.group(2), m.group(3)
        alvos.append((os.path.basename(f), nome, tab, cols.strip()))
    # 2) UNIQUE (cols) dentro de CREATE TABLE
    for mt in re.finditer(r'CREATE TABLE IF NOT EXISTS (\w+)\s*\((.*?)\n\);', txt, re.S | re.I):
        tab, corpo = mt.group(1), mt.group(2)
        for mu in re.finditer(r'^\s*UNIQUE\s*\(([^)]*)\)', corpo, re.M | re.I):
            alvos.append((os.path.basename(f), f'inline_{tab}', tab, mu.group(1).strip()))

con = oracledb.connect(user="pinheirao", password="apollo", dsn=oracledb.makedsn("192.168.1.230",1521,sid="apollo"))
con.call_timeout = 600000
cur = con.cursor()
cur.execute("select table_name from user_tables")
existentes = {r[0] for r in cur.fetchall()}

print(f"{len(alvos)} unicidades declaradas nas migrations\n")
viola, ok, sem_tab, pulados = [], [], [], []
for arq, nome, tab, cols in alvos:
    T = tab.upper()
    if T not in existentes:
        sem_tab.append((nome, tab)); continue
    if any(x in cols.lower() for x in ('coalesce', 'nullif', '::', 'case')):
        pulados.append((nome, tab, cols)); continue
    expr = cols
    try:
        cur.execute(f"select count(*) g, sum(n) l from (select {expr}, count(*) n from {T} group by {expr} having count(*)>1)")
        g, l = cur.fetchone()
        if g and g > 0:
            viola.append((nome, tab, cols, g, l or 0))
        else:
            ok.append((nome, tab))
    except Exception as e:
        pulados.append((nome, tab, f"{cols} -> ERRO {str(e)[:60]}"))

print("=== VIOLAM O GOLDEN (a carga rejeitaria) ===")
for nome, tab, cols, g, l in sorted(viola, key=lambda x: -x[4]):
    print(f"  ❌ {tab}({cols})  [{nome}] — {g} grupos / {l} linhas")
if not viola: print("  (nenhuma)")
print(f"\n=== OK ({len(ok)}) ===")
print("  " + ", ".join(f"{t}" for _, t in ok))
print(f"\n=== tabela não existe no Oracle ({len(sem_tab)}) — nossas ou renomeadas ===")
print("  " + ", ".join(f"{t}" for _, t in sem_tab))
print(f"\n=== não avaliadas ({len(pulados)}) ===")
for nome, tab, c in pulados: print(f"  ~ {tab}: {c[:90]}")
con.close()
