# A esteira da nota — dez etapas do manifesto à devolução

Migration **292**. Última tabela viva com valor sem destino. Smoke §158.1 a §158.3.
Contagens no Oracle de produção (só leitura), 23/09/2026.

## 1. O que é

**440.571 linhas para 44.054 chaves de NF-e**: sempre as mesmas dez etapas por nota, na mesma ordem, cada
uma com o seu status. É o workflow de entrada de mercadoria inteiro.

| # | processo | o que é |
|---:|---|---|
| 1 | `stManifesto` | Manifesto Destinatário |
| 2 | `stCiencia` | Ciência da operação |
| 3 | `stCruzamentoPedido` | Cruzamento com pedido de compra |
| 4 | `stConfirmacaoOp` | Confirmação da operação |
| 5 | `stRepasseItens` | Lançamento de nota fiscal, repasse |
| 6 | `stColeta` | Coleta |
| 7 | `stConferencia` | Conferência (coleta) |
| 8 | `stProcessarFaturar` | Processar, Faturar |
| 9 | `stGerarFinanceiro` | Gerar financeiro |
| 10 | `stDevolucao` | Devolução |

A esteira é criada inteira quando a nota é manifestada e as etapas vão sendo marcadas conforme acontecem —
por isso cada etapa aparece 44.057 vezes.

## 2. ⚠️ Pendente não tem data, e isso é o estado

| status | linhas | |
|---|---:|---|
| `R` realizado | 237.036 | com data |
| `P` pendente | **201.557** | **sem data** |
| `A` | 1.978 | |

As pendentes têm `DATAPROCESSO` nula, e tem de ser assim: a etapa foi criada e ainda não aconteceu.
Preencher a data com a criação da esteira afirmaria que a etapa ocorreu; deixar a linha de fora perderia a
informação de que ela **está prevista e parada**. A coluna é nullable, o índice de pendência não a usa, e a
tela mostra "não aconteceu" em vez de um traço vazio.

É também o que dá valor operacional à tabela: com 44 mil notas e dez etapas, a pergunta é **em que etapa
cada nota travou**, e ela só tem resposta porque o pendente é registrado. Smoke §158.1.

## 3. ⚠️ A nota que nunca virou NF também tem esteira

A chave casa com `nfe_nao_cadastradas` em **438.731** linhas e com `nf` em **420.769**: as 19.802 restantes
(4,5%) são de notas manifestadas que nunca viraram NF no sistema.

Por isso a tabela é indexada pela **chave de acesso** e **não tem FK para `nf`**. Uma FK rejeitaria essas
linhas e apagaria o histórico do que **não** entrou — que é metade do que a conferência de entrada precisa
saber. Mesma lição da chave estrangeira de `clube_desconto` (mig 285). Smoke §158.2.

## 4. O painel conta só a primeira pendente

Contar toda linha pendente somaria a mesma nota em várias etapas: a nota parada na 4ª também tem a 5ª, a 6ª
e as demais pendentes, por consequência. O painel conta **só a primeira pendente de cada nota**, que é onde
ela de fato travou. Smoke §158.3.

## 5. ⚠️ A empresa é nula justamente nas pendentes

`IDEMPRESA` é nula em **201.556 das 440.571 linhas** — exatamente as etapas pendentes, criadas antes de a
nota ter loja definida. O destino a exige.

Medido: **44.051 das 44.054 chaves são mistas** (têm a empresa em alguma etapa irmã e não em outras), então
ela se recupera da própria esteira. Só 3 chaves não a têm em lugar nenhum, e essas caem na nota e depois na
loja 1. Sem a derivação, 201.556 linhas iriam para a loja 1 em silêncio — o padrão do Achado 4.

## 6. Fecha o inventário de tabelas vivas sem destino

Restava também `REMESSA_LOTE`, com **11.048.221 linhas** — a maior de todas. Ela **não migra**, e o veredito
está escrito no `plano-tabelas.json`: é **log de replicação**, não regra. Cada linha é uma tripla (tabela,
id, data) apontando outra tabela (`HISTORICO_PDV`, `ARECEBER`, `CX_VENDAS`, `NFC`, `VENDAS`), e o Apollo tem
outro mecanismo de sincronização. Migrar o log de sincronismo do legado não reproduz regra nenhuma.

## 7. ⚠️ O vínculo da nota com a esteira é um CURSOR, e o cursor atrasa (mig 293)

`NF.CODNFSTATUSPRO` (42.065 preenchidos) e `NFE_NAO_CADASTRADAS.CODNFSTATUSPRO` (43.872) casam **100%** com
a esteira — mas não apontam a esteira: apontam **uma etapa**. Comparado com a etapa realizada mais alta da
própria chave:

| | nf | nfe_nao_cadastradas |
|---|---:|---:|
| é a etapa realizada mais alta | **40.732 (96,8%)** | 42.592 |
| etapa ANTERIOR à mais alta | **1.321** | 1.258 |
| etapa POSTERIOR à mais alta | 2 | 16 |
| chave sem etapa realizada | 3 | 0 |
| aponta a etapa de OUTRA chave | 7 | 6 |

É o cursor da nota na esteira, e em 1.321 notas ele não foi avançado. Por isso o "parada em" da tela sai das
**dez linhas**, não do ponteiro — ler o ponteiro diria que a nota está atrás de onde está. A coluna migra
como o legado a gravou (fidelidade), sem FK: `nfe_nao_cadastradas` carrega na f0 e a esteira na f2.
