#!/usr/bin/env python3
"""
RETRATO DO CATÁLOGO DO CONSTRUTOR — as views que o FRMRELATORIO do legado oferece, como estão HOJE na produção.

O catálogo do construtor não é tabela: é o COMMENT da view (`GET_CARTAOBX` → ';CARTOES BAIXADOS'). Entram as views com COMMENT
que não começa com '#' (os '#PDV_…' são as views de carga do PDV); o rótulo do combo é o COMMENT sem o ';' do início. O binário da
produção recria views sem aviso (LAST_DDL_TIME de 29/09/2026 em quatro delas), então o retrato é datado e se renova.

Grava `tools/cutover/catalogo-construtor-producao.json` ({views: {nome: {rotulo, status, colunas, tipos, sql}}}), que o smoke §283
usa para conferir toda fonte do Apollo. SOMENTE LEITURA no Oracle (SET TRANSACTION READ ONLY; só dicionário de dados).

Uso:  ORACLE_HOST=hiperpinheirao.ddns.com.br python3 tools/cutover/retratar-catalogo-construtor.py
"""
import datetime, json, os
import oracledb

BASE = os.path.dirname(os.path.abspath(__file__))
host = os.environ.get('ORACLE_HOST', 'hiperpinheirao.ddns.com.br')
c = oracledb.connect(user=os.environ.get('ORACLE_USER', 'pinheirao'), password=os.environ.get('ORACLE_PASS', 'apollo'),
                     dsn=f"{host}:{os.environ.get('ORACLE_PORT', '1521')}/{os.environ.get('ORACLE_SID', 'apollo')}")
cu = c.cursor(); cu.execute('SET TRANSACTION READ ONLY')
cu.execute("""SELECT v.view_name, cm.comments, o.status FROM all_views v
                JOIN all_tab_comments cm ON cm.owner = v.owner AND cm.table_name = v.view_name
                JOIN all_objects o ON o.owner = v.owner AND o.object_name = v.view_name AND o.object_type = 'VIEW'
               WHERE v.owner = 'PINHEIRAO' AND cm.comments IS NOT NULL ORDER BY 1""")
views = {}
for nome, com, status in cu.fetchall():
    if com.lstrip().startswith('#'):
        continue
    cu.execute("SELECT LOWER(column_name), data_type FROM all_tab_columns WHERE owner = 'PINHEIRAO' AND table_name = :v ORDER BY column_id", v=nome)
    cols = cu.fetchall()
    cu.execute("SELECT text FROM all_views WHERE owner = 'PINHEIRAO' AND view_name = :v", v=nome)
    sql = ' '.join(str(cu.fetchone()[0]).split())
    rot = com.strip()[1:].strip() if com.strip().startswith(';') else com.strip()
    # o COMMENT gravado com o UTF-8 lido como cp1252 ('HistÃ³rico Desconto'): o rótulo sai consertado (o importador conserta o TABELA)
    if 'Ã' in rot or 'Â' in rot:
        try: rot = rot.encode('cp1252').decode('utf-8')
        except (UnicodeEncodeError, UnicodeDecodeError): pass
    # e o caractere de controle invisível que sobra de outros acidentes ('DIÁ\x81RIA' na GET_MOVIMENTACAO_DIARIA)
    rot = ''.join(ch for ch in rot if not (ord(ch) < 0x20 or 0x7f <= ord(ch) <= 0x9f))
    views[nome.lower()] = {'rotulo': rot, 'status': status, 'colunas': [a for a, _ in cols], 'tipos': [b for _, b in cols], 'sql': sql}
out = {'gerado_em': datetime.date.today().isoformat(), 'origem': f'{host}, ALL_VIEWS/ALL_TAB_COLUMNS/ALL_TAB_COMMENTS, só leitura',
       'regra': "catálogo do construtor = views com COMMENT que não começa com '#' (os '#PDV_…' são as views de carga do PDV); rótulo = o COMMENT sem o ';' do início",
       'views': views}
json.dump(out, open(f'{BASE}/catalogo-construtor-producao.json', 'w'), ensure_ascii=False, indent=1)
print(f'{len(views)} views no catálogo da produção')
