# O que falta migrar — ranking por USO REAL (não por contagem de telas)

O placar de conversão conta telas. Esta lista conta **acessos**: o legado registra o uso de cada formulário em
`MENUEXPRESS.ACESSOS`, e são **3.024.930** acessos acumulados. É a medida honesta do que dói faltar.

> **O Apollo cobre 98% do uso real.** As telas ausentes somam 46.159 acessos — 2% do total.

E o topo do que falta é escopo já decidido: as três primeiras (sangria, consulta NFC-e e devolução de vendas)
são **PDV**, fora por instrução do usuário, e sozinhas valem 67% do que resta.

| tela | acessos | operadores | último acesso | situação |
|---|---|---|---|---|
| FECHAMENTO DE SANGRIA (`FRMFECHAMENTOSANGRIA`) | 13,976 | 43 | 2026-09-05 | PDV — fora de escopo |
| CONSULTA NFC-E (`FRMNFCE`) | 13,048 | 22 | 2026-09-05 | PDV — fora de escopo |
| DEVOLUCAO DE VENDAS (`FRMDEVOLUCAOVENDAS`) | 4,050 | 45 | 2026-09-05 | PDV — fora de escopo |
| RELATORIO GERAL (`FRMRELATORIO`) | 1,759 | 20 | 2026-09-03 | fila |
| CONTROLE DE ACESSO (`FRMCTRLPERMISSOES`) | 968 | 15 | 2026-09-02 | era nossa: grant errado, corrigido (mig 196) |
| GERADOR SPED FISCAL (`FRMSPEDFISCAL`) | 896 | 25 | 2026-09-04 | era nossa: grant errado, corrigido (mig 196) |
| INTEGRACAO CONTABIL (`FRMTRON`) | 781 | 19 | 2026-08-31 | fila |
| FECHAMENTO DIARIO (`FRMFECHAMENTODIARIO`) | 740 | 25 | 2026-09-01 | fila |
| ANALISE DE NOTAS FISCAIS (`FRMNFANALISE`) | 704 | 19 | 2026-09-04 | fila |
| SALDO DA EMPRESA (`FRMSALDOEMPRESA`) | 611 | 19 | — | fila |
| FRMMANCADCARTAOBOAVISTA (`FRMMANCADCARTAOBOAVISTA`) | 560 | 0 | 2026-05-20 | fila |
| RELATORIOS DE CAIXAS (`FRMRELCAIXA`) | 504 | 22 | 2026-09-05 | fila |
| CONSULTORIA APOLLO (`FRMCONSULTORIAATM`) | 440 | 19 | 2026-09-04 | fila |
| INTEGRACAO FISCAL - BORBA FISCAL (`FRMVERIFICACAOTRIBUTARIABORBAFISCAL`) | 388 | 9 | 2026-06-15 | fila |
| TOTAL POR CARTAO (`FRMRELCARTOES`) | 383 | 19 | 2026-09-02 | fila |
| LANCAMENTOS CONTABEIS (`FRMRELLANCAMENTOSCONTABEIS`) | 377 | 19 | 2026-08-18 | fila |
| RENTABILIDADE POR CATEGORIAS (`FRMRENTABILIDADECATEGORIAS`) | 275 | 19 | — | fila |
| PRECIFICACAO NF (`FRMPRECIFICACAONF`) | 236 | 17 | 2026-08-25 | fila |
| RELATORIOS DE COMPRAS (`FRMRELCOMPRAS`) | 204 | 19 | 2026-08-17 | fila |
| PROMOCAO ACUMULATIVA (`FRMCADPROMOCAOACUMULATIVA`) | 199 | 26 | 2026-08-24 | fila |
| CONF. NOTAS FISCAIS X INDEXADOR (`FRMCONFERENCIANFINDEXADOR`) | 165 | 4 | — | fila |
| PRODUTOS (`FRMPRODUTOSREL`) | 162 | 19 | 2026-09-02 | fila |
| MDF-E MANIFESTO ELETRONICO DE DOC. FISCAIS (`FRMCADMDFE`) | 153 | 5 | 2026-07-24 | fila |
| ENTRADAS E SAIDAS (`FRMRELENTRADASSAIDAS`) | 148 | 20 | 2026-08-25 | fila |
| PREENCHER COTACAO (`FRMCADCOTACAOFORN`) | 137 | 19 | — | fila |

## Como ler

- **acessos** é uso acumulado, não frequência recente; a coluna do último acesso separa o vivo do histórico.
- **operadores** é quantos têm permissão hoje — uma tela com muitos acessos e poucos operadores costuma ser
  rotina de uma pessoa só (o que a torna frágil, não irrelevante).
- uma tela com acessos e **sem** último acesso recente é candidata a estar morta: vale confirmar antes de
  investir. `FRMFECHAMENTODIARIO` é o caso oposto e vale como aviso — 740 acessos e último em 01/09, mas o
  DADO de fechamento parou em fev/2024: abrem a tela, ela cria os dias do mês, ninguém fecha.

## Cauda longa

Além destas, outras 197 telas com uso somam 4,295 acessos
(média de 22 por tela) — a cauda é longa e rasa.
