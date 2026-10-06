#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CONFERIDOR DA APURAÇÃO DE ICMS — a regra das NOTAS que o Apollo usa (`apuracao-icms.service.ts`, `detalheNotas`) contra o
`APURACAO_ICMS_DETALHES` que o legado GRAVOU na produção, linha a linha e coluna a coluna.

Por que existe: o fonte do legado é de mai/2020 e a produção roda um binário mais novo. O SQL do fonte (`FDqCFOP_ICMS`)
reproduzia o crédito de jan/2026 com 8.132,02 contra 12.877,83 gravados; a regra reconstruída do dado (alíquota I/N zera em vez de
"só T conta", o x401 credita, alíquota = ICME, efetivo = BCR, frete pelo VRFRETE) reproduz 12.877,83 exatos e todas as colunas de
1.650 das 1.658 linhas de dez/2025-jan/2026 (as outras 8 são notas alteradas depois da apuração). Dossiê:
`docs/04-screen-dossier/dossiers/retaguarda/uRelRegistros_ES-apuracao-icms.md` §8.

Uso (SOMENTE LEITURA no Oracle — SET TRANSACTION READ ONLY, só SELECT):
    python3 tools/cutover/conferir-apuracao-icms.py <CODAPURACAOICMS> <DATAINI> <DATAFIN> <IDEMPRESA> <E|S> [x]
    ex.: python3 tools/cutover/conferir-apuracao-icms.py 2282 2026-01-01 2026-01-31 1 E
Sem o `x`: contagem de linhas e de colunas que batem + as somas (Apollo × gravado). Com o `x`: as linhas que divergem.
"""
import sys, oracledb
cod, di, df, emp, tipo = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
mostra = len(sys.argv) > 6
c = oracledb.connect(user='pinheirao', password='apollo', dsn='hiperpinheirao.ddns.com.br:1521/apollo')
cu = c.cursor(); cu.execute('SET TRANSACTION READ ONLY')
d = lambda x: f"TO_DATE('{x}','YYYY-MM-DD')"
filtro = (f" TRUNC(N.dtcontabil) BETWEEN {d(di)} AND {d(df)} AND N.PROC = 'S' AND N.CANCELADA = 'N' AND N.TIPO = '{tipo}' "
          f" AND N.NRONF <> '0' AND N.NRONF IS NOT NULL AND ((N.STATUSNFE <> 'D') OR (N.STATUSNFE IS NULL)) AND N.IDEMPRESA = {emp}")
if tipo == 'S':
    filtro += " AND (((N.MODELO = 55) AND (N.CHAVENFE IS NOT NULL) AND (COALESCE(N.STATUSNFE, 'P') <> 'I')) OR (N.MODELO <> 55))"
Z = "(C.PROC_CUPOM = 'S' OR SUBSTR(NP.CFOP,2,3) IN ('403','933','556') OR (SUBSTR(NP.CFOP,2,3) IN ('102','101') AND NP.CST IN (40,90)))"
L = "SUBSTR(NP.ALIQUOTA,1,1)"
VAL = "((NP.VRCUSTO - CAST(((NP.VRCUSTO * (CAST(COALESCE(NP.DESCONTO, 0) AS NUMERIC(15,6)))) / 100) AS NUMERIC(15,6))) * CAST(NP.QUANTIDADE AS NUMERIC(13,3)))"
PCT = lambda col: f"((CAST(COALESCE(NP.{col},0) AS NUMERIC(13,3)) * CAST({VAL} AS NUMERIC(15,2))) / 100)"
IPI = f"((CAST(COALESCE(NP.IPI, 0) AS NUMERIC(13,3)) * {VAL}) / 100)"
q = f"""WITH I AS (
 SELECT NP.CODNF||'NF' CODIGO, TO_NUMBER(NP.CFOP) CFOP, NP.CST,
   CASE WHEN (C.PROC_CUPOM='S' OR SUBSTR(NP.CFOP,2,3) IN ('933','556') OR (SUBSTR(NP.CFOP,2,3) IN ('102','101') AND NP.CST IN (40,90))) THEN 0 WHEN {L} IN ('I','N') THEN 0 ELSE NP.ICME END ICMS,
   CASE WHEN (C.PROC_CUPOM='S' OR SUBSTR(NP.CFOP,2,3) IN ('933','556') OR (SUBSTR(NP.CFOP,2,3) IN ('102','101') AND NP.CST IN (40,90))) THEN 0 ELSE ROUND(NP.BCR,2) END ICMS_EFETIVO,
   SUM(CASE WHEN {Z} THEN 0 WHEN {L} IN ('I','N') THEN 0 ELSE NP.VRBASECALCULO END) BASE,
   SUM(CASE WHEN {Z} THEN 0 WHEN {L} IN ('I','N') THEN 0 ELSE NP.VRICM END) VALOR_ICMS,
   SUM(CASE WHEN C.PROC_CUPOM='S' THEN 0 WHEN {L} IN ('I','N') THEN {VAL} + COALESCE(NP.DEPSACESS,0) ELSE 0 END) ISENTAS,
   SUM(CASE WHEN C.PROC_CUPOM='S' THEN {VAL} + COALESCE(NP.VRICMST,0) + {PCT('IPI')} + COALESCE(NP.DEPSACESS,0)
            WHEN {L} = 'S' THEN {VAL} + COALESCE(NP.VRICMST,0) + {IPI} + COALESCE(NP.DEPSACESS,0) + COALESCE(NP.VRFRETE,0) + {PCT('SEGURO')}
            ELSE 0 END + COALESCE(NP.FCP_VALOR_ST,0)) OUTRAS,
   SUM({VAL} + COALESCE(NP.VRICMST,0) + {IPI} + COALESCE(NP.DEPSACESS,0) + COALESCE(NP.VRFRETE,0) + {PCT('SEGURO')} + COALESCE(NP.FCP_VALOR_ST,0)) TOTALNF
 FROM NF_PROD NP JOIN CFOP C ON C.CODCFOP = NP.CFOP AND COALESCE(C.NAO_GERA_APURACAO_ICMS,'N') = 'N'
 LEFT JOIN NF N ON N.CODNF = NP.CODNF INNER JOIN PARCEIROS_END PE ON PE.CODEND = N.CODPARCEIRO_END
 WHERE {filtro}
 GROUP BY NP.CODNF||'NF', TO_NUMBER(NP.CFOP), NP.CST,
   CASE WHEN (C.PROC_CUPOM='S' OR SUBSTR(NP.CFOP,2,3) IN ('933','556') OR (SUBSTR(NP.CFOP,2,3) IN ('102','101') AND NP.CST IN (40,90))) THEN 0 WHEN {L} IN ('I','N') THEN 0 ELSE NP.ICME END, CASE WHEN (C.PROC_CUPOM='S' OR SUBSTR(NP.CFOP,2,3) IN ('933','556') OR (SUBSTR(NP.CFOP,2,3) IN ('102','101') AND NP.CST IN (40,90))) THEN 0 ELSE ROUND(NP.BCR,2) END),
G AS (SELECT CODIGO, CFOP, CST, ICMS, ICMS_EFETIVO, SUM(BASE) BASE, SUM(VALOR_ICMS) VALOR_ICMS, SUM(ISENTAS_NAOTRIB) ISENTAS, SUM(OUTRAS) OUTRAS, SUM(TOTALNF) TOTALNF
      FROM APURACAO_ICMS_DETALHES WHERE CODAPURACAOICMS={cod} AND TIPO='{tipo}' AND ESPECIE='NF' GROUP BY CODIGO, CFOP, CST, ICMS, ICMS_EFETIVO),
J AS (SELECT COALESCE(I.CODIGO,G.CODIGO) CODIGO, COALESCE(I.CFOP,G.CFOP) CFOP, COALESCE(I.CST,G.CST) CST, COALESCE(I.ICMS,G.ICMS) ICMS, I.ICMS_EFETIVO EFI, G.ICMS_EFETIVO EFG,
   CASE WHEN I.CODIGO IS NULL THEN 'só-gravado' WHEN G.CODIGO IS NULL THEN 'só-H3' ELSE 'par' END K,
   I.BASE BI, G.BASE BG, I.VALOR_ICMS VI, G.VALOR_ICMS VG, I.ISENTAS II, G.ISENTAS IG, I.OUTRAS OI, G.OUTRAS OG, I.TOTALNF TI, G.TOTALNF TG
 FROM I FULL JOIN G ON G.CODIGO=I.CODIGO AND G.CFOP=I.CFOP AND G.CST=I.CST AND G.ICMS=I.ICMS AND G.ICMS_EFETIVO=I.ICMS_EFETIVO)
"""
if mostra:
    cu.execute(q + f" SELECT * FROM J WHERE K<>'par' OR ABS(NVL(BI,0)-NVL(BG,0))>0.02 OR ABS(NVL(VI,0)-NVL(VG,0))>0.02 OR ABS(NVL(II,0)-NVL(IG,0))>0.02 OR ABS(NVL(OI,0)-NVL(OG,0))>0.02 OR ABS(NVL(TI,0)-NVL(TG,0))>0.02 OR ABS(NVL(EFI,0)-NVL(EFG,0))>0.02 ORDER BY CODIGO")
    for r in cu.fetchall()[:40]: print(r)
else:
    ok = lambda a, b: f"SUM(CASE WHEN K='par' AND ABS(NVL({a},0)-NVL({b},0))<=0.02 THEN 1 ELSE 0 END)"
    cu.execute(q + f" SELECT COUNT(*), SUM(CASE WHEN K='par' THEN 1 ELSE 0 END) PARES, {ok('BI','BG')} BASE, {ok('VI','VG')} VALOR, {ok('II','IG')} ISENTAS, {ok('OI','OG')} OUTRAS, {ok('TI','TG')} TOTAL, {ok('EFI','EFG')} EFETIVO, SUM(VI), SUM(VG), SUM(TI), SUM(TG), SUM(OI), SUM(OG) FROM J")
    print(cod, tipo, cu.fetchall())
