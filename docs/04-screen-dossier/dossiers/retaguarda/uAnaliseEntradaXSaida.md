# ANÁLISE DE ENTRADA × SAÍDA (`FRMANALISEENTRADAXSAIDA`) — completa

`uAnaliseEntradaXSaida.pas` (152) + `.dfm` (1.196) + `udmAnaliseEntradaXSaida`. **68 acessos, 9 operadores.**

## 1. A terceira da família — e o que a distingue

Por **fornecedor** e produto: quanto entrou pela nota e quanto saiu. Só **quantidade**, sem valor: a pergunta
aqui é de giro, não de dinheiro.

| tela | pergunta |
|---|---|
| `uRelEntradasSaidas.md` | lista as notas e compara totais |
| `uRelEntSai.md` | por produto, entrada × venda, **com valores** |
| **esta** | por **fornecedor**, e a saída pode vir de **pedido** em vez de venda |

O rádio `rgPedVen` troca a origem da saída entre `VENDAS` e `PEDIDOS` (tipo `'P'`) — é a mesma tela
respondendo se o giro é do que saiu pelo caixa ou do que foi encomendado.

## 2. ⚠️ Os filtros anulam o `LEFT JOIN` e escondem produto

O SQL original faz `LEFT JOIN PARCEIROS`, `LEFT JOIN FAMILIAS_PROD` (grupo) e (departamento) — e depois
filtra no `WHERE`:

```sql
AND P.RAZAO LIKE :RAZAO
AND D.DESCRICAO LIKE :DESCRICAO
AND E.DESCRICAO LIKE :DEPTO
```

Com o filtro vazio o parâmetro vira `'%%'` — mas **`NULL LIKE '%%'` é falso**. Então todo produto **sem
fornecedor, sem grupo ou sem departamento** desaparece do relatório, **mesmo sem filtro nenhum**. O `LEFT
JOIN` é anulado pelo próprio `WHERE`: na prática vira `INNER JOIN`.

Medido na produção em 17/09/2026:

| | |
|---|---|
| produtos sem grupo | **4.502** de 47.711 |
| produtos sem departamento | **4.520** |
| o que sumiria em agosto/2026 | **652 linhas de venda, 38 produtos, R$ 7.111,31** |

Pouco em valor, e invisível: o operador não tem como saber que sumiu.

**A correção:** o filtro só se aplica **quando preenchido**, e o produto sem cadastro aparece rotulado —
`(SEM FORNECEDOR)`, `(SEM GRUPO)`, `(SEM DEPARTAMENTO)`. É o rótulo que faz alguém ir arrumar o cadastro.

## 3. Cobertura (§120 do smoke, 4 checks)

1. o produto sem cadastro **aparece**, rotulado, com entrada e saída certas;
2. entrada × saída por produto, só em quantidade;
3. o rádio trocando a saída de venda (70) para pedido (15);
4. o filtro preenchido **volta a filtrar** — a correção não desligou o filtro, só parou de aplicá-lo vazio.

## 4. O que ficou de fora

**Resolvido de outro jeito:** os dois relatórios `.fr3` (com e sem itens) — a grade mostra o detalhe e
exporta.
