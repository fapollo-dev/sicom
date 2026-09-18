# FRMRELANALISECOMPORTAMENTOPERIODO — Análise de comportamento por período

**24 acessos · 6 operadores.** `URelAnaliseComportamentoPeriodo.pas` (24.021 b) + `.dfm` (42.420) +
`UAnaliseComportamentoPeriodoGrid`. Migration **250**.
API `POST relatorios/analise-comportamento-periodo`. Tela `/relatorios/analise-comportamento-periodo`.
Smoke §127 (6 checks).

## 1. O que faz

Compara **três períodos** com nome próprio ("Natal 2025", "Natal 2024") em seis métricas — Faturamento, CMV,
Lucro, Rentabilidade, Quantidade de tickets e Ticket médio — e mostra a diferença da referência para cada um
dos dois comparados. É a tela de "como foi este ano contra o ano passado".

## 2. O legado lê a cache do Giros; aqui o número é calculado

`ANALISE_COMP_DIA_PROD` (**4.554.664** linhas) e `ANALISE_COMPORTAMENTO_DIARIO` (4.590) são alimentadas pelo
**Giros**, o processo externo que roda de madrugada e **não veio no fonte** — o mesmo que bloqueou a
`FRMANALISECOMPORTAMENTO` (item 27 da fila). A tela chega a exibir a data da última execução
(`SELECT INICIOEXECUCAO FROM PROCESSOS WHERE NOMEPROCESSO = 'GIROS'`), mas só num label: não completa nada.

A diferença para o item 27 é que aqui os campos são **nomeados**, e isso permitiu reconstruir o critério do
dado e medi-lo contra a produção, peça por peça:

| peça | critério reconstruído | medição |
|---|---|---|
| Faturamento de venda | `Σ round(qtde × vrvenda, 2) + DESC_ACRE_MEDIO − DESC_PROMOCAO`, não cancelada | **60 de 60 dias × 2 lojas exatos**, diferença máxima 0,00 — e confere produto a produto |
| Tickets | `COUNT(DISTINCT NROCUPOM)` não cancelado | 58 de 60 dias exatos |
| Faturamento de NF | saída não cancelada cujo CFOP tem `PROC_FINANCEIRO = 'S'` e `DEVOLUCAO = 'N'` | todos os dias com nota |
| CMV | `Σ round(qtde × vrcusto, 2)` (ou `vrcustorep`) | 177 de 180 dias exatos |

A `VALOR_TOTAL` da cache é a soma das duas metades: venda + NF. Confirmado no dado (42.118,51 = 41.985,43 +
133,08 em 10/09/2026, loja 1).

## 3. ⚠️ O CMV do Giros usa o custo da MADRUGADA SEGUINTE

O único ponto que não fecha exato, e o motivo é instrutivo. Produto 130 em 10/09/2026, loja 1:

| | custo unitário |
|---|---:|
| gravado em **todas** as linhas de venda do dia | 24,33 |
| implícito na cache do Giros (486,71 ÷ 18,459) | **26,367** |
| em `MULTI_PRECO` hoje (18/09) | 26,99 |

O Giros não usa o custo do que foi vendido: usa o custo que vigorava **quando o job rodou**. O CMV histórico
do legado, portanto, é o custo de quando o relatório foi processado — e esse custo não está guardado em lugar
nenhum, o que torna a cache irreproduzível por definição.

O tamanho disso, medido em **90 dias × 2 lojas**: 177 dos 180 dias batem exato, e a diferença total é
**R$ 1.363,21 em R$ 5.120.935,94 — 0,027%**. Aqui o CMV sai do custo gravado na linha da venda.

## 4. ⚠️ A porcentagem de variação divide pelo número errado

```pascal
GetPorcentagem(Cds.VALOR - Cds2.VALOR, Cds.VALOR)   // divide pela REFERÊNCIA
```

Medido na loja 1:

| | valor |
|---|---:|
| ago/2026 (referência) | R$ 1.146.825,82 |
| ago/2025 (comparado) | R$ 1.668.836,16 |
| diferença | −R$ 522.010,34 |
| **queda real** (÷ base) | **−31,28%** |
| **o que a tela mostra** (÷ referência) | **−45,52%** |

**14,24 pontos** de exagero, e o erro é sistemático: subestima crescimento e infla queda. Aqui a variação é
sobre a base comparada.

## 5. ⚠️ A mesma tela conta ticket de dois jeitos

```pascal
if Filtro.FiltroFamilia <> '' then
  vQtdeTickets := GetQtdeTicket(FiltroData, True)    // COUNT(DISTINCT NROPEDIDO) de VENDAS
else
  vQtdeTickets := GetQtdeTicket(FiltroData, False);  // SUM(QTDE_TICKETS) da cache = DISTINCT NROCUPOM
```

Medido em 10/09/2026, loja 1: **974 cupons** contra **970 pedidos**. Marcar um departamento que contém tudo
já muda o ticket médio. Aqui é sempre por cupom.

## 6. ⚠️ O ticket médio não divide o faturamento exibido

A linha "Faturamento" mostra `VALOR_TOTAL` (venda + NF), mas o ticket médio é `VALOR_TOTAL_VENDA / tickets`.
Faturamento ÷ tickets não dá o ticket médio — no legado também não dava. Mantido, porque dividir a nota pelos
cupons seria pior: ela não passa pelo caixa. O retorno separa `faturamentoVenda` de `faturamento`, e a tela
mostra as duas metades embaixo do quadro.

## 7. A cache termina ontem

`ANALISE_COMPORTAMENTO_DIARIO` vai até **2026-09-17**; a venda vai até **hoje**. Pedir o dia corrente no
legado devolve zero. Calculando, o dia de hoje aparece.

## 8. Os CFOPs que entram

O critério sai do **cadastro**, não de uma lista fixa. Medido na produção, dos CFOPs de saída em uso:

| entra | fica fora |
|---|---|
| 5102 venda de terceiros · 5405 venda com ST | 5929 espelho do cupom · 5152 transferência · 5927 baixa por perda · 5949 outra saída · 5411/6202/6411 devolução de compra · 5557 transf. de uso e consumo · 5926 reclassificação · 6929 lançamento de cupom |

A regra é `PROC_FINANCEIRO = 'S'` **e** `DEVOLUCAO = 'N'`: gera financeiro e não é devolução. As três colunas
(`tipo`, `proc_financeiro`, `devolucao`) não existiam no `cfop` do destino e entram com a migration.

## 9. Folds declarados

- Tenant-scoped (o legado monta `IDEMPRESA IN (lista)` pelo seletor multi-empresa).
- O segundo período comparado é **opcional** aqui; no legado os três são obrigatórios.
- A grade de detalhe (`UAnaliseComportamentoPeriodoGrid`) e o gráfico do original: o retorno já traz o
  material dos dois (`periodos` + `comparacoes`); o desenho do gráfico é acessório da tela.
