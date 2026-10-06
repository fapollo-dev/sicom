# FATURAMENTO DA NOTA (`FRMFATURAMENTO2`)

`uFaturamento2.pas` (1.148). **34 acessos.** API `compras/faturamento`. Migration 246. A regra está no cabeçalho do serviço.

## ✅ O Imprimir (06/10/2026)

- **Documentos faturados** (o rádio "baixados"): `BuscaDocsFaturados` — as parcelas LIBERADAS das notas do tipo na loja (sem exigir
  PROC), em ordem de lote, título, chegada e nota, com o CODLOTEFAT do `cdsDoctosFaturadosCalcFields` ('FAT-P'/'FAT-R' + o lote em 5
  dígitos; LOTE_FATURAMENTO tem 0 linhas na produção e não existe no Apollo → "00000") → `fat_Relatorio_de_faturamento_por_lotes.fr3`
  (754) ou `..._por_cliente.fr3` (753), o `cbbRelatorio`, no `dbdFaturamento`.
- **Documentos a faturar**: `BuscaDocsAFaturar` — as NOTAS processadas com parcela não liberada (`dbdNota`) e, aninhadas em cada uma, TODAS
  as parcelas da nota (`qryFaturamentosNota`, a liberada também) com o STATUS do `cdsDoctosAFaturarCalcFields`: LIB, ATR, VHJ, AGD →
  `fat_Relatorio_de_status_de_faturamento.fr3` (757).
- RBAC: o BTNIMPRIMIR da tela (a opção que a produção concede). O legado imprime mesmo sem linhas.

Smoke §123.4; teste de renderização do 757.
