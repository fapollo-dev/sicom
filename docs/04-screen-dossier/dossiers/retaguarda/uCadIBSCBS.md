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
