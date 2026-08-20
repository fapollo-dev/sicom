# Cluster **GIROS** — `MOVIMENTACAO_DIARIA`, `ANALISE_COMP_DIA_PROD`, `ANALISE_COMPORTAMENTO_DIARIO`, `REL_ANALISE_COPORTAMENTO(_GRID)`

**Veredicto: NADA A MIGRAR COMO TABELA.** As quatro tabelas mais uma são *cache derivável* produzido por um
**batch externo** (o aplicativo **Giros**), e o Apollo já deriva a mesma coisa das vendas. O que sobrou de real
é um **épico de tela** (o BI mensal `FRMANALISECOMPORTAMENTO` + o relatório `FRMRELANALISECOMPORTAMENTOPERIODO`),
que fica registrado no fim deste dossiê como candidato — sem nenhuma tabela para carregar.

Este dossiê existe porque as duas primeiras tabelas eram **as duas maiores** da varredura por dado
(2.338.168 e 2.850.037 linhas) e o placar mandava, antes de migrar, "checar se é agregado **derivável** de VENDAS".
São. E a prova é textual, não inferida.

---

## 1. `MOVIMENTACAO_DIARIA` — derivável, provado pela procedure do próprio banco

`(IDEMPRESA, CODPRODUTO, DATA, QTDE)` — quatro colunas. O escritor **está no Oracle** e é uma
materialização literal (`user_source`, `PROCEDURE GERA_MOVIMENTACAO_DIARIA`, 62 linhas):

```sql
-- GERA_MOVIMENTACAO_DIARIA(IDEMPRESAINICIAL, IDEMPRESAFINAL, DTINICIAL, DTFINAL)
DELETE FROM MOVIMENTACAO_DIARIA WHERE TRUNC(DATA) BETWEEN DTINICIAL AND DTFINAL AND IDEMPRESA BETWEEN ...;
-- e insere, linha a linha, o resultado de:
SELECT IDEMPRESA, DATA, CODPRODUTO, SUM(QTDE) FROM (
  SELECT V.IDEMPRESA, TRUNC(V.DTVENDA) DATA, V.CODPRODUTO, SUM(V.QTDE)          -- perna 1: CUPOM
    FROM VENDAS V
   WHERE TRUNC(V.DTVENDA) BETWEEN DTINICIAL AND DTFINAL
     AND V.IDEMPRESA BETWEEN IDEMPRESAINICIAL AND IDEMPRESAFINAL
     AND COALESCE(V.CANCELADO,'N') = 'N'
   GROUP BY V.IDEMPRESA, TRUNC(V.DTVENDA), V.CODPRODUTO
  UNION                                                                          -- (UNION, não UNION ALL)
  SELECT N.IDEMPRESA, TRUNC(N.DTEMISSAO) DATA, NP.CODPRODUTO, SUM(NP.QUANTIDADE) -- perna 2: NF DE SAÍDA
    FROM NF N JOIN NF_PROD NP ON NP.CODNF = N.CODNF
   WHERE TRUNC(N.DTEMISSAO) BETWEEN DTINICIAL AND DTFINAL
     AND N.IDEMPRESA BETWEEN IDEMPRESAINICIAL AND IDEMPRESAFINAL
     AND N.CANCELADA = 'N' AND N.PROC = 'S' AND N.TIPO = 'S'
     AND N.CFOP IN (5405,6405,5402,6402,5102,6102,5403,6403)
   GROUP BY N.IDEMPRESA, TRUNC(N.DTEMISSAO), NP.CODPRODUTO
) GROUP BY IDEMPRESA, DATA, CODPRODUTO;
```

Três coisas a registrar da leitura literal:

1. **É a mesma regra que o Apollo já usa.** `rel-sem-movimento.service.ts` deriva o movimento de
   `vendas` ∪ `nf_prod`/`nf`, e `previa-fornecedor.service.ts` já tem `somenteComGiro`/`dias_com_movimento`.
   Ou seja: a regra foi migrada como **cálculo**, e a tabela era só o cache dela.
2. **O `UNION` (distinct) é um bug do legado.** Se, no mesmo dia/empresa/produto, a soma da perna do cupom
   der **exatamente** a mesma quantidade da perna da NF, o `UNION` descarta uma das duas linhas e o `GROUP BY`
   externo soma só uma. Copiar isso seria copiar o defeito; como não migramos a tabela, a questão morre aqui —
   fica registrado para quem for reconstruir a regra (usar soma das duas pernas, não `UNION`).
3. A perna da NF filtra por **CFOP de saída/venda** (`5405,6405,5402,6402,5102,6102,5403,6403`) e exige
   `PROC='S'` — nota processada. Nenhum consumidor recalcula esse filtro: eles confiam na tabela.

### Quem lê (cinco pontos, todos SELECT — nenhum INSERT/UPDATE no fonte da retaguarda)

| fonte | o que faz com a tabela | no Apollo |
|---|---|---|
| `uPedidoCompra.pas:8608` | `SELECT DISTINCT CODPRODUTO` dos últimos `edtDiasGiro` dias → **quais itens entram na sugestão de compra** | `previa-fornecedor.service.ts` (`somenteComGiro`) |
| `uProdutosRel.pas:1911` | `NOT EXISTS (…)` → relatório de **produtos sem movimento** com estoque > 0 | `rel-sem-movimento.service.ts` (deriva de `vendas` ∪ `nf_prod`) |
| `uProdutosRel.pas:2056` | quantidade vendida **depois da última NF de compra** (cobertura) | `rel-vendas-departamento.service.ts` / agregado de produto |
| `uVendas.pas:590` | `SUM(M.QTDE) QTDE_VENDIDA` em `TRUNC(M.DATA) >= CURRENT_DATE - DiasCalculoCobertura` → **dias de cobertura** | idem |
| `uDDE.pas:171` | o mesmo join, para exportação DDE | — (DDE não migra) |

### O dado morreu em fevereiro de 2024

Linhas por mês (Oracle, `pinheirao`): 2023-12 = 45.795 · **2024-01 = 53.444** · **2024-02 = 14.271** ·
2024-03 = **6** · 2024-05 = 1 · 2024-06 = 10 · … · 2025-11 = **3**. Por ano: 2021 = 508.265, 2022 = 506.179,
2023 = 453.284, 2024 = 67.738, **2025 = 70**. O "período até 25/11/2025" que a varredura por dado registrou
era ruído de execução avulsa: a rotina diária parou em **fev/2024**.

---

## 2. `ANALISE_COMP_DIA_PROD` (2.850.037) e `ANALISE_COMPORTAMENTO_DIARIO` (2.488)

Mesmo grão da anterior, com valores: `(IDEMPRESA, DATA, CODPRODUTO)` + `VALOR_TOTAL`, `VALOR_TOTAL_VENDA`,
`VALOR_TOTAL_NF`, `CUSTO_TOTAL`, `CUSTO_TOTAL_REP`, `QTDE_TICKETS`, `QTDE_NF`. A `..._DIARIO` é a **mesma tabela
sem o produto** — e é *roll-up exato*: os totais por ano batem dígito a dígito com a por-produto
(2018 = 11.839.243,90 · 2019 = 11.440.343,84 · 2021 = 15.084.171,90 · 2023 = 16.812.156,83).

Caso conferido linha a linha — produto 790668, empresa 1, 29/10/2025: a tabela diz `VALOR_TOTAL_NF` 300,00 ·
`QTDE_NF` 3 · `CUSTO_TOTAL` 81,00, e a `MOVIMENTACAO_DIARIA` diz `QTDE` 3. No dado bruto: **uma** NF `TIPO='S'`
modelo 55 daquele dia com 3 itens do produto, `SUM(QUANTIDADE)` = 3 e `SUM(QUANTIDADE*VRCUSTO)` = 300,00.
Derivável de `NF`/`NF_PROD` + `VENDAS`.

Duas ressalvas honestas sobre a derivação:

- **`CUSTO_TOTAL` é um retrato do custo no dia** (81,00 ≠ os 300,00 do valor); reconstruir o histórico exigiria
  o custo vigente naquela data. Para período corrente é derivável; para o passado, não é reproduzível — e é
  exatamente por isso que existia o acumulador.
- **`QTDE_TICKETS` está furado no próprio golden**: em 2018 e 2019 a soma é 361 e 361 — *um por dia*. O legado
  sabe disso e desvia: quando há filtro de família, `URelAnaliseComportamentoPeriodo.pas:471-478` conta
  `COUNT(DISTINCT NROPEDIDO)` **direto de `VENDAS`** em vez de ler o acumulador.

Mesma morte: 2023-12 = 46.014 linhas · 2024-01 = 53.749 · 2024-02 = 14.378 · 2024-03 = **6** · … · 2025 = 70.

## 3. `REL_ANALISE_COPORTAMENTO` (7.567) e `REL_ANALISE_COMPORTAMENTO_GRID` (850)

Não são acumuladores: são **staging de impressão** do BI mensal — matriz `TITULO × SEMANA_1..5 + TOTAL`
(mais as colunas `_PERC`), com `MES`/`ANO`/`IDEMPRESA`. Note o *typo no nome da tabela* (`COPORTAMENTO`),
que é como o fonte a referencia (21 ocorrências em `uAnaliseComportamento.pas`).

O que o golden guarda como título prova o conteúdo do relatório (procedência de dado):

- na staging mensal, só três séries sobreviveram: **Faturamento**, **CMV**, **Num. Clientes** (2018→2025);
- no grid, os **9 indicadores** — Faturamento · CMV · Margem Bruta · Previsão Impostos · Margem Final ·
  Lucro Final · Rentabilidade · Ticket Médio · Num. Clientes — mais as **9 diferenças** (`Dif …`) contra
  **Compar. Mês Anterior** e **Compar. Ano Anterior** (17 linhas cada).

## 4. O escritor: o aplicativo **Giros** (externo, sem fonte no repo)

Procedência textual, `uAnaliseComportamento.pas:214-217`:

> *"Este relatório busca os dados na tabela REL_ANALISE_COPORTAMENTO que é alimentada diariamente no
> processamento que fica dentro do aplicativo **Giros**, que é executado diariamente por volta das 4:00 da manhã"*

A tela ainda **exibe** a última execução (`uAnaliseComportamento.pas:66-82`):
`SELECT INICIOEXECUCAO FROM PROCESSOS WHERE NOMEPROCESSO = 'GIROS'`. No golden, `PROCESSOS` diz:
**GIROS, status 0, início 2025-12-04 09:55:24, fim 09:55:46** — 22 segundos, execução manual isolada (é também
a data de `LAST_ANALYZED` das duas tabelas de análise). Não existe job no `USER_SCHEDULER_JOBS`, nenhuma trigger
de `VENDAS`/`NF` toca essas tabelas, e não há projeto "Giros" em `/Library/SicomGit` (só `retaguarda-master`,
`vendas-master`, `gestaomobile-*`).

⇒ O escritor é **um app externo sem fonte disponível**, cuja rotina diária está desligada desde fev/2024.
Carregar 5,2 milhões de linhas de cache furado seria carregar dívida: o Apollo calcula na hora, das vendas.

---

## 5. O que sobra: o épico **Análise de Comportamento** (candidato, sem tabela a migrar)

Duas telas, ambas com permissão real no golden (`PERMISSOES`: 34 linhas / 15 operadores cada):

| form | fonte | o que entrega |
|---|---|---|
| `FRMANALISECOMPORTAMENTO` | `uAnaliseComportamento.pas` (5.911 linhas) + `uAnaliseComportamentoFiltro.pas` (3.223) + grids | BI do mês: os 9 indicadores × semanas 1-5, com comparativo de mês e de ano anterior e gráfico |
| `FRMRELANALISECOMPORTAMENTOPERIODO` | `URelAnaliseComportamentoPeriodo.pas` (693) | período de referência × 2 períodos de comparação: Faturamento, CMV, Lucro, Rentabilidade, tickets, ticket médio, com filtro de família |

O tamanho do fonte engana: os blocos de cálculo são **o mesmo código copiado por semana** (`RentabilidadeSemana1..5`,
`ImpostosSemana1..5`, `FaturamentoSemana1..5`, `LucroFinalSemana1..5`). O relatório de período é a versão simples
e já mostra a fórmula: `Lucro = VALOR_TOTAL − CUSTO_TOTAL`, `Rentabilidade = (VALOR_TOTAL − CUSTO_TOTAL) / VALOR_TOTAL × 100`,
`Ticket Médio = VALOR_TOTAL_VENDA / QTDE_TICKETS`, com o custo alternando entre `CUSTO_TOTAL` e `CUSTO_TOTAL_REP`
conforme o check "custo de reposição" (`URelAnaliseComportamentoPeriodo.pas:504-507`).

Se o épico entrar, entra **derivado** (vendas + NF de saída + impostos + famílias), sem acumulador e sem batch —
e aí "Previsão Impostos" e "Margem Final" precisam de recon próprio (vêm de `IMPOSTOS`, 15 referências no fonte).
