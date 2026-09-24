import re,sys,os
root='/Library/Apollo/apps/api/src/modules/'
for f in sys.argv[1:]:
    p=root+f
    if not os.path.exists(p): print('MISSING',f); continue
    src=open(p,encoding='utf-8').read().split('\n')
    meth='?'
    for i,l in enumerate(src):
        m=re.match(r'\s*(?:async\s+|private\s+|public\s+|protected\s+|static\s+|readonly\s+)*([a-zA-Z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\(.*\)\s*(?::[^{]*)?\{?\s*$',l)
        if m and m.group(1) not in ('if','for','while','switch','catch','return','function') and re.match(r'\s{2}\S',l): meth=m.group(1)
        m2=re.match(r'\s*(?:async\s+)?([a-zA-Z_][A-Za-z0-9_]*)\s*[:=]\s*(?:async\s*)?\(',l)
        if m2 and re.match(r'\s{2,4}\S',l): meth=m2.group(1)
        if re.search(r'throw new (BusinessRuleError|ForbiddenActionError|ConflictError)',l):
            txt=' '.join(x.strip() for x in src[i:i+4])
            txt=re.sub(r'\s+',' ',txt)[:260]
            print(f'{f}:{i+1} [{meth}] {txt}')
