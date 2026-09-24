# Auditoria de travas inventadas — G1 COMPRAS/FISCAL

Data: 24/09/2026. Fonte do legado: `/Library/SicomGit/retaguarda-master/fonte` (snapshot mai/2020). Evidência: Oracle de
PRODUÇÃO, só leitura (`q.py`). Rascunhos e extrações em `scratchpad/aud/g1/`.

Configs de produção lidas (CONFIGURACOES, sem valor específico por empresa): `ESTORNA_FINANCEIRO_NF=N`,
`ESTORNA_FINANCEIRO=N`, `PERMITE_EXCLUIR_FINANCEIRO_DA_NF=S`, `ALTERA_ESTOQUE_REVERSAO_NF=S`,
`LIBERA_DIGITACAO_NF_TERCEIROS=S`, `BLOQUEIA_ENVIO_NF_SAIDA=N`. `EMPRESAS.INTEGRACAO='AUTOMATICA'` em 4 das 5 empresas
(1, 2, 51, 52). Triggers de NF/pedido em produção (`ESTOQUE_NOTAS`, `AUDIT_NF`, `AUDIT_PEDIDOCOMPRA_I`,
`AUDIT_PEDIDO_COMPRA_QTDE`): nenhuma tem `RAISE_APPLICATION_ERROR`. Nenhum objeto do banco cita `BLOQ_NF`.

---

### FRMNF (58.849 acessos) — services: `cadastro/nf.aggregate.ts`, `nf-processamento.service.ts`, `nf-faturamento.service.ts`, `nf-contabilizacao.service.ts`, `nf-nfe.service.ts`, `nf-vendas.service.ts`, `nf-scrap.service.ts`, `nf-devolucao-vendas.service.ts`, `nf-lote.service.ts`, `compras/recebimento.service.ts` (refaturar-xml)

| # | Guarda (arquivo:linha — código/condição) | Classe | Âncora no legado | Evidência em produção 2025/2026 | Recomendação |
|---|---|---|---|---|---|
| 1 | nf.aggregate.ts:167 — editar com `proc='S'` → NF_PROCESSADA | a | uNF.pas:3915 "Nota já Processada! Para edita-lá é necessário Reverter Processamento." + btnGravar uNF.pas:4504 | — | manter |
| 2 | **nf.aggregate.ts:168 — editar com `faturada='S'` → NF_TEM_FATURAMENTO** | **c** | nenhuma. `btnEditarClick` (uNF.pas:3905-4004) só barra CONTABILIZADO, PROC e dia FECHADO; com financeiro só desabilita o `btnGerarFin` (:3974-3976). Procurado também em btnGravarClick (:4489), NotaEletronica (:15265), edtCodigoExit (:9855-9965) | NF de entrada editada **antes do processamento e com A Pagar (IDNF) já criado**: **2025: 4.436 edições em 2.612 NFs; 2026: 5.816 edições em 3.388 NFs** (LOG 'Notas fiscais de entrada', edições que não são PROC/CONTABILIZADO/STATUSNFE, estado PROC reconstruído pelos flips do LOG). É o fluxo principal: a NF importada do XML já nasce com o A Pagar e o operador ajusta RATEIO/CFOP/ICMS depois. No Apollo o import auto-fatura (`recebimento.service.ts:476` → faturada='S'), e aí a nota fica congelada | **remover** |
| 3 | nf.aggregate.ts:169 — editar com `contabilizado='S'` → NF_CONTABILIZADA | a | uNF.pas:3909 "Documento contabilizado. Não é permitido editar." | — | manter |
| 4 | nf.aggregate.ts:170-171 — editar com `cancelada='S'`/statusnfe C, P ou D → NF_CANCELADA / NF_ENVIADA | a-parcial | `NotaEletronica` (uNF.pas:15265: CHAVENFE<>'' e NF_IMPORTACAO_NFE não S/T e STATUSNFE<>'' e TIPOEMISSAO=0) desabilita btnEditar/btnExcluir (uNF.pas:9950-9953) | escopo: o legado libera a própria **importada** (NF_IMPORTACAO_NFE S/T) com P: 4 NFs de saída em 2025-26. Entrada de terceiros nunca tem P/C/D | manter (opcional: liberar NF_IMPORTACAO_NFE S/T) |
| 5 | nf.aggregate.ts:176-177 e :291 — período contábil fechado (`periodo_contabil.bloq_nf`) no editar e no excluir → PERIODO_FECHADO | dúvida (c no fonte 2020) | nenhuma no fonte 2020: o grep por `BLOQ_NF`/`PERIODO_CONTABIL` em todo o fonte não acha nada ligado à NF. O que o legado checa é o **dia FECHADO** na tabela `FECHAMENTO` (uNF.pas:3930-3940, 4088-4096, 4565-4572, 8983-8991), que o Apollo não checa. A coluna `PERIODO_CONTABIL.BLOQ_NF` existe na produção (binário novo) | efeito nulo hoje: os 3 períodos da produção estão com STATUS='N'. Obs.: `PERIODO_CONTABIL` da produção **não tem coluna CODEMPRESA** (o Apollo filtra por `codempresa`) | manter (efeito nulo); ver "Observações" sobre a tabela FECHAMENTO |
| 6 | nf.aggregate.ts:204 — chave fiscal duplicada → NF_DUPLICADA | a | uNF.pas:4735-4761 (RetornarValores NRONF;IDEMPRESA;CODPARCEIRO;SERIE;TIPOEMISSAO) | — | manter |
| 7 | nf.aggregate.ts:218 / :240 / nf-cfop-situacao.ts:46 — CFOP fora da situação da NF/item | a | `validaCFOP_SituacaoNF` (uNF.pas:4527); processamento `ValidaSituacoesDosCFOPs` (uProcessaNotaFiscal.pas:586-618) | — | manter |
| 8 | nf.aggregate.ts:250 — base de cálculo acima de 100% na saída sem PERMITE_BASECALC_MAIOR100 | a | uItensNF.pas:1561-1566 "O valor da base de cálculo do ICMS é maior que 100%!" | — | manter |
| 9 | nf.aggregate.ts:286-290 — excluir processada / com financeiro / contabilizada / cancelada / enviada | a | btnExcluirClick uNF.pas:4078 (processada), :4083 (contabilizada), :4099-4105 (numeração gerada), :4108-4121 (`VerificaExisteBaixas`/`ExisteFinanceiro`) | — | manter |
| 10 | nf.aggregate.ts:302 — excluir NF referenciada por outra → NF_REFERENCIADA | a | uNF.pas:4134-4158 "Não é possível excluir esta nota, pois está sendo referenciada…" | — | manter |
| 11 | nf-processamento.service.ts:89 — sincronizar CFOP com `proc='S'` | a | uNF.pas:16407 "Nota fiscal já está processada, não permite alterações no CFOP dos itens!" | — | manter |
| 12 | **nf-processamento.service.ts:90 — sincronizar CFOP com `faturada='S'`** | **c** | nenhuma: o menu (uNF.pas:16401-16410) só checa PROC | mesmo universo do #2 (NF não processada com A Pagar) | **remover** |
| 13 | nf-processamento.service.ts:91-94 — sincronizar CFOP contabilizada/cancelada/enviada/período | d | na prática implicam PROC='S' (contabilizar exige PROC='S'; transmitir exige PROC='S'; reverter enviada é barrado), então não barram nada que o #11 não barre | — | manter |
| 14 | nf-processamento.service.ts:144 — reverter enviada (statusnfe ≠ T, ≠ D) → NF_ENVIADA | a | ReverteProcessamento uNF.pas:8937-8946 "Nota fiscal já enviada para receita." (o legado barra também D; o Apollo é mais frouxo) | — | manter |
| 15 | **nf-processamento.service.ts:149 — reverter com `faturada='S'` → NF_TEM_FATURAMENTO** | **c** | nenhuma: o legado reverte e chama `CancelaFaturamento(...,'R')` (uNF.pas:9171-9172). Com `ESTORNA_FINANCEIRO_NF='N'` (produção) **mantém os títulos e registra pendência** (`AdicionaPendenciaFinanceiro`, uNF.pas:6715-6719); com 'S' exclui se não houver baixa (:6680-6711) | reversões (LOG PROC S→N) com A Pagar/A Receber da NF já existente: **2025: 295 de 800** (276 entrada + 19 saída); **2026: 151 de 445** (140 + 11). Em 225/110 delas algum título está quitado hoje, então nem o "estorne antes" do Apollo funciona (o estorno recusa TITULO_QUITADO) | **remover**: seguir `CancelaFaturamento` (N → mantém e registra pendência; S → exclui se sem baixa, senão avisa e mantém) |
| 16 | nf-processamento.service.ts:155 — reverter contabilizada com empresa não AUTOMATICA | a | uNF.pas:8949-8954 "Documento contabilizado. Não será possível reverter o processamento." | — | manter |
| 17 | nf-processamento.service.ts:224 — processar com TOTALNF ≠ total recalculado dos itens → NF_TOTAL_DIVERGENTE | c-escopo | o legado só confere o **ICMS-ST** (e só com FIGURAFISCAL='D'): `ValidaTotalICMSStNota`, uProcessaNotaFiscal.pas:564-585. Nenhuma checagem de TOTALNF nas 30+ validações de uProcessaNotaFiscal.pas nem em uNF.pas | NF digitada no Apollo não cai (o `derivar` recalcula o total). Cai a NF migrada revertida e reprocessada sem regravar: o TOTALNF do cabeçalho não fecha com a fórmula em **643 de 9.221 NFs de entrada (2025) e 459 de 6.497 (2026)** — e há ~800 reversões/ano | reduzir escopo: manter só o ST (#18); o total vira aviso |
| 18 | nf-processamento.service.ts:229 — ICMS-ST divergente com FIGURAFISCAL='D' | a | uProcessaNotaFiscal.pas:573 "Valores do ICMS ST divergentes do calculado." | — | manter |
| 19 | nf-processamento.service.ts:297 — estoque negativo no estorno por cancelamento | a | config `PERMITE_PROC_NF_ESTOQUE_NEG` (udmNF.pas:11643); o Apollo também depende da config | — | manter |
| 20 | nf-faturamento.service.ts:69 — faturar cancelada | a/d | NF cancelada não tem faturamento pendente (o cancelamento chama `CancelaFaturamento`, uNF.pas:6802) | — | manter |
| 21 | nf-faturamento.service.ts:70 — faturar DENEGADA → NF_DENEGADA | c | **inversa**: btnFaturamentoClick (uNF.pas:4336-4340) exige, para a própria, STATUSNFE **'P' ou 'D'**, ou seja, libera a denegada | 0 NFs com STATUSNFE='D' em 2025-26 | remover (impacto nulo) |
| 22 | **nf-faturamento.service.ts:71 — faturar com `contabilizado='S'` → NF_CONTABILIZADA** (vale também para refaturar-xml, `recebimento.service.ts:489-`) | **c** | nenhuma: btnFaturamentoClick (uNF.pas:4332-4374) e uFaturamento2.pas não olham CONTABILIZADO. E a ordem do legado é a oposta à do Apollo: o processar **gera o financeiro e só depois integra o contábil** (udmNF.pas:7772-7788: GerarAPagarDeRetencoes → GerarFinanceiroAutomaticamente → `TIntegracaoContabil.Integrar`). O Apollo contabiliza no processar (`nf-processamento.service.ts:56`, tentarContabilizar) sem gerar financeiro, e aí o F4 fica barrado | NFs de entrada contabilizadas cujo A Pagar nasceu **no processamento ou depois dele**: **2025: 5.409; 2026: 2.716** (4.759/2.309 em ≤ 60 s = dentro do próprio processar; 121/42 mais de 10 min depois, já contabilizadas). No Apollo, toda NF que o import não auto-faturou (CFOP sem `gera_financeiro_auto`, ou sem `<cobr>`) só fatura depois de estornar o contábil | **remover** (ou gerar o financeiro no processar antes de contabilizar, como o legado) |
| 23 | nf-faturamento.service.ts:72/75/365 — já faturada → NF_JA_FATURADA | a | uNF.pas:4345-4350 `ExisteFaturamentoAGerarFinanceiro` "Não existe faturamento pendente para esta nota fiscal" | — | manter |
| 24 | nf-faturamento.service.ts:510 — estornar faturamento de NF contabilizada | a (indireta) | excluir o financeiro pela NF (`ExcluirDocumentosFinanceiros`, uNF.pas:17711) só aparece em modo edição (`lblExcluirDocumentosFinanceiros.Visible`, :9421; `btnExcluirDocumentosFin.Enabled`, :3979-3981 e :9422), e editar exige CONTABILIZADO<>'S' (:3909) | — | manter |
| 25 | nf-faturamento.service.ts:522 — estornar com título quitado → TITULO_QUITADO | a | `VerificaExisteBaixas` (udmNF.pas:11848: baixados, agrupados ou contabilizados) "Existem documentos financeiros que já foram baixados, agrupados ou contabilizados…" (o legado é **mais** restritivo: agrupado/contabilizado também barram) | — | manter |
| 26 | nf-contabilizacao.service.ts:57-64 — elegibilidade (cancelada, não processada, sem valor, NRONF 000000, saída 55 não autorizada, já contabilizada) | a | `GetSQLNF` UIntegracaoContabil.pas:500-507 | — | manter |
| 27 | nf-contabilizacao.service.ts:68 — empresa não AUTOMATICA | a | uNF.pas:10949 / udmNF.pas:7778 (só AUTOMATICA integra pela NF; o resto vai pelo TRON) | — | manter |
| 28 | nf-contabilizacao.service.ts:234 (e :455) — período fechado no contabilizar/estornar | dúvida | como #5 (no fonte 2020 a regra é `ChaveamentoPeriodo`, UIntegracaoContabil.pas:282-292) | efeito nulo (nenhum período STATUS='S') | manter |
| 29 | nf-nfe.service.ts:74-96, 253-254, 360-370 — pré-condições de transmitir/cancelar/CC-e (modelo 55, terceiros, cancelada, já transmitida, não processada, sem número/itens/valor, não autorizada, 20 CC-e) | a/d | uNF.pas:10761 (terceiros), :8273-8276 (btnEnviarNfe só com PROC='S'), NFe.pas:332 (20 CC-e); o resto é protocolo SEFAZ | — | manter |
| 30 | nf-vendas.service.ts:76 — cupom já importado exige senha ADM | a | uNF.pas:13336-13340 `SenhaAdministrativa('ADM')` | — | manter |
| 31 | nf-vendas.service.ts:111 — NFC-e não autorizada | a | uNF.pas:13307 `NFCProcessada` | — | manter |
| 32 | nf-scrap.service.ts:76-82 — scrap já importado exige liberação USUARIOS_LIBERAM_SCRAP_NF | a | uNF.pas:1996-2012 | — | manter |
| 33 | nf-scrap.service.ts:94 — scrap com `mov_estoque='S'` → SCRAP_ESTOQUE_JA_BAIXADO | d (sem âncora) | nenhuma: `MOV_ESTOQUE` não aparece no fonte 2020 (coluna do binário novo); blindagem contra baixa dupla de estoque | MOV_ESTOQUE nunca é 'S' (0 de 3.794 scraps) | manter (impacto nulo) |
| 34 | nf-devolucao-vendas.service.ts:79-85 — devolução já importada exige liberação USUARIOS_LIBERAM_DEVOL_VENDA_NF | a | uNF.pas:6020-6030 | — | manter |
| 35 | nf-vendas/scrap/devolucao-vendas `NF_TIPO_INCOMPATIVEL`, `NF_CANCELADA` | d | a importação só existe na tela do tipo certo (TipoNota) | — | manter |
| 36 | recebimento.service.ts:502 — refaturar XML com finalidade 2/3/4 | a-parcial | udmNF.pas:9107 só sai com FINALIDADE=4 (o Apollo barra 2 e 3 também) | 0 NFs de entrada com finalidade 2/3 em 2025-26 | manter (ou alinhar a =4) |

Omitidas (triviais): ~70 (tenant ~15, not-found ~22, validação de entrada/cadastro/protocolo SEFAZ ~33 — ex.: NUM_PARCELAS, NF_SEM_VALOR, CONTAS_NAO_INFORMADAS, EMPRESA_FISCAL_NAO_CONFIGURADA, NF_LOTE_DUPLICADO, NF_SEFAZ_ERRO).

`nf-lote.service.ts`: sem guardas de estado.

---

### FRMMANIFESTODFE (67.058 acessos) — services: `compras/manifesto-dfe.service.ts`, `manifesto-previsao.service.ts`, `sefaz-dfe.service.ts` (importar reusa `recebimento.importarXml`)

| # | Guarda | Classe | Âncora no legado | Evidência em produção 2025/2026 | Recomendação |
|---|---|---|---|---|---|
| 1 | manifesto-dfe.service.ts:188-192 — importar sem evento 210200 (confirmação) → CONFIRMACAO_NECESSARIA | a-parcial | UManifestoDFe.pas:1806-1811 "Realize a confirmação da operação para importar a NF-e.", **exceto contingência** (:1800-1804: CONTINGENCIA='SIM' importa com alerta), exceção que o Apollo não tem | NFs de entrada com IMP_MANIFESTO='S' **sem** evento 210200 na chave: **2025: 52 de 8.512; 2026: 63 de 6.028**, todas com tpEmis=1 (não são contingência) e em geral só com 210210 (ciência). Ou o binário novo afrouxou a regra, ou o evento não foi gravado | manter; implementar a exceção de contingência (tpEmis≠1, dígito 35 da chave) e investigar os 115 casos |
| 2 | manifesto-dfe.service.ts:194-199 — XML indisponível | a | UManifestoDFe.pas:1818-1823 | — | manter |
| 3 | manifesto-dfe.service.ts:136 — ignorar NF já importada → NFE_JA_IMPORTADA | c (sem âncora) | nenhuma: o "ignorar" (IGNORAR_MANIFESTO) não existe no fonte 2020 (grep em UManifestoDFe.pas/uDMManifestoDFe.pas só acha `IgnorarEvento`, que é outra coisa) | 1 linha em 43.949 com IGNORAR_MANIFESTO='S', e ela está importada: impacto nulo | manter (efeito nulo) ou remover por fidelidade |
| 4 | manifesto-previsao.service.ts:114 — previsão já gerada para a chave → PREVISAO_MANIFESTO_JA_GERADA | d (sem âncora no fonte; binário novo) | nenhuma no fonte 2020 (previsão de A Pagar do manifesto é do binário novo) | 0 de 179 chaves com previsão (2025-26) tiveram segunda geração: consistente com o legado também barrar | manter |
| 5 | manifesto-previsao.service.ts:113 — situação/CC da previsão não configurados | d (config) | configs SITUACAO_/CC_GERACAO_PREVISAO_APAGAR_MANIFESTO | — | manter |

Omitidas (triviais): 14 (tenant 2, not-found 4, validação/certificado/SEFAZ 8).

---

### FRMPEDIDOCOMPRA (23.311 acessos) — services: `compras/pedido-compra.aggregate.ts`, `pedido-compra.service.ts`, `recebimento.service.ts`, `analise-pedido-nf.service.ts`, `pedido-lojas.ts`

Contexto medido: 1.100 pedidos (2025) e 638 (2026); **só 12/7 fechados**; **só 13 pedidos ligados a NF (NF.CODPEDCOMP) em 21 meses**, todos fechados hoje. `DTFATURAMENTO` do legado é a data **digitada** (edtDtFaturamento, DefaultToday; 1.099/1.100 e 637/638 preenchidos). A carga já a desvia para `data_faturamento` (`tools/cutover/etl/extrair.py:71-77`), senão todo pedido migrado chegaria "recebido" e travado.

| # | Guarda | Classe | Âncora no legado | Evidência em produção 2025/2026 | Recomendação |
|---|---|---|---|---|---|
| 1 | pedido-compra.aggregate.ts:287-288 (editar), :391 (excluir); pedido-compra.service.ts:241 (gerar parcelas), :403 (liberar limite), :773 (importar itens), :897 (reabrir) — "recebido" (`dtfaturamento` carimbado pelo recebimento, ou `lojaRecebeu`) → PEDIDO_FATURADO | c | nenhuma: btnEditarClick (uPedidoCompra.pas:6606-6612) e btnExcluirClick (:6661-6671) só checam `ValidaFechamento` + `ExisteTransferenciaGerada`; FecharPedido/Reabrir (:7754-7870) só pedem USUARIOS_REABREM_PEDIDO_COMPRA. Nenhum uso de DTFATURAMENTO como trava no fonte | os 13 pedidos com NF estão fechados e nenhum foi editado depois da NF (LOG PEDIDOCOMPRA / HISTORICO 'PEDIDO DE COMPRA' = 0) | remover (impacto baixo; a trava que vale é FECHADO) |
| 2 | **pedido-lojas.ts:120-122 (via recebimento.service.ts gerarNf :69 e importarXml com pedido :632) — receber exige a loja FECHADA → PEDIDO_NAO_FECHADO** | **c (invertida)** | o legado faz o contrário: a análise NF × pedido só oferece pedido **aberto** (`FFiltroObrigatorio := 'FECHADO = ''N'' …'`, UanalisaPedComp_NF.pas:1482-1484) e, ao liberar, **pergunta se fecha** (:730-760 "Deseja fechar o pedido de compra?") | 1.719 de 1.738 pedidos de 2025-26 nunca foram fechados; os 13 com NF foram fechados justamente pela análise. No Apollo o operador teria de fechar antes de receber, o inverso do hábito | **remover/inverter**: aceitar pedido aberto e oferecer fechar depois, como o legado |
| 3 | recebimento.service.ts:77, :143, :638 — pedido totalmente recebido → PEDIDO_TOTALMENTE_RECEBIDO | c (sem âncora) | nenhuma: UanalisaPedComp_NF.pas só **pergunta** "Já existe o pedido X importado para esta nota, deseja continuar…" (:585); "saldo" ali é só relatório (SaldodoPedidodeCompra1) | 0 casos mensuráveis (13 vínculos) | remover ou virar aviso (baixo) |
| 4 | recebimento.service.ts:91 — quantidade explícita > saldo → RECEBIMENTO_EXCEDE_SALDO | d | só no "gerar NF" do Apollo (a NF continua editável, e o import não capa quantidade) | — | manter |
| 5 | recebimento.service.ts:633 — fornecedor do XML ≠ do pedido | a | UanalisaPedComp_NF.pas:1482 (filtro CODIGO_PARCEIRO quando VISUALIZA_PC_PARC='S') | — | manter |
| 6 | pedido-compra.aggregate.ts:440-468 / service :154-155 — editar com todas as lojas fechadas ou a logada fechada; tirar item ou mexer em quantidade de loja fechada; excluir com fechamento parcial/total | a | `ValidaFechamento` uPedidoCompra.pas:6610-6611 (editar), :6664 (excluir, tfParcial+tfTotal), :6709 (excluir item), :7090 (limpar item) | — | manter |
| 7 | pedido-compra.service.ts:70 (fechar já fechado), :894 (reabrir não fechado), :406 (liberar limite de pedido fechado) | a | menu Fechar só habilita com tfSemFechamento e Reabrir só com tfTotal (`ValidarBotaoOutros`, uPedidoCompra.pas:7924-7928); a liberação de limite é do gravar, e gravar pedido fechado não é possível | — | manter |
| 8 | pedido-compra.service.ts:77 — fechar sem itens | d | nenhuma explícita | 0 pedidos fechados sem item (19 fechados) | manter |
| 9 | pedido-compra.service.ts:126 — meta diária excedida sem senha ADM | a | mniFecharPedidoClick uPedidoCompra.pas:2439-2445 | — | manter |
| 10 | pedido-compra.service.ts:455 — lote de preço já gerado | a | uPedidoCompra.pas:1373-1375 (LTPRECO_PROCESSADO='S') | — | manter |
| 11 | pedido-compra.service.ts:753 — produto já desassociado | a | uPedidoCompra.pas:2315-2318 "Este produto já está desassociado do fornecedor." | — | manter |
| 12 | pedido-compra.aggregate.ts:333 / :358 / :375 — condição obrigatória, prazo > máximo do fornecedor, pendências do fornecedor ('B') | a | uPedidoCompra.pas:6831-6836 (OBRIGA_INFORMAR_CONDICOES_PAGAMENTO), `VerificaFP` :6792, `VerificaPendencias` :4255 (AVISA_PENDENCIAS_FORNECEDOR) | — | manter |
| 13 | analise-pedido-nf.service.ts:214-221 — liberar conferência com divergência exige supervisor | a | UanalisaPedComp_NF.pas btnLiberarPedidoClick (ChamaLiberacaoLogin sobre divergências) | — | manter |

Omitidas (triviais): ~60 (tenant ~10, not-found ~12, validação/loja do pedido/importação ~38).

---

### FRMCONFERENCIANOTA (5.695 acessos) — services: `compras/conferencia-nota.service.ts`

| # | Guarda | Classe | Âncora no legado | Evidência | Recomendação |
|---|---|---|---|---|---|
| 1 | conferencia-nota.service.ts:144 — aprovar sem liberação USUARIOS_APROVAM_CONFERENCIA_NOTA | a | `UsuarioLiberadoParaAprovacao` uConferenciaNota.pas:1267-1296 (chamada em btnAprovarClick :376) | — | manter |
| 2 | conferencia-nota.service.ts:205 — NF que não é de entrada | a | picker `GET_NF` com `TIPO = 'E'` (uConferenciaNota.pas:556, :631) | — | manter |
| 3 | conferencia-nota.service.ts:204 — NF cancelada | d | nenhuma explícita; NF de entrada nunca é cancelada | 0 NFs de entrada com CANCELADA='S' em 2025-26 | manter |

Omitidas (triviais): 3 (tenant, sem itens ×2). Sem outras guardas de estado.

---

### FRMCADPEDIDODEVOLUCAOCOMPRAS (2.527 acessos) — services: `compras/devolucao-compra.aggregate.ts`, `devolucao-compra.service.ts`

| # | Guarda | Classe | Âncora no legado | Evidência | Recomendação |
|---|---|---|---|---|---|
| 1 | devolucao-compra.aggregate.ts:183 / :274 — editar/excluir fora de EM_DIGITACAO | a | `PedidoLiberadoParaEdicao` uCadPedidoDevolucaoCompras.pas:1838-1847; btnEditar :425-434 "Status da devolução não permite alterações."; btnExcluir :436-471 | — | manter |
| 2 | devolucao-compra.service.ts:120/128 — transições (finalizar só EM_DIGITACAO, reabrir só DIGITADO, cancelar só EM_DIGITACAO/DIGITADO) | a | `ControlaBotoes` :1181-1197; ReabrirPedido :1857-1868; CancelarPedido :912-927; FinalizarDigitacao :1600-1614 | — | manter |
| 3 | devolucao-compra.service.ts:178-179/197/374 — gerar NF com NF já emitida / fora de DIGITADO | a | GerarNotaFiscaldeDevoluo1Click :1703-1713 | — | manter |
| 4 | devolucao-compra.aggregate.ts:259 — quantidade > saldo a devolver | a | edtQtdDevolvidaExit :1393 | — | manter |
| 5 | devolucao-compra.aggregate.ts:231 — item de outro fornecedor | a | `VerificaParceiro` :1955-1967 | — | manter |
| 6 | devolucao-compra.aggregate.ts:236/242 — CFOP de origem vazio / sem CFOP_DEVOLUCAO | a | CarregaItens :1005-1011 "CFOP de origem não está preenchido. Reimporte a nota fiscal…" | — | manter |
| 7 | devolucao-compra.service.ts:232 — NF de origem cancelada | d | NF de entrada nunca cancelada | 0 em 2025-26 | manter |

Omitidas (triviais): ~8 (tenant 2, not-found 3, sem itens/sem NF 3).

---

## Achados do grupo por impacto

1. **FRMNF × editar NF de entrada com A Pagar antes de processar** (`nf.aggregate.ts:168`, e `nf-processamento.service.ts:90`) — c. 4.436 edições/2.612 NFs (2025) e 5.816/3.388 (2026); é o fluxo diário da 1ª tela do sistema (NF importada já nasce faturada no Apollo). Remover.
2. **FRMNF × faturar (F4/refaturar-xml) NF contabilizada** (`nf-faturamento.service.ts:71`) — c. O Apollo contabiliza no processar e o legado gera o financeiro antes de contabilizar (udmNF.pas:7772-7788). Universo: 5.409 (2025) e 2.716 (2026) NFs com A Pagar nascido no/após o processamento. Remover, ou gerar o financeiro no processar.
3. **FRMNF × reverter processamento com financeiro** (`nf-processamento.service.ts:149`) — c. 295 (2025) e 151 (2026) reversões; o legado mantém os títulos e registra pendência (ESTORNA_FINANCEIRO_NF='N'). Remover e seguir `CancelaFaturamento`.
4. **FRMPEDIDOCOMPRA × receber contra pedido aberto** (`pedido-lojas.ts:120-122`) — c, invertida: o legado só vincula pedido ABERTO e fecha na liberação; 1.719 de 1.738 pedidos nunca são fechados. Frequência baixa (13 vínculos em 21 meses), mas o fluxo fica ao contrário.
5. **FRMNF × processar NF com TOTALNF fora da fórmula** (`nf-processamento.service.ts:224`) — c-escopo: o legado confere só o ST. ~7% das NFs de entrada migradas (643/459) cairiam se revertidas e reprocessadas sem regravar. Reduzir ao ST.
6. **FRMMANIFESTODFE × importar sem confirmação 210200** (`manifesto-dfe.service.ts:188`) — a-parcial: falta a exceção de contingência. 52 (2025) e 63 (2026) NFs importadas pelo manifesto sem 210200 na produção; é preciso investigar se o binário novo afrouxou a regra.
7. **FRMPEDIDOCOMPRA × pedido "recebido" read-only / não reabre / totalmente recebido** (PEDIDO_FATURADO, PEDIDO_TOTALMENTE_RECEBIDO) — c, 0 casos medidos. Remover por fidelidade (a trava do legado é só FECHADO).
8. Impacto nulo hoje: faturar denegada (`nf-faturamento:70`, c inversa, 0 NFs D); ignorar importada (`manifesto-dfe:136`, 1 caso); período contábil `bloq_nf` (nenhum período fechado; a regra do fonte 2020 é outra tabela).

## Observações (sentido inverso — regras do legado que faltam no Apollo; fora do escopo, só registro)

- **Dia FECHADO (tabela `FECHAMENTO`)**: o legado barra editar/excluir/gravar/reverter NF com DTCONTABIL em dia fechado (uNF.pas:3930-3940, 4088-4096, 4565-4572, 8983-8991). Na produção há 3.346 dias 'F' (último: 31/07/2026 empresa 2, 29/06/2026 empresa 1). O Apollo checa `periodo_contabil.bloq_nf`, que o fonte não usa, e não checa `FECHAMENTO`.
- Reverter NF processada em outro dia pede `SenhaAdministrativa('ADM')` (uNF.pas:9005-9009); o Apollo não pede.
- Faturar NF própria exige STATUSNFE P/D (uNF.pas:4336-4340); o Apollo não exige.
- Processar com pedido 'NAO LIBERADO' / sem pedido quando exigido (`VerificaPedidoCompra`, uNF.pas:17408-17425; uProcessaNotaFiscal.pas:199-209); excluir pedido com transferência gerada (uPedidoCompra.pas:6666); excluir NF com devolução de compra emitida (uNF.pas:4165-4177) ou de produção encerrada (:4125-4131). Nenhuma delas está no Apollo.
