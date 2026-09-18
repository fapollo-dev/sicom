# FRMMOTIVO — Motivos do ajuste de estoque

**10 acessos · 6 operadores** (último 04/08/2026). `Umotivo.pas` (38 linhas) + `UdmMotivos`. Migration **261**.
API `cadastro/motivos` (CRUD, exclusão lógica). Tela `/cadastro/motivos`. Smoke §139 (3 checks).

## 1. O que faz

CadMaster de um campo (DESCRIÇÃO) sobre a tabela **`MOTIVOS`** — a lista que a tela de ajuste de estoque
oferece no combo (`GET_MOTIVOS`, UajusteEstoque.pas:745).

## 2. ⚠️ O achado: o Apollo tinha a FK do ajuste na tabela ERRADA

No legado há **duas** tabelas de motivo com nome parecido e são coisas diferentes:

| tabela | linhas | quem aponta | tela |
|---|---:|---|---|
| `MOTIVOS` | 3 | `AJUSTE_ESTOQUE.CODMOTIVO` (**FK em USER_CONSTRAINTS**) | `FRMMOTIVO` (esta) |
| `MOTIVOS_OPERACAO` | 38 (códigos 1–301) | `SCRAP_ITEM.CODMOTIVOOP` (uCadSCRAP.pas:404) | `FRMMOTIVOSOPERACOES` |

A migration 059 modelou `ajuste_estoque.codmotivo REFERENCES motivos_operacao` e semeou 6 motivos
inventados ("ERRO DE CONTAGEM", "PRODUTO AVARIADO"…). A 171 precisou "criar o 999 em motivos_operacao
para a carga não quebrar" — o sintoma: o 999 sempre existiu, em `MOTIVOS`, como **INVENTARIO ROTATIVO**.

Conteúdo real de `MOTIVOS` (produção, 18/09/2026): **999 INVENTARIO ROTATIVO** · **1 PERCA INDENTIFICADA**
(sic) · 41 APOLLO SISTEMAS (`INDR='E'`, excluído em 10/03/2025). Em 2026, `AJUSTE_ESTOQUE` usa 999 em
679 ajustes e 1 em 297 — só os dois vivos.

## 3. O que a 261 faz

1. Cria `motivos` com os dois vivos do legado, com o nome do legado (a sequência de novos nasce em 1000).
2. Ajustes já gravados no destino com código fora de `motivos` têm o código copiado de `motivos_operacao`
   (descrição preservada) para a FK fechar.
3. **Reaponta a FK**: solta a que ia para `motivos_operacao`, cria `fk_ajuste_estoque_motivo → motivos`.
4. View `get_motivos` (a que a tela do legado lê).
5. `ajuste-estoque.service` valida e exibe o motivo em `motivos`; o combo da tela de ajuste lê
   `cadastro/motivos`. `motivos_operacao` segue intacta — é do scrap.

Exclusão é **lógica** (`INDR='E'`), como o legado fez com o 41: o motivo sai do combo, ajustes antigos
continuam apontando para ele, e um ajuste novo com motivo excluído é recusado (422).

## 4. Carga

`motivos` entrou na f0 do `plano-tabelas.json`. A carga de `ajuste_estoque.codmotivo` passa a fechar
contra a tabela certa sem muleta.
