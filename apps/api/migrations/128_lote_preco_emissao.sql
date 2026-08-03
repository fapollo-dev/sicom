-- 128 — AJUSTE DE PREÇOS corte-2: EMISSÃO de lote nas ORIGENS (fecha o ciclo — até aqui a fila lote_preco só
-- enchia por ETL). Recon das 9 origens do legado (grep INSERT INTO LOTEPRECO): o lote NÃO é um mecanismo
-- multi-empresa — é um MODO DE TRABALHO alternativo (radio "On-line" × "Gerar lote", mutuamente exclusivos):
-- no modo lote o preço NÃO é gravado no MULTI_PRECO (o form REVERTE o valor antes do post, UCadProduto.pas:3104)
-- e vai p/ a fila, p/ conferência/etiqueta antes de valer.
-- Origens migradas neste corte: (1) FORM DO PRODUTO (UCadProduto.NovoLotePreco:7993 — a ÚNICA que escreve
-- ORIGEM='P' + ALTEROUPROMOCAO/PROMOCAO/VRPROMO/MARKUP, i.e. a única que exercita esses ramos do consumidor;
-- 11.581 lotes no golden); (2) PEDIDO DE COMPRA (uPedidoCompra.pas:1443 — a MAIOR origem, 46.396 lotes; OBS
-- 'REFERENTE AO PEDIDO DE NRO. <cod> ' com espaço final, sem ORIGEM/CODOPERADOR/MARKUP/promo, vrvenda 4 casas).
-- ADIADO (com procedência): precificação de NF (3.043 — telas não migradas + modal GetMultiEmpresa sem equivalente)
-- · entrada de NF (188 — neste tenant PRECONF='O' = atualiza ON-LINE, não por lote: cópia-fiel-negativa) ·
-- Precificação do Custo (4.983 — tela própria) · preço-filho (211 — casa com o motor de filhos, adiado golden-vazio)
-- · LOTEPRECOATACAREJO (fila paralela; braço atacarejo morto).
-- NOTA (não-bug, documentada): o legado escolhe as empresas do lote em PEDIDO_COMPRA_QTDE (grandchild por-empresa).
-- No app novo esse grandchild NÃO foi migrado (mig 078 projetou o pedido como SINGLE-empresa; N-por-empresa =
-- corte-3 cross-docking, adiado por decisão de tenant) → o conjunto {empresa do pedido} == {emp} é a projeção
-- FIEL. Quando o corte-3 migrar o grandchild, o conjunto passa a vir dele (aqui e no atualizarPrecos on-line).

-- carimbo "este pedido já gerou lote de preço" (fiel a PEDIDOCOMPRA.LTPRECO_PROCESSADO; o legado bloqueia o
-- segundo gerar-lote do MESMO pedido, uPedidoCompra.pas:1373-1382).
ALTER TABLE pedidocompra ADD COLUMN IF NOT EXISTS ltpreco_processado char(1);

-- config do MODO do form do produto (fiel a HABILITA_GERACAO_LOTE_PRODUTO, UCadProduto.pas:6424: habilita E já
-- (id 900: os ids <400 do legado já estão tomados por outras migrations — o id aqui é interno ao app novo)
-- deixa marcado o radio "Gerar lote"). Valor do golden = 'N' → o form segue APLICANDO direto (comportamento atual
-- do app novo preservado); com 'S' o save enfileira e NÃO grava o preço.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (900, 'HABILITA_GERACAO_LOTE_PRODUTO', 'N', 'S/N', 'Modulo;Empresa', 'Modo do preço no form do produto: S = "Gerar lote" (enfileira em lote_preco e NÃO grava vrvenda/promo no multi_preco, fiel à reversão de UCadProduto.pas:3104); N = "On-line" (aplica direto). Golden: N.')
ON CONFLICT (id) DO NOTHING;
