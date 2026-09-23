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

---

## 8. O TEXTO DO RAZÃO — a lacuna que este épico tinha (corte-4, migration 229)

Os cortes 1-3 gravavam `DIARIO.CODHIST` e deixavam **`DIARIO.DESCHIST` nulo**. No cliente, **1,43 milhão de
linhas do razão têm o texto** — é ele que a tela de lançamentos mostra e o que o contador lê no livro. Os
lançamentos que o Apollo gerasse sairiam mudos ao lado dos do legado, sem erro nenhum para avisar.

Pior: a tabela **`HISTORICO_CONTABIL` não existia no destino** (54 linhas na produção), embora o motor já
usasse `CODHISTORICO` para decidir o formato do lançamento.

### 8.1 O histórico é um TEMPLATE, e o `*` é o buraco

Não é um rótulo fixo. O cadastro guarda `TAXA DE CARTAO BAIXADOS LOTE .: * OPERADORA .: *` (código 96) e o
razão grava `TAXA DE CARTAO BAIXADOS LOTE .: 90886 OPERADORA .: ALELO ALIMENTACA - CODREDE 5`. Cada `*` recebe
um argumento **na ordem**.

⚠️ **procedência**: quem substitui mora em `FuncoesApollo`, pacote que **não veio no fonte clonado** — o mesmo
buraco que obrigou a reconstruir o motor. A regra saiu de confrontar os 54 templates com o razão real.

Três regras de formatação, as três medidas:

1. **Número vira 9 dígitos com zeros à esquerda** (`FormatFloat('000000000')`): `A RECEBER DOCTO .: 000130582`
   para documento `130582` em **5.895 de 5.895** linhas da origem 14, e `AGRUPAMENTO CONVENIO .: 000117847` em
   **15.089 de 15.089** da origem 65. Texto vai cru — por isso o lote sai `LOTE .: 90790`, não `000090790`.
2. **Quebra de linha vira espaço**: o `DESCHIST` é de uma linha só. Provado no histórico da movimentação
   (`TRANSF. CONTA DESTINO: 4914-7\r\n Lote: 89642\r\nRealizada…` → `… 4914-7  Lote: 89642 Realizada…`) e na
   observação do título (`…31/07/2026\r\n` → termina em espaço).
3. **`*` sem argumento imprime vazio** — o razão do cliente tem `NOTA FISCAL COMPRA .: 000000000 CNPJ  FORNECEDOR `
   na origem 64, onde o chamador não passou nada.

### 8.2 ⚠️ O texto varia LINHA A LINHA, não por lançamento

Foi o erro que quase entrou. O primeiro desenho montava um texto por lançamento, do registro em que o cursor
parou. O razão diz outra coisa: das **1.723** baixas de A PAGAR com mais de uma linha de histórico 91,
**nenhuma** tem um texto só — cada linha traz o seu título, o seu tipo de documento e o seu parceiro. No
agrupamento de convênio (105) é igual: 30 grupos, zero com texto único. No A RECEBER (93), 1.673 lotes
multi-linha e só 347 com texto único — os de cliente único, onde o texto coincide por acaso.

Já no cadastro de contas a pagar (103) as **197** são constantes, e isso confirma a regra em vez de
contrariá-la: ali as várias linhas são o **rateio de um título só**.

Ou seja: o texto sai do **registro do dataset**, com o contexto do lançamento cobrindo o que o registro não
tem — exatamente a mesma "substituição coluna a coluna" da regra 3 do motor (§ 5). É assim que a baixa de
A PAGAR escreve `PAGTO LOTE .: … PARCEIRO .: …` em cada débito e o histórico da movimentação bancária no
crédito, tudo de uma chamada só.

### 8.3 O mapa de argumentos (`historico-contabil.args.ts`)

O mapa é **por histórico, não por origem** — é o histórico que define o texto: o 96 imprime a mesma coisa
vindo da origem 61 ou da 62, e o 88 aparece nas origens 13 e 64 com a mesma ordem. Vinte e sete históricos
estão mapeados, cada um com o texto real medido no comentário. Histórico sem regra provada imprime o template
com os buracos vazios — que é o que o legado faz quando o chamador não passa argumento.

Alguns rótulos do legado **não descrevem o conteúdo**, e foram copiados como estão:

- **87** `ADIANT P/ PARCEIRO .: * DOCTO .: *` → o primeiro `*` recebe o **código** do parceiro (cru) e o
  rotulado "DOCTO" recebe a **razão** dele (`ADIANT P/ PARCEIRO .: 3066 DOCTO .: CAIXA ECONOMICA FEDERAL`).
- **221** `PAGTO * *` → o segundo argumento é o caractere **`¦`**, constante em **5.169 de 5.169** linhas.
- **102/103** → o que parece uma verba (`FGTS NORMAL`, `IRRF - FOLHA`) é a **razão do parceiro**: o cliente
  cadastra as rubricas de folha como parceiros.

### 8.4 Colunas que faltavam no destino

| coluna | por quê | medição |
|---|---|---|
| `historico_contabil` (tabela) | o cadastro dos 54 templates | 54 linhas na produção |
| `cartao.operadora` · `cartao.codrede` | o `OPERADORA .: *` do histórico 96 | 2.038.896 e 2.061.076 de 2.062.109 |
| `apagar.docnf` | o `NOTAFISCAL .: *` do histórico 91 | ⚠️ **nula nas 55.204 linhas** — cópia-fiel-negativa |

O CNPJ dos históricos 1/21/61/112 vive em **`parceiros_end`**, não em `parceiros`, e já vem formatado
(`06.981.180/0001-16`); `endereco_padrao` é nulo no cliente, então vale o primeiro endereço.

### 8.5 O que ficou de fora, e por quê

- **Origens 53 e 56** (juros de A PAGAR e A RECEBER): **zero linhas** no razão em seis anos. Sem texto para
  reconstruir.
- **Origem 57** (acréscimo de A RECEBER): existe, 554 linhas, mas **não sai deste caminho** — o `PARCEIRO .:`
  que elas mostram é `AO CONSUMIDOR` enquanto o título é de outro parceiro (o `CODRCB 113104` é de DENNER
  TEODORO SILVA). Vêm do fechamento de caixa reusando o código de origem. Sem procedência, sem argumentos.
- Os 27 históricos que sobram do cadastro não aparecem nas origens que o Apollo gera hoje.

### 8.6 A tela que mantém os templates (`FRMCADHISTORICOCONTABIL`, migration 231)

62 acessos, 3 operadores. CRUD declarativo pela engine (`historico-contabil.crud.ts`), rota
`/cadastro/historico-contabil`.

- O **código é gerado por sequence**, posicionada **depois do maior já carregado** (261). Sem isso o primeiro
  cadastro colidiria com um template em uso. No cliente os códigos vão de 1 a 261 com saltos largos (o legado
  dava passo de 20 em parte das inclusões); o número não tem significado, só o texto tem.
- A view expõe a contagem de **buracos** (`coringas`): é ela que diz quantos argumentos a contabilização
  precisa passar, e o que separa um rótulo fixo (0) de um template.
- O **texto é livre**, inclusive sem nenhum `*` — um rótulo fixo é um template de zero buracos, e o legado
  tem desses. Para tirar de circulação sem apagar, é o `STATUS`.
- ⚠️ **hard-delete não deixa razão órfão**: `DIARIO` guarda o código **e o texto já resolvido** (`DESCHIST`),
  não uma referência ao template. Apagar um histórico não muda nada do que o razão mostra — só o tira das
  contabilizações futuras. É por isso que não há trava aqui.
- A tela **simula o resultado enquanto se digita** (`SMOKE LOTE .: * OPERADORA .: *` → `… 90886 … ALELO …`),
  usando a **mesma** `montarDeschist` que a API usa para escrever o razão — ela mora no pacote compartilhado
  exatamente para isso. Trocar a ordem dos `*` troca o que sai no livro, e sem a simulação o erro só
  apareceria depois, no razão.

### 8.7 ⚠️ Os ITENS do histórico são a regra — e a nota gravava o razão sem texto (migration 294)

A grade de detalhe do cadastro (`uCadHistoricoContabil.dfm:359`, dataset aninhado `sqqItens_Historico`) é
`ITENS_HISTORICO_CONTABIL`: **144 itens para os 54 históricos**, cada um com ORDEM, TABELA e CAMPO. Ficou
fora do plano de carga até o inventário completo de 23/09/2026 — e não é documentação, é a lista que diz qual
campo preenche cada `*`. **O razão prova**, porque o texto segue os itens mesmo quando eles contradizem o
rótulo do template:

| hist. | template | itens, na ordem | o que o razão grava |
|---|---|---|---|
| 62 | `CREDITO ICMS NFISCAL COMPRA .: * CNPJ.: * PARCEIRO.:*` | NRO_NF, CFOP, CNPJ_CPF, PARCEIRO | `… .: 007922433 CNPJ.: 1403 PARCEIRO.:23.814.940/0010-00` |
| 66 | `DEBITO ICMS NFISCAL PERDA .: * CFOP .: *LOJA .: *` | CFOP, IDEMPRESA, NRO_NF | `… PERDA .: 5927 CFOP .: 001LOJA .: 000004412` |
| 70 | `CUSTO VENDA NFISCAL .:*CFOP .: *` | CFOP, NRO_NF | `CUSTO VENDA NFISCAL .:5405CFOP .: 000004393` |

Montando o texto das NOTAS pelos itens, bate em **32.731 de 32.894** linhas do razão desde 2025 (**99,5%**),
nos 17 históricos de nota. As 163 restantes são parceiro renomeado depois do lançamento (o razão guarda o nome
da época) e uma linha corrompida do próprio legado.

**A lacuna**: `nf-contabilizacao.service.ts` gravava `diario.codhist` e deixava `diario.deschist` nulo — o
mesmo defeito que a migration 229 corrigiu no motor da integração contábil, mas que ficou no caminho da nota.
No cliente são **14.322 linhas de razão de nota só em 2026, todas com texto**. Agora a nota monta o texto
pelos itens, com os formatos que o razão mostra: número com 9 dígitos, loja com 3 (`LOJA .: 001`), CFOP cru,
e o CNPJ como está gravado no endereço da nota (`codparceiro_end`; sem ele, o primeiro endereço).

**Como os itens convivem com o mapa medido (§8.3)**:

- **o mapa vence onde existe.** No 89 os itens dizem `ARECEBER.OBS` e o razão mostra a descrição do centro de
  custo em 5.895 de 5.895 linhas: o nome do campo é o do dataset interno do legado (`FuncoesApollo`), não o da
  coluna. O mapa foi medido contra o razão; os itens, não.
- **os itens entram onde o mapa não tem o histórico**, traduzidos por `CAMPO_DO_LEGADO` (tabela.campo →
  contexto). Cada tradução tem âncora: o mesmo par aparece num histórico que o mapa prova, e a tradução é a
  dele — `APAGAR_BX.CODIGO_DOCUMENTO` sai cru (91, 106, 107), `APAGAR.CODIGO` com 9 dígitos (21, 101-103). O
  teste `historico-contabil-itens.spec.ts` confere que dicionário e mapa **não se contradizem em nenhuma
  posição**, e reproduz oito linhas reais do razão de históricos que o mapa não tinha (41, 62, 64, 66, 70, 108,
  121, 201).
- Os históricos de PDV (81-85, 98-100) ficam sem tradução — fora de escopo.

**A grade no cadastro**: o legado grava mestre e itens juntos (`ClientDataSet` aninhado). Aqui os itens são um
recurso do histórico (`/cadastro/historico-contabil/:cod/itens`), gravado como lista inteira numa transação
que trava o mestre — para não mexer no cadastro do mestre, que já funcionava. A tela mostra o texto **com o
nome do campo em cada buraco** (`… .: [NRO_NF] CNPJ.: [CFOP] PARCEIRO.:[CNPJ_CPF]`), que é onde se vê o CFOP
caindo no rótulo "CNPJ" antes de gravar. Ordem repetida é recusada (o `*` ficaria ambíguo).

⚠️ **Decisão sem prova, registrada**: item com `STATUS='N'` sai da lista e o seguinte sobe um `*`. Os 144 itens
da produção estão todos em `S`, então o dado não decide o caso; seguimos a leitura natural de um campo "ativo".

---

## 9. A tela que configura tudo isso (`FRMCONFIGINTEGRACAOCONTABIL`, migration 233)

**55 acessos, 2 operadores.** `UFrmConfigIntegracaoContabil.pas` (1.873 linhas). API `contabil/config-integracao`,
tela `/contabil/config-integracao`.

É o painel que diz, para cada EVENTO do sistema, **qual situação** o razão deve usar — o que o motor lê em
`lancarNoDiario` para achar as duas pernas. Sem ele, `CONTAS_NAO_INFORMADAS`.

A tabela e as **60 colunas** já vieram com as migrations 199-201; faltava a tela. No cliente, **27 dos 60
campos estão preenchidos** — o resto são eventos que a loja não contabiliza (cheques, boa parte das retenções,
o fiscal por dentro da NFC-e).

As cinco abas e os rótulos são os do legado: *Vendas e fechamento de caixa* · *Financeiro* (contas a pagar,
contas a receber, cheques, cartões) · *Movimentações bancárias* · *Fiscal* (ICMS, PIS, COFINS, retenções,
outros) · *Outras configurações* (o chaveamento de período).

### 9.1 O que a tela acrescenta

⚠️ **apontar para uma situação sem as DUAS pernas** em `ITENS_INTEGRACAO_CONTABIL` é o erro que só aparece
muito depois — na hora de contabilizar, com outra pessoa, longe de quem configurou. A tela lista quantas
pernas cada situação tem, marca as incompletas na própria escolha e abre com um aviso dizendo quantos eventos
estão pendurados numa situação que vai falhar.

### 9.2 Divergências conscientes

- **Só muda o que foi enviado.** O legado grava o formulário inteiro; num painel de 60 campos, isso apaga a
  configuração que outra pessoa acabou de pôr. Aqui o `PUT` aplica campo a campo o que veio.
- **Situação inexistente é recusada na porta** (422). Digitar um número errado aqui só daria erro na
  contabilização, muito depois.
- O **chaveamento de período** continua como está: a comparação é `<=` (a data final digitada tem de ser
  POSTERIOR ao chaveamento) e no cliente o campo está NULO, então hoje não bloqueia nada.
