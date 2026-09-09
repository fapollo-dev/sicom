# TOTAL POR CARTÃO (`FRMRELCARTOES`) — recon e corte-1 (completo)

`uRelCartoes.pas` (239 linhas) + `uDMRelCartoes`. **382 acessos, 7 operadores, o último em 02/09/2026.**

## 1. O que a tela faz

Soma as vendas em cartão do período por **operadora**, e para cada uma dá o **bruto** e o **líquido da taxa**,
separando por tipo (`:140-160`). Agrupa por operadora, administradora (o parceiro de `CODADM`), dias de
compensação, taxa e empresa. Filtro: período por `DTVENDA` e operadora.

| `OPERADORAS.TIPO` | coluna |
|---|---|
| `'C'` | crédito |
| `'D'` | débito |
| **qualquer outra coisa, inclusive nulo** | **alimentação** |

O "resto vira alimentação" é literal — `CASE WHEN 'C' THEN 0 WHEN 'D' THEN 0 ELSE …`. Voucher, vale e o que
mais existir caem ali. Copiado como está.

## 2. Dois defaults diferentes para a mesma coisa

O líquido é `VALOR − VALOR × TXADM / 100`, e aqui o legado usa **`COALESCE(TXADM, 0)`**: operadora sem taxa
cadastrada não desconta nada.

⚠️ No **saldo da empresa** (`FRMSALDOEMPRESA`) a mesma conta usa **`coalesce(txadm, 0.1)`** — 0,1%. São dois
pontos do legado com defaults diferentes para o mesmo campo, e cada um foi copiado do seu lugar em vez de
uniformizado. Se o cliente algum dia notar a diferença de centavos entre as duas telas, a causa está aqui.

## 3. Outra diferença de escopo com o saldo da empresa

Este relatório é da **venda** no período: entra o cartão **com ou sem baixa**. O saldo da empresa só olha o
que ainda **não foi liberado**, porque lá interessa o que está por receber. As duas telas somam cartão e dão
números diferentes de propósito.

## 4. Estado

Corte único, **completo** — nada ficou de fora. Nenhuma migration de schema foi precisa: `cartao`,
`operadoras` e `parceiros` já tinham tudo.
