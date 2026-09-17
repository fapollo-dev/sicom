# FRMMULTATUALIZACAO — Atualização automática de produtos

**60 acessos · 6 operadores.** `uMultAtualizacao.pas` (1.145 linhas) + `udmMultAtualizacao`. Migration **232**.
API `cadastro/mult-atualizacao`. Tela `/cadastro/mult-atualizacao`.

## 1. O que a tela faz

Escolhe produtos, escolhe **um** campo, escolhe uma operação, e aplica em todos de uma vez. É a tela que sobe
10% no preço de uma família inteira, troca o subgrupo de duzentos itens ou desativa uma linha de produtos.

Poderosa e perigosa na mesma medida — e é por isso que ela tem as travas que tem.

## 2. O fluxo, em três tempos

| tempo | no legado | aqui |
|---|---|---|
| **Buscar** | `btnBuscaProdutoClick` :228 enche a grade e guarda um espelho (`cdsEspelho_Produto`) | `GET produtos` |
| **Alterar** | `btnProcessar` → `EditaDataset` :619 mexe só na **memória**; `Desfazer` :117 restaura o espelho | `POST simular` |
| **Gravar** | `btnGravarClick` :343 percorre os selecionados e escreve, **para cada empresa**, campo a campo | `POST aplicar` |

O "Alterar" do legado nunca tocou no banco — era uma prévia com botão de desfazer. Aqui isso virou
`simular()`, que roda **a mesma conta** da gravação e devolve o antes e o depois de cada produto. A prévia não
pode mentir: é literalmente o mesmo código.

## 3. As sete operações (`TTipoOperacaoAlteracao`, :683-689)

| operação | conta | vale para |
|---|---|---|
| Substituir | o valor digitado | texto e número |
| Somar no início | `valor + atual` | texto |
| Somar no fim | `atual + valor` | texto |
| Somar / Subtrair / Multiplicar / Dividir | sobre o valor atual | número |

⚠️ **O percentual é do valor ATUAL de cada produto** (`:679`), não um valor fixo aplicado a todos: +10% sobre
20,00 dá 22,00 e sobre 24,00 dá 26,40.

## 4. As travas, e por que existem

- ⚠️ **Produto que compõe outro não pode ser desativado** (`ProdutoFazParteDaComposicaoDeOutroProduto` :741).
  Desativar a farinha deixaria o pão sem ingrediente. No cliente, `COMPOSICAO` tem 61 linhas — 9 produtos-pai
  e **39 componentes** protegidos.
- ⚠️ **Código de família precisa existir COM O TIPO CERTO** (`RetornarValores('FAMILIAS_PROD'…)` :694): um
  grupo não serve como subgrupo. `FAMILIAS_PROD.TIPO` é quem diz.
- ⚠️ **Mexer no subgrupo arrasta grupo, departamento e seção** (`AdicionaComplementoSubGrupo` :127). A
  hierarquia mora no **próprio registro do subgrupo**: `SELECT CODDPTO, CODGRUPO, CODSECAO FROM FAMILIAS_PROD
  WHERE CODFAMILIA = :x AND TIPO = 'S'`. Medido: das 520 famílias tipo `S`, **505** têm grupo e departamento.
- **Histórico só de preço**: `FCamposHistorico` (:368) registra `VRVENDA` e `VRCUSTO`, mais nada. É a única
  pista de quem mexeu no preço de N produtos de uma vez, e foi mantida.

## 5. Divergências conscientes

- ⚠️ **Dividir por zero**. `toaDividir` (:687) é `valor / ValorOperacao` sem nenhuma proteção: derruba a
  alteração no meio, com parte dos produtos já mexida em memória. Recusado na porta.
- ⚠️ **Os campos de controle saem do combo.** A lista de exclusão do `FormShow` (:990-1016) tira 20 campos
  por substring, mas **esqueceu** `IDPRODUTO`, `CAMPO`, `OPERACAO`, `DTULTIMALTERACAO`, `USULTALTERACAO` e
  `CODOPERADOR` — que continuam oferecidos. Alterar `IDPRODUTO` em massa não tem leitura nenhuma; identidade e
  auditoria não são cadastro. `CODAUXILIAR` também sai: nem existe em `PRODUTOS` no Oracle.
- ⚠️ **Uma transação só.** O legado grava produto a produto, e um `Abort` no meio deixa metade aplicada. Aqui
  é tudo ou nada, e o operador vê **todos** os impedimentos de uma vez em vez do primeiro. Numa alteração em
  massa, meia alteração é pior que nenhuma.
- ⚠️ **O valor não é aparado.** `PREFIXAR` com `'ORG '` precisa do espaço, senão `ARROZ` vira `ORGARROZ`. O
  legado não apara (`:671` só troca ponto por vírgula) e nós também não — foi um `trim` que o smoke pegou.
- **Multi-empresa**: o legado varre `EMPRESAS` e escreve em todas. Somos tenant-scoped em `multi_preco` (preço
  é por empresa e a sessão tem uma); os campos de `produtos` são globais e valem para todas.

## 6. As colunas que faltavam no destino

| coluna | tipo | preenchidos (de 47.712) |
|---|---|---|
| `produtos.descmax` | numeric(15,6) | 40.897 |
| `produtos.comissao` | numeric(13,2) | 40.503 |
| `produtos.compqtde` | numeric(13,2) | 47.712 |
| `produtos.compfator` | numeric(13,4) | 47.712 |
| `produtos.tipopis` | char(1) | 29.142 |
| `produtos.especificacao` | varchar(300) | ⚠️ **48** |
| `familias_prod.codgrupo` / `.coddpto` | integer | 505 de 520 (tipo `S`) |
| `familias_prod.codsecao` | integer | ⚠️ **1** de 520 |

## 7. A aba PIS/COFINS (`BtnAlterarPCClick` :141-227)

Três campos — código PIS/COFINS, tipo (`N` não-cumulativo, `A` cumulativo, `I` isento retido, `S` suspenso,
`Z` alíquota zero) e natureza — com duas travas fiscais próprias:

- ⚠️ **a natureza só é exigida quando a alíquota é ZERO** (`GetAliquota(...) = 0` :798). Num CST com alíquota,
  a natureza do crédito não se aplica e o campo fica desabilitado.
- quando informada, o par (`IDPISCOFINS`, `IDBASECREDITOISENTO`) tem de existir em `PC_TIPOCREDITOISENTO` — é
  de lá que sai o `IDTABELA` que vai para o produto.

## 8. O que fica para o próximo corte

O **Desfazer** da grade (o espelho em memória do legado) não tem equivalente aqui: a prévia já mostra o
resultado antes de gravar, e depois de gravado o caminho é outra alteração. Se o operador sentir falta, o
espelho vira um "reverter último lote" apoiado no `historico_dinamico` — que já registra preço.
