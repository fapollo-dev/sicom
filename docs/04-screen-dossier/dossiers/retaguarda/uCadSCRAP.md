# Dossiê de Tela — SCRAP / PERDAS — `FRMCADSCRAP`

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | corte-1 (registro + baixa de estoque) ENTREGUE e verde, 2026-07-30, commit `ff0a6ed`, migration 116. Recon (mapa menu×migrado×dado-real via `MENUEXPRESS` + Oracle golden + monorepo) + auditoria adversarial (2 agentes: paridade + correção) — sem defeito ALTA de dados. Verde: shared build · api tsc 0 · api test 172 · smoke **796/0** (§47b, 10 checks) · web tsc 0 · build. |
| **Autor** | Claude (agente de migração) |
| **Fontes legadas** | `FRMCADSCRAP` (unit `uCadSCRAP`). Kardex: `HISTORICO_PROD`. Lookup: `MOTIVOS_OPERACAO`. Relacionados adiados: `UmportaVendasPerdas` (importador F7), NF de perda CFOP 5927. |
| **Golden** | Oracle PINHEIRAO: `SCRAP` + `ITENS_SCRAP` (populado até 2026), `MOTIVOS_OPERACAO`, `ESTOQUE`, `HISTORICO_PROD`, `MENUEXPRESS` (auditoria de uso). |

## 1. Por que esta tela (seleção do módulo)

O corte foi escolhido por um **mapa menu × migrado × dado real**: a tabela de auditoria de uso `MENUEXPRESS` mede quem abre cada tela do legado. Scrap saiu como a **3ª tela mais usada** do ERP, com `SCRAP` populado até 2026, tabela limpa e primo direto do Inventário/Ajuste já migrados.

**Descartados por DADO-MORTO neste tenant** (mesmo veredito do Bloco D do SPED): Logística de Recebimento/Doca/Agenda, Mapa de Carga, MDF-e, CT-e, Cheques, Transferência entre lojas, Vasilhame, Entregas, Funcionários, Recargas.

**Vivos não escolhidos** (viraram fila): Manifestação do Destinatário de NF-e de entrada (SEFAZ externo), Cartões/recebíveis (125k linhas → entregue depois em `uCadCartao.md`), Conciliação OFX, Produção açougue/padaria, Troca com fornecedor (→ `uTrocaMercadoriaFor.md`), Devolução de Vendas, Adiantamento a Fornecedor.

## 2. Modelo (Oracle real)

- Documento **MESTRE-DETALHE** de perda (quebra / vencimento / avaria).
- **`SCRAP`** (cabeçalho): `codscrap`, `dt_cadastro`, `codplc`, `codparceiro`, `idsituacao_nf`, `mov_estoque`, `importado`, `obs`.
- **`ITENS_SCRAP`** (itens, FK em cascata): `idproduto`, `qtde` **signed**, `vr_custo`/`vrcustorep`, `codmotivoop`, `codsetor`, `codfor`, + `origem`/`motivo`/`faturado` com default.
- **`qtde` é SIGNED** — o golden tem 6 negativos e 22 zeros (estornos). **Não clampar.**
- **Sem `INDR`** → exclusão física (fiel).
- **Domínio PERDA** em `MOTIVOS_OPERACAO`: 4 motivos exatos — **127** GERAL (o mais usado), **141** VALIDADE, **142** AVARIA, **261** IDENTIFICADA. Tolera null/0.
- **Valoração** é unitária × qtde — **não existe coluna de total**.
- Colunas mortas dropadas (100% null/zero); manteve o `VRCUSTOREP` vivo e dropou o twin morto `VR_CUSTO_REPOSI`.

### Contexto histórico do golden (decisivo para o recorte)

As perdas **fluíram por NF-de-perda** (`importado='S'`, 92% entre 2020-24) e **viraram baixa-direta** (`mov_estoque='S'`) a partir de **2025-10-27**. Implementar a baixa-direta e decoplar o "aplicar" é fiel ao comportamento **atual** da operação.

> ⚠️ **CORREÇÃO (23/09/2026, produção lida):** a frase acima está ERRADA para a produção. De jun/2025 a set/2026
> **nenhum** scrap tem `MOV_ESTOQUE='S'` (25-32 por mês, 85-90% importados em NF — PEDIDO_NF tipo 'S': 199 scraps →
> 131 NFs em 2026, todas processadas e autorizadas) e a config `BAIXAR_ESTOQUE_NO_SCRAP` (id 576, "define se o estoque
> será baixado na criação do scrap") é **'N'**. Quem baixa o estoque é o PROCESSAMENTO da NF de perda. O "aplicar" do
> Apollo passou a exigir `BAIXAR_ESTOQUE_NO_SCRAP='S'` (senão 422 `SCRAP_BAIXA_PELA_NF`) e a importação do scrap na
> NF de saída foi convertida (`nf-scrap.service.ts`; dossiê uNF.md). Lição 133: medir na produção antes de afirmar.

## 3. Corte-1 (ENTREGUE)

- **Migration 116:** `scrap` + `scrap_item` (FK cascata) + seed dos 4 motivos PERDA em `motivos_operacao` + view `get_scrap` (nº de itens + valor Σ `qtde × vr_custo`) + RBAC `FRMCADSCRAP`.
- **`scrap.aggregate`** — CRUD mestre-detalhe via factory (molde Inventário). Valoração do custo **SERVER-AUTHORITATIVE** por `MULTI_PRECO`: o operador **não digita custo**.
- **`scrap.service`** — `aplicar`/`estornar` = movimento **RELATIVO** em `estoque.qtde` (delta −qtde na baixa / +qtde no estorno) + Kardex `historico_prod` com `origem='SCRAP'` (molde ajuste-estoque; `forUpdate` na linha do scrap **e** na do estoque). A baixa é **decoplada do gravar** (precedente do Inventário); `mov_estoque='S'` marca aplicado.
- **`scrap.controller`** para aplicar/estornar. **Front** `ScrapPage` mestre-detalhe (lista + documento: produto/qtde/motivo, valoração, aplicar/estornar/excluir) + rota `/estoque/scrap` + menu (ícone Trash2).

### Folds da auditoria

- **[ALTA] PUT em documento aplicado/faturado dessincronizava a baixa.** O `updateAggregate` faz delete+insert dos itens sem checar estado, e o `estornar` usa os itens **atuais** → corromperia o saldo (aplicar 8 → PUT para qtde 100 → estornar → +100). O **`validar` passou a travar o update** (`mov_estoque='S'` → `SCRAP_ESTOQUE_APLICADO`; `importado='S'` → `SCRAP_JA_FATURADO`), espelhando o `validarRemocao`. Smoke §47b.2b (PUT → 422, saldo intacto).
- **[MÉDIA] custo confiado do cliente** → `derivarItensTrx` **sempre** lê `MULTI_PRECO`; `vr_custo`/`vrcustorep` removidos do schema de input (valor da perda não é forjável). Smoke §47b.8.
- **[MÉDIA] web "Aplicar" habilitado com itens locais não salvos** — atuava no estado do servidor, perdia input e deixava documento "aplicado" vazio → **dirty-guard** (salvar antes de aplicar).
- **[BAIXA]** `origem_estoque` default `'E'` (dominante no golden, 61%); comentário "261 padrão" corrigido para "127 GERAL, o mais usado".

### Não-issues confirmados

Idempotência de aplicar/estornar (`forUpdate` + guard de `mov_estoque` re-checado na transação) · mesmo produto 2× no documento (delta relativo + read-your-writes) · concorrência cross-documento (`forUpdate` na linha de estoque) · rollback no meio do loop · tenant scoping (`idempresa` em tudo) · cascata da FK.

## 4. Adiado (com procedência)

- ~~**Lançamento gerencial em CAIXA**~~ ✅ 24/09/2026 — `scrap-caixa.ts` (a diferença da perda a cada gravação; `CAIXA-escritores.md`).
- ~~**NF de perda CFOP 5927**~~ ✅ 23/09/2026 — a importação do SCRAP na NF de saída (`nf-scrap.service.ts`, `NfScrapModal`).
- ~~**Importador F7**~~ de perdas identificadas (`UmportaVendasPerdas`) → 🪦 **morto, com prova (28/09/2026)**: gera a perda
  por `PRODUTOS.PERCENTUAL_PERDAS` sobre a venda/NF em KG e marca `VENDAS.CODSCRAP`/`NF_PROD.CODSCRAP` — na produção **1** produto
  tem percentual e **nenhuma** venda foi marcada desde 2022 (os 36.833 `NF_PROD.CODSCRAP` são o caminho inverso, a importação do
  SCRAP na NF de perda, convertida em 23/09).
- ~~**Gating de config PLC**~~ ✅ já no `scrap.aggregate` (`FLG_USO_SETOR` obriga o setor; `PLC_OBRIGA_MOTIVO_PERDA` ou a config
  `INFORMA_MOTIVO_PERDA_SCRAP` obrigam o motivo; motivo tem de ser de PERDA) — a linha "adiado" tinha ficado velha.
- **Situação do documento** (E02).

### CAVEAT de ETL

Re-save de documentos legados com motivo **não-PERDA** (51 linhas: {6, 3000, 3860}) reprovaria no `validar` — tolerar na ETL ou aplicar a regra só a itens novos. E **7 itens com `idproduto` órfão** barrariam no `NOT NULL` + FK.

## 5. Pendência

**Preview de tela não renderizado** — pendente do eyeball do usuário. A tela espelha Inventário e Ajuste de Estoque, ambos já validados visualmente.

## Ver também

- [uInventario.md](uInventario.md) — o primo que definiu o "aplicar decoplado".
- [uAjusteEstoque.md](uAjusteEstoque.md) — o molde do movimento relativo + Kardex.
- [uTrocaMercadoriaFor.md](uTrocaMercadoriaFor.md) — mesmo molde, lado do fornecedor.

## Corte "o documento como o legado" (24/09/2026) — auditoria de esqueletos §4.3

A tela web criava o documento vazio (`criarScrap({})`) e salvava só `{obs, itens}` — sem centro de custo a CAIXA gerencial
nunca era lançada (produção 2025-26: 12.006 linhas, R$ −9.169.081,45 em 607 scraps). Agora (smoke §203):

- **Rascunho local + um só gravar**, com situação, centro de custo, fornecedor e itens — como o `btnGravarClick`.
- Travas do servidor (uCadSCRAP.pas:603-700, :306-335; udmCadSCRAP.pas): "Obrigatório informar um item. Verifique!",
  "Informe o centro de custo e tente novamente!" (623 de 623 com CC), "Quantidade não pode ser MENOR QUE ZERO" (0 negativos
  em 28.532 itens de 2025-26), item de quantidade zero descartado ao gravar (a tela confirma antes).
- **Situação** obrigatória com INFORMA_SITUACAO_DOCUMENTO_SCRAP — global 'N', mas o override "Modulo Retaguarda" = 'S' (621 de
  623 com situação) — e de TIPO_OPERACAO 'E02' (3000 PERCA, 3001 USO E CONSUMO, 3400 TRANSFORMAÇÃO).
- **Fornecedor** = o parceiro da empresa (`cdsSCRAPNewRecord`; 87199 nas 623).
- **Setor** obrigatório no item incluído quando o CC tem FLG_USO_SETOR; **motivo** com INFORMA_MOTIVO_PERDA_SCRAP ou
  PLC_OBRIGA_MOTIVO_PERDA do CC. Setores = FAMILIAS_PROD tipo 'E' (o 'SETOR' do GET_FAMILIAS_PROD). Produto filho no item.
- `usucadastro` do item gravado. «Aplicar» só aparece com BAIXAR_ESTOQUE_NO_SCRAP='S' ('N' no cliente).
- Apoio da tela: `GET cadastro/scrap/apoio/dados` (situações, centros de perda com as flags e a lista por situação, setores,
  parceiro, configurações).

## Imprimir Scrap (01/10/2026)

O menu "Imprimir Scrap" (`ImprimirScrap1Click`, uCadSCRAP.pas:1600) não existia no Apollo. Agora `GET cadastro/scrap/:id/impressao`
devolve o `extr - Scrap.fr3` da RELATORIOS (PERSONALIZADO antes do DEFAULT) com os datasets do legado: **frxDBScrap** (o `sqqSCRAP` —
centro de custo, observação, situação), **frxDBScrapitem** (o `sqqSCRAP_Item` — o TOTAL é a quantidade × o custo **atual** da loja no
MULTI_PRECO, não o custo gravado no item; fiel) e **frxDBEmpresa** (a empresa logada, sem senhas/tokens/certificados). O layout é
mestre-detalhe (DetailData dos itens com um grupo que soma quantidade e total), e o motor `shared/fr3` ganhou a DetailData. O menu não
tem Tag: vale o acesso à tela (`FRMCADSCRAP`; mig 404 dá a opção ao operador de fixture). Botão "Imprimir" no lançamento gravado.
Smoke 47b.1b.

## A auditoria controle a controle do uCadSCRAP.dfm (14/10/2026)

O `.dfm` (2.525 linhas), o `udmCadSCRAP` e as 8 opções de permissão da produção revistos contra a página do Apollo, com a prova nos
3.794 scraps / 133.324 itens (273 scraps e 11.594 itens em 2026). Convertido:

- ⛔→✅ **O produto pelo código** (`EdtCodProduto` + "Buscar por PLU (F2)" + `BtnBuscaProduto`/F3; `GetProduto`/`GetProdutoFilho`,
  udmCadSCRAP.pas:382/332): código de barras ou **código auxiliar** (CODAUXILIAR), ou o código do produto com o F2 (guardado por
  estação — `ConfigTelas.ini` → `localStorage`); o produto **filho** leva ao pai (IDPRODUTO_PAI) e fica no IDPRODUTO_FILHO (527 dos
  11.590 itens de 2026 são filhos); custo e reposição do MULTI_PRECO da loja; com `IMPEDIR_MOVIMENTO_ESTOQUE_NEGATIVO` só com estoque;
  o fornecedor do item = o da última entrada (ESTOQUE.IDORIGEM_ENT → NF, senão PRODUTOS.CODFOR — `SetaOutrasInformacoesItemScrap` :441).
  A página pedia o id do produto e do filho. `GET cadastro/scrap/apoio/produto?codigo=&plu=`.
- ⛔→✅ **A grade do legado** (cxgridItensScrap): Cod.prod, Cod.Prod Filho (com `EXIBE_CAMPO_PRODUTO_PAI` — 'S' na empresa 1), Codigo
  Barra, Descrição, Qtde, Vr.Custo, Custo Repos., Total, Origem, Faturado, Imp, Origem Imp., Setor, Motivo perda, Fornecedor — a leitura
  do agregado anexa o que a SCRAP_ITEM não guarda (`anexarLeitura`). A página mostrava só o id do produto.
- ⛔→✅ **"Limpar"** (`btnLimparIClick` :791, BTNLIMPARI — 60 operadores): "Deseja limpar todos os produtos deste pedido?"; sem senha
  (o legado só confere o importado). **"Excluir" do item gravado e do documento com a liberação por login** (`PermiteExcluir` :1749,
  `PEDE_SENHA_EXCLUIR_ITEM_SCRAP` = 'S' no módulo Retaguarda; libera quem tem a config em 'N' — o usuário 1 na produção; 35 itens e 1
  scrap excluídos em 2026): `POST cadastro/scrap/:id/excluir-itens` e `:id/excluir` com login/senha; o item novo sai sem senha
  (NOVO_REGISTRO). As permissões BTNEXCLUIR (35 operadores), BTNGRAVAR/BTNEDITAR/BTNADICIONARREGISTRO agora valem na página.
- ⛔→✅ **"Não é permitido fracionar produto que não seja Kg!"** (`ProdutoUndFracionado` :1772) — na página e no gravar (item incluído).
- ⛔→✅ **`BLOQUEIA_PRODUTO_DUPLICADO_SCRAP`** ("O produto já foi inserido no SCRAP anteriormente.", `GetProduto` :424; pai + filho é a
  chave) — 'N' no módulo Retaguarda da produção: a regra existe, desligada lá.
- ⛔→✅ **Data do lançamento** (`edtData`/`edtDataExit` :1373, `TController` fora do fonte — as configs são as da produção):
  `DIAS_PERMITIDO_LANCTO_RETROATIVO_SCRAP` = 0 → data só de hoje na inclusão (futura e retroativa → 422); `EDICAO_SCRAP_FORA_DO_MES`
  'N' bloqueia a edição fora do mês — 'S' em todos os níveis da produção (3 de 652 scraps alterados fora do mês: a importação na NF).
  DT_CADASTRO = DTCADASTRO em 652 de 652: ninguém muda a data, mas o campo existe.
- ⛔→✅ **Importado** (`Importado`/`ListaNotasFiscaisAssociadas` :1595/:1690 e o grupo "Notas fiscais", `cdsNotasFiscais`): o scrap ligado a
  uma NF de perda (PEDIDO_NF tipo S — 225 dos 273 de 2026) lista a nota com o STATUSNOTA e não se altera nem se exclui ("Este SCRAP já foi
  importado. Não será possível alterá-lo. NF.: …"); a trava anterior olhava só o IMPORTADO='S'.
- ⛔→✅ **[F6] - Análise geral do produto** (`MostraAnaliseGeralProduto` :1739 → TfrmPosicaoProduto): a posição do produto da linha.
- Mig 420: as 7 configurações da tela (ids/defaults/whitelist da produção) e os overrides da produção.

Com prova, sem código: **[F7] - Importar produtos** (`ConsultaImportarPerdas` :979 — as perdas das VENDAS/NF, IMP_VENDAS='S'): 132 itens em
2024, **0 em 2025 e 2026**; **motivo padrão do centro de custo** (`GetMotivoOpCentroCustoPerda` :276 — PLC_MOTIVO_OPERACAO): 0 linhas;
**fornecedor do documento** editável (`edtCODFOR`): 652 de 652 = o parceiro da empresa (fica fixo); **empresa de origem ≠ logada**: o
agregado é por loja (a de outra loja não abre); **edição da quantidade na grade** (Enter na coluna): aqui exclui e inclui de novo.

Smoke §315 (4 checks); jsdom `scrapPage.spec.tsx`.

