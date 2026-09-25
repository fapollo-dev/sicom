# Recon — Decomposição na entrada (produto que entra decomposto na NF de entrada)

Data: 25/09/2026. Somente leitura.
- Fonte Delphi: `/Library/SicomGit/retaguarda-master/fonte/Units` (mai/2020).
- Produção Oracle consultada só com SELECT, dentro de `SET TRANSACTION READ ONLY`, pelo `q.py` do scratchpad.
- População padrão: `NF.TIPO='E'`, `DTEMISSAO >= 01/01/2026`, lojas 1, 2, 50, 51 e 52. Quando uso outra população, digo qual.
- "Filho" é o item de NF_PROD com `CODPRODUTOPAI_DECOMPOSICAO > 0`.
- "Grupo" é o conjunto de filhos de um mesmo (CODNF, CODPRODUTOPAI_DECOMPOSICAO, NROITEM_DECOMP), isto é, um item-pai decomposto.

Vale a regra de sempre: **quando o fonte e o dado vivo discordam, o dado decide**. Cada divergência aparece marcada, com os números.

---

## 0. Resumo

**Números de 2026.**
- **7.132 filhos** em **644 NFs** e **905 grupos**. A loja 1 tem 319 NFs e 3.547 filhos; a loja 2 tem 325 NFs e 3.585 filhos.
- As 644 NFs são todas importação de XML (`NF_IMPORTACAO_NFE='S'`). Em 585 delas, todos os itens são filhos.
- Os filhos são 11,7% dos 60.751 itens de entrada.
- Distribuição de grupos por NF: 443 NFs com 1 grupo, 141 com 2 e 60 com 3.
- O número cresce durante o dia. O dossiê `uNF-item-colunas.md` registrou 7.124; hoje já são 7.132.

**Regras que o dado confirma:**
1. **Gatilho.** Vale quando `NF.TIPO='E'` e `PRODUTOS.ENTRADA_DECOMPOSTA='S'`. O diálogo deixa o operador mudar só três coisas: a **quantidade total em KG**, o **valor total** e o **CFOP**.
2. **O pai sai da NF.** O item-pai é **excluído**, e os filhos entram no lugar dele. Na tela ele volta só como linha **virtual** da grade, montada a partir dos filhos.
   - Na produção: 0 NFs com pai e filho juntos, e 0 itens de produto `ENTRADA_DECOMPOSTA='S'` nas entradas de 2026.
   - O pai **não mexe no estoque**, e o processamento é bloqueado enquanto houver um pai na nota.
3. **Quantidade do filho** = `round(QtdKG × PERCENTUAL/100, 3)`. Confere em 6.602 de 7.116 filhos.
4. **Custo do filho** no modo padrão ("pelo valor de venda", `CALCULO_VALOR_CUSTO_DECOMP` = 'CV' ou NULL):
   `VRCUSTO = round(ValorTotal × VRVENDA_filho / Σ round(QtdKG×PERC/100×VRVENDA, 2), 6)`
   - Confere em 6.245 de 7.116 filhos.
   - No nível do grupo, a fórmula inteira fecha em 824 de 903 grupos consistentes (91,3%). Tirando os 65 grupos anteriores à alteração do cadastro em 08/04/2026, fecha em 824 de 838 (98,3%).
   - **Divergência:** o binário novo arredonda o custo a **6 casas**. O fonte arredonda a 4 (`udmNF.pas:10594-10597`). A 4 casas conferem só 38 filhos.
5. **Arredondamento.** O **primeiro filho em ordem alfabética** absorve duas diferenças:
   - a de quantidade: em 319 de 319 grupos com diferença, o filho corrigido é sempre o primeiro;
   - a de valor: 522 de 522 custos ajustados batem com `(C×Q ± resto)/Q`.
   - Com isso, `NF.TOTALPROD` = Σ `round(Q×VRCUSTO,2)` dos itens em **644 de 644 NFs**.
6. **ICMS-ST do pai** é rateado entre os filhos proporcionalmente ao TOTALPRODS: VRBASEST confere em 5.732 de 5.743 filhos (±0,01) e VRICMST em 5.736 de 5.743. Nenhum filho absorve a sobra.
7. **ATUALIZA_MULTIPRECO_DECOMP do filho** = flag do produto-pai ('S' só quando o pai tem 'S'; NULL vira 'N').
   - Confere em 7.132 de 7.132 filhos.
   - No processamento, o custo da MULTI_PRECO só muda com 'S'. O `HISTORICO_PROCESSAMENTO_NF` fecha 100%: 2.408 'N' e 4.772 'S'.
8. **Estoque.** Cada filho move o **próprio** estoque. `NF_PROD.DECOMPOSICAO` fica 'N' em todos os filhos.
   - **Correção do dossiê anterior**, que atribuía o 'N' ao binário novo: o fonte de 2020 já explica.
   - O `TfrmEstoqueNF.FormShow` do processamento faz `DECOMPOSICAO := PRODUTOS.DECOMPOSICAO` do item (`uEstoqueNF.pas:1868`), e os 30 produtos-filho têm DECOMPOSICAO='N'.
   - Se ficasse 'S', o gatilho `ESTOQUE_NOTAS` moveria os filhos do filho (que não existem) e o filho não entraria no estoque.

**Divergências do binário novo sem explicação no fonte** (detalhes em §10 e "Não determinado"):
- custo a 6 casas;
- NROITEM dos filhos NULL em 80% (5.689 de 7.132);
- CST_NOTA e ICMS_ALIQ_NOTA preenchidos em 62%;
- desde 17/09/2026, IDPRODUTO_FILHO e troca pelo produto-pai em 9 filhos.

---

## 1. Quando o item "entra decomposto" (Q1)

### 1.1 A condição

| Onde | O que exige | Linha |
|---|---|---|
| `TDMNF.ProdutoEntraDecomposto` | `PRODUTOS.ENTRADA_DECOMPOSTA = 'S'` e nada mais (não olha a DECOMPOSICAO nem configuração nenhuma) | `udmNF.pas:11758-11764` |
| OK do diálogo do item | `cdsNotaTIPO='E'` e `ProdutoEntraDecomposto(CODPRODUTO)` | `uItensNF.pas:1858-1859` |
| OK do diálogo do item | só decompõe se `NF.PROC <> 'S'`; senão cancela a edição e fecha | `uItensNF.pas:1901-1906` |
| Editar a NF (`btnEditarClick`) | `TIPO='E'` → `VerificaProdutosComEntradaEmDescomposicao` | `uNF.pas:3953-3954` |
| idem | sai sem nada se não houver itens, se `TIPO<>'E'` ou se `PROC='S'` | `uNF.pas:17457-17468` |
| idem | percorre todos os itens e abre o diálogo para cada `ProdutoEntraDecomposto` | `uNF.pas:17506-17508` |
| Trava do processamento | se sobrar item com `ENTRADA_DECOMPOSTA='S'`, bloqueia (mensagem abaixo) | `uNF.pas:14810` → `:16887-16912` |

Mensagem da trava, literal (`uNF.pas:16899-16900`):
"Produto: <DESCRICAO>, com entrada em decomposição. Os produtos da decomposição deverão ser lançados à nota. Altere a nota fiscal para iniciar a decomposição."

**Produção — os produtos:**
- 14 produtos têm `ENTRADA_DECOMPOSTA='S'`.
- 13 deles têm cadastro em DECOMPOSICAO: 135 linhas, 30 filhos distintos, soma de percentuais = 100 em todos.
- O 14º é o 843374 "EXCLUIR", sem cadastro.
- Todo produto com linhas em DECOMPOSICAO tem `ENTRADA_DECOMPOSTA='S'` e `DECOMPOSICAO='S'`. Não há produto de "decomposição só de estoque" sem entrada decomposta.

| Pai | Descrição | UN | CALC (custo) | ATU (multi-preço) | Filhos | Grupos em 2026 |
|---|---|---|---|---|---|---|
| 2820 | SUINO RACHADO (PORCO INTEIRO) KG | KG | NULL→CV | S | 8 | 268 |
| 3940 | BOI CASADO KG | KG | **CR** | S | 20 | 0 (21 filhos só em 2021) |
| 8297 | TRASEIRO VACA (SERROTE) | KG | CV | S | 13 | 44 |
| 10672 | VACA CASADA KG | KG | NULL | NULL→N | 19 | 3 |
| 831824 | COSTELA VACA - PINHEIRAO | KG | CV | S | 4 | 3 |
| 832388 | TRASEIRO CAPOTE BOI | UN | CV | S | 14 | 0 |
| 832390 | TRASEIRO CAPOTE DE VACA | UN | CV | NULL→N | 15 | 1 |
| 832408 | TRASEIRO DE BOI (SERROTE) | UN | NULL | S | 12 | 94 |
| 832410 | COSTELA INTEIRA BOVINA | KG | CV | S | 4 | 183 |
| 832938 | DIANTEIRO DE BOI | UN | CV | S | 8 | 18 |
| 833018 | DIANTEIRO DE VACA | UN | CV | NULL→N | 8 | 291 |
| 834764 | CAIXARIA DA PALETINHA KG | KG | NULL | NULL | 7 | 0 |
| 859529 | COSTELA INTEIRA S/ FRALDINHA | KG | CV | S | 3 | 0 (117 filhos em 2025) |

### 1.2 O diálogo `frmItemDecomposicaoNotaFiscal` (`uItemDecomposicaoNotaFiscal.pas/.dfm`)

Título: "Item de decomposição nota fiscal". Aviso literal (dfm:170-185):
"Produto com entrada em decomposição. Os produtos da decomposição serão lançados à nota. Deseja continuar?"

| Mostra (só leitura) | Edita | Botões |
|---|---|---|
| Produto (DESCRICAO), Código barra, Fator (FATOREMBAL), UN, Quantidade (QTDETOTAL), Valor total original (TOTALPROD), CFOP (dfm:37-259) | **Quantidade total em KG** (padrão QTDETOTAL = QUANTIDADE×FATOREMBAL), **Valor total** (padrão TOTALPRODS), **CFOP** (padrão = CFOP do item) (`.pas:189-195`) | "Confirmar decomposição" e "Cancelar" |

- **Não mostra** os filhos, os percentuais nem o custo por filho. Também **não tem** o "atualiza multi-preço", que vem do cadastro do pai (§1.3).
- Validações do OK (`.pas:197-229`), com mensagens literais:
  - CFOP <= 0: "Informe o CFOP para a decomposição do item!";
  - CFOP fora da tabela CFOP: "CFOP não cadastrado. Informe um CFOP cadastrado!" (`:139-150`);
  - quantidade <= 0: "Informe a quantidade total do item em KG!";
  - valor <= 0: "Informe o valor total do item!".
- O que o diálogo devolve (`:231-247`):
  - quantidade, valor total e CFOP digitados;
  - **VRICMST e VRBASEST do item original**, sem edição;
  - DESCRICAO, CODPRODUTO, CFOP_ORIGINAL e NROITEM do item.
- `fFatorEmbalagem := 1` e `fValorCusto := total/qtd` são calculados, mas **ninguém usa**.

### 1.3 Configurações lidas

| Nome | Onde | Uso | Produção |
|---|---|---|---|
| `PRODUTOS.ENTRADA_DECOMPOSTA` (pai) | `udmNF.pas:11762` | gatilho | 14 'S' |
| `PRODUTOS.CALCULO_VALOR_CUSTO_DECOMP` (pai) | `udmNF.pas:10473-10477` | 'CR' = custo rateado pelo percentual; qualquer outro valor (CV ou NULL) = pelo valor de venda. Na tela: rádio "Calcula valor de custo pelo valor de venda" / "Calcula valor de custo rateado" (`UCadProduto.dfm:8249-8265`) | 1 CR, 8 CV, 5 NULL |
| `PRODUTOS.ATUALIZA_MULTIPRECO_DECOMP` (pai) | `udmNF.pas:10477`, grava no filho em `:10650` | vai para o filho e é o gate do custo no processamento (§6). Na tela: "Atualiza valor de custo dos itens de decomposição na multi-preço" (`UCadProduto.dfm:8266-8276`) | 9 S, 5 NULL (NULL vira 'N' no filho: 2.400 de 2.400) |
| `PRODUTOS.PERCENTUAL_PERDAS` (filho) | `udmNF.pas:10529`, `:10586` | só no modo CR: 100 = item de perda total | nenhum filho com 100 (só o 31 tem 3,0) |
| `CALCULA_BONIFICACAO_ITENSNF_AUTO` | `udmNF.pas:10185` (`CalcularBonificacaoDecomposicao`) | bonificação automática nos CFOPs x910 | 'N' |
| `EMPRESAS.FIGURAFISCAL` | `udmNF.pas:9997`, `:10009-10013` | se 'O' ou 'S', consulta o indexador do filho | 1 = D desde 22/09/2026 (era O), 2 = O, 50 = D, 51 = O, 52 = O. Ver `uItensNF-indexador.md` §0 |
| `EMPRESAS.SEGMENTO` | `udmNF.pas:10607-10610` | 'INDUSTRIA' lê a alíquota da MULTI_PRECO; senão, a do produto | PADRAO ou NULL em todas |
| `EMPRESAS.CLASSFISCAL`, ALQSIMPLESNAC, DESPOPERACIONAL, IMPRENDA, CONTSOCIAL | `udmNF.pas:10344-10400` | escada de margem do filho (`MargemLucroDecomposicao`) | 1, 2, 51 e 52 LR; 50 SN |
| `PARCEIROS.RETIRA_FORNINDEX`, `NF.LIBERA_NF_INDEXADOR`, `NF.COD_PED_DEV_COMPRA` | `udmNF.pas:9997-10015` | gate do indexador | — |
| `EMPRESAS.ATUDCOMPOSICAO` | `udmNF.pas:7626` | decomposição "antiga estrutura" no processamento (§6.4) | NULL nas 5 lojas (`<> 'N'` → ligada) |
| `CONSIDERA_ITENS_DECOMPOSICAO_SPED_FISCAL` (id 152) | view `GET_CONFIG_DECOMPOSICAO`, SPED (§7) | não afeta a entrada decomposta | 'N', sem específicas |
| `HABILITA_CALC_PERCENTUAL_AUTOMATICO_DECOMP` (id 809) | não está no fonte de 2020 (cadastro de decomposição do binário novo) | — | 'N' |

- `CONFIGURACOES_ESPECIFICAS` não tem nenhuma linha para configurações com "DECOMP" ou "COMPOSI" no código.
- `NF_INSERE_COMPOSICAO` ('S') e `SEPARAR_COMPOSICAO_POR_EMPRESA` ('N') são da **composição** (kit na saída), não deste tema.

---

## 2. O item-pai (Q2)

**É excluído, não zerado.** Os três caminhos fazem igual: guardam os lotes do pai num array, apagam os lotes e dão `cdsItensNota.Delete` no pai **antes** de chamar `InsereProdutosDaDecomposicao`.
- `uItensNF.pas:1908-1927`;
- `uNF.pas:17547-17568`;
- `uNF.pas:8864-8884`.

**Na tela, o pai é só uma linha virtual.** `ConstruirGridDosItensDaNota.InserirPai` (`udmNF.pas:5729-5820`) monta na grade uma linha `PRODPAIDECO='S'` com `CODNFPROD=0`:
- QUANTIDADE = Σ QUANTIDADE dos filhos;
- VRCUSTO = Σ totais / Σ qtd;
- TOTALPRODS = Σ `round(QTDETOTAL×(VRCUSTO−desc%)/FATOREMBAL, 2)`;
- VRICMST e VRBASEST = Σ;
- CFOP, CFOP_ORIGINAL, CST e UNIDADE do primeiro filho (em ordem de NROITEM);
- NROITEM = NROITEM_DECOMP;
- DESCRICAO, CODBARRA, NCM e ALIQUOTA lidos do produto-pai.

A grade-mestre liga os filhos por `CODPRODUTO;NROITEM_DECOMP` ↔ `CODPRODUTOPAI_DECOMPOSICAO;NROITEM_DECOMP` (`uNF.dfm:8919-8921`).

**Produção:**
- 0 NFs de 2026 com um item cujo CODPRODUTO é igual ao CODPRODUTOPAI_DECOMPOSICAO de outro item da mesma NF.
- 0 itens de entrada de 2026 com produto `ENTRADA_DECOMPOSTA='S'`. Os anos anteriores têm itens assim (2020: 63, 2021: 171, 2022: 83, 2023: 2, 2025: 3), todos da "antiga estrutura" (§6.4).
- Estoque, na NF 164053 (pai 2820, 25/09/2026): `HISTORICO_PROD` tem uma linha de "ENTRADA DE ESTOQUE" por filho, com `QTDE_ALTER = QUANTIDADE` (8 de 8), e **nenhuma linha do 2820**.

**Pontas soltas no fonte** (não aparecem no dado):
- Produto `ENTRADA_DECOMPOSTA='S'` **sem cadastro** (o 843374): o pai é apagado e `InsereProdutosDaDecomposicao` não insere nada, porque tudo fica dentro de `if not IsEmpty` (`udmNF.pas:10466`). **O item some da nota.**
- Filho com VRVENDA zero no modo CV: a exceção "Produto "<cód> - <desc>" com valor de venda zero. Verifique!" (`udmNF.pas:10500-10501`) só é levantada **depois** do `Delete` do pai.

---

## 3. Cada filho (Q3)

Todos os filhos com `PERCENTUAL > 0` (`udmNF.pas:10548`) são percorridos em `ORDER BY P.DESCRICAO` (`:10446-10451`) e entram por `Append`. O `cdsItensNota` não tem índice (`udmNF.dfm:3543`, nenhum IndexFieldNames), então fica valendo a ordem de inserção.

Parâmetros da rotina: `AQtdTotal` = quantidade em KG do diálogo, `AValorCustoBruto` = valor total do diálogo, e ICMS-ST e base do item original.

| Coluna | Regra (fonte) | Linha | Produção 2026 (7.132 filhos) |
|---|---|---|---|
| CODNFPROD | `GetID('CODNFPROD')` | 10566 | — |
| CODPRODUTO | IDPRODUTO_01 do cadastro | 10571 | 7.130 no cadastro atual. A exceção são os 2 casos pai/filho de set/2026 (§10) |
| DESCRICAO | `P.DESCRICAO` do filho | 10572 | — |
| QUANTIDADE | `round(AQtdTotal × PERCENTUAL / 100, 3)`, com ajuste no 1º filho (§4) | 10573 | 6.602 de 7.116 nos grupos consistentes. Das 514 diferenças, 319 são o ajuste no 1º filho (grupos com uma diferença só). As outras 195 estão nos 79 grupos que não fecham (§3.2) |
| FATOREMBAL | 1 | 10626 | 1 em 7.132 |
| VRCUSTO modo CV (padrão) | `round(Tot × (Q×VV) / TV / Q, 4)`, com `TV = Σ round(AQtdTotal×PERC/100×VV, 2)` (quantidade **não** arredondada) | 10483-10508, 10592-10598 | **a 6 casas**: 6.245 de 7.116; a 4 casas: 38. Com o ajuste de custo (§4), 824 de 903 grupos fecham 100% |
| VRCUSTO modo CR | `round(Tot × PERC/100 / Q, 4) + vValorUnPerda`, com perda = `Σ PERC(filhos com PERDAS=100) × Tot/100 / Σ qtd(filhos sem perda)` | 10509-10545, 10575-10591 | só a NF 17650 (2021, pai 3940): 21 filhos com custo quase único, 19,69 a 19,70/kg. É o rateio uniforme por kg. O cadastro mudou depois (QEXP não confere mais) |
| ITEM_PERDA_TOTAL | 'S' e VRCUSTO 0,01 quando o filho tem `PERCENTUAL_PERDAS=100` (só no CR); senão 'N' (NewRecord `:4856`) | 10586-10590 | 'N' em todos os anos |
| ARREDONDA | 'S'; no modo CR passa a 'N' quando `VRCUSTO×Q > round(Tot×PERC/100,4)+perda` | 10569, 10582-10583 | 'S' em 7.132 |
| VRVENDA | `VRVENDA` do `cdsProdutos` (MULTI_PRECO da loja logada) | 10600 | = MULTI_PRECO.VRVENDA gravada no `HISTORICO_PROCESSAMENTO_NF` 'PRODUTO' em 7.180 de 7.180 linhas |
| UNIDADE | `PRODUTOS.UNIDADE` do filho | 10604 | 7.132 de 7.132 |
| CODPRODNOTA, CODBARRA | `PRODUTOS.CODBARRA` do filho | 10605, 10612 | 7.132 de 7.132 |
| ALIQUOTA | a do filho (na indústria, a da MULTI_PRECO) | 10607-10611 | 7.132 de 7.132. Os 30 filhos são 'STB' |
| NCMSH, NCM | `PRODUTOS.NCMSH` do filho | 10613-10614 | 6.866 de 7.132 (o NCM de alguns produtos mudou depois) |
| ICMS, ICME, CST, BCR (sem indexador) | `DET_ALIQUOTA(ALIQUOTA do filho, UF = NF.TITULAR_UF)`: ICMS = ICME = ICM, CST, BCR = BASE | 10616-10627 | STB/MG = ICM 0, BASE 100, CST 60. Sem indexador: 2.252 de 2.256 com CST 60 e BCR 100 |
| CFOP | o CFOP digitado no diálogo; o indexador pode trocar (`cdsFigFiscalCODCFOP`, `:10122`) | 10567 | 1403 em 7.132 |
| CFOP_ORIGINAL | o do item-pai | 10568 | 5401, 5403 ou 5405 (o CFOP do XML) |
| INDEXADORTRIB, CST, ICME, BCR, MVA, MVA_AJUSTADO (com indexador) | `CarregarIndexadorItemDecomposicao` (mesma consulta do item comum) + `CalculaNFDecomposicao` | 9986-10176, 10863-10898 | 4.876 de 7.132 com INDEXADORTRIB>0 (68%; nos itens comuns: loja 1 76%, loja 2 74%). CST 70 / ICME 18 / BCR 38,89 é o mais comum |
| VRBASECALCULO, VRICM | `TEMPBASEICME` e `TEMPVLRICME` do CalcValorNota | 10629-10642 | **0 em 7.132** (o filho nunca carrega ICMS próprio) |
| VRBASEST, VRICMST | `ConstICMST = BaseST_pai / Σ TOTALPRODS(filhos com CFOP de ST) × 100` → `TEMPVRBASEST/TEMPVRICMST` (proporcional ao TOTALPRODS) | 10793-10861 | ±0,01: VRBASEST 5.732 de 5.743 e VRICMST 5.736 de 5.743 (filhos com ST) |
| VRBASE_STEXTERNO, STREAL | = VRBASEST e VRICMST no rateio; o indexador pode refazer (`RecalculaICMSSTDecomposicao`, `:10265-10270`) | 10851-10852 | STREAL = VRICMST em 6.106; VRBASE_STEXTERNO = VRBASEST em 6.046; VRICMS_STEXTERNO 0 em 6.427 |
| IDSITUACAO_NF | o da NF | 10570 | 7.132 de 7.132 |
| DECOMPOSICAO | 'S' no fonte; o processamento sobrescreve com `PRODUTOS.DECOMPOSICAO` (`uEstoqueNF.pas:1868`) | 10648 | **'N' em 7.132** (e em todos os filhos desde 2020) |
| PROD_DECOMPOSICAO (campo de tela) | 'S' em memória; ao reabrir = `COALESCE(P.DECOMPOSICAO,'N')` do filho (`udmNF.dfm`, SQL do item) | 10647 | — |
| CODPRODUTOPAI_DECOMPOSICAO | o produto-pai | 10649 | — |
| ATUALIZA_MULTIPRECO_DECOMP | `ifThen(PRODUTOS.ATUALIZA_MULTIPRECO_DECOMP do pai = 'S', 'S', 'N')`. NULL → 'N' (o `RetornarValores` devolve ";…", não vazio) | 10470-10477, 10650 | igual ao flag atual do pai em 7.132 de 7.132 (S 4.732, N 2.400) |
| DESCRICAO_PRODPAI_DECOMP | a DESCRICAO do item-pai | 10651 | = descrição atual do produto-pai em 7.132 de 7.132 |
| NROITEM_DECOMP | o NROITEM do item-pai (a posição no XML) | 10652 | — |
| NROITEM | o fonte não atribui aqui; na gravação renumera 1..N na ordem do dataset (`uNF.pas:4913-4915`) | — | **NULL em 5.689** e preenchido em 1.443. Quando preenchido: = NROITEM_DECOMP ou = 1. Não é o fonte |
| IDPISCOFINS, PIS | não atribuídos aqui (vêm do produto) | — | IDPISCOFINS = produto em 7.132. ALIQPISE/ALIQCOFINSE 0 e CSTPISCOFINS NULL em 7.132 |
| QTD_NOTA, TOTAL_PRODUTO_NOTA | não atribuídos | — | 0 em 7.132 (o XML não chega ao filho) |
| CST_NOTA, ICMS_ALIQ_NOTA | não atribuídos no fonte | — | CST_NOTA preenchido em 4.424 (62%), igual ao do XML (70 ou 60) — binário novo |
| VL_UNITARIO, VL_CUSTO | na gravação: VRCUSTO/FATOREMBAL (4 casas) e o custo corrente do produto (`uNF.pas:4927-4935`) | — | VL_UNITARIO confere em 7.065 |
| GERAESTOQUE, MOVIMENTA_ESTOQUE, ORIGEM_ESTOQUE | NewRecord 'S'/'E' (`udmNF.pas:4824`, `:4784`); no processamento MOVIMENTA := CFOP.PROC_QTDE (`uEstoqueNF.pas:1840`) | — | S / S / E em 7.132 |
| REPASSADO | — | — | 'S' em 7.132 |
| DESCONTO, FRETE, SEGURO, IPI, DEPSACESS, BONIFICACAO | o NewRecord chama `RateioNota` (`udmNF.pas:4859`), que aplicaria o % do cabeçalho | — | 0 em 7.132 |
| Lotes (NF_PROD_LOTE) | **cada** lote do pai é copiado para **cada** filho (`CODNFPRODLOTE` novo, IDPRODUTO do filho). DTFABRICACAO recebe DTVALIDADE (bug em `uItensNF.pas:1918`, `uNF.pas:17559`, `uNF.pas:8876`) | 10658-10668 | 238 lotes em 132 filhos, todos de 2020 a 2023, nenhum desde então. DTFABRICACAO = DTVALIDADE em 197 dos 234 com data |
| NF.QTDE | somada em memória (`:10603`), sem tirar a do pai | — | na gravação: NF.QTDE = Σ itens em 637 de 644 |

### 3.1 Exemplos (produção)

**NF 164053** — loja 1, 25/09/2026, pai 2820 SUINO (modo CV, ATU 'S').
- Qt = 492,700, Tot = 4.232,29 (= NF.TOTALPROD), TV = 8.921,33.
- VRBASEST total 1.892,83 e VRICMST 44,44, rateados.

| Filho | PERC | Q | QEXP | VV | VRCUSTO | fórmula 6 casas | VRBASEST | VRICMST | NROITEM |
|---|---|---|---|---|---|---|---|---|---|
| COSTELA SUINA (1º alfabético) | 17,1 | 84,252 | 84,252 | 23,99 | **11,381004692** | 11,380886 (ajuste +0,01) | 428,84 | 10,07 | 1 |
| LOMBO SUINO | 9,0 | 44,343 | 44,343 | 23,99 | 11,380886 | 11,380886 | 225,70 | 5,30 | NULL |
| PE SUINO | 1,9 | 9,361 | 9,361 | 16,99 | 8,060077 | 8,060077 | 33,74 | 0,79 | 1 |
| PERDA SUINA OSSO/RETALHO | 5,8 | 28,577 | 28,577 | 13,99 | 6,636873 | 6,636873 | 84,82 | 1,99 | NULL |
| PERNIL (CODPRODUTO 1267, IDPRODUTO_FILHO 215) | 41,2* | 202,992 | 202,992 | 16,99 | 8,060071 | 8,060077 | 731,74 | 17,18 | NULL |
| SUAN SUINA | 11,1 | 54,690 | 54,690 | 12,99 | 6,162472 | 6,162472 | 150,73 | 3,54 | NULL |
| TOUCINHO P/BANHA | 8,6 | 42,372 | 42,372 | 10,99 | 5,213670 | 5,213670 | 98,80 | 2,32 | NULL |
| TOUCINHO P/TORRESMO | 5,3 | 26,113 | 26,113 | 24,99 | 11,855287 | 11,855287 | 138,46 | 3,25 | NULL |

- Todos os filhos: CFOP 1403, CFOP_ORIGINAL 5403, CST 60, STB, ICME 0, BCR 100, DECOMPOSICAO 'N', ATU 'S', NROITEM_DECOMP 1.
- *O cadastro tem o 215 com 41,2%. O item gravou o 1267 (pai do 215) com IDPRODUTO_FILHO 215 (§10).
- O custo do PERNIL (8,060071) é o único fora da fórmula sem explicação.

**NF 163219** — loja 2, 17/09/2026, pai 833018 DIANTEIRO DE VACA (CV, ATU 'N'). Tem os dois ajustes:
- Qt = 163,800; Σ QEXP = 163,799.
- ACEM (1º alfabético): QEXP 51,269 e Q gravado **51,270** (+0,001).
- Custo do ACEM: fórmula 22,615332, gravado **22,615136954** = (22,615332×51,27 − 0,01)/51,27.
- Os outros 7 filhos conferem exatamente (ex.: MACA PEITO 19,656 kg a 25,200680; OSSO BOVINO 29,975 kg a 0,116341, com VV 0,18).

**NF 163941** — loja 2, 23/09/2026: 1 item comum e 2 grupos.
- Item comum: FIGADO, NROITEM 1, CFOP 1401, CST 70, QTD_NOTA 120,32, TOTAL_PRODUTO_NOTA 1.202,00.
- Grupo NROITEM_DECOMP 2: pai 832410 COSTELA INTEIRA, ATU 'S', 4 filhos.
- Grupo NROITEM_DECOMP 3: pai 833018, ATU 'N', 8 filhos.
- O produto 710 MUCHIBA aparece **nos dois grupos**, a 45,93575 e a 45,237255/kg. Isso acontece em 506 pares produto×NF, em 201 NFs de 2026.
- Filhos: QTD_NOTA e TOTAL_PRODUTO_NOTA 0, CST_NOTA 70 e ICMS_ALIQ_NOTA 18 (copiados do XML pelo binário novo), IDPISCOFINS 12 ou 13, INDEXADORTRIB 0.

### 3.2 Onde a fórmula não fecha (grupos consistentes = todos os filhos no cadastro atual, soma 100 e mesmo número de filhos)

| Situação | Grupos |
|---|---|
| Fórmula inteira confere (quantidade e custo dos "outros" exatos; no máximo o 1º filho ajustado) | **824** (512 sem ajuste de quantidade, 312 com) |
| Pai 832410 antes de 08/04/2026: o cadastro mudou nesse dia (`AUDIT_DECOMPOSICAO`: 3 UPDATEs em 08/04/2026 10:41) | 65 |
| Outros, sem explicação | 14 (2820: 7, 8297: 1, 832408: 2, 832410: 1, 833018: 3) |
| Não consistentes (filho fora do cadastro: o 1267 de §10) | 2 |

`AUDIT_DECOMPOSICAO` tem só 6 linhas no total (3 INSERTs do 859529 em 06/08/2025 e os 3 UPDATEs do 832410). Não dá para datar mudanças mais antigas.

---

## 4. Arredondamento (Q4)

**Ajuste de quantidade** (`udmNF.pas:10680-10736`).
- Calcula `vQtdeRestante = AQtdTotal − Σ QTDETOTAL(filhos do grupo)`.
- Se ≠ 0, soma ou subtrai no **primeiro** filho do dataset que não seja `ITEM_PERDA_TOTAL`, e para aí (`Break`, `:10718`/`:10725`).
- O primeiro do dataset é o primeiro inserido, isto é, o primeiro em `P.DESCRICAO`.

Produção: 319 grupos têm exatamente um filho com Q ≠ QEXP, e em **319 de 319** é o primeiro alfabético. Diferenças: −0,004 (7), −0,003 (9), −0,002 (70), −0,001 (111), +0,001 (122).

**Ajuste de custo** (`udmNF.pas:10738-10791`).
- Calcula `vTotalRestante = AValorCustoBruto − Σ VRTOTALPRODUTOS`, com `VRTOTALPRODUTOS = round(Q×VRCUSTO, 2)` (`:4147`).
- Se ≠ 0, o mesmo 1º filho recebe `VRCUSTO := (VRCUSTO×Q ± |resto|)/Q`. Fica com 9 casas, porque a coluna é NUMBER(18,9).
- A quantidade usada já é a ajustada.

Produção, grupos em que a fórmula fecha:
- 302 primeiros filhos sem ajuste;
- **522 de 522** ajustados batem com `C = C6 + resto/Q` a 9 casas. Resto: −0,06 (1), −0,05 (2), −0,04 (2), −0,03 (11), −0,02 (50), −0,01 (175), +0,01 (190), +0,02 (51), +0,03 (23), +0,04 (11), +0,05 (5), +0,20 (1).
- Resultado: `NF.TOTALPROD = Σ round(Q×VRCUSTO,2)` em **644 de 644** NFs com filhos.

**O ST não tem ajuste de sobra.** TOTALBASEICMT da NF = Σ VRBASEST em 315 de 644 (505 dentro de R$ 0,05). TOTALICM_ST = Σ VRICMST em 335 de 644 (506 dentro de R$ 0,05).

**No fonte:** `vQtdeProdutoDeco` e `vTotalProdutoDeco` são variáveis locais **não inicializadas** (`udmNF.pas:9944`, `:9947`, somadas em `:10690`/`:10748`). O dado (644 de 644) mostra que, na prática, partem de zero. O porte deve inicializar em 0.

---

## 5. Reedição e recálculo (Q5)

| Gatilho | Condição | O que faz | Linhas |
|---|---|---|---|
| **Editar a NF** (`btnEditarClick`) | TIPO='E', PROC<>'S', itens não vazios | Para **cada item cujo produto tem ENTRADA_DECOMPOSTA='S'** (um pai ainda presente, típico logo após importar o XML): abre o diálogo. OK → apaga o pai e insere os filhos. Cancelar → `Continue` (o pai fica, e o processamento continua travado). Os filhos já gerados **não** são mexidos (os 30 produtos-filho têm ENTRADA_DECOMPOSTA 'N' ou NULL) | `uNF.pas:3953-3954`, `:17435-17597` |
| **Ctrl+D** na aba de itens | NF em edição ou inclusão, linha da grade = pai virtual (`PRODPAIDECO='S'`) | Diálogo pré-preenchido com Σ QUANTIDADE dos filhos, fator 1, Σ total e o CFOP do 1º filho. OK → apaga **todos** os filhos com `NROITEM_DECOMP`+`DESCRICAO_PRODPAI_DECOMP` do pai (e seus lotes) e **regera** com o cadastro e os preços **atuais**; reconstrói a grade | `uNF.pas:11286-11291` → `:8804-8906` |
| **Excluir** o pai virtual (`btnDelItemClick`) | linha `PRODPAIDECO='S'` | Confirmação: "O item selecionado faz parte de uma decomposição. Todos os itens da decomposição serão excluídos. Deseja realmente excluí-lo?" Bloqueia se algum filho foi devolvido, tem lote ou é de produção. Depois exclui todos os filhos | `uNF.pas:3804-3860` |
| **OK do diálogo do item** | incluir ou editar item de produto ENTRADA_DECOMPOSTA com TIPO='E' | igual ao primeiro caso, para um item | `uItensNF.pas:1858-1945` |
| `RecalcularCustoEValoresDaNotaFiscal` | — | só `CalcValorCusto`/`CalcValorNota` item a item. **Não regera** filhos | `uNF.pas:8782-8800` |

Não existe regeneração automática: `InsereProdutosDaDecomposicao` só é chamada nos três pontos acima.

No Ctrl+D, só os lotes do registro corrente são recolhidos a cada volta (`uNF.pas:8866-8881`), e DTFABRICACAO recebe DTVALIDADE (`:8876`).

Produção: não há rastro direto de Ctrl+D (nenhuma coluna guarda). Ver "Não determinado".

---

## 6. Processamento (Q6)

### 6.1 Antes de processar
- `Processamento` exige que não haja pai sem decompor (`uNF.pas:14810`).
- `ValidaProdutosComDecomposicao` (`:14817` → `:16846-16885`) filtra os itens com `PROD_DECOMPOSICAO='S'` e checa o cadastro via `ProdutoComDecomposicaoValida` (`udmNF.pas:11730-11756`): nenhum PERCENTUAL <= 0 e soma = 100,00.
  - Mensagem: "Os produtos <lista> estão com erros na decomposição. Verifique o cadastro do produto para continuar com o processamento da nota fiscal!"
  - Depois de reaberta, só os produtos com PRODUTOS.DECOMPOSICAO='S' caem aqui, ou seja, os pais da antiga estrutura.

### 6.2 A tela de estoque do processamento (`TfrmEstoqueNF.FormShow`, `uEstoqueNF.pas:1724-1880`)
- `MOVIMENTA_ESTOQUE := PROC_QTDE` do CFOP (`:1840`). CFOP 1403: PROC_QTDE 'S', ALTERA_CUSTO_NF 'S', ATUALIZA_VENDA_NF 'N'.
- **`DECOMPOSICAO := PROD_DECOMPOSICAO`** (`:1868`), isto é, o `PRODUTOS.DECOMPOSICAO` do produto do item. Os 30 produtos-filho têm 'N' (29 com ENTRADA_DECOMPOSTA NULL e 1 com 'N').

Produção 2026: os 7.132 filhos têm PROC 'S', GERAESTOQUE 'S', MOVIMENTA 'S', ORIGEM 'E' e DECOMPOSICAO 'N'.

O único grupo de filhos em NF não processada (3 NFs de 2024, 24 filhos, loja 1) tem 16 linhas de `HISTORICO_PROCESSAMENTO_NF` por NF. Foram processadas e revertidas, então o `:1868` já tinha rodado.

### 6.3 O gatilho `ESTOQUE_NOTAS` (AFTER UPDATE ON NF, lido de `all_source`, 1.054 linhas)
- Cursor `CPRODUTO` (l. 40-61):
  - QTDEX = QUANTIDADE×FATOREMBAL;
  - `COALESCE(NP.DECOMPOSICAO,'N')` e `COALESCE(NP.GERAESTOQUE,'N')`;
  - MOVIMENTA_ESTOQUE é lido em `PROC_QTDENP` e **nunca usado**.
- Na virada PROC N→S (l. 120), com GERAESTOQUE='S' e ORIGEM 'E' (l. 262-321):
  - **`DECOMPOSICAO='S'`** (l. 264-286): em vez do próprio produto, atualiza o ESTOQUE de cada `DECOMPOSICAO.IDPRODUTO_01` do produto do item com `QTDEX×PERCENTUAL/100` (cursor `CESTOQUE_DECOMPOSICAO`, l. 63-81). Grava em HISTORICO_PROD com o sufixo ". PROD. DECOMPOSICAO." e em `DECOMPOSICAO_NF_QTDE`.
  - **Senão** (l. 287-319): `ESTOQUE.QTDE += QTDEX` do próprio produto, DTENT/QTDE_ENT e HISTORICO_PROD.
  - Os ramos 'D', 'P', 'X' e dinâmico repetem o padrão (l. 158-197, 199-260, 323+, 384+).
- A reversão (l. 546+) espelha tudo.
- **Bug:** `DELETE FROM DECOMPOSICAO_NF_QTDE WHERE CODNF = :NEW.CODNF` fica **dentro** do loop de filhos (l. 282, 178, 230, 343, 407, 477), então só o último filho sobra. Em 2026 há 2 linhas para 2 itens da antiga estrutura (8 e 4 filhos).

**Resultado para a entrada decomposta:** só os filhos movem estoque, cada um o seu. O pai não existe na NF. Prova na NF 164053: 8 de 8 filhos com "ENTRADA DE ESTOQUE" de QTDE_ALTER = QUANTIDADE, e 0 linhas do 2820.

### 6.4 A "antiga estrutura" (não é a entrada decomposta)
- É o item cujo produto tem PRODUTOS.DECOMPOSICAO='S' e que **fica na nota** (`NF_PROD.DECOMPOSICAO='S'` sem CODPRODUTOPAI): o gatilho distribui o estoque pelos filhos.
- Produção: 2020 E 26, 2021 E 171, 2022 E 83 + S 4, 2023 E 2 + S 8, 2024 S 2, 2025 E 2 + S 2, **2026 S 2** (pais 2820 e 832410 em saídas). `DECOMPOSICAO_NF_QTDE` por ano: 14, 171, 86, 11, 2, 4, 2.
- Custo da antiga estrutura: `cdsMultiPreco_decomp` recebe `VRCUSTOFINAL` do item quando MOVIMENTA_ESTOQUE='S', `ATUDCOMPOSICAO<>'N'`, ALTERACUSTO e ATUALIZA_MULTIPRECO_DECOMP='S' (`udmNF.pas:7623-7640`, gate em `:7624-7628`; SQL em `udmNF.dfm:15788-15802`). Em 2026, nenhuma entrada tem item-pai, então está dormente (confirma `uEstoqueNF-UpdateProdutos.md` §7).

### 6.5 O custo na MULTI_PRECO (UpdateProdutos)
- Gate: `AlteraMultiPreco(ALTERACUSTO and ATUALIZA_MULTIPRECO_DECOMP='S' and CFOP.ALTERA_CUSTO_NF='S')` (`udmNF.pas:7506-7510`).
- Histórico: `ALTERACUSTODECO/ESTO/CFOP` → `EXISTEALTERACAOCUSTO` (`:6950-6954`).
- Produção, filhos de 2026 × `HISTORICO_PROCESSAMENTO_NF` 'PROCESSAMENTO':

| ATU do filho | ALTERACUSTODECO | ALTERACUSTOESTO | ALTERACUSTOCFOP | EXISTEALTERACAOCUSTO | linhas |
|---|---|---|---|---|---|
| N | N | S | S | N | 2.408 |
| S | S | S | S | S | 4.772 |

O item comum sai com ATUALIZA_MULTIPRECO_DECOMP 'S' pelo NewRecord (`udmNF.pas:4857`): 52.002 'S' e 1.617 NULL em 2026.

---

## 7. `CONSIDERA_ITENS_DECOMPOSICAO_SPED_FISCAL` e outros usos (Q7)

- **View** `GET_CONFIG_DECOMPOSICAO`: `SELECT COALESCE(CE.VALOR, C.VALOR) … WHERE C.CODIGO='CONSIDERA_ITENS_DECOMPOSICAO_SPED_FISCAL'`. Nenhum objeto do banco depende dela; só o Delphi a usa.
- **EFD ICMS-IPI.**
  - 0200: `UdmSpedFiscal.pas:1720-1790`.
  - C170: `adqNFprod`, `UdmSpedFiscal.dfm:2868-3180`.
  - Config ≠ 'N': o item com PRODUTOS.DECOMPOSICAO='S' recebe `FLG_PRODUTO_DECOMPOSTO='R'` e sai do C170. Um segundo SELECT gera um C170 virtual por filho do cadastro:
    - QTD = `QUANTIDADE×PERC/100` (2 casas);
    - VL_ITEM = `QUANTIDADE×VRCUSTO×PERC/100`;
    - VRICM, BC, BC-ST e ICMS-ST também × PERC/100;
    - CST e CFOP do pai.
  - Config 'N': mantém o item como está.
  - EFD-Contribuições: igual (`UdmSpedPisCofins.dfm:2283`, `:2534`, `:2821`, `:4202-4260`).
  - O texto da config fala da flag "A entrada deste produto na NF será de forma decomposta" **desmarcada**. Ela vale para a **antiga estrutura**. Os filhos da entrada decomposta têm PRODUTOS.DECOMPOSICAO='N' e não são afetados.
- **Produção:** 'N', sem específicas. O C170 sai como está gravado: os filhos na entrada decomposta e o pai na antiga estrutura.
- **Relatórios do Apollo** que leem o cadastro na hora (não a NF):
  - `rel-compras.service.ts:165-189` (compras por produto, rateando o pai pelo PERCENTUAL);
  - `analise-casa-carne.service.ts:85-115` (a peça decomposta distribui a compra entre os cortes).

---

## 8. Estruturas no Oracle (Q8)

- **DECOMPOSICAO:**
  - colunas: CODDECOMP NUMBER(10) NOT NULL, IDPRODUTO NUMBER(10) (o pai), IDPRODUTO_01 NUMBER(10) (o filho), PERCENTUAL NUMBER(13,2), **GERA_SCRAP CHAR(1)**;
  - GERA_SCRAP não aparece no fonte de 2020 e está NULL nas 135 linhas;
  - 135 linhas, 13 pais, 30 filhos;
  - gatilho `AUDIT_DECOMPOSICAO` (INSERT, UPDATE e DELETE em AUDIT_DECOMPOSICAO, com programa e máquina da `Gsession`).
- **PRODUTOS:** ENTRADA_DECOMPOSTA CHAR(1), CALCULO_VALOR_CUSTO_DECOMP CHAR(2), ATUALIZA_MULTIPRECO_DECOMP CHAR(1), PERCENTUAL_PERDAS NUMBER(15,3), DECOMPOSICAO CHAR(1).
  - Também existem DECOMPOSICAO_UN, DECOMPOSICAO_LIVRE, SAIDA_DECOMPOSTA e NAO_DECOMPOR_SAIDA, que não estão no fonte de 2020. Nos 13 pais: DECOMPOSICAO_UN 'N', DECOMPOSICAO_LIVRE 'N', SAIDA_DECOMPOSTA NULL, NAO_DECOMPOR_SAIDA NULL (e 'N' no 832408).
  - COMPOSICAO, ESTOQUECOMPOSICAO, CODCOMPOSICAO e CHAVECOMPOSICAO são da composição.
- **NF_PROD:** DECOMPOSICAO CHAR(1), CODPRODUTOPAI_DECOMPOSICAO NUMBER(10), ITEM_PERDA_TOTAL CHAR(1), ATUALIZA_MULTIPRECO_DECOMP CHAR(1), DESCRICAO_PRODPAI_DECOMP VARCHAR2(150), NROITEM_DECOMP NUMBER(10), CFOP_ORIGINAL NUMBER(10).
  - Relacionadas: IDPRODUTO_FILHO, NROITEM NUMBER(10), VRCUSTO **NUMBER(18,9)**, QUANTIDADE NUMBER(13,3), FATOREMBAL NUMBER(13,3).
- **DECOMPOSICAO_NF_QTDE:** CODDECOMPNFQTD, CODNF, CODNFPROD, CODPRODUTO, CODPRODUTO_PRINCIPAL, NROITEM, QTDE, PERCENTUAL. Só o gatilho grava (§6.3).

---

## 9. O que o Apollo tem hoje (somente leitura)

| Peça | Existe? | Onde |
|---|---|---|
| Tabela `decomposicao` (coddecomp, idproduto, idproduto_01, percentual, gera_scrap) | sim | mig `023_produto_kit.sql:35-44` |
| Cadastro da decomposição no produto (detalhe `decomposicoes`, soma 100 validada no back, `gera_scrap` preservado, flag `decomposicao` derivada) | sim | `produto.aggregate.ts:117-123`, `:340-348`; `DecomposicaoModal.tsx` |
| `produtos.entrada_decomposta`, `atualiza_multipreco_decomp` gerenciados na tela | sim, como checkboxes | `produto.aggregate.ts:99-100`; `ProdutoCadMaster.tsx:2436-2437` |
| `produtos.calculo_valor_custo_decomp`, `percentual_perdas` | só as colunas (mig 310:1286, 1294). **Fora da lista gerenciada**: a tela não edita | `310_todos_os_campos.sql` |
| Rótulo do checkbox | "Atualiza o preço da decomposição". O legado diz "Atualiza valor de custo dos itens de decomposição na multi-preço" (é custo, não preço) | `ProdutoCadMaster.tsx:2437` |
| `nf_prod.decomposicao`, `codprodutopai_decomposicao`, `item_perda_total`, `atualiza_multipreco_decomp`, `descricao_prodpai_decomp`, `nroitem_decomp` | colunas sim (mig 310:914-938; defaults 'N'/'N'/'S' na mig 351:80-85). **Não estão nas `colunas` do item** do agregado: são preservadas pela chave natural `codproduto`, casando a n-ésima ocorrência (`aggregate-engine.service.ts:274`) | `nf.aggregate.ts:500-530` |
| `nf_prod.cfop_original`, `idproduto_filho` | sim | mig 215:35; `nf.aggregate.ts:512` |
| `nf_prod_lote`, `decomposicao_nf_qtde`, `empresas.atudcomposicao` | tabelas e colunas sim | mig 169, 311:77-88, 310:359 |
| Gatilho "entra decomposto" / diálogo / `InsereProdutosDaDecomposicao` / linha virtual do pai / Ctrl+D / excluir grupo | **não** | — |
| Trava do processamento para pai não decomposto | **não**: hoje uma NF importada com o 2820 seria processada e moveria o estoque do **pai** | `nf-processamento.service.ts` |
| `DECOMPOSICAO := PRODUTOS.DECOMPOSICAO` no processamento (uEstoqueNF:1868) e estoque da antiga estrutura | **não**: o processamento move sempre o produto do próprio item ("composição/decomposição (kit)" adiada) | `nf-processamento.service.ts:60-71` |
| Gate do custo `ATUALIZA_MULTIPRECO_DECOMP`×`ALTERA_CUSTO_NF`×estoque | **sim** | `nf-produtos-processar.ts:72-74` |
| SPED com a config | EFD-Contribuições: só **remove** o pai quando a config ≠ 'N', sem gerar os filhos virtuais. EFD ICMS-IPI: nada. Com a produção em 'N', não há efeito | `sped-efd-contribuicoes.service.ts:307-324` |

---

## 10. Divergências fonte (mai/2020) × produção

| Tema | Fonte | Produção | Decisão |
|---|---|---|---|
| NF_PROD.DECOMPOSICAO do filho | 'S' (`udmNF.pas:10648`) | 'N' em 100% desde 2020 | **Explicado pelo próprio fonte**: `uEstoqueNF.pas:1868` sobrescreve no processamento. O porte grava 'N' (ou replica o `:1868`) |
| Casas do VRCUSTO (modo CV) | 4 (`:10596`) | 6 (6.245 de 7.116 contra 38 a 4 casas) | seguir o dado: 6 |
| NROITEM dos filhos | renumerado 1..N na gravação (`uNF.pas:4913-4915`) | NULL em 5.689 (80%). Por grupo (905): em 522 os preenchidos são todos = NROITEM_DECOMP, em 170 são todos = 1, em 211 estão todos NULL e 2 grupos têm outro padrão | não determinado (§ND) |
| CST_NOTA, ICMS_ALIQ_NOTA do filho | não atribuídos | preenchidos em 4.424 (62%) | não determinado |
| Produto-filho com IDPRODUTO_PAI | — | desde 17/09/2026: 7 filhos com IDPRODUTO_FILHO = CODPRODUTO = 215 e 2 (NFs 164019 e 164053, 23 e 25/09) com **CODPRODUTO = 1267** (o pai do 215), IDPRODUTO_FILHO 215 e CODPRODNOTA '0126'. O estoque entrou no 1267 (HISTORICO_PROD da NF 164053). Antes de 17/09: 258 filhos do 215 com IDPRODUTO_FILHO NULL | binário de set/2026, instável: não portar ainda |
| Indexador do filho na loja 1 com 'D' | não consulta | 68% dos filhos com indexador | já explicado: a loja 1 era 'O' até 22/09/2026 (`uItensNF-indexador.md` §0) |

---

## Cortes propostos (do menor para o maior risco)

1. **C1 — Trava e cadastro.**
   - Portar `ValidaProdutosComEntradaEmDecomposicao` no processar da entrada: item com `produtos.entrada_decomposta='S'` bloqueia, com a mensagem literal de §1.1.
   - Pôr `calculo_valor_custo_decomp` (rádio CV/CR) e `percentual_perdas` na lista gerenciada do produto e na tela.
   - Corrigir o rótulo do checkbox.
   - Portar `ProdutoComDecomposicaoValida` (soma 100 e nenhum ≤ 0) na trava.
   - Risco baixo: só impede processar errado, que é o que acontece hoje.
2. **C2 — Leitura e preservação.**
   - Na grade da NF, agrupar os filhos por (`codprodutopai_decomposicao`, `nroitem_decomp`) numa linha virtual do pai, com as somas de §2.
   - Incluir as 6 colunas de decomposição nas `colunas` do item, ou garantir a preservação por posição: um mesmo produto aparece em dois grupos em 201 NFs de 2026.
   - Tratar `nroitem` NULL dos filhos na ordenação e na renumeração.
   - Risco baixo.
3. **C3 — Motor puro `decomporItemEntrada`**, sem banco. Entradas: pai, cadastro, VRVENDA dos filhos, modo CV/CR e perdas. Deve implementar:
   - quantidade a 3 casas;
   - custo CV a **6 casas**; CR a 4 casas mais a perda;
   - ITEM_PERDA_TOTAL/0,01;
   - ajuste de quantidade e de custo no 1º filho em ordem de descrição, pulando o de perda;
   - rateio do ST por TOTALPRODS sem ajuste de sobra.
   - Teste de ouro: os 824 grupos consistentes de 2026 (e a NF 17650 para o CR).
   - Risco médio (numérico), mas isolado.
4. **C4 — Diálogo "Confirmar decomposição"** e troca pai → filhos numa transação:
   - no OK do item de entrada (NF não processada) e ao abrir para edição uma NF importada que tenha pai;
   - quantidade em KG, valor total e CFOP validado contra a tabela CFOP;
   - fiscal por filho: DET_ALIQUOTA (alíquota do filho, UF do fornecedor) e depois `indexadorDoItem` como item novo;
   - descrição, unidade, NCM, CODPRODNOTA e alíquota do filho;
   - IDSITUACAO_NF da NF, REPASSADO 'S', ATUALIZA_MULTIPRECO_DECOMP do pai, DESCRICAO_PRODPAI_DECOMP, NROITEM_DECOMP e CFOP_ORIGINAL;
   - DECOMPOSICAO 'N';
   - lotes do pai copiados para cada filho, **sem** o bug da DTFABRICACAO.
   - Guardas que o fonte não tem: produto sem cadastro não apaga o item; filho com VRVENDA 0 aborta **antes** de apagar o pai.
   - Risco médio-alto (mexe no agregado da NF).
5. **C5 — Ctrl+D (recalcular o grupo) e excluir o grupo**, com as travas de devolvido, lote e produção de §5. Regera com o cadastro e os preços atuais. Risco médio.
6. **C6 — Processamento e SPED da antiga estrutura.**
   - No processar: `nf_prod.decomposicao := produtos.decomposicao`.
   - Para o item com 'S', mover o estoque dos filhos por PERCENTUAL e registrar `decomposicao_nf_qtde`, **sem** o bug do DELETE no loop.
   - Expandir C170 e 0200 quando `CONSIDERA_ITENS_DECOMPOSICAO_SPED_FISCAL`='S'.
   - Em 2026 são só 2 itens de saída, e a config está 'N'. Risco alto e ganho baixo: por último, e só com decisão do usuário.

---

## Não determinado

- **O que o binário atual grava em NF_PROD.DECOMPOSICAO na inclusão do filho.** Não existe NF com filhos que nunca tenha sido processada: as 3 de 2024 com PROC 'N' têm histórico de processamento. O valor final 'N' está provado; o valor no momento do insert, não.
- **A regra do NROITEM dos filhos no binário novo.** NULL em 5.689 de 7.132; preenchido = NROITEM_DECOMP ou = 1. O fonte renumeraria 1..N.
- **A origem de CST_NOTA e ICMS_ALIQ_NOTA nos filhos** (62% preenchidos, com o valor do XML). O fonte não atribui.
- **A troca pai/filho de produto (IDPRODUTO_FILHO, CODPRODUTO do pai) desde 17/09/2026** (9 filhos). Não dá para saber se é regra nova ou efeito de o 215 ter ganho IDPRODUTO_PAI recentemente; a LOG do produto não foi consultada. O PERNIL da NF 164053 (8,060071) é o único custo fora da fórmula na NF.
- **14 grupos (1,5%) em que a fórmula não fecha** e o cadastro atual é consistente. O `AUDIT_DECOMPOSICAO` só tem 6 linhas, e mudanças anteriores ao gatilho não podem ser datadas.
- **A quantidade e o valor originais do pai.** O item é apagado, e não achei tabela com os itens do XML (nenhuma coluna QCOM, XPROD ou VPROD). Σ filhos = pai está provado só pelo cabeçalho: TOTALPROD em 644 de 644 e QTDE em 637 de 644.
- **O modo CR e a perda total no binário novo.** O CR só foi usado em 2021 (21 filhos, cadastro alterado depois). A perda (PERCENTUAL_PERDAS=100) nunca apareceu. Não dá para confirmar as casas decimais nem a fórmula da perda com dado.
- **Se o indexador trocou o CFOP dos filhos.** Todos têm 1403, e o pai foi apagado, então não se distingue o CFOP digitado do CFOP da figura.
- **Uso real do Ctrl+D e da exclusão do grupo.** Nenhuma coluna ou LOG consultada registra.
- **As diferenças de ST acima de R$ 0,05 no cabeçalho** (139 NFs): a origem não foi investigada. Pode ser item comum na mesma NF ou recálculo do indexador.
