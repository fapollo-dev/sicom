#!/usr/bin/env python3
"""
CONTAGENS-ÂNCORA do ORACLE (metade 1 de 2 — passo 4.1 do RUNBOOK-DA-VIRADA).

A reconciliação da carga confere CSV → Postgres. Falta conferir **Oracle → Postgres**, que é o que o cliente
entende: "tenho 18.883.845 vendas no sistema velho, tenho as mesmas no novo?". Este script conta no Oracle e
grava `tools/cutover/ancoras-oracle.json`; quem compara com o Postgres é
`apps/api/scripts/conferir-ancoras.ts` (o Node é que tem driver de Postgres aqui — não há `psql` na máquina).

Uso:  ORACLE_HOST=<host> python3 tools/cutover/conferir-ancoras.py
      pnpm --filter @apollo/api exec ts-node --transpile-only scripts/conferir-ancoras.ts
"""
import json, os, sys
import oracledb

BASE = '/Library/Apollo/tools/cutover'
# as tabelas que o cliente reconhece — não é a lista inteira, é a que se olha na hora do go/no-go
ANCORAS = ['vendas', 'cx_vendas', 'nf', 'nf_prod', 'historico_prod', 'estoque', 'produtos', 'parceiros',
           'areceber', 'apagar', 'caixa', 'cartao', 'diario', 'operadores', 'multi_preco', 'pedidocompra']
TABELA_ORIGEM = {'lote_preco': 'LOTEPRECO'}

host = os.environ.get('ORACLE_HOST', '192.168.1.230')
con = oracledb.connect(user='pinheirao', password='apollo', dsn=oracledb.makedsn(host, 1521, sid='apollo'))
con.call_timeout = 900000
cur = con.cursor()
cur.execute('SET TRANSACTION READ ONLY')

# o que a carga descarta de propósito, para a diferença não parecer perda silenciosa
try:
    import re
    src = open(f'{BASE}/etl/extrair.py', encoding='utf-8').read()
    tem_filtro = set(re.findall(r"'(\w+)':\s*'[^']*is not null'", src))
except Exception:
    tem_filtro = set()

contagens = {}
for t in ANCORAS:
    try:
        cur.execute(f'select count(*) from {TABELA_ORIGEM.get(t, t.upper())}')
        contagens[t] = cur.fetchone()[0]
        print(f'  {t:22} {contagens[t]:>14,}')
    except Exception as e:
        contagens[t] = None
        print(f'  {t:22} {"ERRO":>14}  {str(e)[:60]}')

json.dump({'host': host, 'contagens': contagens, 'com_filtro': sorted(tem_filtro)},
          open(f'{BASE}/ancoras-oracle.json', 'w'), indent=1, ensure_ascii=False)
print(f'\n→ {BASE}/ancoras-oracle.json  (agora rode o conferir-ancoras.ts)')
