#!/usr/bin/env python3
"""
MAPA COLUNA-A-COLUNA por evidência (ETL do cutover).

Cruza o schema REAL do destino (`tools/cutover/schema-destino.json`, gerado por
`apps/api/scripts/dump-schema-destino.ts`) com o dicionário do Oracle, tabela a tabela, e aponta o que o ETL
precisa resolver ANTES de rodar: coluna que só existe no destino (default/derivação), coluna que só existe na
origem (descartada de propósito?), e — o que mais dói — **capacidade menor no destino** (varchar/numeric que
truncaria ou estouraria na carga).

Uso:  /Library/Developer/CommandLineTools/usr/bin/python3 tools/cutover/etl/mapa-colunas.py [fase]
"""
import json, sys, oracledb

FASES = {
 'f2': "pedidocompra pedidocompra_i nf nf_prod nfe_xml cotacao cotacao_prod inventario inventario_livro balanco balancoitens producao troca scrap lote_preco agenda_promocao".split(),
 'f1': "empresas configuracoes configuracoes_especificas operadores perfil permissoes parceiros parceiros_end parceiros_bancos produtos composicao decomposicao receita_prod codauxiliar codreferencia_for multi_preco estoque contas_bancarias formas_pgto".split(),
 'f0': "bancos cidades bairro cfop ncm aliquota tributacao piscofins det_aliquota figura_fiscal unidade marcas familias_prod familias_prod_area plc plano_contas condicoes_pagto operacoes_conta".split(),
}
fase = (sys.argv[1] if len(sys.argv) > 1 else 'f0').lower()
alvos = FASES[fase]

dest = json.load(open('/Library/Apollo/tools/cutover/schema-destino.json'))['tabelas']
con = oracledb.connect(user="pinheirao", password="apollo", dsn=oracledb.makedsn("192.168.1.230",1521,sid="apollo"))
con.call_timeout = 600000
cur = con.cursor()
cur.execute("select table_name from user_tables")
ora_tabs = {r[0] for r in cur.fetchall()}

print(f"== MAPA {fase.upper()} — {len(alvos)} tabelas ==\n")
problemas = 0
for t in alvos:
    T = t.upper()
    if t not in dest:
        print(f"  ⛔ {t}: NÃO existe no destino"); problemas += 1; continue
    if T not in ora_tabs:
        print(f"  ○ {t}: sem origem no Oracle (nossa/seed)"); continue
    cur.execute("""select column_name, data_type, data_length, data_precision, data_scale, nullable
                     from user_tab_columns where table_name = :t""", t=T)
    ori = {r[0].lower(): dict(tipo=r[1], len=r[2], prec=r[3], esc=r[4], nulo=r[5] == 'Y') for r in cur.fetchall()}
    dst = dest[t]['colunas']
    cur.execute(f"select count(*) from {T}")
    n = cur.fetchone()[0]

    so_destino = [c for c in dst if c not in ori]
    so_origem = [c for c in ori if c not in dst]
    curtas = []
    for c, d in dst.items():
        o = ori.get(c)
        if not o: continue
        if d['tipo'] in ('character varying', 'character') and o['tipo'] in ('VARCHAR2', 'CHAR', 'NVARCHAR2'):
            if d['tam'] and o['len'] and d['tam'] < o['len']:
                curtas.append(f"{c} {d['tam']}<{o['len']}")
        if d['tipo'] == 'numeric' and o['tipo'] == 'NUMBER' and d['tam'] and o['prec'] and d['tam'] < o['prec']:
            curtas.append(f"{c} num({d['tam']})<({o['prec']})")
    # a DECLARAÇÃO menor não é problema por si: o que decide é o dado real (cnpj varchar(14) × VARCHAR2(30) nunca
    # estoura). Mede-se `max(length)` das candidatas e só sobra o que REALMENTE não cabe.
    estouram = []
    for item in curtas:
        c = item.split()[0]
        if 'num(' in item:
            cur.execute(f"select max(length(to_char(abs({c})))) from {T}")
        else:
            cur.execute(f"select max(length({c})) from {T}")
        real = cur.fetchone()[0] or 0
        cap = dst[c]['tam']
        if cap and real > cap:
            estouram.append(f"{c}: dado {real} > destino {cap}")
    curtas = estouram
    flag = "⚠️ " if (curtas or so_destino) else "✅ "
    print(f"  {flag}{t}: {n} linhas · destino {len(dst)} col × origem {len(ori)}")
    if curtas:      print(f"       NÃO CABE (dado real medido): {', '.join(curtas[:6])}"); problemas += 1
    if so_destino:  print(f"       só no destino ({len(so_destino)}): {', '.join(so_destino[:8])}")
    if so_origem:   print(f"       só na origem ({len(so_origem)}): {', '.join(so_origem[:8])}")
print(f"\n{problemas} tabela(s) com problema que bloqueia carga.")
con.close()
