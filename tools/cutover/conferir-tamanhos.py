#!/usr/bin/env python3
"""
CONFERIDOR DE TAMANHOS E TIPOS — a terceira escala do "tem que ter todos os campos" (usuário, 23/09/2026).

O de colunas garante que toda coluna da origem EXISTE no destino; o de tabelas, que toda tabela com dado tem destino ou
veredito. Falta o TAMANHO: a coluna existe, mas mais estreita que a do Oracle — `situacao_nf.descricao` é VARCHAR2(100) no
legado e varchar(80) aqui. Enquanto o dado couber, ninguém vê; no dia em que alguém digitar a descrição de 90 letras no
legado, a carga falha (ou, num número, arredonda em silêncio).

Para cada coluna do plano que existe nos dois lados (com o de-para de nomes da carga):
  · texto (VARCHAR2/CHAR)  → destino varchar/char mais curto que o Oracle?
  · número (NUMBER(p,s))   → destino com menos dígitos inteiros ou menos casas decimais? inteiro recebendo decimal?
  · data (DATE/TIMESTAMP)  → destino `date` recebendo hora?
Só onde a DECLARAÇÃO do destino é menor, mede o DADO real no Oracle:
  ALTO  = o dado atual NÃO cabe (a carga falha ou perde valor)
  MÉDIO = o dado cabe hoje, mas o legado aceita mais do que o destino (o próximo valor pode não caber)
SOMENTE LEITURA no Oracle. Uso:
  ORACLE_HOST=hiperpinheirao.ddns.com.br python3 tools/cutover/conferir-tamanhos.py
"""
import ast, json, os, re, sys
import oracledb

BASE = os.path.dirname(os.path.abspath(__file__))
plano = json.load(open(os.path.join(BASE, 'plano-tabelas.json')))
destino = json.load(open(os.path.join(BASE, 'schema-destino.json')))['tabelas']

# de-para de tabela e de coluna, lidos do extrator (a mesma fonte que a carga usa)
src = open(os.path.join(BASE, 'etl', 'extrair.py'), encoding='utf-8').read()
TABELA_ORIGEM, RENOMEIA, TRANSFORMA, CALCULADAS = {}, {}, {}, {}
for node in ast.parse(src).body:
    if isinstance(node, ast.Assign):
        for t in node.targets:
            nome = getattr(t, 'id', '')
            if nome in ('TABELA_ORIGEM', 'RENOMEIA', 'TRANSFORMA', 'CALCULADAS'):
                # exec da atribuição (não literal_eval): a CALCULADAS monta expressões com join/f-string e o
                # literal_eval falhava calado — a lista ficava vazia e as colunas calculadas eram medidas como brutas
                ns = {}
                exec(compile(ast.Module([node], []), 'extrair.py', 'exec'), ns)
                globals()[nome] = ns[nome]

# DATA com hora no legado → `date` no destino: a hora só some com veredito, e a prova é a medida. Nestas o que o legado
# guarda é o CARIMBO do momento da gravação (o campo é data na tela — TcxDBDateEdit): horários de relógio aleatórios, a
# mesma hora na emissão e no vencimento, validades de lote todas no minuto de uma rodada. Medido em 23/09/2026.
DATAS_DIA = {
    ('apagar', 'dtcompra'): '5.840 de 55.405 com hora; 811 horários distintos (relógio da inclusão)',
    ('balanco', 'data'): '1 de 8',
    ('caixa', 'dtvenc'): '278 de 240.568; 218 horários distintos',
    ('cotacao_forn', 'data'): '5 de 97, todas 17:19:16 (uma rodada)',
    ('faturamento', 'data'): '5 de 47.203, todas 01:03:17 (uma rodada)',
    ('mov_contas_bancarias', 'dtemissao'): '176.174 de 292.255; a MESMA hora do dtvenc (carimbo da gravação)',
    ('mov_contas_bancarias', 'dtvenc'): '168.046 de 292.255; a mesma hora do dtemissao',
    ('nf', 'dtcontabil'): '6.611 de 49.723; 341 às 05:31:38 (rotina), resto relógio',
    ('nf_prod_lote', 'dtvalidade'): '10.563 de 132.141; 4.095 às 16:47:25 e 2.054 às 15:21:19 (rodadas de importação)',
    ('parceiros', 'dtnascimento'): '26 de 19.071, às 07:00/23:00/01:00 (efeito de fuso)',
    ('parceiros', 'dtultcompra'): '2.102 de 19.071; 817 horários (relógio da venda)',
    ('periodo_contabil', 'data_inicio'): '3 de 3, a mesma hora do data_fim (carimbo da criação)',
    ('periodo_contabil', 'data_fim'): '3 de 3, a mesma hora do data_inicio',
    ('troca', 'data'): '2 de 107',
}
TABELA_ORIGEM.update(plano.get('tabela_origem', {}))

# a carga que TRANSFORMA um valor pode estar perdendo dado — foi assim que `caixa.nrparcela` ('1/3' → 1),
# `caixa.formapgto` e `nf.sequencia_nfe` ('S' → nulo) passaram por este conferidor (mig 320). Cada transformação
# precisa de veredito: o valor original não se perde (preenche nulo, tira máscara) ou o original mora em outra coluna.
TRANSFORMA_DECLARADAS = {
    ('parceiros', 'idempresa'): 'preenche o nulo (96,9% nulo no legado; a coluna é NOT NULL aqui) — nada se perde',
    ('nf_prod', 'vl_custo'): 'preenche o nulo com 0 (NOT NULL aqui)',
    ('apuracao_pc_det', 'tipo'): 'papel C/D; o texto original fica em `tipo_origem` (mig 320)',
    ('clube_desconto', 'idempresa'): 'a primeira loja; a LISTA original fica em `empresas` (mig 320)',
    ('operadoras', 'operadora'): 'preenche o nome nulo (NOT NULL aqui)',
    ('historico_prod', 'qtde_alter'): 'preenche o nulo com 0',
    ('historico_prod', 'qtde_atual'): 'preenche o nulo com 0',
    ('empresas', 'cnpj'): 'tira a máscara (os dígitos ficam)',
    ('empresas', 'insc'): 'tira a máscara (os dígitos e letras ficam)',
    ('empresas', 'cep'): 'tira a máscara (os dígitos ficam)',
}
sem_veredito = sorted(f'{t}.{c}' for t, cols in TRANSFORMA.items() for c in cols if (t, c) not in TRANSFORMA_DECLARADAS)

tabelas = sorted({t for v in plano['fases'].values() for t in v})
host = os.environ.get('ORACLE_HOST', '192.168.1.240')
con = oracledb.connect(user='pinheirao', password='apollo', dsn=oracledb.makedsn(host, 1521, sid='apollo'))
con.call_timeout = 600000
cur = con.cursor()
cur.execute('SET TRANSACTION READ ONLY')

TEXTO_DEST = ('character varying', 'character', 'varchar', 'char', 'bpchar')
INTEIRO_DEST = {'integer': 10, 'smallint': 5, 'bigint': 19}

def q(n):
    return n.upper() if re.match(r'^[a-z_][a-z0-9_$#]*$', n) else f'"{n.upper()}"'

altos, medios, declaradas = [], [], []
for t in tabelas:
    dt = destino.get(t)
    if not dt:
        continue
    orig = str(TABELA_ORIGEM.get(t, t)).upper()
    ren = {k.lower(): v.lower() for k, v in RENOMEIA.get(t, {}).items()}
    cur.execute("""SELECT column_name, data_type, char_length, data_precision, data_scale
                     FROM user_tab_columns WHERE table_name = :t""", t=orig)
    for cn, dty, clen, prec, esc in cur.fetchall():
        oc = cn.lower()
        dc = ren.get(oc, oc)
        d = dt['colunas'].get(dc)
        if not d:
            continue
        dtipo, dtam, desc = d.get('tipo'), d.get('tam'), d.get('escala')
        # a carga TRANSFORMA ou CALCULA o valor (ex.: CNPJ sem máscara) — o que chega não é o bruto do Oracle
        if dc in TRANSFORMA.get(t, {}) or oc in TRANSFORMA.get(t, {}) or dc in CALCULADAS.get(t, {}):
            continue
        motivo, medir, alvo = None, None, None
        if dty in ('VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR') and (dtipo in INTEIRO_DEST or dtipo == 'numeric'):
            # TEXTO no legado, NÚMERO aqui: o que não for número derruba a carga ('1/3', 'S') — o tipo é o do legado
            motivo = f'texto {dty}({clen}) → {dtipo}'
            medir = (f"SELECT count(*) FROM \"{orig}\" WHERE {q(oc)} IS NOT NULL AND NOT regexp_like(trim({q(oc)}), '^-?[0-9]+([.,][0-9]+)?$')",
                     lambda v: v is not None and v > 0)
            alvo = f'char({clen})' if dty in ('CHAR', 'NCHAR') else f'varchar({clen})'
        elif dty in ('VARCHAR2', 'NVARCHAR2', 'CHAR', 'NCHAR'):
            if dtipo in TEXTO_DEST and dtam is not None and clen and dtam < clen:
                motivo = f'texto {dty}({clen}) → {dtipo}({dtam})'
                medir = (f'SELECT max(length({q(oc)})) FROM "{orig}"', lambda v, lim=dtam: v is not None and v > lim)
                alvo = f'char({clen})' if dty in ('CHAR', 'NCHAR') and dtipo in ('character', 'char', 'bpchar') else f'varchar({clen})'
        elif dty == 'NUMBER':
            p, s = prec, (esc or 0)
            if dtipo == 'numeric' and dtam is not None:
                ds = desc or 0
                if p is not None and ((dtam - ds) < (p - s) or ds < s):
                    motivo = f'número NUMBER({p},{s}) → numeric({dtam},{ds})'
                    esc_alvo = max(ds, s)
                    alvo = f'numeric({max(dtam - ds, p - s) + esc_alvo},{esc_alvo})'
                    lim_int = 10 ** (dtam - ds)
                    medir = (f'SELECT max(abs({q(oc)})), sum(CASE WHEN {q(oc)} <> round({q(oc)}, {ds}) THEN 1 ELSE 0 END) FROM "{orig}"',
                             lambda v, li=lim_int: v is not None and ((v[0] is not None and v[0] >= li) or (v[1] or 0) > 0))
            elif dtipo in INTEIRO_DEST:
                if s > 0 or p is None or p > INTEIRO_DEST[dtipo]:
                    motivo = f'número NUMBER({p},{s}) → {dtipo}'
                    alvo = 'INTEIRO'  # só acusa se o dado não couber (ids: o inteiro do destino basta)
                    lim = 2 ** 31 - 1 if dtipo == 'integer' else 32767 if dtipo == 'smallint' else 2 ** 63 - 1
                    medir = (f'SELECT max(abs({q(oc)})), sum(CASE WHEN {q(oc)} <> trunc({q(oc)}) THEN 1 ELSE 0 END) FROM "{orig}"',
                             lambda v, li=lim: v is not None and ((v[0] is not None and v[0] > li) or (v[1] or 0) > 0))
        elif dty == 'DATE' or dty.startswith('TIMESTAMP'):
            if dtipo == 'date':
                motivo = f'{dty} → date (a hora some)'
                medir = (f'SELECT count(*) FROM "{orig}" WHERE {q(oc)} <> trunc({q(oc)})', lambda v: v is not None and v > 0)
                alvo = 'DATA'
        if not motivo:
            continue
        try:
            cur.execute(medir[0])
            row = cur.fetchone()
            v = row if len(row) > 1 else row[0]
            ruim = medir[1](v)
        except Exception as e:  # coluna que não mede (tipo estranho) — trata como médio, com o erro
            v, ruim = f'erro: {e}'[:80], False
        if alvo == 'INTEIRO' and not ruim:
            continue                      # inteiro que cabe: nada a fazer
        if alvo == 'DATA':
            if not ruim:
                continue                  # o legado nunca gravou hora nesta coluna
            if (t, dc) in DATAS_DIA:
                declaradas.append((t, dc, motivo, DATAS_DIA[(t, dc)]))
                continue
        (altos if ruim else medios).append((t, dc, motivo, v, alvo))
con.rollback()

if '--sql' in sys.argv:
    # a migration de alargamento: textos e números ao tamanho do legado (apollo_alterar_tipo trata as views dependentes)
    for t, c, m, v, alvo in medios:
        if alvo and alvo not in ('INTEIRO', 'DATA'):
            print(f"SELECT apollo_alterar_tipo('{t}', '{c}', '{alvo}');  -- {m}")
    sys.exit(0)
print(f'tabelas conferidas: {len(tabelas)}')
print(f'\n[TRANSFORMAÇÃO SEM VEREDITO] a carga altera o valor e ninguém disse que nada se perde: {len(sem_veredito)}')
for x in sem_veredito:
    print(f'   {x}')
print(f'\n[ALTO] o dado atual NÃO cabe no destino: {len(altos)}')
for t, c, m, v, _ in altos:
    print(f'   {t}.{c:32s} {m:48s} dado: {v}')
print(f'\n[MÉDIO] o dado cabe hoje, mas o legado aceita mais: {len(medios)}')
for t, c, m, v, _ in medios:
    print(f'   {t}.{c:32s} {m:48s} dado: {v}')
print(f'\n[DECLARADAS] data com carimbo de hora no legado, dia no destino (com a medida): {len(declaradas)}')
for t, c, m, prova in declaradas:
    print(f'   {t}.{c:32s} {prova}')
if altos or medios or sem_veredito:
    sys.exit(1)
