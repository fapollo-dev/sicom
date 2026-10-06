# FRMRELENTRADAS_FINAN — Entradas × Financeiro

**11 acessos · 3 operadores.** `uRelEntradas_Finan.pas` (233) + `.dfm` + `uDMRelEntradas_Finan`. Migration **262**.
API `GET relatorios/entradas-financeiro`, `/:codnf/titulos` e `/impressao`. Tela
`/relatorios/entradas-financeiro`. Smoke §140 (4 checks).

## 1. O que faz

"Das notas de entrada do período, quais têm título a pagar — e quais não têm?" Grid de cima: `NF` tipo E
por `DTCONTABIL` (`NRONF <> '0'` e não nulo), com TOTALPROD/TOTALNF e o fornecedor (filtro opcional por
fornecedor `FRN='S'`). Grid de baixo: os `APAGAR` com `IDNF = CODNF` da nota selecionada — duplicata,
obs, compra, operador, fornecedor, quitada, valor, juros, vencimento, tipo, banco, parcela, grupo. Os campos de vencimento e emissão
da tela **não filtram** (o `FiltraDoc` está comentado no fonte). Impressão `Notas_fiscais_Entradas_Finan.fr3`.

## 2. O que o dado diz (produção, 18/09/2026)

| | |
|---|---:|
| NF de entrada em 2026 (3 lojas) | **6.547** — loja 1: 4.007 · loja 2: 2.521 · loja 52: 19 |
| `NRONF` '0'/nulo · `DTCONTABIL` nulo · `TOTALPROD` nulo (2026) | 0 · 0 · 0 |
| canceladas (2026) | 1 |
| **loja 1: NF de entrada de 2026 sem NENHUM título a pagar** | **346 de 4.007 (8,6%) — R$ 438 mil** |
| nas 3 lojas, sem título | 515 |

## 3. ✅ Corte 2 pelo fonte (06/10/2026)

O corte 1 tinha chamado de "defeito" e trocado regras do legado; voltam como o fonte:
- **sem filtro de loja** no `sqqNF`: o Apollo traz as notas de todas as lojas que o operador alcança (era só a do login, com LIMIT 3000);
- `COALESCE(TOTALPROD, 0.01)` e `TRUNC(DTEMISSAO)` como o SQL; `ORDER BY DTEMISSAO, NRONF` (o NRONF é texto — ordem binária; o corte 1
  ordenava pela data contábil);
- a cancelada entra (o SQL não filtra) e vem marcada; `NRONF <> '0' AND NRONF IS NOT NULL` literal;
- o grid de títulos sem o filtro de vencimento (morto no fonte) e com os nomes do `sqqPagar` (DESCFORN, DESCOPERADOR, DESCBANCO);
- **Imprimir** (só depois de uma consulta com notas, como o legado): `Notas_fiscais_Entradas_Finan.fr3` (847) com o `cdsNF` no
  `frxDBDatasetNF`, o `cdsPagar` aninhado (os títulos de cada nota, `__MESTRE`) no `frxDBDatasetPagar` e a empresa no `frxDBDataset2`.
  Sem opção de impressão na PERMISSOES: o acesso à tela.
- ficam do Apollo (não mudam a lista padrão): os contadores por nota e no total (`titulos`, `valorTitulos`, `quitados`, `semTitulo`) e o
  filtro `somenteSemTitulo`.

Colunas do grid que o destino não tinha e a 262 acrescenta em `apagar`: `codoperador`, `nrparcela`, `gfat`; índice `ix_apagar_idnf`.
