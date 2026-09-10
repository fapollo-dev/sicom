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

### 8.3 O que ainda falta (corte-3)

- **produtos filhos**: `TAtualizacaoPrecoFilho.GeraLoteFilho` (`:1019`) gera lote para os filhos do produto
  precificado. Unit inteira (`UAtualizacaoPrecoFilho.pas`) **não portada** — épico à parte, e mexe em preço de
  produto que não está na nota;
- **multi-empresa na tela**: a API já aceita `empresas[]` (`GetMultiEmpresa`, `:1041`), a tela ainda não oferece;
- **relatório impresso**: `Relatorios\PrecificacaoNF.fr3`, agrupado por empresa, com média de margem no rodapé
  do grupo (`btnImprimir:364`);
- **etiquetas com o dataset do legado**: hoje o botão leva para a tela de etiquetas; o legado **monta a fila**
  com os itens marcados (usando `CODPRODNOTA` como código de barras, `PRECO_VENDA` nos quatro campos de valor,
  quantidade 1) e **desmarca cada item** depois de enfileirar (`:341`);
- **coloração e legenda por regra** (`btnAddPLCClick:206`): `CAMPO/OPERACAO/VALOR/COR/LEGENDA` — NF-e enviada,
  cancelada, nota processada;
- colunas que faltam: `MARKUP_AUTORIZADO`, `VRCUSTOCSI` da nota, `LJ`, `CODPRODUTO`, `CODNFPROD`;
- **salvar/carregar o layout da grade** por operador (`popgrid`, `:1113`);
- **aviso de alteração pendente** ao fechar (`TemEdicao`/`FormCloseQuery`, `:676`);
- **Visualizar Bonificação/Verbas**.

### 8.4 O que grava, e está fiel

`LOTEPRECO` (nosso `lote_preco`) com `PROCESSADO='N'`, `CODEMPRESA`, `CODOPERADOR`, o preço, o markup
**percentual** e a `OBS` no texto fixo do legado: `REFERENTE A PRECIFICAÇÃO NOTA FISCAL DE NRO. <nronf>`
(`:1013`).

## 9. Cobertura (§104 do smoke, 12 checks)

Além dos oito do corte-1: as três escadas de custo (§104.9), as três semânticas do markup incluindo a margem
líquida completa (§104.10), o rodapé com os três lucros e a média por modo (§104.11), e o markdown contra o
markup de reposição (§104.12).
