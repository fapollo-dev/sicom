# DESCONTO DE TÍTULOS (`FRMDESCONTOTITULO`) — corte-1

`uDescontoTitulo.pas` (1.971) + `.dfm` (1.591) + `udmDescontoTitulo` (558/1.296) + `uReverterDescontoTitulo`.
**5.416 linhas.** 68 acessos, **11 operadores**.

## 1. ⚠️ O nome engana: é ENCONTRO DE CONTAS

Não é desconto bancário de duplicata. É o abatimento de um título **a receber** contra um **a pagar** do
mesmo parceiro — o cliente que também é fornecedor.

O autor do legado documentou a mecânica num comentário dentro do `Gravar` (`:886`), e é a melhor fonte que
encontramos até aqui:

> *"O CAMPO VALOR REAL É O VALOR QUE O USUÁRIO VAI UTILIZAR DO TÍTULO. (…) SEMPRE O MENOR VALOR SERÁ O
> DESCONTADO NO TÍTULO DE MAIOR VALOR. (…) Será gerado um novo título com o valor da diferença."*

Com o exemplo dele:

```
RCB 30,00 — valor real 10,00
APG 12,00 — valor real 12,00
  12,00 − 10,00 = 2,00  → nasce um título de 2,00
  o RCB de 30,00 é baixado PARCIALMENTE para ficar em 10,00
                           e nasce outro título de 20,00
```

Tudo com o mesmo `COD_DESCONTO_TITULO`.

## 2. As duas colunas que amarram a operação

| coluna | marca |
|---|---|
| `COD_DESCONTO_TITULO` | **todos** os títulos da operação |
| `CODGRUPO_DESCONTO_TITULO` | só os **nascidos da diferença** |

É esse par que permite **reverter**: sem saber o que nasceu, não há como desfazer. `CODGRUPO_...` **não
vinha na carga** (mig 226) — a reversão ficaria cega.

## 3. Uso real: pouco volume, muito valor

Medido na produção em 16/09/2026:

| | |
|---|---|
| operações | **18** |
| em títulos a receber | **R$ 254.390,96** |
| em títulos a pagar | **R$ 263.518,12** |
| última operação | **12/09/2026** |

Média de 14 mil por operação, e ativa. É o caso em que contar linhas engana: 18 registros valem mais que
tabelas com milhões.

## 4. Corte-1: a visão

68 acessos contra 18 operações dizem que a tela é **mais consultada que executada**. O corte-1 entrega a
consulta completa — quais títulos entraram, o que nasceu, e a diferença entre as pontas.

## 5. Cobertura (§118 do smoke, 4 checks)

1. o exemplo do próprio autor reproduzido: 4 títulos, 30,00 contra 14,00;
2. o que a operação **gerou** fica marcado (2 de 4), e é o que permite reverter;
3. o detalhe com os dois lados juntos e o título de 2,00 identificado como nascido da diferença;
4. o filtro por parceiro.

## 6. O que falta — o corte-2

**Executar** o encontro de contas. Mexe em cinco tabelas numa transação (`areceber`, `areceber_bx`,
`apagar`, `apagar_bx`, `mov_contas_bancarias`), faz **baixa parcial** dos dois lados e gera títulos novos —
merece o mesmo cuidado que a baixa de títulos teve, e um smoke próprio.

Mais a **reversão** (`uReverterDescontoTitulo`), que desfaz a operação apagando o que nasceu e estornando as
baixas — e que só é possível por causa das duas colunas do §2.
