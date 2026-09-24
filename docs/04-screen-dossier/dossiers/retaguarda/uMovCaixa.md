# LANÇAMENTO DE CAIXA — `FRMMOVCAIXA` (`uMovCaixa`, menu F06)

| | |
|---|---|
| **Status** | **CONVERTIDO** (24/09/2026): `lancamento-caixa.service.ts` / `.controller.ts`, tela `/cobranca/lancamento-caixa`, smoke §172. |
| **Uso** | 5.022 acessos (último em 23/09/2026); inclusões por ano: 2022 2.767 · 2023 1.466 · 2024 597 · 2025 594 · 2026 569 (568 despesas, 1 receita). |
| **Fonte × dado** | o fonte de 2020 é bem diferente do binário que roda — **vale o dado** (spec reconstruída na produção, só leitura). |

## O que a tela faz (produção)
- **A linha de CAIXA**: CADASTRADO_MANUALMENTE 'S', TIPORECURSO 'DINHEIRO' (8.997 de 8.997 — o combo de recurso está oculto),
  o LOTE do `ID_IDLOTE`, a situação do documento F06 (`INFORMA_SITUACAO_DOC_LANC_CAIXA`: 'S' no módulo Retaguarda; com uma
  situação só, ela entra sozinha), CC analítico (restrito pela `SITUACAO_NF_PLC` — fora da lista, recusa), parceiro
  obrigatório (o binário exige; 0 nulos desde 11/2022), conta bancária, OBS em maiúsculas. O **sinal** vem do tipo do CC
  (`TPCONTA` 1 = despesa → negativo; 0/2 → positivo). ORIGEM 'APAGAR' na despesa e 'DIN' na receita (desde 29/11/2022),
  CONTABILIZADO 'N' na inclusão (desde 08/2023). A empresa da linha é a da conta bancária (98% em 2025-26).
- **A movimentação bancária do lote** (`UpdateMovBancaria`): a conta, o valor com sinal, D/C pelo tipo, liberada, com a OBS
  como histórico, IDPGTO 1, CODOPCONTA 0; DTLIBERACAO = a data do movimento (desde 02/2024).
- **A despesa gera o título A Pagar já QUITADO** (binário novo): APAGAR ("Documento gerado através do LANCAMENTO DE CAIXA
  TITULO Nº: <codcx>", BOLETO, "1/1", valor sem sinal, grupo novo, situação, banco da conta), o rateio CX_APAGAR (o CC, valor
  NEGATIVO, V) e a APAGAR_BX ("DOCUMENTO BAIXADO VIA LANCAMENTO DE CAIXA TITULO Nº: <codcx>, TITULO Nº: <codapg> |LOTE:<lote>
  | <OBS>"). A CAIXA do rateio não é gerada (o lançamento é a linha).
- **Contabilização** (origem 64, `IntegraMovimentoCaixa`): com `EMPRESAS.INTEGRACAO='AUTOMATICA'`, pelo motor de documentos
  do Apollo (`documentos-contabil.service.ts`, código = o lote); erro é engolido, como no legado (a linha fica 'N').
- **Editar/excluir**: só o que foi digitado aqui ("…gerado de outra operação"); contabilizado sem integração automática (ou
  sem lote) não se mexe; senão o documento é estornado (o DIÁRIO 64 do CODCX, as marcas). Excluir leva a movimentação do
  lote e o título quitado com a baixa.

## Defeitos do legado não copiados
1. A exclusão faz `DELETE … WHERE IDLOTE = 0` quando a linha não tem lote — há 65.807 movimentações com IDLOTE 0. Aqui só com lote.
2. Efeitos colaterais antes da permissão e sem transação (movimentação órfã). Aqui uma transação.
3. O estorno contábil ao só CLICAR em editar/excluir (cancelar deixava estornado). Aqui só ao gravar.
4. O sinal só aplicado ao sair do campo do CC (2 despesas positivas em 2025). Aqui na gravação.
5. A edição regrava o título NEGATIVO com TIPODOC 'DINHEIRO' e vencimento = a hora da nova baixa. Aqui o título é refeito são.

## A levar ao usuário (não é do código)
- As linhas da conciliação OFX (também CADASTRADO_MANUALMENTE 'S') aparecem na pesquisa e podem ser editadas/excluídas —
  como no legado (765 ligadas a movimentação já conciliada).
- A despesa da tela é contabilizada duas vezes no legado (a origem 64 do caixa e a 15 da baixa do título): 864 de 1.156 em
  2025-26 — o banco é creditado duas vezes.

## Mortos na produção
Recursos ≠ DINHEIRO (0 de 8.997), cheque-pré, a prazo, DOC/transferência/débito, NEUTRA 'S' (desde 11/2023), FORMAPGTO,
CODNF (o ramo de NF sem chamador), CHQ_PROPRIO e LOTE.
