# PREVISÃO DE A PAGAR DO MANIFESTO (binário novo) — convertida em 24/09/2026

| | |
|---|---|
| **Status** | ✅ gerar (fila do manifesto) + converter (faturamento da NF) · mig 329 · smoke §176 |
| **Procedência** | o fonte de 2020 não tem o recurso; reconstruído da PRODUÇÃO (auditoria `AUDIT_APAGAR`/`AUDIT_CX_APAGAR`, `NF_STATUS_PROCESSO`, `NFE_XML`) |
| **Volume** | 6.632 previsões desde 18/03/2025 (3.601 em 2026 — a maior família de títulos do ano); 250 a 440 por mês |

## O que é
Uma conta a pagar **antes** da nota: o operador, na fila do manifesto, gera a previsão da NF-e do fornecedor — em 89,6% das
chaves antes de confirmar e importar a nota. Quando a nota é faturada, a previsão vira o título.

## Gerar (`compras/manifesto-dfe/previsao-apagar/:cod`, FRMMANIFESTODFE/BTNIMPORTAR)
- **Não há critério automático no dado** (loja 1 47%, loja 2 85%; 127 fornecedores com os dois caminhos): é escolha do
  operador por nota — uma ação da fila, como lá. Configurações: `SITUACAO_GERACAO_PREVISAO_APAGAR_MANIFESTO` (3540) e
  `CC_GERACAO_PREVISAO_APAGAR_MANIFESTO` (3721, "compras provisionadas"), no módulo Retaguarda; zeradas, não gera.
- **Parcelas**, na ordem do legado: a grade financeira da nota (`NFE_FINANCEIRO_MANIFESTO`, o que o operador ajustou — 270
  linhas; vence o XML 30 a 7), o `<dup>` do XML (83,6% exatos), ou uma parcela com o total e o vencimento digitado.
- **Um título por parcela**: TIPODOC 'PREVISÃO', DTCOMPRA = vencimento, DUPLICATA = o código, NRODUP 1 e "1/1" em todas, um
  CODGRUPO por título, a situação e o CHAVENFE, IDNF nulo, GERADO 'SISTEMA', juros/desconto/embutidos 0, OBS `PREVISÃO GERADA A
  PARTIR DO MANIFESTO AO IMPORTAR A NF NO SISTEMA, DA NOTA FISCAL N:<nº sem zeros>`; rateio V no CC da configuração. **Sem
  CAIXA.** Não gera de novo com previsão da chave aberta.

## Converter (o faturamento da NF de entrada — `nf-faturamento.service.ts`)
- **Uma parcela** (5.910 das 6.632): a previsão vira o título da nota no lugar — TIPODOC 'BOLETO', IDNF, valor e vencimento
  do faturamento; o rateio leva o valor e **fica no CC 3721 e na situação 3540**, com a OBS, a DTCOMPRA e a DUPLICATA da
  previsão (o legado nunca reclassifica — mantido, pela continuidade da DRE); a CAIXA nasce; HISTORICO "TIPODOC DE: PREVISÃO
  PARA: BOLETO", "IDNF DE: 0 PARA: <nota>", valor e vencimento se mudaram. Nenhum título novo.
- **Várias parcelas**: nascem os títulos da nota e **todas** as previsões da chave saem (rateio e CAIXA junto), com o
  HISTORICO de exclusão.

## Divergências conscientes
1. **Órfãs**: o legado apagava só UMA previsão no faturamento de várias parcelas (a de menor código) e deixava as outras —
   **253 títulos, R$ 379.985,33 em aberto em 24/09/2026, 233 já vencidos**, e 2 baixas caíram na previsão. Aqui saem todas
   (e as que sobram numa conversão de uma parcela também). ⚠️ As 253 órfãs da produção vêm na carga como estão: quem decide
   o que fazer com elas é o cliente.
2. O vínculo manual com previsão de **outra** nota do mesmo fornecedor (59 casos) não é replicado: a previsão é achada pela
   chave (99,0% dos casos).

## Pontos em aberto
- Qual botão do binário gera a previsão (o dado aponta a aba "Financeiro" da análise de itens do manifesto) — a fila do
  Apollo oferece a ação por nota.
