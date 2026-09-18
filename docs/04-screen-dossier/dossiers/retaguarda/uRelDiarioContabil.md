# FRMRELDIARIOCONTABIL — Livro Diário

**4 acessos · 4 operadores.** `uRelDiarioContabil.pas` (239) + `udmRelDiarioContabil`. Migration **270**.
API `GET contabil/diario`. Tela `/contabil/diario`. Smoke §148 (3 checks).

## 1. O que faz

O terceiro livro contábil da casa, ao lado do **balancete** (mig 258) e do **balanço** (mig 265). Cada
lançamento do `DIARIO` do período vira **duas linhas** — uma na conta debitada, outra na creditada — com
dia, código expandido, descrição da conta, histórico (`TRIM(DESCHIST) || ' ' || COMPLEMENTO`), origem,
id de origem, documento e o valor na coluna certa. Ordenado por dia e conta; cabeçalho .fr3 com o
contabilista.

## 2. ⚠️ O `UNION` que apaga lançamento

O legado monta as duas metades com **`UNION`**, não `UNION ALL`. Dois lançamentos idênticos em tudo —
mesmo dia, conta, histórico, origem, documento e valor — **colapsam numa linha só**, e o livro Diário
passa a mostrar menos do que o diário tem. Num supermercado, lançamento repetido idêntico no mesmo dia é
rotina (dois cupons de mesmo valor pela mesma integração). Aqui é `UNION ALL`, com o `coddiario` em cada
linha.

## 3. O que o dado diz (produção, 18/09/2026)

| | |
|---|---:|
| `DIARIO` | 1.769.341 linhas — 2024: 480.888 · 2025: 273.308 · **2026: 131.536** (e 2 em 2027) |
| 2026: `DESCHIST` preenchido | 131.431 de 131.538 (99,9%) |
| 2026: `COMPLEMENTO` preenchido | 127.757 (97%) |
| 2026 por empresa | 74.260 (loja 1) · 55.018 (2) · 2.160 (50) · 71 (52) · 29 (51) |
| `CONTABILISTA` | 4 linhas, uma por empresa, todas do mesmo contador (CRC 44122) |

## 4. Folds

- **tenant-scoped** (o legado soma as cinco empresas com `CODEMPRESA IN (...)`);
- o nome da origem vem de `origem_contabil` (mig 209) — "INTEGRAÇÃO DE BAIXA DE CARTÕES" em vez de "51";
- `totais` traz débito, crédito, a **diferença** e quantos lançamentos têm **uma perna só**
  (`contadebito` ou `contacredito` nulo) — no legado esses viravam uma linha sem contrapartida e ninguém
  contava;
- filtros novos: conta (prefixo do código expandido) e origem;
- `contabilista` não existia no destino: entra na 270 e no plano de carga.
