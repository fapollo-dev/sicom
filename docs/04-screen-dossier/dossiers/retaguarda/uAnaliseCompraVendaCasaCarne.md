# ANÁLISE COMPRA × VENDA — CASA DE CARNE (`FRMANALISECOMPRAVENDACASACARNE`)

`uAnaliseCompraVendaCasaCarne.pas` (509). **37 acessos.** API `relatorios/analise-casa-carne`. Migration 242. A regra do corte 1 está no cabeçalho do serviço (`analise-casa-carne.service.ts`).

## ✅ O Imprimir (06/10/2026) — a única saída do legado

O legado **não tem grade**: o botão monta a tabela de trabalho e imprime `Rel_Analise_Compra_Venda_Carne.fr3` (935). A grade do Apollo é
uma leitura própria (por produto, com o rateio da peça); a impressão segue a estrutura do `sqqAnaliseCVCarne`:
- a tabela de trabalho (`CriaTabelaTemporaria`, aqui uma CTE): as vendas do período nas lojas marcadas e os itens das NF de entrada não
  canceladas pela emissão, com os filtros por código (departamento, grupo, subgrupo, produto) e alíquota;
- `dbdtsAnalise` (INDICE 0): a peça com DECOMPOSICAO vira **uma linha por corte** (QTDE_COMPRA = Σ QTDE × FATOREMBAL × % ÷ 100) e
  **mostra a venda da PEÇA** (os cortes vendidos aparecem como produtos próprios, sem compra); o produto sem decomposição, Σ QTDE da nota;
  ordem DECOMPOSICAO, DESCRIÇÃO; o script do layout agrupa as linhas da peça e mostra o corte pelo DESCRICAO_DEC;
- `dbdtsAnalise2` (INDICE 1): por PRODUTO repetido (o corte da peça e o próprio corte), a soma da compra;
- o custo do corte é o da correção do §1 (total da linha × % ÷ 100); o layout lê a empresa em `frxDBDatasetEmpresa`, que o formulário
  não fornece (ele publica `dbdtsEmpresa`) — o cabeçalho da empresa sai vazio no legado, e aqui também.

Smoke §119.4; teste de renderização do 935.
