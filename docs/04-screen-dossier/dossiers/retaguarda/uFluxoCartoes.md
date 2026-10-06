# FLUXO DE CARTÕES (`FRMFLUXOCARTOES`) — completa (impressão e fidelidade em 06/10/2026)

`uFluxoCartoes.pas` + `udmFluxoCartoes`. **98 acessos, 7 operadores.**

## 1. O que a tela responde

Quanto a loja vendeu no cartão, **quanto já caiu na conta e quanto ainda vai cair** — por dia e, abrindo o
dia, por operadora. É a leitura que o extrato bancário não dá: o dinheiro existe, mas ainda não está lá.

`CARTAO` tem **2.059.893 linhas** em 2.201 dias, a última de hoje (15/09/2026). `LIBERADO = 'S'` é o que a
operadora já pagou.

## 2. A grade: uma linha por dia (corrigido em 06/10/2026)

```sql
SELECT TRUNC(C.DTVENDA), SUM(C.VALOR) TOTALVENDASMES,
       COALESCE(CASE WHEN C.LIBERADO = 'N' THEN SUM(C.VALOR) END, 0) VENDASNAORECEBIDAS,
       COALESCE(CASE WHEN C.LIBERADO = 'S' THEN SUM(C.VALOR) END, 0) VENDASRECEBIDAS
  FROM CARTAO C WHERE TRUNC(C.DTVENDA) BETWEEN :DTINI AND :DTFIM AND C.IDEMPRESA IN (GetMultiEmpresa)
 GROUP BY TRUNC(C.DTVENDA), C.LIBERADO
```

O SQL sai com uma linha por status, mas o `btnPesquisarClick` **soma as do mesmo dia** no `cdsMontaGridFluxoCartao`
(`Locate('DTVENDA')` + Edit): a grade do legado já é uma linha por dia. ⚠️ **O dossiê de 15/09 dizia que o legado mostrava o dia
duplicado — errado** (leu só o SQL, não o laço que monta a grade). O resultado do Apollo era o mesmo; o texto foi corrigido.

O que estava diferente e foi corrigido:
- **LIBERADO nulo** (1.969 cartões na produção): entra no TOTAL e em nenhuma das duas colunas — o Apollo o contava como "a receber";
- **as lojas**: as do `GetMultiEmpresa` (o Apollo usava só a do login);
- **o dia**: o da loja (o Oracle guarda a hora local; `TRUNC`), não o do UTC.

## 3. O detalhe por operadora

A segunda consulta da tela quebra o dia por bandeira (`LEFT JOIN OPERADORAS`). É assim que se descobre qual
operadora está atrasando o repasse — a informação que justifica a ligação para a adquirente.

Agrupa pelo **nome** da operadora (`GROUP BY … O.OPERADORA` + `Locate('DTVENDA;OPERADORA')`), em ordem de nome
(`IndexFieldNames := 'OPERADORA'`); operadora sem cadastro sai com o nome vazio, como no legado.

## 4. A impressão (`btnImprimirClick`) ✅ 06/10/2026

`Relatorios\Rel_Fluxo_Cartoes.fr3` (974) com a grade no `frxFluxoCartao` e as variáveis `DtIncial` (sic), `DtFinal` e `Empresa`
(o texto do `GetMultiEmpresa`, "1,2").

## 5. Cobertura (§115 do smoke, 5 checks; teste de renderização do 974)

1. uma linha por dia, com o dia da loja;
2. LIBERADO nulo só no total;
3. o detalhe por operadora pelo nome, com as lojas;
4. as lojas, o filtro por operadora e a data invertida;
5. o Imprimir no layout do cliente e o "sem dados".

## 6. O que ficou de fora

**Resolvido de outro jeito:** a exportação é o CSV da grade.

**✅ A tela irmã `uFluxoCartaoBandeira` já estava coberta (conferido em 25/09/2026):** apesar do nome e do título da coluna
("Bandeira"), a consulta dela (`sqqFluxoCartoesBandeiras`, udmFluxoCartoes.dfm:121-144) agrupa o dia por **OPERADORA**
(`LEFT JOIN OPERADORAS … GROUP BY TRUNC(C.DTVENDA), O.OPERADORA, C.LIBERADO`) — não por `CARTAO.BANDEIRA`, que nem
existe na tabela da produção. É o "abrir o dia por operadora" do Apollo (smoke §115.3), com os três totais do rodapé.
