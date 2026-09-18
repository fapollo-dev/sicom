# FRMRELBALANCETE — Balancete de verificação

**14 acessos · 4 operadores.** `uRelBalancete.pas` (384) + `udmRelBalancete`. Migration **258**.
API `GET contabil/balancete`. Tela `/contabil/balancete`. Smoke §136 (3 checks).

## 1. O que faz

Por conta do plano: **saldo anterior** (Σ débitos − Σ créditos antes do período), **débitos** e **créditos** do
período, **saldo atual**. Faixa de contas pelo código expandido, nível máximo, descrições em degrau, imprimir
analíticas, sintéticas em negrito, contas sem movimento. Fonte: `DIARIO` (1,77 milhão de lançamentos; 131 mil
em 2026) × `PLANO_CONTAS`.

## 2. ⚠️ O roll-up do legado só anda sobre contas com NIVEL — 387 de 11.028

O SQL traz as analíticas; a soma nos pais é feita em memória: `for vNivel := vUltimoNivel-1 downto 1` e, para
cada conta do nível, soma os filhos por `CODPAI`. Medido:

| | |
|---|---:|
| contas do plano | 11.028 |
| com `NIVEL` | **387** (3 · 10 · 18 · 47 · 309) |
| sem `NIVEL` (todas analíticas, código de 15 posições) | **10.641** |
| contas com lançamento | 658 |
| **contas com lançamento e sem nível** | **520** |

O laço nunca visita as 10.641; os totais dos pais ficam sem a maior parte do movimento. Aqui o nível sai do
**código expandido** (1 → 1, `1.1` → 2, `1.1.01` → 3, `1.1.01.01` → 4, 15 posições → 5) e o roll-up é por
**prefixo** — alcança todas as contas, com ou sem `NIVEL`.

## 3. Folds

- Tenant-scoped (o legado monta `D.CODEMPRESA IN (lista)`); o plano é global.
- "Degrau" e "negrito" são apresentação: o retorno traz `nivel` e `sintetica`; a tela desenha.
- O total do rodapé soma as raízes (nível 1) — sem duplicar o que já foi consolidado.
