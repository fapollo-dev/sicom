# EXTRATO DE FORNECEDORES (`FRMEXTRATOFORNECEDORES`)

`UextratoFornecedores.pas` (287) + `UdmExtratoFornecedores` (sqqExtrato, sqqExtrato2, sqqChqProp). **38 acessos, 4 operadores.**
API `relatorios/extrato-fornecedores` (+ `/impressao`), tela `/relatorios/extrato-fornecedores`. Migration 241 (corte 1).

## 1. O que é

O que se deve a cada fornecedor (APAGAR com a baixa ao lado), em seis modelos (`rgModelo`):

| modelo | recorte |
|---|---|
| 0 — por período | a data escolhida (`rgDatas`: contábil da nota, vencimento, pagamento) entre as duas datas |
| 1 — referência a menor | `data <= d OR data IS NULL` |
| 2 — referência a maior | `data >= d OR data IS NULL` |
| 3 — saldo do contas a pagar em | comprado até a data (TRUNC) e não pago até ela: `dtpgto > d` ou (sem pagamento e não quitado) |
| 4 — saldo dos cheques próprios em | `sqqChqProp`: emitidos até a data e não baixados até ela (CHQ_PROPRIO: 0 linhas no cliente) |
| 5 — saldo do contas a pagar 2 | `sqqExtrato2`: `A.DTCOMPRA <= d`, com a data contábil da nota no lugar da compra e o DTPGTO |

A coluna "vencimento" do `sqqExtrato` é `CASE A.QUITADA WHEN 'S' THEN P.DTPGTO ELSE A.DTVENC END`: a data do pagamento quando quitado.
O `rgFiltro` (todos / abertos / baixados) vale em todos os modelos — nos modelos 3 e 5 ele fica desabilitado, mas o valor escolhido
continua no SQL.

## 2. O campo Parceiro

Ao sair do campo, o `SetaFiltro` pergunta a comparação (`frmFiltro`) e reescreve o texto: `='X'`, `%X` (termina), `X%` (começa),
`%X%` (contém), `<>'X'`; com `%` vai `PA.RAZAO LIKE`, sem `%` o texto é concatenado (`PA.RAZAO ='X'`). O corte 1 chamava isso de
injeção de SQL e reduziu a "contém, sem maiúsculas"; desde 06/10/2026 o modo vem em `parceiroModo` (os cinco), com as maiúsculas como
digitadas e sem concatenar texto.

## 3. ✅ Corte 2 (06/10/2026)

- os modelos 4 e 5 (não existiam);
- as lojas do `GetMultiEmpresa` (`A.IDEMPRESA IN`; era só a do login) e a situação exata (`QUITADA = 'N'`);
- **as datas sem TRUNC**, como o legado: o vencimento e o pagamento podem ter hora (5.285 e 3.453 na produção) — o título com hora no
  último dia fica fora do período e do "até", e o pago no próprio dia (com hora) ainda conta no saldo; o modelo 3 trunca a compra, o 5 não
  — ⚠️ mas `apagar.dtcompra` é **date** no Apollo (mig 201) e a hora de **6.042** compras do legado não veio na carga: o modelo 5 não
  consegue deixar de fora a compra do próprio dia com hora. Pendência de carga (mudar a coluna para timestamp toca ~18 serviços);
- **Imprimir** (`btnImprimirClick`): modelos 0-3 → `extratoFornecedores3.fr3` (751 — o nome em minúscula na RELATORIOS) com o
  `cdsExtrato` no `frxDBDataset1`; o de cheques → `ExtratoFornecedores1.fr3` (749, `frxDBDataset3`); o 5 → `ExtratoFornecedores2.fr3`
  (750, `frxDBExtrato2`); a empresa do login no `frxDBDataset2` e a variável DATA (a 1ª data). O legado imprime mesmo sem linhas.

## 4. Cobertura

Smoke §118.1-3 (corte 1), §118.4 (datas, parceiro, lojas, modelos 4 e 5), §118.5 (os três layouts); teste de renderização do 751.
