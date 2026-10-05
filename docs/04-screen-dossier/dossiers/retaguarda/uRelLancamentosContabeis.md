# LANÇAMENTOS CONTÁBEIS (`FRMRELLANCAMENTOSCONTABEIS`) — completa (corte 2, 05/10/2026)

`UFrmRelLancamentosContabeis.pas` (1.416 linhas) + `UFrmDiferencasDebitoCredito` + `TIntegracaoImportacao` (UIntegracaoContabil.pas).
**377 acessos, 19 operadores.**

## 1. O que a tela é

O razão **por lançamento**: o `SQL_DIARIO` (`:30`) — cada linha do `DIARIO` com as duas contas (a **reduzida** como CONTADEBITO /
CONTACREDITO, a expandida, a descrição e o código interno como COD_INTERNO_*), o histórico (`DESCHIST`), o documento, o complemento,
a origem pelo nome (`ORIGEM_CONTABIL`), a operação, o centro de custo e a empresa, em `ORDER BY TRUNC(DATALAN), CODDIARIO`.

⚠️ não confundir com o **Livro Razão** (`FRMRELRAZAOCONTABIL`): aquele é por conta, com saldo acumulado.

> ⚠️ **O corte 1 (09/2026) era uma versão "inspirada"**: período livre, uma origem só, conta/operação/documento como filtros próprios, só
> a loja do login, e o "Detalhar" resolvido por outro caminho (pela `ARECEBER_BX`/`APAGAR_BX`). O corte 2 refez a tela pelo fonte.

## 2. O período: a árvore de datas (`CriaArvore`, `LocalizaDataArvore`)

Ano anterior e ano atual, cada um com os 12 meses e todos os dias. O nó com lançamento sai em **verde**, o sem em **vermelho**
(`DtvDatasCustomDrawItem`; a consulta é `SELECT DISTINCT DATALAN FROM DIARIO` no intervalo, **sem filtro de empresa**). A tela abre no
dia de hoje e **cada nó escolhido já filtra** (`MtbDatasAfterScroll → BtnFiltrar.Click`): o dia, o mês inteiro ou o ano inteiro
(`GetFiltroData`). "Atualizar datas" refaz tudo.

## 3. Os filtros

- **Origens** (`AdicionaOrigens`): só as de `STATUS = 'S'`, na ordem do código, todas marcadas; **Empresas** (`AdicionaEmpresas`): **todas
  as do cadastro** — o legado não recorta pelas do operador. Marcar/desmarcar todos. Nenhuma marcada = nada (`AND 1 = 2`); todas = sem filtro.
- **"Somente partidas dobradas"** (`GetFiltroPartidaDobrada`): apesar do nome, isola as linhas de **UM LADO SÓ** (débito sem crédito ou
  crédito sem débito) — o rótulo do legado foi mantido, com a explicação ao lado.
- **Filtro auxiliar** (`grpFiltroAuxiliar`, `GetFiltroAuxiliar`): qualquer coluna do `SQL_DIARIO` × as operações do `TPesquisaRelatorio`
  (texto: igual, diferente, começado com, terminado com, em qualquer lugar, contido em; número/data: igual, diferente, entre, maior,
  menor, contido em) sobre a **coluna de saída** (`SELECT * FROM (SQL_DIARIO) WHERE …`). A conta (reduzida, expandida ou descrição) é
  procurada **"tanto no crédito quanto no débito"**. A semântica do valor é a do construtor de relatórios (helper comum
  `shared/relatorios/condicao-pesquisa.ts`).

## 4. O menu

- **Detalhar** (botão e duplo clique, `BtnDetalharDiarioClick`): pelo `TTipoOrigemContabil` — NF (12) pelo IDORIGEM; título de A PAGAR /
  A RECEBER: a **baixa** (15/16) pelo DOCUMENTO, o cadastro/juro/acréscimo/desconto (13/14, 53-58) pelo COMPLEMENTO — o que estiver
  preenchido, senão o IDORIGEM (texto que não é número vira 0, `StrToIntDef`); cheque (52/59/60), cartão (51/61/62) e adiantamento (63)
  pelo COMPLEMENTO ou IDORIGEM; movimento de caixa (64) e redução Z (18) pelo IDORIGEM; convênio (65) pelo DOCUMENTO no a receber
  (TIPODOC 'CONTA A RECEBER') ou no a pagar. O resto: "Não foi possível encontrar o detalhe.". (As funções `GetRcb`/`GetApg` do fonte,
  que o corte 1 usou, **estão declaradas mas não são chamadas**.) A tela abre o documento numa aba; cheque e redução Z não têm tela no
  Apollo e mostram o número.
- **Totais débito/crédito** (`MniTotaisDebitoCreditoClick`): o valor entra no crédito quando há conta de crédito e no débito quando há
  de débito, sobre as linhas carregadas.
- **Diferenças débito × crédito** (`TFrmDiferencasDebitoCredito`): por lote e dia, a soma das linhas só de débito contra a das só de
  crédito, onde não fecham, no período do nó (sem filtro de empresa). "Selecionar lote" lista os lançamentos do lote — o filtro de lote
  **substitui** origens, empresas e "um lado só" (`OutrosFiltros := ' AND D.CODLOTE = …'`). Sem diferença: "Não foram encontradas
  diferenças no período selecionado.".
- **Exportar Excel** (a grade) e **Exportar CSV** (o conjunto inteiro, `GET_DIARIO`): CSV com `;` e BOM.
- **Importar arquivo** (`TIntegracaoImportacao.ImportaLancamentoDiario`): cada linha `[empresa,]data,débito,crédito,valor,(ignorado),"histórico"`
  — empresa opcional (sem ela, a menor do cadastro), contas pelo código **reduzido** (vazio/0 = sem o lado), valor com ponto ou vírgula
  — vira um lançamento de origem **66** com DOCUMENTO "Importação", o operador e a hora; tudo ou nada ("A conta contábil para o código X
  não foi encontrada.").
- **Salvar/restaurar a configuração da grade**: o layout salvo da grade do Apollo (por operador).

## 5. O que não veio, com o motivo

- **Exportar TXT** (`CriarTxt`, com as perguntas "códigos auxiliares?" e "ignorar débito = crédito?" e a máscara CODIEXPANDIDO_FORS): a
  função está em `FuncoesApollo`, que **não está no repositório** (procurado em todo o material, 05/10/2026). Sem o fonte o leiaute do
  arquivo seria inventado — fica bloqueado até o material aparecer.
- **Limite**: o legado carrega tudo (`fmAll`); aqui a consulta para em 50.000 lançamentos e avisa (o ano inteiro de todas as empresas
  passa de 250 mil). Dia e mês, o uso normal da árvore, ficam muito abaixo.

## 6. Dado (medido em 09/09/2026)

`DIARIO.DESCHIST` em 99,99% das 1.750.577 linhas e `ORIGEM_CONTABIL` (35 linhas) vieram na mig 209. `CODCC` e `CODPERIODO` estão
vazias na produção. 4 lançamentos no futuro (2 de 2026, 2 de 07/2027) — ruído de digitação.

## 7. Cobertura (smoke §102, 7 checks)

1. o SQL_DIARIO (conta reduzida × código interno, descrições, origem por extenso) e os totais D×C;
2. origens, "nenhuma", empresas e "só de um lado";
3. o filtro auxiliar (a conta nos dois lados, "em qualquer lugar", "entre", campo inválido);
4. o Detalhar (baixa pelo DOCUMENTO, cadastro pelo COMPLEMENTO, NF inexistente, origem sem detalhe);
5. as origens ativas em ordem, todas as empresas, a árvore com o dia de hoje marcado;
6. as diferenças por lote e o filtro do lote que derruba os outros;
7. a importação (empresa opcional, conta reduzida, valor, tudo ou nada).
