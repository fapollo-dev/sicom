# Recon de paridade — o que "Processar Nota" faz aos PRODUTOS (`TfrmEstoqueNF` → `TDMNF.UpdateProdutos`)

Data: 25/09/2026. Somente leitura (nenhuma edição em `/Library/Apollo`, nenhum git que altere).
Fonte do legado: `/Library/SicomGit/retaguarda-master/fonte/Units` (mai/2020, latin1; linhas conferidas em cópias UTF-8 nesta pasta:
`uEstoqueNF.pas.txt`, `udmNF.pas.txt`, `udmNF.dfm.txt`, `uNF.pas.txt`, `uProcessaNotaFiscal.pas.txt`).
Dado vivo: Oracle de PRODUÇÃO `hiperpinheirao` (python-oracledb thin, `SET TRANSACTION READ ONLY`, só SELECT; scripts `q.py`, `extract.py`,
`extract2.py`, `analyze.py`, `analyze2.py` e os SQL em `sql/` nesta pasta; amostras `hist_ago_set.csv` = 13.301 itens processados de
01/08 a 25/09/2026 e `hist_next.csv` = o retrato seguinte de cada produto/empresa).

Convenção: `udmNF:7182` = `udmNF.pas` linha 7182; `dfm:9621` = `udmNF.dfm`; `uEstoqueNF:967` = `uEstoqueNF.pas`; `uNF:15113` = `uNF.pas`.
Quando o fonte (2020) e o dado discordam, **o dado decide** e isso está marcado como ⚠️ BINÁRIO NOVO.

---

## 0. Sumário (o que importa)

1. **É só nota de ENTRADA.** Todo efeito em produto está dentro de `if cdsNotaTIPO = 'E'` (`udmNF:7322`). Na saída o `UpdateProdutos`
   só grava os flags do item (GERAESTOQUE/ORIGEM_ESTOQUE/USOCONSUMO/MOVIMENTA_ESTOQUE, `udmNF:7287-7317`). Produção 2026: **6.581 de 6.581**
   NFs de entrada processadas e **61.741 de 61.741** itens têm o par em HISTORICO_PROCESSAMENTO_NF; **0 de 733** saídas.
2. **HISTORICO_PROCESSAMENTO_NF grava DOIS registros por item**: `'PRODUTO'` = retrato do MULTI_PRECO/PRODUTOS **antes** (`udmNF:6846-6900`) e
   `'PROCESSAMENTO'` = os valores da nota (`udmNF:6962-7023`). Roda todo mês (6,4 mil–8,1 mil pares/mês em 2026). As fórmulas batem 99,9–100%.
3. **Custo (VRCUSTO/VRCUSTOREAL/VRCUSTOREP) só muda com as 3 chaves**: coluna "Altera custo" do grid (default = entrada) **E**
   `NF_PROD.ATUALIZA_MULTIPRECO_DECOMP='S'` **E** `CFOP(item).ALTERA_CUSTO_NF='S'` (`udmNF:7507-7510`). VRCUSTO = **custo contábil**
   `(VRCUSTO − VRCUSTO×DESCONTO/100)/FATOREMBAL` (100% na produção → `PREÇO CUSTO NF` do ConfigDB.xml local é 'CUSTO CONTABIL'/vazio).
   Não é custo médio: é o **último custo** da nota.
4. **Outros ~25 campos do MULTI_PRECO são SEMPRE sobrescritos** (entrada normal), mesmo sem a chave de custo: VRCUSTOFISCAL, ICMST, VRFCPST,
   SEGURO, FRETE, MARKUP, ICME, DESPACESSORIO, IPI, FRETE2, MARGEML, CREDITOICM/PISCOFINS, DEBITOICM…MARGEML2, VRCUSTOCSI, PMZ, VRVENDASUG,
   BONIFICACAO, VRCUSTOAJUSTE (`udmNF:7514-7571`). Provado: VRCUSTOCSI muda com a chave de custo 'N' em 404/404 casos; VRCUSTO fica igual em 581/585.
5. **Preço de venda quase nunca muda no processamento**: `CFOP.ATUALIZA_VENDA_NF='N'` em todos os CFOPs usados → o grid abre com "Atualizar preço"
   desmarcado; `BLOQUEAR_ATUALIZA_PRECO_ONLINE_NF`='S' (específica Modulo Retaguarda) força "Gerar lote". 2026: 29 itens marcados à mão, **0 lotes**
   (todos com preço igual e `GERA_LOTE_PROD_ALTERADO='S'`); online = 0 desde 2023. Quando gera, é 1 LOTEPRECO **por empresa** (sincronizar,
   `EMPRESAS.SINCRONIZA_PRECO_NF='S'`): prova em out/2025, 5 lotes × 2 reprocessamentos.
6. **Reverter não desfaz custo/preço/histórico**: `ReverteProcessamento` (`uNF:8913-9186`) só vira PROC, estorna estoque (trigger), cancela
   faturamento e caixa. 2.998 itens de 2026 foram processados 2+ vezes (cada vez novo par no histórico). O botão "Reverter" do `TfrmEstoqueNF`
   é outra coisa: **exclui o financeiro** (`uEstoqueNF:991-1037`).
7. ⚠️ BINÁRIO NOVO, pelo dado: **PRODUTOS.FATORCX não é mais atualizado** (576/576 inalterados, o fonte manda em `udmNF:7338`);
   **transferência não altera custo** (0/231 itens com custo diferente tiveram histórico de custo, apesar da config Modulo=S);
   **SetaSTReal (`uNF:16084`) não se observa** (ICMST final = VRICMST/qtde em 45 × STREAL/qtde em 3); o histórico dinâmico do custo usa o
   texto `'NF de Entrada'` (VRCUSTO) e `'Processamento da NF Nro: <NRONF>'` (VRCUSTOREAL); VRCUSTOREP não tem histórico da aplicação (só o do trigger).
8. **Apollo**: `nf-processamento.service.ts` não tem nada disso — nem os flags do item (hoje a importação grava `geraestoque='S'` fixo,
   `nfe-item-importacao.ts:135-136`, `recebimento.service.ts:144-145`: **2.856 itens de uso/consumo/serviço de 2026 (CFOP 1556/2556/1949/1933/1407…,
   `PROC_QTDE='N'`) moveriam estoque no Apollo**). Tabelas e colunas de destino existem todas (mig 291 para o histórico); faltam a porta de
   `CalcValorCusto` do item e o gatilho `UPDATE_CUSTO_MULTI_PRECO` (histórico dinâmico de custo).

---

## 1. O fluxo do botão (uNF → TfrmEstoqueNF → UpdateProdutos)

### 1.1 `TfrmNF.Processamento` — antes de abrir a tela (`uNF:14765-15136`)
Ordem: dia FECHADO bloqueia (`:14774-14782`) · se o menu está como "Reverter Processamento" chama `ReverteProcessamento` (`:14786-14790`) ·
já processada (`:14792`) · DTCONTABIL < DTEMISSAO (`:14800`) · transferência de produção (`:14807`) · decomposição na entrada (`:14810`) ·
pedido de compra (`:14814`) · decomposição (`:14817`) · conferência (`:14820`) · transferência (`:14826`) · base INSS (`:14829`) ·
FINALIDADE=1 → `ValidaValorDeCustoDosProdutos` (`:14832`) · **entrada não-transferência com `NF_IMPORTACAO_NFE='T'` → `RecalcularCustoEValoresDaNotaFiscal`**
(recalcula `CalcValorCusto`+`CalcValorNota` de todos os itens, `:14835-14838`, `:8782-8802`) · devolução exige referência (`:14842`) ·
complemento (`:14856`) · CFOPs de devolução (`:14877`) · sem itens (`:14886`) · transportadora na saída (`:14898`) · totais (`:14905`) ·
FIGURAFISCAL='D' confere ST (`:14910-14918`) · CFOP×situação (`:14921-14936`) · indexador obrigatório (`:14938-14996`) · chave/modelo 55 (`:14998-15029`) ·
total informado (`:15031`) · **repasse dos itens** (`:15038-15080`) · tributação×CFOP na saída (`:15093`) · lançamentos contábeis (`:15101`) ·
abre `TfrmEstoqueNF.ProcessarEstoqueNota` em laço enquanto a tela pedir reabrir (`:15113-15120`) · **depois, se PROC='S' e entrada: `SetaSTReal`** (`:15123-15125`).

Outros chamadores do mesmo fluxo: `TFrmProcessaNotaFiscal.ProcessarNotaFiscal` (`uProcessaNotaFiscal:1038-1112`: recalcula custo dos itens, valida e abre
`TfrmEstoqueNF`, depois `AtualizaICMSSTRealProduto` `:1794`) — usado ao gerar a NF de transferência (`uNF:7597-7599`); e o Mapa de Carga
(`UCadMapaDeCarga:1453`, `UpdateProdutos(false)` com `ALTERAPRECO=False`, `ALTERACUSTO = TIPO<>'S'`, `fTipoAtualizacaoPreco` = `tpaNenhum` do
`DataModuleCreate`, `udmNF:6318`; as notas do mapa são de saída).

### 1.2 `TfrmEstoqueNF.FormShow` — os defaults que o operador vê (`uEstoqueNF:1724-1969`)
| controle | default | linha |
|---|---|---|
| Atualizar preços: On-line / Gerar lote / Não atualizar | On-line; Gerar lote se `EMPRESAS.PRECONF='L'`; se `BLOQUEAR_ATUALIZA_PRECO_ONLINE_NF='S'` força Gerar lote e desabilita On-line | `:1750-1758` |
| Opção de atualização (rgopcao) "Individual"/"Sincronizar empresas" (`uEstoqueNF.dfm:232-244`) | 1 (Sincronizar) se `EMPRESAS.SINCRONIZA_PRECO_NF='S'`; 0 e escondido se `BLOQUEIA SINCRONIZACAO VALOR DE VENDA`='SIM' (ConfigDB.xml local) | `:1763-1770` |
| coluna Depósito visível | `PROCESSAR_NOTA_MOSTRAR_COLUNA_DEPOSITO='S'` | `:1760` |
| coluna "Atualizar preço de venda? [F7]" visível | `BLOQUEAR PRECIFICAO NA NF`<>'SIM' (ConfigDB.xml) | `:1761` |
| item ALTERAPRECO | `CFOP(do CABEÇALHO).ATUALIZA_VENDA_NF='S'` | `:1835-1836` |
| item ALTERACUSTO | `TIPO<>'S'` | `:1838` |
| item MOVIMENTA_ESTOQUE | `PROC_QTDE` do CFOP **do item** (join `C.CODCFOP = N.CFOP`, `dfm:2450`, `:2677`) | `:1840` |
| item DEPOSITO/GERAQTDE (loja) | se MOVIMENTA: `TIPO_ESTOQUE='A'` → loja se `TIPO_ESTOQUE_PADRAO='L'`; senão depósito se `TIPO_ESTOQUE='D'`; sem MOVIMENTA → nenhum | `:1842-1860` |
| troca com estoque informado | LOJA→GERAQTDE, senão DEPÓSITO | `:1862-1866` |
| DECOMPOSICAO do item | `PRODUTOS.DECOMPOSICAO` | `:1868` |
| requisição de produção (`CODPRODUCAO_REQ>0`, não entrada 'P') | tudo desmarcado e colunas escondidas | `:1786-1830` |
| edição das colunas de estoque | `PERMITE_EDICAO_PROC_ESTOQUE='S'` e não (transferência e `TIPO_ESTOQUE<>'A'`) | `:1972-1975` |
| saída | colunas de preço/custo escondidas | `:1929-1937` |
Toggle manual: clique na célula ALTERAPRECO/ALTERACUSTO (`:1121-1136`), título/F7/F8 marca todos (`:1208-1226`, `:1675-1676`, `:1390-1442`).

### 1.3 `btnProcessarClick` (`uEstoqueNF:825-989`), em ordem
1. Σ faturas ≠ total − bonificado − retenções − desc. acordo − desc. pedido, com "Gerar financeiro" habilitado → "O total das faturas é diferente…" (`:830-845`).
2. NFe 4.00 (FINALIDADE∉{2,3,4}, VERSAOXML=400, PROC_FINANCEIRO='S', modelo 55/57): `ValidaNfeVersao4` (forma de pagamento; entrada não-importada) (`:847-853`, `:674-723`);
   entrada TIPOEMISSAO='1' exige total de pagamentos>0; senão pagamentos−troco = total (`:856-871`).
3. Entrada modelo 3 (serviço): parceiro com teto `VALORSERVICOFIXO` e Σ do mês > teto → confirma + `USUARIOS_PROCESSAM_NF_SERV_ACIMA_VALORFIXO` + liberação
   por login, grava `NF.CODOPERADOR_LIBERA_NFSERV` (`:874-895`, `:531-547`, `:618-658`, `:725-752`); LR/LP → aviso de ISSQN (`:897-900`).
4. Confirmação (`:903`); produto do item inexistente em PRODUTOS → aborta com a lista (`:907-941`).
5. `PermiteReverterComProdutoEstoqueNeg` (`:944`; `udmNF:11600-11688`) — apesar do nome, também no processar: item com MOVIMENTA e GERAESTOQUE='S'
   cujo saldo (entrada: saldo; saída: saldo − qtde×fator) < 0 e `PERMITE_PROC_NF_ESTOQUE_NEG='N'` pede senha e grava `NF_PROD.CODOPERADOR_LIB_ESTOQUENEG`.
6. CODFATURAMENTO definitivo por `GetID` (`:947-958`).
7. `fTipoAtualizacaoPreco` := On-line/Lote/Nenhum (`:962-964`) e **`UpdateProdutos(rgopcao.ItemIndex = 1, true)`** (`:967`); erro com 'VRVENDA' → "Valor de venda
   do produto está em branco…" (`:972-974`).

### 1.4 Reverter
- **Botão "Reverter" da tela de processar** = `ExcluirDocumentosFinanceiros` (`uEstoqueNF:991-1037`): exige `PERMITE_EXCLUIR_FINANCEIRO_DA_NF='S'`,
  recusa se houver baixa (`VerificaExisteBaixas`), `ExcluiFaturamento` + `DesregistrarProcessoNotaFiscal(stGerarFinanceiro)`. Não toca produto.
- **Reverter processamento** (`uNF:8913-9186`): bloqueia NFe enviada (`:8939-8947`), estorna contábil se AUTOMATICA (`:8949-8967`), confirmação
  conforme `ALTERA_ESTOQUE_REVERSAO_NF` (`:8969-8980`), dia fechado (`:8984-8992`), estoque negativo (`:8994`), senha ADM se DTPROCESSAMENTO ≠ hoje
  (`:9006-9010`), grava `ALTERAESTOQUEREVERSAO`, `PROC='N'`, `DTPROCESSAMENTO=NULL` (`:9030-9047`) → trigger `ESTOQUE_NOTAS` estorna estoque;
  desregistra `stProcessarFaturar` (`:9163`), `CancelaFaturamento(...,'R')` (`:9171-9172`), `ReverteLancamentosDeCaixa` (`:9174`).
  **Nenhuma linha toca MULTI_PRECO, PRODUTOS, LOTEPRECO ou HISTORICO_PROCESSAMENTO_NF**, e o trigger `ESTOQUE_NOTAS` (1.029 linhas, lido em
  `all_source`) só mexe em ESTOQUE/ESTOQUE_DEP/ESTOQUE_PROD/HISTORICO_PROD*/DECOMPOSICAO_NF_QTDE/CLAVEGOS/HISTORICO_FLEX. Reprocessar grava tudo de novo.
  Dado: 2.861 itens processados 2×, 112 3×, 25 4–9× em 2026; VRCUSTOCSI do 2º retrato = processado do 1º em 108/117 (sem desfazer).

---

## 2. `UpdateProdutos` passo a passo (`udmNF:6778-7898`)

### 2.1 Montagem (`udmNF:7252-7264`)
`vQryProdutosGrupoEmpresa` = `SELECT IDPRODUTO FROM PRODUTOS WHERE CODGRUPOPRECO = :CODGRUPOPRECO OR IDPRODUTO = :IDPRODUTO` (`UAtualizacaoPrecoFilho:25-29`);
`vListaEmpresas := GetEmpresas(conexão)` (FuncoesApollo — **não está no fonte**; o dado mostra as 5 empresas 1/2/50/51/52 no lote sincronizado); abre **uma
transação** para tudo (`:7264`).

Por item, abre `cdsProdutos` = MULTI_PRECO ⋈ PRODUTOS da **empresa da nota** (`udmNF:6193-6309`; `IDPRODUTO_FILHO=0` → VRVENDA é o do próprio produto, `:6235`, `:7272`)
e `cdsProdutos_Update` = PRODUTOS (`dfm:15158-15354`). Chaves de gravação: MULTI_PRECO por (IDPRODUTO, IDEMPRESA) (`dfm:9460`, `:9576`, upWhereKeyOnly).

### 2.2 Todos os tipos — flags do item (`udmNF:7280-7317`)
| NF_PROD | regra | linha | produção 2026 |
|---|---|---|---|
| (recalcula) | `CalcValorNota(TIPO)` → refaz VRCUSTOFINAL/VRCUSTOFINALC e os TEMP de custo (§2.9) | `:7283` | — |
| GERAESTOQUE | 'S' se GERAQTDE ou DEPOSITO ou PRODUCAO | `:7287-7290` | = CFOP(item).PROC_QTDE em 61.733/61.741 entrada, 8.410/8.410 saída |
| ORIGEM_ESTOQUE | 'D' depósito / 'P' produção / 'E'; troca: LOJA→'E' senão 'D' | `:7292-7309` | 'E' em 100% (entrada e saída) |
| USOCONSUMO | `PRODUTOS.USO_CONSUMO` | `:7299` | = produto em 100% (ver nota) |
| MOVIMENTA_ESTOQUE | = GERAESTOQUE; e `UPDATE NF_PROD SET MOVIMENTA_ESTOQUE … WHERE CODNF, CODPRODUTO, NROITEM` | `:7311-7317` | = GERAESTOQUE 100% |
Nota USOCONSUMO: o dataset lê `COALESCE(N.USOCONSUMO,'N')` (`dfm:2643`); produto 'N' não "muda" o valor e o provider não grava → NF_PROD fica NULL
(5.194 casos), mas o histórico grava 'N'. Produto 'S' grava 'S' (1.800).
Esses campos vão ao banco no `cdsNota.ApplyUpdates` (itens são dataset aninhado, `dfm:3546`) de `:7738`.

### 2.3 Entrada — HISTORICO_PROCESSAMENTO_NF (`RegistrarAlteracoesDoProduto`, `udmNF:6803-7024`, chamada em `:7328-7331` dentro de `try…except end` — erro engolido)
Só se o produto tem MULTI_PRECO na empresa da nota (`:7320`) — em 2026, 61.741/61.741. Grava para **toda entrada** (normal, transferência e devolução).

**Linha `'PRODUTO'`** (`:6846-6900`) = estado atual: CODHISTPROCNF=`ID_CODHISTPROCNF.NEXTVAL`, CODNFPROD, CODNF, CODPRODUTO, HISTORICO='PRODUTO',
USUHISTORICO=usuário, GERAESTOQUE/USUCONSUMO/ORIGEM_ESTOQUE do item, **FATOREMBAL=PRODUTOS.FATORCX, CODPARCEIRO=PRODUTOS.CODFOR**, e do MULTI_PRECO:
VRCUSTO, VRVENDA, VRCUSTOREAL, VRCUSTOREP, VRCUSTOFISCAL, VRCUSTOCSI, VRCUSTOAJUSTE, VRVENDASUG, PMZ, BONIFICACAO, ICMST, VRFCPST, SEGURO, FRETE,
MARKUP, ICME, DESPACESSORIO, IPI, FRETE2, MARGEML, CREDITOICM, CREDITOPISCOFINS, DEBITOICM, DEBITOPISCOFINS, VENDALIQ, LUCROBRUTOV, LUCROBRUTOP,
DESPOPV, LUCROLIQV, LUCROLIQP, IMPREND, CONTSOCIAL, MARGEML2V, MARGEML2, UNIDADE (=`COALESCE(U.SIGLA, PRO.UNIDADE)`), DTHISTORICO=SYSDATE. Flags NULL.

**Linha `'PROCESSAMENTO'`** (`:6962-7023`), DTHISTORICO = SYSDATE + 1 s:
| coluna | valor | linha | acordo 2026 (13.301 itens ago–set) |
|---|---|---|---|
| FATOREMBAL / CODPARCEIRO | NF_PROD.FATOREMBAL / NF.CODPARCEIRO | `:6977-6978` | 99,99% / 100% |
| VRCUSTO | contábil `VRCUSTOFINALC` (config vazia/'CUSTO CONTABIL') senão `VRCUSTOREAL/FATOREMBAL` | `:6918-6922` | **contábil 100%** (real 98,8%: difere nos 161 com desconto) |
| VRVENDA | NF_PROD.VRVENDA | `:6980` | 99,95% |
| VRCUSTOREAL | CUSTO_REAL_UNIT; se 0, TEMPVRCUSTO | `:6924-6926` | 99,99%; os 198 com 0 (transferências) = TEMPVRCUSTO reproduzido 198/198 |
| VRCUSTOREP | NF_PROD.VRCUSTOREP (sem fallback aqui) | `:6982` | 100% |
| VRCUSTOFISCAL | NF_PROD.VRCUSTO (preço da embalagem, sem dividir) | `:6983` | 99,99% |
| VRCUSTOCSI / PMZ / VRVENDASUG | gravado; se 0, TEMPVRCUSTOCSI/TEMPPMZ/TEMPVRVENDASUG | `:6928-6934`, `:6943-6945` | 99,99 / 99,99 / 99,98% |
| VRCUSTOAJUSTE | NF_PROD.VRCUSTOAJUSTENF (inteiro, **sem** dividir — o MULTI_PRECO divide) | `:6985` | 100% (sempre 0) |
| BONIFICACAO | 0 se CFOP do cabeçalho ou do item ∈ {1910,2910,5910,6910}; senão NF_PROD.BONIFICACAO | `:6936-6941` | 100% |
| ICMST | (VRICMST se STREAL=0, senão STREAL) / QTDETOTAL | `:6902-6905` | 100% |
| VRFCPST | FCP_VALOR_ST / QTDETOTAL | `:6907-6910` | 100% |
| SEGURO, FRETE, MARKUP, IPI, FRETE2 | NF_PROD (percentuais) | `:6991-6997` | 100/100/99,98/100/100% |
| ICME | TEMPICMEEFETIVO (§2.9) | `:6994` | **100%** (sem as zeragens: 68%) |
| DESPACESSORIO | DEPSACESS / (QUANTIDADE×FATOREMBAL) | `:6912-6916` | 100% |
| MARGEML / MARGEML2 | NF_PROD.MARKUPL / MARKUPL2 | `:6998`, `:7012` | 100 / 99,95% |
| CREDITOICM / CREDITOPISCOFINS | TEMPCREDITOICM / TEMPCREDITOPIS (as colunas do item ficam 0) | `:6999-7000` | 100 / 99,99% |
| DEBITOICM…MARGEML2V (10 colunas) | NF_PROD homônimas | `:7001-7011` | 99,95–100% |
| UNIDADE | NF_PROD.UNIDADE | `:7013` | 99,98% |
| ALTERACUSTOESTO / DECO / CFOP | coluna do grid / ATUALIZA_MULTIPRECO_DECOMP / `CFOP(item).ALTERA_CUSTO_NF` | `:6949-6951` | DECO 100%, CFOP 100% |
| EXISTEALTERACAOCUSTO | 'S' se as 3 | `:6953-6954` | 100% |
| ALTERAVENDAONLINE / LOTE / EXISTEALTERACAOVENDA | ALTERAPRECO e modo | `:6956-6960` | online 0; lote 29 |
⚠️ BINÁRIO NOVO: o fonte formata tudo com `'0.00'`; em produção o VRCUSTO do PROCESSAMENTO tem até 6 casas (48% com >2) e o do PRODUTO até 4
(escala do MULTI_PRECO); os demais, 2 casas. Distribuição dos flags 2026: S/S/S/S 61.402; ESTO+CFOP sem DECO 2.400; ESTO+DECO sem CFOP (1949/1910/1407) 1.330.

### 2.4 Entrada normal (CFOP da nota **não** é transferência `CFOP.PROC_TRANSF='S'` **nem** devolução `CFOP.DEVOLUCAO='S'`, `udmNF:7334`, `:5711-5723`)

**PRODUTOS** (`cdsProdutos_Update`, `udmNF:7336-7349`, aplicado em `:7601`; flags do provider `dfm:15199-15349`):
| coluna | valor | condição | linha | dado |
|---|---|---|---|---|
| FATORCX | NF_PROD.FATOREMBAL | sempre | `:7338` | ⚠️ **não acontece**: 576/576 casos com fator diferente seguem com o fator antigo; PRODUTO.FATOREMBAL = PRODUTOS.FATORCX atual 3.041/3.041 |
| CODFOR | NF.CODPARCEIRO | `ATUALIZA_FORNEC_PRODUTO_PROCESSAR_NF='S'` (global N, **Modulo Retaguarda S**) | `:7340-7341` | **925/926** trocas acontecem → a específica de módulo vale |
| DTULTIMALTERACAO / USULTALTERACAO | Now / operador | sempre | `:7343-7344` | 1.672/1.672 com data ≥ processamento |
| ALIQPISE/S, ALIQCOFINSE/S | do item | — | `:7345-7348` | **não gravam** (ProviderFlags [] `dfm:15327`; são colunas do PISCOFINS) |
| PIS | NF_PROD.PIS | sempre | `:7349` | igual em 1.672/1.672 |
Triggers acionados: `UPDATE_PRODUTOS_FILHOS` propaga CODFOR/FATORCX… aos filhos (Apollo já tem: mig 132), `AUDIT_PRODUTOS` (auditoria), `REM_PRODUTO`.

**MULTI_PRECO da empresa da nota** (laço `udmNF:7352-7576`, aplicado em `:7600`; só colunas com `pfInUpdate`, `dfm:9460-9845`; **UNIDADE não grava**, `dfm:9621`):
| coluna | valor | condição | linha | persistência medida (próximo retrato do mesmo produto/empresa, 8.194 itens) |
|---|---|---|---|---|
| VRCUSTO | contábil VRCUSTOFINALC (ou VRCUSTOREAL/FATOR) | **3 chaves** | `:7178-7182`, `:7507-7510` | chave S: 94,3%; chave N: fica o antigo (581/585 quando o processado diferia) |
| VRCUSTOREAL | CUSTO_REAL_UNIT ou TEMPVRCUSTO | 3 chaves | `:7184-7187` | S 96,5% / N 11% |
| VRCUSTOREP | NF_PROD.VRCUSTOREP ou TEMPVRCUSTOREP | 3 chaves | `:7189-7192` | S 94,4% / N 11% |
| VRCUSTOFISCAL | NF_PROD.VRCUSTO | sempre | `:7514` | 99,2–99,7% |
| ICMST | VRICMST / (QUANTIDADE×FATOREMBAL) | sempre | `:7515` | 99,2–99,9% (difere do histórico quando STREAL≠VRICMST: prevalece VRICMST, 45×3) |
| VRFCPST | FCP_VALOR_ST / qtde | sempre | `:7516` | 99,9–100% |
| SEGURO / FRETE / IPI / FRETE2 | NF_PROD (%) | sempre | `:7517-7518`, `:7525-7526` | 99,7–100% |
| MARKUP | NF_PROD.MARKUP | `TRAVAR ALTERACAO MARKUP NF`<>'SIM' (ConfigDB.xml) | `:7520-7521` | 100%; as 7 mudanças persistiram → trava desligada |
| ICME | TEMPICMEEFETIVO | sempre | `:7523` | 97,3–99,8% |
| DESPACESSORIO | DEPSACESS / qtde | sempre | `:7524` | 99,8–99,9% |
| MARGEML / MARGEML2 | MARKUPL / MARKUPL2 | sempre | `:7527`, `:7541` | 100 / 96,9–99,6% |
| CREDITOICM / CREDITOPISCOFINS | TEMP | sempre | `:7528-7529` | 99,9–100% |
| DEBITOICM, DEBITOPISCOFINS, VENDALIQ, LUCROBRUTOV/P, DESPOPV, LUCROLIQV/P, IMPREND, CONTSOCIAL, MARGEML2V | NF_PROD | sempre | `:7530-7540` | 96,9–100% |
| VRCUSTOCSI / PMZ / VRVENDASUG | NF_PROD ou TEMP se 0 | sempre | `:7544-7565` | 97–99,6%; CSI muda com chave N em 404/404 |
| BONIFICACAO | 0 se CFOP do item x910; NF_PROD senão; **não mexe** se CFOP do cabeçalho x910 | `:7554-7560` | 100% |
| VRVENDA | 0 se nulo (o preço em si: §2.5) | `:7568-7569` | — |
| VRCUSTOAJUSTE | VRCUSTOAJUSTENF / qtde | sempre | `:7571` | 100% (=0) |
| ATIVO | 'S' | só transferência com config (§2.6) | `:7208-7212` | — |
Depois: `Locate` da empresa, QTDESTOQUE/QTDDEPOSITO (campos de cálculo), DECOMPOSICAO/COMPOSICAO lidos, `SetaNull` (FuncoesApollo, fora do fonte) e
`ApplyUpdates` de MULTI_PRECO e PRODUTOS (`:7579-7601`). Cada registro do `cdsProdutos` é a mesma linha de MULTI_PRECO (o LEFT JOIN com CODAUXILIAR/CLAVEGOS
pode duplicar — grava 2× a mesma chave, inócuo).

**Triggers Oracle disparados pelo UPDATE do MULTI_PRECO** (lidos em `all_source`):
- `ATUALIZAPROD` (BEFORE): `DTULTIMALTERACAO := now` sempre; se VRVENDA/VRPROMO/PROMOCAO/ATACAREJO_ATIVO mudou → `DTULTPRECOALTERADO := now`, `ETQ_IMPRESSA := 'N'`.
  (O fonte nunca seta DTULTPRECOALTERADO/ETQ_IMPRESSA — vem daqui.)
- `UPDATE_CUSTO_MULTI_PRECO` (AFTER): HISTORICO_DINAMICO para VRCUSTO ('Alteracao do Valor de Custo'), VRCUSTOREP ('Alteracao do Valor de Custo de Reposicao'),
  VRPROMO, VRVENDA ('Alteracao do Valor de Venda'), valores com ponto, operador = CLIENT_IDENTIFIER/CODUSUALT/PRODUTOS.USULTALTERACAO. Só dispara se o valor
  **armazenado** (escala 4) mudou.
- `REM_MULTI_PRECO`: REMESSA_SERVER (carga de PDV) quando VRVENDA/VRPROMO/PROMOCAO/VRCUSTO/MARGEM_COMISSAO/VRCUSTOREP/ATIVO mudam.
- `COMPOSICAO_PROD` (PARAMETRO.ATUCOMPOSICAO/CAMPOCOMPOSICAO → COMPOSICAO.VALOR) e `COMPOSICAO_PROD_KIT` (kit 'K'); `ATUALIZATRIBUTOS` (IDPISCOFINS/TIPOPIS/…,
  não tocados aqui); `AUDIT_MULTI_PRECO`.

**Histórico dinâmico da aplicação** (`SetaHistoricoMultiPreco`, `udmNF:7155-7169`, chamado em `:7197-7204` se OldValue≠Value):
fonte = 'Processamento da NF Nro: '+NRONF para VRCUSTO, VRCUSTOREAL, VRCUSTOREP (e ATIVO 'N'→'S').
⚠️ BINÁRIO NOVO: em produção só aparecem **VRCUSTO com `'NF de Entrada'`** (valor com vírgula e sem arredondar, ex. `5,152987`; ago–set 7.521 ≈ 7.313 itens
com chave S e custo diferente + 60 transferências) e **VRCUSTOREAL com `'Processamento da NF Nro: <NRONF>'`** (4.416 ≈ 4.436 esperados); VRCUSTOREP só pelo trigger.
A data dessas linhas é `Now()` do cliente (na amostra 22 s atrás do servidor), a do trigger é `CURRENT_TIMESTAMP` do servidor.

### 2.5 Preço de venda (só se `ALTERAPRECO` do item, `udmNF:7363-7503`)
- `vAtualizarGrupoPreco` = produto tem grupo de preço E `ENTRADA_ATUALIZAR_PRECO_GRUPO='S'` (`:7359-7360`) — em produção 'N'.
- **On-line, Individual** (`:7373-7388`): `cdsProdutosVRVENDA := NF_PROD.VRVENDA` (só a empresa da nota); se grupo+config: `UPDATE MULTI_PRECO SET VRVENDA` para todo o
  grupo na empresa + `TAtualizacaoPrecoFilho.AtualizaPrecoFilho` (`UAtualizacaoPrecoFilho:75-185`: filhos com DIF≠0 e TPDIF preenchido recebem VRCUSTO/VRCUSTOREP/VRVENDA do pai,
  histórico 'Alteração de preço do produto pai').
- **On-line, Sincronizar** (`:7389-7416`): para cada empresa de `vListaEmpresas`, se **nem a empresa da nota nem a empresa i** têm promoção acumulativa
  (`PromocaoAcumulativa`, FuncoesApollo — fora do fonte): `UPDATE MULTI_PRECO SET VRVENDA` (produto, ou grupo se config) + `AtualizaPrecoFilho` da empresa i.
- **Lote, Individual** (`:7423-7457`): se sem promoção acumulativa na empresa: `GeraLote` = true, ou só se o preço mudou quando `GERA_LOTE_PROD_ALTERADO='S'`
  (compara com 2 casas); `INSERT INTO LOTEPRECO (CODLOTEPRECO=ID_CODLOTEPRECO.NEXTVAL, IDPRODUTO, VRVENDA (4 casas), DATALOTE=SYSDATE, PROCESSADO='N',
  OBS='REFERENTE A NOTA FISCAL DE NRO. '+NRONF, CODEMPRESA)` para o produto — **ou para todo o grupo de preço, sem olhar a config de grupo** (`:7447-7449`) —
  e `GeraLoteFilhos` → `TAtualizacaoPrecoFilho.GeraLoteFilho` para cada produto do grupo (`:6783-6799`; `UAtualizacaoPrecoFilho:224-261, 306-320`: LOTEPRECO do filho com
  'REFERENTE A ALTERAÇÃO DE PREÇO DO PRODUTO PAI' se o preço calculado difere).
- **Lote, Sincronizar** (`:7458-7500`): o mesmo, uma vez por empresa de `vListaEmpresas`, com o gate de promoção da empresa da nota e da empresa i.
- Histórico do VRVENDA (só On-line, `:7644-7697`): HISTORICO_DINAMICO 'Processamento da NF Nro: '+NRONF, anterior de `vQryMultiPrecoAnt`; sincronizar → uma linha por empresa.
- Nenhum (`tpaNenhum`): não mexe no preço.
- Produção: online bloqueado (config), 0 online desde 2023; lote 144 itens em 2023, 4 em 2025, 29 em 2026; LOTEPRECO da NF: 16 (2020), 168 (2023), 10 (2025), **0 (2026)**.
  O caso de out/2025 (NF 2338897): 5 lotes (empresas 1, 2, 50, 51, 52) por reprocessamento, produto com preço igual pulado (GERA_LOTE_PROD_ALTERADO).
  Colunas gravadas no LOTEPRECO real: ORIGEM NULL, CODOPERADOR=1 (não está no INSERT do fonte — binário novo ou default não visível; DEFAULT da coluna só em PERMITEALTERACAO='N').

### 2.6 Transferência (`CFOP.PROC_TRANSF='S'`, `udmNF:7606-7620`)
`AlteraMultiPreco(custo = ALTERA_CUSTO_PRODUTO_TRANSFERENCIA_PROCESSAR_NF='S', ativa = ATIVA_PRODUTO_TRANSFERENCIA_PROCESSAR_NF='S' e ATIVO='N')` — só VRCUSTO/REAL/REP
(+ATIVO); PRODUTOS não é tocado. Config: global N, **Modulo Retaguarda S** (custo); ativa N.
⚠️ Dado: 2026, **231 itens de transferência com custo processado diferente do anterior e 0 com histórico de custo** (±5 min) — o custo não mudou; FATORCX idem. Não determinado
por quê (a específica de módulo vale para CODFOR); o dado vivo diz: transferência não altera custo. Transferências são 1152 na empresa 2 (126) e 1 (5).

### 2.7 Devolução (CFOP.DEVOLUCAO='S' e não transferência)
Só o par no histórico; nenhum efeito em MULTI_PRECO/PRODUTOS (a condição `:7334` exclui e não há outro ramo).

### 2.8 Ramos mortos/dormentes
- **Decomposição "antiga estrutura"** (`:7624-7640`): edita `cdsMultiPreco_decomp` (aninhado em `cdsProdutos`, `dfm:15856-15858`) **depois** do `cdsProdutos.ApplyUpdates` (`:7600`/`:7619`)
  e o dataset é fechado no próximo item (`:7270`) → as edições nunca são aplicadas. Não portar.
- **Produto acabado de receita** (`:7028-7151`, chamado em `:7194-7195` se `ATUALIZAR_VALORCUSTO_PRODUTOACABADO='S'`): recalcula o custo do produto acabado pela RECEITA_PROD
  e grava VRCUSTOREAL=VRCUSTO=VRCUSTOREP. Config 'N' em produção (sem específicas). Bug latente: `'SELECT CODEMPRESA FROM EMPRESAS  AND CODEMRPESA = …'` (`:7117`) é SQL inválido
  no modo Individual → abortaria o processamento.
- **AtualizaPrecoFilho on-line**: dormente (on-line bloqueado; `precificacao-custo.service.ts:21-26` já registra 0 filhos com diferença).

### 2.9 As contas que o processamento refaz (`CalcValorNota`/`CalcValorCusto`, chamadas em `udmNF:7283`)
- QTDETOTAL = QUANTIDADE×FATOREMBAL (FATOR 0→1; CFOP do cabeçalho x929 → só QUANTIDADE) (`:3946-3954`).
- VRCUSTOFINAL = (VRCUSTOREAL − VRCUSTOREAL×DESCONTOR/100)/FATOR; **VRCUSTOFINALC** = (VRCUSTO − VRCUSTO×DESCONTO/100)/FATOR (`:3982-3989`).
- **TEMPICMEEFETIVO** = round2(ICME/100×BCR) (`:4213`), zerado se `APROVEITAMENTO_CREDITO_ICMSST_NF`<>'S' (produção 'N') e CFOP(item) x401/x403/x933/x556, ou x101/x102 com CST 40/90,
  ou 1910/2910 com alíquota não 'T' (`:4231-4261`). Acordo 100%.
- `CalcValorCusto` (`:3773-3926`, empresa **logada**): ICME crédito = round2(TEMPICMEEFETIVO×VRCUSTOFINAL/100) se alíquota 'T' e não SN; PIS = round2((ALIQPISE+ALIQCOFINSE)×VRCUSTOFINAL/100)
  se LR e ALIQPISE>0 (`:3808-3826`); ST = VRICMST se STREAL=0 senão STREAL; **TEMPVRCUSTO** (real) = round2(VRCUSTOFINAL + (DEPSACESS+VRSEGURO+VRFRETE+VRIPI+VRIPI_DEV+VROUTRASDESP+ST+FCPST
  +DESPEXTRAP+VRCUSTOAJUSTENF)/QTDETOTAL + DESPFEDERATIVAS%×VRCUSTOFINAL + FRETE2%×VRCUSTOFINAL − PIS − ICME) (`:3858-3874`); **TEMPVRCUSTOREP** = mesma soma − BONIFICACAO, sem créditos
  (`:3877-3892`, `:3911`); **TEMPVRCUSTOCSI** = REP − créditos (`:3912`); **TEMPPMZ** = TEMPVRCUSTO/(100 − (ALIQPISS+ALIQCOFINSS+ICMS se 'T'+DESPOPERACIONAL))×100 (`:3907-3915`);
  **TEMPVRVENDASUG** = round2(TMargemPreco(empresa, produto, TEMPVRCUSTO; custo de reposição se TIPO_PRECIFICACAO D/M).CalculaValorVenda(MARKUP)) (`:3898-3921`).
- Reprodução com o dado (13.301 itens, VRSEGURO=0, IPI pelo IPI_NOTA, DESPFEDERATIVAS vazia): TEMPVRCUSTO = histórico.VRCUSTOREAL **99,3%**; REP **98,6%**; CSI **97,8%**;
  CREDITOICM **100%**; CREDITOPISCOFINS **99,99%**. Como o item já chega "analisado" (grupo C do `uNF-item-colunas.md`), os gravados NF_PROD só são zero em 198 itens (CUSTO_REAL_UNIT, todos transferência).

### 2.10 Fechamento (`udmNF:7706-7888`)
`NF.PROC='S'`, `DTPROCESSAMENTO=Now` (`:7706-7708`) → `cdsNota.ApplyUpdates` (NF + itens) → trigger `ESTOQUE_NOTAS` move estoque → **commit** (`:7738-7740`).
Depois do commit (fora da transação): `SetaOperadorAlteracao(NF)` (`:7742`), entrada com chave: `RegistrarProcessoNotaFiscal(stProcessarFaturar)` e, se houver faturamento liberado,
`stGerarFinanceiro` (`:7749-7770`, `:4970`); acordo comercial, retenções, FunRural, financeiro automático, caixa (`:7772-7776`); integração contábil se AUTOMATICA e entrada
(`:7778-7789`); `AtualizaCestNcm` (`:7791`, `:11972-12055`, só com `ATUALIZAR_NCMCEST_PRODUTO_XMLNFE='S'` — produção 'N'); LOG de NF/NF_PROD/FATURAMENTO/CODCONTABILNF (`:7793-7873`).
Erro → rollback de tudo e re-raise (`:7881-7888`).

### 2.11 Depois da tela — `SetaSTReal` (`uNF:16084-16128`)
Entrada, item com STREAL>0: `UPDATE MULTI_PRECO SET ICMST = STREAL/(QTD×FATOR)` na empresa da nota. ⚠️ Não observado: nos 95 itens de ago–set com STREAL>0 e ≠ VRICMST, o ICMST seguinte
é VRICMST/qtde em 45 e STREAL/qtde em 3 (47 outros). Seguir o dado: ICMST = VRICMST/qtde.

---

## 3. Configurações lidas (produção)

`CONFIGURACOES` (VALOR global) + `CONFIGURACOES_ESPECIFICAS` (ID = CONFIGURACOES.ID; TIPO Modulo/Empresa/Grupo/Usuario). A precedência do `TSessao.ValorConfiguracao` não está
no fonte; o dado (CODFOR 925/926) confirma que a específica **Modulo 'Retaguarda'** vale no processamento. ⚠️ Apollo: `ConfigService.resolver` só aplica Modulo se `ctx.modulo`
for passado (`config.service.ts:34-47`); `configNaTrx(..., { modulo: 'Retaguarda' })` já existe (`compras/pedido-heranca.ts:105`).

| código | global | específicas | efetivo no Retaguarda | onde |
|---|---|---|---|---|
| BLOQUEAR_ATUALIZA_PRECO_ONLINE_NF | N | Modulo Retaguarda=S | **S** (on-line desabilitado) | `uEstoqueNF:1753` |
| GERA_LOTE_PROD_ALTERADO | S | Modulo=S, Empresa 1=S | S | `udmNF:7428`, `:7468` |
| ENTRADA_ATUALIZAR_PRECO_GRUPO | N | — | N | `udmNF:7360`, `:7376`, `:7400` |
| ATUALIZA_FORNEC_PRODUTO_PROCESSAR_NF | N | Modulo=S | **S** (dado 925/926) | `udmNF:7340` |
| ALTERA_CUSTO_PRODUTO_TRANSFERENCIA_PROCESSAR_NF | N | Modulo=S | S pela config, **mas o dado mostra N** (0/231) | `udmNF:7612` |
| ATIVA_PRODUTO_TRANSFERENCIA_PROCESSAR_NF | N | — | N | `udmNF:7613` |
| ATUALIZAR_VALORCUSTO_PRODUTOACABADO | N | — | N | `udmNF:7194` |
| TIPO_PRECIFICACAO | P | Modulo=P | P | `udmNF:3904` |
| APROVEITAMENTO_CREDITO_ICMSST_NF | N | — | N (zeragens do ICME valem) | `udmNF:4231` |
| PROCESSAR_NOTA_MOSTRAR_COLUNA_DEPOSITO | S | — | S | `uEstoqueNF:1760` |
| TIPO_ESTOQUE | A | Empresa 1=L | 1: L; demais: A | `uEstoqueNF:1844-1856` |
| TIPO_ESTOQUE_PADRAO | L | Empresa 1=L | L (loja) | `uEstoqueNF:1846-1847` |
| PERMITE_EDICAO_PROC_ESTOQUE | S | Modulo=N | **N** (colunas de estoque travadas) | `uEstoqueNF:1974` |
| PERMITE_PROC_NF_ESTOQUE_NEG | S | — | S | `udmNF:11643`, `uEstoqueNF:1152`, `:1958` |
| PERMITE_EXCLUIR_FINANCEIRO_DA_NF | S | — | S | `uEstoqueNF:1000`, `:1783` |
| USUARIOS_PROCESSAM_NF_SERV_ACIMA_VALORFIXO | S | — | S | `uEstoqueNF:631` |
| ALTERA_ESTOQUE_REVERSAO_NF | S | — | S | `uNF:8969`, `:9030` |
| ATUALIZAR_NCMCEST_PRODUTO_XMLNFE | N | — | N | `udmNF:11980` |
| VALIDA_CFOP_SITUACAO_NF_SAIDA | N | — | N | `uNF:14921` |
| EMPRESAS.PRECONF | O (todas) | | On-line por default (mas bloqueado) | `uEstoqueNF:1751` |
| EMPRESAS.SINCRONIZA_PRECO_NF | S (todas) | | Sincronizar empresas | `uEstoqueNF:1764` |
| EMPRESAS.ATUDCOMPOSICAO | NULL | | `<>'N'` → ramo morto habilitado | `udmNF:7626` |
| EMPRESAS.CLASSFISCAL / DESPOPERACIONAL / DESPFEDERATIVAS | LR (50 = SN) / 20 (50 = NULL) / NULL | | usados no TEMP | `udmNF:3808`, `:3868`, `:3907` |
| CFOP.ATUALIZA_VENDA_NF | N em todos os CFOPs usados | | ALTERAPRECO desmarcado | `uEstoqueNF:1835` |
| CFOP.ALTERA_CUSTO_NF | S, exceto 1407/1910/1949/2910 (N) | | chave de custo | `dfm:2617` |
| CFOP.PROC_QTDE | N em 1556/2556/1949/1933/1407/1653/2933/1253/2407/2949/2551/1551 | | não move estoque | `uEstoqueNF:1840` |
| ConfigDB.xml (arquivo LOCAL por estação, `udmConfigura:291-296`): `PREÇO CUSTO NF` | não está no banco | | inferido 'CUSTO CONTABIL'/vazio (100%) | `udmConfigura:367` |
| ConfigDB.xml: `TRAVAR ALTERACAO MARKUP NF` | idem | | inferido ≠ 'SIM' | `udmConfigura:363` |
| ConfigDB.xml: `BLOQUEIA SINCRONIZACAO VALOR DE VENDA` | idem | | inferido ≠ 'SIM' (lote em 5 empresas) | `udmConfigura:399` |
| ConfigDB.xml: `BLOQUEAR PRECIFICAO NA NF` | idem | | não determinado (29 itens marcados em 2026 → coluna visível em alguma estação) | `udmConfigura:472` |

---

## 4. Verificação na produção (2026) — resumo dos números
- HISTORICO_PROCESSAMENTO_NF por mês (PRODUTO = PROCESSAMENTO, NFs): jan 6.504/686 · fev 7.101/721 · mar 7.805/821 · abr 7.147/753 · mai 7.868/719 · jun 7.244/751 ·
  jul 8.134/821 · ago 6.966/705 · set (até 25) 6.392/648.
- Cobertura: 6.581/6.581 NFs de entrada processadas; 61.741/61.741 itens; 0/733 saídas.
- Fórmulas do PROCESSAMENTO: §2.3 (99,9–100% em todas as colunas).
- O que chega ao MULTI_PRECO (retrato seguinte, mesmo produto/empresa, 8.194 itens de entrada normal): §2.4 — campos "sempre" 97–100% com ou sem chave; custo 94–97% com chave e ~11% sem.
- Precisão do VRCUSTO gravado: o histórico 'NF de Entrada' mostra o valor sem arredondar (6–9 casas); a coluna é NUMBER(15,4). Nos itens com >2 casas, o retrato seguinte mostra
  2 casas em 2.159 e 4 casas em 1.220 (mesmo dentro da mesma NF) — **não determinado** (provável diferença de versão do executável por estação). Recomendação: gravar com 4 casas.
- PRODUTOS: CODFOR 925/926 atualizado; FATORCX 0/576; PIS 1.672/1.672; DTULTIMALTERACAO 1.672/1.672.
- Transferência: 0/231 com custo alterado. Devolução: nenhum item de entrada com CFOP.DEVOLUCAO='S' processado em 2026.
- Preço: 0 LOTEPRECO de NF em 2026; online 0 desde 2023.

---

## 5. Apollo — o que existe, o que falta, cortes

### 5.1 O que existe e se reaproveita
| peça | onde | uso no porte |
|---|---|---|
| Transação do processar (trava a NF, reconcilia, move estoque com o gate `geraestoque='S' AND movimenta_estoque='S'`, flip CAS, caixa, financeiro, LOG, esteira) | `cadastro/nf-processamento.service.ts:147-244`, `:302-381` (gate `:327`) | ponto de inserção: dentro de `mover`, modo 'processar' — flags do item **antes** de `aplicarMovimentoItens` (`:201`); produto (entrada) na mesma trx |
| Tabela HISTORICO_PROCESSAMENTO_NF (56 colunas, seq, índices) e a consulta do par | mig `291_historico_processamento_nf.sql:35-108`; `precificacao/hist-proc-nf.service.ts:40-122` | só falta o escritor (`idempresa` extra do Apollo: preencher) |
| Escada de custo/margem do produto (TMargemPreco) | `precificacao/precificacao-custo.service.ts:153-170` (bases), `:173-235` (calcular), `preco-fiscal.service.ts:74` (precoAtual), `:193` (pmz) | base para o `CalcValorCusto` do item — com as diferenças do grupo C (base REAL, PMZ do diálogo, componentes em VALOR/qtde, DESPFEDERATIVAS, FRETE2, VRCUSTOAJUSTENF, DESPEXTRA) e **sem** o `exigirPermissaoEmpresa` (`:107`, chamado em `:176`) |
| Lote de preço e lote dos filhos | tabela `lote_preco` (mig 127:16-39), `precificacao/lote-filho.ts:32-66` (`gerarLotesFilhos`), `precificacao-nf.service.ts:336-376` (`aplicar`) | ramo "Gerar lote" |
| Filhos on-line | `precificacao-custo.service.ts:27-50` (`atualizarFilhosOnline`) | ramo on-line |
| Gate de promoção acumulativa | `precificacao-custo.service.ts:284-291` (SQL da vigência por loja/produto/grupo) | extrair função e usar no preço |
| Trigger ATUALIZAPROD (DTULTPRECOALTERADO/ETQ_IMPRESSA) | mig `127_ajuste_precos.sql:56-68` | já cobre o UPDATE do preço; **não** seta `multi_preco.dtultimalteracao` (a coluna existe hoje no destino) |
| Propagação PRODUTOS → filhos (UPDATE_PRODUTOS_FILHOS) | mig `132_produtos_filhos_propagacao.sql:40-157` | cobre o efeito da troca de CODFOR |
| HISTORICO_DINAMICO | mig `009_historico_dinamico.sql`; `shared/crud/historico.ts` | textos 'NF de Entrada' / 'Processamento da NF Nro: X' e os do trigger |
| Config com módulo | `compras/pedido-heranca.ts:105` (`configNaTrx`) | ler as específicas Modulo Retaguarda |
| Retrato do produto no item (ULTCUSTO/ULTCUSTOREP/ULTVENDA/MARKUP/VRCUSTOREAL/IDPISCOFINS) | `cadastro/nf.aggregate.ts:51-80` | a próxima NF depende do MULTI_PRECO atualizado aqui |

### 5.2 O que falta (e o impacto hoje)
- **Nenhum** efeito de produto no processar do Apollo (confirmado: `nf-processamento.service.ts` inteiro, 382 linhas). NF processada no Apollo não atualiza custo/CSI/PMZ/ICME/margens
  do MULTI_PRECO → a Precificação NF lê os componentes do MULTI_PRECO (`precificacao-nf.service.ts:139-143`) e a próxima NF tira o retrato dele (`nf.aggregate.ts:64`) → margens e
  custos velhos em cadeia; o CMV (`vl_custo` = MULTI_PRECO.VRCUSTO, `nf.aggregate.ts:515-547`, select em `:530`) fica congelado.
- **Flags do item**: o Apollo não deriva GERAESTOQUE/MOVIMENTA_ESTOQUE do `CFOP(item).PROC_QTDE`; a importação grava 'S' fixo (`compras/nfe-item-importacao.ts:135-136`,
  `compras/recebimento.service.ts:144-145`) → NF de uso/consumo/serviço entraria no estoque (2.856 itens em 2026). USOCONSUMO nunca é gravado. ORIGEM_ESTOQUE: o legado grava 'E';
  o Apollo grava a origem do produto na importação — **o SPED do Apollo usa `origem_estoque[0]`** (achado do `uNF-item-colunas.md`): corrigir o SPED antes de gravar 'E'.
- **Métricas do item** (CUSTO_REAL_UNIT, VRCUSTOREP, VRCUSTOCSI, PMZ, VRVENDASUG, MARKUPL2…): corte 4 do `uNF-item-colunas.md` ainda ⏳. Para NF criada no Apollo elas são 0 (DEFAULT, mig 351),
  então o porte precisa do fallback TEMP (a porta de `CalcValorCusto`) — sem ela o processamento gravaria 0 no MULTI_PRECO.
- **Opções da tela** (ALTERAPRECO/ALTERACUSTO por item, On-line/Lote/Nenhum, Individual/Sincronizar, colunas de estoque): o `POST /fiscal/nf/:id/processar` não recebe corpo
  (`nf-processamento.controller.ts:16-22`) e a web chama sem corpo (`web/src/features/nf/nfProcessamentoApi.ts:31-33`).
- **Equivalentes de trigger**: UPDATE_CUSTO_MULTI_PRECO (histórico de VRCUSTO/VRCUSTOREP/VRPROMO/VRVENDA) não existe no Apollo; REM_MULTI_PRECO (REMESSA_SERVER) e
  COMPOSICAO_PROD (tabela PARAMETRO) não têm destino; AUDIT_MULTI_PRECO/AUDIT_PRODUTOS também não.

### 5.3 Esquema de destino (`tools/cutover/schema-destino.json`)
Todas as colunas usadas existem: `multi_preco` (101 col., inclui vrcustofiscal, vrcustoajuste, creditoicm…, dtultprecoalterado, etq_impressa, dtultimalteracao, codusualt),
`historico_processamento_nf` (56 = as 54 do Oracle + idempresa, dtcadastro), `lote_preco`, `historico_dinamico`, `produtos` (fatorcx, codfor, usultalteracao, pis, uso_consumo,
receitaqtde/receitafator, idproduto_pai, dif/tpdif…), `nf_prod` (usoconsumo, geraestoque, movimenta_estoque, origem_estoque, custo_real_unit, vrcustoajustenf, atualiza_multipreco_decomp,
markupl/markupl2, fcp_valor_st, estoqueretiradatroca, codoperador_lib_estoqueneg…), `cfop` (altera_custo_nf, atualiza_venda_nf, proc_transf, devolucao, proc_qtde),
`empresas` (preconf, sincroniza_preco_nf, atudcomposicao, despfederativas, despoperacional, classfiscal, alqsimplesnac), `receita_prod`, `decomposicao`, `composicao`.
**Ausentes**: `remessa_server`, `parametro`, `audit_multi_preco`, `audit_produtos`, `clavegos`.
Atenção de precisão: `historico_processamento_nf.vrcusto` é numeric(15,4) na mig 291; o Oracle guarda até 6 casas no PROCESSAMENTO.

### 5.4 Cortes propostos (do menor para o maior risco)

**Corte 1 — `custoDoItemNaEntrada()` puro (zero gravação).** Porta de `CalcValorNota` (entrada) + `CalcValorCusto`: QTDETOTAL, VRCUSTOFINAL, VRCUSTOFINALC, TEMPICMEEFETIVO (com as
zeragens), TEMPCREDITOICM/PIS, TEMPVRCUSTO, TEMPVRCUSTOREP, TEMPVRCUSTOCSI, TEMPPMZ, TEMPVRVENDASUG (reusando `fiscal.precoAtual`/TMargemPreco). Teste de ouro: `hist_ago_set.csv`
(meta ≥ 99% em REAL/REP/CSI/créditos, já medidos 99,3/98,6/97,8/100/99,99%). Também serve ao corte 4 do `uNF-item-colunas.md`. Escreve: nada.

**Corte 2 — Par no HISTORICO_PROCESSAMENTO_NF (entrada, todo item com MULTI_PRECO na empresa).** Escreve `historico_processamento_nf`: linha PRODUTO (MULTI_PRECO+PRODUTOS.FATORCX/CODFOR,
antes de qualquer update) e PROCESSAMENTO (tabela §2.3, com fallback TEMP do corte 1; flags ALTERACUSTO*/ALTERAVENDA*/EXISTE*), `idempresa` = da nota, `dthistorico` do servidor
(+1 s no PROCESSAMENTO). Auditoria pura; a tela `hist-proc-nf` passa a mostrar as NFs do Apollo. Risco ≈ 0.

**Corte 3 — Flags do item no processar (todas as notas).** Escreve `nf_prod`: `geraestoque`/`movimenta_estoque` = `CFOP(item).PROC_QTDE` (troca: `ESTOQUERETIRADATROCA`),
`origem_estoque` ('E'; 'D'/'P' quando houver depósito/produção — com o SPED corrigido antes), `usoconsumo` = `produtos.uso_consumo` (NULL se o item estava NULL e o produto 'N', para ficar
igual ao legado). Tem de rodar **antes** de `aplicarMovimentoItens`. Muda estoque (para certo): deixa de somar compras de uso/consumo/serviço. Opção do operador (colunas de estoque)
fica travada como na produção (`PERMITE_EDICAO_PROC_ESTOQUE`=N no Retaguarda). Risco baixo-médio.

**Corte 4 — MULTI_PRECO "sempre" (entrada normal = CFOP não transferência e não devolução).** Escreve `multi_preco` (empresa da nota): vrcustofiscal, icmst (VRICMST/qtde), vrfcpst, seguro,
frete, markup (sem a trava local), icme, despacessorio, ipi, frete2, margeml, creditoicm, creditopiscofins, debitoicm, debitopiscofins, vendaliq, lucrobrutov, lucrobrutop, despopv,
lucroliqv, lucroliqp, imprend, contsocial, margeml2v, margeml2, vrcustocsi, pmz, vrvendasug, bonificacao (regra x910), vrcustoajuste, `dtultimalteracao`; e `produtos`: pis,
dtultimalteracao, usultalteracao. Não mexe em custo nem preço — mexe em margens/PMZ que a Precificação NF e os relatórios leem. Risco médio-baixo.

**Corte 5 — Custo e fornecedor.** Escreve `multi_preco.vrcusto` (VRCUSTOFINALC, 4 casas), `vrcustoreal` (CUSTO_REAL_UNIT/TEMP), `vrcustorep` (NF_PROD/TEMP) só com as 3 chaves
(ALTERACUSTO do item — default entrada —, `nf_prod.atualiza_multipreco_decomp='S'`, `cfop(item).altera_custo_nf='S'`); `historico_dinamico`: VRCUSTO 'NF de Entrada', VRCUSTOREAL
'Processamento da NF Nro: <NRONF>', e as linhas do trigger UPDATE_CUSTO_MULTI_PRECO ('Alteracao do Valor de Custo', '…de Custo de Reposicao', só se o valor armazenado muda);
`produtos.codfor` = parceiro com `ATUALIZA_FORNEC_PRODUTO_PROCESSAR_NF` (Modulo Retaguarda = S). **Não** gravar `produtos.fatorcx` (dado: não acontece). Muda CMV, retrato da próxima NF e
precificação. Risco alto — conferir contra o histórico da produção item a item.

**Corte 6 — Preço de venda.** DTO no processar (ALTERAPRECO por item + modo On-line/Lote/Nenhum + Individual/Sincronizar), defaults do FormShow (§1.2) e as travas de config
(BLOQUEAR_ATUALIZA_PRECO_ONLINE_NF → só Lote no cliente). 6a **Lote** (produção): `lote_preco` com OBS 'REFERENTE A NOTA FISCAL DE NRO. X', uma por empresa no Sincronizar, grupo de preço
inteiro quando o produto tem grupo, GERA_LOTE_PROD_ALTERADO, gate de promoção acumulativa (empresa da nota e alvo), `gerarLotesFilhos` por produto do grupo. Só enfileira — risco baixo.
6b **On-line** (bloqueado no cliente): `multi_preco.vrvenda` (empresa ou todas), grupo com ENTRADA_ATUALIZAR_PRECO_GRUPO, `atualizarFilhosOnline`, `historico_dinamico` 'Processamento da NF Nro: X'.
Risco médio (muda preço; dispara etiqueta pelo trigger ATUALIZAPROD).

**Corte 7 — Ramos de config/dormentes.** Transferência (`ALTERA_CUSTO_PRODUTO_TRANSFERENCIA_PROCESSAR_NF`/`ATIVA_PRODUTO_TRANSFERENCIA_PROCESSAR_NF` — implementar ligável, mas o dado diz
que hoje **não** altera: decidir com o usuário); produto acabado de receita (config N; corrigir o SQL do `:7117`); **não portar** a decomposição antiga (`:7624-7640`, nunca aplicada) nem o
`SetaSTReal` (não observado). Risco: depende da decisão.

Reverter (qualquer corte): **não desfazer** nada de produto/histórico/lote — como o legado; reprocessar grava de novo.

---

## 6. Não determinado / riscos
- `GetEmpresas`, `PromocaoAcumulativa`, `SetaNull`, `TSessao.ValorConfiguracao` e `SetaHistorico_Dinamico` com Data = Now do cliente estão em FuncoesApollo/`sicom/util` (fora do fonte).
  O dado mostra 5 empresas no lote sincronizado.
- Por que transferência não altera custo (config Modulo=S) e por que FATORCX não é gravado: binário novo; seguir o dado.
- Arredondamento do VRCUSTO gravado (2 × 4 casas, 64%/36%): provavelmente versão do executável por estação.
- `CODOPERADOR=1` no LOTEPRECO de 2025 não sai do INSERT do fonte (`udmNF:7438-7449`).
- 4 itens de 2026 com GERAESTOQUE≠PROC_QTDE (6 'S' com PROC_QTDE N; 1 'N' com S): edições manuais antigas ou nota com requisição.

## Status (25/09/2026)

| Corte | Status |
|---|---|
| 1 — custo do item na entrada (porta pura de CalcValorNota/CalcValorCusto) | ✅ `nf-custo-item.ts` (teste-ouro 99,2%) |
| 2 — par no HISTORICO_PROCESSAMENTO_NF | ✅ `nf-produtos-processar.ts` (PRODUTO antes / PROCESSAMENTO da nota, com os TEMP de fallback) |
| 3 — flags do item no processar | ✅ GERAESTOQUE/MOVIMENTA_ESTOQUE = PROC_QTDE do CFOP do item, ORIGEM_ESTOQUE 'E', USOCONSUMO do produto (`flagsDoItemNoProcessar`); a importação não decide mais (e o SPED não usa ORIGEM_ESTOQUE). Mig 353: PROC_QTDE da semente com o valor da produção. Smoke §241. Falta: troca (ESTOQUERETIRADATROCA) e depósito/produção (TIPO_ESTOQUE) |
| 4 — MULTI_PRECO "sempre" | ✅ custo fiscal, ST, FCP-ST, seguro, frete, markup, ICME efetivo, despesas, IPI, frete 2, créditos, débitos, escada, CSI, PMZ, venda sugerida, bonificação (regra x910), ajuste; PRODUTOS: PIS (só com o flag no item), alteração |
| 5 — custo e fornecedor | ✅ VRCUSTO contábil/VRCUSTOREAL/VRCUSTOREP com as 3 chaves; histórico 'NF de Entrada' e 'Processamento da NF Nro: X'; o gatilho UPDATE_CUSTO_MULTI_PRECO portado (mig 354, vale para toda tela); CODFOR com ATUALIZA_FORNEC_PRODUTO_PROCESSAR_NF (módulo Retaguarda). Smoke §243 |
| 6 — preço de venda (lote/on-line) + a tela de processar da entrada (`nf-preco-venda-processar.ts`, `GET /fiscal/nf/:id/processar/opcoes`, corpo do processar com `precos` e `semAlterarCusto`; mig 357 com as 3 configs) | ✅ smoke §251 |
| 7 — ramos de config (transferência: o dado diz que NÃO altera custo; seguir o dado) | ⏳ |
