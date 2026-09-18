# FRMRELATORIOCAIXADME — Caixa DME

**9 acessos · 2 operadores** (último 17/08/2026). `uRelatorioCaixaDME.pas` (246). Migration **264**.
API `GET cobranca/caixa-dme`. Tela `/cobranca/caixa-dme`. Smoke §142 (2 checks).

## 1. O que faz

A **DME** (Declaração de Operações Liquidadas com Moeda em Espécie, IN RFB 1.761/2017): por pessoa, as
operações em dinheiro a partir de R$ 30.000 no mês. A tela soma o `CAIXA` com `TIPORECURSO='DINHEIRO'`
por parceiro **não funcionário** (`CODPARCEIRO<>0`, `COALESCE(FUN,'N')='N'`), separa ARECEBER (Σ>0) de
APAGAR (Σ<0) pelo sinal, e mantém quem passa de `ABS(SUM(VALOR)) > 30000` no período. Sintético = uma
linha por parceiro × tipo (razão, CNPJ/CPF de `PARCEIROS_END`, total, empresa); analítico = todos os
lançamentos em dinheiro de quem passou. Multi-empresa por `IDEMPRESA IN (...)`.

## 2. O que o dado diz (produção, 18/09/2026)

| | |
|---|---:|
| 2026, loja 1 — passam | 5 fornecedores (APAGAR, R$ 478 mil) · 3 clientes (ARECEBER, R$ 525 mil) |
| … o maior | JF SUPERMERCADOS: R$ 461 mil recebidos + R$ 44 mil pagos |
| 2026, loja 2 · 2025 (lojas 1/2) | 1 + 2 · 6+2 / 2+2 |
| `TIPORECURSO` em 2026 | 'DINHEIRO' 10.055 · **'1 - DINHEIRO' 1.636** (a tela ignora a variante) |
| lançamentos em dinheiro **sem parceiro** (2026) | **8.618 — R$ 3,9 mi** (invisíveis à DME por construção) |
| parceiros com 2+ endereços (`PARCEIROS_END`) · com um marcado padrão | 24 · 1 |
| … que caem no recorte de 2026 | 1 (a linha dobra e a soma dobra) |

## 3. O que o Apollo faz diferente (folds documentados na migration)

- **Conta a variante '1 - DINHEIRO'** — dinheiro é dinheiro para a RFB; em 2026 isso não muda quem passa
  (0 parceiros cruzam só com a variante), mas o valor declarado fica certo.
- **Um endereço por parceiro** (o padrão; senão o de menor código) — o `LEFT JOIN PARCEIROS_END` do
  legado dobrava a soma de quem tem dois endereços.
- **Tenant-scoped.**
- `totais.semParceiro`: o dinheiro sem parceiro do período, para quem declara saber que existe.
- Analítico lista os dois tipos de quem passou, como o legado (`CODPARCEIRO IN (SELECT … FROM TEMP)`).

## 4. Fora

O .fr3 de impressão.
