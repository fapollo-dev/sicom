# Ajuste de preços — lote (FRMAJUSTEPRECOS, `uAjustePrecos.pas`) — 5.277 acessos

Código no Apollo: `cadastro/ajuste-precos.service.ts` + `apps/web/src/features/ajuste-precos`. Migs 127-128 (fila `lote_preco`
e as origens que a alimentam: cadastro do produto, pedido de compra, precificações).

## Corte "o botão Etiquetas" (25/09/2026) — auditoria de esqueletos §4.12

O botão "Etiquetas" (`btnEtiquetasClick`, uAjustePrecos.pas:109-260), que a mig 127 declarava adiado: os lotes marcados (ou os
que acabaram de ser processados) viram etiquetas — expandidos pelo grupo de preço, sem repetir código de barras; com "sem os de
promoção" (`ckPromo`) o lote em promoção fica de fora. `POST cadastro/etiqueta/dos-lotes`; a tela leva à de Etiquetas
(`/estoque/etiquetas`) com a lista montada. Produção: 469 das 789 execuções do ajuste tiveram impressão de etiqueta pelo mesmo
operador até 15 minutos antes. Smoke §211.

Pendentes (BAIXA): o histórico por produto atualizado; o processar é da empresa da sessão (28 execuções multi-empresa no
legado — divergência declarada).
