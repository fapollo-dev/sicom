#!/usr/bin/env python3
"""CUTOVER das senhas de OPERADOR — EXTRATOR READ-ONLY do Oracle legado. Emite CODOPERADOR + SENHA (cifrada César
+13) como JSON. RAWTOHEX(UTL_RAW.CAST_TO_RAW(RTRIM(SENHA))) devolve os BYTES EXATOS (imune ao NLS do cliente) →
reconstruídos como latin-1 (charCodeAt == byte), que é o que o motor (decodeSenhaLegado) espera. SOMENTE SELECT.

Credenciais por env (defaults = PINHEIRAO homolog; ver memória oracle-db-access):
  ORA_HOST=192.168.1.230 ORA_PORT=1521 ORA_SID=apollo ORA_USER=pinheirao ORA_PASS=apollo
uso: python extract-senha-operador.py [saida.json]
"""
import json, os, sys, oracledb

con = oracledb.connect(
    user=os.environ.get("ORA_USER", "pinheirao"),
    password=os.environ.get("ORA_PASS", "apollo"),
    dsn=oracledb.makedsn(os.environ.get("ORA_HOST", "192.168.1.230"),
                         int(os.environ.get("ORA_PORT", "1521")),
                         sid=os.environ.get("ORA_SID", "apollo")),
)
con.call_timeout = 60000
cur = con.cursor()
cur.execute("""
  SELECT CODOPERADOR, RAWTOHEX(UTL_RAW.CAST_TO_RAW(RTRIM(SENHA))) AS H_SENHA
  FROM OPERADORES ORDER BY CODOPERADOR
""")

def bytes_latin1(hexstr):
    if not hexstr:
        return None
    return bytes.fromhex(hexstr).decode("latin-1")

out = [{"codoperador": int(r[0]) if r[0] is not None else None, "senha": bytes_latin1(r[1])} for r in cur]
cur.close(); con.close()

path = sys.argv[1] if len(sys.argv) > 1 else "senha_operador_raw.json"
with open(path, "w") as f:
    json.dump(out, f, ensure_ascii=False)
print(f"extraídas {len(out)} operadores → {path}")
print(f"[SEGREDO] {path} contém senhas César-13 reversíveis — apague após o cutover (rm {path}).")
