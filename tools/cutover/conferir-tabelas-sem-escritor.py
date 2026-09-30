#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CONFERIDOR DE TABELAS LIDAS SEM ESCRITOR — o quarto sentido, a tabela inteira.

O `conferir-colunas-nao-escritas.py` pega a COLUNA que nenhuma tela grava. Este pega a TABELA: o Apollo a LÊ (uma regra, uma
tela, uma view de relatório), a carga a enche com o dado do legado, e **nenhum código do Apollo a grava** — funciona no ensaio
e para no dia seguinte à virada, sem erro nenhum. Foi o que escondeu (30/09/2026) a análise dos itens do manifesto: a
importação da NF lia o FATOREMBAL de NFE_NAO_CADASTRADAS_ITENS, e a tela que grava a tabela não existia no Apollo.

Método (triagem, não prova):
  1. ESCRITA no Apollo: `insertInto('t')`, `updateTable('t')`, `INSERT INTO t`, `UPDATE t SET`, `tabela: 't'` (o motor dos
     cadastros) em apps/api/src, e os mesmos padrões dentro de funções/gatilhos das migrations (o corpo entre $$ … $$) —
     o INSERT solto de uma migration é carga inicial, não escritor;
  2. LEITURA no Apollo: `selectFrom('t')`, `FROM t`, `JOIN t` em apps/api/src, ou a tabela dentro de uma view das migrations;
  3. na PRODUÇÃO (só leitura): as linhas e a data mais nova da tabela de origem (a 1ª coluna DATE/TIMESTAMP de nome de data).

Sai a lista das tabelas lidas, nunca gravadas, com movimento na produção desde --desde. Cada uma é um candidato: pode ser
tabela de outro sistema (PDV, integração, binário novo), pode ser uma tela que falta.

Uso (só leitura no Oracle):
    python3 tools/cutover/conferir-tabelas-sem-escritor.py [--desde=2026-01-01]
"""
import ast
import json
import os
import re
import sys

import oracledb

BASE = '/Library/Apollo/tools/cutover'
SRC = '/Library/Apollo/apps/api/src'
MIG = '/Library/Apollo/apps/api/migrations'
ORACLE = dict(user='pinheirao', password='apollo', dsn='hiperpinheirao.ddns.com.br:1521/apollo')
ARGS = dict(a.lstrip('-').split('=', 1) for a in sys.argv[1:] if '=' in a)
DESDE = ARGS.get('desde', '2026-01-01')


def _consts(caminho, nomes):
    arvore = ast.parse(open(caminho, encoding='utf-8').read())
    out = {n: {} for n in nomes}
    for no in arvore.body:
        if isinstance(no, ast.Assign) and len(no.targets) == 1 and isinstance(no.targets[0], ast.Name) and no.targets[0].id in out:
            try:
                out[no.targets[0].id] = ast.literal_eval(no.value)
            except ValueError:
                pass
    return out


_c = _consts(f'{BASE}/etl/extrair.py', ['TABELA_ORIGEM'])
plano = json.load(open(f'{BASE}/plano-tabelas.json'))
ORIGEM = {**_c['TABELA_ORIGEM'], **plano.get('tabela_origem', {})}
destino = json.load(open(f'{BASE}/schema-destino.json'))['tabelas']
TABELAS = sorted(destino.keys())


def ler(caminho):
    try:
        return open(caminho, encoding='utf-8', errors='replace').read()
    except OSError:
        return ''


codigo = []
for raiz, _, arqs in os.walk(SRC):
    for a in arqs:
        if a.endswith('.ts') and not a.endswith('.spec.ts'):
            codigo.append(ler(os.path.join(raiz, a)))
TS = '\n'.join(codigo)

migs = [ler(os.path.join(MIG, a)) for a in sorted(os.listdir(MIG)) if a.endswith('.sql')]
CORPOS = '\n'.join(b for texto in migs for _, b in re.findall(r'\$(\w*)\$(.*?)\$\1\$', texto, flags=re.S))
VIEWS = '\n'.join(v for texto in migs for v in re.findall(r'CREATE (?:OR REPLACE )?VIEW\s.*?;', texto, flags=re.S | re.I))


def escreve(t):
    ts = re.search(rf"(insertInto|updateTable)\(\s*['\"]{t}(?:\s+as\s+\w+)?['\"]", TS) \
        or re.search(rf"\b(INSERT\s+INTO|UPDATE)\s+{t}\b", TS, flags=re.I) \
        or re.search(rf"tabela:\s*['\"]{t}['\"]", TS)
    gatilho = re.search(rf"\b(INSERT\s+INTO|UPDATE)\s+{t}\b", CORPOS, flags=re.I)
    return bool(ts or gatilho)


def le(t):
    return bool(re.search(rf"selectFrom\(\s*['\"]{t}(?:\s+as\s+\w+)?['\"]", TS)
                or re.search(rf"\b(FROM|JOIN)\s+{t}\b", TS, flags=re.I)
                or re.search(rf"\b(FROM|JOIN)\s+{t}\b", VIEWS, flags=re.I))


NOMES_VIEW = {v.lower() for texto in migs for v in re.findall(r'CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(\w+)', texto, flags=re.I)}
candidatas = [t for t in TABELAS if t not in NOMES_VIEW and le(t) and not escreve(t)]
print(f'# {len(TABELAS)} tabelas no destino · {len(candidatas)} lidas pelo Apollo e nunca gravadas por ele', file=sys.stderr)

con = oracledb.connect(**ORACLE)
con.call_timeout = 60000
cu = con.cursor()
cu.execute('SET TRANSACTION READ ONLY')
NOME_DATA = re.compile(r'(DT|DATA|DATE|EMISSAO|CADASTRO|ALTERACAO|MOVIMENTO|LANCAMENTO|VENDA|INCLUSAO)', re.I)

saida = []
for t in candidatas:
    origem = str(ORIGEM.get(t, t)).upper()
    cu.execute("SELECT column_name, data_type FROM all_tab_columns WHERE owner = 'PINHEIRAO' AND table_name = :t ORDER BY column_id", t=origem)
    cols = cu.fetchall()
    if not cols:
        continue
    datas = [c for c, tipo in cols if (tipo == 'DATE' or tipo.startswith('TIMESTAMP')) and NOME_DATA.search(c)]
    try:
        if datas:
            d = datas[0]
            cu.execute(f'SELECT count(*), max({d}), sum(CASE WHEN {d} >= DATE \'{DESDE}\' THEN 1 ELSE 0 END) FROM {origem}')
            n, mx, recentes = cu.fetchone()
        else:
            cu.execute(f'SELECT count(*) FROM {origem}')
            n, mx, recentes, d = cu.fetchone()[0], None, None, None
    except oracledb.Error as e:
        print(f'{t}: erro {e}', file=sys.stderr)
        continue
    if not n:
        continue
    vivo = recentes is None or (recentes or 0) > 0
    if vivo:
        saida.append((t, origem, n, d, mx, recentes))

print(f'{"tabela":36} {"origem":36} {"linhas":>10}  {"coluna de data":26} {"mais nova":20} {"desde " + DESDE:>12}')
for t, o, n, d, mx, rec in sorted(saida, key=lambda x: -(x[5] or 0)):
    print(f'{t:36} {o:36} {n:>10}  {str(d or "-"):26} {str(mx or "-")[:19]:20} {str(rec if rec is not None else "?"):>12}')
