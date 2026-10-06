# MOVIMENTAÇÕES DO DIA (`FRMMOVIMENTACOESDIA`)

`UmovimentacoesDia.pas` (487). **27 acessos.** API `relatorios/movimentacoes-dia`. Migration 247.

## ✅ Corte 2 e o Imprimir (06/10/2026)

As quatro consultas foram refeitas pelas views do legado (definições lidas da produção e versionadas em
`docs/05-migration-engineering/capturas-vsql/view_get_areceberbx.sql`, `view_get_apagarbx.sql`, `view_get_pedidosrelat_recursos.sql`):
- **Recebidas** (`GET_ARECEBERBX`): só a baixa do título QUITADO, `INDR <> 'E'`, o parceiro por INNER JOIN, o `LEFT JOIN
  MOV_CONTAS_BANCARIAS` pelo lote (o lote com dois movimentos repete a baixa); o operador pelo LOGIN. A parte `ARECEBER_BX_SALDO` da view
  tem 0 linhas na produção (sem tabela no Apollo).
- **Pagas** (`GET_APAGARBX`): DISTINCT; valor do documento = VALOR + VENDOR − DESCONTO; histórico em maiúsculas sem ';'/quebras; LOGIN.
- **Pedidos** (`GET_PEDIDOSRELAT_RECURSOS`): os **pagamentos** do pedido (`CX_PEDIDOS`, sem DESCONTO/ACRESCIMO) juntados aos itens (não
  cancelado, tipo P); "Faturados" ou todos; data da venda ou do faturamento. ⚠️ O `rgFiltroFaturado` **reescreve** o where e apaga a
  loja e o operador: a seção mostra todas as lojas (aqui, as que o operador alcança) e ignora o operador. O `Imprimir` deduplica por
  operação + vendedor + pedido e monta o `cdsPgtos` (o 1º valor de cada pedido por operação); o `TOTAL_VEND` tem o SQL montado e nunca
  executado — sai vazio. (O corte 1 lia os itens da PEDIDOS — outra coisa.)
- **Histórico**: pelo dia, as lojas, o operador e os tipos marcados (`ClbTiposHistorico`, as TABELAs distintas com o rótulo do legado),
  em ordem de tabela; a linha sem loja não entra (o `CODEMPRESA IN`).

**Imprimir** (`movd- movimento diario.fr3`, 823): `DBDbusca`, `dbdPgtos`, `dbdRecebidos`, `dbdPagados`, `frxDBDatasetHist`, `dbdEmpresa`
e o PERIODO. O `SetaVisible` das seções marcadas não tem efeito no layout do cliente (nenhuma banda está invisível). RBAC: a opção
BTNIMPRIMIR (63 concessões na produção).

Cobertura: smoke §124.4 (as views, os quirks), §124.5 (o Imprimir e o 403); teste de renderização do 823.
