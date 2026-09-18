# FRMRELENTRADAS_FINAN — Entradas × Financeiro

**11 acessos · 3 operadores.** `uRelEntradas_Finan.pas` (233) + `.dfm` + `uDMRelEntradas_Finan`. Migration **262**.
API `GET relatorios/entradas-financeiro` e `GET relatorios/entradas-financeiro/:codnf/titulos`. Tela
`/relatorios/entradas-financeiro`. Smoke §140 (3 checks).

## 1. O que faz

"Das notas de entrada do período, quais têm título a pagar — e quais não têm?" Grid de cima: `NF` tipo E
por `DTCONTABIL` (`NRONF <> '0'` e não nulo), com TOTALPROD/TOTALNF e o fornecedor (filtro opcional por
fornecedor `FRN='S'`). Grid de baixo: os `APAGAR` com `IDNF = CODNF` da nota selecionada — duplicata,
obs, compra, operador, fornecedor, quitada, valor, juros, vencimento, tipo, banco, parcela, grupo — com
filtro por vencimento. Impressão `Notas_fiscais_Entradas_Finan.fr3`.

## 2. O que o dado diz (produção, 18/09/2026)

| | |
|---|---:|
| NF de entrada em 2026 (3 lojas) | **6.547** — loja 1: 4.007 · loja 2: 2.521 · loja 52: 19 |
| `NRONF` '0'/nulo · `DTCONTABIL` nulo · `TOTALPROD` nulo (2026) | 0 · 0 · 0 |
| canceladas (2026) | 1 |
| **loja 1: NF de entrada de 2026 sem NENHUM título a pagar** | **346 de 4.007 (8,6%) — R$ 438 mil** |
| nas 3 lojas, sem título | 515 |

## 3. Defeitos do legado e o que o Apollo faz

- **Sem filtro de empresa**: a tela mostra as três lojas juntas. Aqui tenant-scoped.
- `COALESCE(TOTALPROD, 0.01)`: gambiarra de divisor para o .fr3; não replicada (0 nulos; 0,01 seria
  inventar número).
- Não filtra `CANCELADA`: aqui a cancelada vem **marcada**, não escondida.
- **O número que a tela existe para achar** vem pronto: cada nota traz `titulos`, `valorTitulos`,
  `quitados`; o total traz `semTitulo`/`valorSemTitulo`; e há o filtro `somenteSemTitulo` (`boolQuery`,
  lição 60).
- O grid de títulos só abre nota da própria loja (422 para nota de outra).

Colunas do grid que o destino não tinha e a 262 acrescenta em `apagar`: `codoperador`, `nrparcela`, `gfat`;
índice `ix_apagar_idnf`.

## 4. Fora

O .fr3 (impressão) — a tela web imprime pelo navegador.
