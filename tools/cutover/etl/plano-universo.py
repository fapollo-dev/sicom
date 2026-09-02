#!/usr/bin/env python3
"""
UNIVERSO DO PLANO DE CARGA — derivado, não mantido à mão.

O plano tinha um buraco de 77 tabelas (~5M linhas em produção): `FASES` era uma lista digitada que cobria os 69
"principais" e esquecia os FILHOS (nf_prod_lote, agenda_promocao_itens, scrap_item, apuracao_icms_detalhes…).
Este script troca a lista pela regra:

  universo = toda tabela do DESTINO (schema-destino.json) que exista no Oracle (com o mapa de nomes)
             − EXCLUSÕES declaradas (views de lookup, tabelas só nossas, e o que o usuário mandou não migrar)
  fase(t)  = profundidade no grafo de FKs do destino: 0 = não depende de ninguém; n = 1 + max(fase dos pais)
             (auto-referência ignorada; ciclo, se houver, é reportado)

Escreve `tools/cutover/plano-tabelas.json` — {fases: {f0: [...], f1: [...]}, excluidas: {...}, novas: [...]} —
que o extrator e o carregador passam a ler. Tabela nova no destino aparece sozinha na próxima rodada, em vez de
ficar "pulada" em silêncio. SOMENTE LEITURA no Oracle (conta linhas para o relatório).

Uso:  ORACLE_HOST=hiperpinheirao.ddns.com.br python3 tools/cutover/etl/plano-universo.py
"""
import json, os, sys
import oracledb

BASE = '/Library/Apollo/tools/cutover'
# nome no Oracle quando não é só o nosso em maiúsculas
TABELA_ORIGEM = {'lote_preco': 'LOTEPRECO'}
# o que NÃO entra, com motivo (fica no JSON para quem ler o plano)
EXCLUSOES = {
    'historico_pdv': 'PDV — instrução do usuário (19/08): nada de PDV; a tabela existe no destino só como estrutura',
    'hist_sangria_suprimento': 'PDV (sangria/suprimento é do fechamento por PDV, fora da regra)',
}
# as fases antigas, para o relatório dizer o que é NOVO
ANTIGAS = set("""bancos cidades bairro cfop ncm aliquota piscofins det_aliquota figura_fiscal unidade marcas familias_prod
familias_prod_area plc plano_contas condicoes_pagto operacoes_conta empresas configuracoes configuracoes_especificas
operadores perfil permissoes parceiros parceiros_end parceiros_bancos produtos composicao decomposicao receita_prod
codauxiliar codreferencia_for multi_preco estoque contas_bancarias formas_pgto pedidocompra pedidocompra_i nf nf_prod
nfe_xml cotacao cotacao_prod inventario inventario_livro balanco balancoitens producao troca scrap lote_preco
agenda_promocao areceber areceber_bx apagar apagar_bx cx_apagar caixa cartao mov_contas_bancarias
movimentacao_bancaria_ofx diario apuracao_pc adiantamento_forn vendas cx_vendas historico_prod historico_dinamico
caixa_pdv nfe_nao_cadastradas""".split())

dest = json.load(open(f'{BASE}/schema-destino.json'))['tabelas']

host = os.environ.get('ORACLE_HOST', '192.168.1.230')
con = oracledb.connect(user='pinheirao', password='apollo', dsn=oracledb.makedsn(host, 1521, sid='apollo'))
con.call_timeout = 900000
cur = con.cursor()
cur.execute('SET TRANSACTION READ ONLY')
print(f'[oracle] {host} (read only)')
cur.execute('select table_name from user_tables')
ora = {r[0] for r in cur.fetchall()}

def nome_oracle(t: str) -> str:
    return TABELA_ORIGEM.get(t, t.upper())

# 1) universo
candidatas = [t for t in dest if not t.startswith('get_') and nome_oracle(t) in ora]
so_nossas = sorted(t for t in dest if not t.startswith('get_') and nome_oracle(t) not in ora)
universo = [t for t in candidatas if t not in EXCLUSOES]

# 2) profundidade pelo grafo de FKs (só entre tabelas do universo)
pais = {t: {fk['ref'].split('.')[0] for fk in dest[t].get('fks', [])} - {t} for t in universo}
pais = {t: {p for p in ps if p in pais} for t, ps in pais.items()}
prof, ciclo = {}, []
def profundidade(t, trilha=()):
    if t in prof: return prof[t]
    if t in trilha:
        ciclo.append(' -> '.join(trilha + (t,))); return 0
    d = 0 if not pais[t] else 1 + max(profundidade(p, trilha + (t,)) for p in pais[t])
    prof[t] = d
    return d
for t in universo: profundidade(t)

fases = {}
for t in sorted(universo, key=lambda x: (prof[x], x)):
    fases.setdefault(f'f{prof[t]}', []).append(t)

# 3) contagem em produção (relatório) — só das NOVAS, para não pesar
novas = sorted(t for t in universo if t not in ANTIGAS)
contagem = {}
for t in novas:
    try:
        cur.execute(f'select count(*) from {nome_oracle(t)}'); contagem[t] = cur.fetchone()[0]
    except Exception as e:
        contagem[t] = f'ERRO {str(e)[:40]}'

plano = {'gerado_em_host': host, 'fases': fases, 'excluidas': EXCLUSOES, 'so_do_destino': so_nossas,
         'novas_vs_plano_antigo': {t: contagem[t] for t in novas}, 'ciclos': ciclo,
         'tabela_origem': TABELA_ORIGEM}
json.dump(plano, open(f'{BASE}/plano-tabelas.json', 'w'), indent=1, ensure_ascii=False)

print(f'\nuniverso: {len(universo)} tabelas em {len(fases)} fases · excluídas: {len(EXCLUSOES)} · só do destino: {len(so_nossas)}')
for f in sorted(fases, key=lambda x: int(x[1:])):
    print(f'  {f}: {len(fases[f])} — ' + ', '.join(fases[f]))
if ciclo: print('\n⚠️ ciclos de FK:', ciclo)
tot = sum(v for v in contagem.values() if isinstance(v, int))
print(f'\nNOVAS em relação ao plano antigo: {len(novas)} tabelas · {tot:,} linhas em {host}')
for t in sorted(novas, key=lambda x: -(contagem[x] if isinstance(contagem[x], int) else -1)):
    print(f'  {t:36} {contagem[t]}')
print(f'\n→ {BASE}/plano-tabelas.json')
