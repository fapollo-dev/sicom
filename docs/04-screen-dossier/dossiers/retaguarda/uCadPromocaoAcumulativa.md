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

## 5. Auditoria

`USUINCLUSAO` é gravado num **`UPDATE` separado**, logo após o insert (`InserirUsuario:181`) — o legado não
o põe no próprio `INSERT`. Aqui vai junto, no insert, porque o efeito é o mesmo e uma escrita a menos não
muda regra nenhuma. `USULTALTERACAO` e `DTULTIMALTERACAO` na alteração; `DTCADASTRO` na inclusão.

## 6. Cobertura (§106 do smoke, 6 checks)

1. a lista de lojas gravada como `;1;2;`;
2. as três formas de sobreposição — duas recusadas, e a janela que termina antes passa;
3. a colisão é **por loja**: a mesma janela entra numa loja diferente;
4. a colisão pelo **grupo de preço**, com produto irmão;
5. as recusas: quantidade zero, desconto zero, sem loja, término igual ao início, produto inativo;
6. a lista é da loja da sessão (a promoção só da loja 51 não aparece para quem está na 1), e a exclusão
   remove a promoção.

## 7. O que ficou de fora

- o **histórico de exclusão** (`BtnHistoricoClick:242`) e os **registros de log** (`MniRegistroLogClick`):
  o Apollo já tem log de alteração próprio, e a tela do legado abre o visualizador genérico dele;
- a **busca de produto por F-key** com a tela de pesquisa (`btnBuscaProdutoClick:104`): aqui o código é
  digitado e o produto é validado no gravar.
