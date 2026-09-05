# Permissões a distribuir — 32 ações que o sistema novo tem e o antigo não separava

O sistema antigo não pedia permissão para estas ações: elas aconteciam como efeito de outro botão. No Apollo
cada uma tem a sua, o que é mais seguro — mas significa que **ninguém as tem hoje**, e alguém precisa
distribuí-las na tela *Controle de permissões* (`/cadastro/permissoes`).

A coluna **"já mexem nessa tela"** é o número de operadores que hoje têm alguma permissão no mesmo formulário —
é o candidato natural, mas a decisão é de quem conhece a operação. Nada aqui foi concedido automaticamente:
conceder por conta própria seria dar poder que ninguém tinha.

> **Duas saíram desta lista** depois de uma conferência a mais: *baixar* e *estornar baixa* de título já têm
> dono no sistema antigo — a baixa é uma tela própria lá (`FRMBAIXAAPAGAR`, 287 pessoas; `FRMBAIXAARECEBER`,
> 209), e o Apollo passou a respeitar isso. Não era permissão nova, era permissão no lugar errado.

## DINHEIRO E ESTOQUE

| tela | o que a ação faz | já mexem nessa tela |
|---|---|---|
| NOTAS DE SAIDA | Processar a nota: MOVE O ESTOQUE (entrada soma, saída baixa) | 63 |
| NOTAS DE SAIDA | Reverter o processamento: desfaz o movimento de estoque | 63 |
| BAIXA DE CARTOES | Estornar a baixa de cartão | 25 |
| AJUSTE DE ESTOQUE | Estornar um ajuste de estoque | 26 |
| NOTAS DE SAIDA | Estornar o faturamento: apaga os títulos gerados pela nota | 63 |
| CONTROLE CONTAS CORRENTES | Gravar lançamento em conta bancária | 40 |
| CONTROLE CONTAS CORRENTES | Excluir lançamento de conta bancária | 40 |

## CONTÁBIL E FISCAL

| tela | o que a ação faz | já mexem nessa tela |
|---|---|---|
| NOTAS DE SAIDA | Contabilizar: gera os lançamentos no diário contábil | 63 |
| NOTAS DE SAIDA | Estornar a contabilização | 63 |
| RAZAO | Visualizar o razão contábil | 19 |
| GERADOR SPED CONTRIBUICOES | Gerar o arquivo SPED PIS/COFINS | 5 |
| CONCILIACAO BANCARIA | Importar o arquivo OFX do banco | 26 |
| CONCILIACAO BANCARIA | Gravar a conciliação bancária | 26 |
| IMPRESSAO DE BOLETOS | Gerar o arquivo de remessa (CNAB) para o banco | 23 |

## COMPRAS

| tela | o que a ação faz | já mexem nessa tela |
|---|---|---|
| PEDIDO DE COMPRA | Gerar a nota fiscal a partir do pedido | 31 |
| PEDIDO DE COMPRA | Importar o XML da NF-e do fornecedor | 31 |
| PEDIDO DE COMPRA | Liberar o pedido para conferência | 31 |
| PEDIDO DE COMPRA | Reabrir pedido fechado | 31 |
| PEDIDO DE COMPRA | Vincular produto do fornecedor ao nosso cadastro | 31 |
| PEDIDO DE COMPRA | Liberar pedido acima do valor máximo permitido | 31 |
| COTACAO | Fechar a cotação | 19 |
| COTACAO | Reabrir cotação fechada | 19 |
| COTACAO | Apurar a cotação (definir vencedores) | 19 |
| COTACAO | Lançar os preços da cotação | 19 |

## ADMINISTRAÇÃO DO SISTEMA

| tela | o que a ação faz | já mexem nessa tela |
|---|---|---|
| PERFIL | Editar as permissões de um perfil | 19 |
| PERFIL | Atribuir perfis a operadores | 19 |
| EMPRESAS | Definir a senha de operação da empresa | 18 |
| ALIQUOTA | Excluir alíquota (no cliente NINGUÉM tem: a exclusão é bloqueada de propósito) | 17 |

## OPERAÇÃO DE LOJA

| tela | o que a ação faz | já mexem nessa tela |
|---|---|---|
| IMPRESSAO DE ETIQUETAS | Gravar a fila de etiquetas | 55 |
| IMPRESSAO DE ETIQUETAS | Excluir itens da fila de etiquetas | 55 |
| EXPORTAR DADOS PARA BALANCA | Gravar a configuração de exportação para a balança | 46 |
| INVENTARIO | Excluir itens do inventário | 19 |

## Como conceder

1. abra **Controle de permissões** (`/cadastro/permissoes`);
2. escolha o **operador** e a **empresa** (a permissão é por empresa — quem trabalha em duas precisa nas duas);
3. filtre pela tela e clique em **Conceder** na ação;
4. para dar tudo de uma tela de uma vez, use **Marcar tudo desta tela**;
5. para copiar o conjunto de alguém que já está certo, use **Copiar de outro operador** — ⚠️ isso **apaga** as
   permissões atuais do destino antes de copiar, igual ao sistema antigo.

Toda mudança fica registrada com data, ação, tela e quem fez.
