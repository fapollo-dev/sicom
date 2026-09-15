# DIAS DE ESTOQUE / COBERTURA (`FRMRELDDE`) — completa

`URelDDE.pas` (373) + `.dfm` (1.181) + **`uDDE.pas` (318)**, onde vive a conta. **132 acessos, 5 operadores.**

## 1. A pergunta que a tela responde

**Com o que tenho na prateleira, quantos dias eu aguento?**

```
média diária = quantidade vendida na janela ÷ dias da janela
cobertura    = estoque ÷ média diária          (em dias, truncado para inteiro)
```

É o número que o comprador olha antes de emitir o pedido — mais direto que "tenho 100 unidades", porque 100
unidades podem ser três dias ou três meses.

## 2. ⚠️ A tabela de 4 milhões de linhas que faltava na carga

A venda vem de **`MOVIMENTACAO_DIARIA`** — a consolidação por produto e por dia
(`IDEMPRESA · CODPRODUTO · DATA · QTDE`). Medida na produção em 15/09/2026:

| | |
|---|---|
| linhas | **4.034.759** |
| período | 02/01/2019 → **14/09/2026** |
| produtos | 18.296 |

**Não estava no destino nem no plano de carga** (mig 220 cria a tabela; o `plano-tabelas.json` passou de 153
para 154 tabelas, com ela na fase 2). É a **maior tabela ausente** encontrada até aqui.

E ela existe por um motivo: somar `vendas` (18,9 milhões de linhas) para obter a mesma média custa uma ordem
de grandeza mais. O legado mantém essa consolidação justamente para o relatório abrir rápido.

## 3. Os três casos da conta (`GetSQLBaseDiasEstoque:19`)

| caso | cobertura |
|---|---|
| estoque **negativo** | **0** — não se cobre dia nenhum com estoque no vermelho, e a divisão daria número negativo sem sentido |
| **vendeu** na janela | `estoque ÷ (vendido ÷ dias)`, truncado |
| **não vendeu** | o legado grava **`-999999`** |

### ⚠️ O sentinela que não pode chegar ao comprador

`-999999` não é cobertura: é o jeito do Delphi dizer *"não dá para calcular"* num campo numérico. Repassado
como está, ele poria **"-999999 dias"** na tela e, ao ordenar por cobertura, jogaria justamente esses itens
para o **topo** — como se fossem os mais urgentes, quando são os que ninguém comprou.

Aqui a cobertura vem **nula**, com `sem_venda` ao lado, e a tela escreve **"sem venda no período"**.

## 4. O estoque somado

`ESTOQUE + ESTOQUE_DEP` (loja + depósito). Neste cliente o depósito está zerado — soma zero, e fica fiel para
quem usar. (Ver `uProdutosRel.md` §2: escolher só a gêmea daria tudo zero.)

## 5. Os dois filtros

- **"só os que venderam"** — tira o produto parado da lista;
- **"cobertura até N dias"** — o filtro de ruptura: o que não cobre a próxima entrega.

## 6. Cobertura (§112 do smoke, 4 checks)

1. a conta: 100 em estoque vendendo 10/dia = 10 dias; 6 vendendo 3/dia = 2;
2. estoque negativo cobre **zero**;
3. o sentinela `-999999` vira nulo + "sem venda no período";
4. os dois filtros.

## 7. O que ficou de fora

**Resolvido de outro jeito:** a exportação para Excel do legado (`NomeArquivoExcel`) é o CSV da grade.

**Ainda falta:** o `GET_TROCAS_PRODUTO`, que o legado subtrai do estoque **só no ramo dos não vendidos** e
não no dos vendidos — uma inconsistência do próprio fonte que preferi não replicar sem entender o porquê; e
os níveis expandidos da impressão.
