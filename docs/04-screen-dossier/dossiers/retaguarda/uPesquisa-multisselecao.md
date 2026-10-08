# PESQUISA — Multisseleção: onde o legado marca várias linhas, e o que a tela do Apollo faz hoje

Recon de 07/10/2026, **somente leitura** (nenhum código, migration ou commit). Complementa `uPesquisa.md` §6.1 (o mecanismo) e o
corte D da Pesquisa, que já pôs no Apollo as props `multisselecao` + `onSelecionarVarios(linhas)` em
`apps/web/src/shared/cadmaster/Pesquisa.tsx`. Até hoje **nenhuma tela usa essas props** (grep em `apps/web/src`: só o próprio
`Pesquisa.tsx`). Este documento lista, chamada por chamada, onde o legado abre a Pesquisa em multisseleção e como a tela equivalente
do Apollo resolve a mesma escolha.

> **Procedência.** `[fonte]` = Delphi de mai/2020 (`/Library/SicomGit/retaguarda-master/fonte/Units`, latin1), conferido contra o
> `Retaguarda.dpr` (unit fora do `.dpr` não é compilada). `[produção]` = Oracle vivo, `SET TRANSACTION READ ONLY`, só SELECT, em
> 07/10/2026. Os acessos são `SUM(MENUEXPRESS.ACESSOS)` agrupado por `FORMULARIO` (a mesma métrica de `FALTA-MIGRAR-POR-USO.md` e
> `FILA-CONVERSAO.md`, lição 16). As contagens são `count(*)` exato. `[Apollo]` = `main` `6907baf4`, mais a árvore de trabalho de
> 07/10 (outro agente tinha `telas.ts`/`Pesquisa.tsx` alterados sem commit). Por isso os recursos de `telas.ts` são citados pela
> **chave**, não pela linha. Caminhos curtos: `W:` = `apps/web/src/features/`, `A:` = `apps/api/src/modules/`, `FILA` =
> `docs/05-migration-engineering/FILA-CONVERSAO.md`.

---

## 0. Resumo

**O universo.** Há duas portas para a multisseleção, e a segunda não contém a palavra `HabilitaMultiselecao`:

- **A propriedade.** São 84 units com `HabilitaMultiselecao`. Saem 8:
  - 3 só definem ou registram: `uPesquisa`; `uPesquisa2`, que está fora do `.dpr`; e `udmPrincipal`, que só faz `EventLog` em `:3564`.
  - 1 é cópia fora do `.dpr`: `1uNF` (3 chamadas).
  - 4 inteiras fora do `.dpr`: `uBaixasAPG`, `uBaixasCHQ`, `uBaixasRCB`, `uTabelaPrecoProd`.

  `uMenuSuperior` **não** só define: é uma chamada real (item "Selecionados" do menu, `:1276`).
- **O método de classe.** `TfrmPesquisa.Pesquisa(Owner, View, procedure(pDst)…, Filtro)` liga `HabilitaMultiselecao := True` por
  dentro (`uPesquisa.pas:2402-2424`). Ninguém achava essas chamadas procurando a palavra. São 9, em 7 units:
  - `UFrmLoteConferenciaNF` ×2
  - `UFrmLoteInventarioRotativo`
  - `UPrecificacaoTabelaPreco`
  - `URelCompras`
  - `uCadClientes` ×2
  - `uCadFormaPgto`
  - `uNFCe`

  A sobrecarga que devolve `.GetValor(…)` é seleção única e ficou de fora.

| | chamadas |
|---|---:|
| pontos de chamada achados (120 com a propriedade + 9 pelo método) | **129** |
| − `HabilitaMultiselecao := False` (`uCadProducao:919`, `uDescontoTitulo:392`, `uFrmApuracaoICMSST:683`, `uReverterDescontoTitulo:841`) | 4 |
| − comentadas: `Utesouraria:647/719/788` (dentro do `(* … *)` de `:581-833`) e `uGerarFinanceiroLote:239` (dentro de `{ }` em `:234-241`) | 4 |
| − em units fora do `Retaguarda.dpr` (`uBaixasAPG` ×2, `uBaixasCHQ`, `uBaixasRCB` ×2, `uTabelaPrecoProd` ×2) | 7 |
| − PDV: `uNFCe:387` (FRMNFCE = Consulta NFC-e, ⛔ PDV pela ADR-017 e pela FILA) | 1 |
| **chamadas vivas, em 76 units** | **113** |

Fora da conta também ficaram as 2 linhas `//` de `UanalisaPedComp_NF:3166-3167` e as 3 de `1uNF`.

**O veredito das 113:**

| | chamadas | o que é |
|---|---:|---|
| em tela **não convertida** | **43** | ⛔ com veredito: FILA, dossiê ou contagem na produção; só 2 com uso possível, e nenhuma pede multisseleção agora |
| em tela **convertida** | **70** | (uma delas, o SPED fiscal, está convertida só na API) |
| ↳ ✅ **coberta por mecanismo equivalente** | **21** | o Apollo já escolhe vários com grade própria (checkbox, "Adicionar marcados", marcar todos/T, importação com prévia) |
| ↳ ⏭️ **não se aplica** | 3 | no legado a multisseleção é inócua: só a linha corrente é usada, ou o ramo nunca roda |
| ↳ 🪦 **gap marginal** | 11 | ação ausente, mas o dado do cliente está morto ou sem substrato (prova na linha); não vale aplicar agora |
| ↳ 🔧 **gap real** | **35** | **16 P · 16 M · 3 G**; 2 deles com uso NÃO PROVADO (`uInventario:2073`, `Uetiqueta:903`) |

Tamanhos:
- **P** = só a tela. Abre a Pesquisa com `multisselecao` num recurso que já existe e manda a lista a uma API que já aceita lista,
  ou faz N `append` num detalhe que já grava N linhas.
- **M** = falta um pedaço: recurso novo em `telas.ts`, schema ou endpoint que aceite lista, grade com valor editável por linha, ou
  uma regra a decidir.
- **G** = falta o fluxo inteiro.

**O que o recon mostra:**

1. **O padrão "digite os códigos separados por vírgula" é o gap mais barato e o mais repetido.** Ele aparece em seis lugares; em
   quatro a API **já aceita a lista** e falta só o seletor na tela.

   | tela | arquivo:linha | a API aceita a lista? |
   |---|---|---|
   | Relatório de compras | `W:rel-compras/RelComprasPage.tsx:166` | sim |
   | DRE | `W:dre/DreRelatorio.tsx:105` | sim |
   | Relatório do rotativo | `W:inventario-rotativo/RelatorioRotativo.tsx:156` | não verificado |
   | Limite de venda (IDs internos) | `W:agenda-limitacao/AgendaLimitacaoPage.tsx:165` | sim |
   | Análise de comportamento (um código) | `W:analise-comportamento/AnaliseComportamentoPage.tsx:126` | sim |
   | Lote do rotativo (o campo nem existe) | `W:inventario-rotativo/InventarioRotativoPage.tsx:150-157` | sim |

   O hub de vendas (73.505 acessos) não tem filtro de família, embora a API aceite `departamentos[]`, `grupos[]`, `secoes[]` e
   `subgrupos[]` (`packages/shared/src/schema/rel-vendas.schema.ts:27-30`).
2. **Os 21 cobertos não usam a Pesquisa: cada tela tem SQL próprio, com colunas fixas e LIMIT.** Os limites são 2.000 nas baixas,
   1.000 no CNAB, 5.000 na liberação e 500 no agrupamento. Funciona, mas sem campo × operação, F4, cores e totalizador. Trocar pela
   Pesquisa ali é fidelidade, não função nova (§2, corte 6).
3. **Um "coberto" tem defeito de alcance: a baixa de cartões.** A lista vem do CRUD genérico sem parâmetro, cortado em 200 linhas
   sem ordem (`apps/api/src/shared/crud/crud-engine.service.ts:99`). Os cartões além desses 200 não podem ser baixados por ali.
   Tem 7.786 acessos. Há cortes silenciosos do mesmo tipo em 500 linhas em dois lugares:
   - a pesquisa da Etiqueta (`A:cadastro/etiqueta.service.ts:338-343`);
   - a Atualização automática (`W:mult-atualizacao/MultAtualizacaoPage.tsx:39`).
4. **Duas grades de inclusão de alto uso precisam de mais que o seletor.** São a agenda de promoção (31.198 acessos) e a gestão de
   promoções. O legado põe as marcadas com valor 0 e o operador preenche na grade. No Apollo o "Adicionar" exige o valor antes e a
   grade é só leitura.
5. **Três vereditos da FILA não se sustentam** (ver §3; não alterei a FILA).

---

## 1. Tabela completa (113 chamadas vivas)

**Legenda:** ✅ coberto · 🔧 gap real · 🪦 gap marginal · ⏭️ não se aplica · ⛔ tela não convertida.

O número entre parênteses é o de acessos no MENUEXPRESS. Uma subtela aberta por outra tela (sem linha própria no menu) indica a
tela de origem.

Na coluna "view no destino / recurso":
- `mig NNN` é a migration que cria a view no PG (`create or replace view`). O `rel_` é a versão integral do construtor.
- `—` quer dizer que a view não existe no destino (grep em `apps/api/migrations`).
- O recurso é a chave de `TELAS_DA_PESQUISA` em `apps/api/src/shared/pesquisa/telas.ts`.

### 1.1 Financeiro (21)

| # | unit:linha | view · filtro obrigatório | o que faz com as marcadas | tela legado (acessos) | tela Apollo | como escolhe vários hoje | veredito | tam. | view no destino / recurso |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `UBaixaApagar.pas:304` | GET_APAGAR · `CODIGO_EMPRESA in (lojas)`; cores bloqueio / fornecedor com débito | viram os títulos do lote de baixa (`:327-370`) | Baixa a pagar FRMBAIXAAPAGAR (9.530) | `/cobranca/baixa-apagar` — `W:baixa-apagar/BaixaApagarPage.tsx:100-122` | grade própria com CheckboxField (`:247`) + "Adicionar marcados" (`:230`) | ✅ — a lista é SQL próprio de 7 colunas, LIMIT 2000 (`A:cobranca/baixa-apagar-lote.service.ts:83-110`) | — | get_apagar 045, rel_get_apagar 389 / `cadastro/apagar` |
| 2 | `UBaixaApagar.pas:920` | GET_APAGAR · `CODIGO NOT IN (grade)` (sem lojas) | acrescenta à baixa em curso; recusa com recurso lançado (`:896-897`) | idem | idem `:115-122` | o mesmo "Adicionar marcados" tira os já na grade (`:118-119`) e recusa com recurso (`:117`) | ✅ — o Apollo mantém o filtro de lojas que o legado tira aqui | — | idem |
| 3 | `UlancChequesBXapg.pas:123` | GET_CHEQUE · `[CONSILIADO='S']` | cheques de terceiros repassados no pagamento (`:131-143`) | FRMLANCACHEQUESBXAPG (aberta por FRMBAIXAAPAGAR `UBaixaApagar.pas:1328/1361` e FRMAPAGAR `uAPagar.pas:1619`) | não convertida — recurso fora do combo (`A:cobranca/baixa-apagar-lote.service.ts:18-29`) | não dá | ⛔ por decisão documentada: `uBaixaApagar-spec.md` §5 corte C "não converter" (CHEQUE_REP 0 linhas na história) | — | get_cheque 396 / — |
| 4 | `UBaixaAreceber.pas:901` | GET_RCB · lojas, não agrupado, `QUITADA='N'` [CONSILIADO] — só com `BAIXA_RCB_POR_CLIENTE<>'S'` | títulos da baixa, em lotes de 999 (`:906-944`), com o desconto padrão do cliente (`:947-958`) | Baixa a receber FRMBAIXAARECEBER (3.233) | `/cobranca/baixa-receber` — `W:baixa-receber/BaixaReceberPage.tsx:96-108` | CheckboxField (`:295`) + "Adicionar marcados" (`:279`); desconto no servidor (`A:cobranca/baixa-receber-lote.service.ts:81-102`) | ✅ | — | get_rcb 399 / `cadastro/areceber` |
| 5 | `UBaixaAreceber.pas:1937` | GET_RCB · `CODIGO NOT IN (grade)` [AND cliente] | acrescenta à baixa (`:1942-1968`) | idem | idem `:132-136` | mesmo "Adicionar marcados" (`:134-135`); recusa com recurso (`:133`) | ✅ — o modo por cliente não foi reproduzido (só o usuário 1 usa: `uBaixaAreceber-spec.md:322`) | — | idem |
| 6 | `UCadLoteCobranca.pas:99` | GET_ARECEBER · loja [CONSILIADO] | itens do lote, sem repetir (`:102-129`) | Lote de cobrança FRMCADLOTECOBRANCA (20) | `/cobranca/lotes` — `W:lotes-md/AddTitulosModal.tsx:78-85` | DataTable do DS com `selectionConfig` (`:82`); tira repetidos (`:59-64`) | ✅ — divergência: `consiliado='S'` fixo (`:33`); LOTE_COBRANCA tem 0 linhas na produção | — | get_areceber 410 / — (`cadastro/areceber` é a GET_RCB) |
| 7 | `UbaixaCartao.pas:826` | GET_CARTAO · lojas [CONSILIADO], ordem DATA | documentos do lote de baixa (`:829-853`) | Baixa de cartões FRMBAIXACARTAO (7.786) | `/financeiro/cartoes` — `W:cartao/CartaoPage.tsx:82-97` | DataTable com seleção (`:144`) + "Baixar marcados" (`:139`); **mas** a lista é o CRUD sem parâmetro (`W:cartao/cartaoApi.ts:56`), cortado em 200 sem ordem, e o filtro LIBERADO roda no navegador (`:103`) | 🔧 **defeito**: os cartões fora desses 200 não podem ser baixados | M | get_cartao 117, rel_get_cartao 390 / — (falta recurso) |
| 8 | `UbaixaCheque.pas:168` | GET_CHEQUE · lojas [CONSILIADO]; soma VALOR; cores | cheques da baixa (`:191-239`) | FRMBAIXACHEQUE (80) | não convertida | — | ⛔ 🪦 FILA:70 (CHEQUE tem 11 linhas) | — | get_cheque 396 / — |
| 9 | `UchqCustodia.pas:126` | GET_CHEQUE · CUSTODIA N/nulo | cheques a pôr em custódia (`:138-157`) | FRMCHQCUSTODIA (2) | não convertida | — | ⛔ 🪦 FILA:222 | — | idem |
| 10 | `uAgrupaCartao.pas:135` | GET_CARTAOCOMPLETO · `RESUMO IS NULL`, lojas | cartões a agrupar | FRMAGRUPACARTAO (65) | não convertida | — | ⛔ FILA:77 (CARTAO.RESUMO nulo nas 2.059.893 linhas) | — | — / — |
| 11 | `uAgrupaContasAPagar.pas:260` | GET_APAGAR_AGRUPAR · não agrupado | títulos a agrupar | FRMAGRUPACONTASAPAGAR (472) | `/cobranca/agrupar-pagar` — `W:agrupamento/AgrupamentoPage.tsx:77-113` | CheckboxField (`:184`) + marcar todos por botão e tecla T (`:58`, `:155`, `:167`) | ✅ — busca limitada a 500 (`W:agrupamento/agrupamentoApi.ts:25-29`) | — | mig 397 / — |
| 12 | `uAgrupaContasAReceber.pas:417` | GET_RCB · não agrupado, `QUITADA='N'` [CONSILIADO]; cor da remessa | títulos a agrupar + total | FRMAGRUPACONTASARECEBER (456) | `/cobranca/agrupar-receber` — mesma página | mesma grade + total com juro (`:60-64`, `:206`) | ✅ | — | get_rcb 399 / `cadastro/areceber` |
| 13 | `uAddTituloAgrupamentoAReceber.pas:121` | GET_RCB · sem agrupamento, `QUITADA='N'` | títulos a somar a um agrupamento existente | FRMADDTITULOAGRUPAMENTOARECEBER (aberta por FRMCADARECEBER, 8.174, `uCadAReceber.pas:3834`) | `/cobranca/agrupar-receber`, "Consultar agrupamento → Incluir os marcados" (`AgrupamentoPage.tsx:142-150`, `:243`) | a mesma grade (`:184`) | ✅ — com entrada em outra tela: o cadastro de A receber não tem o "Adicionar título" | — | idem |
| 14 | `uConfBoleto.pas:1896` | GET_ARECEBER · lojas, `ATIVADO='S'` [CODBCO]; cores da remessa | títulos dos boletos/remessa (`:1919-1943`) | Impressão de boletos FRMCONFBOLETO (4.873) | `/cobranca/cnab` — `W:cnab/CnabRemessaPage.tsx:49-59` | checkbox por título (`:208`), contador e total (`:190`) | ✅ — divergências: só a loja do login, sem ATIVADO/CODBCO, LIMIT 1000 (`A:cobranca/cnab-remessa.service.ts:265`, `:272`) | — | get_areceber 410 / — |
| 15 | `uControleContasBancarias.pas:213` | GET_MOV_CONTAS_BANCARIAS · não liberado, da conta | pede a data e libera cada movimento (`:217-268`) | Controle contas correntes FRMCONTROLECONTASBANCARIAS (7.653) | `/financeiro/contas-correntes` — `W:controle-contas/ControleContasPage.tsx:216-241` | CheckboxField por movimento (`:227-228`), data (`:239`), Liberar (`:241`) | ✅ — LIMIT 5000 | — | mig 396 / — |
| 16 | `Utransferencia.pas:386` | GET_ARECEBER · `CONTA_TRANSFERENCIA` = conta ou nula | documentos transferidos; soma o VALOR (`:409-420`) | FRMTRANSFERENCIA (aberta por FRMCONTROLECONTASBANCARIAS `:143` e `Ucxaberto.pas:584`) | transferência só por valor: `ControleContasPage.tsx:95-102` → `A:cadastro/controle-contas.service.ts:371` | não escolhe documentos | 🪦 marginal: ARECEBER com LOTETRANSF = **6** títulos, sem data; e no fonte o ramo RCB grava em `'ARECEBEER'` (sic, `Utransferencia.pas:205`) | — | get_areceber 410 / — |
| 17 | `Utransferencia.pas:400` | GET_CHEQUE · idem | idem | idem | idem | idem | 🪦 marginal: CHEQUE com LOTETRANSF = **0** | — | get_cheque 396 / — |
| 18 | `uGerarFinanceiroLote.pas:182` | GET_PARCEIROS · `CLI='S'`, ativo | 1 título a receber por cliente (`:192-232`) | FRMGERARFINANCEIROLOTE (8) | `/cobranca/gerar-financeiro-lote` — `W:gerar-financeiro-lote/GerarFinanceiroLotePage.tsx:44-63` | checkbox por cliente (`:95`), marcar todos (`:90`), já vêm marcados (`:47`) | ✅ | — | 017, rel 390 / `lookup/parceiros` |
| 19 | `ufrmProcessaAPagar.pas:1244` | GET_APAGAR; cores | títulos da remessa de pagamento | FRMPROCESSAAPAGAR (23) | não convertida | — | ⛔ 🪦 FILA:112 (abandonada em 2021) | — | `cadastro/apagar` |
| 20 | `uMovAReceber.pas:262` | GET_NF_NAOVINCULADARECEBER · parceiro, processada | vincula NFs ao título | FRMMOVARECEBER (no Menu.XML de 2020, sem linha no MENUEXPRESS) | não convertida | — | ⛔ NFARECEBER vazia (`views-de-relatorio.md:112`) | — | — / — |
| 21 | `UManipulaFin.pas:508` | GET_CHEQUE · ainda não sangrado | cheques da sangria em cheque (`:511-535`) | FRMMANIPULAFIN, aberta pela finalização do fechamento de caixa (`UConsDocs.pas:2062`; FRMFECHAMENTOCAIXA 64.801) | `/cobranca/fechamento-caixa`: sangria só em dinheiro e suprimento (`A:cobranca/fechamento-caixa.service.ts:693-707`) | — | ⏭️ ramo morto no legado: `UConsDocs.pas:916-917` desliga a inserção na sangria em cheque | — | — |

### 1.2 NF, compras, estoque e logística (44)

| # | unit:linha | view · filtro obrigatório | o que faz com as marcadas | tela legado (acessos) | tela Apollo | como escolhe vários hoje | veredito | tam. | view no destino / recurso |
|---|---|---|---|---|---|---|---|---|---|
| 22 | `uNF.pas:1352` | GET_PEDIDO (tipo 0: não cancelado, `TIPO='P'`, sem cupom) / GET_PEDIDOS (tipo 7: `TIPO='T'` da loja); cores | importa os itens de **todos** os pedidos marcados (`:1513+`); reimportação pede liberação (`:1473-1508`) | NF FRMNF (55.896) | NF de saída: sem o botão (`W:nf/NfCadMaster.tsx:1694-1704`); aba Pedidos desabilitada (`:258`) | não dá | 🪦 marginal: PEDIDO_NF 'P' = 1 (2022), 'T' = 3 (até 12/2023) | — | — / — |
| 23 | `uNF.pas:1804` | GET_TROCA · itens em aberto na loja [fornecedor da nota]; F10 itens | itens das trocas marcadas; um só fornecedor; CFOP 5949/6949 (`:1825-1878`) | FRMNF | sem a ação | não dá | 🪦 marginal: 4 NFs com troca em 2025, 0 em 2026 | — | get_troca 118, rel 393 / — |
| 24 | `uNF.pas:1904` | GET_SCRAP · loja; cores | itens dos SCRAPs marcados; reimportação com liberação (`:1960-2010`) | FRMNF | "Importar SCRAP" — `W:nf/NfScrapModal.tsx`; `A:cadastro/nf-scrap.controller.ts:17,23,30` | CheckboxField por scrap (`NfScrapModal.tsx:99`) + liberação por login | ✅ | — | 116, rel 390 / — |
| 25 | `uNF.pas:2095` | GET_PEDIDOPRODUCAO · expedição fechada, finalizado | todos os pedidos de produção (`:2219-2255`) | FRMNF | sem a ação | — | 🪦 sem substrato: PEDIDOSPRODUCAO 0 linhas (FILA:234) | — | — / — |
| 26 | `uNF.pas:5910` | GET_DEVOLUCAO_VENDAS · loja; cores | NF de entrada com as devoluções marcadas | FRMNF | "Importar devolução de vendas" — `W:nf/NfDevolucaoVendasModal.tsx`; `A:cadastro/nf-devolucao-vendas.controller.ts:20,27,34` | pesquisa por período/cupom + CheckboxField (`:88`) | ✅ | — | mig 398 / — |
| 27 | `uNF.pas:12758` | GET_INVENTARIO_ROTATIVO · loja; F10 itens; abre em LOTE=0 | NF de perdas com os itens de cada lote; pula lote já importado | FRMNF | "Importar inventário rotativo" — `W:nf/NfRotativoModal.tsx`; `A:cadastro/inventario-rotativo.controller.ts:95,103` | lotes fechados com CheckboxField (`:141`); os recusados voltam em `lotes_recusados` | ✅ | — | mig 396 / — |
| 28 | `uNF.pas:12912` | idem (sobras) | NF de sobras | FRMNF | idem (lado sobras) | idem | ✅ | — | idem |
| 29 | `uNF.pas:13288` | GET_VENDAS · não cancelado, loja; cor | NF que referencia os cupons marcados (confere NFC-e processada) | FRMNF | "Importar vendas" — `W:nf/NfVendasModal.tsx`; `A:cadastro/nf-vendas.controller.ts:20,27,34` | período + CheckboxField (`:91`); senha ADM para reimportar | ✅ | — | mig 392 / — |
| 30 | `uPedidoCompra.pas:1551` | GET_PEDIDOCOMPRA_SEM_EMPRESA · `LOTE_PROCESSADO` N | lote de preço (LOTEPRECO) de cada pedido marcado (`:1570-1640`) | Pedido de compra FRMPEDIDOCOMPRA (30.122) | sem tela; a API gera um pedido por vez e ninguém a chama (`A:compras/pedido-compra.controller.ts:122`) | não dá | 🪦 marginal: último lote em 06/02/2024 | — | — / — |
| 31 | `uPedidoCompra.pas:3077` | GET_PRODUTOS_ESTOQUE · `QTDE<=MINIMO` (loja ou depósito, config `SELECIONA_ESTOQUE_PARA_QTDE_MINIMA`), ativo compra, não filho | itens do pedido (menu "Qtde mínima") | FRMPEDIDOCOMPRA | ação ausente; em lote só "Importar do fornecedor" e "Importar já comprados" (`W:pedido-compra/PedidoCompraCadMaster.tsx:605-606`) | não dá | 🔧 (o uso da ação não é mensurável: o item entra como qualquer outro) | M | mig 391 / — (falta recurso) |
| 32 | `uPedidoCompra.pas:4392` | GET_PRODUTOS_ESTOQUE · loja, não filho | grade de bonificação | FRMPEDIDOCOMPRA | só "Gerar pedido bonificado", que copia **todos** os itens (`:962`) | não dá | 🪦 sem uso desde 2023 (BONIFICACAO 28 linhas; `tools/cutover/conferir-tabelas-fora.py:133-134`) | — | mig 391 / — |
| 33 | `uPedidoCompra.pas:4449` | GET_PRODUTOS_PC · ativo compra (ou `_MP`), UF, loja, não filho; F9-F11 | itens do pedido, com a última tabela do fornecedor (`:4492-4512`) | FRMPEDIDOCOMPRA | "Adicionar item"/F7 — `W:pedido-compra/PedidoCompraItemModal.tsx:158-166` (herança `:81`); append em `PedidoCompraCadMaster.tsx:484` | um LookupField por vez | 🔧 | M — N heranças e precificações + append; `lookup/produtos` só aproxima a GET_PRODUTOS_PC (faltam UF e ATIVO_COMPRA_MP) | mig 397 / `lookup/produtos` |
| 34 | `uPedidoCompra.pas:6546` | GET_PEDIDOCOMPRA · não fechado, loja | "baixa" os marcados: `PEDIDO_COMPRA_QTDE.FECHADO='S'` (`:6558-6570`) | FRMPEDIDOCOMPRA | "Fechar pedido", um por vez (`PedidoCompraCadMaster.tsx:948` → `A:compras/pedido-compra.controller.ts:87`) | um por vez | 🔧 — **regra a decidir**: o lote passa pelas travas do fechar (limite e meta, service `:71-86`) que o UPDATE cru do legado não tem? | M | 303, rel 390 / `compras/pedidos` (a opção "abertos" difere: FORNECEDOR_ATIVO e lojas) |
| 35 | `uCadPedidoDevolucaoCompras.pas:576` | GET_NF_PROD · entrada, `TIPO_EMISSAO='T'`, loja; cores | itens da devolução por produto (máx. 990) | Devolução de compras FRMCADPEDIDODEVOLUCAOCOMPRAS (2.529) | `/compras/devolucao`, "Carregar itens" — `W:devolucao-compra/DevolucaoCompraCadMaster.tsx:158-161`, `:179`; `A:compras/devolucao-compra.controller.ts:17` | automático: todos os itens com saldo do fornecedor; qtde digitada por linha (`:189`) | ✅ parcial (não filtra por produto) | — | — / — |
| 36 | `uCadPedidoDevolucaoCompras.pas:778` | GET_NF · entrada, `TIPO_EMISSAO='T'`, loja | itens de todas as NFs marcadas (máx. 990) | idem | idem | idem: todas as NFs do fornecedor vêm juntas | ✅ parcial (não escolhe as NFs; a API aceita `?codnf` e a tela não usa) | — | 025, rel 389 / `fiscal/nf` |
| 37 | `uImportaTrocaForDevolucao.pas:194` | GET_TROCA · fornecedor, `STATUS='ABERTA'`, loja | itens das trocas marcadas | FRMIMPORTATROCAFORDEVOLUCAO (aberta pela devolução, `:638`) | ação ausente | — | 🪦 marginal: 21 de 3.809 itens com COD_TROCA (`uCadPedidoDevolucaoCompras.md:45`) | — | 118, rel 393 / — |
| 38 | `uCadCotacao.pas:317` | GET_PARCEIROS · `ATIVADO<>'N'` | participantes da cotação | Cotação FRMCADCOTACAO (363) | `/compras/cotacao` — `W:cotacao/CotacaoPage.tsx:323-325` | LookupField + "Convidar fornecedor", um por vez; só na criação | 🔧 | P | `lookup/parceiros` |
| 39 | `uCadCotacao.pas:873` | GET_PRODUTOS · ativo compra; F9-F11 | itens da cotação | idem | `CotacaoPage.tsx:317-320` | LookupField + "Adicionar produto", um por vez | 🔧 | P | `lookup/produtos` |
| 40 | `uCadCotacao.pas:2437` | GET_PRODUTOS_ESTOQUE · `QTDE<=MINIMO` | itens (menu "Importar estoque mínimo") | idem | ação ausente | — | 🔧 (uso não mensurável) | M | mig 391 / — |
| 41 | `uCotacaoListaFornecendores.pas:98` | GET_PARCEIROS · FRN | ocupa as colunas FORNn da lista | FRMCOTACAOLISTAFORN (7) | não convertida | — | ⛔ 🪦 FILA:171 (COTACAO_LISTAF tem 1 linha) | — | `lookup/parceiros` |
| 42 | `uCotacaoListaFornecendores.pas:156` | GET_PRODUTOS · ativo compra | itens da lista | idem | idem | — | ⛔ | — | `lookup/produtos` |
| 43 | `UManifestoDFe.pas:676` | GET_NF_MANIFESTO · loja, com chave; cores | as marcadas **substituem** a grade de notas | Manifesto DF-e FRMMANIFESTODFE (71.687) | `/compras/manifesto-dfe` — `W:manifesto-dfe/ManifestoDfePage.tsx:245-257`; `A:compras/manifesto-dfe.controller.ts:49` | filtro fixo que substitui a grade; checkbox para manifestar (`:313`) | ✅ — não monta a grade com notas escolhidas a dedo | — | mig 400 / — |
| 44 | `UFrmLoteConferenciaNF.pas:98` | GET_NF · entrada não processada do(s) fornecedor(es), loja, fora de lote | notas do lote de conferência | FRMLOTECONFERENCIANF (aberta por FRMCONFERENCIANOTA, 5.695, `uConferenciaNota.pas:528/609`) | não convertida: a conferência abre uma NF por código (`W:conferencia-nota/ConferenciaNotaPage.tsx:163-164`) | — | ⛔ morta: 4 lotes e 6 vínculos, nada depois de 2022 (`uNF-impressoes.md:76`) | — | `fiscal/nf` |
| 45 | `UFrmLoteConferenciaNF.pas:126` | PARCEIROS · FRN | vários fornecedores ("VÁRIOS") | idem | idem | — | ⛔ | — | `lookup/parceiros` |
| 46 | `uExportaNFe.pas:234` | GET_NF · lojas, modelo 55, emitida, com chave; cores | até 999 notas na grade de manutenção | Manutenção de NF-e FRMEXPORTANFE (15) | `/fiscal/nf-exportacao` — `W:exporta-nfe/ExportaNfePage.tsx:46-50`, `:64` | automático por filtro; XML um por linha | 🔧 marcar várias e baixar os XMLs | M | 025, rel 389 / `fiscal/nf` (sem filtro de modelo e status) |
| 47 | `uCadCte.pas:2241` | GET_NF · saída processada | só a linha corrente vira documento (`:2251-2273`) | FRMCADCTE (5) | não convertida | — | ⛔ FILA:184 (CTE 0 linhas); e a multisseleção é inócua no legado | — | `fiscal/nf` |
| 48 | `UsaidaDep.pas:260` | GET_ESTOQUE_DEP / GET_ESTOQUE · origem [ativo] | InserirProduto para cada | FRMSAIDADEP (104) | não convertida | — | ⛔ FILA:61 (SAIDADEP 16 linhas, a última de 04/02/2021) | — | 396 / 390 / — |
| 49 | `uPedidoTransferencia.pas:344` | GET_PRODUTOS · custo > 0, sem pai; F8/F10 | AdicionarProduto para cada | FRMPEDIDOTRANSFERENCIA (32) | não convertida | — | ⛔ 🪦 FILA:102 | — | `lookup/produtos` |
| 50 | `uTrocaMercadoriaFor.pas:199` | GET_PRODUTOS · realiza troca, custo > 0 [fornecedor] | só a linha corrente vira o código digitado (`:203-209`) | Troca FRMTROCAMERCADORIAFOR (121) | `/estoque/troca` — `W:troca/TrocaPage.tsx:134-136` | NumberField "Produto (id)" | ⏭️ inócua; falta um seletor de **um** produto, não multisseleção | — | `lookup/produtos` (parcial) |
| 51 | `uCadDevolucao.pas:164` | GET_PRODUTOS | itens | FRMCADDEVOLUCAO (93) | não convertida | — | ⛔ 🪦 FILA:25 (DEVOLUCAO 1 linha) | — | `lookup/produtos` |
| 52 | `uInventario.pas:646` | GET_BALANCO · loja | só a linha corrente (`:650`) | Inventário FRMINVENTARIO (64) | `/estoque/inventario` — `W:inventario/InventarioPage.tsx:312-313`, `:324` | SelectField de balanços | ⏭️ inócua | — | mig 166 / — |
| 53 | `uInventario.pas:2073` | GET_PRODUTOS_ATUALIZACAO · loja | **apaga** o inventário em tela e o recria com os marcados (menu "Restituição de tributação") | FRMINVENTARIO | ação ausente; `uInventario-balanco.md:23`, `:244` deixa "fora do escopo" | — | 🔧 uso NÃO PROVADO (o efeito não deixa carimbo de origem) | G | mig 397 / — |
| 54 | `uCadBalanco.pas:71` | GET_PRODUTOS_ESTOQUE_UPDATE · loja | itens do balanço | FRMCADBALANCO (15) | não convertida como tela (o balanço nasce da contagem no inventário) | — | ⛔ 🪦 FILA:26 | — | — / — |
| 55 | `uRelatorioInventarioRotativo.pas:1179` | GET_PRODUTOS | filtro `I.IDPRODUTO IN` | Inventários FRMRELINVENTARIOROTATIVO (141) | `/estoque/inventario-rotativo` — `W:inventario-rotativo/RelatorioRotativo.tsx:156` (lido em `:71`) | digitação de códigos | 🔧 | P | `lookup/produtos` |
| 56 | `UFrmLoteInventarioRotativo.pas:83` | GET_FAMILIAS_PROD · `TIPO='DEPARTAMENTO'` | departamentos do lote | FRMLOTEINVENTARIOROTATIVO (aberta pelo FRMRELINVENTARIOROTATIVO, `:181`) | "Abrir lote" — `W:inventario-rotativo/InventarioRotativoPage.tsx:150-157` | não dá: só Grupo e Seção, embora a API já aceite `departamentos[]` (`A:cadastro/inventario-rotativo.service.ts:116-120`) | 🔧 (INVENTARIO_ROTATIVO_DPTO 22 linhas) | P | `lookup/familias` |
| 57 | `UCadMapaDeCarga.pas:2277` | GET_PEDIDO_DISTRIBUIDOR | itens do mapa | FRMCADMAPADECARGA (9) | não convertida | — | ⛔ FILA:158 (MAPA_DE_CARGA 0 linhas) | — | mig 397 / — |
| 58 | `UCadMapaDeCarga.pas:5940` | GET_PEDIDO_DO_MAPA | devolve pedidos do mapa | idem | idem | — | ⛔ | — | — / — |
| 59 | `UCadMapaCargaProducao.pas:598` | GET_PR_PEDIDO_DISTRIBUIDOR | itens do mapa de produção | FRMCADMAPACARGAPROD (1) | não convertida | — | ⛔ FILA:234 | — | — / — |
| 60 | `uConsMapaCarga.pas:117` | GET_PEDIDO · não cancelado | `UPDATE PEDIDOS SET NROMAPA` | FRMCONSMAPACARGA (aberta por `UMapaCarga.pas:129`; 0 acesso) | não convertida | — | ⛔ | — | — / — |
| 61 | `uResumoCargas.pas:169` | GET_PR_PEDIDO_DISTRIBUIDOR · rota, período | itens da carga | FRMRESUMOCARGAS (0) | não convertida | — | ⛔ view vazia (`views-de-relatorio.md:124`) | — | — / — |
| 62 | `uMapaDeEntregas.pas:153` | GET_CUPOM_LIBERADO_ENTREGA · últimos N dias | itens do mapa de entregas | FRMMAPADEENTREGAS (98) | não convertida | — | ⛔ FILA:64 | — | — / — |
| 63 | `uDigitacaoPedidosProducao.pas:792` | GET_PEDIDOPRODUCAO · período/rota/status | relatório dos pedidos marcados | FRMDIGITACAOPEDIDOSPRODUCAO (0) | não convertida | — | ⛔ view morta (`views-de-relatorio.md:120`) | — | — / — |
| 64 | `uLoteProducao.pas:389` | GET_PRODUTOS | matéria-prima/produto final do lote | FRMLOTEPRODUCAO (1) | não convertida | — | ⛔ FILA:232 | — | `lookup/produtos` |
| 65 | `uImprimeEtiqueta.pas:175` | GET_PRODUTOS | etiquetas de produção pesada | FRMIMPRIMEETIQUETA (2) | não convertida; coberta pelas Etiquetas | — | ⛔ 🟢 FILA:228 | — | `lookup/produtos` |

### 1.3 Produtos, preço, promoção e etiqueta (27)

| # | unit:linha | view · filtro obrigatório | o que faz com as marcadas | tela legado (acessos) | tela Apollo | como escolhe vários hoje | veredito | tam. | view no destino / recurso |
|---|---|---|---|---|---|---|---|---|---|
| 66 | `UCadProduto.pas:1797` | GET_PRODUTOS_ESTOQUE · estoque e depósito da loja; abre em DESCRICAO "começa com" | itens da receita (CarregaItensReceita) | Produtos FRMCADPRODUTO (38.638) | aba Receita, "Adicionar ingrediente" (`W:produtos/ProdutoCadMaster.tsx:1627`) → `ReceitaModal.tsx:49-57` | uma janela por item com LookupField (o comentário `:46-48` já anota a pendência) | 🔧 (RECEITA_PROD 86 linhas) | M — recurso GET_PRODUTOS_ESTOQUE + N linhas com a quantidade a completar | mig 391 / — (hoje usa `lookup/produtos`) |
| 67 | `UCadProduto.pas:1843` | GET_PARCEIROS · `FRN='S'`, ativo | fornecedores desassociados, sem repetir | idem | `ProdutoCadMaster.tsx:244-297` | LookupField + "Desassociar fornecedor", um por vez (`:276-279`) | 🔧 (PRODUTOS_FORN_DESASSOCIADOS 320 linhas) | P | `lookup/parceiros` |
| 68 | `UCadProduto.pas:1944` | GET_PRODUTOS_ESTOQUE · idem | itens da decomposição | idem | "Adicionar resultante" (`:1482`) → `DecomposicaoModal.tsx:46-54` | uma janela por item | 🔧 (DECOMPOSICAO 135) | M | mig 391 / — |
| 69 | `UCadProduto.pas:1977` | GET_PRODUTOS_ESTOQUE · + `ATIVO_VENDA='S'`, EMPRESA_PRECO | itens da composição (exige `EMPRESAS.CAMPOCOMPOSICAO`) | idem | "Adicionar componente" (`:1348`) → `ComposicaoModal.tsx:48-56` | uma janela por item, **sem** o filtro ATIVO_VENDA/EMPRESA_PRECO | 🔧 (COMPOSICAO 61) | M | mig 391 / — |
| 70 | `UCadPromocao.pas:927` | GET_PRODUTOS · ativo, `IMPRIMIRCOMP='N'` | itens com VALOR 0; o operador preenche na grade | Gestão de promoções FRMCADPROMOCAO (195) | `/cadastro/gestao-promocoes` — `W:promocao/PromocaoCadMaster.tsx:221-231`, `:533-540` | um produto por vez, com valor > 0 antes; a grade é só leitura (`:401-410`) | 🔧 | M — grade com valor editável | `lookup/produtos` |
| 71 | `UCadPromocao.pas:1062` | GET_PERFIL · ativo, `TIPO='PARCEIRO'` | perfis de cliente da promoção | idem | aba ausente (o campo está no schema, `promocao.schema.ts:48`, e no aggregate, `:151`) | não dá | 🪦 sem uso: 0 itens com CODPERFIL_PARCEIRO | — | 084, rel 393 / — |
| 72 | `uCadAgendaPromocao.pas:461` | GET_PRODUTOS (ou GET_PROD_COLETADO_AGENDA_PROMO) · ativo, `IMPRIMIRCOMP='N'` | itens da agenda (CarregarItens) | Agenda de promoção FRMCADAGENDAPROMOCAO (31.198) | `/cadastro/promocoes` — `W:agenda-promocao/AgendaPromocaoCadMaster.tsx:328-345` (adicionarItem `:119-133`) | um por vez, com o preço antes; a grade é só leitura (`:267-287`) | 🔧 (o ramo por validade não conta: LOTE_PRODUTO_VALIDADE_PROMO tem 0 linhas) | M | `lookup/produtos` |
| 73 | `uCadAgendaLimitacaoVenda.pas:107` | GET_PRODUTOS · ativo, `IMPRIMIRCOMP='N'`, sem os incluídos | itens com a qtde padrão + ApplyUpdates | Limite de venda FRMCADAGENDALIMITACAOVENDA (51) | `/cadastro/agenda-limitacao` — `W:agenda-limitacao/AgendaLimitacaoPage.tsx:76-87`, `:165` | digita IDPRODUTOs separados por espaço; o POST em lote já existe (`A:cadastro/agenda-limitacao.controller.ts:42-46`) | 🔧 | P | `lookup/produtos` |
| 74 | `Uetiqueta.pas:603` | GET_ETIQUETA_CONS_PROD · impressa N, loja, coletor; código auxiliar | grade de impressão | Etiquetas FRMETIQUETA (2.471.754) | `/estoque/etiquetas` — `W:etiqueta/EtiquetaPage.tsx:56-69`, `:216` | a fila do coletor entra inteira e se marca na grade (`:249`, `:263`) | ✅ | — | — / — |
| 75 | `Uetiqueta.pas:735` | GET_PRODUTOS · etiqueta impressa S/N/todos; cores azul/preto; código auxiliar | grade de impressão (qtde = QTDE_ETIQUETAS) | idem | "Pesquisar" por situação (`EtiquetaPage.tsx:124-133`, `:212-213`) | automático por filtro, tudo marcado; **corte silencioso em 500** (`A:cadastro/etiqueta.service.ts:338-343`) | 🔧 | P — a lista entra pelo `POST de-itens` ou pelo `importar`, que já aceitam lista (`A:cadastro/etiqueta.controller.ts:65-77`) | rel_get_produtos 390 (tem `etq_impressa`) / `lookup/produtos` |
| 76 | `Uetiqueta.pas:903` | GET_PARCEIROS; abre em RAZAO | etiquetas de parceiros | idem (FlagEtiqueta=1, aberta por `uCadClientes.pas:2328-2331`) | não existe | não dá | 🔧 uso NÃO PROVADO (1 modelo `etip%` ativo) | G | `lookup/parceiros` |
| 77 | `UPrecificacaoTabelaPreco.pas:187` | GET_PRODUTOS · ativo, ativo compra, loja, fora da tabela | itens PRECO_ITEM/PRECO_PARCEIRO | FRMPRECIFICACAOTABELAPRECO (2) | não convertida | — | ⛔ sem substrato: PRECO e PRECO_ITEM 0 linhas (ver §3) | — | — |
| 78 | `uPR_TabelaPrecoProd.pas:332` | GET_PARCEIROS | parceiros da tabela de preço de produção | FRMTABELAPRECOPROD (0) | não convertida | — | ⛔ sem substrato (tabelas `*_PRODUCAO` com 0 linhas) | — | — |
| 79 | `uPR_TabelaPrecoProd.pas:628` | GET_PARCEIROS (tecla +) | idem | idem | idem | — | ⛔ | — | — |
| 80 | `uPR_TabelaPrecoProd.pas:649` | GET_PRODUTOS (tecla +) | produtos da tabela | idem | idem | — | ⛔ | — | — |
| 81 | `uLancaPreco2.pas:88` | GET_LANCA_PRECO2 · ativo, loja | grade do preço 2 | FRMLANCAPRECO2 (3) | não convertida (o preço 2 só se edita produto a produto, `ProdutoCadMaster.tsx:2533`) | — | ⛔ 🪦 10 produtos com preço 2, fim mais recente em 30/11/2017 (ver §3) | — | — |
| 82 | `uLancaPreco2.pas:211` | GET_LANCA_PRECO2 · `VRDESCPRECO2<>0` | idem ("Lançados") | idem | idem | — | ⛔ | — | — |
| 83 | `uMultAtualizacao.pas:255` | GET_PRODUTOS_ATUALIZACAO · loja | a grade da atualização em massa **vira** as marcadas | Atualização automática FRMMULTATUALIZACAO (65) | `/cadastro/mult-atualizacao` — `W:mult-atualizacao/MultAtualizacaoPage.tsx:110-122` | filtro próprio + checkbox, todos marcados (`:43`, `:83`); corte em 500 (`:39`) | ✅ | — | mig 397 / — |
| 84 | `uMultAtualizacaoTabela.pas:126` | a view escolhida | idem, para qualquer tabela | FRMMULTATUALIZACAOTABELA (0) | não convertida | — | ⛔ sem acesso (`FILA-IMPRESSOES.md:69`) | — | — |
| 85 | `uAtualizacaoProdutos.pas:73` | GET_PRODUTOS_ESTOQUE_UPDATE · loja; código auxiliar | grade da atualização manual | FRMATUALIZACAOPRODUTOS (19) | não convertida | — | ⛔ 🪦 FILA:120 | — | — |
| 86 | `uCadTabelaFornecedores.pas:144` | GET_TABELA_FORNECEDORES_ITEM · loja | itens da tabela do fornecedor | FRMCADTABELAFORNECEDORES (5) | não convertida | — | ⛔ 🪦 FILA:188 | — | — |
| 87 | `UMovConcorrentes.pas:211` | GET_CONCORRENCIA | concorrentes | FRMMOVCONCORRENTES (72) | não convertida | — | ⛔ 🪦 FILA:72 (CONCORRENCIA 20 linhas) | — | — |
| 88 | `uCadAnaliseConcorrentes.pas:195` | GET_PRODUTOS · ativo; F9-F11 | itens da análise | FRMCADANALISECONCORRENTES (36) | não convertida | — | ⛔ 🪦 FILA:97 | — | `lookup/produtos` |
| 89 | `uPrecificacaoCargaPDV.pas:84` | GET_PRODUTOS | grade da carga do PDV | FRMPRECIFICACAOCARGAPDV (0) | não convertida | — | ⛔ PDV (ADR-017); PRECIFICACAO_PDV nem existe na produção | — | — |
| 90 | `uMenuSuperior.pas:1276` | GET_PRODUTOS | REMESSA_SERVER `MULTI_PRECO` por produto × loja × terminal (`:1287-1300`) | menu principal do Retaguarda (item "Selecionados") | não convertida | — | ⛔ PDV (ADR-017; a mig 372 deixa a REMESSA_SERVER fora) | — | `lookup/produtos` |
| 91 | `uHIstoricoFGF.pas:226` | GET_PRODUTOS | filtro do histórico de alterações | FRMHISTORICOFGF (2) | não convertida | — | ⛔ FILA:220 | — | — |
| 92 | `uintegracao_fiscal.pas:140` | GET_PRODUTOS · ativo compra | produtos a enviar ao serviço fiscal | FRMINTEGRACAO_FISCAL (10) | não convertida | — | ⛔ FILA:153 | — | — |

### 1.4 Relatórios, fiscal e cadastros (21)

| # | unit:linha | view · filtro obrigatório | o que faz com as marcadas | tela legado (acessos) | tela Apollo | como escolhe vários hoje | veredito | tam. | view no destino / recurso |
|---|---|---|---|---|---|---|---|---|---|
| 93 | `URelVendas.pas:2473` | GET_FAMILIAS_PROD · `TIPO='DEPARTAMENTO'` (F3) | filtro "*SELECIONADOS" | Relatório de vendas FRMRELVENDAS (73.505) | hub `/relatorios/vendas`, filtro da variante 01 (`W:rel-vendas/RelVendasPage.tsx:65-68`) | não dá: nenhuma variante tem o campo; a API já aceita `departamentos[]` (`rel-vendas.schema.ts:27`) | 🔧 | P | `lookup/familias` (fixo `tipo`) |
| 94 | `URelVendas.pas:3152` | idem · GRUPO | idem | idem | idem | `grupos[]` (`:28`) | 🔧 | P | idem |
| 95 | `URelVendas.pas:3269` | idem · SEÇÃO | idem | idem | idem | `secoes[]` (`:30`) | 🔧 | P | idem |
| 96 | `URelVendas.pas:3309` | idem · SUBGRUPO | idem | idem | idem | `subgrupos[]` (`:29`) | 🔧 | P | idem |
| 97 | `URelVendas.pas:3426` | GET_PRODUTOS · lojas (até 1.000) | filtro de produtos | idem | `RelVendasPage.tsx:111` "Produto (descrição) contém…" | só texto | 🔧 — o schema não tem `produtos` (o serviço já filtra por lista: `rel-vendas.service.ts:148`) | M | `lookup/produtos` |
| 98 | `URelCompras.pas:113` | GET_CFOP · `TIPO='E'` | filtro "VÁRIOS" | Relatórios de compras FRMRELCOMPRAS (206) | `/relatorios/compras` — `W:rel-compras/RelComprasPage.tsx:166` | "CFOPs (vírgula)"; a API aceita lista (`integracao-contabil.schema.ts:371`; `rel-compras.service.ts:119`) | 🔧 | P | `lookup/cfops` |
| 99 | `UNFAnalise.pas:200` | GET_CFOP (com "Múltiplos CFOPs") | filtro IN (modelo "Por CST") | Análise de notas FRMNFANALISE (728) | `/fiscal/nf-analise` — `W:nf-analise/NfAnalisePage.tsx:181` | um CFOP digitado; a API só compara por igualdade (`nf-analise.service.ts:173`) | 🔧 | M | `lookup/cfops` |
| 100 | `UFrmRelDREContabil.pas:498` | GET_PLANO_CONTAS | contas do DRE | DRE FRMRELDRECONTABIL (335) | `/contabil/dre` — `W:dre/DreRelatorio.tsx:105` | códigos com vírgula; a API aceita `planos`, até 1.000 (`dre-relatorio.service.ts:74`) | 🔧 | P | `lookup/plano-contas` |
| 101 | `Uspedfiscal.pas:209` | GET_FAMILIAS_PROD · DEPARTAMENTO, ativo | K200 por departamento (InsereK200Depto) | Gerador SPED fiscal FRMSPEDFISCAL (909) | só a API: `POST fiscal/sped/efd-icms-ipi` (`A:sped/sped.controller.ts:46-50`), sem tela web; o bloco K sai vazio (`sped-efd-icms-ipi.service.ts:227-230`) | não dá | 🔧 depende do bloco K | G | `lookup/familias` |
| 102 | `uApuracaoCIAP.pas:109` | GET_ATIVOIMOBILIZADO | bens da apuração CIAP | FRMAPURACAOCIAP (10) | não convertida | — | ⛔ FILA:161 | — | — / — |
| 103 | `uAnaliseComportamento.pas:91` | GET_PLC | centros de custo de impostos | Análise comportamento FRMANALISECOMPORTAMENTO (53) | `/relatorios/analise-comportamento` — `W:analise-comportamento/AnaliseComportamentoPage.tsx:126`, `:83` | um código por vez; a API aceita `codplcs[]` até 200 (`analise-comportamento.schema.ts:24`) | 🔧 (o rótulo "Conta do plano" está errado: é centro de custo) | P | `lookup/plc` |
| 104 | `uRelCurvaABCFornecedor.pas:121` | GET_CFOP · fora dos padrões 1102/2102/1403/2403 | CFOPs da curva ABC de **compras** por fornecedor (NF de entrada, `:384-416`) | FRMRELCURVAABCFORNECEDOR (11) | não convertida: a curva ABC do Apollo é de vendas (`rel-curva-abc.service.ts`) | — | ⛔ contesta o "🟢 coberto" da FILA:155 (ver §3) | — | `lookup/cfops` |
| 105 | `uRelatorioIndustria.pas:117` | GET_PRODUTOS | filtro opcional | FRMRELATORIOINDUSTRIA (1) | não convertida | — | ⛔ FILA:239 | — | — |
| 106 | `uCadClientes.pas:997` | GET_PARCEIROS · `FUN='S'` | vendedores do cliente, sem repetir | Parceiros FRMCADCLIENTES (18.744) | aba vendedores — `W:parceiros/ParceirosDetalhes.tsx:465-470` | modal com LookupField, um por vez, sem checar repetido | 🪦 marginal: PARCEIROS_VENDEDORES tem 1 linha | — | `lookup/parceiros` |
| 107 | `uCadClientes.pas:4181` | GET_FORMAS_PGTO | formas de pagamento do parceiro (PARCEIROS_PGTO) | idem | PgtosSection — `ParceirosDetalhes.tsx:160`, `:235-237` | um por vez, IDPGTO digitado e modalidade em texto livre ("TODO F3", `:158`) | 🔧 (PARCEIROS_PGTO 307 linhas) | P | `cadastro/formas-pgto` (não há `lookup/`) |
| 108 | `uCadFormaPgto.pas:168` | GET_CONDICOES_PAGTO | condições da forma | Formas de pagamento FRMCADFORMAPGTO (242) | `/cadastro/formas-pgto`; o vínculo foi adiado (`FormasPgtoCadMaster.tsx:14`) | não dá | 🪦 sem substrato: REL_FORMA_PAGAMENTO_CONDICAO 0 linhas | — | `compras/condicoes-pagto` |
| 109 | `uCadUsuarios.pas:174` | GET_EMPRESAS | empresas do operador | Operadores FRMCADUSUARIOS (1.815) | `/cadastro/operadores` — `W:operadores/OperadoresCadMaster.tsx:52-69` | uma linha por vez com SelectField | 🔧 (RELACAO_OPERADOR_EMPRESA 583 linhas) | P | `cadastro/empresas` |
| 110 | `uCadUsuarios.pas:281` | GET_OPERADORES · `TIPO_SIGLA='OPE'` | supervisionados (UPDATE do IDSUPERVISOR dos outros) | idem | só o caminho inverso: o supervisor do próprio operador (`:142-155`) | não dá | 🔧 ("corte-2", `operador.schema.ts:53`) | M | `lookup/operadores` |
| 111 | `uCadUsuarios.pas:815` | GET_PERFIL · ativo, acesso/compra (chamada de `:233` com multisseleção) | perfis do operador | idem | nada de perfil na tela; a API faz um por chamada (`perfil-relacao.controller.ts:19-30`) e nenhuma tela a usa | não dá | 🔧 (RELACAO_OPERADOR_PERFIL 62 linhas; a de compra, 0) | M | 084, rel 393 / — |
| 112 | `uCadPerfilOperador.pas:212` | GET_OPERADORES (multisseleção só no "Adicionar operador vinculado", `:163`) | operadores vinculados ao perfil | Perfil FRMCADPERFILOPERADOR (49) | `/cadastro/perfis` — `W:perfil/PerfilCadMaster.tsx:88` (só a contagem) | não dá | 🔧 | M | `lookup/operadores` |
| 113 | `uCadRegiao.pas:76` | GET_CIDADES | cidades da região | FRMCADREGIAO (1) | não convertida | — | ⛔ FILA:235 | — | `lookup/cidades` |

### 1.5 As 16 descartadas (para fechar a conta)

| unit:linha | motivo |
|---|---|
| `uCadProducao.pas:919`, `uDescontoTitulo.pas:392`, `uFrmApuracaoICMSST.pas:683`, `uReverterDescontoTitulo.pas:841` | `HabilitaMultiselecao := False` (seleção única explícita) |
| `Utesouraria.pas:647`, `:719`, `:788` | dentro do comentário `(* … *)` de `:581-833` (a tesouraria por pesquisa morreu no fonte) |
| `uGerarFinanceiroLote.pas:239` | dentro de `{ }` em `:234-241` |
| `uBaixasAPG.pas:236`, `:281` · `uBaixasCHQ.pas:132` · `uBaixasRCB.pas:413`, `:917` · `uTabelaPrecoProd.pas:636`, `:678` | units fora do `Retaguarda.dpr` |
| `uNFCe.pas:387` | FRMNFCE (Consulta NFC-e) = PDV, ADR-017 |

---

## 2. Proposta de ordem de aplicação

**Critério:** valor para o operador. Primeiro a tela mais usada, pelo `SUM(MENUEXPRESS.ACESSOS)` da consulta de 07/10/2026 (o mesmo
ranking de `FALTA-MIGRAR-POR-USO.md`; a subtela herda o acesso da tela que a abre). Depois o menor tamanho. O dado vivo decide o
empate: um gap sobre tabela morta vai para o fim.

| corte | o quê | chamadas (#) | acessos da tela | tam. | por quê |
|---|---|---|---|---|---|
| **0** | **Baixa de cartões**: a lista vira a Pesquisa sobre GET_CARTAO, com recurso novo em `telas.ts` (a `rel_get_cartao`, mig 390, já existe), lojas e ordem por DATA | 7 | 7.786 | M | é **defeito**, não comodidade: os cartões além dos 200 primeiros não podem ser baixados |
| **1** | **Etiquetas**: o "Pesquisar" vira Pesquisa com multisseleção em `lookup/produtos`, com o fixo da situação (`etq_impressa`) e as cores azul/preto; as marcadas entram pelo `POST de-itens` | 75 | 2.471.754 | P | a tela mais usada do sistema; acaba com o corte silencioso em 500 |
| **1** | **Hub de vendas, famílias**: um campo por nível (departamento, grupo, seção, subgrupo) com Pesquisa multisseleção em `lookup/familias` (fixo `tipo`) | 93-96 | 73.505 | P | a API já aceita as quatro listas; vale para todas as variantes que já as recebem |
| **1** | **Cadastro de produto, fornecedores desassociados** | 67 | 38.638 | P | `lookup/parceiros` com `frn`/`ativado`; N `append` sem repetir |
| **1** | **Parceiros, formas de pagamento** | 107 | 18.744 | P | troca o IDPGTO digitado e a modalidade em texto livre pela linha da view |
| **1** | **Operadores, empresas** | 109 | 1.815 | P | `cadastro/empresas`; N linhas na relação |
| **2** | **Agenda de promoção**: inclusão em lote com preço editável na grade | 72 | 31.198 | M | segunda tela mais usada da lista; pede grade editável, como o legado |
| **2** | **Pedido de compra, itens** (N heranças e precificações) | 33 | 30.122 | M | o F7 é o caminho principal de montar pedido |
| **2** | **Cadastro de produto, receita, decomposição e composição**: recurso GET_PRODUTOS_ESTOQUE e o filtro da composição | 66, 68, 69 | 38.638 | M | o modal já anota a pendência (`ReceitaModal.tsx:46-48`); dado vivo (86/135/61 linhas) |
| **2** | **Pedido de compra, "Baixar" em lote e "Qtde mínima"** | 34, 31 | 30.122 | M | no 34, primeiro decidir se o lote passa pelas travas do fechar |
| **2** | **Hub de vendas, produtos** (até 1.000): `produtos` no schema | 97 | 73.505 | M | o serviço já filtra por lista |
| **3** | **O mesmo campo em várias telas**: "códigos com vírgula" vira Pesquisa com multisseleção. Telas: cotação (participantes e produtos), DRE, relatório de compras, relatório e lote do rotativo, análise de comportamento, limite de venda | 38, 39, 100, 98, 55, 56, 103, 73 | 363 · 335 · 206 · 141 · 53 · 51 | P | um corte só, porque é o mesmo padrão; em todas a API já aceita a lista, menos a cotação, que acumula no cliente |
| **4** | **Gaps M de pouco uso**: | 110, 111, 99, 40, 70, 112, 46 | 1.815 · 728 · 363 · 195 · 49 · 15 | M | cada um pede schema, grade ou endpoint novo |
|  | operadores (supervisionados e perfis) | 110, 111 | 1.815 | | |
|  | análise de NF (múltiplos CFOPs, a API só compara por igualdade) | 99 | 728 | | |
|  | cotação (estoque mínimo) | 40 | 363 | | |
|  | gestão de promoções (grade editável) | 70 | 195 | | |
|  | perfil (operadores vinculados) | 112 | 49 | | |
|  | manutenção de NF-e (XMLs em lote) | 46 | 15 | | |
| **5** | **Fluxos inteiros**: SPED K200 por departamento (depende do bloco K), etiqueta de parceiros, restituição de tributação | 101, 76, 53 | 909 · — · 64 | G | dois deles com uso NÃO PROVADO |
| **6** (opcional) | **Fidelidade nos 21 cobertos**: trocar a grade de SQL próprio pela Pesquisa (campo × operação, F4, cores, totalizador) onde o LIMIT corta. Antes, corrigir duas divergências: o `consiliado='S'` fixo do lote de cobrança (#6) e a loja única do CNAB (#14) | ver §1 | — | M | não é função nova; é paridade de busca |

**Não aplicar agora (com prova):**
- 🪦 os 11 marginais: #16, 17, 22, 23, 25, 30, 32, 37, 71, 106, 108.
- ⏭️ os 3 inócuos: #21, 50, 52. No #50 falta um seletor de **um** produto, sem multisseleção.
- ⛔ as 43 em tela não convertida. Só 2 têm uso possível, e nenhuma pede multisseleção agora:
  - a curva ABC de compras por fornecedor (#104, 11 acessos);
  - a etiqueta de produção (#65, já coberta pelas Etiquetas).

---

## 3. Notas e achados laterais

- **Vereditos da FILA que não se sustentam** (registrados aqui; a FILA não foi alterada):
  - **FILA:155**, `FRMRELCURVAABCFORNECEDOR` "🟢 coberto". O legado soma o `TOTALNF` das notas de **entrada** (`N.TIPO='E'`,
    `N.CFOP IN (1102,2102,1403,2403 + escolhidos)`) por fornecedor (`uRelCurvaABCFornecedor.pas:62`, `:384-416`). A curva ABC do
    Apollo é de vendas. É uma curva de compras, que não existe.
  - **FILA:210**, `FRMLANCAPRECO2` "coberto, procedure UPDATEGRUPOPRECO não existe". Não é procedure: é a TFDQuery
    `QryUpdateGrupoPreco`, com `UPDATE PRODUTOS … WHERE CODGRUPOPRECO` (`uLancaPreco2.dfm:864-873`). A tela funciona. O veredito
    certo é 🪦: 10 produtos com `VRDESCPRECO2<>0`, e o maior `PRECO2DTFIM` é 30/11/2017.
  - **FILA:215**, `FRMPRECIFICACAOTABELAPRECO` "coberto, não existe TABELA_PRECO". A tela grava `PRECO_ITEM`/`PRECO_PARCEIRO`. O
    veredito certo é ⛔ sem substrato: `PRECO` e `PRECO_ITEM` têm 0 linhas na produção.
- **A conta das units.** O comentário de `Pesquisa.tsx` e o `uPesquisa.md` §6.1 falam em "73 units". A contagem fiel é outra:
  - 84 units têm a palavra;
  - 70 delas têm chamada viva;
  - mais 6 entram pelo método de classe (sem a palavra);
  - total: **76 units com 113 chamadas vivas**.
- **Recursos que faltam em `telas.ts` para os gaps reais:**
  - GET_PRODUTOS_ESTOQUE (#31, 40, 66, 68, 69), com view no destino (mig 391);
  - GET_CARTAO (#7), com `rel_get_cartao` (mig 390);
  - GET_PERFIL (#111), com `rel_get_perfil` (mig 393).

  Formas de pagamento e empresas não têm `lookup/`, mas os recursos `cadastro/formas-pgto` e `cadastro/empresas` servem. O resto
  dos P usa recursos que já existem: `lookup/produtos`, `lookup/parceiros`, `lookup/familias`, `lookup/cfops`,
  `lookup/plano-contas`, `lookup/plc`, `lookup/operadores`.
- **A marca da Pesquisa é pelo código**, não pela linha. Onde a view do legado multiplica linhas (pedido × loja, parceiro ×
  endereço), as linhas do mesmo código saem como uma só. Isso serve para os lotes desta lista. A tecla **T** marca até 1.000 linhas
  (`marcarDesmarcarTodos` em `Pesquisa.tsx`). Isso basta para os tetos do legado: 1.000 produtos no relatório de vendas, 990 na
  devolução de compras e 999 na manutenção de NF-e.
- **Método.** O `grep` desta máquina (ugrep) pula, sem avisar, as linhas de `.pas` e os arquivos que o `file` classifica como
  "data". Por isso o fonte Delphi foi lido com `grep -a` / `iconv -f latin1`, e o lado do Apollo foi conferido com
  `/usr/bin/grep -a`. Os comentários `{ }` e `(* *)` foram detectados por um analisador que respeita strings, não por grep de linha.
  Foi isso que achou os 4 pontos comentados.

---

## 4. Andamento

- **Corte 0 — baixa de cartões** ✅ (`d24e384`): Pesquisa `financeiro/cartao-baixa` em multisseleção → documentos do lote.
- **Corte 1 — Etiquetas** ✅: o "&Pesquisar" é a Pesquisa `estoque/etiquetas-produtos`, com as regras do legado:
  - a GET_PRODUTOS da loja, com o rádio da situação (`etq_impressa`) e o "somente ativos";
  - cores azul e preto, abertura em DESCRICAO / Em qualquer lugar, código auxiliar e multisseleção;
  - os marcados entram pelo `de-itens` (fonte `pesquisa`), marcados para imprimir, com a QTDE_ETIQUETAS e sem repetir o código de
    barras;
  - a exigência da opção `FRMETIQUETA · BTNADICIONARREGISTRO` passou para o recurso (`requer` em `telas.ts`).

  Saiu a rota `GET /cadastro/etiqueta/pesquisa`, que cortava em 500 em silêncio e ordenava pela data do preço. Smoke §298.25 e o check
  "ETIQUETA [pesquisa por situação]" migrado; jsdom `etiquetaPesquisa.spec.tsx`.
- **Corte 1 — Hub de vendas, famílias** ✅: `shared/pesquisa/FiltroFamilias` (departamento, grupo, seção e subgrupo).
  - F3 ou "…" abre a Pesquisa `lookup/familias` com o TIPO do nível, em multisseleção; o campo mostra o nome (se é um) ou
    "*SELECIONADOS", e outra tecla limpa (URelVendas.pas:2462-2492).
  - Entra nas 7 variantes cuja API já aplicava as listas: 01, 02, 06…, 07, 09…, os complementares e o 38.
  - O teto de cada lista subiu de 200 para 2.000: a produção tem 520 subgrupos.
  - Fica de fora o texto digitado no campo: no legado, um LIKE pelo nome com o operador escolhido; a API não tem esse filtro.
  - Smoke §298.26; jsdom `filtroFamilias.spec.tsx`.
- **Corte 1 — os 3 restantes** ✅ (só web). Em todos, o "Adicionar" do legado abre a Pesquisa em multisseleção:
  - **Fornecedores desassociados do produto:** `lookup/parceiros` com FRN = 'S' e ATIVADO = 'S'; o código entra uma vez só, mesmo que
    a view repita o parceiro por endereço (UCadProduto.pas:1830-1862).
  - **Formas de pagamento do parceiro:** `cadastro/formas-pgto`. Cada marcada entra com o IDPGTO e a MODALIDADE da view, **sem**
    conferir repetição, como o legado; na produção há 1 caso repetido (uCadClientes.pas:4181-4198).
  - **Empresas do operador:** `cadastro/empresas`, pela opção `pesquisa` nova do `CadMasterDet`; a empresa que já está não repete
    (uCadUsuarios.pas:168-189). A legenda é a do legado, "Adicionar", sem atalho: o Alt+A é o do rodapé.
- **Corte 2 — Agenda de promoção** ✅ (só web). O "&Adicionar" (o do legado, dica "Adicionar itens") é a Pesquisa `lookup/produtos`
  (ATIVO = 'S' e IMPRIMIRCOMP = 'N') em multisseleção:
  - cada marcado entra uma vez, com o VRVENDA e o preço promocional = VRVENDA − o % de desconto do cabeçalho (sem %, o VRPROMO) e o
    clube do produto (CarregarItens);
  - a grade passou a ser editável como o cxGrid do legado (duplo clique): Vr. Promocional, Vr. Fidelidade, Máx. e Mín. compra;
  - o produto avulso (o painel do F2) virou "Incluir produto";
  - a trava "promoção e clube iguais a zero" continua no gravar (o schema dos itens, uCadAgendaPromocao:651), e a de "produto em
    outra agenda" no servidor (PERMITE_PRODUTO_MAIS_UMA_AGENDA);
  - jsdom `agendaPromocaoLote.spec.tsx`.
- **Corte 2 — Pedido de compra, achados antes de implementar (08/10/2026):**
  - **Item com quantidade 0 é fluxo normal do legado:**
    - 10.677 dos 30.721 itens de pedido de 2026 (35%) estão gravados com quantidade total 0. O lote do legado põe cada produto com
      QTDE = 0 em cada loja (`CarregarItensComArray`, uPedidoCompra.pas:7383-7550) e o comprador preenche só alguns.
    - Há o menu "Excluir itens com Qtde zerada" (`retirarositenscomquantidade1Click`) e a IMPRIME_ZERADO_PC.
    - O schema do Apollo exige `qtde > 0` no item, regra que não vem do legado: alinhar antes do lote.
  - **O ValidaPerfilOperador** (o perfil de compra do departamento e do produto, que barra o lote inteiro) está **inerte com o dado
    atual**: 0 das 5.988.302 linhas da GET_PRODUTOS_PC têm COD_PERFIL_DEPARTAMENTO ou COD_PERFIL_PRODUTO. Fica registrado, não
    desligado: se o cliente passar a usar perfis, ele entra.
  - **A tabela do fornecedor no custo** (GetUltimaTabelaFornecedor) está desligada no cliente (`pedido-heranca.ts`).
  - **"Baixar" em lote (#34):** o legado faz um UPDATE cru, sem conferir nada (:6546-6570). Lá o limite diário/semanal de compra é
    conferido no GRAVAR; o Apollo o move para o FECHAR. Por isso o lote passa pelas travas do Fechar pedido, pedido a pedido; sem
    isso, o lote seria um atalho para fugir do limite.
- **Corte 2 — Pedido de compra, o lote de itens** ✅:
  - O F7 e o "Adicionar &item" abrem a Pesquisa `lookup/produtos-pc`, com os filtros e atalhos do legado:
    - a GET_PRODUTOS_PC com o ativo de compra pela ATIVO_PELA_MULTIPRECO, a UF da empresa, a loja e sem filho;
    - F9-F11; a opção BTNADICIONARI exigida.
  - Os marcados entram uma vez, com a herança do catálogo (`POST /compras/pedidos/heranca-lote`) e QTDE = 0 em cada loja.
  - No pedido de uma loja, a quantidade se digita na grade.
  - O item com QTDE = 0 passou a valer: o schema aceita, e o agregado e o duplicar não o trocam mais por 1 (sem quantidade, 1).
  - Smoke §298.27. Falta, do mesmo corte: o "Excluir itens com Qtde zerada" e o "Baixar" em lote (#34, pelas travas do fechar).
- **Corte 2 — Pedido de compra, "Baixar" em lote e "Excluir itens com Qtde zerada"** ✅:
  - **"&Baixar pedidos" (menu Outros):** a Pesquisa `compras/pedidos-baixa`, com FECHADO <> 'S' na loja e a opção BTNBAIXAR, em
    multisseleção; a pergunta do legado; e o `fechar` de cada pedido.
    - Os recusados voltam com o motivo, por exemplo "já está fechado", "sem itens" ou "limite excedido".
    - Divergência consciente: o legado faz só o UPDATE do FECHADO da loja. Aqui o pedido fechado ganha também a data, o histórico e o
      cabeçalho, como no Fechar pedido.
  - **"Excluir itens com Qtde zerada":** pedido gravado e sem loja fechada; os dois DELETE do legado; e o pedido impresso em seguida,
    como o legado.
  - A tela mostrava o item zerado como 1 na grade e no total (`qtdeDoItem`); corrigido.
  - Smoke §298.28.
- **Corte 2 — Hub de vendas, produtos (rel 01)** ✅:
  - Com a FILTRA_PRODUTOS_RELATORIO_VENDAS = 'S' (a da produção; o fonte de 2020 a lia do ConfigDB.xml), o "Gerar" pergunta "Deseja
    realizar o filtro de produtos?" e abre a Pesquisa `relatorios/vendas-produtos`: a GET_PRODUTOS das lojas, em multisseleção.
  - Até 1.000 códigos vão ao relatório (`produtos` no schema; o serviço já filtrava). Fechar sem marcar gera sem filtro.
  - O SetDefault('RAZAO') do legado aponta para coluna que a GET_PRODUTOS da produção não tem: a Pesquisa abre no padrão.
  - Divergência: o Imprimir usa a última escolha (o legado pergunta de novo; a janela de impressão precisa abrir no clique).
  - Os relatórios 22 (promoção por loja) e 46 (produtos por operador), em que o legado também pergunta, vieram depois (`e7b72dd8`, §298.33).
  - Smoke §298.29; jsdom `relVendasFiltroProdutos.spec.tsx`.
- **Corte 2 — Produto: receita, decomposição e composição** ✅. Os três "Adicionar" abrem a Pesquisa da GET_PRODUTOS_ESTOQUE com o
  estoque e o depósito da loja (a composição também com o preço da loja e ATIVO_VENDA = 'S'), em DESCRICAO / Começado com, em
  multisseleção:
  - **Receita:** QTDE 1, KG, o VRCUSTO como valor e o FATORCX_PRODUCAO. O legado exige a "Qtde total da receita" (RECEITAFATOR) antes;
    ela e a "Qtde unitária" (RECEITAQTDE) não estavam no formulário do Apollo e entraram. A unitária zerada vira 1.
  - **Decomposição:** PERCENTUAL 0; o repetido avisa "Produto X já encontra-se na grade.".
  - **Composição:** QTDE 1 e o VALOR da coluna do EMPRESAS.CAMPOCOMPOSICAO (VRCUSTO nas 5 lojas). Sem ele, a mensagem do legado.
  - Fica fora: o recálculo da venda do produto pela composição (Σ qtde × valor), que o legado faz ao carregar os itens. É regra de
    preço, não de multisseleção.
  - Smoke §298.30; jsdom `produtoReceitaLote.spec.tsx`.
- **Corte 3 — "códigos com vírgula" → Pesquisa** ✅ (só web; `shared/pesquisa/CodigosComPesquisa`):
  - O campo digitável continua; F3 ou "…" abre a Pesquisa em multisseleção, e os marcados substituem a lista, como o `fLista.Clear` do
    legado.
  - Telas:
    - relatório de compras: CFOPs de entrada (#98);
    - DRE: plano de contas (#100);
    - análise de comportamento: os **centros de custo** de impostos (#103; o rótulo dizia "conta do plano"), agora todos de uma vez;
    - inventário rotativo: produtos do relatório (#55) e **departamentos do lote** (#56; a tela não tinha o campo, a API já aceitava);
    - limite de venda: produtos (#73);
    - cotação: produtos e fornecedores (#38/#39; "Vários…" ao lado do avulso).
  - jsdom `codigosComPesquisa.spec.tsx`.
- **Corte 4 — Análise de notas, "Múltiplos CFOPs" (#99)** ✅ (`4c11ef12`): só no "Por CST", pelo CFOP do item (`NP.CFOP IN …`); a caixa
  "Múltiplos CFOPs" troca o campo único pela lista com Pesquisa. Smoke §298.34.
- **Corte 4 — Operadores: perfis e supervisionados (#110, #111)** ✅:
  - **Achado que mudou o acesso de todo o app:** o cliente roda em **CONTROLE_PERMISSOES = AMBOS**, não 'Usuario' como estava escrito.
    A global diz 'Usuario', mas a específica Modulo/Retaguarda diz 'A', e o `COALESCE(CE.VALOR, C.VALOR)` do legado fica com ela.
    Prova: a VANICE (op 50) abriu a Agenda de Promoção 1.422 vezes sem nenhuma linha própria da tela — vem do perfil COMPRADOR GERAL.
    O Apollo fixava 'usuario' e tiraria dela a tela; agora o modo vem da config (`modoPermissao`, mig 414, smoke §77.7b). Detalhe e a
    divergência consciente (o vínculo retirado, 'E', ainda dá acesso no legado; no Apollo não) em `uCtrlPermissoes.md` §2.
  - As abas que a tela não tinha: "Perfil operador" (ACESSO), "Perfil de compras" (COMPRA; tabela nova, mig 415) e, só no SUPERVISOR,
    "Operadores supervisionados". O Adicionar é a Pesquisa em multisseleção (`lookup/perfis` com ATIVO='S' e o TIPO da aba;
    `lookup/operadores` com TIPO_SIGLA='OPE'); vai tudo no Gravar do operador.
  - O vínculo retirado vira 'E' com INDR_USUARIO/INDR_DATA e o reposto é linha nova: o histórico do legado fica (não é o delete+insert
    do motor de detalhe).
  - A regra do supervisor: o campo só no tipo Operador (limpo nos outros), a escolha só entre SUPERVISORES ativos; quem deixa de ser
    supervisor perde os supervisionados, com a confirmação do legado.
  - Produção: 43 vínculos de acesso ativos (4 novos e 12 retirados em 2026); perfil de compra nunca usado (0 vínculos, 0
    parceiros/produtos/famílias com perfil de compra) — o `ValidaPerfilOperador` do pedido segue inerte; supervisionados: 0.
  - Fica de fora: o F2 que abre o cadastro de perfil por cima e a biometria.
  - Smoke §298.35; jsdom `operadoresAbas.spec.tsx`.
