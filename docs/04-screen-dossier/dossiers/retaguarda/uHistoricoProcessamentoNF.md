# Histórico de processamento da NF — por que o custo do produto mudou

Migration **291**. Tabela viva sem destino, achada na varredura de tabelas de 22/09/2026.
Smoke §157.1 a §157.3. Contagens no Oracle de produção (só leitura), 23/09/2026.

## 1. Não é o kardex — é a outra pergunta

O kardex (`historico_prod`) responde **quanto** entrou e saiu de estoque. Esta tabela responde o que mais
ninguém responde no sistema: **por que o custo e o preço do produto mudaram**. Cada processamento de nota
grava a escada de custo inteira — custo, custo real, reposição, fiscal, CSI, markup, margens e lucro — e as
flags do que aquele processamento alterou.

| | |
|---|---:|
| linhas | **863.582** |
| em 2026 | 128.418 (64.209 pares) |
| produtos cobertos em 2026 | 5.794 |
| notas em 2026 | 6.517 |

## 2. ⚠️ Cada evento grava DUAS linhas, e ler só uma dá metade da história

`PRODUTO` é o estado **antes**; `PROCESSAMENTO` é o **depois**. Os totais por ano são idênticos porque é
sempre um par: 2026 tem 64.209 de cada, 2025 tem 90.101 de cada.

E o par não é decorativo. Nos **531.650 pares** completos:

| | |
|---|---:|
| mudaram o custo | **191.695 (36%)**, somando R$ 111.934,23 |
| mudaram o preço de venda | 20.330, somando R$ 585.336,06 |
| variação média de custo em 2026 | **18,29%** |

É o mesmo desenho de procedência do kardex (`saldo_anterior`/`saldo_novo`) e dos pares `_ORI` da reforma:
guardar só o resultado apaga a evidência de como se chegou nele.

O serviço devolve o par **já casado** e a variação calculada por degrau, para que nenhum consumidor refaça
a subtração e erre o sinal. Smoke §157.1.

## 3. As flags dizem por qual caminho o custo mudou

Na linha `PROCESSAMENTO` (a de `PRODUTO` as traz nulas, porque é o estado anterior): em 2026, **60.508 dos
64.209** processamentos têm `EXISTEALTERACAOCUSTO='S'` com alteração por decomposição, estoque e CFOP ao
mesmo tempo. Ou seja, **94% dos processamentos mexem no custo**, e as flags separam o motivo.

Cada caminho vira um booleano próprio na resposta — por decomposição, por estoque, por CFOP, venda online,
venda em lote —, não um campo de texto para o consumidor interpretar. Smoke §157.2.

## 4. ⚠️ Sem o par, a variação é DESCONHECIDA, não zero

Cerca de 2.000 das 863.582 linhas estão sem o estado anterior, porque a nota já não existe. Nessas, mostrar
zero afirmaria que nada mudou — e isso é diferente de "não sei". A resposta traz `tem_par: false` e o
resumo conta quantas estão assim. Smoke §157.3.

## 5. As chaves, e por que a FK é só para o produto

`codproduto` casa em **863.582 de 863.582** (100%); `codnf` em 861.582 e `codnfprod` em 861.566. Os ~2.000
órfãos são de notas que já não existem — e o histórico do **produto** vale mesmo sem a nota. Uma FK para a
nota rejeitaria essas linhas e levaria junto o histórico do produto, que é a mesma lição da chave
estrangeira de `clube_desconto` (mig 285).

## 6. ⚠️ A empresa vem da nota: 177.880 linhas iriam para a loja errada

A tabela não guarda empresa. Derivando da nota: **685.702 linhas na loja 1, 177.804 na loja 2 e 76 na 52**.
Sem a derivação, as 177.880 da segunda e da terceira cairiam na constante 1 — o padrão do Achado 4 da
`FILA-CONVERSAO`. Onde a nota já não existe, a loja 1 é a decisão, e o histórico do produto continua
valendo.
