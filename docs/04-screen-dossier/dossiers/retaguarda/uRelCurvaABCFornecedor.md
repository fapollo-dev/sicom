# Curva ABC por fornecedor — `FRMRELCURVAABCFORNECEDOR`

> Fonte: `uRelCurvaABCFornecedor.pas` (458 linhas) + `.dfm`, `uDMRelCurvaABCFornecedor`; layouts "Curva ABC por Fornecedor.fr3" e
> "Curva ABC por Fornecedor com saidas.fr3" (RELATORIOS 86/87 DEFAULT, 702/703 PERSONALIZADO). Produção (só leitura, 08/10/2026):
> **11 acessos, 4 operadores, último 30/09/2026**; menu "Fornecedores › Curva abc por fornecedor"; PERMISSOES só com o gate (64 linhas).
> Apollo: `relatorios/curva-abc-fornecedor` (mig 417), tela `/relatorios/curva-abc-fornecedor`, smoke §300, render `curvaAbcFornecedor.spec.ts`.

## O que é

A curva ABC das **compras**: quanto se comprou de cada fornecedor, por loja, e em que faixa ele cai. A FILA dava a tela como "coberta"
pela curva ABC de vendas (que tem a dimensão fornecedor) — não é a mesma conta: aqui o valor é o **TOTALNF das notas de entrada**.

## A consulta (`GeraConsulta`, :309-396)

- Notas `TIPO = 'E'`, `PROC = 'S'`, `CANCELADA = 'N'`, das lojas do GetMultiEmpresa, no período pela **data contábil** (padrão) ou de
  emissão, com o **CFOP da nota** na lista do campo — a padrão `1102,2102,1403,2403` mais as escolhidas na Pesquisa da GET_CFOP (que
  esconde as 4); campo vazio volta à padrão.
- Por nota: o TOTALNF e a soma de `QUANTIDADE × COALESCE(FATOREMBAL, 1)` dos itens. O `JOIN NF_PROD` tira a nota sem item.
- Por fornecedor × loja: as somas, com as faixas da loja (`EMPRESAS.PC_CURVA_ABC_A/B/C`), em ordem de TOTALNF decrescente.
- Fornecedor: a razão com o modo do `TfrmFiltro` (igual, começa, termina, contém) — LIKE sensível a maiúsculas, como no Oracle.
- "Mostrar vendas": as VENDAS não canceladas do período e das lojas dos produtos cujo `CODFOR` é o fornecedor da linha — a quantidade e
  o total líquido (o item arredondado no IAT 'A' e truncado nos outros; + acréscimos; − promoção, departamento e descontos).

## O A/B/C (o script do .fr3)

`MasterData1OnBeforePrint`, com `EngineOptions.DoublePass`: a 1ª passada soma o TOTALNF; a final calcula o % da linha sobre o total, o
acumulado e a letra — **A** até o corte A da loja da linha, **B** até A+B, **C** até A+B+C. A 1ª linha é sempre A. **Acima de A+B+C a
linha repete a letra da anterior** (o script não tem o `else`): na loja 1 (60/20/10), quem passa de 90% acumulado fica "C". O motor de
.fr3 do Apollo roda o script como está; a grade da tela faz a mesma conta no servidor (`classificar`).

## Folds e decisões

- O legado só imprime; o Apollo mostra também a grade (Consultar).
- O LIKE do Oracle não tem caractere de escape: a barra invertida vira literal no PG; o `_` segue curinga, como lá.
- O F10 do legado (CopyQuery, copia o SQL) não entrou: é ferramenta de suporte.
