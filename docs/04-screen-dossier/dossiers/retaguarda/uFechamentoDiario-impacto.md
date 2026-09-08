# FECHAMENTO DIÁRIO — análise de impacto da remoção (2026-09-08)

Pedido do usuário: *"analise a fechamento diária o que interferiria caso removêssemos"*. Medido em **produção**,
não na homologação — o veredicto anterior (`uFechamentoDiario.md`) foi feito sobre a cópia defasada e precisa ser
corrigido antes de qualquer coisa.

## 0. Correção do veredicto anterior

O dossiê antigo dizia que "o fechamento parou em fev/2024". **Errado** — era a homologação, que parou de ser
copiada nessa data. Em produção:

| | |
|---|---|
| linhas em `FECHAMENTO` | 5.054 (**3.346 com `STATUS='F'`**, 1.708 em aberto) |
| dias fechados em 2025 | 639 |
| dias fechados em 2026 | 271 · **último em 31/07/2026** |
| acessos à tela | 740 · último em **01/09/2026** |

⇒ **A tela é usada e o fechamento acontece.** O usuário já havia dito: não é tela abandonada, é tela que não dá
problema.

## 1. Quem depende, e o peso de cada um

### (a) SINTEGRA — o único gate DURO, mas sobre obrigação quase morta

`Usintegra.pas:845-862`: antes de gerar o arquivo, lista os dias do período sem `STATUS='F'` e **lança exceção**
— *"Existem dias em aberto no fechamento diario"*. Sem nenhuma linha, a mensagem é *"Periodo total em aberto no
FECHAMENTO DIARIO, verifique."*. É bloqueio real.

**Mas o Sintegra praticamente não é mais emitido**: `FRMSINTEGRA` tem **10 acessos**, último em 25/05/2026,
contra `FRMSPEDFISCAL` com **896** e último em 04/09/2026 — a EFD substituiu o Sintegra. O gate é duro, mas
protege uma porta por onde quase ninguém passa.

### (b) TRON / exportar vendas por Redução Z — gate sobre rotina sem dado

`uTron.pas:1311` chama `PeriodoFechado`, que lê `FECHAMENTO` (`:1129-1150`). Só que a rotina exporta a partir de
`REDUCAOZ`, que tem **0 linhas** em produção. Gate real, rotina vazia.

### (c) TRON / integração contábil — **NÃO depende de `FECHAMENTO`**

Esta é a parte que mais preocupava, e a resposta é tranquilizadora. As demais rotinas do TRON usam **outro**
gate: `TIntegracaoContabil.PeriodoFechado` (`UIntegracaoContabil.pas:282-294`), que compara a data com
`CONFIG_INTEGRACAO_CONTABIL.CHAVEAMENTO_PERIODO` — e esse campo está **NULL** em produção, ou seja o gate nem
bloqueia hoje. **Nenhuma linha de `FECHAMENTO` é lida por esse caminho.**

### (d) A própria tela — o efeito colateral que MOVE DADO

`VerificaNFs` (`uFechamentoDiario.pas:770-831`): ao fechar um dia, as NFs ainda não processadas têm a
**`DTCONTABIL` empurrada para o próximo dia aberto**. Em produção, notas com data contábil diferente da emissão:
**7.893 (2024) · 7.797 (2025) · 5.176 (2026)**.

⚠️ Este é o ponto que exige cuidado: não é gate, é **escrita**. A data contábil decide em que período a nota cai
na apuração e no contábil. Hoje há 33 notas de 2026 não processadas — são elas que seriam empurradas no próximo
fechamento.

## 2. Resposta objetiva: o que interfere se removermos

| se removermos | consequência |
|---|---|
| integração contábil (TRON) | **nada** — usa outro gate, e ele está inativo |
| SPED Fiscal / EFD | **nada** — não lê `FECHAMENTO` |
| Sintegra | perde o bloqueio que impede gerar com dia em aberto — mas são 10 acessos em um ano |
| NFs não processadas | **perde-se o empurrão automático da `DTCONTABIL`**: a nota fica com a data contábil original, e é isso que muda período de apuração |
| processo | some o registro de "este dia está conferido" — 271 dias marcados em 2026, dois operadores fazendo isso mês a mês |

## 3. Recomendação

**Não remover, mas também não migrar por inteiro agora.** O que tem valor é pequeno e localizado:

1. **`VerificaNFs` é a única regra com efeito em dinheiro** — vale portar junto de quem já mexe em `DTCONTABIL`
   (o processamento da NF), com ou sem a tela;
2. **A marcação do dia** (`FECHAMENTO`, 4 colunas) é barata de manter: a tabela já entra na carga e uma tela
   simples de marcar/desmarcar preserva o processo de conferência que duas pessoas fazem hoje;
3. **O gate do Sintegra** só faz sentido se o cliente ainda for emitir Sintegra — pergunta para ele, não decisão
   nossa.

⚠️ **Quirk a não copiar**, registrado no dossiê original e confirmado: o fecha-mês do legado tem `DiaProximo`
não inicializado, que grava `30/12/1899` — 0 ocorrências no golden, mas o bug está lá.
