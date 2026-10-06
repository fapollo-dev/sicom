# Fila das impressões — telas cujo legado imprime em `.fr3` e a página do Apollo não

Levantamento de 06/10/2026 (`scratchpad/levanta_fr3b.py`): toda unit do fonte que carrega `.fr3`, o formulário dela e a página do
Apollo (pelo nome do formulário no arquivo ou na rota), conferindo se a página chama a impressão no layout (`imprimirRelatorio`).
Uso = `MENUEXPRESS.ACESSOS` da produção. A regra é a de sempre: o layout do cliente (RELATORIOS), os datasets pelo UserName do
TfrxDBDataset e as variáveis que o legado atribui.

| uso | formulário | layouts | situação |
|---:|---|---|---|
| 32.383 | `FRMAPAGAR` | AgrupamentoCP[Agrupado], AgrupamentoCPCR[Agrupado] | ✅ falso positivo — imprime na tela de agrupamento |
| 12.142 | `FRMCADARECEBER` | Agrupamento*, AgrupamentoAR | ✅ falso positivo — idem |
| 7.920 | `FRMRELFINALIZADORAS` | Rel_Finalizadoras[_Vertical] | ✅ 06/10 (`2790e4b`) |
| 3.903 | `FRMRELLISTAPRECOSFORNECEDOR` | AnaliseGiroMercPeriodo[Analitico], ListaPrecFornecedor* (8 layouts, dataset `dbdListagem` com TITULOn/SMDn/QTDE_ENTRADAn) | ⏳ recon feito: os títulos dos meses vêm de `MesExtenso` (prova no Rel_CaixaAnual: abreviação de 3 letras) e `MesExtensoT` (sem prova — FuncoesApollo ausente); o modo "Pedidos" ainda está adiado no serviço (PEDIDOS já migrada); VRCUSTOREP impresso = custo de reposição ÷ nº de períodos com custo (quirk do AtualizaListagem) |
| 1.415 | `FRMVALORTICKETMEDIO` | Rel_TicketMedio | ⛔ os dois layouts (DEFAULT e PERSONALIZADO) leem MEDIA_QTDE_PRODUTOS_CUPOM, que o SQL de 2020 não tem — binário novo; vigia do V$SQL ligado |
| 877 | `FRMCONFBOLETO` | BoletoFR, Dup_Duplicata* | ✅ 06/10 (boleto com os datasets do ACBr, duplicata com o extenso; as instruções com vírgula) |
| 735 | `FRMADIANTAMENTOFORNECEDOR` | ReciboAdiantamentoParceiro | ✅ 06/10 (o NumeroExtenso no motor) |
| 355 | `FRMRELREGISTROS_ES` | Notas_Fiscais_Registro_Apuracao/Entrada/Saida | ✅ 06/10 — Apuração (e a apuração refeita pela regra do binário novo, `7a44529`) e o modo Registro de entradas/saídas, que não existia |
| 236 | `FRMPRECIFICACAONF` | PrecificacaoNF | ✅ 06/10 (a grade como está, com o editado) |
| 141 | `FRMRELINVENTARIOROTATIVO` | InvRotDetalhado/Produtos/Resumido | ✅ 06/10 (o relatório inteiro — as 5 opções, a grade e a impressão — não existia) |
| 138 | `FRMCADCOTACAOFORN` | Cot_Pree_da_Cotacao | ✅ 06/10 (a tela como está; a ordem dos itens do fonte) |
| 121 | `FRMTROCAMERCADORIAFOR` | extr - Troca | ✅ 06/10 (o 3º nível no motor) |
| 120 | `FRMRELINTERSECCAOPRODUTOS` | extr - Interseccao produtos qtde cupom/vendida | ✅ 06/10 (e 3 correções de fidelidade: lojas, cancelado, COUNT(NROCUPOM)) |
| 116 | `FRMDIGITACAOPEDIDOS` | PedidoRetaguarda[A4][_Transferencia] | ✅ 06/10 (e o total do pedido pela fórmula do fonte) |
| 109 | `FRMCADPRODUCAO` | Producao, Producao_Lista_Transferencia | ✅ Producao 06/10 (QUANTIDADE_COMERCIAL pelos dois ramos de conversão) · ⛔ lista de transferência (ITENS_PRODUCAO_TRANSFERENCIA/ESTOQUE_PROD mortas) |
| 98 | `FRMFLUXOCARTOES` | Rel_Fluxo_Cartoes | ✅ 06/10 (e 2 correções: LIBERADO nulo, lojas; o "legado duplica o dia" do dossiê era falso) |
| 84 | `FRMRELENTSAI` | Rel_Analise_Compra_Venda2 | ✅ 06/10 (e 5 correções de fidelidade: lojas, NF cancelada processada, descrição da venda, dpto do pedido, fornecedor; e o agrupar, que dava 500) |
| 64 | `FRMCONSCLIRCB` | Rel_BaixaAReceber | ✅ 06/10 — e a tela refeita pelo fonte (juro pela taxa da tela, tolerância do cliente, agrupados fora, todas as lojas, seleção) |
| 53 | `FRMANALISECOMPORTAMENTO` | Rel_Analise_Comportamento_Loja | ✅ 06/10 — e o corte 2 (Previsão Impostos 5,5% com a lista vazia, margem do total pela média das semanas, lojas) |
| 43 | `FRMRELFINANCEIRO` | RelatorioFinanceiroGeral, RelatorioFinanceiroContasReceber | ✅ 06/10 — as duas (a Geral com os detalhes aninhados por lote; o "Contas a receber" não existia) e a consulta fiel (ordem LOTE/RAZÃO, lojas, filtro travado) · ⛔ Sintético/Atrasados: binário novo |
| 38 | `FRMEXTRATOFORNECEDORES` | ExtratoFornecedores1/2/3 | ✅ 06/10 — os três, e o corte 2 (os 6 modelos, os operadores do parceiro, lojas, datas sem TRUNC) |
| 37 | `FRMANALISECOMPRAVENDACASACARNE` | Rel_Analise_Compra_Venda_Carne | ✅ 06/10 (a estrutura do sqqAnaliseCVCarne: um corte por linha da peça, as somas dos cortes repetidos) |
| 36 | `FRMRELPRECOSALTERADOS` | Rel_PrecosAlterados[Det][PorEmpresa] | ✅ 06/10 — Produtos e Lote, os 3 agrupamentos (loja em colunas) · ⛔ "Lote detalhado" (procedure com ROWNUM no ON, a medir) |
| 34 | `FRMRELANALISEITENSNF` | Rel_AnaliseItensNF | ⏳ |
| 34 | `FRMFATURAMENTO2` | Fat_Relatorio_de_Faturamento_por_Cliente/Lotes, de_Status | ⏳ |
| 27 | `FRMMOVIMENTACOESDIA` | movD- Movimento diario | ⏳ |
| 20 | `FRMCADLOTECOBRANCA` | Lote_Cobranca[Bairro] | ⏳ |
| 14 | `FRMRELBALANCETE` | BalanceteVerificacao | ⏳ |
| 11 | `FRMPRECIFICACAONFBRUTA` | PrecificacaoNFBruta | ✅ 06/10 (MARGEM = markup fixo da grade) |
| 11 | `FRMRELENTRADAS_FINAN` | Notas_Fiscais_Entradas_Finan | ⏳ |
| 4 | `FRMRELDIARIOCONTABIL` | LivroDiarioContabil | ⏳ |
| — | `FRMCONSULTORIAATM`, `FRMRELPERDAS`, `FRMSALDOEMPRESA` | | ⛔ aguardam o SQL do binário novo (vigias do V$SQL) |
| 148 | `FRMRELENTRADASSAIDAS` | Rel_EntradasESaidas[_Comparativo][_2] | ✅ comparativo 06/10 (SQL do binário novo capturado no V$SQL: PDV nas saídas, CFOPs, por loja) · ⛔ listagem aguarda o SQL |

Já feitas antes deste levantamento: produtos-rel (13), pedidos de compra (5), apuração PIS/COFINS, dados do pagamento/recebimento,
análise entrada × saída (2) e as demais telas do `TFrmRelMaster`.
