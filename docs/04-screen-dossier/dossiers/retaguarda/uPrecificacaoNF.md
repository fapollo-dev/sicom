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

⚠️ **a coluna MARKUP muda de unidade no meio do caminho — e isso é do legado.** A consulta a traz como
**razão** (`venda ÷ custo`, `:941`); assim que o operador digita qualquer coisa, `CalcularMargem` sobrescreve
o **mesmo campo** com **percentual** (`(preço − custo) × 100 / custo`). E é o valor corrente do campo que vai
para `LOTEPRECO.MARKUP`.

**Prova no dado (produção, 10/09/2026):** dos **2.952** lotes que esta tela gerou (`OBS LIKE 'REFERENTE A
PRECIFICA%NOTA FISCAL%'`, de 24/08/2020 a 27/11/2024), **1.182** caem na faixa de razão (0,5–5) e **1.358** na
de percentual (>5). A incoerência está gravada no banco do cliente. Em `MULTI_PRECO.MARKUP`: mediana **30,79**,
mínimo **−98,93** — ou seja, o que o sistema consome é percentual, e **aceita negativo**.

Copiado como está no que **grava**; na tela as duas aparecem **rotuladas** ("Markup NF (razão)", só leitura, e
"Markup % (grava)", editável) em vez de uma coluna ambígua. Ler 65,56 como razão poria a etiqueta a 65 vezes
o custo — é exatamente o erro que esta seção existe para impedir.

⚠️ **o ICMS vem da UF do FORNECEDOR** (`PARCEIROS_END.CODEND = NF.CODPARCEIRO_END`), **não** da UF da empresa —
que é como a Rentabilidade por Categorias resolve a mesma coluna. Duas telas, a mesma `DET_ALIQUOTA`, origens
opostas, e ambas certas: lá interessa onde se VENDE, aqui de onde a mercadoria VEIO.

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

## 7. Cobertura (§104 do smoke, 6 checks)

1. o fator de embalagem dividindo o custo e multiplicando a quantidade;
2. markup como razão, ICMS pela UF do fornecedor, último custo excluindo a própria nota;
3. os filtros de transferência e bonificação, ligados e desligados;
4. a marcação de margem negativa;
5. o lote gravado com `PROCESSADO='N'` — e o preço do produto **inalterado** depois de aplicar;
6. as recusas: preço zero e empresa inexistente.

## 8. ⚠️ O tamanho real da tela — e o quanto o corte-1 cobre

O corte-1 é **uma fatia**, e o registro anterior deste dossiê a descrevia como maior do que é. Medido no
fonte em 10/09/2026:

| | legado | corte-1 |
|---|---|---|
| colunas na grade | **35** | 13 |
| tipos de custo | **3** (CSI · bruto · reposição, no `rgPreco`) | 1 (bruto) |
| telas abertas por atalho | **5** | 0 |
| modo markdown | sim, por configuração | não |

### 8.1 Os cinco atalhos (é por isso que a tela é um hub)

| tecla | abre | fonte |
|---|---|---|
| **F2** | Cadastro do Produto | `:772` |
| **F4** | Precificação por Custo | `:790` |
| **F5** | a Nota Fiscal | `:818` |
| **F6** | Financeiro da Nota Fiscal | `:838` |
| botão | Impressão de Etiquetas (`frmEtiqueta`) | `:296` |

O operador precifica **sem sair da tela**: vê o item, abre o cadastro, confere a nota, olha o financeiro dela,
imprime a etiqueta. Tirar os atalhos não tira função — tira o fluxo de trabalho, que é o que a tela é.

### 8.2 Os três tipos de custo (`rgPreco`, `uDMPrecificacaoNF:12`)

`tcCustoCSI` (custo sem imposto) · `tcCustoBruto` · `tcCustoReposicao`. **Cada um muda a fórmula da margem e
a do preço** (`CalcularMargem:370`, `CalcularVenda:400`). O corte-1 implementa só o bruto.

### 8.3 As duas configurações que mudam a tela inteira

| configuração | efeito | **valor vivo no cliente** |
|---|---|---|
| `MARGEM_LIQUIDA_PRECIFICACAO_NF` | `'S'` ⇒ custo CSI **e esconde o botão Etiquetas** (`:871`) | **`'B'`** ⇒ custo bruto, etiquetas visíveis |
| `TIPO_PRECIFICACAO` | `'D'` ⇒ a coluna vira **MARKDOWN** (margem sobre a VENDA) | **`'P'`** ⇒ markup |

Lidas de `CONFIGURACOES` da produção em 10/09/2026. Para **este** cliente o corte-1 acertou o modo — mas por
coincidência de configuração, não por cobertura.

### 8.4 O resto do corte-2

- **produtos filhos**: `TAtualizacaoPrecoFilho.GeraLoteFilho` (`:1019`) gera lote para os filhos do produto
  precificado. Unit inteira (`UAtualizacaoPrecoFilho.pas`) ainda **não portada** — épico à parte;
- **multi-empresa** de verdade: `dmPrincipal.GetMultiEmpresa` aplica em todas as lojas marcadas (a API já
  aceita `empresas[]`; a tela ainda não oferece);
- **coloração e legenda por regra** (`btnAddPLCClick:206`): `CAMPO/OPERACAO/VALOR/COR/LEGENDA` — status da
  NF-e, nota processada, etc.;
- as colunas que faltam: `VRCUSTOREP`, `MARKDOWN`, `MARKUPFIXO`, `MARKUP_AUTORIZADO`, `VRPROMO`,
  `GRUPO_PRECO`, `CODPRODNOTA`, `LJ`;
- **rodapé** com Margem Média, Lucro Bruto e Produtos Listados;
- **salvar/carregar o layout da grade** por operador;
- **Visualizar Bonificação/Verbas**;
- o **histórico de preço** do item.

### 8.5 O que o corte-1 grava, e está fiel

`LOTEPRECO` (nosso `lote_preco`) com `PROCESSADO='N'`, `CODEMPRESA`, `CODOPERADOR`, o preço, o markup
**percentual**, e a `OBS` no texto fixo do legado: `REFERENTE A PRECIFICAÇÃO NOTA FISCAL DE NRO. <nronf>`
(`:1013`).
