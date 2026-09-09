# RELATÓRIOS DE CAIXA (`FRMRELCAIXA`) — recon e corte-1

`URelCaixa.pas` (437 linhas) + as cinco classes de `UCaixa.pas` (710). **505 acessos, 11 operadores, o último
em 08/09/2026** — a tela está viva.

## 1. O que a tela é

Cinco modelos num combo (`CmbTipoRelatorio`, `URelCaixa.dfm:118`), cada um uma classe:

| # | modelo | classe | corte-1 |
|---|---|---|---|
| 1 | Divergências de caixa | `TDivergenciasCaixa` | ✅ |
| 2 | Voucher | `TVoucher` | — |
| 3 | Apuração do caixa | `TApuracaoCaixa` | — |
| 4 | Caixas abertos | `TCaixasAbertos` | ✅ |
| 5 | Relatório de pedidos | `TCaixaPedidos` | — (falta `PEDIDOS`/`PEDIDO_ECOMMERCE`) |

## 2. ⚠️ O achado é maior que a tela

Fui olhar as tabelas para montar as divergências e a carga estava descartando quase tudo:

| tabela | colunas no legado | tínhamos | **perdidas** | linhas |
|---|---|---|---|---|
| `CAIXA_PDV` | 33 | 8 | **25** | 26.907 |
| `CX_VENDAS` | 36 | 21 | **15** | 3.352.924 |

E as 25 de `CAIXA_PDV` são **exatamente as de dinheiro**: `SANGRIA`, `TROCO`, `FUNDOCAIXA`, `DESCONTOS`,
`ACRESCIMOS`, `CANCELAMENTOS`, `CONTRAVALE`, `VOUCHER`, `RECARGA`, `CORRESPONDENTE` e os `INI_*` (o que o
operador declarou na abertura). **Sem elas não existe conferência de caixa** — é a declaração do PDV que se
compara com o apurado.

Em `CX_VENDAS` a que faz falta imediata é **`TESOURARIA`**: é ela que diz se o caixa já foi recolhido.

Faltava também **`PLC.TPCONTA`**, e essa é sutil: a apuração só soma os lançamentos de `CAIXA` cujo centro de
custo é conta de caixa (`TPCONTA = 0` — 47 dos 388 PLCs do cliente). Sem a coluna, a apuração somaria despesa
junto com recebimento e acusaria divergência **para mais** em toda linha.

## 3. Divergências — a conferência clássica

`TDivergenciasCaixa.GetSQL` (`UCaixa.pas:96`) compara, por (empresa, PDV, operador, dia, recurso):

- **o que o PDV registrou**: `CX_VENDAS` com `STATUS='F'`, somando `VALOR − TROCO`, **excluindo** desconto,
  acréscimo, sangria e suprimento — as quatro não são recebimento;
- **o que entrou no caixa**: `CAIXA` com `PLC.TPCONTA = 0` e `CODPDV` não nulo;
- **divergência = caixa − PDV**, e a linha só aparece se um dos lados for diferente de zero.

⚠️ **as divergências NÃO filtram por tesouraria** — o caixa já recolhido continua tendo de fechar. Só o
relatório de caixas abertos usa esse filtro. As duas telas têm escopos diferentes de propósito.

⚠️ **ajuste inócuo, medido**: a consulta soma ao lado do caixa um valor de `HIST_DEVOLUCAO` (devolução tipo
'D', só no DINHEIRO, `:141`). Em produção a tabela tem **ZERO linhas** — a regra ficou registrada no serviço e
a tabela não foi criada.

## 4. Caixas abertos

`TCaixasAbertos.GetSQL` (`:634`): as sessões do período com `TESOURARIA <> 'S'`, com hora de entrada e saída
de `CAIXA_PDV`. É a lista do caixa que ficou em aberto.

## 5. O que fica

Voucher e apuração do caixa (que agora **podem** ser feitos, porque as 25 colunas de `CAIXA_PDV` chegaram) e o
relatório de pedidos, que depende de `PEDIDOS` e `PEDIDO_ECOMMERCE` — duas tabelas que o Apollo ainda não tem.

## 6. Nota sobre `FRMMANCADCARTAOBOAVISTA` (560 acessos)

Estava acima desta na fila por acessos, e foi **pulada com procedência**: não existe unit no repositório
clonado — nenhum arquivo, nenhuma referência a "BoaVista" em lugar nenhum do fonte. Sem fonte não há cópia
fiel. A tela também parou: último acesso em **20/05/2026**, contra 08/09 desta. Se o cliente ainda precisar
dela, é pedir o fonte.
