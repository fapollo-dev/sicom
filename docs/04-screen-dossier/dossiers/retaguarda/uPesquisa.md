# PESQUISA — `uPesquisa` / `frmPesquisa` (`TfrmPesquisa`)

Recon de 07/10/2026 (somente leitura: fonte Delphi de mai/2020 + Oracle de **produção** em modo `READ ONLY`). Nenhum
código alterado. É a janela que **todo cadastro** abre (F3 / botão "Consultar Registro (F3)") e que outras telas abrem
como lookup de campo: **934 chamadas `TfrmPesquisa.Create` em 250 units**, sobre **136 views/tabelas** distintas. Na
produção há **417 views `GET_`**; **107** estão registradas como "view de cadastro" em `TABELA_CADASTRO`.

> **Procedência.** `[fonte]` = lido no `.pas`/`.dfm` de mai/2020. `[produção]` = visto no Oracle vivo (V$SQL,
> `CONFIG_STATUS_TELA`, `CONFIGURACOES`, dicionário). O binário da produção é mais novo que o fonte; onde discordam,
> vale o dado vivo, e isso vem dito no item.
>
> ⚠️ **Armadilha de método encontrada neste recon:** os `.pas` em latin1 (ex.: `uCadMaster.pas`, "very long lines")
> são tratados como **binários** pelo `grep` — sem `-a`, o `grep -rn` não lista a linha e a contagem sai errada. A 1ª
> passada deste recon contou 46 chamadas em 19 units; com cópias UTF-8 (`iconv -f latin1`) são 934 em 250. Toda
> contagem abaixo foi refeita sobre as cópias UTF-8 (excluídos `uPesquisa.pas`, `uPesquisa2.pas`, `uCadMaster_old.pas`
> e `1uNF.pas`).

Fontes da tela (convertidas de latin1, exceto `uPesquisa.pas`, que já é UTF-8 com BOM):

| unit | linhas | papel |
|---|---:|---|
| `uPesquisa.pas` / `.dfm` | 3.022 / 988 | a tela |
| `UFrameGeral.pas` / `.dfm` | 472 / 245 | o **único** frame de valor (4 páginas: texto, valor, data, data+hora) |
| `uComunPesquisaRel.pas` | 679 | `TPesquisaRelatorio`: tipo do campo → operações, `GetParametroWhere`, ordenação, `PercorreOrigem` |
| `UClassGrid.pas` | 176 | filtro digitado na coluna da grade + realce amarelo |
| `uConfigStatusTela.pas` | 1.396 | o "status da tela" (Ctrl+Shift+S/D) em `CONFIG_STATUS_TELA` |
| `uMaster.pas` / `.dfm` | 723 | base: Esc, Enter→Tab, Ctrl+Shift+S/D, `RecuperarStatus` |
| `uCadMaster.pas` / `.dfm` | 1.806 | `btnPesquisaClick`: situação (`rdgAtivo`), INDR, navegação sobre o resultado |
| `udmConfigura.pas` | — | `SalvarConfiguracaoUsuario` ← configuração "SALVAR CONFIGURAÇÃO DE PESQUISA POR USUÁRIO" (`:353-354`) |

Não vieram no fonte (o que depende deles está marcado "não provado"): `FuncoesApollo` (o enum `TTipoPesquisa`,
`SetaTitulo`, `ExportaExcel`, `CriarCsv`, `CopyQuery`), `UadaptadorBanco` (`PesquisaCamposDaView`, `GetDescricaoView`)
e `SearchEngineApollo`. As consultas de `UadaptadorBanco` foram recuperadas do **V$SQL** (§3.1). `uPesquisa2.pas`
existe mas nenhuma unit a usa (código morto).

---

## 0. Estado da conversão (07/10/2026)

**Corte A entregue.** `GET /cadastro/pesquisa/meta` e `GET /cadastro/pesquisa` (`apps/api/src/shared/pesquisa/`): campo + operação +
valor no banco com as regras do §3.4 (`pesquisa-sql.ts`, testado em `test/pesquisa-sql.spec.ts`), excluído (INDR) nunca aparece, a
situação pelo campo de ativo de cada tela, os filtros obrigatórios e as opções antes da Pesquisa (A pagar, A receber, Pedido de compra),
a abertura por tela, o código de barras pelo código auxiliar e a página sobre o total (sem o teto de 200). As 26 telas estão em
`telas.ts`, com a procedência em `tools/pesquisa/telas-pesquisa.json`. Web: `shared/cadmaster/Pesquisa.tsx` (abre vazia; &Campos /
O&peração / Texto-Valor-Data; Enter pesquisa e vai à grade; clique só posiciona; Enter/duplo clique/&OK confirmam). Smoke §298 (7
checks), jsdom `pesquisa.spec.tsx`, e2e `teclado.e2e.ts`.

O levantamento das 26 telas corrigiu este dossiê em dois pontos: o **ATIVO de produtos é o da loja** (a GET_PRODUTOS da produção lê o
MULTI_PRECO: `CONFIGURACOES_ESPECIFICAS` id 30 = 'S' prevalece sobre `ATIVO_PELA_MULTIPRECO='N'` — ~30 mil inativos por loja contra 582
em `produtos.ativo`; o §8 dizia o contrário) e, no binário novo, o union do código auxiliar é INNER JOIN e **leva** os filtros
obrigatórios (o §2.2 descreve o fonte de 2020).

**Corte C entregue (07/10/2026).** C1: o cadastro navega sobre o resultado da Pesquisa (o `cdsNavegation`, `soCodigos`). C2: os 56
combos de tabela grande (`useResourceOptions` cortado em 200: parceiros, produtos, plano de contas, cidades, famílias, bancos, CFOP,
PLC, operadores) viraram `LookupField` (código + descrição + a Pesquisa da view) com o filtro de cada campo do legado — igualdades em
`f_<coluna>` (com `a|b` = OU) e o que não é igualdade como parâmetro declarado no servidor (`lancavel` = máscara do centro de custo,
`idsituacao_nf`, `daLoja`, `naoComposto`, `ativoCompra`, `semFilho`, `lookup/operadores-da-loja`); `campoDigitado` = o que se digita no
legado (CODIGO_EXTENSO do centro de custo, CODIREDUZIDO da conta), gravando o código interno. As grades nomeiam só os códigos exibidos
(`shared/pesquisa/useLinhasDosCodigos`). Smoke §298.8-§298.11.

Filtros do legado ainda fora (por falta de coluna/config no destino): `TIPO_CONTA IN (DESPESA, NEUTRA)` do convênio de funcionário
no A pagar (uAPagar.pas:776); `TIPOESTADO` FORA/DENTRO do CFOP do item (uItensNF.pas:1084); `REALIZA_RETENCOES` e
`INCLUIR_CLIENTES_FORN_NF_DEV` no parceiro da NF (uNF.pas:3144-3150); `ENDERECO_ATIVO` do fornecedor do pedido (uPedidoCompra.pas:6599);
o produto-pai ≠ o próprio (UCadProduto.pas:4298); a cotação aceita participante não fornecedor no legado e o servidor do Apollo recusa.

**Corte D entregue (07/10/2026)** — menos a multisseleção: as cores com legenda (a 1ª regra que casa, no servidor — `cores.ts`;
AMARELO/PRETO na cor normal, como o `GetColor`), os atalhos F8-F12 da pesquisa de produto (o F12 explica que a ESTOQUE_PROD não vem) e
o totalizador do A pagar/A receber (soma no servidor). Smoke §298.12.
**Corte E entregue em parte** — o status da tela (Ctrl+Shift+S/D) na Pesquisa do cadastro (`status-tela.ts`; smoke §298.13). Faltam o
F4 (layout/campo em arquivo local no legado), o F7 (filtros acumulados), o ↑ (última pesquisa) e o status do lookup de campo.

**Fica para o corte B (as views do destino iguais às da produção):** GET_PRODUTOS por loja (IDEMPRESA e o ATIVO da loja; hoje o
destino tem uma linha por produto e `produtos.ativo`), o `FORNECEDOR_ATIVO='S'` do pedido aberto e o FECHADO por loja, o complemento
"com centro de custo" do A pagar (GET_APAGAR_CEN/GET_CP_CEN), as colunas que faltam nas views (GET_NF 17 de 49, GET_EMPRESAS…). **Corte
C:** o cadastro navegar sobre o resultado e o teto de 200 do `useResourceOptions`. **D/E/F** como no §12.

## 1. Resumo para quem tem pressa

**O legado:** o operador escolhe **campo** (todas as colunas da view, em ordem alfabética) + **operação** (por tipo do
campo) + **valor**, aperta Enter, e a tela traz **a view inteira filtrada, sem limite** (o `SELECT` não tem `ROWNUM`
nem `ORDER BY`; a ordenação é na grade). Enter/duplo clique devolve o registro; no cadastro, as setas passam a
**navegar sobre o resultado da pesquisa**. Cada chamador acrescenta o seu **filtro obrigatório** (71% das chamadas:
lojas do operador, aberto/quitado, tipo da nota…), o campo/operação/ordenação de abertura, regras de **cor com
legenda** (51 units), **atalhos de detalhe** (F8-F12: preço, código auxiliar, estoques — 9 units), **multisseleção**
(73 units), **totalizador**, **etiquetas** e uma consulta auxiliar (código de barras acha pelo **código auxiliar**). Em
volta: filtros acumulados (F7), filtro digitado na coluna (F6 alterna "em qualquer lugar"/"começa com"), imprimir os
relatórios salvos da view, exportar, abrir o cadastro da view (Ins/F2), repetir a última pesquisa (↑) e dois jeitos de
"abrir do meu jeito": **F4** (arquivo local) e **Ctrl+Shift+S/D** (banco, `CONFIG_STATUS_TELA`).

**O Apollo hoje** (`Pesquisa.tsx` + `crud-engine.service.ts`): um Modal com o `DataTable` do DS que busca **uma vez**
`GET /<recurso>?situacao=…` e filtra **no navegador**. A API corta em **200 linhas** (`limit(min(limite ?? 200, 500))`)
sem ordem — e a Pesquisa nunca manda `campo/valor`. Com 17,3 mil produtos ativos por loja, 19,1 mil parceiros e 50,1
mil NF, **a maior parte dos registros não pode ser achada pela Pesquisa**.

Os gaps estão no §9; a proposta de cortes, no §12.

---

## 2. Quem abre a Pesquisa e com o quê

### 2.1 O cadastro (`TfrmCadMaster.btnPesquisaClick`, `uCadMaster.pas:516-590`) `[fonte]`

F3 (`FormKeyUp`, `uCadMaster.pas:1018-1027`, só fora de inclusão/edição) ou o botão. O que ele monta antes de abrir:

1. **Situação (`rdgAtivo`, "Ati&vo [F6]": Sim / Não / Todos — `uCadMaster.dfm:704-709`)**: se o registro da tabela
   tem o campo de ativo (`FCampoAtivo`, padrão **`ATIVO`**, `:972`; Parceiros e Associados trocam para **`ATIVADO`**,
   `uCadClientes.pas:3825`), entra `ATIVO = 'S'` (Sim) / `ATIVO = 'N'` (Não) / nada (Todos) — `:524-538`, valores de
   `FValorAtivo = 'S;N'`. F6 no cadastro cicla o rádio (`:993-1004`).
2. **Excluídos (INDR)**: se a tabela tem `INDR` **e a view expõe `INDR`**, soma `(COALESCE(INDR,'I') = 'I')`
   (`:540-544`). Na prática quase todas as views já excluem `INDR='E'` no próprio `WHERE` (§8). **Excluído nunca
   aparece na Pesquisa** — não existe "mostrar excluídos".
3. `FObrigatoriosPesquisa` da tela (27 units): Operadores → `CODIGO_EMPRESA = <empresa>` (`uCadUsuarios.pas`); A
   receber → `IDEMPRESA in (<lojas>)` + aberto/quitado/agrupado conforme a opção escolhida (`uCadAReceber.pas`); Pedido
   de compra → `FECHADO = 'N' AND IDEMPRESA in (<lojas>) AND FORNECEDOR_ATIVO = 'S'` (`uPedidoCompra.pas:7160`); SCRAP
   → `IDEMPRESA = <empresa>`; Cartão → `CODIGO_EMPRESA in (<lojas>)`; Agenda de promoção → `FLAGPROMOCAO <> 'J' AND
   DT_FIM_PROMOCAO >= TRUNC(SYSDATE)`; Parceiros pelo menu "Funcionários" → `FUN = 'S'` (`uCadClientes.pas:4870`).
4. Cria `TfrmPesquisa.Create(Self, FViewPesquisa, edtCodigo, FCampoRetornoPesquisa, nil, '', <filtro>, cdsNavegation, …)`
   (`:547`): retorno no `edtCodigo`, campo de retorno padrão **`CODIGO`** (`:1063-1064`), e **`cdsNavegation` recebe o
   resultado** (§6.4).
5. Repassa: etiqueta (`FEtiqueta`), view auxiliar de relatório, totalizador (`TotalizaFinanceiroNaPesquisa`), colunas
   ocultas/visíveis, `SetDefault` (`:556-559`; sem padrão da tela: `SetDefault('', '', tpQualquerLugar, False,
   FCampoOrdenacao)`), as regras de cor (`cdsColoracao`, `:561-564`), filtros pré-carregados (`cdsFiltros` ⇒ já abre
   com F7 ligado, `:566-570`) e os atalhos de detalhe (`cdsDetalhes` + `FLabelAtalhos`, `:572-576`).
6. Depois do OK: `cdsNavegation.Locate` + `AbreDataset(código)` + foco no Editar (`:579-589`).

Ao abrir (`FormShow`, `:1051-1052`) o cadastro **grava sozinho** o par `(GET_<TABELA>, <nome do form>)` em
`TABELA_CADASTRO` se não existir — é daí que vem o mapa view→cadastro do Ins/F2 (§7.5).

Várias telas **substituem** o `btnPesquisaClick` e mostram uma janela de **opções antes da Pesquisa**: A pagar
(`uAPagar.pas:2630-2720`) pergunta "Status das contas a pagar" — Somente abertas / Somente quitadas / Adiantamento de
crédito / Agrupadas / Todas + Com/Sem centro de custo — e, conforme a resposta, abre **outra view** (`GET_APAGAR`,
`GET_APAGAR_CEN`, `GET_CP`, `GET_CP_CEN`) com filtro diferente, sempre `CODIGO_EMPRESA in (<lojas>)`
(`dmPrincipal.GetMultiEmpresa`), totalizador ligado, ordenação por `VENCIMENTO` e cores. A NF (`uNF.pas:6202-6300`) abre
`GET_NF` com `TIPO = <E/S> AND IDEMPRESA = <empresa>`, `NRO_NF` sem decimais, `SetDefault('PARCEIRO', …,
tpQualquerLugar, …, 'CODIGO')` e 9 regras de cor.

### 2.2 Os lookups de campo `[fonte]`

934 chamadas em 250 units. As views mais chamadas: `GET_PARCEIROS` 149 · `GET_FAMILIAS_PROD` 97 ·
`GET_PRODUTOS` 85 · `GET_SITUACAO_NF` 67 · `GET_PLC` 56 · `GET_PLANO_CONTAS` 52 · `GET_CONTAS_BANCARIAS` 32 ·
`GET_FORMAS_PGTO` 24 · `GET_NF` 24 · `GET_EMPRESAS` 21 · `GET_OPERADORES` 16 · `GET_BANCOS` 16. Padrão:
`TfrmPesquisa.Create(Self, 'GET_X', edtCod, 'CAMPO_COD', edtDesc, 'CAMPO_DESC', '<filtro obrigatório>', …)`;
**662** chamadas (71%) passam filtro obrigatório. A função de classe nova
`TfrmPesquisa.Pesquisa(Self, 'GET_PRECO', 'ATIVO = ''S''').GetValor('CODIGO', edt)…` (`uPesquisa.pas:2402-2462`; 30
chamadas em 16 units) devolve a **linha inteira** num dicionário (`TRetornoUnicoPesquisa`).

Parâmetros do construtor (`uPesquisa.pas:259-271`, `795-873`) e o uso medido:

| parâmetro | o que faz | uso |
|---|---|---|
| view, retorno 1 e 2 | controle + campo do código e da descrição; retorno 1 padrão `CODIGO` | todos |
| filtro obrigatório | `and`-ado ao `WHERE` (§3.2) | 662 |
| dataset de códigos | recebe o resultado (navegação / clone / multi) | |
| `ApenasRetorno` | valida o código digitado sem mostrar a grade (`:864-869`, `:2299-2304`) | 0 |
| `Join` | texto anexado depois do `FROM` (ex.: `LEFT JOIN CONTAS_BANCARIAS_OP O ON …`) | 15 |
| `CamposInteiros` | colunas numéricas sem `,00` | 29 |
| `PesquisaSimples` | esconde campo/operação e **abre carregada** (`:871`, `:1593-1599`) | 1 (`UCadMapaDeCarga`) |

`SetDefault(campo, valor, operação, abre, ordenação, consAux, campoAux)` — 185 chamadas: operação **Em Qualquer Lugar
126**, **Começado com 40**, Igual a 14, Diferente de 1. `AbreDataset=True` em 25 — **sem efeito** (§7.6). A
**consulta auxiliar** (`FConsAux`/`FCampoAux`, `:2234-2242`) tem 8 usos, todos iguais na ideia: quando o campo escolhido
é `CODBARRA`, soma `union all select … from CODAUXILIAR C LEFT JOIN GET_PRODUTOS PR ON (PR.CODBARRA = C.CODBARRA) where
C.CODAUXILIAR = '<valor>'` — **procurar pelo código de barras acha também pelo código auxiliar** (`UCadProduto.pas:6296-6300`,
`Uetiqueta`, `uInventario`, `uLoteProducao`, `uRelatorioIndustria`, `uImprimeEtiqueta`). (O `union` não leva os filtros
obrigatórios — traz o produto de todas as lojas.)

### 2.3 Os filtros obrigatórios vistos vivos `[produção — V$SQL de 07/10/2026]`

```sql
-- A pagar (uAPagar: lojas do operador)
… from GET_APAGAR where (VENCIMENTO between '03/10/2026' and '05/10/2026') and CODIGO_EMPRESA in (1,2)
-- Baixa de cartão: loja + o que já está na seleção do usuário
… where (DATA between '04/09/2026' and '07/09/2026') and CODIGO_EMPRESA in (2)
      AND CODIGO NOT IN (SELECT CODIGO FROM GET_CARTAO_SELECAO WHERE USUARIO_SEL = 3801 )
-- Fornecedor no pedido de compra (uPedidoCompra.pas:6599)
… where (RAZAO like '%LUFIR%') and FRN = 'S' AND ((ATIVADO = 'S') OR (ATIVADO IS NULL))
      AND ((ENDERECO_ATIVO = 'S') OR (ENDERECO_ATIVO IS NULL))
-- Pedido de compra (uPedidoCompra.pas:7160)
… where (DATA =  '07/10/2026') and FECHADO = 'N' AND IDEMPRESA in (1,2) AND FORNECEDOR_ATIVO='S'
-- Cadastro de produtos: situação + empresa obrigatória
… from GET_PRODUTOS where (DESCRICAO like '%BENTO%') and ATIVO = 'S' AND  (IDEMPRESA = 2)
```

Consequência para o alvo: o filtro obrigatório é **uma lista de condições por chamador** (multi-loja `in (…)`,
subselects, `OR … IS NULL`), separada do filtro do usuário — não um par campo=valor.

---

## 3. A consulta (`OpenDataset`, `uPesquisa.pas:2009-2400`, e `GetConsulta`, `:2758-2946`)

### 3.1 Metadados que a tela lê ao abrir `[produção — V$SQL]`

```sql
-- a lista de campos (cdsCampos) — ORDENADA POR NOME
SELECT DISTINCT U.COLUMN_NAME, U.COLUMN_ID, COALESCE(C.COMMENTS, U.COLUMN_NAME) DESCRICAO, U.DATA_TYPE,
       COALESCE(U.DATA_PRECISION, U.DATA_LENGTH) TAMANHO, U.DATA_SCALE
  from user_tab_cols u left join user_col_comments c on C.TABLE_name = U.TABLE_name AND C.COLUMN_NAME = U.COLUMN_NAME
 WHERE u.TABLE_name = 'GET_PARCEIROS' ORDER BY U.COLUMN_NAME
-- o título ("Pesquisa " + comentário da view)
SELECT CAST(c.comments AS VARCHAR(255)) DESCRICAO FROM user_tab_comments c WHERE c.TABLE_NAME = :NOME
-- o hint "(Insert): Incluir registro" e o Ins/F2
select FORM from TABELA_CADASTRO where TABELA = 'GET_PARCEIROS'
```

A combo de campos é **alfabética** (`uPesquisa.pas:1651-1661` lê `cdsCampos` na ordem em que veio), com o nome
capitalizado (`RAZAO` → "Razao"). Prova: os índices salvos em `CONFIG_STATUS_TELA` batem com a posição alfabética
(GET_PLC: "Codigo"=0, "Descricao"=3; na ordem do `COLUMN_ID` seriam 2 e 0).

### 3.2 O SQL `[fonte]` + `[produção]`

```
select Cast('F' as CHAR(1)) as Selecionar, Cast('T' as CHAR(1)) as Sel, <VIEW>.* from <VIEW><Join>
  [where (<campo> <op> <valor>)]            -- o filtro do frame
  [and <TextoPesquisa>]                     -- dmPrincipal.TextoPesquisa (só com FRetornoPesquisa; ninguém liga)
  [and <filtro obrigatório>]                -- do chamador + IDEMPRESA de GET_PRODUTOS
  [and <FFiltroCad>]                        -- o registro recém-gravado pelo Ins/F2 (§7.5)
  [and <instrução 1> and <instrução 2> …]   -- filtros acumulados (F7) ou a "última consulta" (↑)
  [<FConsAux com %S = valor>]               -- o union do código auxiliar (§2.2)
```

(`:2034`, `:2085-2162`, `:2164-2212`, `:2234-2247`.) **Sem `ORDER BY` e sem limite** — confirmado nos 18 cursores do
V$SQL de hoje. A ordenação inicial (`FCampoOrdenacao`) é feita na grade (`cdsTemp.IndexFieldNames`, `:2307-2315`).

**Empresa obrigatória** (`SetaEmpresaObrigatoria`, `:2555-2564`): só para `GET_PRODUTOS`, soma
`(IDEMPRESA = <empresa logada>)`. Indispensável: a view tem **uma linha por produto por loja** (47.811 em cada uma das
lojas 1, 2, 51, 52 e 12.871 na 50 — ~204 mil linhas); sem o filtro cada produto apareceria 4-5 vezes.

### 3.3 Tipo do campo → frame e operações (`SetaSaidas`, `uComunPesquisaRel.pas:385-419`; `MontaComboOperacao`, `:421-452`)

| tipo (cdsCampos) | frame | operações, nesta ordem (índice) |
|---|---|---|
| VARCHAR, CHAR, SUB_TYPE | texto (`edtTexto`, **CharCase maiúsculo** — `UFrameGeral.dfm:56`) | 0 Igual a · 1 Diferente de · 2 Começado com · 3 Terminado com · 4 Em Qualquer Lugar · 5 Contido em |
| NUMERIC, INTEGER | valor (`edtValorIni`/`Fim`) | 0 Igual a · 1 Diferente de · 2 Entre · 3 Maior que · 4 Menor que · 5 Contido em |
| DATE | data (`edtDataIni`/`Fim`) | idem números |
| TIMESTAMP | data + hora (`DedData*` + `TedHora*`) | idem números |

"Contido em" existe para **todos** os tipos e força o frame de **texto** (`cbbOperacaoChange`, `:382-397`;
`MostraFrame`, `:2679-2680`). Não há frame de "lista": é texto com vírgulas, e a tela mostra um exemplo por tipo
(`cbbOperacaoExit`, `:404-418`): `5.1,6.9,7.8` · `APOLLO,SISTEMAS` · `13/10/2011` · `15,6,10`.

O mapeamento Oracle→tipo da tela fica em `UadaptadorBanco` (ausente). Na produção as colunas das views `GET_` são
NUMBER 2.577 · VARCHAR2 1.946 · CHAR 649 · DATE 277 · TIMESTAMP(6) 156 · outros 20.

### 3.4 O texto do filtro (`GetParametroWhere`, `uComunPesquisaRel.pas:228-299`; `SetaParametrosWhere`, `UFrameGeral.pas:140-264`)

| operação | SQL gerado | observação |
|---|---|---|
| Igual a / Diferente de (texto) | `(CAMPO =  'X')` / `(CAMPO <> 'X')` | dois espaços depois do `=` (aparece assim no V$SQL) |
| Começado com | `(CAMPO like 'X%')` | |
| Terminado com | `(CAMPO like '%X')` | |
| Em Qualquer Lugar | `(CAMPO like '%X%')` | **`+` vira ` %`**: `ARROZ+TIO` → `like '%ARROZ %TIO%'` (várias palavras, em ordem) |
| Contido em | `CAMPO in ('a','b')` | sempre entre aspas, até para número; data troca `/` por `.` |
| Entre | `(CAMPO between v1 and v2)` | inclusivo |
| Maior / Menor | `(CAMPO >  v)` / `(CAMPO <  v)` | estrito |
| Igual a `''` (texto) | `((CAMPO =  '')OR (CAMPO IS NULL))` | o operador digita duas aspas para achar o vazio (`:2096-2107`) |
| Diferente de `''` | `((CAMPO <> '') OR NOT (CAMPO IS NULL))` | = "preenchido" |

Regras do frame que mudam o resultado:

- **Texto vazio ⇒ sem filtro** (`Trim(edtTexto.Text) <> ''`, `UFrameGeral.pas:156`): Enter com o campo vazio traz a
  view inteira (só com o filtro obrigatório). Visto vivo: `… from GET_AGENDA_PROMOCAO where FLAGPROMOCAO <> 'J' …`.
- **Valor numérico vazio ⇒ `= 0`**: o frame de valor não testa vazio (`:219-235`) — Enter sem número procura
  `CAMPO = 0`. Visto vivo: `… from GET_MOTIVOS_OPERACAO where (CODIGO =  0) and TIPO_OPERACAO = 'PERDA'`. (Alguns
  cadastros abrem assim de propósito: `SetDefaultPesquisa('CODIGO', '0', tpIgual, …)` em Mapa de carga e CT-e.)
- **Data abre com hoje** (`SetaValorInicial`, `:270-290`; "Entre" = hoje a hoje); data zerada ⇒ sem filtro. Vai como
  literal `'dd/mm/aaaa'`. Nas colunas DATE conferidas (`GET_PEDIDOCOMPRA.DATA`, `GET_APAGAR.VENCIMENTO`,
  `GET_CARTAO.DATA` — 323 mil linhas —, `GET_PRODUTOS.DATA_CADASTRO`) **nenhuma** linha tem hora ≠ 00:00: `=` por data
  acha o dia inteiro.
- **Maiúsculas**: o campo de texto só aceita maiúsculas e o `like` do Oracle diferencia caixa — dado gravado em
  minúscula não é achado. (O Apollo faz `upper()` dos dois lados: mais permissivo — divergência benigna, registrar.)

### 3.5 Campo e operação com que a tela abre

- **Campo**: `SetDefault` do chamador, senão o arquivo do F4, senão `cbbCampos.ItemIndex := 0` (`:1672`) — o
  **primeiro em ordem alfabética**. Cadastros com padrão próprio (`SetDefaultPesquisa`): Produtos `DESCRICAO` (ordena por
  descrição), Pedido de compra `PARCEIRO` (ordena por pedido), A receber `CLIENTE`, A pagar ordena por `VENCIMENTO`, NF
  `PARCEIRO` (no `btnPesquisaClick`), Mapa de carga e CT-e `CODIGO`/`NROCTE = 0`, Mapa de entregas `DT_ABERTURA`. Os
  demais caem no alfabético: Parceiros abre em "Ativado", SCRAP em "Centro_custo", Agenda de promoção em "Codigo",
  Operadores em "Ativo". Os 26 status salvos na produção mostram o que o operador troca: "Razao" (Parceiros), "Nro_nf"
  (NF, por cima do PARCEIRO), "Nome", "Descricao", "Vencimento", "Codbarra".
- **Operação**: na abertura, `SetOperacaoDefault(FOperacaoDefault, tipo)` (`uComunPesquisaRel.pas:629-656`). Com
  `tpQualquerLugar`: texto → **Em Qualquer Lugar**, número/data → **Igual a** (o `case` de número não tem
  `tpQualquerLugar` ⇒ índice 0). **Trocar de campo depois volta a operação para o índice 0 = "Igual a"**
  (`cbbCamposCloseUp`, `:323-328`). Lookups sem `SetDefault` caem no ordinal 0 de `TTipoPesquisa` (enum em
  `FuncoesApollo`, ausente — não provado).

---

## 4. Filtros acumulados — F7 (`cdsFiltros`)

`[fonte]` F7 liga/desliga `FSubSelect` e mostra o painel " Vários filtros ativado. (<F5> Limpar; <Alt> + <Del>
Remover) " (`:1509-1517`, `SetaControlesFiltro` `:2527-2553`). Ligado, cada pesquisa **acrescenta** uma linha (CAMPO,
OPERACAO, VALOR_MOSTRAR, VALOR_CAMPO, INSTRUCAO) se não houver uma igual (`:2214-2232`) e o `WHERE` junta **todas** com
`and` (`:2164-2206`), com o mesmo tratamento do `''`→`IS NULL`. Desligado, cada pesquisa substitui a anterior. Alt+Del
na grade de filtros remove o selecionado (`:1383-1400`) — vale na próxima pesquisa (não refaz sozinho). F5 esvazia tudo
(`:1503-1508`). O cadastro pode abrir a Pesquisa com filtros já carregados, e aí o F7 já vem ligado
(`uCadMaster.pas:566-570`).

---

## 5. A grade de resultado

| item | legado | procedência |
|---|---|---|
| Colunas | **todas** as da view (`VIEW.*`), título = nome capitalizado com `_`→espaço ("Data ultima compra"); `SEL` sempre oculta; `SELECIONAR` só com multisseleção (60 px, negrito, centro, mostra `X`/`[]`) | `Corrigegrid` `uComunPesquisaRel.pas:78-144`; `:2285`, `:2369-2394`, `GetText` `:1909-1916` |
| Larguras/formatação | texto por tamanho (teto 300 px), numérico `,0.00` à direita (exceto `CamposInteiros`), data 70 px | `Corrigegrid`; `:2270-2277` |
| Colunas ocultas/visíveis | `HiddenGridCols`/`VisibleGridCols` (`;`): Mapa de carga e de entregas, Agenda de limitação (`ESTATUS;EMPRESAS;INDR`), e as pesquisas de produto das etiquetas (`CODBARRA;DESCRICAO;VRVENDA;` + configuração **`PESQUISA_PRODUTO_MOSTRA_CAMPOS`**, vazia na produção) | `:1964-2007`; `Uetiqueta.pas:594-596`, `uImprimeEtiqueta.pas:177-179` |
| Ordenar | clique no título alterna asc/desc (título em negrito); **Alt+H** ordena pela coluna focada; ordenação inicial `FCampoOrdenacao` | `:1363-1368`, `:1522-1533`, `OrdenaDataSet` `uComunPesquisaRel.pas:497-579` |
| Filtro digitado na coluna | digitar sobre a coluna focada acumula o texto (maiúsculo; `+`→espaço; Backspace apaga), posiciona (`FindNearest`) e **filtra a grade**: texto `like '%x%'` ou `'x%'` (**F6 alterna** "Em qualquer lugar"/"Comeca com"), número e data por igualdade (data só com 10 caracteres); realce amarelo; rótulo "Filtro aplicado a coluna X Em qualquer lugar "TXT"" | `DbGridDadosKeyPress` `:1143-1247`, `DBGridDadosKeyDown` `:1119-1122`, `UClassGrid.pas:25-174` |
| Cor + legenda | regras `cdsColoracao` (CAMPO, OPERACAO `=`/`<>`/`>`/`<`/`NULL`/`NDIAS` + `OPERACAO_NDIAS`, VALOR, COR, LEGENDA); **a 1ª que casa** pinta a fonte da linha; legenda numa grade à parte | `:969-1113`, `GetColor` `:1844-1865`, `:1696-1714` |
| Linha marcada | negrito; seleção azul-céu | `:1098-1106` |
| Rodapé | "N registros." / "1 registro." / "Nenhum registro encontrado." + "Filtro obrigatório: …" (o texto troca `AND`→`"E"`, `OR`→`"OU"`, apaga `IN` — **em qualquer lugar da string**: `FORNECEDOR` vira `F "OU" NECED "OU"`; cosmético, não copiar) | `btnLocClick` `:682-709` |
| Layout salvo | se existir `<VIEW>[<op>].TXT` (do F4) com o mesmo nº de colunas, carrega ordem/larguras; senão descarta | `:2317-2356` |

**As regras de cor (51 units) `[fonte]`** — as que importam para as telas já no Apollo:

| tela (unit) | regras (ordem = prioridade) |
|---|---|
| Produtos (`UCadProduto.pas:6302-6318`) e ~15 lookups de produto | `ATIVO='N'` vermelho "Produto Inativo" · `PROMOCAO='S'` azul "Produto em promoção" |
| Parceiros (`uCadClientes.pas:3785-3810`) | `BLOQUEADO='S'` vermelho "Parceiro Bloqueado" · `ENDERECO_ATIVADO='N'` roxo "Endereco Desativado" · `DATA_ULTIMA_COMPRA` há mais de 35 dias azul |
| NF (`uNF.pas:6211-6283`) | `STATUS_NFE` = ENVIADA A RECEITA azul / CANCELADA NA RECEITA vermelho / DENEGADA NA RECEITA **AMARELO** / ENVIADA EM CONTINGENCIA azul / CANCELADA EM CONTINGENCIA vermelho · `PROCESSADA='S'` verde · `OBS_NF<>''` fúcsia "NFe com Obs" · `NF_IMPORTACAO_NFE` = S roxo "NFe Importada" / T azul-petróleo "Transferência entre lojas" |
| A pagar (`uAPagar.pas:2692-2708`; idem `UBaixaApagar`) | `BLOQUEIO='S'` vermelho "Compromisso bloqueado" · `FORNECEDOR_POSSUI_DEBITO='S'` azul |
| A receber (`uCadAReceber.pas:2612-2636`) | `QUITADA='S'` verde "Liquidada" · `REGISTRO_ARQ_REMESSA='S'` roxo "Boletos Bancários emitidos" · `DATA_VENCIMENTO < hoje` vermelho "Vencida" |
| Pedido de compra (`uPedidoCompra.pas:735-760`) | `FECHADO='S'` vermelho "Pedido baixado" · `BONIFICACAO='S'` azul · `DT_VENCIMENTO < hoje` **verde** "Pedido vencido" |
| Família (`UCadFamiliaProd`) · Perfil · Agenda prev. pagto | `ATIVO='N'` vermelho "… Inativa/o" |

Achados `[produção]`/`[fonte]`: (1) `GetColor` não conhece **`AMARELO`** nem **`PRETO`** (usados em NF denegada,
CT-e, manifesto, etiquetas) ⇒ pintam **preto** — a "NFe Denegada" não se destaca. (2) Na view de parceiros **não existe
`ENDERECO_ATIVADO`** (é `ENDERECO_ATIVO`, 829 'N') ⇒ a regra roxa nunca casa. (3) `BLOQUEADO='S'` em 13.900 dos 19.149
parceiros (72,6%) — a maioria da grade de parceiros sai vermelha; última compra > 35 dias em 2.004. (4) O status salvo
mostra a legenda visível em GET_APAGAR, GET_PARCEIROS e GET_NF — coerente com o fonte.

---

## 6. Multisseleção, totalizador, detalhes e retorno

### 6.1 Multisseleção (`HabilitaMultiselecao`, 73 units)

Liga a coluna `SELECIONAR`, a barra de progresso e o contador "N registros selecionados" (`:2616-2624`). Espaço
marca/desmarca e desce (`:1253-1273`); clique na coluna `SELECIONAR` alterna; **botão direito** nela ou **T** com ela
focada marca/desmarca **todos** (`:1275-1303`, `:1307-1361`, `MarcarDesmarcarTodos` `:1924-1954`); duplo clique marca a
linha e confirma (`:959-967`). Uso típico: escolher vários produtos/parceiros/títulos para um filtro de relatório ou uma
operação em lote (lote de cobrança, custódia de cheques, baixa de cartão, histórico FGF…), quase sempre com
`ClonarDatasetCodigos` (79 units).

### 6.2 Totalizador (`cbbCamposSoma` + `edtTotal`)

Só aparece com multisseleção ou `TotalizaFinanceiro` (`:1589-1591`); lista **só colunas NUMERIC** (`:1657-1659`). Com
multisseleção soma as marcadas (incremental, `:2635-2650`; recalcula ao trocar a coluna, `:340-374`); com
`TotalizaFinanceiro` soma tudo ao abrir (`:2395-2399`). `TotalizaFinanceiro` ligado em **A pagar**
(`uAPagar.pas:2689`, `uCadAPagar.pas:524`) e **A receber** (`uCadAReceber.pas:2585`). `[produção]` visível nos status
salvos de GET_APAGAR, GET_APAGAR_AGRUPAR, GET_CARTAO (baixa) e GET_PRODUTOS (agenda, verificação tributária).

### 6.3 Atalhos de detalhe (`cdsDetalhes` + `lblAtalho`, `GetDetalhes` `:1867-1907`) — 9 units

Cada linha liga uma tecla (`ATALHO` = código virtual) a `SELECT <campos> FROM <tabela> WHERE <chave detalhe> = <valor
da linha> <condição>`, aberto numa janela de consulta com título "<código> - <auxiliar> - <descrição>"
(`:1571-1578`). Na pesquisa de **produtos** (`UCadProduto.pas:6332-6391`, rótulo `:6393`):

| tecla | consulta |
|---|---|
| F8 (119) | preços por loja: `MULTI_PRECO` (IDEMPRESA, VRVENDA, PROMOCAO, VRPROMO) |
| F9 (120) | códigos auxiliares: `CODAUXILIAR` (CODAUXILIAR, FATOREMB) |
| F10 (121) | estoque por loja: `ESTOQUE` × `MULTI_PRECO` (qtde, mínimo, máximo, custos, venda) |
| F11 (122) | estoque do depósito: `ESTOQUE_DEP` |
| F12 (123) | estoque de produção: `ESTOQUE_PROD` |

O mesmo conjunto (ou parte) nas pesquisas de produto do pedido de compra, itens da NF, digitação de pedidos, cotação,
operações contábeis, transferência e análise de concorrentes; na NF, F10 = itens da troca / do inventário. ⚠️ F10 também
liga o "copiar consulta" (`FormKeyDown`, `:1490`) — as duas coisas acontecem juntas.

### 6.4 Confirmar e ⚠️ o cadastro navega sobre o resultado

Enter na grade (`:1124-1125`), duplo clique ou **&OK** (`btnOKClick`, `:719-793`). Copia o resultado para o dataset de
códigos (`GetCodigos`, `:1778-1841`) em um de três modos: **padrão** (todas as linhas; só as marcadas se multi) ·
`ClonarDatasetCodigos` (idem, posicionado no registro) · `ClonarLinha` (só a linha corrente, com todas as colunas; 13
units, ex. cidades). Preenche `Retorno1` (padrão `CODIGO`) e `Retorno2` (descrição), respeitando o tipo do controle;
guarda **todas as colunas** em `RetornoUnicoPesquisa`. Sem memória: "O sistema não possui memória suficiente para esta
operação. Tente fazer um filtro que retorne menos registros." (`:733-739`).

O `cdsNavegation` do cadastro **é** o resultado da Pesquisa (§2.1 item 4). As setas do `edtCodigo` (←/→
anterior/próximo, ↑/↓ primeiro/último — `uCadMaster.pas:870-883`) e o `DBNavigator` (`:718-737`) andam **nessa lista,
na ordem da grade**. Antes de qualquer pesquisa a lista está fechada e as setas não fazem nada.

---

## 7. O resto da tela

### 7.1 Imprimir e etiquetas

- `cbbRelatorios` ("Configurações de impressão salvas") lista os arquivos de `<aplicação>\Report\` cujo nome contém
  `<VIEW>_` (`PercorreOrigem`, `uComunPesquisaRel.pas:581-614`; `:1689-1694`) — os relatórios salvos do construtor
  para a view. **&Imprimir** (`:570-665`) abre o construtor com filtro padrão = filtro obrigatório **+ `CAMPO_RETORNO
  IN (<marcados>)`**; com mais de 2.000 marcados ignora a marcação (desmarca e imprime pelo filtro). `[produção]` há
  relatório salvo para GET_APAGAR, GET_APAGAR_AGRUPAR, GET_CARTAO, GET_CARTAOBX, GET_PRODUTOS e GET_NF.
- **&Etiquetas** (`:423-568`; `FEtiqueta` em Produtos — `UCadProduto.pas:3737-3738`, tipo 0 —, Parceiros e Associados —
  tipo 1 — e Promoção acumulativa): manda **todas** as linhas do resultado (não só as marcadas) para a tela de
  etiquetas — produto com CODBARRA, DESCRICAO, preço (`VRPROMO` se `PROMOCAO='S'` e o ramo não é 'O', senão
  `VRVENDA`), VRCUSTO, qtde 1 e promoção acumulativa; parceiro com endereço completo, CNPJ/IE, fone, e-mail.

### 7.2 Exportar e depurar

Na grade: **Ctrl+A** Excel, **Ctrl+B** CSV em `<aplicação>\<VIEW>.csv`, **Ctrl+X** TXT de lançamentos contábeis (o hint
só aparece em `GET_DIARIO`, a tecla vale em qualquer view) — `:1127-1138`. **F10** liga "copiar a próxima consulta para
a área de transferência" (`:1490`, `:2249-2250`) — ferramenta de suporte.

### 7.3 Três memórias diferentes (não confundir)

| | **F4 — `SalvaConfig`** | **última consulta (↑)** | **Ctrl+Shift+S / D — status da tela** |
|---|---|---|---|
| onde grava | **arquivo local** `<aplicação>\Configuracoes_Pesquisa\<VIEW>[<CODOPERADOR>].XML` + `.TXT` (layout da grade) — **não é tabela** | arquivo local `…\Configuracoes_Pesquisa\Consultas\<VIEW>[<CODOPERADOR>].XML` | **banco**, `CONFIG_STATUS_TELA` (26 linhas) |
| quando | F4 (pergunta se substitui) | ao fechar, se houve filtro e resultado (`FormClose` `:1407-1429`) | Ctrl+Shift+S (`uMaster.pas:496-503`) / D apaga (`:506-513`) |
| o quê | campo + operação; coluna do totalizador (`SOMATORIO`); coluna ordenada (`ORDENACAO`); layout das colunas | os filtros (`cdsFiltros`) + a **linha onde estava** (`RECNO`) | o estado de **todos** os controles: campo, operação, **valor digitado** (`edtTexto`, datas, números), coluna do totalizador, relatório, painéis visíveis |
| chave | view (+ operador) | view (+ operador) | operador + `FORMULARIO_PAI` + `VIEW_PESQ` + `RETORNO1_PESQ` (a mesma view abre diferente por tela e por campo de retorno) |
| como volta | ao abrir: campo/operação/soma/ordenação padrão (`:1601-1648`); layout na consulta (`:2317-2356`) | **↑ no campo de valor** recarrega e pesquisa: 1 filtro → recompõe campo/operação/valor; vários → liga F7 (`SendKeys('{F7}')`); volta à linha (`:2039-2083`, `:2358-2367`) | ao abrir, por último (`RecuperarStatus`, `:1769-1775`): repõe os controles, **repete os eventos** de troca de campo e operação (recria o frame) e repõe os valores; **não pesquisa** |
| fonte | `:2464-2525` | `UFrameGeral.pas:129-138` | `uConfigStatusTela.pas` |

Detalhes que importam:

- **Por operador** depende de "SALVAR CONFIGURAÇÃO DE PESQUISA POR USUÁRIO" (`udmConfigura.pas:353-354`); na produção a
  configuração `CONFIGURACOES.SALVAR_CONFIG_PESQUISA_POR_USUARIO` = **`S`**. Os dois arquivos ficam **no disco da
  estação** — o mesmo problema que o `grade-layout.md` resolveu para o F8/F9.
- **F4 só grava o `.TXT` do layout ao substituir** um arquivo que já existia (`:2513-2523`): a 1ª gravação perde o
  layout. Bug do legado.
- **Status (Ctrl+Shift+S) guarda o ÍNDICE da combo** (`uConfigStatusTela.pas:236-264`), e a combo é alfabética: quando a
  view ganha coluna, o índice aponta para outra. Conferido hoje: **7 de 15** índices salvos já apontam para a coluna
  errada (GET_PARCEIROS salvo 48/49 = "Razao" → hoje 48 é `PERFIL`, Razao é 50; GET_APAGAR 50 "Vencimento" → hoje
  `VALORISSQN`; GET_CARTAO 25 "Operadora" → `NSUHOST`). O **binário novo** grava também o texto (`valorAuxiliar`:
  "Razao", "Em Qualquer Lugar") — 20 das 26 linhas têm; as 6 de 2020-2021 não. O fonte de 2020 não tem esse campo.
- **Ctrl+Shift+D apaga a linha errada** `[fonte]`: `ApagaConfigNoBd` (`uConfigStatusTela.pas:929-964`) filtra só
  `IDOPERADOR + FORMULARIO='frmPesquisa'` (sem form pai/view/retorno) e apaga **a primeira que vier** — o operador 84 tem
  10 status salvos; D em qualquer pesquisa apaga um deles ao acaso. (Pode ter sido corrigido no binário novo; não há como
  provar daqui.)
- Datas do frame voltam **fixas** (um status de 2024 reabre com 28/03/2024, não com hoje).
- Precedência na abertura: `SetDefault` do chamador → arquivo do F4 → **status do banco por cima**.

### 7.4 Ins / F2 — abrir o cadastro da view (`:1534-1567`, `CreateForm` `:875-931`)

Com o par em `TABELA_CADASTRO` (e se o cadastro não for a própria tela que abriu a Pesquisa): **Ins** abre o cadastro
vazio; ao gravar, a grade recarrega **mostrando só o registro novo**. **F2** abre o cadastro no registro da linha; ao
voltar, **atualiza só aquela linha** (`AtualizaRegistro`, `:2719-2756`). Exige `PossuiAcessoForm(<form>)` ("Operador
não possui acesso ao formulário solicitado").

`[produção]` `TABELA_CADASTRO`: 164 linhas para **107 views**, sujas — **51** com nome de instância numerada
(`frmCadProduto_7`, quando o form foi aberto duas vezes) e **26** com `TABELA = 'GET_'` (cadastro aberto antes de
definir a tabela); `GET_PRODUTOS` tem 19 linhas. O `select FORM … where TABELA = …` pode devolver um nome que não é
classe (Ins/F2 falha com "Formulário não encontrado"). No alvo: mapa estático view → rota. ⚠️ Corrige o `uCadBancos.md`
§4 Q2, que leu `TABELA_CADASTRO` como "config do form de pesquisa".

### 7.5 Thread de abertura

`JvThreadExecute` (`:1918-1922`) é **código morto**: não há `TJvThread` no `.dfm` e a única chamada está comentada
(`MostraFrame`, `:2697-2700`). Logo `SetDefault(…, AbreDataset=True, …)` (25 chamadas) **não abre nada**; só
`PesquisaSimples` abre carregada.

---

## 8. Situação × excluídos — o que o legado separa e o Apollo junta

| tabela (cadastro) | campo de situação (F6 do cadastro) | `INDR` na tabela | a view `GET_` exclui `INDR='E'`? |
|---|---|---|---|
| PRODUTOS | `ATIVO` (na view: `ATIVO_PELA_MULTIPRECO` = **N** na produção ⇒ `PRODUTOS.ATIVO`) | não | — |
| PARCEIROS | `ATIVADO` | não | — |
| OPERADORES, UNIDADE, BAIRRO, PERFIL, PRECO | `ATIVO` | sim | sim, no `WHERE` da view |
| PLC, MOTIVOS_OPERACAO | — | sim | sim |
| MARCAS | — | sim | não — a view expõe `INDR` e o cadastro soma `COALESCE(INDR,'I')='I'` |
| AGENDA_PROMOCAO | — | sim | não (a view nem expõe `INDR`) |
| PEDIDOCOMPRA | — | sim | dentro da view |
| CONTAS_BANCARIAS, FAMILIAS_PROD, OPERADORAS, SITUACAO_NF | `ATIVO` | não | — |

**Situação = ativo/inativo do negócio (`ATIVO`/`ATIVADO` S/N). Excluído (`INDR='E'`) nunca aparece.** O Apollo
(`crud-engine.service.ts`, `list`) faz outra coisa: `situacao` só age com `softDelete` e vira `INDR` — "inativos" =
`INDR='E'` **mostra os excluídos** (marcas, plc, unidade, operadores, …) — e em produtos/parceiros (sem `softDelete`) a
situação é **ignorada**: a Pesquisa diz "Situação: Ativos" e lista também os inativos.

---

## 9. O Apollo hoje × o legado (gap item a item)

O que existe: `apps/web/src/shared/cadmaster/Pesquisa.tsx` (157 linhas, Modal + `DataTable`), usado pelos **26
cadastros** com `<CadMaster colunasPesquisa=…>`; `resourceApi.listar` → `GET /<recurso>?…`; `crud-engine.service.ts:52-101`
(`list`: `selectAll` da view, empresa, situação→INDR, **um** campo+operador+valor em whitelist com 6 operadores,
`orderBy`, **`limit(min(limite ?? 200, 500))`**). Testes: `apps/web/test/pesquisa.spec.tsx` (5 casos: carrega, clique
seleciona, F6 situação, F3/F5, Esc).

| # | item | Apollo | estado | o que a falta faz no uso |
|---|---|---|---|---|
| 1 | Achar qualquer registro da view | lista os **200 primeiros, sem ordem**, e filtra no navegador | **falta (crítico)** | produto/parceiro/NF/título fora dos 200 não é achado; a busca diz "nenhum" e o registro existe. GET_PRODUTOS 17,3 mil ativos por loja, GET_PARCEIROS 19.149, GET_NF 50.109, GET_ARECEBER 18.493 |
| 2 | Situação (F6 do cadastro) = `ATIVO`/`ATIVADO`; excluído nunca aparece | situação→`INDR`; ignorada sem `softDelete` | **errado** | produtos/parceiros "Ativos" trazem inativos; F6 "Inativos" em marcas/plc/unidade/operadores mostra **excluídos** |
| 3 | Filtro obrigatório por tela (lista de condições; lojas do operador; aberto/quitado; tipo da NF) e as opções antes da Pesquisa (A pagar, A receber) | `filtroExtra`: **uma** condição, no mesmo slot campo/valor da API; só NF (tipo) e Parceiros (papel) usam | **falta** | A receber/A pagar/Pedido de compra/Operadores listam fora do recorte do legado (outras lojas, quitados, pedidos fechados, operadores de outra empresa) |
| 4 | Campo (todas as colunas, alfabético) + operação por tipo + valor, no servidor | busca global + filtros de coluna do DataTable, só no navegador; API com 6 operadores | parcial | faltam Terminado com, Entre, Contido em, `''`→vazio/nulo, `+`→várias palavras, data padrão hoje, código de barras pelo código auxiliar; nada disso chega ao banco |
| 5 | Todas as colunas da view | 2 a 11 colunas escolhidas à mão; views do destino reescritas | parcial | GET_PRODUTOS 95→11 colunas, GET_PARCEIROS 61→17, GET_NF 49→17, GET_ARECEBER 65→35, GET_APAGAR 53→28, GET_EMPRESAS 24→13 |
| 6 | Cadastro navega sobre o resultado (←/→/↑/↓) | `useCadMaster` navega a tabela inteira por PK, via `listar` **também cortado em 200** | **errado** | ↓ "último" vai ao 200º código; as setas não seguem a pesquisa |
| 7 | Campo/operação/ordenação de abertura por tela (`SetDefaultPesquisa`) | — (primeira coluna da lista do DataTable) | falta | Produtos não abre em Descrição; NF não abre em Parceiro; A pagar não ordena por vencimento |
| 8 | F6 **dentro** da Pesquisa = modo do filtro digitado na coluna | F6 = situação | divergente | tecla com outro significado; no legado a situação se escolhe no cadastro, antes do F3 |
| 9 | Confirmar = Enter / duplo clique / OK | **clique simples** já seleciona e fecha (Enter na linha também, pelo DS) | divergente | clique para "olhar" uma linha fecha a janela |
| 10 | Ordenar (título, Alt+H, ordenação inicial) | ordenação do DataTable sobre os 200 | parcial | ordena só o recorte |
| 11 | Filtro digitado na coluna + F6 + realce | busca global do DataTable | parcial | sem "começa com", sem realce, sem foco por coluna |
| 12 | Filtros acumulados (F7, Alt+Del, F5) | vários filtros do DataTable (cliente); F5 limpa busca **e** filtros | parcial | no legado o F5 não apaga o texto do campo |
| 13 | Cor + legenda (regras por tela, §5) | — (DS tem `getRowClassName`) | falta | inativo, bloqueado, vencido, NF cancelada/processada não se distinguem |
| 14 | Atalhos de detalhe F8-F12 (preço, cód. auxiliar, estoques) | — | falta | o comprador perde a consulta rápida de preço/estoque de dentro da pesquisa de produto |
| 15 | Multisseleção (Espaço, T, botão direito, contador) | — (DS tem `selectionConfig`) | falta | lotes e filtros de relatório |
| 16 | Totalizador (A pagar, A receber, multi) | — (DS tem `showTotalizers`) | falta | soma de títulos na pesquisa |
| 17 | Repetir a última pesquisa (↑, volta à linha) | — | falta | |
| 18 | F4 (campo/operação/soma/ordenação + layout) | — (há `grade_layout`/`gradeLayoutService` pronto) | falta | |
| 19 | Ctrl+Shift+S/D (status por operador × tela × view × retorno) | tabela `config_status_tela` criada e carregada (mig 412); sem endpoint nem tecla | falta | os 26 status da produção não voltam |
| 20 | Imprimir relatório salvo da view (+ IN dos marcados) | — (construtor existe: fontes = views) | falta | |
| 21 | Etiquetas (Produtos, Parceiros) | — (feature `etiqueta` existe) | falta | |
| 22 | Exportar Excel/CSV (Ctrl+A/B), TXT contábil (Ctrl+X) | — (DS tem `enableExport`) | falta | |
| 23 | Ins / F2 (abrir o cadastro da view) | — | falta | |
| 24 | Título "Pesquisa <comentário da view>" · rodapé "N registros" + filtro obrigatório | "Pesquisar" fixo, sem rodapé | falta (menor) | |
| 25 | F3 (limpa e foca o valor), Esc | tem | ok | |
| 26 | Lista rolável inteira | paginação de 10 | divergente (UX) | |

Fora deste componente, mesma raiz: `useResourceOptions` (38 telas, lookups em `SelectField`) chama `listar` sem
`limite` ⇒ **200 opções** (vendedor, convênio, fornecedor…), onde o legado abria a Pesquisa (GET_PARCEIROS é a view mais
chamada como lookup: 149 vezes). E várias telas que no legado usam a Pesquisa no cadastro (`GET_SCRAP`, `GET_CARTAO`,
`GET_CAIXA`, `GET_AGENDA_PROMOCAO`, cotação, adiantamento) no Apollo têm lista própria na página, sem campo+operação.

---

## 10. Dados da produção que sustentam as regras

| fato | número | consulta |
|---|---|---|
| views `GET_` | 417 (198 com comentário, 193 começando com `;`) | `user_views`, `user_tab_comments` |
| `TABELA_CADASTRO` | 164 linhas · 107 views · 51 instâncias numeradas · 26 `GET_` vazios | `tabela_cadastro` |
| `CONFIG_STATUS_TELA` | 26 linhas, **todas `frmPesquisa`**, 8 operadores (84: 10, 1: 8, 59: 3), última 10/01/2026 | `config_status_tela` |
| operações salvas | Em Qualquer Lugar 11 · Igual a 6 · Entre 2 · Diferente de 1 · sem texto (2020-21) 6 (uma é "Contido em", GET_NF) | JSON `cbbOperacao` |
| índice salvo que já aponta para outra coluna | 7 de 15 conferidos | `user_tab_cols` em ordem de nome |
| `SALVAR_CONFIG_PESQUISA_POR_USUARIO` · `ATIVO_PELA_MULTIPRECO` · `PESQUISA_PRODUTO_MOSTRA_CAMPOS` | `S` · `N` · vazio | `configuracoes` |
| GET_PRODUTOS | 47.811 linhas por loja (1, 2, 51, 52) + 12.871 (50); ~17,3 mil ativas por loja; 95 colunas | |
| GET_PARCEIROS | 19.149; ATIVADO='N' 906; BLOQUEADO='S' 13.900; ENDERECO_ATIVO='N' 829; última compra > 35 d 2.004; 61 colunas | |
| outras | GET_NF 50.109 · GET_ARECEBER 18.493 · GET_PEDIDOCOMPRA 14.761 · GET_APAGAR 7.799 · GET_SCRAP 3.822 · GET_AGENDA_PROMOCAO 3.766 · GET_CARTAO 323.198 | `count(*)` |

**Quais views mais usadas.** A Pesquisa não passa pelo menu (não está na `MENUEXPRESS`) e o AWR não guardou nenhum dos
SQLs dela (`dba_hist_sqltext` = 0). Três medidas indiretas:

1. **Chamadas no código** (§2.2): GET_PARCEIROS 149 · GET_FAMILIAS_PROD 97 · GET_PRODUTOS 85 · GET_SITUACAO_NF 67 ·
   GET_PLC 56 · GET_PLANO_CONTAS 52.
2. **Acessos ao cadastro dono da view** (`MENUEXPRESS`, soma de ACESSOS / operadores distintos, cruzado com
   `TABELA_CADASTRO`): GET_NF 55.892/61 · GET_SCRAP 52.429/54 · GET_PEDIDOCOMPRA 43.043/26 · GET_PRODUTOS 38.638/58 ·
   GET_AGENDA_PROMOCAO 31.198/47 · GET_PARCEIROS 21.069/57 · GET_ARECEBER 8.169/42 · GET_CAIXA 5.063/31 · GET_CARTAO
   4.347/18 · GET_PEDIDO_DEVOLUCAO_COMPRA 2.529/30 · GET_OPERADORES 1.815/41.
3. **Aberturas de hoje** (a consulta de metadados roda uma vez por abertura; V$SQL de 07/10/2026, 08:16-15:25):
   GET_CARTAO 36 · GET_PARCEIROS 12 · GET_MOTIVOS_OPERACAO 9 · GET_AGENDA_PROMOCAO 7 · GET_RCB 4 · GET_APAGARBX 3 ·
   GET_PLC 2 · GET_APAGAR 2 · GET_PRODUTOS 1 · GET_SITUACAO_NF 1 · GET_CONTAS_BANCARIAS 1. É um dia — para uma medida
   firme, rodar um vigia de V$SQL por uma semana (só leitura).

---

## 11. Teclas (todas)

| onde | tecla | faz | procedência |
|---|---|---|---|
| form (base) | Esc | fecha | `uMaster.pas:467` |
| form (base) | Enter | vira Tab fora das grades (no campo de valor ⇒ pesquisa) | `uMaster.pas:521`; `UFrameGeral.FrameExit` |
| form (base) | Alt+← | controle anterior | `uMaster.pas:485` |
| form (base) | Ctrl+E | troca de empresa (herdado; vale com a Pesquisa aberta) | `uMaster.pas:472` |
| form (base) | Ctrl+Shift+S / D | salva / apaga o status | `uMaster.pas:496`, `:506` |
| form | F3 | limpa o valor e põe o foco nele | `uPesquisa.pas:1485` |
| form | F10 | liga/desliga "copiar a próxima consulta" | `:1490` |
| form | F5 | limpa os filtros acumulados | `:1503` |
| form | F7 | liga/desliga vários filtros | `:1509` |
| form | F4 | salva a configuração (arquivo) | `:1518` |
| form | Alt+H | ordena pela coluna focada | `:1522` |
| form | Ins | abre o cadastro da view para incluir | `:1534` |
| form | F2 | abre o cadastro no registro da linha | `:1547` |
| form | F8-F12 (os `ATALHO` do chamador) | detalhe (preço, cód. auxiliar, estoques) | `:1571`; `UCadProduto.pas:6332-6393` |
| rótulos | Alt+C / Alt+P | foco em Campos / Operação | `.dfm` `&Campos`, `O&peração` |
| botões | Alt+O / Alt+I / Alt+E | OK / Imprimir / Etiquetas | `.dfm` |
| campo de valor | ↑ | repete a última pesquisa | `UFrameGeral.pas:133` |
| grade | Enter | confirma | `:1124` |
| grade | F6 | filtro da coluna: em qualquer lugar ↔ começa com | `:1119` |
| grade | Ctrl+A / Ctrl+B / Ctrl+X | Excel / CSV / TXT contábil | `:1127-1138` |
| grade | letras, dígitos, `/ . , - +`, Backspace | filtro digitado na coluna | `:1143`, `UClassGrid.pas:102` |
| grade | Espaço | marca/desmarca e desce (multi) | `:1253` |
| grade | T (na coluna Selecionar) | marca/desmarca todos | `:1275` |
| grade (mouse) | título / duplo clique / botão direito em Selecionar / clique em Selecionar | ordena / confirma / todos / alterna | `:1363`, `:959`, `:1313`, `:1343` |
| grade de filtros | Alt+Del | remove o filtro | `:1391` |

O `mapa-de-teclado.md` (linha do `FRMPESQUISA`) traz F6 como "situação" no Apollo — é a divergência do item 8 do §9. O
`tools/teclado/mapa-teclado.json` não tem as teclas das grades, a ↑ do frame nem os F8-F12 dos chamadores.

---

## 12. Proposta de cortes (ordem = valor para o operador)

> Dependência explícita: o **status da tela (Ctrl+Shift+S/D) só faz sentido depois do campo + operação + valor** — ele
> salva justamente a combo de campo (alfabética, todas as colunas da view), a combo de operação (lista por tipo) e o
> valor do frame. Por isso vem no corte E, depois de A e B.

**A — Achar o registro (servidor, fiel, com o recorte de cada tela)**
Entra: a Pesquisa consulta o servidor a cada pesquisa (DataTable em modo `fetchData`): campo + operação + valor no
banco, sem teto silencioso de 200 (paginação/virtualização sobre o total, com aviso se o volume exigir filtro); os 9
operadores com as regras do §3.4 (incluindo `''`→vazio/nulo, `+`→várias palavras, Contido em, Entre, data padrão hoje,
número vazio = 0 — este último **decidir com o usuário**) e o código de barras achando pelo código auxiliar; campo,
operação e ordenação de abertura por tela (§3.5); **situação certa** (coluna de ativo por cadastro: `ATIVO`/`ATIVADO`
S/N; `INDR='E'` sempre fora, nunca exposto); **filtro obrigatório por tela** como lista de condições separada do filtro
do usuário (lojas do operador, aberto/quitado, tipo da NF, empresa do operador…) e as **opções antes da Pesquisa** de
A pagar / A receber; empresa obrigatória onde a view for por loja; Enter pesquisa e leva o foco à grade;
Enter/duplo clique/OK confirmam (clique simples só posiciona); F6 dentro da Pesquisa deixa de ser situação.
Testa: smoke HTTP por operador × tipo (texto/número/data/timestamp) em `get_parceiros` e `get_produtos` com o registro de
código mais alto (fora dos 200 de hoje); golden de SQL dos exemplos vivos (§2.3, §3.4) traduzidos; inventário dos 26
cadastros do Apollo × filtro/padrão do legado (a tabela do §2.1 completa); situação: produto inativo não aparece em
"Sim", excluído não aparece em nada; jsdom das teclas (Enter na grade, duplo clique, F3, F6 ausente).

**B — A view inteira na grade**
Entra: todas as colunas da view (título capitalizado, `_`→espaço, numérico `,0.00`, `CamposInteiros`), combo de campos
alfabética com todas elas; views do destino com as colunas da produção para as mais usadas (GET_PRODUTOS por loja,
GET_PARCEIROS, GET_NF, GET_ARECEBER, GET_APAGAR, GET_EMPRESAS…) — conferidas com `tools/cutover/conferir-views.py`;
ordenar por título/Alt+H; filtro digitado na coluna com F6 e realce; título "Pesquisa <comentário>"; rodapé com o total e
o filtro obrigatório legível.
Testa: conferidor de colunas view-a-view (contagem e nomes = produção); jsdom do filtro digitado + F6.

**C — O resultado volta ao cadastro**
Entra: o retorno (código, descrição e a linha inteira — `RetornoUnicoPesquisa`/`ClonarLinha`); a navegação ←/→/↑/↓ do
`CadMaster` **sobre o resultado da última pesquisa, na ordem da grade** (sem pesquisa, as setas não andam); corrigir o
`garantirNav` (hoje cortado em 200). Aproveitar e tirar o teto de 200 do `useResourceOptions` (ou trocar esses lookups
pela Pesquisa — GET_PARCEIROS, GET_FAMILIAS_PROD, GET_PRODUTOS são os lookups mais chamados).
Testa: `useCadMaster.spec` — pesquisa com 3 linhas fora da ordem de PK, ↓ vai à 3ª da grade, ← volta.

**D — Cores, detalhes e totais (o que o operador lê na grade)**
Entra: cor + legenda pelas regras do §5 (declaradas por tela; `AMARELO`/`PRETO` pintando de fato — **decidir com o
usuário**, o legado pinta preto); atalhos F8-F12 de produto (preço por loja, códigos auxiliares, estoque, depósito,
produção) e F10 da NF; totalizador (A pagar, A receber, e com multisseleção); multisseleção (Espaço, T, botão direito,
contador; só as marcadas no retorno).
Testa: jsdom — linha com `ATIVO='N'` recebe a classe vermelha e a legenda aparece; F10 abre o estoque do produto da
linha; soma = soma das marcadas; regra NDIAS com data fixa.

**E — Abrir do meu jeito: F4, status (Ctrl+Shift+S/D), vários filtros e última pesquisa** — depende de A e B
Entra: F4 = campo + operação + soma + ordenação + layout (reusar `grade_layout`); Ctrl+Shift+S/D = `CONFIG_STATUS_TELA`
por operador + tela que abriu + view + campo de retorno, repondo campo, operação e valor **sem pesquisar**; resolver a
combo pelo **texto** (`valorAuxiliar`) e só cair no índice alfabético quando o texto não existir (6 linhas de 2020-21); o
D apaga **só** o status daquela chave (o legado apaga a 1ª do operador — **decidir com o usuário** corrigir);
precedência chamador → F4 → status. F7 (filtros acumulados, Alt+Del, F5 só dos filtros) e a última pesquisa por operador
× view **no servidor** (não no disco), com ↑ no valor repetindo e voltando à linha.
Testa: carregar os 26 status da produção e abrir cada combinação (form pai × view × retorno): campo/operação esperados =
`valorAuxiliar`; S grava, D apaga só a sua; jsdom F7/Alt+Del/F5; smoke da última consulta.

**F — Saídas e atalhos**
Entra: Imprimir com os relatórios salvos do construtor cuja fonte é a view (filtro obrigatório + `IN` dos marcados, teto
de 2.000); Etiquetas (todas as linhas do resultado; produto e parceiro); exportar Excel/CSV; TXT contábil em GET_DIARIO;
Ins/F2 com mapa estático view → rota do cadastro e a linha atualizada na volta; F10 (copiar a consulta) só se o usuário
quiser.
Testa: e2e imprimir de GET_APAGAR com 2 marcados; Ins cria e a grade mostra só o novo; F2 edita e a linha muda.

---

## 13. Contradições com o que estava suposto, e decisões para o usuário

1. **O F4 (`SalvaConfig`/`cdsConfig`) não grava em tabela**: grava arquivos `.XML`/`.TXT` no disco da estação. O que
   grava no banco é o Ctrl+Shift+S (`CONFIG_STATUS_TELA`).
2. **Não há thread de abertura** (`JvThreadExecute` morto) e **não há limite** na consulta (nem `ORDER BY`).
3. **O status salva mais que campo + operação**: salva o valor digitado, as datas (fixas), a coluna do totalizador, o
   relatório e os painéis. E salva o **índice** da combo, que deriva (o texto só no binário novo).
4. **Situação ≠ INDR**: F6 do cadastro é `ATIVO`/`ATIVADO`; excluído nunca aparece. O Apollo mistura (§8).
5. **F6 dentro da Pesquisa** é o modo do filtro da coluna, não a situação.
6. **Não existe frame de "lista"**: um frame só, com páginas texto/valor/data/data-hora; "Contido em" é texto com
   vírgulas.
7. `TABELA_CADASTRO` é o mapa view→cadastro do Ins/F2, não configuração da Pesquisa (corrige `uCadBancos.md`), e está
   classificada como `AUX` em `tools/cutover/conferir-tabelas-fora.py:51` — pela regra "todos os campos", **decidir** se
   entra na carga ou se o mapa estático basta.
8. **Decidir**: (a) número vazio pesquisar `= 0` como o legado; (b) Ctrl+Shift+D apagar a 1ª linha do operador (bug) ou
   só a da chave; (c) o rodapé que mutila `AND/OR/IN`; (d) F4 que perde o layout na 1ª gravação; (e) maiúsculas — o
   legado não acha dado minúsculo, o Apollo acha; (f) cores `AMARELO`/`PRETO` que o legado pinta de preto; (g) a regra
   roxa de parceiros que aponta para uma coluna inexistente; (h) F10 que abre o estoque **e** liga o "copiar consulta".

## 14. Pendências de runtime

- Quais cadastros mudaram o padrão/filtro/cores no binário novo (o fonte é de mai/2020): conferir, tela a tela, os 26
  cadastros do Apollo contra a produção (V$SQL do `as Selecionar` + legenda na tela) no corte A.
- O mapeamento Oracle→tipo da tela (NUMBER com escala 0 ⇒ INTEGER?) — `UadaptadorBanco` ausente.
- Uma semana de vigia do V$SQL (`as Selecionar` + consulta de metadados) para o ranking firme de views.
