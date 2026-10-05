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

- ~~Tenant-scoped~~ → desde 05/10/2026 **todas as lojas**, como o legado (`FiltraEmpresa := False`; ver abaixo).
- Devolve, além das linhas, o resumo **por funcionário** (créditos, débitos, saldo, quantos operadores
  ativos ele tem) e os totais.
- Colunas do legado que o destino não tinha, acrescentadas em `apagar`: `codcxagrupamentocr`, `codplcfuncionarios`.
- `GET …/convenios`: a lista do botão de busca do legado (parceiros que são `CODCONVENIO` de alguém, com a
  contagem de funcionários).

## 5. Fora

Os .fr3 (3 layouts) e o "sintético por nível" como layout separado — o dado é o do analítico.

## A impressão, os três tipos e as lojas (05/10/2026)

- **Os três tipos do `CmbTipoRelatorio`**: "1 - Extrato de funcionário" (`TExtratoFuncionario`, por funcionário × tipo × dia, com o
  SINAL) e "2 - … analítico" / "3 - … sintético" (`TExtratoFuncionarioAnalitico` com `TipoRel` 'A' / 'S' — o MESMO SQL linha a
  linha, layouts diferentes). O Apollo tinha só dois; o tipo 3 entrou (`analitico_sintetico`).
- **As lojas**: o legado **não filtra empresa** (`FiltraEmpresa := False`) — o convênio de funcionários atravessa as lojas. O Apollo
  recortava à loja do login e o extrato saía incompleto (a quebra lançada na loja 2 sumia do extrato do funcionário). Fiel agora.
- **A impressão** (`TFrmRelMaster.GeraRelatorio`): o `DBDRelatorio` é o `GetSQL` da classe, na ordem dele, sem o limite da grade;
  - tipo 1 → `Funcionario1 - Extrato de funcionario.fr3`, recolhido (o `CmbNiveisExpandidos` fica em −1 → 0 níveis); o script
    guarda o total de cada funcionário com `Set(<NOME>, SUM(...))` na 1ª passada e o cabeçalho do grupo o lê com `Get` na final
    ("Total : …") — o motor ganhou `Set`/`Get`. O layout soma o VALOR como vem (o débito do tipo 1 vem positivo com o SINAL ao
    lado; o total do layout soma os dois, como o legado);
  - tipo 2 → `Funcionario2 - Extrato de funcionario analítico.fr3`, com os níveis escolhidos (1 de fábrica);
  - tipo 3 → `Funcionario2 - Extrato de funcionario sintético.fr3`, 1 nível (o combo desabilitado).
- smoke §141.1-4 (a loja 2 agora entra); testes de renderização dos três layouts.
