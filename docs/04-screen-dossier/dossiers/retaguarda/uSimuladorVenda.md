# FRMSIMULADORVENDA — Simulador de vendas

**42 acessos · 5 operadores.** `uSimuladorVenda.pas` + `udmSimuladorVenda`. Migration **239**.
API `relatorios/simulador-venda` (+ `POST /impressao`). Tela `/relatorios/simulador-venda`. Smoke §116.1-4.

## 1. O que faz

Mostra o que foi vendido num período, produto a produto, com custo, venda, descontos e acréscimos — e deixa o
operador **mexer no preço** para responder: *"se eu tivesse vendido a tanto, quanto teria sobrado?"*.

## 2. ⚠️ O legado soma TODAS as empresas

A query (`sqqVendas`) filtra só a data e o cancelado:

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

O corte 1 tratou isso como defeito e recortou na loja do login. É a regra do legado (o operador vê o banco inteiro); desde o corte 2
(§4) o Apollo soma todas as lojas que o operador alcança — o mesmo número para quem vê todas.

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

## 4. ✅ Corte 2 pelo fonte (06/10/2026)

O corte 1 simulava só o preço, filtrava produto no SQL, tinha LIMIT 3000 e usava só a loja do login. O legado:
- **as lojas**: o `sqqVendas` não filtra loja (soma o banco inteiro). O Apollo soma **todas as lojas que o operador alcança** (a do login
  \+ RELACAO_OPERADOR_EMPRESA) — para quem vê todas, é o número do legado; não passa do que o operador pode ver;
- o campo "Descrição" **não filtra**: é `cdsVendas.Locate('DESCRICAO', texto, [loPartialKey])` — posiciona na primeira descrição que
  começa com o texto (maiúsculas como digitadas); sem limite de linhas; o título da coluna ordena (`OrdenaDataSet`);
- **a grade edita** VRVENDA, VRCUSTO, QTDE, DESCONTO e ACRÉSCIMO (o resto é ReadOnly), com os `OnValidate` do `cdsVendas`, sem arredondar:
  quantidade ou custo → TOTAL_CUSTO = custo × qtde e TOTAL_VENDA = venda × qtde + acréscimo − desconto; venda, desconto ou acréscimo →
  só o TOTAL_VENDA; e o TOTAL_VENDA refaz o LUCRO_TOTAL = venda − custo. O SUB_TOTAL_VENDA não muda (o subtotal simulado fica o da carga);
- os totais: o **Consolidado** (os `edt*Cons`, congelados na consulta; o lucro % só com custo > 0) e o **Simulado** (o `cdsTotais`, pelos
  agregados do `cdsVendas`; o lucro % com venda e custo diferentes de zero) — markup sobre o custo, não margem;
- a mensagem "Não foram encontradas vendas no período informado." na consulta vazia e no Imprimir sem linhas;
- **Imprimir** (`imprimir(frxReportDados)`): o relatório **desenhado no próprio .dfm** (convertido por `tools/relatorios/dfm-para-fr3.py`),
  com o `cdsVendas` como a grade está — os valores simulados e a ordem da coluna clicada (a tela manda a grade no POST). Gate: a opção
  BTNIMPRIMIR da tela (existe na PERMISSOES da produção).
