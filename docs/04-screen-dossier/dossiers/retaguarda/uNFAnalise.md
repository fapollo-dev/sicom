# ANÁLISE DE NOTAS FISCAIS (`FRMNFANALISE`) — recon e corte-1

`UNFAnalise.pas` (1.547 linhas) + `UdmNFAnalise` + `UAnalisaItemNF` (997). Depois do PDV, **é a tela de maior
uso ainda não migrada**: 704 acessos, 19 operadores, o último em **04/09/2026**.

## 1. O que a tela é

Um **hub de nove análises** sobre notas fiscais (`rgOpcao`, `UNFAnalise.dfm:742`), com um painel de filtros
comum e um `.fr3` por análise:

| # | análise | corte-1 |
|---|---|---|
| 1 | Análise de situação tributária | ✅ |
| 2 | Análise de precificação | — |
| 3 | Situação tributária por produtos | — |
| 4 | Precificação agrupada por fornecedor | — |
| 5 | Precificação agrupada por fornecedor — itens | — |
| 6 | Análise de formas de pagamento | — |
| 7 | Situação tributária por CST | — |
| 8 | Análise de conferência de notas | ✅ |
| 9 | Conferência de ICMS-ST a recolher | — |

Prova por tabela (a regra: o nome é chute, a tabela que o data module consulta é prova): `NF` (11 ocorrências),
`NF_PROD` (14), `PARCEIROS` (10), `CFOP` (10), `PRODUTOS` (8), `ESTOQUE` (5), `CODCONTABILNF` (4),
`MULTI_PRECO`, `INDEXADOR_TRIBUTARIO`, `LOTE_FATURAMENTO`. Tudo o que o corte-1 precisa já existe no Apollo.

⚠️ **não confundir com `FRMCONFERENCIANOTA`**, que já migramos: aquela aprova/cancela a nota recebida; esta
analisa a nota depois de lançada. Nomes parecidos, telas diferentes — foi a armadilha que já me pegou uma vez
(o `FRMCONFERENCIANOTA` casando com `FRMNF` por conter "NF" no meio da palavra).

## 2. O corte-1 — as duas que não dependem de nada

### (1) Situação tributária

Base em `sqqNF` (`UdmNFAnalise.dfm:352`): `NF` + `PARCEIROS` + `CFOP`, por `DTCONTABIL`, com `TOTALPROD`,
`TOTALNF`, `TOTALISENTO` e `TOTALOUTRASDESP`.

**O que dá valor à tela é o filtro "somente diferenças"** (`UNFAnalise.pas:746`):

```sql
N.TOTALNF <> (SELECT CAST(coalesce(SUM(E.VALOR), 0.01) AS NUMERIC(15,2))
                FROM CODCONTABILNF E WHERE E.CODNF = N.CODNF)
```

Ou seja: **a nota cujo rateio contábil não fecha com o total**. Medido em produção: **3.037 das 49.282 notas
(6,2%)**. Cada uma é um lançamento contábil que vai sair errado — e é por isso que 19 operadores abrem esta
tela.

### (8) Conferência de notas

`GetSqlAnaliseConferencia` (`:1257`): as notas com `USULTALTERACAO IS NOT NULL`, com o nome de quem alterou.
É a trilha de quem mexeu na nota depois de lançada.

### Os filtros, que valem para as duas

Período por `DTCONTABIL`, tipo (todas/entrada/saída), número da nota (LIKE parcial), parceiro, razão social
(LIKE), CFOP, "Notas processadas" (o radio pega `PROC='N'` **ou nulo**, `:729`) e "Incluir notas de devolução"
(`:734`, pelo `CFOP.DEVOLUCAO`; CFOP sem marca conta como não-devolução).

## 3. O que a mig 204 trouxe

- **`nf.totaloutrasdesp`** — está na consulta base e é coluna do relatório. Preenchida em **49.282 de 49.282**
  notas do cliente (100%) e **fora da nossa carga**. É a enésima da série; vale como lembrete de conferir as
  colunas da carga a cada tela nova.
- **`cfop.devolucao`** — sem ela não há como aplicar o filtro de devolução. No cliente: 14 CFOPs marcados
  como devolução, 30 como não, 354 sem marca.

## 4. Achado técnico

`nf.cfop` é `varchar(4)` e `cfop.codcfop` é `char(4)` no destino — **o CFOP é código, não número**. Comparar
com inteiro dá `operator does not exist: character = integer`. O filtro converte antes de comparar.

## 5. Próximos cortes

As sete análises restantes. As de precificação (2, 4, 5) dependem do departamento e do agrupamento por
fornecedor e formam um bloco só; a 3 e a 7 são a tributária descendo ao item e ao CST; a 6 sai de
`FATURAMENTO.MODALIDADE`; a 9 monta um demonstrativo de ST com 24 colunas sobre `nfe_nao_cadastradas` e tem o
seu próprio parâmetro (`GET_VLR_MIN_ICMSARECOLHER`).
