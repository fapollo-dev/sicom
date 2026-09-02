#!/bin/bash
# ENSAIO DE OPERAÇÃO — o Apollo de pé sobre a base de PRODUÇÃO carregada, respondendo às telas que a loja usa.
#
# O ensaio de carga prova que o dado ENTRA; este prova que o sistema FUNCIONA em cima dele, e quanto demora, com
# o volume real (18,9M vendas, 14,5M de kardex). Roda contra a API já apontada para o Postgres do `--manter`:
#
#   1) pnpm --filter @apollo/api exec ts-node --transpile-only scripts/carregar-cutover.ts todas --manter
#   2) PGHOST=127.0.0.1 PGPORT=5433 PGUSER=apollo PGPASSWORD=apollo \
#        pnpm --filter @apollo/api exec ts-node --transpile-only src/main.ts               (porta 3000; não há `dev` sem banco embarcado)
#   3) tools/cutover/ensaio-operacao.sh [http://127.0.0.1:3000]
#
# Cada chamada sai com STATUS · TEMPO · TAMANHO. 200 devagar é achado de índice; 4xx/5xx é achado de dado
# (coluna que a tela espera e a carga não trouxe, valor fora do domínio, etc.). Nada aqui grava.
API="${1:-http://127.0.0.1:3000}"
# operador REAL de produção com grants na empresa 1 (BRUNO SANTANA, cod 4, 1.079 opções; CYARA 3801 tem 1.080).
# O op 7 do smoke não tem nada aqui — a base é a do cliente, não a do harness.
OP="${OP:-4}"; EMP="${EMP:-1}"
H=(-H 'content-type: application/json' -H 'x-tenant-id: pinheirao' -H "x-operador-id: $OP" -H "x-empresa-id: $EMP")
INI="${INI:-2026-08-01}"; FIM="${FIM:-2026-08-31}"   # um mês fechado de operação real

chamar() { # método rota [body]
  local m="$1" rota="$2" body="${3:-}"
  local out
  if [ -n "$body" ]; then
    out=$(curl -s -o /tmp/ensaio-op.json -w '%{http_code} %{time_total} %{size_download}' -X "$m" "${H[@]}" "$API/$rota" --data "$body")
  else
    out=$(curl -s -o /tmp/ensaio-op.json -w '%{http_code} %{time_total} %{size_download}' -X "$m" "${H[@]}" "$API/$rota")
  fi
  local st t sz; read -r st t sz <<<"$out"
  local marca="✅"; [ "$st" -ge 400 ] && marca="❌"; awk "BEGIN{exit !($t > 3)}" && [ "$st" -lt 400 ] && marca="🐢"
  printf '%s %-4s %-52s %s  %6.2fs  %8s B' "$marca" "$m" "$rota" "$st" "$t" "$sz"
  [ "$st" -ge 400 ] && printf '  %s' "$(head -c 160 /tmp/ensaio-op.json | tr '\n' ' ')"
  printf '\n'
}

echo "== ensaio de operação em $API · período $INI..$FIM · $(date '+%d/%m %H:%M') =="
echo "-- cadastros (listas que a tela abre)"
chamar GET  'cadastro/produtos'
chamar GET  'cadastro/produtos/1'
chamar GET  'cadastro/parceiros'
chamar GET  'cadastro/operadores'
chamar GET  'cadastro/bancos'
echo "-- documentos"
chamar GET  'fiscal/nf'
chamar GET  'cadastro/areceber'
chamar GET  'cadastro/apagar'
chamar GET  'compras/pedidos'
chamar GET  'cadastro/inventario-rotativo'
chamar GET  'cadastro/inventario'
echo "-- relatórios sobre o movimento (é aqui que o volume pesa)"
chamar POST 'relatorios/vendas-data/consultar'        "{\"dtini\":\"$INI\",\"dtfim\":\"$FIM\"}"
chamar POST 'relatorios/ticket-medio/consultar'       "{\"dtini\":\"$INI\",\"dtfim\":\"$FIM\"}"
chamar POST 'relatorios/curva-abc/consultar'          "{\"dtini\":\"$INI\",\"dtfim\":\"$FIM\"}"
chamar POST 'relatorios/vendas-departamento/consultar' "{\"dtini\":\"$INI\",\"dtfim\":\"$FIM\"}"
chamar POST 'relatorios/vendas-hora/consultar'        "{\"dtini\":\"$INI\",\"dtfim\":\"$FIM\"}"
chamar POST 'relatorios/formas-pgto/consultar'        "{\"dtini\":\"$INI\",\"dtfim\":\"$FIM\"}"
chamar POST 'relatorios/sem-movimento/consultar'      "{\"dtini\":\"$INI\",\"dtfim\":\"$FIM\",\"modo\":\"SEM_VENDA\"}"
# a CONSULTA do histórico é por cupom+PDV/pedido; quem varre período é o `listar` (com teto, senão são 18,9M linhas)
chamar POST 'relatorios/hist-vendas/listar'           "{\"dtini\":\"$INI\",\"dtfim\":\"$FIM\",\"limite\":500}"
chamar POST 'relatorios/caixa-dre/consultar'          "{\"dtini\":\"$INI\",\"dtfim\":\"$FIM\"}"
echo "-- fiscal"
chamar POST 'fiscal/apuracao-icms/obter'              "{\"dataini\":\"$INI\",\"datafin\":\"$FIM\"}"
chamar POST 'fiscal/sped/apuracao-pc'                 "{\"dtini\":\"$INI\",\"dtfim\":\"$FIM\"}"
echo "== fim $(date '+%H:%M') =="
