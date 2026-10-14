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

## A auditoria controle a controle do URelVendas.dfm — o rel 01 (14/10/2026)

O painel de filtros do hub (`URelVendas.dfm`, 3.243 linhas) revisto contra a tela do rel 01 do Apollo, com a prova nas 1.974.532 linhas
de VENDAS de 2026. A tela já tinha período/hora, canceladas, promoção, produto, fornecedor, custo de reposição, as famílias (F3 em
multisseleção) e o filtro de produtos; a API já aceitava `descontos`, `exibirFilhos`, `agruparEmpresas`, cupom/pedido/PDV/alíquota — a
tela não os mostrava. Convertido:

- ⛔→✅ Na tela, em "Mais filtros": **Descontos** (rgDescontos SIM/NÃO/Todos), **Exibir produtos filhos** (`CkbExibirProdutosFilhos`),
  **Desagrupar Empresas** (`chkAgruparEmpresas`, visível no rel 01), **Nro Cupom / Nro Pedido / Nro PDV / Aliquota** (`cbAliq`: IST, NTB,
  STB, T01..T20).
- ⛔→✅ **PIS** (`RGpis` :911): "Com PIS" = `P.IDPISCOFINS > 0 AND CPC.ALIQ_PIS_SAI > 0`, "Sem PIS" = `COALESCE(P.IDPISCOFINS,0) = 0`
  (1.809.758 das linhas de 2026 têm PIS = 'S').
- ⛔→✅ **Desconto Scanntech** (`CkbDescontoScanntech` :1234): o legado filtra `V.IDPROMOCAO IS NOT NULL` — a venda com a promoção
  identificada (6.977 linhas em 2026; DESC_SCANNTECH > 0 em 6.961).
- ⛔→✅ **Cliente / Vendedor / Operador** (`edtCliente` :980 = `UPPER(V.RAZAO)` ou a razão do parceiro; `edtVendedor` :1111 =
  `UPPER(VE.RAZAO)`; `edtOperador` :1120 = `O.LOGIN`): filtros de texto "contém", como o `%` do legado.
- ⛔→✅ **Lucro** (`gpbLucro` :834): Campo (Lucro Bruto = TOTAL_VENDA − TOTAL_CUSTO; Lucro Bruto % pela config
  `RELATORIO_VENDAS_LUCRO_BRUTO`), operação (=, <>, >, <, >=, <=, ENTRE) e valor — o WHERE externo do legado; aqui sobre as linhas
  calculadas (depois do teto de 20.000).

Com prova, sem código: **Prom. Acumulativa** (`chkPromAcumulativa`: IDPROACUMULATIVA nulo nas 1,97 M linhas de 2026; PROMOCAO_ACUMULATIVA
com 6 linhas), **Atacarejo** (IDMULTIPRECOATACAREJO nulo em 100%), **Filtrar por comissões / Departamento a excluir da comissão**
(EDTDPTOEXC — 40 operadores; COMISSAO > 0 em 0 linhas de 2026 — os relatórios de comissão 12/14/17/24/51 não têm dado), **Mostrar
Composição** (sem fonte de prova — fica para o corte do rel 01 com composição), **Tipo Consulta** Pedidos / Vendas e NF / NF e o
**Filtro Auxiliar** (campo/operação sobre o resultado): outras trilhas do hub, fora deste corte; **EDTCFOP** (27 operadores) não existe
no fonte de 2020 — binário novo.

Os relatórios que o hub do Apollo ainda não lista (e os layouts `ven2_*` da produção): 04 (sangrias/suprimentos dos caixas — PDV), 05
(liberações do PDV), 12/14/17/24/51 (comissões — sem dado), 20 (produtos vendidos CMP), 23 (rebaixa — REL_PRODUTO_REBAIXA vazia), 27
(promoção acumulativa — 0), 41 (categoria), 44 (devolução por operador), 48 (CresceVendas — CRESCE_VENDAS vazia), 52-59 (binário novo).

Smoke §317.

