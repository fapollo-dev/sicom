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
