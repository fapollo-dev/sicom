# INTEGRAÇÃO CONTÁBIL (`FRMTRON`) — recon e plano de cortes

Decisão do usuário (08/09): migrar por completo. Fontes: `uTron.pas` (2.615 linhas, a tela),
`UIntegracaoContabil.pas` (4.616, o motor) e o dado de **produção**.

## 1. O que a tela é

Um exportador contábil com **15 origens** num radio group (`btnExportarClick`, `:2101-2117`) — notas fiscais,
contas a pagar/receber, cinco tipos de baixa, fechamento de caixa, Redução Z, transferências, três cadastros e
NFC-e — mais um **estornar** (`:2128-2384`).

Apesar do nome "exportar", **não gera arquivo**: cada origem instancia uma classe de `UIntegracaoContabil` e
grava partidas em **`DIARIO`** via `LancaDiarioContabil`; o estorno é `DELETE FROM DIARIO` pela origem/documento.
É o mesmo motor que o corte F5b já portou para a nota fiscal.

Dois gates, e nenhum deles é o fechamento diário:
- `TIntegracaoContabil.PeriodoFechado` (`UIntegracaoContabil.pas:282`) compara a data com
  `CONFIG_INTEGRACAO_CONTABIL.CHAVEAMENTO_PERIODO` — **NULL em produção**, ou seja não bloqueia hoje;
- multi-empresa: **corrigido no corte-1** — `:2068` não restringe as origens 3-7 e 10-13 à empresa corrente,
  ele apenas as deixa FORA do seletor de empresas. O SQL delas não filtra empresa nenhuma: varrem o banco
  inteiro e tiram o `IDEMPRESA` de cada lançamento da própria linha (o razão do cliente tem lançamentos de
  cartão nas empresas 1 e 2 — e 19 linhas com `CODEMPRESA = 51`, que é um CODORIGEM gravado no lugar errado).

## 2. O que o cliente REALMENTE usa (`DIARIO` por origem, produção)

| cod | origem | linhas | em 2026 | situação no Apollo |
|---|---|---|---|---|
| **61** | baixa de cartões — **taxas** | **1.200.524** | 44.817 | ✗ |
| 17 | fechamento de caixa | 117.612 | 16.071 | ✓ (contabilizar do caixa) |
| **62** | baixa de cartões — outras despesas | 110.053 | 7.576 | ✗ |
| 12 | notas fiscais | 78.207 | 13.447 | ✓ **F5b** |
| 67 | NFC-e | 73.925 | 11.123 | PDV — fora de escopo |
| **15** | baixa de contas a pagar | 47.795 | 7.274 | ✗ |
| **16** | baixa de contas a receber | 35.689 | 2.818 | ✗ |
| **51** | baixa de cartões | 31.400 | 7.036 | ✗ |
| 19 | transferências entre contas | 17.581 | 94 | ✗ |
| 65 | agrupamento de convênio | 15.119 | 231 | ✗ |
| 64 | movimentação do caixa | 7.261 | 234 | ✗ |
| 14 | contas a receber (cadastro) | 6.710 | 253 | ✗ |
| 13 | contas a pagar (cadastro) | 3.935 | 150 | ✗ |
| 66 | importação | 1.166 | 58 | ✗ |
| 55·57·63·54·58 | juros, acréscimos, descontos, adiantamento | 2.425 | 417 | ✗ |
| 18 | Redução Z | **0** | 0 | `REDUCAOZ` está vazia |

Último lançamento gravado: **18/08/2026**. A integração está viva e é o maior consumidor do diário
(1,75 milhão de linhas no total).

**A leitura que importa:** o volume não está onde a intuição diz. **Baixa de cartões (61+62+51) é 1,34 milhão de
linhas — 77% de tudo**, com 58.879 lançamentos só em 2026. Fechamento de caixa e nota fiscal, que já temos, são
os dois seguintes.

## 3. Plano de cortes (por uso, não por ordem de tela)

1. **corte-1 — BAIXA DE CARTÕES** (61 · 62 · 51): o maior volume de longe. Três origens que saem de um mesmo
   fluxo (a baixa do cartão, suas taxas e as outras despesas).
2. **corte-2 — BAIXAS DE AP e AR** (15 · 16) mais os acessórios de cada uma (53-58: juros, acréscimos,
   descontos) — 86.958 linhas somadas.
3. **corte-3 — CADASTRO de CP e CR** (13 · 14), **transferências** (19), **movimentação do caixa** (64),
   **adiantamento** (63) e **agrupamento de convênio** (65).
4. **estorno** — vale para todas as origens; entra junto do corte-1 e é ampliado a cada um.
5. **fora**: NFC-e (67) é PDV; Redução Z (18) não tem dado; importação (66) precisa de recon próprio.

## 4. O que já está pronto e serve de base

O `NfContabilizacaoService` (F5b, fases 1-4) já implementa o núcleo: resolução de conta por
`ITENS_INTEGRACAO_CONTABIL` (tipo 'F' fixa / 'A' automática), partida dobrada em `diario`, idempotência por
`(codorigem, idorigem)`, estorno por `DELETE`, e o bloqueio de período contábil. **Os cortes acima reusam esse
motor** — o que muda por origem é de onde vem o valor e qual par de contas.

## 5. Corte-1 ENTREGUE — baixa de cartões (`mig 199`, smoke §92, 1060/0)

### 5.1 O motor, reconstruído do razão

`LancaDiarioContabil` mora em `FuncoesApollo`, que **não veio no fonte clonado** — o mesmo buraco que a F5b
enfrentou na nota. Reconstruído em `integracao-contabil.motor.ts` a partir de 1,34 milhão de linhas do razão
do cliente cruzadas com a `ITENS_INTEGRACAO_CONTABIL`. Duas regras, as duas medidas:

1. **O FORMATO sai do `CODHISTORICO`.** Pernas com o mesmo histórico ⇒ UMA linha balanceada; históricos
   diferentes ⇒ DUAS linhas, cada uma com um lado só e o seu histórico.

   | situação | hist D / C | linhas no razão | balanceadas | só-débito | só-crédito |
   |---|---|---|---|---|---|
   | 894 despesas | 96 / 96 | 110.053 | **110.053** | 0 | 0 |
   | 895 taxas | 96 / 96 | 1.200.524 | **1.200.524** | 0 | 0 |
   | 893 baixa | **94 / 95** | 31.400 | **0** | 15.700 | 15.700 |
   | 2009 baixa AR | 92 / 93 | 35.689 | 0 | 17.619 | 18.070 |
   | 2004 baixa AP | 91 / 221 | 47.795 | 0 | 42.147 | 5.415 |
   | 910 convênio | 104 / 105 | 15.119 | 0 | 30 | 15.089 |

   (Há 5 situações pequenas fora do padrão — 464, 1190, 500, 463, 11 — todas de origens que não migramos.)

2. **A conta da perna `TIPO='A'` sai do dataset** (o "substitui pelo dataset"). Na 895 o crédito é automático
   e o `CONTACREDITO` bate com o `CONTAS_BANCARIAS.CODLANCCONTABIL` da forma de pagamento em **1.200.523 de
   1.200.523** linhas — três contas distintas (213, 557, 211), nenhuma fixa.

### 5.2 O que o corte-1 entregou

- **`CONFIG_INTEGRACAO_CONTABIL`** (60 colunas, a config de instalação inteira — as outras origens leem daqui).
- **`cartao.valor_outras_despesas_paga`**: o terceiro valor da baixa, que faltava, e que decide a origem 62.
- **`mov_contas_bancarias.idlote`**: o elo entre o lote de cartões e o crédito no banco — 204.904 linhas
  preenchidas no cliente e **fora da nossa carga até agora**. O `cartao-baixa.service` passa a carimbá-la.
- **`diario.documento`**: preenchida em 1.749.372 das 1.749.402 linhas do razão e ausente do destino.
- As três origens: **51** (um lançamento por LOTE, pelo líquido), **61** e **62** (um por CARTÃO que tenha
  taxa / outras despesas), o **estorno** das três (por período, como a tela faz, ou por lote) e a prévia.
- Gates copiados: chaveamento de período (`<=`, e NULL não bloqueia), centro de custo obrigatório na taxa e
  nas outras despesas, conta contábil da conta bancária, `M.VALOR > 0` na movimentação, "devolução de cheque"
  fora, lote sem os dois lados aborta a integração inteira.
- Quirk copiado com prova: o **`IDORIGEM` do lançamento principal sai do cartão em que o cursor do legado
  parou** — o último do lote quando não houve rateio, o primeiro quando o resíduo do `AjustaValores` foi
  aplicado. No cliente: 10.105 lançamentos com o último, 6.721 com o primeiro.

### 5.3 Achados e divergências registradas

- ⛔ **`DIARIO.CODCC` não entra**: existe no legado e está preenchida em **0 de 1.749.402** linhas. O centro de
  custo só serve para resolver a conta quando a perna é automática, e para o gate.
- ⛔ **`LOTE_CONTABIL` está VAZIA no cliente** — o `DIARIO.CODLOTE` é só um número de sequência por lançamento.
  Mantemos o cabeçalho porque as contabilizações já migradas o gravam e a nossa `diario.codlote` tem FK.
- ⚠️ **multi-empresa**: rodamos na empresa do tenant, o legado varre todas. Separa 23 lotes que hoje misturam
  duas empresas; nenhum valor se perde, a partição é outra.
- ⚠️ **`AjustaValores` é inócuo no razão deste cliente**: ele ajusta o dataset em memória, mas o valor do
  lançamento é o total de ANTES (`Valor := vValor`, `:365`) e as duas pernas da 893 são fixas. Fica implementado
  fiel porque numa instalação com perna automática o ajuste chegaria ao razão.
- ⚠️ **prefixo novo de rota exige entrada no `TenantMiddleware`** (`app.module.ts`): sem `'contabil'` na lista,
  `currentTenant()` estoura e a rota devolve 500.
- Estado do cliente hoje: **13.275 cartões pendentes em 84 lotes**, com data de baixa entre 2020 e 2025.

### 5.4 O que fica para os próximos cortes

*(fechado no corte-3, seção 7.)*

## 6. Corte-2 ENTREGUE — baixas de A PAGAR e A RECEBER (`mig 200`, smoke §93, 1067/0)

### 6.1 A terceira regra do motor, e a mais importante

O corte-1 deixou uma pergunta em aberto: quantas linhas cada perna gera. O corte-2 respondeu, e a resposta
estava na assimetria do razão. **Perna `TIPO='F'` gera uma linha; perna `TIPO='A'` gera uma por REGISTRO do
seu dataset.** Na origem 15 as duas pernas da situação 2004 são automáticas, e o cliente tem **42.178 linhas
só-débito** (uma por baixa do lote) contra **5.417 só-crédito** (uma por movimentação bancária). Na baixa de
cartão as duas são fixas, e por isso saía exatamente uma de cada.

E a substituição é **coluna a coluna**: o dataset manda na conta, no valor, no `IDORIGEM`, no `DOCUMENTO` e no
`COMPLEMENTO`; onde ele não tem a coluna, vale o parâmetro. A prova mais limpa está na perna de dinheiro do
A PAGAR: `IDORIGEM` e `DOCUMENTO` vêm da movimentação (5.411/5.411), mas o `COMPLEMENTO` é o IDLOTE do
parâmetro (5.411/5.411) — porque `GetSQLMovimentacaoCP` não seleciona `COMPLEMENTO`.

### 6.2 Reconciliação contra produção

| | linhas | valor | conta | documento | complemento |
|---|---|---|---|---|---|
| 16 crédito (cliente) | 18.070 | **100%** | **100%** | **100%** | **100%** |
| 16 débito (banco) | 17.618 | **100%** | **100%** | — | **100%** |
| 15 débito (fornecedor) | 42.175 | 99,8% | 34% ⚠️ | **100%** | 99,8% |
| 15 crédito (banco) | 5.411 | 99,5% | **100%** | **100%** | **100%** |

⚠️ os 34% do débito AP são a conta do fornecedor tendo mudado de cadastro ao longo de seis anos — o `COALESCE`
lê o valor de HOJE. Não é divergência de regra: o documento bate em 100% e o valor em 99,8%.

### 6.3 O que o corte-2 entregou

- `apagar_bx.idlote` e `areceber_bx.idlote` — **100% preenchidas no cliente** (51.136 e 19.080) e, como
  aconteceu com `mov_contas_bancarias`, **fora da nossa carga**. É o elo com a movimentação bancária.
- `codplc_acredesc` / `codplc_juros` nas duas tabelas de baixa (gate dos acessórios).
- `apagar.codplanocontas_deb_baixa_cp`, `areceber.codplanocontas_cred_baixa_cr` (a conta POR TÍTULO, que vence
  a do parceiro) e `cod_desconto_titulo` nas duas (exclui do lote o título descontado em banco).
- As origens **15** e **16** e os acessórios **53/54/55** e **56/57/58**, com o estorno de cada lado.
- **A IIC de 2004/2009 voltou a ser a do cliente** (as quatro pernas `'A'`). A mig 055 fixava a perna de
  dinheiro em 183 e o `BaixaContabilService` exigia exatamente uma perna fixa — divergência que atrapalhava
  duas vezes: a perna de dinheiro do TRON sai da movimentação, e na virada a carga TRUNCA a IIC e traz as 224
  linhas reais. Agora quem resolve a perna de dinheiro é a **natureza** (AR: entra ⇒ débito; AP: sai ⇒
  crédito) e o **recurso** dá a conta (BANCO → `codlanccontabil`; DINHEIRO → 183). O auto-disparo continua
  funcionando e passou a funcionar TAMBÉM sobre a IIC verdadeira.

### 6.4 Achados

- ⚠️ **o filtro do título descontado é do LOTE, não da baixa.** `COD_DESCONTO_TITULO IS NULL` está em
  `GetSQL*BXLotes`; quem seleciona as baixas pega **todas** as do lote qualificado. Um título descontado que
  divida lote com um normal entra no lançamento. Copiamos o código; o caso **nunca ocorreu** no cliente (zero
  lotes mistos, e nenhuma das 18 baixas AP / 25 AR de título descontado chegou ao razão).
- **JUROS (53 e 56) têm ZERO linhas** no cliente e nem situação configurada. A regra entra igual — é a mesma
  passagem de código — e o serviço acusa `SITUACAO_NAO_CONFIGURADA` se um dia aparecer juro.
- **TROCO no A RECEBER** (`:3620-3647`): a movimentação negativa do lote é apensada ao dataset do crédito como
  uma linha do banco. Regra copiada, **zero ocorrências** (nenhuma movimentação negativa em lote de
  `ARECEBER_BX`).
- O sinal de `ACRE_DESC` **troca os datasets de lado** — é assim que o legado inverte a partida entre
  acréscimo e desconto, e é por isso que a conta do parceiro muda de perna.
- Convivência com o auto-disparo: sem dupla contagem, os dois filtram `CONTABILIZADO = 'N'`. No legado só
  existe o caminho do TRON.
- Pendente no cliente hoje: **2.893 baixas de A PAGAR e 377 de A RECEBER**.

## 7. Corte-3 ENTREGUE — os lançamentos por DOCUMENTO (`mig 201`, smoke §94, 1074/0)

Cadastro de contas a pagar (13) e a receber (14), transferências entre contas (19), adiantamento a parceiros
(63), movimentação de caixa (64) e agrupamento de convênio (65). **A integração contábil está completa** —
fora ficam só NFC-e (67, PDV), Redução Z (18, sem dado) e importação (66, que grava sem `CODOPERACAO` e
precisa de recon próprio).

### 7.1 O que muda em relação aos cortes 1 e 2

**A situação vem de cada documento** (`IDSITUACAO_NF`), não da configuração — por isso a origem 13 aparece no
razão com 37 situações distintas e a 64 com 21. Só a transferência (2020) e o convênio (910) são fixos na
config. E o cadastro de CP pode ter a situação TROCADA pela origem do título: recarga, voucher,
correspondente e troco solidário têm cada um a sua (`:1320-1327`).

### 7.2 A regra do motor que faltava

O corte-3 fechou a última ambiguidade do formato: **o pareamento numa linha balanceada exige que NENHUM dos
dois datasets tenha mais de um registro**, além do histórico igual. Não basta contar as linhas emitidas — a
prova está na situação **464** (as duas pernas FIXAS, hist 103/103) no cadastro de contas a pagar: os 27
títulos com UMA linha de rateio saíram balanceados e os 121 com DUAS saíram como um só-débito mais um
só-crédito, embora o débito continue sendo uma linha só porque a conta é fixa.

Com isso o motor reproduz as sete formas que o razão do cliente mostra, e todas as exceções que eu havia
listado como "fora do padrão" no corte-1 (464, 500, 1190, 463, 11) passaram a ser explicadas pela regra.

### 7.3 O que o corte-3 entregou

- **`apagar.codgrupo`, `dtcompra` e `desconto`** — ~100% preenchidas no cliente (54.869 / 54.865 / 54.265 de
  54.872) e **nenhuma entrava na carga**. `codgrupo` é o que liga o título ao rateio de `CX_APAGAR`, e
  `dtcompra` é a data do lançamento.
- **`mov_contas_bancarias.dtemissao` (289.813, 100%) e `nrodocumento` (120.769)** — também fora da carga, e
  sem elas a origem 19, a terceira maior do razão, não teria como ser encontrada (é `NRODOCUMENTO LIKE
  '%TRANSFERENCIA%'`, 37.572 linhas).
- `agrupamento`, `codapg_pai`, `contabilizado_agrupamento` em `apagar`; `agrupamento`,
  `codgrupo_agrupamento_apg`, `contabilizado_agrupamento` em `areceber`.
- As seis origens, com estorno por período em cada uma.

### 7.4 As seis formas, uma a uma

| origem | lançamento | quem manda no lado |
|---|---|---|
| 13 CP | crédito = fornecedor (1) · débito = rateio de `CX_APAGAR` (N) | o rateio decide o formato; sem centro de custo o débito **tem** de ser conta fixa (`:1393`) |
| 14 CR | débito = cliente · crédito = centro de custo do recebível | sempre balanceado (6.711 linhas, zero single) |
| 19 transferência | débito = conta que recebeu · crédito = conta que enviou | o par vem do LOTE; as duas pontas são marcadas juntas |
| 63 adiantamento | banco × parceiro | o **TIPO** ('C' põe o parceiro no crédito) |
| 64 caixa | banco × centro de custo | o **SINAL** do valor (o lançado é sempre o absoluto) |
| 65 convênio | 1 débito fixo + 1 crédito por recebível | o formato mais desigual: 15.089 só-crédito × 30 só-débito em 30 grupos |

### 7.5 Achados

- O **índice de rateio** do CP (`:1357-1377`): quando a soma de `CX_APAGAR` não fecha com o valor do título,
  cada linha é multiplicada por `valor / soma`. Copiado.
- Cinco exclusões no cadastro de CP, cada uma com o seu próprio caminho contábil: agrupado, adiantamento a
  fornecedor, origem 'B' (boleto), título-filho e título gerado por nota (`IDNF`).
- O convênio usa **flag próprio** (`CONTABILIZADO_AGRUPAMENTO`), que convive com o `CONTABILIZADO` do título —
  o mesmo recebível pode estar contabilizado por uma origem e não pela outra.
- **Quando a perna é FIXA, a conta da IIC vence o dataset.** Vale para todas as origens e é o que explica, por
  exemplo, o débito do caixa cair na conta fixa quando a situação é a 586 em vez de sair da conta bancária.
