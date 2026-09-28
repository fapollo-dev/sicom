# Agenda de promoção — os relatórios do menu "Outros"

`uCadAgendaPromocao.pas` (`GeralRel` :1844-2272, `GerarRelProdInativos`/`MontarDataSetProdInativos` :2274/:2518) +
`uVendas.pas` (`TVendas.GetSQL` 1, 1000, 1001, 1002, 22) + `udmCadAgendaPromocao.dfm` (`sqqRelFimPromocao`). Smoke **§275**.
Fecha o "relatórios" do *continua adiado* da agenda (30.910 acessos — a tela mais usada do cadastro de preço).

## 1. Os dez relatórios e o que cada um lê

| menu | SQL | layout (.fr3) |
|---|---|---|
| Produtos vendidos no período | `GetSQL(1)` (o rel 01 do hub) + `GetSQL(1000)` por departamento | Rel_Produtos_Vendidos_no_Periodo_Agrupado |
| … oferta em TV · rádio · tabloide · interna | idem, só os itens com a flag | ven2_01 - Produtos_vendidos_no_periodo |
| … totais | `GetSQL(1001)` CadAgendaVendaRebaixa | CadAgenda_Vendas_Rebaixa |
| … totais com itens | `GetSQL(1002)` | CadAgenda_Vendas_Rebaixa_Itens |
| Produtos vendidos por loja | `GetSQL(22)` ProdutosVendidosPorEmpresa | AgendaPromocaoVendidosPorLoja |
| Produtos que sairão da promoção | `sqqRelFimPromocao` | ListagemProdutosFimPromocao |
| Produtos inativos | `MontarDataSetProdInativos` | Agenda_Promocao_Produtos_Inativos |

- **Janela**: TVendas com `QuebraHora = True` → uma janela contínua data inicial + hora inicial → data final + hora final. As
  datas vêm do diálogo (que abre com as da agenda); as horas são sempre as do início/fim da agenda (`mskHoraInicio/Fim`).
- **Produtos**: `AND V.CODPRODUTO IN (itens da agenda) AND CANCELADO = 'N'`. No "vendidos", nos totais e no por loja o filtro
  da grade é desligado (`Filtered := False`) — todos os itens. Nos de mídia vale o filtro da grade (`ATUALIZACAO_GRUPO <> 'S'`
  + "Exibir produtos", padrão Ambos) e a flag `= 'T'`. (Na produção nenhum item tem TV; a flag existe e é portada.)
- **Totais**: só venda com `PROMOCAO = 'S'`; a "diferença" é contra o `MULTI_PRECO.VRVENDA` **atual**, não o da data da venda.
  O percentual divide pelo total vendido — o legado estoura com total 0; aqui sai nulo.
- **Por departamento**: o layout imprime o `frxDBDatasetD` = `cdsConsDpto` (`GetSQL(1000)`); o `cdsDeptoGrupo` que o código
  monta item a item (via `sqqProdutoDepto`) não é impresso.
- **Por loja**: o legado pivota até 3 lojas em campos Q1..Q3/C1..C3/V1..V3 indexados pelo **código** da loja (loja 4 quebraria)
  e acima disso imprime a lista; o Apollo devolve a lista e o pivô para qualquer número de lojas.
- **Lojas**: `GetMultiEmpresa`, recortado às lojas do operador (RELACAO_OPERADOR_EMPRESA), menos no fim da promoção (a do login).
- **Fim da promoção**: itens das agendas A/E/N da loja (`A.CODEMPRESA`) cujo fim cai na data, com `PRECO2` (desconto D somado,
  P percentual). ⚠️ **Desvio consciente**: o legado não filtra a agenda excluída (INDR='E'); na produção há uma aberta terminando
  em 28/09/2026 que sairia na listagem com preços que nunca valeram. Aqui fica de fora.
- **RBAC**: o menu é o `btnOutros` com Tag 0 → vale o gate da tela (FRMCADAGENDAPROMOCAO).

## 2. Apollo

`GET relatorios/agenda-promocao/:id?tipo=…&dtini&dtfim&horaIni&horaFim&empresas&exibir` (`AgendaPromocaoRelService`; o tipo 1
reusa o `RelVendasService` com o filtro novo `produtos`). Na tela, a seção de relatórios aparece com a agenda aberta: escolhe o
relatório, o período, gera e imprime pelo navegador.

**Continua adiado**: imprimir a agenda (`btnImprimirClick`) e as etiquetas (`btnEtiquetas`/`ImprimeEtiqueta`).
