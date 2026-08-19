# PEDIDO DE DEVOLUÇÃO DE COMPRAS — `uCadPedidoDevolucaoCompras` / `FRMCADPEDIDODEVOLUCAOCOMPRAS`

Dossiê de **recon** (2026-08-18). Nenhuma linha migrada ainda — este documento é a base do corte-1.
Escolhido por dado na reordenação da fila (ver `docs/10-roadmap/placar-conversao.md`): **1.753 acessos por 15
operadores**, dados até **out/2025**, e complementa a Devolução de Compra que já está migrada.

## 1. O que a tela faz

É o **passo anterior** à devolução: o comprador monta um pedido de devolução ao fornecedor a partir de uma NF de
entrada já lançada, escolhendo itens e quantidades. Quando aprovado, o pedido **gera a NF de devolução** (o
épico `devolucao-compra`, migrado nas migs 072/073/074) — daí o campo `COD_NOTA_FISCAL_EMITIDA` no cabeçalho.

## 2. Estado no Oracle (liveness)

| Tabela | Linhas | Observação |
|---|---:|---|
| `PEDIDO_DEVOLUCAO_COMPRA` | **545** | cabeçalho; 13 colunas; pedidos de 2020-08 a **2025-10** |
| `PEDIDO_DEVOLUCAO_COMPRA_ITENS` | **3.809** | itens; **66 colunas** (todo o fiscal em dose dupla, §4) |

⚠️ **Correção de um erro anterior**: o plano de carga registrava `PEDIDO_DEVOLUCAO_COMPRA_I` como "conferir se
existe". O nome real é **`..._ITENS`** — a tela é **viva**, não morta (o plano já foi corrigido).

`STATUS_PEDIDO` — o workflow real, com a distribuição do golden:

| status | linhas |
|---|---:|
| FINALIZADO | 427 |
| EM DIGITACAO | 42 |
| CANCELADO | 31 |
| NOTA FISCAL EMITIDA | 29 |
| DIGITADO | 16 |

- **480 de 545** pedidos têm `COD_NOTA_FISCAL_EMITIDA` preenchido ⇒ o caminho normal é pedido → NF.
- **529 de 545** têm itens (16 cabeçalhos vazios — rascunhos abandonados).
- `PRODUTO_TROCA` é **NULL em 545/545** ⇒ **cópia-fiel-negativa**: a coluna existe no cabeçalho e nunca foi
  usada. Registrar e não inventar comportamento para ela.
- `COD_TROCA` / `ESTOQUERETIRADATROCA` nos itens: preenchidos em **21 de 3.809** (0,55%) — o vínculo com a Troca
  com Fornecedor (épico já migrado) é raro, mas existe.

## 3. Cabeçalho (13 colunas)

`COD_PEDIDO_DEV_COMPRA` (PK) · `COD_PARCEIRO` · `COD_OPERADOR` · `COD_EMPRESA` · `CNPJ_CPF` · `DATA_PEDIDO` ·
`STATUS_PEDIDO` · `COD_NOTA_FISCAL_EMITIDA` · `OBSERVACOES` · `PRODUTO_TROCA` (morta) ·
`USULTALTERACAO` / `DTULTIMALTERACAO` / `DTCADASTRO`.

## 4. Itens: o fiscal em DOSE DUPLA (o coração do corte)

Cada tributo/despesa aparece **duas vezes**: a versão `_NOTA` (o que estava na NF original) e a versão sem
sufixo (a parte **devolvida**, proporcional à quantidade que volta). Isso vale para:

- **ICMS**: `ICMS_ALIQUOTA` · `ICMS_REDUCAO_BC` · `ICMS_BC` / `ICMS_BC_NOTA` · `ICMS_VALOR` / `ICMS_NOTA`
- **ICMS-ST**: `ICMS_ST_ALIQUOTA` · `ICMS_ST_REDUCAO_BC` · `ICMS_ST_BC` / `ICMS_ST_BC_NOTA` ·
  `ICMS_ST_VALOR` / `ICMS_ST_NOTA`
- **FCP-ST** (12 colunas!): base/alíquota/valor, cada um em ST e ST-RET, cada um em devolvido e `_NOTA`
- **IPI**: `IPI` / `IPI_NOTA`
- **PIS/COFINS**: `BCPISCOFINSE` · `VRPISE` · `VRCOFINSE` · `ALIQPISE` · `ALIQCOFINSE` + `..._NOTA`
- **despesas**: `SEGURO` · `FRETE` · `OUTRAS_DESPESAS` · `DESCONTO`, cada um com `_NOTA`
- **quantidade/valor**: `QTD_NOTA_FISCAL` × `QTD_DEVOLVIDA` · `TOTAL_PRODUTO_NOTA` ×
  `TOTAL_PRODUTO_DEVOLVIDO` · `VALOR_CUSTO` · `VALOR_VENDA` · `VRCUSTOREP`
- **classificação**: `CFOP` · `CST` · `UNIDADE` / `UNIDADE_NOTA` · `FATOR_EMBALAGEM` · `ARREDONDA`
- **vínculos**: `COD_NF` + `COD_ITEM_NF` (a origem na NF de entrada) · `COD_TROCA` / `COD_TROCA_ITENS` /
  `COD_TROCA_ITENS_QTDE` (a troca, rara) · `COD_PRODUTO` · `NROITEM` · `DESCRICAO_PRODUTO`

**O que falta reconear antes do build** (é o miolo da fidelidade): as fórmulas de proporcionalidade em
`uCadPedidoDevolucaoCompras.pas` (1.974 linhas) — como cada `_NOTA` vira o valor devolvido em função de
`QTD_DEVOLVIDA / QTD_NOTA_FISCAL`, o papel de `ARREDONDA`, e o que a tela recalcula × o que copia da NF.

## 5. Corte proposto

- **corte-1**: as 2 tabelas (com o `_ITENS` no nome certo), a criação do pedido a partir de uma NF de entrada
  (itens + quantidade a devolver) com o rateio proporcional dos tributos/despesas, o workflow de status
  (EM DIGITACAO → DIGITADO → NOTA FISCAL EMITIDA → FINALIZADO / CANCELADO) e a tela.
- **corte-2**: o elo com a NF de devolução já migrada (gerar a NF a partir do pedido e gravar
  `COD_NOTA_FISCAL_EMITIDA`) e o vínculo raro com a Troca com Fornecedor.
- **fora**: `PRODUTO_TROCA` (morta no golden) — registrada, não implementada.
