# Dossiê de Tela — DEVOLUÇÃO DE COMPRA — `FRMDEVOLUCAOCOMPRA` (`uCadPedidoDevolucaoCompras`)

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | **corte-1** (NÚCLEO do documento — agregado header+itens + picker de saldo + workflow + tela, SEM efeitos; migration 072) ENTREGUE e verde 2026-07-14. Recon 3 agentes (Oracle READ-ONLY + Delphi + monorepo) + auditoria adversarial (2 agentes). Verde: api tsc 0 · api test 138 · smoke **502/0** (5 DEVOLUÇÃO) · web tsc 0 · web test 32 · web build ✓. |
| **Autor** | Claude (agente de migração) |
| **Fontes legadas** | `uCadPedidoDevolucaoCompras.pas`/`.dfm` (tela mestre-detalhe) · `uDMCadPedidoDevolucaoCompra.pas` (DataModule/queries: `GetQtdDevolvida`, `CarregaItens`) · `uPedidoDevolucaoCompra.pas` (domínio + validações fiscais) · `uItensDevolucaoCompra.pas` (edição de item) · `uNF.pas:11994` `ImportaPedidoDevolucaoCompra` (geração da NF de saída — corte futuro). |
| **Golden** | Oracle PINHEIRAO: `PEDIDO_DEVOLUCAO_COMPRA` 545 / `_ITENS` 3.809; NFs de saída emitidas 480; A Receber 391; kardex 1.093; `NFE_REF_DEV_ENT_VINCULO` 168. Feature viva porém DECLINANTE (pico 190 em 2021, 13 em 2025). |

## 1. Modelo (Oracle real)
- **Documento próprio** `PEDIDO_DEVOLUCAO_COMPRA` (cabeçalho: `COD_PEDIDO_DEV_COMPRA` PK, `COD_PARCEIRO`=fornecedor, `COD_OPERADOR`, `COD_EMPRESA`, `DATA_PEDIDO`, `STATUS_PEDIDO`, `COD_NOTA_FISCAL_EMITIDA`, `OBSERVACOES`, `PRODUTO_TROCA`) + `_ITENS` (`COD_NF`+`COD_ITEM_NF` da ENTRADA, `COD_PRODUTO`, `QTD_NOTA_FISCAL`, **`QTD_DEVOLVIDA`**, `VALOR_CUSTO`, `TOTAL_PRODUTO_NOTA`/`TOTAL_PRODUTO_DEVOLVIDO`, `CFOP`, bloco fiscal + espelho `*_NOTA`).
- **PARTE da NF de ENTRADA** original (nunca do pedido de compra): 100% dos 3.809 itens têm `COD_NF`→NF `TIPO='E'`. Picker legado = view `GET_NF_PROD_DEV`.
- **SALDO / parcial é a norma** (3.188/3.809 devolvem menos): `QTD_DEVOLVIDA` por item; saldo = qtd da entrada − Σ devolvido (exceto CANCELADO); não há coluna acumuladora.
- **Custo/impostos rateados** da entrada: `VALOR_CUSTO = TOTAL_PRODUTO_NOTA/QtdNota`; `TOTAL_PRODUTO_DEVOLVIDO = VALOR_CUSTO×QtdADevolver`; impostos = `(valor_NOTA/QtdNota)×QtdADevolver`.
- **CFOP de saída** via de-para `CFOP.CFOP_DEVOLUCAO` (1102→5202, 2102→6202, +ST 5411/6411). Sem mapeamento → o legado ABORTA.
- **Workflow** `STATUS_PEDIDO`: EM DIGITACAO→DIGITADO→NOTA FISCAL EMITIDA→FINALIZADO (+CANCELADO); edição só em EM DIGITACAO.
- **Efeitos (só na NF de saída, não no documento):** ao "Gerar NF de Devolução" → NF `TIPO='S' FINALIDADE='4'` + `NF_REFERENCIA`/refNFe (1 por NF-origem); no processamento: **estoque−** (kardex "SAIDA DE ESTOQUE; REF. NOTA COD"), **A RECEBER contra o FORNECEDOR** (crédito — NÃO abate A Pagar; venc = faturamento da entrada + `QUANTIDADE_DIAS_GERAR_BOLETO_DEVOLUCAO`), fiscal de saída (situações contábeis 825/826/827 DEBITO ICMS/PIS/COFINS SAIDA - DEVOLUCAO COMPRAS). Sem senha de supervisor dedicada.

## 2. Monorepo — reuso
Quase tudo já existe: estoque de saída (o F3 `nf-processamento` baixa por `tipo='S'`), `nf.finalidade='4'` + referência entre NFs (`nf_referencia`/`codnf_ref`), a validação zod `validaDevolucao`, CFOP 5202 no seed, o faturamento (saída→A Receber). O trabalho novo é o DOCUMENTO (agregado) + o picker de saldo + o "Gerar NF de Devolução" (molde `RecebimentoService.gerarNf`, corte-2).

## 3. Plano de cortes
- **Corte-1 (ESTE) — núcleo do documento, SEM efeitos** (migration 072): agregado `pedido_devolucao_compra` + `_i`; picker `GET compras/devolucao-compra/itens-disponiveis` (saldo = qtd entrada − Σ devolvido); `validar` (fornecedor FRN; item de NF de ENTRADA do próprio fornecedor; CFOP_DEVOLUCAO configurado; saldo por origem; edição só EM_DIGITACAO); `derivarItensTrx` TOTAL_PRODUTO_DEVOLVIDO = custo×qtd; verticais finalizar/reabrir/cancelar (CAS); coluna `cfop.cfop_devolucao` + CFOPs de devolução; view + RBAC `FRMDEVOLUCAOCOMPRA`; tela (fornecedor→picker→qtde→gravar + lista/workflow).
- **Corte-2 (próximo) — Gerar NF de Devolução**: materializa a NF `tipo='S' finalidade='4'` (CFOP mapeado, `nf_referencia`/refNFe por NF-origem, codparceiro=fornecedor, situação saída), vincula `COD_NOTA_FISCAL_EMITIDA`, status→NOTA_FISCAL_EMITIDA. Espelho fiscal completo do item. Reusa a máquina de NF (F3 estoque− / F4 A Receber). Molde `RecebimentoService.gerarNf`.
- **Corte-3 — efeito financeiro/fiscal fiel**: A Receber contra o fornecedor no faturamento da devolução (venc = faturamento-entrada + `QUANTIDADE_DIAS_GERAR_BOLETO_DEVOLUCAO`), situações 825/826/827.
- **ADIADO**: troca de produto (`PRODUTO_TROCA`/`COD_TROCA` — 0 headers/21 itens no golden); refNFe SEFAZ real (F6 externo adiado).

## 4. Corte-1 — o que foi construído
- **Migration 072**: `pedido_devolucao_compra` (header, empresaScoped, soft-delete INDR, status default EM_DIGITACAO) + `pedido_devolucao_compra_i` (itens referenciando codnf/codnfprod da entrada + qtd_devolvida + custo/totais) + `cfop.cfop_devolucao` + CFOPs 1403/2403/6202/5411/6411 + de-para; view `get_pedido_devolucao_compra`; RBAC.
- **Agregado** (`devolucao-compra.aggregate.ts`): colunas editáveis (codparceiro/data/produto_troca/obs); `derivarTrx` codoperador; `derivarItensTrx` total_produto_devolvido = custo×qtd; `validar` (estado EM_DIGITACAO / fornecedor FRN / item de NF-entrada do próprio fornecedor / CFOP_DEVOLUCAO / **saldo por origem** agregando o dto + Σ outros não-cancelados); `validarRemocao` (só EM_DIGITACAO).
- **Vertical** (`devolucao-compra.service.ts`): `itensDisponiveis` (picker de saldo, mesma fórmula do validar) + `finalizar`/`reabrir`/`cancelar` (forUpdate + CAS).
- **Front** (`DevolucaoCompraCadMaster.tsx`): fornecedor (lookup FRN) → carregar itens (picker) → qtde a devolver por item (≤ saldo; item sem CFOP_DEVOLUCAO desabilitado) → gravar; lista com workflow (finalizar/reabrir/cancelar/excluir). Rota `/compras/devolucao` + menu. Botão compartilhado ganhou `disabled`.
- **Smoke §73** (5): picker (saldo 10 + cfop_devolucao 5202 + custo) · criar parcial (total=custo×qtd) · saldo decresce + qtd>saldo→422 + qtd exata→201 · workflow (finalizar→DIGITADO / PUT em finalizado→422 / cancelar libera saldo) · gates (CFOP sem devolução→422 / não-FRN→422 / RBAC 403).

### Divergências CONSCIENTES
- **0 efeitos** no documento (fiel: o legado só dispara na NF de saída) — estoque/financeiro/fiscal são cortes 2/3.
- **Espelho fiscal do item ADIADO** (ICMS/ST/IPI/`_NOTA`) — só é necessário na geração da NF (corte-2); o corte-1 guarda referência + qtd + custo + totais.
- **status como enum** `EM_DIGITACAO` (o legado usa a string `'EM DIGITACAO'`) — normalizado; o cutover mapeia.
- **Troca de produto ADIADA** (uso ~nulo no golden).

### Auditoria adversarial (2 agentes: paridade + regressão/segurança) — folds
Ambos: **safe to commit (corte-1)** — núcleo FIEL (saldo `GetQtdDevolvida` = Σ não-cancelado, elo com NF de entrada, workflow, de-para CFOP; smoke-verde) e sem cross-tenant/RBAC/bypass de saldo. Folds dobrados:
- **[MÉDIA, ambos] valor_custo/idproduto/cfop/qtd confiados do cliente** → `derivarItensTrx` (que recebe a `trx`) re-deriva o SNAPSHOT da `nf_prod` + de-para CFOP (autoritativo, dentro da transação); o cliente só escolhe `qtd_devolvida`. Fecha a base do FATO futuro (o crédito ao fornecedor virá do custo real).
- **[MÉDIA, paridade] CFOP de origem VAZIO passava** → `DEVOLUCAO_CFOP_ORIGEM_AUSENTE` (o legado exige "reimporte a nota", :1006). Smoke §73.5.
- **[BAIXA, ambos] saldo arredondado a 2 casas** (qtd é numeric(13,3)) → alinhado a **3 casas** (r3) no validar, igual ao picker.

**PRÉ-REQUISITOS do corte-2 (documentados, adiados — hoje 0 efeitos):**
- **[MÉDIA] concorrência** — o `validar` do engine roda FORA da transação (réplica); duas devoluções concorrentes da mesma origem podem exceder o saldo. Fechar no corte-2 com `SELECT … FOR UPDATE` na origem dentro da trx (herdado do engine; mitigado por 0 efeitos hoje).
- **[MÉDIA] NF de entrada CANCELADA/rascunho** entra no picker (o legado filtra `REPASSADO='S'`, coluna inexistente no novo) → definir o critério de "NF concluída" no corte-2.
- **[MÉDIA] custo × fatorembal** — a fórmula usa `vrcusto` direto (premissa `fatorembal=1` do recebimento novo); o legado divide por `qtd×fatorembal`. Robustecer/confirmar no corte-2 (espelho fiscal).
- **[BAIXA] fornecedor inativo/bloqueado** não barrado (só FRN); **status enum** com underscore vs strings legadas (cutover corte-5); descrição do CFOP 5411 herdada do seed 041 (mapeamento 1403→5411 correto); config de `cfop_devolucao` dos demais CFOPs sem UI.

**Verde pós-fold:** api tsc 0 · api test 138 · smoke **502/0** (5 DEVOLUÇÃO, com M1/M4) · web tsc 0 · web test 32 · web build ✓.
