# FRMRELFINANCEIRO — Relatório financeiro

**43 acessos · 7 operadores.** `UrelFinanceiro.pas` (846 linhas) + `UdmRelFinanceiro`. Migration **238**.
API `relatorios/financeiro`. Tela `/relatorios/financeiro`.

## 1. O que é

Recebíveis (`ARECEBER`, **99.768** títulos) e compromissos (`APAGAR`, **55.210**) no mesmo período e com os
mesmos filtros, cada linha trazendo a baixa ao lado do título. É o extrato que responde "o que entra e o que
sai".

## 2. ⚠️ O filtro por data de BAIXA do lado A RECEBER não funciona no legado

O legado monta o filtro **sem prefixo de tabela** (`:596`):

```pascal
vFiltroPG := vFiltroPG + ' AND ' + FormataCastData(vCampoDataPG) + ' BETWEEN ...'
```

e o cola num SELECT que já tem `LEFT JOIN ARECEBER_BX`. Como **as duas tabelas têm `DTPGTO`**, o Oracle
responde:

```
ORA-00918: coluna definida de maneira ambígua
```

— verificado na produção. O operador escolhe "Baixa", manda consultar e recebe a mensagem do `except`
(*"Erro : … ao tentar abrir consulta areceber"*). A opção está na tela e não produz relatório nenhum.

**E se rodasse, rodaria errado.** `ARECEBER.DTPGTO` é uma coluna denormalizada e abandonada:

| medida | valor |
|---|---|
| títulos quitados | **50.949** |
| com baixa em `ARECEBER_BX` | **18.601** |
| com `ARECEBER.DTPGTO` preenchido | **6.819** |
| ⇒ invisíveis no filtro por baixa | **11.782 títulos · R$ 12.207.925,74** |

Em agosto/2026, filtrar por `R.DTPGTO` dá **0 linhas** onde o certo (`BX.DTPGTO`) dá **24**.

Aqui a data de baixa é **sempre a da baixa**. Do lado A PAGAR o legado acerta por acidente: `APAGAR` **não
tem** `DTPGTO`, então o nome sem prefixo resolve sozinho para o da baixa.

## 3. O LIKE do parceiro

`AND P.RAZAO LIKE '%x%'` (`:610`) só entra quando o campo está preenchido (o `if edtParceiro.Text <> ''`) — sem filtro, o título sem
parceiro aparece. (O corte de 09/2026 chamava isso de defeito "corrigido"; no fonte já era assim.) Desde 06/10/2026 o LIKE é o do
legado: com as maiúsculas como digitadas.

## 4. O total não multiplica com o título

O `LEFT JOIN` com a baixa **multiplica a linha** — um título com três baixas aparece três vezes, e é assim que
o legado mostra (uma linha por baixa, que é o que o operador quer ver). Mas o **valor do título** entra no
total **uma vez só**: somá-lo a cada baixa parcial dobraria o saldo. O valor pago/recebido, esse sim, soma
todas.

## 5. Cópia fiel, inclusive no vazio

| coluna / tabela | situação no cliente |
|---|---|
| `ARECEBER.NRODOC` (o "documento" impresso) | ⚠️ preenchido em **1** linha de 99.769 — a tela usa a `DUPLICATA` quando ele é nulo |
| `ARECEBER.CODCONTA` (o filtro "Conta corrente") | ⚠️ preenchido em **6** de 99.769 — o filtro existe e não seleciona nada deste lado |
| `CHEQUE` | **11** linhas |
| `CHEQUE_REP` · `CHQ_PROPRIO` · `PERMUTAS` | **0** linhas cada |

O `UNION ALL` do legado inclui cheques e permutas; o corte cobre **títulos**, e o ramo de cheque fica
declarado — não há substrato que justifique o esforço hoje.

## 6. Os cinco ramos e o filtro de conta (25/09/2026)

O `UNION ALL` do legado tem cinco ramos e agora o Apollo também: títulos a receber, **cheque** (11 no cliente), **cartão**
(2,06 mi — vence em `DTVENDA + DIASCOMP × NROPARCELA`, recebe o valor menos a taxa da operadora, 0,1% se ela não tem, quando
LIBERADO; a taxa vai na coluna de juros e a operadora no lugar do parceiro, sem o filtro de parceiro), **cheque próprio** e títulos
a pagar. O cheque de terceiros mostra o VALOR como pago mesmo em aberto — é o SQL do legado. Os seletores `cmbRecebiveis`
(todos/títulos/cheques/cartões) e `cmbCompromissos` (todos/títulos/cheques) escolhem os ramos. ⚠️ O filtro de **conta** era do
Apollo (`areceber.codconta`, só do lado a receber); agora é o do legado: o **lote** que passou pela conta
(`IDLOTE IN (SELECT IDLOTE FROM MOV_CONTAS_BANCARIAS WHERE CODCONTA = …)`), em todos os ramos. Smoke §115.5.

## 7. ✅ Fidelidade e as impressões (06/10/2026)

**A consulta** passou a seguir o `MontaRelatorioAnaliseDescritiva` em quatro pontos: as lojas do `GetMultiEmpresa` (era só a do login);
a **ordem** do `sqqDtos` (`ORDER BY 9, 8` = LOTE, RAZÃO — o relatório agrupa por TIPO, CÓDIGO e LOTE nessa ordem; era por vencimento);
a situação exata (`QUITADA = 'N'`); e o `rgTipoClick`: com a situação "todos" o rgFiltro fica desabilitado e travado em
**VENCIMENTO** (o filtro por emissão/baixa só vale com "em aberto"/"baixados"). As linhas trazem também as colunas do `cdsDoctos`.

**Imprimir — análise descritiva** (`RelatorioFinanceiroGeral.fr3`, 918): o `cdsDoctos` no `frxDBDatasetDocs` e, ANINHADOS em cada linha
pelo lote (`MasterFields = IDLOTE`): as contas correntes do lote (`sqqContaCorrente`: o VALOR é o do movimento, o crédito MENOS e o
débito MAIS o Σ das baixas a receber do mesmo lote cujo título está FORA do período), os cheques (`IDLOTEBXRCB` = o lote), os cheques
próprios, permutas e cheques repassados (essas duas tabelas não vieram — 0 linhas na produção); o resumo por conta do laço (`cdsResumoconta`:
a 1ª conta corrente do lote de cada linha, somada quando o lote ou a conta muda — a linha sem lote vira a "conta 0" com 0,00); a empresa;
CodEmpresas/DataInicial/Datafinal. Os sub-relatórios estão no cabeçalho do grupo por CÓDIGO: o motor passou a dar a eles a linha
corrente do grupo como mestre (antes viam os detalhes de todas as linhas). ⚠️ Não reproduzido: o laço apagaria o cheque cujo
IDLOTEBXRCB está nos cheques do 1º documento quando o lote dele não tem conta corrente — e entraria em laço infinito quando tem (o
`Continue` sem `Next`); 11 cheques de 2023 na produção.

**O 2º relatório, "Contas a receber"** (`MontaRelatorioContasAReceber`, não existia no Apollo): os títulos das lojas pela emissão,
vencimento ou baixa, a situação, sem agrupados; CNPJ/CPF do 1º endereço ativo; documento `COALESCE(NROCUPOM, DOCNF)`; tipo NF / NFC / ECF
(a NFC-e do pedido vem da venda — a tabela NFC fica com o PDV); o status da nota. Pela baixa, a data da BAIXA (o legado lê
`R.DTPGTO`, a coluna abandonada — §2). Grade + Imprimir (`RelatorioFinanceiroContasReceber.fr3`, 916).

Os layouts `RelatorioFinanceiroGeralSintetico` (919) e `RelatorioFinanceiroContasReceberAtrasados` (917, com a variável `vFiltro`) estão
na RELATORIOS do cliente, mas nenhuma opção do fonte os carrega — binário novo, sem SQL capturado.

Cobertura: smoke §115.1 (+ o filtro travado), §115.6 (impressão geral: ordem, aninhados, VALOR ajustado, resumo), §115.7 (contas a
receber e a impressão); teste de renderização do 918 (o detalhe só no documento dele).
