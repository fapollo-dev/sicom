# FRMCADAGENDALIMITACAOVENDA — Agenda de limitação de venda

**51 acessos · 6 operadores.** `uCadAgendaLimitacaoVenda.pas` (310 linhas) + `uDMCadAgendaLimitacaoVenda`.
Migration **235**. API `cadastro/agenda-limitacao`. Tela `/cadastro/agenda-limitacao`.

## 1. O que a tela faz

Define **quanto de um produto cada cliente pode levar** num período e num conjunto de lojas. É o que segura a
gôndola no dia de promoção forte, quando o preço atrai quem compra para revender.

## 2. Para que o cliente usa

| medida | valor |
|---|---|
| agendas | **11** |
| itens | **92** (a maior com 41 produtos) |
| período | 21/12/2020 → **29/09/2023** |
| situação | **todas fechadas** (todas já passaram) |

Das 11, **8 têm o nome ligado ao "DIA D"** (`DIA D`, `LIMITACAO DIA D`, `LIMITAÇOES DIA D`, `DIA D 29/09`) e as
outras limitam um item que sumiu da praça (`HEINEKEN`, `LEITE PORTO ALEGRE 1L`).

**Não é mecanismo morto — é sazonal.** Só se usa quando há promoção que atrai atravessador, e por isso a
última é de 2023. Migrado por isso, e não apesar disso.

## 3. As travas do legado

| trava | onde | o que evita |
|---|---|---|
| **agenda fechada não se altera** | `:147` — *"Agenda Fechada. Impossível alterar."* | mexer numa limitação que já valeu, mudando o histórico do que foi aplicado |
| **sem lojas participantes não se adiciona item** | `:136` — *"Selecione as Empresas participantes"* | uma limitação sem loja não limita nada |
| **o produto não entra duas vezes** | `:97` — o pesquisador monta `NOT (CODIGO IN (...))` | dois limites para o mesmo produto, e o PDV escolhendo um deles |
| **só produto ATIVO e que não seja item de composição** | `:104` — `ATIVO='S' AND IMPRIMIRCOMP='N'` | limitar um insumo que nem é vendido sozinho |

## 4. Os dois detalhes que enganam

⚠️ **`AGENDA_PRODUTO_ITEM.CODGRUPO` é o grupo de PREÇO, não o de produto.** O legado o preenche com
`COD_GRUPOPRECO` vindo do pesquisador (`:119`). Confundir os dois limitaria a família errada — e a família de
preço é justamente o que agrupa as variações do mesmo item (a cerveja de 350ml e a de 600ml).

⚠️ **`ATUALIZACAO_GRUPO='S'` estende a limitação à família de preço inteira**, não só ao produto escolhido. É
o que permite dizer "6 cervejas por cliente" sem cadastrar cada embalagem. Só **2 dos 92 itens** do cliente
usam isso.

## 5. Colunas que faltavam no destino

- as duas tabelas (`agenda_produto`, `agenda_produto_item`) — nenhuma existia;
- `produtos.imprimircomp` — o filtro do pesquisador. Medido: **46.906** com `'N'`, **804 nulos** e apenas
  **2** com `'S'`. O filtro é real mas raso, e o nulo precisa passar, senão 804 produtos sumiriam da lista.

⚠️ **não existe cadastro de grupo de preço** no legado: `CODGRUPOPRECO` é só um número que agrupa produtos
(9.554 dos 47.712 o têm). A tela mostra quantos produtos compartilham o grupo, que é o que o operador precisa
saber antes de marcar o flag.
