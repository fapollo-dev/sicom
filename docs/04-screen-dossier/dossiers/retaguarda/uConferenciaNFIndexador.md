# CONFERÊNCIA DE NF × INDEXADOR TRIBUTÁRIO (`FRMCONFERENCIANFINDEXADOR`) — completa

`uConferenciaNFIndexador.pas` (685) + `.dfm` (971) + `uDMConferenciaNFIndexador`. **165 acessos, 4 operadores.**

## 1. O que a tela é

Põe lado a lado, item a item, **o que o sistema calculou** e **o que veio na nota** (XML). É onde se descobre
que o fornecedor mandou um CST diferente do cadastrado, ou um total que não fecha com quantidade × custo.

Poucos operadores (4), mas é conferência fiscal: o achado de um item errado evita autuação.

## 2. ⚠️ O maior achado de carga até aqui: 20 colunas, e são o lado do XML

A `nf_prod` do destino **não tinha nenhuma** das colunas `*_NOTA` — metade da comparação simplesmente não
chegava. Mais `NF.DTIMPORTACAO`. Medido na produção em 14/09/2026, sobre **496.498** itens de nota:

| coluna | preenchidos | | coluna | preenchidos |
|---|---|---|---|---|
| `TOTAL_PRODUTO_NOTA` | 369.812 | | `CFOP_ORIGINAL` | 387.452 |
| `QTD_NOTA` | 369.815 | | `CST_NOTA` | 373.912 |
| `ICMS_ST_ALIQ_NOTA` | 107.897 | | `MVA_AJUSTADO` | 88.883 |
| `OUTRAS_DESPESAS_NOTA` | 47.089 | | `IPI_NOTA` | 33.515 |
| `ICMS_RED_BC_NOTA` | 31.995 | | `DESCONTO_NOTA` | 8.925 |

**E o que a tela encontraria hoje: 52.065 itens com CST diferente do que veio na nota**, e 883 com o valor
total do produto divergente. Não é relatório decorativo — é achado fiscal real esperando conferência.

### ⛔ `NF.NFE_XML` fica de fora, com o número

São **716,1 MB** em 46.352 notas — mais peso que toda a recarga total das 77 tabelas do plano de virada. A
conferência não depende dele: compara as colunas que o importador já extraiu. O XML serve para abrir o
documento original, e isso pode vir depois, sob demanda, fora da janela.

## 3. A conta do lado "sistema" (`uDMConferenciaNFIndexador.dfm:30`)

As colunas de encargo em `nf_prod` são **percentuais**, aplicados sobre a base **líquida**:

```
base = QUANTIDADE × (VRCUSTO − VRDESCPROD / QUANTIDADE)
IPI  = IPI% > 0 ? round(IPI%/100 × base, 2) : 0      (idem seguro, frete, acessórias)
```

Aplicar o percentual sobre o bruto inventaria divergência onde não há: com 10 × 10,00 e 20,00 de desconto, a
base é 80,00 e o IPI de 10% dá **8,00** — não 10,00.

## 4. Três defaults que evitam falso alarme (`:70-95`)

| campo | quando zerado, vale | por quê |
|---|---|---|
| `TOTAL_PRODUTO_NOTA` | `QUANTIDADE × VRCUSTO` | nota importada antes de a coluna existir apareceria como divergência de 100% |
| `QTD_NOTA` | `QUANTIDADE` | idem |
| unitário da nota | `TOTAL_PRODUTO_NOTA / QUANTIDADE` | ⚠️ divide pela quantidade do **sistema**, não pela `QTD_NOTA`. É o fonte, e é o número que o conferente lê há anos |

## 5. As divisões sem proteção — corrigidas

O legado divide `VRDESCPROD / QUANTIDADE` e `VRDESCPROD / (QUANTIDADE × VRCUSTO)` **sem `NULLIF`**. Com
quantidade zero a expressão inteira vira `NULL` e **a linha desaparece da conferência** — o pior lugar
possível para uma linha sumir. Em produção há **4 itens com quantidade zero** e **6 com base zero**.

Aqui as divisões usam `NULLIF`: o item aparece, com o encargo em zero, e o conferente decide o que fazer.

## 6. Cobertura (§107 do smoke, 5 checks)

1. o lado sistema derivado sobre a base líquida (IPI 8,00, não 10,00);
2. as divergências marcadas **uma a uma** — total e CST no mesmo item, para o conferente saber a quem ligar;
3. o item de quantidade zero **aparece** em vez de sumir;
4. os defaults de `TOTAL_PRODUTO_NOTA` e `QTD_NOTA` não geram falso alarme;
5. os filtros: "só o que diverge", as caixas de processadas/canceladas (que são de **inclusão**) e a recusa
   de data invertida.

## 7. O que ficou de fora

- **exportar a grade** (`[F10]`) e **salvar/carregar o layout** (`[F8]`/`[F9]`): a grade imprime em paisagem;
- **"Recolher itens"** — o agrupamento visual por nota, que aqui é ordenação;
- a coluna com o **XML da nota**, pelo motivo do §2.
