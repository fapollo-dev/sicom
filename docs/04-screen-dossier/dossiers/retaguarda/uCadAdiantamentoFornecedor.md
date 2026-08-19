# ADIANTAMENTO A FORNECEDOR/PARCEIRO — `uCadAdiantamentoFornecedor` / `FRMADIANTAMENTOFORNECEDOR`

Recon de 2026-08-19. **699 acessos, 11 operadores.** Retaguarda pura (financeiro; nada de PDV).

**Ausência provada no código** antes de eleger o alvo (lição 80):
`grep -rn "adiantamento_forn\|AdiantamentoForn\|adiantamento-fornecedor" apps/api/src apps/api/migrations apps/web/src`
→ **zero**. E o comentário `apagar-baixa.service.ts:93` confirma o buraco: "…em BANCO/outro o excesso é dinheiro real →
rejeita (**adiantamento adiado**)".

## 1. O que a tela faz

Registra o adiantamento de dinheiro entre a empresa e um parceiro e **produz dois fatos**: um movimento na conta
corrente (o dinheiro que sai/entra) e um **título** que representa o direito/obrigação criada.

| tipo | `RgpTipo` | `SITUACAO_NF.TIPO_OPERACAO` | dinheiro | título gerado |
|---|---|---|---|---|
| `C` | 0 | `F19` (situação 1012 "RECEBIMENTO") | **entra** (crédito) | **`APAGAR`** |
| `D` | 1 | `F20` (situação 1011 "PAGAMENTO") | **sai** (débito) | **`ARECEBER`** |
| `E` | 2 | `F21` | entra (crédito) | `APAGAR` com `ADCREDITO='S'` |

O tipo **não é escolhido no radio**: ele vem da *situação do documento* informada no "adicionar"
(`uCadAdiantamentoFornecedor.pas:99-147` — `AnsiIndexStr(SituacaoNF.TipoOperacao,['F19','F20','F21'])` → índice →
`RgpTipo.Enabled := False`). O gate é a config **`INFORMA_SITUACAO_DOC_ADIANTAMENTO_PARCEIROS`**; no golden ela está
ligada (`IDSITUACAO_NF` preenchido em 563/563).

## 2. Estado no Oracle (liveness — golden)

`ADIANTAMENTO_FORN`, 19 colunas, **563 linhas**, 121 fornecedores, **R$ 844.007,79** (min R$ 5 · max R$ 120.000),
2020-05 → 2025-03.

| coluna | golden |
|---|---|
| `TIPO` | **D 554 · C 9** — `E` **nunca ocorreu** |
| `QUITADA` | S 430 · N 133 |
| `CODMOVCONTA` | **563/563** ⇒ todo adiantamento move conta corrente |
| `DTVENCIMENTO` | 563/563 |
| `CONTABILIZADO` | S 526 · null 37 |
| `IDSITUACAO_NF` | 1011 (554) · 1012 (9) |
| `OBS` | 563/563 (texto digitado) |
| `IDDOCGERADO` | **2** — quase morta (gancho da integração contábil) |
| `CODMAPA` | **0/563 ⇒ COLUNA MORTA** (cópia-fiel-negativa; não copiada) |
| `OLD_CODPARCEIRO` | resíduo de migração antiga — não copiada |

**`E` é cópia-fiel-negativa com prova dupla:** nenhuma linha no golden **e** nenhuma `SITUACAO_NF` com
`TIPO_OPERACAO='F21'` (`select … where tipo_operacao in ('F19','F20','F21')` devolve só 1011/1012) ⇒ o caminho é
inalcançável hoje. O código do legado existe, então **foi implementado** (com o smoke exercitando-o), mas o operador
não tem como chegar nele sem cadastrar a situação F21.

## 3. Regras do gravar (`btnGravarClick`, linha 258+)

Validações, na ordem do legado:
1. parceiro obrigatório · 2. conta corrente obrigatória · 3. `valor <> 0` · 4. `dtvencimento >= dtadiantamento`.

**Movimento na conta corrente** — `dmPrincipal.ValidaSaldoAnterior` (`udmPrincipal.pas:2131`), chamada em
**`edtNroContaExit`** (linhas 582 e 595 — o `RgpTipoExit` da linha 758 só copia o `ItemIndex` para o `TIPO`), e só
no caminho de inserção (`if FlagGravacao = 0`, linha 577):
- `D`: `ValidaSaldoAnterior(cc,'DINHEIRO', +valor, LancaMov=true, **VerifSaldo=true**, obs…)`
- `C`/`E`: `ValidaSaldoAnterior(cc,'DINHEIRO', **−valor**, true, **false**, obs…)`

Dentro dela (`LancaMovimento`): `VALOR := ValorRef * -1`, `TIPOMOVIMENTO := 'C'` se `valor*-1 > 0` senão `'D'`,
`DTEMISSAO = DTVENC = DTLIBERACAO = data do adiantamento`, `LIBERADO='S'`, `CODOPCONTA=0`, `HISTORICO = OBS` (ou
`'ADIANTAMENTO PARA/DO O PARCEIRO <razão>'` quando OBS vazio — golden: `HISTORICO = OBS` em **557/563**),
`IDPGTO` = forma `MODALIDADE='DINHEIRO'` quando a conta é CAIXA (`CODBCO=0`), senão a de `DESTINO='CXA'`.

Dois gates dentro da mesma função:
- **`CONTAS_BANCARIAS.DTCHAVEAMENTO`**: `data <= dtchaveamento` → *"Caixa FECHADO não é permitida alteração dos
  documentos!"* (golden: preenchida em **2 de 31** contas, 2021-01-01 — viva, rara).
- **saldo**: só quando `VerifSaldo` (⇒ só tipo `D`) **e** a conta é CAIXA (`CODBCO = 0`):
  `abs(valor) > saldo` → *"Saldo insuficiente para esta operação!"*.

⚠️ **O saldo desse gate NÃO é o saldo geral do razão.** `GetSaldoContaCorrente` (`udmPrincipal.pas:3877-3903`) é
`SUM(CASE WHEN M.LIBERADO='S' THEN M.VALOR ELSE 0 END)` com **`INNER JOIN FORMAS_PGTO F ON F.IDPGTO = M.IDPGTO`** e
`AND UPPER(F.MODALIDADE) = 'DINHEIRO'` (a modalidade vem do call site, linha 583). A diferença é enorme no golden:

| conta CAIXA | saldo do legado (DINHEIRO + LIBERADO) | soma geral do razão |
|---|---:|---:|
| 22 | **−284.308,49** | +1.590.292,62 |
| 24 | **0,00** | +50.472,70 |
| 21 | −2.568.689,69 | −2.360.339,07 |

Nas contas 22 e 24 o legado **barra qualquer débito** e a soma geral liberaria — e é o caminho quente (533/563
adiantamentos em conta CAIXA, 554/563 do tipo `D`). O novo copia o filtro de modalidade; o único termo que não dá
para reproduzir é `LIBERADO`, que não existe no nosso razão (split registrado como adiado no Controle de Contas
Correntes) — aqui todo movimento conta como liberado.

**Vínculo operador×conta é gate de GRAVAÇÃO, não só do picker**: `uCadAdiantamentoFornecedor.pas:568-575` consulta
`CONTAS_BANCARIAS_OP` (par `CODOPERADOR;CODCONTA`) **antes** do `if FlagGravacao = 0` e aborta com *"Este Operador
não tem permissão para manipular essa conta corrente."* — vale no insert e no editar (129 pares no golden, 27 das
31 contas com vínculo).

**Sinal no golden (prova):** `select a.tipo, m.tipomovimento, sign(m.valor) …` →
`D → tipomovimento 'D', valor NEGATIVO (554)` · `C → 'C', valor POSITIVO (9)`.

Duas coisas do movimento não têm par no novo e ficam registradas: as **três datas** do legado
(`DTEMISSAO`/`DTVENC`/`DTLIBERACAO`, todas iguais à data do adiantamento) colapsam na única coluna de data do nosso
razão (`mov_contas_bancarias.data_fechamento` — a que o extrato e o saldo-até-data usam); e `LIBERADO='S'`, que o
legado grava sempre, não existe no novo (o split de LIBERADO já estava registrado como adiado no Controle de Contas
Correntes).

> ⚠️ **Divergência de convenção registrada (vale para o PLANO DE CARGA):** o legado grava
> `MOV_CONTAS_BANCARIAS.VALOR` **com sinal** (C:+ / D:−; no golden inteiro: C positivo 101.911 · D negativo 42.527).
> O novo grava **magnitude** e o sinal vem de `tipomovimento` (`controle-contas.service.ts:107` e os 4 writers de MCB
> do repo). O adiantamento segue a convenção **do novo** (senão o saldo/extrato da tela de Contas Correntes
> inverteria). Na carga, `VALOR` do legado tem de entrar como `abs(VALOR)`.

**Título gerado** (`usInserted`):

| campo | `D` → `ARECEBER` | `C`/`E` → `APAGAR` |
|---|---|---|
| valor / total | `VALOR` (positivo, sem sinal) | `VALOR` |
| datas | `DTVENDA = dtadiantamento` · `DTVENC = dtvencimento` | `DTCOMPRA` · `DTVENC` idem |
| `DUPLICATA` | `CODADIANTAMENTO` | idem |
| `OBS` | `'Originado do lancamento do adiantamento de parceiro n: <cod>'` | idem |
| `QUITADA` | `'N'` | `'N'` |
| `NRODUP` | `1` | `1` |
| `TIPODOC` | `'A VISTA'` | `'A VISTA'` |
| `ADFORNECEDOR` | `'S'` | `'S'` |
| `IDSITUACAO_NF` | **não é gravada** (os INSERTs das linhas 321/343 não listam a coluna; golden: 0 dos 552 títulos do adiantamento no ARECEBER têm situação) | idem |
| extra | `CONSILIADO='S'`, `IDPGTO` = forma `DESTINO='RCB'` | `CODGRUPO` novo · `ADCREDITO='S'` **só se `E`** |

Golden do título: 552 `TIPODOC='A VISTA'` + 4 `DUPLICATA` + 2 `ADIANTAMENTO` (esses 6 vêm de outros fluxos que também
apontam `CODADIANTAMENTO`), `NRODUP=1` e `CONSILIADO='S'` em 100%, `VALOR = TOTAL` em 100%, nenhum negativo.
Cruzamento `D`: **554/554 têm `ARECEBER`**; `C`: 9/9 têm `APAGAR`.

**Editar** (`usModified`): `UPDATE ARECEBER` (tipo `D`) ou `UPDATE APAGAR` (tipo `C`) — parceiro, datas, valor
(+`TOTAL`/`CONSILIADO` no ARECEBER) — e `UPDATE MOV_CONTAS_BANCARIAS SET VALOR, DTEMISSAO, DTVENC, DTLIBERACAO
WHERE CODMOVCONTA = …` (linha 409). **O tipo `E` não é tratado no editar** (cópia fiel: fica sem atualizar o APAGAR).

Três divergências deliberadas no editar/excluir, todas com a prova do lado:

- **trocar a CONTA no editar**: o legado **permite** (`CODCONTACORRENTE` tem `pfInUpdate` no `.dfm` e
  `HabilitaContaOrigem`, linha 674, mantém o campo habilitado) mas **não move o movimento** — o UPDATE da linha 409
  só toca valor/datas. Prova de que foi exercido: **4 de 563** adiantamentos do golden têm
  `mov_contas_bancarias.codconta ≠ adiantamento_forn.codcontacorrente`. O novo **não deixa trocar a conta**: copiar
  o caminho produziria exatamente essas 4 linhas inconsistentes (movimento numa conta, adiantamento noutra), com
  saldo e extrato errados nas duas. Registrado aqui em vez de implementado.
- **`DTCHAVEAMENTO` no editar e no excluir**: no legado o teste vive dentro do `ValidaSaldoAnterior`, que só é
  chamado no caminho de inserção — então alterar/excluir documento de conta chaveada passa. O novo aplica o gate
  nos três caminhos, porque a mensagem do próprio legado é sobre isso ("*não é permitida **alteração** dos
  documentos*"): o que o legado tem é a regra certa cabeada no lugar errado.
- **período contábil**: ver a seção anterior.

Três detalhes que o golden explica:
- o UPDATE do movimento **não toca `HISTORICO`** ⇒ editar a OBS depois deixa histórico e OBS diferentes. É
  exatamente o que se vê no golden: `HISTORICO = OBS` em **557 de 563** — os 6 restantes são OBS editada depois.
  O novo copia isso (o histórico é o do lançamento original) e o smoke §82.7 assere justamente a NÃO-mudança.
- o editar **não revalida saldo** (o `ValidaSaldoAnterior` só roda no caminho de inserção, `FlagGravacao = 0`),
  então aumentar o valor de um adiantamento pode estourar o saldo do caixa. Copiado como está.

## 4. Bloqueios de editar/excluir (linhas 200-245)

1. `TIntegracaoContabil.PeriodoFechado(...)` → sai calado.
2. `QUITADA='S'` → *"Não é possivel alterar/excluir o registro, documento ja baixado!"*.
3. `VerificaContabilizado(op)`: se `CONTABILIZADO='S'` **e** a empresa **não** é `INTEGRACAO='AUTOMATICA'` →
   *"Não é permitido <op> esta conta pois já foi contabilizada."*; se é automática, **estorna** a contabilização
   (`TIntegracaoAdiantamento.Estornar`) e segue.

**Excluir**: apaga o registro, `DELETE FROM MOV_CONTAS_BANCARIAS WHERE CODMOVCONTA = …` e o título —
`DELETE FROM ARECEBER WHERE DUPLICATA = <cod> AND OBS LIKE '<a frase>' AND CODEMPRESA = …` (tipo `D`) /
`DELETE FROM APAGAR …` (tipo `C`). **O tipo `E` não é tratado no excluir** (o APAGAR fica órfão) — cópia fiel
registrada. No novo, o delete usa a **coluna própria `codadiantamento`** (idêntica em valor à `DUPLICATA` no insert,
mas imune a edição do campo) + escopo de empresa.

### Período contábil: o flag é PRÓPRIO, e o gate do legado está morto

Três fatos, nesta ordem:

1. **A tabela tem um flag dedicado a esta tela:** `PERIODO_CONTABIL.BLOQ_ADIANTAMENTO_FORN` existe no Oracle e vale
   `'S'` nos **2 períodos fechados** do golden (`codperiodocontabil` 21 e 61). Quem o LÊ não está no fonte clonado —
   mesma situação do `ValidaPeriodoFechado`, que vive no submódulo `sicom/util` — mas schema + dado provam a
   intenção. O novo usa **este** flag (não `bloq_rcb`/`bloq_apg`, que são do título), na criação, no editar e no
   excluir. Mig 159 cria a coluna; smoke §83.10 prova os dois lados (fechado no flag próprio barra; período fechado
   só com `BLOQ_RCB` não barra).
2. **O gate que o legado realmente chama em editar/excluir está morto:** `TIntegracaoContabil.PeriodoFechado`
   (`UIntegracaoContabil.pas:286`) compara a data de HOJE com `CONFIG_INTEGRACAO_CONTABIL.CHAVEAMENTO_PERIODO` — e
   essa coluna é **NULL na única linha do golden**, ou seja hoje não barra nada. O novo substitui esse gate morto
   pelo `periodo_contabil` (vivo) com o flag do item 1.
3. **Divergência deliberada:** o `btnGravarClick` **não** testa período nenhum. O novo barra também na criação, com
   a data do adiantamento. Motivo: o adiantamento **cria um título** a receber/a pagar, e o módulo de A Receber/A
   Pagar do próprio legado barra gravação de título em período fechado — pela porta do adiantamento o legado furava
   a própria trava com um INSERT direto.

## 5. Quem quita o adiantamento (o outro lado do fluxo)

- **baixa do título gerado** → `update adiantamento_forn set quitada='S' where codadiantamento = :id`
  (`UBaixaAreceber.pas:1233` e `UBaixaApagar.pas:485`).
- **reversão da baixa a pagar** → `quitada='N'` (`UReversaoBaixaContasPagar.pas:65`).
- **reversão da baixa a receber** → `UReversaoBaixaContasReceber.pas:71` seta **`quitada='S'`** — **bug do legado**
  (deveria ser `'N'`). Prova de que nunca foi exercido: o cruzamento golden não tem **nenhuma** linha
  `adto='S' + areceber='N'` (só N/N 116 · N/S 9 · S/S 429). O novo implementa `'N'` nas duas reversões (simétrico) e
  o bug fica registrado aqui.
- 9 linhas `D` com título baixado e adiantamento `N`: baixas por caminho que não chamava o update (lote/agrupamento).
- **Baixa PARCIAL também quita o adiantamento**: no legado o `QuitarAdiantamento` é chamado logo depois do
  `QUITADA='S'` do título, dentro do laço de documentos e **sem condição de valor**
  (`UBaixaAreceber.pas:1754-1755` — só `if CODADIANTAMENTO > 0`). O novo chama no mesmo ponto (depois do update do
  título), então o parcial se comporta igual — o saldo remanescente vira outro título, sem vínculo com o
  adiantamento (idem legado).

## 6. Outros detalhes fiéis

- **Picker de conta corrente**: só contas do operador — `LEFT JOIN CONTAS_BANCARIAS_OP O ON O.CODCONTA = … WHERE
  O.CODOPERADOR = <operador>` (temos `contas_bancarias_op`, mig 099).
- **Picker de parceiro**: `ATIVADO='S'` + (se a situação tiver lista) `CODIGO IN (SITUACAO_NF_PARCEIROS)`. As
  situações 1011/1012 **não têm** linhas em `SITUACAO_NF_PARCEIROS` ⇒ hoje o filtro é só `ATIVADO='S'`.
- `ImprimirRecibo(cod)` e `IntegraAdiantamento(cod)` (integração contábil quando `INTEGRACAO='AUTOMATICA'`,
  que grava `CONTABILIZADO='S'` — `UIntegracaoContabil.pas:2988`) ficam para corte futuro. Como o estorno contábil
  (`TIntegracaoAdiantamento.Estornar`) depende dessa integração, o novo **bloqueia** editar/excluir de um
  adiantamento `CONTABILIZADO='S'` em vez de estornar — fail-closed até a integração existir.
- **prefill e MAIÚSCULAS da OBS**: `dbmOBSEnter` (linha 468) pré-preenche `'ADIANT P/ <razão> - '` (tipo `D`) ou
  `'ADIANT DE <razão> - '` (`C`/`E`) e `dbmOBSKeyPress` (linha 481) força `UpCase`. Golden: **563/563 em
  maiúsculas**, 527 começando com `'ADIANT P/ '` e 5 com `'ADIANT DE '`; e **0/563** usam o fallback
  `'ADIANTAMENTO PARA/DO O PARCEIRO …'` do `ValidaSaldoAnterior` — ou seja, o texto do fallback nunca chegou ao
  banco. O novo copia o prefill (na tela) e o UpCase (no serviço, que é onde ninguém escapa), e mantém o fallback
  só para OBS vazia, registrado como caminho nunca exercido.
- **trigger `VALIDA_ADIANTAMENTO`** (Oracle, AFTER INSERT OR UPDATE): levanta `-20001` se `CODMOVCONTA`, `VALOR` ou
  `CODPARCEIRO` vierem nulos. O novo tem `codmovconta NOT NULL` e grava o **movimento antes** do registro (a ordem
  do legado: `LancaMovimento` no exit da conta, depois o post com `CODMOVCONTA` na linha 606, e por fim o vínculo
  inverso `MOV.CODADIANTAMENTO` na linha 396).
- **`VALIDA_SALDO_PARCEIRO_ADIANTAMENTO`** (config real, `VALOR='S'`, "valida o saldo de crédito do parceiro no
  adiantamento", valores `S;N;A`): **zero call sites** em todo o fonte clonado da retaguarda (`grep -ril` na árvore
  inteira devolve vazio) ⇒ a regra vive em módulo não clonado. Não implementada, registrada aqui e na mig 159.
- **Colunas do título que o legado grava e o novo não tem**: `ARECEBER.TOTAL` (= `VALOR` em 552/552 dos títulos do
  adiantamento; o novo deriva o total na view `get_areceber`), `CODOPERADOR` (o novo carimba `usultalteracao`) e
  `APAGAR.CODGRUPO` (`GetID('CODGRUPO')` — o agrupamento de pagamento do legado, que ainda não tem par no novo).

## 7. Cortes

- **corte-1 (este)**: tabela + situação/tipo + os dois fatos (movimento na conta corrente com os gates de
  chaveamento e saldo, e o título `ARECEBER`/`APAGAR`), editar, excluir, os bloqueios (quitada/contabilizado/período)
  e o wire da quitação nas baixas/estornos de AR/AP. Tela + smoke.
- **fora (registrado)**: recibo impresso, integração contábil automática (`CONTABILIZADO`/`IDDOCGERADO`),
  `CODMAPA` (morta), `OLD_CODPARCEIRO`.
