#!/usr/bin/env python3
"""CUTOVER do de-para — EXTRATOR READ-ONLY do Oracle legado (retaguarda). Emite o de-para ENRIQUECIDO como JSON:
cada linha de CODREFERENCIA_FOR + o codbarra/ativo do produto + a validade do fornecedor (FRN). O motor de de-dup
(report-codref.ts) consome este JSON. SOMENTE SELECT — nada é escrito no Oracle (o banco tem replicação ativa).

Credenciais por env (defaults = PINHEIRAO homolog; ver a memória oracle-db-access):
  ORA_HOST=192.168.1.230 ORA_PORT=1521 ORA_SID=apollo ORA_USER=pinheirao ORA_PASS=apollo
Requer o pacote `oracledb` (thin, sem Instant Client). uso: python extract-codref.py [saida.json]
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

# LEFT JOINs: produtos (codbarra/ativo) + parceiros (existe + FRN). Tudo resolvido no banco (1 query).
cur.execute("""
  SELECT c.CODREFERENCIA_FOR, c.IDPRODUTO, c.CODREF, c.CODFOR, c.TIPOREF, c.FATOR_EMBALAGEM,
         p.IDPRODUTO AS PROD_ID, p.CODBARRA, NVL(p.ATIVO,'S') AS PROD_ATIVO,
         par.CODPARCEIRO AS PAR_ID, NVL(par.FRN,'N') AS PAR_FRN
  FROM CODREFERENCIA_FOR c
  LEFT JOIN PRODUTOS  p   ON p.IDPRODUTO   = c.IDPRODUTO
  LEFT JOIN PARCEIROS par ON par.CODPARCEIRO = c.CODFOR
""")
cols = [d[0] for d in cur.description]
out = []
for r in cur:
    row = dict(zip(cols, r))
    out.append({
        "codreferencia_for": int(row["CODREFERENCIA_FOR"]),
        "idproduto": int(row["IDPRODUTO"]) if row["IDPRODUTO"] is not None else None,
        "codref": row["CODREF"],
        "codfor": int(row["CODFOR"]) if row["CODFOR"] is not None else None,
        "tiporef": row["TIPOREF"],
        "fator_embalagem": float(row["FATOR_EMBALAGEM"]) if row["FATOR_EMBALAGEM"] is not None else None,
        "produto_existe": row["PROD_ID"] is not None,
        "produto_ativo": (row["PROD_ATIVO"] or "S") != "N",
        "produto_codbarra": row["CODBARRA"],  # CRU — o report aplica normRef (TS) p/ single-source com o runtime
        "fornecedor_valido": row["PAR_ID"] is not None and (row["PAR_FRN"] or "N") == "S",
    })
cur.close(); con.close()

path = sys.argv[1] if len(sys.argv) > 1 else "codref_raw.json"
with open(path, "w") as f:
    json.dump(out, f)
print(f"extraídas {len(out)} linhas → {path}")
