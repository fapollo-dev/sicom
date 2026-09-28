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

## 3. Imprimir a agenda (`btnImprimirClick` :787) — 28/09/2026, smoke §276

- Dois leiautes, escolhidos pela config **"AGENDA DE PROMOCAO AGRUPAR VALORES PELO DEPARTAMENTO"** — que mora no `ConfigDB.xml`
  **local de cada estação** (`udmConfigura`), não no banco; ausente = o simples. No Apollo vira a opção "Agrupar por
  departamento" na hora de imprimir (desmarcada, o padrão do legado).
- Os itens são os da grade (`sqqAgendaPromocaoItem`: com MULTI_PRECO na loja; ativos ou inativados há até
  AGENDA_PROMOCAO_DIAS_ITEM_CANCELADO dias; sem os irmãos gerados por grupo, `ATUALIZACAO_GRUPO <> 'S'`). O simples
  (ListagemAgendaPromocao) força "Exibir produtos = Ativos"; o agrupado (RelatorioAgendaPromocaoAgrupadoDepto) imprime a
  grade como está e soma o **valor promocional** por departamento de **todos** os itens (`sqqVendaPromocaoAgrupado`).
  Vr. venda = `COALESCE(X.VRVENDA, M.VRVENDA)`; preço 2 como no fim da promoção.

## 4. Etiquetas (`ImprimeEtiqueta` :2302) — 28/09/2026, smoke §276

- O botão abre a tela de etiquetas (`Application.CreateForm(TfrmEtiqueta)` — **sem o gate dela**) com os itens ATIVOS da agenda
  que têm preço na loja, uma etiqueta por código de barras, quantidade 1.
- Preço impresso: clique direto = pela situação (agenda FECHADA, `cbbStatus` índice 2 = 'J' → preço de venda; senão o
  promocional); menu "Utilizar valor de venda" / "Utilizar valor promocional".
- Item **mestre** de grupo de preço (`GRUPOPRECOSEL` = `ATUALIZACAO_GRUPO = 'M'`) com grupo > 0 expande para os itens da agenda
  do mesmo grupo (`sqqProdGrupoPreco`: família TIPO 'P', produto ativo pela ATIVO_PELA_MULTIPRECO, preço de venda da loja);
  sem nenhum, o próprio item. A config de estação "desconsiderar grupo de preço na agenda" fica no padrão: expandir.
- Na produção o grupo de preço é **TIPO 'P'** (1.532 famílias); a view `get_etiqueta_fila` do Apollo juntava com `tipo = 'R'`
  — corrigida na mig 385 (a do legado junta sem filtro de tipo).
- RBAC: `POST cadastro/etiqueta/da-agenda` pelo gate da agenda; o imprimir da tela de etiquetas aceita também quem chega pela
  agenda ou pelo Ajuste de Preços (`@RequerAcessoDeAlgum`), porque o legado abre a tela por Create; sem "Consulta Preço" a
  tela só fica sem a fila do coletor.
