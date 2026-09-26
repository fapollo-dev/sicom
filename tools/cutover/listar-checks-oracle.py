#!/usr/bin/env python3
# SOMENTE LEITURA: as CHECK constraints do schema (fora os NOT NULL gerados)
import oracledb
c = oracledb.connect(user='pinheirao', password='apollo', dsn='hiperpinheirao.ddns.com.br:1521/apollo')
cu = c.cursor(); cu.execute('SET TRANSACTION READ ONLY')
cu.execute("SELECT table_name, constraint_name, search_condition, status FROM user_constraints WHERE constraint_type = 'C'")
n = 0
for t, cn, cond, st in cu:
    cond = str(cond or '')
    if cond.strip().upper().endswith('IS NOT NULL'):
        continue
    n += 1
    print(f'{t} | {cn} | {st} | {cond[:150]}')
print(n)
