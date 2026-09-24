# Auditoria de travas inventadas — Grupo 3 (FINANCEIRO)

Data: 24/09/2026. Escopo: 9 telas do financeiro. Fonte do legado: `/Library/SicomGit/retaguarda-master/fonte` (snapshot de mai/2020).
Oracle de PRODUÇÃO consultado só com SELECT, pelo `q.py`. Toda contagem abaixo é de produção, com 2025 e 2026 separados (2026 vai até 24/09).

Fatos de produção que valem para várias linhas:
- `PERIODO_CONTABIL` tem 3 linhas, todas com `STATUS='N'`, e `CONFIG_INTEGRACAO_CONTABIL.CHAVEAMENTO_PERIODO` é nulo. **Nenhuma trava de período dispara com o dado de hoje.**
- `CONTAS_BANCARIAS.DTCHAVEAMENTO` está preenchido só em 2 contas (263 = 1899-01-01; 42 = 2021-01-01). O "caixa fechado por conta" não dispara em 2025-26.
- `EMPRESAS.INTEGRACAO` = `AUTOMATICA` nas empresas 1, 2, 51 e 52, e nulo na 50.
- `ITENS_LOTECOB` está **vazia** (0 linhas).
- A tabela `CAIXA_SESSAO` (a sessão de caixa por operador) **não existe no Oracle**. É um modelo novo do Apollo.
- Nenhuma trigger de `MOV_CONTAS_BANCARIAS`, `CARTAO`, `APAGAR_BX`, `ARECEBER_BX` ou `ADIANTAMENTO_FORN` recusa operação com `RAISE_APPLICATION_ERROR`. As únicas que recusam são `VALIDA_ADIANTAMENTO` (campo nulo), `VALIDA_AGRUPAMENTO` (CODGRUPO=0) e `CHECK_REMESSAS_BOLETOS_CONTAS` (DELETE de ARECEBER com remessa).

---

### FRMBAIXAAPAGAR (8.497 acessos) — services: `cobranca/apagar-baixa.service.ts` (+ `caixa.service.ts` `lancarDaBaixa`/`estornarDaBaixa`, `baixa-caixa.ts`, `shared/periodo-contabil.ts`)

| # | Guarda (arquivo:linha — código/condição) | Classe | Âncora no legado | Evidência em produção 2025/2026 | Recomendação |
|---|---|---|---|---|---|
| 1 | `apagar-baixa.service.ts:69` e `:196` — `PERIODO_FECHADO` (DTPGTO num `periodo_contabil` com STATUS='S' e `bloq_baixa_apg`), na baixa e no estorno | a-parcial | `UBaixaApagar.pas:552` `TIntegracaoContabil.ValidaPeriodoFechado` (mensagem `mMsgPeriodoFechado`), `UReversaoBaixa.pas:119-137` (rrpPeriodoFechado). O legado de 2020 compara com `CHAVEAMENTO_PERIODO` (`UIntegracaoContabil.pas:286`). O flag `BLOQ_BAIXA_APG` existe na tabela `PERIODO_CONTABIL` de produção (binário mais novo) | Não dispara: nenhum período fechado e chaveamento nulo | manter (se quiser fidelidade total, olhar também o `CHAVEAMENTO_PERIODO`) |
| 2 | `:79` `TITULO_JA_BAIXADO` (quitada='S') · `:80` `TITULO_AGRUPADO` | a | A view `GET_APAGAR` de produção, usada na escolha de documentos (`UBaixaApagar.pas:917`), filtra `WHERE P.QUITADA='N' AND COALESCE(P.AGRUPADO,'N')='N'` | — | manter |
| 3 | `:96` `TITULO_VALOR_EXCEDE` — valor pago > total com recurso ≠ DINHEIRO | c-escopo | Nenhuma recusa. Com recurso ≠ total, o legado pergunta "Deseja gerar uma baixa parcial?" (`UBaixaApagar.pas:589`). Procurei em `UBaixaApagar.pas` (gravar/recurso) e não há teto | APAGAR com ORIGEM='B' e valor < 0 (o efeito de pagar a mais no legado): 0 em 2025 e 0 em 2026. Acréscimo digitado na baixa: 158 / 71 linhas | manter por ora (uso ≈ 0; o acréscimo explícito cobre o caso). Trocar a mensagem para orientar "lance como acréscimo" |
| 4 | `baixa-caixa.ts:65/67` `BAIXA_CC_JUROS/ACRESCIMO/DESCONTO...` — centro de custo obrigatório quando há juros, acréscimo ou desconto | a | `UBaixaApagar.pas:1797-1801` "Informe o centro de custo para juros/acréscimos/descontos recebidos." | — | manter |
| 5 | `caixa.service.ts:378` `CAIXA_NAO_ABERTO` — baixa com recurso DINHEIRO exige uma `caixa_sessao` aberta do operador (via `apagar-baixa.service.ts:152`) | **c** | Nenhuma. No legado o DINHEIRO sai de uma **conta corrente do tipo caixa** (CODBCO=0) em `MOV_CONTAS_BANCARIAS` (`ValidaSaldoAnteriorNew`, `udmPrincipal.pas:2254-2375`). Não há abertura de caixa na retaguarda (a tabela CAIXA_SESSAO não existe no Oracle) | Lotes de baixa de AP pagos por conta caixa (MCB do lote em conta CODBCO=0, sem os lançamentos de caixa): **6 em 2025 e 225 em 2026** | remover a dependência: o DINHEIRO lança na conta caixa (MCB), como o legado. Se a sessão ficar, ela não pode ser pré-requisito da baixa |
| 6 | `caixa.service.ts:382` `CAIXA_SALDO_INSUFICIENTE` — saída em DINHEIRO maior que o saldo da **sessão** | a-parcial | `udmPrincipal.pas:2334` "Saldo insuficiente para esta operação." (VerifSaldo=True em `UBaixaApagar.pas:1125`), mas só para conta caixa (CodBco=0) e sobre o saldo **acumulado da conta** na modalidade (`GetSaldoContaCorrente`). O Apollo usa saldo inicial + movimentos da sessão, uma base muito menor | Faz parte dos 225 lotes de 2026 do item 5. Hoje 2 contas caixa estão com saldo negativo (281 = −1.851,02; 662 = −14.819,44) | reduzir escopo: testar o saldo da **conta caixa** escolhida (CODBCO=0), não o da sessão |
| 7 | `:212` `REVERSAO_PARCIAL_SALDO_BAIXADO` — estorno recusado se o título-saldo da baixa parcial já tem baixa (ativa **ou estornada**) · `:213` `TITULO_AGRUPADO` no saldo | c | Nenhuma. `UReversaoBaixaContasPagar.pas:47-48` `DELETE FROM APAGAR WHERE IDLOTE=%d AND QUITADA='N'`: apaga o saldo só se ainda aberto e **deixa o quitado**, sem recusar. `ReversaoPermitida` (`:231-271`) só barra contabilizado sem integração automática e desconto de títulos | Lotes de AP estornados cujo título-saldo (ORIGEM='B', mesmo IDLOTE) já estava quitado: **0 em 2025 e 8 em 2026**. Obs.: o Apollo liga a baixa ao saldo por `codapg_gerado`, coluna que não existe no Oracle. Nos títulos migrados a guarda nunca dispara (e o saldo também não sai), então ela só vale para baixas feitas no Apollo | reduzir escopo: fiel = apagar o saldo só se QUITADA='N' e seguir. Se ficar como blindagem, recusar só com baixa **ativa** e com mensagem clara |
| 8 | `caixa.service.ts:416` `CAIXA_FECHADO` — o estorno de baixa em DINHEIRO é recusado se a `caixa_sessao` daquele movimento já fechou (via `apagar-baixa.service.ts:224`) | a-parcial / c-escopo | O conceito existe: `UReversaoBaixa.pas:15` "Não será possível reverter a baixa pois o caixa foi fechado." (`TContasBancariasBO.CaixaFechado(conta, data)`, que não está no fonte; a trava análoga de `udmPrincipal.pas:2322` é por `DTCHAVEAMENTO` da **conta**). O Apollo usa o fechamento da sessão do operador, que ocorre todo dia | Estornos de lotes de AP em conta caixa: **1 em 2025 e 13 em 2026** (8 feitos em dia posterior ao pagamento, com a sessão já fechada no modelo do Apollo). Chaveamento de conta em 2025-26: 0 | trocar a base para `CONTAS_BANCARIAS.DTCHAVEAMENTO` da conta do lote (fiel), não o status da sessão |

Omitidas (triviais): 10 (tenant; título/conta não encontrados; `TITULO_NAO_BAIXADO` ×3 no estorno; CAS `:121`; `TITULO_VALOR_INVALIDO :92` valor ≤ 0; `CAIXA_VALOR_INVALIDO`; `BAIXA_CC_INVALIDO`).
Regras do legado **ausentes** no Apollo, para registro (não são trava inventada): `QTDE_DIAS_BX_APG_FUTURA`, `PERMITE_BX_APG_DATA_RETROATIVA`, permissão do operador na conta (`UBaixaApagar.pas:1553/1561`), e o estorno recusado se contabilizado sem integração automática ou com desconto de títulos (`UReversaoBaixaContasPagar.pas:253/259`).

---

### FRMBAIXACARTAO (7.713 acessos) — services: `cadastro/cartao-baixa.service.ts`

| # | Guarda | Classe | Âncora no legado | Evidência 2025/2026 | Recomendação |
|---|---|---|---|---|---|
| 1 | `:65` `CARTAO_BAIXA_NENHUM_ABERTO` — só baixa cartão com `liberado='N'` | a | A view `GET_CARTAO` de produção tem `WHERE COALESCE(C.LIBERADO,'N')='N'`, e é a pesquisa da baixa (`UbaixaCartao.pas:822`) | — | manter |
| 2 | `:72` `CARTAO_OUTRAS_DESPESAS_EXCEDE` | a | `UbaixaCartao.pas:1413-1416` "Valor das despesas não pode ser maior que o total da baixa!" | — | manter |
| 3 | `:75` `BAIXA_CC_DESCONTO_CONCEDIDO` — CC obrigatório com outras despesas | a | `UbaixaCartao.pas:2124-2125` (ValidaCentroCustos) "Informe o centro de custo para descontos concedidos." | — | manter |
| 4 | `:156-157` `CARTAO_BAIXA_EXCEDE` — recusa se Σ baixas ativas + valor > valor do cartão (o próprio comentário diz que "o legado não tem") | c, mas funciona como d | Nenhuma no fonte (o fonte de 2020 nem grava `CARTAO_BX`; procurei em `UbaixaCartao.pas` inteiro) | Cartões **abertos** (LIBERADO='N', vendas desde 2024) com baixa ativa em `CARTAO_BX`: **0**. No legado, 1.280 (2025) e 1.082 (2026) cartões liberados têm mais de uma baixa ativa: o lote foi estornado sem marcar a baixa e o cartão baixado de novo. No Apollo o estorno marca `INDR='E'`, então esse caminho não dispara a trava | manter como blindagem (não bloqueia nada medido). Se disparar com dado migrado, a mensagem deve apontar a baixa ativa órfã |

Omitidas (triviais): 5 (tenant ×2, sem itens, conta/cartão/lote não encontrado).
Sem guardas no `estornarLote` além de not-found.

---

### FRMCONTROLECONTASBANCARIAS (7.615 acessos) — services: `cadastro/controle-contas.service.ts` (+ `contas-transf-perm.service.ts` `destinosPermitidos`)

| # | Guarda | Classe | Âncora no legado | Evidência 2025/2026 | Recomendação |
|---|---|---|---|---|---|
| 1 | `:129` `SALDO_INSUFICIENTE` no **lançamento manual** (débito em conta caixa CODBCO=0) | c | Nenhuma no lançamento. `UlancamentoSaldo.pas:54` chama `ValidaSaldoAnterior(..., LancaMov=true, VerifSaldo=**false**, ...)`. O `udmPrincipal.pas:2232-2237` que o comentário cita só roda com VerifSaldo=True. O cadastro de movimentação (`uCadMovContasBancarias.pas:115-131`) também não testa saldo | Lançamentos de saldo manuais (`LANCAMENTO_SALDO` preenchido): em conta caixa só **créditos** (1 em 2025, 1 em 2026). Débitos manuais em conta caixa: 0 | remover (ou limitar à transferência, onde é ancorada) |
| 2 | `:143` `TRANSFERENCIA_MESMA_CONTA` | a | `Utransferencia.pas:151` "A conta de destino deve ser diferente da conta de origem." | — | manter |
| 3 | `:150` `TRANSFERENCIA_NAO_PERMITIDA` — matriz `contas_banc_transf_perm` | a (pelo dado) | Não está no fonte de 2020. A tabela `CONTAS_BANC_TRANSF_PERM` existe em produção (6 contas de origem, criada em 12/06 e 11/08/2026) | Desde a criação da matriz, transferências de origem listada para destino fora da lista: **0** (63 dentro). Antes dela houve 5 em 2025 e 1 em jan/2026. Dúvida: `CONTAS_BANCARIAS.BLOQ_TRANS_CONTAS` vale 'N' nas 16 contas preenchidas, inclusive 421/441/461/541, que têm matriz. Não consegui provar se esse flag liga ou desliga a matriz no binário novo | manter; confirmar o papel de `BLOQ_TRANS_CONTAS` no binário |
| 4 | `:155` `SALDO_INSUFICIENTE` na transferência (origem conta caixa) | a | `Utransferencia.pas:187-190` "Saldo insuficiente!" (só com CODBCO=0) | — | manter |
| 5 | `:181` `MOVIMENTO_NAO_MANUAL` — só estorna `origem IN ('MANUAL','TRANSF')` | **c** | O legado apaga transferência por `NRODOCUMENTO='TRANSFERENCIA'` (`UconsMovBancaria.pas:925-966`, `DELETE ... WHERE IDLOTE=`) e movimento manual com `IDLOTE=0` (`uCadMovContasBancarias.pas:107-111` só barra com lote). **Em produção `ORIGEM` nunca é 'MANUAL' nem 'TRANSF'** (2025+: nulo, 'FCP' e 'OFX'), então nenhuma transferência ou lançamento manual migrado pode ser estornado no Apollo | Exclusões pela retaguarda (AUDIT_MOV_CONTAS_BANCARIAS, DELETE): **transferências 34 lotes / 55 linhas em 2025, 38 lotes / 62 linhas em 2026**. Manuais sem lote: 3 em 2025 e 5 em 2026 | trocar o critério: transferência = `NRODOCUMENTO='TRANSFERENCIA'` (legado) ou `origem='TRANSF'` (Apollo); manual = sem IDLOTE e sem origem de outro módulo |
| 6 | `:182` e `:190` `MOVIMENTO_CONCILIADO` — recusa estornar linha (ou perna) conciliada | c | Nenhuma. `MOV_CONCILIADO` só aparece em `UDMConciliacaoBancaria.pas:641` (quem marca). A remoção de transferência (`UconsMovBancaria.pas:925-966`) só testa CONTABILIZADO sem integração automática. E o Apollo não tem desconciliar | 79% das transferências de 2025+ estão conciliadas (1.217 de 1.547). Das linhas de transferência excluídas pelo legado, **49 (2025) e 32 (2026)** têm ORIGEM='OFX', ou seja, nasceram do lançamento automático da conciliação (835 das 1.071 transferências OFX estão conciliadas). A AUDIT não guarda MOV_CONCILIADO, então não dá prova linha a linha | remover (ou, se ficar, desfazer a conciliação junto, na mesma transação) |

Omitidas (triviais): 5 (tenant, conta/operação/movimento não encontrados).
Regras ausentes (não são trava): senha ADM do lançamento de saldo (`uControleContasBancarias.pas:184`), `EMPRESAS.LCTO_FINANCEIRO` habilitando o lançamento (`UconsMovBancaria.pas:764-766`), `DTCHAVEAMENTO` da conta (`udmPrincipal.pas:2196`), transferência contabilizada sem integração automática (`UconsMovBancaria.pas:952`).

---

### FRMMOVCAIXA (5.022 acessos) — services: `cobranca/lancamento-caixa.service.ts`, `cobranca/caixa.service.ts` (`movimentar`)

| # | Guarda | Classe | Âncora no legado | Evidência 2025/2026 | Recomendação |
|---|---|---|---|---|---|
| 1 | `lancamento-caixa.service.ts:80` `PERIODO_CONTABIL_CHAVEADO` (criar `:99`, editar/excluir `:214`) | a | `uMovCaixa.pas:158/217/247/300` `TIntegracaoContabil.PeriodoFechado` | CHAVEAMENTO_PERIODO nulo: não dispara | manter |
| 2 | `:88` `LANCAMENTO_CAIXA_SEM_SITUACAO` · `:90` `LANCAMENTO_CAIXA_SITUACAO_OBRIGATORIA` (só com `INFORMA_SITUACAO_DOC_LANC_CAIXA='S'`) | a (config) | `uMovCaixa.pas:166-172`. Produção: valor N, especial `Modulo:Retaguarda=S` | — | manter |
| 3 | `:101` `assertCentroCustoDaSituacao` | a | `uMovCaixa.pas:538-544` "O centro de custo informado não é permitido para a situação..." | — | manter |
| 4 | `:104` `LANCAMENTO_CAIXA_RECEITA_BLOQUEADA` (com `BLOQUEIA_RECEITAS_LANCAMENTO_CAIXA='S'`) | a (config, binário novo) | Não está no fonte de 2020. A config existe em produção = 'S', criada em 25/02/2026 (`AUDIT_CONFIGURACOES`, AdmScripts) | Receitas manuais reais (NEUTRA='N'): a última é de jan/2026, **0 depois de 25/02/2026**. As 14 positivas de jul-ago/2026 são "Gerado pela conciliação bancária." (outro fluxo) | manter |
| 5 | `:212` `LANCAMENTO_CAIXA_DE_OUTRA_OPERACAO` (cadastrado_manualmente ≠ 'S') | a | `uMovCaixa.pas:220-222 / 250-252` "Não é permitido editar/excluir pois o lançamento foi gerado de outra operação." | — | manter |
| 6 | `:169` `LANCAMENTO_CAIXA_CONTABILIZADO` — só quando a integração não é AUTOMATICA ou não há lote; senão estorna | a | `uMovCaixa.pas:920-951` VerificaContabilizado, mesma condição | — | manter |
| 7 | `caixa.service.ts:158` `CAIXA_NAO_ABERTO` · `:163` `CAIXA_SALDO_INSUFICIENTE` em `movimentar` (rota `POST cobranca/caixa/movimentar`, `@RequerAcesso('FRMMOVCAIXA','BTNGRAVAR')`, tela `CaixaPage`) | d | Sem par no legado: é a sessão de caixa por operador, um modelo novo (CAIXA_SESSAO/CAIXA_MOV não existem no Oracle). O FRMMOVCAIXA do legado está coberto por `lancamento-caixa`, que não depende de sessão | — | manter como está; só revisar o RBAC (usar o código do form do legado aqui confunde a paridade) |

Omitidas (triviais): 5 (tenant, PLC/conta inválidos, não encontrado, espécie/valor inválido).

---

### FRMCONFBOLETO (4.836 acessos) — services: `cobranca/cnab-remessa.service.ts`

| # | Guarda | Classe | Âncora no legado | Evidência 2025/2026 | Recomendação |
|---|---|---|---|---|---|
| 1 | `:266` `BOLETO_JA_ENVIADO` em `emitir` (registro_arq_remessa='S') | a-parcial | `uConfBoleto.pas:2610-2621` taEmitirBoleto: filtra `(NOME_ARQ_REMESSA IS NULL) or (REGISTRO_ARQ_REMESSA='C')` e segue com os elegíveis. Só avisa "Boletos selecionados já gravados..." se nenhum sobrar. O Apollo recusa o lote inteiro se houver 1 enviado | não medido (não há log do clique) | reduzir escopo: pular os já enviados e informar (como o legado) |
| 2 | `:268` `TITULO_QUITADO` em `emitir` | a | A seleção usa a view `GET_ARECEBER` (`uConfBoleto.pas:1892`), que em produção tem `WHERE R.QUITADA='N'` | — | manter |
| 3 | `:361` `BOLETO_NAO_EMITIDO`, `:363` `BOLETO_JA_ENVIADO`, `:367` `BOLETO_NAO_MARCADO_CANCELAMENTO`, `:371` `BOLETO_NAO_ELEGIVEL_ALTERACAO` | a-parcial | `uConfBoleto.pas:2657-2683`, mesmos critérios (STATUS_BOLETO='E'/'C'; ''+REGISTRO='S'), mas o legado **filtra** e segue. O Apollo recusa tudo se 1 falhar | não medido | reduzir escopo (filtrar e avisar), ou manter recusando mas listando os códigos |
| 4 | `:376` `REMESSA_VALOR_INVALIDO` · `:378` `TITULO_SEM_VENCIMENTO` | d | Nenhuma no legado. O CNAB não tem sinal nem aceita vencimento vazio, e o banco rejeitaria | — | manter |
| 5 | `:414` `REMESSAS_DO_DIA_ESGOTADAS` (contador 01-99 por dia) | a | `GetNomeArqRemessa`, `uConfBoleto.pas:1432-1461` | — | manter |
| 6 | `:299-300` `LAYOUT_NAO_SUPORTADO` (≠C400) · `:309` `BANCO_NAO_SUPORTADO` (≠341/001) · `:320-321` `CONTA_DE_OUTRO_BANCO` · `:615` `RETORNO_LAYOUT_NAO_SUPORTADO` (retorno só Itaú) | d (limitação do corte) | O legado suporta mais bancos (retorno: Itaú, Bradesco, BB e SICOOB, `UBaixaAreceber.pas:2668`) | `CONF_INTEG_BANCARIA`: 3 configs, todas C400. `REMESSAS_BOLETOS`: Itaú 167 (2025) e 112 (2026); BB 1 (2025) e 0 (2026) | manter (uso fora de 341/001 = 0 em 2026) |

Omitidas (triviais): 22 (tenant, sem títulos, não encontrados, campos CNAB obrigatórios/longos, agência/conta/CNPJ inválidos, CNAB inválido, retorno vazio/sem pagamento/não reconhecido).

---

### FRMCADCARTAO (4.337 acessos) — services: `cadastro/cartao.crud.ts` (CRUD genérico)

sem guardas de estado (não tem `validar` nem `validarRemocao`. `cartao_bx` referencia `cartao` com `ON DELETE CASCADE`, mig 277, e não bloqueia).
Omitidas (triviais): 0 (fora a validação de schema).

---

### FRMBAIXAARECEBER (3.191 acessos) — services: `cobranca/areceber-baixa.service.ts` (+ `caixa.service.ts`, `baixa-caixa.ts`, `senha-operacao.service.ts`)

| # | Guarda | Classe | Âncora no legado | Evidência 2025/2026 | Recomendação |
|---|---|---|---|---|---|
| 1 | `:93` e `:239` `PERIODO_FECHADO` (`bloq_baixa_rcb`) | a-parcial | `UBaixaAreceber.pas:1319` `PeriodoFechado(edtDataBaixa...)`, `UReversaoBaixa.pas:119-137` | Não dispara | manter |
| 2 | `:95` → `:59/:61` `SENHA_OPERACAO_REQUERIDA/INVALIDA` — **qualquer** acréscimo ou desconto ≠ 0 exige a senha DESC | a-parcial / c-escopo | `UBaixaAreceber.pas:678-680` pede `SenhaAdministrativa('DESC')` só no campo **global** `edtDesc_Acre`. Nas colunas por título da grade (`ACREDESC_VALOR`, `PERCENTUAL`, editáveis, `UBaixaAreceber.dfm:1999-2010`) o acréscimo não pede nada, e o desconto passa por `DescontoValidado` (`:420-490`: `PORCENTUAL_MAXIMO_DESCONTO`=0, especial Usuario:102=100, + `USUARIOS_LIBERAM_DESCONTO_MAXIMO_EXCEDIDO`, usuários 1/3/102 → **login de um usuário liberador**, não a senha DESC). O desconto padrão do cliente (`DESCONTO_CLIENTE`, ReadOnly) entra sem senha | ARECEBER_BX com acréscimo: **150 linhas (99 lotes) em 2025, 25 (18) em 2026**. Com desconto: 38 e 15 | reduzir escopo: senha DESC só para o acréscimo/desconto global. Desconto por título pela regra de `PORCENTUAL_MAXIMO_DESCONTO`/`USUARIOS_LIBERAM_DESCONTO_MAXIMO_EXCEDIDO`. Acréscimo por título sem senha |
| 3 | `:106` `TITULO_JA_BAIXADO` · `:107` `TITULO_AGRUPADO` | a | `UBaixaAreceber.pas:892-896`, filtro da pesquisa `COALESCE(AGRUPADO,'N')='N' AND QUITADA='N'`, e `:936` `WHERE G.QUITADA='N'` | — | manter |
| 4 | `:110` `TITULO_EM_LOTE` (itens_lotecob) · `:259` idem no saldo do estorno | c | Nenhuma: `LOTECOB` não aparece como trava em `UBaixaAreceber.pas`, e `GET_RCB` não filtra lote | `ITENS_LOTECOB` vazia: **0 / 0** | remover (inócua hoje, mas sem âncora) |
| 5 | `:125` `TITULO_VALOR_INVALIDO` (valor ≤ 0) | a | `UBaixaAreceber.pas:1345-1348` "O valor da conta deve ser maior que zero." | — | manter |
| 6 | `:131` `TITULO_VALOR_EXCEDE` — recebido > total com recurso ≠ DINHEIRO | b / c-escopo | O legado nunca recusa. `edtVlrBaixaExit` (`:812-830`): com `MOSTRAR_TROCO_BAIXA_CR` ≠ 'S' (**produção = 'N'**) o excesso vira **acréscimo** (`edtDesc_Acre := Valor − Rest`, com senha DESC). Com 'S' vira troco (`:1499-1530`). O Apollo também ignora a config no DINHEIRO (dá troco com config N) | Troco de baixa em MCB ("Troco referente a baixa..."): 0 / 0. Os acréscimos do item 2 (150 / 25) incluem o excesso convertido | tornar dependente de config (`MOSTRAR_TROCO_BAIXA_CR`): com N, converter o excesso em acréscimo em qualquer recurso. Com S, troco |
| 7 | `:137` → `baixa-caixa.ts:65/67` centro de custo obrigatório | a | `UBaixaAreceber.pas:2884-2888` | — | manter |
| 8 | `caixa.service.ts:378` `CAIXA_NAO_ABERTO` na baixa em DINHEIRO (via `:194`) | **c** | Nenhuma (mesma análise do FRMBAIXAAPAGAR #5; `ValidaSaldoAnterior` em `UBaixaAreceber.pas:547` só testa o chaveamento da conta) | Lotes de AR recebidos em conta caixa: **31 em 2025 e 23 em 2026** (6 deles são desconto de títulos) | remover a dependência da sessão (lançar na conta caixa) |
| 9 | `:256` `REVERSAO_PARCIAL_SALDO_BAIXADO` · `:257` `TITULO_AGRUPADO` no saldo | c | Nenhuma. `UReversaoBaixaContasReceber.pas:12-22` **apaga** as baixas do saldo (`DELETE_BAIXA_PARCIAL`) e o saldo (`DELETE_RCB_PARCIAL ... OR IDLOTE=%d`) em cascata, sem recusar | Títulos de AR com baixa que foram apagados (AUDIT_ARECEBER DELETE × AUDIT_ARECEBER_BX INSERT): **0 / 0** | manter como blindagem (uso 0; a cascata do legado apagaria recebimento real). Registrar a divergência |
| 10 | `caixa.service.ts:416` `CAIXA_FECHADO` no estorno (via `:277`) | a-parcial / c-escopo | `UReversaoBaixa.pas:15`, por chaveamento da **conta** (ver AP #8) | Estornos de AR em conta caixa: 1 em 2025 e 0 em 2026 | trocar a base para o DTCHAVEAMENTO da conta |

Omitidas (triviais): 9 (tenant, não encontrados, conta bancária inexistente, `TITULO_NAO_BAIXADO` ×3, CAS `:157`, `CAIXA_VALOR_INVALIDO`, `BAIXA_CC_INVALIDO`).
Regras ausentes (não são trava): `FECHAMENTO_CAIXA='S'` exige `CONSILIADO='S'` na pesquisa (`UBaixaAreceber.pas:891-892`), `QTDE_DIAS_BX_RCB_FUTURA`, `PERMITE_BX_RCB_DATA_RETROATIVA`, permissão do operador na conta (`:522/:533`), conta caixa × banco por recurso (`:525/:528`).

---

### FRMCONCILIACAOBANCARIA (1.987 acessos) — services: `cadastro/conciliacao-bancaria.service.ts`

| # | Guarda | Classe | Âncora no legado | Evidência | Recomendação |
|---|---|---|---|---|---|
| 1 | `:161` `OFX_LINHA_INDISPONIVEL` · `:164` `MOV_LANCAMENTO_INDISPONIVEL` (já conciliado / de outra conta) | d | O legado só lista os pendentes. É concorrência e consistência, e não bloqueia nada que o legado permita | — | manter |
| 2 | `:177` `LOTE_INCOMPLETO` | a | `UDMConciliacaoBancaria.pas:702-755` "O lote %d não foi conciliado totalmente." | — | manter |
| 3 | `:184` `CONCILIACAO_TOTAIS_DIVERGENTES` | a | `UFrmConciliacaoBancaria.pas:437-457` "O total das movimentações do sistema (%s) não bate com o total das movimentações OFX (%s)." | — | manter |

Omitidas (triviais): 4 (tenant ×2, conta não encontrada, OFX sem transações).
Regra ausente: `ValidaConciliacaoManual` (OFX de datas diferentes, `UDMConciliacaoBancaria.pas:680-700`).

---

### FRMADIANTAMENTOFORNECEDOR (731 acessos) — services: `cobranca/adiantamento-forn.service.ts`

| # | Guarda | Classe | Âncora no legado | Evidência 2025/2026 | Recomendação |
|---|---|---|---|---|---|
| 1 | `:52/:55/:58/:59` situação obrigatória / não é de adiantamento / tipo obrigatório | a (config) | `uCadAdiantamentoFornecedor.pas:117-123` (`INFORMA_SITUACAO_DOC_ADIANTAMENTO_PARCEIROS`) | — | manter |
| 2 | `:69` `PARCEIRO_INATIVO` · `:73` `PARCEIRO_NAO_PERMITIDO_SITUACAO` · `:98` `CONTA_SEM_PERMISSAO_OPERADOR` | a | `:186` (pesquisa `ATIVADO='S'`), `:521` "O cliente informado não é permitido para a situação...", `:572` "Este Operador não tem permissão para manipular essa conta corrente." | — | manter |
| 3 | `:217` (criar), `:366` (editar/excluir, com a data de hoje), `:400` (editar, data nova) `PERIODO_FECHADO` (`bloq_adiantamento_forn`) | a-parcial | `:197/:218` `PeriodoFechado(GetDataHoraServidor)`, só com a data de **hoje** no editar/excluir. O teste da data nova (`:400`) e o da criação são extensões | Não dispara | manter |
| 4 | `:220` (criar) `CAIXA_FECHADO` por DTCHAVEAMENTO · `:402` (editar) | a (criar) / c-escopo (editar) | Criar: `udmPrincipal.pas:2196` via `edtNroContaExit` (`:582-600`, só com `FlagGravacao=0`). No editar (`btnEditarClick` põe `FlagGravacao:=1`, `:208`) o legado **não** testa chaveamento | Chaveamentos são de 1899 e 2021: 0 | reduzir escopo: tirar do `editar` (`:402`) |
| 5 | `:225` `SALDO_INSUFICIENTE` (tipo D, conta caixa) | a | `:582-590` `ValidaSaldoAnterior(..., VerifSaldo=true)` → `udmPrincipal.pas:2237` | Adiantamentos 2025-26 em conta caixa: 0 | manter |
| 6 | `:367` `ADIANTAMENTO_BAIXADO` | a | `:200-202 / :221-223` "Não é possivel alterar/excluir o registro, documento ja baixado!" | — | manter |
| 7 | `:371` `ADIANTAMENTO_CONTABILIZADO` — **incondicional** | **b** | `:777-806` VerificaContabilizado: só bloqueia se `EMPRESAS.INTEGRACAO <> 'AUTOMATICA'`. Com AUTOMATICA **estorna** (`TIntegracaoAdiantamento.Estornar`) e deixa editar/excluir (é o padrão da Lição 140) | Contabilizados: **12 de 12 (2025) e 11 de 12 (2026)**, empresas com integração AUTOMATICA, então **toda edição ou exclusão é barrada no Apollo**. Prova de uso: as 2 exclusões do período, **nº 3141 (18/12/2025, R$ 797,81) e nº 3401 (28/08/2026, R$ 682.318,00)**, têm na AUDIT_MOV_CONTAS_BANCARIAS `CONTABILIZADO` 'S' → nulo (o estorno) segundos antes do DELETE. Mais 2 edições de campo de negócio em 2026 (nº 3161, nº 3441), ambos contabilizados | tornar dependente de config (`EMPRESAS.INTEGRACAO`): com AUTOMATICA, estornar o contábil do adiantamento e seguir. O motor `TIntegracaoAdiantamento` precisa existir, ou pelo menos o estorno do DIÁRIO da origem |
| 8 | `:382` `MOVIMENTO_CONCILIADO` (a MCB do adiantamento conciliada) | c | Nenhuma: o `btnExcluirClick`/`btnEditarClick` do legado (`:195-260`) não olha conciliação, e `MOV_CONCILIADO` só aparece em `UDMConciliacaoBancaria.pas:641` | MCB dos adiantamentos conciliada: **11 de 12 (2025) e 12 de 12 (2026)**. Bloqueia os mesmos 2 casos de exclusão e 2 de edição do item 7 | remover (ou desconciliar junto) |
| 9 | `:328`/`:349` `TITULO_JA_BAIXADO` · `:333`/`:352` `TITULO_TEM_BAIXA` (título gerado) | a-parcial (redundante) | O legado olha só o flag `ADIANTAMENTO_FORN.QUITADA`, que a baixa do título liga (`UBaixaApagar.pas:485`, `UBaixaAreceber.pas:1233`). Na prática é a mesma condição do #6 | Adiantamentos quitados: 1 (2025), 0 (2026) | manter (mesmo efeito do #6) |
| 10 | `:329`/`:350` `TITULO_AGRUPADO` · `:335` `TITULO_EM_LOTE` | c (d na intenção) | Nenhuma no legado | `ITENS_LOTECOB` vazia. Não medi título de adiantamento agrupado (universo de 24 adiantamentos em 2 anos) | manter como blindagem (apagar título agrupado quebraria o consolidado). EM_LOTE pode sair |

Omitidas (triviais): 5 (tenant, situação/parceiro/conta/adiantamento não encontrados).

---

## Achados do grupo por impacto

1. **FRMBAIXAAPAGAR (8.497) — `CAIXA_NAO_ABERTO` / `CAIXA_SALDO_INSUFICIENTE` da sessão (`caixa.service.ts:378/382`)**: 225 lotes de pagamento por conta caixa em 2026 (6 em 2025) passam a exigir uma sessão de caixa que o legado não tem (a tabela nem existe no Oracle). O DINHEIRO deveria lançar na conta caixa.
2. **FRMCONTROLECONTASBANCARIAS (7.615) — `MOVIMENTO_NAO_MANUAL` (`controle-contas.service.ts:181`)**: nenhuma linha migrada tem ORIGEM 'MANUAL'/'TRANSF', então nenhuma transferência ou lançamento do legado pode ser estornado. O cliente exclui 34 (2025) e 38 (2026) lotes de transferência.
3. **FRMCONTROLECONTASBANCARIAS (7.615) — `MOVIMENTO_CONCILIADO` (`:182/:190`)**: sem âncora e sem desconciliar no Apollo. 79% das transferências são conciliadas, e 81 das 117 linhas de transferência excluídas pelo legado eram de origem OFX (nascem conciliadas). Depois da virada, isso barra a maioria das remoções.
4. **FRMADIANTAMENTOFORNECEDOR (731) — `ADIANTAMENTO_CONTABILIZADO` incondicional (`:371`) + `MOVIMENTO_CONCILIADO` (`:382`)**: 23 de 24 adiantamentos estão contabilizados (integração AUTOMATICA) e conciliados, então 100% das edições e exclusões são barradas. Há prova de que o legado estorna e exclui: nº 3401, R$ 682.318,00, 28/08/2026.
5. **FRMBAIXAAPAGAR (8.497) — `REVERSAO_PARCIAL_SALDO_BAIXADO` (`:212`) e `CAIXA_FECHADO` no estorno (`caixa.service.ts:416`)**: 8 lotes de 2026 estornados com o saldo já quitado (o legado segue) e 13 estornos em conta caixa em 2026 (8 em outro dia).
6. **FRMBAIXAARECEBER (3.191) — senha DESC para qualquer acréscimo/desconto (`:95`)**: o legado pede senha DESC só no campo global. O acréscimo por título é livre e o desconto por título usa a liberação por usuário (`PORCENTUAL_MAXIMO_DESCONTO`/`USUARIOS_LIBERAM_DESCONTO_MAXIMO_EXCEDIDO`). Atinge 150 (2025) e 25 (2026) baixas com acréscimo.
7. **FRMBAIXAARECEBER (3.191) — `CAIXA_NAO_ABERTO` (31/23 lotes em conta caixa) e `TITULO_VALOR_EXCEDE` (`:131`)**: com `MOSTRAR_TROCO_BAIXA_CR='N'` o legado transforma o excesso em acréscimo em vez de recusar.
8. **FRMCONTROLECONTASBANCARIAS — `SALDO_INSUFICIENTE` no lançamento manual (`:129`)**: sem âncora (`UlancamentoSaldo.pas:54` usa VerifSaldo=false), mas uso ≈ 0: não há débito manual em conta caixa em 2025-26.
9. **FRMBAIXACARTAO (7.713) — `CARTAO_BAIXA_EXCEDE` (`:156`)**: o próprio código admite que é invenção, mas afeta 0 cartões abertos. Fica como blindagem.
10. **FRMBAIXAARECEBER/ADIANTAMENTO — `TITULO_EM_LOTE`**: sem âncora, e `ITENS_LOTECOB` está vazia (0). Pode sair.
Sem trava inventada: FRMCADCARTAO (sem guardas), FRMCONCILIACAOBANCARIA (tudo ancorado), FRMMOVCAIXA (`lancamento-caixa` todo ancorado; `caixa/movimentar` é modelo novo, d), FRMCONFBOLETO (ancorado; as parciais são só "recusa tudo × filtra e segue"; limitação de banco/layout com uso 0).
