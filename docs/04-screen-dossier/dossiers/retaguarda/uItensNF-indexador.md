# Recon — Indexador tributário no item da NF (NF_PROD), binário novo × fonte de 2020

Data: 25/09/2026. Somente leitura. Fonte Delphi em `/Library/SicomGit/retaguarda-master/fonte/Units` (mai/2020). Produção Oracle
(`SERVER_HOST = oracle`, `DB_NAME = apollo`) consultada só com SELECT, depois de `SET TRANSACTION READ ONLY`. Script: `q.py`, na mesma pasta.
População padrão: `NF.TIPO='E'` e `DTCONTABIL >= 01/01/2026`. Quando digo "período O" da loja 1, uso só o que foi gravado antes de 22/09/2026 08:53.

---

## 0. Achado principal: a premissa "o binário novo carrega o indexador em 'D'" não se confirma

**A loja 1 era 'O' até 22/09/2026 08:53:28.** Quem trocou foi o usuário "ACESSO DE PROGRAMADOR", pela tela "Cadastro de empresas":

```
LOG.IDLOG 15733296 · 22/09/2026 08:53:28 · Alterou · Cadastro de empresas · CHAVE CODEMPRESA · VALOR 1
CAMPO: FIGURAFISCAL    VALOR ANTERIOR: O    VALOR ATUAL: D
```

- É a **única** troca de FIGURAFISCAL na LOG. São 368 linhas de EMPRESAS desde 15/07/2020, e só esta mexe no campo.
- Cobertura do indexador na loja 1, mês a mês: de jan/2025 a ago/2026, 99–100% dos itens de fornecedor não-livre têm indexador. Em set/2026 caem para 2.126 de 2.532.
- Troca e sessões abertas: `dmPrincipal.Empresa` é carregado no login, então quem já estava logado continuou em 'O'. As NFs 163519 a 163617 (22/09, de 08:57 a 11:47) ainda gravaram INDEXADORTRIB>0. **A partir da NF 163453 (22/09 11:57), todas as 480 linhas de item gravadas na loja 1 (50 NFs) saíram com INDEXADORTRIB 0 e REPASSADO N→S.**
- Hoje, na loja 1, os itens gravados depois da troca estão assim: INDEXADORTRIB 0, REPASSADO 'S', VRICMS_STEXTERNO 0 e MVA_AJUSTADO intacto (é o pMVAST do XML). Isso é exatamente o fonte de 2020: `CarregaIndexadorTributario` cai no `else → IndexadorNaoEncontrado` (uItensNF.pas:996-998, :790-795) e o OK do item grava REPASSADO 'S' (uItensNF.pas:1855-1856).

**Conclusão:** neste tema, o binário novo não diverge do fonte de 2020 em nada que o dado prove. Os 26.846 itens com indexador da loja 1 "em 'D'" são do período em que ela era 'O'.
Situação atual das empresas: **1 = D (desde 22/09), 2 = O, 50 = D (SN), 51 = O, 52 = O**.
Em 2026, as lojas 50 e 51 não têm nenhuma NF de entrada, e a 52 tem 19.

---

## 1. As regras, com o dado ao lado de cada uma

### R1 — Quando o indexador é consultado (o "gate")
Fonte: `uItensNF.pas:805-809`. A consulta só roda quando:
- `FIGURAFISCAL in ('O','S')`;
- o fornecedor não é livre de indexador (`FornecedorLivreDeIndexador`, `uItensNF.pas:3863-3882`: `PARCEIROS.RETIRA_FORNINDEX='S'`, lido só quando FIGURAFISCAL <> 'D' e LIBERA_NF_INDEXADOR <> 'S'; nos demais casos o fornecedor já é tratado como livre);
- não há `COD_PED_DEV_COMPRA`;
- `NF.LIBERA_NF_INDEXADOR <> 'S'`.

Fora disso, `IndexadorNaoEncontrado` (`:790-801`).

Dado, período O, itens fora de transferência ('T'):
- Fornecedor livre (RETIRA_FORNINDEX='S'), em 2026: INDEXADORTRIB 0 em 8.118 de 8.127 itens na loja 1 (99,9%) e em 5.968 de 5.980 na loja 2 (99,8%).
  Em 2025 aparecem 960 e 436 itens de fornecedor hoje livre com indexador. O mais provável é o flag ter sido ligado depois (não determinado).
- Fornecedor não-livre, desde 2025: INDEXADORTRIB>0 em 100% dos itens processados da loja 2 (41.021) e em 99,94% da loja 1 (67.700 contra 40 itens de 4 NFs, com fornecedor cujo flag provavelmente mudou).
- Loja 1 depois da troca para 'D': INDEXADORTRIB 0 em 100% dos itens gravados por sessão nova (480 linhas de item em 50 NFs).

Os itens da decomposição têm consulta própria e idêntica (`CarregarIndexadorItemDecomposicao`, `udmNF.pas:9987-10162`). Isso explica os itens que já nascem com INDEXADORTRIB no LOG "Inseriu": sempre os mesmos 8–9 códigos (69710…69717, 71419), 62 vezes cada.

### R2 — Os candidatos
Fonte: SQL de `cdsFigFiscal` (`udmNF.dfm:17567-17602`) mais o sufixo `AND CODCFOP < 4000` na entrada / `> 4000` na saída (`uItensNF.pas:811`).
Parâmetros (`:816-823`):
- `CODFIGURAFISCAL` = PRODUTOS.CODFIGURAFISCAL;
- `ORIGEM` = UF de PARCEIROS_END (NF.CODPARCEIRO_END, o `TITULAR_UF` de `udmNF.dfm:85`); `DESTINO` = UF da empresa (invertidos na saída);
- `TP_CADASTRO` 'F' na entrada, 'C' na saída;
- `CODBARRA` = PRODUTOS.CODBARRA **ou NULL**; `NCM` = PRODUTOS.NCMSH **ou NULL**; `CODPARCEIRO` = NF.CODPARCEIRO **ou NULL**;
- `CODCFOP = CFOP do item`;
- `COALESCE(INDR,'I') <> 'E'`.

Dado: comparei os 46.261 itens com INDEXADORTRIB>0 de 2026 (lojas 1, 2 e 52) com a linha escolhida.

| conferência | loja 1 (27.578) | loja 2 (18.664) | loja 52 (19) |
|---|---|---|---|
| linha do indexador existe | 100% | 100% | 100% |
| CODFIGURAFISCAL = a do produto | 99,43% | 99,40% | 100% |
| ORIGEM = UF do fornecedor / DESTINO = UF da loja | 100% / 100% | 100% / 100% | 100% |
| TP_CADASTRO = 'F' | 100% | 99,92% | 100% |
| CODCFOP = CFOP do item | 99,94% | 99,46% | 100% |
| CODCFOP = CFOP_ORIGINAL (o do fornecedor) | 0 | 0 | 0 |
| CODBARRA nulo ou = produto | 99,74% | 99,71% | 100% |
| NCM nulo ou = NCMSH do produto | 99,17% | 98,98% | 100% |
| CODPARCEIRO nulo ou = fornecedor | 99,95% | 99,46% | 100% |
| INDR <> 'E' | 99,82% | 99,80% | 100% |

Por que não é 100%: 9,3% (loja 1) e 8,2% (loja 2) das linhas escolhidas foram alteradas em 2026, depois do repasse.
O NCM da chave é o do **produto**. O NF_PROD.NCM difere do NCMSH do produto em 1,2–1,5% dos itens.
Como a CFOP é filtro, a atribuição `edtCFOP := cdsFigFiscalCODCFOP` (`:953`) não muda nada.

### R3 — Desempate (sequencial, sem ORDER BY)
Fonte: `uItensNF.pas:826-885`. Com mais de 1 candidato, filtra em cadeia: CODBARRA, se houver algum que case (`Locate`) → NCM → CODCFOP (inócuo, todos iguais) → CODPARCEIRO.
Se ainda sobrarem vários, filtra `CNPJ_CPF = TITULAR_CNPJ` **sem Locate** (`:876-884`). Com esse filtro incondicional, se nenhum casar o dataset fica vazio e o item cai em "não encontrado" (`:922-926`).
Com vários, vale o registro corrente: o primeiro da ordem física, porque a consulta não tem ORDER BY.

Dado: refiz os candidatos com a regra de R2 sobre o cadastro de hoje. São 44.932 itens de fornecedor não-livre, fora de 'T', antes de 22/09.
- **Quando a linha escolhida ainda está entre os candidatos (44.149 itens), ela é sempre a de maior especificidade lexicográfica (CODBARRA > NCM > CODPARCEIRO).** "Escolhido abaixo do topo": **0 casos**.
  O desempate sequencial equivale à soma de pesos 4/2/1: os pesos são potências de 2, e a soma vira uma ordem lexicográfica.
- 783 itens (1,7%) têm a linha escolhida fora do conjunto de hoje, porque o cadastro ou o produto mudou depois.
- **Empate no topo: 2.048 itens (4,6%).** Em **todos**, os empatados têm o mesmo CNPJ_CPF do fornecedor, então o passo do CNPJ nunca discrimina.
  - Quem vence: **primeiro ROWID em 97,1%** (1.989); menor CODINDEXADORTRIBUTARIO em 93,7% (1.918).
  - Em 1.723 desses 2.048, as linhas empatadas **diferem no conteúdo** (operação, alíquota, MVA, redução…), então a escolha muda o imposto.
  - O cadastro tem 191 grupos (397 linhas) com a chave inteira duplicada (figura/tp/origem/destino/cfop/barra/ncm/parceiro, INDR <> 'E').
- O caso "o filtro do CNPJ esvazia e vira não encontrado" não aparece no dado: **não determinado** se ainda ocorre.

### R4 — Achou: o que o item recebe
Fonte: `uItensNF.pas:927-992`.
- **CST** pela OPERACAO: T 0 (e BCR 100 provisório), R 20, C 10, F 60, S 50, D 51, I 40, N 90, Y 41, Z 70, '' 0. Operação fora da lista deixa o CST como estava.
- **CFOP**: o do indexador, que é o mesmo do item.
- **ICME** (`edtAliquota`, DataField ICME, `uItensNF.dfm:3847`): ICM_FONTE na entrada, ou ALIQUOTA_REDUZIDA_LEI_3166 quando ALIQUOTA_FONTE_LEI_3166='S'.
- **BCR** (`edtBaseCalculo`, `uItensNF.dfm:3897`): REDUCAO.
- **TEMPMVA** := MVA; no OK vira `NF_PROD.MVA := TEMPMVA` (`:1593`).
- **INDEXADORTRIB** := CODINDEXADORTRIBUTARIO.
- `IndexadorTributario.SetParametros(...)`, de onde sai **MVA_AJUSTADO** (`:964-992`).

Dado (IDX>0, 2026):

| campo | loja 1 | loja 2 |
|---|---|---|
| CST = mapa(OPERACAO) | 98,07% | 97,35% |
| ICME = ICM_FONTE (ou Lei 3166) | 98,37% | 97,69% |
| BCR = REDUCAO | 96,75% | 96,19% |
| MVA = MVA do indexador | 99,34% | 99,41% |
| MVA_AJUSTADO = fórmula | 99,40% | 99,45% |

A fórmula é `uIndexadorTributario.pas:259-285`: MVA 0 → 0; ORIGEM <> DESTINO e TP_FIGURA <> 'S' → `RoundTo(((MVA/100+1)·(ICM_FONTE/100−1)/((ALIQUOTA−FEM)/100−1)−1)·100, −3)`; senão, o próprio MVA.

**CODFIGURAFISCAL não é coluna de NF_PROD.** Não existe na produção. No fonte é campo do join `P.CODFIGURAFISCAL` com PRODUTOS (`udmNF.dfm:2530`), `ProviderFlags = []` (`udmNF.dfm:5278-5280`). A atribuição de `:962` serve só à tela. **Não há o que gravar.**

### R5 — Não achou
Fonte: `IndexadorNaoEncontrado` (`uItensNF.pas:790-801`): INDEXADORTRIB 0, REPASSADO 'N', zera o `IndexadorTributario`. Com fornecedor livre ou NF liberada e o item em inserção, reaplica a alíquota do produto (`cbbAliquotaChange`).
Em 'O', o usuário com acesso a `frmCadIndexadorTributario` vê "Indexador não encontrado! Deseja cadastrar agora?" (`:888-913`). Sem acesso, vê "…Solicite suporte para fechar a Nota!" (`:915`).
CST, ICME, BCR e MVA_AJUSTADO não são tocados e ficam os do XML ou do produto.

Dado:
- Eventos de "não encontrado" na LOG (INDEXADORTRIB → 0 com REPASSADO inalterado, isto é, continuou 'N'), para fornecedor não-livre no período O de 2026: **loja 1, 894 linhas em 429 NFs (~10% das NFs); loja 2, 310 linhas em 130 NFs (~5%)**.
- **Todas essas NFs foram processadas depois.** O fluxo real: o item fica 'N', o indexador é cadastrado, o item é repassado de novo.
- Quem cadastra: em 2026 a LOG de INDEXADOR_TRIBUTARIO tem **1.876 "Inseriu" do usuário BORBA** (formulário "Indexador Tributário"), mais 4 do programador.

### R6 — MVA do item
Fonte:
- entrada, inclusão: `TEMPMVA := PRODUTOS.MVA` (`uItensNF.pas:2532`); alteração de produto: `:2748`; edição: `TEMPMVA := MVA` quando nulo (`:2718-2719`);
- com indexador: `TEMPMVA := I.MVA` (`:960`);
- OK: `MVA := TEMPMVA` (`:1593`); ao gravar em 'D': `MVA := TEMPMVA` (`uNF.pas:4907-4908`).

Dado: sem indexador, MVA = PRODUTOS.MVA em 91,8% (loja 1) e 91,5% (loja 2) dos itens processados; com indexador, 99,3% (R4).

### R7 — ST externo da entrada (`RecalculaICMSST`, uItensNF.pas:3369-3431, ramo FIGURAFISCAL <> 'D' e LIBERA <> 'S')

**Caso especial** (ST_EXTERNO='S', CFOP 1403/2403, MVA>0, NF de emissão própria e não importada): VRBASEST = VRICMST = STREAL = VRBASE_STEXTERNO = 0, e VRICMS_STEXTERNO = VRICMS_STEXTERNO_SEPARADONF = VrICMSSTCalculado (`:3375-3386`).
Dado: só 1 linha de indexador tem ST_EXTERNO='S', e **VRICMS_STEXTERNO_SEPARADONF ≠ 0 em 0 itens** de 2026.

**Fornecedor livre** (`:3390-3406`): valores TEMP do produto, ou `VRBASE_STEXTERNO := VRBASEST`, `STREAL := VRICMST`, `VRICMS_STEXTERNO := 0`.

**Com indexador** (`:3419-3428`):
- nota não importada: VRBASEST/VRICMST := os da nota;
- `STREAL := VrICMSSTCalculado`, `VRBASE_STEXTERNO := VrBCSTCalculada`, `VRICMS_STEXTERNO := VrICMSSTRecolher`, SEPARADONF 0;
- tudo com `TruncarArredondar(…, 'A', 2)`.

**TIndexadorTributario** (`uIndexadorTributario.pas`):
- `CalcularST` = CFOP na lista (1403/2403, 1401/2401, 1407/2407, 1411/2411, 1949/2949, 1910/2910, 1911/2911, 1902/2902, 1124, 1923/2923, 1406/2406 e as de saída) **e** MVA ≠ 0; bonificação (19xx) sem CST 10/60/70 não calcula (`:417-447`).
- VrTotalProduto = produto + IPI + (DEPSACESS + SEGURO) + frete; − desconto **só** com CONSIDERAR_DESCONTO_CALC_ST='S' (`:393-401`).
- BCST = VrTotalProduto × **REDCOM/100** × (1 + MVAAjustado/100). Se |BCST − BC-ST da nota| ≤ 0,01999, usa a da nota (`:287-312`).
- Débito = BCST × ALIQUOTA/100. Crédito = (produto − desconto) × REDUCAO/100 × ICM_FONTE/100, mais frete × ICM_FONTE se GERAICM_FRETE. Na Lei 3166: ES = crédito da nota × alíquota da lei; outras UFs = produto × alíquota da lei (`:314-339`).
- **Recolher = débito − crédito − ST da nota**, zerado se estiver em [−0,02; 0,01] (`:374-391`). **Não há piso em zero.** Calculado = nota + recolher (não-SN).

Dado (IDX>0, 2026, período O). Recomputei em SQL com produto = VRCUSTO×QUANTIDADE, IPI% do item, DEPSACESS, VRFRETE e VRDESCPROD:

| | loja 1 | loja 2 |
|---|---|---|
| CalcularST falso: VRICMS_STEXTERNO = 0 | 21.232 / 21.232 (100%) | 13.327 / 13.327 (100%) |
| CalcularST falso: VRBASE_STEXTERNO = VRBASEST | 99,2% | 99,2% |
| CalcularST verdadeiro: VRICMS_STEXTERNO = recolher (±0,05) | 5.531 / 5.709 (96,9%); entre os ≠0, 783/786 (99,6%) | 4.565 / 4.700 (97,1%); entre os ≠0, 762/763 |
| CalcularST verdadeiro: VRBASE_STEXTERNO = BCST (±0,05) | 94,6% | 94,9% |
| VRICMS_STEXTERNO < 0 em 2026 | 102 | 38 |
| STREAL = VRICMST + VRICMS_STEXTERNO (nos ≠0) | 759 / 792 | 743 / 772 |

Os negativos provam que não há piso em zero.
Há 49 linhas de indexador com REDCOM = 0 e MVA > 0. Nelas o legado zera a base literalmente: 15 itens de 2026 com VRBASE_STEXTERNO 0.

### R8 — REPASSADO (OK do item)
Fonte: `uItensNF.pas:1839-1856`.
```pascal
if (FIGURAFISCAL <> 'D') and (LIBERA_NF_INDEXADOR <> 'S') then
  if (INDEXADORTRIB > 0) or FornecedorLivreDeIndexador or (FINALIDADE = '4') then 'S'
  else if FIGURAFISCAL = 'O' then 'N' else 'S'
else 'S'
```
O item nasce da importação com REPASSADO **NULL**: o "Inseriu" da LOG não traz o campo em 95% dos itens. Só o OK do diálogo, direto ou pela análise F7/F8/Enter (`UAnalisaItemNF.pas:419-458`, `:541-636`, `:638-670`, que abrem o mesmo `TfrmItensNF`), grava 'S' ou 'N'.

Dado, desde 2025, período O:

| situação do item | resultado |
|---|---|
| IDX>0 | 'S' em 100% (loja 1: 69.201; loja 2: 41.674) |
| IDX 0 com fornecedor livre, fora de 'T' | 'S' em 100% (loja 1: 18.739; loja 2: 13.284) |
| IDX 0 com fornecedor não-livre | 'N' nas NFs não processadas (loja 1: 3 itens; loja 2: 33); 'S' em só 40 itens de 4 NFs processadas (ruído) |
| REPASSADO NULL | item nunca analisado (import pendente) ou NF de transferência 'T' |

Loja 1 depois de 'D': 'S' em 100%.

### R9 — Transferência entre lojas (`NF_IMPORTACAO_NFE='T'`)
Rótulo "NF-e transferência entre lojas" (`uNF.pas:7323-7335`, `:8380-8383`). A entrada **copia** INDEXADORTRIB e REPASSADO dos itens da saída de origem. Casando por CHAVENFE e NROITEM: 637 'N'/'N' e 100 'S'/'S' na loja 2 (a origem é a loja 1, que era 'O'); 66 e 12 'S'/'S' na loja 1.
A cópia não passa pela LOG com "Inseriu" (a LOG dessas NFs só tem "Processamento rápido").
**Por isso há NF 'T' processada com item 'N': 1.112 itens em 68 NFs da loja 2 desde 2025** (337 itens em 10 NFs em 2026). A trava as isenta (seção 2).

### R10 — Quem grava (LOG)
INDEXADORTRIB e REPASSADO só aparecem na LOG dos formulários **"Notas fiscais de entrada"** e **"Notas fiscais de saída"**. É o gravar da NF que persiste o que o diálogo ou a análise mudou em memória. Em 2026, na entrada: loja 1 com 23.385 N→S + indexador, 7.362 N→S com indexador 0; loja 2 com 15.242 e 4.992.
"Itens da nota fiscal" só registra a troca de descrição, e "Processamento rápido" nunca grava esses campos.
**Não dá para separar, pela LOG, o repasse manual do F7** (não determinado).
Estranheza: o "VALOR ANTERIOR" do REPASSADO no "Alterou" é 'N' mesmo quando o gravado era NULL. A base de comparação parece ser o estado em memória depois de `IndexadorNaoEncontrado`. Não afeta a regra.

---

## 2. A trava do processamento e a esteira

### Fonte
Há duas travas de REPASSADO, repetidas em dois caminhos:
- `TfrmNF.Processamento`: `uNF.pas:15038-15060` e `:15061-15081`;
- `TFrmProcessaNotaFiscal`: `ValidaItensRepassadosNoIndex` (`uProcessaNotaFiscal.pas:724-761`) e `…ComIndex` (`:763-797`), chamadas em `:1093-1094`.

1. **'D' — "clientes livres de indexador"**: TIPO 'E', TIPOEMISSAO 1, **config ProcessaSemRepassar <> 'NÃO'** ("valor invertido"), FIGURAFISCAL 'D', FINALIDADE <> '4', NF_IMPORTACAO_NFE <> 'T', e algum item com REPASSADO='N' → bloqueia.
   A config **não está no banco**: vem de `ConfigDB.xml` da estação (`udmConfigura.pas:296`, `:415-416`, chave "BLOQUEAR PROCESSAMENTO NF SEM REPASSAR ITENS"). Sem a chave, vale '' <> 'NÃO', ou seja, **ligada**. Valor real nas estações: **não determinado**.
2. **'O'/'S' — "indexador obrigatório"**: FIGURAFISCAL <> 'D', FINALIDADE <> '4', NF_IMPORTACAO_NFE <> 'T', TIPO 'E', e algum item com REPASSADO='N' → "Não é permitido processamento sem repassar todos os itens!".
   **Não olha LIBERA_NF_INDEXADOR.** Com a NF liberada, o repasse grava 'S' e a trava passa.

O filtro `REPASSADO = 'N'` do ClientDataSet **não pega NULL**, então item nunca analisado passa por esta trava. Quem pega a nota importada sem repasse é a terceira trava:

3. **`ValidaIndexadores`** (`uProcessaNotaFiscal.pas:623-664`; em `uNF.pas:14938-14967`, com LIBERA_NF_INDEXADOR <> 'S'):
   FIGURAFISCAL 'O', TIPO 'E', TIPOEMISSAO 1, RETIRA_FORNINDEX <> 'S', CFOP da NF fora de 1152/1409/2401, **NF_IMPORTACAO_NFE='S'** e algum item com INDEXADORTRIB NULL ou 0 → "Existe(m) item(ns) sem indexador tributário configurado".
   Na saída há uma trava análoga, só para as CFOPs 5102/6102/5403/6403/5949/6949 (`uNF.pas:14969-14995`).

**Esteira `stRepasseItens`**: marcada ao **gravar** a NF quando TIPO 'E', há CHAVENFE e **algum item tem REPASSADO='S'** (`uNF.pas:4978-4979`, `:5171-5181`). O processamento não marca.

### Dado
**NFs processadas (fora de 'T') com item REPASSADO='N', desde 2025: 0 em todas as lojas.**

| loja | processadas 'T' com 'N' | NFs paradas com 'N' (não processadas) |
|---|---|---|
| 1 | 0 | 3 (66170, 74254, 74558; de 2022–2023) |
| 2 | 1.112 itens em 68 NFs (isentas pela regra 'T') | 4 (91486, 94542, 97120 de 2024; 146029 de fev/2026) |
| 51 | sem entrada em 2026 | — |
| 52 | 19 NFs, todas com indexador | — |

As 7 NFs paradas são abandonadas.
`ValidaIndexadores` na prática: só 2 NFs importadas processadas com item de indexador 0 e fornecedor hoje não-livre, ambas de jan/2025 e do fornecedor 88595 (flag provavelmente trocado).

Esteira, em 2026 (NFs com chave de 44 dígitos):
- NF com algum item 'S' → `stRepasseItens` 'R': **loja 1, 3.688 de 3.786 (97,4%); loja 2, 2.414 de 2.464 (98,0%)**;
- NF sem item 'S', mas com produto: 'R' em só 2 de 108.

O proxy do Apollo (`codproduto > 0`) marcaria **~106 NFs a mais**.

Observação lateral: uma rotina diária move o **DTCONTABIL das NFs não processadas** para o instante atual (hoje, 25/09/2026 05:32:05, em 186 de entrada e 139 de saída). Origem não determinada.

---

## 3. NF.LIBERA_NF_INDEXADOR

**Quem liga** — menu `LiberarNFdousodeindexadorClick` (`uNF.pas:17780-17829`):
- barra NF processada (`:17785`);
- exige a config `LIBERA_NF_USO_INDEXADOR='S'` (`:17791`; o menu só aparece com ela, `:8402-8405`) e o login de liberação (`ChamaLiberacaoLogin`, `:17801`);
- **alterna**: 'S' com `CODOPERADOR_LIB_NF_INDEX` = usuário, ou 'N' e limpa o operador (`:17808-17817`);
- avisa "Clique em gravar… e repasse os itens para recalcular" (`:17819`);
- rótulo e caption: `uNF.pas:8406-8410`; aviso na análise: "Nota fiscal liberada para não usar indexador. Usuário liberação: X" (`UAnalisaItemNF.pas:984-995`).

**O que faz** — a NF passa a se comportar como 'D':
- sem consulta (`uItensNF.pas:808`);
- REPASSADO 'S' no OK (`:1839`, `:1856`);
- ICMS-ST editável (`:1218`);
- ST externo pelo ramo 'D' (`:3373`);
- fornecedor tratado como livre (`:3864`);
- `CalcValorNota` ignora o MVA da figura (`udmNF.pas:4056`, `:4067`, `:4075`, `:4402`, `:4408`);
- pula a `ValidaIndexadores` do `uNF.pas:14943`, mas **não** a do `uProcessaNotaFiscal.pas:627-630`, que não testa o campo.

**Dado:**
- **4 NFs em toda a base, todas de saída da loja 1**: 18836 (mar/2021), 23502 (mai/2021), 71620 (fev/2023), 135977 (out/2025, não processada). **Entrada: nunca.**
- LOG: 5 liberações, pela KAROL VIEIRA (2021) e pelo ACESSO DE PROGRAMADOR, mais 2 gravações vazias.
- Config: `CONFIGURACOES` id 78 `LIBERA_NF_USO_INDEXADOR` = 'N' no global, 'S' **só para o usuário 1** (`CONFIGURACOES_ESPECIFICAS`, tipo Usuario, chave 1).

---

## 4. Mapeamento para o Apollo

### 4.1 O que dá para reusar
- **`TributacaoRepository.resolverFigura`** (`tributacao.repository.ts:96-150`): filtro figura/tp/origem/destino/cfop/INDR (`:116-125`), OR-null (`:127-131`) e especificidade 4/2/1 (`:133-137`).
  A especificidade **equivale** ao desempate sequencial do legado (R3: 0 divergências fora dos empates). `cstDaOperacao` (`:153-156`) é o mapa certo.
- **`FiscalPricingService.calcularIcmsSt`** (`preco-fiscal.service.ts:122-162`): o MVA ajustado (`:146-153`) bate com `GetMVAAjustado`, com 3 casas.
- Colunas que já existem no PG:
  - nf_prod: `indexadortrib`, `repassado`, `vricms_stexterno_separadonf` (mig 310), `mva_ajustado` (mig 215), `vricms_stexterno` e `vrbase_stexterno` (mig 287), com DEFAULT 0 (mig 351);
  - nf: `libera_nf_indexador`, `codoperador_lib_nf_index`, `ult_codnfprod_repasse` (mig 310);
  - parceiros: `retira_fornindex` (mig 115);
  - indexador_tributario: todas as colunas (migs 034/248; ALIQUOTA → `aliquota_dest`).
- Cadastro do indexador, a saída do "Deseja cadastrar agora?": `indexador-tributario.service.ts`. Conferência NF × indexador: `conferencia-nf-indexador.service.ts`.
- Esteira: `registrarProcessoNf` (`modules/shared/nf-status-processo.ts:27-45`). Gancho do OK do item: `it.dialogo === true` (`nf.aggregate.ts:62`, `:557`), dentro de `derivarItensTrx` (`nf.aggregate.ts:516-548`).

### 4.2 O que falta ou está errado
1. **`resolverFigura` quase nunca acha nada pelo caller atual.** `nf-fiscal.service.ts:288-296` passa `ncm` do **item** (o legado usa o NCMSH do produto), `codparceiro` do **item** (inexistente, fica undefined) e **nenhum `codbarra`**.
   Pelo OR-null (`:127-128`), linha com CODPARCEIRO ou CODBARRA preenchido não casa. **Só 7 das 11.357 linhas de entrada (e 22 das 495 de saída) têm os dois nulos.**
2. `resolverFigura` não devolve `codindexadortributario`, `st_externo`, `aliquota_fonte_lei_3166`, `aliquota_reduzida_lei_3166`, `considerar_desconto_calc_st` nem origem/destino (`:138-149`).
   Também não aplica `CODCFOP < 4000 / > 4000`, não trata empate (hoje sai a ordem da linha no PG; o legado leva o 1º ROWID, e o menor código acerta 93,7%) e não sinaliza "mais de um" (TEMP_STATUSFIGURA 'C', `uItensNF.pas:2891`).
3. `calcularIcmsSt` é da **saída**. Faltam, para a entrada:
   - gate `CalcularST` (lista de CFOPs, MVA ≠ 0, bonificação × CST);
   - IPI, despesas e frete na base; desconto só com CONSIDERAR_DESCONTO;
   - REDCOM literal: o Apollo troca ≤0 por 100 (`:141`), o legado zera a base (15 itens em 2026);
   - tolerância de 0,02 na BC-ST da nota;
   - crédito com frete e Lei 3166;
   - **subtrair o ST da nota**;
   - **sem piso em zero**: o Apollo faz `Math.max(…,0)` (`:160`) e o legado tem 140 negativos em 2026.
4. No `recalcular` (botão "Recalcular impostos", `NfCadMaster.tsx:1311`), a entrada com figura grava `mva/vrbasest/vricmst/streal` com semântica de saída (`nf-fiscal.service.ts:354-358`).
   Sem figura, cai em `resolverIndexador(ncm)` (`tributacao.repository.ts:58-86`, `nf-fiscal.service.ts:336-337`), que pega **a primeira linha qualquer com aquele NCM**: há 10.747 linhas com NCM, de qualquer figura, UF, tipo ou CFOP. Sem nenhuma, lança INDEXADOR_NAO_CADASTRADO.
   **Na entrada isso é incompatível com o legado**, que mantém VRBASEST/VRICMST da nota e calcula STREAL/VRBASE_STEXTERNO/VRICMS_STEXTERNO.
5. Nada no Apollo grava INDEXADORTRIB ou REPASSADO. Não existe a análise de itens (F7).
6. Esteira por proxy (`nf.aggregate.ts:413-418`, `coalesce(codproduto,0) > 0`).
7. Processamento sem nenhuma das três travas (`nf-processamento.service.ts:185-194`).
8. Não há o menu de liberar a NF do indexador.

### 4.3 Cortes, do menor para o maior risco

| # | corte | o que faz / fonte | colunas que escreve | risco |
|---|---|---|---|---|
| **C0a** | Fidelidade do `resolverFigura`, sem mudar caller | Devolver `codindexadortributario`, `st_externo`, lei 3166 (flag e alíquota), `considerar_desconto_calc_st`, `aliquota_fem`, `tp_figura`, `redcom`, `reducao`, `icm_fonte`, `aliquota_dest`, `mva`, `operacao`. Aceitar `codbarra`. Filtrar `codcfop<4000` ('F') / `>4000` ('C'). Empate por `ORDER BY codindexadortributario` (93,7% dos empates) e flag `multiplos`. Teste contra amostra da produção (R2/R3). | nenhuma | ~0 (função pura) |
| **C0b** | Caller de `recalcular` com as chaves do legado | `nf-fiscal.service.ts:288-296`: codbarra/NCMSH do **produto** e `nf.codparceiro`. Tirar a entrada do caminho de saída (`:330-360`) e do `resolverIndexador(ncm)`. | nenhuma nova (muda CST/ST calculados na saída 'O') | médio na saída das lojas 2/51/52: passa a achar figura onde hoje não acha. Precisa de smoke |
| **C1** | Repasse sem indexador: FIGURAFISCAL 'D' (lojas 1 e 50 hoje), NF liberada ou COD_PED_DEV_COMPRA | No OK do item de entrada (`it.dialogo`) e no repasse em lote: `uItensNF.pas:996-998` → `:790-795` e `:1856`. MVA := PRODUTOS.MVA (`:2532` → `:1593`; `uNF.pas:4907-4908`). ST: ramo 'D' (`:3433-3453`): na importada, VRBASE_STEXTERNO = VRBASEST, STREAL = VRICMST, VRICMS_STEXTERNO = 0. | `indexadortrib`=0, `repassado`='S', `mva`, `vrbase_stexterno`, `streal`, `vricms_stexterno` | baixo, sem trava |
| **C2** | Repasse com consulta (FIGURAFISCAL 'O'/'S') | Gate R1. Fornecedor livre ou FINALIDADE '4' → INDEXADORTRIB 0, 'S'. Achou → R4 e 'S'. Não achou → INDEXADORTRIB 0, 'N' em 'O' ('S' em 'S'); a UI oferece cadastrar o indexador. MVA_AJUSTADO pela fórmula (sobrescreve o pMVAST do XML). | `indexadortrib`, `cst`, `cfop` (no-op), `icme`, `bcr`, `mva`, `mva_ajustado`, `repassado` | médio: reescreve CST/ICME/BCR do XML (97–98% de concordância). Ainda sem trava |
| **C3** | ST externo da entrada (ramo 'O'/'S' de `RecalculaICMSST`) | Modo "entrada" do `calcularIcmsSt` com as 7 diferenças do item 4.2-3. Fornecedor livre: `:3390-3406`. Especial ST_EXTERNO: `:3375-3386`. Totais do cabeçalho (`uItensNF.pas:1801-1805`, `:1831-1836`); o `icms_st_apagar` já sai do `derivar` do `nf.aggregate`. | `vrbase_stexterno`, `streal`, `vricms_stexterno`, `vricms_stexterno_separadonf` (0, salvo o especial); nf: `totalbase_stexterno`, `totalicm_stexterno`, `total_streal`, `totalicm_stexterno_sepnf`; na não importada também `vrbasest`, `vricmst` e `totalicm_st`, `totalbaseicmt` | médio (dinheiro: ST a recolher, com negativos). Conferir item a item contra a produção (97% já batem na minha recomputação) |
| **C4** | Esteira pelo REPASSADO | `nf.aggregate.ts:413-418`: `repassado = 'S'` no lugar de `codproduto > 0` (`uNF.pas:4978`, `:5171-5181`). **Depende de C1/C2**: sem eles, NF do Apollo nunca ganha 'R'. | nf_status_processo (já escrita) | baixo |
| **C5** | Repasse em lote (F7 do `UAnalisaItemNF`) | Aplica C1–C3 a todos os itens da NF, com retomada por `ULT_CODNFPROD_REPASSE` (`UAnalisaItemNF.pas:564-633`) e config `BLOQUEIA_ANALISE_AUTOMATICA_ITENS_NF` ('N' na produção). Sem isso, a trava de C6 fica inoperável na prática. | as de C1–C3; nf: `ult_codnfprod_repasse` | baixo/médio |
| **C6** | Travas do processamento | Em `nf-processamento.service.ts:185-194`: (a) `ValidaIndexadores`; (b) `ValidaItensRepassadosComIndex` (FIGURAFISCAL <> 'D', FINALIDADE <> '4', NF_IMPORTACAO_NFE <> 'T', TIPO 'E', item 'N'; NULL passa); (c) a variante 'D' atrás de config, **desligada por padrão**, porque o dado não diz como estão as estações. | nenhuma (só recusa) | **alto nas lojas 2/51/52** (ver 4.4) |
| **C7** | Liberar NF do indexador | Menu com senha e config `LIBERA_NF_USO_INDEXADOR` (`uNF.pas:17780-17829`). Efeitos nos cortes C1–C3 e C6. Entregar **junto com C6**, como válvula. | nf: `libera_nf_indexador`, `codoperador_lib_nf_index` | baixo (4 usos em 5 anos, todos na saída) |

### 4.4 Risco de bloquear o processamento nas lojas 2, 51 e 52

**Loja 2 ('O')** — ~2.550 NFs de entrada em 2026; ~74% são importadas de fornecedor não-livre (1.934 das processadas).
- **Ligar C6 antes de C1–C2 bloqueia ~74% das entradas.** A `ValidaIndexadores` vê INDEXADORTRIB NULL em todo item importado pelo Apollo. A trava de REPASSADO não pega nada (NULL passa), o que engana o teste.
- Com C1–C2–C5 no ar, o esperado é o que o legado vive hoje: **~5% das NFs (130 em 2026) param na 1ª passada** até alguém cadastrar o indexador (BORBA cadastrou 1.876 em 2026).
- Os empates (4,6% dos itens) não bloqueiam, mas podem escolher outra linha em ~0,3% dos itens (130 dos 44 mil), com imposto diferente em 84% desses empates.

**Loja 51** — sem entrada em 2026: risco prático nulo, mas a regra vale.

**Loja 52** — 19 NFs em 2026, 100% com indexador. Risco baixo.

**Lojas 1 e 50 ('D')** — as travas 'O' não se aplicam. A 'D' depende de config local (não determinado): recomendo não ligar.

**Carga** — as 4 NFs paradas da loja 2 (e as 3 da loja 1) com item 'N' continuariam bloqueadas, como no legado. As 'T' com 'N' passam pela isenção. **A isenção de 'T' precisa entrar em C6**: o Apollo ainda não grava 'T' (`recebimento.service.ts:420` grava só 'S'), mas as NFs migradas têm.

---

## 5. Não determinado
- Valor de "BLOQUEAR PROCESSAMENTO NF SEM REPASSAR ITENS" no `ConfigDB.xml` das estações (trava 'D').
- Se o filtro do CNPJ, ao esvaziar o conjunto, ainda gera "não encontrado" no binário novo: nenhum caso no dado.
- Por que o "VALOR ANTERIOR" do REPASSADO na LOG é 'N' com o gravado NULL.
- Se o repasse foi manual ou F7: a LOG não distingue.
- A rotina que move o DTCONTABIL das NFs não processadas para o instante atual.

## Apêndice — consultas-chave (todas SELECT, sessão READ ONLY)
- Troca de figura: `SELECT … FROM log WHERE tabela='EMPRESAS' AND upper(historico) LIKE '%FIGURAFISCAL%'`.
- Concordância com o indexador (seção 1, R2/R4): NF ⨝ NF_PROD ⨝ PRODUTOS ⨝ PARCEIROS_END ⨝ EMPRESAS ⨝ INDEXADOR_TRIBUTARIO (por INDEXADORTRIB), somando flags.
- Candidatos e desempate: junção item × INDEXADOR_TRIBUTARIO pela regra de R2; `esp = 4·(codbarra) + 2·(ncm) + 1·(codparceiro)`; `first_value(... order by rowid / codigo)` no topo.
- LOG: `regexp_substr(historico, 'CAMPO: REPASSADO +VALOR ANTERIOR: *([A-Z]?) +VALOR ATUAL: *([A-Z]?)')` e o análogo para INDEXADORTRIB, com CHAVE='CODNF' ⨝ NF.
- ST externo: recomputação `bcst = (vrcusto·qtd + ipi + depsacess + vrfrete − desc?)·redcom/100·(1+mva_ajustado/100)`; `rec = bcst·aliquota/100 − (vrcusto·qtd − vrdescprod)·reducao/100·icm_fonte/100 − vricmst`.

## Status (25/09/2026)

| Corte | Status |
|---|---|
| C0a — `resolverFigura` fiel (CFOP <4000/>4000, código de barras, desempate pelo menor código, campos completos, `multiplos`) | ✅ |
| C0b — caller com as chaves do legado (barra/NCM do produto, parceiro da nota); a entrada fora da conta de ST da saída e do `resolverIndexador(ncm)` | ✅ |
| C1/C2 — indexador e REPASSADO do item de entrada (`nf-indexador-item.ts`): item novo consulta; OK do diálogo refaz o REPASSADO; o pMVAST do XML só vai ao MVA_AJUSTADO do item sem indexador | ✅ smoke §244 |
| C3 — ST externo da entrada (`calculoIndexador` + `stExternoDoItem`; roda na análise do item antes do custo; o cabeçalho soma os itens e o ICMS_ST_APAGAR sai dessa soma) | ✅ smoke §245 + teste-ouro (183 itens reais) |
| C4 — esteira pelo REPASSADO | ✅ |
| C5 — análise automática: [F7] repasse em lote e [F8] um item (`POST /fiscal/nf/:id/repasse-automatico[?item=]`, botão na tela da NF; configs BLOQUEIA_ANALISE_AUTOMATICA_ITENS_NF e OBRIGA_SITUACAONF_ANALISA_ITEM_NF — mig 355) | ✅ smoke §247 (a saída ainda não: o indexador da saída vive no recálculo fiscal) |
| C6 — travas do processar da entrada (`nf-travas-processamento.ts`: ValidaIndexadores, Total NF digitado × total, REPASSADO 'N' em 'O'/'S' e em 'D' de terceiros — a chave da estação vale ligada sem o ConfigDB.xml; isenção finalidade 4 e importação 'T') + Total NF obrigatório no gravar da entrada e o campo na tela | ✅ smoke §248 (a trava da saída espera o indexador do item de saída) |
| C7 — liberar a NF do indexador | ⏳ |

### C3 — o que a produção mostrou (itens de entrada de 2026, lojas "O"; só leitura)

- Com indexador: STREAL / VRBASE_STEXTERNO / VRICMS_STEXTERNO **100%** nos 357 itens digitados e **98,2%** nos 44.685 importados (o resto: notas com o item sem análise — tudo 0 — e bases negativas antigas).
- Fornecedor livre importado: o ST externo é o da nota (STREAL = VRICMST, base externa = VRBASEST, nada a recolher) em 99,1%; loja "D" de terceiros importada, 98,7%.
- Sem indexador (loja "O"): o legado roda o `TIndexadorTributario` com o que sobrou do item anterior (`InicializarVariaveis` não limpa a ST da nota) — o Apollo deixa o item como está; a importação guarda o ST da nota (72 de 72).
- Totais do cabeçalho = Σ itens em 6.522 de 6.522 notas; ICMS_ST_APAGAR = max(0, TOTALICM_STEXTERNO − ICMS_ST_PAGO_FONTE) em 6.521 de 6.522. **O TOTALICM_STEXTERNO deixou de ser digitado no cabeçalho** (o smoke do RESIDUAL ST passou a pôr o valor no item).
- O ramo "emissão própria + ST_EXTERNO + 1403/2403" (ST separada da NF) não tem nenhum caso em 2025-26 (TOTALICM_STEXTERNO_SEPNF = 0 em 15.743 notas) — portado do fonte.
- Os TEMP do `CalcValorNota` (fornecedor livre / loja "D" com MVA ou ALIQOPE_INTERNA no produto, nota digitada): ramo do MVA do item e o da proporção do ST do cabeçalho (ConstICMST); sem caso na produção de 2026.

### Achado do C5 — o OK do item regrava a base e o ICMS (`6575c3b`)

`CalculaBaseICME` (uItensNF.pas): VRBASECALCULO := TEMPBASEICME e VRICM := TEMPVLRICME, com as zeragens do CalcValorNota. Nos itens de entrada importados de jun-set/2026: base = VRBASECALCULOICM_CALC em 99,9%, ICMS = VRICM_CALC em 99,9%; iguais aos do XML só em 74%. O Apollo mantinha os do XML — a análise do item (e o F7) agora grava os calculados e o cabeçalho soma. E o OK da nota digitada de emissão própria (`7c47e3d`): TOTALICM_ST = Σ STREAL − Σ separado, TOTALBASEICMT = Σ base externa, ICMS "da nota" = calculados; na loja 'D' o ST externo é o da nota.
