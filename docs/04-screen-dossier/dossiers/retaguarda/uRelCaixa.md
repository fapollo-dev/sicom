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

## Corte 2 — os cinco modelos e a impressão no layout do cliente (05/10/2026)

A tela fica completa: os cinco modelos do `CmbTipoRelatorio`, cada um com o `GetSQL` da sua classe de `UCaixa.pas` traduzido linha a linha,
e o "Imprimir" no layout da classe pelo esquema do `TFrmRelMaster` (helper `shared/relatorios/relatorio-mestre.ts`: `DBDRelatorio`,
`DbdAuxiliar`, `DBDVariaveisAdicionais` com IDEmpresas "1,2", DataInicial, DataFinal, NiveisExpandidos, Tabela + os campos da subclasse).

| modelo | classe | layout | conjuntos |
|---|---|---|---|
| Divergências | `TDivergenciasCaixa` | Caixa1 - Divergências de caixa.fr3 | relatório + auxiliar (total por recurso) |
| Voucher | `TVoucher` | Caixa2 - Voucher.fr3 | HIST_VOUCHER (vazia na produção) |
| Apuração | `TApuracaoCaixa` | Caixa3 - Apuração do caixa.fr3 | relatório + contas internas + `DBResumoApuracao` + `DBDResumoCC` |
| Caixas abertos | `TCaixasAbertos` | Caixa4 - Caixas abertos.fr3 | relatório |
| Pedidos | `TCaixaPedidos` | Relatorio_Pedidos.fr3 | relatório (CX_VENDAS → VENDAS.PEDIDONRO → PEDIDOS; 953 vendas com pedido desde 2025) |

- **Correções do corte 1, fiéis ao legado:** as divergências só listam o que NÃO fecha (`WHERE VALOR_CAIXA − VALOR_CX_VENDAS <> 0`), na
  ordem loja, operador, dia, recurso; entram os ramos RECARGA/CORRESPONDENTE/VOUCHER da CAIXA_PDV (vazios na produção) e a devolução em
  dinheiro (HIST_DEVOLUCAO tipo D) somada ao caixa do DINHEIRO; o dia é o da loja (`FUSO_HORARIO_ACESSO`); multiempresa; filtro de PDV.
- **Filtro de recurso nas divergências:** o legado o injeta também na subconsulta de CX_VENDAS, que não tem TIPORECURSO (ORA-00904 — a tela
  respondia "Ocorreu um erro durante a impressão do relatório."). Vale a intenção: filtra a operação do PDV.
- **Apuração:** `ProcessaResumoApuracao` (Total PDV, Total contas internas, Total PDV + Contas internas, Outras informações = descontos do
  PDV negativos e cancelamentos da CAIXA_PDV — o `QryDescCanc` —, Adiantamentos a Receber = ADIANTAMENTO_FORN tipo D, 573 na produção) e o
  resumo das contas correntes (`GetResumoCC`) com "Somente contas movimentadas". As contas internas (`EXIBE_REL_APURACAO_CAIXA = 'S'`) estão
  em 0 de 36 contas na produção. Vazio só quando relatório, contas internas e resumo das contas estão todos vazios (`AntesImprimir`).
- **Pedidos:** PEDIDO_ECOMMERCE está vazia na produção e não existe no destino — o NROECOMERCE sai nulo, como o LEFT JOIN vazio.
- **Motor .fr3:** grupos recolhíveis (`DrillDown` / `ExpandDrillDown` pelo script dos "níveis expandidos": fechado mostra só o cabeçalho com
  os totais que a passada dupla escreveu), `case … of` no PascalScript, e a agregada sem banda soma a banda de dados da própria página (o
  resumo por recurso do Page2).
Smoke §99 (6 verificações).
