# FRMPRECIFICACAONFBRUTA — Precificação pela nota

**11 acessos · 4 operadores** (último em 17/06/2026). `uPrecificacaoNFBruta.pas` + `uDMPrecificacaoNFBruta`.
Migration **273**. API `GET precificacao/nf-bruta` e `POST precificacao/nf-bruta/aplicar`. Tela
`/precificacao/nf-bruta`. Smoke §151 (3 checks). Fecha o item 89 da fila.

## 1. O que faz

A irmã enxuta da precificação por NF (mig 211-212). Lista os itens de **nota de entrada** cruzando
`NF_PROD` × `MULTI_PRECO` × `PRODUTOS`: preço atual, custo de reposição, PMZ, último custo, preço
**sugerido** e o **markup fixo** do produto. O botão Aplicar, para cada item marcado cujo sugerido difere
do atual (`InsereAjustePreco`, `uPrecificacaoNFBruta.pas:747`):

1. insere `LOTEPRECO` com o **preço sugerido** (`PROCESSADO='N'`, obs
   `'REFERENTE A PRECIFICAÇÃO NOTA FISCAL DE NRO. <nro>'`, markup = a margem digitada) — **não muda o
   preço na hora**, como toda a família de precificação;
2. faz `UPDATE MULTI_PRECO SET MARKUPFIXO = <margem digitada>`.

## 2. ⚠️ Dois defeitos do legado, os dois com consequência

**Transação por item.** `StartTransaction` e `Commit` estão **dentro do laço** (linhas 761-780): cada item
é uma transação própria. Falhando o quinto, os quatro primeiros já estão gravados e o lote sai pela
metade, sem aviso. Aqui é **uma transação para o lote inteiro** — o smoke prova com um lote onde o
segundo item é um produto inexistente: nada é gravado.

**A empresa do lote e a do markup são diferentes.** O `INSERT INTO LOTEPRECO` usa `IDEMPRESA` **da nota**;
o `UPDATE MULTI_PRECO` logo abaixo usa `EmpresaCODEMPRESA`, a **empresa logada**. Precificando uma nota de
outra loja, o preço vai para a loja da nota e o markup fixo para a loja de quem está na tela. Aqui as duas
seguem o tenant, e nota de outra empresa nem aparece na consulta.

## 3. O que o dado diz (produção, 18/09/2026)

| | |
|---|---:|
| `LOTEPRECO` | **96.863 linhas**, a última de 17/09/2026 |
| por origem | `'P'` **29.008** (5.952 em 2026) · **nula 67.855** |
| `MULTI_PRECO` | 203.640 linhas — **146.387 com MARKUPFIXO** (140.135 > 0) |
| `LOTEPRECO.CODPEDCOMP` | **0 de 96.863** — coluna morta, não replicada |

As 67.855 linhas com origem nula são desta tela: o `INSERT` do legado lista 8 colunas e **`ORIGEM` não
está entre elas**. Aqui o lote nasce com `origem = 'PRECIFICACAO_NF_BRUTA'` e passa a ser rastreável no
relatório de preços alterados (mig 244).

## 4. Fora

A impressão (.fr3) e a fila de etiquetas da tela — o épico Etiquetas já cobre a impressão.
