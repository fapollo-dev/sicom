# FATURAMENTO POR MÊS (`FRMRELFATURAMENTO`) — completa

`uRelFaturamento.pas` (286) + `.dfm` (925) + `udmRelFaturamento`. **80 acessos, 7 operadores.**

## 1. ⚠️ O relatório do legado mostra 0,04% do faturamento deste cliente

O SQL original soma **duas** pernas:

```sql
SELECT ... FROM REDUCAOZ  ...            -- a venda do ECF, pela Redução Z
UNION
SELECT ... FROM NF WHERE CFOP IN (5102,6102,5403,6403,5405,6405)
                     AND CANCELADA='N' AND PROC='S'
```

Isso era certo na época do cupom fiscal de impressora — e deixou de ser quando a loja passou a emitir
**NFC-e**. Medido na produção em 16/09/2026, agosto/2026:

| perna | valor |
|---|---|
| `REDUCAOZ` | **0 linhas na tabela inteira** — o cliente nunca teve ECF |
| `NF` nos 6 CFOPs | 2 notas, **R$ 872,74** |
| **venda NFC-e** (200.550 itens) | **R$ 2.233.973,50** |

**O relatório entrega 872,74 onde o faturamento foi 2,23 milhões.** Não é arredondamento nem recorte: é a
tela inteira olhando para um canal que a loja não usa mais.

## 2. A terceira perna

Aqui são **três**, cada uma visível na grade: Redução Z (para quem ainda tem ECF), nota fiscal e **NFC-e**.

**Sem dupla contagem**, e isso foi medido: as vendas do mês são 100% `venda_nfc = 'S'` (modelo 65) e as notas
de saída são todas **modelo 55**. São canais distintos — balcão e nota para empresa.

O truncamento por `IAT` é o mesmo das outras telas de venda: item pesado (`'A'`) arredonda, o resto trunca.

## 3. O que não entra

Da perna da nota: **cancelada**, **não processada** e **CFOP fora da lista** de venda (5152, por exemplo, é
transferência). Da perna NFC-e: **venda cancelada**. No teste, deixar qualquer uma entrar pularia o mês em
26 mil.

## 4. `REDUCAOZ` criada vazia, de propósito

A tabela não existia no destino (0 linhas na origem). Criada assim mesmo por dois motivos: a consulta de três
pernas **quebraria** sem ela, e outro tenant pode ter ECF — aí a perna passa a valer sem mexer no código.

## 5. Cobertura (§116 do smoke, 3 checks)

1. as três pernas somando e aparecendo separadas (300 + 872,74 + 2.500 = 3.672,74);
2. o que não entra: cancelada, não processada, CFOP fora da lista e venda cancelada;
3. a competência mensal com primeiro e último dia, e os totais por origem.

## 6. O que ficou de fora

**Resolvido de outro jeito:** o gráfico do legado — a grade traz os números, e a exportação leva para onde o
gráfico for feito.
