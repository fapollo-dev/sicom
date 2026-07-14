# Dossiê de Tela — DEVOLUÇÃO DE COMPRA — `FRMDEVOLUCAOCOMPRA` (`uCadPedidoDevolucaoCompras`)

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | **corte-1** (NÚCLEO do documento, migration 072) ENTREGUE 2026-07-14; **corte-2** (Gerar NF de Devolução — NF saída finalidade=4 + refNFe, migration 073) ENTREGUE 2026-07-14; **corte-3** (fidelidade fiscal/financeira — ParceiroZera + espelho PIS/COFINS + vencimento do A Receber, migration 074) ENTREGUE e verde 2026-07-14. Recon (Oracle+Delphi+monorepo) + auditoria adversarial (2 agentes/corte). Verde corte-3: api tsc 0 · api test 138 · smoke **505/0** (8 DEVOLUÇÃO) · web tsc 0 · web test 32 · web build ✓. |
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
- **Corte-2 (ENTREGUE, migration 073) — Gerar NF de Devolução**: ver §5. Materializa a NF `tipo='S' finalidade='4'` + refNFe + vínculo; os efeitos (estoque−/A Receber) o operador roda na NF (F3/F4).
- **Corte-3 (ENTREGUE, migration 074) — fidelidade fiscal/financeira**: ver §6. ParceiroZera + espelho PIS/COFINS no gerar-NF + faturar (A Receber contra o fornecedor, venc = emissão + config dias).
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

## 5. Corte-2 — GERAR NF DE DEVOLUÇÃO — ENTREGUE e verde, 2026-07-14
`POST compras/devolucao-compra/:id/gerar-nf` (RBAC BTNGERARNF, migration 073). Materializa a NF de SAÍDA a
partir do documento **DIGITADO** (molde `RecebimentoService.gerarNf`, `ImportaPedidoDevolucaoCompra` do legado):
- **NF `tipo='S' finalidade='4'`**, tipoemissao='0' (própria), modelo 55, dtemissao/dtcontabil=hoje, codparceiro=fornecedor;
  **CFOP header** = o CFOP de devolução do 1º item.
- **Itens**: quantidade = `qtd_devolvida`; vrcusto/vrvenda = custo da entrada; **ESPELHO FISCAL RATEADO** da
  entrada por `qtd_devolvida/qtd_nota_fiscal` (ICMS base/valor, ST base/valor, IPI, FCP) + aliquota/ncm/origem do
  produto; geraestoque/movimenta_estoque='S'.
- **refNFe**: `nf_referencia` — 1 linha por NF de ENTRADA distinta (codnf_ref + chave_ref da origem) — exigido
  por `validaDevolucao`.
- **Vínculo/estado**: `codnf_emitida` = a NF gerada; status → NOTA_FISCAL_EMITIDA.
- **Anti-duplo (fecha M2)**: CAS-first `status DIGITADO + codnf_emitida NULL → NOTA_FISCAL_EMITIDA` antes de
  criar a NF; falha na criação → reverte a DIGITADO (try/catch).
- **Guarda (fecha M3)**: nenhuma NF de entrada de origem pode estar CANCELADA (`nf.cancelada`).
- **Efeitos** (estoque−, A RECEBER contra o fornecedor) = a máquina de NF existente (F3 processar / F4 faturar,
  tipo='S'→areceber com codparceiro=fornecedor). Front: ação «Gerar NF» no status DIGITADO.
- **Smoke §73.6**: gerar-NF → NF saída finalidade=4 CFOP 5202 + refNFe(codnf_ref) + item(qtd 4) + vínculo/status
  NOTA_FISCAL_EMITIDA; re-gerar → 422 DEVOLUCAO_NF_JA_EMITIDA.

### Divergências CONSCIENTES / adiados (corte-3)
- **Situação-NF de saída + contábil** (825/826/827 DEBITO ICMS/PIS/COFINS SAIDA - DEVOLUCAO COMPRAS) — não setada; corte-3.
- **Espelho fiscal PARCIAL** (ICMS/ST/IPI/FCP rateados; PIS/COFINS/seguro/frete/`_NOTA`/`ParceiroZeraImpostosDeICMSSt` adiados) — o F2 (recalcular) da NF pode complementar; corte-3.
- **NF de saída single-UF-class** — o CFOP header = 1º item; devolução com itens 5xxx+6xxx misturados não é suportada num único documento (o operador separa). Documentado.
- **Numeração/transmissão SEFAZ (refNFe real, NRONF)** — F6 externo adiado; a NF nasce rascunho (proc='N').
- **Vencimento do A Receber** (faturamento-entrada + `QUANTIDADE_DIAS_GERAR_BOLETO_DEVOLUCAO`) — corte-3.

### Auditoria adversarial (2 agentes: paridade/fiscal + regressão/concorrência) — folds
Núcleo FIEL (rateio ≡ `GetValorCalculado`; refNFe 1-por-NF via codnf_ref; vrcusto/vrvenda=custo; gate DIGITADO; CFOP header=1º item). Folds dobrados:
- **[ALTA, concorrência] catch revertia status após a NF commitada → 2ª NF (duplo estoque−/A Receber)** — refeito no padrão do RECEBIMENTO: vínculo **IN-ROW `nf.cod_ped_dev_compra`** (atômico com a criação) + **UNIQUE parcial** `ux_nf_cod_ped_dev_compra` (backstop 23505→já-emitida) + **catch ESTREITO** (só reverte se a criação falhar) + **reconciliação** (jaNf: se a NF já existe mas o reverse-link não gravou, reconcilia o codnf_emitida e reporta já-emitida — nunca duplica nem trava). Fecha a ALTA e a MÉDIA (NF órfã / documento travado por crash).
- **[MÉDIA, paridade] `ipi: rat(it.ipi)` rateava a ALÍQUOTA %** → íntegra (`num(it.ipi)`, como o ICMS); só o valor `vripi` rateia.
- **[MÉDIA, paridade] série '1' fixa** (a NF de saída própria É numerada pelo agregado) → usa `empresas.serie_nfe` (o legado usa EmpresaSERIE); doc corrigida (a NF nasce NUMERADA, não "rascunho sem número").
- **[BAIXA] read do espelho fiscal sem filtro de tenant** → `.where('n.idempresa','=',emp)`; **M3** também cobre `statusnfe='C'` (não só `cancelada='S'`).

**ADIADO (documentado — corte-3 fiscal / F6):** `ParceiroZeraImpostosDeICMSSt` (`parceiros.devolucao_zera_imposto_icmsst`='S' → zera ICMS/ST + CST 060/000/020: **incorreção fiscal real p/ esses fornecedores** até o corte-3); espelho de PIS/COFINS/seguro/frete/`_NOTA`; situação-NF + contábil 825/826/827; `codparceiro_end`/`obs`/informações-adicionais (DANFE); `nf_referencia.modelo`/chave_ref real + numeração/transmissão SEFAZ (F6); vencimento do A Receber (`QUANTIDADE_DIAS_GERAR_BOLETO_DEVOLUCAO`); mixed-UF (5xxx+6xxx) num só documento.

**Verde pós-fold:** api tsc 0 · api test 138 · smoke **503/0** (6 DEVOLUÇÃO, com o IN-ROW) · web tsc 0 · web test 32 · web build ✓.

## 6. Corte-3 — FIDELIDADE FISCAL/FINANCEIRA — ENTREGUE e verde, 2026-07-14
Escopo escolhido (usuário): **fiscal do NF + vencimento do A Receber** (situações 825/826/827 = apuração fiscal/SPED, camada ausente → adiado). Migration 074.
- **ParceiroZera** (`uDMCadPedidoDevolucaoCompra.pas:435`) no gerar-NF: fornecedor com `parceiros.devolucao_zera_imposto_icmsst='S'` (golden: só 3 — NESTLE/LATICINIO/WICKBOLD) → por `slice(1,4)` do CFOP de ORIGEM: **401/403/405** (ST retido) → zera ICMS **e** ST, **CST 060**; **101/102** (tributado) → zera só ST, **CST 000** (redução 0/100) senão **020**. FCP não é tocado (fiel).
- **Espelho PIS/COFINS** no gerar-NF: `pis`/`cstpiscofins`/`aliqpise`/`aliqcofinse` copiados da entrada (~41-47% dos itens no golden). Completa o espelho (ICMS/ST/IPI/FCP já vinham do corte-2).
- **Faturar** (`POST :id/faturar`, RBAC BTNFATURAR): A RECEBER contra o FORNECEDOR (delega ao F4 `nf-faturamento.faturar`; tipo='S'→areceber, codparceiro=fornecedor), **1 parcela**, **vencimento = DTEMISSAO da NF + `QUANTIDADE_DIAS_GERAR_BOLETO_DEVOLUCAO`** (config global, golden=15; migration 074 seed id 330). Front: ação «Faturar» no status NOTA_FISCAL_EMITIDA.
- **Smoke §73.7/73.8**: faturar → A Receber contra o fornecedor 22 (valor=totalnf, venc=emissão+15) · ParceiroZera (flag S + CFOP 1403 → NF de devolução zera ICMS+ST, CST 60).

### Divergências CONSCIENTES / adiados
- **Vencimento = DTEMISSAO + N dias** (o default; golden moda 46%). O legado usa a data de FATURAMENTO da NF de ENTRADA como base (quando 1 NF); o alinhamento ao vencimento da compra original é comportamento de fluxo do operador (edita na tela) — divergência consciente (o corte reproduz a MODA/default).
- **Situações 825/826/827** (DEBITO ICMS/PIS/COFINS SAIDA - DEVOLUCAO COMPRAS, TIPO_OPERACAO I02/I06/I10) = classificação de **apuração fiscal/SPED sem conta contábil**; o monorepo não tem essa camada → o header da NF usa a situação operacional (como o golden usa 17) e a apuração fica p/ o épico de SPED. ADIADO.
- **PIS/COFINS**: copiados sempre (o legado copia só se `BCPISCofinsE>0`) — diferença benigna (valor 0 quando a entrada não tinha). `_NOTA`/valores vrpise/vrcofinse (a nf_prod não tem essas colunas de valor) — o espelho é por alíquota.
- **CST 000 vs 020** deriva de `bcr` da entrada (base reduzida); entrada sem `bcr` → 000. **SEGURO/FRETE** raros/nunca no golden → não priorizados.

### Auditoria adversarial (2 agentes: paridade fiscal + regressão/segurança) — folds
Núcleo FIEL (ParceiroZera 401/403/405→CST 60 zera ICMS+ST; espelho ICMS rateado; vencimento=emissão+15 bate a moda do golden; A Receber contra o fornecedor; sem cross-tenant/duplo-título; CST inteiro 60/0/20 fiel). Folds dobrados:
- **[MÉDIA, ambos] `tipodoc` do A Receber ficava NULL** (o `faturar` genérico não seta) — o golden/config/nome dizem **BOLETO**. Fix: `faturar` ganhou param opcional `tipodoc` (F4 manual mantém NULL); a devolução passa `'BOLETO'`. Smoke §73.7 agora checa.
- **[MÉDIA, paridade] frete/seguro/despesas/desconto fora do TOTALNF** → o valor do A Receber divergia quando a entrada os tinha. Fix: espelha `desconto`/`frete`/`seguro`/`vroutrasdesp` (rateados) no item + seta `totalfrete/totalseguro/totalacessorias` no header do dto (o `derivar` do NF os compõe no totalnf).
- **[BAIXA, ambos] config '0' dias virava 15** (`|| 15`) → distingue null de 0 (boleto à vista configurável).

**ADIADO (documentado — épico SPED / família `_NOTA`):**
- **CST 000 vs 020** (grupo 101/102) deriva de `nf_prod.bcr`; o legado usa `ICMS_RED_BC_NOTA` (coluna `_NOTA` inexistente no monorepo) e `bcr` do import costuma ser null → CST default **000** (o legado poria 020 em redução parcial). Divergência consciente até a família `_NOTA`/SPED.
- **PIS/COFINS** copiados SEMPRE (o legado só se `BCPISCofinsE>0`; o monorepo não tem `bcpiscofinse`/valores) — só alíquotas, parte do adiamento PIS/COFINS-SPED.
- **ParceiroZera lê `p.cfop`** (não `CFOP_ORIGINAL`) — equivalente no caso normal (o import só muda o 1º dígito; `slice(1,4)`/`copy(2,3)` coincidem).
- **IPI%** não recomputado (`VrIPI×100/VRTOTALPRODUTOS`) + roteamento `IPI_DEVOLUCAO_EM_TRIBUTOS_DEVOLVIDOS` — SPED, adiado. **Vencimento** ancora em DTEMISSAO (não na data de faturamento da entrada) — o alinhamento é fluxo do operador. **Situações 825/826/827** = apuração/SPED sem consumidor no monorepo. **Botão «Faturar»** persiste após faturar (re-clique rejeitado com NF_JA_FATURADA — defensável, permite re-faturar pós-estorno).

**Verde pós-fold:** api tsc 0 · api test 138 · smoke **505/0** (8 DEVOLUÇÃO) · web tsc 0 · web test 32 · web build ✓.
