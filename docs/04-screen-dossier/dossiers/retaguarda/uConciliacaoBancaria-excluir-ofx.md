# Conciliação bancária — excluir movimentação OFX

Tela `FRMCONCILIACAOBANCARIA`, opção **`BTNPERMISSAOEXCLUIROFX`** ("Excluir movimentação OFX", 27 operadores na produção).
Migration **384** (fixture), smoke **§274**. Achada na auditoria de RBAC de 27/09/2026 (o legado tinha a opção, o Apollo não
tinha a ação).

## 1. Posterior ao fonte — reconstruída do dado

Nem a opção nem o botão existem no fonte de mai/2020. A regra vem de `MOVIMENTACAO_BANCARIA_OFX` na produção (só leitura,
27/09/2026):

| | linhas |
|---|---:|
| vivas (INDR nulo) | 66.276 |
| excluídas (INDR='E') | **1.227** — de jul/2021 a **21/09/2026** (em uso) |
| excluídas e conciliadas | 2 (as duas em 07/03/2022; nenhuma depois) |
| vivas sem FITID/CHECKNUM | **0** |
| excluídas sem FITID/CHECKNUM | **1.227 (todas)** |

- Excluir = `INDR='E'`, `INDR_USUARIO` = operador, `INDR_DATA` = agora **e `MBO_TRANSACAO_ID`/`MBO_CHECK_NUM` zerados**. Zerar
  o FITID é o que deixa reimportar o arquivo corrigido sem o dedup barrar (576 das excluídas têm "gêmea" viva — mesma conta,
  dia, valor e descrição: o uso é tirar a duplicata de extratos sobrepostos e reimportar).
- Só linha **não conciliada**: a conciliada se desfaz primeiro (422 `OFX_CONCILIADA_NAO_EXCLUI`).
- Várias de uma vez (dez/2025: 60 linhas em 5 momentos).
- **Sem LOG**: os 848 LOGs de `MOVIMENTACAO_BANCARIA_OFX` na produção são todos da reversão ("REVERSAO Campo: …").

## 2. O defeito que vinha junto

Os pendentes do extrato não filtravam `INDR='E'`: depois da carga, as 1.227 excluídas voltariam para a conciliação (e poderiam
ser conciliadas ou lançadas pelas regras automáticas). Agora pendentes, conciliar e lançamentos automáticos ignoram a excluída.

## 3. Apollo

`POST cadastro/conciliacao-bancaria/excluir-ofx {codconta, mboIds}` com `@RequerAcesso('FRMCONCILIACAOBANCARIA',
'BTNPERMISSAOEXCLUIROFX')`; na tela, "Excluir do extrato" para as linhas selecionadas, habilitado pela opção.
