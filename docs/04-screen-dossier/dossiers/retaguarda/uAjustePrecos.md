# Ajuste de preços — lote (FRMAJUSTEPRECOS, `uAjustePrecos.pas`) — 5.277 acessos

Código no Apollo: `cadastro/ajuste-precos.service.ts` + `apps/web/src/features/ajuste-precos`. Migs 127-128 (fila `lote_preco`
e as origens que a alimentam: cadastro do produto, pedido de compra, precificações).

## Corte "o botão Etiquetas" (25/09/2026) — auditoria de esqueletos §4.12

O botão "Etiquetas" (`btnEtiquetasClick`, uAjustePrecos.pas:109-260), que a mig 127 declarava adiado: os lotes marcados (ou os
que acabaram de ser processados) viram etiquetas — expandidos pelo grupo de preço, sem repetir código de barras; com "sem os de
promoção" (`ckPromo`) o lote em promoção fica de fora. `POST cadastro/etiqueta/dos-lotes`; a tela leva à de Etiquetas
(`/estoque/etiquetas`) com a lista montada. Produção: 469 das 789 execuções do ajuste tiveram impressão de etiqueta pelo mesmo
operador até 15 minutos antes. Smoke §211.

Pendentes (BAIXA): o histórico por produto atualizado. (O processar só na empresa da sessão foi resolvido na auditoria abaixo.)

## Auditoria do `uAjustePrecos.dfm` (15/10/2026) — controle a controle

Produção (somente leitura): PERMISSOES — FRMAJUSTEPRECOS 108 linhas, BTNEXCLUIR 58, BTNGRAVAR 50, BTNIMPRIMIR 24. LOTEPRECO por ano:
2025 14.215 (2.494 pendentes), 2026 9.198 (3.201 pendentes, 224 excluídos); lojas 1, 2, 50, 51, 52. LOTEPRECOATACAREJO: 1 linha (2021).

| Controle do legado | Apollo |
|---|---|
| `edtDtIni`/`edtFim` + `btnPesquisar` (`trunc(L.DATALOTE) between`) | Data inicial/final + Pesquisar; sem período não consulta (o legado abria vazio e trazia nada); data final < inicial avisa (`edtFimExit`/ValidaDatas). A tela não carrega mais sozinha nem corta em 2.000 (a fila tem 6.653 pendentes de 2023 a 2026: o corte, ordenado do mais antigo, escondia os recentes). |
| `GetMultiEmpresa` (`L.CODEMPRESA IN`) | Empresas (1,2) recortadas às lojas do operador; vazio = a loja do login. |
| `ckbLoteCadastro` / `CkbAlteracoesPedido` / `ckbAlteracoesNF` | As três caixas, combináveis como no `btnPesquisarClick`: cadastro + pedidos = OU entre os dois prefixos do OBS; nota fiscal = `L.VRVENDA <> M.VRVENDA` (sem linha de preço na loja fica fora, como o NULL do Oracle — antes o Apollo usava `coalesce(m.vrvenda,0)` e trazia esses). Antes era um select de uma origem só. |
| `btnProcessar` (sem Tag) | Processar com o acesso à tela (antes exigia BTNGRAVAR — 58 operadores com a tela e sem a opção ficavam de fora, inclusive da consulta). Cada lote é aplicado na loja DELE (`cdsAjustePrecosCODEMPRESA`): multi_preco, grupo de preço e histórico na loja do lote. Mensagens: "Confirma o processamento dos lotes selecionados?" / "Processamento efetuado com sucesso." |
| `btnGravar` (Tag 1, invisível) | Não exposto (o preço não é editável na grade). |
| `btnEtiquetas` (Tag 5) + `ckPromo` | Etiquetas com o acesso; "Retirar da etiqueta produtos em promoção" olha a promoção ATUAL do produto na loja do lote (`COALESCE(M.PROMOCAO,'N') PROMOCAO`) — antes olhava a do lote (PROMOCAOLOTEPRECO). O grupo de preço só traz produtos ATIVOS (`cdsGrupoPreco`: `P.ATIVO = 'S'`), e grupo sem ativo cai no produto do lote. |
| `DmConfigura...DesconsideraGrupoPrecoNaTelaAjustesDePrecosLote` | No fonte de 2020 vinha do ConfigDB.xml da estação (udmConfigura.pas:462); a produção tem no banco `DESCONSIDERAR_GRUPO_PREÇO_AJUSTE_PREÇOS_LOTE` = **S** (id 539, sem específica). Mig 424 traz a config; ligada, as etiquetas dos lotes saem só com o produto do lote. Prova de que ela não vale para o PROCESSAR: desde mar/2026, 646 de 757 irmãos de grupo ficaram com o preço do último lote no mesmo minuto. Indício para as etiquetas: em 244 de 407 irmãos sem lote próprio, o produto do lote tinha etiqueta impressa e o irmão não. |
| `btnExcluir` (Tag 1) | BTNEXCLUIR no botão e na rota (`RequerControle`); "Confirma a exclusão deste registros selecionados ?" / "Exclusão de Lotes realizada com Sucesso"; INDR='E' + usuário + data, nas lojas do operador. |
| Tecla T (`FormKeyDown`) | Marcar/desmarcar todos (T). |
| Grade: Sel, Loja, Lot. Preço, Data, Cód. Barra, Descrição, Vr. Venda, Vr. Custo, Quantidade, Markup, Obs, Grupo Preço, Alterou promoção?, Em promoção?, Vr. promoção | Todas, com o OBS inteiro (antes cortado em 32) e o preço atual ao lado. Quantidade fica de fora: só o braço atacarejo tem (1 lote na produção, de 2021). Descrição em negrito (`cxgridLoteDESCRICAOCustomDrawCell`). |
| `FormCloseQuery` "Deseja sair sem salvar as alterações?" | Sem edição na grade, não se aplica. |

Fora (com prova): o braço LOTEPRECOATACAREJO do UNION, o processar do atacarejo (`RetornarStatusAtacarejo`, MULTI_PRECO_ATACAREJO com 3 linhas)
e a exclusão por CODLOTEPRECOATACAREJO — 1 lote em toda a produção, pendente desde 22/07/2021. Configs do binário novo com N na produção e sem
leitura no fonte: PEDIR_SENHA_PROCESSAR_AJUSTE_PRECO (355), USA_BLOQUEIO_AJUSTE_PRECO_LOTE (363). Smoke §211 (atualizado) e §326; spec
`ajustePrecosPage.spec.tsx`.
