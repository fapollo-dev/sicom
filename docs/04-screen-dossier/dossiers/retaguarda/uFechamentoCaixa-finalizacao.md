# FECHAMENTO DE CAIXA — a FINALIZAÇÃO (consolidação por PDV) e o FECHAMENTO DIÁRIO

Recon de 2026-08-19. **Ausência provada no código** (`grep` por `finaliza_fechamento`, `doc_fechamento`,
`'DINHEIRO CONTADO'`, `'SANGRIA EM'` em `apps/api/src` e `apps/api/migrations`: zero ocorrências) — a lição do
ciclo anterior aplicada antes de eleger o alvo.

## 1. O achado: uma lacuna no épico MAIS USADO do sistema

Refazendo o levantamento de uso do menu **sem truncar a saída** (o erro do ciclo anterior escondeu as 15
primeiras linhas), o topo real é:

| acessos | operadores | form | coberto no novo? |
|---:|---:|---|---|
| 512.456 | 30 | `FRMETIQUETA` | sim |
| **41.215** | **35** | **`FRMFECHAMENTOCAIXA`** | sim (épico Caixa) — **mas falta a etapa desta nota** |
| 40.741 | 38 | `FRMCADSCRAP` | sim |
| 29.341 | 41 | `FRMNF` | sim |
| 27.161 | 39 | `FRMCADPRODUTO` | sim |
| 27.086 | 33 | `FRMMANIFESTODFE` | sim |
| 25.881 | 34 | `FRMCADAGENDAPROMOCAO` | sim |
| 24.915 | 20 | `FRMPEDIDOCOMPRA` | sim |
| 24.045 | 28 | `FRMAPAGAR` | sim |
| 14.287 | 25 | `FRMRELVENDAS` | sim (hub) |
| 7.897 | 9 | `FRMRELFINALIZADORAS` | sim |

Ou seja: os 11 forms mais usados estão migrados — o que confirma a estratégia "o mais pesado primeiro". O que
falta é uma **etapa interna** do 2º colocado.

## 2. `FINALIZA_FECHAMENTO` + `DOC_FECHAMENTO` — a consolidação que falta

Quem escreve essas tabelas no legado: `UfinalizaFechamento.pas` (2.664 linhas), `Utesouraria.pas` +
`UdmTesouraria` e `uDmFechamentoCaixa.dfm`. Quem abre a tela `TfrmFinalizaFechamento`: **`uFechamentoCaixa.pas`**
(o form de 41.215 acessos), `UConsDocs.pas` e `uFinalizaFechamentoLanc.pas`. É a etapa em que o gerente/tesouraria
**consolida, por PDV e por operação, o que o caixa apurou** — e guarda os documentos que compõem cada valor.

`FINALIZA_FECHAMENTO` — **172.164 linhas**, 2020-08 a **2025-09**, 21 PDVs:

| coluna | papel |
|---|---|
| `DATA` · `PDV` · `IDEMPRESA` | a chave do fechamento (dia × PDV × empresa) |
| `OPERACAO` | o que está sendo fechado (texto, §3) |
| `VRREAL` | o valor apurado da operação |
| `OPERADOR` | quem fechou |
| `CODIFINFECH` | o id da linha (referenciado por `DOC_FECHAMENTO`) |
| `CONSOLIDADO` | `'F'` em 2.280 linhas · nulo nas outras |
| `CHAVE` | identificador auxiliar |
| `TIPO` | **NULL em 172.164/172.164 ⇒ coluna morta** (cópia-fiel-negativa) |

`DOC_FECHAMENTO` — **876.927 linhas**: `CODIGO` · `OPERACAO` · `CODDOCFEH` · `CODIFINFECH` (o vínculo com a linha
de `FINALIZA_FECHAMENTO`). É o **detalhe documental** de cada valor consolidado.

## 3. As operações do fechamento (do golden, com volume e soma)

| operação | linhas | Σ VRREAL |
|---|---:|---:|
| CARTOES | 12.255 | R$ 34.212.644,09 |
| SANGRIA EM DINHEIRO | 12.262 | R$ 13.951.430,12 |
| DINHEIRO | 12.262 | R$ 13.927.789,24 |
| POS | 12.259 | R$ 2.979.873,23 |
| SUPRIMENTO | 12.262 | R$ 371.004,74 |
| DINHEIRO CONTADO | 12.262 | R$ 350.727,24 |
| DEVOLUCAO | 12.259 | R$ 50.667,17 |
| CHEQUE · SANGRIA EM CHEQUE · OUTRAS SANGRIAS | 12.262 cada | **R$ 0,00** (cópia-fiel-negativa: a operação existe e nunca teve valor) |

O padrão de ~12.260 linhas por operação mostra que **todas as operações são gravadas sempre**, mesmo zeradas —
é um "formulário fixo" por PDV/dia, não uma lista do que houve. Copiar isso importa: um fechamento sem linha de
CHEQUE não é o mesmo que um fechamento com CHEQUE = 0.

## 4. `FRMFECHAMENTODIARIO` — a outra tela, pequena e independente

Não confundir: `uFechamentoDiario.pas` (840 linhas, 389 acessos, 8 operadores) mexe só na tabela
**`FECHAMENTO`** (3.439 linhas · 4 empresas · 2019-08 a **2026-04** · `STATUS` `'F'` em 1.997 e nulo em 1.442).
O que ela faz: um calendário do mês onde cada dia é **fechado** (`FechaDia` → `STATUS='F'` + `VerificaNFs`) ou
**reaberto** (`AbreDia` → `STATUS = null`), com botões de fechar/abrir o **mês inteiro** (F8/F9) e atalhos
F6/F7. As três grades da tela (`cdsNF`, `cdsNFS`, `cdsEcf`) mostram as notas de entrada, de saída e os cupons do
dia — é a conferência antes de travar.

Relação com o que já existe: o novo tem `periodo_contabil` com bloqueios por **período/mês** (migs 038/100,
`BLOQ_NF` etc.). O `FECHAMENTO` é um nível **por DIA** e não tem equivalente — mas é uma tela pequena.

## 5. Corte proposto (ordem por valor)

1. **corte-1 — a finalização do fechamento de caixa**: `finaliza_fechamento` + `doc_fechamento`, a gravação do
   formulário fixo de operações por PDV/dia (inclusive as zeradas), o vínculo documental e o `CONSOLIDADO`.
   É a lacuna do form de 41.215 acessos. Antes de codar falta ler em `UfinalizaFechamento.pas` **de onde vem
   cada `VRREAL`** (o que é somado do PDV × o que o operador digita, como o `DINHEIRO CONTADO`) e o que o
   `CONSOLIDADO='F'` habilita/trava.
2. **corte-2 — fechamento diário** (`FECHAMENTO`): fechar/reabrir o dia, em lote pelo mês, com a conferência de
   NFs/cupons; e decidir a relação com o `periodo_contabil` (dia × mês) em vez de duplicar o conceito.

---

## RECON DE PRODUÇÃO (23/09/2026) — substitui as premissas acima, que eram da homologação

A tela voltou para a fila por decisão do usuário ("corrija e siga"). Medido no Oracle de produção (2025-01-01 → 2026-09-22).

### Sete achados que mudam o plano
1. **"Efetivar fechamento" NÃO grava FINALIZA_FECHAMENTO.** FF e DOC_FECHAMENTO são um RASCUNHO salvo a cada `FormClose`,
   mesmo sem fechar (`UfinalizaFechamento.pas:1410-1416` → `ProcessaFinalizaFechamento :2056-2189`). O fechamento em si
   grava CAIXA, MOV_CONTAS_BANCARIAS (FCP), SALDO_OPERADOR, ARECEBER/CAIXA da quebra, CONTACORRENTEOP, APAGAR, as marcas
   dos documentos e o CX_VENDAS.
2. **`CONSOLIDADO='F'` é defeito do legado**: o UPDATE filtra `DATA = now` em vez da data do caixa (`:2179`) — 1.139 de
   142.708 linhas; o fechamento acontece em média 6,66 dias depois da data do caixa (máx. 96).
3. **Utesouraria é código morto**: nada instancia `TfrmTesouraria`; TESOURARIA e FINALIZA_FECHAMENTO_LANC têm 0 linhas.
   "Tesouraria" na prática é `CX_VENDAS.TESOURARIA='S'`, gravado junto com `STATUS='F'` no efetivar (`uFechamentoCaixa.pas:425-434`).
4. **A quebra cobre TODAS as operações**, não só o dinheiro: `diferença = TOTALREAL − (TOTALVALOR + recarga + correspondente +
   voucher + troco solidário) + devolução em dinheiro` (`:897-907`, `:1736`). O `caixa-conferencia` do Apollo conta só DINHEIRO.
5. **Contábil em dobro (CORRIGIDO, mig 316 + pós-carga):** `CX_VENDAS.CONTABILIZADO` nulo em 100% dos 474.750 de 2026; o
   legado marca o CAIXA do fechamento (mesmo CODGRUPO). O `caixa-pdv-contabil` repostaria todos os turnos migrados.
6. **Situação da quebra desatualizada no Apollo**: `CONFIG_INTEGRACAO_CONTABIL.CONFIG_FALTACAIXA = 2002` (D148/C183, 1.795
   linhas no DIÁRIO em 2026); a 2018 foi usada até 2024. O `caixa-conferencia` fixa 2018 e CODORIGEM 18; o legado usa
   CODORIGEM 17 com IDORIGEM = IDSALDOOP.
7. **Exclusão cruzada (CORRIGIDO, mig 316):** o estorno do caixa do Apollo apagava FCP por `nropdv_fechamento = codcaixa`
   (no legado, o número do PDV) e DIÁRIO 17/19 por `idorigem = codcaixa`.

### O fluxo (uFechamentoCaixa)
- Abre em "Caixas em aberto" (`Ucxaberto.pas:108-155`: CX_VENDAS × OPERADORES × PDV × CAIXA_PDV). Verde = TESOURARIA 'S',
  vermelho = STATUS 'F'. F5 observação (CAIXA_OBS), F6 transferência.
- Turno aberto: **completa o CX_VENDAS** com uma linha `NROPEDIDO='00000'` por modalidade de FORMAS_PGTO (DESTINO<>'QUE')
  que falta (`:1583-1601`) e abre a finalização. Na produção essas linhas vêm `LANC_PROVISORIO='S'` (27.941 em 2026) —
  ⚠️ correção (24/09): isso é do FONTE de 2020 (`UdmLancProv.pas:94-100`, o `OnNewRecord` do `cdsLancProv`), não do binário
  novo; o `LANC_PROVISORIO_USUARIO` é o usuário logado. E vazam modalidades da outra empresa (§ corte 1).
- Grade (`ProcessaSQL :1785-2006`): data+hora, PDV, operador, turno (CHAVE), operação, status (1 aberto, 2 F sem
  tesouraria, 3 tesouraria), empresa; exclui DESCONTO/ACRESCIMO/SANGRIA/SUPRIMENTO.
- Ações: Fechar/Consultar, Abrir (`UabertCaixa`), Caixas abertos, Reabrir (`:504-1086`), Lançamento provisório (DADOSCX),
  impressões (análise, relatório de fechamento, comprovante de quebra, histórico).
- RBAC (produção): FRMFECHAMENTOCAIXA, BTNFECHA, BTNABRIR, BTNCXABERTO, FECHAMENTOCAIXA1 (170 linhas / 68 operadores);
  BTNREABRIR e BTNLANCPROV (117 / 44). Configurações: `USUARIOS_PERMITIDOS_ALTERAR_SUP_SAN_FECHAMENTO` (13),
  `USUARIOS_PERMITIDOS_EXCLUIR_DOCUMENTOS_FECHAMENTO` (1/59/701), `LIMITE_LANCAR_SALDO_AUTOMATICAMENTE_FECHAMENTO` = 2.

### A finalização (TfrmFinalizaFechamento)
| Linha | De onde vem o VRREAL |
|---|---|
| TEF/CRT (CARTOES, PIX, POS, PIX POS, IFOOD) | Σ CARTAO.VALOR dos documentos selecionados (`RealizaConf :2397-2521`; `CONSILIADO IS NULL`) |
| RCB (CONVENIO, DEVOLUCAO, BOLETO) | Σ ARECEBER.VALOR selecionados (`:2315-2355`) |
| CHQ/CHP | Σ CHEQUE.VALOR (`:2356-2396`) |
| TICKET | Σ TICKET.VALORLIQ (cria o TICKET que falta a partir do CX_VENDAS, `:2200-2313`) |
| DINHEIRO | digitado: `REAL = dinheiro contado + sangria em dinheiro − suprimento` (`:1109-1119`) |
| SANGRIA EM DINHEIRO/CHEQUE/OUTRAS, SUPRIMENTO | Σ HIST_SANGRIA_SUPRIMENTO por tipo × destino (`:1468-1542`) |
| DINHEIRO CONTADO | digitado |

**Efetivar** (`btnFechaClick :234-895`, uma transação): valida conta por PDV×forma (`CONTACORRENTE.CODPLC` +
`FORMAS_PGTO.CODCONTACORRENTE`), documentos não selecionados (confirma ou liberação), LIMITE da quebra; grava
`LancaApagar` (recarga/correspondente/voucher/troco — na produção só ORIGEM T, 1.681), CAIXA por linha com REAL>0
(ORIGEM 'FECHAMENTO', novo CODGRUPO), MCB FCP por linha (3 regras de configuração), CONTACORRENTEOP, SALDO_OPERADOR se
diferença<>0, quebra com título (ARECEBER 'Q' + CAIXA 'QUEBRA DE CAIXA'), marcas `CONSILIADO='S'`+`DTFECHAMENTOCX` nos
documentos, HISTORICO; e o CX_VENDAS vai a `STATUS='F'`, CODGRUPO, `TESOURARIA='S'`, com a integração se AUTOMATICA.

**Reabrir**: trava por DTCHAVEAMENTO da conta do dinheiro; estorna o contábil (ou bloqueia se não AUTOMATICA); reverte
APAGAR; apaga CAIXA; MCB apaga ou lança débito (`EXCLUI_OU_LANCA_DEBITO_REABRIR_CAIXA`); CX_VENDAS e CONSILIADO voltam a
nulo (DTFECHAMENTOCX, TICKET, AGRUPARECEBER e CONTACORRENTEOP NÃO são revertidos); quebra apagada, SALDO_OPERADOR
`EXCLUIDO='S'`; FF CONSOLIDADO nulo (FF/DOC ficam). 114 reaberturas em 2026.

### Produção
142.708 linhas FF, 9.132 turnos, 17 PDVs, 93 operadores (~420 turnos/mês); toda operação é gravada mesmo zerada.
DOC_FECHAMENTO: CARTOES 702.903 · POS 43.277 · PIX 33.451 · CONVENIO 25.412 · DEVOLUCAO 1.993 (joins 100%). Em 2026:
CAIXA FECHAMENTO 13.939 linhas / R$ 19,95 mi; MCB FCP 10.390 C; SALDO_OPERADOR ~450/mês; CARTAO 300.819 conciliados;
CONTACORRENTEOP é acumulador só-escrita (nenhum 'SALDO ANTERIOR' no CX_VENDAS, jamais).

### O que o Apollo tem
Lista de abertos só como relatório (`rel-caixa`); grade por operação, documentos, FF/DOC, completar CX_VENDAS, CAIXA/MCB
por modalidade, marcas, APAGAR do troco, reabertura do turno — FALTAM. SALDO_OPERADOR + título de quebra — PARCIAL
(`caixa-conferencia`, só dinheiro, sem LIMITE, sem CAIXA da quebra, sem CONTACORRENTEOP, sem tela). Contábil — DIVERGENTE
(`caixa-pdv-contabil`: CX_VENDAS líquido por CODGRUPO × legado CAIXA/CODCX + SALDO_OPERADOR/IDSALDOOP).

### Cortes
1. **conferência + rascunho** (sem efeito financeiro): turnos por data, detalhe do turno (a grade + adicionais), documentos
   por operação, rascunho FF/DOC (todas as linhas, inclusive zeradas), completar o CX_VENDAS, modo consulta, tela.
2. **efetivar**: numa transação, tudo acima; o `caixa-conferencia` vira parte disto (um escritor só da quebra).
3. **contábil + reabertura**: a semântica do legado (CAIXA por tipo de recurso, 2010; SALDO_OPERADOR com as situações de
   CONFIG 2002/2019; APAGAR CODGRUPO_FCX; CODORIGEM 17) e a reabertura completa.
4. **acessórios**: lançamento provisório/DADOSCX, relatórios, comprovante, CAIXA_OBS, documentos manuais.

---

## CORTE 1 ENTREGUE (24/09/2026) — conferência + rascunho, sem efeito financeiro

Mig 322 · `fechamento-caixa.service.ts` / `.controller.ts` · `FechamentoCaixaPage` (`/cobranca/fechamento-caixa`) · smoke §168 (7).
Especificação lida no fonte e medida na produção (só leitura) — os números de cobertura abaixo são de 2026.

### O que entrou
- **Turnos do dia** (`Ucxaberto.pas:108-155`, `SQL_Sem_Chave` — `FECHAMENTO_CAIXA_SOMENTE_CHAVE='N'` na produção; o
  `SQL_Com_Chave` existe para 'S' sem movimento sem chave no dia): PDV × operador × CHAVE × status; hora de entrada do
  CAIXA_PDV ou, sem ela (PDVs 21-23 de autoatendimento), da própria CHAVE (PDV + ddmmyy + hhmiss). RBAC `BTNCXABERTO`.
- **Detalhe do turno** (`ProcessaSQL` + `FormShow`): grade por operação (`cdsFechaVendas`: sistema = valor − troco − balcão −
  sangrias + suprimentos; na prática valor − troco), exclui DESCONTO/ACRESCIMO/SANGRIA/SUPRIMENTO; REAL do rascunho; saldo
  = real − |sistema|; sangria em dinheiro/cheque/outras e suprimento pelo HIST (tipo × destino da forma), com o valor do
  rascunho quando > 0; adicionais do CAIXA_PDV ou, zerados, do HIST_RECARGA/CORRESPONDENTE/VOUCHER/TROCO_SOLIDARIO;
  cancelamentos; descontos das vendas (informativo); diferença = real − (sistema + adicionais) + devolução em dinheiro.
  Turno fechado = **consulta** (lê o rascunho sem o filtro de consolidado, lista documentos já conciliados, não grava).
- **Abrir para fechar**: completa o CX_VENDAS (uma linha zerada por modalidade DESTINO<>'QUE' que falta, `'00000'`, 'C',
  00:00 do dia, `LANC_PROVISORIO='S'` + data + usuário); insere a sangria/o fundo do CAIXA_PDV sem histórico ("Inserido
  automaticamente pelo fechamento de caixa", forma = a única `%DINHEIRO%` — com mais de uma o subselect do legado falha e
  a exceção é engolida: não insere); cria o TICKET que falta com a CHAVE (o binário novo grava; o fonte não).
- **Documentos** (`UConsDocs`): CARTAO (TEF/CRT), ARECEBER (RCB), CHEQUE (CHQ/CHP, com a marca de sangria), TICKET (CXA com
  "TICKET", sem filtro de chave, pelo líquido), HIST_DEVOLUCAO (DEV); filtros empresa, PDV, operador, `(forma OR
  DINHEIRO)`, não conciliado (fora da consulta), CHAVE, dia; `EMPRESAS.FILTRAPDV='NAO'` deixa só o dia. Sangria: sempre
  todos marcados. Na primeira vez nada vem marcado; depois, os do rascunho. Tecla T marca/desmarca todos.
- **Rascunho** (`ProcessaFinalizaFechamento`): apaga as operações duplicadas inteiras (com chave); uma linha por operação
  da grade + as 4 fixas + DINHEIRO CONTADO, todas mesmo zeradas, na data do caixa; `CODIFINFECH`/`CODDOCFEH` pelas
  sequências (PK nova: únicos no Oracle); documentos marcados entram, desmarcados saem; a operação que não foi conferida
  nesta vez fica como estava (o `cdsSel` do legado nasce do rascunho). O REAL é recalculado no servidor pela soma dos
  documentos listáveis (o que foi mandado e não está na lista é recusado); DINHEIRO = contado + sangria − suprimento na
  primeira linha que começa com DINHEIRO (o `Locate` parcial). `EMPRESAS.VALIDACAIXA='N'` trava o contado.

### Decisões conscientes (defeitos do legado não copiados)
1. **Vazamento de modalidade entre empresas** (22,6% dos turnos de 2026 levaram linha de completar de outra empresa: o
   `cdsOperacoes` carregado uma vez no `FormShow`): aqui é sempre o FORMAS_PGTO da empresa do turno.
2. **`LimpaRetorno` sem argumento** apagando a seleção da última modalidade (78 linhas de produção com REAL e sem DOC): o
   REAL sai sempre dos documentos gravados.
3. **Corte das horas no minuto 23:59**: o dia inteiro (em 2026 nenhuma venda entre 23:59:01 e 23:59:59).
4. **Sem transação no legado** (autocommit + ApplyUpdates): aqui tudo numa transação.
5. **Filtro de empresa** no HIST de sangria e no CAIXA_PDV (o legado filtra só PDV/operador/chave/dia): igual na prática
   (a chave carrega PDV + data/hora) e necessário no tenant multiempresa.
6. **Momento do TICKET**: o legado cria ao abrir o diálogo do ticket; aqui ao abrir o turno. Mesmo estado final para quem
   confere (4 linhas de TICKET desde 2025).
7. **A coluna "Venda Balcão" do dfm aponta para VALORB**: aqui mostra a VENDA_BALCAO (0 em 2026).

### Tabelas (mig 322)
HIST_SANGRIA_SUPRIMENTO ganha as 9 colunas do binário novo (IDENTIFICADOR, IDENTIFICADOR_MOVCB, CODOPERADOR_CADASTRO,
…_FECHADO/LOTE/DATA, …_AUTENTICADO/LOTE/DATA) e sai da exclusão do plano ("PDV" era errado: o retaguarda lê e grava);
TICKET (49), HIST_TROCO_SOLIDARIO (11.134), HIST_RECARGA/CORRESPONDENTE/VOUCHER/DEVOLUCAO (vazias, estrutura inteira)
entram com todas as colunas; os vereditos "PDV" de TICKET e TROCO_SOLIDÁRIO no `conferir-tabelas-fora.py` saem.

### Falta (cortes 2-4)
- **Corte 2 — efetivar**: validações (conta por PDV×forma, documentos não marcados, LIMITE da quebra), CAIXA 'FECHAMENTO'
  por linha, MCB FCP, CONTACORRENTEOP, SALDO_OPERADOR, quebra (ARECEBER 'Q' + CAIXA), marcas CONSILIADO/DTFECHAMENTOCX,
  CX_VENDAS STATUS/TESOURARIA/CODGRUPO, `CONSOLIDADO='F'` (com a data de hoje, como o legado), APAGAR do troco solidário.
- **Corte 3 — contábil + reabertura**. **Corte 4 — acessórios**: diálogos de recarga/voucher/troco, documentos manuais
  (inserir/editar/excluir no diálogo, `USUARIOS_PERMITIDOS_EXCLUIR_DOCUMENTOS_FECHAMENTO`), CARTAO criado só com
  `ReabriuCaixa`, lançamento provisório, F5 observação, F6 transferência, impressões.

---

## CORTE 2 ENTREGUE (24/09/2026) — efetivar o fechamento

Mig 325 · `FechamentoCaixaService.efetivar` (`POST cobranca/fechamento-caixa/turno/efetivar`, BTNFECHA) · botão "Efetivar
fechamento" e a caixa "Gerar saldo do operador" na tela · smoke §169 (4). Especificação com a produção de 2026 (3.668
grupos, 13.939 linhas de CAIXA, 10.390 MCB FCP, 3.663 SALDO_OPERADOR) reconstruída turno a turno.

### O que entrou (tudo numa transação)
- **Guarda que o legado não tem:** o CX_VENDAS do turno é travado (FOR UPDATE) e tem de ter linha aberta — 3 chaves de
  2026 foram fechadas duas vezes (CAIXA, MCB e SALDO duplicados).
- **O rascunho primeiro**, com a seleção da tela (o legado grava ao fechar a tela; aqui dentro da transação).
- **Validações na ordem do legado:** conta do usuário que fecha (`FECHA_CAIXA_CC_OPERADOR`, `PARCEIROS.CODCONTA`); o
  saldo do operador — marcado à mão ou quando |diferença| > `LIMITE_LANCAR_SALDO_AUTOMATICAMENTE_FECHAMENTO` (2 nas
  empresas 1 e 2) — exige o operador com parceiro, a forma de quebra na empresa (`EMPRESAS.IDPGTO`) e o CC dela no PDV;
  cada linha com REAL > 0 exige o CC do par PDV × forma em CONTACORRENTE e a conta na forma; documentos listáveis não
  conferidos perguntam "A finalizadora X possui documentos que não foram selecionados. Deseja continuar?" (422 com a
  lista; a tela reenvia com a confirmação — com a config de usuários vazia na produção, é a confirmação simples).
- **LancaApagar:** o título de cada adicional com fornecedor e CC na empresa (produção: só o troco solidário, 'T') —
  APAGAR (novo CODGRUPO, CODGRUPO_FCX = o do fechamento), CX_APAGAR (TIPO 'V') e a CAIXA 'APAGAR' do binário novo.
- **Por linha com REAL > 0:** CAIXA ORIGEM 'FECHAMENTO' (CC de CONTACORRENTE, PDV = número, "1/1", SISTEMA, chave,
  "Referente ao fechamento de caixa do(a) operador(a): …") + HISTORICO 'CAIXA'; MCB 'FCP' na conta da forma (cheque só
  o de fora da sangria; zero não grava), e no DINHEIRO a conta do usuário e o CONTADO com `ENVIA_SANGRIA_SUPRIMENTO_
  CONTA_FISCAL` (a sangria já foi à conta fiscal na hora) + HISTORICO 'MOV_CONTAS_BANCARIAS' (que descreve a conta da
  forma, como o legado).
- **CONTACORRENTEOP** de toda linha: saldo zero zera o acumulado; com o saldo marcado, soma.
- **A diferença:** SALDO_OPERADOR sempre que ≠ 0; na quebra com o saldo marcado, o A Receber 'Q' (parceiro do operador,
  forma RCB — a BOLETO, como a produção desde 08/2025 —, CC da quebra, AGRUPADO 'N' e TOTAL_BRT que as triggers do
  Oracle punham) e a CAIXA da quebra (tipo QUEBRA DE CAIXA, parcela '1', sem PDV); HISTORICO 'QUEBRA_CAIXA'.
- **Marcas** CONSILIADO='S' + DTFECHAMENTOCX nos documentos conferidos (A Receber, cheque, cartão, TICKET só com a
  modalidade 'TICKET' exata — na produção 'TICKETS', nunca marca —, devolução).
- **CX_VENDAS** de todas as datas da chave (ou do dia, sem chave) vai a F/tesouraria com o grupo; **CONSOLIDADO** com a
  data de hoje (como o legado: só marca quem fecha no mesmo dia).

### Decisões conscientes
1. CONTACORRENTEOP pelo IDPGTO da própria linha (o legado reaproveita o da última linha com valor).
2. Um instante só para o grupo (o legado mistura o relógio da estação com o do servidor — até 88 s).
3. A forma RCB do título da quebra: a BOLETO, senão a de menor código (o legado pega a primeira que o banco devolver).
4. "CONSIDERAR NO CAIXA DINHEIRO CONTADO" vem do XML da estação no legado; pelo dado, é "não" — não há config.
5. A baixa automática do título de recarga/correspondente (conta de baixa na empresa) não roda na produção — fica fora.

### Falta
- **Corte 3 — contábil + reabertura** (`TIntegracaoFechamentoCaixa`; o CAIXA.CONTABILIZADO, SALDO_OPERADOR e o 'Q'
  marcados pelo contábil; a reabertura completa). O `caixa-conferencia.service.ts` antigo (SALDO só do dinheiro) e o
  `caixa-pdv-contabil` (modelo divergente) saem quando o corte 3 entrar.
- **Corte 4 — acessórios** (impressões, comprovante de quebra, documentos manuais, F5/F6, lançamento provisório).
