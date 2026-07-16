# Dossiê de Tela — PEDIDO DE COMPRA — `FRMPEDIDOCOMPRA`

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | corte-1 NÚCLEO (cabeçalho + itens + workflow FECHADO, §0-4) + **PEDIDO corte-2** (condição de pagamento + parcelas, §11) + **RECEBIMENTO corte-1** (gerar NF do pedido, §5) + **corte-2** (import de XML valorado, §6) + **corte-3** (de-para de fornecedor CODREFERENCIA_FOR, §7) + **corte-4/4b** (duplicatas do XML → A Pagar + forma `<pag>` + gate CFOP, §8) + **corte-4c** (ST RESIDUAL → título A Pagar 'RESIDUAL ST', §9) + **corte-4c-b** (RETENÇÃO FEDERAL → títulos A Pagar ao órgão + abate, §10) + **PRECIFICAÇÃO do item** (markup→venda + margem/PMZ reusando o motor, §12) + **CUTOVER do de-para** (ferramenta + motor de de-dup verificado contra os 16.229 reais: 16.229→16.029 limpas, 48 grupos ambíguos p/ revisão, §14) — todos ENTREGUES e verdes (2026-07-07/14). Recon multi-agente + auditoria adversarial 2 agentes por corte (paridade vs Oracle/fonte Delphi + regressão/segurança) — achados dobrados antes de cada commit. Verde: shared build · api tsc 0 · api test 128 · smoke **471/0** (18 PEDIDO + 8 PED-2 + 1 PREC-ITEM + 7 RECEB + 11 IMPORT + 5 DE-PARA + 4 DUP + 2 4B + 9 4C + 8 4C-B + 3 PREC) · web tsc 0 · web test 27 · build. |
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

## 5. Recebimento (corte-1) — gerar NF de entrada a partir do pedido — ENTREGUE e verde, 2026-07-08

Recon multi-agente (Oracle fluxo/modelo + reuso monorepo). **Achado-âncora:** o "recebimento" REAL do legado é **IMPORT do XML da NFe do fornecedor casado a um pedido** — todas as 3232 NFs de entrada vinculadas têm `NF_IMPORTACAO_NFE='S'` + chave de 44 díg; a NF carrega o FATO (quantidades/custos/fiscal REAIS do XML, que **DIFEREM** do pedido). O import de XML é épico à parte (adiado). Vínculo é SÓ de cabeçalho `NF.CODPEDCOMP` (sem FK de item; itens correlacionam por produto). **Efeito 100% delegado ao processamento da própria NF** (flip PROC 'N'→'S' = F3 move estoque; faturamento = F4 gera A Pagar) — nenhuma lógica de recebimento no banco, nenhum trigger em PEDIDOCOMPRA.

**Corte-1 (escolhido via AskUserQuestion "Gerar NF rascunho"):** `POST compras/pedidos/:id/gerar-nf` gera uma NF de entrada **RASCUNHO** pré-preenchida a partir do pedido:
- **Migration 061**: `ALTER nf ADD codpedcomp` (FK) + **UNIQUE PARCIAL `ux_nf_codpedcomp`** (backstop 1:1 do corte-1) + seed dos CFOPs de entrada dominantes (**1403/ST**, 2403, 1910, 1556 — 1403 não estava no seed 025) + RBAC `BTNGERARNF`. `codpedcomp` entrou em `nfAggregateConfig.colunas` (gravado atômico no create; o schema da NF descarta chaves desconhecidas, então um PUT normal não o altera — sem rebind/cross-tenant).
- **`RecebimentoService.gerarNf`**: guarda (pedido FECHADO + não recebido) → **CAS-first** (marca `dtfaturamento` ANTES de criar a NF: serializa o duplo-recebimento; desfaz se a criação falhar) → `createAggregate(nfAggregateConfig, dto)`. Mapeamento pedido→NF: `codproduto=idproduto`, `quantidade=fatorembalagem` (qtd pedida), `fatorembal=1` (não duplica a base de estoque), `vrvenda=vrcusto` (SEED: custo como valor unitário da entrada — base de TOTALPROD), `desconto`, e **aliquota/ncm/unidade/origem do PRODUTO**; valores fiscais em R$ ficam para o F2. `tipo='E'`, `tipoemissao='1'` (terceiros → não auto-numera NRONF), `modelo=1`, `serie='1'`, `cfop='1102'` (default NEUTRO não-ST) — todos EDITÁVEIS na NF (opts modelo/serie/cfop). Datas via `data::date` (sem shift de fuso).
- **Front**: botão "Gerar NF de entrada" na `AcoesEstadoBar` (visível em pedido fechado e não recebido) → navega para `/fiscal/notas/entrada`. O operador roda F2→F3→F4 na NF.
- **Smoke §49** (7 checks): rascunho→422 · gerar (fechado)→NF E vinculada terceiros mod.1 · itens mapeados (NCM/aliquota distintos do produto) · pedido recebido→reabrir/editar 422 · gerar 2x→422 + só 1 NF · RBAC 403 · **processar(F3) a NF gerada move estoque +10/+3 (FATO delegado à NF)**.

### Divergências CONSCIENTES / honestidade (auditoria 2 agentes: paridade + regressão)
- **Gera do pedido, NÃO importa XML** — o recebimento fiel é XML-import; o corte-1 gera um RASCUNHO a partir do pedido cujos valores (qtde/custo) são **sugestões editáveis** (o real vem da NF do fornecedor e DIFERE). Documentado; não finge que a NF gerada é o recebido definitivo.
- **`dtfaturamento` reusado como marcador "recebido/tem-NF"** — o legado marca recebido com `FECHADO='S' + IMPORTADO='S' + DTFATURAMENTO`; o **modelo migrado NÃO tem coluna IMPORTADO** (correção: `IMPORTADO` no legado é o marcador de recebimento/import, NÃO "importação de preços"). Reusamos `dtfaturamento` (cujo sentido legado é "faturado"), carimbado na GERAÇÃO (legado carimba no faturamento — divergência de timing). É o marcador que trava edição/exclusão/reabertura via as guardas do pedido.
- **CFOP default `1102` (não-ST)** — no golden o dominante é `1403` (ST, 3,5× mais comum); mas assumir ST por padrão seria errado (depende do item). `1102` é um default NEUTRO; o CFOP real vem da NF do fornecedor e o operador ajusta (1403 e cia. agora seedados p/ permitir o override).
- **`vrvenda=vrcusto`** — seed do rascunho (custo como valor unitário da entrada). No legado `VRVENDA` é o preço de VENDA e difere do custo em ~100% dos casos; ajustável na NF.
- **1:1 (um pedido → uma NF)** — o legado permite 1:N (recebimento parcial; ~63 pedidos, 2%). O corte-1 bloqueia a 2ª NF (UNIQUE parcial + CAS); 1:N entra com o import de XML.

## 6. Recebimento (corte-2) — IMPORT do XML da NFe do fornecedor → NF de entrada VALORADA — ENTREGUE e verde, 2026-07-08

Recon 2 agentes (Oracle+legacy flow — a **fonte Delphi ESTÁ no disco** em `.../retaguarda-master/fonte/`; mapa autoritativo = `TNFe.ImportaNFe`, NFe.pas:2842 — + reuso monorepo/parser). É o **entry-point REAL** do recebimento (todas as 3232 entradas vinculadas vieram de XML). Corte-2 = **Core** (escolhido via AskUserQuestion): ingere um XML fornecido (não fala com a SEFAZ) → NF de entrada com os **valores fiscais REAIS do XML** (base/ICMS/ST/IPI em R$ — não recalcula).

- **Dependência**: `fast-xml-parser` (registry OK; puro-JS). Parser API-side `nfe-xml.parser.ts` (config `removeNSPrefix`+`ignoreAttributes:false`+`parseTagValue:false`+`isArray:det`; trata `nfeProc>NFe>infNFe` e `NFe` nua; ignora `<Signature>`). Valida a chave (DV mód 11, reusa `chaveNfeValida`).
- **`main.ts`**: `useBodyParser('json', { limit: '5mb' })` — uma NFe real (dezenas de itens) estoura o default 100 KB.
- **`RecebimentoService.importarXml`**: parse → **fornecedor por CNPJ** (`parceiros_end.cnpj_cpf`, regexp só-dígitos, FRN='S') → **produtos por EAN** (`produtos.codbarra` → `codauxiliar.codbarra`); itens NÃO casados **BLOQUEIAM** (422 `NFE_PRODUTOS_NAO_CASADOS` com a lista — espelha o `frmProdNC` do legado). Mapa XML→nf/nf_prod: header `tipo='E'`, `modelo` do XML (55), `tipoemissao='1'`, `chavenfe`, `protocolo_nfe`, `nronf/serie` do ide, `dtemissao=dtcontabil=dtchegada=dhEmi`, totais `frete/seguro/acess` no header; item `quantidade=qCom`, `vrvenda=vrcusto=vUnCom`, `cfop` **ajustado saída→entrada (5→1/6→2/7→3)**, `codprodnota=cProd` (base de futura de-para), e os fiscais verbatim (`vrbasecalculo=vBC`, `icms=pICMS`, `vricm=vICMS`, `vrbasest=vBCST`, `vricmst=vICMSST`, `mva`, `ipi/vripi`, PIS/COFINS). CFOPs ajustados faltantes → **upsert no catálogo** (garante a FK). XML cru salvo em `nfe_xml`.
- **Totais**: os itens são alimentados de forma que o `derivar` do agregado REPRODUZA os totais do XML (Σ(qCom×vUnCom)=vProd, Σ vricmst=vST, …); o serviço **reconcilia** `totalnf` vs `vNF` do XML (epsilon 0,02) e devolve `divergencia` (aviso, não bloqueia — o vNF é a verdade legal).
- **Vínculo opcional ao pedido**: `codpedcomp` no body → guardas do corte-1 (fechado/não-recebido) + **fornecedor do XML == fornecedor do pedido** (`NFE_FORNECEDOR_DIVERGE_PEDIDO`) + CAS-first `dtfaturamento` + `ux_nf_codpedcomp`. Sem `codpedcomp` → NF **standalone** (dedup natural pela chave/número → `NF_DUPLICADA` no reimport).
- **Draft-only** (PROC='N'): o FATO (estoque/A Pagar) é o F3/F4 na NF — fiel (import não move estoque; `ESTOQUE_NOTAS` é AFTER UPDATE, no flip PROC).
- **Endpoint** `POST compras/recebimento/importar-xml` (`ImportacaoNfeController`, RBAC `BTNIMPORTARXML`, migration 062). **Front**: `ImportarXmlModal` (cola/upload do XML) + botão "Importar XML da NFe" na `AcoesEstadoBar`.
- **Smoke §50** (11 checks): import válido→NF valorada (mod 55, terceiros, totalnf=vNF, divergência=false) · ICMS/ST reais + CFOP ajustado 1102/1403 + codprodnota · XML em nfe_xml · não-casado→422 · CNPJ desconhecido→422 · chave DV inválida→422 + XML lixo→422 · reimport→NF_DUPLICADA · vínculo ao pedido→NF vinculada+recebido · fornecedor≠pedido→422 (pedido intacto) · RBAC 403 · **processar(F3) a NF importada move estoque +10/+4**.

### Divergências CONSCIENTES / honestidade
- **Ingere XML fornecido, não baixa da SEFAZ** — o fluxo legado tem 2 estágios (manifesto `NFE_NAO_CADASTRADAS`/`NFE_XML` via ACBr/SEFAZ → NF). Corte-2 faz só o 2º estágio (o `btnImportarNFe` da tela da NF, que também aceita arquivo). SEFAZ/manifestação = adiado.
- **`vrvenda=custo` (vUnCom)** — o legado grava `MULTI_PRECO` (preço de VENDA/varejo) em VRVENDA; aqui gravamos o custo p/ o `derivar` reproduzir `vProd` (mesma escolha do corte-1). O repricing (MULTI_PRECO) na entrada é adiado.
- **Matching só por EAN** (codbarra/codauxiliar) no corte-2 — a de-para de fornecedor `CODREFERENCIA_FOR` (cProd/cEAN→idproduto por CODFOR) foi ENTREGUE no **corte-3 (§7)**; corte-2 guardava `codprodnota=cProd` p/ ela.
- **Link ao pedido por escolha do operador (opcional)** — o legado liga via a **Análise Pedido×NF** (`ANALISE_PEDIDO_NF`, por chave, pré-finalizada; só 17% dos imports têm CODPEDCOMP). O workflow de análise é adiado; aqui o operador informa o `codpedcomp` (com a guarda de fornecedor).
- **CST_NOTA/CFOP_ORIGINAL** — o legado guarda o CST/CFOP crus do XML em colunas `*_NOTA`/`*_ORIGINAL` além dos mapeados; o modelo migrado guarda o valor mapeado (cst/cfop) — o cru fica no `nfe_xml` (adiado separar em colunas).

## 7. Recebimento (corte-3) — DE-PARA de fornecedor (CODREFERENCIA_FOR) — ENTREGUE e verde, 2026-07-08

Recon 2 agentes (Oracle + **fonte Delphi no disco**: match `GetProduto(codigo, CODPARCEIRO)` em `uNF.pas` ~12280-12336; inserts na resolução `uNF.pas` ~12399-12631 / `uProdNC.pas`; SQL da de-para `udmParceiros.dfm:2719`). A de-para casa o código/EAN do fornecedor ao nosso produto por `CODFOR` — é o que torna o import de XML usável de verdade (o que o EAN não resolve, a de-para resolve; o resto vira pendência que o operador vincula e reimporta).

- **Migration 063**: `codreferencia_for` (id PK, `idproduto` FK produtos, `codfor` FK parceiros, `codref` varchar(60), `tiporef` 'E'/'P', `fator_embalagem`) + **UNIQUE `(codfor, codref)`** (chave de upsert; a tabela nasce vazia — o cutover das 16.229 linhas legadas, com 76 colisões, é adiado com de-dup) + RBAC `BTNVINCULARPRODUTO`. **Global** (sem idempresa — como o legado; o escopo de empresa vem por `codfor`, que é um parceiro de uma empresa).
- **Wiring no `importarXml`** (`recebimento.service.ts`): após o match por EAN, os ainda-não-casados passam por 1 query em lote `codreferencia_for WHERE codfor=<fornecedor> AND codref IN (cProds∪cEANs normalizados)`. Precedência fiel ao `GetProduto`: EAN/codbarra → de-para (cEAN, depois cProd), escopado ao fornecedor; **TIPOREF é descritivo (não filtra)**. O que a de-para não resolver BLOQUEIA (pendências).
- **Envelope corrigido (gap do corte-2)**: `ErroResposta` ganhou `detalhe?` e o `all-exceptions.filter` passa o `details` do AppError adiante — antes as pendências (`detalhe.itens` + `detalhe.codparceiro`) do `NFE_PRODUTOS_NAO_CASADOS` eram DESCARTADAS e não chegavam ao front.
- **Resolução `vincularProdutos`** (`POST compras/recebimento/vincular-produto`, RBAC BTNVINCULARPRODUTO): por vínculo grava **DOIS** registros — 'E' (cEAN) e 'P' (cProd) — espelhando o legado; upsert por `(codfor, codref)` (idempotente); guarda fornecedor FRN='S' + produto existe. Depois o operador reimporta e casa sozinho.
- **Front**: `ImportarXmlModal` agora é 2-passos — cola/sobe o XML → importa; se houver pendência, mostra a lista + um seletor de produto por item (lookup `cadastro/produtos`) → "Vincular e reimportar" (grava a de-para + reimporta).
- **Smoke §51** (5): import com item não-casado → 422 + `detalhe.itens`/`detalhe.codparceiro` · vincular (E+P) → reimporta casa · upsert idempotente (1 linha) · RBAC 403 · fornecedor não-FRN/produto inexistente → 422.

### Divergências CONSCIENTES
- **`FATOR_EMBALAGEM` migrado mas NÃO cabeado** — 98,3% nulo no legado e o import lê o pack de `CODAUXILIAR` (não daqui). Migrado por fidelidade; não entra no custo/estoque no corte-3.
- **UNIQUE `(codfor, codref)` — mais ESTRITO que o legado, de propósito.** O guard do legado é a TRIPLA `(IDPRODUTO, CODREF, CODFOR)` (UCadProduto.pas:5357) → PERMITE o mesmo `(codfor, codref)` mapear produtos diferentes (77 casos reais). Nossa UNIQUE `(codfor, codref)` força uma de-para determinística (1 código de fornecedor → 1 produto — mata a ambiguidade que a de-para existe p/ resolver); re-vincular corrige o mapa (upsert). Cutover das 16.229 linhas exige de-dup das 77 colisões multi-produto (decisão do operador) — adiado.
- **Normalização de CODREF/EAN** = trim + tira pontos + **strip do zero-à-esquerda de GTIN-14 → GTIN-13** (fiel a uNF.pas:12308; `digEan`/`normRef`, consistente entre casar e gravar). O cap de 20 do cProd do legado é simplificado (coluna varchar(60); 0 linhas legadas >20) — reavaliar no cutover.

## 8. Recebimento (corte-4/4b) — DUPLICATAS do XML → A Pagar + forma (`<pag>`) + gate CFOP — ENTREGUE e verde, 2026-07-08

Recon 2 agentes (Oracle + fonte Delphi). Fecha o ciclo financeiro do recebimento: as parcelas REAIS do fornecedor (do XML) viram títulos A Pagar. **Fluxo legado (2 estágios):** o import (`NFe.pas:3457`) só faz STAGING das duplicatas em `cdsFaturamento`; a geração REAL do APAGAR é `GeraApagar` (`uAPagar.pas:4843`), disparada no PROCESSAMENTO (F3) e GATED por CFOP (`GERA_FINANCEIRO_AUTO`) + finalidade. Mapa por `<dup>`: 1 título (VALOR=vDup, DTVENC=dVenc, DTCOMPRA=DTEMISSAO, TIPODOC='BOLETO'), Σ vDup = vNF; sem `<cobr>` (à vista) → nenhum título.

- **Parser** (`nfe-xml.parser.ts`): + `duplicatas: [{nDup, dVenc, vDup}]` (isArray `dup`). `<cobr>` opcional → `[]`.
- **`NfFaturamentoService.faturarComParcelas(codnf, duplicatas)`** (reuso do F4): 1 título por `<dup>` VERBATIM (sem rateio), reusando as MESMAS travas + txjuros + flip `faturada` do F4. Refatorei o F4 extraindo `carregarNfFaturavel`/`inserirTituloFat`/`marcarFaturada` (fonte única do shape de coluna — sem drift). `duplicata` = o `nDup` REAL do fornecedor (fallback formato F4 `<nronf> - i/N`).
- **Auto-on-import** (`recebimento.service.importarXml`): após criar a NF + salvar o XML cru, se há duplicatas E os DOIS gates fiéis passam, gera o A Pagar. **Gate de finalidade** (`udmNF.pas:9107`): devolução/ajuste/complementar (2/3/4) NÃO faturam. **Gate por CFOP (corte-4b)**: `cfop.gera_financeiro_auto='S'` do CFOP do cabeçalho (`CFOPGeraFinanceiroAutomatico`, `udmNF.pas:9902`) — no golden SÓ o **1102** está ligado (migration 064 semeia 1102='S', default 'N'; os demais faturam manualmente pelo F4). Transação SEPARADA do `createAggregate`; o CAS de `nf.faturada` evita duplicar. Wiring: `ComprasModule imports CadastroModule` (export de `NfFaturamentoService`; acíclico, singleton).
- **`<pag>` → NF_FORMA_PAGAMENTO (corte-4b)**: o parser lê `<pag><detPag>` (`formasPagamento`); `importarXml` grava (best-effort) 1 linha por forma em `nf_forma_pagamento` — `tPag` → DESTINO (single-code, escopado à empresa, **fallback CXA**) → IDPGTO de `formas_pgto` (migration 064). **Informativo** (COMO foi pago); NÃO afeta o título A Pagar (esse é TIPODOC='BOLETO' do `<dup>`).
- **Estorno = o mesmo `estornarFaturamento`** (delete por idnf, bloqueado se quitada) — os títulos do XML são idênticos em forma aos do F4.
- **Front**: a mensagem de sucesso do import informa "N título(s) A Pagar gerado(s)". Sem tela nova.
- **Smoke §52** (4): `<cobr>`→2 A Pagar (TIPODOC BOLETO, idnf, faturada=S) · à vista→0 · estornar-faturamento por idnf · devolução(finNFe=4)→0. **§53** (2, corte-4b): `<pag>`→NF_FORMA_PAGAMENTO (tPag 01→CXA→idpgto) · CFOP 1910 (não-`S`) c/ `<cobr>`→0 A Pagar (gate CFOP). (+ regressão F4 saída intacta.)

### Divergências CONSCIENTES
- **Gera no IMPORT, não no F3** — o legado gera o A Pagar no processamento (F3); aqui geramos no import (o XML já traz as parcelas exatas — nada a decidir). Os DOIS gates do legado estão replicados: **finalidade** (2/3/4 não faturam) e **CFOP `gera_financeiro_auto='S'`** (corte-4b; só 1102 no golden). Gate por `gera_financeiro_auto` isolado (não `AND proc_financeiro`) — no golden nenhum CFOP tem gera='S' com proc='N', então é equivalente. O gate lê o CFOP do CABEÇALHO (= 1º item, como `nf.cfop`) — fiel ao legado, que também chaveia pelo CFOP único da nota; numa NF multi-item cujo 1º item não é 1102, a NF inteira não auto-fatura (limitação conhecida).
- **`<pag>`/forma = single-code + fallback CXA** — o legado passa listas ('TEF, CRT'/'CHQ, CHP'/'DEV, QUE') que nunca casam a coluna DESTINO CHAR(3) → caíam em CXA; replicamos single-code (dinheiro/crédito-loja/PIX resolvem; cartão/cheque→fallback quando o DESTINO não existe na empresa). Informativo — não afeta o título.
- **`DUPLICATA` = `nDup` (nº real do fornecedor), truncado a 20** — o legado grava `APAGAR.DUPLICATA=NRONF` (o nDup só na staging). Guardamos o nDup direto (mais útil p/ conciliar com o boleto); fallback ao formato F4 se vazio. `apagar.duplicata` é varchar(20) → truncamos (NFe permite nDup até 60) p/ não abortar imports legítimos.
- **Sem staging FATURAMENTO** — o legado usa a tabela FATURAMENTO como staging (artefato das 2 telas Delphi); escrevemos `apagar` direto (o F4 já faz isso, com idnf + faturada CAS).
- **Duas transações** (createAggregate + faturarComParcelas) — mesma não-atomicidade do legado; o CAS de faturada garante que nunca duplica. **Lacuna de recovery honesta:** se o faturar falhar após a NF commitar, a NF fica não-faturada + XML salvo; o re-import bate em `NF_DUPLICADA` e o F4 manual usa rateio computado (não os vDup reais) → recuperação FIEL das parcelas exige um "refaturar do XML" (adiado). Janela estreita (falha transitória entre 2 commits).
- **Σ vDup verbatim** (sem reconciliar com vNF) — as parcelas do fornecedor são a verdade do A Pagar. O ST-residual (TIPODOC='RESIDUAL ST') é um título SEPARADO, agora entregue no corte-4c (§9); a retenção FEDERAL (E03) segue adiada.
- **TIPODOC='BOLETO'** (fiel ao GeraApagar); `NRPARCELA` (o legado grava "i/total") não tem coluna no modelo migrado — a parcela vai no `duplicata`/`nrodup` (herdado do F4).

## 9. Recebimento (corte-4c) — ST RESIDUAL (ICMS-ST a recolher) → título A Pagar 'RESIDUAL ST' — ENTREGUE e verde, 2026-07-09
Cenário real (golden PINHEIRAO, **177 títulos**): compra interestadual (CFOP 2102/2403) de produto sujeito a ICMS-ST em que o **fornecedor não reteve o ST na origem** — a LOJA recolhe o ST antecipado, que vira 1 título A Pagar por NF.
- **Fórmula** (verificada 1:1 no golden; `uNF.pas:4817-4821`): `ICMS_ST_APAGAR = TOTALICM_STEXTERNO − ICMS_ST_PAGO_FONTE`, **só quando `TOTALICM_STEXTERNO>0`** (senão 0). `ICMS_ST_PAGO_FONTE=0` em 100% da amostra (fornecedor não reteve). Derivada no `nf.aggregate.derivar` e persistida no cabeçalho da NF (migration 065: `nf.total_icmst_externo`/`icms_st_pago_fonte`/`icms_st_apagar`).
- **Título golden-exato** (`nf-faturamento.gerarTituloStResidual`, gerado na trx do faturamento — `faturar` e `faturarComParcelas`): TIPODOC='RESIDUAL ST', **RETENCAO='ICMSST'**, ORIGEM='N', GERADO='SISTEMA', `nrodup=1`, `txjuros=0`, `valor=icms_st_apagar`, IDNF=codnf, mesmo CODPARCEIRO. **À vista = DTCONTABIL** (golden: DTVENC=DTCOMPRA=DTCONTABIL em 173/177=98%; o legado passa `cdsNotaDTCONTABIL`, `udmNF.pas:8509` — NÃO a emissão, que difere da contábil em ~82% das entradas). **DUPLICATA=NRONF** (fiel ao `GeraApagar iif(pNroNf<>'',pNroNf,...)`). **OBS byte-a-byte** do legado (`udmNF.pas:8514-8516`), com **VÍRGULA decimal** (`FormatFloat('0.00')` pt-BR): `REF. À RETENÇÕES DE IMPOSTOS. IMPOSTO: ICMSST\nNOTA FISCAL NRO: <nronf>\nVALOR NOTA FISCAL: <total,dd>\nALIQUOTA ICMSST: 0,00%`. Migration 065 adiciona `apagar.retencao` varchar(10).
- **Estorno**: `estornar-faturamento` deleta por idnf → remove o RESIDUAL ST junto. A trava "título quitado bloqueia estorno" (`VerificaExisteBaixas`, varre TODOS por idnf) agora também apanha o RESIDUAL ST — **é FIEL**: um ST já recolhido (quitada='S') bloqueia o estorno da NF (o golden tem 1 residual quitado, confirmando que pode ser pago).
- **Smoke §9/§54** (9): derivar calcula o residual · faturar gera o RESIDUAL ST (shape) · à vista=DTCONTABIL (não emissão) + duplicata=NRONF · OBS byte-a-byte (vírgula) · pago_fonte abate · sem externo→0 · estorno remove · SAÍDA→0 · PUT parcial preserva o derivado.

### Divergências CONSCIENTES / honestidade (auditoria 2 agentes: paridade golden/Delphi + regressão/segurança)
- **AUTO-DERIVAÇÃO do `TOTALICM_STEXTERNO` por item NÃO está neste corte** — o roteamento "ST externo" vive em parte no `FuncoesApollo` (submódulo fechado) e as condições visíveis do .pas (`ST_EXTERNO='S'`+CFOP 1403/2403) NÃO batem com os CFOPs reais do golden (2102/2403, `ST_EXTERNO='N'`). Entregamos o **MECANISMO** (fórmula + shape + persistência) com `total_icmst_externo`/`icms_st_pago_fonte` como campos de CABEÇALHO (a F2/operador informa); a auto-derivação por item é um corte de motor fiscal.
- **Gate lógico `externo>0` NÃO é o gate golden** — das ~958 entradas com `ICMS_ST_APAGAR>0` só **177** geraram título (o gate fino, por situação/CFOP/regime, é do motor fiscal fechado). Hoje é inócuo (o campo só é populado quando informado, default 0); quando um motor por item começar a populá-lo, o gate precisa ser estreitado (senão super-gera ~3,3×). Documentado na migration 065.
- **`max(0, …)` é DEFENSIVO** — o legado subtrai cru (sem clamp), mas o golden não tem NENHUM caso negativo (observacionalmente idêntico) e a coluna/schema é nonnegative.
- **Import de XML não gera** — o import pega os fiscais do XML verbatim e não computa ST externo → `icms_st_apagar=0` → sem título. Fiel ao `NF_IMPORTACAO_NFE='S'` do legado, que desliga o caminho de ST externo no import.

## 10. Recebimento (corte-4c-b) — RETENÇÃO FEDERAL (PIS/COFINS/CSLL/IR/INSS/ISSQN/FUNRURAL) → títulos A Pagar — ENTREGUE e verde, 2026-07-09
O motor `calcularRetencoes` (nf-fiscal, corte A1) já computa `nf.total_ret_*` (só ENTRADA de serviço E03; FUNRURAL por CFOP). Este corte **gera os títulos separados** no faturamento (`GerarAPagarDeRetencoes`, udmNF.pas:8473) e **abate** o título do fornecedor.
- **1 título por imposto** (`nf-faturamento.gerarTitulosRetencao`, na trx do `faturar`) quando `total_ret_*>0` **E** órgão configurado **E** dia de vencimento>0 **E** (E03 para os federais / CFOP embutido no snapshot para FUNRURAL). TIPODOC='BOLETO', RETENCAO ∈ {PIS,COFINS,CSLL,**IR**,INSS,ISSQN,FUNRURAL} (IR, não IRRF), GERADO='SISTEMA', ORIGEM='N', DTVENDA=DTCONTABIL.
- **CODPARCEIRO = ÓRGÃO** (Receita/INSS/prefeitura), **NÃO o fornecedor** — config `PARCEIRO_RETENCAO_PISCOFINS_CSLL`/`_INSS`/`_IR`/`_FUNRURAL` (migration 066); ISSQN = `parceiros.codparceiro_ent_issqn` do fornecedor (019). Sem órgão → não gera.
- **Vencimento** (`montarDataVencimento`, udmNF.pas:8550): `DIA_VENCIMENTO_RET_*>0` → **dia fixo do MÊS SEGUINTE** (dez→jan/ano+1); =0 → contábil+30 (mas 0 também desliga a geração). 7 chaves de config (066).
- **ABATE** o fornecedor → líquido = totalnf − Σretenções. `total_ret_*` persistidos via allowlist do agregado (065/066).
- **OBS byte-a-byte** (compartilha `obsRetencao` com o RESIDUAL ST): `REF. À RETENÇÕES DE IMPOSTOS. IMPOSTO: <imp>\nNOTA FISCAL NRO: <nro>\nVALOR NOTA FISCAL: <total,dd>\nALIQUOTA <imp>: <aliq,dd>%` (vírgula decimal; alíquota real — IR/ISSQN do parceiro, demais de `ALIQUOTA_RETENCAO_*`).
- **Estorno**: `estornar-faturamento` deleta por idnf → remove retenção (órgão) + fornecedor + RESIDUAL ST juntos; trava "quitada bloqueia" varre por idnf.
- **Smoke §55** (8): gera títulos ao órgão (PIS+INSS, codparceiro≠fornecedor) · abate (140−120=20) · vencimento dia-fixo-mês-seguinte · OBS byte-a-byte c/ alíquota real · gate por-imposto (COFINS sem dia→0) · estorno · SAÍDA→0 · **gate E03 no faturamento** (PIS órfão em NF não-E03→0).

### Divergências CONSCIENTES / honestidade (auditoria 2 agentes)
- **GOLDEN ~inexistente** — retenção federal é INÉDITA na base (`APAGAR.RETENCAO` só ICMSST[205]+SENAR[1]; 0 dos 7 federais; 1 única NF com `total_ret_*` [zerado]). O 1 título **SENAR** (órgão 87199≠fornecedor 1925; abate 2,58+126,42=129=totalnf; venc; OBS c/ vírgula; alíq 2,00%) valida o **SHAPE** do mecanismo. Config default **OFF** (fiel — a base tem off). Validado por dados sintéticos + o shape SENAR.
- **ABATE = Σ(títulos GERADOS), não Σ(computados)** [fold ALTA-2] — o legado abate `TOTAL_RETENCOES` = Σ dos 7 `total_ret_*` computados (uFinanceiroNotaFiscal.pas:552). Nós abatemos a soma dos títulos efetivamente **gerados** → livro balanceado (Σ órgão+fornecedor = totalnf). Idênticos no caso normal (todo imposto computado é configurado p/ gerar); diferem só quando um imposto é computado mas não gerado (órgão/dia off), onde o **legado desbalanceia** (abate sem gerar → o valor "some"). Escolha consciente por balanceamento.
- **Gate E03 re-checado no faturamento** [fold ALTA-1] — `SituacaoGeraRetencao` (tipo_operacao='E03') é re-verificado por `idsituacao_nf` no `gerarTitulosRetencao`, porque `total_ret_*` é um SNAPSHOT do F2; se a situação mudou de E03 depois, o legado não geraria. FUNRURAL é exceção (gate por CFOP, procedure separada `GerarAPagarDeFunRural`).
- **Alíquota da OBS re-lida do config** [MÉDIA, doc] — o legado imprime o snapshot `PERC_ALIQUOTA_RET_*`; nós re-resolvemos `ALIQUOTA_RETENCAO_*` (ou parceiro p/ IR/ISSQN) no faturamento. Coincide no caso normal (config estável entre F2 e F4); divergiria só sob alteração de alíquota no meio. Persistir os `perc_aliquota_ret_*` (snapshot) fica adiado (cosmético, sem golden).
- **`montarDataVencimento` com dia>28 em mês curto** [BAIXA] — JS `Date.UTC` ROLA (fev+31→mar); o Delphi `EncodeDate` LANÇARIA. Dias de vencimento fiscais são ≤25 na prática. Divergência de edge documentada, não bloqueia.
- **Injeção de `total_ret_*`** [MÉDIA, doc] — estão no allowlist e são client-enviáveis (mesmo modelo de confiança de `totalnf`/`totalicm_st`, pós-recalcular). Mitigado: 4 gates AND (tipo E + E03 + valor>0 + órgão + dia) e **config OFF por default** → sem config, nada gera.
- **Só no `faturar`, não no `faturarComParcelas`** [BAIXA] — o path de import de XML (duplicatas) não gera/abate retenção; inócuo hoje (import nunca seta `total_ret_*`/E03). Vira gap real só se um dia importar NFe de serviço E03 via XML.
- **`idsituacao_nf` do título NULL** [BAIXA] — o legado grava a situação financeira; adiado junto do contábil da retenção (CX_APAGAR/DIARIO).

## 11. PEDIDO corte-2 — CONDIÇÃO DE PAGAMENTO + PARCELAS (back + front) — ENTREGUE e verde, 2026-07-09
Recon Oracle (37 condições, 9.010 parcelas — feature real, 72,6% dos pedidos) + fonte Delphi (`RatearTotalNasParcelas`, uPedidoCompra.pas:8892) + monorepo. Escopo escolhido pelo usuário: **completo (back + front)**.
- **`condicoes_pagto`** (cadastral GLOBAL, migration 067): `CODCONPAGTO`(PK seq) + `DESCRICAO` + `CD1..CD8` (prazos em DIAS). CRUD `compras/condicoes-pagto` (empresaScoped:false, hard-delete; CD1 obrigatório no create). `setval` após o seed (ids explícitos 1/41/42/161) p/ o 1º create não colidir na PK. Front `CondicoesPagtoCadMaster` + rota/menu.
- **`pedidocompra_parcelas`** (2º detalhe do agregado): `CODPEDCOMPPARCELAS`(PK), `CODPEDCOMP`(FK), `IDEMPRESA`, `PARCELA`, `DATA`, `VALOR`, `QTDEDIASAPOSFATURAMENTO`. Editável (substituído no PUT só quando a chave `parcelas` vem no dto). `idempresa` carimbada server-side (derivarItensTrx).
- **`pedidocompra.cd1..cd8`** (override local dos prazos) + **`pedidocompra.data_faturamento`** (a data-base do vencimento — o input DTFATURAMENTO do legado, SEPARADO do marcador "recebido" que o recebimento pôs em `dtfaturamento`).
- **Geração** (`gerarParcelas`, `POST compras/pedidos/:id/gerar-parcelas`, gated `BTNGRAVAR`): prazos = CD1..CD8 do PEDIDO, senão da CONDIÇÃO (codconpagto). Para cada CDn não-nulo: 1 parcela; `VALOR = round(TOTAL/nParc)` com a **SOBRA na PRIMEIRA** (RatearTotalNasParcelas:8941, resíduo com sinal — verificado no golden inclusive negativo); `DATA = data_faturamento (fallback data) + CDn dias`; `QTDEDIASAPOSFATURAMENTO = CDn`. Total = Σ VLREMBALAGEM. Delete+insert atômico; bloqueado em fechado/faturado. Front: lookup de condição (mostra os prazos) + grid de parcelas + botão «Gerar parcelas».
- **Smoke §48P** (8): CRUD condições (seed/criar/CD1-obrigatório) · gerar pela condição (30/60/90, sobra na 1ª, Σ=100) · venc+qtdedias · override CD do pedido · sem-condição→422 · parcelas editáveis (PUT) · fechado→422 · **DATA_FATURAMENTO como base** (≠ data do pedido).

### Divergências CONSCIENTES / honestidade (auditoria 2 agentes)
- **Base do vencimento = DATA_FATURAMENTO** [fold ALTA] — o golden prova `DTFATURAMENTO+QTDIAS` casa 99,2% vs `DATA` 92,1%. Como o recebimento repropôs `dtfaturamento` como marcador "recebido", introduzi a coluna `data_faturamento` (input, separada) e baseio nela (fallback `data`). Resolve a colisão semântica sem tocar o marcador do recebimento.
- **Total = Σ VLREMBALAGEM (redução single-empresa)** — o legado usa TOTALCUSTO = Σ(QTDE×VLREMBALAGEM) por loja (PEDIDO_COMPRA_QTDE, o split multi-loja = cross-docking ADIADO); no modelo reduzido do corte-1 (qtd=FATOREMBALAGEM) Σ vlrembalagem é a base consistente.
- **`gerar-parcelas` gated por `BTNGRAVAR`** [fold] — o legado não tem opção "gerar parcelas" (o rateio é efeito de editar CD/condição); reuso a opção real BTNGRAVAR (é uma edição), não invento uma nova.
- **Precedência CD-pedido→condição** — no legado, selecionar a condição COPIA seus CDs para os do pedido (o rateio sempre lê os do pedido); aqui lemos CD-pedido senão condição (converge no caso comum; o front usa a condição — o override por-pedido é nível API).
- **CD1 obrigatório no create da condição** — aperto consciente (o golden não tem condição com CD1-nulo-mas-outros-setados); impede condição inútil.
- **Fuso** [BAIXA, dívida transversal pré-existente] — `new Date(base)+setUTCDate+toISOString` pode escorregar 1 dia sob sessão PG não-UTC; MESMO padrão do `nf-faturamento` (não é regressão deste corte); tratar numa passada de fuso dedicada.

## 12. PEDIDO — PRECIFICAÇÃO do item (o comprador forma o preço) — ENTREGUE e verde, 2026-07-10
Aplica o **motor completo** (custo líquido + markup→venda + margem líquida + PMZ, já portado em `precificacao`) ao ITEM do pedido — o legado abre `TfrmPrecificacaoProduto` (F11) com `cdsPedidoCompra_I` (uPedidoCompra.pas:5498), a MESMA unit do motor.
- **Migration 068** — `pedidocompra_i` ganha `vrcustoliquido`, `markup`, `vrvenda`, `vrvendasug`, `margeml2`, `margeml2v`, `pmz` (escalas fiéis ao dicionário: 13,2; vrvenda 12,4). 2º detalhe do agregado (allowlist).
- **Front** (`PedidoCompraItemModal`): markup + UF + botão «Calcular venda» → reusa `POST /precificacao/produto` (custo=vrcusto, aliquota do produto via mapa `produtoAliquotas`) → preenche a analítica. Exibe custo líq/venda sugerida/PMZ. O item ARMAZENA o resultado (analítica; sem golden reproduzível — os valores gravados no legado são snapshot manual, batem 0,4%).
- **`VRVENDA` (praticado) ≠ `VRVENDASUG` (sugerido)** — no golden batem só **1,1%**: a sugestão vem do motor; a venda praticada é do comprador (default = sugestão só se vazia, preserva o manual). `VLREMBALAGEM` (custo estendido) segue derivado (fator×custo), independente da venda.

### Divergências CONSCIENTES / honestidade (auditoria 2 agentes)
- **PROPAGAÇÃO ao MULTI_PRECO ADIADA** — o legado faz `UPDATE MULTI_PRECO SET VRVENDA` (uPedidoCompra.pas:3517) com promoção acumulativa + produtos-filho + multi-loja: é EFEITO DE ESCRITA no catálogo. Mantido FORA (o pedido segue "sem efeitos"); o FATO de catálogo é um corte próprio. **0 writes a MULTI_PRECO** confirmado pelos auditores.
- **Folds da auditoria:** [ALTA] separar `vrvenda`/`vrvendasug` (eram conflados; golden 1,1% de igualdade); [ALTA] `margeml`→`margeml2`(+`margeml2v`) — nome fiel ao dicionário (não existe `MARGEML` em PEDIDOCOMPRA_I); [MÉDIA] escalas alinhadas ao dicionário (13,2 / 12,4).
- **UF='SP' default** no cálculo (a UF virá da EMPRESA — mesmo limite documentado da tela de Produto). **PIS/COFINS=0** no front (derivação do PISCOFINS de saída adiada). **Cadeia de lucro** (VENDALIQ/LUCROV) o motor devolve mas só `margeml2v` é persistido (o resto é analítica adiável).
- Smoke §48Q (round-trip: markup/vrvenda≠vrvendasug/margeml2+v/custo-líq/PMZ; vlrembalagem intacto).

## 13. PEDIDO — CORTE FINAL: a tela FINALIZADA (todas as regras vivas) — ENTREGUE e verde, 2026-07-13
Recon exaustiva (`uPedidoCompra.pas` ~8.973 linhas + `udmPedidoCompra.pas` + DFM + uso real Oracle) → matriz MIGRAR/ADIAR/MORTO → build back+front → **code review em 3 lentes** (`/code-review` skill + 2 auditores adversariais: paridade contra o Delphi + regressão). Migration **069**. As 5 regras VIVAS que faltavam:

- **(A) PROPAGAÇÃO DE PREÇO AO CATÁLOGO** — "o pedido forma o preço", regra de ALTO volume (golden: 95,5% dos preços 2024+ em `MULTI_PRECO` batem com o `VRVENDA` do item do pedido). `POST :id/atualizar-precos` (`BTNGRAVAR`): para cada item `VRVENDA>0` que difere do catálogo → `UPDATE MULTI_PRECO SET VRVENDA` (só VRVENDA, fiel :3517) + `dtultprecoalterado` + histórico byte-a-byte `'Atualização on-line de preço, pedido de compra Nro: X'`. GATE promoção (`multi_preco.promocao='S'` pula). `ATUALIZA_PRECO_OUTRAS_EMPRESAS='S'` propaga a todas as empresas do tenant.
- **(B) LIMITE DIÁRIO/SEMANAL DE COMPRA + LIBERAÇÃO** — ativo no tenant (`VALOR_MAXIMO_SEMANAL_PC`=270.000 via override; 233 liberações reais 2021-24). Gate no **FECHAR** (divergência consciente: o legado valida no gravar). Fluxo = Σ parcelas de OUTROS pedidos ABERTOS na janela **+ o fluxo DESTE pedido, materializado OU projetado das CDs** (ver fold A1). Janela semanal **dom-sáb** (bate `DayOfWeek`/`MontaFluxoPorEmpresa`:6193). Liberação: grant **`LIBERAVALORMAX`** (substitui a lista+senha de supervisor do legado — auth adiado) → grava `OPERADOR_ULT_LIB_VALOR_MAX` (:3752), **rearmada na reabertura** (fold M1).
- **(C) BONIFICAÇÃO + DUPLICAR** — `POST :id/duplicar` (rascunho: datas=hoje, clona condição/CDs/frete/situação + itens com precificação, sem parcelas, vencimento vencido→delta / não-vencido→hoje) e `POST :id/gerar-bonificado` (ESPELHO MÍNIMO: data=origem, só codparceiro/obs/`BONIFICACAO='S'` + itens `BONIFICACAO=100`, sem termos de pagamento — fold M6). Uso residual (7 em 6 anos).
- **(D) GATES DO GRAVAR** (agregado `validar`, ordem fiel :6831→6844→6870): `OBRIGA_INFORMAR_CONDICOES_PAGAMENTO='S'`→exige condição/CD (`PEDIDO_SEM_CONDICAO_OBRIGATORIA`); prazo máx do fornecedor (`PARCEIROS.QTDE_DIAS_MAXIMO_FP_PC`, `VerificaFP`:6792)→`PEDIDO_PRAZO_EXCEDE_FORNECEDOR`; pendências A Receber do fornecedor (`AVISA_PENDENCIAS_FORNECEDOR='B'` bloqueia; só ao DEFINIR/TROCAR o fornecedor — fold M3)→`PEDIDO_FORNECEDOR_PENDENCIAS`. **SITUAÇÃO-NF** no header (`idsituacao_nf`; o `gerar-nf` a carrega à NF de entrada — `recebimento.service.ts`).
- **(E) IMPORTAR ITENS EM MASSA** — `POST :id/importar-itens` (`ImportaItens`:8242): produtos ASSOCIADOS (`PRODUTOS.CODFOR`) ou já COMPRADOS (histórico) do fornecedor; `ATIVO/ATIVO_COMPRA` lidos de **PRODUTOS** (fold M4); custo = `MULTI_PRECO.VRCUSTO` (ou `VRCUSTOREP` se `CUSTO_REP_PC='S'`); produto SEM preço na empresa NÃO é candidato (INNER JOIN do legado — evita item custo-0); fator = de-para `CODREFERENCIA_FOR` (se `USAR_FATOR_EMBALAGEM_REFERENCIA_FORNECEDOR='S'`) senão `FATORCX`; exclui filhos e já-no-pedido; cap 990.

**Migration 069**: 7 configs (321-327), `pedidocompra.operador_ult_lib_valor_max/bonificacao/idsituacao_nf`, `pedidocompra_i.bonificacao`, `parceiros.qtde_dias_maximo_fp_pc`, view `get_pedidocompra` (DROP+CREATE — colunas novas no meio da lista), RBAC `LIBERAVALORMAX`. **6 rotas** novas no controller (5×`BTNGRAVAR` + 1×`LIBERAVALORMAX`). **Smoke §57** (11 checks): propagação (9,99 + histórico) · idempotência+gate-promoção · **limite semanal + liberação + rearme M1** · **A1 projeção sem parcelas** · duplicar · bonificado · importar · 3 gates do gravar · situação-NF · ValidaDatas.

### Code review — folds aplicados (3 lentes convergentes)
- **[A1, ALTA — paridade+skill]** o limite era burlável: pedido com CDs mas SEM parcelas geradas retornava cedo (`if !minhas.length return`). O legado roda `RatearTotalNasParcelas(False)` **no gravar** (:6866), então o fluxo sempre existe na validação. Fold: `fluxoDoPedido` usa parcelas materializadas OU **projeta** pelas CDs (pedido→condição)+total+data-base com o mesmo rateio; `validarLimites` passou a "excluir o corrente do banco + somar o fluxo em memória" (fiel ao legado). Provado no smoke (§57.3b: sem parcelas → 422).
- **[M1, MÉDIA — paridade+regressão]** liberação de limite virava PERMANENTE (o `fechar` pula se `operador_ult_lib_valor_max != null` e nada limpava). Exploração: liberar→reabrir→inflar→fechar sem re-checagem. Fold: `reabrir` limpa a flag (`LiberouLimiteDiario` do legado é transiente, :699/5891). Provado no smoke (reabrir→flag NULL→fechar→422).
- **[M2, MÉDIA — paridade]** chave de config `OBRIGA_INFORMAR_CONDICOES_PAGAMENTO` (singular, fiel ao legado :6831) — corrigido o typo `..._PAGAMENTOS` (quebrava o cutover do valor do Oracle).
- **[M3, MÉDIA — paridade+skill]** o gate de pendências disparava em QUALQUER save (o comentário dizia "só ao trocar" mas a impl não comparava). Fold: só quando `create` OU `cod !== atual.codparceiro`.
- **[M4, MÉDIA — paridade]** `importarItens` filtrava `multi_preco.ativo_compra`; o legado filtra `PRODUTOS.ATIVO_COMPRA` (`GetSQLProdutos`:8313). Fold: lê de PRODUTOS + `ATIVO='S'` exato; produto sem `multi_preco` não é candidato.
- **[M6, MÉDIA — paridade]** bonificado copiava demais (condição/CDs/frete/venc) e usava data=hoje; o espelho do legado (:7017-7040) é MÍNIMO com data=origem. Fold: path separado (só codparceiro/obs/bonificacao=S + itens 100%).
- **[M7, MÉDIA — paridade]** `duplicar` mantinha o vencimento futuro da origem; o legado (`DM`:1758-1761) reseta o não-vencido para hoje. Fold: `else novaVenc = hoje`.

### Divergências CONSCIENTES / adiados (documentados — nada perdido)
- **[M5]** exclusão de `PRODUTOS_FORN_DESASSOCIADOS` no importar — tabela não migrada (parte do épico de-para do recebimento). ADIADO.
- **[M8]** o legado escolhe UM modo de limite via `TIPO_FLUXO_CAIXA_PC` ('D' xor 'S'); aqui roda o que estiver configurado (>0) — se ambos setados, ambos valem (mais restritivo; o tenant real só usa SEMANAL). ADIADO o gate exclusivo.
- **[B1-B8, BAIXA]** promoção só na empresa-alvo (legado checa origem+destino — só afeta multi-empresa); filtro `vrvenda>0` na propagação (mais seguro que o legado, que zeraria); `CarregaOBSForn` (copia OBS do parceiro) não migrado; `VerificaPendencias` só cobre A Receber (sem `cdsTrocas`, sem override por login — auth adiado); `liberarLimite`/duplicar gravam o operador da sessão (RBAC no endpoint = o chamador é o autorizador); `IDSITUACAO_NF` por item (cascade `SetaSituacaoNF`) só no header; ações novas sob `BTNGRAVAR` (o legado também não separa — oportunidade de grant dedicado).
- **MORTOS confirmados** (0 refs no fonte OU 0 uso no golden): `NOVO_LIMITE`, `CODPEDCOMP_BONIFICADO`, `PEDIDOCOMPRA.IMPORTADO` (coberto por `nf.codpedcomp`+UNIQUE), e-mail pós-gravar, `CD6-CD8`.

> **A tela PEDIDO DE COMPRA está FUNCIONALMENTE COMPLETA in-repo.** Todas as regras vivas do `FRMPEDIDOCOMPRA` estão migradas (cadastro+itens → condição/parcelas → precificação → propagação/limite/bonificação/gates/importar) + o épico RECEBIMENTO (pedido→NF→XML→de-para→duplicatas→ST residual→retenção). Resíduos abaixo são de OUTROS épicos (split multi-loja, análise pedido×NF, devolução) ou dependem de cortes futuros (auth, SEFAZ, PDV).

## 14. CUTOVER do de-para (CODREFERENCIA_FOR) — FERRAMENTA + motor de de-dup, verificado contra os 16.229 reais — ENTREGUE e verde, 2026-07-14

O corte-3 (§7) forçou uma UNIQUE **determinística** `(codfor, codref)` — mais estrita que a tripla do legado, que permite o mesmo `(codfor, codref)` apontar produtos diferentes (a AMBIGUIDADE que a de-para existe p/ resolver). Isso deixou um débito: **as 16.229 linhas legadas não entram cruas** (colidem na UNIQUE). Este corte entrega a **ferramenta de cutover + o motor de de-dup**, verificado ponta-a-ponta contra os dados reais do Oracle. **Não** faz a carga viva (não existe banco de tenant real in-repo; a carga é 1 comando `loadCodref` quando o tenant existir + a revisão operacional dos 48 grupos ambíguos).

**Escopo (escolha do usuário):** "Ferramenta + motor de de-dup, verificado". Entregue:
- **`scripts/cutover/dedup-codref.ts`** — o motor PURO (`dedupCodref(rows) → {keep, report}`). Regra derivada dos dados reais: (1) descarta SUJAS (`codfor` nulo/fornecedor inválido, `idproduto` nulo/inexistente, `codref` branco); (2) descarta `SEM GTIN` (sentinela textual, não é código); (3) agrupa por `(codfor, normRef(codref))`; singleton → migra; **colisão** → se exatamente 1 candidato tem `produto_codbarra_norm === chave`, **auto-resolve** (o dono legítimo do EAN), senão **tiebreak** `melhor()` (produto ATIVO vence; entre iguais, maior `codreferencia_for`) + **registra o grupo p/ revisão**. `tiporef` nulo→'E', `fator` nulo/≤0→1.
- **`codref-normalize.ts`** — `normRef`/`digEan` EXTRAÍDOS do `recebimento.service` p/ **single-source** (o cutover normaliza EXATAMENTE como o runtime casa/grava; GTIN-14 zero-à-esquerda → GTIN-13, tira pontos, trim; NÃO tira zero-à-esquerda geral). O runtime passou a importar daqui (0 divergência possível).
- **`scripts/cutover/load-codref.ts`** — loader IDEMPOTENTE (`INSERT ... ON CONFLICT (codfor, codref) DO UPDATE ... RETURNING (xmax=0)`), em lotes, contando inseridos vs atualizados. Aceita um `PgLike` (portável p/ o banco do tenant real; testado contra o Postgres embarcado no smoke §74).
- **`scripts/cutover/report-codref.ts`** + **`scripts/cutover/extract-codref.py`** (READ-ONLY) — o extrator Python roda **SOMENTE SELECT** no Oracle legado (LEFT JOIN `PRODUTOS` codbarra/ativo + `PARCEIROS` FRN; creds por env, defaults PINHEIRAO homolog) → JSON cru; o report aplica `normRef` ao codbarra, roda o motor, imprime o relatório e grava o artefato limpo + a **fila de revisão CSV** (todos os grupos ambíguos). Uso: `python extract-codref.py raw.json && npx tsx report-codref.ts raw.json clean.json`.

**Números REAIS (rodado READ-ONLY contra o Oracle, 2026-07-14):** origem **16.229** → **limpas 16.029** · descartadas: **sujas 21** + **SEM GTIN 106** + **colisão-excedente 73** · colisões: **60 grupos** (12 auto-resolvidas por codbarra, **48 ambíguas p/ revisão**). **Conferência: 16.029 + 21 + 106 + 73 = 16.229 ✓** (balanceado, 0 linha perdida). *(A estimativa velha do §7 — "77 colisões" — era grosseira; o número real com a normalização do runtime é 60 grupos / 48 ambíguos.)*

### Divergências CONSCIENTES / honestidade
- **NÃO é a carga viva.** O deliverable é a FERRAMENTA + o motor verificado + os artefatos reais (limpo + fila de revisão), não um load em produção. Falta: (a) o banco do tenant real (schema-per-tenant ainda não provisionado in-repo), (b) a **decisão do operador nos 48 grupos ambíguos** (o tiebreak escolhe um default defensável, mas o vínculo certo é humano). O CSV `..._ambiguos.csv` é essa fila.
- **1 grupo é FALSO-ambíguo** — `(codfor 84589, codref 0070330129627) → candidatos 20220, 20220` (o MESMO idproduto duas vezes = 2 linhas legadas duplicadas exatas). O motor mantém 1 e não perde nada; entra na fila só por ter >1 linha na chave.
- **`SEM GTIN` (106)** e **sujas (21)** são descartadas de propósito — não são de-para utilizável (sem código de fornecedor real, ou apontam produto/fornecedor inexistente). Documentado, não migra.
- **O motor é PURO e testado** (7 testes unitários `cutover-dedup.spec.ts` cobrindo cada categoria + smoke §74 contra o Postgres real com idempotência). A verificação contra os 16.229 é o report acima; o artefato limpo NÃO é versionado (dado de tenant, fica no scratchpad).

## 4. Adiado (com procedência — nada perdido)
- **SEFAZ / manifestação do destinatário** (download-by-chave, `NFE_NAO_CADASTRADAS`/staging via ACBr) + **de-para: cadastro/manutenção standalone** (grade na tela de Produto) + ~~**cutover das 16.229 linhas de `CODREFERENCIA_FOR`**~~ — **FERRAMENTA + motor de de-dup ENTREGUES (§14)**; resta só a CARGA VIVA (banco do tenant real + revisão dos 48 grupos ambíguos) + **backfill** (`uAtualizaTipoCodReferenciaFor`) + **auto-criação de produto/fornecedor** a partir do XML + **Análise Pedido×NF** (`ANALISE_PEDIDO_NF*`, link automático por chave + divergências pedido×NF) + **A Pagar (resíduos):** gerar no F3 em vez do import + "refaturar do XML" (recovery das parcelas exatas) + **auto-derivação por item do `total_icmst_externo`** (motor fiscal de ST externo — o corte-4c já entregou o título RESIDUAL ST a partir do campo de cabeçalho, §9) + CX_APAGAR/contábil da retenção (idsituacao_nf do título + GeraCxApagar/DIARIO) + snapshot `perc_aliquota_ret_*` p/ OBS byte-a-byte sob drift de config, bandeira do cartão (OPERADORAS) + **transportadora/lote/rastro** + **recebimento parcial/múltiplo 1:N** (63 pedidos; sem CODPEDCOMPI nem qtd-recebida no schema) + **devolução de compra** (`COD_PED_DEV_COMPRA`/`PEDIDO_DEVOLUCAO_COMPRA*`, saída) + **cross-docking 1-para-N-lojas**. `STATUS_PEDCOMP`/`STATUS_QTD_PEDCOMP`/`PEDIDOCOMPRA.NRONF`/`IDSITUACAO_NF` são MORTAS (100% NULL) → não usadas.
- ~~**Condição de pagamento / parcelas**~~ — ENTREGUE no corte-2 (§11). Resta o **split multi-loja** (`PEDIDO_COMPRA_QTDE`/`COMPRA_1_PARA_N_LOJAS`, IDEMPRESA por parcela = cross-docking) e o **`data_faturamento` no fluxo do recebimento** (hoje o marcador "recebido" e o input de faturamento são colunas separadas — reconciliar quando o recebido virar `NF.CODPEDCOMP`).
- **Precificação/analítica do item** (`MARKUP`/`VRVENDA`/`VRVENDASUG`/`PMZ`/`VRCUSTOLIQUIDO`/margens/lucros) — output do motor `precificacao` (SUGESTÃO); reuso opcional em corte-2 (não é dado primário). **Nota de magnitude (auditoria):** essas colunas são MUITO populadas no golden (`VRVENDA` 100%, `MARKUP` 98,2%, margens ~98,3%, `VLREMBALAGEMB`≈VLREMBALAGEM redundante 100%) — a decisão de adiar é defensável (é sugestão do motor, não fato), mas o volume é alto; reavaliar prioridade do reuso do motor no corte-2.
- **`CD1` (header, populada 73,8% / 56 valores distintos)** — semântica DESCONHECIDA (campo genérico CD1..CD8). Não é "lixo" (tem carga real); ADIADO até confirmar o significado antes de descartar/migrar. (CD2..CD8, `NRONF`/`IDSITUACAO_NF`/`IDTF`/`SINCRONIZADO` confirmados 100% NULL = lixo real.)
- **Impostos do item** (`ICME`/`IPI`/`ICMST`/`PISCONFIS`/créditos-débitos) — alíquotas de simulação; o imposto DEFINITIVO nasce na NF (não replicar cálculo fiscal no pedido).
- ~~**limite** (`OPERADOR_ULT_LIB_VALOR_MAX`)~~ + ~~**bonificação** (`BONIFICACAO`)~~ + ~~**propagação de preço** ("importação"/on-line)~~ — **ENTREGUES no corte FINAL (§13)**. Resta: **análise/aprovação** (`OPERADOR_ULTIMA_ANALISE`, fluxo de aprovação de pedido), **fila de etiquetas `LOTEPRECO`/`LTPRECO_PROCESSADO`** (efeito PDV da propagação — depende do PDV) + cascade pai/filho na propagação, **`TIPO_FLUXO_CAIXA_PC`** exclusivo (M8), **1-para-N-lojas** (`EMPRESAS` CSV). MORTOS: `NOVO_LIMITE`+senha, `CODPEDCOMP_BONIFICADO`, `IMPORTADO`.
- **Colunas mortas/lixo** (`NRONF`/`IDSITUACAO_NF`/`IDTF`/`SINCRONIZADO` 100% NULL; `VLRUNITARIO`/`VRVENDAITEM` do item; `CD2..CD8`) — descartadas. (`CD1` movida p/ adiado — tem carga real, ver §1.)
- **Satélites 0 linhas** (`PEDIDOCOMPRA_ANALISE`/`_COLETOR`/`_QTDE_TRANSF`/`_CARRINHO`/`_CARRINHO_ITEM`/`PEDIDOCOMPRACEREAL`) — ignoradas.

## 15. RECEBIMENTO PARCIAL 1:N (Wave 4) — corte-1 (fundação: 1:N + saldo) — ENTREGUE e verde, 2026-07-16

Destrava o recebimento de UM pedido em VÁRIAS NFs de entrada (o fornecedor entrega em remessas). Recon 3 frentes
(Oracle READ-ONLY + `UanalisaPedComp_NF.pas` 3283 linhas + monorepo) + decisões do usuário via AskUserQuestion:
**(1) vínculo item-NF↔item-pedido POR PRODUTO** (fiel ao legado — NF_PROD não tem CODPEDCOMPI; o usuário aceitou o
risco de produto repetido no pedido); **(2) escopo = núcleo 1:N + Análise juntos** (este corte-1 entrega a fundação;
a Análise/divergências/liberação é o corte-2).

**Modelo (antes → depois):** antes a NF ligava ao pedido 1:1 (índice UNIQUE `ux_nf_codpedcomp`, recebimento
all-or-nothing). Agora (migration 087): DROP do UNIQUE + `nf.status_qtd_pedcomp`/`status_pedcomp`/
`codoperador_liberacao`. Saldo é **COMPUTADO** (não há coluna de saldo — confirmado no Oracle): fiel a
`udmNF.dfm:17495` (FDqSaldoPedidoCompra), adaptado ao single-empresa da 078:
`saldo(produto) = Σ pedidocompra_i.qtdtotal − Σ (nf_prod.quantidade × nf_prod.fatorembal)` das NFs vinculadas
(`nf.codpedcomp`, não-canceladas), correlacionadas por PRODUTO (`nf_prod.codproduto = pedidocompra_i.idproduto`).

**Backend:**
- `AnalisePedidoNfService.saldo(codpedcomp)` (novo): saldo por produto (qtdPedido/qtdRecebida/saldo) + saldoTotal +
  totalmenteRecebido. READ-ONLY, tenant fail-closed. `GET compras/pedidos/:id/saldo`.
- `RecebimentoService.gerarNf` reescrito **saldo-driven**: chamável N vezes; recebe o SALDO restante (ou
  `quantidades` explícitas por produto, ≤ saldo → senão `RECEBIMENTO_EXCEDE_SALDO`); saldo=0 →
  `PEDIDO_TOTALMENTE_RECEBIDO`; marca a NF `'Total'` (fecha o saldo) / `'Parcial'`. `dtfaturamento` carimbado na
  1ª remessa (trava edição/reabertura do pedido — PEDIDO_FATURADO intacto) mas NÃO bloqueia remessas seguintes; só
  desfaz no erro se fomos nós que setamos.
- `persistirComVinculo` (import XML) idem: permite N NFs; bloqueia só se totalmenteRecebido.

**Divergências CONSCIENTES / adiado (corte-2):** over-receipt (receber > pedido) NÃO é bloqueio — é **divergência**
(fiel: o legado avisa + exige liberação de supervisor, não trava). A janela concorrente (2 gerar-nf simultâneos) pode
gerar over-receipt (o saldo é lido antes de criar a NF, sem lock forte) → tratada como divergência. A **Análise
Pedido×NF** (cruzamento preço `VARIACAO_CUSTO_PEDIDO_NF%` / qtd, liberação por supervisor reusando E8, `GERA_ARECEBER_
DIF_PEDCOMPRA_AUTO`, fechar pedido) e o **front** são o corte-2/3. Saldo conta NF rascunho (proc='N') como recebida
(fiel: link = conta); NF cancelada (`cancelada='S'`) é excluída.

**Auditoria adversarial (paridade+regressão) — folds aplicados:**
- **[MÉDIA]** o UPDATE de `status_qtd_pedcomp` estava DENTRO do try que faz o undo do `dtfaturamento` → se falhasse
  APÓS a NF criada, o catch reabria o pedido com a NF já vinculada. Fix: mover pra FORA do try + best-effort.
- **[BAIXA]** saldo excluía só `cancelada='S'` → agora exclui também `statusnfe='C'` (consistente com nf.aggregate/
  nf-faturamento/devolucao). **[BAIXA]** import vinculado perdeu o mapping `23505→NF_DUPLICADA` → restaurado.
  **[BAIXA]** `quantidades` com produto duplicado era last-wins silencioso → agora SOMA e valida o total ≤ saldo.
- **[BAIXA] LIMITAÇÃO deferida:** `dtfaturamento` (trava de edição) NÃO é limpo quando as NFs vinculadas são
  deletadas → o pedido fica travado PEDIDO_FATURADO mesmo com saldo recuperado (parcialmente pré-existente do modelo
  1:1). Remédio: hook de exclusão de NF que reavalia/limpa a marca — fast-follow.

**Verde pós-fold:** api tsc 0 · api test 151 · smoke **571/0** (§49.5 saldo-zerado→TOTALMENTE_RECEBIDO; §49.5b: saldo
inicial, 1ª remessa parcial 6/10→Parcial, over-receipt→EXCEDE_SALDO, 2ª remessa 4→Total+totalmenteRecebido, 3ª→422, 2 NFs).

## 16. RECEBIMENTO PARCIAL 1:N (Wave 4) — corte-2 (ANÁLISE PEDIDO×NF) — ENTREGUE e verde, 2026-07-16

O cruzamento NF×pedido do legado (`UanalisaPedComp_NF.pas`): detecta DIVERGÊNCIAS e LIBERA a conferência (com
supervisor quando há divergência). Reusa o **E8** (ChamaLiberacaoLogin + LOG_LIBERACOES + lockout).

**Backend (`AnalisePedidoNfService` estendido):**
- `divergencias(codnf)`: carrega a NF vinculada (codpedcomp obrigatório; tenant fail-closed), compara o CUSTO
  UNITÁRIO de cada item da NF (`nf_prod.vrcusto`) com o do pedido (`pedidocompra_i.vrcusto`), correlação por PRODUTO.
  Divergência **PRECO** se `|custoNf−custoPedido|/custoPedido > VARIACAO_CUSTO_PEDIDO_NF/100` (config, default **0** =
  qualquer diferença); item da NF fora do pedido → **INE_PEDIDO**. `GET compras/analise-pedido-nf/:codnf/divergencias`.
- `liberar(codnf, {login?,senha?})`: sem divergência → `'LIBERADO SEM DIVERGENCIA'` (operador da sessão). Com
  divergência → exige SUPERVISOR (`login+senha` ∈ `USUARIOS_PERMITIDOS_LIBERAR_PEDIDO_COMPRA`, id 26 da 083) via
  `LiberacaoService.validar` → `'LIBERADO COM DIVERGENCIA'` + `codoperador_liberacao=supervisor`; sem override → 422
  `LIBERACAO_SUPERVISOR_REQUERIDA`; validar falhou → 422 `LIBERACAO_NEGADA`. Grava `nf.status_pedcomp`. RBAC
  `FRMPEDIDOCOMPRA/BTNLIBERARCONFERENCIA`. `POST .../:codnf/liberar`.
- migration 088: seed configs `VARIACAO_CUSTO_PEDIDO_NF`(id 2,'0')/`VERIFICA_VR_UN_OU_EMBALAGEM`(id 39,'E') + RBAC.

**Divergências CONSCIENTES / adiado:** comparação **sempre por UNIDADE** (a NF de entrada é unit-based, fatorembal=1
→ o caminho `VERIFICA_VR_UN_OU_EMBALAGEM='E'` por embalagem equivale ao unitário; a config é lida mas não altera).
**Adiado (com procedência):** divergência de QTD (`PedcompQTDTOTAL<>ItensNotaQTDETOTAL` — coberta pelo SALDO do
corte-1 no 1:N); `'LIBERADO COM DIVERGENCIA FINANCEIRA SEM EXIGIR SENHA'` (`EXIGE_SENHA_DIVERGENCIAS_PARCELAS_NF_PC`)
+ divergência de PARCELAS + `INE_NF`; **fechar pedido** (`IMPORTADO/FECHADO='S'` — no 1:N o "fechado" é implícito:
saldo=0); **gerar A Receber da diferença** (`GERA_ARECEBER_DIF_PEDCOMPRA_AUTO`, id 315, default 'N').

**Auditoria adversarial — folds aplicados:**
- **[MÉDIA]** `divergencias` ignorava QUANTIDADE → over-receipt via import liberava sem supervisor (o corte-1 delegou
  o over-receipt a este corte). Fix: saldo < 0 em algum produto → divergência **QUANTIDADE** (exige supervisor).
- **[MÉDIA]** tolerância com denominador INVERTIDO — o legado monta a faixa em torno do valor da NF
  (`|custoPed−NF|/NF > var`), não do pedido. Fix: denominador = custoNf (idêntico só sob VARIACAO=0). 
- **[MÉDIA]** produto repetido no pedido: 1ª linha sem `ORDER BY` (não-determinístico) + comentário "média" falso +
  divergência duplicada. Fix: `ORDER BY codpedcompi`/`nroitem` (determinístico) + dedup por produto (fiel ao cdsDiv.Locate).
- **[BAIXA]** sem guarda de NF cancelada → `carregarNfVinculada` recusa `cancelada='S'`/`statusnfe='C'` (NF_CANCELADA).
  **[BAIXA]** `status_qtd_pedcomp` não setado no import → import marca Total/Parcial best-effort.

**Verde pós-fold:** api tsc 0 · api test 151 · smoke **577/0** (§81: sem divergência→libera direto op7; custo 8≠5→PRECO;
sem supervisor→422; supervisor sem grant→NEGADA; op8 autorizado→LIBERADO COM DIVERGENCIA cod=8; RBAC 403; NF sem pedido 422).

## 17. RECEBIMENTO PARCIAL 1:N (Wave 4) — corte-3 (FRONT) — ENTREGUE e verde, 2026-07-16

Fecha o épico Wave 4 no front (tela do Pedido de Compra, `PedidoCompraCadMaster`):
- **`AnalisePedidoNfPanel`** (novo): painel de RECEBIMENTO no pedido FECHADO — tabela de SALDO por produto
  (pedido/recebido/saldo, badge Totalmente recebido/Saldo em aberto) + CONFERÊNCIA de uma NF (input do nº da NF →
  divergências PRECO/QUANTIDADE/INE_PEDIDO → «Liberar»; com divergência mostra os campos login/senha do SUPERVISOR).
- **`RecebimentoSection`** (wrapper): coordena a barra de estado com o painel — ao gerar/importar uma NF a barra
  chama `onRecebeu(codnf)` → re-busca o saldo (`refreshKey`) e pré-preenche a conferência da NF recém-recebida.
- **`AcoesEstadoBar` (1:N):** «Gerar NF»/«Importar XML» agora disponíveis enquanto FECHADO (o servidor barra quando
  o saldo zera — antes travava na 1ª NF por `dtfaturamento`); «Reabrir» só ANTES da 1ª remessa; sem auto-navigate
  (fica no pedido p/ conferir). Fetchers `saldoPedido`/`divergenciasNf`/`liberarConferencia`.

Self-review (sem auditor dedicado — camada fina de UI sobre o backend já auditado): `useMensagem` é estável
(useMemo+useCallback) → sem loop de fetch no `useEffect([carregarSaldo, refreshKey])`; supervisor login/senha só
enviados quando há divergência. **RECEBIMENTO PARCIAL 1:N = ÉPICO COMPLETO** (corte-1 saldo/1:N + corte-2 Análise +
corte-3 front). **Verde:** web tsc 0 · web test 32 · web build ✓ (api/smoke inalterados 577/0).
