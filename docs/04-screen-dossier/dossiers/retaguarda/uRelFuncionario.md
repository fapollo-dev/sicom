# FRMRELFUNCIONARIO — Extrato de funcionário

**9 acessos · 4 operadores.** `URelFuncionario.pas` + `UFuncionario.pas` (classes `TExtratoFuncionario` e
`TExtratoFuncionarioAnalitico`). Migration **263**. API `GET cobranca/extrato-funcionario` e
`GET cobranca/extrato-funcionario/convenios`. Tela `/cobranca/extrato-funcionario`. Smoke §141 (3 checks).

## 1. O que faz

O extrato do **convênio de funcionários**: por funcionário (parceiro `FUN='S'`), os **débitos**
(`ARECEBER`: compras no convênio, quebras de caixa, estornos) e os **créditos** (`APAGAR`: adiantamentos,
acertos), no período, por convênio (`PARCEIROS.CODCONVENIO`) e por operador (o `OPERADORES.CODPARCEIRO`
do funcionário). Três saídas no combo: "1 - Extrato" (sintético: funcionário × tipo × dia, com sinal),
"2 - analítico" (linha a linha com centro de custo) e "3 - sintético" (o mesmo SQL do analítico, .fr3
agrupado). Rádios: Situação (quitados/abertos/todos) e Tipo (todos/compra/adiantamento/quebra/estorno).

## 2. Regras do fonte (UFuncionario.pas), copiadas

- **TIPO vem do TEXTO da OBS**: `'%CONTA ORIGINADA DE VENDAS%'`→Compras · `'%ADIANTAMENTO%'` ·
  `'%QUEBRA%'` · `'%ESTORNO%INDEVIDO%'` · senão "Convênio de Funcionários". No analítico, TIPO =
  descrição do PLC (AR por `CODPLC`, AP por `CODPLCFUNCIONARIOS`), senão a OBS, senão "Convênios de funcionários".
- AP entra com sinal **+** (a favor do funcionário), AR com **−**. Agrupados ficam fora: AR `AGRUPADO<>'S'`;
  AP `AGRUPADO<>'S' AND CODCXAGRUPAMENTOCR=0`.
- Operador do funcionário = `MAX(CODOPERADOR)` entre os operadores **ativos** do parceiro.
- `Validacoes`: convênio **obrigatório** só quando o Tipo é "Todos" (URelFuncionario.pas:272-276); se
  informado, tem de ser convênio de alguém (`ParceiroEConvenio`) — 422 `CONVENIO_OBRIGATORIO` /
  `PARCEIRO_NAO_E_CONVENIO`.
- O 3º ramo do UNION lê `AGRUPARECEBER` — **0 linhas na produção**. Não replicado.

## 3. O que o dado diz (produção, 18/09/2026)

| | |
|---|---:|
| funcionários (`FUN='S'`) · convênios com funcionários · parceiros `CON='S'` | 1.271 · 21 · 386 |
| AR de funcionários em 2026 | **10.109** títulos |
| … com `AGRUPADO='S'` (fora do extrato por regra) | **7.490 (74%) — R$ 314 mil** |
| … que ficam | 2.619 — R$ 175 mil |
| … dos que ficam, OBS nula → "Convênio de Funcionários" (são os consolidados do agrupamento) | 152 — R$ 82 mil |
| AP de funcionários em 2026 · agrupados | 185 (R$ 530 mil) · 30 |
| empresas com AP de funcionários em 2026 (o legado **não filtra empresa**) | 4 (1: 136 · 2: 22 · 50: 9 · 52: 19) |
| parceiros com 2+ operadores ativos (o MAX escolhe um) | 7 |

## 4. O que o Apollo faz diferente

- **Tenant-scoped** (`FiltraEmpresa := False` no legado).
- Devolve, além das linhas, o resumo **por funcionário** (créditos, débitos, saldo, quantos operadores
  ativos ele tem) e os totais.
- Colunas do legado que o destino não tinha, acrescentadas em `apagar`: `codcxagrupamentocr`, `codplcfuncionarios`.
- `GET …/convenios`: a lista do botão de busca do legado (parceiros que são `CODCONVENIO` de alguém, com a
  contagem de funcionários).

## 5. Fora

Os .fr3 (3 layouts) e o "sintético por nível" como layout separado — o dado é o do analítico.
