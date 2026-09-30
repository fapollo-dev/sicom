#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CONFERIDOR DE COLUNAS NÃO ESCRITAS — o terceiro sentido, do lado do APLICATIVO.

Os dois sentidos do `conferir-colunas-orfas.py` olham a CARGA: o que a origem tem e o destino não, e o contrário.
Este olha o CÓDIGO: a coluna existe no destino, vem na carga, e **nenhuma tela do Apollo a escreve** — a linha que
o legado criava preenchida nasce no Apollo com ela vazia, sem erro nenhum. Foi o que escondeu (25/09/2026):

  · `nf_prod.descricao` — fora da lista do agregado; todo item de NF nascido no Apollo ficava sem descrição,
    enquanto a produção tem 6.391 de 6.391 itens de set/2026 preenchidos;
  · `adiantamento_forn.iddocgerado` — o título gerado, 25 de 25 desde o binário novo, que o Apollo nunca gravava.

Método (heurística de triagem, não prova):
  1. as tabelas que o Apollo GRAVA: `insertInto('t')`, `updateTable('t')`, `INSERT INTO t`, `UPDATE t SET` e
     `tabela: 't'` (os cadastros do motor) em apps/api/src;
  2. uma coluna conta como escrita se o nome dela aparece num arquivo que também cita a tabela, ou em qualquer arquivo
     do motor genérico (apps/api/src/shared) — nome comum ("descricao") passa por escrito, é o limite do método;
  3. na PRODUÇÃO (só leitura), as 2.000 linhas mais novas pela PK de cada tabela: quanto de cada coluna está preenchido.

Sai a lista das colunas preenchidas em >= 50% das linhas recentes do legado que nenhum código do Apollo cita. Cada uma
é um candidato a olhar: pode ser coluna de outro processo (integração, PDV), pode ser buraco.

Uso (só leitura no Oracle):
    python3 tools/cutover/conferir-colunas-nao-escritas.py [--min=0.5] [--amostra=2000] [--so=tabela1,tabela2]
"""
import ast
import json
import os
import re
import sys

import oracledb

BASE = '/Library/Apollo/tools/cutover'
SRC = '/Library/Apollo/apps/api/src'
ORACLE = dict(user='pinheirao', password='apollo', dsn='hiperpinheirao.ddns.com.br:1521/apollo')

ARGS = dict(a.lstrip('-').split('=', 1) for a in sys.argv[1:] if '=' in a)
MINIMO = float(ARGS.get('min', 0.5))
AMOSTRA = int(ARGS.get('amostra', 2000))


def _consts_do_extrator(caminho, nomes):
    # por AST, sem importar (o extrator não tem guarda `if __name__` — importá-lo dispararia a extração)
    arvore = ast.parse(open(caminho, encoding='utf-8').read())
    out = {n: {} for n in nomes}
    for no in arvore.body:
        if isinstance(no, ast.Assign) and len(no.targets) == 1 and isinstance(no.targets[0], ast.Name) \
                and no.targets[0].id in out:
            try:
                out[no.targets[0].id] = ast.literal_eval(no.value)
            except ValueError:
                pass
    return out


_c = _consts_do_extrator(f'{BASE}/etl/extrair.py', ['RENOMEIA', 'TABELA_ORIGEM'])
plano = json.load(open(f'{BASE}/plano-tabelas.json'))
TABELA_ORIGEM = {**_c['TABELA_ORIGEM'], **plano.get('tabela_origem', {})}
RENOMEIA = _c['RENOMEIA']
schema = json.load(open(f'{BASE}/schema-destino.json'))['tabelas']

# carimbos que o motor escreve em toda tabela, e o que é só do Apollo
GENERICAS = re.compile(r'^(usultalteracao|dtultimalteracao|dtcadastro|indr|indr_usuario|indr_data|criado_em|atualizado_em|origem_legado)$')
PALAVRA = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')
GRAVA = [
    re.compile(r"""insertInto\(\s*['"]([a-z_0-9]+)['"]"""),
    re.compile(r"""updateTable\(\s*['"]([a-z_0-9]+)['"]"""),
    re.compile(r"""\bINSERT\s+INTO\s+([a-z_0-9]+)""", re.I),
    re.compile(r"""\bUPDATE\s+([a-z_0-9]+)\s+(?:[a-z]\s+)?SET\b""", re.I),
    re.compile(r"""\btabela:\s*['"]([a-z_0-9]+)['"]"""),
]


def ler_codigo():
    arquivos = {}
    for raiz, _, nomes in os.walk(SRC):
        for n in nomes:
            if n.endswith('.ts') and n != 'db-types.ts':
                p = os.path.join(raiz, n)
                arquivos[p] = open(p, encoding='utf-8').read()
    return arquivos


def main() -> int:
    arquivos = ler_codigo()
    palavras = {p: {w.lower() for w in PALAVRA.findall(t)} for p, t in arquivos.items()}
    motor = set().union(*(w for p, w in palavras.items() if p.startswith(f'{SRC}/shared/')))
    gravadas = set()
    for t in arquivos.values():
        for rx in GRAVA:
            gravadas |= {m.lower() for m in rx.findall(t)}
    gravadas &= set(schema)
    if ARGS.get('so'):  # --so=t1,t2: só estas tabelas (reamostrar sem refazer as outras)
        gravadas &= {x.strip() for x in ARGS['so'].split(',')}

    c = oracledb.connect(**ORACLE)
    c.call_timeout = 90000  # uma consulta que passa de 90 s (a VENDAS, 18,9 milhões) é cortada: triagem não pesa na produção
    cu = c.cursor()
    cu.execute("SET TRANSACTION READ ONLY")
    origens = {t: TABELA_ORIGEM.get(t, t.upper()) for t in gravadas}
    lista = ", ".join(f"'{o}'" for o in sorted(set(origens.values())))
    cu.execute(f"select table_name, column_name, data_type from user_tab_columns where table_name in ({lista})")
    cols_origem: dict = {}
    for tab, col, tipo in cu.fetchall():
        cols_origem.setdefault(tab, []).append((col, tipo))
    cu.execute(f"""select c.table_name, cc.column_name from user_constraints c
                    join user_cons_columns cc on cc.constraint_name = c.constraint_name
                   where c.constraint_type = 'P' and c.table_name in ({lista})
                     and (select count(*) from user_cons_columns x where x.constraint_name = c.constraint_name) = 1""")
    pk = {t: f'"{col}" desc' for t, col in cu.fetchall()}
    # PK composta: a ordem do índice da própria PK (todas as colunas desc) — "mais nova" pela chave, com stopkey no índice
    cu.execute(f"""select c.table_name, listagg('"' || cc.column_name || '" desc', ', ') within group (order by cc.position)
                     from user_constraints c join user_cons_columns cc on cc.constraint_name = c.constraint_name
                    where c.constraint_type = 'P' and c.table_name in ({lista})
                    group by c.table_name having count(*) > 1""")
    composta = dict(cu.fetchall())
    # sem PK: a 1ª coluna de data, só em tabela pequena (ordenar milhões de linhas sem índice pesa na produção)
    cu.execute(f"select table_name, num_rows from user_tables where table_name in ({lista})")
    linhas_est = {t: n for t, n in cu.fetchall()}  # sem estatística (None) = tamanho desconhecido: não ordena
    NOME_DATA = re.compile(r'^(DTULTIMALTERACAO|DTCADASTRO|DATA\w*|DT\w*)$')
    for o, cols in cols_origem.items():
        if o in pk:
            continue
        if o in composta:
            pk[o] = composta[o]
            continue
        datas = [col for col, tipo in cols if (tipo == 'DATE' or tipo.startswith('TIMESTAMP')) and NOME_DATA.match(col)]
        if datas and linhas_est.get(o) is not None and linhas_est[o] <= 200000:
            pk[o] = f'"{datas[0]}" desc nulls last'

    achados = []
    sem_pk = []
    for t in sorted(gravadas):
        o = origens[t]
        if o not in cols_origem:
            continue
        if o not in pk:
            sem_pk.append(t)
            continue
        ren = {k.lower(): v for k, v in RENOMEIA.get(t, {}).items()}
        destino = schema[t]['colunas']
        # a coluna do destino que vem desta coluna da origem, e que nenhum arquivo que cita a tabela menciona
        candidatas = []
        for col, tipo in cols_origem[o]:
            d = ren.get(col.lower(), col.lower())
            if d not in destino or GENERICAS.match(d) or d in motor:
                continue
            # o destino a preenche sozinho (sequência, carimbo) — a linha nova já nasce com ela
            if re.match(r'(nextval\(|now\(\)|CURRENT_)', str(destino[d].get('default') or '')):
                continue
            citada = any(t in w and d in w for w in palavras.values())
            if not citada:
                candidatas.append((col, d, tipo))
        if not candidatas:
            continue
        # LOB não entra no count do Oracle — fica listada à parte
        lobs = [d for col, d, tipo in candidatas if tipo in ('CLOB', 'BLOB', 'NCLOB', 'LONG')]
        candidatas = [x for x in candidatas if x[2] not in ('CLOB', 'BLOB', 'NCLOB', 'LONG')]
        for d in lobs:
            achados.append((t, d, 'LOB', None, None, None, None))
        if not candidatas:
            continue
        amostra = (f'(select {", ".join(chr(34) + col + chr(34) for col, _, _ in candidatas)} from "{o}" '
                   f'order by {pk[o]}) where rownum <= {AMOSTRA}')
        conta = ", ".join(f'count("{col}")' for col, _, _ in candidatas)
        print(f'  · {t}', file=sys.stderr, flush=True)
        try:
            cu.execute(f'select count(*), {conta} from {amostra}')
        except oracledb.DatabaseError as e:
            print(f'  ! {t}: {e}', file=sys.stderr)
            sem_pk.append(t)
            # o corte por tempo derruba a sessão no modo thin: abre outra, de novo só leitura
            c = oracledb.connect(**ORACLE)
            c.call_timeout = 90000
            cu = c.cursor()
            cu.execute("SET TRANSACTION READ ONLY")
            continue
        linha = cu.fetchone()
        total = linha[0] or 0
        if not total:
            continue
        for (col, d, tipo), n in zip(candidatas, linha[1:]):
            if n / total < MINIMO:
                continue
            # o valor mais comum: 100% de um valor igual ao DEFAULT do destino já sai certo sem código nenhum
            cu.execute(f'select "{col}", count(*) from (select "{col}" from {amostra}) where "{col}" is not null '
                       f'group by "{col}" order by 2 desc fetch first 1 rows only')
            moda, nm = cu.fetchone() or (None, 0)
            achados.append((t, d, tipo, n, total, moda, nm))

    print(f'# colunas preenchidas em >= {MINIMO:.0%} das {AMOSTRA} linhas mais novas do legado que nenhum código do Apollo cita')
    print(f'# tabelas gravadas pelo Apollo: {len(gravadas)} · amostradas (PK simples, PK composta ou data): {len(gravadas) - len(sem_pk)}')
    atual = None
    cobertas = 0
    for t, d, tipo, n, total, moda, nm in achados:
        padrao = schema[t]['colunas'][d].get('default')
        if n is not None and nm == total and padrao is not None and str(moda).strip("'") in str(padrao):
            cobertas += 1   # 100% um valor só, e é o DEFAULT do destino: a linha nova já nasce com ele
            continue
        if t != atual:
            print(f'\n{t}')
            atual = t
        if n is None:
            print(f'  {d:32} LOB (não amostrada)')
            continue
        print(f'  {d:32} {tipo:14} {n:>6}/{total:<6} {n / total:6.1%}   moda={str(moda)[:24]!s:26} {nm / total:6.1%}   default={padrao}')
    if sem_pk:
        print(f'\n# sem PK e grandes demais para ordenar pela data (não amostradas): {", ".join(sem_pk)}')
    print(f'\n# {len(achados) - cobertas} candidatas ({cobertas} cobertas pelo DEFAULT do destino ficaram de fora)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
