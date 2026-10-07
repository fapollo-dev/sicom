# PESQUISA — Corte B: as views `get_*` do destino × as `GET_*` da produção

Recon de 07/10/2026, **somente leitura** (nenhum código, migration ou commit). Complementa `uPesquisa.md` (§0, §3, §8, §12-B) e o
registro `apps/api/src/shared/pesquisa/telas.ts`.

> **Procedência.** `[produção]` = Oracle vivo em `SET TRANSACTION READ ONLY` (`user_views`, `user_tab_cols`, `user_col_comments`,
> contagens em 07/10/2026). `[destino]` = a **última** definição de cada view nas migrations (extraída por número de migration; as
> recriações dinâmicas das migs 174-192/318 preservam a definição) e `tools/cutover/schema-destino.json`. `[fonte]` = Delphi de
> mai/2020 (`/Library/SicomGit/retaguarda-master/fonte/Units`, lido como latin1). As expressões foram comparadas coluna a coluna com
> a mesma normalização do `tools/cutover/conferir-views.py` (posicional pela lista de colunas da view da produção).

---

## 0. Resumo

**O achado que decide a proposta:** para **14 das views do registro a versão integral do legado já existe no destino** — feita para o
construtor de relatórios (`rel_get_*` das migs 389/390/393; `get_rcb` 388/399; `get_apagar_cen` 397; `get_cp` 391; `get_cp_cen`
388; `get_produtos_pc` 397). Todas conferem com a produção nas colunas (nome, ordem, tipo) e nas expressões (só diferenças de sintaxe
ou deliberadas e documentadas). A Pesquisa lê as `get_*` "da tela", que são outra coisa: subconjunto de colunas, nomes do Apollo,
códigos crus em vez do texto decodificado e, nas que importam, **outra multiplicidade e outro recorte**. Logo o corte B é, na maior
parte, **apontar a Pesquisa para a relação do legado**, sem mexer nas `get_*` que os CRUDs leem; migration só para 6 views pequenas
que não têm versão integral.

As diferenças que mais mudam o resultado da Pesquisa (números da produção, loja 1):

| # | view | o que muda | tamanho |
|---|---|---|---|
| 1 | GET_PRODUTOS | o **ATIVO é o da loja** (MULTI_PRECO, config 30 = S) e a view tem **uma linha por produto × loja** com `IDEMPRESA`; o destino usa `produtos.ativo`, uma linha por produto | "Ativos": **17.347** no legado × **47.232** no Apollo (29.885 inativos da loja aparecem); o mesmo nos lookups de promoção/agenda (`ativo='S'`) |
| 2 | GET_PRODUTOS | `ATIVO_COMPRA` da loja (cotação, `ATIVO_COMPRA <> 'N'`) e `IMPRIMIRCOMP` com `COALESCE(…,'N')` (promoção/agenda, `IMPRIMIRCOMP='N'`) | cotação: **20.204** × 47.802; os **804** produtos com `IMPRIMIRCOMP` nulo o legado inclui e o Apollo exclui |
| 3 | GET_PEDIDOCOMPRA | uma linha por **pedido × loja**, `FECHADO` **da loja** (`PEDIDO_COMPRA_QTDE`) e `FORNECEDOR_ATIVO`; o destino usa o `FECHADO` do cabeçalho | "Trazer somente aberto": **1.429** pedidos no legado × **3.982** pela regra do Apollo (2.553 já baixados na loja) |
| 4 | GET_APAGAR (+ _CEN, GET_CP, GET_CP_CEN) | a janela de opções escolhe **a view** (abertas → GET_APAGAR; o resto → GET_CP; "com centro de custo" → as _CEN, uma linha por centro do rateio); `VALOR` é o **líquido** (valor + vendor − desconto) | 53 colunas × 28; `VALOR` difere em **473** dos 7.802 abertos; o complemento CC não existe no Apollo |
| 5 | GET_RCB | a Pesquisa do A receber é sobre GET_RCB (73 colunas, nomes do legado: CLIENTE, DATA_VENCIMENTO…); o destino usa `get_areceber` (35, nomes do Apollo) | o status salvo e a abertura em CLIENTE dependem dos nomes; +13 linhas (título com 2 baixas) |
| 6 | GET_NF | 49 colunas × 17; `STATUS_NFE` **decodificado** (o operador procura "CANCELADA"; as 5 cores do legado comparam o texto) | 5.286 notas com status preenchido |
| 7 | GET_PARCEIROS | uma linha **por endereço** e `ENDERECO_ATIVO`/`REALIZA_RETENCOES` (filtros do pedido e da NF que estão fora); 61 colunas × 17 | 31 parceiros com mais de um endereço (+62 linhas); 829 linhas com endereço inativo |
| 8 | GET_PLANO_CONTAS · GET_FAMILIAS_PROD · GET_OPERADORES · GET_PLC · GET_FORMAS_PGTO | o legado mostra e filtra o **texto** (`CLASSE='ANALITICA'`, `TIPO='DEPARTAMENTO'`, `TIPOOP='Supervisor(a)'`, `TIPO_CONTA='DESPESA'`); o destino tem o código cru | o operador que digita o texto não acha nada; `TIPOOP='Supervisor(a)'` inclui as **444** linhas de `TIPOOP` nulo |

**A proposta em poucas linhas** (§4): (B0) a Pesquisa passa a ler a relação do legado — `rel_<view>` quando existe, como o construtor
(`relacaoDaFonte`) — mostrando só as colunas do legado, e a view do A pagar passa a depender da opção; (B1) produtos; (B2) pedido de
compra; (B3) A pagar e A receber; (B4) NF, parceiros, operadores e as demais com `rel_` — tudo isso **sem migration**; (B5) uma
migration só para `get_plc`, `get_cfop`, `get_preco`, `get_motivos_operacao`, `get_historico_contabil`, `get_operacoes_conta`;
(B6) os lookups de valor decodificado com os `fixos` da web reescritos; (B7, opcional) o lookup de produto do pedido sobre
`get_produtos_pc`. **Não** mudar no lugar a multiplicidade nem o significado das `get_*` que os CRUDs leem (§3).

---

## 1. Mapa: a view do legado × o que o destino tem

`faltam` = colunas da produção ausentes na `get_*` do destino. "integral" = a relação do destino com todas as colunas do legado.

| view da produção | linhas · colunas | `get_*` do destino (mig · colunas · faltam) | integral no destino | multiplicidade da produção | telas do registro |
|---|---|---|---|---|---|
| GET_PRODUTOS | 204.125 · 95 | `get_produtos` (020 · 11 · **86**) | `rel_get_produtos` (390) | produto × loja (MULTI_PRECO) | cadastro/produtos, lookup/produtos |
| GET_PRODUTOS_PC | 5.988.302 · 72 | `get_produtos_pc` (397 · 72 · 0) | a própria | produto × loja × cód. auxiliar × UF | (lookup do pedido — fora do registro) |
| GET_PARCEIROS | 19.151 · 61 | `get_parceiros` (017 · 17 · **47**) | `rel_get_parceiros` (390) | parceiro × endereço | cadastro/parceiros, lookup/parceiros |
| GET_NF | 50.127 · 49 | `get_nf` (025 · 17 · **42**) | `rel_get_nf` (389) | 1 por NF com parceiro | fiscal/nf |
| GET_RCB | 100.770 · 73 | `get_areceber` (410 · 35 · **56**) | `get_rcb` (399) | título × baixa | cadastro/areceber |
| GET_APAGAR | 7.802 · 53 | `get_apagar` (045 · 28 · **47**) | `rel_get_apagar` (389) | 1 por título **aberto** | cadastro/apagar (abertas) |
| GET_APAGAR_CEN | 7.966 · 38 | — | `get_apagar_cen` (397) | título aberto × centro do rateio | cadastro/apagar (abertas, com CC) |
| GET_CP | 56.077 · 43 | — | `get_cp` (391) | título × baixa | cadastro/apagar (as outras opções) |
| GET_CP_CEN | 59.087 · 41 | — | `get_cp_cen` (388) | título × baixa × centro | cadastro/apagar (outras, com CC) |
| GET_PEDIDOCOMPRA | 14.761 · 24 | `get_pedidocompra` (303 · 22 · **17**) | `rel_get_pedidocompra` (390) | pedido × loja (× endereço do fornecedor) | compras/pedidos |
| GET_OPERADORES | 570 · 11 | `get_operadores` (051 · 17 · 6) | `rel_get_operadores` (393) | operador × loja | cadastro/operadores, lookup/operadores(-da-loja) |
| GET_EMPRESAS | 5 · 24 | `get_empresas` (032 · 13 · 16) | `rel_get_empresas` (393) | 1 | cadastro/empresas |
| GET_FAMILIAS_PROD | 2.473 · 10 | `get_familias_prod` (348 · 10 · 7) | `rel_get_familias_prod` (393) | 1 | cadastro/familias, lookup/familias |
| GET_PLANO_CONTAS | 11.028 · 7 | `get_plano_contas` (046 · 11 · 1) | `rel_get_plano_contas` (393) | 1 | lookup/plano-contas |
| GET_FORMAS_PGTO | 47 · 11 | `get_formas_pgto` (052 · 17 · 3) | `rel_get_formas_pgto` (393) | 1 | cadastro/formas-pgto |
| GET_CONTAS_BANCARIAS | 36 · 13 | `get_contas_bancarias` (004 · 8 · 8) | `rel_get_contas_bancarias` (393) | 1 | cadastro/contas-bancarias |
| GET_LOTE_COBRANCA | 0 · 5 | `get_lote_cobranca` (016 · 5 · 5) | `rel_get_lote_cobranca` (393) | 1 | cobranca/lotes-md |
| GET_UNIDADE | 11 · 5 | `get_unidade` (350 · 8 · 0) | `rel_get_unidade` (393) | 1 | cadastro/unidades |
| GET_BAIRRO | 0 · 5 | `get_bairro` (010 · 6 · 1) | `rel_get_bairro` (393) | 1 | cadastro/bairros |
| GET_PLC | 332 · 8 | `get_plc` (349 · 9 · **6**) | **não há** | 1 (com `WHERE`) | cadastro/plc, lookup/plc |
| GET_CFOP | 398 · 10 | `get_cfop` (346 · 6 · **8**) | **não há** | 1 | cadastro/cfops, lookup/cfops |
| GET_PRECO | 0 · 5 | `get_preco` (011 · 6 · 1) | não há | 1 | cadastro/precos |
| GET_MOTIVOS_OPERACAO | 34 · 4 | `get_motivos_operacao` (059 · 5 · 1) | não há | 1 | cadastro/motivos-operacao |
| GET_HISTORICO_CONTABIL | 54 · 3 | `get_historico_contabil` (231 · 7 · 1) | não há | 1 | cadastro/historico-contabil |
| GET_OPERACOES_CONTA | 1 · 3 | `get_operacoes_conta` (003 · 3 · 1) | não há | 1 | cadastro/operacoes-conta |
| GET_BANCOS · GET_CIDADES · GET_NCM · GET_MARCAS · GET_CONDICOES_PAGTO · GET_SITUACAO_NF | 594 · 5.564 · 11.344 · 1 · 53 · 194 | iguais nas colunas do legado (001 · 013 · 012 · 006 · 067 · 321) | — | 1 | os cadastros e lookups homônimos |

Tipos: nas relações integrais as categorias (número / texto / data) batem com a produção em todas as colunas; só `get_rcb.data_pagamento`
(timestamptz × DATE) e `rel_get_contas_bancarias.data_abertura` (date × TIMESTAMP) trocam data↔data-hora, o que hoje não muda nada
(`tipoDoCampo` trata as duas como data).

---

## 2. As diferenças, view a view

### 2.1 GET_PRODUTOS (e GET_PRODUTOS_PC) — o ATIVO é o da loja

**Produção** (`user_views`, trecho):

```sql
WITH VALOR_CONFIG AS (SELECT C.CODIGO, COALESCE(CE.VALOR, C.VALOR) AS VALOR FROM CONFIGURACOES C
                      LEFT JOIN CONFIGURACOES_ESPECIFICAS CE ON CE.ID = C.ID WHERE C.CODIGO = 'ATIVO_PELA_MULTIPRECO')
SELECT … CASE WHEN VC.VALOR = 'S' THEN COALESCE(P.ATIVO,'S') ELSE COALESCE(PRO.ATIVO,'S') END AS ATIVO,
         CASE WHEN VC.VALOR = 'S' THEN COALESCE(P.ATIVO_COMPRA,'S') ELSE COALESCE(PRO.ATIVO_COMPRA,'S') END AS ATIVO_COMPRA, …
         P.PROMOCAO, … P.IDEMPRESA, … COALESCE(PRO.IMPRIMIRCOMP,'N'), … PRO.IDPRODUTO_PAI (→ PRODUTO_PAI) …
FROM MULTI_PRECO P LEFT JOIN PRODUTOS PRO ON (PRO.IDPRODUTO = P.IDPRODUTO) … LEFT JOIN ESTOQUE E ON … (E.IDEMPRESA = P.IDEMPRESA) …
```

Config 30: `CONFIGURACOES.VALOR = 'N'`, `CONFIGURACOES_ESPECIFICAS.VALOR = 'S'` ⇒ vale **S** (o ATIVO vem do MULTI_PRECO). A view tem
204.125 linhas = as 204.125 do MULTI_PRECO (47.813 nas lojas 1/2/51/52, 12.873 na 50). A Pesquisa do legado sempre soma
`(IDEMPRESA = <loja do login>)` para esta view (`SetaEmpresaObrigatoria`, uPesquisa.pas:2555-2564; V$SQL do dossiê §2.3).

| loja 1 | GET_PRODUTOS (legado) | `produtos` (o que o Apollo usa) |
|---|---:|---:|
| ATIVO = 'S' | **17.347** | 47.232 |
| ATIVO = 'N' | 30.466 | 582 |
| ATIVO_COMPRA <> 'N' (cotação, uCadCotacao.pas:833) | **20.204** | 47.802 (só 12 com 'N') |
| IMPRIMIRCOMP = 'N' (promoção/agenda, uCadAgendaPromocao.pas:438-439, UCadPromocao.pas:919-920) | **47.811** (o nulo vira 'N') | 47.008 (804 nulos ficam fora) |
| PRODUTO_PAI IS NULL (uNF.pas:12422) | 47.611 | — (mesmo critério) |
| PROMOCAO = 'S' (a cor azul) | 103 | coluna inexistente |

**Destino.** `get_produtos` (020): 11 colunas, `FROM produtos`, uma linha por produto, `ativo = produtos.ativo`, sem `idempresa`.
`rel_get_produtos` (390): as 95 do legado + `idproduto`, `ncmsh`, `FROM multi_preco`, a mesma `valor_config`; as 7 diferenças de
expressão são de sintaxe (`TRUNC`→`::date`, `NULLIF` no divisor de `VLR_APRESENTACAO`). O produto criado no Apollo ganha linha no
`multi_preco` de todas as lojas (`produto-lojas.ts:250-270`), então aparece na `rel_` como no legado.

**Erro do registro hoje (com prova):** o comentário de `telas.ts` sobre `naoComposto` ("o nulo fica de fora, como no Oracle") vale
para a tabela, não para a view: a GET_PRODUTOS entrega `COALESCE(PRO.IMPRIMIRCOMP,'N')`, e o filtro do legado é sobre a view. O
subselect `produtos.imprimircomp = 'N'` tira 804 produtos que o legado oferece.

**Quem lê `get_produtos`:** `produto.aggregate.ts:68` (o CRUD do cadastro: lista e leitura por PK, uma linha por produto) e o smoke.
É fonte do construtor (`COMMENT ';PRODUTOS'`), mas o construtor já lê a `rel_`. ⇒ **não mudar a `get_produtos`**; a Pesquisa lê a
`rel_get_produtos` com `idempresa = loja`.

**GET_PRODUTOS_PC** (o lookup de item do pedido, uPedidoCompra.pas:4441-4446): `MULTI_PRECO` × `CODAUXILIAR` × `DET_ALIQUOTA`
(5,99 milhões de linhas), filtrada por `ATIVO_COMPRA_MP` (config 30 = S), `UF = UF da loja`, `IDEMPRESA` e `CODIGO NOT IN (filhos)`.
O destino tem a `get_produtos_pc` fiel (397, 0 diferenças). O Apollo usa `lookup/produtos` com `ativoCompra`+`semFilho`
(`PedidoCompraItemModal.tsx:164`): pela `rel_get_produtos` o **conjunto** de produtos fica igual ao legado (o `ATIVO_COMPRA` da
GET_PRODUTOS já é o da loja); o que só a `_PC` dá são as 72 colunas da simulação de margem e a repetição por código auxiliar.

### 2.2 GET_PEDIDOCOMPRA — o FECHADO é o da loja

**Produção:**

```sql
SELECT P.CODPEDCOMP, …, COALESCE(PQ.FECHADO, 'N'), PCE.CODEMPRESA IDEMPRESA, …, A.ATIVADO (→ FORNECEDOR_ATIVO), …
FROM PEDIDOCOMPRA P
INNER JOIN PEDIDO_COMPRA_EMPRESA PCE ON (P.CODPEDCOMP = PCE.CODPEDCOMP) AND (COALESCE(P.INDR,'I')='I')
LEFT JOIN PARCEIROS_END PE ON (PE.CODPARCEIRO = P.CODPARCEIRO) …
LEFT JOIN (SELECT PDQ.IDEMPRESA, …, COALESCE(PDQ.FECHADO,'N') FECHADO, I.CODPEDCOMP, … FROM PEDIDO_COMPRA_QTDE PDQ JOIN PEDIDOCOMPRA_I I …) PQ
       ON PQ.CODPEDCOMP = P.CODPEDCOMP AND PQ.IDEMPRESA = PCE.CODEMPRESA
GROUP BY … PE.CODEND, PE.UF, … PQ.DATA_FECHAMENTO …
```

14.761 linhas / 12.570 pedidos. O `FECHADO` do cabeçalho e o da loja divergem muito: cabeçalho N × loja S em 4.735 linhas; cabeçalho
S × loja N em 478; cabeçalho nulo em 634. O V$SQL da tela (dossiê §2.3) é `FECHADO = 'N' AND IDEMPRESA in (1,2) AND
FORNECEDOR_ATIVO='S'`.

| "Trazer somente aberto", loja 1 | pedidos |
|---|---:|
| legado: GET_PEDIDOCOMPRA `FECHADO='N' AND IDEMPRESA=1 AND FORNECEDOR_ATIVO='S'` | **1.429** |
| a regra do Apollo hoje (cabeçalho `FECHADO='N'` e a loja no pedido), aplicada à produção | **3.982** |

**Destino.** `get_pedidocompra` (303): uma linha por pedido, `fechado` do cabeçalho, `idempresa` = a dona, o CSV `empresas`.
`rel_get_pedidocompra` (390): fiel (0 diferenças), o `FECHADO` por loja; a `PEDIDO_COMPRA_EMPRESA` é mantida pelo gatilho da mig 401
e o Apollo grava `PEDIDO_COMPRA_QTDE.FECHADO` ao fechar/reabrir (`pedido-compra.service.ts:93/:836`, `analise-*`).

**Quem lê `get_pedidocompra`:** `pedido-compra.aggregate.ts:72` (CRUD) e a `rel_get_pedidocompra` (JOIN). ⇒ não mudar; a Pesquisa lê
a `rel_`. A cor "Pedido baixado" (uPedidoCompra.pas:735-760) também é sobre o `FECHADO` da loja.

### 2.3 GET_APAGAR / GET_APAGAR_CEN / GET_CP / GET_CP_CEN — a view depende da opção

O `frmAPagar` (uAPagar.pas:2638-2685) abre a janela "Status das contas a pagar" com o complemento "Com/Sem centro de custo" (padrão
Sem) e escolhe a **view**: "Somente abertas" → GET_APAGAR (ou GET_APAGAR_CEN); "Somente quitadas", "Adiantamento", "Agrupadas",
"Todas" → GET_CP (ou GET_CP_CEN), sempre com `CODIGO_EMPRESA in (<lojas>)` (procedência em `tools/pesquisa/telas-pesquisa.json`).

| view | produção | recorte / multiplicidade (trecho) |
|---|---|---|
| GET_APAGAR | 7.802 linhas = 7.802 títulos · 53 col | `WHERE P.QUITADA = 'N' AND COALESCE(P.ADCREDITO,'N') = 'N' AND COALESCE(P.AGRUPADO,'N') = 'N'` |
| GET_APAGAR_CEN | 7.966 / 7.802 · 38 | o mesmo `WHERE` + `LEFT JOIN (… CX_APAGAR C LEFT JOIN PLC …) CEN ON CEN.CODGRUPO = P.CODGRUPO` (uma linha por centro do rateio) |
| GET_CP | 56.077 / 56.075 · 43 | sem `WHERE`; `LEFT JOIN APAGAR_BX ABX ON … COALESCE(ABX.INDR,'I') = 'I'` (título × baixa); tem `ADCREDITO`, `AGRUPADO`, `DATA_BX` |
| GET_CP_CEN | 59.087 / 56.075 · 41 | GET_CP × centro do rateio |

`VALOR` nas quatro = `CAST(P.VALOR + COALESCE(P.VENDOR,0) - COALESCE(P.DESCONTO,0) AS NUMERIC(13,2))` (o líquido); difere do valor
bruto em **473** dos 7.802 abertos (2.866 de 56.075 no total). O V$SQL de hoje tem `(VALOR = 700.34) and CODIGO_EMPRESA in (1)`.

**Destino.** `get_apagar` (045): 28 colunas, **todos os estados**, `valor` bruto, sem `adcredito` (o registro filtra por subselect na
tabela). As quatro integrais existem: `rel_get_apagar` (389, 53 + 22 do Apollo, com o `WHERE` dos abertos), `get_apagar_cen` (397),
`get_cp` (391), `get_cp_cen` (388) — as diferenças de expressão são só o nome da coluna base (`IDEMPRESA`→`codempresa`,
`RAZAOSOCIAL`→`razao_social`).

**Efeito na Pesquisa hoje:** o operador não tem FORNECEDOR, VENCIMENTO, NR_DOCUMENTO, CODBARRAS, BLOQUEIO, FORNECEDOR_POSSUI_DEBITO…;
o `VALOR` pesquisado é outro em 6% dos abertos; o status salvo da produção ("Vencimento / Entre", op 102) não tem coluna onde cair;
falta o "com centro de custo"; e a abertura (1º alfabético BAIXA_AUTENTICA_TRANS, ordenação VENCIMENTO) não existe.

**Quem lê `get_apagar`:** `apagar.service.ts:46,79` (lista/leitura da tela), `apagar-baixa.service.ts:86` (o juro),
`rel_get_apagar` (JOIN), `db-types.ts`, smoke (18). `get_cp`, `get_cp_cen`, `get_apagar_cen`: só o construtor e o smoke. ⇒ nada a
migrar; a Pesquisa escolhe entre as quatro.

### 2.4 GET_RCB — a Pesquisa do A receber

`uCadAReceber.pas:2590` (`SetaDataset(…, 'GET_RCB', 'GET_RCB')`): a Pesquisa é sobre **GET_RCB**, não GET_ARECEBER. Produção: 100.770
linhas / 100.757 títulos (`LEFT JOIN ARECEBER_BX RBX ON … COALESCE(rbx.indr,'I') <> 'E'` — 13 títulos com duas baixas saem duas
vezes), 73 colunas, sem `WHERE`, `ORDER BY TRUNC(R.DTVENC)`. A GET_ARECEBER da produção (sem COMMENT, 18.496 linhas = só abertos e
não agrupados, 65 colunas) é outra view; a `get_areceber` do destino, homônima, traz todos os estados.

**Destino.** `get_areceber` (410): 35 colunas com nomes do Apollo (`codrcb`, `razao`, `dtvenc`, `codempresa`…). `get_rcb` (399): as 73
do legado + `consilidado`, `codgrupo`; expressões iguais (o atraso foi fatorado num CTE; `cliente_completo` com `concat`).
**Quem lê `get_areceber`:** `areceber.service.ts:78,129`, `areceber-baixa.service.ts:117`, `areceber-agrupamento.service.ts:97,243`,
`lote-cobranca.repository.ts:117`, `db-types.ts`, smoke. `get_rcb`: construtor e smoke. ⇒ a Pesquisa lê a `get_rcb`.

### 2.5 GET_NF

Produção: 50.127 linhas (`INNER JOIN PARCEIROS` — hoje nenhuma NF sem parceiro), 49 colunas: `CODIGO`, `NRO_NF` (NUMBER) e
`NRONF_DESCRITIVO`, `STATUS_NFE` **decodificado** (vazio 44.841 · "NFE ENVIADA A RECEITA" 4.970 · "T" 173 · "NFE CANCELADA NA RECEITA"
128 · "…EM CONTINGENCIA" 10 · "NFE DENEGADA NA RECEITA" 5), `PROCESSADA`, `OBS_NF`, `NF_IMPORTACAO_NFE`, `PRECIFICADA` ('SIM'/'NÃƒO')…
**Destino.** `get_nf` (025): 17 colunas, `LEFT JOIN parceiros`, `statusnfe` código. `rel_get_nf` (389): as 49 + 10 do Apollo; o
'NÃO' consertado (deliberado) e casts defensivos em `NRO_NF`/`CFOP`/`VERSAOXML`. **Quem lê `get_nf`:** `nf.aggregate.ts:223`, smoke.
As cores do legado (uNF.pas:6211-6283) comparam o **texto** de `STATUS_NFE` e `PROCESSADA`; o registro em curso usa `statusnfe`/`proc`
do Apollo e por isso junta "emitida" e "emitida em contingência" na mesma regra — com a `rel_` as cinco regras ficam exatas. O status
salvo da produção ("Nro_nf / Igual a", op 84) só resolve com a coluna `NRO_NF`.

### 2.6 GET_PARCEIROS — uma linha por endereço

Produção: `FROM PARCEIROS P LEFT JOIN PARCEIROS_END Q ON (Q.CODPARCEIRO = P.CODPARCEIRO) …` — 19.151 linhas / 19.089 parceiros (31
parceiros com mais de um endereço); `Q.ATIVADO AS ENDERECO_ATIVO` ('N' em 829 linhas; 300 fornecedores têm algum endereço inativo);
`REALIZA_RETENCOES` (as 7 flags de retenção); `TIPO_PESSOA` decodificado; 61 colunas. **Destino.** `get_parceiros` (017): 17 colunas,
uma linha por parceiro com o endereço **padrão** (`LATERAL … ORDER BY endereco_padrao DESC LIMIT 1`) — pesquisar CIDADE/CNPJ_CPF de
um endereço não padrão não acha. `rel_get_parceiros` (390): fiel. **Quem lê `get_parceiros`:** `parceiro.aggregate.ts:26`, smoke.

Dois filtros do legado que o §0 do dossiê lista como "fora" passam a ir pela view: `ENDERECO_ATIVO` do fornecedor do pedido
(`FRN='S' AND (ATIVADO='S' OR nulo) AND (ENDERECO_ATIVO='S' OR nulo)`, uPedidoCompra.pas:6596-6599 — exige a multiplicidade por
endereço) e `REALIZA_RETENCOES = 'S'` do parceiro da NF de entrada (uNF.pas:3144-3150). As cores do legado usam `BLOQUEADO` e
`DATA_ULTIMA_COMPRA` (uCadClientes.pas:3788-3808); a regra `ENDERECO_ATIVADO` nunca casa (a coluna não existe na view).

### 2.7 GET_OPERADORES — operador × loja e o TIPOOP decodificado

Produção: `FROM OPERADORES O LEFT JOIN RELACAO_OPERADOR_EMPRESA R … WHERE O.LOGIN <> 'SICOM' and (COALESCE(O.INDR,'I') <> 'E')` —
570 linhas / 275 operadores (loja 1: 219); `TIPOOP` decodificado com `ELSE 'Supervisor(a)'` (o `TIPOOP` nulo vira supervisor: 444
linhas; 'Usu?rio(a)' com a codificação quebrada) e `TIPO_SIGLA` com o código. **Destino.** `get_operadores` (051): uma linha por
operador, `tipoop` código, sem empresa (o registro chega à loja por subselect na relação — mesmo conjunto). `rel_get_operadores`
(393): fiel, com 'Usuário(a)' consertado (diferença deliberada). Os lookups do legado filtram pelo texto (`TIPOOP =
'Operador(a)'`, UabertCaixa.pas:155; `'Supervisor(a)'`, UlancProv.pas:158) e pela sigla (`TIPO_SIGLA = 'OPE'/'SUP'`,
uCadUsuarios.pas:277, uRelatorioCaixa.pas:673-674). **Quem lê `get_operadores`:** `operadores.aggregate.ts:39`, `rel_get_operadores`
(JOIN), `db-types.ts`, smoke.

### 2.8 GET_PLC — `WHERE` e tipo de conta decodificado (sem versão integral)

Produção:

```sql
SELECT PLC.DESCRICAO, PLC.DESCCODPLC, PLC.CODPLC, PLC.CODPAI,
       CASE PLC.TPCONTA WHEN 0 THEN 'RECEITA' WHEN 1 THEN 'DESPESA' WHEN 2 THEN 'NEUTRA' END AS TIPO_CONTA,
       PLC.NIVELCONTA, PLC.FLG_PERDA, PLC.PLC_OBRIGA_MOTIVO_PERDA
FROM PLC WHERE 1=1 AND CHARACTER_LENGTH(PLC.DESCCODPLC) > 5 AND COALESCE(PLC.INDR,'I')<>'E'
```

Colunas: DESCRICAO, CODIGO_EXTENSO, CODIGO, CODIGO_PAI, TIPO_CONTA (DESPESA 283 · RECEITA 37 · NEUTRA 11 · nulo 1), NIVEL_CONTA, PERDA,
OBRIGA_MOTIVO_PERDA; 332 linhas. **Destino.** `get_plc` (349): `codplc, codigo, desccodplc, descricao, codpai, tpconta, nivelconta,
codcontabil, indr`, **sem `WHERE`** (o registro põe o `length > 5` como obrigatório). Faltam 6 colunas; todas têm o dado na tabela
`plc` (`flg_perda`, `plc_obriga_motivo_perda`…). **Quem lê:** `plc.crud.ts:35` (o cadastro precisa ver as 388), smoke. O filtro
`TIPO_CONTA IN ('DESPESA','NEUTRA')` do convênio de funcionário (uAPagar.pas:776) já é exprimível hoje como `tpconta` 1,2 — o que
falta para ele é a origem (`cdsDocsOPERACAO_CONVENIO_FUNCIONARIO`), não a view.

### 2.9 GET_FAMILIAS_PROD · GET_PLANO_CONTAS · GET_FORMAS_PGTO — texto decodificado

- **GET_FAMILIAS_PROD** (2.473): `NOME` (= descrição), `CODIGO`, `CODIGO_SUBGRUPO` (= o próprio código, sic), `TIPO` decodificado
  (GRUPO DE PRECO 1.819 · SUBGRUPO 520 · GRUPO 92 · DEPARTAMENTO 34 · SETOR 6 · SECAO 1 · PRODUCAO 1), `CODEMPRESA` (= IDEMPRESA; nula
  em 1.917), `CODIGO_DPTO`, `CODIGO_GRUPO`, `CODIGO_SETOR`, `ATIVO`, `SETOR_PERDA_PADRAO`. Os lookups do legado: `TIPO =
  'DEPARTAMENTO'|'GRUPO'|'SECAO'|'SETOR' AND CODEMPRESA = <loja> AND ATIVO = 'S'` (UCadFamiliaProd.pas:220-259) e sem a loja no
  produto (UCadProduto.pas:4201-4283). Destino `get_familias_prod` (348): `tipo` código, sem a empresa (o `daLoja` vai por subselect);
  `rel_get_familias_prod` (393) fiel.
- **GET_PLANO_CONTAS** (11.028, `ORDER BY CODIEXPANDIDO`): `TIPO` (EMPRESA/REFERENCIAL), `STATUS` (ATIVA/DESATIVADA), `CLASSE`
  (ANALITICA/SINTETICA) decodificados; na produção: EMPRESA·ANALITICA·ATIVA 10.950, EMPRESA·SINTETICA·ATIVA 78. Os lookups filtram o
  texto: `(CLASSE = 'ANALITICA') AND (TIPO = 'EMPRESA')` (uCadFormaPgto.pas:291, UCadContasBancarias.pas:175, uCadSituacaoNF.pas:276).
  Destino `get_plano_contas` (046): códigos crus (`classe 'A'`, `tipo 'E'`); `rel_get_plano_contas` (393) fiel. Leitores:
  `plano-contas.service.ts:27,47`, `rel_` (JOIN), `db-types.ts`.
- **GET_FORMAS_PGTO** (47, todas as lojas): `DESTINO` decodificado (TEF, CARTAO, ARECEBER, CAIXA, CHEQUE, QUEBRA DE CAIXA…), `CODIGO`
  (= IDPGTO), `PLC` (= PLCCOFRE), `CONTA_CORRENTE` (o **código**), `CONTA_CONTABIL` (o **CODIREDUZIDO**), `EMPRESA_FANTASIA`. Destino
  `get_formas_pgto` (052): `destino` código, e **o mesmo nome com outro significado** — `conta_corrente` = titular, `conta_contabil` =
  descrição. `rel_get_formas_pgto` (393) fiel ('DEVOLUÇÃO' consertado).

### 2.10 GET_CFOP — nomes e colunas de processamento (sem versão integral)

Produção: `SELECT B.CODCFOP, B.DESCRICAO, B.TIPO, B.TIPOESTADO, B.PROC_QTDE, B.PROC_FINANCEIRO, B.PROC_TRANSF, B.PROC_CUPOM,
B.CODCONTABIL, A.DESCRICAO as DESCONTABIL FROM CFOP B LEFT JOIN CODCONTABIL A …` com as colunas `CFOP` (NUMBER), DESCRICAO, TIPO,
`ESTADO` (DENTRO 217 · FORA 166 · nulo 15), `PRECESSA_QTDE` (sic), `PROCESSA_FINANCEIRO`, `PROCESSA_TRANSFERENCIA`, `PROCESSA_CUPOM`,
`CODCONTABIL`, `DESCODCONTABIL`. A tabela `CODCONTABIL` está **vazia** na produção (0 linhas; `CFOP.CODCONTABIL` preenchido em 2 de
398) e não existe no destino ⇒ `DESCODCONTABIL` sai nula, como lá. Destino `get_cfop` (346): `codcfop` (texto), `codigo`, `descricao`,
`tipo`, `tipoestado`, `devolucao`. O lookup do item da NF filtra `TIPO = … AND ESTADO = 'FORA'|'DENTRO' AND CFOP IN (…)` e devolve
`CFOP` (uItensNF.pas:1084-1087): o dado já está em `tipoestado`; o que falta é o nome. Leitor: `cfop.crud.ts:38`.

### 2.11 GET_EMPRESAS · GET_CONTAS_BANCARIAS · GET_LOTE_COBRANCA

- **GET_EMPRESAS** (5): 24 colunas, com `SENHAADMIN/DESC/CANCEL/GAVETA`, `MASCARAPLC`, `DESCONTO_MAXIMO`, `CODPARCEIRO`,
  `NOME_PARCEIRO`. `get_empresas` (032) tem 13; `rel_get_empresas` (393) as 24 com as senhas **nulas** (e o `SEGREDO` da Pesquisa já
  esconde toda coluna `senha*`). Leitor: `empresas.crud.ts:82`, `rel_` (JOIN). O 1º alfabético do legado é BAIRRO (só na `rel_`).
- **GET_CONTAS_BANCARIAS** (36, todas as lojas): `JOIN BANCOS` (nenhuma conta sem banco), `NRO_CONTA`, `AGENCIA`, `NRO_BANCO`
  (= CODBCOBLT), `DATA_ABERTURA`, `TELEFOMNE` (sic), `OBS`, `CODIGO`, `CODIGO_BANCO`; 5 colunas com **COMMENT** (título na Pesquisa:
  "CODIGO DA CONTA", "NUMERO DA CONTA"…). `get_contas_bancarias` (004) tem 8; `rel_` (393) fiel. (GET_BANCOS tem 1 COMMENT: BANCO =
  "NOME DO BANCO".)
- **GET_LOTE_COBRANCA**: `LOTE_COBRANCA` vazia na produção (0). Colunas `CODIGO`, `DATA_COBRANCA`, `COBRADOR`, `COD_COBRADOR`,
  `TOTAL_LOTE` (soma dos títulos), `JOIN PARCEIROS`. `get_lote_cobranca` (016) usa outros nomes e `qtd_itens` no lugar do total;
  `rel_` (393) fiel. Sem efeito hoje.

### 2.12 As pequenas

| view | produção | diferença no destino | efeito | proposta |
|---|---|---|---|---|
| GET_BANCOS | 594 | nenhuma (001) | — | — |
| GET_CIDADES | 5.564 | `uf` por `CASE` do código IBGE em vez do `JOIN UF` (a tabela UF não existe no destino) | equivalente | — |
| GET_UNIDADE | 11 | `get_unidade` (350) expõe `codunidade`, `indr`, `producao` e não tem o `WHERE INDR<>'E'` (a Pesquisa tira o INDR) | mesmo conjunto | `rel_` (393) |
| GET_BAIRRO | 0 | sem `CODIGO`; `REGIAO 'O'` → 'OESTE' (o legado diz 'CENTRO' — bug do legado, mantido na `rel_`) | nenhum (tabela vazia) | `rel_` (393) |
| GET_NCM | 11.344 | nenhuma (012) | — | — |
| GET_MARCAS | 1 | nenhuma (006; expõe INDR como o legado) | — | — |
| GET_PRECO | 0 | falta `CODIGO` (= `ID_PRECO`); o legado tem `WHERE INDR = 'I'` (o destino expõe `indr` e a Pesquisa filtra) | nenhum (vazia) | `+ codigo` |
| GET_CONDICOES_PAGTO | 53 | o legado tem só `CODIGO`, `DESCRICAO`; o destino soma `codconpagto`, `cd1`..`cd8`, `dtcadastro` | 10 campos a mais no combo | esconder (B0) |
| GET_MOTIVOS_OPERACAO | 34 | falta `PERDA_PADRAO` (`COALESCE(MOTIVO_OPERACAO_PERDA_PADRAO,'N')`, 1 'S') | 1 campo | `+ perda_padrao` |
| GET_HISTORICO_CONTABIL | 54 | falta `DESC_HISTORICO` (= `DESCHIST`) | o campo da descrição tem outro nome | `+ desc_historico` |
| GET_SITUACAO_NF | 194 | `ativo` com `COALESCE(…,'S')` | nenhum (0 nulos na produção) | — |
| GET_OPERACOES_CONTA | 1 | falta `CODIGO` (= `CODOPCONTA`) | retorno/abertura do legado | `+ codigo` |

---

## 3. Quem lê as `get_*` do destino — o custo de mudá-las no lugar

| view | leitores (fora a Pesquisa) | views que dependem | mudar no lugar? |
|---|---|---|---|
| `get_produtos` | `produto.aggregate.ts:68` (CRUD), smoke | — | **não** (multiplicidade quebra o CRUD) |
| `get_parceiros` | `parceiro.aggregate.ts:26`, smoke | — | **não** (idem) |
| `get_pedidocompra` | `pedido-compra.aggregate.ts:72`, `pedidoCompraApi.ts` (doc) | `rel_get_pedidocompra` | **não** (idem; `fechado`/`idempresa` mudariam de sentido) |
| `get_apagar` | `apagar.service.ts:46,79`, `apagar-baixa.service.ts:86`, `db-types.ts`, smoke (18) | `rel_get_apagar` | **não** (o `WHERE` dos abertos esconderia os quitados da tela) |
| `get_areceber` | `areceber.service.ts`, `areceber-baixa.service.ts`, `areceber-agrupamento.service.ts`, `lote-cobranca.repository.ts`, `db-types.ts`, smoke | — | **não** |
| `get_nf` | `nf.aggregate.ts:223`, smoke | — | não (colunas do CRUD) |
| `get_operadores` | `operadores.aggregate.ts:39`, `db-types.ts`, smoke | `rel_get_operadores` | **não** (`tipoop` mudaria de sentido) |
| `get_plano_contas` · `get_familias_prod` · `get_formas_pgto` | `plano-contas.service.ts`, `familias.crud.ts`, `formas-pgto.crud.ts`, `db-types.ts` | as `rel_` | **não** (`classe`, `tipo`, `destino`, `conta_*` mudariam de sentido) |
| `get_empresas` · `get_contas_bancarias` · `get_lote_cobranca` · `get_unidade` · `get_bairro` | os CRUDs; `lote-cobranca.repository.ts` | as `rel_` | desnecessário (há `rel_`) |
| `get_plc` · `get_cfop` · `get_preco` · `get_motivos_operacao` · `get_historico_contabil` · `get_operacoes_conta` | os CRUDs (`plc.crud.ts`, `cfop.crud.ts`…); `db-types.ts` em `get_operacoes_conta` | **nenhuma** | **sim, só aditivo** (colunas novas no fim; o `CREATE OR REPLACE VIEW` do PG só aceita acrescentar no fim, sem renomear nem mudar tipo) |
| `get_rcb` · `get_cp` · `get_cp_cen` · `get_apagar_cen` · `get_produtos_pc` | construtor (catálogo) e smoke | — | já fiéis — nada a fazer |

As `get_*` com `COMMENT ON VIEW` são fontes do construtor; quando há `rel_`, o construtor lê a `rel_` (`relacaoDaFonte`,
`relatorio-construtor.service.ts:22-29`) — mudar a `get_` não afeta os relatórios importados, mas afeta o CRUD. Onde não há `rel_`
(`get_rcb`, `get_cp`, `get_cp_cen`, `get_apagar_cen`, `get_produtos_pc`, `get_bancos`, `get_cidades`), o construtor lê a própria
`get_` — e elas já são as do legado.

---

## 4. Proposta (ordem = valor para o operador × risco)

| passo | o que entra | valor (uso na produção) | risco | migration |
|---|---|---|---|---|
| **B0** mecanismo | a Pesquisa lê a **relação do legado**: um campo `le` no registro (padrão `relacaoDaFonte(view)` — `rel_<view>` quando existe), com `view` mantendo o nome do legado (título, `TABELA_CADASTRO`, `CONFIG_STATUS_TELA`, Imprimir); o combo e a grade mostram **só as colunas do legado** (as do Apollo no fim da `rel_` ficam ocultas, mas valem para retorno, obrigatórios e cores — marcá-las com `COMMENT ON COLUMN … IS 'APOLLO'` ou listá-las no registro); `view` por opção e complemento (A pagar); o `meta` passa a depender da opção; títulos pelo COMMENT de coluna (GET_BANCOS 1, GET_CONTAS_BANCARIAS 5) | pré-requisito; sem ocultar, a `rel_get_apagar` abriria em AGRUPADO (do Apollo) em vez de BAIXA_AUTENTICA_TRANS | baixo | não |
| **B1** produtos | cadastro/produtos e lookup/produtos sobre `rel_get_produtos` + obrigatório `idempresa = loja do login`; `naoComposto`/`ativoCompra`/`semFilho` pela view (§5); cor de promoção | 38.638 acessos; 29.885 inativos da loja deixam de aparecer como ativos; cotação 20.204 × 47.802; 804 compostos nulos voltam; 86 colunas | médio: o smoke §298 insere produto **sem** `multi_preco` (não apareceria — como no legado) e compara com `count(*) FROM get_produtos`; medir o `count(*)` + `ORDER BY descricao` sobre ~48 mil linhas por loja (há índice `multi_preco(idempresa, dtultprecoalterado)`) | não |
| **B2** pedido de compra | compras/pedidos sobre `rel_get_pedidocompra`; "aberto" = `fechado='N' AND idempresa IN (<lojas>) AND fornecedor_ativo='S'` (o V$SQL); sai o `unnest` do CSV | 30.122 acessos; 1.429 × 3.982 abertos na loja 1 | baixo (uma linha por loja — o pedido de 2 lojas aparece 2 vezes com as 2 marcadas, como no legado) | não |
| **B3** A pagar e A receber | A pagar: abertas → `rel_get_apagar`/`get_apagar_cen`; demais → `get_cp`/`get_cp_cen`; o complemento "com/sem centro de custo"; retorno `codigo`; lojas por `codigo_empresa`; ordenação `vencimento`. A receber: `get_rcb`; retorno `codigo`; lojas por `idempresa`; abertura e ordenação em `cliente` | 31.986 + 8.326 acessos; `VALOR` líquido; o status salvo "Vencimento / Entre" passa a resolver | médio (mecanismo de view por opção do B0; o código devolvido é o mesmo valor — `CODIGO` = `codapg`/`codrcb`) | não |
| **B4** as demais com versão integral | fiscal/nf → `rel_get_nf`; parceiros → `rel_get_parceiros` (e os filtros `endereco_ativo`/`realiza_retencoes` nas telas que os usam); operadores → `rel_get_operadores` (`codigo_empresa = loja` no lugar do subselect); empresas, contas bancárias, formas de pagamento, lotes, unidades, bairros → as `rel_` | NF 29.245, parceiros ~20 mil, operadores 1.815, empresas 734, contas 392, formas 242 | baixo | não |
| **B5** as 6 sem versão integral | **`rel_get_plc`** (nova, sem COMMENT: o `WHERE length(desccodplc) > 5 AND indr <> 'E'`, as 8 do legado na ordem — `TIPO_CONTA` decodificado — e `codplc`, `desccodplc`, `tpconta`, `nivelconta`, `codcontabil` no fim) e **`rel_get_cfop`** (as 10 do legado — `CFOP` numérico, `ESTADO`, `PROCESSA_*`, `DESCODCONTABIL` nulo — e `codcfop`, `codigo`, `tipoestado`, `devolucao` no fim); **aditivo no fim** de `get_preco` (`codigo`), `get_motivos_operacao` (`perda_padrao`), `get_historico_contabil` (`desc_historico`), `get_operacoes_conta` (`codigo`) | plc 447, cfop 349, o resto < 70 | ~nulo: nenhuma view depende delas; `db-types.ts` de `get_operacoes_conta` ganha a coluna | **sim** (uma) |
| **B6** lookups de valor decodificado | lookup/familias, lookup/plano-contas, lookup/plc, lookup/operadores(-da-loja), lookup/cfops sobre a relação do legado, com os `fixos` da web reescritos para o valor do legado (§5.2) | o operador vê e digita o texto do legado (ANALITICA, DEPARTAMENTO, Supervisor(a)…); `TIPOOP='Supervisor(a)'` traz os nulos como o legado | médio (cerca de 13 pontos de chamada na web; um a um com o smoke §298.8-§298.11) | não |
| **B7** (opcional) lookup de item do pedido | um `lookup/produtos-pc` sobre `get_produtos_pc` com `idempresa`, `uf` da loja, `ativo_compra_mp` (config 30) e sem filho (uPedidoCompra.pas:4441-4446) | as 72 colunas da simulação de margem no pedido | médio-alto: 5,99 milhões de linhas na produção, repetição por código auxiliar — medir antes | não |

**Não fazer:** mudar no lugar a multiplicidade ou o significado de `get_produtos`, `get_parceiros`, `get_pedidocompra`, `get_apagar`,
`get_areceber`, `get_nf`, `get_operadores`, `get_plano_contas`, `get_familias_prod`, `get_formas_pgto` (§3). Uma "view só da Pesquisa"
nova também não é preciso: a `rel_` **é** a view do legado, já conferida pelo smoke §283 e pelo importador de relatórios, e ler a mesma
relação que o construtor deixa o corte F (Imprimir os relatórios salvos da view com o `IN` dos marcados) sem tradução de colunas.

---

## 5. Os filtros do `telas.ts` que passam a ir pela própria view

### 5.1 Obrigatórios, retorno, abertura e cores

| tela / lookup | hoje (pela tabela ou pelo nome do Apollo) | com a relação do legado |
|---|---|---|
| cadastro/produtos, lookup/produtos | sem loja; `ativo` = `produtos.ativo` | `idempresa = <loja>` (sempre, como `SetaEmpresaObrigatoria`); `ativo` da loja |
| lookup/produtos `naoComposto` | `idproduto in (select … from produtos where imprimircomp = 'N')` — **exclui 804 nulos** | `imprimircomp = 'N'` (a view já faz o `COALESCE`) |
| lookup/produtos `ativoCompra` | `… coalesce(p.ativo_compra,'S') <> 'N'` da tabela | `ativo_compra <> 'N'` da loja |
| lookup/produtos `semFilho` | `… p.idproduto_pai is null` | `produto_pai is null` |
| cadastro/produtos cor "promoção" | coluna inexistente (a regra fica fora) | `promocao = 'S'` |
| compras/pedidos "aberto" | `fechado = 'N'` do cabeçalho + `idempresa in (…) or unnest(empresas)` | `fechado = 'N' and idempresa in (<lojas>) and fornecedor_ativo = 'S'` |
| compras/pedidos cor "baixado" | `fechado` do cabeçalho | `fechado` da loja |
| cadastro/apagar estados | `get_apagar` + subselect `apagar.adcredito` + `codempresa` | a view da opção: abertas = a própria view (sem condição de estado); as outras pela `get_cp`, que tem `quitada`, `adcredito`, `agrupado`; lojas por `codigo_empresa`; retorno `codigo`; ordenação `vencimento` |
| cadastro/apagar cores | `bloqueio`, `fornecedor_possui_debito` (sem coluna em `get_apagar`) | as duas existem na GET_APAGAR (na GET_CP só `bloqueio`, como no legado) |
| cadastro/areceber | `get_areceber`: `codempresa`, `trim(quitada)`, `trim(agrupado)`, `consiliado`; retorno `codrcb`; abertura `razao`; cor `dtvenc` | `get_rcb`: `idempresa`, `quitada`, `agrupado`, `consiliado`; retorno `codigo`; abertura/ordenação `cliente`; cores `quitada`, `registro_arq_remessa`, `data_vencimento` (os nomes do uCadAReceber.pas:2611-2635) |
| fiscal/nf cores | `statusnfe` 'P'/'C'/'D' (junta emitida e contingência), `proc` | `status_nfe` = o texto de cada regra do uNF.pas:6211-6283; `processada` |
| cadastro/parceiros cores | `bloqued`; `data_ultima_compra` sem coluna | `bloqueado`, `data_ultima_compra` (uCadClientes.pas:3788-3808) |
| cadastro/operadores, lookup/operadores-da-loja | `codoperador in (select … from relacao_operador_empresa where codempresa = <loja>)` + `login <> 'SICOM'` | `codigo_empresa = <loja>` (a view já tira SICOM e excluídos) |
| cadastro/plc, lookup/plc | obrigatório `length(desccodplc) > 5` | dentro da `rel_get_plc`; `lancavel` = `char_length(codigo_extenso) = <máscara>` (o texto do legado, uAPagar.pas:777) |
| lookup/familias `daLoja` | `codfamilia in (select … from familias_prod where idempresa = <loja>)` | `codempresa = <loja>` (UCadFamiliaProd.pas:222-259) |

Filtros que o §0 do dossiê dá como "ainda fora" e que a relação do legado destrava: `ENDERECO_ATIVO` do fornecedor do pedido e
`REALIZA_RETENCOES` do parceiro da NF (GET_PARCEIROS). Os outros não dependem da view: `TIPO_CONTA IN (DESPESA, NEUTRA)` e o
`TIPOESTADO` do CFOP já têm o dado (`tpconta`, `tipoestado`) e esperam a origem do valor na tela; `INCLUIR_CLIENTES_FORN_NF_DEV` é
configuração; o produto-pai ≠ o próprio é regra da tela.

### 5.2 Os `fixos` da web que mudam de valor (B6)

| chamada (web) | hoje (código cru) | com a relação do legado |
|---|---|---|
| `ProdutoCadMaster.tsx:444/462/480`, `FamiliasCadMaster.tsx:33`, `PromocaoCadMaster.tsx:614` (lookup/familias) | `tipo: 'G'/'D'/'O'/…` | `tipo: 'GRUPO'/'DEPARTAMENTO'/'SECAO'/…` |
| `SituacaoNfCadMaster.tsx:18`, `FormasPgtoCadMaster.tsx:106`, `ContasBancariasCadMaster.tsx:181` (lookup/plano-contas) | `classe: 'A', tipo: 'E'` | `classe: 'ANALITICA', tipo: 'EMPRESA'` |
| `PlcCadMaster.tsx:65` (lookup/plano-contas) | `classe: 'A'` | `classe: 'ANALITICA'` |
| `OperadoresCadMaster.tsx:149` (lookup/operadores) | `tipoop: 'SUP'` | `tipo_sigla: 'SUP'` — **provado (B6)**: o botão do supervisor é `TfrmPesquisa.Create(…, 'GET_OPERADORES', …, 'DESABILITADO = ''N'' AND TIPO_SIGLA = ''SUP''')` (uCadUsuarios.pas:495-501; o `SegSupervisor` do .dfm:2557-2582 filtra a tabela por `TIPOOP = 'SUP'`, o mesmo conjunto). Na produção: `TIPO_SIGLA='SUP' AND DESABILITADO='N'` = 20 linhas / 6 operadores; `TIPOOP='Supervisor(a)'` = 418 / 202 (o nulo entra pelo `ELSE`) |
| `ContasReceberCadMaster.tsx:299`, `SituacaoNfCadMaster.tsx:160` (lookup/plc) | `tpconta: 0/1` | ficam (a `rel_get_plc` mantém `tpconta` no fim) ou `tipo_conta: 'RECEITA'/'DESPESA'` |
| `campoCodigo`/`campoDigitado`/`descricao` (`codparceiro`, `idproduto`, `codplc`/`desccodplc`, `codplanocontas`/`codireduzido`, `codoperador`, `codfamilia`/`descricao`, `codcfop`) | nomes do Apollo | continuam: as `rel_` guardam essas colunas no fim |

---

## 6. Cuidados e decisões

1. **Multiplicidade visível.** Com as relações do legado o operador vê o que vê lá: o parceiro com 2 endereços 2 vezes, o título com 2
   baixas 2 vezes (GET_RCB, GET_CP), o título com rateio uma vez por centro (_CEN), o pedido de 2 lojas 2 vezes. A navegação do
   cadastro (`soCodigos`, corte C1) repete o código como o `cdsNavegation`; o `LookupField` usa a 1ª linha (`LookupField.tsx:49`) —
   sem efeito.
2. **Desempenho a medir antes do B1/B3:** `count(*)` + página ordenada sobre `rel_get_produtos` por loja (~48 mil linhas, 14 junções
   e um `EXISTS`), `get_rcb` (100 mil, cálculo de juro) e `rel_get_pedidocompra` (`GROUP BY` + junção com a `get_pedidocompra`). O
   filtro de loja é coluna de agrupamento/junção simples: o PG o empurra para dentro.
3. **Smoke §298** depende de `get_produtos` (fixtures sem `multi_preco`, total = `count(*) FROM get_produtos WHERE ativo='S'`) —
   reescrever junto com o B1. O §283 (catálogo) não muda: nenhuma `rel_`/`get_` do catálogo é alterada; `rel_get_plc` e `rel_get_cfop`
   nascem **sem** COMMENT (GET_PLC e GET_CFOP não têm COMMENT na produção — não são fontes do construtor).
4. **Corte E depende do B:** os status salvos da produção ("Nro_nf", "Vencimento", "Razao", "Nome", índice 1 = CODIGO) só resolvem com
   as colunas do legado.
5. **Diferenças deliberadas que ficam** (decidir se o usuário quer o texto quebrado do legado): 'Usuário(a)' × 'Usu?rio(a)'
   (GET_OPERADORES), 'NÃO' × 'NÃƒO' (GET_NF.PRECIFICADA), 'DEVOLUÇÃO' × 'DEVOLUÃ‡ÃƒO' (GET_FORMAS_PGTO). Quem digita o texto quebrado
   no legado não acha no Apollo; o contrário também.
6. **GET_ARECEBER** (a da produção, só abertos, sem COMMENT) não é a view de nenhuma tela do registro; não confundir com a
   `get_areceber` do destino (todos os estados, nomes do Apollo).

---

## 7. Como refazer a prova (só leitura)

- Texto e colunas da produção: `user_views` / `user_tab_cols` (com `hidden_column='NO'`) / `user_col_comments` /
  `user_tab_comments`, com `SET TRANSACTION READ ONLY`; contagens `select count(*), count(distinct codigo) from GET_X`.
- Contagens citadas: `get_produtos` por `idempresa` × `ativo`/`promocao`/`ativo_compra`/`imprimircomp`/`produto_pai`; `produtos` por
  `ativo`/`imprimircomp`/`ativo_compra`; `configuracoes` ⋈ `configuracoes_especificas` (id 30); `get_pedidocompra` por
  `fechado`×`fornecedor_ativo` e cabeçalho × loja; `pedidocompra` aberto pelo cabeçalho com a loja em `pedido_compra_empresa`;
  `get_parceiros` por `codigo` repetido e `endereco_ativo`; `get_nf` por `status_nfe`; `apagar` com `vendor`/`desconto` ≠ 0;
  `get_operadores` por `codigo_empresa` e `tipoop`×`tipo_sigla`; `get_familias_prod` por `tipo`/`codempresa`; `get_plano_contas` por
  `tipo`×`classe`×`status`; `get_plc` por `tipo_conta`; `get_cfop` por `estado`; `codcontabil`; `situacao_nf.ativo` nulo.
- Destino: a última `CREATE [OR REPLACE] VIEW` de cada nome nas migrations (ordem numérica) e `tools/cutover/schema-destino.json`;
  leitores por `grep -rnw get_x apps/api/src apps/web/src apps/api/scripts apps/api/test`; dependentes por `(FROM|JOIN) get_x` nas
  migrations.
- Expressões: a normalização do `tools/cutover/conferir-views.py` aplicada à relação integral (posicional pela lista de colunas da
  produção; GET_APAGAR e GET_APAGAR_CEN não são posicionais por causa de um `-- G.DESCRICAO,` comentado no meio da lista).
