# CONSULTORIA APOLLO (`FRMCONSULTORIAATM`) — recon e corte-1

`uConsultoriaATM.pas` (1.240 linhas). 440 acessos no cliente.

## 1. A tela não tem lista de relatórios

Ela **varre o disco**: monta o combo com os arquivos `Relatorios\at&m_*.fr3` que encontrar
(`uConsultoriaATM.pas:389`), tira o prefixo e a extensão e mostra o que sobrou. Em produção existem **15
layouts distintos** (30 linhas em `RELATORIOS`, cada um em DEFAULT e PERSONALIZADO):

| tema | layouts |
|---|---|
| participação dos setores | 4 (+ 2 gráficos) |
| participação de seções | 2 |
| participação de grupos | 2 |
| rentabilidade da família | 3 (cheia, simplificada, totais) |
| ranking geral por famílias | 1 |
| faturamento × rentabilidade | 1 |

**Todos giram em torno da mesma coisa**: participação e rentabilidade por nível da árvore de famílias. Por
isso o corte-1 não porta "um relatório" — porta **o cálculo**, parametrizado pelo nível.

## 2. A árvore, medida em produção

`FAMILIAS_PROD.TIPO`: **D** departamento (34) · **G** grupo (92) · **S** seção (520) · P (1.817, o produto) ·
E/O/R (8 no total). E `PRODUTOS` aponta para os três níveis: `CODDPTO`, `CODGRUPO`, `CODSUBGRUPO` — 21, 93 e
481 valores distintos em uso. Um único `GROUP BY` trocando o campo cobre setor, grupo e seção.

## 3. As contas do legado (`ParticipacaoSetor`, `:469-560`)

| conta | regra |
|---|---|
| acréscimo | só a parte **positiva** de `DESC_ACRE_MEDIO` e `DESC_ACRE_ITEM` |
| desconto | `DESC_PROMOCAO + DESC_DEPARTAMENTO` **mais** a parte negativa daqueles dois, invertida |
| venda | `QTDE × VRVENDA` — **arredonda** se o item é por peso (`IAT = 'A'`), **trunca no centavo** se não |
| custo | `QTDE × VRCUSTO` |
| resultado | venda + acréscimo − desconto |
| lucro | resultado − custo |
| **rentabilidade** | lucro / **custo** × 100 — sobre o custo, não sobre a venda |
| cupons | `NROPEDIDO` distintos |

⚠️ **o truncamento**: `TRUNC(x × 100) / 100` no item por unidade é o que faz o relatório fechar com o PDV.
No teste isso se prova pela **quantidade** (3 casas), não pelo preço — `VRVENDA` é `numeric(15,2)` no
destino, então um preço de três casas nem chega a ser gravado. Foi o que me pegou ao escrever o smoke.

**A participação é nossa.** O legado a calcula dentro do `.fr3`; sem ela, a tela chamada "participação de
setores" não mostraria participação nenhuma.

## 4. O que fica

O modo **"Vendas e Notas Fiscais"** (`rdgPesquisa = 1`), que faz UNION com `NF_PROD` para somar o que saiu por
nota; os dois layouts de **gráfico**; e a **previsão** (`PREVISAO`), que é epic próprio.

## 5. Corte 2 (15/10/2026) — a tela do legado, controle a controle

O corte 1 trocou a tela por um seletor de "nível" com um cálculo genérico. A tela do legado é outra — e agora é ela:

| controle | regra (uConsultoriaATM.pas / .dfm) | Apollo |
|---|---|---|
| `rdgPesquisa` "Tipo Consulta" | Vendas / Vendas e Notas Fiscais (soma as notas de venda: CFOP 5102/6102/5402/6402/5403/6403/5405/6405, PROC 'S', TIPO 'S', não canceladas) | ✅ |
| `CmbRelatorio` | os arquivos `at&m_*` (aqui os da RELATORIOS), rótulo sem "at&m"/".fr3", "_"→" ", na ordem do diretório; sem os dois da "rentabilidade da família" (`RemoveRelatorioUsadoEmOutraTela` — têm tela própria) | ✅ `GET relatorios/consultoria/layouts` |
| `EdtCodPLC` (centro de custo) | só no "participacao dos setores"; Pesquisa GET_PLC no tamanho da máscara e de DESPESA; filtra a PERDA (scrap) | ✅ |
| `edtFornecedor` | só no "ranking geral por familias"; maiúsculas; o filtro do frmFiltro (igual / começa / termina / contém / diferente) sobre UPPER(F.RAZAO). Tag 13: num TJvEdit a opção EDTFORNECEDOR (3 concessões) só muda a COR (uMaster :644-700) — não restringe | ✅ (sem RBAC) |
| `CmbRelatorioChange` | limpa centro de custo e fornecedor a cada troca | ✅ |
| Período (`EdtDatInicial/Final`) | o Notebook "Mês/Ano" só no faturamento × rentabilidade | ✅ (período) |
| `btnImprimir` | sem opção própria (65 concessões só da tela) | ✅ |

**As rotinas.** `ParticipacaoSetor` (o RxMemoryData4 = `frxDBDataset4`): por departamento (a DESCRICAO da família do CODDPTO do produto),
faturamento (RESULTADO2), lucro (RESULTADO4), % de cada um no total (RESULTADO1/3), markup e markdown arredondados a 2, cupons e a PERDA
(o custo do scrap do departamento: VR_CUSTO do item ou o custo da loja, contas com NAO_MOSTRAR_SCRAP_REL_PARTSET ≠ 'S') + `PERC_PERDA`.
`RankingFamilias` (o RxMemoryData2 = `frxDBDataset2`): por seção da VENDA (V.CODSUBGRUPO), com os impostos (ICMS de saída pela alíquota
efetiva da UF da empresa − ICMS de entrada nas tributadas + ST + PIS/COFINS) e o período 30 dias antes (margem, lucro e imposto
anteriores); ordem do lucro final (SortOnFields LUCROFIN). "rentabilidade da familia totais" → "Relatório não disponível.".

**Mortos/fora, com prova:** "faturamento × rentabilidade" depende da previsão diária (frmPrevisao → tabela PREVISAO), que tem **0 linhas**
na produção — nunca rodou; fica fora do combo.

**Diferenças deliberadas:** (1) os outros layouts de participação (de grupos, de seções, os "_new", os gráficos) no legado NÃO recalculam
— o `btnImprimirClick` só chama o `ParticipacaoSetor` para o texto exato "participacao dos setores" e os demais imprimem o que ficou no
RxMemoryData4 da última execução (ou nada); aqui cada um recalcula. (2) No ranking, PESO e PARTICIPAÇÃO valem para toda família (o legado
só os preenche dentro do `Locate` do período anterior) e o acumulado segue a ordem do relatório (o legado acumulava na ordem do GROUP BY).

**Pendente — o binário da produção é mais novo que o fonte:** os layouts da RELATORIOS leem campos que o `ParticipacaoSetor` de 2020 não
gera — PRODUTOS, TOTAL_PROD (o clássico), TRANSFORMACAO, USO_E_CONSUMO (os "_new") e, nos analíticos, por produto (IDPRODUTO,
DESCRICAO_PRODUTO, GRUPO, SUBGRUPO, AGRUPA_*, TOTAL_SITUACAO). O SQL vivo não está no shared pool nem no AWR; captura-se quando alguém
rodar a Consultoria no legado (V$SQL). Até lá esses campos saem em branco. Prova: smoke §100.5-8, `consultoriaPage.spec.tsx`.
