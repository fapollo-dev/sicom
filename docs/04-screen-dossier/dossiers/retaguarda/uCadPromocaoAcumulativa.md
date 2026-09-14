# PROMOÇÃO ACUMULATIVA (`FRMCADPROMOCAOACUMULATIVA`) — completa

`uCadPromocaoAcumulativa.pas` (619) + `.dfm` (580) + `uDMCadPromocaoAcumulativa` (98/269).
**199 acessos, 26 operadores** — o maior número de operadores do que restava na fila.

## 1. O que a tela é

**Leve N, pague menos.** O cliente acumula `QTDE` unidades do mesmo produto no cupom e o preço cai
`DESCONTO`. A tela é o **cadastro** da regra; quem a aplica é o PDV, que está fora de escopo.

Uso real (produção, 14/09/2026): **6 promoções em toda a história**, de 03/10/2020 a 18/09/2024 — uma por
grupo de preço e uma marcada como atacarejo. Os 199 acessos são gente **abrindo para conferir**, não para
cadastrar: a tela é muito mais consultada que alimentada.

## 2. ⚠️ `IDEMPRESA` é uma LISTA, não um inteiro

`VARCHAR2(30)` no legado, gravada como **`;1;2;`** — ponto-e-vírgula na frente e atrás, normalizado pelo
próprio `ValidaEmpresas:485`. Uma promoção vale para **várias lojas** ao mesmo tempo.

O formato não é enfeite: é o que permite procurar `;1;` dentro da string **sem casar com `;12;`**. Toda
comparação de loja, aqui e nas validações de colisão, é feita assim. Copiado como está — virar tabela-filha
agora quebraria a carga e a leitura que o PDV faz.

## 3. As quatro validações do gravar, na ordem (`btnGravarClick:195`)

| # | validação | regra |
|---|---|---|
| 1 | `ValidaDataHora:445` | término **estritamente maior** que início — e compara data **com hora** |
| 2 | `ValidaEmpresas:465` | quantidade > 0, desconto > 0, ao menos uma loja (e normaliza a string) |
| 3 | `ValidaProdutoPromocao` | o produto não pode estar em outra promoção com período **sobreposto** na mesma loja |
| 4 | `ValidaGrupoPrecoPromocao:276` | o mesmo, pelo **grupo de preço** do produto |

### A sobreposição, em três formas (`:302-312`)

```
o outro COMEÇA dentro da janela   → dtini_outro BETWEEN ini E fim
o outro TERMINA dentro da janela  → dtfim_outro BETWEEN ini E fim
o outro ENVOLVE a janela inteira  → dtini_outro <= ini AND dtfim_outro >= fim
```

Com `>=`/`<=`: janelas que se encostam pelas pontas **colidem**. E a colisão só vale se houver **loja em
comum** entre as duas listas — o legado varre a lista de empresas uma a uma procurando `;n;` na outra.

A validação por grupo de preço é a mesma, com o alvo trocado: em vez do produto, **todos os produtos do
mesmo grupo**. É a que impede cadastrar dois produtos irmãos em promoções que se cruzam.

## 4. Só produto ativo

`VerificarProdutoAtivo:390` consulta `get_produtos` com `ativo = 'S'`. Produto inativo não entra em promoção.

## 5. Os DOIS botões de excluir — que não são o mesmo

### 5.1 Excluir a promoção (`btnExcluirClick:130`)

⚠️ **exige SENHA ADMINISTRATIVA.** O legado abre `dmPrincipal.SenhaAdministrativa('ADM')` **antes de
qualquer coisa** e sai se não passar. É a única operação da tela com essa trava, e faz sentido: apagar a
promoção some com o desconto que a loja está anunciando. Depois grava **log de exclusão** com histórico em
texto — quem apagou, o quê e quando.

### 5.2 Excluir a promoção do GRUPO INTEIRO (`btnExcluirPromocaoClick:156`)

O outro botão percorre a grade de produtos do grupo de preço e, para cada um, roda:

```sql
DELETE FROM PROMOCAO_ACUMULATIVA WHERE IDPRODUTO = <o produto>
```

⚠️ **sem filtro de período e sem filtro de loja.** Apaga **todas** as promoções daquele produto — de
qualquer data e de qualquer loja, inclusive as já encerradas e as de lojas onde o operador nem trabalha. É um
botão de estrago largo, e é assim no legado. Mantido igual, com a mesma senha administrativa e devolvendo o
total apagado, para a tela poder dizer o tamanho do estrago **antes** de confirmar.

## 6. A grade do grupo de preço (`dbgPromocao`)

Quando o produto tem grupo de preço, a tela lista **todos os produtos do grupo** com a promoção de cada um
(`sqqProdutosPromocao`). O `LEFT JOIN` parte de `PRODUTOS`, então:

- aparecem também os irmãos **sem** promoção, com as colunas de promoção vazias;
- e o join **multiplica**: um produto com três promoções aparece **três vezes**. Não é defeito — é o que
  deixa o operador ver todas as promoções que o botão do §5.2 vai levar embora.

## 7. A pesquisa tem TRÊS modos — e "aberta" não é "vigente"

`ChamaTelaOpcoes:254` abre um diálogo com *Trazer somente abertas / somente fechadas / todas*, e o critério
não é o que se imagina:

```
abertas  → FIM >= TRUNC(SYSDATE)
fechadas → FIM <  TRUNC(SYSDATE)
```

**Uma promoção que só começa semana que vem conta como ABERTA.** Chamar isso de "vigente" (`now()` entre
início e fim) excluiria a agenda futura — que é justamente o que o operador monta nesta tela.

## 8. Auditoria

`USUINCLUSAO` é gravado num **`UPDATE` separado**, logo após o insert (`InserirUsuario:181`) — o legado não
o põe no próprio `INSERT`. Aqui vai junto, no insert, porque o efeito é o mesmo e uma escrita a menos não
muda regra nenhuma. `USULTALTERACAO` e `DTULTIMALTERACAO` na alteração; `DTCADASTRO` na inclusão.

## 9. Cobertura (§106 do smoke, 11 checks)

1. a lista de lojas gravada como `;1;2;`;
2. as três formas de sobreposição — duas recusadas, e a janela que termina antes passa;
3. a colisão é **por loja**: a mesma janela entra numa loja diferente;
4. a colisão pelo **grupo de preço**, com produto irmão;
5. as recusas: quantidade zero, desconto zero, sem loja, término igual ao início, produto inativo;
6. a lista é da loja da sessão (a promoção só da loja 51 não aparece para quem está na 1), e a exclusão
   remove a promoção;
7. **excluir sem senha administrativa é recusado**;
8. com a senha certa a promoção sai **e o log é gravado** (`historico_dinamico`);
9. a grade do grupo traz uma linha **por promoção**, não por produto;
10. os três modos de pesquisa, com a promoção futura contando como **aberta**;
11. o excluir-do-grupo apaga tudo dos produtos do grupo — inclusive a promoção de 2019.

## 10. O que ficou de fora

- o **visualizador** de histórico de exclusão (`BtnHistoricoClick:242`) e de registros de log
  (`MniRegistroLogClick`): o log **é gravado** (§5.1), o que falta é a tela genérica que o exibe, e o Apollo
  tem a sua própria;
- a **busca de produto por F-key** com a tela de pesquisa (`btnBuscaProdutoClick:104`): aqui o código é
  digitado e o produto é validado no gravar.
