#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CONFERIDOR DE CAMPOS DA LOG — o que a TELA do legado grava e o Apollo não.

A LOG do form-base do legado lista, no "Inseriu", TODOS os campos preenchidos do registro e, no "Alterou", os que o operador mudou.
Cruzada com a lista de colunas que a config do Apollo gerencia para a mesma tabela, ela diz exatamente o que falta na tela — foi o que
achou 45 colunas no cadastro de produto, onde o conferidor por nome (`conferir-colunas-nao-escritas.py`) tinha visto 12 (lição 151).

Para cada (formulário, tabela) da LOG de produção desde `--desde` (só leitura):
  · a lista do Apollo é a `colunas: [...]` que segue `tabela: '<tabela>'` numa config (CRUD, agregado ou detalhe) de apps/api/src;
  · sem config, cai no método por menção: a coluna aparece num arquivo que também cita a tabela.
Sai, por par, cada campo com quantas vezes aparece no Inseriu e no Alterou.

Uso:
    python3 tools/cutover/conferir-campos-da-log.py [--desde=2026-01-01] [--min=5]
"""
import os
import re
import sys
import collections

import json

import oracledb

SRC = '/Library/Apollo/apps/api/src'
ORACLE = dict(user='pinheirao', password='apollo', dsn='hiperpinheirao.ddns.com.br:1521/apollo')
ARGS = dict(a.lstrip('-').split('=', 1) for a in sys.argv[1:] if '=' in a)
DESDE = ARGS.get('desde', '2026-01-01')
MINIMO = int(ARGS.get('min', 5))

# carimbos do form-base e o que o motor escreve por conta própria
IGNORAR = {'dtcadastro', 'dtultimalteracao', 'usultalteracao', 'indr', 'indr_usuario', 'indr_data'}
# o que a LOG lista mas o Apollo cobre por outro caminho (com a prova no recon da tabela)
COBERTAS = {
    'nf_prod': {
        'especificacao': 'P.ESPECIFICACAO do JOIN do qryItensNota, ProviderFlags [] — nunca gravada (udmNF.dfm:2950)',
        'idsituacao_nf': 'aposGravarTrx da NF preenche a do cabeçalho',
        'informacoes_adicionais': 'extra da devolução de compra (devolucao-compra.service.ts)',
    },
}
# tabelas cujo nome na LOG difere do destino
TABELA_DESTINO = {'codauxiliar ': 'codauxiliar', 'concilicao_bancaria_ofx': 'conciliacao_bancaria_ofx',
                  'concilicao_bancaria_mov': 'conciliacao_bancaria_mov'}
PALAVRA = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')


def ler_codigo():
    arquivos = {}
    for raiz, _, nomes in os.walk(SRC):
        for n in nomes:
            if n.endswith('.ts') and n != 'db-types.ts':
                p = os.path.join(raiz, n)
                arquivos[p] = open(p, encoding='utf-8').read()
    return arquivos


def colunas_da_config(arquivos):
    """tabela → conjunto de colunas das configs (`tabela: 'x'` … `colunas: [ … ]`), com spreads de constantes resolvidos"""
    consts = {}
    for t in arquivos.values():
        for m in re.finditer(r'const\s+([A-Z_][A-Z0-9_]*)\s*=\s*\[([^\]]*)\]', t):
            consts[m.group(1)] = set(re.findall(r"'([a-z_0-9]+)'", m.group(2)))
    out = collections.defaultdict(set)
    for t in arquivos.values():
        for m in re.finditer(r"tabela:\s*'([a-z_0-9]+)'", t):
            resto = t[m.end():m.end() + 6000]
            c = re.search(r'colunas:\s*\[', resto)
            if not c:
                continue
            # a próxima `tabela:` antes das colunas é de outra config
            prox = re.search(r"tabela:\s*'[a-z]", resto)
            if prox and prox.start() < c.start():
                continue
            i = c.end()
            prof = 1
            j = i
            while j < len(resto) and prof:
                prof += {'[': 1, ']': -1}.get(resto[j], 0)
                j += 1
            corpo = resto[i:j - 1]
            cols = set(re.findall(r"'([a-z_0-9]+)'", corpo))
            for chave in ('pk', 'fk'):
                m2 = re.search(r"\b" + chave + r":\s*'([a-z_0-9]+)'", resto[:c.start()])
                if m2:
                    cols.add(m2.group(1))
            for sp in re.findall(r'\.\.\.([A-Z_][A-Z0-9_]*)', corpo):
                cols |= consts.get(sp, set())
            out[m.group(1)] |= cols
    return out


def defaults_das_migrations():
    """tabela → colunas com DEFAULT posto por migration (`ALTER TABLE t ALTER COLUMN c SET DEFAULT`): a inclusão as grava"""
    out = collections.defaultdict(set)
    pasta = '/Library/Apollo/apps/api/migrations'
    for n in sorted(os.listdir(pasta)):
        if n.endswith('.sql'):
            for m in re.finditer(r'ALTER TABLE\s+(\w+)\s+ALTER COLUMN\s+(\w+)\s+SET DEFAULT', open(os.path.join(pasta, n), encoding='utf-8').read(), re.I):
                out[m.group(1).lower()].add(m.group(2).lower())
    return out


def main() -> int:
    arquivos = ler_codigo()
    defaults = defaults_das_migrations()
    palavras = {p: {w.lower() for w in PALAVRA.findall(t)} for p, t in arquivos.items()}
    config = colunas_da_config(arquivos)
    # a LOG trunca o histórico em 4.000 caracteres: o último nome sai cortado ("BCPISCO") — só vale nome de coluna real
    schema = json.load(open('/Library/Apollo/tools/cutover/schema-destino.json'))['tabelas']
    c = oracledb.connect(**ORACLE)
    cu = c.cursor()
    cu.execute('SET TRANSACTION READ ONLY')
    cu.execute("""select formulario, tabela, acao, historico from log
                   where datahora >= to_date(:d, 'YYYY-MM-DD') and acao in ('Inseriu', 'Alterou') and historico like '%CAMPO:%'""", d=DESDE)
    cont = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
    for form, tab, acao, hist in cu:
        if acao == 'Inseriu':
            campos = set(re.findall(r'CAMPO: (\w+)', hist or ''))
        else:
            # o legado registra "vazio → vazio" (o gravar troca '' por NULL e o form-base vê diferença): isso não é alteração
            campos = {m.group(1) for m in re.finditer(r'CAMPO: (\w+)\s+VALOR ANTERIOR: (.*?)\s+VALOR ATUAL: (.*?)(?:\r|\n|$)', hist or '')
                      if m.group(2).strip() != m.group(3).strip()}
        for campo in campos:
            cont[(form, tab)][campo.lower()][0 if acao == 'Inseriu' else 1] += 1
    total = 0
    for (form, tab), campos in sorted(cont.items(), key=lambda kv: -sum(a + b for a, b in kv[1].values())):
        destino = TABELA_DESTINO.get(tab.lower(), tab.lower().strip())
        geren = config.get(destino)
        metodo = 'config' if geren else 'menção'
        faltam = []
        for campo, (i, a) in campos.items():
            if campo in IGNORAR or i + a < MINIMO:
                continue
            if destino in schema and campo not in schema[destino]['colunas']:
                continue
            if campo in COBERTAS.get(destino, {}):
                continue
            # o DEFAULT cobre a inclusão; só sobra se a tela também o muda depois (o "Alterou")
            if campo in defaults.get(destino, set()) and a < MINIMO:
                continue
            if geren is not None and geren:
                if campo in geren or campo == destino:
                    continue
            elif any(destino in w and campo in w for w in palavras.values()):
                continue
            faltam.append((campo, i, a))
        if not faltam:
            continue
        faltam.sort(key=lambda x: -(x[1] + x[2]))
        total += len(faltam)
        print(f'\n{form} / {tab}  [{metodo}]')
        for campo, i, a in faltam:
            print(f'  {campo:34} inseriu={i:6} alterou={a:6}')
    print(f'\n# {total} campos que a tela do legado grava e a config do Apollo não gerencia (desde {DESDE}, mín. {MINIMO})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
