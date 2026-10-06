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

## 3. Auditoria de fidelidade (06/10/2026)

A conversão de setembro tinha divergências silenciosas em relação ao `sqqAnalise` (udmAnaliseEntradaXSaida.dfm), corrigidas:

| ponto | legado | o que o Apollo fazia |
|---|---|---|
| "Pedidos" | `AND J.TIPO = 'P'` — na produção, **53 de 2.208** linhas de PEDIDOS desde 2025 (os nulos são antigos; há 'O' e 'T') | somava todos os tipos |
| o rádio | abre em **Pedidos** (`ItemIndex = 0`) | abria em Vendas |
| nota cancelada | **conta** (o SQL não filtra CANCELADA nem PROC; 1 nota de entrada cancelada em 2025-26) | excluía |
| famílias | pelo CODFAMILIA, **sem** o tipo | exigia tipo G/D |
| filtros | fornecedor em maiúsculas (`CharCase`); grupo e departamento `LIKE` **como digitados** | `ILIKE` nos três |

Mantida a correção já documentada (§2): o filtro só entra preenchido e o produto sem cadastro aparece rotulado.

A tela do legado **não tem grade**: o botão imprime direto. A grade do Apollo soma os dois ramos por produto; a impressão segue o legado.

## 4. A impressão (06/10/2026)

`GET relatorios/analise-entrada-saida/impressao` → `extr - AnaliseEntradaXSaidaComItens.fr3` ("Mostrar itens") ou `extr - AnaliseEntradaXSaida.fr3`
(PERSONALIZADO 736/735) com o `frxDBAnalise` — os **dois ramos do UNION ALL**, como o legado lista (o produto com entrada e saída sai em
duas linhas no layout com itens), ORDER BY departamento, grupo, fornecedor — e o `frxDBEmpresa`; variáveis `DtIncial` (sic), `DtFinal`,
`Titulo`. Sem dados: "Não existem informações no período informado para impressão. Verifique!".

O layout "sem itens" esconde a MasterData e soma os grupos com `SUM(…, MasterData1, 1)` — a flag 1 do FastReport conta a banda
invisível. **O motor de impressão não imprimia os rodapés de grupo quando a banda de dados era invisível** (o registro invisível não
contava como percorrido) e ignorava as flags das agregadas: agora a banda invisível percorre o dataset (os grupos quebram e fecham), a
agregada sem a flag 1 não a soma, e a flag 2 é o total acumulado (não zera no grupo). Os layouts da Consultoria (participação dos
setores, analítico) usam o mesmo recurso.

## 5. Cobertura (§120 do smoke, 5 checks)

1. o produto sem cadastro **aparece**, rotulado, com entrada e saída certas;
2. entrada × saída por produto, só em quantidade;
3. o rádio (que abre em Pedidos) trocando a saída de venda (70) para pedido de TIPO 'P' (15; o de tipo 'O' fica fora);
4. o filtro preenchido **volta a filtrar** (e o grupo é `LIKE` como digitado);
5. a nota cancelada conta; a impressão nos dois layouts, com os dois ramos, as variáveis e a mensagem sem dados.

Testes de renderização dos dois layouts (735/736).
