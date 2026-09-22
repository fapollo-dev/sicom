# Reforma tributária IBS/CBS

Telas **110 `FRMCADCLASSTRIBIBSCBS`** e **145 `FRMCADCSTIBSCBS`** da fila.
Corte-1 (os cadastros): migration **278**, smoke §153.1-5. Corte-2 (os grupos na nota): migration **279**,
smoke §154.1-5, na seção 8.

## 1. Sem fonte no repositório, e por um motivo legítimo

O `retaguarda-master` clonado é de **mai/2020**; a reforma é a EC 132/2023 + LC 214/2025. As duas units não
existem lá — `grep -ril IBSCBS` no fonte inteiro devolve zero. O material é o **dado da produção**, que é o
que o cliente roda hoje. É o mesmo caminho do motor do razão (mig 202), pelo mesmo motivo, e o mesmo fato já
registrado na precificação: o fonte é de 2020 e a produção roda binário mais novo.

Toda contagem abaixo é do Oracle de produção (só leitura), 21/09/2026.

## 2. O mecanismo está vivo e em volume

Não é tela de futuro. O cliente já grava os grupos IBS/CBS na nota:

| | |
|---|---:|
| `NF_PROD_IBSCBS` | **98.747 itens** |
| … base de cálculo | R$ 26.276.533,06 |
| … IBS · CBS | R$ 15.931,30 · R$ 143.275,55 |
| `NF_IBSCBS` | 10.011 notas |
| **só em 2026** | **68.677 itens**, base R$ 17.642.187,45 |
| `PRODUTOS` com `CODCLASS_TRIB` | **44.501 de 47.729 (93,2%)** |

A alíquota praticada em 97.299 dos 98.747 itens é **0,1% de IBS-UF + 0,9% de CBS** — a fase-teste de 2026. E
isso **bate com o seed da mig 007** (`tributacao_reforma`), que foi feito da legislação antes de olhar o
cliente. Os outros 1.448 itens estão zerados (CST sem tributação).

Predominam **entradas**: 8.596 notas de fornecedor (78.042 itens) contra 1.029 de saída (12.288). Faz
sentido — quem emite com os grupos novos é o fornecedor, e o cliente recebe.

## 3. ⚠️ A regra que uma implementação ingênua quebra

**A redução de IBS e a de CBS são independentes.** Das 132 classificações, **uma tem `PRED_IBS` = 60 e
`PRED_CBS` = 100**. Guardar "um percentual de redução" e aplicá-lo aos dois erraria essa linha em silêncio —
e é justamente a faixa de **CBS zerada com IBS reduzido**, onde o erro vira imposto cobrado a mais.

Distribuição das 132: 73 sem redução · 24 com 100/100 · 21 com 60/60 · 5 com 40/40 · 3 com 50/50 · 2 com
70/70 · 2 com 30/30 · 1 com 80/80 · **1 com 60/100**.

As duas colunas existem separadas na migration, no schema e na tela, e a grade marca em vermelho a linha
assimétrica. Smoke §153.2.

## 4. O que cada tabela é

| tabela | linhas | o que guarda |
|---|---:|---|
| `CST_IBS_CBS` | 17 | o catálogo de CST da reforma |
| `CLASS_TRIB` | 132 | a classificação tributária (cClassTrib, 6 dígitos) com a redação da LC |
| `CCLASS_TRIB_NCM_ANEXOS` | 199 | o de-para cClassTrib × NCM por anexo |
| `IBS_UF` | 27 | a alíquota de IBS por UF (0,1 em todas) |
| `IBS_MUN` | 0 | vazia |
| `INTEGRACAO_IBSCBS` · `_WL` | 0 · 0 | staging de integração, vazias |

**A CST vale por documento fiscal, não em geral.** São **nove flags** separadas (`IND_NFE`, `IND_NFCE`,
`IND_CTE`, `IND_CTEOS`, `IND_BPE`, `IND_BPETM`, `IND_NF3E`, `IND_NFCOM`, `IND_NFSE`): a mesma CST vale para
NF-e e não vale para CT-e. A tela mostra as nove em colunas e filtra por "só as válidas para NF-e".

A `CLASS_TRIB` se distribui por CST assim: **000** tributação integral (4) · **010/011** alíquotas uniformes
(7) · **200** reduzida (121), destas 24 de alíquota zero e 18 de redução de 60%. Por tipo de alíquota:
Padrão 60 · Sem alíquota 55 · Uniforme setorial 8 · Uniforme nacional 5 · Fixa 4.

Os anexos da LC: **IX** 82 vínculos · **VII** 69 · **I** 29 · XII 5 · V 5 · XIV 4 · IV 2 · VIII, XIII, VI 1
cada. A busca é por **prefixo** de NCM: o anexo lista o código com 8 dígitos e quem consulta tem o capítulo
(2 dígitos) ou a posição (4) na mão. Smoke §153.3.

## 5. Duas fontes de alíquota, de propósito

`IBS_UF` é a tabela **operacional** do cliente. `tributacao_reforma` (mig 007) é o **parâmetro** com
vigência, CBS e fonte legal, e é quem manda no cálculo do preço (`preco-fiscal.service.ts`). As duas
existem e hoje concordam em 0,1.

A tela mostra as duas lado a lado e **marca a divergência** em vez de escolher uma calada. Ausência de
parâmetro não é divergência — é ausência, e aparece como traço. Smoke §153.4.

Por isso `tributacao_reforma` **não é carregada do legado**: o `IBS_UF` do cliente só tem o IBS, sem CBS,
sem vigência e sem fonte. Serve de conferência, e confere. (Eu havia mapeado `tributacao_reforma` para
`CST_IBS_CBS` na varredura de 18/09 e estava errado — ver o Achado 5 da `FILA-CONVERSAO.md`.)

## 6. Excluir é estorno lógico, e produto apontando segura

Apagar a classificação que produtos usam deixaria a nota **sem cClassTrib** — rejeição na SEFAZ, não erro
interno. No cliente há 44.501 produtos classificados, então isso não é hipótese.

- com produto apontando: **422 `CLASS_TRIB_EM_USO`**, dizendo quantos;
- sem produto: estorno lógico com `INDR='E'` + usuário + data, some da lista e volta com
  `incluir_estornadas` — a linha não é apagada;
- sem o grant `BTNEXCLUIR`: 403.

Gravar uma classificação com CST fora do catálogo é **422 `CST_IBSCBS_NAO_CADASTRADA`**: é a CST que decide
que grupos do XML entram, então ela não pode ser texto livre. Smoke §153.2 e §153.5.

## 7. Fold declarado: vigência

`CLASS_TRIB` tem `D_INI_VIG` e `D_FIM_VIG`, e as duas estão **vazias nas 132 linhas**. O catálogo do cliente
é o vigente, sem histórico. As colunas vêm junto porque o leiaute da reforma as prevê e a carga precisa de
destino, mas **nenhuma regra depende delas** — quem tem vigência de verdade aqui é a alíquota, e essa mora
em `tributacao_reforma`.

## 8. Corte-2 — os grupos na nota (migration 279)

`NF_PROD_IBSCBS` (98.760 itens) e `NF_IBSCBS` (10.012 notas), smoke §154.1 a §154.5.

### 8.1 ⚠️ A alíquota efetiva é a que conta, e a coluna dela não é confiável

Duas camadas, as duas medidas.

**(a) Quem multiplicar a base pela alíquota cheia cobra imposto a mais.** Nos **31.633 itens com redução**:

| | real | pela alíquota cheia |
|---|---:|---:|
| IBS | R$ 469,70 | R$ 10.872,08 |
| CBS | R$ 4.233,04 | R$ 97.781,80 |
| **cobrado a mais** | | **R$ 103.951,14** |

São 23× em cada tributo. A redução vem de `CLASS_TRIB` (corte-1) e chega ao item: **21.848 itens têm
redução de 100%** (alíquota zero) e 9.833 têm 60%.

**(b) E ler a coluna de alíquota efetiva que o legado grava não resolve — para a CBS ela é lixo.**
`PALIQEFET_CBS` fica em **0 em 46.677 itens cuja redução é 0** (deveria ser 0,9), enquanto 41.255 deles
têm o valor de CBS calculado certo. Medido nas 97.005 linhas com base:

| conta | acerta |
|---|---:|
| IBS derivando `vbc × pibsuf × (1 − predaliq/100)` | **96.966 (99,96%)** |
| IBS lendo `paliqefet_ibsuf` | 95.038 |
| CBS derivando | **89.277** |
| CBS lendo `paliqefet_cbs` | 56.129 (57,9%) |

Por isso o serviço **deriva** e grava a efetiva como resultado, em vez de confiar na coluna. É uma função
só para os três tributos, de propósito: o erro que ela evita é aplicar a redução a um e esquecer do outro.

### 8.2 ⚠️ O que o fornecedor mandou não é o que fica: R$ 4,9 milhões

As colunas `_ORI` guardam o que veio no XML; as sem sufixo, o que ficou depois da conferência de entrada.

| | |
|---|---:|
| itens com base alterada | **36.278** |
| base do fornecedor | R$ 4.040.470,56 |
| base efetiva | R$ 8.936.794,30 |
| **diferença** | **+R$ 4.896.323,74** |

E a CST é reclassificada em 9.530 itens: **7.753 vieram como 000** (tributação integral) e ficaram **200**
(alíquota reduzida) — o fornecedor não aplicou a redução e a conferência aplicou; 1.375 no sentido inverso
e 377 de 410 para 000. É a mesma semântica dos pares `*_nota` do `nf_prod`, e é por isso que as duas
colunas existem. Recalcular **não reescreve** a origem: sem esse par não há o que conferir.

### 8.3 A aritmética do cabeçalho

`VIBS = VIBSUF + VIBSMUN` em **10.012 de 10.012** notas — exata, não aproximada; a consulta devolve
`ibs_fecha` para que a quebra apareça. O cabeçalho é a soma dos itens em ~95% (9.642 no IBS-UF).

### 8.4 Produto sem classificação: decisão escrita, não `null` virando zero

**44.501 dos 47.729 produtos** estão classificados; os 3.228 que faltam sairiam com IBS/CBS zerado e a nota
seria rejeitada. Calcular com item sem classificação é **422 `PRODUTO_SEM_CLASSIFICACAO`**. Só passa com
pedido explícito, e aí o item é tributado **integral** (redução 0), porque pagar cheio o que não se sabe é
o conservador e zerar seria sonegar calado — é também o que o legado faz, onde a CST padrão é 000. A
resposta devolve quantos itens saíram assim.

### 8.5 Folds declarados

No item, `PREDALIQ` e `PALIQEFET` **sem sufixo** estão vazias nas 98.760 linhas — são as genéricas, e o
cliente só usa as por tributo. No cabeçalho, `VDIF`, `VDEVTRIB`, `VIBSMUN`, `VCREDPRES` e
`VCREDPRESCONDSUS` estão **zeradas nas 10.012 notas**: o município ainda não cobra IBS na fase-teste e o
cliente não tem crédito presumido. Vêm com destino porque o leiaute da NF-e as exige.

⚠️ `CODCCLASS_TRIB_NCM_ANEXOS` é **0 em 92.726 dos 98.760 itens** (93,9%): o legado usa zero como "sem
vínculo", não NULL. Os 6.034 positivos casam todos. Uma FK direta rejeitaria 92.726 linhas na carga — no
ETL o zero vira NULL (`nullif`).

⚠️ A empresa vem da nota (padrão do Achado 4): nenhuma das duas tabelas guarda loja e **3.623 das 10.012
notas são da empresa 2**. As duas entraram na f1 do `plano-tabelas.json` com a empresa derivada da NF.


## 9. Auditoria minuciosa do corte-2 (21/09/2026) — quatro defeitos meus, medidos

Auditei o corte-2 linha a linha contra a legislação e o dado depois de entregue. Achei **quatro defeitos**,
todos meus, todos corrigidos na migration **280** e provados no smoke §154.6 a §154.10.

### 9.1 ⚠️ Eu cobraria imposto sobre imunidade constitucional

`PRED_IBS` nulo significa **duas coisas opostas**, e quem decide é `TIPO_ALIQUOTA`:

| | | |
|---|---|---|
| `Padrão` + nulo | sem redução | tributa integral ✔️ |
| `Sem alíquota` + nulo | **não tributa** | ❌ eu tributava |

O cliente tem **23 produtos** nessa armadilha, e eles circulam:

| CST | o que é | produtos | já em nota |
|---|---|---:|---|
| **410** | Imunidade e não incidência (livros, jornais, periódicos e o papel; fonogramas musicais brasileiros — art. 150, VI, "d" e "e" da CF) | 17 | 18 itens, R$ 8.472,82 |
| **620** | Tributação monofásica sobre combustíveis, cobrada antecipadamente | 6 | 21 itens, R$ 19.972,70 |

O legado acerta: nenhum desses 39 itens tem linha em `NF_PROD_IBSCBS`. Os 98.760 que ele gerou têm **só CST
000 e 200**. Meu erro daria R$ 284,46 na fase-teste de 1% e **R$ 7.538,07 no regime pleno de 26,5%** — e o
que importa não é o valor, é cobrar sobre imunidade e bitributar combustível.

**A regra certa exige os dois indicadores, e nenhum sozinho basta:** `IND_GIBSCBS = 1` não garante alíquota
percentual (510 diferimento, 550 suspensão, 830 exclusão de base e 220 fixa têm o grupo e não têm
alíquota), e `TIPO_ALIQUOTA = 'Padrão'` não garante fórmula simples (210 e 222 trazem redutor de **base**).

> calculável ⟺ `TIPO_ALIQUOTA = 'Padrão'` **e** `IND_GIBSCBS = 1` **e** `IND_REDUTOR_BC <> 'S'`

São **56 das 132** classificações. Cada item gravado agora diz por quê, na coluna `tratamento`:
`calculado` · `nao_tributado` · `monofasico`. O que não se sabe calcular é **recusado** (422
`CLASSIFICACAO_EXIGE_TRATAMENTO_PROPRIO`, com a lista) e nada é gravado — inventar número onde não se sabe
calcular é pior do que parar.

### 9.2 ⚠️ A base não é o valor cheio: o imposto não entra na base do imposto

A LC 214/2025 (art. 12, § 2º) exclui da base do IBS e da CBS o montante do **ICMS, do ISS, do PIS e da
COFINS**. O dado confirma com precisão:

| fórmula | acerta (de 87.815 itens) |
|---|---:|
| **valor do produto − ICMS − PIS − COFINS** | **86.201 (98,2%)** |
| valor cheio (o que eu usava) | 54.016 (61,5%) |

O "valor do produto" é o total da nota quando existe; em 20.058 itens ele vem zerado e o legado usa
quantidade × custo (com a mesma subtração, acerta 19.511 desses 20.058).

Meu erro inflava a base em **R$ 806.350,38**, o que cobra a mais R$ 8.063,50 na fase-teste e
**R$ 213.682,85 no regime pleno**.

### 9.3 ⚠️ A alíquota vale na data da nota, não hoje

Eu buscava a alíquota por `current_date`. A reforma sobe por degraus — 0,1% + 0,9% em 2026 e **17,7% + 8,8%
em 2033** (o que a mig 007 semeia) — então recalcular em 2033 uma nota de 2026 aplicaria **26,5× a mais**.
E recalcular nota antiga é rotina de conferência fiscal, não exceção. Agora a data de emissão manda.

### 9.4 ⚠️ Eu carimbava procedência falsa

O par `_ORI` é **procedência**: o que veio no XML do fornecedor ou na carga do legado. Meu código caía para
o valor atual quando a origem estava vazia, ou seja, carimbava o resultado do nosso próprio cálculo como se
fosse o do fornecedor. A partir daí a nota **nunca mais divergiria**, porque o original passaria a ser a
nossa conta. Agora só se preserva o que já existe, e as colunas `_ori` ficam fora do `SET` do recálculo.

### 9.5 Dois folds que a auditoria confirmou com rigor

- **IBS municipal: zero em 98.794 de 98.794 itens** (alíquota e valor). Não é "quase sempre zero" — é
  sempre, e por isso o cálculo o fixa em zero na fase-teste.
- **Imposto seletivo: o legado não o implementa.** Nem `NF_PROD_IBSCBS` nem `NF_IBSCBS` têm coluna de IS
  (conferido no dicionário do Oracle); `CSTIS`/`CCLASSTRIBIS` só existem na staging `INTEGRACAO_IBSCBS`, com
  0 linhas. Não há leiaute nem dado para migrar. **É frente nova e não é pequena**: o cliente tem **3.276
  produtos classificados com NCM de bebida (cap. 22) ou fumo (cap. 24)**, as categorias do IS.

### 9.6 O que a auditoria também ensinou sobre o método

A comparação do `TIPO_ALIQUOTA` é feita **por prefixo sem diacrítico**, não por igualdade literal. Não é
zelo excessivo: nesta mesma auditoria, a consulta `tipo_aliquota <> 'Padrão'` contra o Oracle **casou com
todas as linhas** por diferença de encoding. Se isso acontecesse na carga, o efeito seria pesado — com
"Padrão" não casando, todo item viraria tratamento próprio e nenhuma nota calcularia. Smoke §154.8.


## 10. Segunda revisão (22/09/2026) — o que a primeira auditoria não olhou

A primeira auditoria (§9) atacou a **regra fiscal** do corte-2. Esta segunda olhou o que ficou de fora:
o **corte-1**, o **código** (transação, tenant, concorrência) e o **ETL**. Mais seis defeitos, todos meus.

### 10.1 ⚠️ O cálculo não tinha transação

O `calcular` gravava N itens e depois o cabeçalho, cada um numa instrução solta. Uma falha no meio do laço
deixaria **metade dos itens novos ao lado do cabeçalho velho** — um total que não corresponde a nenhuma
versão dos itens, logo depois de o próprio cabeçalho afirmar a identidade `vibs = vibsuf + vibsmun`.
É o mesmo defeito que apontei no legado da precificação por NF bruta (mig 273, `Commit` dentro do laço),
e aqui seria pior porque é documento fiscal. Agora tudo roda numa transação só.

### 10.2 ⚠️ O tipo de alíquota governava a fórmula e aceitava qualquer coisa

Depois da mig 280, `TIPO_ALIQUOTA` decide se o item se calcula pela alíquota da UF, se não tributa ou se
tem cálculo próprio. Mas o schema o deixava **opcional e de texto livre**. Gravar sem tipo faria toda nota
daquela classificação ser recusada; gravar com tipo inventado faria o cálculo sair errado calado. Agora é
obrigatório e fechado nos cinco valores da LC 214/2025, comparados sem diacrítico — e a normalização é
**a mesma função** que o serviço usa (`normalizaTipoAliquota`, no shared), porque duas cópias dessa regra
seriam duas verdades. Smoke §153.6.

### 10.3 ⚠️ A exclusão validava fora da transação (TOCTOU)

`excluirClassTrib` contava os produtos num `SELECT` e estornava num `UPDATE` separado: entre um e outro,
outra sessão pode classificar um produto, que ficaria apontando classificação estornada. Agora a linha é
travada com `FOR UPDATE` antes da contagem. A exclusão também passou a **contar o uso em notas e em
vínculos de NCM** — isso não barra (item de nota calculado é histórico; apagar a classificação não apaga a
nota), mas vai no detalhe para quem decide ver. Smoke §153.7.

### 10.4 ⚠️ O histórico perdia o nome da classificação

A consulta dos grupos fazia `JOIN class_trib ... AND coalesce(indr,'I') <> 'E'`. Bastava estornar a
classificação para toda nota antiga aparecer **sem descrição**. Consulta de cadastro filtra estornadas;
consulta de **histórico** não. O join foi aberto.

### 10.5 ⚠️ O upsert não atualizava a nota nem o produto do item

O `ON CONFLICT` recalculava os valores mas mantinha `codnf`, `idempresa` e `codproduto` antigos. Se o item
trocasse de produto entre um cálculo e outro, o grupo apontaria o produto errado **com os valores certos** —
o pior tipo de inconsistência, porque não chama atenção. As três colunas entraram no `SET`.

### 10.6 ⚠️ A carga FALHARIA na chave estrangeira — o legado guarda órfãos

As duas tabelas referenciam o documento, e o legado tem grupo de tributação sem documento:

| | total | órfãos | |
|---|---:|---:|---|
| `NF_PROD_IBSCBS` | 99.109 | **9.733 (9,8%)** | sem item de nota (8.504 sem nem a nota) |
| `NF_IBSCBS` | 10.054 | **416** | sem nota |

Valor preso nos itens órfãos: base R$ 1.141.521,80 · IBS R$ 708,36 · CBS R$ 6.377,56. Sem filtro a carga
não perderia linha em silêncio — ela **falharia inteira** na FK. Os dois `FILTROS` entraram no ETL e foram
testados na produção: passam 89.376 e 9.638, descartando 9.733 e 416, contados no manifesto.

### 10.7 Conferido e correto (para não reabrir depois)

- **Tenant nos itens**: `nf_prod` não tem coluna de empresa; o filtro por `codnf` é seguro por
  transitividade, porque a nota já foi validada contra o tenant antes.
- **Itens que somem**: a FK `ON DELETE CASCADE` limpa o grupo quando o item da nota é apagado — não sobra
  grupo órfão de um recálculo para outro.
- **Arredondamento**: cada item é arredondado a 2 casas antes de somar, e o cabeçalho é a soma dos itens
  arredondados. É o que o legado faz (o cabeçalho bate com a soma dos itens em ~95% das notas).
- **Alíquota zero legítima**: `pIbsUf` só cai para a tabela de reserva quando o parâmetro é **nulo**, não
  quando é zero — `??` e não `||`.


## 11. Terceira verificação (22/09/2026) — o que ainda NÃO está coberto

Perguntado se novos problemas vão aparecer, a resposta honesta é **sim, provavelmente**. Esta terceira
passada não achou defeito ativo novo, mas achou o que falta. Fica escrito para não se perder.

### 11.1 Dois alarmes que investiguei e eram falsos

- **A base das notas de SAÍDA.** Um teste meu indicou que a fórmula acertava 1 item em 11.405. O teste
  estava errado, não o código: eu havia escrito `nvl(total_produto_nota, 0)` onde o código faz
  `coalesce(nullif(total_produto_nota, 0), quantidade × custo)` — e nas saídas o total vem zerado. Medida
  com a fórmula real: **94,8% nas saídas, 98,6% nas entradas, 98,1% no geral**. Lição: medir a fórmula
  que está no código, não uma paráfrase dela.
- **O endereço do parceiro.** O serviço usa o endereço padrão e a nota tem o seu próprio
  (`NF.CODPARCEIRO_END`). Medido: em **9.653 notas, zero** têm UF diferente entre os dois. Inócuo hoje,
  mas o certo é a nota mandar — anotado abaixo.

### 11.2 Um risco real, hoje sem efeito: operação interestadual

| | notas | itens | base |
|---|---:|---:|---:|
| entrada interestadual | 324 | 2.447 | R$ 550.041,03 |
| saída interestadual | 28 | 637 | R$ 59.322,22 |

Na reforma o IBS interestadual se reparte entre origem e destino, e o cálculo aqui aplica só a alíquota do
estabelecimento. **Hoje isso não muda um centavo**: as 27 UFs de `IBS_UF` têm alíquota idêntica (0,1) e o
legado usa a mesma alíquota nas interestaduais e nas internas. Vira material quando as UFs fixarem
alíquotas próprias, na transição a partir de 2029.

### 11.3 Frentes inteiras que não foram feitas, e estão declaradas

| frente | situação |
|---|---|
| **XML da NF-e com os grupos** | o Apollo calcula e grava; não emite o grupo no XML nem valida contra o schema da SEFAZ |
| **Imposto seletivo** | não existe no leiaute do legado (§9.5); 3.276 produtos de bebida/fumo esperando |
| **Crédito de IBS/CBS na entrada** | o comprador credita o imposto da entrada; nada aqui apura crédito |
| **Alíquota setorial, nacional e fixa** | 17 classificações — recusadas com 422, não calculadas |
| **Crédito presumido** | 9 classificações — idem |
| **Diferimento e suspensão** | 22 classificações — idem |
| **Split payment** | mecanismo de recolhimento na liquidação; fora de escopo até aqui |
| **Endereço da nota** | usar `NF.CODPARCEIRO_END` em vez do endereço padrão (hoje dá no mesmo em 9.653 de 9.653) |

### 11.4 O que as três passadas dizem sobre o risco

| passada | o que auditou | defeitos |
|---|---|---:|
| 1ª | a regra fiscal contra a LC 214/2025 e o dado | 4 |
| 2ª | o corte-1, o código e o ETL | 6 |
| 3ª | saída, interestadual, endereço, cobertura | 0 ativos (2 alarmes falsos, 1 risco futuro) |

A curva sugere convergência, não perfeição. O que dá confiança no que **está** feito não é a ausência de
achados na terceira passada — é que cada regra tem um número medido em produção ao lado e um check no
smoke. O que não tem número medido é o que está na tabela de 11.3, e é por ali que o próximo problema vem.
