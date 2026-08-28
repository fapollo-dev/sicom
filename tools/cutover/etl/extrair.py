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
 'f3': "areceber areceber_bx apagar apagar_bx cx_apagar caixa cartao mov_contas_bancarias movimentacao_bancaria_ofx diario apuracao_pc adiantamento_forn".split(),
 'f2': "pedidocompra pedidocompra_i nf nf_prod nfe_xml cotacao cotacao_prod inventario inventario_livro balanco balancoitens producao troca scrap lote_preco agenda_promocao".split(),
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
CONSTANTES = {'operadores': {'origem_legado': 'S'}, 'parceiros_end': {'origem_legado': 'S'},
              'nf': {'origem_legado': 'S'}}
# transformações de carga declaradas (expressão Oracle aplicada na extração)
# - empresas.cnpj vem FORMATADO no legado (00.000.000/0000-00, 18 chars) e aqui a coluna guarda só dígitos
TRANSFORMA = {
 # §7j: PARCEIROS.IDEMPRESA existe no legado mas é NULA em 17.722 de 18.297 (96,9%) — o parceiro é global na
 # prática. Aqui a coluna é NOT NULL DEFAULT 1 e nenhum dos 17 pontos que consultam parceiros filtra por
 # empresa: a carga preserva os 575 que a casa amarrou a uma loja e usa o default nos demais.
 'parceiros': {'idempresa': 'nvl({c}, 1)'},
 # `nf.sequencia_nfe` é integer aqui e VARCHAR2 no legado, com 'S' gravado (flag usada como texto): só entra o
 # que for número; o resto vira nulo, em vez de derrubar as 23.420 notas.
 # `caixa.nrparcela` é integer aqui e no legado vem como "1/3" (parcela/total): entra só o número da parcela.
 'caixa': {'nrparcela': "case when regexp_like({c}, '^[0-9]+$') then {c} else regexp_substr({c}, '^[0-9]+') end",
           # `formapgto` é integer aqui e no legado guarda o NOME da forma ('BOLETO'…): só entra se for número
           'formapgto': "case when regexp_like({c}, '^[0-9]+$') then {c} else null end"},
 'nf': {'sequencia_nfe': "case when regexp_like({c}, '^[0-9]+$') then {c} else null end"},
 # colunas NOT NULL no destino que a origem deixa nula: a carga preenche o neutro (o app conta com o valor)
 'nf_prod': {'vl_custo': 'nvl({c}, 0)'},
 'empresas': {'cnpj': "regexp_replace({c}, '[^0-9]', '')",
                           'insc': "regexp_replace({c}, '[^0-9A-Za-z]', '')",
                           'cep':  "regexp_replace({c}, '[^0-9]', '')"}}

# FILTROS de carga declarados: linha que o destino não aceita e que não vale afrouxar o app para receber.
# `codreferencia_for.codref` tem 4 nulos em 16.229 e o de-para exige o código (o app quebra com nulo).
FILTROS = {'codreferencia_for': 'codref is not null',
           # `pedidocompra_i.idproduto` é NOT NULL aqui e a origem deixa nulo: item de pedido sem produto não
           # tem o que virar — a carga descarta e conta (não dá para inventar o produto).
           'pedidocompra_i': 'idproduto is not null',
           # pedido de compra sem fornecedor não tem o que virar (codparceiro é NOT NULL aqui): descarta e conta
           'pedidocompra': 'codparceiro is not null'}

# PKs naturais que a origem repete: a carga fica com a ÚLTIMA linha por chave e CONTA o descarte (§7e)
DEDUP = {'det_aliquota': ['aliquota', 'uf'], 'caixa_pdv': ['codcaixa'],
         # o de-para do fornecedor NÃO é 1:1 no legado (76 chaves com produtos diferentes), mas o UPSERT do
         # recebimento depende da unicidade: a carga fica com a última referência de cada (codfor, codref).
         'codreferencia_for': ['codfor', 'codref'],
         'cotacao_prod': ['codctc', 'idproduto']}

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
    ren = dict(RENOMEIA.get(t, {}))
    # REGRA GERAL (fold do ensaio da F2, onde 6 tabelas caíram pelo mesmo motivo): o legado chama a empresa de
    # CODEMPRESA e boa parte do nosso schema chama `idempresa`. Quando o destino exige `idempresa`, a origem não
    # tem essa coluna e tem `codempresa`, a equivalência é essa — sem precisar listar tabela a tabela.
    # a empresa aparece com os DOIS nomes nos dois lados (idempresa aqui, codempresa lá — e vice-versa):
    # a equivalência vale nas duas direções.
    for _dst, _ori in (('idempresa', 'codempresa'), ('codempresa', 'idempresa')):
        if _dst in dest[t]['colunas'] and _dst not in ori and _ori in ori:
            ren.setdefault(_ori, _dst)
    # e quando a coluna EXISTE nos dois lados mas o legado a deixa nula (parceiros, cotacao, pedidocompra,
    # inventario…): o destino é NOT NULL DEFAULT 1 — a carga preserva o que veio e usa o default no resto.
    # REGRA GERAL: coluna NOT NULL no destino que TEM DEFAULT literal — se o legado manda nulo, a carga usa o
    # default declarado no nosso próprio schema (é o valor que o app assumiria de qualquer forma). Cobre de
    # `idempresa` (DEFAULT 1) a percentuais e valores com DEFAULT 0 espalhados pela `nf`.
    import re as _re
    tr_auto = {}
    for _c, _d in dest[t]['colunas'].items():
        if _d.get('nulo') or _c not in ori or _d.get('default') is None:
            continue
        # o default pode ser número (0, 1) OU literal de texto ('N'::bpchar) — o regex antigo só via número,
        # e por isso `pedidocompra.fechado` (default 'N') continuava caindo.
        d_raw = str(_d['default']).strip()
        m_num = _re.match(r"^([-\d.]+)(::[a-z ]+)?$", d_raw)
        m_txt = _re.match(r"^'([^']*)'(::[a-z ]+)?$", d_raw)
        if m_num:
            tr_auto[_c] = 'nvl({c}, ' + m_num.group(1) + ')'
        elif m_txt:
            tr_auto[_c] = "nvl({c}, '" + m_txt.group(1) + "')"
    # `idempresa` NOT NULL **sem** default declarado (inventario, cotacao, pedidocompra): a regra acima não pega,
    # mas o valor neutro é o mesmo — empresa 1. Sem isto o ensaio regride (79.190 → 46.500 em inventario).
    for _emp in ('idempresa', 'codempresa'):
        if _emp in ori and not dest[t]['colunas'].get(_emp, {}).get('nulo', True):
            tr_auto.setdefault(_emp, 'nvl({c}, 1)')
    # FLAG NOT NULL sem default: o repo inteiro usa char(1) 'S'/'N' e o legado deixa nulo em parte das linhas
    # (pedidocompra.fechado foi a que apareceu). O neutro de uma flag é 'N' — declarado aqui, não adivinhado
    # caso a caso.
    for _c, _d in dest[t]['colunas'].items():
        if _c in ori and not _d.get('nulo') and _d.get('default') is None \
           and _d.get('tipo') == 'character' and _d.get('tam') == 1:
            tr_auto.setdefault(_c, "nvl({c}, 'N')")
    # colunas a levar: as que casam por nome (ou por renomeação) com o destino
    cols = [(c, ren.get(c, c)) for c in ori if ren.get(c, c) in dest[t]['colunas']]
    const_auto = {}
    for _c, _d in dest[t]['colunas'].items():
        if _d.get('nulo') or _c in {d for _, d in cols} or _d.get('default') is None:
            continue
        d_raw = str(_d['default']).strip()
        m = _re.match(r"^'?([-\w.]+)'?(::[a-z ]+)?$", d_raw)
        if m and 'nextval' not in d_raw:
            const_auto[_c] = m.group(1)
    for _emp in ('idempresa', 'codempresa'):
        if _emp in dest[t]['colunas'] and not dest[t]['colunas'][_emp].get('nulo', True) \
           and _emp not in {d for _, d in cols}:
            const_auto.setdefault(_emp, '1')
    if not cols:
        manifesto[t] = {'pulada': 'nenhuma coluna casa'}; print(f"  ⛔ {t}: nenhuma coluna casa"); continue
    tr = {**tr_auto, **TRANSFORMA.get(t, {})}
    sel = ", ".join((tr[c].format(c=c) + f" as {c}") if c in tr else c for c, _ in cols)
    chave = DEDUP.get(t)
    if chave:
        # ROW_NUMBER pela PK física (ROWID) — determinístico e sem depender de coluna de data
        ordem = ", ".join(chave)
        cols_alias = ", ".join(c for c, _ in cols)
        onde = FILTROS.get(t)  # o FILTRO também vale no caminho do dedup (era o bug que deixava codref nulo passar)
        cur.execute(f"select {cols_alias} from (select {sel}, row_number() over (partition by {ordem} order by rowid desc) rn from {T}"
                    + (f" where {onde}" if onde else "") + ") where rn = 1")
    else:
        onde = FILTROS.get(t)
        cur.execute(f"select {sel} from {T}" + (f" where {onde}" if onde else ""))
    linhas, somas, datas = 0, {}, {}
    with open(f'{saida}/{t}.csv', 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        const = {**const_auto, **CONSTANTES.get(t, {})}
        w.writerow([d for _, d in cols] + list(const))
        for row in cur:
            out = []
            for (oc, dc), v in zip(cols, row):
                # LOB/RAW: o oracledb devolve objeto LOB (CLOB do XML da NF-e) ou bytes — o csv.writer não sabe
                # serializar nenhum dos dois. CLOB vira texto; binário vira hex (a carga decide o que fazer).
                if hasattr(v, 'read'):
                    v = v.read()
                if isinstance(v, bytes):
                    try:
                        v = v.decode('utf-8')
                    except UnicodeDecodeError:
                        v = v.hex()
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
