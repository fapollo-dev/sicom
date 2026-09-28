# Baixa de cartão — corte-3: a baixa parcial (`CARTAO_BX`)

`UbaixaCartao.pas` (a tela) + o dado de produção. Migration **277**. Fecha o *"ADIADO (fiel): baixa
parcial/ajuste"* declarado no corte-2 (mig 119). Smoke §47x.4 e §47x.5.

## 1. ⚠️ A tabela existia no cliente e não tinha destino

`CARTAO_BX` tem **1.169.680 baixas**, R$ 58,4 milhões, **223.704 só em 2026** — e **não estava no destino
nem no `plano-tabelas.json`**. O corte-2 modelou a baixa como flag no próprio recebível
(`cartao.liberado/dtbaixa/idlote`), e um flag não comporta duas baixas no mesmo cartão. Achado da
varredura de dado de 18/09/2026 (o par da varredura de telas).

| | |
|---|---:|
| baixas | **1.169.680** (R$ 58.453.706,83) |
| cartões distintos | 1.110.745 |
| **cartões com mais de uma baixa** | **46.218** |
| baixas estornadas (`INDR='E'`) | 59.118 |
| por ano | 2023: 50.760 · 2024: 418.692 · 2025: 476.524 · **2026: 223.704** |

## 2. ⚠️ O defeito, medido: o legado baixa o mesmo recebível duas vezes

Contando só as baixas **ativas** (`INDR <> 'E'`):

- **2.926 cartões têm 2+ baixas ativas**;
- em **2.921 deles a soma ultrapassa o valor do cartão** — **R$ 131.623,12 baixados a mais**.

O padrão é sempre o mesmo: o recebível é baixado num lote, o lote é estornado **sem** marcar a baixa com
`INDR='E'`, e ele é baixado de novo noutro lote. As duas continuam valendo. Exemplo real: o cartão
**1843996** (R$ 19,61) tem duas baixas de R$ 19,61 — lotes 81835 e 85579.

Aqui: baixa que faria a soma passar do valor é recusada (422 `CARTAO_BAIXA_EXCEDE`), e **estornar o lote
marca as baixas dele** com `INDR='E'` + usuário + data, em vez de deixá-las vivas.

## 3. A baixa parcial é real e usada

**5.186 cartões** têm soma ativa **menor** que o valor — ex.: recebível de R$ 405,42 com R$ 258,71
baixados. O corte-2 não conseguia representar isso. Agora cada baixa é uma linha, o saldo é
`valor − Σ baixas ativas`, e `GET cadastro/cartao/baixas/:codvendcartao` devolve as baixas (com as
estornadas marcadas) mais `pago` e `saldo`.

## 4. O modelo

`cartao_bx` espelha o padrão das outras baixas do monorepo (`areceber_bx` / `apagar_bx`): valor pago,
data, operador, lote, obs, e **estorno lógico** por `indr`/`indr_usuario`/`indr_data`. O `VALORPG` guarda
o **bruto** — no cliente a soma bate com `CARTAO.VALOR` em 9.935 de 10.000 amostras (não com o líquido).

A tabela entrou no `plano-tabelas.json` (f0) e no mapa `tabela_origem` dos dois scripts do ETL.

## 5. Corte-4 (24/09/2026) — as três pernas da baixa, a data digitada e a reversão fiel

Achado da auditoria de esqueletos (`docs/05-migration-engineering/auditoria-esqueletos.md` §1): o Apollo gravava só o
crédito, com a data do dia. O que uma baixa grava na produção (lote 91347, 15/09/2026):

| perna | conta | valor | IDPGTO | LIBERADO | histórico | fonte |
|---|---|---:|---|---|---|---|
| (a) crédito | destino (421) | +154,44 C | 1 | N (bancária) / S (tesouraria) | o digitado — padrão `REF. BX LOTE: N` | `rdgDestinoExit` :2001-2030 |
| (b) saída do líquido | a da FORMA do cartão (1) | −154,44 D | da forma (200) | S | `SAIDA PARA BAIXA DE DOCUMENTOS` | `ValidaSaldoAntMultiEmpresa` |
| (c) saída da taxa | a da forma (1) | −5,08 D | da forma | S | `SAIDA REF A TAXA ADMINISTRATIVA DA BAIXA DE DOCUMENTOS` | idem |

- (b)+(c) saem **uma dupla por IDPGTO** (`BaixaContasApagar` :683-799, cdsTemp): líquido = Σ `VALOR_COM_TAXA`, taxa = Σ bruto − Σ líquido.
  O cartão sem forma herda a do anterior (`FIdpgto` só muda quando > 0); forma não achada cai na TEF. A query da forma
  (`FDqFormasPgtoMultiEmpresa`) traz UMA linha — o `Locate('DESTINO','CXA')` nunca acha outra, então o IDPGTO é sempre o da forma.
- 8.798 dos 8.805 lotes do cliente têm (b) (R$ −33,1 mi) e (c) (R$ −0,62 mi). Desde ago/2026, 100% das saídas estão na DTBAIXA.
- **Tudo na data digitada**: DTBAIXA 00:00, `CARTAO_BX.DATA_PGTO`, as 3 pernas (emissão/vencimento/liberação), a CAIXA.
  "Data da baixa não pode ser maior que a data atual!" (:1372).
- O `UPDATE CARTAO` (:731-742): CODOPBX, DATA_OPERACAO (hora do servidor), CODPLC_ACREDESC (só com outras despesas),
  VALOR_OUTRAS_DESPESAS_PAGA (0 quando não há — 0 nulos desde 2025), VALOR_TAXA_PAGA, CODPLC_TAXA_CARTAO (só com taxa).
  O `OBS || ' BAIXA DO LOTE: N'` do fonte **a produção não grava** (0 de 670.924 baixas desde 2025) — o dado vivo decide.
  `LIBERADO = 'N' se ItemIndex = 3` é morto (o combo tem 3 itens).
- Travas novas: CC de multa/juros da empresa obrigatório (:996), período contábil chaveado, conta do operador
  (`CONTAS_BANCARIAS_OP`), conta caixa só na tesouraria (:1340), caixa FECHADO na conta da forma (DTCHAVEAMENTO).
- Recebíveis de todas as empresas do operador (`GetMultiEmpresa`); a conta de destino pode ser de outra empresa.
- Depois do commit, `INTEGRACAO = 'AUTOMATICA'` → integração contábil do lote (:1214). A integração pega o crédito por
  `tipomovimento = 'C'` (o `M.VALOR > 0` do legado — o Apollo guarda o absoluto, e com `valor > 0` as saídas entravam).
- **Reversão** (`UConsCRTbx.pas:95-275`): não apaga a movimentação. Cada linha do lote fica `REVERTIDO='S'` e ganha a
  contrária — tipo invertido, **um lote novo por linha**, `IDLOTE_REVERSAO` = o lote, emissão agora, "Reabertura da baixa
  de cartões, lote N, realizada pelo usuário X." (produção: 86909 → 86911/86912). Recusa com contabilizado fora da
  AUTOMATICA (que estorna junto), período chaveado e caixa FECHADO; limpa REFERENCIA/DTBAIXA/conciliação/IDLOTE/
  DATA_OPERACAO/CCs/taxa/outras/`VALOR_AJUSTE_BAIXA`; apaga `CONS_REG10_NAO_ENCONTRADOS` dos arquivos do lote e a CAIXA.
  `TIVIT_REDE_*` têm 0 linhas no cliente e não vieram.
- Tela: marca os recebíveis (antes baixava todos os abertos da lista), destino, conta do operador, data e histórico.
- ~~ADIADO~~ → 🪦 **mortos, com prova (28/09/2026, produção só leitura)**:
  - `AjustarDiferenca` / baixa por valor digitado: a config `VALOR_MAXIMO_DIFERENCA_BAIXA` vale 0 na base e **10.000** no
    override Módulo/Retaguarda (a função está ligada), mas `CARTAO.VALOR_AJUSTE_BAIXA` é **0 em todas as 1.257.119 baixas**
    de 2023 a set/2026 — ninguém usa. (A função é do binário novo; não está no fonte de 2020.)
  - taxa de antecipação (`edtTXantecipacao`): `CARTAO.TXANTECIPACAO` = 0 em todas as baixas desde 2023.
  - E-Extrato/SITEF (a conciliação pelos arquivos da adquirente, `CONS_REG10` / `CONS_REG10_NAO_ENCONTRADOS`): usada até
    abr/2026 — ~99% das baixas do 1º quadrimestre levam a `REFERENCIA` do arquivo —, mas a `CONS_REG10` para em
    **04/05/2026** e **nenhuma das 106 mil baixas de mai a set/2026 tem REFERENCIA**. As baixas seguem em lote pela tela
    (60 cartões por lote), sem o arquivo. As duas tabelas estão no destino (mig 311) e a reversão já as limpa.
