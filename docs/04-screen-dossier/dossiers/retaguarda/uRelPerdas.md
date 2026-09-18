# FRMRELPERDAS — Relatório de perdas

**17 acessos · 4 operadores.** `URelPerdas.pas` (622) + `.dfm` (1.448) + `URelPerdasGrid`. Migration **255**.
API `GET cadastro/rel-perdas`. Tela `/cadastro/rel-perdas`. Smoke §132 (3 checks).

## 1. O que faz

O relatório sobre `SCRAP`/`SCRAP_ITEM` — o documento de perda/quebra que já vive no destino (`cadastro/scrap`,
com aplicar/estornar do estoque). Abre também a partir do próprio scrap (`Create(CodScrap, Data)`).

**Analítico**: um item por linha (scrap, data, centro de custo, parceiro, produto, qtde, custo, total,
fornecedor, setor, motivo, departamento, status da nota) + resumo por **centro de custo** (× departamento).
**Sintético**: por produto × motivo × setor × fornecedor × departamento, com custo médio **ponderado**
(Σ total ÷ Σ qtde) + total por **empresa**. Filtros: período (`DT_CADASTRO`), parceiro, centro de custo,
scrap, produto, setor, motivo, departamento/grupo/subgrupo, fornecedor.

## 2. O que o dado diz

| | |
|---|---:|
| scraps · itens | **3.794 · 133.309** (último em 02/09/2026) |
| motivo "PERDA GERAL" · sem motivo | 98.925 · 31.557 itens |
| setor preenchido | 27.675 itens (21%) |
| centro de custo preenchido | 100% dos scraps |
| scraps com NF de saída (`PEDIDO_NF TIPO='S'`) em 2026 | 199 de 244 (81%) |
| origem `ESTOQUE`, `FATURADO='N'` | 133.302 de 133.309 |

## 3. ⚠️ Um item digitado errado vale 91% das perdas do ano

| 2026 | custo |
|---|---:|
| total do ano | **R$ 7.292.991,37** |
| scrap **16155** (22/08/2026, 3 itens) | **R$ 6.645.919,88 — 91,13%** |
| o item: MUCHIBA KG | **139.502,008 kg** × R$ 47,64 |
| MUCHIBA nos outros 6 scraps | média 393 kg, máximo 1.300 kg |
| 2026 sem o 16155 | R$ 647.071,49 |
| 2025 · 2024 | R$ 1.875.935,86 · R$ 1.356.517,53 |

O relatório do legado imprime o total e pronto. Aqui `totais.maiorItem` traz o item e a participação dele, e
a tela destaca quando passa de 50%: o número não passa em silêncio.

## 4. Folds

- **`STATUSNOTA`** vem de `PEDIDO_NF (TIPO='S')` → `NF` (a NF de saída gerada pelo scrap, com o CASE de status
  SEFAZ / contingência / processada). `PEDIDO_NF` não existe no destino: o status da nota fica de fora;
  `mov_estoque` (o efeito no estoque, que é o que a casa confere) e `importado` entram.
- Tenant-scoped (o legado monta `IDEMPRESA IN (lista)`). A grade `.fr3` (`TFrmRelPerdasGrid`): acessório.
