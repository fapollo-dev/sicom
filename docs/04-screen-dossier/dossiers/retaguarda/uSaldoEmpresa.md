# SALDO DA EMPRESA (`FRMSALDOEMPRESA`) — recon e corte-1

`uSaldoEmpresa.pas` (1.011 linhas) + `udmSaldoEmpresa`. **611 acessos, 19 operadores** — a próxima da fila por
uso real depois da análise de notas.

## 1. O que a tela é

Um **fluxo de caixa projetado**: a UNIÃO de cinco fontes por data de vencimento (`sqqSaldo`,
`udmSaldoEmpresa.dfm:366`), com o dinheiro que entra positivo e o que sai negativo.

| tipo | fonte | sinal | data que posiciona | condição |
|---|---|---|---|---|
| 1 | `ARECEBER` | + | `DTVENC` | não quitada e não agrupada |
| 2 | `CHEQUE` | + | `BOMPARA` | não baixado |
| 3 | `CARTAO` | + | `DTVENDA + DIASCOMP × NROPARCELA` | **não liberado** |
| 4 | `APAGAR` | − | `DTVENC` | não quitada e não agrupada |
| 5 | `CHQ_PROPRIO` | − | `DTVENC` | não baixado |

A tela oferece quatro visões do mesmo dado (descritivo por tipo/dia, por fornecedor, compromissos por
fornecedor, agrupado por semana) e um painel de contas bancárias.

## 2. As duas contas que não são óbvias

**A pagar não é o valor da duplicata.** É `(|VALOR| + VENDOR − DESCONTO) × −1`: o vendor entra e o desconto
sai. Quem lê a tela vê o compromisso real, não o valor de face.

**O cartão é projetado.** A data é a da venda mais os dias de compensação da operadora vezes o número da
parcela, e o valor é o líquido da taxa: `VALOR − VALOR × TXADM / 100`. O `coalesce(TXADM, 0.1)` do legado foi
copiado — operadora sem taxa cadastrada assume **0,1%**, não zero.

## 3. As três tabelas que faltavam, e o volume real

Medido em produção **antes** de decidir o escopo:

| tabela | linhas |
|---|---|
| `CHEQUE` | **11** |
| `CHQ_PROPRIO` | **0** |
| `AGENDA_PREV_PAGTO` | **27** |

**O cliente praticamente não usa cheque** — o que também explica a origem 52 (baixa de cheque) estar zerada no
razão, achado do corte-2 da integração contábil.

Mesmo assim as três entram **inteiras** na mig 205, coluna a coluna do dicionário do Oracle: são dado do
cliente, a carga as descartaria, e 11 cheques em aberto são dinheiro que a empresa espera receber. O custo de
trazer tudo é zero; o custo de recortar seria justificar cada coluna descartada.

## 4. O que o corte-1 entregou

Os cinco ramos da união, com filtro de período e de parceiro, e três agregações: **por tipo** (quanto vem de
cada origem), **por dia** (entra, sai, saldo do dia) e **o total do período**. Tela em
`/cobranca/saldo-empresa`, com impressão.

## 5. O que fica

As visões de agrupamento que a tela oferece (por fornecedor, por semana) — são recortes do mesmo dado e
entram como opção de exibição. O painel de **contas bancárias** (o saldo atual de cada conta) e o de
**pedidos colocados** (compromisso futuro de `PEDIDOCOMPRA` + `PEDIDOCOMPRA_PARCELAS`) são um corte-2: somam
ao fluxo o que ainda não virou título.
