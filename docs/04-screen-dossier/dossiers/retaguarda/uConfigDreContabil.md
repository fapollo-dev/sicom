# FRMCONFIGDRECONTABIL — Configurador do DRE contábil

**51 acessos · 3 operadores.** `UFrmCadConfigDREContabil.pas` (756 linhas) + `UConfigDREContabil`.
Migration **234**. API `cadastro/dre-estrutura`. Tela `/cadastro/dre-estrutura`.

## 1. O que é, e por que agora

É o **editor da árvore do DRE** — o corte-2 que a migration 047 deixou declarado por escrito:

> *"O editor da estrutura é corte-2 (aqui a estrutura é semeada, fiel ao modelo)."*

As tabelas (`dre_estrutura`, `dre_conta`) e o motor de cálculo existem desde a 047; entra aqui a tela. E é ela
que define **como o DRE é somado**: mexer aqui muda todo relatório de resultado que o contador lê.

## 2. O que o cliente tem

| medida | valor |
|---|---|
| linhas em `CONFIG_DRE_CONTABIL` | **98**, todas ativas |
| níveis | 6 raízes · 14 no nível 2 · 78 no nível 3 |
| tipos de cálculo | `P` **78** · `F` **19** · `E` **1** |
| classes | `A` **78** · `S` **20** |
| vínculos conta→linha (`VINCULO_PLC_CFG_DRE`) | **10.439** |

⚠️ **A classe é consequência do tipo, e o dado não deixa dúvida**: as 78 linhas `P` são todas `A` (analíticas,
recebem conta) e as 20 sintéticas (19 `F` + 1 `E`) são todas `S`. A correlação é perfeita, então a tela deriva
a classe do tipo em vez de deixar escolher — escolher livre criaria uma linha analítica que nunca recebe
conta, ou uma sintética que soma duas vezes.

⚠️ Existe **uma única expressão**: `<01>+<03>+<04>` no LUCRO BRUTO COMERCIAL. É a sintaxe que o avaliador
aritmético do `dre.service` já entende.

## 3. As travas, e o que cada uma evita

Todas saem do que o motor de cálculo precisa para não mentir:

| trava | o que evita |
|---|---|
| não se apaga linha **com filha** | o roll-up some com o ramo inteiro, e o DRE passa a fechar num número menor sem nada indicando o porquê |
| não se apaga linha **com conta vinculada** | idem — o valor daquelas contas simplesmente sai do relatório |
| não se apaga linha **referenciada** por uma expressão | a expressão passaria a somar um código que não existe |
| a expressão não referencia **a si mesma** nem código inexistente | o avaliador do `dre.service` é recursivo e giraria sem parar |
| o filho está sempre **um nível abaixo** do pai | é o que faz o roll-up recursivo terminar |
| só linha **analítica** recebe conta | vincular a uma sintética duplicaria o valor: ela já soma as filhas |
| ⚠️ **uma conta só pode estar em uma linha** | senão ela entra **duas vezes** no DRE e o resultado fecha errado sem nada acusando. O legado não trava; aqui o índice único `ux_dre_conta_conta` trava |
| trocar o tipo para sintético **solta as contas** | deixá-las penduradas numa linha que já soma as filhas dobraria o valor |

## 4. O vínculo em lote (25/09/2026)

A tela do legado tem duas grades — **disponíveis** × **vinculadas** —, o filtro e quatro botões (Vincular, Vincular todos,
Desvincular, Desvincular todos). Agora o Apollo também: o botão **Contas** da linha analítica abre o painel; as disponíveis vêm de
`GET cadastro/dre-estrutura/:cod/disponiveis?filtro=` com o critério do `QryPlanoContas` (analíticas `TIPO 'E'`/`CLASSE 'A'` desta
linha ou sem linha — a de outra linha não aparece, o que casa com a trava de uma conta numa linha só) e o filtro do `BtnFiltrarClick`
(código expandido/reduzido começando com o texto, descrição contendo); **Gravar vínculos** manda o conjunto (`POST contas`, que agora
aceita a lista vazia — o "Desvincular todos"). Smoke §111.4b.
