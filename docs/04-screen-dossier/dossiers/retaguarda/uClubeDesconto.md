# Clube de desconto — o cadastro das regras, e três defeitos de carga

Migration **285**. Smoke §156.1 a §156.4. Achado da varredura de tabelas sem destino (22/09/2026).
Contagens no Oracle de produção (só leitura).

## 1. Sem tela e sem fonte, mas vivo e grande

**Não existe formulário do clube no `MENUEXPRESS`** — zero ocorrências. O clube não é uma tela: é um
mecanismo que vive dentro do cadastro de cliente e das promoções. No fonte de mai/2020 há só o rastro
dele, `ckbPublicidadeClubeFidelidade` em `uCadClientes.pas` e `VRCLUBE_FIDELIDADE` na agenda de promoção.
As tabelas começam em jul/2020 e o movimento em jun/2021: são **posteriores ao snapshot do fonte**.
Convertido pelo dado, como a reforma tributária, e pelo mesmo motivo.

| | linhas | em 2026 |
|---|---:|---:|
| `CLUBE_DESCONTO` (as regras) | 3.111 | 400 cadastradas |
| `CLUBE_DESCONTO_MOV` (o uso no cupom) | **3.118.725** | **824.491** |
| `CLUBE_DESCONTO_EXT` | 40 | |
| `CLUBE_DESCONTO_PROD` | 273 | |

O movimento cresce todo ano: 201k (2021) · 417k · 385k · 595k · 693k · **824k (2026)**.

## 2. ⚠️ A tabela já existia — e a carga dela tinha três defeitos

`clube_desconto` está no destino desde a **mig 112**, modelada como detalhe da promoção, e **está no plano
de carga**. Esta migration não a cria: conserta o que ela tinha.

### 2.1 A carga perdia o produto de 3.104 das 3.111 regras

`BARRAS` diz sobre qual produto a regra age, está preenchido em **3.104 de 3.111 (99,8%)** e **não existia
no destino**. Sem ela toda regra de preço chega sem saber a que produto se aplica — não é perda parcial, é
a regra inteira virando inútil. São 388 produtos distintos.

Outras nove colunas também ficavam para trás. Destas, só `venda_estoque` tem uso real (1.013 linhas);
`pdv` (6), `hora` (5), `dtalteracao`, `indr_usuario` e `indr_data` são resíduo, e `descricao`, `vrcusto` e
`vrcustorep` estão zeradas. Todas vêm, porque o leiaute as prevê e é barato.

### 2.2 A chave estrangeira rejeitaria 98,5% da carga

A mig 112 criou `idpromocao ... REFERENCES promocao(idpromocao)`. O dado desmente: das 3.111 regras, só
**47 (1,5%)** têm `IDPROMOCAO` existente em `PROMOCAO` — **3.064 são órfãs**; em `CLUBE_DESCONTO_EXT` são
**40 de 40**. O `IDPROMOCAO` do clube é o identificador da promoção **no sistema do clube**, não a nossa.

Como a tabela está no plano, a carga **falharia inteira** nela. A chave saiu; o índice ficou, e o número
está escrito na migration para ninguém restaurá-la. É a mesma armadilha de `MOTIVOS` × `MOTIVOS_OPERACAO`:
o nome sugere um vínculo que o dado nega.

### 2.3 ⚠️ A empresa vem como TEXTO, com lista

`CLUBE_DESCONTO.IDEMPRESA` é **VARCHAR** no legado e contém valores como **`'1,2'`** — uma lista de lojas.
No destino a coluna é `integer`. A carga tentaria gravar `'1,2'` num inteiro e **quebraria a tabela**.

É o mesmo padrão de `COTACAO` e `PEDIDOCOMPRA` (Achado 4 da `FILA-CONVERSAO`): a projeção single-empresa
fica com a **primeira da lista**. Só 50 das 3.111 regras têm a coluna preenchida; as demais caem na loja 1.
A extensão não tem empresa própria (0 de 40) e casa com a regra em 40 de 40, então herda dela — com a
mesma extração, porque o valor do pai também é texto. As duas expressões foram testadas na produção.

## 3. ⚠️ O `valor` muda de unidade conforme a operação

É a regra central do cadastro, e a faixa do dado prova sozinha:

| operação | tipo | n | faixa do valor | o que é |
|---|---|---:|---|---|
| `PRECO` | **nulo** | 2.970 | 0,99 a 419,40 | **preço em reais** |
| `VARIAVEL` | % | 53 | 6 a 20 | **percentual de desconto** |
| `ADICIONAL_FILHO` | % | 8 | 50 | percentual |
| `DESCONTO_POR_PDV` | % | 5 | 100 | percentual (100% = grátis) |
| `CODIGO_PROMOCIONAL` | $ | 1 | 10 | valor em reais |

Tratar tudo como percentual daria **419% de desconto**; tratar tudo como preço venderia a R$ 6,00 o que
deveria ter 6% de desconto. A diferença entre `PRECO` e `VARIAVEL` é exatamente o `TIPO`: nulo significa
que o valor **é** o preço; preenchido significa que é desconto, na unidade que o tipo diz.

O serviço tem **uma** função que resolve isso (`precoEfetivo`) e a resposta devolve `preco_clube` já
calculado mais `unidade_valor` em uma palavra — para que a tela não precise saber ler o par, e ninguém
reimplemente a leitura e erre a unidade. Smoke §156.1.

## 4. As nove operações, e o que cada uma exige

Medido campo a campo nas 3.111 regras (100% salvo onde indicado):

| operação | barras | qtde | qtde paga | valor | tipo | grupo | máximo | pdv |
|---|---|---|---|---|---|---|---|---|
| `PRECO` (2.970) | ✔ | ✔ | — | ✔ | — | ✔ | ✔ | — |
| `VARIAVEL` (53) | ✔ | ✔ | — | ✔ | ✔ | ✔ | ✔ | — |
| `GRATIS` (41) | ✔ | ✔ | 13/41 | — | — | 28/41 | 28/41 | — |
| `GRATIS_FILHO` (14) | ✔ | ✔ | ✔ | — | — | — | 2/14 | — |
| `LEVE_PAGUE` (10) | ✔ | ✔ | ✔ | — | — | ✔ | ✔ | — |
| `ADICIONAL_FILHO` (8) | ✔ | ✔ | ✔ | ✔ | ✔ | — | — | — |
| `ADICIONAL` (8) | ✔ | ✔ | ✔ | — | — | — | — | — |
| `DESCONTO_POR_PDV` (6) | **0** | ✔ | — | 5/6 | ✔ | — | 5/6 | ✔ |
| `CODIGO_PROMOCIONAL` (1) | **0** | ✔ | — | ✔ | ✔ | — | — | — |

**As duas últimas não têm código de barras**: agem sobre o cupom inteiro. Exigir barras de toda regra
impediria cadastrá-las; aceitá-las com barras faria o PDV procurar um produto que a regra não tem. As duas
direções são barradas. Smoke §156.3.

A validação por operação está no schema compartilhado, não no banco, porque o erro precisa chegar ao
operador com o nome do campo: `PRECO` com tipo preenchido, `VARIAVEL` sem tipo, percentual acima de 100 e
**`LEVE_PAGUE` pagando mais do que leva** são todos recusados. Smoke §156.2.

## 5. A trava que o legado não tem: regras sobrepostas

Dois preços de clube para o mesmo produto em vigências que se cruzam tornam o resultado **indeterminado** —
vale o que o banco devolver primeiro. O legado aceita; aqui é **422 `CLUBE_DESCONTO_SOBREPOSTO`**, dizendo
com qual regra conflita. Em janela que não cruza, grava normalmente. Smoke §156.4.

## 6. Escopo e o que fica para depois

Quem cadastra a regra é o operador da retaguarda, e é isso que a tela entrega. O **uso** da regra
(`CLUBE_DESCONTO_MOV`, 3,1 milhões) acontece no PDV, que está **fora de escopo por instrução**: a tabela
entrou no plano com destino e carga, como dado histórico, sem tela.

**Fold declarado:** o movimento tem colunas para quatro integradores de CRM (Izio, Mercafácil, Cresce
Vendas e "sistema") e o status de **todos os quatro é nulo nas 3.118.725 linhas**. Nunca foram usados. As
colunas vêm para a carga não perder o leiaute, mas nenhuma regra depende delas.
