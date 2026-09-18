# FRMRELBALANCO — Balanço patrimonial

**8 acessos · 3 operadores.** `uRelBalanco.pas` (239) + `udmRelBalanco`. Migration **265**.
API `GET contabil/balanco`. Tela `/contabil/balanco`. Smoke §143 (3 checks).

## 1. O que faz

O irmão patrimonial do balancete (mig 258): mesmas contas e mesmo diário, mas **só ativo e passivo**
(`PP.CODIEXPANDIDO < '3'`) e numa **data**. Saldo anterior = tudo lançado antes do 1º dia do mês da data;
débito e crédito = o movimento do mês até a data; saldo atual = anterior + débito − crédito. Débito soma
positivo, crédito negativo no saldo anterior (`SUM(D.VALOR)*-1`). Checkboxes: Degrau (indentação por
nível), Analíticas e Sem movimento. Impressão em .fr3 com página inicial configurável.

## 2. ⚠️ O modo "só sintéticas" devolve zero linhas — sempre

Desmarcar "Analíticas" acrescenta `AND PP.CLASSE = 'S'`. Em produção (18/09/2026) `PLANO_CONTAS.CLASSE`
tem só dois valores:

| classe | contas | nas patrimoniais (< '3') |
|---|---:|---:|
| A | 10.950 | 10.816 |
| T | 78 | 55 |
| **S** | **0** | **0** |

Aqui, como no balancete, **sintética = conta que tem filha** (ou `CLASSE` em S/T), e o roll-up soma por
prefixo do código expandido. `totais.classeS` devolve o número do legado (0) para a tela poder explicar.

## 3. Outros folds

- o legado casa pai×filha com `Q.CODIEXPANDIDO LIKE PP.CODIEXPANDIDO || '%'`, **sem separador** — o pai
  "1" abocanharia um "10" se existisse; aqui o prefixo inclui o ponto;
- multi-empresa por `CODEMPRESA IN (...)`; aqui tenant-scoped (2026: 74.260 lançamentos na loja 1, 55.018
  na 2, 2.160 na 50, 71 na 52, 29 na 51);
- a fronteira do saldo anterior (`edtDtIni − dia + 1`) vai na resposta como `competencia`;
- `diferenca` (ativo + passivo) vem calculada — no legado a conferência era visual;
- 131.487 lançamentos de 2026 tocam contas patrimoniais (R$ 134,1 mi).

## 4. Fora

O .fr3 e o campo "página inicial" da impressão.
