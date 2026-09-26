# FLUXO DE CARTÕES (`FRMFLUXOCARTOES`) — completa

`uFluxoCartoes.pas` + `udmFluxoCartoes`. **98 acessos, 7 operadores.**

## 1. O que a tela responde

Quanto a loja vendeu no cartão, **quanto já caiu na conta e quanto ainda vai cair** — por dia e, abrindo o
dia, por operadora. É a leitura que o extrato bancário não dá: o dinheiro existe, mas ainda não está lá.

`CARTAO` tem **2.059.893 linhas** em 2.201 dias, a última de hoje (15/09/2026). `LIBERADO = 'S'` é o que a
operadora já pagou.

## 2. ⚠️ O legado mostra o mesmo dia duas vezes — e chama as duas de "total"

```sql
SELECT TRUNC(C.DTVENDA), SUM(C.VALOR) TOTALVENDASMES, ...
  FROM CARTAO C
 GROUP BY TRUNC(C.DTVENDA), C.LIBERADO      -- ← LIBERADO no GROUP BY
```

Como `LIBERADO` entra no agrupamento, **todo dia com parte recebida e parte pendente vira duas linhas** — e
em nenhuma delas `TOTALVENDASMES` é o total do dia: é o total daquele status.

Medido na produção: **1.485 dos 2.201 dias (67%)** saem duplicados. O operador vê o dia repetido e soma na
cabeça.

Aqui é **uma linha por dia**, com as três colunas que o nome delas promete — vendido, recebido, a receber —
e a soma fecha.

## 3. O detalhe por operadora

A segunda consulta da tela quebra o dia por bandeira (`LEFT JOIN OPERADORAS`). É assim que se descobre qual
operadora está atrasando o repasse — a informação que justifica a ligação para a adquirente.

Operadora sem cadastro aparece como `(SEM OPERADORA)` em vez de linha em branco.

## 4. Cobertura (§115 do smoke, 4 checks)

1. o dia que o legado duplicaria sai em **uma** linha, com vendido/recebido/a receber fechando;
2. o total do período separando o que caiu do que falta cair;
3. o detalhe por operadora;
4. o filtro por operadora e a recusa de data invertida.

## 5. O que ficou de fora

**Resolvido de outro jeito:** a exportação é o CSV da grade.

**✅ A tela irmã `uFluxoCartaoBandeira` já estava coberta (conferido em 25/09/2026):** apesar do nome e do título da coluna
("Bandeira"), a consulta dela (`sqqFluxoCartoesBandeiras`, udmFluxoCartoes.dfm:121-144) agrupa o dia por **OPERADORA**
(`LEFT JOIN OPERADORAS … GROUP BY TRUNC(C.DTVENDA), O.OPERADORA, C.LIBERADO`) — não por `CARTAO.BANDEIRA`, que nem
existe na tabela da produção. É o "abrir o dia por operadora" do Apollo (smoke §115.3), com os três totais do rodapé.
