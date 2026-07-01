# Dossiê de Tela — NOTA FISCAL (`uNF.pas` / `udmNF.pas`)

> **A tela-coroa do ERP.** `uNF.pas` = **18.262 linhas** (o maior arquivo do sistema); `udmNF.pas` (DataModule `TDMNF`) = 12.103 (onde vive **toda** a regra fiscal/NFe/financeira). Entidade `NF` = **209 colunas** / 23.404 linhas; `NF_PROD` = **193 colunas** / 252.411 linhas; ~40 tabelas no namespace `NF*`. É, de longe, o maior agregado e a maior carga de regra de negócio do Apollo.
>
> Síntese de 5 inspeções profundas isoladas (2026-06-29): (1) modelo de dados + Oracle, (2) fluxo/UI/ciclo de vida, (3) fiscal/impostos + reuso, (4) efeitos estoque/financeiro/contábil, (5) NFe/NFC-e/TEF. Procedência citada como `[arquivo:Lnnn]` / `[Oracle-dict]` / `[trigger:Lnnn]`.
>
> **Status:** `F1+F2+F2b+F3+F4+F5+F6 implementadas e verdes`. **F2b** = refino fiscal: **ARREDONDA por item** (round 'S' / trunca 'N') + **ST profundo** (`TIndexadorTributario`: MVA ajustado interestadual + redução BC-ST REDCOM + crédito, caminho Lucro Real; UF de origem via `empresa_fiscal`) + DEPSACESS na base ICMS. Params do ST opcionais no-op → **backward-compat** (STB 3,24 / T20 12,00 inalterados). VRICM/IPI/base já eram fiéis (golden); resíduos deep-fiscal (regime SN/figura fiscal/Lei 3166/pauta/FCP/DIFAL) documentados. **F6** = NFe mod.55 (transmitir/cancelar/CCe) atrás da **porta SEFAZ**: máquina de estados `STATUSNFE` (''/P/C/D), chave de acesso 44 díg+DV mód 11, eventos (cancel 110111 justificativa ≥15 SEM reverter estoque/financeiro; CCe 110110 ≥15/máx-20/nSeqEvento), persistência (`nfe_evento`/`nfe_xml`/`historico_envio_nfe`). Transmissão real (SOAP/cert/XSD/DANFE/e-mail) **adiada atrás da porta** — corte 1 usa `SimuladorSefazProvider` (homologação, `simulado='S'`, gated por env). Verde: shared 68, API 123, web 25, **smoke 126/0**. **F5** = contábil: rateio `CODCONTABILNF` (situação + centro de custo PLC + valor) como **detalhe do agregado** (config armazenada, SEM efeito); situação/CC obrigatórios + par único = HARD; **soma=TOTALNF = ADVISORY** (preview na UI, fiel ao legado — só label, sem bloqueio); DIÁRIO/partida-dobrada adiado. **F4** = faturamento: `POST /fiscal/nf/:id/faturar` e `/estornar-faturamento` geram/apagam títulos em `ARECEBER` (saída) / `APAGAR` (entrada) por `IDNF`, numa **transação atômica** (rateio em centavos — Σ = total ao centavo; idempotente CAS+flag; estorno bloqueado por título quitado). 8 auditorias adversariais + **1 code-review sênior de gap-analysis (5 agentes, legado→migrado)**. Grau de paridade: **`paridade certificada por golden`** — o **golden do legado (PINHEIRAO, V$SQL real) foi capturado e confrontado** (ver "### Golden — confronto e correções"): chave/DV 5000/5000, fórmula de TOTALNF, sinais de estoque e rateio-advisory confirmados FIÉIS; transcrição corrigida em cancelar-estorna-estoque, gate PROC='S', terceiros, contabilizado, dup-key TIPOEMISSAO, isento IST, duplicata NRONF; resíduos deep-fiscal (F2b/F4b) golden-backed. Verde: **API 123, web 25, smoke 130/0**. — **F1** = núcleo cadastro, SEM efeitos. **F2** = cálculo fiscal por item (ICMS próprio + ICMS-ST clássico + IPI), REUSANDO `precificacao` via `POST /fiscal/nf/recalcular` (puro). **F3** = processamento (movimento de estoque): `POST /fiscal/nf/:id/processar` e `/reverter` movem `ESTOQUE.QTDE` numa **transação atômica** (estoque + kardex + flip de PROC), entrada soma/saída baixa, **negativo bloqueia**, idempotente (CAS), reverter bloqueado se enviada à SEFAZ. Recon (5+2+2 inspeções) + 6 auditorias adversariais. F2 corrigiu dupla-redução de base; F3 confirmou paridade do movimento (4 casos de sinal) + atomicidade. Verde: shared build, api/web `tsc`, **API 123 testes**, **web 25**, **smoke 89/0**. **Risco de lost-update do saldo (Produto regravava `estoque.qtde` absoluto) RESOLVIDO** com hook `preservar`/`chaveNatural` no engine de agregado (saldo owned pelo movimento; cadastro preserva do banco). F4..F6 (financeiro/contábil/SEFAZ) são fases dedicadas. **Nada pode dar errado** — efeitos isolados, atômicos e verificados; o que falta está documentado.

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

### F2b — ENTREGUE e verde (refino fiscal: ARREDONDA + ST profundo do TIndexadorTributario)
Recon por 3 agentes (motor legado `udmNF.pas`/`uIndexadorTributario.pas` + motor migrado/seed + **golden fiscal** PINHEIRAO 252k itens). **Achado-âncora:** o VALOR de VRICM/IPI/base **já era FIEL** (golden: VRICM por ICME 98,6%; identidade `icmEfetivo=icm×base/100`; o migrado usa a representação **NFe-padrão** vBC-reduzida×alíquota-cheia; o "IPI base bruta" do golden era a coluna `IPI_NOTA`=captura do XML, ≠ `VRIPI` recalculado, que bate). Restavam dois refinos reais — entregues:
- **ARREDONDA por item** (`nf_prod.arredonda` 'S'/'N'; golden 77,7% round / 22,3% **trunca**): helper `arred(x,modo)` = trunca 2 casas se 'N', senão `round2`; aplicado a `vripi/vrbasecalculo/vricm/vrbasest/vricmst`. Smoke: T01/MA 9,99×22% = 2,1978 → **2,19** ('N') vs **2,20** ('S').
- **ST profundo** (`FiscalPricingService.calcularIcmsSt` estendido com **params OPCIONAIS no-op** → backward-compat total; caminho **Lucro Real**, pois PINHEIRAO é LR): **MVA ajustado** interestadual `mvaAj=((1+mva/100)·(1−icmFonte/100)/(1−(aliqDest−FEM)/100)−1)·100` (RoundTo 3, só interestadual & fornecedor não-SN); **redução de BC-ST (REDCOM)** `bc=(valor−desc)·redcom/100`; `baseSt=bc·(1+mvaAj/100)`; **crédito** `(valor−desc)·reducaoAliqFonte/100·icmFonte/100`; **ST = max(0, débito−crédito)**. A **UF de origem** vem da `empresa_fiscal` (F6) → destrava o interestadual sem a tabela EMPRESAS. `item.mva` passa a guardar o **MVA ajustado**.
- Migration `031_nf_fiscal_f2b.sql` (ALTER `nf_prod` +`arredonda`/+`depsacess`; ALTER `indexador_tributario` +`redcom`/+`aliquota_fem`/+`tp_figura`, todos DEFAULT no-op; NCM de teste do ST profundo). **DEPSACESS** vira a coluna correta do complemento de base ICMS (× BCR) — antes usava `vroutrasdesp` (inócuo: `geraicm_acess='N'` em 100% dos dados, mas defensivo/fiel). **Backward-compat provado:** STB (NCM 04061010) segue 58/3,24 e T20 segue 12,00 (os defaults reduzem à fórmula clássica). **2 auditores adversariais:** (a) **paridade ST + golden-confronto: 7/7 itens ST reais batem EXATO** (NF28/NCM 20052000; VRBASEST/VRICMST), MVA ajustado/CFOP-ST/zeramento/backward-compat OK — pegou **2 ALTA de ARREDONDA, corrigidas**: o **IPI sempre arredonda** (udmNF:4164, independe de ARREDONDA) e em **modo 'N' a base fica CHEIA**, truncando só o VRICM (udmNF:4199-4220), não a base; (b) **zero-regressão CONFIRMADO** (aditivo; Produto/precificacao e F1–F6 intactos; `recalcular` puro; migration só ADD/INSERT). Verde: shared 75, **API 123, web 25, smoke 130/0**.

**Resíduos (F2b fase-2 / bloqueado por dados não migrados — golden/recon, com procedência):** **regime SN** (PINHEIRAO é LR; SN documentado — `uIndexadorTributario.pas:374-391`), **figura fiscal** (seleção multi-chave em INDEXADOR + fallback CNPJ/INDR), **Lei 3166** (ES-específico; colunas + regra ES), **ST por pauta/preço-fixo** (~64% do ST real — precisa dado de pauta), gates de config (`APROVEITAMENTO_CREDITO_ICMSST_NF` etc.), **FCP/DIFAL/PIS-COFINS valor**, **IPI_NOTA** (captura do XML → F6/importação), e a **representação base/alíquota** GO/MG (o `ICM_EFETIVO` legal — ex. T56/MG=8,40% — é independente de `icm×base/100`; o precificacao usa o valor real; as alíquotas usadas na NF (MA) coincidem). **VRICM/IPI/base = fiéis em valor; NÃO trocar a representação (é a NFe-padrão).**

### F2c — ENTREGUE e verde (regime da empresa + gate de config, destravado por EMPRESAS)
Recon por 2 agentes. **Achado que enxugou o escopo:** o SN-vs-LR do ICMS-ST **já era fiel** (F2b) — a única diferença é "não ajustar o MVA no SN", dirigida pelo **fornecedor** (`TP_FIGURA='S'`, já wired via `idx.tpFigura`). O regime da EMPRESA age em camada separada. Entregue:
- **Gate SN da empresa** (`DmOld/udmNF.pas:1869`): quando `empresas.classfiscal='SN'`, o `nf-fiscal.service` **zera ICMS próprio + ST na emissão** (Simples não destaca). `resolverEmpresa` passou a ler `uf` + `classfiscal`. PINHEIRAO é LR → gate não dispara (backward-compat); smoke prova o SN (vricm 22→0) e a reversão.
- **Gate de config `APROVEITAMENTO_CREDITO_ICMSST_NF`** (`udmNF.pas:4231/4470`) via a nova camada de config (ver dossiê `uConfiguracoes.md`): o zeramento de crédito de ST só ocorre quando `!aproveita && zeraCreditoIcms(...)`; default 'N' preserva o comportamento; override Empresa='S' aproveita. Smoke seção 25.
- 2 auditores adversariais. Verde: shared 75, **API 123, web 25, smoke 143/0**.

**F2c-2 ENTREGUE (P1) — crédito de ENTRADA SN:** empresa `classfiscal='SN'` em nota de ENTRADA calcula crédito presumido do Simples = `vrbasecalculo × ALQSIMPLESNAC/100` (`udmNF.pas:4021`, TruncarArredondar 'A') em vez de zerar; na SAÍDA continua zerando o destaque (DmOld:1869). `resolverEmpresa` lê `alqsimplesnac`; o bloco SN distingue TIPO; ST sempre zerado (SN não é substituto). Smoke §25.3 (entrada SN vricm 3 / base 100 / ST 0).

**F2c-2 ENTREGUE (P2) — figura fiscal por catálogo:** `indexador_tributario` reestruturado para a chave MULTI-CAMPO real do legado (migration 034: `codindexadortributario` PK; +codfigurafiscal/tp_cadastro/origem/destino/codcfop/codbarra/codparceiro/cnpj_cpf/operacao/lei_3166…; `ncm` deixa de ser PK mas preservado → `resolverIndexador`/golden ST 7/7 intactos) + tabela `figura_fiscal` + `produtos.codfigurafiscal`. `TributacaoRepository.resolverFigura` faz a resolução multi-chave + **desempate por especificidade** (CODBARRA>NCM>CODPARCEIRO, udmNF.pas:10029) e deriva o **CST pela OPERAÇÃO** (`cstDaOperacao`, udmNF.pas:10096). `nf-fiscal` gateia por `FIGURAFISCAL` ('D' não consulta / 'O'-'S' consultam, udmNF.pas:6666): a figura sobrepõe o CST e dirige o ST (prioridade sobre o caminho NCM/CFOP_ST). Smoke §25.4 (figura O → CST 20 da operação 'R' + ST). **Resíduo (precisa golden de figura):** o destaque de ICMS PRÓPRIO por figura (ICME/BCR do indexador sobrepondo `resolverAtual`) — hoje o ICMS próprio segue por alíquota; a figura dirige CST+ST.

**Adiado (F2c fase-2):** precificação-lê-empresa (simplesNacional/despOperacional/modoMargem — é a tela Produto, `uMargemPreco.pas:123`), destaque ICMS-próprio por figura (ICME/BCR, resíduo acima), **ST_da_nota** (o `calcularIcmsSt` retorna `VrICMSSTCalculado`=débito−crédito; a subtração de `GetVrICMSSTNotaFiscal` só importa em NF de entrada com ST já destacado → F6/importação, `uIndexadorTributario.pas:369-391`), **Lei 3166** (ES, `uIndexadorTributario.pas:314-329`; colunas já no indexador, sem golden), DIFAL (lib externa) e FCP-ST (alíquota não migrada).

**Dívida do ciclo de vida (validação cross-cutting 2026-06-30 — `docs/06-testing-quality/validacao-cross-cutting-2026-06.md`):** (a) **cancelar → estorno do FINANCEIRO ENTREGUE (F4b):** `CancelaFaturamento` (uNF.pas:6668/6802) wired em `nf-nfe.cancelar` gated por `ESTORNA_FINANCEIRO_NF` (default 'N' NÃO deleta, fiel; 'S' exclui títulos na mesma transação, best-effort se quitado). Contábil (`TIntegracaoContabil.Estornar` se `CONTABILIZADO='S'`+`INTEGRACAO='AUTOMATICA'`, uNF:6808) → **F5b** (depende do DIÁRIO). (b) **denegada `statusnfe='D'` — ENTREGUE (F3b):** o `reverter` foi liberado para `'D'` (a denegada é fiscalmente inválida e precisa voltar a editável) → estorna o estoque preso e LIMPA o status fiscal (statusnfe/chavenfe/protocolo_nfe = null) p/ reemissão; `contabilizado='S'` ainda bloqueia. O `SimuladorSefazProvider` ganhou o modo `SEFAZ_SIM_CSTAT` (força cStat 110/301/302/303) p/ exercitar o ramo D ponta-a-ponta. (c) **guardas de `faturar` — ENTREGUE (F3b):** bloqueia `statusnfe='D'` (NF_DENEGADA) e `'C'` (NF_CANCELADA). O `proc='S'` no faturar ficou como decisão de corte (faturar é ação explícita e independente no migrado; o acoplamento legado processar→financeiro é nota, não trava). (d) **reconciliação no `processar` — ENTREGUE (F3b):** `reconciliarTotais` recomputa os totais dos itens (mesma fórmula do `derivar`) e confere contra o header ±0,01 ANTES de mover estoque — TOTAL sempre (NF_TOTAL_DIVERGENTE), ICMS-ST só quando `figurafiscal='D'` (NF_ST_DIVERGENTE), fiel a `ValidaTotalICMSStNota` (uProcessaNotaFiscal.pas:564).

### F3 — ENTREGUE e verde (processamento: movimento de estoque, corte 1 = loja)
`POST /fiscal/nf/:id/processar` e `/reverter` (`NfProcessamentoService`, RBAC FRMNF/BTNPROCESSAR|BTNREVERTER). Migration `027_nf_processamento.sql` (ADD `produtos.geraqtde`, `nf_prod.geraestoque/movimenta_estoque`, `nf.dtprocessamento`; cria **`historico_prod`** kardex; seed RBAC). Numa **única transação**: lê/trava o header (`forUpdate`), por item (guardas `geraqtde & geraestoque & movimenta_estoque='S'`) move `ESTOQUE.QTDE` por `(idproduto,idempresa)` com **upsert relativo** (`qtde=qtde+delta`, nunca absoluto), `QTDEX=quantidade·fatorembal`, **entrada +/saída −** (estorno inverso); **negativo gateado por `PERMITE_PROC_NF_ESTOQUE_NEG`** (F3b, udmNF.pas:11643 — default golden **'S'** PERMITE, fiel ao legado; **'N'** bloqueia com rollback atômico; override por senha e escopo Grupo adiados); grava kardex; flip `proc` com **compare-and-set** (idempotente). Reverter exige `proc='S'` e **bloqueia se `statusnfe` enviado** (≠''/≠'T'). Auditoria confirmou paridade dos 4 casos de sinal + atomicidade + multi-tenant fail-closed + sem efeito financeiro/contábil/SEFAZ.

### ✅ RISCO RESOLVIDO — lost-update do saldo por caminho cruzado
**(corrigido, commit pós-F3).** `produto.aggregate.ts` regravava `estoque.qtde` no substitute (delete+insert) com o valor ABSOLUTO do cliente → lost-update do saldo movido pela NF. **Corrigido** com um hook genérico no engine de agregado: `DetalheConfig.preservar` + `chaveNatural`. No substitute, as colunas `preservar` (owned pelo banco) são lidas da linha existente **com `forUpdate`** (casadas por `chaveNatural`) e **carregadas adiante**, em vez de regravadas pelo dto. O detalhe `estoque` do Produto usa `preservar:['qtde'], chaveNatural:['idempresa']` → o cadastro **nunca** sobrescreve o saldo (owned pelo movimento NF/F3); só `minimo/maximo/local` são editáveis. Regressão no smoke: PUT de Produto com `qtde` obsoleta (88888) preserva o saldo do banco e aplica `minimo`. (`aggregate-engine.service.ts:preservarColunas`.)

### F4 — ENTREGUE e verde (faturamento: títulos ARECEBER/APAGAR, corte 1)
`POST /fiscal/nf/:id/faturar` (body `{numParcelas, primeiroVencimento, intervaloDias}`) e `/estornar-faturamento` (`NfFaturamentoService`, RBAC FRMNF/BTNFATURAR|BTNESTORNARFATURAMENTO). Migration `028_nf_faturamento.sql` (ALTER `areceber` +idnf/quitada/nrodup; CREATE `apagar`; ALTER `nf` +faturada; seed RBAC). Numa **única transação atômica** (ganho sobre o legado, que gerava título fora da transação): gera **N parcelas** como títulos em `areceber` (saída) / `apagar` (entrada), `idnf=codnf`, **rateio em CENTAVOS** (sobra na última → **Σ = TOTALNF ao centavo**), `dtvenc = primeiroVencimento + i·intervaloDias` (UTC), `nrodup = total de parcelas` (paridade legado; sequência na duplicata `NF-<codnf>-<i>/<N>`), `dtvenda` = DTCONTABIL (areceber)/DTEMISSAO (apagar). Idempotente (flag `nf.faturada` + CAS + checagem por `idnf`). Estorno = `DELETE por idnf` **bloqueado se houver título `quitada='S'`** (TITULO_QUITADO). Os títulos aparecem no **picker do Lote de Cobrança** (`GET /cobranca/areceber`). Auditoria: paridade de dinheiro OK (Σ ao centavo, modalidade, estorno seguro) + atomicidade/idempotência superiores ao legado.

**Paridade de campo pendente de golden (não-valor):** o **formato da duplicata** usa `codnf` (legado usa `NRONF`); a **sobra do rateio** vai na última parcela (a referência legível `GeraParcelas` põe na primeira; `BuildParcelas` real está em `FuncoesApollo.pas`, ausente); `consiliado='N'` (legado ARECEBER hardcoda 'S'). Σ é idêntica nos dois — confrontar `nrodup`/`duplicata` contra golden do Oracle antes de produção.

### ✅ Code-review de paridade (gap-analysis sênior, 5 agentes) — correções + adiados registrados
Revisão legado→migrado de TODO o complexo NF. **Efeitos (F3/F4): cópia fiel, 0 itens (C).** **Validações/eventos: gaps corrigidos ou registrados abaixo.**

**Correções aplicadas (viraram A):**
- **Lock de edição estendido** (`nf.aggregate.validar`): além de proc/contabilizado/P-D, agora bloqueia `cancelada='S'`, `statusnfe='C'` e `faturada='S'` — espelha `NotaEletronica`/`btnEditar` [uNF.pas:9950].
- **Guarda de EXCLUSÃO** (novo hook `AggregateConfig.validarRemocao` no engine; `nf.aggregate.validarRemocao`): impede apagar NF **processada/faturada/contabilizada/enviada/cancelada** — evitava estoque movido + títulos órfãos (DELETE genérico do CadMaster não tinha guarda) [uNF.pas:4072-4183 btnExcluir].
- **Devolução (finalidade='4') exige documento referenciado** [uProcessaNotaFiscal.pas:377]; **CFOP do item × cabeçalho (1º dígito)** [uItensNF.pas:2175]; **mensagem terceiros M55 completa** [uNF.pas:9435]; **BCR `numeric(13,4)`** (paridade de tipo, Oracle NUMBER(13,4)); comentário da guarda de estoque corrigido (guarda real = `GERAESTOQUE`; código é conservadoramente mais restritivo).

**Validações de gravar adiadas (B, com procedência — dependem de catálogo/UI não migrados):**
- **CFOP × SITUACAO_NF** (lista permitida) — cabeçalho [udmNF.pas:7900], item [uItensNF.pas:1479] e no processar [uProcessaNotaFiscal.pas:587]: exige catálogo SITUACAO_NF→CFOP (não migrado) → **F2b**.
- **CFOP × UF** (dentro/fora do estado) [uNF.pas:16633] → **F2b** (figura fiscal/UF).
- **Dia FECHADO** (período contábil) [uNF.pas:4565]: exige tabela `FECHAMENTO` (não migrada) → **F5/fechamento**.
- **Produtos "DIVERSOS" bloqueia gravar** [uNF.pas:17597] → **F1b** (niche).
- **Finalidade obrigatória** ("Selecione a finalidade") + coerência complemento/ajuste [uNF.pas:16675-16743] → **F1b** (hoje finalidade é opcional; default 'normal' na UI).
- **DTCONTABIL < hoje (confirmação)** [uNF.pas:4556] → **UI** (confirmação, não-bloqueante).
- **Nota de complemento** (sem valor de produto + exige referência) [uProcessaNotaFiscal.pas:388] → **F2b/processar**.

**Eventos/menu adiados (B, com procedência):** Clonar/Transferência/Devolução (`ClonaNF 1/2/3/4`) [uNF.pas:15152+]; transformar **Entrada↔Saída** (`NotadeSada`) [uNF.pas:15166]; gerar nota de complemento [uNF.pas:11663]; **espelho/impressão/DANFE/etiquetas** [uNF.pas:14616/14711/14646]; sincronizar CFOP cabeçalho→itens [uNF.pas:16401]; liberar NF do indexador [uNF.pas:17780]; registros de log / análise de item [uNF.pas:14759/2810] — **F2b/F6/relatórios**.

**Divergências de campo registradas (valor correto; reconciliar com golden):**
- **Chave de duplicidade**: legado tem 2 checks (NRONF+IDEMPRESA+CODPARCEIRO+SERIE+TIPOEMISSAO='0'; e CODPARCEIRO+NRONF+MODELO=55+SERIE+IDEMPRESA+TIPOEMISSAO) [uNF.pas:4735/4761]; o corte-1 usa (nronf+serie+modelo+idempresa+tipo+codparceiro) — aproximação (sem TIPOEMISSAO; `tipo` E/S em vez de `modelo=55` fixo).
- **Colunas `icms`/`icme` por item**: legado `NF_PROD.ICMS`=efetiva, `ICME`=destacada [uItensNF.dfm:3894/3982]; o migrado usa naming intuitivo (icms=destacada, icme=efetiva). O **VALOR `vricm` está correto**; o F6/SPED deve mapear.
- **Fiscal**: `NF_IMPORTACAO_NFE='S'` suprime o cálculo (preserva o XML) [udmNF.pas:4001]; **snap ±0,01** aos valores do XML (`ICMS_NOTA_*`) [udmNF.pas:4204] → **F6/importação**.

**Efeitos — fiéis (B menores):** `CLAVEGOS` (saldo_kg pecuária) [trigger:529] e `HISTORICO_FLEX` (comissão flex) [trigger:533] — módulos específicos (frigorífico/comissão); ESTOQUE_DEP/PROD/almox/congelado/composição/decomposição já listados.

**Conformidade ADR-012 (FECHADA):** o **golden foi capturado e confrontado** (PINHEIRAO, V$SQL acessível) — ver "### Golden — confronto e correções". §4 SQL-por-query `[runtime]` (V$SQL real), §8 mapa de teclado (do .dfm) e §9 casos golden estão registrados ali. Status promovido de `paridade-verde de resultado` para **`paridade certificada por golden`** (corte-1). Resíduos (deep-fiscal) ficam como F2b/F3b/F4b golden-backed, abaixo.

### F5 — ENTREGUE e verde (contábil: rateio CODCONTABILNF por centro de custo, corte 1 = config armazenada, SEM efeito)
Rateio contábil `CODCONTABILNF` como **detalhe 1:N do agregado da NF** (chave `contabil`), gravado na **mesma transação** do master pelo `AggregateEngineService` (create/substitute/cascata) — **config pura, sem service stateful, sem efeito colateral**. Migration `029_nf_contabil.sql`: `CREATE TABLE plc` (catálogo do **centro de custo gerencial**, PK `codplc`, +`get_plc` view + seed) e `CREATE TABLE nf_contabil` (`codcontabilnf` PK seq; `codnf` FK ON DELETE CASCADE; `idsituacao_nf` FK situacao_nf; `codcc` FK plc; `valor`; `adicional` DEFAULT 'N'; `tipovalor`; `insert_manual` + index); RBAC `FRMCADCENTROCUSTO`. Lookup declarativo `plc.crud.ts` (chave natural, `pkGerada:false`). Web: `ContabilSection`+`ContabilModal` em `NfCadMaster` (sub-grid `useFieldArray('contabil')` + lookups situação/centro-de-custo + `CurrencyField`, total corrente Restante/Excedido como dica visual). Auditoria: 2 auditores — **config-pura confirmada (não move estoque, não gera título, NÃO grava DIÁRIO nem seta CONTABILIZADO); F1–F4 intactas.** Verde: **API 123, web 25, smoke 111/0.**

**Decisão-chave de paridade — soma = TOTALNF é ADVISORY (não bloqueia o save):** o legado [uLancamentoContabilNF.pas:481-496] só **pinta o "Valor restante/excedido"** num label (sem `Abort`) — o rateio desbalanceado **grava normalmente**. Confirmado no Oracle: **172 de 22.014 NFs reais têm Σ rateio ≠ TOTALNF**. A 1ª iteração elevou a soma a validação dura no save; o code-review adversarial (Auditor 1, ALTA) flagrou que isso **rejeitaria 172 NFs legado-válidas** → revertido para **advisory** (preview na UI; back aceita 201) por mandato "cópia fiel". **Permanecem HARD** (verbatim do legado, esses sim com `Abort`): situação obrigatória [L366], centro de custo obrigatório [L373], **par (IDSITUACAO_NF, CODCC) único** [L398] ("Este centro de custo já está informado").

**CODCC = PLC, não PLANO_CONTAS (recon resolveu a ambiguidade):** `CODCONTABILNF.CODCC → PLC.CODPLC` (Plano de Contas **Gerencial** / "centro de custo", 376 linhas) — **não** uma tabela CENTRO_CUSTO nem o `PLANO_CONTAS` formal. O `PLANO_CONTAS` (partida dobrada) só entra no **DIÁRIO** (o efeito, adiado). Cadeia: `CODCONTABILNF.CODCC → PLC.CODPLC → (PLC.CODCONTABIL → PLANO_CONTAS)` — só o 1º elo é F5.

**Adiados de config do rateio (B, com procedência — nada perdido):** **DIÁRIO / partida dobrada** (`TIntegracaoContabil.Integrar` — débito/crédito, `PLANO_CONTAS`, conta do parceiro, `SituacaoDebitoAutomatica`, condição `Empresa.INTEGRACAO='AUTOMATICA'`+`TIPO='E'`, **set de `NF.CONTABILIZADO='S'`**) → **F5b/efeito**; **CX_APAGAR/CAIXA por centro de custo** (`GeraCxApagar`/`GerarLancamentosDeCaixa` — depende do rateio que a F5 entrega) → **F4b/F5b**; **auto-popular linhas** a partir de `SITUACAO_NF_PLC` (`InserirCentroDeCustosDefinidos`) e **restrição de CCs permitidos por situação** (`GetCentrosCustosPermitidos`) → **F5b** (refino UX); **`SituacaoDeBonificacao`/coluna `ADICIONAL`** (linha de adicional/bonificação) e **máx-1-linha em saída** → **F5b**; **coluna `CODCONTABIL`** em PLC (elo ao `PLANO_CONTAS` formal; 100% null no recorte) e **`PLANO_CONTAS` formal** → **F5b**; **Dia FECHADO** (`FECHAMENTO`, período contábil) [uNF.pas:4565] → **F5/fechamento**.

### F6 — ENTREGUE e verde (NFe mod.55: transmissão/cancelamento/CCe atrás da PORTA SEFAZ, corte 1)
A camada **portável** da emissão fiscal eletrônica (NFe modelo 55, retaguarda), com a transmissão real **isolada atrás de uma porta** (`SefazPort`) — espelha a decisão §8 ("o app não fala SEFAZ direto") e o reuso a jusante da F2. Recon por 4 agentes (emissão+máquina de estados / eventos / modelo Oracle real / monorepo). **Três operações stateful** no molde F3/F4 (`@Controller('fiscal/nf')` + `@Post(':id/ação')` + `@HttpCode(200)` + `AcessoGuard`/`@RequerAcesso` + transação `forUpdate` + CAS + `currentTenant` + `BusinessRuleError`→422 + CODE_PT), em `nf-nfe.service.ts`/`nf-nfe.controller.ts`:
- **Transmitir** (`POST /fiscal/nf/:id/transmitir`): pré-cond fiéis (modelo=55, não-cancelada, statusnfe vazio, nronf/itens/destinatário/valor — **sem inventar `proc='S'`**, que o legado não exige); gera a **chave de acesso 44 díg + DV mód 11** (`packages/shared/validators/chave-nfe.ts`: `montarChaveNfe`/`chaveNfeValida`, 12 testes); chama a porta; **CAS** (`WHERE statusnfe IS NULL`) grava `chavenfe`/`protocolo_nfe`/`statusnfe='P'`/`confirmada='S'`; grava `nfe_xml` + `historico_envio_nfe`(tipo='S'). Idempotente (2ª vez → `NF_JA_TRANSMITIDA`).
- **Cancelar** (`/:id/cancelar`, justificativa ≥15 — verbatim `NFe.pas:4397`): exige autorizada (`statusnfe='P'`), CAS P→C grava `statusnfe='C'`+`cancelada='S'`+`protocolo_cancelamento`+`xjust`, evento `nfe_evento`(110111). **NÃO reverte estoque/financeiro/contábil** (`NFe.pas:254-297` — cancelar é puramente fiscal; **invariante provada no smoke**).
- **Carta de correção** (`/:id/cce`, texto ≥15 — verbatim `uCartaCorrecao.pas:54`): exige autorizada, **máx 20/nota** (`NFe.pas:332`), `nSeqEvento = MAX(seq)+1`, evento `nfe_evento`(110110).

**Máquina de estados (fiel ao Oracle real):** `STATUSNFE` `''`(rascunho)/**P**(autorizada)/**C**(cancelada)/**D**(denegada); mapeamento `cStat→status` na porta (`GetStatusNFE`: 100/539/204→P; 101/151/155/218→C; 110/301/302/303→D). As travas de edição/exclusão (`nf.aggregate.validar`/`validarRemocao`) já cobriam P/D/C desde a F1.

**Migration `030_nf_nfe.sql`:** `empresa_fiscal` (config mínima da chave: CNPJ/UF/cUF/série/ambiente — **sem certificado/senha**, passivo de segurança adiado); `nfe_evento` (UNIFICA cancel+CCe, como o NFE_EVENTOS legado; UNIQUE(codnf,tipo_evento,seq_evento)); `nfe_xml` (fiel a NFE_XML); `historico_envio_nfe` (fiel). A tabela `nf` **não muda** — já nasceu (F1) com as colunas NFe. RBAC FRMNF/BTNTRANSMITIR|BTNCANCELAR|BTNCCE.

**Fronteira/Simulador (decisão do usuário — AskUserQuestion):** o corte 1 pluga o **`SimuladorSefazProvider`** (homologação): devolve cStat de sucesso determinístico, marca **`simulado='S'`** + `ambiente='2'` nos registros, comentário gritante + gate por env `SEFAZ_PROVIDER`. **Nenhuma NFe é autorizada na Receita** — os registros servem a homologação/demonstração. O provider real (ACBrLibNFe / lib NFe Node / microserviço) implementa a mesma `SefazPort` e pluga sem tocar no service. Web: `NfeSefazSection` em `NfCadMaster` (chave + badge de status + Transmitir/Cancelar/CCe com justificativa, aviso de simulado) + `nfNfeApi.ts`. **2 auditores adversariais** (paridade vs legado + fronteira/segurança) — vereditos globais positivos (DV verificado correto em 100k casos por reimplementação independente; invariante de cancelamento fiscal-only confirmada lendo `UpdateNFE` inteiro; fronteira isolada/simulador honesto/integridade transacional fiel ao molde F3/F4). **Correções aplicadas das auditorias:** (1) **gating real por env** `SEFAZ_PROVIDER` no `cadastro.module.ts` (`useFactory`: default simulador, **proíbe simulador em produção**, recusa provider desconhecido) — o comentário antes era ficção; (2) **`statusFromCstat`** (= `GetStatusNFE` legado) extraído p/ helper puro/testado em `@apollo/shared` (a peça portável que faltava — o simulador agora o usa como fonte única); (3) `empresa_fiscal` **fail-closed** também em cancelar/CCe (evita CNPJ vazio/ambiente assumido com o provider real); (4) `ver_aplic`/`id_evento` em `nfe_evento` (metadados de retorno do legado); (5) CAS de transmitir tolera `statusnfe=''` (injeção no create); (6) guarda `nNF>9 díg`→`NF_CHAVE_INVALIDA` (chave nunca truncada em silêncio); (7) `mensagem` do histórico com `slice(255)`; (8) golden DV congelado + comentários "verbatim" corrigidos p/ "normalizado" (legado diz "dígitos"/tem typo "caracters"). Verde: shared 74, **API 123, web 25, smoke 126/0**.

**Adiado da F6 (F6b/externo — dossiê §8/§10, com procedência):** **transmissão real à SEFAZ** (SOAP ve400, geração + assinatura A1/A3 do XML, validação XSD, rejeições 528-806) = o provider real que substitui o Simulador (que já usa `statusFromCstat` p/ mapear o cStat real); **trilha de erro de envio** (`historico_envio_nfe` tipo='E' numa gravação autônoma fora da transação quando a porta falhar — hoje o simulador nunca falha, então só faz sentido com o provider real); **XJUST no cancelamento** é gravado sempre (o legado só gravava em contingência — melhoria de auditoria, registrada); **config de certificado** (CERTIFICADO/CERTIFICADO_SENHA/CSC em EMPRESAS — senha em claro = passivo → vault) + migração de EMPRESAS; **DANFE** (PDF mod.55 / térmico ESC-POS mod.65) e **e-mail** (SMTP do XML+DANFE, flag ENVIANFE); **inutilização de faixa** (`NFE_INUTILIZADA` — ~100% PDV/NFC-e); **NFC-e mod.65** (emitida no PDV); **consulta de situação** (`ConsultaNFE`), **contingência real** (tpEmis SVC 6/7), **manifestação do destinatário** (ciência/confirmação — NFE_EVENTOS 210xxx, fluxo de entrada).

### Golden — confronto e correções (ADR-012 §4/§8/§9 — FECHADA)
Captura de golden no Oracle real (PINHEIRAO, read-only, **V$SQL acessível**) + 3 auditorias de transcrição (legado→migrado, por camada) + 1 agente de golden. Confrontou a SAÍDA dos motores migrados contra DADOS REAIS.

**§9 — Golden vectors confirmados FIÉIS (dados reais):**
- **Chave de acesso / DV mód 11:** **5000/5000 chaves reais passam** + 3 ancoradas no teste (`chave-nfe.spec.ts`): `31200866312653000114550010005599791528020227` (DV 7), `…815729057` (DV 7), `…045077624` (DV 4). Chave é **nua (44 díg, sem prefixo 'NFe')** — como o migrado guarda. Layout cUF/AAMM/CNPJ/mod/serie/nNF/tpEmis/cNF/DV confirmado (SUBSTR bate com MODELO/SERIE/NRONF).
- **TOTALNF** (21 notas): `= TOTALPROD − TOTALDESC + FRETE + SEGURO + ACESSORIAS + IPI + ICM_ST` — **TOTALICM NÃO entra** (embutido no preço). 19/21 batem na fórmula base; os 2 desvios só ADICIONAM `TOTAL_FCP_VALOR_ST` e `TOTALIPI_DEVOLUCAO` (→ F2b). Fórmula do migrado FIEL.
- **Estoque:** sinal E+/S− e estorno inverte (kardex `HISTORICO_PROD`: `QTDE_ALTER` com sinal, `QTDE_ATUAL`=saldo pós-move); **`QTDE_ALTER = QUANTIDADE×FATOREMBAL`** (20×16=320). Migrado FIEL.
- **Rateio F5:** Σ VALOR=TOTALNF em ~99% (1% diverge) e **sem Abort** no legado → o **advisory do migrado é a escolha FIEL** (o 1% prova que não é enforçado). Par (situação,CC) único confirmado.
- **CCe / cancelamento / statusFromCstat:** regras (≥15, máx-20, nSeqEvento; conjuntos cStat) confirmadas.

**§4 — SQL runtime (V$SQL real do legado):**
- Duplicidade (entrada): `WHERE CODPARCEIRO=? AND NRONF=? AND MODELO='55' AND SERIE='001' AND IDEMPRESA=? [AND TIPOEMISSAO=?]`; (saída): `lpad(NRONF,12,'0')=? AND CODPARCEIRO=? AND IDEMPRESA=? AND lpad(SERIE,3,'0')=? AND TIPO='S'` → tupla de identidade **(IDEMPRESA, CODPARCEIRO, MODELO, SERIE, NRONF, TIPOEMISSAO)**.
- Status: `UPDATE NF SET CODNFSTATUSPRO=? WHERE CHAVENFE=? AND IDEMPRESA=?`; `NF_STATUS_PROCESSO` junta por `NF.CHAVENFE`.
- ICMS de **saída** vem de `multi_preco.ALIQUOTASAIDA` (por idproduto).

**§8 — Mapa de teclado (extraído de `uNF.dfm`):** F-keys (captions): **F1**=Calcular · **F3**=Importar venda/pedido · **F4**=Base ICMS · **F5**=Total dos produtos · **F6**=Produtos com ST · **F7**=Centro de custo · **F9**=Financeiro. Menu Ctrl+letra (ShortCut 16453/16457/16460/16462/16463/16468) = **Ctrl+E/I/L/N/O/T**. `OnShortCut=FormShortCut` (global) + `OnKeyDown` por campo (edtCodParceiro/grid itens/edtCFOP — Enter-avança).

**Correções de transcrição aplicadas (golden/auditoria → fix + verde):**
- **`cancelar` ESTORNA o estoque** quando a NF está processada (golden: NF cancelada tem kardex net-0 via estorno compensatório `NF-CANC`; o `reverter` é bloqueado em nota enviada, então o estorno só vem do cancelamento) — `nf-nfe.service.ts`→`NfProcessamentoService.estornarEstoquePorCancelamento` (mesma transação). [golden]
- **Transmitir exige `PROC='S'`** (uNF.pas:8273 — o botão só habilita processada) → `NF_NAO_PROCESSADA`.
- **Guarda de TERCEIROS** (`TIPOEMISSAO='1'`) na transmissão (uNF.pas:10761) → `NF_TERCEIROS_NAO_TRANSMITE`.
- **Guarda `CONTABILIZADO='S'`** no reverter (F3), estornar e faturar (F4) (uNF.pas:8951).
- **Chave de duplicidade**: removido `TIPO` (que o legado não usa), incluído **`TIPOEMISSAO`** (V$SQL) — default '0' no validar (espelha o DEFAULT da coluna).
- **`statusFromCstat`** (= `GetStatusNFE` NFe.pas:2792) extraído p/ helper puro/testado em `@apollo/shared` (peça portável que faltava; o Simulador o usa como fonte única).
- **Gate de cStat de sucesso** (transmitir P/D; eventos 135/136) antes de persistir/flipar (NFe.pas:383) → `NF_SEFAZ_ERRO`.
- **`TOTALDESC`** = SUM de um único campo de desconto-valor (não somar `desconto`+`vrdescprod` — dupla contagem; legado SUM(VRDESCPROD)).
- **`TOTALISENTO`** disparado por `ALIQUOTA='IST'` (udmNF.pas:4169), não por CST 40/41.
- **Formato da duplicata** = `"<NRONF> - NNN/NNN"` (golden; referencia NRONF, não CODNF).
- **Guarda de movimento de estoque** = 2 flags `GERAESTOQUE & MOVIMENTA_ESTOQUE` (fiel à trigger; removido o `PRODUTOS.GERAQTDE` extra que podia pular movimento).
- Gating real por env `SEFAZ_PROVIDER` (era ficção no comentário); `empresa_fiscal` fail-closed em cancelar/CCe; `ver_aplic`/`id_evento` em `nfe_evento`; CAS tolera `statusnfe=''`; guarda `nNF>9 díg`. Verde: shared 75, **API 123, web 25, smoke 127/0**.

**Resíduos golden-backed (deep-fiscal; F2b/F3b/F4b — valor do corte-1 OK, representação/escopo a fechar no cutover):**
- **F2 base/alíquota (representação):** o legado armazena `VRBASECALCULO = QUANTIDADE×VRCUSTO×BCR/100` (entrada; BCR≈100, NÃO é redução) e `VRICM = VRBASECALCULO×ICME/100` (alíquota **EFETIVA**). O migrado computa base **reduzida** × alíquota **cheia** — **o VRICM é algebricamente equivalente** (base_red×icm_cheia = base_cheia×icm_efetiva; provado no T20), mas o VRBASECALCULO/TOTALBASEICM ficam na representação reduzida. Reconciliar no F2b (+ entrada usar VRCUSTO; IPI base = custo bruto; saída via `multi_preco.ALIQUOTASAIDA`). [golden]
- **F4 `txjuros`:** legado semeia da **`EmpresaTXJUROPADRAO`** (udmCadAReceber.pas:214), não do parceiro — corrigir no cutover de EMPRESAS (não migrada); não afeta o VALOR das parcelas. [auditoria]
- **F4 multi-parcela:** o golden é ~100% parcela única (Σ=TOTALNF) — a regra da sobra (1ª vs última) e `NRODUP` multi-parcela **não ancoráveis** nesta base; validar no cutover. [golden]
- **F3 `geraestoque` default:** trigger usa `COALESCE(...,'N')`; o migrado default `'S'` (pragmático) — o correto é DERIVAR `geraestoque` da config do produto (F3b), não flipar o default (quebraria o movimento). [auditoria]
- **F1 totais:** `TOTAL_FCP_VALOR_ST` + `TOTALIPI_DEVOLUCAO` são addends extras do legado (FCP-ST/devolução) → F2b.
- **`nf.xjust` no cancelamento:** gravado (auditoria a mais — o legado reserva XJUST p/ contingência; a razão também fica em `nfe_evento.texto`). Divergência menor consciente.

### Adiado (documentado, nada perdido)
- **F4b financeiro (refino):** CAIXA/CX_APAGAR (movimento de caixa/centro de custo); gate **automático por CFOP** (`GERA_FINANCEIRO_AUTO`/`PROC_FINANCEIRO` — corte-1 é ação explícita); **retenções/FunRural/acordo comercial** (títulos acessórios); **deduções da base** (bonificado/retenções/desc.acordo/desc.pedido — corte-1 base=TOTALNF); NF_FORMA_PAGAMENTO (NFC-e/TEF); **agrupamento**; **dia-fixo** de vencimento (`venc_prev`/`tcDiaFixo`); duplicata modelo 01 (`nroDup/AA/letra`); dois gates de config do estorno (`ESTORNA_FINANCEIRO_NF`/`ESTORNA_FINANCEIRO`).
- **F3b estoque (refino):** ORIGEM `'D'` (ESTOQUE_DEP), `'P'` (ESTOQUE_PROD), `'X'` (almoxarifado) e origens dinâmicas; estoque por **local** (CODESTOQUE_LOCAL) e **congelado** (`*_CONG`/`GETEMPRESAETQCONG`); **composição** (trigger `ESTOQUE_NOTAS_COMPOSICAO` — baixa componentes) e **decomposição** (rateio %); **autorização de negativo por senha** (`PERMITE_PROC_NF_ESTOQUE_NEG`/supervisor); gate **`ALTERAESTOQUEREVERSAO`** + config `ALTERA_ESTOQUE_REVERSAO_NF` (reverter sem mexer no estoque); conferência por coletor; colunas auxiliares `DTVENDA/QTDE_VENDA`/`DTENT/QTDE_ENT`; conflação `origem_estoque`(CST) × balde de estoque (limpar).
- **F2b fiscal (refino):** MVA **ajustado** interestadual (`GetMVAAjustado:276`); redução de BC-ST (REDCOM) e BC própria encadeada; ST a recolher **SN-vs-LR + crédito + Lei 3166**; **rateio fino** (`RateioNota`); **figura fiscal completa** (CFOP derivado/CSOSN); **modo-truncar** (flag `ARREDONDA` por item — hoje `round2` half-up, divergência ≤1 centavo); gate `APROVEITAMENTO_CREDITO_ICMSST_NF` (config por tenant); `DEPSACESS` separado de `vroutrasdesp`; colunas `MARKUP` (precificação) e NF_PROD_LOTE; serviço/ISS.
- **F4 financeiro / F5 contábil:** FATURAMENTO→ARECEBER/APAGAR (IDNF), `DELETE FROM DIARIO` no estorno — no legado nem são atômicos com o estoque.
- **DIFAL/partilha + FCP/FCP-ST** (lib externa `TICMSUFDest`) → F2b/F3+.
- **PIS/COFINS valor** fiscal → SPED (fase própria).
- **F3 estoque:** flip PROC→estoque (trigger `ESTOQUE_NOTAS` fiel: sentido/origem/decomposição/composição/reversão) — liga ao Produto F5.
- **F4 financeiro:** FATURAMENTO → ARECEBER/APAGAR (parcelas/condição pgto/retenções/funrural/acordo), NF_FORMA_PAGAMENTO, exclusão/trava de baixa.
- **F5 contábil:** CODCONTABILNF + DIARIO (depende de plano de contas/integração).
- **F6 SEFAZ — corte 1 ENTREGUE** (transmitir/cancelar/CCe mod.55 atrás da porta; ver "### F6 — ENTREGUE"). **Adiado (F6b/externo):** transmissão real (ACBr→serviço dedicado/SOAP ve400/XSD/assinatura A1), config de certificado+EMPRESAS, DANFE, e-mail, inutilização (`NFE_INUTILIZADA`), NFC-e mod.65 (PDV), consulta de situação, contingência real, manifestação do destinatário (NFE_EVENTOS 210xxx), `NF_STATUS_PROCESSO` (workflow de entrada).
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
