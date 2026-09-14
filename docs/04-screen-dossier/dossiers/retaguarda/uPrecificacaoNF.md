# PRECIFICAÇÃO DE NF (`FRMPRECIFICACAONF`) — recon e corte-1

`uPrecificacaoNF.pas` (1.129 linhas) + `uDMPrecificacaoNF.pas` (914). **236 acessos, 17 operadores.**
O usuário classificou a tela como *"de extrema importância e de grande influência"* — tratada com o cuidado
que isso pede: nenhuma conta adivinhada, nenhuma simplificação silenciosa.

## 1. O que a tela é

**É onde o preço de venda nasce.** A mercadoria chega, a nota é lançada, e aqui o operador vê item a item: o
custo que veio na nota, o preço que está valendo na loja, o sugerido pela margem, e decide.

Não confundir com a **Precificação por Custo** (`FRMPRIFICACAOCUSTO`): aquela reprecifica o cadastro a partir
do custo já registrado; esta parte **da nota que acabou de entrar**. A escada de margem é a mesma — e é
literalmente a mesma, por reúso (§4).

## 2. ⚠️ A regra mais importante: aplicar **não muda o preço**

`uPrecificacaoNF.pas:996` — "Aplicar Valores" grava em `LOTE_PRECO` com `PROCESSADO = 'N'`. Quem muda o preço
de fato é o **processamento do lote**, que é também quem gera a etiqueta e a carga do PDV.

É uma trava de conferência, não um detalhe de implementação: o operador precifica a nota inteira, confere, e
só então o lote roda. Foi mantida, e a tela **diz isso em voz alta** para quem não conhece o fluxo.

## 3. As contas, e o que não se adivinha

| conta | fórmula | onde |
|---|---|---|
| **custo unitário** | `(VRCUSTO − desconto% × VRCUSTO) / FATOREMBAL` | `uDMPrecificacaoNF` |
| **quantidade** | `QUANTIDADE × FATOREMBAL` | idem |
| **markup na listagem** | `VRVENDA / custo unitário` — **razão** | `:941` |
| **markup ao EDITAR** | `((PRECO_VENDA − custo) × 100) / custo` — **percentual** | `uDMPrecificacaoNF:377` |
| **preço ao editar o markup** | `custo + custo × markup/100` | `CalcularVenda:410` |
| **ICMS** | `DET_ALIQUOTA.ICM_EFETIVO` pela **UF do FORNECEDOR na nota** | `dfm` |
| **último custo de reposição** | `VRCUSTOREP` da última NF de entrada processada, não cancelada, CFOP na lista, **excluindo a própria** | `dfm:424` |

⚠️ **o fator de embalagem é o coração da tela.** A nota vem em caixa, a loja vende em unidade. O mesmo fator
**divide** o custo e **multiplica** a quantidade. Trocar o sentido de um dos dois erra o preço por uma ordem de
grandeza — e o erro sai direto na etiqueta. Fator zero ou nulo vale **1**.

⚠️ **o markup é SEMPRE PERCENTUAL — e tem TRÊS semânticas, uma por tipo de custo.**

A consulta traz `MARKUP = VRVENDA / custo` (razão, `:941`), e por isso eu o descrevi como razão na primeira
passada. **Está errado**: `btnVisualizar:412` percorre TODAS as linhas assim que a consulta abre e sobrescreve
a coluna com `CalcularMargem`. A razão do SELECT nunca chega aos olhos do operador — é só o valor inicial de
um campo que é imediatamente recalculado.

O que se vê, e o que vai para o lote:

| `rgPreco` | a coluna MARKUP é | fórmula |
|---|---|---|
| **Custo bruto** | markup % | `((preço − VRCUSTO) × 100) / VRCUSTO` |
| **Custo de reposição** | markup % | o mesmo, contra o custo de reposição |
| **Custo sem imposto** | ⚠️ **margem líquida %** | a escada fiscal inteira (§3.1) |

No modo CSI **não é markup nenhum**. É por isso que a configuração se chama `MARGEM_LIQUIDA_PRECIFICACAO_NF`.

### 3.1 A margem líquida (`CalculaValorMargem:775`)

```
ICMS de saída = Simples ? ALQSIMPLESNAC × V / 100
                        : (produto 'T*' ? ICM_EFETIVO(alíquota, UF DA EMPRESA) × V / 100 : 0)
PIS/COFINS    = Simples ? 0 : (ALIQ_PIS_SAI + ALIQ_COFINS_SAI) × V / 100
lucro bruto   = (V − ICMS − PIS/COFINS) − custo CSI
lucro líquido = lucro bruto − V × DESPOPERACIONAL/100
margem %      = (lucro líquido − IR − CSLL) / V × 100      (IR e CSLL com PISO ZERO)
```

⚠️ **há DOIS ICMS diferentes na mesma tela.** A coluna `ICMS` mostra o da **UF do fornecedor** (de onde a
mercadoria veio); a margem líquida usa o da **UF da empresa** (onde ela é vendida). Ambos saem de
`DET_ALIQUOTA`, e trocá-los é um erro que não aparece em teste com fornecedor do mesmo estado.

### 3.2 As três escadas de custo (`CalculaValorCusto:423`)

```
custo REAL      = custo − PIS/COFINS − ICMS + ST + FCP-ST + IPI + frete + seguro + acessória + frete2 + ajuste
custo REPOSIÇÃO = custo + (IPI + frete + seguro + acessória + ST + FCP-ST + frete2 + ajuste) − BONIFICAÇÃO
custo CSI       = custo de reposição − ICMS − PIS/COFINS
```

Três regras que não se adivinha:
- **o de reposição não abate crédito nenhum**, e é o único que desconta bonificação;
- IPI, frete, frete2 e seguro entram em **percentual** sobre o custo; acessória, ICMS-ST, FCP-ST e ajuste em
  **valor**. A mesma tabela, duas formas;
- ⚠️ **o crédito de PIS/COFINS da entrada só existe no LUCRO REAL (`'LR'`)** — o **inverso** da Rentabilidade
  por Categorias, que zera para `SN`/`ME`/`LP`. Duas telas, dois recortes de regime, ambos no fonte.

E os componentes saem do **`MULTI_PRECO` do produto naquela empresa**, não da nota — a nota traz o custo, o
cadastro traz os encargos.

### 3.3 O rodapé, que mente se você não olhar o modo

`Produtos Listados`, `Margem Média` (= `AVG(MARKUP)`) e um **`Lucro Bruto` que troca de campo** conforme o
`rgPreco`: `LUCROCB`, `LUCROREP` ou `LUCROCSI` (`btnVisualizar:420`). **Mesmo rótulo, três contas.** No Apollo
os três vêm juntos e a tela diz qual está em destaque.

### O que a tela exclui por padrão

- **transferência** (`CFOP.PROC_TRANSF`, `:911`) — mercadoria da outra loja não é compra, não reprecifica;
- **bonificação** (CFOP `1910`/`2910`, `:916`) — mercadoria de graça não forma preço.

Ambas com caixa para incluir, porque o legado tem.

## 4. O que foi **reusado**, não reescrito

`recalcular()` chama `PrecificacaoCustoService.calcular()`. A escada de margem (PMZ → preço sugerido → lucro)
já tinha sido portada do `FRMPRIFICACAOCUSTO` e certificada; reimplementá-la aqui criaria duas verdades sobre
a margem da mesma empresa. Esta tela **alimenta** aquele cálculo com os componentes que vieram na nota.

## 5. O que a carga estava jogando fora (mig 211)

Mais seis colunas de `NF_PROD` que existiam no legado e não no destino — e as seis são de **preço**:

| coluna | o que é |
|---|---|
| `pmz` | preço de margem zero do item na nota |
| `vrvendasug` | o preço sugerido, gravado no item |
| `ultcusto` | o último custo no momento do lançamento |
| `vrcustocsi` | custo sem imposto |
| `frete2` | o segundo frete (existe no legado, entra no custo) |
| `despextra` | despesa extra do item |

Mais `CFOP.PROC_TRANSF`, que é o que marca o CFOP como transferência. Sem ela o filtro de transferência não
existe. **Achado nº 7 da mesma família** — a carga vinha descartando coluna de dinheiro em silêncio.

## 6. RBAC

Duas permissões, não uma: `FRMPRECIFICACAONF` (abrir/consultar) e **`BTNAPLICAR`** (gravar o lote). O legado
separa, porque ver o preço sugerido e mandar a loja mudar de preço não são o mesmo poder.

## 8. O tamanho real da tela, e onde estamos

Medido no fonte em 10/09/2026, depois de o usuário desconfiar duas vezes do "corte-1 completo" — e nas duas
ele estava certo.

| | legado | hoje |
|---|---|---|
| colunas na grade | 35 | **22** |
| tipos de custo | 3 | **3 ✅** |
| telas abertas por atalho | 5 | **4** (falta o financeiro da nota ter tela própria) |
| rodapé (listados/margem média/lucro) | sim | **sim ✅** |
| modo markdown por configuração | sim | coluna calculada ✅, troca de rótulo ainda não |

### 8.1 Os cinco atalhos — é por isso que a tela é um hub

| tecla | abre | fonte | no Apollo |
|---|---|---|---|
| **F2** | Cadastro do Produto | `:772` | `/cadastro/produtos` ✅ |
| **F4** | Precificação por Custo | `:790` | `/estoque/precificacao` ✅ |
| **F5** | a Nota Fiscal | `:818` | `/fiscal/notas/entrada` ✅ |
| **F6** | Financeiro da Nota | `:838` | aponta para contas a pagar — a tela própria (`FrmFinanceiroNotaFiscalVisualizacao`) não foi migrada |
| botão | Etiquetas (`frmEtiqueta`) | `:296` | `/estoque/etiquetas` ✅ |

O operador precifica **sem sair da tela**. Tirar os atalhos não tira função — tira o fluxo de trabalho, que é
o que a tela é.

### 8.2 As duas configurações que mudam a tela inteira

| configuração | efeito | **valor vivo no cliente** |
|---|---|---|
| `MARGEM_LIQUIDA_PRECIFICACAO_NF` | `'S'` ⇒ custo CSI **e esconde o botão Etiquetas** (`:871`) | **`'B'`** ⇒ bruto, etiquetas visíveis |
| `TIPO_PRECIFICACAO` | `'D'` ⇒ o rótulo da coluna vira **MARKDOWN FIXO** (`:882`) | **`'P'`** ⇒ markup |

Lidas da produção em 10/09/2026. Ambas já são respeitadas na abertura da tela.

### 8.3 ✅ Produtos filhos (corte-3, mig 212) — a parte que mexe em preço invisível

Precificar o pai enfileira lote **para os filhos também**, e o filho pode nem estar na nota: CHUCHU KG sobe,
CHUCHU PICADO KG vai junto. `CalculaPrecoFilho:187`:

```
tipo 'D'       → preço do filho = preço do pai + diferença     (valor)
qualquer outro → preço do filho = preço do pai × (1 + dif/100) (percentual)
```

A base é o **preço novo** que está sendo aplicado, não o vigente (`:1019` passa `PRECO_VENDA` do grid) — usar
o vigente prenderia o filho no preço velho. Só enfileira **se o preço mudar**, e o lote do filho não leva
markup nem operador: não houve decisão humana sobre ele.

**⛔ `FATOR_FILHO` é campo morto.** `CalculaPrecoFilho:192` abre com `pFatorFilho := 1;` e o `iif` original
está **comentado** no fonte: o campo é lido, passado como parâmetro e descartado na primeira linha. Em
produção os 200 produtos com pai têm fator 1, então ninguém percebeu. Copiado como está — ligar o fator agora
mudaria preço sem ninguém ter pedido. O smoke prova (§104.15): fator 3 não multiplica nada.

**⚠️ DIVERGÊNCIA fonte × dado, resolvida pelo dado.** O fonte é de 14/05/2020; a produção roda binário mais
novo, e aqui os dois discordam:

| | fonte (mai/2020) | produção (medida em 14/09/2026) |
|---|---|---|
| filtro dos filhos | `DIF <> 0 AND TPDIF IS NOT NULL` | **200 com pai, ZERO com DIF ou TPDIF** |
| lotes de filho | impossíveis, pelo filtro | **676**, sendo 670 com pai, último em 10/09/2026 |

O caso que fecha a conta: o produto 795537 (CHUCHU PICADO KG), filho de 5890 (CHUCHU KG), sem DIF e sem
TPDIF, recebeu lote a **4,49** — exatamente o preço do pai, que é o que a fórmula devolve com diferença nula.
**A fórmula do fonte está certa; o filtro é que caiu.** Implementada a fórmula sem o filtro, que é o
comportamento vivo.

A coluna `TPDIF_PRECO_PROD_FILHO_X_PAI` **não vinha na carga** (mig 212) — oitavo achado da mesma família, e
sem ela o filho sairia com o preço errado.

### 8.4 ✅ Multi-empresa (corte-3)

`GetMultiEmpresa` (`:1041`) aplica o mesmo preço em todas as lojas marcadas. A tela oferece a seleção; em
branco, só a loja da sessão. Empresa inexistente faz a operação inteira falhar, não a metade.

### 8.5 ✅ Etiquetas, coloração e as colunas de gate (14/09/2026)

**Etiquetas** (`btnEtiquetasClick:296`): o botão agora **enfileira** os itens marcados na fila de impressão e
**desmarca** cada um, como o legado — para o operador não mandar a mesma etiqueta de novo ao clicar outra vez.
O serviço ainda protege: o mesmo produto não duplica na fila.

⚠️ **uma diferença de propósito, com o número medido**: o legado usa `CODPRODNOTA` — o código do produto **na
nota do fornecedor** — como código de barras da etiqueta (`:340`). Em **98,3%** dos itens isso é igual ao
`CODBARRA` do cadastro (196.582 de 200.000, medido em 14/09/2026), mas nos outros **1,7%** a etiqueta sairia
com o código do fornecedor, que **não é o que o PDV lê na gôndola**. A fila do Apollo é por produto e o código
sai do cadastro.

**Coloração por regra** (`btnAddPLCClick:206`): o legado monta uma tabela de regras
(`CAMPO/OPERACAO/VALOR/COR/LEGENDA`) que pinta a linha conforme o status da NF-e e se a nota foi processada.
Aqui a informação vira **coluna com a mesma legenda** — NF-e emitida, NF-e cancelada, nota processada — que
diz a mesma coisa sem esconder o motivo atrás de uma cor.

**`MARKUP_AUTORIZADO`**: no legado é `TBooleanField` **calculado, sem SQL**. É o gate do PMZ — o preço
proposto não pode ficar abaixo do preço de margem zero. Virou coluna, e o que está abaixo aparece em
destaque.

### 8.5.1 O que ainda falta

- o **relatório impresso** `Relatorios\PrecificacaoNF.fr3`, agrupado por empresa com média de margem no
  rodapé do grupo (`btnImprimir:364`) — aqui a grade imprime em paisagem;
- **salvar/carregar o layout da grade** por operador (`popgrid`, `:1113`);
- **Visualizar Bonificação/Verbas**;
- as colunas `VRCUSTOCSI` **da nota** (temos a calculada), `LJ` e `CODNFPROD` na grade;
- o **aviso de alteração pendente** ao fechar (`TemEdicao`/`FormCloseQuery`, `:676`).

### 8.6 O que grava, e está fiel

`LOTEPRECO` (nosso `lote_preco`) com `PROCESSADO='N'`, `CODEMPRESA`, `CODOPERADOR`, o preço, o markup
**percentual** e a `OBS` no texto fixo do legado: `REFERENTE A PRECIFICAÇÃO NOTA FISCAL DE NRO. <nronf>`
(`:1013`).

## 9. Cobertura (§104 do smoke, 17 checks)

Corte-1 (8): fator de embalagem · ICMS pela UF do fornecedor e último custo · filtros de transferência e
bonificação · margem negativa · o lote que não muda preço · as recusas · o markup percentual · o negativo.

Corte-2 (4): as três escadas de custo (§104.9) · as três semânticas do markup, com a margem líquida completa
(§104.10) · o rodapé com os três lucros e a média por modo (§104.11) · o markdown contra o markup de
reposição (§104.12).

Corte-3 (3): o preço dos filhos nos três casos, com base no preço NOVO do pai (§104.13) · o filho que já está
no preço não entra na fila, e o lote do filho não leva markup nem operador (§104.14) · **`FATOR_FILHO` é
campo morto** — fator 3 não multiplica nada (§104.15).

Fechamento (2): o botão de etiquetas enfileirando sem duplicar (§104.16) · a coloração por regra e o gate do
PMZ como colunas (§104.17).
