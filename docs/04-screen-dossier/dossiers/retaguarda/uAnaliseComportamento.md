# FRMANALISECOMPORTAMENTO — Análise de comportamento da loja

**53 acessos · 8 operadores.** `uAnaliseComportamento.pas` (5.911 linhas) + `uAnaliseComportamentoFiltro.pas`
(3.223) + grid (169) + dm (133) = 9.436 linhas. Migration **251**.
API `GET relatorios/analise-comportamento` + `impostos` (GET/POST/DELETE). Tela `/relatorios/analise-comportamento`.
Smoke §128 (5 checks). **Item 27 da fila — estava adiado.**

## 1. O que faz

Para um mês/ano, **três blocos** — mês anterior, mês atual, mesmo mês do ano anterior — cada um com **nove
linhas** (Faturamento, CMV, Rentabilidade em R$, Previsão de Impostos, Lucro Final, Margem Bruta %, Margem
Final %, Num. Clientes, Ticket Médio) em **cinco "semanas" + total**; e **dois comparativos** (mês atual × mês
anterior; mês atual × ano anterior) com diferença e variação de cada linha. O painel "Impostos" da tela mantém
a lista de contas do plano que a linha de impostos soma.

## 2. Por que estava adiada, e o que destravou

A tela lê `REL_ANALISE_COPORTAMENTO` (14.020 linhas, jan/2018 → set/2026, 3 empresas), alimentada pelo
**Giros** — o processo que roda às 4h e não veio no fonte (o próprio autor deixou o aviso em comentário). O
recon anterior reconstruía o número com `SUM(QTDE × VRVENDA)` e ficava **0,75%** fora; entregar um gerencial
diferente do que o cliente vê era pior que adiar.

A migration 250 (`FRMRELANALISECOMPORTAMENTOPERIODO`, que lê a irmã `ANALISE_COMP_DIA_PROD`) fechou o critério:

| peça | fórmula | prova |
|---|---|---|
| venda | `Σ round(qtde × vrvenda, 2) + DESC_ACRE_MEDIO − DESC_PROMOCAO`, não cancelada | 60/60 dias × 2 lojas exatos |
| NF | saída não cancelada, CFOP com `PROC_FINANCEIRO='S'` e `DEVOLUCAO='N'`, por item | todos os dias com nota |
| clientes | cupons distintos **por dia**, somados | ver §5 |
| CMV | `Σ round(qtde × vrcusto, 2)` | 177/180 dias exatos |

Aplicado a esta cache — ago/2026, loja 1: **1.146.825,82** na cache, **1.146.825,83** no cálculo. Um centavo em
R$ 1,1 milhão.

## 3. As "semanas" são blocos fixos de 7 dias

```pascal
Semana1Ini := FDtIni;  Semana1Fim := Semana1Ini + 6;  Semana2Ini := Semana1Fim + 1; ... Semana5Fim := FDtFim;
```

1 = dias 1–7 · 2 = 8–14 · 3 = 15–21 · 4 = 22–28 · 5 = 29–fim. Não é semana de calendário. A cache confirma:
uma linha por **dia**, e cada dia cai na coluna `SEMANA_n` do seu bloco. E o valor confirma:

| ago/2026, loja 1 | cache | cálculo |
|---|---:|---:|
| semana 1 (Faturamento) | 238.838,52 | **238.838,52** |
| semana 5 (Faturamento) | 117.555,28 | 116.891,44 venda + 663,84 NF = **117.555,28** |
| semanas 1, 2, 3 (CMV) | — | **0,00** de diferença |
| semana 4 (CMV) | 222.681,89 | 222.522,27 (+159,62 · 0,07%) |
| semana 5 (CMV) | 82.224,64 | 81.653,68 (+570,96 · 0,7%) |

O resíduo do CMV é o do Giros (custo da madrugada seguinte), já medido e explicado no dossiê da migration 250.

## 4. ⚠️ A mesma tela tem DOIS critérios — e o segundo está muito errado

Sem filtro, a tela lê a cache. **Com** filtro (departamento, grupo, subgrupo, seção, fornecedor),
`uAnaliseComportamentoFiltro` não pode usar a cache (que é por dia, sem família) e **calcula** em cima de
`VENDAS`/`NF_PROD`. Medido em ago/2026, loja 1:

**Faturamento**: `SUM(QTDE × VRVENDA)` sem arredondar por item e sem os descontos → 1.153.860,03 contra
1.146.825,82 da cache (+0,61%). E a NF entra por `NF_PROD.VRVENDA`, que é **zero em 57 dos 62 itens** das notas
de venda do cliente (o valor está em `VRCUSTO`) → NF = **0,00** contra 872,74.

**CMV**:
```sql
FROM VENDAS V
LEFT JOIN MULTI_PRECO M ON M.IDPRODUTO = V.CODPRODUTO      -- sem IDEMPRESA
...
AND V.IDEMPRESA IN (1)                                      -- fixo no código
```

| | valor |
|---|---:|
| linhas de venda do mês | 111.535 |
| linhas depois do JOIN | **475.737** (×4,265) |
| CMV real (custo da linha) | R$ 804.921,42 |
| CMV da cache | R$ 805.652,00 |
| **CMV que a tela calcula com filtro** | **R$ 3.518.208,52** (4,37×) |

Com o filtro ligado, a tela mostra CMV maior que o faturamento e "Rentabilidade" negativa em R$ 2,4 milhões.
E o `IN (1)` fixo faz o operador da **loja 2** ver o CMV da loja 1 (× 4,27) sobre o faturamento da loja 2
(R$ 1.071.188,61). Aqui há **um** critério, com ou sem filtro — o filtro só recorta; o smoke prova que o
departamento que contém tudo devolve o mesmo total do sem-filtro.

## 5. ⚠️ Num. Clientes: o resíduo, e a armadilha

| ago/2026, loja 1 | cache | soma diária de cupons | dif |
|---|---:|---:|---:|
| semana 1 | 4.927 | 4.898 | 29 |
| semana 2 | 4.193 | 4.031 | 162 |
| semana 3 | 6.094 | 6.094 | 0 |
| semana 4 | 6.718 | 6.717 | 1 |
| semana 5 | 2.358 | 2.357 | 1 |

As semanas 1 e 2 carregam os dias 11 e 12/08 — cupons cancelados **depois** do job, que a cache nunca
reprocessa. E a armadilha (lição 59): o número do cupom **reinicia todo dia**; `COUNT(DISTINCT NROCUPOM)` no
mês inteiro dá 21.804 contra 24.097 — 10,5% a menos. A chave é o par (dia, cupom).

## 6. ⚠️ A "Previsão de Impostos" nunca teve dado

```sql
SELECT Sum(Abs(VALOR)) VLRIMPOSTOS FROM caixa C JOIN IMPOSTOS I ON (C.CODPLC = I.CODPLC) WHERE ...
```

No cliente, `IMPOSTOS` tem **0 linhas** — e `CAIXA ⋈ IMPOSTOS` nunca produziu uma linha em toda a história.
Logo Lucro Final = Rentabilidade e Margem Final = Margem Bruta, sempre. A regra é viva (a tela tem o botão
"Selecionar Plano de Contas" e o "Excluir", que mantêm a lista pelo `GET_PLC`), então a tabela entra no
destino e a manutenção vem junto: `GET/POST/DELETE …/impostos`. O legado só acrescenta o que ainda não está
na lista (`Locate` antes do `Append`) — idem aqui.

## 7. O comparativo desta tela acerta a %

```pascal
SEMANA_1_PERC := (Dif / cdsClone1.SEMANA_1) * 100   // cdsClone1 = o período ANTERIOR (a base)
```

Ao contrário da irmã (migration 250), que dividia pela referência, aqui a variação é sobre a base. Mantido.

## 8. Folds declarados

- Tenant-scoped (o legado monta `IDEMPRESA IN (lista)` pelo seletor multi-empresa).
- Na venda, a família vem da **própria linha** (`V.CODDPTO`, `V.CODGRUPO`, `V.CODSUBGRUPO`), como no legado; o
  fornecedor do produto; a seção da `FAMILIAS_PROD` do departamento. Na NF, tudo do produto.
- `REL_ANALISE_COMPORTAMENTO_GRID` (1.850 linhas) é o buffer que a tela grava para imprimir o `.fr3` —
  saída, não fonte: ignorada. Exportar para Excel e o `.fr3`: acessórios; o retorno traz a grade inteira.
- A cache termina ontem (max `2026-09-17`); calculando, o dia corrente aparece.
