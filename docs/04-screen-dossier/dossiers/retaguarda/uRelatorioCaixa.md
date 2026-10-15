# Relatório de caixa — `FRMRELATORIOCAIXA` (`uRelatorioCaixa.pas` / `.dfm`, `uDmRelatorioCaixa`)

| | |
|---|---|
| **Menu** | Financeiro › Relatório de caixa (MENUEXPRESS) |
| **Permissões (produção)** | `FRMRELATORIOCAIXA` 65 · `BTNIMPRIMIR` 65 (o Imprimir é Tag 1) |
| **Apollo** | `apps/web/src/features/rel-caixa-dre/RelCaixaDrePage.tsx` · API `relatorios/caixa-competencia` (`rel-caixa-competencia.service.ts`) e `relatorios/caixa-dre` (o Anual) |
| **Migrations** | 136 (estrutura do CAIXA) · 206 (`plc.tpconta`) · **427** (BTNIMPRIMIR) |

## 1. A tela do legado — o `cbbRelatorios` escolhe o modelo

| índice | modelo | classe SQL | layout |
|---|---|---|---|
| 0 | Competencia (emissão) | `TRelCompetencia` | conforme o `rdgRelatorio` (abaixo) |
| 1 | Competencia (vencimento) | `TRelCompetencia` | idem |
| 2 | Caixa Baixado (emissão) | `TRelCaixaBaixado` | `Rel_BalanceteRegimeCaixa(.fr3/Detalhado)` |
| 3 | Caixa Baixado (pagamento) | `TRelCaixaBaixado` | idem |
| 4 | Caixa Aberto (emissão) | `TRelCaixaAberto` | idem |
| 5 | Caixa Aberto (vencimento) | `TRelCaixaAberto` | idem |
| (6) | Anual | `GetCaixaAnual` (`aqqCaixaAnual*`) | o frxReport1 do form (`dbAnual`) |

⚠️ **O "Anual" não está nos `Items` do combo no `.dfm`** (só os 6 primeiros) — no fonte de 2020 o `trAnual` não é
selecionável pela tela. Era o único modelo que o Apollo tinha convertido ("Caixa D.R.E.", mig 136). Fica, como a
opção "Anual (D.R.E.)", até a produção dizer o contrário; os modelos de uso real são os seis do combo.

`rdgRelatorio` (só na Competência): 0 Totalizado → `Rel_CaixaTotalizado.fr3` · 1 Recursos → `cx_Recursos_Caixa.fr3` ·
2 Recursos totalizado → `Rel_RecursosTotalizado.fr3` · 3 Agrupado Geral → `cx_Totalizado_Geral_Caixa.fr3`. Todos estão na
RELATORIOS da produção (há também um `Rel_CaixaTotalizado_4Niveis.fr3`, que o fonte não referencia — a máscara da
produção é `#.##.###`, 3 níveis).

## 2. Competência — `TRelCompetencia.GetSQL` (:1810-2220) — ✅ convertido (corte 1)

- **O livro-caixa** (`CAIXA`) por centro de custo com a hierarquia do plano gerencial pela máscara da empresa
  (`GetJoinFixo`/`GetParteFixaSQL`: `P2` é o pai da conta, `P1` o avô; as colunas `CODPLC/DESCRICAO/DESCCODPLC/LIMITEPLC_NVLn`).
- **TPCONTA**: 0 receita → crédito ('C') · 1 despesa → débito ('D') · 2 neutra → `VALOR_SOMAR` 0 ('N').
- **Data**: na emissão, a data da nota do lançamento (DTCONTABIL ou DTEMISSAO — `RgpFiltroData`) ou a do lançamento;
  no vencimento, `CAIXA.DTVENC`. Fora sempre o lançamento "DUPLICATA GERADA REFERENTE A BAIXA PARCIAL".
- **SetFiltro**: operador, fiscal de caixa (`CODFISCALCX`), PDV, lojas (GetMultiEmpresa), observação/descrição (UPPER LIKE),
  começo do código do centro de custo (`DESCCODPLC LIKE 'x%'`), tipo de conta.
- **C.M.V.** (`ckCmv`): tira a conta de CMV da empresa e, pelo `DesconsideraPLCPaiCMV` (Marcelo/2016, "alteração para
  SINHÁ"), **todo o grupo principal dela** (a conta de nível 1 cujo código é o 1º dígito da conta de CMV + '.'); soma o custo
  das vendas — emissão: Σ(qtde × custo) do período (`GetSQLCMVEmissao`); vencimento: o custo proporcional ao que entrou
  (à vista pela data do CX_VENDAS, a prazo pela parcela do CAIXA do mesmo CODGRUPO que vence — `GetSQLCMVVencimento`).
- **Custo de reposição** (`CkbUtilizarCustoRep`, **marcado por padrão no .dfm**): `COALESCE(V.VRCUSTOREP, V.VRCUSTO)`.
- **Taxas de cartão** (`cbTaxasCartao`, só na emissão): tira a conta de taxas e soma −Σ(valor × TXADM) dos cartões
  (TXADM da OPERADORAS_TAXA da loja se > 0, senão o da operadora base).
- **Notas fiscais** (`cbNF`): o TOTALNF das notas de venda (CFOP 5102/6102/5402/6402/5403/6403/5405/6405) com título, na
  conta de cofre da forma de pagamento.
- **FiltraPLCProprietario** (:268): quem não é PRO não vê os centros de custo `APENAS_PROPRIETARIO` (a conta, as de baixo até
  3 níveis e as de cima — `SetListaCodPLCProprietario`).
- **ORDER BY** por modelo: Totalizado `8, 1` · Agrupado `9` · Recursos `4, 8` (ou `4, 9` com a ordenação por descrição) · Recursos totalizado `4, 8`.
- **Impressão**: `frxDBDatasetCaixa` + `frxDBDataset1` (a empresa) e as variáveis `REGIME` ('Periodo: … até … Regime: …'),
  `PLANO_CONTAS_EXPANDIDO` (`chkPlanoContasExpandido`, visível no Totalizado e no Recursos totalizado) e `VIMPRIMECMV`.

### Controles da tela (visibilidade do `cbbRelatoriosCloseUp` :818)

| controle | regra | Apollo |
|---|---|---|
| operador (`GET_OPERADORES`, TIPO_SIGLA 'OPE', da loja) / fiscal de caixa ('SUP') | escolher um zera o outro (`edtCodOperadorExit`/`edtFiscalCXExit`) | `lookup/operadores-caixa` (sigla) ✅ |
| `btnAddPLC` | **é a pesquisa do OPERADOR** (OnClick = `btnOPeradorClick`), apesar do nome | a pesquisa do campo Operador ✅ |
| PDV (`GET_PDV` da loja, NUMERO_PDV) | — | `lookup/pdvs-da-loja` ✅ |
| centro de custo (TEdit, F3 = `GET_PLC` → CODIGO_EXTENSO) | prefixo | campo + F3 ✅ |
| tipo de conta ('', 1-RECEITA, 2-DESPESA, 3-NEUTRA) | — | ✅ |
| `rdgTipoRel` | na Competência só no modelo Recursos, como "Ordenação por centro de custo" (Código/Descrição) | ✅ |
| `RgpFiltroData` | só Competência (emissão) e Baixado (emissão) | ✅ |
| `cbTaxasCartao` | só Competência (emissão); fora dela desmarca | ✅ |
| `cbNF` | só Competência | ✅ |
| `chkCreditoICMS` "Deduzir Crédito do ICMS" | **`Visible = False` no .dfm e nunca ligado** — controle morto | fora (prova: .dfm :721) |
| `cbCMVContabil` "C.M.V. Contábil" | **`Visible = False` e nunca ligado** — `VIMPRIMECMV` é sempre 'N' | fora (prova: .dfm :731) |
| `btnImprimir` | Tag 1 → `BTNIMPRIMIR` | `@RequerAcesso('FRMRELATORIOCAIXA','BTNIMPRIMIR')` + botão habilitado pela opção ✅ |

Sem validação de período no legado (data inicial > final só dá "Dados não encontrados…"); o Apollo segue igual.

**Diferenças deliberadas**: as datas viram o dia da loja (`FUSO_HORARIO_ACESSO`) — o `TRUNC` do Oracle roda no fuso do
servidor da loja; o subselect do `DesconsideraPLCPaiCMV` leva `LIMIT 1` (no Oracle, dois PLCs com o mesmo código de nível 1
dariam ORA-01427). Prova: smoke §334 (7 checks), `relatorioCaixa.spec.tsx` (3).

## 3. Caixa Baixado — `TRelCaixaBaixado.GetSQL` (:1007-1355) — ✅ convertido (corte 2)

O SQL ativo é `GetSQLReceitasOrigem UNION ALL GetSQLDespesas ORDER BY 1` (a versão com `GetSQLReceitas`/`GetSQLCMV` está comentada):

| perna | origem | conta | data na EMISSÃO | data no PAGAMENTO |
|---|---|---|---|---|
| receber | GET_ARECEBERBX ⋈ ARECEBER | `COALESCE(R.CODPLC, FP.PLCCOFRE)` | `DATA_VENDA` | `DATA_PAGAMENTO` |
| cheque | GET_CHEQUEBX ⋈ CHEQUE | cofre da forma | `DATA_EMISSAO` | `DATA_BAIXA` |
| cartão | GET_CARTAOBX ⋈ CARTAO | cofre da forma | `DATA` (venda) | `DATA_BAIXA` |
| à vista | CONTACORRENTE (destino CXA) → Σ ABS(CAIXA.VALOR) da conta | a da CONTACORRENTE | `CAIXA.DATA` | `CAIXA.DATA` |
| despesas | APAGAR_BX ⋈ APAGAR ⋈ CX_APAGAR (pelo CODGRUPO) — rateio pela base (TOTALNF da NF, ou Σ VALOR+VENDOR do grupo), líquido de juros e acréscimo/desconto, × −1 | `CX_APAGAR.CODCC` | `APAGAR.DTCOMPRA` | `APAGAR_BX.DTPGTO` |
| scrap | SCRAP ⋈ CAIXA (CODSCRAP) | a do lançamento | `CAIXA.DATA` | `CAIXA.DATA` |

- O `rdgTipoRel` é **forçado em Analítico** (`cbbRelatoriosCloseUp` :852, e fica invisível) → sempre o `Rel_BalanceteRegimeCaixaDetalhado.fr3`,
  com OBS/CODPARCEIRO/RAZAO (`frxDBDataset2` = o resultado). O Baixado não avisa "Dados não encontrados" — imprime vazio.
- **Filtros que valem**: o começo do código (todas as pernas), a observação (só nas despesas — `G.OBS LIKE` ou `P.DESCRICAO LIKE`, com
  caixa) e o C.M.V. (tira a conta de CMV das baixas a pagar e, pelo `DesconsideraPLCPaiCMV`, o grupo principal dela de todas as despesas).
  **Inócuos no legado** (habilitados na tela, ignorados pelo SQL ativo, porque só o `GetSQLReceitas` comentado os lia): operador, fiscal de
  caixa, PDV, tipo de conta, o campo data das notas e o custo de reposição. No Apollo ficam desabilitados no Baixado.
- **FiltraPLCProprietario pelo `CODPLC_NVL1`**: como a lista leva os pais da conta marcada, marcar UMA conta de proprietário tira o grupo
  de nível 1 inteiro do relatório para quem não é PRO (fiel; smoke §335.5).

**Diferenças deliberadas** (o legado erra; não se copia):
1. **O cartão conta uma vez.** A `GET_CARTAOBX` faz `LEFT JOIN CARTAO_BX` e repete o cartão a cada baixa não estornada: na produção,
   **3.144 cartões com 2+ baixas, R$ 143.411,53 somados em dobro** (jan/2024 – set/2026). O Apollo lê o CARTAO liberado direto.
2. **A observação no scrap** filtra a observação do lançamento: o legado escreve `G.OBS` na consulta do scrap, que não tem alias `G`
   — com a Observação preenchida o Baixado inteiro dá ORA-00904.
3. **Base zero no rateio** (grupo sem valor): o legado dá ORA-01476 (divisão por zero); o Apollo deixa o lançamento sem valor.

Prova: smoke §335 (6 checks), `relatorioCaixa.spec.tsx` (Baixado).

## 4. Caixa Aberto — `TRelCaixaAberto.GetSQL` (:1593-1811) — ✅ convertido (corte 3)

`rdgTipoRel` visível como "Tipo do relatório" (Sintético → `Rel_BalanceteRegimeCaixa.fr3` · Analítico → o Detalhado), volta ao Sintético a
cada troca do combo. Pernas (ORDER BY 1, 2 no fim):

| perna | origem | data na EMISSÃO | data no VENCIMENTO |
|---|---|---|---|
| a pagar em aberto | APAGAR (QUITADA 'N'/nula) ⋈ CX_APAGAR do CODGRUPO: (VALOR+VENDOR) × CX.VALOR / **Σ(VALOR+VENDOR) de TODOS os títulos do grupo** (quitados também) × −1 | `DTCOMPRA` | `DTVENC` |
| lançamentos de lote | CAIXA pelos 6 textos literais (com os typos 'Referenta'); no Analítico `'%Referente a Producao%'`, no Sintético `'Referente a Producao%'` | `CAIXA.DATA` | `CAIXA.DTVENC` |
| C.M.V. (`ckCmv`) | Σ(qtde × custo) das vendas × −1 na conta de CMV (custo de reposição se marcado); e o CAIXA perde a conta de CMV **da empresa logada** | `DTVENDA` | `DTVENDA` |
| a receber | GET_ARECEBER_COM_AGRUPADOS (= `get_areceber` QUITADA 'N', mig 410) pelo **TOTAL com o juro até hoje**, na `CODPLC` do título | `DATA_VENDA` | `DATA_VENCIMENTO` |
| cheque | GET_CHEQUE (BAIXADO 'N') no cofre da forma | `DATA_EMISSAO` | `BOM_PARA` |
| cartão | GET_CARTAO (LIBERADO 'N') no cofre da forma; no Analítico a operadora BASE | `DATA` | `PREVISAO_COMPENSACAO` |

- Sintético: as despesas agrupadas por conta (o legado agrupa o a pagar por G.VALOR/G.CODGRUPO/parceiro e soma por fora).
- Só o começo do código filtra; operador, fiscal, PDV e tipo de conta ficam desabilitados no legado; a observação fica habilitada mas o
  SQL não a lê (no Apollo, desabilitada). O recorte do proprietário pelo `CODPLC_NVL1`.
- A previsão de compensação é a da GET_CARTAO da produção: `DIAFECHAMENTO` da loja se > 0, senão o `DIASCOMP` da operadora base, × a
  parcela; domingo +1, sábado +2. ⚠️ A `get_cartao` do Apollo usa `COALESCE(diafechamento, diascomp)` (diverge se DIAFECHAMENTO = 0 —
  0 linhas na produção hoje) e **não tem o `WHERE COALESCE(LIBERADO,'N') = 'N'`** da produção; o relatório não depende dela.

**Diferença deliberada**: C.M.V. marcado com a empresa sem conta de CMV → o legado monta `AND P.CODPLC <> ` vazio (ORA-00936); o Apollo
só aplica a exclusão quando há conta. Prova: smoke §336 (5 checks), `relatorioCaixa.spec.tsx` (Aberto).

## 5. Pendente

- A impressão do Anual (`Rel_CaixaAnual.fr3`) — se a produção mostrar o modelo acessível.
