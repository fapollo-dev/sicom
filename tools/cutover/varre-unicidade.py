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

# 0) PRIMARY KEYs do destino (o ensaio da F0 mostrou `det_aliquota` violando a PK — a v1 desta varredura só
#    olhava índices/constraints UNIQUE e deixava as PKs de fora, que são 207 afirmações a mais sobre o dado)
import json as _json
try:
    _dest = _json.load(open('/Library/Apollo/tools/cutover/schema-destino.json'))['tabelas']
    for _t, _d in _dest.items():
        if _d.get('pk'):
            alvos.append(('schema-destino.json', f'PK_{_t}', _t, ', '.join(_d['pk']), ''))
except FileNotFoundError:
    print('(sem schema-destino.json: rode apps/api/scripts/dump-schema-destino.ts para incluir as PKs)')

# 1) CREATE UNIQUE INDEX ... ON tab (cols) — e DROP INDEX: um índice derrubado por migration posterior não existe
#    mais (ux_mbo_fitid da 120 foi recriado PARCIAL na 186; ux_parceiros_end_doc/ux_operadores_login idem).
#    Sem isto a varredura acusava a versão antiga e enterrava a correção já feita.
for f in sorted(glob.glob(f'{MIG}/*.sql')):
    txt = open(f, encoding='utf-8').read()
    for md in re.finditer(r'DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(\w+)', txt, re.I):
        derrubado = md.group(1).lower()
        alvos[:] = [a for a in alvos if a[1].lower() != derrubado]
    for m in re.finditer(r'CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)\s*\(([^;]*?)\)\s*(?:WHERE\s+([^;]*))?;', txt, re.I | re.S):
        nome, tab, cols, pred = m.group(1), m.group(2), m.group(3), (m.group(4) or '').strip()
        # índice PARCIAL: o predicado faz parte da unicidade. Sem ele a varredura acusou 2 grupos em
        # relacao_operador_perfil que eram pares 'E' (soft-delete) + 'I' — exatamente o que o índice permite.
        alvos.append((os.path.basename(f), nome, tab, cols.strip(), pred))
    # 2) UNIQUE (cols) dentro de CREATE TABLE
    for mt in re.finditer(r'CREATE TABLE IF NOT EXISTS (\w+)\s*\((.*?)\n\);', txt, re.S | re.I):
        tab, corpo = mt.group(1), mt.group(2)
        for mu in re.finditer(r'^\s*UNIQUE\s*\(([^)]*)\)', corpo, re.M | re.I):
            alvos.append((os.path.basename(f), f'inline_{tab}', tab, mu.group(1).strip(), ''))

# ORACLE_HOST escolhe a base: 192.168.1.230 (homologação, padrão) ou hiperpinheirao.ddns.com.br (PRODUÇÃO).
# Produção é SOMENTE OBSERVAÇÃO por instrução do usuário: a sessão abre READ ONLY como guarda — este script só
# faz SELECT, mas a guarda deixa o Oracle recusar qualquer escrita por acidente.
import os as _os
ORACLE_HOST = _os.environ.get("ORACLE_HOST", "192.168.1.230")
con = oracledb.connect(user="pinheirao", password="apollo", dsn=oracledb.makedsn(ORACLE_HOST,1521,sid="apollo"))
con.call_timeout = 600000
con.cursor().execute("SET TRANSACTION READ ONLY")
print(f"[oracle] {ORACLE_HOST} (read only)")
cur = con.cursor()
cur.execute("select table_name from user_tables")
existentes = {r[0] for r in cur.fetchall()}

# o EXTRATOR já trata estas: a PK de vendas/cx_vendas vira coluna *_legado (a PK nova é sequência) e as demais
# são DEDUP por chave (última por ROWID). Ficam listadas à parte para a leitura acusar só o que falta.
TRATADAS = {'PK_vendas': 'RENOMEIA codvendas→codvendas_legado (§7e)', 'PK_cx_vendas': 'RENOMEIA codcxvendas→codcxvendas_legado',
            'PK_caixa_pdv': 'DEDUP codcaixa', 'ux_codref_for': 'DEDUP (codfor, codref)', 'ux_cotacao_prod': 'DEDUP (codctc, idproduto)',
            'ux_cotacao_prodqtde': 'DEDUP (codcpr, idempresa)', 'ux_cotacao_forn_itens': 'DEDUP (codctcforn, codcpr) — app usa ON CONFLICT', 'inline_det_aliquota': 'DEDUP (aliquota, uf)'}
print(f"{len(alvos)} unicidades declaradas nas migrations\n")
viola, ok, sem_tab, pulados = [], [], [], []
for arq, nome, tab, cols, pred in alvos:
    T = tab.upper()
    if T not in existentes:
        sem_tab.append((nome, tab)); continue
    if any(x in cols.lower() for x in ('coalesce', 'nullif', '::', 'case')):
        pulados.append((nome, tab, cols)); continue
    expr = cols
    # ⚠️ semântica do índice único: no Postgres (como no Oracle) **NULL não colide com NULL** — cada NULL é
    # distinto. Sem este filtro o GROUP BY junta todos os NULLs num "grupo" gigante e o relatório superestima
    # (a 1ª versão desta varredura reportou 22.946 linhas em `nf(cod_ped_dev_compra)` que eram 22.931 NULLs).
    where_nn = " AND ".join(f"{c.strip()} IS NOT NULL" for c in expr.split(",") if "(" not in c)
    conds = [x for x in (where_nn, pred) if x]
    # predicado que cita coluna SÓ do destino (origem_legado, indr de tabela que lá não tem): não dá para
    # avaliar no Oracle; quando a query falhar por ORA-00904 o alvo cai em "não avaliadas" com o motivo.
    filtro = ("WHERE " + " AND ".join(f"({c})" for c in conds)) if conds else ""
    try:
        cur.execute(f"select count(*) g, sum(n) l from (select {expr}, count(*) n from {T} {filtro} group by {expr} having count(*)>1)")
        g, l = cur.fetchone()
        if g and g > 0:
            viola.append((nome, tab, cols, g, l or 0))
        else:
            ok.append((nome, tab))
    except Exception as e:
        pulados.append((nome, tab, f"{cols} -> ERRO {str(e)[:60]}"))

print("=== VIOLAM O GOLDEN (a carga rejeitaria) ===")
tratadas = [v for v in viola if v[0] in TRATADAS]
viola = [v for v in viola if v[0] not in TRATADAS]
if tratadas:
    print('=== violam, mas o EXTRATOR já trata ===')
    for nome, tab, cols, g, l in tratadas: print(f'  ✓ {tab}({cols}) [{nome}] — {g} grupos / {l} linhas → {TRATADAS[nome]}')
    print()
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
