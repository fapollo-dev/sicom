# Relatório de vendas (FRMRELVENDAS) — a impressão no layout do cliente

O hub legado (`URelVendas.pas`) lista os arquivos `Relatorios\ven2_*.*` no combo (o número no nome é o `TVendas.GetSQL(n)`; variantes
com o mesmo número usam a mesma consulta) e o "Imprimir" carrega o escolhido com o `dbdConsulta` e as variáveis do período
(`:500-735`). A produção tem **75 layouts `ven2_*` PERSONALIZADOS** na RELATORIOS (42 com GroupHeader, 5 com gráfico, 2 subrelatórios,
1 tabela cruzada).

## Corte 1 — o rel 01, "Produtos vendidos no período" (01/10/2026)

- `GET relatorios/vendas/layouts/01` — os `ven2_01 - *` da RELATORIOS (PERSONALIZADO antes do DEFAULT, na ordem do nome), cada um com
  os campos do `dbdConsulta` que ele usa e o Apollo **não** fornece (`shared/relatorios/campos-fr3.ts` lê DataField, expressões e o
  script sem os comentários — os layouts do hub têm blocos `{ }` inteiros com campos que a consulta não tem).
- `POST relatorios/vendas/produtos-vendidos/impressao` — o filtro da tela + o layout: o `dbdConsulta` nos nomes do **TEMP do GetSQL(1)**
  (`uVendas.pas:1814-1866`: TOTAL_VENDA líquido, MARGEM markup, RENTABILIDADE markdown, DEPTO/GRUPO/SUBGRUPO/SECAO e os códigos,
  VRVENDA_UNI = bruto ÷ qtde; os descontos que o Apollo não separa — Scanntech, acumulativo, funcionário, atacarejo, gestão, CresceVendas —
  saem 0, como no dado do cliente); as variáveis DtInicial/DtFinal/HrInicial/HrFinal/Empresa/AGRUPA_EMPRESA/CUSTO_REP; o rodapé da
  grade (`uRelVendasGrid1.pas:343-354`, FooterSummaryValues 0..5 → TOTAL_CUSTO, TOTAL_VENDA, LUCRO_BRUTO, LUCRO_BRUTO_PERC = a
  rentabilidade, MARGEM_BRUTA = a margem, TOTAL_ACRES); os memos SysMemo10/SysMemo15 pela config de lucro bruto (`:537-570`).
- Sem venda: "Não há venda no filtro informado. Verifique!" (`:520`). Acima de 20.000 produtos (o teto da consulta do Apollo) a
  impressão recusa e pede um filtro menor — o total impresso não pode cobrir só parte das linhas.
- **Fora, sem procedência:** o layout **"Resumo de Vendas"** do cliente imprime `ST_QUANTIDADE`, `ST_TOTAL_VENDA`, `TD_QUANTIDADE` e
  `TD_TOTAL_VENDA`, que a consulta de 2020 não tem e que não estão no cache de SQL da produção (V$SQL; sem AWR). A tela lista o layout
  como "fora" com os campos que faltam, em vez de imprimi-lo com colunas em branco.
- Web: o seletor "Layout de impressão" e o "Imprimir" na tela do rel 01. Smoke (no bloco §275).

## Pendente

Os outros números do hub (02, 03, 06, 09-11/18, 13, 15/16, 19, 21-50…): cada um precisa do mapa da consulta do Apollo para os nomes
do `GetSQL(n)` e das variáveis específicas (02/39: MARGEM; 07: PRIMEIRA/ULTIMA_VENDA_DIA; 28/48: EXPANDE; 03 com cliente agrupado).
