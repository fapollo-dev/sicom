# LANÇAMENTOS CONTÁBEIS (`FRMRELLANCAMENTOSCONTABEIS`) — recon e corte-1

`UFrmRelLancamentosContabeis.pas` (1.416 linhas). **377 acessos, 19 operadores.**

## 1. O que a tela é

O razão **por lançamento**: cada linha do `DIARIO` com as duas contas (reduzida, expandida e descrição do
plano), o histórico, o documento, a operação e — o que dá sentido à tela — **a origem pelo nome**, vinda de
`ORIGEM_CONTABIL`.

⚠️ **não confundir com o Livro Razão** (`FRMRELRAZAOCONTABIL`, já migrado): aquele é por conta, com saldo
acumulado; este é a lista dos lançamentos, com filtro por origem e a ponte para o documento que os gerou.

## 2. ⚠️ Duas coisas que a carga descartava

**`DIARIO.DESCHIST`** — o texto do histórico de cada lançamento, preenchido em **1.750.513 de 1.750.577**
linhas (**99,99%**). Sem ele o razão mostra número e não conta história: é a coluna que o contador lê.
(`DIARIO.TIPODOC` veio junto — 36.414 linhas, 2%.)

**`ORIGEM_CONTABIL`** — o de-para dos códigos de origem, **35 linhas**. Os três cortes da integração contábil
vinham usando os números crus (12, 15, 16, 51, 61, 62, 13, 14, 19, 63, 64, 65); agora toda tela contábil pode
mostrar "INTEGRAÇÃO DE BAIXA DE CARTÕES" em vez de "51".

As origens com `STATUS = 'N'` (2, 4, 5, 6, 8, 9, 10, 11, 50) são de uma **geração anterior** da integração —
baixa total e parcial separadas, venda de PDV solta, Redução Z. Não recebem lançamento novo, mas o razão
histórico as referencia, então vêm junto.

⛔ `DIARIO.CODPERIODO` **não** entra: 0 de 1.750.577 preenchidas. Coluna morta, como a `CODCC` da mig 199.

## 3. Débito e crédito somam separado

Não é capricho: parte das origens grava **linha de um lado só** — 893 (baixa de cartão), 2004 e 2009 (baixas
de AP/AR), 910 (convênio), como o corte-2 da integração contábil mostrou. Somar tudo junto não diz nada; a
diferença entre os dois totais é a medida de quanto do período está partido. A tela tem o filtro
"só de um lado" para isolá-los.

## 4. A ponte para o documento

`BtnDetalharDiarioClick` (`:422-437`) é o que faz o contador usar a tela: dado um lançamento, achar o papel.
O legado resolve dois casos — `ARECEBER_BX` → `CODRCB` e `APAGAR_BX` → `CODAPG`, porque nessas origens o
`IDORIGEM` é o código da BAIXA, não do título.

Aqui a resolução cobre o que o Apollo grava hoje: 15 e 16 pela baixa, 12/13/14 direto (o `IDORIGEM` já é o
documento), 64 e 51/61/62 identificados sem rota. **O que não tem ponte devolve o `IDORIGEM` cru** em vez de
apontar para o lugar errado.

## 5. O que fica

A árvore de datas (ano → mês → dia) que a tela usa para navegar, o "filtro auxiliar" salvo por usuário, a
importação de arquivo e as exportações TXT/Excel — o CSV já existe pelo construtor de relatórios.
