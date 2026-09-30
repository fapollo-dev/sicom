# NF — as impressões do menu da tela (`uNF.pas:13528-13635`)

O menu da NF (`PopupMenu` do uNF.dfm:22299-22503) tem onze impressões. Até 30/09/2026 o Apollo não tinha nenhuma: o rodapé "NF-e"
mostrava "Imprimir" desabilitado e o menu não existia. Os modelos estão vivos — a RELATORIOS da produção tem versão PERSONALIZADA de
todas as conferências, e a de preço completa foi editada pelo cliente em **28/07/2025**, um mês depois da carga dos arquivos.

## Corte 1 — as conferências e a lista de conferência (30/09/2026)

| Menu do legado | Modelo (RELATORIOS) | Datasets |
|---|---|---|
| Imprimir conferencia de preço simplificada (:13584) | `conf - conferencia de preco simples nf.fr3` | dbdNota, dbdItensNota **por DESCRICAO** |
| Imprimir conferencia de preço completa (:13576) | `conf - conferencia de preco nf.fr3` | dbdNota, dbdItensNota |
| Imprimir conferencia de Impostos (:13541) | `conf - conferencia de impostos nf.fr3` | dbdNota, dbdItensNota |
| Imprimir conferência ICMS ST Recolher (:13593) | `conf - conferencia de icms st recolher.fr3` | frxDBDatasetICMSRecolher (`aqqICMSTRecolher`) |
| Imprimir conferencia de Devolução de Compra (:13549) | `conf - conferencia de pedido devolucao compra.fr3` | dbdNota, dbeEmpresa, frxDBRelPedDevCompra (`sqqRelPedDevCompra`) |
| Imprimir Lista de Conferência (:13631) | `Rel_ListaConferenciaNF.fr3` | Nota, Empresa, Itens (`ImprimeListadeConferencia`, uConferenciaNota.pas:993) |

E o botão **"Conf. Preço"** da grade do Manifesto (`cxbtnConfpr`, UManifestoDFe.pas:821) — a simplificada, habilitada só na nota
cadastrada (`CADASTRADA = 'SIM'`, :950).

**API:** `GET fiscal/nf/:id/impressao/:relatorio` (FRMNF) e `GET fiscal/nf/:id/conferencia-preco-manifesto` (FRMMANIFESTODFE). O
servidor monta os datasets e devolve o .fr3 da RELATORIOS (PERSONALIZADO antes do DEFAULT, `shared/relatorios/modelo-fr3.ts`); o
navegador desenha com o motor do FastReport (`apps/web/src/shared/fr3`, antes só das etiquetas).

**Os datasets, como o legado:**
- `dbdNota` = o `qryNota` (udmNF.dfm:7): a NF com TITULAR_* (parceiro + endereço), TRANSP_*, DESCCFOP, PRECO_CUSTO, DEVOLUCAO.
- `dbdItensNota` = o `qryItensNota` que **a produção executa** — capturado do V$SQL em 30/09/2026 (o fonte de 2020 não tem o campo
  **ESTOQUE** que a conferência completa personalizada imprime: é `GET_ESTOQUE_TOTAL.TOTAL` do produto na loja — loja + depósito +
  almoxarifado + trocas). Mais os campos internos que o `CalcValorNota` (udmNF.pas:3928) calcula na abertura, porque o relatório os
  imprime: **TEMPVRCUSTO** (custo líquido, via `CalcValorCusto`), **VRCUSTOFINALC**, **VRDESCONTO** (o desconto unitário; na entrada
  com o total dos produtos batendo com a nota em 0,02, o % vem do desconto da nota — :4150), **VRIPI**, **VRTOTALPRODUTOS**, TOTALPRODS,
  QTDETOTAL — ramo de entrada e de saída (:4267).
- `dbeEmpresa` = a empresa logada, **sem** senhas, tokens, certificados e CSC.
- Os tipos: numeric/bigint do PG viram número (o `%2.2n` do .fr3 só formata número); CST é NUMBER no Oracle e sai como número (0, 60).

**Mensagens do legado:** ICMS ST sem item de MVA → "Não existem registros a serem exibidos."; devolução sem pedido → "Nota Fiscal
sem pedido de devolução associado."; pedido sem itens → "Sem registro a serem exibidos.".

**O motor .fr3 ganhou** vários datasets (a MasterData percorre o do seu `DataSet`, "frmNF.dbdItensNota" sem o prefixo; os outros
ficam no 1º registro), as agregadas `SUM`/`AVG`/`MIN`/`MAX`/`COUNT(Banda)` sobre as linhas impressas da banda e `[TotalPages#]` (duas
passadas). Teste com os 6 modelos da produção e o pedido de devolução 10244 da produção (7 itens, 779,07 / 140,61 / 38 devolvidos).

**Divergências conscientes:**
- A ordem dos itens nas outras conferências é CODNFPROD; no legado é a do índice corrente do cdsItensNota — se a simplificada foi
  impressa antes na mesma sessão, o `IndexFieldNames := 'DESCRICAO'` fica e as seguintes saem por descrição.
- `CodigoCFOPDeDevolucao` (FuncoesApollo, fora do repositório) é o `CFOP.DEVOLUCAO = 'S'` da nota.
- O `VRVENDAFINAL` do item (campo interno que só o diálogo do item preenche) é 0 na abertura — como no dataset do legado.

**Smoke:** 3 checks (as 6 impressões, as mensagens, RBAC, loja; o ICMS ST com indexador de MVA; a devolução com o fator).

## Pendente (próximos cortes)

- **Espelho da nota** (`uRptEspelhoNF.fr3`, Ctrl+N, :14616) e **Imprimir nota** (`mniImprimirNota`, Ctrl+I, :14711 — o layout
  escolhido em `mniLayoutDaNota`; `uRptNF.fr3` e variantes PERSONALIZADAS) — mesmos datasets + `frxDBDatasetAnimal`.
- **DANFE** (`ImprimirDANFE1`, ACBr `DANFeRetrato.fr3` PERSONALIZADO) e **Carta de correção** (`CartaCorrecao.fr3`, dataset
  `sqqCartaCorrecao`) — os datasets do ACBr (Identificacao, Emitente, Destinatario, Dados Produtos, …) precisam de recon próprio.
- A Conferência de Nota (`TfrmConferenciaNota`) tem a mesma lista de conferência (itens marcados da grade, por descrição) e a
  "Conferência por operadores" (`ConferenciaNFOperadores.fr3`).
