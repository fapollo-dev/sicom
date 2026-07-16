#!/usr/bin/env python3
"""CUTOVER das senhas de operação da EMPRESA — EXTRATOR READ-ONLY do Oracle legado (retaguarda). Emite as colunas
SENHAADMIN/DESC/CANCEL/GAVETA de EMPRESAS como JSON (cifradas César +13 — RTRIM p/ tirar padding). O motor
(senha-empresa.ts) decoda + classifica + re-hasha. SOMENTE SELECT — nada é escrito no Oracle (replicação ativa).

Credenciais por env (defaults = PINHEIRAO homolog; ver a memória oracle-db-access):
  ORA_HOST=192.168.1.230 ORA_PORT=1521 ORA_SID=apollo ORA_USER=pinheirao ORA_PASS=apollo
Requer o pacote `oracledb` (thin). uso: python extract-senha-empresa.py [saida.json]
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

# RAWTOHEX(UTL_RAW.CAST_TO_RAW(...)) devolve os BYTES EXATOS da coluna em hex — imune ao NLS/charset do cliente
# oracledb (fold da auditoria: sem RAWTOHEX, um byte alto poderia virar outro codepoint Unicode e o decode César
# byte-wise no TS erraria). Reconstruímos cada byte como um char latin-1 (charCodeAt == byte), que é o que o motor
# (decodeSenhaLegado, charCodeAt(0)) espera.
cur.execute("""
  SELECT CODEMPRESA,
         RAWTOHEX(UTL_RAW.CAST_TO_RAW(RTRIM(SENHAADMIN)))  AS H_ADMIN,
         RAWTOHEX(UTL_RAW.CAST_TO_RAW(RTRIM(SENHADESC)))   AS H_DESC,
         RAWTOHEX(UTL_RAW.CAST_TO_RAW(RTRIM(SENHACANCEL))) AS H_CANCEL,
         RAWTOHEX(UTL_RAW.CAST_TO_RAW(RTRIM(SENHAGAVETA))) AS H_GAVETA
  FROM EMPRESAS ORDER BY CODEMPRESA
""")

def bytes_latin1(hexstr):
    """hex do Oracle → string latin-1 (1 char por byte); None/'' → None."""
    if not hexstr:
        return None
    return bytes.fromhex(hexstr).decode("latin-1")

out = []
for r in cur:
    out.append({
        "codempresa": int(r[0]) if r[0] is not None else None,
        "senhaadmin": bytes_latin1(r[1]),
        "senhadesc": bytes_latin1(r[2]),
        "senhacancel": bytes_latin1(r[3]),
        "senhagaveta": bytes_latin1(r[4]),
    })
cur.close(); con.close()

path = sys.argv[1] if len(sys.argv) > 1 else "senha_empresa_raw.json"
with open(path, "w") as f:
    json.dump(out, f, ensure_ascii=False)
print(f"extraídas {len(out)} empresas → {path}")
# AVISO DE SEGREDO (fold da auditoria): este JSON contém as senhas cifradas César +13 = REVERSÍVEIS. Trate-o como
# segredo — NÃO versione, NÃO deixe em share/CI. Apague após rodar o report/loader (`rm`).
print(f"[SEGREDO] {path} contém senhas César-13 reversíveis — apague após o cutover (rm {path}).")
