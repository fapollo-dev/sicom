# FRMRELDIARIOCONTABIL — Livro Diário

**4 acessos · 4 operadores.** `uRelDiarioContabil.pas` (239) + `udmRelDiarioContabil`. Migration **270**.
API `GET contabil/diario` (+ `/impressao`). Tela `/contabil/diario`. Smoke §148 (4 checks).

## 1. O que faz

O terceiro livro contábil da casa, ao lado do **balancete** (mig 258) e do **balanço** (mig 265). Cada
lançamento do `DIARIO` do período vira **duas linhas** — uma na conta debitada, outra na creditada — com
dia, código expandido, descrição da conta, histórico (`TRIM(DESCHIST) || ' ' || COMPLEMENTO`), origem,
id de origem, documento e o valor na coluna certa. Ordenado por dia e conta; cabeçalho .fr3 com o
contabilista.

## 2. O `UNION` do legado — fica (corrigido em 06/10/2026)

O legado monta as duas metades com **`UNION`**, não `UNION ALL`: duas linhas iguais em tudo o que o SELECT traz — dia, conta, código,
descrição, histórico, origem, id da origem, documento e valor (sem a loja e sem o código do lançamento) — **colapsam numa só**. O corte 1
trocou por `UNION ALL` dizendo que "num supermercado é rotina"; medido em 2026 (jan-set, lado do débito, por loja): **1 grupo, 2 linhas,
R$ 248,06**. É o livro que o cliente imprime e entrega — volta o `UNION`.

## 3. O que o dado diz (produção, 18/09/2026)

| | |
|---|---:|
| `DIARIO` | 1.769.341 linhas — 2024: 480.888 · 2025: 273.308 · **2026: 131.536** (e 2 em 2027) |
| 2026: `DESCHIST` preenchido | 131.431 de 131.538 (99,9%) |
| 2026: `COMPLEMENTO` preenchido | 127.757 (97%) |
| 2026 por empresa | 74.260 (loja 1) · 55.018 (2) · 2.160 (50) · 71 (52) · 29 (51) |
| `CONTABILISTA` | 4 linhas, uma por empresa, todas do mesmo contador (CRC 44122) |

## 4. ✅ Corte 2 pelo fonte (06/10/2026)

- `UNION` (§2); as lojas do `GetMultiEmpresa` (era só a do login); `TRIM(DESCHIST) || ' ' || COMPLEMENTO` com o espaço que sobra quando
  não há complemento (a concatenação do Oracle); `ORDER BY 1, 2` (dia, conta — o desempate por histórico/origem só fixa o que o Oracle
  deixa ao acaso); sem LIMIT; os filtros de conta e de origem do corte 1 saíram (o legado não tem — e mudariam o livro impresso);
- consulta vazia: "Não há lançamentos no filtro informado informado. Verifique!";
- **Imprimir** → `LivroDiarioContabil.fr3` (812): `dbdConsulta` (o layout agrupa por DIA, com o total do dia e o acumulado — o `SUM(…, 2)`)
  e `dbdEmpresa` — o `cdsEmpresa` do `udmRelDiarioContabil` tem o SQL fixo `WHERE E.CODEMPRESA IN (1)` e a tela não o reabre: sai
  **sempre a loja 1** com o contabilista. Variáveis DtInicial, DtFinal, Empresa (a lista) e PaginaInicial (`edtPagina`, padrão 1). Sem
  opção de impressão na PERMISSOES: o acesso à tela;
- ficam do Apollo, só na tela: o nome da origem (`origem_contabil`, mig 209), o contabilista e os totais com a diferença débito − crédito.
- `contabilista` não existia no destino: entra na 270 e no plano de carga.
