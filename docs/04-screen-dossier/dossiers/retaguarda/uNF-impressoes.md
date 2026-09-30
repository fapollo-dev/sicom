# NF — as impressões do menu da tela (`uNF.pas:13528-13635`)

O menu da NF (`PopupMenu` do uNF.dfm:22299-22503) tem onze impressões. Até 30/09/2026 o Apollo não tinha nenhuma: o rodapé "NF-e"
mostrava "Imprimir" desabilitado e o menu não existia. Os modelos estão vivos — a RELATORIOS da produção tem versão PERSONALIZADA de
todas as conferências, e a de preço completa foi editada pelo cliente em **28/07/2025**, um mês depois da carga dos arquivos.

## Corte 1 — as conferências e a lista de conferência (30/09/2026)

| Menu do legado | Modelo (RELATORIOS) | Datasets |
|---|---|---|
| Imprimir conferencia de preço simplificada (:13584) | `conf - conferencia de preco simples nf.fr3` | dbdNota, dbdItensNota **por DESCRICAO** |
| Imprimir conferencia de preço completa (:13576) | `conf - conferencia de preco nf.fr3` | dbdNota, dbdItensNota |
| Imprimir conferencia de Impostos (:13541) | `conf - conferencia de impostos nf.fr3` | dbdNota, dbdItensNota |
| Imprimir conferência ICMS ST Recolher (:13593) | `conf - conferencia de icms st recolher.fr3` | frxDBDatasetICMSRecolher (`aqqICMSTRecolher`) |
| Imprimir conferencia de Devolução de Compra (:13549) | `conf - conferencia de pedido devolucao compra.fr3` | dbdNota, dbeEmpresa, frxDBRelPedDevCompra (`sqqRelPedDevCompra`) |
| Imprimir Lista de Conferência (:13631) | `Rel_ListaConferenciaNF.fr3` | Nota, Empresa, Itens (`ImprimeListadeConferencia`, uConferenciaNota.pas:993) |

E o botão **"Conf. Preço"** da grade do Manifesto (`cxbtnConfpr`, UManifestoDFe.pas:821) — a simplificada, habilitada só na nota
cadastrada (`CADASTRADA = 'SIM'`, :950).

**API:** `GET fiscal/nf/:id/impressao/:relatorio` (FRMNF) e `GET fiscal/nf/:id/conferencia-preco-manifesto` (FRMMANIFESTODFE). O
servidor monta os datasets e devolve o .fr3 da RELATORIOS (PERSONALIZADO antes do DEFAULT, `shared/relatorios/modelo-fr3.ts`); o
navegador desenha com o motor do FastReport (`apps/web/src/shared/fr3`, antes só das etiquetas).

**Os datasets, como o legado:**
- `dbdNota` = o `qryNota` (udmNF.dfm:7): a NF com TITULAR_* (parceiro + endereço), TRANSP_*, DESCCFOP, PRECO_CUSTO, DEVOLUCAO.
- `dbdItensNota` = o `qryItensNota` que **a produção executa** — capturado do V$SQL em 30/09/2026 (o fonte de 2020 não tem o campo
  **ESTOQUE** que a conferência completa personalizada imprime: é `GET_ESTOQUE_TOTAL.TOTAL` do produto na loja — loja + depósito +
  almoxarifado + trocas). Mais os campos internos que o `CalcValorNota` (udmNF.pas:3928) calcula na abertura, porque o relatório os
  imprime: **TEMPVRCUSTO** (custo líquido, via `CalcValorCusto`), **VRCUSTOFINALC**, **VRDESCONTO** (o desconto unitário; na entrada
  com o total dos produtos batendo com a nota em 0,02, o % vem do desconto da nota — :4150), **VRIPI**, **VRTOTALPRODUTOS**, TOTALPRODS,
  QTDETOTAL — ramo de entrada e de saída (:4267).
- `dbeEmpresa` = a empresa logada, **sem** senhas, tokens, certificados e CSC.
- Os tipos: numeric/bigint do PG viram número (o `%2.2n` do .fr3 só formata número); CST é NUMBER no Oracle e sai como número (0, 60).

**Mensagens do legado:** ICMS ST sem item de MVA → "Não existem registros a serem exibidos."; devolução sem pedido → "Nota Fiscal
sem pedido de devolução associado."; pedido sem itens → "Sem registro a serem exibidos.".

**O motor .fr3 ganhou** vários datasets (a MasterData percorre o do seu `DataSet`, "frmNF.dbdItensNota" sem o prefixo; os outros
ficam no 1º registro), as agregadas `SUM`/`AVG`/`MIN`/`MAX`/`COUNT(Banda)` sobre as linhas impressas da banda e `[TotalPages#]` (duas
passadas). Teste com os 6 modelos da produção e o pedido de devolução 10244 da produção (7 itens, 779,07 / 140,61 / 38 devolvidos).

**Divergências conscientes:**
- A ordem dos itens nas outras conferências é CODNFPROD; no legado é a do índice corrente do cdsItensNota — se a simplificada foi
  impressa antes na mesma sessão, o `IndexFieldNames := 'DESCRICAO'` fica e as seguintes saem por descrição.
- `CodigoCFOPDeDevolucao` (FuncoesApollo, fora do repositório) é o `CFOP.DEVOLUCAO = 'S'` da nota.
- O `VRVENDAFINAL` do item (campo interno que só o diálogo do item preenche) é 0 na abertura — como no dataset do legado.

**Smoke:** 3 checks (as 6 impressões, as mensagens, RBAC, loja; o ICMS ST com indexador de MVA; a devolução com o fator).

## Pendente (próximos cortes)

- **Carta de correção** (`ImprimirCartadeCorreco1`, `CartaCorrecao.fr3` no Config, dataset `sqqCartaCorrecao`/`NF_CARTA_CORRECAO`).
- O envio por e-mail da NF-e e da carta, a consulta de status e o cancelamento pelo XML (SEFAZ).

## Corte 2 — o menu Imprimir da Conferência de Nota (30/09/2026)

O `pmImprimir` de `uConferenciaNota` (dfm:2242) — nenhuma das três existia no Apollo:
- **Lista de Conferência** e **Lista de Conferência Usuários** (`ListadeConferenciaClick`, :969): a grade copiada, só os itens
  **marcados** quando há marcado (`Filtered := not IsEmpty` — sem marcado, todos), por DESCRICAO; Nota e Empresa das consultas de
  `ImprimeListadeConferencia`. A dos usuários (`ConferenciaNFOperadores.fr3`) imprime quem coletou e quem aprovou. Sem nota
  carregada: "Informe a nota fiscal ou o lote.". `POST compras/conferencia-nota/:codnf/impressao`.
- **Relatório** (`BtnImprimirFiltroClick`, :224): as entradas com coleta divergente por **fornecedor** (`aqqRelFornecedor`) ou por
  **produto** (`aqqRelPro`) no período de DTCONTABIL com as horas da tela (padrão hoje 00:00 a hoje 00:00, como os JvDateEdit/
  JvTimeEdit), filtros fornecedor/departamento/grupo/produto, a variável "Empresa" = razão social da empresa logada; vazio → "Não
  existem notas fiscais com coletas divergentes lançadas para essa busca.". **Todas as lojas**, como o legado (as consultas não têm
  IDEMPRESA). ⚠️ **Correção:** o filtro "Departamento" do legado comparava `PR.CODGRUPO` (cópia do "Grupo"); aqui é `PR.CODDPTO`.
  `POST compras/conferencia-nota/relatorio-diferencas`.
- O motor .fr3 ganhou as bandas **Header/Footer** da banda de dados (a que está logo acima/abaixo no desenho; `ReprintOnNewPage`,
  `PrintIfDetailEmpty`), e a MasterData resolve o dataset pelo `DataSetName` (o UserName) antes do `DataSet` (o nome do componente
  no form — "dbdRelFor").
- **Fora, com prova:** o modo "por lote de notas" (`LOTE_CONFERENCIA_NF`: 4 lotes e 6 vínculos na produção inteira).
- Smoke: 1 check (listas com e sem marcados, relatório por fornecedor e por produto, vazio).

## Corte 3 — "Imprimir nota", "Espelho da nota" e o DANFE (30/09/2026)

**Prova de uso:** a RELATORIOS tem layouts da nota por loja editados pelo cliente — `uRptNF2.fr3` (21/07/2025), `uRptNFE2.fr3`
(22/07/2025) e um `uRptNFE50.fr3` novo (03/07/2026); 169 concessões de `IMPRIMIRDANFE1` na produção.

| Menu | Modelo | Procedência |
|---|---|---|
| Imprimir nota (Ctrl+I) | `uRptNF<CODEMPRESA>.fr3`, senão `uRptNF.fr3` | `mniImprimirNotaClick` :14711 |
| Espelho da nota (Ctrl+N) | `uRptEspelhoNF.fr3` | `mniEspelhoNotaClick` :14616 |
| Imprimir DANFE (menu NF-e) e o botão "Imprimir" do rodapé | `uRptNFE<CODEMPRESA>.fr3`, senão `uRptNFE.fr3` | `ImprimirDANFE1Click` :13615 → `CriaNFE` (udmNF.pas:6017: `RelNFE` é sempre 'PERSONALIZADO') → `TNFe.ImprimirNFE` (NFe.pas:4274) |

- **O DANFE do legado é um .fr3 do FastReport, não o do ACBr:** o `CriaNFE` carrega o uRptNFE com os mesmos datasets da tela.
- **Datasets:** `dbdNota` com o **TOTALNOTA** (`cdsNotaCalcFields` — o `totalNfLegado` do Apollo) e a **HORASAIDA** (`TO_CHAR(DTHORASAIDA,
  'HH24:MI')`); `dbdItensNota` com o **TOTALDESCONTOS** (a agregada `SUM(VRDESCPROD)` do cdsItensNota); `dbeEmpresa` = `SELECT E.* FROM
  EMPRESAS` com os nomes do legado (CODEMPRESA, RAZAOSOCIAL, SERIE), **sem** senhas/hashes/tokens/certificados/CSC; `frxDBDatasetAnimal`
  vazio (NF_ANIMAL tem 0 linhas na produção).
- **Faturamento:** o `SetaFAturamento` (uNF.pas:15709) — "dd/mm/aaaa DUP: xxx      valor | ", quebra depois da 5ª, 9ª e 13ª parcela, a
  duplicata pelo `EMPRESAS.MODELO_DUPLICATA`. No DANFE vai **com a modalidade** ("A VISTA" na parcela que vence na emissão) no objeto
  `MemoFaturamento`, menos na nota de devolução (CFOP.DEVOLUCAO = 'S'). Em "Imprimir nota" o legado põe o texto na variável
  FATURAMENTO — que nenhum layout da produção usa (o `MemoFaturamento` deles é vazio): a nota sai sem o faturamento, como no legado.
- **Travas:** o DANFE só imprime com chave e NRONF ≠ 000000 (o legado não faz nada; aqui, "A nota não tem chave de NF-e para imprimir
  o DANFE."). O botão do rodapé passa pelo `LinhaComandosNfeLiberada` (:17831): entrada de emissão de terceiros → "Comandos não
  liberados para nota fiscal eletrônica de entrada de emissão de terceiros." (a "LIBERA COMANDOS NFE" mora no ConfigDB.xml da estação;
  o padrão sem ela é 'NÃO').
- **Permissões:** o item do menu exige GERARNFE1 + IMPRIMIRDANFE1 (Tag 1 nos dois); o botão, BTNIMPRIMIRNFE. Mig 403 (fixture).
  `GET fiscal/nf/:id/danfe` e `…/danfe-rodape`; a nota e o espelho pela rota geral (`…/impressao/nota|espelho`).
- **Estação (ConfigDB.xml, fora do banco), com o padrão do legado:** "CARREGAR DADOS EMPRESA NO DANFE AUTOMATICAMENTE" = 'NÃO'
  (o `DADOS_AUTOMATICOS` que o script do uRptNFE lê); "Nº DE VIAS NF" = 1 (as cópias ficam no diálogo de impressão do navegador); o
  `Images\logo.jpg` que troca a figura do DANFE fica a do próprio .fr3.
- **Fora:** a consulta de status na SEFAZ que o legado faz antes de imprimir o DANFE (`ConsultaNFE(True)`; a SEFAZ do Apollo é
  simulada).
- **Motor .fr3:** `Engine.NewPage`, `Engine.ShowBand`, `Inc`/`Dec`, `while … do`, o typecast `TfrxMemoView(Sender).Visible := …`
  (antes, um script com ele não compilava e o relatório perdia TODOS os eventos), `Sender`, `OnAfterPrint`, ColumnHeader/ColumnFooter
  por página, `DataSet.Eof`, `DataSet.RecNo` a partir do zero, Code-128C (a chave no uRptNF) e o texto de objeto posto antes da
  impressão. Testes com o uRptNF2 da loja 2 (60 itens: folha N de M, ColumnHeader só na 1ª) e o espelho (35 itens: linhas em branco
  e os totais só na última folha).
- Smoke: 1 check (nota, espelho, DANFE com e sem chave, rota genérica, RBAC, rodapé de terceiros).
