"""
CONFERIR VIEWS — as views do Apollo com homônima no Oracle, coluna a coluna (SOMENTE LEITURA na produção).

Para cada view (padrão: as do catálogo do construtor = as com COMMENT ON VIEW nas migrations), extrai a lista do SELECT dos
dois lados — no Oracle a expressão de cada posição é casada com ALL_TAB_COLUMNS (a lista de colunas da view MANDA sobre os
aliases do SELECT), no Apollo a última definição nas migrations — normaliza (NVL→COALESCE, prefixos de alias, casts) e
grava em `cmpviews.json` as colunas homônimas com expressão diferente. A leitura das diferenças é manual: código cru ×
texto decodificado, coluna trocada, cálculo diferente. Uso:

    ORACLE_* no ambiente (padrão: produção só leitura) · python3 tools/cutover/conferir-views.py [view …]

Achados de 28/09/2026: docs/05-migration-engineering/views-de-relatorio.md.
"""
import oracledb, re, glob, json, sys
MIG='/Library/Apollo/apps/api/migrations'
def split_top(s):
    out=[]; depth=0; q=False; cur=''
    for ch in s:
        if ch=="'" : q=not q
        if not q:
            if ch=='(': depth+=1
            elif ch==')': depth-=1
            elif ch==',' and depth==0: out.append(cur); cur=''; continue
        cur+=ch
    out.append(cur); return [x.strip() for x in out]
def select_list(sql):
    s=sql.strip()
    m=re.search(r'\bSELECT\b', s, re.I); s=s[m.end():]
    s=re.sub(r'^\s*DISTINCT\b','',s,flags=re.I)
    depth=0; q=False
    for i in range(len(s)):
        ch=s[i]
        if ch=="'": q=not q
        if q: continue
        if ch=='(': depth+=1
        elif ch==')': depth-=1
        elif depth==0 and re.match(r'\bFROM\b', s[i:i+5], re.I) and (i==0 or not (s[i-1].isalnum() or s[i-1]=='_')):
            return s[:i]
    return s
def strip_alias(e):
    m0=re.match(r'^(.*?)\s+AS\s+("?[A-Za-z_][A-Za-z0-9_$#]*"?)\s*$', e, re.S|re.I)
    if m0: return m0.group(1), m0.group(2).strip('"').lower()
    m=re.match(r'^(.*\S)\s+(?:AS\s+)?("?[A-Za-z_][A-Za-z0-9_$#]*"?)$', e, re.S|re.I)
    if m and not m.group(1).rstrip().endswith(('.','(')) and m.group(2).upper() not in ('END',):
        # evita cortar "a.col" sem alias
        return m.group(1), m.group(2).strip('"').lower()
    return e, None
def norm(e):
    e=e.upper()
    e=re.sub(r'\bNVL\(','COALESCE(',e)
    e=re.sub(r'::[A-Z ]+(\(\d+(,\d+)?\))?','',e)
    e=re.sub(r'\b[A-Z_][A-Z0-9_]*\.(?=[A-Z_"])','',e)
    e=re.sub(r'\bTRUNC\(([A-Z_0-9]+)\)',r'\1',e)
    e=re.sub(r'\s+','',e)
    e=re.sub(r'^CAST\((.*)AS[A-Z]+(\(\d+(,\d+)?\))?\)$',r'\1',e)
    return e
c=oracledb.connect(user='pinheirao', password='apollo', dsn='hiperpinheirao.ddns.com.br:1521/apollo')
cu=c.cursor(); cu.execute('SET TRANSACTION READ ONLY')
views=sys.argv[1:] or sorted({m.group(1).lower() for f in glob.glob(MIG+'/*.sql') for m in re.finditer(r'COMMENT ON VIEW ([a-z_0-9]+)', open(f).read(), re.I)})
# Apollo: última definição
defs={}
for f in sorted(glob.glob(MIG+'/*.sql')):
    t=open(f).read()
    for m in re.finditer(r'CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([a-z_0-9]+)\s+AS\s+(.*?);\s*(?:\n|$)', t, re.S|re.I):
        defs[m.group(1).lower()]=(f.split('/')[-1], m.group(2))
res={}
for v in views:
    cu.execute("SELECT TEXT FROM ALL_VIEWS WHERE OWNER='PINHEIRAO' AND VIEW_NAME=:v", v=v.upper())
    r=cu.fetchone()
    if not r or v not in defs: continue
    otext=str(r[0])
    cu.execute("SELECT LOWER(COLUMN_NAME) FROM ALL_TAB_COLUMNS WHERE OWNER='PINHEIRAO' AND TABLE_NAME=:v ORDER BY COLUMN_ID", v=v.upper())
    ocols=[x[0] for x in cu]
    oexp=[strip_alias(e)[0] for e in split_top(select_list(otext))]
    omap={}
    if len(oexp)==len(ocols):
        omap=dict(zip(ocols,oexp))
    else:
        for e in split_top(select_list(otext)):
            ex,al=strip_alias(e)
            if al: omap[al]=ex
    amap={}
    for e in split_top(select_list(defs[v][1])):
        ex,al=strip_alias(e)
        if al is None:
            al=re.sub(r'^.*\.','',e.strip()).lower()
        amap[al]=ex
    difs=[(k,omap[k],amap[k]) for k in amap if k in omap and norm(omap[k])!=norm(amap[k])]
    res[v]={'mig':defs[v][0],'n_ora':len(ocols),'n_apollo':len(amap),'comuns':len([k for k in amap if k in omap]),'difs':difs,'posicional':len(oexp)==len(ocols)}
json.dump(res, open('cmpviews.json','w'), indent=1, ensure_ascii=False)
for v,r in res.items():
    print(f"== {v} ({r['mig']}) ora={r['n_ora']} apollo={r['n_apollo']} comuns={r['comuns']} difs={len(r['difs'])} pos={r['posicional']}")
