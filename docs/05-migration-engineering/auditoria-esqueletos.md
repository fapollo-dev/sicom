# Auditoria de esqueletos: o que o legado grava e o app não (lição 142)

**Data:** 24/09/2026
**Método:** somente leitura. A produção Oracle foi consultada só com SELECT, via `q.py`, em transação READ ONLY. Nenhum arquivo do app foi alterado.

**Pergunta:** para cada tela de alto uso já "convertida", o que **uma** operação grava no legado? A resposta vem de todas as tabelas, cruzadas pela chave do lote/documento, numa amostra recente da produção. Ela é comparada com o que o serviço do app grava para a mesma operação. Também foram conferidas as leituras que filtram por coluna que o dado migrado deixa vazia.

**Fontes:**
- **Uso:** `MENUEXPRESS` da produção, em 24/09/2026.
- **Fonte:** Delphi de mai/2020, em `/Library/SicomGit/retaguarda-master/fonte/Units`.
- **Dado vivo da produção:** tabelas de negócio, `LOG`, `AUDIT_*` e `USER_SOURCE` para triggers e procedures.
- **App:** código em `apps/api/src/modules/**`, `apps/web/src/features/**` e `apps/api/migrations/`.
- **Carga:** `tools/cutover/etl/extrair.py` e `schema-destino.json`.

**Fora desta auditoria** (já corrigidas hoje): baixa de A Pagar e A Receber, controle de contas, fechamento de caixa, agrupamento AR/AP, edição do cadastro de A Pagar e A Receber, adiantamento a fornecedor, lançamento de caixa e edição/faturamento de NF. PDV e relatórios puros também ficaram fora.

**Volumes:** "operações 2025-26" quer dizer de 01/01/2025 até 24/09/2026 na produção.

---

## 1. Placar de prioridade (uso × severidade)

**Como ler:**
- **Pontuação** = acessos × peso da severidade (ALTA 3, MÉDIA 2, BAIXA 1).
- **FRMETIQUETA:** o acesso dela é inflado, porque cada impressão abre o form. Pelo **dano ao dado**, a ordem de ataque recomendada está na seção 2.

| # | tela | acessos | pior lacuna | sev. | operações 2025-26 afetadas | pontuação |
|---|---|---:|---|---|---|---:|
| 1 | FRMETIQUETA — Etiquetas | 2.426.760 | não lista os produtos com etiqueta pendente (`ETQ_IMPRESSA='N'`): só a fila do coletor; `valor_impressao` gravado nulo | MÉDIA | 116.368 impressões; hoje 19.710 produtos pendentes (lojas 1/2/52) | 4.853.520 |
| 2 | FRMCADPRODUTO — Produtos | 97.860 | a web grava preço e estoque sempre na **empresa 1**; o lote de preço não se espalha para as lojas; a inclusão não cria MULTI_PRECO/ESTOQUE nas 5 lojas | **ALTA** | ~45% das edições de preço de 2026 (1.119 de 2.499) em outra loja; 4.416 eventos de lote multi-loja; 5.434 inclusões | 293.580 |
| 3 | FRMMANIFESTODFE — Manifesto DF-e | 71.003 | o sincronizar deve falhar no 1º resumo (ON CONFLICT sobre índice **parcial** e PK = NSU colidindo com os códigos migrados); `NF_STATUS_PROCESSO` nunca é gravado | **ALTA** | 15.398 resumos; ~29.684 marcações de ciência/confirmação; 14.930 esteiras | 213.009 |
| 4 | FRMCADSCRAP — Scrap/perdas | 53.963 | a tela web não envia centro de custo, fornecedor nem situação, então **a CAIXA da perda nunca dispara** | **ALTA** | 607 scraps · 12.006 linhas de CAIXA · R$ −9.169.081,45 | 161.889 |
| 5 | FRMCADAGENDAPROMOCAO — Agenda de promoção | 30.929 | **não há agendador**: a promoção não liga no início nem desliga no fim; a geração por grupo de preço não existe | **ALTA** | 1.144 de 1.153 agendas ligadas/desligadas automaticamente; 230 agendas / 3.465 itens por grupo | 92.787 |
| 6 | FRMCADCLIENTES — Clientes/parceiros | 25.689 | cada alteração **renumera o CODEND** (delete+insert), o que deixa órfãos `parceiros.codend`, `nf.codparceiro_end` e `pedidos.codparceiro_end`; escopo por loja errado | **ALTA** | 601 alterações em 356 parceiros (114 com NF); 6.232 títulos AR de parceiros invisíveis fora da loja 1 | 77.067 |
| 7 | FRMPEDIDOCOMPRA — Pedido de compra | 23.312 | as parcelas não são re-rateadas ao gravar, e a trava de valor máximo diário (ativa) lê parcelas velhas | MÉDIA | 1.385 de 1.658 pedidos com parcelas | 46.624 |
| 8 | FRMBAIXACARTAO — Baixa de cartões | 7.988 | faltam os **débitos** na conta da forma de pagamento e da taxa (MOV_CONTAS_BANCARIAS); a data da baixa é sempre "hoje" | **ALTA** | 8.798 de 8.805 lotes · R$ −33.143.081,86 + taxa R$ −623.178,98; 90% dos lotes com data ≠ hoje | 23.964 |
| 9 | FRMAJUSTEPRECOS — Ajuste de preços | 5.277 | o botão "Etiquetas" não existe (mesma lacuna da #1) | MÉDIA | 469 de 789 execuções | 10.554 |
| 10 | FRMCONCILIACAOBANCARIA — Conciliação | 2.965 | não grava `LIBERADO='S'` nem `DTLIBERACAO` no movimento conciliado; a sugestão casa por `data_fechamento` (73% nula) | **ALTA** | 1.721 movimentos que o legado liberou; 10.313 sem DTLIBERACAO | 8.895 |
| 11 | FRMCADCARTAO — Controle de cartões | 4.337 | NSUHOST e CODREDE não são editáveis; falta `CONSILIADO='S'` e as travas de cartão conciliado ou baixado | MÉDIA | 623 alterações de NSUHOST/CODREDE; 94% dos cartões de 2026 conciliados | 8.674 |
| 12 | FRMCADPEDIDODEVOLUCAOCOMPRAS — Devolução de compras | 2.527 | **unidade errada** no item (CX/FD da nota com a qtde já em UN) chega à NF-e de devolução; o status migrado é incompatível | **ALTA** | 242 itens em 94 de 217 devoluções; 17 abertas travadas | 7.581 |
| 13 | FRMCADUSUARIOS — Usuários | 1.805 | o operador criado no app **não consegue entrar** (sem senha, sem endpoint de administrador para definir) | **ALTA** | 88 de 88 operadores novos | 5.415 |
| 14 | FRMAJUSTEESTOQUE — Ajuste de estoque | 754 | grava `dtcadastro` e nunca `data` (a coluna do legado); o destino vai como rótulo 'LOJA' em vez do código 'E' | MÉDIA | 2.386 ajustes | 1.508 |
| 15 | FRMCADEMPRESA — Empresas | 723 | edita 33 de 273 colunas; alterações reais caem em colunas sem editor (`CODPLC_JUROS_PAGOS`, curva ABC, TEF…) | MÉDIA | 78 alterações | 1.446 |
| 16 | FRMCONFERENCIANOTA — Conferência de nota | 5.695 | não registra `NF_STATUS_PROCESSO` stConferencia; falta a ação "Análise produto" (LIBERADO) | BAIXA | 2 NFs aprovadas + 5 liberadas | 5.695 |
| 17 | FRMPRIFICACAOCUSTO — Precificação por custo | 3.346 | rótulo do histórico diferente; `CODUSUALT` não gravado; lote do filho ausente | BAIXA | 1.001 eventos (rótulo) · 5 (filho) | 3.346 |
| 18 | FRMCONFBOLETO — Conferência de boleto | 4.836 | só as sequências de remessa (Itaú/BB) não são ressincronizadas na pós-carga | OK (BAIXA) | 1 remessa BB (o número BB vai no header) | — |
| 19 | FRMEXPORTABALANCA — Exportar para balança | 24.374 | nada: o banco só recebe a LOG, igual | **OK** | 8.582 exportações conferidas | — |
| 20 | FRMPENDENCIASOPERADOR — Pendências | 3.665 | nada (o app persiste `ANALISE_PEDIDO_NF`, e a memória está desatualizada) | **OK** | 0 escritas da tela em 2025-26 | — |
| 21 | FRMCADCONTASBANCARIAS — Contas bancárias | 383 | só o filtro por loja (o legado não filtra) | **OK** (BAIXA) | 29 gravações | — |

**Resultado:**
- **9 telas com GAP-ALTA:** produto, manifesto, scrap, agenda, clientes, baixa de cartão, conciliação, devolução de compras e usuários.
- **6 com GAP-MÉDIA:** etiqueta, pedido de compra, ajuste de preços, cartões, ajuste de estoque e empresas.
- **2 com GAP-BAIXA:** conferência de nota e precificação por custo.
- **4 limpas:** balança, pendências, contas bancárias e conferência de boleto (esta com uma sequência de pós-carga a acertar).

## 2. Ordem de ataque recomendada (pelo dano ao dado)

1. **Baixa de cartão: os débitos de origem e a data digitada.** São R$ 33,1 mi/ano e meio de saída que não baixam da conta "cartões", com o saldo por dia errado em 90% dos lotes.
2. **Produto: a loja da sessão, o lote em todas as lojas, a inclusão nas 5 lojas.** Hoje a gôndola da loja 2/52 fica com o preço velho, e o produto novo não existe nas outras lojas.
3. **Scrap: centro de custo, fornecedor e situação na tela.** Sem isso, a CAIXA ligada hoje (aafcd6a) é código morto: R$ −9,17 mi de perdas fora da CAIXA gerencial.
4. **Agenda de promoção: o agendador da vigência e a geração por grupo.** Hoje o preço promocional fica ativo no PDV depois do fim.
5. **Conciliação: `LIBERADO`/`DTLIBERACAO`.** 1.721 movimentos ficam "a prazo" para sempre e fora do saldo do controle de contas.
6. **Devolução de compras: a unidade do item.** É fiscal: a NF-e sai com "24 CX" onde deveria sair "24 UN".
7. **Manifesto: o sincronizar.** Provavelmente quebra na primeira nota e nunca grava a esteira.
8. **Clientes: o CODEND estável.** É uma mina: o primeiro PUT com endereço já deixa NF e pedido órfãos.
9. **Usuários: a senha no cadastro.** É bloqueio operacional no dia 1.

## 3. Achados transversais

- **`AUDIT_*` não existem no destino.** O `schema-destino.json` só tem `audit_permissoes`. As triggers de auditoria do legado gravam em AUDIT_CARTAO, AUDIT_MULTI_PRECO, AUDIT_PRODUTOS, AUDIT_SCRAP(_ITEM), AUDIT_ESTOQUE, AUDIT_PEDIDOCOMPRA_I, AUDIT_PEDIDO_COMPRA_QTDE, AUDIT_AGENDAPROMOCAOITENS e AUDIT_OPERADORES, entre outras. Só em pedido de compra são 2,7 M de linhas em 2025-26. É uma **decisão de projeto pendente**, não uma lacuna de tela, e nenhum dossiê a declara.
- **Das 7 triggers de `MULTI_PRECO`, o destino só tem a ATUALIZAPROD, e só como `BEFORE UPDATE`** (`migrations/127_ajuste_precos.sql:67`). Faltam:
  - UPDATE_CUSTO_MULTI_PRECO: HISTORICO_DINAMICO de custo/venda/promo por alteração;
  - REM_MULTI_PRECO: fila `REMESSA_SERVER` para o PDV;
  - ATUALIZATRIBUTOS e COMPOSICAO_PROD(_KIT).

  Como o motor de aggregate faz DELETE+INSERT nos detalhes, a trigger `BEFORE UPDATE` **não dispara** na edição pelo cadastro de produto. Por isso a etiqueta não volta para 'N' no modo online (FRMCADPRODUTO lacuna 5).
- **`NF_STATUS_PROCESSO` nunca é gravado pelo app.** Só `nf-esteira.service.ts` lê essa tabela. O legado a grava no manifesto (stCiencia/stConfirmacaoOp/stManifesto, cerca de 44 mil marcações em 2025-26), na conferência de nota (stConferencia) e na devolução de compras (stDevolucao, 543 chaves). Depois da virada, a esteira do app fica congelada.
- **Data "hoje" em vez da data digitada** aparece de novo (baixa de cartão). É o mesmo padrão da lição da baixa de A Pagar: toda operação do legado com campo de data grava a data **digitada** em todas as tabelas do lote.
- **Motor de aggregate e chave estável.** O engine exclui a PK das colunas preservadas (`aggregate-engine.service.ts:200-206`) e apaga/reinsere os detalhes. Toda tabela-detalhe cuja PK é referenciada de fora é renumerada a cada gravação. O caso provado é `parceiros_end.codend`; vale conferir os demais aggregates com detalhe referenciado.
- **Afirmação falsa no código.** `migrations/124_etiqueta.sql:8` e `:26` dizem que "LOG_IMPRESSAO_ETIQUETA do legado NÃO tem escritor (artefato morto)". A produção tem 77.404 linhas em 2026, a última de 24/09/2026 18:49.
- **Memória e dossiê desatualizados:**
  - a memória diz que o app calcula a análise pedido×NF "na hora", mas `analise-motor.service.ts:156-220` persiste `ANALISE_PEDIDO_NF`;
  - o dossiê `uAjusteEstoque.md` diz ".pas ausente", mas `Units/UajusteEstoque.pas` existe.

---

## 4. Detalhe por tela

### 4.1 FRMCADPRODUTO — Cadastro de produtos (97.860 acessos) — **GAP-ALTA**

- **Operação:** gravar produto (alteração de preço/custo e inclusão).
- **Config viva na produção:**
  - `HABILITA_GERACAO_LOTE_PRODUTO` global 'N', com override Empresa 1='S', Empresa 2='S' e Modulo Retaguarda='S';
  - `EMPRESAS.SINCRONIZA_PRECO_NF='S'` nas 5 empresas;
  - `ATIVA_LOG_PRODUTOS='S'`.
- **O legado grava:**
  - LOG de PRODUTOS e de MULTI_PRECO (UCadProduto.pas:3074-3084) e TB_SPEED_AUX 0205 (:3072).
  - **Modo lote:** LOTEPRECO ORIGEM='P' **para todas as empresas do operador**, expandindo pelo grupo de preço (:3132-3139, :3244, :8001). Mais `GeraLoteFilho` (:3256), com o texto "REFERENTE A ALTERAÇÃO DE PREÇO DO PRODUTO PAI".
  - **Modo online:** UPDATE de MULTI_PRECO do grupo e HISTORICO_DINAMICO (:3269-3290).
  - **Inclusão:** MULTI_PRECO e ESTOQUE **para todas as empresas** (:3147, :3153; udmCadProduto.pas:2747).
  - **Triggers:** HISTORICO_DINAMICO VRCUSTO/VRCUSTOREP, AUDIT_MULTI_PRECO, REMESSA_SERVER e HASHPAF.
- **Amostras na produção:**
  - LOG 15738657 (24/09/2026 16:45:42, produto 1489, VRVENDA 5,99→5,49) gerou LOTEPRECO 117180-117185: produto 1489 nas empresas 1, 2 e 52, mais o filho 832304 nas mesmas 3.
  - LOG 15738694 (produto 6040) gerou HISTORICO_DINAMICO 2026013/2026014, AUDIT_MULTI_PRECO e REMESSA_SERVER.
- **Volume 2025-26:**
  - LOG PRODUTOS: Inseriu 5.434, Alterou 3.585;
  - LOG MULTI_PRECO: Alterou 6.845 (3.437 com VRVENDA, 2.033 com VRCUSTO), Inseriu 2.719;
  - LOTEPRECO 'P': 14.038 lotes em 4.561 eventos.
- **O app grava:**
  - `produtos`, com HISTORICO_DINAMICO e LOG só do mestre (aggregate-engine.service.ts:85-86);
  - DELETE+INSERT de multi_preco/estoque/codauxiliar (:104; produto.aggregate.ts:270, :293, :306);
  - `lote_preco` (produto.aggregate.ts:59-113);
  - `tb_speed_aux` (sped-alteracoes.ts:58).
  - **A web fixa a empresa 1:** `const IDEMPRESA_F2 = 1` (apps/web/src/features/produtos/ProdutoCadMaster.tsx:41, :143, :147, :746-753).
- **Lacunas:**
  1. **ALTA — preço e estoque na loja errada.** Em 2026, casando LOG com AUDIT_MULTI_PRECO no mesmo minuto, as edições se dividem em empresa 1 = 1.380, **empresa 2 = 1.069, empresa 52 = 50**. No app, todas cairiam na empresa 1.
  2. **ALTA — o lote não se espalha para as lojas.** Distribuição de empresas por evento em 2025-26: 1=145, 2=376, **3=3.597**, 4=413, 5=30. São **4.416 eventos** multi-loja, e o app gera lote só para a linha editada.
  3. **ALTA — a inclusão só cria na empresa 1.** Dos 1.179 produtos incluídos em 2026, **1.175 têm 5 MULTI_PRECO e 5 ESTOQUE**. O dossiê G-18 também diz "MULTI_PRECO por empresa".
  4. **MÉDIA — o lote do filho está ausente.** O legado gerou 524 lotes em 2026 (47 produtos). O app o declara "adiado, DIF≠0 = 0 linhas" (produto-filhos.service.ts:9-19), mas o GeraLoteFilho roda com DIF=0 (os 201 filhos da base têm DIF=0).
  5. **MÉDIA — a precedência da config ignora o 'Modulo'.** A empresa 52 (só override Modulo='S') gerou lote em 30 de 31 edições de VRVENDA de 2026; no app, cairia no modo online. No modo online, o DELETE+INSERT não zera `etq_impressa` nem carimba `dtultprecoalterado`: sem reimpressão e fora do relatório de preços alterados.
  6. **MÉDIA — HISTORICO_DINAMICO de custo/preço do detalhe não é gravado.** São 2.033 edições de VRCUSTO, com 2 linhas cada.
  7. **BAIXA:**
     - LOG de MULTI_PRECO (9.564) e de CODAUXILIAR (78);
     - HASHPAF (impacto no PDV não provado);
     - outbox `replica` desligado sem decisão.
- **Não provado:** a precedência exata de `ValorConfiguracao`, porque a função não está no fonte e foi inferida do dado vivo.

### 4.2 FRMMANIFESTODFE — Manifestação do destinatário (71.003 acessos) — **GAP-ALTA**

- **Operação:** manifestar (ciência/confirmação) e importar o resumo da distribuição.
- **O legado grava:**
  - `NFE_EVENTOS` (UManifestoDFe.pas:2131-2155).
  - `NF_STATUS_PROCESSO` stCiencia/stConfirmacaoOp='R' (:2157). No cStat 573, grava mesmo assim (:2216-2270).
  - Na distribuição (:2557-2796):
    - `NFE_NAO_CADASTRADAS` com CNPJ formatado, TIPO pelo tpNF, NRONF, DTRECBO, CODOPERADOR, IMPORTACAO_MANUAL='N' e NFE_IMPORTADA_SISTEMA='N', pulando a chave que já tem NF;
    - a esteira de 10 etapas em `NF_STATUS_PROCESSO` e `CODNFSTATUSPRO`;
    - `NFE_XML` e `NFE_EVENTOS` em upsert;
    - `EMPRESAS.ULTIMO_NSU`.
- **Amostra:** chave 31260922327834000149550010005198081159244720. Fila 66929; eventos 127137/127201; esteira 451661-451670.
- **Volume 2025-26:**
  - 15.384 ciências, 14.825 confirmações, 152 desconhecimentos e 9 operações não realizadas;
  - 15.398 resumos na fila;
  - stCiencia R 14.986 · stConfirmacaoOp R 14.698 · stManifesto R 14.930.
- **O app grava:**
  - `manifestar`: só `nfe_eventos` (sefaz-dfe.service.ts:275-281).
  - `processarDocs`: `nfe_nao_cadastradas` (:136-159), `nfe_xml` (:151), `nfe_eventos` (:162-173) e `empresas.ultimo_nsu` (:209).
- **Lacunas:**
  1. **ALTA — o sincronizar deve falhar no 1º resumo.** Isto foi lido no código e não executado. São duas causas:
     - `.onConflict(oc => oc.column('chavenfe'))` (:146, :159) aponta para `ux_nfe_naocad_chave`, que a mig 188 recriou como índice **parcial** (`WHERE chavenfe IS NOT NULL AND coalesce(origem_legado,'N')<>'S'`, 188_carga_f4_folds.sql:31-33). Sem o predicado, o PG recusa com 42P10.
     - `codnfe_naocad = Number(nsu)` (:138, :154) colide com a PK migrada (1..66929): `ULTIMO_NSU` é 6582 na empresa 2 e 21920 na empresa 51. Além disso, NSUs de empresas diferentes colidem entre si.

     O smoke só chama `/sincronizar` sem certificado (smoke.ts:6923). Afeta 15.398 resumos.
  2. **MÉDIA — `nf_status_processo` nunca é gravado**, e `codnfstatuspro` também não (15.393 de 15.398 preenchidos no legado).
  3. **MÉDIA — o resumo sai diferente do legado:**
     - sem `nronf`, que a grade do app mostra (15.398/15.398 preenchidos no legado);
     - `tipo` sempre 'E' (209 'S' no legado);
     - sem dtrecbo, codoperador e flags;
     - não pula a nota que já tem NF;
     - `nfe_xml` inserido sempre (duplica);
     - eventos da distribuição sem upsert.
  4. **BAIXA:**
     - CNPJ só dígitos;
     - `cnpj/razao_destinatario` ausentes;
     - cStat 573 vira erro e 136 vira sucesso;
     - `data_evento` = hora local em vez de `dhRegEvento`.
- **Leituras:** `nf_status_processo.idempresa` é nula nas 201.797 linhas P, mas o ETL resolve (extrair.py:190-194). OK.

### 4.3 FRMCADSCRAP — Scrap/perdas (53.963 acessos) — **GAP-ALTA**

- **Operação:** gravar o documento de perda.
- **O legado grava:**
  - `SCRAP` (codplc, codparceiro, idsituacao_nf, idempresa) e `SCRAP_ITEM` (idproduto, qtde, vr_custo, vrcustorep, codmotivoop, codsetor, idproduto_filho, usucadastro…);
  - `CAIXA` com a diferença (codplc, codscrap, origem='SCRAP'; uCadSCRAP.pas:716-760);
  - LOG, AUDIT_SCRAP e AUDIT_SCRAP_ITEM.
  - **Não** mexe em ESTOQUE: não há trigger de estoque em SCRAP_ITEM e `mov_estoque='S'` aparece em 0 de 623.
- **Amostra:** CODSCRAP 16228. Tem 6 itens (15-22/09/2026) e CAIXA 280831 (−344,95), 281682 (−326,29) e 281874 (−31,48).
- **Volume 2025-26:** 623 scraps; 28.531 itens; 12.006 linhas de CAIXA em 607 scraps (R$ −9.169.081,45).
- **O app grava:** `scrap`/`scrap_item` (scrap.aggregate.ts:32-79); `caixa` (scrap-caixa.ts:30-34, chamado em scrap.aggregate.ts:123); `log`.
- **Lacunas:**
  1. **ALTA — a tela web cria o documento com `criarScrap({})`** (apps/web/src/features/scrap/ScrapPage.tsx:68) e salva só `{obs, itens}` (:95). Não há campo de PLC, fornecedor nem situação. Por isso `lancarCaixaDoScrap` sai cedo (`codplc == null`, scrap-caixa.ts:24).
     - No legado, 623 de 623 têm codplc e codparceiro, e 621 têm situação.
     - A API aceita documento sem codplc e sem itens (scrap.schema.ts:41); o legado bloqueia os dois (uCadSCRAP.pas:615, :622).
  2. **MÉDIA — a tela não captura setor nem produto filho.** Em 2025-26, 1.786 itens têm codsetor e 1.339 têm idproduto_filho.
  3. **BAIXA:**
     - `usucadastro` do item não é gravado (28.527 de 28.531 preenchidos no legado);
     - item com qtde 0 fica no documento;
     - o botão "Aplicar" aparece com `BAIXAR_ESTOQUE_NO_SCRAP='N'`.

### 4.4 FRMCADAGENDAPROMOCAO — Agenda de promoção (30.929 acessos) — **GAP-ALTA**

- **Operação:** gravar a agenda com itens e o efeito dela no preço.
- **O legado grava:**
  - `AGENDA_PROMOCAO` (FLAGPROMOCAO N/E/J, DATAEXECUCAO) e `AGENDA_PROMOCAO_ITENS` (VRVENDA = foto do preço cheio, uCadAgendaPromocao.pas:958).
  - Itens por grupo de preço com ATUALIZACAO_GRUPO='S' (`AtualizaGrupoPreco`, :286-417).
  - UPDATE MULTI_PRECO nas lojas que saem (:750) e no item desativado (:247).
  - LOG do cabeçalho e de cada item; AUDIT_AGENDAPROMOCAOITENS.
  - O **serviço `ServerRemessaDS.exe`** liga a promoção no MULTI_PRECO na hora de início e depois de cada gravação, e depois fecha a agenda (J).
- **Amostra:** CODAGENDA 31185 (24/09/2026), com 40 itens (8 por grupo). MULTI_PRECO ficou PROMOCAO='S' e CODAGENDA=31185 nas lojas 1 e 2 às 05:00:48; o AUDIT_MULTI_PRECO registra PROGRAMA=ServerRemessaDS.exe.
- **Volume 2025-26:** 1.153 agendas, das quais 1.144 foram executadas pelo serviço (1.138 chegaram a J); LOG com 1.613 gravações de cabeçalho e 14.487 de itens.
- **O app grava:**
  - agenda e itens, com os itens apagados e reinseridos (agenda-promocao.aggregate.ts:56-96);
  - `agenda_promocao_empresa` e a reversão no multi_preco (:232-256);
  - `aplicar`/`fechar`/`processarVigencia` (agenda-promocao.service.ts:100-191).
- **Lacunas:**
  1. **ALTA — nada agenda a vigência.** `processarVigencia` só é chamada por `POST processar-vigencia` (agenda-promocao.controller.ts:38). No repositório não há `@nestjs/schedule`, `setInterval`, cron nem pg_cron (conferido). A agenda não liga no início, e uma agenda aplicada à mão **não desliga no fim**. Afeta 1.144 agendas.
  2. **ALTA — a geração por grupo de preço não existe.** O dossiê §4 a declara "adiada", mas o uso é relevante: 230 agendas (20%) e 3.465 itens com ATUALIZACAO_GRUPO='S'. Os irmãos do grupo seriam vendidos pelo preço cheio.
  3. **BAIXA:**
     - VRVENDA do item digitado à mão, fica 0 se ninguém digitar (AgendaPromocaoCadMaster.tsx:117); o legado preenche 100%;
     - sem LOG por item (14.487) nem AUDIT;
     - DESCRICAO_PROMOCAO ausente em item novo.

### 4.5 FRMCADCLIENTES — Clientes/parceiros (25.689 acessos) — **GAP-ALTA**

- **Operação:** incluir ou alterar parceiro.
- **O legado grava:**
  - `PARCEIROS` e `PARCEIROS_END`, este **atualizado no lugar, com CODEND estável** (udmParceiros.dfm, upWhereKeyOnly);
  - na inclusão, `PARCEIROS.CODEND` de cobrança (uCadClientes.pas:2150-2158);
  - PARCEIROS_REL e PARCEIROS_BANCOS;
  - TB_SPEED_AUX 0175 (:2107-2110);
  - LOG por tabela (:2117-2142).
- **Amostra:** parceiro 109003 (24/09/2026 15:48).
- **Volume 2025-26:** 523 inclusões; 601 alterações em 356 parceiros.
- **O app grava:** `parceiros` (cerca de 95 colunas) e os detalhes end/bancos/pgto/rel/vendedores **apagados e reinseridos** (parceiro.aggregate.ts:51-71; engine :104-105); 0175 (:75-77); LOG só do cabeçalho.
- **Lacunas:**
  1. **ALTA — o CODEND é renumerado a cada alteração.** Em `parceiros_end`, o `codend` é a PK e fica fora das colunas preservadas (aggregate-engine.service.ts:200-206); cada PUT com endereços gera um codend novo (`nextval`). Três coisas quebram:
     - `parceiros.codend` passa a apontar para um endereço que não existe;
     - `nf.codparceiro_end` e `pedidos.codparceiro_end` ficam órfãos (não há FK);
     - as leituras fiscais por codend perdem a UF e o CNPJ (precificacao-nf.service.ts:159/317; nf-ibscbs.service.ts:82).

     No legado há 0 órfãos. Exposição: 114 parceiros alterados em 2025-26 têm NF (17.455 NFs, 100% com endereço). Provado por leitura de código, não executado.
  2. **MÉDIA — o escopo por loja está errado.** `empresaScoped:true` (:24) filtra por `idempresa` da sessão; o legado não filtra (udmParceiros.dfm:59). PARCEIROS.IDEMPRESA é nulo em 17.690 de 19.073 linhas, e a carga os leva para a loja 1 (extrair.py:292). No AR de 2025-26, ficariam invisíveis:
     - loja 2: 3.926 títulos de 50 parceiros;
     - loja 50: 2.243 títulos de 114 parceiros;
     - loja 51: 63 títulos de 9 parceiros.
  3. **BAIXA:**
     - sem LOG de END/REL/BANCOS;
     - EMPRESAS, CODPERFIL_PARCEIRO (15%) e IDENTIFICADOR (9%) não são gravados;
     - DTULTALTERACAO não é carimbada.

### 4.6 FRMBAIXACARTAO — Baixa de cartões (7.988 acessos) — **GAP-ALTA**

- **Operação:** gravar a baixa por lote (`btnGravarClick` → `BaixaContasApagar`).
- **O legado grava:**
  - `CARTAO` com DTBAIXA (a data **digitada**), CODOPBX, LIBERADO, IDLOTE, DATA_OPERACAO, CODPLC_ACREDESC, CODPLC_TAXA_CARTAO, VALOR_TAXA_PAGA e VALOR_OUTRAS_DESPESAS_PAGA (UbaixaCartao.pas:723-734).
  - `CARTAO_BX` com DATA_PGTO = data digitada.
  - **`MOV_CONTAS_BANCARIAS`, três linhas por lote** (`ValidaSaldoAntMultiEmpresa`, UbaixaCartao.pas:779; udmPrincipal.pas:2025-2064):
    - (a) crédito do líquido na conta de destino;
    - (b) **débito "SAIDA PARA BAIXA DE DOCUMENTOS"** na conta da forma de pagamento;
    - (c) **débito da taxa** na mesma conta.
    - Todas com DTEMISSAO = DTVENC = DTLIBERACAO = data da baixa, IDLOTE e CODOPERADOR.
  - `CAIXA` com taxa e outras despesas (:1151-1206).
  - Integração contábil automática (:1214-1215) quando `EMPRESAS.INTEGRACAO='AUTOMATICA'` (empresas 1, 2, 51 e 52).
- **Amostra:** lote 91347 (baixa 15/09/2026, operação 23/09/2026). Gravou MCB 1224829 (+154,44, conta 421), 1224830 (−154,44, conta 1) e 1224831 (−5,08, conta 1), além de CAIXA 282224, CARTAO_BX 1223880-82 e CONTABILIZADO='S'.
- **Volume 2025-26:** 8.805 lotes / 670.924 cartões.
- **O app grava** (`cadastro/cartao-baixa.service.ts`):
  - `cartao` com `dtbaixa=now()` (:104);
  - **uma única** linha de crédito em `mov_contas_bancarias`, sem dtemissao/dtvenc/dtliberacao/idpgto (:112-116);
  - `caixa` com `data=current_date` (:120, :129);
  - `cartao_bx` com `now()` (:160).
- **Lacunas:**
  1. **ALTA — os débitos (b) e (c) não são gravados.** São 12.560 linhas SAIDA PARA BAIXA em 8.798 de 8.805 lotes (R$ −33.143.081,86) e 10.574 linhas de taxa em 7.541 lotes (R$ −623.178,98). O saldo da conta "cartões" nunca baixa.
  2. **ALTA — a data da baixa é sempre "hoje".** Não há campo de data na API. No legado, 7.890 de 8.805 lotes (90%) têm DTBAIXA ≠ DATA_OPERACAO.
  3. **MÉDIA — a contabilização não dispara após a baixa** (`baixar()` não chama `cartao-contabil.service`). No legado, 670.057 de 670.924 cartões estão CONTABILIZADO='S'.
  4. **MÉDIA — faltam CODOPBX, DATA_OPERACAO, CODPLC_TAXA_CARTAO e CODPLC_ACREDESC** em `cartao`. O contábil do app lê os dois PLC (cartao-contabil.service.ts:256-257), então a taxa e as outras despesas ficam com centro de custo 0 em todo lote novo.
  5. **MÉDIA — cartão de outra empresa.** O app filtra `cartao.idempresa = sessão` (:62); o legado baixa cartão de outra empresa em 1.118 lotes.
  6. **MÉDIA latente — reintegração contábil de lote migrado.** Com `valor=abs(valor)` no ETL (extrair.py:218), o filtro `m.valor > 0` de cartao-contabil.service.ts:299 passa a pegar também os débitos (b) e (c) numa reintegração.
  7. **BAIXA:**
     - LIBERADO do crédito (o legado grava 'N' em 412 de 2.752 lotes CRED_DESTINO);
     - `tiporecurso` 'DINHEIRO' em vez de '1 - DINHEIRO';
     - texto do histórico diferente.

### 4.7 FRMCONCILIACAOBANCARIA — Conciliação bancária (2.965 acessos) — **GAP-ALTA**

- **Operação:** confirmar a conciliação (automática ou manual).
- **O legado grava** (UDMConciliacaoBancaria.pas:314-620, :636-657):
  - `MOV_CONTAS_BANCARIAS` com **LIBERADO='S'**, MOV_CONCILIADO='S' e **DTLIBERACAO** (= DTEMISSAO na automática, MBO_DATA na manual);
  - `MOVIMENTACAO_BANCARIA_OFX.MBO_CONCILIADO='S'`;
  - `CONCILIACAO_BANCARIA`, `CONCILICAO_BANCARIA_MOV` e `_OFX`.
- **Amostra:** CB 24087-24089 (24/09/2026 18:07). MCB 1225148-50 tiveram INSERT com LIBERADO nulo e depois UPDATE para 'S' / DTLIBERACAO 2026-08-03.
- **Volume 2025-26:** 4.860 conciliações / 10.313 movimentos.
- **O app grava:** as tabelas de conciliação, `mbo_conciliado='S'` e **só** `mov_conciliado='S'` (conciliacao-bancaria.service.ts:193-201).
- **Lacunas:**
  1. **ALTA — não grava LIBERADO nem DTLIBERACAO.** Pelo AUDIT, 1.721 movimentos conciliados estavam LIBERADO='N' antes e o legado os liberou. No app, continuam "a prazo" e fora do saldo, porque o controle de contas soma só o liberado (controle-contas.service.ts:73).
- **Leituras sobre coluna vazia:**
  - **MÉDIA:** `pendentes`/`sugerir` usam `data_fechamento` como data do movimento (:95, casamento por dia em :121/:139). DATA_FECHAMENTO é nula em 72.440 de 98.827 linhas de MCB de 2025-26 (73%). O legado usa `TRUNC(DTEMISSAO)` (UDMConciliacaoBancaria.dfm:166-172) e `ABX.DTPGTO`.
  - Sobre dado migrado, a sugestão não casa por data, e a grade sai sem data e fora de ordem.

### 4.8 FRMCADPEDIDODEVOLUCAOCOMPRAS — Devolução de compras (2.527 acessos) — **GAP-ALTA**

- **Operação:** gravar com CarregaItens (uCadPedidoDevolucaoCompras.pas:816, :936-1166).
- **O legado grava:**
  - `PEDIDO_DEVOLUCAO_COMPRA` com STATUS_PEDIDO='EM DIGITACAO' (com espaço, :825);
  - `_ITENS` com os tributos proporcionais, **UNIDADE='UN' salvo nota em KG** (:995-1001), UNIDADE_NOTA, FATOR_EMBALAGEM, VALOR_VENDA e VRCUSTOREP;
  - `NF_STATUS_PROCESSO` stDevolucao (:855, :1876);
  - LOG.
- **Amostra:** devolução 10326 (21/09/2026). O item é FD na entrada e UN na devolução; a NF 163455 sai em UN.
- **Volume 2025-26:** 217 devoluções / 1.532 itens.
- **O app grava:**
  - `pedido_devolucao_compra` com status 'EM_DIGITACAO';
  - `_i` com **unidade = unidade da nota de entrada** (devolucao-compra.aggregate.ts:110) e `fatorembalagem: 1` (:112);
  - a NF de devolução usa `i.unidade` com a qtde em unidades (devolucao-compra.service.ts:265).
- **Lacunas:**
  1. **ALTA, fiscal — unidade errada.** A NF-e sairia, por exemplo, com "24 CX" onde o legado emite "24 UN". Afeta 242 itens em 94 de 217 devoluções (121 são CX com fator ≠1).
  2. **MÉDIA — status migrado incompatível.** A carga só renomeia a coluna (extrair.py:53) e mantém 'EM DIGITACAO'/'NOTA FISCAL EMITIDA'; o app compara com os valores com sublinhado (aggregate :183, :274; service :144-154, :193). Devolução aberta migrada não pode ser editada, finalizada nem cancelada: 17 abertas em 2025-26 (63 no staging).
  3. **BAIXA/MÉDIA:** stDevolucao não é gravado (543 chaves).
  4. **BAIXA:**
     - VALOR_VENDA, VRCUSTOREP e UNIDADE_NOTA não são gravados;
     - FATOR_EMBALAGEM vai sempre 1 (256 itens com fator ≠1);
     - o status FINALIZADO nunca é atingido (no legado, 181 de 217; não provado no fonte).

### 4.9 FRMCADUSUARIOS — Usuários/operadores (1.805 acessos) — **GAP-ALTA**

- **Operação:** incluir operador.
- **O legado grava:**
  - `OPERADORES` com SENHA, LOGIN_SENHA, SENHAPDV e SENHARETAGUARDA (uCadUsuarios.pas:430-440) e IDGRUPO pelo tipo (:451);
  - RELACAO_OPERADOR_EMPRESA, _PERFIL e _COMPRA, e o IDSUPERVISOR (:161-167);
  - DELETE PERMISSOES das empresas retiradas (uRdmCadUsuarios.pas:291-320);
  - LOG e AUDIT_OPERADORES.
- **Amostra:** operador 4241 "LILA" (23/09/2026).
- **Volume 2025-26:** 88 inclusões.
- **O app grava:** operadores e relacao_operador_empresa (operadores.aggregate.ts:35-52); perfis à parte (perfil-relacao.service.ts:40-47).
- **Lacunas:**
  1. **ALTA (bloqueio) — o operador criado no app não consegue entrar.** A tela não grava senha, e não existe endpoint de administrador para definir a senha de outro operador. Só há `auth/trocar-senha`, que exige a senha atual contra um `senha_hash` nulo (auth.service.ts:246); o login falha contra o DUMMY_HASH (:145). No legado, 88 de 88 têm senha. O dossiê dizia "adiada até o epic de auth", que já foi entregue.
  2. **MÉDIA:**
     - SENHAPDV (48 de 88) e SENHARETAGUARDA (12 de 88) não são editáveis;
     - PERMISSAOPDV (19 flags; 88 de 88 preenchidos) não é gravada.
  3. **BAIXA:** as PERMISSOES das empresas retiradas não são apagadas (inócuo, porque o login exige o vínculo com a empresa).

### 4.10 FRMETIQUETA — Etiquetas (2.426.760 acessos) — **GAP-MÉDIA**

- **Operação:** imprimir e marcar como impressa.
- **O legado grava:**
  - `UPDATE MULTI_PRECO SET ETQ_IMPRESSA='S'` (Uetiqueta.pas:474-489), o que dispara AUDIT_MULTI_PRECO;
  - `ETIQUETA_CONS_PROD.IMPRESSA='S'` para **todas** as pendentes do produto (:436-443);
  - `LOTEPRECO.ETIQUETA_IMPRESSA` (:1374), que tem 0 uso;
  - pelo binário novo, **LOG_IMPRESSAO_ETIQUETA** (CODOPERADOR, DATAHORA, CODBARRA, **VALOR_IMPRESSAO**, MODELO), uma linha por cópia.
- **Amostra:** operador 63, 24/09/2026 18:49:58, codbarra 7896098905999, VALOR_IMPRESSAO 4,99.
- **Volume 2025-26:** 116.368 linhas de LOG_IMPRESSAO_ETIQUETA (cerca de 1.160 lotes por minuto e operador); ETIQUETA_CONS_PROD tem só 309.
- **O app grava:** `log_impressao_etiqueta` (etiqueta.service.ts:161), `etiqueta_cons_prod.impressa` só do idetiqueta (:168) e `multi_preco.etq_impressa='S'` (:170).
- **Lacunas:**
  1. **MÉDIA (risco operacional alto) — só lista a fila do coletor** (309 linhas contra 116 mil impressões). Faltam a pesquisa por `etq_impressa='N'` (Uetiqueta.pas:713-725) e a entrada pelo Ajuste de Preços. Hoje há 4.965 produtos pendentes na loja 1, 7.159 na 2 e 7.586 na 52. Gôndola com preço velho não é detectada.
  2. **BAIXA — o log grava em colunas diferentes.** O app grava `valor_venda_promocao` e deixa `valor_impressao` nulo; no histórico migrado, `valor_impressao` está 116.368/116.368 preenchido. O app grava uma linha por produto, o legado uma por cópia.
  3. **BAIXA:**
     - a marcação da fila é mais estreita que a do legado;
     - o "adicionar" manual enfileira no ETIQUETA_CONS_PROD e polui a fila do coletor.
- **Afirmação falsa** em `migrations/124_etiqueta.sql:8,26` (seção 3).

### 4.11 FRMPEDIDOCOMPRA — Pedido de compra (23.312 acessos) — **GAP-MÉDIA**

- **Operação:** gravar (btnGravarClick, uPedidoCompra.pas:6775). O Fechar também foi conferido e bate.
- **O legado grava:**
  - PEDIDOCOMPRA, PEDIDOCOMPRA_I e PEDIDO_COMPRA_QTDE (FECHADO='N', CODCOMPRADOR);
  - **PEDIDOCOMPRA_PARCELAS re-rateada a cada gravação** (RatearTotalNasParcelas em :6866, :4015; SalvaParcelas em :696);
  - LOG, AUDIT_PEDIDOCOMPRA_I e AUDIT_PEDIDO_COMPRA_QTDE.
- **Amostra:** pedido 36036 (24/09/2026). As parcelas por loja (1: 1.556,31 · 2: 811,70) são exatamente a soma de TOTALCUSTO de cada loja.
- **Volume 2025-26:** 1.738 pedidos.
- **O app grava:** as mesmas tabelas e LOG (pedido-compra.aggregate.ts:69, 92-214). As parcelas só são gravadas quando o dto as traz (:220) ou pelo botão "Gerar parcelas" (service :233).
- **Lacunas:**
  1. **MÉDIA — parcelas velhas depois de editar.** Elas alimentam `validarLimites` (service :318-360), e o limite está ativo: `TIPO_FLUXO_CAIXA_PC='D'` e 269 pedidos com OPERADOR_ULT_LIB_VALOR_MAX. Afeta 1.385 de 1.658 pedidos.
  2. **BAIXA:**
     - CODCOMPRADOR não é gravado, e o migrado se perde na 1ª gravação (88.121 de 89.322 linhas preenchidas);
     - AUDIT_* sem equivalente;
     - a exclusão é física em vez de INDR='E' (29 pedidos).

### 4.12 FRMAJUSTEPRECOS — Ajuste de preços (5.277 acessos) — **GAP-MÉDIA** (o processar é BAIXA)

- **Operação:** processar lotes.
- **O legado grava** (uAjustePrecos.pas:531-640):
  - LOTEPRECO processado (:575);
  - HISTORICO_DINAMICO por lote (:579);
  - UPDATE MULTI_PRECO do produto e do grupo (:615, :626), com as triggers.
- **Amostra:** 24/09/2026 06:55:31, operador 63, lotes 117056/117076.
- **Volume 2025-26:** 789 execuções / 17.076 lotes.
- **O app grava:** `lote_preco` (ajuste-precos.service.ts:80+), `multi_preco` (:118) e o histórico por lote (:125).
- **Lacunas:**
  1. **MÉDIA — o botão "Etiquetas" não existe** (mig 127 o declara "ADIADO"). 469 de 789 execuções tiveram impressão de etiqueta pelo mesmo operador até 15 minutos antes.
  2. **BAIXA:**
     - o histórico por produto atualizado não é gravado;
     - o app processa só a empresa da sessão (28 execuções multi-empresa; divergência declarada).

### 4.13 FRMCADCARTAO — Controle de cartões (4.337 acessos) — **GAP-MÉDIA**

- **Operação:** gravar (alterar ou incluir recebível).
- **O legado grava:**
  - `CARTAO` com **CONSILIADO='S'** em toda gravação (UcadCartao.pas:366-367), IDPGTO default e, no NewRecord, IDEMPRESA/CODOPERADOR/LIBERADO='N';
  - HISTORICO "ALTERACAO DO CAMPO X" (:351);
  - LOG (:369-372) e AUDIT_CARTAO.
- **Volume 2025-26** (pelo HISTORICO por campo): CODOPERADORA 660, NSUHOST 445, AUTORIZACAO 430, NSU 414, CODREDE 178.
- **O app grava:** CRUD genérico (cadastro/cartao.crud.ts:21), com LOG e HISTORICO_DINAMICO.
- **Lacunas:**
  1. **MÉDIA — NSUHOST e CODREDE não são editáveis.** São os campos da conciliação e do histórico contábil.
  2. **MÉDIA — faltam CONSILIADO='S' e as travas** (UcadCartao.pas:282-305). O app deixa editar o valor ou excluir cartão conciliado ou baixado; 94% dos cartões de 2026 estão conciliados.
  3. **BAIXA:** grava HISTORICO_DINAMICO no lugar de HISTORICO.

### 4.14 FRMAJUSTEESTOQUE — Ajuste de estoque (754 acessos) — **GAP-MÉDIA**

- **Operação:** ajustar o saldo (`btnOkClick`).
- **O legado grava:**
  - ESTOQUE, ESTOQUE_DEP ou ESTOQUETROCA (UajusteEstoque.pas:336-409);
  - `AJUSTE_ESTOQUE` com **DATA**, operação, **destino 'E'/'D'** e demais colunas (:411-440);
  - pelo trigger `ESTOQUE_AJUSTE`, HISTORICO_PROD "AJUSTE DE ESTOQUE LOJA <motivo> OPERADOR:<login>";
  - AUDIT_ESTOQUE.
- **Amostra:** CODAJUSTE 23915 (24/09/2026 17:11:25).
- **Volume 2025-26:** 2.386 ajustes, 100% destino 'E'.
- **O app grava:** `estoque.qtde` (ajuste-estoque.service.ts:64-75), `historico_prod` (:141-147) e `ajuste_estoque` com `dtcadastro` e destino como rótulo (:78-85).
- **Lacunas:**
  1. **MÉDIA — grava `dtcadastro` e nunca `data`.** A coluna `data` foi criada pela mig 310 e recebe o histórico migrado; o `listar` (:161) mostra `dtcadastro`. Os migrados aparecem sem data ou com a data da carga, e os novos ficam com `data` nula. Afeta 2.386 ajustes.
  2. **MÉDIA — o destino vai como rótulo 'LOJA'/'ESTOQUE'** (ajuste-estoque.schema.ts:13-16) em vez do código 'E'/'D'. A opção "depósito" mexe no saldo da loja (:51-75), e o estornar só reconhece 'DEPOSITO' (:108). Uso de depósito em 2025-26: 0.
  3. **BAIXA:**
     - texto do histórico diferente;
     - mínimo/máximo não gravados (declarado; 6 casos).

### 4.15 FRMCADEMPRESA — Empresas (723 acessos) — **GAP-MÉDIA**

- **O app edita** 33 de 273 colunas (empresas.crud.ts:25-31).
- **Alterações reais de 2025-26 no LOG.HISTORICO (78)** caem em colunas sem editor em módulo nenhum:
  - PC_CURVA_ABC_* e PC_CURVA_COMP_*;
  - AREAM2 e AREAM2_VENDA;
  - TEF_LOJA e TEF_SERVIDOR;
  - JUNTA_COMERCIAL;
  - CODPLC_NF_PDV e IDSITUACAO_NF_PDV;
  - **CODPLC_JUROS_PAGOS**, que a baixa lê (baixa-apagar-lote.service.ts) e ninguém consegue manter.
- Parte disso o dossiê declara adiada.

### 4.16 FRMCONFERENCIANOTA — Conferência de nota (5.695 acessos) — **GAP-BAIXA**

- **Operação:** aprovar (uConferenciaNota.pas:366); também conferidos Cancelar (:440) e "Análise produto" (:291).
- **O legado grava:**
  - NF_PROD com PRODUC_STATUS='APROVADO', CODOPERADOR_APROVA_COLETA e DATA_APROVACAO_CONF;
  - NF_STATUS_PROCESSO stConferencia (:418).
- **Amostra:** NF 130470 (01/08/2025), 28 itens.
- **Volume 2025-26:** 30 itens aprovados em 2 NFs e 11 itens LIBERADO em 4 NFs. O "CONFERENCIA OK" (35.793 itens) vem do coletor, não desta tela.
- **O app grava:** nf_prod (conferencia-nota.service.ts:153, :178).
- **Lacunas (BAIXA):**
  - não grava NF_STATUS_PROCESSO; o comentário do serviço diz que a tabela não foi migrada, mas ela existe desde a mig 292;
  - falta a ação "Análise produto" (LIBERADO).

### 4.17 FRMPRIFICACAOCUSTO — Precificação por custo (3.346 acessos) — **GAP-BAIXA**

- **Operação:** gravar no modo online (lote desta tela em 2025-26: 1).
- **O legado grava** (UPrificacaoCusto.pas:736-1205):
  - MULTI_PRECO com CODUSUALT (:963-967);
  - HISTORICO_DINAMICO "Precificação do Custo" e "Precificação de Mercadorias" (VRVENDA; :1081, :1139);
  - AtualizaPrecoFilho.
- **Amostra:** produto 834878 (11/09/2026 16:40:31).
- **Volume 2025-26:** 1.001 eventos "Precificação de Mercadorias".
- **O app grava:** multi_preco por empresa e grupo (precificacao-custo.service.ts:283, :311), historico_dinamico por campo (:319) e lote_preco (:333).
- **Lacunas (BAIXA):**
  - rótulo "Precificação do Custo" no lugar de "Precificação de Mercadorias" (1.001 eventos);
  - `CODUSUALT` nunca gravado (a coluna existe desde a mig 310);
  - lote e preço do filho ausentes (5 eventos);
  - o modo lote não enfileira os peers do grupo (1 lote).

### 4.18 Telas limpas

- **FRMCONFBOLETO — Conferência de boleto (4.836): OK.**
  - Na geração da remessa, o app grava as mesmas tabelas do legado: arquivo_remessa_areceber, ref_remessa_areceber, remessas_boletos, remessas_boletos_contas e os carimbos em areceber (cnab-remessa.service.ts:542-568); na emissão, `status_boleto='E'` (:269).
  - Amostra: remessa 873 (24/09/2026). Volume: 280 remessas / 4.698 títulos.
  - Único ponto (BAIXA): `seq_remessa_banco_itau` começa em 3132 (mig 153:82) contra 6822 na produção, e `seq_remessa_banco_bb` em 705 (mig 154:9) contra 1682. `tools/cutover/pos-carga.sql` não faz `setval` delas, e o número do BB vai no header do arquivo (:454).
- **FRMEXPORTABALANCA — Exportar para balança (24.374): OK.**
  - No banco, o legado grava só a LOG 'Exportar para balança' (binário novo); o resto são arquivos.
  - AUDIT_PRODUTOS e AUDIT_MULTI_PRECO têm 0 linhas no segundo da exportação.
  - O app grava a mesma LOG (exporta-balanca.service.ts:180-189).
  - Volume: 8.582 exportações.
- **FRMPENDENCIASOPERADOR — Pendências (3.665): OK.**
  - Em 2025-26 houve 0 escritas da tela; 352 APN e 202 CFN estão abertas, criadas por outras telas.
  - O app persiste a análise (analise-motor.service.ts:156-220) e a pendência (pendencia-operador.service.ts:217, 236-251).
  - As colunas de filtro estão 100% preenchidas.
- **FRMCADCONTASBANCARIAS — Contas bancárias (383): OK.**
  - O app grava as mesmas tabelas: CONTAS_BANCARIAS, CONTAS_BANCARIAS_OP e LOG (contas-bancarias.crud.ts:22-37).
  - Único desvio (BAIXA): o app filtra por loja e o legado não.

---

## 5. Consultas de sustentação (resumidas; produção, somente SELECT)

- **Lotes de cartão:** `SELECT TRUNC(dtbaixa,'YYYY'), COUNT(DISTINCT idlote), COUNT(*) FROM cartao WHERE dtbaixa>=DATE '2025-01-01' GROUP BY 1` → 4.879/447.234 em 2025 e 3.926/223.690 em 2026.
- **Débitos de origem:** `WITH l AS (SELECT DISTINCT idlote FROM cartao WHERE dtbaixa>=DATE '2025-01-01') SELECT <prefixo do HISTORICO>, COUNT(*), COUNT(DISTINCT idlote), SUM(valor) FROM mov_contas_bancarias JOIN l USING(idlote) GROUP BY …` → SAIDA PARA BAIXA 12.560 / 8.798 lotes / −33.143.081,86.
- **Datas nulas no MCB:** `SELECT COUNT(*), COUNT(data_fechamento) FROM mov_contas_bancarias WHERE dtemissao>=DATE '2025-01-01'` → 98.827 / 26.387.
- **Conciliações:** `SELECT COUNT(DISTINCT b.cb_id), COUNT(*) FROM concilicao_bancaria_mov x JOIN conciliacao_bancaria b ON b.cb_id=x.cb_id WHERE b.cb_data>=DATE '2025-01-01'` → 4.860 / 10.313.
- **CAIXA do scrap:** `SELECT COUNT(*),COUNT(DISTINCT codscrap),SUM(valor) FROM caixa WHERE codscrap IS NOT NULL AND data>=DATE '2025-01-01'` → 12.006 / 607 / −9.169.081,45.
- **Agendas executadas:** `SELECT COUNT(*), COUNT(dataexecucao) FROM agenda_promocao WHERE dtiniciopromocao>=DATE '2025-01-01'` → 1.153 / 1.144.
- **Agenda por grupo:** `… GROUP BY atualizacao_grupo` → S = 3.465 itens / 230 agendas.
- **Lote do cadastro de produto:** `WITH ev AS (SELECT idproduto,codoperador,TRUNC(datalote,'MI') m,COUNT(DISTINCT codempresa) nemp FROM lotepreco WHERE origem='P' AND datalote>=DATE '2025-01-01' GROUP BY idproduto,codoperador,TRUNC(datalote,'MI')) SELECT nemp,COUNT(*) FROM ev GROUP BY nemp`.
- **Inclusão de produto:** `ins AS (SELECT DISTINCT valor FROM log WHERE formulario='Cadastro de produtos' AND tabela='PRODUTOS' AND acao='Inseriu' AND datahora>=DATE '2026-01-01')` → contagem de MULTI_PRECO/ESTOQUE por produto: 5|5|1.175.
- **Manifesto:** `SELECT COUNT(*),COUNT(nronf),COUNT(codnfstatuspro) FROM nfe_nao_cadastradas WHERE dtconsulta>=DATE '2025-01-01'` → 15.398/15.398/15.393; `SELECT MAX(codnfe_naocad) FROM nfe_nao_cadastradas` → 66929; `SELECT codempresa, ultimo_nsu FROM empresas`.
- **Devolução:** `… JOIN nf_prod p ON p.codnfprod=i.cod_item_nf WHERE d.data_pedido>=DATE '2025-01-01' AND NVL(TRIM(p.unidade),'UN')<>NVL(TRIM(i.unidade),'UN')` → 242 / 94.
- **Operadores:** `SELECT COUNT(*), COUNT(login_senha), COUNT(senhapdv), COUNT(senharetaguarda) FROM operadores WHERE dtcadastro>=DATE '2025-01-01'` → 88/88/48/12.
- **Log de etiqueta:** `SELECT TO_CHAR(datahora_impressao,'YYYY'),COUNT(*),COUNT(valor_impressao),COUNT(valor_venda_promocao) FROM log_impressao_etiqueta GROUP BY 1`.
- **Parcelas do pedido:** `SELECT COUNT(DISTINCT p.codpedcomp) FROM pedidocompra_parcelas pp JOIN pedidocompra p … WHERE p.data>=DATE '2025-01-01' AND p.indr IS NULL` → 1.385.
- **Ajuste de estoque:** `SELECT EXTRACT(YEAR FROM data), destino, COUNT(*) FROM ajuste_estoque GROUP BY …`; `SELECT text FROM user_source WHERE name='ESTOQUE_AJUSTE'`.

**Rascunhos** (units convertidas para UTF-8, dumps de triggers e saídas brutas): `/private/tmp/claude-501/-Library-Apollo/6bf25248-8079-4341-a66c-543c7c137e42/scratchpad/aud2/{A..E}/`.

---

## 6. Os BAIXA — andamento

**Lote 1 (25/09/2026, smoke §218):**
- §4.18 remessas: `pos-carga.sql` reposiciona `seq_remessa_banco_itau`/`_bb` pelo maior CODREMESSABANCO gravado (produção 6822/1682; as
  sequências Oracle estão em 6841/1701 pelo cache) — sem voltar para trás.
- §4.17 precificação por custo: VRVENDA com "Precificação do Custo" (datamodule, udmCadProduto.pas:2844) **e** "Precificação de
  Mercadorias" (título da tela, UPrificacaoCusto.pas:1093) — as duas juntas em 585 eventos de 2025-26; o irmão do grupo só com o título
  da tela; `CODUSUALT`; no lote os irmãos entram na fila (`SQLProduto`, :741) e o filho do pai ganha lote (`GeraLoteFilho`); a
  atualização on-line do filho (`AtualizaPrecoFilho`) implementada com o gate do legado (DIF ≠ 0) — dormente na produção (0 históricos
  "Alteração de preço do produto pai").
- §4.16 conferência: "Análise produto" (LIBERADO, sem operador; a esteira desmarca stColeta e stConferencia). A esteira da aprovação já
  vinha do commit `51e1d61`.
- §4.13 cartão: HISTORICO em texto (`SetaHistorico`: "ALTERACAO DO CAMPO X DE: a PARA: b" na ordem do `cdsCartao`, com as descrições
  OPERADORA/MODALIDADE; "EXCLUSAO DO REGISTRO , NROPEDIDO: x, VALOR: 040"); o HISTORICO_DINAMICO saiu (0 linhas no legado).
- §4.11 pedido de compra (e agenda de promoção): a exclusão lógica mantém os itens (`manterDetalhesNaExclusao` no motor) — o legado
  guarda 4.179 itens de 216 pedidos INDR='E' e 172 itens de 11 agendas.
- §4.5 parceiro: `CODPERFIL_PARCEIRO` (perfil do cliente, TIPO 'PARCEIRO') e `DTULTALTERACAO` carimbada pela tela (vai na LOG "Alterou":
  280 de 280 em 2026, inclusive a regravação sem mudança); LOG de PARCEIROS_END/REL/BANCOS. EMPRESAS e IDENTIFICADOR não são da tela
  (outro processo) e o UPDATE não os toca.

**Já resolvidos junto dos ALTA/MÉDIA:** scrap (usucadastro, qtde 0), manifesto (CNPJ formatado, 135/573, `data_evento`), devolução
(VALOR_VENDA, UNIDADE_NOTA, fator da nota, stDevolucao), etiqueta (log por cópia com VALOR_IMPRESSAO), pedido (CODCOMPRADOR),
ajuste de estoque (texto do histórico), baixa de cartão (LIBERADO do crédito).

**Lote 2 (25/09/2026, smoke §219 + `test/hash-paf.spec.ts`):**
- §4.1 produto: **HASHPAF** reconstruído do dado — `MD5(IDPRODUTO‖IDEMPRESA‖VRVENDA‖VRCUSTO)`, valores no `CurrToStr` pt-BR, hex maiúsculo
  (`getHASH_MultiPreco` está fora do fonte; bate em 1.726 de 2.953 preços de ago-set/2026 — o resto é hash velho deixado pelo lote de
  preço, que não o refaz). Recalculado na linha que a tela grava (nova ou com preço/custo mudado) e na precificação por custo. LOG
  MULTI_PRECO (o registro da loja da sessão, na ordem do `cdsMulti_Preco_Update`) e CODAUXILIAR (Inseriu com a tabela `'CODAUXILIAR '`,
  o espaço do legado; Alterou; Excluiu); o código auxiliar novo nasce com DTCADASTRO/DTALTERACAO e PORCENTAGEM_VALOR 100.
- §4.9 usuários: a empresa retirada leva as PERMISSOES do operador nela; o operador excluído perde as dele.
- §4.14 ajuste de estoque: mínimo/máximo no saldo e no ajuste.
- §4.6 baixa de cartão: TIPORECURSO "1 - DINHEIRO" na CAIXA (3.600 de 3.632); o histórico digitado vai antes de "REF. BX LOTE: N"
  ("AMEX REF. BX LOTE: 91347").
- Conferidos e já em ordem: scrap (Aplicar só com BAIXAR_ESTOQUE_NO_SCRAP='S'), etiqueta (a busca não enfileira; a marcação é por
  produto), agenda (VRVENDA e DESCRICAO_PROMOCAO do item — feitos no §4.4), ajuste de preços (1 linha VRVENDA por lote, como o dado:
  1.240 de 1.240).
- **Não provado, mantido:** contas bancárias — o registro é aberto pelo código sem filtro de loja (uRDmCadContaBancaria.dfm), mas a
  pesquisa é a do form-base e não há prova de que ela não filtre; a trava de isolamento por loja (smoke MT) fica.

**Lote 3 (25/09/2026, smoke §219.4):** agenda — a LOG por item no formato do binário novo ("INCLUSÃO DE ITEM NA AGENDA: …",
"MODIFICAÇÃO DE ITEM DA AGENDA: … CAMPO/VALOR ANTERIOR/VALOR ATUAL", uma por campo, "EXCLUSÃO DE ITEM DA AGENDA: …"; LF, acentuado, sem
normalizar), o CODITEM estável (`pkEstavel`) e o DTATIVO só quando o item é ativado.

**LOG vertical (25/09/2026, smoke §220-§222):** os formulários da LOG de produção 2025-26 cruzados com o que o Apollo grava.
- §4.7 conciliação: **desfazer a conciliação** (244 reversões; binário novo, fora do fonte de 2020) — reconstruído do dado: o evento CB fica,
  as junções CONCILICAO_BANCARIA_OFX/_MOV saem, MBO_CONCILIADO e MOV_CONCILIADO voltam 'N', o LIBERADO do lançamento fica; LOG
  "REVERSAO Campo: X   Valor: V" (todos os campos, o valor do débito com sinal) na ordem MOV_CONTAS_BANCARIAS Alterou →
  CONCILICAO_BANCARIA_MOV Alterou → CONCILICAO_BANCARIA_OFX Excluiu → MOVIMENTACAO_BANCARIA_OFX Excluiu. Na tela, a lista das
  conciliações da conta com "Desfazer".
- NF — **a DESCRIÇÃO do item (NF_PROD.DESCRICAO) não era gravada**: nenhum caminho do Apollo a escrevia (fora da lista do agregado),
  e todo item nascido nele ficava NULL; o legado sempre a preenche (a do produto ao escolhê-lo, uItensNF.pas:2531; a da origem na
  importação — o cupom tem a sua). Agora: a que veio, senão a que o item tinha, senão a do produto; editável no diálogo só com
  `EDITAR_DESCRICAO_ITEM_NF`='S' (produção 'N'; mig 344 semeia). A LOG "Itens da nota fiscal" (142) no OK do diálogo quando ela difere
  da do produto, com o CODOPERADOR no IDEMPRESA como o legado grava (o GravaLog recebe o operador na posição da empresa).
- NF — a LOG do cancelamento ("Notas fiscais", 39 de 39 canceladas): "Nota fiscal cancelada pelo usuário: <NOME>, com a justificativa:
  <J> ,em <data>" — a justificativa no UpperCase do Delphi (só a-z), sem normalizar, sem empresa.
- Adiantamento a parceiro: a LOG do form-base ("Adiantamento a Parceiro", 588 Inseriu desde 2020 — o Apollo não gravava nenhuma), com
  os campos da tabela na ordem do `cdsAdiantamentoForn` (os de junção ficam de fora); e o **IDDOCGERADO** = o título gerado (CODRCB no
  'D', CODAPG no 'C' — 25 de 25 desde o binário novo de jul/2025; o comentário da mig 159, "gancho quase morto", era leitura da
  homologação).
- **Não provado, fica de fora:** a exclusão de movimento pelo grid da conciliação (92 LOGs "DELETADO VIA TELA CONCILIAÇÃO BANCÁRIA GRID
  MOVIMENTAÇÃO SISTEMA. IDLOTE = x E CODMOVCONTA = y") — o texto está no dado, as guardas (lote baixado? contabilizado?) não.
- **Tela não convertida achada:** "Processamento rápido de nota fiscal" (`uProcessaNotaFiscal`; altera VL_CUSTO/USOCONSUMO da nota).
- **Fora de escopo:** `CONFERENCIA NF` (16.432, coletor), `Cadastro de Relatórios` (upload .fr3 do suporte). O título da LOG do parceiro
  por papel ("- Fornecedor"/"- Transportadora", 620 linhas) depende do menu de entrada — divergência de texto, não de regra.

**Pendentes:** devolução (o status FINALIZADO — 181 de 217 no legado, mas nenhum caminho no fonte de 2020 o grava: não provado),
produto (outbox `replica`, decisão de projeto) e a decisão de projeto sobre AUDIT_*.

## 7. Colunas que o legado preenche e o Apollo não escreve (25/09/2026)

`tools/cutover/conferir-colunas-nao-escritas.py`: nas 2.000 linhas mais novas de cada tabela que o Apollo grava (produção, só
leitura), as colunas preenchidas em ≥ 50% que nenhum código do Apollo que grava a tabela cita. Heurística de triagem — nome comum
("descricao") passa por escrito; foi como `nf_prod.descricao` escapou até o LOG vertical achá-la.

**Feitos:**
- DEFAULTs do Oracle (mig 345): 48 colunas com DEFAULT no legado e nenhum no destino, e 4 com outro — a linha nascida no Apollo ficava
  NULL onde o legado grava 'N'/0/'S'.
- CFOP (mig 346): a tela editava 11 das 45 colunas (nem o TIPO, NOT NULL no Oracle); agora todas, com as regras do UCadCFOP (o TIPO
  limpa o lado oposto da situação, PROCESSA FINANCEIRO governa o automático, o CFOP de devolução é de devolução e do mesmo destino, a
  alíquota é da UF). Smoke §223.

- PRODUTO corte P1: a comparação exata (o "Inseriu"/"Alterou" da LOG de 2026 × as colunas do agregado) deu 45 colunas que a tela do
  legado preenche ou altera e o Apollo não gerenciava — o filtro por nome tinha visto 12. Entraram 39 (as flags do binário novo,
  USO_CONSUMO, PIS/TIPOPIS, TIPO_ITEM, o desconto do PREÇO 2 — TPDESCPRECO2 alterado 785 vezes em 2026 —, DESCMAX, COMISSAO,
  TARAEMBALAGEM, DIAS_VALIDADE_MINIMO, FATOR_PEDIDOCOMPRA, ESPECIFICACAO, a medida caseira, …) com o NewRecord medido (VISIVEL_REL 'S',
  RECEITAUNIDADE 'KG', APRESENTACAO_ETIQUETA 1, TIPO_ITEM 0, PIS 'S', TIPOPIS 'N', o resto 'N') e o CODOPERADOR de quem cria. Smoke §224.
  Ficam: PRODUTOS.HASHPAF (outro hash, a reconstruir como o do MULTI_PRECO), DT_*_FGF (a integração de consulta tributária) e
  CHAVECOMPOSICAO.

- PRODUTO corte P2 (`produto-gravar.ts`, smoke §225): as validações do `btnGravarClick` (UCadProduto.pas:2608-3070) — nenhuma existia
  no Apollo —, só as provadas vivas no dado de 2026: NCM obrigatório, 8 dígitos, existente e vigente (0 de 519 sem); CEST 7 dígitos e
  existente, obrigatório no STB (1 de 422 sem) — ambos para o produto que não é filho nem uso e consumo (o Apollo cobrava o CEST do STB
  de todos: no uso e consumo, 4 de 45 não têm); custo e custo de reposição ≠ 0 (0 de 575); PIS/COFINS fora do Simples; a config
  BLOQ_VENDA_MAIOR_CUSTO ('N' na produção); a figura fiscal do uso e consumo pela alíquota de saída (~96% batem); CODBALANCA 1.
  **Não aplicadas, com prova:** VALOR DE VENDA obrigatório (331 de 575 com venda 0), seção/depto/grupo/subgrupo obrigatórios (1.168 de
  1.175 sem seção), natureza PIS/COFINS (573 de 1.175 sem ela). Mig 347 semeia na base de dev os NCMs e o PIS/COFINS dos produtos-semente.

- `tools/cutover/conferir-campos-da-log.py` (lição 151): por formulário/tabela da LOG de 2026, os campos que a tela do legado grava
  (Inseriu/Alterou) e a config do Apollo não gerencia — 460 na primeira rodada. Feitos daí: PARCEIRO (as 5 flags 'N' de todo parceiro
  novo, SENAR, CODCONTA, matriz, "todos os pagamentos", placa/UF da transportadora) e OPERADOR (MENU — 2 no NewRecord —, CODIGOAUXILIAR,
  ATIVO, BLOQUEARSUPERLIBERARPROP; o bloqueio de acesso segue o DESABILITADO). Smoke §226.

**Fila (por dano provável):**
- NF — cabeçalho: ~50 totais do legado que o Apollo não grava (QTDE, PIS/COFINS_NFE, RATEIO_ST, TOTALBASE_STEXTERNO, TOTAL_STREAL,
  TOTALREPICM, DTPROCESSAMENTO, TOTAL_BONIFICADO, VALIDATOTALNF…); item: ~90 (os valores da nota do fornecedor, custo real/reposição, PMZ,
  venda sugerida, lucros e margens, USOCONSUMO, SINCRONIZADO_*, a decomposição na entrada, REPASSADO, INDEXADORTRIB, ESPECIFICACAO…).
- MULTI_PRECO pelo cadastro de produto: ✅ CODFIGURAFISCAL/IDPISCOFINS/IDTABELA (a linha da sessão espelha o produto; a inclusão leva PIS/COFINS e tabela às outras lojas — §227). Faltam VRCUSTOFISCAL, ABC/DATA_ABC/PERC_ABC, ATACAREJO_ATIVO (TIPOPIS da linha não espelha: 135 de 579).
- ✅ A inclusão: CARTÃO grava o CODOPERADOR de quem lança; DEVOLUÇÃO DE COMPRA o CNPJ_CPF do endereço do parceiro (77 de 79); FAMÍLIA
  ATIVO 'S' e a loja — e o **TIPO da família com o domínio do legado**: P = GRUPO DE PREÇO, R = PRODUÇÃO (UCadFamiliaProd.dfm:105-122),
  E = SETOR; o Apollo tinha 'R' como grupo de preço e recusava 'P' — 1.818 famílias, 9.397 produtos (smoke §228). A TELA de famílias
  (FRMCADFAMILIAPROD) foi convertida — dossiê UCadFamiliaProd.md, smoke §229.
- Ruído da LOG, não é lacuna: a agenda de promoção (DATAEXECUCAO/IDSITUACAO_NF/CODPARCEIRO, 468) e o SCRAP.MOV_ESTOQUE (141) são
  "vazio → vazio" (o gravar troca '' por NULL e o form-base registra); o conferidor passou a ignorar.
- ✅ PEDIDO DE COMPRA (smoke §230): a inclusão grava DTENCERRAMENTO = o dia do pedido (568 de 570), e o vencimento e a data de
  faturamento na data do pedido quando a tela não os traz. **Trava inventada removida:** o Apollo barrava editar, excluir, reabrir, gerar
  parcelas, liberar limite e importar itens de pedido já recebido (PEDIDO_FATURADO) — o legado não tem essa trava (editar: fechamento,
  uPedidoCompra.pas:6610; excluir: fechamento/transferência, :6661; reabrir: só a liberação, :7754). O carimbo do 1º recebimento
  (`dtfaturamento` do Apollo; a data digitada do legado vai para `data_faturamento`) fica como metadado.
- ~~`pedidocompra_i`: PISCONFIS, ICME, LUCROBRUTOP, LUCROLIQP, VLREMBALAGEMB~~ — falso positivo do conferidor por nome: a herança do catálogo (mig 307, `pedido-heranca.ts`) já os grava.
- `nf_prod`: ✅ REPASSADO/INDEXADORTRIB e `nf.ULT_CODNFPROD_REPASSE` (indexador C1-C7); ✅ VRCREDSN/ALIQCREDSN (do XML) e DESTACICMSSN (NewRecord);
  ✅ **VRFRETE** — o binário novo mudou o FRETE do item para a FATIA do frete da nota: VRFRETE = TOTALFRETE × FRETE (267/267 em 2026; a conta
  do fonte, produtos × FRETE%, 0/267) — o custo, a gravação e a importação seguem isso; faltam CUSTO_RECALCULO_BONIF, VRCFOP_ABATIDO; `nf_forma_pagamento.VRTROCO`.
- `parceiros`: VISUALIZA_PC_PARC, CLUBEFIDELIDADE, SOMA_ST_BONIFICACAO, HABILITA_RETENCAO_SENAR_NF.
- `cartao`: TIPOMODALIDADE, MODALIDADEOPERADORA, SEQUENCIA, CODOPERADORAORIGEM, VALOR_OPERACAO.
- ✅ `nfe_evento` do cancelamento e da CC-e: ORGAO_RECEPCAO (UF da chave) e ID_EVENTO ("ID"+tipo+chave+seq) como o legado grava (smoke §231); CNPJ do autor e mensagem são só da manifestação (que vem da SEFAZ).
- ✅ `lote_preco.VRCUSTO_ANTERIOR` (e o CODOPERADOR) — sem gatilho: o binário novo grava, por origem: lote do FILHO = o custo da linha do filho + o operador (49/49); do PEDIDO = o custo do item (212/224), sem operador; do AJUSTE no cadastro/precificação do custo = o custo da linha ANTES do ajuste (81% quando o custo muda junto); da NF = sem custo, com o operador. `cotacao_prod` (QTDEATUAL, VALORCOTACAO, VLRUNITARIO); `itens_producao_receita` (UNIDADE_PRODUTO,
  FATOR_CONVERSAO_CX_PROD[_UTIL]); `apuracao_pc_det` (DESCRICAOBASE, DESCRICAOPC, BASECALCULOAPURA, VALORPISAPURA, VALORCOFINSAPURA);
  `pedido_devolucao_compra.CNPJ_CPF`, `pedido_devolucao_compra_i.VRCUSTOREP`; `plc` (NIVELCONTA, DESCPLCCONTABIL);
  `plano_contas.CODEXPINTEIRO`; `figura_fiscal` (origem/destino); `contas_bancarias` (ESTORNO_DTHR_BAIXA, EXIBE_SALDO_EMP);
  `formas_pgto` (BAIXA_DOCUMENTO_AUTOMATICO, EXIGE_PERMISSAO); `hist_sangria_suprimento` (*_FECHADO, *_AUTENTICADO).
- ✅ CENTRO DE CUSTOS (FRMCADPLC) convertida — dossiê uCadPLC.md, smoke §233 (a tela não existia; 2 de 20 colunas; sem sequência).
- ✅ EMPRESAS (smoke §232): a tela gerenciava 53 das 273 colunas; entram 186 (`empresa-legado.ts`, gerado do UCadEmpresa.dfm — rótulo,
  aba e itens dos combos — e do schema do destino), por aba do legado; senhas de certificado/e-mail, tokens e CSC graváveis e nunca
  devolvidos na leitura. Fora: NSU, carimbos, hashes, certificados (binário), as datas de contingência do PDV e as senhas de operação
  (que o Apollo guarda em hash).
- **Outro processo, fora:** `nf.EXPORTADA/APP_EXPORTACAO/DATA_EXPORTACAO` (o MONITORNOTAFISCAL), `operadores.PERMISSAOPDV` e
  `operadoras.OPERADORA_PDV` (PDV), `operadores_acessos.EXECUTAVEL` (o executável do legado).
- 51 tabelas sem PK simples na origem ficaram fora da amostra (ex.: `adiantamento_forn`, `multi_preco`, `vendas`, `pedidos`).
