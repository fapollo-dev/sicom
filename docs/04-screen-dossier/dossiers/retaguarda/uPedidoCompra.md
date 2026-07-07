# Dossiê de Tela — PEDIDO DE COMPRA — `FRMPEDIDOCOMPRA`

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | corte-1 (NÚCLEO: cabeçalho + itens + workflow FECHADO) ENTREGUE e verde, 2026-07-07. Recon multi-agente (4 agentes: Oracle modelo + custo/fiscal do item + reuso monorepo + ciclo-de-vida) + auditoria adversarial 2 agentes (paridade vs Oracle + regressão/segurança) — achados dobrados antes do commit. Verde: shared build · api tsc 0 · api test 123 · smoke **412/0** (18 PEDIDO) · web tsc 0 · web test 27 · build. |
| **Autor** | Claude (agente de migração) |
| **Fontes legadas** | `FRMPEDIDOCOMPRA` (`uPedidoCompra.pas`, 8973 linhas — a MAIOR tela; .pas ausente no filesystem → recon por Oracle + monorepo). |
| **Golden** | Oracle PINHEIRAO: `PEDIDOCOMPRA` (10.378), `PEDIDOCOMPRA_I` (286.854), `PEDIDOCOMPRA_PARCELAS` (9.010), `CONDICOES_PAGTO`. |

## 1. Modelo (Oracle real)
- **Master-detail.** `PEDIDOCOMPRA` (cabeçalho, PK `CODPEDCOMP`) + `PEDIDOCOMPRA_I` (itens, PK `CODPEDCOMPI`, FK `CODPEDCOMP`, ~28 itens/pedido).
- **O pedido é INTENÇÃO (previsão).** O FATO (fiscal definitivo, movimento de estoque, títulos A Pagar) nasce na **NF de ENTRADA** que referencia o pedido — vínculo INVERTIDO `NF.CODPEDCOMP` (3.241 de 23.408 NFs; a NF aponta o pedido, não o contrário). Recebimento parcial = várias NFs por pedido (1:N).
- **QUANTIDADE do item = `FATOREMBALAGEM`** (NUMBER(13,2)). **Não existe coluna "qtd".** Custo unitário negociado = `VRCUSTO` (NUMBER(12,4)). **`VLREMBALAGEM = FATOREMBALAGEM × VRCUSTO`** (custo estendido; confirmado 100% nas amostras). **Total do pedido = Σ VLREMBALAGEM** (o cabeçalho **NÃO persiste total** — pedido 123 = 72 itens Σ=4.349,56, batido).
- **Item NÃO tem CFOP nem UNIDADE** (vêm do produto/regra fiscal). Os "impostos" do item (`ICME`/`IPI`/`ICMST`/`PISCONFIS`) são **alíquotas de SIMULAÇÃO** (%), não valores — o imposto definitivo é da NF. `PISCONFIS` é constante 9,3 (não é cálculo por item).
- **markup/preço-venda** (`MARKUP`/`VRVENDA`/`VRVENDASUG`/`PMZ`/margens) = analítica do motor `precificacao` (SUGESTÃO); `VRVENDA` é preço redondo DECIDIDO (nunca deriva de custo×(1+markup)). `PEDIDOCOMPRA_I` e `NF_PROD` compartilham o MESMO bloco de precificação (mesmo motor escreve nos dois); só a NF_PROD tem o bloco fiscal DEFINITIVO (CFOP/CST/base/valor em R$).
- **Máquina de estados** = flags + timestamps (não há campo "status" único): `FECHADO` 'N' rascunho (1.817) → 'S' fechado (8.113); **há um 3º valor `FECHADO`=NULL (448, ~4,3%)** — a maioria (437) é faturada (legado legado). É o **gate principal**; `DTFATURAMENTO` (faturado — **1.804 pedidos têm dtfaturamento com FECHADO='N'**: faturado NÃO implica FECHADO='S', por isso a trava de edição/exclusão é por `dtfaturamento`, não só por `FECHADO`); `DTENCERRAMENTO` (encerrado); `INDR='E'` cancelado (71); `IMPORTADO`/`LTPRECO_PROCESSADO`/`BONIFICACAO` (periférico). **Cutover:** ao importar, `FECHADO`=NULL vira rascunho editável salvo se `dtfaturamento` presente (a guarda pega).
- **`EMPRESAS`** (cabeçalho) é um **CSV** de ids de loja ("1-para-N-lojas"; `COMPRA_1_PARA_N_LOJAS` quase sempre 'N').
- **TRIGGERS / efeitos:** cabeçalho **NENHUM trigger**; item só `AUDIT_PEDIDOCOMPRA_I` (auditoria, não mexe em estoque/custo). **O pedido é TRANSACIONAL PURO — sem side-effects no banco.** Todo efeito é da aplicação ou do fluxo de NF.
- **Volumes:** 10.378 pedidos (2020→2026), em queda recente (2024=186) — feature em desuso relativo.

## 2. Monorepo
Agregado DECLARATIVO (molde `nf.aggregate.ts` / `lote-cobranca.aggregate.ts`) via `AggregateEngineService` (header+itens numa transação, substituição de itens no update, cascata na exclusão). Reusa: engine + `createAggregateController`, lookup de fornecedor (`parceiros` FRN='S'), lookup de produtos, `all-exceptions.filter` (CODE→PT). Novo módulo `ComprasModule` (path `compras/pedidos`).

## 3. Corte-1 (ENTREGUE) — NÚCLEO
- **Migration 060**: `pedidocompra` (cabeçalho empresaScoped, soft-delete INDR) + `pedidocompra_i` (itens) + view `get_pedidocompra` (fornecedor via JOIN + **total = Σ VLREMBALAGEM** subquery) + RBAC (`FRMPEDIDOCOMPRA`: BTNGRAVAR/BTNEXCLUIR/BTNFECHAR/BTNREABRIR).
- **Agregado `pedido-compra.aggregate.ts`** (declarativo): `empresaScoped`, `softDelete`, colunas do header (codparceiro, data, dt_vencimento, codconpagto, frete tipo/valor, nronf_cruzamento, obs); detalhe `pedidocompra_i` com **`derivarItensTrx` → VLREMBALAGEM = FATOREMBALAGEM × VRCUSTO** (server-authoritative); **`derivarTrx` → CODOPERADOR = operador do contexto** (comprador; só no create → imutável); **`validar`** (fornecedor FRN='S'; pedido FECHADO é read-only); **`validarRemocao`** (FECHADO não exclui).
- **Vertical `pedido-compra.service.ts` + controller** (transições de estado no mesmo path): `fechar` (N→S, exige ≥1 item, CAS anti-duplo-fechamento) + `reabrir` (S→N, CAS, bloqueado se faturado). Tenant `idempresa`+operador fail-closed. **Guardas coerentes** (achado da auditoria dobrado): edição (`validar`), exclusão (`validarRemocao`) e `reabrir` TODAS travam por `dtfaturamento` (faturado é read-only, mesmo com FECHADO='N') E ignoram pedido excluído (INDR='E' → `PEDIDO_NAO_ENCONTRADO`, sem "ressurreição" de estado). **Anti-overflow:** VLREMBALAGEM é `numeric(18,4)` + teto no schema (fator/custo ≤ 9.999.999) + mapeamento PG `22003`→400 (nunca 500 cru).
- **Schema** `pedido-compra.schema.ts`: header (fornecedor obrigatório; ao menos 1 item no create) + item (fatorembalagem>0, vrcusto≥0; VLREMBALAGEM aceito p/ round-trip mas sobrescrito no servidor). **Front** `PedidoCompraCadMaster` (master-detail: header + itens + total + fechar/reabrir honrando rascunho/fechado) + rota `/compras/pedidos` + menu.
- **Smoke §48** (15 checks): criar/derivar VLREMBALAGEM/total-view · server-authoritative · fornecedor-não-FRN 422 · sem-itens/sem-fornecedor 400 · editar-substitui-itens · fechar/reabrir · editar/excluir-FECHADO 422 · fechar-2x/reabrir-não-fechado/fechar-sem-itens 422 · soft-delete · RBAC 403 · multi-tenant.

### Divergências CONSCIENTES
- **Single-empresa** (empresaScoped IDEMPRESA) — o legado tem `EMPRESAS` CSV "1-para-N-lojas" (`COMPRA_1_PARA_N_LOJAS` quase sempre 'N'; só 214 pedidos, 2%, têm CSV multi-loja). O corte-1 é single-loja (padrão do monorepo); o 1-para-N é feature ADIADA.
- **Fornecedor escopado por IDEMPRESA** — no legado `PARCEIROS` é GLOBAL (17.722 de ~18.147 têm IDEMPRESA NULL; o vínculo loja é a coluna `EMPRESAS`). No monorepo `parceiros` é `empresaScoped` (parceiro.aggregate.ts) e TODA tela migrada valida assim (o Lote de Cobrança valida o cobrador por idempresa — `lote-cobranca.repository.assertCobradorValido`). O `validar` do pedido segue esse padrão UNIFORME: divergência consciente do legado, mas coerente com o monorepo. (Consequência: cada empresa/tenant precisa dos seus próprios fornecedores cadastrados.)
- **Cabeçalho NÃO persiste total** — fiel ao legado (total = Σ VLREMBALAGEM na view/on-demand). Não há coluna de total.
- **VLREMBALAGEM derivado server-side** — o cliente não é fonte da verdade (fórmula confirmada no golden). Divergência de FORMA, não de valor.
- **CODOPERADOR = operador do contexto** (comprador que criou) — server-set, imutável. O legado grava o comprador; aqui vem do login.
- **fechar/reabrir como recurso explícito** — o legado alterna `FECHADO` na tela; aqui são endpoints dedicados (CAS + guardas), convenção do monorepo.

## 4. Adiado (com procedência — nada perdido)
- **NF de entrada / recebimento** (`NF.CODPEDCOMP`, `STATUS_PEDCOMP`, faturado/encerrado, recebimento parcial 1:N) — depende do vínculo NF↔pedido (NF.CODPEDCOMP ainda não migrado). É onde o pedido vira FATO (estoque/custo/A Pagar). A guarda `validarRemocao` de pedido-com-NF entra junto.
- **Condição de pagamento / parcelas** (`CONDICOES_PAGTO` lookup + `PEDIDOCOMPRA_PARCELAS` 2º detalhe, 9.010 vivas) — corte-1 guarda `codconpagto` (número) + `dt_vencimento` diretos; o plano de parcelas detalhado é corte-2.
- **Precificação/analítica do item** (`MARKUP`/`VRVENDA`/`VRVENDASUG`/`PMZ`/`VRCUSTOLIQUIDO`/margens/lucros) — output do motor `precificacao` (SUGESTÃO); reuso opcional em corte-2 (não é dado primário). **Nota de magnitude (auditoria):** essas colunas são MUITO populadas no golden (`VRVENDA` 100%, `MARKUP` 98,2%, margens ~98,3%, `VLREMBALAGEMB`≈VLREMBALAGEM redundante 100%) — a decisão de adiar é defensável (é sugestão do motor, não fato), mas o volume é alto; reavaliar prioridade do reuso do motor no corte-2.
- **`CD1` (header, populada 73,8% / 56 valores distintos)** — semântica DESCONHECIDA (campo genérico CD1..CD8). Não é "lixo" (tem carga real); ADIADO até confirmar o significado antes de descartar/migrar. (CD2..CD8, `NRONF`/`IDSITUACAO_NF`/`IDTF`/`SINCRONIZADO` confirmados 100% NULL = lixo real.)
- **Impostos do item** (`ICME`/`IPI`/`ICMST`/`PISCONFIS`/créditos-débitos) — alíquotas de simulação; o imposto DEFINITIVO nasce na NF (não replicar cálculo fiscal no pedido).
- **Análise/aprovação/limite** (`OPERADOR_ULTIMA_ANALISE`, `NOVO_LIMITE`+senha, `OPERADOR_ULT_LIB_VALOR_MAX`), **bonificação** (`BONIFICACAO`/`CODPEDCOMP_BONIFICADO`), **importação de preços** (`IMPORTADO`/`LTPRECO_PROCESSADO`), **1-para-N-lojas** (`EMPRESAS` CSV).
- **Colunas mortas/lixo** (`NRONF`/`IDSITUACAO_NF`/`IDTF`/`SINCRONIZADO` 100% NULL; `VLRUNITARIO`/`VRVENDAITEM` do item; `CD2..CD8`) — descartadas. (`CD1` movida p/ adiado — tem carga real, ver §1.)
- **Satélites 0 linhas** (`PEDIDOCOMPRA_ANALISE`/`_COLETOR`/`_QTDE_TRANSF`/`_CARRINHO`/`_CARRINHO_ITEM`/`PEDIDOCOMPRACEREAL`) — ignoradas.
