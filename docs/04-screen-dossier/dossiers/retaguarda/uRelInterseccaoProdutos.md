# INTERSECÇÃO DE PRODUTOS (`FRMRELINTERSECCAOPRODUTOS`) — completa

`uRelInterseccaoProdutos.pas` (371) + `.dfm` (1.469) + `udmRelInterseccaoProdutos`.
**117 acessos, 10 operadores.**

## 1. O que a tela responde

**O que mais o cliente leva quando leva este produto.** Análise de cesta: pega os cupons que contêm o produto
escolhido e soma tudo o que estava junto neles. Serve para decidir gôndola, combo de promoção e sugestão no
PDV.

Os dois eixos do rádio "Tipo de análise": ordenar por **quantidade vendida** ou por **quantidade de cupons**.
Não são a mesma coisa — quantidade alta pode ser um cliente levando muito; cupons altos são muitos clientes
levando. Por isso a grade traz também **% dos cupons**, que é a leitura que decide.

## 2. ⚠️ O legado usa uma tabela de trabalho GLOBAL — e dois operadores se atropelam

O fluxo original (`:150-195`) é em três passos:

1. acha os cupons que contêm o produto;
2. **`DELETE FROM VENDAS_INTER`** (sem filtro nenhum) e grava os códigos lá;
3. soma os itens desses cupons fazendo join com a tabela.

`VENDAS_INTER` é física e global. **Se dois operadores rodam o relatório ao mesmo tempo, o segundo apaga os
cupons do primeiro** — e os dois recebem resultado errado, sem erro na tela. Com 10 operadores usando a tela
isso não é hipótese remota; numa aplicação web, onde todos compartilham o servidor, seria a regra.

Aqui é **uma consulta só**, com os cupons num CTE: mesmo resultado, sem tabela intermediária e sem corrida.
`VENDAS_INTER` não entra no destino — é rascunho, não registro.

## 3. ⚠️ O cupom é `codvendas_legado`, não `codvendas`

No Oracle, `VENDAS.CODVENDAS` identifica o **cupom** — 23.518 cupons para 103.041 linhas em setembro/2026,
**4,4 itens por cupom**. No destino ele não podia ser a PK (a carga precisa de chave por LINHA), então o ETL
o renomeia para `codvendas_legado` e gera um `codvendas` novo por item.

Agrupar por `codvendas` daria **um "cupom" por item**: a análise não encontraria companhia nenhuma e o
relatório voltaria **sempre vazio, sem erro**. Foi exatamente o que o smoke pegou na primeira rodada.

## 4. Duas regras menores que mudam número

- o **próprio produto sai** da lista (`:196`): está em 100% dos cupons por definição;
- o valor é `SUM(QTDE × VRVENDA)`. O SQL guardado no `.dfm` soma `VRVENDA` **sem** a quantidade, mas é o texto
  montado no `.pas` que roda — o do `.dfm` é resíduo de versão anterior, e copiá-lo erraria todo item vendido
  em quantidade maior que 1.

## 5. Cobertura (§113 do smoke, 4 checks)

1. a conta e o percentual: cerveja em 4 cupons, carvão em 3 (75%), guardanapo em 1 (25%);
2. o valor multiplicado pela quantidade, e o cupom cancelado fora;
3. o próprio produto excluído;
4. a ordenação por cupom, o limite de itens e a recusa de produto inexistente.

## 6. O que ficou de fora

**Resolvido de outro jeito:** a exportação da grade é o CSV.

**Ainda falta:** a análise para **vários produtos de uma vez** (o legado aceita um só) — não é do legado, é
uma extensão óbvia que ficou anotada.
