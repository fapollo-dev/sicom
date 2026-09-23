#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CONFERIDOR DE COLUNAS — o par do `conferir-ancoras.py`, pelo lado das COLUNAS, nos DOIS SENTIDOS.

**Sentido 1 — o destino exige e a origem não tem.** A carga cai no DEFAULT (ou na constante 1 de empresa)
e o dado entra errado sem um único erro:

  · `pedidocompra_i.qtde` — a quantidade mora no grandchild `PEDIDO_COMPRA_QTDE`; com o default 1 os
    pedidos migrariam R$ 32,4 milhões subcontados;
  · `areceber_bx.codempresa` — a empresa vem do título; com a constante 1, 75% das baixas mudariam de loja.

**Sentido 2 — a origem tem e o destino não.** Essa não cai em default nenhum: a coluna simplesmente não é
carregada, e o dado some sem deixar buraco visível. Foi o que escondeu o `CLUBE_DESCONTO.BARRAS` por três
migrations — a coluna diz sobre qual produto a regra de preço age, está preenchida em **99,8% das 3.111
regras**, e a tabela estava no plano desde a mig 112 sem ela. O sentido 1 nunca a veria, porque do lado do
destino não faltava nada.

Uso (só leitura no Oracle):
    python3 tools/cutover/conferir-colunas-orfas.py

Sai 1 quando acha coluna órfã de risco ALTO ou coluna da origem ficando para trás — serve de gate.
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
    ('produtos', 'geraqtde'): 'mig 027 (se o produto movimenta estoque na NF); default S = o legado',
    # mig 280: na carga o default 'calculado' é exato — os 98.760 itens que o legado gerou têm SÓ CST 000
    # e 200, as duas calculáveis; ele não gera grupo para 410 (imunidade) nem 620 (monofásica).
    ('nf_prod_ibscbs', 'tratamento'): 'mig 280; default calculado é exato (a origem só tem CST 000 e 200)',
    # mig 282/283/284: o legado não tem imposto seletivo, regimes especiais nem split em coluna nenhuma
    ('nf_prod_ibscbs', 'vis'): 'mig 282; o legado não tem IS — default 0 é o valor correto',
    ('nf_prod_ibscbs', 'pis_seletivo'): 'mig 282; idem',
    ('nf_ibscbs', 'vis'): 'mig 282; idem',
    ('nf_prod_ibscbs', 'pred_base'): 'mig 283; o legado não tem redutor de base — default 0 é exato',
    ('nf_prod_ibscbs', 'vibs_suspenso'): 'mig 283; idem',
    ('nf_prod_ibscbs', 'vcbs_suspenso'): 'mig 283; idem',
    ('nf_prod_ibscbs', 'vcred_pres_ibs'): 'mig 283; idem',
    ('nf_prod_ibscbs', 'vcred_pres_cbs'): 'mig 283; idem',
    ('nf_ibscbs', 'vibs_suspenso'): 'mig 283; idem',
    ('nf_ibscbs', 'vcbs_suspenso'): 'mig 283; idem',
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

# ── sentido 2 ────────────────────────────────────────────────────────────────────────────────────────
# colunas da ORIGEM que não vêm de propósito: sobra de manutenção, carimbo que o nosso schema não repete,
# ou flag de integração externa. Cada padrão é uma decisão, não um esquecimento.
ORIGEM_NAO_VEM = re.compile(
    r'^(old_|bkp_|tmp_|temp_|f_bkp|'
    r'usucadastro|usuexclusao|dtexclusao|dtalteracao|dtultacesso|'
    r'sincronizado|exportado|codigoempresawl|filialempresawl)'
    r'|(_bkp|_temp|_wl|_old)$')
# colunas da ORIGEM que ficam de fora com PROVA medida — cada par é uma decisão, não um esquecimento
ORIGEM_DECLARADA = {
    # mig 286: das 28 colunas de total da NF, 12 entraram (R$ 160,5 milhões) e estas 16 não.
    ('nf', 'qtde'): 'contagem de itens: derivável de nf_prod; guardar criaria uma segunda verdade',
    ('nf', 'validatotalnf'): 'flag de processo do legado, não valor',
    ('nf', 'totalfrete2'): 'resíduo: 1 nota',
    ('nf', 'total_fcp'): 'resíduo: 1 nota',
    ('nf', 'total_fcp_bc'): 'resíduo',
    ('nf', 'totalvroutros'): 'resíduo: 1 nota',
    ('nf', 'totaldescfinal'): 'resíduo: 22 notas, R$ -175,96',
    ('nf', 'total_icms_uf_dest_bc'): 'resíduo: zerado nas notas do cliente',
    ('nf', 'totalicm_stexterno_sepnf'): 'resíduo',
    ('nf', 'total_desc_acordo'): 'resíduo',
    ('nf', 'fisco_emit_dar_valor'): 'campo de fisco do emitente: zerado',
    ('nf', 'valorissqn'): 'ISSQN: o cliente não presta serviço (zerado)',
    ('nf', 'valorservico'): 'idem',
    ('nf', 'totalbaseicmsrep_ret'): 'resíduo',
    ('nf', 'total_desc_pedido'): 'zerado nas 49.655 notas (0 com valor)',
    # mig 287: das 31 colunas de nf_prod, 24 entraram (R$ 137,5 milhoes) e estas ficam de fora
    ('nf_prod', 'vrcustoajustenf'): 'residuo: 1 item, R$ 0,01',
    ('nf_prod', 'atualiza_multipreco_decomp'): 'flag de decomposicao sem uso medido',
    ('nf_prod', 'item_perda_total'): 'idem',
    ('nf_prod', 'ipi_devolucao_perc_devol'): 'residuo: 81 itens',
    # mig 288: a integracao Cresce Vendas tem 14.612 linhas de 18,9 milhoes (0,08%) e R$ 39 mil, e o
    # status dela esta nulo nas 3,1 milhoes de CLUBE_DESCONTO_MOV — o mecanismo nunca foi usado.
    ('vendas', 'crescevendas_qtde'): 'integracao Cresce Vendas nunca usada: 0,08% das linhas',
    ('vendas', 'crescevendas_valor'): 'idem',
    # mig 289: flags de comportamento de tela sem uso medido no cliente
    ('empresas', 'preen_ncm'): 'flag de tela sem uso medido',
    ('empresas', 'sincroniza_preco_nf'): 'idem',
    ('empresas', 'valor_perc_multa'): 'idem',
    # mig 290, o que resta da varredura — cada um com o motivo medido
    ('config_plano_contas', 'codconfig'): 'PK da origem; o destino usa `tipo` como chave (1 linha)',
    ('situacao_nf_parceiros', 'codoperador'): 'autoria do vinculo; 146 linhas, sem uso em regra',
    ('log_impressao_etiqueta', 'valor_impressao'): 'log operacional; o destino ja guarda valor_venda',
}
# ⏳ TRIAGEM PENDENTE, DECLARADA — o que o filtro de nomes estendido (revisão do pedido, 23/09/2026) passou a ver fora do
# pedido: a escada de preço gravada em cada VENDA (16 milhões de linhas) e em cada item de NOTA, os tributos do item da
# devolução de compra, o PIS do produto, as retenções do parceiro. Nenhuma está no destino. Não derrubam o gate (são
# trabalho de outras telas, com fila própria — FILA-CONVERSAO, Achado 18), mas saem no relatório toda vez: sair daqui é
# ganhar coluna no destino ou uma linha em ORIGEM_DECLARADA com a prova.
TRIAGEM_PENDENTE = {
    ('nf', 'cofins_nfe'),
    ('nf', 'pis_nfe'),
    ('nf', 'rateio_ipi'),
    ('parceiros', 'hab_ret_cofins_nf_sai'),
    ('parceiros', 'hab_ret_pis_nf_sai'),
    ('nf_prod', 'contsocial'),
    ('nf_prod', 'debitoicm'),
    ('nf_prod', 'despopv'),
    ('nf_prod', 'imprend'),
    ('nf_prod', 'lucrobrutop'),
    ('nf_prod', 'lucrobrutov'),
    ('nf_prod', 'lucroliqp'),
    ('nf_prod', 'lucroliqv'),
    ('vendas', 'icms_modalidade_bc'),
    ('vendas', 'icms_origem_mercadoria'),
    ('vendas', 'icms_taxa_reducao_bc'),
    ('nf', 'rateio_ipi_devolucao'),
    ('nf', 'abater_icms_deson'),
    ('produtos', 'pis'),
    ('nf_prod', 'destacicmssn'),
    ('vendas', 'pis'),
    ('vendas', 'contsocial'),
    ('vendas', 'creditoicm'),
    ('vendas', 'creditopiscofins'),
    ('vendas', 'debitoicm'),
    ('vendas', 'despacessorio'),
    ('vendas', 'despopv'),
    ('vendas', 'frete'),
    ('vendas', 'frete2'),
    ('vendas', 'icmst'),
    ('vendas', 'imprend'),
    ('vendas', 'ipi'),
    ('vendas', 'seguro'),
    ('produtos', 'taraembalagem'),
}

# grandezas cuja ausência muda NÚMERO ou IDENTIDADE — é onde a perda é cara
CHAVE_OU_NUMERO = re.compile(
    r'(^cod|^id|barras|codbarra|ncm|cest|cfop|^cst|'
    r'qtde|quant|valor|total|custo|preco|^vr|_vr|perc|aliq|saldo|markup|margem|desconto|'
    # revisão do pedido (23/09/2026): o item perdia 21 colunas de imposto e de lucro que nenhum termo acima pegava —
    # ICME, ICMST, IPI, FRETE, SEGURO, DESPACESSORIO, LUCROBRUTOV, IMPREND, CONTSOCIAL, PISCONFIS, DEBITOICM…
    r'icm|ipi|frete|seguro|desp|lucro|imprend|contsocial|pis|cofins|debito|credito|vendaliq|pmz|embalagem)')


def main() -> int:
    c = oracledb.connect(**ORACLE)
    cu = c.cursor()
    cu.execute("SET TRANSACTION READ ONLY")

    # ⚠️ o dicionário inteiro em TRÊS consultas, não uma por tabela. O Oracle é remoto e cada ida custa
    # latência; com 186 tabelas × 2 passos eram centenas de viagens, e um `count()` por coluna em tabela
    # de 18 milhões de linhas levava mais de dez minutos. Ferramenta lenta deixa de ser rodada, que é o
    # pior desfecho possível para uma conferência.
    nomes = sorted({TABELA_ORIGEM.get(t, t.upper()) for t in alvo})
    lista = ", ".join(f"'{n}'" for n in nomes)
    cu.execute(f"select table_name, column_name, data_type from user_tab_columns"
               f"  where table_name in ({lista})")
    COLS: dict = {}
    TIPOS: dict = {}
    for tab, col, tipo in cu.fetchall():
        COLS.setdefault(tab, set()).add(col.lower())
        TIPOS.setdefault(tab, {})[col.lower()] = tipo
    cu.execute(f"select table_name, column_name, num_nulls, num_distinct"
               f"  from user_tab_col_statistics where table_name in ({lista})")
    EST: dict = {}
    for tab, col, nulls, dist in cu.fetchall():
        EST.setdefault(tab, {})[col.lower()] = (nulls, dist)
    cu.execute(f"select table_name, num_rows from user_tables where table_name in ({lista})")
    LINHAS = {t: (n or 0) for t, n in cu.fetchall()}

    # ── SENTIDO 1: o destino exige e a origem não tem ───────────────────────────────────────────────
    achados = []
    for t in alvo:
        if t not in schema:
            continue
        T = TABELA_ORIGEM.get(t, t.upper())
        ori = COLS.get(T, set())
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

    # ── SENTIDO 2: a origem tem e o destino não ─────────────────────────────────────────────────────
    perdidas = []
    pendentes = []
    for t in alvo:
        if t not in schema:
            continue
        T = TABELA_ORIGEM.get(t, t.upper())
        ori = COLS.get(T, set())
        if not ori:
            continue
        dst = set(schema[t]['colunas'])
        renomeadas = set(RENOMEIA.get(t, {}))       # origem → destino já mapeada
        calculadas_de = set()                        # colunas da origem já usadas em expressões
        for expr in (CALCULADAS.get(t, {}) or {}).values():
            if isinstance(expr, str):
                calculadas_de |= {x for x in ori if x in expr}
        # a REGRA GERAL de empresa do extrator (idempresa ↔ codempresa nas duas direções) já resolve
        # esse par sozinha — sem descontá-la, toda tabela apareceria aqui com um falso positivo
        equiv = set()
        for a, b in (('idempresa', 'codempresa'), ('codempresa', 'idempresa')):
            if a in ori and b in dst:
                equiv.add(a)
        candidatas = [x for x in sorted(ori - dst - renomeadas - calculadas_de - equiv)
                      if CHAVE_OU_NUMERO.search(x) and not ORIGEM_NAO_VEM.search(x)
                      and not NOSSAS.match(x) and (t, x) not in ORIGEM_DECLARADA]
        if not candidatas:
            continue
        est = EST.get(T, {})
        total = int(LINHAS.get(T, 0) or 0)
        if not total:
            continue   # sem estatística não dá para medir: melhor calar do que chutar
        vivas = []
        for col in candidatas:
            nulls, distintos = est.get(col, (None, None))
            if nulls is None or not distintos:
                continue   # coluna vazia na origem não é perda
            preenchidas = max(0, total - int(nulls))
            pct = (preenchidas / total) * 100
            if preenchidas and pct >= 50:
                vivas.append((col, preenchidas, pct))
        if not vivas:
            continue
        # ⚠️ "preenchida" pela estatística é NÃO-NULA, e **zero conta como preenchida**. Sem este segundo
        # passo, uma coluna numérica zerada em 100% das linhas aparece como perda de 100% — foi o que
        # aconteceu com seis colunas de `nf_prod` (vrpis, markupl, vrcomissao…), todas zeradas.
        # Uma consulta por TABELA (não por coluna) mede o que de fato tem valor: ~20 idas, não centenas.
        numericas = [x for (x, _, _) in vivas if TIPOS.get(T, {}).get(x) in ('NUMBER', 'FLOAT')]
        com_valor = {x for (x, _, _) in vivas}
        if numericas:
            sel = ", ".join(f"count(case when {x} <> 0 then 1 end)" for x in numericas)
            try:
                cu.execute(f"select {sel} from {T}")
                for x, n in zip(numericas, cu.fetchone()):
                    if not int(n or 0):
                        com_valor.discard(x)   # numérica zerada em toda a tabela: não é perda
            except Exception:
                pass   # sem permissão ou tipo exótico: mantém pela estatística
        for col, preenchidas, pct in vivas:
            if col in com_valor:
                (pendentes if (t, col) in TRIAGEM_PENDENTE else perdidas).append((t, col, preenchidas, total, pct))
    perdidas.sort(key=lambda x: -x[4])

    achados.sort(key=lambda x: (x[0] != 'ALTO', x[1], x[2]))
    altos = [a for a in achados if a[0] == 'ALTO']
    print(f"tabelas do plano conferidas: {len(alvo)}")
    print(f"[1] o destino exige e a origem não tem: {len(achados)} — ALTO: {len(altos)}\n")
    for risco, t, col, dflt, nn in achados:
        print(f"  [{risco:5s}] {t}.{col:30s} default={dflt[:20]:22s} {nn}")

    print(f"\n[2] a ORIGEM tem e o destino NÃO — o dado some sem deixar buraco: {len(perdidas)}")
    print("    (só chave/número preenchido em 50% ou mais das linhas E com valor ≠ 0 em alguma delas;")
    print("     a estatística diz o que é não-nulo, e uma segunda passada por tabela descarta as zeradas)")
    for t, col, n, tot, pct in perdidas:
        print(f"      {t}.{col:28s} {n:>10,} de {tot:>10,} linhas ({pct:5.1f}%)")

    if pendentes:
        pendentes.sort(key=lambda x: -x[4])
        print(f"\n[2b] TRIAGEM PENDENTE, declarada (FILA Achado 18) — não derruba, mas não some: {len(pendentes)}")
        for t, col, n, tot, pct in pendentes:
            print(f"      {t}.{col:28s} {n:>10,} de {tot:>10,} linhas ({pct:5.1f}%)")

    if altos or perdidas:
        if altos:
            print("\n⚠️  as de risco ALTO mudam NÚMERO ou EMPRESA: cada uma precisa de entrada em")
            print("    CALCULADAS/RENOMEIA no etl/extrair.py, ou de justificativa em NOSSAS_JUSTIFICADAS.")
        if perdidas:
            print("\n⚠️  as do sentido [2] precisam de coluna no destino, ou de um padrão em ORIGEM_NAO_VEM")
            print("    dizendo por que não vêm. Foi assim que `clube_desconto.barras` passou três migrations.")
        return 1
    print("\nnenhuma coluna órfã de risco alto, e nenhuma coluna da origem ficando para trás.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
