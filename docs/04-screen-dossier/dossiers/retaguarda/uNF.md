# Dossiê de Tela — NOTA FISCAL (`uNF.pas` / `udmNF.pas`)

> **A tela-coroa do ERP.** `uNF.pas` = **18.262 linhas** (o maior arquivo do sistema); `udmNF.pas` (DataModule `TDMNF`) = 12.103 (onde vive **toda** a regra fiscal/NFe/financeira). Entidade `NF` = **209 colunas** / 23.404 linhas; `NF_PROD` = **193 colunas** / 252.411 linhas; ~40 tabelas no namespace `NF*`. É, de longe, o maior agregado e a maior carga de regra de negócio do Apollo.
>
> Síntese de 5 inspeções profundas isoladas (2026-06-29): (1) modelo de dados + Oracle, (2) fluxo/UI/ciclo de vida, (3) fiscal/impostos + reuso, (4) efeitos estoque/financeiro/contábil, (5) NFe/NFC-e/TEF. Procedência citada como `[arquivo:Lnnn]` / `[Oracle-dict]` / `[trigger:Lnnn]`.
>
> **Status:** `F1+F2 implementadas e verdes`. **F1** = núcleo cadastro, SEM efeitos. **F2** = cálculo fiscal por item de entrada (ICMS próprio + ICMS-ST clássico + IPI), REUSANDO o motor `precificacao` via `POST /fiscal/nf/recalcular` (puro — não grava). Recon (5+2 inspeções) + 4 auditorias adversariais. Auditoria F2 pegou e corrigiu um bug crítico (ICMS aplicava a redução de base 2× — `vricm` usava a alíquota efetiva; o correto é a **destacada** sobre a base já reduzida) + guarda de bonificação-sem-ST; ambos com regressão no smoke. Verde: shared build, api/web `tsc`, **API 123 testes**, **web 25 testes**, **smoke 82/0** (NF não move estoque; recalcular não grava; redução de base correta). F3..F6 (estoque/financeiro/contábil/SEFAZ) são fases dedicadas. **Nada pode dar errado** — efeitos e transmissão preservados aqui e desligados; o motor fiscal é reusado, não reinventado.

---

## 0. Decisão de arquitetura governante (o recorte)

A NF tem **dois eixos de estado ortogonais** persistidos e um corpo de **efeitos colaterais disparados por trigger Oracle**. Migrar errado a ordem/atomicidade desses efeitos produz **estoque ou título financeiro incorreto e silencioso** — o erro mais grave e mais difícil de reverter (o próprio legado **bloqueia** estorno quando há baixa). Por isso o complexo é **faseado**, e a **F1 não dispara nenhum efeito**:

- **F1 (núcleo cadastro):** digitar/armazenar **header `NF` + itens `NF_PROD` + config fiscal por item + status inicial** (`PROC='N'`, `STATUSNFE` vazio), parametrizada Entrada/Saída, com a **máquina de estados de bloqueio** (PROC/STATUSNFE/CONTABILIZADO travam edição). **Sem** mover estoque, gerar título, contabilizar ou transmitir.
- **F2 (fiscal por item):** persistir a verdade fiscal resolvida por item e **reusar o motor `precificacao`** (já portado) para recalcular; estender só o estritamente necessário (MVA ajustado, redução de BC, IPI, rateio).
- **F3 (processamento/estoque):** o flip `PROC 'N'→'S'` que move estoque (conecta ao Produto F5 deferido). **Perigoso** — verificação adversarial.
- **F4 (faturamento/financeiro):** condição de pagamento → parcelas → títulos `ARECEBER`/`APAGAR`.
- **F5 (contábil):** rateio `CODCONTABILNF` + integração `DIARIO`.
- **F6 (SEFAZ/NFe/NFC-e):** adaptador externo de transmissão (ACBr hoje; serviço dedicado no Apollo).

Princípio (igual a Parceiros/Produto): **a tela armazena config; o cálculo reusa o motor existente e vive a jusante**. Nenhuma regra é descartada — o que não entra na F1 está documentado aqui com procedência e SQL.

---

## 1. Identidade / herança

- **Classe:** `TfrmNF = class(TfrmCadMasterDetalhe)` `[uNF.pas:L88]`. Cadeia: `TfrmNF → TfrmCadMasterDetalhe → TfrmCadMasterDet → TfrmCadMaster → TfrmMaster` (o pilar CRUD genérico). → No Apollo mapeia ao pilar `CadMasterDet` (master + abas de detalhe), já usado em Parceiros/Produto.
- **Particularidade decisiva:** o `TfrmNF` **não usa o `cdsPrincipal` próprio**; no `FormCreate` cria um DataModule local `dmNF: TDMNF` e redireciona os DataSources `[uNF.pas:L11099-L11113]`: `dsNF←cdsNota` (header), `dsINF←cdsItensNota` (itens), mais `cdsFaturamento`/`cdsFinanceiroNF`/`cdsContabilNF`/`cdsNFReferencia`/`cdsPEDIDO_NF`/`cdsNF_Prod_Lote`. **Toda a regra pesada (cálculo fiscal, NFe/SEFAZ, financeiro) está em `udmNF`, não no form.** O form é UI + orquestração + validações de tela.
- **Entrada vs Saída é a MESMA tela, parametrizada** `[uNF.pas:L8043-8127]`: `ConfiguraNota(TpNota)` no `FormShow` com `dmPrincipal.ParametroCriacao`; **`TpNota=35 → TIPO='E'`** (entrada/compras), **outro (36) → `TIPO='S'`** (saída/vendas). Reflexos: `pnlControlesEntrada/Saida.Visible`, título, e **listas de MODELO diferentes** por tipo (saída 01/02/55; entrada 01/1B/03/04/06/07…/55/57). Campo persistido: `NF.TIPO`. → **F1 replica esse parâmetro** (rota/param Entrada|Saída).

---

## 2. UI — abas (`uNF.dfm`)

**Cabeçalho (sempre visível, `tbsMaster`):** `cbbModeloNota` (MODELO), `edtNumeNota` (NRONF), `edtSerie` (SERIE), `edtEmissao` (DTEMISSAO), `rgTipoEmissao` (TIPOEMISSAO 0=Própria/1=Terceiros), `edtCodParceiro` (CODPARCEIRO)+`dbtRazao`, `segCFOP`/`edtCFOP`, `cbbFinalidadeNota` (FINALIDADE), `cbbModalidadeFrete`, painéis Entrada/Saída.

`PageControl` interno `DadosNota` — 14 abas:

| # | Tab | Caption | Conteúdo | Fase |
|---|---|---|---|---|
| 1 | tsCalculoImpostos | "Cálculo de impostos" | botões NF-e (Importar/Imprimir/Inutilizar/Enviar/Cancelar/XML/CCe); sub-abas: impostos internos (totais), ST externo, ICMS interestadual/DIFAL/FCP, retenções, tributos devolvidos | F2/F6 |
| 2 | tsItensNota | "Itens da nota" | grid de itens (NroItem, Cód.barra, Produto, Qtde, UN, CST, Vlr unit/venda/total, Alíquota, Peso); add/del item via modal `TfrmItensNF` | **F1** |
| 3 | tabFinanceiro | "Financeiro [F9]" | faturas/duplicatas, formas de pagamento, documentos financeiros | F4 |
| 4 | tsNFsReferencia | "NF's Referência" | NFs referenciadas (devolução/complemento) | F1 (armazenar) |
| 5 | tsDadosGerais | "Dados Gerais / Obs" | observações, dados adicionais, combo CANCELADA | **F1** |
| 6 | tsTranspVolumes | "Transportadora e Volumes" | transportadora, placa, volumes, frete | **F1** |
| 7 | tsPedidos | "Pedidos" | pedidos vinculados | adiado |
| 8 | tsServicos | "Serviço" | dados de serviço/ISS | F2 |
| 9 | tbsLancPadrao | "Centro de custo [F7]" | integração contábil (SICOM/Tron) | F5 |
| 10 | tsClassificacaoAnimais | "Classificação de Animais" | módulo frigorífico (específico) | adiado |
| 11 | tsCartaCorrecao | "Carta Correção" | CCe | F6 |
| 12 | tsImportacao | "Importacao" | importação NFe/XML | F6 |
| 13 | tsDevCompra | "Devoluções da Compra" | devolução de compra | adiado |
| 14 | tsNFeAvulsa | "Dados NFe Avulsa" | NFe avulsa | adiado |

---

## 3. Ciclo de vida / máquina de estados (o coração da regra)

**DOIS eixos ortogonais persistidos em `NF`, independentes:**

### Eixo A — PROCESSAMENTO (interno: estoque/financeiro/contábil) — `NF.PROC CHAR(1)`
- `'N'` = não processada (digitação/edição livre). `'S'` = **processada** (estoque movimentado, financeiro gerado) — **estado-trava**.
- O flip `'N'→'S'` é o gatilho do efeito-fantasma de estoque (§6).

### Eixo B — STATUS NFe (externo: SEFAZ) — `NF.STATUSNFE CHAR(1)` `[uNF.pas:L8277-8323]`
- `''` (NULL) = não enviada · `'P'` = autorizada/processada (TPEMISSAO 6/7 = contingência) · `'C'` = cancelada · `'D'` = denegada · `'T'` = NF de terceiros importada via XML (trava edição manual).
- Inutilização **não** é status no registro: é por **faixa** na tabela `NFE_INUTILIZADA`.

### Transições e gatilhos
| De → Para | Gatilho | Condições/efeitos |
|---|---|---|
| (vazio) → Inserindo | `btnAdicionarRegistro` `[L3257]` | defaults TIPO/IDEMPRESA/TIPOEMISSAO/MODELO; `SetaSituacao` |
| Inserindo/Editando → Gravada (`PROC='N'`, STATUSNFE vazio) | `btnGravar` `[L4489]` | cascata de validações (§5) → Post + ApplyUpdates |
| Gravada → Editando | `btnEditar` `[L3905]` | **bloqueado se `CONTABILIZADO='S'`** ou **`PROC='S'`** |
| Gravada → **Processada** (`PROC='S'`) | menu "Processar Nota" → `Processamento` `[L14765]` | dispara estoque (`TfrmEstoqueNF`) + (se config) financeiro; seta DTPROCESSAMENTO — **F3/F4** |
| Processada → Revertida (`PROC='N'`) | "Reverter Processamento" `[L8913]` | **bloqueado se STATUSNFE≠''/≠'T'**; bloqueado se `CONTABILIZADO='S'`; estorna estoque/financeiro; data≠hoje exige senha ADM |
| Gravada → Enviada (`STATUSNFE='P'`) | `btnEnviarNfe` → `EnviarNFE(1)` `[L10744]` | bloqueia terceiros; exige MODELO=55 e nota salva — **F6** |
| Enviada → Cancelada (`STATUSNFE='C'`) | `CancelarNFE` `[L6773]` | confirma; estorna financeiro (`CancelaFaturamento`) e contábil — **F6** |
| (faixa) → Inutilizada | `btnInutilizarNFe` `[L5551]` | grava `NFE_INUTILIZADA` — **F6** |
| Entrada → Saída | menu `NotadeSaida` `[L15166]` | bloqueado se em edição ou `PROC='S'` |
| qualquer → Clonada | `ClonaNF(1/2/3)` Transf/Devolução/Entrada `[L15151]` | gera nova NF |
| Gravada → Excluída | `btnExcluir` `[L4069]` | bloqueios por estado (§5) |

### Bloqueios de edição por estado (regra crítica — F1)
- **`dsNFStateChange` `[L9361]`:** habilita/desabilita **todo o cabeçalho** conforme `dsNF.State in [dsInsert,dsEdit]` → **fora de edição, cabeçalho read-only**.
- `PROC='S'` trava: editar, gravar ("Nota fiscal já processada não pode ser modificada."), adicionar item, excluir, mudar centro de custo.
- `CONTABILIZADO='S'` trava: editar, adicionar item, excluir, reverter.
- `STATUSNFE='P'/'D'` trava: reverter e excluir.
- **NF de terceiros M55** (`TIPOEMISSAO='1'`+MODELO 55, não importada): `EdicaoNFTerceirosLiberada` bloqueia digitação manual.

→ **F1 implementa os dois campos de estado (`PROC` default `'N'`, `STATUSNFE` default vazio) e TODAS as travas de edição**, mesmo com os efeitos desligados — é o esqueleto de segurança da tela.

---

## 4. Dados — modelo (Oracle, verdade)

### NF (header) — 209 colunas, PK `CODNF NUMBER(10)`
- **PK `CODNF`** surrogate via **sequence `ID_CODNF`** (app-side; sem trigger de geração). Item: `CODNFPROD` ← `ID_CODNFPROD`.
- **Chave fiscal natural (NRONF+SERIE+MODELO+IDEMPRESA+TIPO) NÃO é única no banco** (só índices NONUNIQUE) — a unicidade vive no app. → **Apollo deve reintroduzir UNIQUE** (risco de paridade).
- **Só 4 FKs declaradas** (CODVENDEDOR→PARCEIROS, CODOPERADOR_LIBERACAO→OPERADORES, CODPEDCOMP→PEDIDOCOMPRA, CODPAI→PAIS); as demais ("FKs") são joins sem constraint — integridade no app.
- Grupos: **identificação** (CODNF, TIPO 'E'/'S', NRONF, MODELO [55=NFC-e, 1=NF-e], SERIE, FINALIDADE '1'normal/'2'compl/'3'ajuste/'4'devol, IDEMPRESA, CFOP, **IDSITUACAO_NF**→SITUACAO_NF ~200 valores, TIPOEMISSAO/TPEMISSAO, INDICADOR_PRESENCA, VERSAOXML); **datas** (DTEMISSAO NN, DTCONTABIL NN, DTCHEGADA, DTHORASAIDA, DTPROCESSAMENTO, DTCADASTRO, DTULTIMALTERACAO); **parceiro** (CODPARCEIRO NN, CODPARCEIRO_END NN, OLD_*); **transportadora** (CODTRANSP, TIPOFRETE, PLACATRANSP, PESOBRUTO/LIQUIDO, RNTRC…); **~90 colunas de totais** (TOTALNF NN, TOTALPROD, TOTALDESC, TOTALFRETE(+2), TOTALSEGURO, TOTALACESSORIAS, TOTALICM/TOTALBASEICM, TOTALIPI, TOTALICM_ST/TOTALBASE_STEXTERNO, TOTALREPICM, TOTALISENTO, FCP: TOTAL_FCP(_BC/_VALOR_ST/_RET), DIFAL: VTOTICMSUFDEST/UFREMET, ICMS deson/bonif, **retenções** TOTAL_RET_PIS/COFINS/CSLL/INSS/IR/ISSQN/FUNRURAL/SENAR + PERC_/BASE_, serviço/ISS, VALIDATOTALNF); **status/situação** (TIPO, **PROC** 'N'/'S', CANCELADA, CONFIRMADA, CONTABILIZADO, **STATUSNFE**, RECEPCIONADA, EXPORTADA*, CANCELA_FATURAMENTO); **NFe** (CHAVENFE, PROTOCOLO_NFE, PROTOCOLO_CANCELAMENTO, XJUST, SEQUENCIA_NFE, NFE_XML CLOB, CODNFSTATUSPRO); **referências** (CODNF_REF+CHAVE_REF, CODPEDCOMP, CODIMPORTACAO, CUPONS_REF_DEVOLUCAO); **flags fiscais/rateio** (RATEIO, RATEIO_IPI/ST/DESCONTO, APROVEITAMENTOCREDITO, CONTRIBUINTE_ICMS, ALTERAESTOQUEREVERSAO, ABATER_ICMS_DESON); **obs** (OBS/OBSNF VARCHAR2(4000)); **auditoria** (USULTALTERACAO, DTCADASTRO…).

### NF_PROD (itens) — 193 colunas, PK `CODNFPROD`
- FK real `FK_NF_PROD_1: CODNF→NF` (único). **Chave natural = (CODNF, NROITEM)** (NROITEM único por CODNF — confirmado 4999/4999). **NF_PROD não tem triggers.** FK produto = `CODPRODUTO→PRODUTOS.IDPRODUTO` (join no app); CODPRODNOTA = código texto na nota.
- **Quantidades/valores (digitados):** QUANTIDADE NN, **FATOREMBAL NN** (qtde efetiva = QUANTIDADE×FATOREMBAL, usado no estoque), UNIDADE, VRVENDA NN, VRCUSTO, DESCONTO/VRDESCPROD, MARKUP, BONIFICACAO.
- **Fiscais por item:** classificação (CFOP NN + CFOP_ORIGINAL, NCM, NCM_IMPORTACAO, CEST, ORIGEM_ESTOQUE, CODIGOBENFISCAL); **ICMS** (ALIQUOTA CHAR(3)=**código** não %, ICMS %, **CST** NN, CSOSN, VRBASECALCULO, VRICM, ICME, ICMS_RED_BC_NOTA, campos `*_NOTA`=valor do XML vs `*_CALC`=recalculado); **ICMS-ST** (VRBASEST, VRICMST, MVA/MVA_AJUSTADO, STREAL, VRICMS_STEXTERNO/VRBASE_STEXTERNO, ICMS_ST_*_NOTA); **FCP** (FCP_ALIQUOTA/_BC/_VALOR + variantes _ST/_RET); **DIFAL** (VICMSUFDEST/UFREMET, VFCPUFDEST, ICMS_UF_DEST_BC); **IPI** (IPI NN, GERAICM_IPI, IPI_DEVOLUCAO); **PIS/COFINS** (PIS CHAR(1), CSTPISCOFINS, ALIQPISE/S/ALIQCOFINSE/S, VRPIS*, IDPISCOFINS); desonerado; frete/seguro/despesas por item (+ flags GERAICM_FRETE/ACESS).
- **Calculados/derivados (motor):** CREDITOICM, DEBITOICM, CREDITOPISCOFINS, VENDALIQ, LUCRO*, PMZ, VRVENDASUG, INDEXADORTRIB, SINCRONIZADO_CFOP/CST/ALIQ.
- **Estoque/produção/decomposição:** GERAESTOQUE, MOVIMENTA_ESTOQUE, DECOMPOSICAO/CODPRODUTOPAI_DECOMPOSICAO, PRODUC_* (lote/peso/validade), VRSALDOFLEX/VRCOMISSAO/CODVENDEDOR.

### Sub-tabelas do agregado
| Tabela | Linhas | Chave | Propósito | Fase |
|---|---|---|---|---|
| **NF_PROD** | 252.411 | PK CODNFPROD; FK CODNF | itens | **F1** |
| NF_FORMA_PAGAMENTO | 21.096 | PK CODNFORPGTO; CODNF | pagamentos NFC-e/TEF (IDPGTO, VRPGTO, NUMERO_AUT, VRTROCO) | F4 |
| NF_PROD_LOTE | 56.520 | PK; CODNFPROD | rastreabilidade lote/validade | F2 |
| NF_PROD_IBSCBS | 1.454 | PK CODNFPROD | **Reforma por item** (IBS-UF/Mun/CBS, cClassTrib) | adiado |
| NF_IBSCBS | 108 | PK CODNF | **Reforma — totais** | adiado |
| NF_STATUS_PROCESSO | 205.722 | PK; CHAVENFE | trilha de transmissão NFe | F6 |
| NF_CANCELAMENTO | 7.655 | PK; CHAVENFE | eventos de cancelamento (XML CLOB) | F6 |
| NF_CARTA_CORRECAO | 3 | PK IDCARTA; CODNF | CC-e | F6 |
| NF_REFERENCIA | 6.322 | CODNF+CODNF_REF | NFs referenciadas (devol/compl) | F1 (armazenar) |
| NFE_XML / NFE_EVENTOS / NFE_INUTILIZADA | 20k/50k/44k | CHAVENFE | XML/eventos/inutilização | F6 |
| **(fora do agregado, gerados por ele)** ARECEBER/APAGAR (IDNF), ESTOQUE*, DIARIO, AUDIT_NF | — | — | efeitos | F3/F4/F5 |

**Financeiro NÃO é tabela `NF_DUPLICATAS`:** a NF gera títulos **direto em `ARECEBER`/`APAGAR`**, vinculados por **`ARECEBER.IDNF = NF.CODNF`** (coluna nullable, **sem FK**). Campos: DUPLICATA, NRODUP, DTVENC, VALOR, TIPODOC, DOCNF, QUITADA, GERADO. (ARECEBER usa CODEMPRESA, não IDEMPRESA — ver [[parity-certificacao]].)

---

## 5. Regras de negócio (validações + mensagens PT verbatim)

**Gravar (`btnGravarClick`), em ordem `[uNF.pas:L4489+]`:**
1. terceiros M55 → "Não é permitido inserir manualmente notas fiscais de terceiros, Modelo 55. Importe ou Recupere o XML, ou utilize o Importador de XML automático" `[L9435]`
2. `PROC='S'` em edição → "Nota fiscal já processada não pode ser modificada." `[L4537]`
3. `validaCFOP_SituacaoNF`
4. DTCONTABIL < DTEMISSAO → "Data da contabilização MENOR que a data de emissão. Verifique!" `[L4546]`
5. DTCONTABIL < hoje → "Data da contabilização MENOR que hoje, deseja continuar?" `[L4554]`
6. dia fechado → "Dia FECHADO não é permitida alteração ou inclusão de documentos!" `[L4569]`
7. terceiros M55/57: chave → "Chave da nota fiscal eletronica não informada ou inconsistente, Verifique!" `[L4581]`; número → "Informe o numero da nota fiscal de conhecimento de transporte!" `[L4588]`
8. `ValidaFinalidadeNF`
9. produtos DIVERSOS → "Nota fiscal não pode ser gravada, pois existe(m) N produto(s) com descrição DIVERSOS." `[L4609]`
10. entrada sem total → "É necessário informar o campo total NF, para dar continuidade!" `[L4651]`
11. número duplicado → "Esta nota fiscal ja esta lançada com o mesmo numero e o mesmo fornecedor no codigo: …" `[L4747]`
12. fornecedor → "Favor informar o código do fornecedor." `[L4787]`

**Processar (`Processamento`) — F3:** "A nota selecionada já processada!"; "Não é possível processar a Nota Fiscal, pois existem produtos com conferência incorreta!"; "Nota fiscal sem itens informados. Verifique."; "Nota fiscal de devolução sem documento referenciado. Verifique."; "Há divergência de CFOP informado."; "Valores do ICMS ST divergentes do calculado. Verifique!"; "Existe(m) item(ns) sem indexador tributário configurado. Verifique!"; "Não é permitido processamento sem repassar todos os itens!"; "Valor informado no campo total da NF não confere com o Valor Total da Nota, Verifique!"; estoque negativo → "Processamento de Nota Fiscal não permitido, pois com sua emissão o estoque ficará negativo…" `[uProcessaNotaFiscal.pas:L548]` / "O produto … está com quantidade negativa no estoque … Deseja liberar a reversão deste item mesmo assim?" `[udmNF.pas:L11653]` (exige senha).

**Editar/Reverter:** "Documento contabilizado. Não é permitido editar." / "Nota já Processada! Para edita-lá é necessário Reverter Processamento." `[L3910/3917]`; "Não é possível reverter o processamento da nota fiscal.\nNota fiscal já enviada para receita." `[L8944]`; "Ao reverter o processamento, o estoque será revertido. Confirma Operação?" `[L8979]`.

**Financeiro — F4:** "O total das faturas é diferente do valor da nota. Confira!" `[uEstoqueNF.pas:L843]`; "Deseja remover o faturamento e o financeiro desta nota? Esta ação é IRREVERSÍVEL, pois as contas A PAGAR ou A RECEBER serão excluídas!" `[L1007]`; **"Existem documentos financeiros que já foram baixados, agrupados ou contabilizados relacionados à essa nota. Não é possível excluir o financeiro. Verifique!"** `[L1014]` (o "título já baixado").

**Contábil — F5:** "A situação de NF. é obrigatória…" / "O centro de custo é obrigatório…" / "Valor excedido:" `[uLancamentoContabilNF.pas:L366/373/489]`.

**Transmitir — F6:** "Não é possível enviar uma nota com emissão de terceiros. Verifique!"; "O modelo para enviar NF-e deve ser 55. Verifique!"; "Salve a nota antes de envia-la!"; justificativa de cancelamento/CCe/inutilização **≥ 15 caracteres** (UPPERCASE).

---

## 6. Efeitos colaterais + estado externo (a armadilha — F3/F4/F5)

> **Descoberta decisiva:** o movimento de estoque **NÃO é feito em Pascal**. O Pascal só grava flags e seta `NF.PROC='S'`; quem move `ESTOQUE.QTDE` é a **trigger Oracle `ESTOQUE_NOTAS` AFTER UPDATE ON NF** (corpo de ~62.700 chars, ENABLED em homolog). Replicar a NF sem replicar fielmente essa máquina = estoque nunca move / move errado.

**Triggers em NF (3; NF_PROD tem ZERO):**
1. **`AUDIT_NF`** (AINS/UPD/DEL): grava `AUDIT_NF` (430.601 linhas) — CODNF, STATUSNFE (+anterior), PROGRAMA/MAQUINA/USUARIO (de GSESSION), TIPO. → Apollo: audit log próprio.
2. **`ESTOQUE_NOTAS`** (AUPD): move estoque **só quando `:OLD.PROC='N' AND :NEW.PROC='S' AND COALESCE(ALTERAESTOQUEREVERSAO,'S')='S'`**. `QTDEX = QUANTIDADE × FATOREMBAL`; **`TIPO='S'` → −QTDEX (baixa)**, `'E'` → +QTDEX (entrada). Tabela por `ORIGEM_ESTOQUE`: `'E'`→ESTOQUE.QTDE (CODESTOQUE_LOCAL IS NULL), `'D'`→ESTOQUE_DEP, `'P'`→ESTOQUE_PROD (MERGE), `'X'`→ESTOQUE.QTDE_ALMOXARIFADO; estoque congelado usa `*_CONG`. Guardas: `GERAESTOQUE='S'` (=GERAQTDE OR DEPOSITO OR PRODUCAO) e `MOVIMENTA_ESTOQUE='S'`. Atualiza DTVENDA/QTDE_VENDA (saída) ou DTENT/QTDE_ENT (entrada); grava HISTORICO_PROD(_DEP/_PRODUCAO/_ALMOX); trata decomposição (rateio por DECOMPOSICAO.PERCENTUAL). **Reversão** (CANCELADA N→S, PROC S→N, STATUSNFE→'D', BAIXAR_ESTOQUE_EXCLUSAO='S'): estorna no sentido inverso + grava histórico "ESTORNO…" + **apaga lançamentos** `DELETE FROM DIARIO WHERE CODORIGEM IN (SELECT CODRCB FROM ARECEBER WHERE IDNF=:NEW.CODNF)`.
3. **`ESTOQUE_NOTAS_COMPOSICAO`** (AUPD): idem para produtos COMPOSIÇÃO/kit (move componentes).

**Sem reserva separada** — baixa direta no processamento; só **validação prévia** de saldo negativo (com autorização por senha).

**Financeiro (F4):** parcelas geradas em `FATURAMENTO` (da condição de pagamento: nº parcelas, dia fixo `PARCEIROS.VENC_PREV` ou intervalo `DIASPRAZO`, rateio do total); títulos reais gerados **após o commit do estoque** via `GerarFinanceiroAutomaticamente` (entrada→`GeraApagar`+CX_APAGAR; saída→`GerarAReceber`+CAIXA) — **só se CFOP marca `GERA_FINANCEIRO_AUTO='S'`**. Base da parcela = TOTALNF − bonificado − retenções − descontos. MODALIDADE: TIPO='E'→'A PAGAR', senão 'A RECEBER'. Também gera A Pagar de retenções/FunRural e A Receber de acordo comercial. Cancelamento: `ExcluiFaturamento` **DELETA** (irreversível) títulos por IDNF — **bloqueado se houver baixa/agrupamento/contabilização**.

**Contábil (F5):** (a) rateio `CODCONTABILNF` (IDSITUACAO_NF + centro de custo + valor; soma deve bater TOTALNF; persistido na mesma transação da NF); (b) `DIARIO` partida-dobrada via `TIntegracaoContabil.Integrar` **só se `Empresa.INTEGRACAO='AUTOMATICA'` e TIPO='E'** (plano de contas/mapeamento fora destas units).

**Ordem no processamento (imutável — documentar p/ F3-F5):** (1) abrir 1 transação, gravar flags em NF_PROD (MOVIMENTA_ESTOQUE/GERAESTOQUE/ORIGEM_ESTOQUE) + custo/preço (MULTI_PRECO/LOTEPRECO); (2) `NF.PROC:='S'` + commit → **trigger move estoque**; (3) **após o commit**: RegistrarProcesso → financeiro (acordo→retenções→funrural→GerarFinanceiroAutomaticamente); (4) caixa + (se automática) DIARIO. **Atomicidade parcial:** estoque+status+rateio numa transação; **títulos criados após o commit (NÃO atômico com o estoque)** — risco real de estoque baixado e financeiro falho. → motivo de F3/F4 separadas e adversarialmente verificadas.

---

## 7. Fiscal — onde o cálculo vive e o que reusar (F2)

- **O motor fiscal de verdade** é `TIndexadorTributario` (`uIndexadorTributario.pas`) + `TDMNF.CalcValorNota`/`CalculaICMSInterestadual`/`RateioNota` (`udmNF.pas`) + a tela do item `uItensNF.pas` (resolve figura fiscal → CST/CFOP/alíquota/MVA/redução). **`uPrecificacaoNF`/`uDMPrecificacaoNF` NÃO calculam imposto da NF** — são a tela de lote de preço (LOTEPRECO); imposto entra ali só como custo.
- **A tela CALCULA e ARMAZENA:** campos `TEMP*` = scratch; `RecalculaICMSST`/`CalculaBaseICME` transferem para os persistidos (VRICM, VRBASECALCULO, VRBASEST, VRICMST, STREAL…). NFe importada (`NF_IMPORTACAO_NFE='S'`) suprime cálculo e só armazena o XML. **Padrão p/ Apollo: persistir a verdade fiscal por item; recalcular reusando o motor.**
- **CST é DERIVADO** da `OPERACAO` da figura fiscal: T→00, R→20, C→10, F→60, S→50, D→51, I→40, N→90, Y→41, Z→70. CSOSN=400 quando SN+alíquota NTB. CFOP/alíquota/MVA/redução vêm da figura fiscal (`CarregaIndexadorTributario`, desempate CODBARRA→NCM→CFOP→CODPARCEIRO→CNPJ). `ALIQUOTA` é código (T01/NTB/STB/IST) cujo prefixo 'T' decide se há ICMS.
- **Totais:** `TOTALNOTA = TOTALPROD + TOTALFRETE + TOTALSEGURO + TOTALACESSORIAS + TOTALIPI + TOTALIPI_DEVOLUCAO + TOTALICM_ST + TOTAL_FCP_VALOR_ST + VALORSERVICO + TOTALVROUTROS + (TOTALDESCFINAL − TOTALDESC) − TOTAL_ICMSDESON`. Rateio (`RateioNota`): frete/seguro/IPI convertidos a % proporcional ao TOTALPROD.
- **REUSO (já portado em `apps/api/src/modules/precificacao`):** `TributacaoRepository.resolverAtual(aliquota,uf)` (ICMS efetivo/CST/redução por DET_ALIQUOTA — 007); `resolverIndexador(ncm)` (MVA/alíq destino por INDEXADOR — 008); `FiscalPricingService.calcularIcmsSt()` (ST clássico base×(1+MVA), ST=base×aliq−próprio); `precoAtual()` (preço-por-dentro fiel ao `MargemL`); `precoReforma/Transicao`. **NÃO reescrever.**
- **Faltam de motor (estender em F2, na ordem de necessidade):** MVA **ajustado** interestadual (`GetMVAAjustado`), redução de BC-ST/ICMS (BCR/REDUCAO/REDCOM), ST a recolher (SN vs LR, Lei 3166 ES), **IPI** (% sobre total + entrada nas bases), **rateio**, composição de base por flags GERAICM_*, **FCP/FCP-ST**, **DIFAL/partilha** (lib externa `TICMSUFDest`/ACBr — adiar), valor fiscal de **PIS/COFINS** (hoje só % de custo/margem; valor real no SPED). **SPED** (Uspedfiscal/UspedPisCofins/Usintegra) só **lê** o que a NF gravou — fase própria.

---

## 8. NFe/NFC-e/TEF (externo — F6)

- **Biblioteca:** ACBr (`TACBrNFe`), layout `ve400` (NFe 4.00). Fluxo `TNFe.EnviaNFE`: montar (Ide/Emit/Dest/Det/Total/pag) → **assinar → validar(XSD+regras) → gerar → `Enviar(lote)`** (síncrono) → ler `cStat`/`chNFe`/`nProt` → mapear status (§3 Eixo B) → persistir + salvar XML → DANFE/e-mail.
- **Armazena em `NF`:** CHAVENFE(44), PROTOCOLO_NFE, PROTOCOLO_CANCELAMENTO, STATUSNFE, CANCELADA, CONFIRMADA, TPEMISSAO, XJUST, FINALIDADE. Auditoria em `HISTORICO_ENVIO_NFE`. **XML da NFe (mod.55) vai ao filesystem** (`…\NFE\XML_NFE\<emp>\<serie>\<nronf>\<chave>-nfe.xml`); NFC-e usa blob `XML_NFE.ARQUIVO_XML`.
- **Eventos** (ACBr `EnviarEvento`, justificativa ≥15): cancelamento (`teCancelamento`, grava STATUSNFE='C'+PROTOCOLO_CANCELAMENTO), inutilização (faixa → `NFE_INUTILIZADA`), CCe (`teCCe`, máx 20/nota, `NF_CARTA_CORRECAO`). Contingência via `AMBIENTE_CONTINGENCIA` + tpEmis SVC (6/7).
- **NFC-e (mod.65):** CSC/CSC_ID (de EMPRESAS), QR Code, DANFE térmico (`ACBrNFeDANFeESCPOS`); emissão real fica no **PDV** (`vendas-master`), não na retaguarda.
- **TEF:** fora da retaguarda (PDV `vendas-master/Tef/`); na retaguarda só config (operadoras/formas pgto).
- **Config (cadastrar):** tabela `NFE` (certificado por empresa: AUTENTICACAO=nº série, TIPONFE='D'/prod=ambiente); EMPRESAS (UF/CNPJ/SERIE/CSC); ACBr (ve400, paths, SSL/TLS, NroViasNF, timeout).
- **Contrato de colunas:** a tabela `NF` do Apollo **nasce com** os campos NFe (CHAVENFE/PROTOCOLO_NFE/PROTOCOLO_CANCELAMENTO/STATUSNFE/CANCELADA/CONFIRMADA/TPEMISSAO/XJUST/SEQUENCIA_NFE) já na F1, ainda que vazios — para a fase de transmissão não exigir migração de schema. **No Apollo a transmissão será serviço dedicado** (ACBrLibNFe / lib NFe Node / microserviço SEFAZ) — o app não fala SEFAZ direto.

---

## 9. TabOrder + F-keys

- **F1**=Calcular totais/impostos (`btnCalcular`); **F3**=Pesquisa (só fora de insert/edit); **F4/F5/F6**=foco em Base ICMS/Total prod/Prods ST; **F7**=Centro de custo; **F9**=Financeiro; **F11**=Formas de pagamento; **Ctrl+N**=próxima página de abas; **Ctrl+D**=recalcular decomposição. `FormShortCut`: no campo de código de barras do financeiro, Enter avança a parcela (digitação rápida).
- TabOrder cabeçalho: tipo emissão → modelo → número → série → emissão → parceiro → CFOP → finalidade.
- → No Apollo, F-keys via a camada de teclado (ADR-010 `&` mnemônicos + atalhos); F1=calcular, F3=pesquisar como nas demais telas.

---

## 10. Alvo (NestJS + React) — recorte F1

- **API:** `AggregateConfig` master `nf` + detalhe `nf_prod` (chave `itens`), **`empresaScoped`** (IDEMPRESA), `pkGerada` (sequence). Migração cria `nf` (subset fiel do header — identificação/datas/parceiro/transporte/totais/status/obs + colunas NFe vazias) + `nf_prod` (subset fiel do item — produto/qtde/valores + config fiscal) + lookup `situacao_nf` + view `get_nf`. `derivar` (TIPO do parâmetro; totais Σ itens server-side); `validar` (cross-row: chave fiscal única, DTCONTABIL≥DTEMISSAO, fornecedor obrigatório, terceiros M55 bloqueia digitação, número duplicado). **Travas de estado** (PROC/STATUSNFE/CONTABILIZADO) impedem update — no engine via `validar`/guard. **Sem** efeitos.
- **Web:** `NfCadMaster` sobre o pilar `CadMasterDet`, parametrizada Entrada|Saída (rota); abas Cabeçalho/Itens/Transporte/Obs/Referências; itens como sub-grid (DataTable+modal, lookup produto via `useResourceOptions`); F1=calcular totais (client, Σ itens); estados read-only espelhando `dsNFStateChange`. Reusa DS/zero-hardcode/ADR-015/mnemônicos.
- **Reuso:** engine declarativo, validadores BR, pilar CadMasterDet, `precificacao` (F2), tabelas migradas (parceiros/produtos/det_aliquota/ncm).

### Relaxações deliberadas de NOT NULL na F1 (auditado no Oracle real, nada perdido)
A recon §4 subdocumentou alguns NOT NULL; auditoria adversarial conferiu no Oracle (PINHEIRAO) e a F1 foi corrigida:
- **Reintroduzidos como NOT NULL na F1** (são digitados na própria tela): `NF.MODELO`, `NF.SERIE`, `NF.DTCONTABIL`, `NF_PROD.CODPRODUTO` — exigidos no schema e na migration 025 (fecha também o furo do índice UNIQUE por NULL em modelo/serie).
- **Relaxados de propósito p/ F2** (NOT NULL no Oracle, mas DERIVADOS/calculados pelo motor fiscal — §7): `NF_PROD.CST`, `ICMS`, `IPI`, `ALIQUOTA`, `CFOP` (ficam NULLABLE/DEFAULT 0 na F1; a F2 os preenche via figura fiscal/`precificacao`).
- **Omitidos p/ F2** (NOT NULL no Oracle, fase fiscal): `NF_PROD.MARKUP` (precificação) e `NF_PROD.BCR` (base reduzida de ST) — adicionados via ALTER na F2.

### Regras do btnGravar substituídas/adiadas (procedência §5)
- **"Total NF" em entrada** (`VALIDATOTALNF`, "É necessário informar o campo total NF…", `uNF.pas:4651`): na F1 o `totalnf` é **derivado server-side** (Σ itens) — a conferência manual de digitação do total é **substituída pela derivação**; reavaliar na F2 se a conferência operador-informado-vs-calculado é desejada.
- **STATUSNFE='T'** (NF de terceiros importada trava edição via `EdicaoNFTerceirosLiberada`): a F1 trava digitação manual de terceiros M55 no insert (`validaTerceirosM55`), mas o **lock de update por `statusnfe='T'`** entra na **F6** (quando a importação de XML existir; hoje 'T' não ocorre sem importação).

### F2 — ENTREGUE e verde (cálculo fiscal por item, corte 1; reuso do motor `precificacao`)
Ação **"Recalcular impostos"** = `POST /fiscal/nf/recalcular` (`NfFiscalService`, **puro — não grava**; a tela aplica o resultado e o save do agregado persiste). Migration `026_nf_fiscal.sql` (ALTER `nf_prod` ADD `bcr`/`vripi`/`geraicm_*`; seed `det_aliquota` p/ MA). Implementado, verbatim do legado:
- **ICMS próprio:** `vrbasecalculo = round(TOTALPRODS·BCR/100 + complemento)`; **`vricm = round(vrbasecalculo·ICM/100)`** — a alíquota **DESTACADA** (`a.icm`) sobre a base já reduzida; a redução vive UMA vez no BCR (auditoria pegou o bug de usar a efetiva → dupla redução; corrigido + teste T20). `a.icmEfetivo` é só exibição/crédito.
- **IPI:** `vripi = round(TOTALPRODS·ipi%/100)` (`ipi`=alíquota %, `vripi`=valor).
- **Zeramento de crédito** por CFOP/CST (`x401/x403/x933/x556`; `x101/x102`+CST 40/90; `1910/2910` não-T).
- **ICMS-ST clássico** via `resolverIndexador`+`FiscalPricingService.calcularIcmsSt` (reuso), só p/ a lista de CFOPs + `mva>0`, **com guarda de bonificação** (CFOP 19xx/29xx só com CST 10/70/60).
- **CST** de `det_aliquota.cst`; **totais do header** por Σ (`derivar`). **UF** da nota (parceiro→parceiros_end.uf).

### Adiado (documentado, nada perdido)
- **F2b fiscal (refino):** MVA **ajustado** interestadual (`GetMVAAjustado:276`); redução de BC-ST (REDCOM) e BC própria encadeada; ST a recolher **SN-vs-LR + crédito + Lei 3166**; **rateio fino** (`RateioNota`); **figura fiscal completa** (CFOP derivado/CSOSN); **modo-truncar** (flag `ARREDONDA` por item — hoje `round2` half-up, divergência ≤1 centavo); gate `APROVEITAMENTO_CREDITO_ICMSST_NF` (config por tenant); `DEPSACESS` separado de `vroutrasdesp`; colunas `MARKUP` (precificação) e NF_PROD_LOTE; serviço/ISS.
- **DIFAL/partilha + FCP/FCP-ST** (lib externa `TICMSUFDest`) → F3+.
- **PIS/COFINS valor** fiscal → SPED (fase própria).
- **F3 estoque:** flip PROC→estoque (trigger `ESTOQUE_NOTAS` fiel: sentido/origem/decomposição/composição/reversão) — liga ao Produto F5.
- **F4 financeiro:** FATURAMENTO → ARECEBER/APAGAR (parcelas/condição pgto/retenções/funrural/acordo), NF_FORMA_PAGAMENTO, exclusão/trava de baixa.
- **F5 contábil:** CODCONTABILNF + DIARIO (depende de plano de contas/integração).
- **F6 SEFAZ:** NFe/NFC-e (ACBr→serviço dedicado), eventos (cancel/inutil/CCe), DANFE, e-mail, NF_STATUS_PROCESSO/NFE_XML/NFE_EVENTOS/NFE_INUTILIZADA/NF_CANCELAMENTO.
- **Reforma Tributária:** NF_IBSCBS/NF_PROD_IBSCBS (transição 2026-2033) — conviver com legado.
- **Replicação:** sem `REM_NF` (só `REM_RECEBER` nos títulos); AUDIT_NF → audit log próprio.
- **Módulos específicos:** classificação de animais (frigorífico), pedidos, devolução de compra, NFe avulsa.

### Riscos / notas
- **Chave fiscal sem UNIQUE no legado** → reintroduzir no Apollo (UNIQUE NRONF+SERIE+MODELO+IDEMPRESA+TIPO).
- **Efeitos por trigger Oracle** (estoque) + **financeiro não-atômico** com o estoque → fases dedicadas com verificação adversarial; jamais disparar efeito na F1.
- **Centavos:** `TruncarArredondar('A'/'T',2)` (flag ARREDONDA por item) vs `round2` — conferir ao chegar em F2.
- **Dados sujos** (flags tri-state, campos `*_NOTA` vs `*_CALC`) → enums com fallback.
- **Oracle read-only**; nada de DML em homolog (PINHEIRAO replica).

Ver [[parity-certificacao]] · [[fiscal-usar-legado]] · [[apollo-recon]] · [[apollo-erp-app]].
