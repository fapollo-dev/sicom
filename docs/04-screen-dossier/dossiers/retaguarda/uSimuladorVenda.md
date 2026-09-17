# FRMSIMULADORVENDA — Simulador de vendas

**42 acessos · 5 operadores.** `uSimuladorVenda.pas` + `udmSimuladorVenda`. Migration **239**.
API `relatorios/simulador-venda`. Tela `/relatorios/simulador-venda`.

## 1. O que faz

Mostra o que foi vendido num período, produto a produto, com custo, venda, descontos e acréscimos — e deixa o
operador **mexer no preço** para responder: *"se eu tivesse vendido a tanto, quanto teria sobrado?"*.

## 2. ⚠️ O legado soma TODAS as empresas

A query (`sqqTotais`) filtra só a data e o cancelado:

```sql
WHERE TRUNC(V.DTVENDA) BETWEEN :DATAI AND :DATAF
  AND (v.cancelado = 'N' or v.cancelado is null)
```

**Não há `IDEMPRESA` em lugar nenhum.** Medido em agosto/2026:

| | valor |
|---|---|
| empresa 1 | R$ 1.153.860,03 |
| empresa 2 | R$ 1.073.319,68 |
| **o que a tela mostrava** | **R$ 2.227.179,71** |

Quase o dobro. Quem simula o preço da sua loja está olhando o volume das duas — e como o lucro sai de médias
(`AVG(VRVENDA)`, `AVG(VRCUSTO)`), o número perde o significado. Aqui é tenant-scoped.

## 3. As contas, copiadas linha a linha

| campo | conta |
|---|---|
| custo total | `SUM(ROUND(qtde × vrcusto, 2))` |
| subtotal da venda | `SUM(TRUNC(qtde × vrvenda × 100) / 100)` |
| acréscimo | a parte **positiva** de `DESC_ACRE_MEDIO` e `DESC_ACRE_ITEM` |
| desconto | `DESC_PROMOCAO` + `DESC_DEPARTAMENTO` + a parte **negativa** daqueles dois, em módulo |
| venda total | subtotal + acréscimo − desconto |
| lucro | venda total − custo total |

⚠️ **A venda TRUNCA e o custo ARREDONDA.** A assimetria é do legado, muda centavos por linha, e foi mantida.

⚠️ **O "Lucro %" é markup sobre o CUSTO**, não margem sobre a venda (`CalculaLucro`, `:156`):

```pascal
edtLucroPercentual.Value := (((edtVenda.Value / edtCusto.Value) - 1) * 100)
```

Uma venda de 150 sobre custo 100 mostra **50%**, não os 33,3% da margem. Mantido — trocar mudaria todo número
que o operador conhece, e ele compara com o markup do cadastro de preço, que segue a mesma conta.

## 4. A simulação

No legado a simulação acontece na tela, em memória: o operador muda o preço e os campos recalculam. Aqui é
igual — a mesma conta do servidor roda no navegador com a venda unitária trocada, e o rodapé mostra o total
simulado ao lado do real, dizendo quantos produtos foram mexidos.
