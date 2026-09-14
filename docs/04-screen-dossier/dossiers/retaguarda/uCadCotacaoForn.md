# PREENCHER COTAÇÃO (`FRMCADCOTACAOFORN`) — corte-1

`uCadCotacaoForn.pas` (694) + `.dfm` (1.454) + `udmCadCotacaoForn` (108/477) + `uLoginCotacao`.
**137 acessos, 19 operadores.**

## 1. A única tela em que quem opera pode ser de fora

O comprador monta a cotação (`cotacao` + `cotacao_prod`, a lista de produtos) e **o fornecedor preenche os
preços**. O dado confirma que esse é o caso principal: das **97** cotações-fornecedor em produção,
**85 foram preenchidas pelo fornecedor** (`CODOPERADOR = 0`), não por operador da loja.

Uso (14/09/2026): 39 cotações, 97 cotações-fornecedor, **16.014 itens**, de 24/02/2022 a 16/03/2026.

## 2. ⚠️ A porta: dois tipos de gente, e a senha em texto puro

`uLoginCotacao.pas:170` abre um login próprio com duas opções:

| opção | consulta do legado |
|---|---|
| operador da empresa | `OPERADORES.LOGIN = :LOGIN AND SENHA = :SENHA` |
| **fornecedor** | `PARCEIROS.CODPARCEIRO = :COD AND SENHA = :SENHA` |

**Nos dois casos a senha é comparada em texto puro.** São **57 parceiros com senha** cadastrada, de 3 a 13
caracteres.

⛔ **Não copiamos.** A coluna nova é `parceiros.senha_hash`, com o mesmo scrypt dos operadores, e **a carga
hasheia a senha do legado na entrada** — o fornecedor entra com a mesma senha de sempre, ninguém precisa ser
avisado, e o Apollo nunca guarda o texto. Senha errada e parceiro inexistente devolvem **o mesmo erro**, para
a tela não virar oráculo de "este fornecedor existe".

## 3. De quem foi a mão fica gravado

`CODOPERADOR` recebe o operador **ou zero** quando foi o fornecedor, e as datas vão em campos separados:
`DATAMANOPE` para a mão da loja, `DATAMANPAR` para a do fornecedor. É por isso que dá para saber, quatro anos
depois, quem digitou cada cotação.

## 4. Abrir cria os itens zerados

`CarregarItensDaCotacao:103` percorre `COTACAO_PROD` — a lista que o comprador montou — e insere em
`COTACAO_FORN_ITENS` com valor, ICMS e total em **zero**, esperando preço. Só cria o que ainda não existe, de
modo que o fornecedor continua de onde parou.

⛔ **`FATOREMBALAGEM` nasce sempre 1**, com o valor de origem **comentado** ao lado no fonte (`:166`) — o
mesmo padrão do `FATOR_FILHO` da precificação. Campo lido, passado e descartado. Copiado como está; o
fornecedor informa o fator ao preencher.

## 5. As travas

- **um fornecedor preenche cada cotação uma vez** (`VerificarExistenciaFornCotacao:565`) — e aqui um índice
  único garante isso mesmo com duas telas ao mesmo tempo;
- **passou o prazo, ninguém preenche mais**: a cotação-mãe tem janela (`DTFIM_PREENCHIMENTO`), senão o
  comprador apura uma cotação que ainda está se mexendo.

## 6. Cobertura (§110 do smoke, 5 checks)

1. um fornecedor por cotação, e a segunda tentativa recusada;
2. abrir cria os itens zerados, com fator 1;
3. a porta com os dois tipos de gente, o hash no lugar do texto puro, e os dois erros indistinguíveis;
4. quem preencheu fica gravado no campo certo, e o total é `preço × fator`;
5. o prazo encerrado bloqueia.

## 7. O que falta

- **as 14 colunas** que a mig 218 trouxe cobrem o cabeçalho e o item; falta a **apuração** da cotação
  (comparar fornecedores e marcar o `GANHADOR`), que é outra tela;
- o **envio por e-mail** da cotação (`DTENVIOEMAIL`) e a **lista de fornecedores** (`CODCTC_LISTAF`);
- a impressão da cotação para o fornecedor preencher no papel.
