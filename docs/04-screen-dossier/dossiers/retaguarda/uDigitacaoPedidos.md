# DIGITAÇÃO DE PEDIDOS (`FRMDIGITACAOPEDIDOS`) — corte-1

`uDigitacaoPedidos.pas` (3.271) + `.dfm` (4.116) + `udmDigitacaoPedidos` (374/1.331) + três telas auxiliares.
**12.876 linhas** no total. 116 acessos, 9 operadores.

## 1. O que a tela é

O **pedido de venda** — balcão, televenda, entrega. Não confundir com `PEDIDOCOMPRA` (`FRMPEDIDOCOMPRA`, já
migrado): aqui é o que a loja vende.

⚠️ **`PEDIDOS` é 1 linha por ITEM**: o cabeçalho se repete em cada linha e `NROPEDIDO` é o que agrupa. Em
produção, **37.080 linhas em 25.784 pedidos**, de 2020 a 30/07/2026.

## 2. O épico encolheu — e foi o dado que disse

O legado tem três telas auxiliares nesta família: formas de pagamento (811 linhas), produção (2.108) e o RDM
(865). Medido na produção em 15/09/2026, o substrato delas está **todo zerado**:

| tabela | linhas |
|---|---|
| `PEDIDOS_PARCELAS` | **0** |
| `PEDIDOSPRODUCAO` | **0** |
| `PEDIDOSPRODUCAO_ITENS` | **0** |
| `PEDIDOS_COZINHA` | **0** |
| `PEDIDOS_IMPRESSORA` | **0** |

Este cliente usa o **pedido simples**: sem parcelamento próprio, sem produção/cozinha, sem impressora de
setor. As 2.919 linhas dessas telas não têm o que migrar.

**56 de 108 colunas.** Contadas uma a uma no dado: 52 colunas estão inteiramente nulas em 37.080 linhas. A
mig 222 traz as 56 vivas.

## 3. ⚠️ A promoção acumulativa — agora do lado de quem a APLICA

O cadastro já estava migrado (`uCadPromocaoAcumulativa.md`, mig 214). Esta é a tela que a **executa**
(`AplicaPromocaoAcumulativa:2076`), e a conta tem uma virada que muda o preço na frente do cliente:

```
total elegível = soma das quantidades do pedido para o produto — ou para o GRUPO DE PREÇO

ATACAREJO = 'S' → desconto = DESCONTO cheio, por unidade, em TODAS as unidades
senão          → pacotes  = trunc(total ÷ QTDE)          (só pacotes COMPLETOS)
                 desconto = DESCONTO ÷ QTDE, por unidade
                 unidades com desconto = QTDE × pacotes
```

**"Leve 3, ganhe 3,00" com 5 unidades:** no modo normal são 1,00 por unidade em 3 unidades = **3,00**; no
atacarejo são 3,00 em cada uma das 5 = **15,00**. Cinco vezes mais. Confundir os dois modos erra o preço.

⚠️ **cancelado, bonificado e troca ficam de fora** dos dois lados (`:2118`): não somam para atingir o pacote
nem recebem abatimento. Mercadoria que não foi vendida, foi dada ou voltou não é venda.

⚠️ a promoção vigente é buscada com `IDEMPRESA LIKE '%;N;%'` — a lista de lojas em `varchar` do cadastro. A
mesma comparação do outro lado.

⚠️ **aplicar duas vezes não dobra**: o legado chama `RetiraPromocaoAcumulativa` antes de aplicar, e o
serviço zera o acumulado no começo da transação.

## 4. Cobertura (§114 do smoke, 4 checks)

1. promoção normal: 1,00/unidade em 3 de 5 unidades;
2. **atacarejo**: 3,00/unidade em todas as 5 — cinco vezes o anterior;
3. por grupo de preço, somando produtos irmãos, com o item de **troca** fora dos dois lados;
4. aplicar de novo não dobra, e a lista agrupa as linhas por pedido com o total certo.

## 5. O que falta

- **digitar** o pedido pela tela (hoje é consulta + aplicação de promoção); o serviço tem o desenho, falta o
  cadastro de item com busca de produto;
- a **reserva temporária de estoque** enquanto o pedido está aberto (`AdicionarEstoqueTemp` /
  `RemoveEstoqueTemp` / `QuantidadeEstoqueTemp`);
- **converter orçamento em pedido** (`MniConverterOrcamentoPedidoClick`);
- o vendedor vindo do cliente ou do operador logado (`CarregaVendedorDoClienteOuLogado`);
- ⛔ as três telas auxiliares — **sem substrato** neste cliente (§2).
