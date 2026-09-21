#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CONFERIDOR DE COLUNAS ÓRFÃS — o par do `conferir-ancoras.py`, pelo lado das COLUNAS.

Procura o padrão que já custou caro duas vezes: **coluna que o destino exige e a origem não tem**.
Quando isso acontece, o extrator não a encontra pelo nome, a carga cai no DEFAULT (ou na constante 1
de empresa) e o dado entra errado **sem um único erro**:

  · `pedidocompra_i.qtde` — a quantidade mora no grandchild `PEDIDO_COMPRA_QTDE`; com o default 1 os
    pedidos migrariam R$ 32,4 milhões subcontados (Σ real 43.328.145,14 → 10.927.188,98);
  · `areceber_bx.codempresa` — a empresa vem do título; com a constante 1, **75%** das baixas (14.172
    da empresa 50) mudariam de loja.

Uso (só leitura no Oracle):
    python3 tools/cutover/conferir-colunas-orfas.py

Sai 1 quando acha coluna órfã de risco ALTO sem tratamento — serve de gate antes da carga.
"""
import ast
import json
import re
import sys

import oracledb

BASE = '/Library/Apollo/tools/cutover'
ORACLE = dict(user='pinheirao', password='apollo', dsn='hiperpinheirao.ddns.com.br:1521/apollo')

# lê as constantes do PRÓPRIO extrator — se o mapa mudar lá, esta conferência acompanha.
# Por AST, SEM importar: `etl/extrair.py` não tem guarda `if __name__` — importá-lo dispararia a
# extração inteira contra a produção.
def _consts_do_extrator(caminho, nomes):
    arvore = ast.parse(open(caminho, encoding='utf-8').read())
    out = {n: {} for n in nomes}
    for no in arvore.body:
        if isinstance(no, ast.Assign) and len(no.targets) == 1 and isinstance(no.targets[0], ast.Name) \
                and no.targets[0].id in out:
            try:
                out[no.targets[0].id] = ast.literal_eval(no.value)
            except ValueError:
                # valor não-literal (ex.: CALCULADAS traz SQL montado por concatenação): aqui só
                # interessam as CHAVES — qual tabela.coluna o extrator já trata.
                out[no.targets[0].id] = {
                    t.value: {c.value: True for c in v.keys}
                    for t, v in zip(no.value.keys, no.value.values)
                    if isinstance(t, ast.Constant) and isinstance(v, ast.Dict)
                }
    return out


_c = _consts_do_extrator(f'{BASE}/etl/extrair.py',
                         ['RENOMEIA', 'CALCULADAS', 'CONSTANTES', 'TABELA_ORIGEM', 'EMPRESA_SEM_ORIGEM'])
RENOMEIA, CALCULADAS = _c['RENOMEIA'], _c['CALCULADAS']
CONSTANTES, TABELA_ORIGEM = _c['CONSTANTES'], _c['TABELA_ORIGEM']
# a constante 1 de empresa DECLARADA no extrator é decisão escrita, não silêncio — não conta como órfã
EMPRESA_SEM_ORIGEM = _c['EMPRESA_SEM_ORIGEM']
# colunas que o Apollo criou e o legado nunca teve: cada uma justificada aqui, não no silêncio de um default
NOSSAS_JUSTIFICADAS = {
    ('produtos', 'geraqtde'): 'nasceu na mig 027 (se o produto movimenta estoque na NF); default S = o legado',
}

schema = json.load(open(f'{BASE}/schema-destino.json'))['tabelas']
plano = json.load(open(f'{BASE}/plano-tabelas.json'))
TABELA_ORIGEM = {**TABELA_ORIGEM, **plano.get('tabela_origem', {})}
alvo = sorted({t for v in plano['fases'].values() for t in v})

# nossas por construção (carimbo/estorno lógico) — não vêm do legado
NOSSAS = re.compile(r'^(usultalteracao|dtultimalteracao|dtcadastro|indr|indr_usuario|indr_data|'
                    r'criado_em|atualizado_em|origem_legado)$')
# as que mudam NÚMERO: é onde o silêncio vira dinheiro errado
NUMERICAS = re.compile(r'(qtde|quant|valor|total|custo|preco|^vr|_vr|perc|aliq|saldo|markup|margem|desconto)')
# a empresa é o outro caso caro: a constante 1 troca a loja do movimento
EMPRESA = re.compile(r'^(idempresa|codempresa)$')


def main() -> int:
    c = oracledb.connect(**ORACLE)
    cu = c.cursor()
    cu.execute("SET TRANSACTION READ ONLY")

    achados = []
    for t in alvo:
        if t not in schema:
            continue
        T = TABELA_ORIGEM.get(t, t.upper())
        cu.execute("select column_name from user_tab_columns where table_name=:t", t=T)
        ori = {r[0].lower() for r in cu.fetchall()}
        if not ori:
            continue  # sem origem: é tabela só do destino (o conferir-ancoras cuida disso)
        destino_de = {d: o for o, d in RENOMEIA.get(t, {}).items()}
        tratadas = set(CALCULADAS.get(t, {})) | set(CONSTANTES.get(t, {}))
        for col, d in schema[t]['colunas'].items():
            if col in ori or NOSSAS.match(col) or col in tratadas:
                continue
            if (t, col) in NOSSAS_JUSTIFICADAS or (EMPRESA.match(col) and t in EMPRESA_SEM_ORIGEM):
                continue
            if destino_de.get(col) in ori:          # resolvida por RENOMEIA
                continue
            if EMPRESA.match(col) and ({'idempresa', 'codempresa'} & ori):
                continue                            # regra geral de empresa do extrator
            default, nulo = d.get('default'), d.get('nulo', True)
            if default and 'nextval' in str(default):
                continue                            # PK serial: nossa
            if default is None and nulo:
                continue                            # sem default e aceita nulo: entra NULL, sem surpresa
            risco = 'ALTO' if (NUMERICAS.search(col) or EMPRESA.match(col)) else 'MEDIO'
            achados.append((risco, t, col, str(default), 'NOT NULL' if not nulo else 'nulo ok'))

    achados.sort(key=lambda x: (x[0] != 'ALTO', x[1], x[2]))
    altos = [a for a in achados if a[0] == 'ALTO']
    print(f"tabelas do plano conferidas: {len(alvo)}")
    print(f"colunas órfãs (destino exige, origem não tem, sem tratamento): {len(achados)} — ALTO: {len(altos)}\n")
    for risco, t, col, dflt, nn in achados:
        print(f"  [{risco:5s}] {t}.{col:30s} default={dflt[:20]:22s} {nn}")
    if altos:
        print("\n⚠️  as de risco ALTO mudam NÚMERO ou EMPRESA: cada uma precisa de entrada em")
        print("    CALCULADAS/RENOMEIA no etl/extrair.py, ou de uma justificativa escrita aqui.")
        return 1
    print("\nnenhuma coluna órfã de risco alto — a carga não vai inventar número nem trocar de loja.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
