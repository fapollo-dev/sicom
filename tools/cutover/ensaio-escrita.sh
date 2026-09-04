#!/bin/bash
# ENSAIO DE ESCRITA — o dia seguinte à virada.
#
# O ensaio de operação (`ensaio-operacao.sh`) provou que as telas ABREM sobre o dado real. Este prova que o
# sistema **OPERA**: criar documento, mover estoque, gerar título, estornar. É o que testa de verdade duas
# coisas que só quebram depois da carga:
#   · as SEQUÊNCIAS — a carga gravou os ids do legado; se o `setval(max)` falhou, o primeiro INSERT colide
#     com "duplicate key" (e ninguém descobre isso lendo relatório);
#   · as FKs e defaults sobre dado real — o app grava contra 47 mil produtos e 19 mil parceiros do cliente,
#     não contra as fixtures do smoke.
#
# ⚠️ ESCREVE no Postgres do ensaio (descartável, porta 5433). NUNCA aponte para um banco que importe.
# O Oracle não é tocado em momento algum.
#
#   tools/cutover/ensaio-escrita.sh [http://127.0.0.1:3100]
API="${1:-http://127.0.0.1:3100}"
OP="${OP:-4}"; EMP="${EMP:-1}"
H=(-H 'content-type: application/json' -H 'x-tenant-id: pinheirao' -H "x-operador-id: $OP" -H "x-empresa-id: $EMP")
TMP=/tmp/ensaio-escrita.json
falhas=0

chamar() { # método rota [body] — imprime status/tempo e guarda o corpo em $TMP
  local m="$1" rota="$2" body="${3:-}" out st t
  if [ -n "$body" ]; then
    out=$(curl -s -o $TMP -w '%{http_code} %{time_total}' -X "$m" "${H[@]}" "$API/$rota" --data "$body")
  else
    out=$(curl -s -o $TMP -w '%{http_code} %{time_total}' -X "$m" "${H[@]}" "$API/$rota")
  fi
  read -r st t <<<"$out"
  ULTIMO_STATUS=$st
  printf '  %-6s %-46s %s  %5.2fs' "$m" "${rota:0:46}" "$st" "$t"
  if [ "$st" -ge 400 ]; then printf '  ❌ %s' "$(head -c 150 $TMP | tr '\n' ' ')"; falhas=$((falhas+1)); fi
  printf '\n'
}
json() { python3 -c "import json,sys;d=json.load(open('$TMP'));print(d$1)" 2>/dev/null; }

echo "== ensaio de ESCRITA em $API · operador $OP · empresa $EMP · $(date '+%d/%m %H:%M') =="

# 1) CADASTRO NOVO — testa a sequência de `produtos` (a carga gravou ids até 47 mil do legado)
echo "-- 1) cadastro: produto novo (sequência de produtos)"
chamar POST 'cadastro/produtos' '{"descricao":"PRODUTO ENSAIO CUTOVER","unidade":"UN","aliquota":"T01","ativo":"S","codbarra":"7899999000018"}'
PROD=$(json "['idproduto']")
echo "     idproduto gerado: ${PROD:-(nenhum)}"

# 2) NOTA DE ENTRADA — criar, processar (move estoque), conferir, reverter
echo "-- 2) NF de entrada: criar → processar (move estoque) → reverter"
SALDO_ANTES=$(curl -s "${H[@]}" "$API/cadastro/produtos/${PROD:-1}" -o /dev/null -w '%{http_code}')
chamar POST 'fiscal/nf' "{\"tipo\":\"E\",\"modelo\":55,\"serie\":\"1\",\"nronf\":\"999001\",\"dtemissao\":\"2026-09-04\",\"dtcontabil\":\"2026-09-04\",\"codparceiro\":3388,\"cfop\":\"1102\",\"finalidade\":\"1\",\"itens\":[{\"codproduto\":${PROD:-1},\"quantidade\":10,\"fatorembal\":1,\"unidade\":\"UN\",\"vrvenda\":5,\"vrcusto\":5,\"cfop\":\"1102\",\"aliquota\":\"T01\"}]}"
NF=$(json "['codnf']")
echo "     codnf gerado: ${NF:-(nenhum)}"
if [ -n "$NF" ] && [ "$NF" != "None" ]; then
  chamar POST "fiscal/nf/$NF/processar"
  chamar GET  "fiscal/nf/$NF"
  chamar POST "fiscal/nf/$NF/reverter"
  chamar DELETE "fiscal/nf/$NF"
fi

# 3) FINANCEIRO — título a receber, baixa e estorno (sequência de `areceber` com 99 mil linhas do legado)
echo "-- 3) financeiro: título a receber → baixar → estornar"
chamar POST 'cadastro/areceber' '{"codparceiro":3388,"numero":"ENSAIO-1","emissao":"2026-09-04","vencimento":"2026-10-04","valor":100.00,"tipodoc":"DP"}'
RCB=$(json "['codrcb']")
echo "     codrcb gerado: ${RCB:-(nenhum)}"
if [ -n "$RCB" ] && [ "$RCB" != "None" ]; then
  chamar POST "cadastro/areceber/$RCB/baixar" '{"valor":100.00,"data":"2026-09-04","formapgto":"DIN"}'
  chamar POST "cadastro/areceber/$RCB/estornar-baixa" '{}'
  chamar DELETE "cadastro/areceber/$RCB"
fi

# 4) AJUSTE DE ESTOQUE — o caminho mais curto até um movimento de estoque auditado
echo "-- 4) ajuste de estoque (grava em ajuste_estoque, que tem 14 mil linhas do legado)"
chamar POST 'cadastro/ajuste-estoque' "{\"idproduto\":${PROD:-1},\"operacao\":\"AUMENTAR\",\"destino\":\"ESTOQUE\",\"qtde\":5,\"codmotivo\":999,\"obs\":\"ensaio de cutover\"}"

echo "== fim · $falhas falha(s) =="
exit $([ "$falhas" -gt 0 ] && echo 1 || echo 0)
