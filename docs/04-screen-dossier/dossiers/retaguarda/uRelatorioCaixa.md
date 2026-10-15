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
| `cbNF` | só Competência | ✅ (corte dos Baixado/Aberto vai desabilitar) |
| `chkCreditoICMS` "Deduzir Crédito do ICMS" | **`Visible = False` no .dfm e nunca ligado** — controle morto | fora (prova: .dfm :721) |
| `cbCMVContabil` "C.M.V. Contábil" | **`Visible = False` e nunca ligado** — `VIMPRIMECMV` é sempre 'N' | fora (prova: .dfm :731) |
| `btnImprimir` | Tag 1 → `BTNIMPRIMIR` | `@RequerAcesso('FRMRELATORIOCAIXA','BTNIMPRIMIR')` + botão habilitado pela opção ✅ |

Sem validação de período no legado (data inicial > final só dá "Dados não encontrados…"); o Apollo segue igual.

**Diferenças deliberadas**: as datas viram o dia da loja (`FUSO_HORARIO_ACESSO`) — o `TRUNC` do Oracle roda no fuso do
servidor da loja; o subselect do `DesconsideraPLCPaiCMV` leva `LIMIT 1` (no Oracle, dois PLCs com o mesmo código de nível 1
dariam ORA-01427). Prova: smoke §334 (7 checks), `relatorioCaixa.spec.tsx` (3).

## 3. Pendente (próximos cortes)

- Caixa Baixado (emissão/pagamento) — `TRelCaixaBaixado` (à vista, cartão, cheque, receber, receitas, despesas, scrap).
- Caixa Aberto (emissão/vencimento) — `TRelCaixaAberto`.
- A impressão do Anual (`Rel_CaixaAnual.fr3`) — se a produção mostrar o modelo acessível.
