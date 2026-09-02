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

# NUMBER vem como float por padrão no python-oracledb, e float faz duas coisas ruins aqui: escreve
# ruído de ponto flutuante no CSV de dinheiro e some da reconciliação (o extrator só somava Decimal,
# e por isso TODOS os 69 manifestos do ensaio saíram com `somas: {}` — 20,9M linhas conferidas só por
# contagem). Com `fetch_decimals` o valor chega exato e a soma por coluna volta a existir.
oracledb.defaults.fetch_decimals = True

BASE = '/Library/Apollo/tools/cutover'
FASES = {
 'f4': "vendas cx_vendas historico_prod historico_dinamico caixa_pdv nfe_nao_cadastradas".split(),
 'f3': "areceber areceber_bx apagar apagar_bx cx_apagar caixa cartao mov_contas_bancarias movimentacao_bancaria_ofx diario apuracao_pc adiantamento_forn".split(),
 'f2': "pedidocompra pedidocompra_i nf nf_prod nfe_xml cotacao cotacao_prod inventario inventario_livro balanco balancoitens producao troca scrap lote_preco agenda_promocao".split(),
 'f1': "empresas configuracoes configuracoes_especificas operadores perfil permissoes parceiros parceiros_end parceiros_bancos produtos composicao decomposicao receita_prod codauxiliar codreferencia_for multi_preco estoque contas_bancarias formas_pgto".split(),
 'f0': "bancos cidades bairro cfop ncm aliquota piscofins det_aliquota figura_fiscal unidade marcas familias_prod familias_prod_area plc plano_contas condicoes_pagto operacoes_conta".split(),
}
# renomeações origem→destino que o casamento por nome não resolve (achadas pelo mapa-colunas.py)
# tabelas cujo nome no Oracle difere do nosso (o padrão é só maiúsculas)
TABELA_ORIGEM = {'lote_preco': 'LOTEPRECO'}
RENOMEIA = {
 # tabelas que o plano antigo não cobria (§7s): nomes do Oracle → nossos
 'pedido_devolucao_compra': {'cod_pedido_dev_compra': 'codpeddevcompra', 'cod_parceiro': 'codparceiro', 'cod_operador': 'codoperador',
                             'cod_empresa': 'idempresa', 'data_pedido': 'data', 'status_pedido': 'status',
                             'cod_nota_fiscal_emitida': 'codnf_emitida', 'observacoes': 'obs'},
 # a mig 008 batizou a alíquota interna de `aliquota_dest`; no legado é ALIQUOTA
 'indexador_tributario': {'aliquota': 'aliquota_dest'},
 'aliquota': {'aliquota': 'codigo'},
 # §7e: o código do Oracle NÃO entra na PK (lá é por venda/cupom, não por linha) — vira coluna de referência
 'vendas': {'codvendas': 'codvendas_legado'},
 'cx_vendas': {'codcxvendas': 'codcxvendas_legado'},
 # KARDEX: o legado nomeia o movimento por "alteração" e "atual"; nós, por "qtde" e "saldo". A equivalência é
 # direta (qtde_alter = o quanto mexeu; qtde_atual = o saldo depois), e `saldo_anterior` sai da subtração — é a
 # única coluna DERIVADA da carga inteira, e ela existe porque o nosso kardex guarda os dois lados do salto.
 'historico_prod': {'qtde_alter': 'qtde', 'qtde_atual': 'saldo_novo', 'origem_documento': 'origem'},
 # o legado chama a empresa de CODEMPRESA; aqui a coluna é idempresa nessas duas
 'empresas': {'codempresa': 'idempresa', 'razaosocial': 'razao_social'},
 'parceiros': {'codempresa': 'idempresa'},
}
# colunas CONSTANTES que o destino exige e a origem não tem (§7b: sem `origem_legado='S'` o índice parcial de
# login rejeita os 15 operadores com login repetido do cliente)
# colunas CALCULADAS na extração (expressão Oracle que vira coluna nova no CSV)
CALCULADAS = {
  # ICMS_CFOP do legado não tem TIPO; o nosso resumo por CFOP separa entradas e saídas por ele. Deriva do
  # primeiro dígito do CFOP (1/2/3 = entrada, 5/6/7 = saída) — a mesma regra do nosso serviço de apuração.
  # CONFIG_PLANO_CONTAS guarda a máscara como NDIG_1..NDIG_8 (larguras por nível); a nossa é o CSV '1,1,2,2,5'.
  'config_plano_contas': {'mascara': "rtrim(" + "||".join(f"nvl2(ndig_{i}, to_char(ndig_{i})||',', '')" for i in range(1, 9)) + ", ',')"},
  'icms_cfop': {'tipo': "case when substr(to_char(cfop),1,1) in ('1','2','3') then 'E' else 'S' end"},
  'historico_prod': {
    # saldo antes do movimento = saldo depois − o que mexeu
    'saldo_anterior': 'nvl(qtde_atual,0) - nvl(qtde_alter,0)',
    # `tipo` é E/S conforme o sinal do movimento (o legado guarda só o delta assinado)
    'tipo': "case when nvl(qtde_alter,0) < 0 then 'S' else 'E' end"}}

CONSTANTES = {'operadores': {'origem_legado': 'S'}, 'arquivo_remessa_areceber': {'origem_legado': 'S'}, 'parceiros_end': {'origem_legado': 'S'},
              'nf': {'origem_legado': 'S'},
              'movimentacao_bancaria_ofx': {'origem_legado': 'S'}, 'adiantamento_forn': {'origem_legado': 'S'},
              'nfe_nao_cadastradas': {'origem_legado': 'S'}}
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
 # APURACAO_PC_DET.TIPO no legado é texto ('ENTRADA' 118 · 'SAIDA NF' 27 · 'NFC-e' 48); o nosso é o papel na
 # apuração: 'C' crédito (entrada) / 'D' débito (saída, cupom). Mapa semântico, não truncamento.
 'apuracao_pc_det': {'tipo': "case when {c} = 'ENTRADA' then 'C' else 'D' end"},
 # CLUBE_DESCONTO.IDEMPRESA é VARCHAR2 com LISTA ('1,2' em 4 linhas; NULL em 3.019): fica a primeira empresa.
 # Perda declarada: 4 linhas deixam de valer para a empresa 2.
 'clube_desconto': {'idempresa': "nvl(to_number(regexp_substr({c}, '^[0-9]+')), 1)"},
 # OPERADORAS: 1 linha sem nome em produção (codoperadoras 921, ativa) — a coluna é obrigatória no cadastro
 # novo; marcador explícito em vez de afrouxar o schema por uma linha.
 'operadoras': {'operadora': "nvl({c}, '(SEM NOME NO LEGADO)')"},
 'historico_prod': {'qtde_alter': 'nvl({c}, 0)', 'qtde_atual': 'nvl({c}, 0)'},
 'empresas': {'cnpj': "regexp_replace({c}, '[^0-9]', '')",
                           'insc': "regexp_replace({c}, '[^0-9A-Za-z]', '')",
                           'cep':  "regexp_replace({c}, '[^0-9]', '')"}}

# FILTROS de carga declarados: linha que o destino não aceita e que não vale afrouxar o app para receber.
# `codreferencia_for.codref` tem 4 nulos em 16.229 e o de-para exige o código (o app quebra com nulo).
FILTROS = {
 # linhas sem produto/operador no legado (9 · 7 · 2 em produção): o destino exige e o registro não significa nada sem eles
 'agenda_promocao_itens': 'idproduto is not null', 'scrap_item': 'idproduto is not null', 'contas_bancarias_op': 'codoperador is not null','codreferencia_for': 'codref is not null',
           # `pedidocompra_i.idproduto` é NOT NULL aqui e a origem deixa nulo: item de pedido sem produto não
           # tem o que virar — a carga descarta e conta (não dá para inventar o produto).
           'pedidocompra_i': 'idproduto is not null',
           # pedido de compra sem fornecedor não tem o que virar (codparceiro é NOT NULL aqui): descarta e conta
           'pedidocompra': 'codparceiro is not null'}

# PKs naturais que a origem repete: a carga fica com a ÚLTIMA linha por chave e CONTA o descarte (§7e)
DEDUP = {'cotacao_prodqtde': ['codcpr', 'idempresa'],
         # produção: 5 pares repetidos (25 linhas) na cotação 281/282, cópias com VALORES diferentes. O app faz
         # ON CONFLICT (codctcforn, codcpr) — índice parcial quebraria o upsert (lição das migs 179/180), então
         # quem cede é a carga: fica a última por ROWID. Perda: 20 linhas de uma cotação quebrada, registrada.
         'cotacao_forn_itens': ['codctcforn', 'codcpr'],  # produção: 2 pares idênticos (qtde 0) — o índice único barraria a carga
         'det_aliquota': ['aliquota', 'uf'], 'caixa_pdv': ['codcaixa'],
         # o de-para do fornecedor NÃO é 1:1 no legado (76 chaves com produtos diferentes), mas o UPSERT do
         # recebimento depende da unicidade: a carga fica com a última referência de cada (codfor, codref).
         'codreferencia_for': ['codfor', 'codref'],
         'cotacao_prod': ['codctc', 'idproduto']}

fase = (sys.argv[1] if len(sys.argv) > 1 else 'f0').lower()
# PARTIÇÃO (F4): o movimento pesado não cabe num CSV só — 11,9M linhas de venda. `--particao COL:INI:FIM`
# recorta a extração por faixa de data, que é como o plano previa a carga do movimento (mês a mês).
particao = None
for _a in sys.argv[1:]:
    if _a.startswith('--particao='):
        _c, _i, _f = _a.split('=', 1)[1].split(':')
        particao = (_c, _i, _f)
        sys.argv = [x for x in sys.argv if x != _a]
# o UNIVERSO derivado (tools/cutover/etl/plano-universo.py) manda quando existe: fases pela profundidade do grafo
# de FKs, tabela nova aparece sozinha. A lista digitada acima fica só como fallback e como registro histórico.
try:
    _plano = json.load(open(f'{BASE}/plano-tabelas.json'))
    FASES = dict(_plano['fases'])
    TABELA_ORIGEM.update(_plano.get('tabela_origem', {}))
    print(f"[plano] {sum(len(v) for v in FASES.values())} tabelas em {len(FASES)} fases (plano-tabelas.json)")
except FileNotFoundError:
    print('[plano] plano-tabelas.json ausente — usando a lista fixa')
# além das fases, aceita uma LISTA de tabelas separada por vírgula — é como se reextrai uma tabela só
# depois de corrigir o mapa dela, sem repetir as outras 5 da fase (`historico_prod` custa ~4 min).
if fase not in FASES:
    FASES[fase] = [x.strip() for x in fase.split(',') if x.strip()]
saida = sys.argv[2] if len(sys.argv) > 2 else f'{BASE}/staging/{fase}'
os.makedirs(saida, exist_ok=True)
dest = json.load(open(f'{BASE}/schema-destino.json'))['tabelas']

# ORACLE_HOST escolhe a base: 192.168.1.230 (homologação, padrão) ou hiperpinheirao.ddns.com.br (PRODUÇÃO).
# Produção é SOMENTE OBSERVAÇÃO por instrução do usuário: a sessão abre READ ONLY como guarda — este script só
# faz SELECT, mas a guarda deixa o Oracle recusar qualquer escrita por acidente.
import os as _os
ORACLE_HOST = _os.environ.get("ORACLE_HOST", "192.168.1.230")
con = oracledb.connect(user="pinheirao", password="apollo", dsn=oracledb.makedsn(ORACLE_HOST,1521,sid="apollo"))
con.call_timeout = 900000
con.cursor().execute("SET TRANSACTION READ ONLY")
print(f"[oracle] {ORACLE_HOST} (read only)")
cur = con.cursor()
cur.execute("select table_name from user_tables")
ora = {r[0] for r in cur.fetchall()}

manifesto = {}
for t in FASES[fase]:
    # o nome da tabela no Oracle nem sempre é o nosso em maiúsculas: LOTEPRECO (96.569 linhas em produção) passou
    # o ensaio inteiro como 'pulada: nenhuma coluna casa' porque procurávamos LOTE_PRECO. Mapa explícito.
    T = TABELA_ORIGEM.get(t, t.upper())
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
    # a regra de default precisa enxergar a RENOMEAÇÃO: a coluna se chama `origem` aqui e `origem_documento` lá,
    # e sem este de-para a regra procurava o nome do destino na origem e não achava (foi o que segurou o kardex).
    inv = {d: o for o, d in ren.items()}
    for _c, _d in dest[t]['colunas'].items():
        _oc = inv.get(_c, _c)
        if _d.get('nulo') or _oc not in ori or _d.get('default') is None:
            continue
        # o default pode ser número (0, 1) OU literal de texto ('N'::bpchar) — o regex antigo só via número,
        # e por isso `pedidocompra.fechado` (default 'N') continuava caindo.
        d_raw = str(_d['default']).strip()
        m_num = _re.match(r"^([-\d.]+)(::[a-z ]+)?$", d_raw)
        m_txt = _re.match(r"^'([^']*)'(::[a-z ]+)?$", d_raw)
        if m_num:
            tr_auto[_oc] = 'nvl({c}, ' + m_num.group(1) + ')'
        elif m_txt:
            tr_auto[_oc] = "nvl({c}, '" + m_txt.group(1) + "')"
    # `idempresa` NOT NULL **sem** default declarado (inventario, cotacao, pedidocompra): a regra acima não pega,
    # mas o valor neutro é o mesmo — empresa 1. Sem isto o ensaio regride (79.190 → 46.500 em inventario).
    for _emp in ('idempresa', 'codempresa'):
        if _emp in ori and not dest[t]['colunas'].get(_emp, {}).get('nulo', True):
            tr_auto.setdefault(_emp, 'nvl({c}, 1)')
    # e as CALCULADAS não podem ficar nulas quando o destino é NOT NULL: `saldo_anterior` já sai de nvl().
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
    calc = CALCULADAS.get(t, {})
    if calc:
        sel += ", " + ", ".join(f"{expr} as {nome}" for nome, expr in calc.items())
        cols = cols + [(nome, nome) for nome in calc]
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
        if particao and particao[0].lower() in ori:
            faixa = f"{particao[0]} >= date '{particao[1]}' and {particao[0]} < date '{particao[2]}'"
            onde = f"({onde}) and {faixa}" if onde else faixa
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
