-- 083 — OPERADORES: LIBERAÇÃO por supervisor corte-2 — chaves de liberação (CONFIGURACOES) + grants por-usuário.
--
-- DESCOBERTA (recon): USUARIOS_LIBERAM_*/USUARIOS_PERMITIDOS_* NÃO são tabelas — são CÓDIGOS de CONFIGURACOES
-- (tipovalor String, escopo 'Usuario'). A LISTA de autorizados vive como overrides por-usuário em
-- CONFIGURACOES_ESPECIFICAS (tipo='Usuario', chave=codoperador, valor='S') — é o GetUsuariosPermitidos do legado.
-- O VALOR global 'S'/'N' NÃO é a lista (senão seria "todos"); a lista é só os grants explícitos por usuário.
--
-- Ids/defaults/escopo = CONFIGURACOES real do PINHEIRAO (verificado READ-ONLY 2026-07-15). Seed do conjunto
-- ligado às telas migradas/próximas (limite/liberar/reabrir/pendências do pedido, desconto do A Receber,
-- devolução de venda, inventário rotativo). Escopo 'Usuario' (config_especificas_permitidas).
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (104, 'USUARIOS_LIBERAM_VALOR_MAX_EXCEDIDO',            'S', 'String', 'Usuario', 'Operadores que podem liberar o valor máximo excedido do pedido de compra (supervisor).'),
  (26,  'USUARIOS_PERMITIDOS_LIBERAR_PEDIDO_COMPRA',      'S', 'String', 'Usuario', 'Operadores que podem liberar o pedido de compra.'),
  (138, 'USUARIOS_REABREM_PEDIDO_COMPRA',                 'S', 'String', 'Usuario', 'Operadores que podem reabrir o pedido de compra.'),
  (192, 'USUARIOS_PERMITIDOS_LIBERAR_PENDENCIAS_FORNECEDOR_PC', 'S', 'String', 'Usuario', 'Operadores que podem liberar pendências do fornecedor no pedido de compra.'),
  (112, 'USUARIOS_LIBERAM_DESCONTO_MAXIMO_EXCEDIDO',      'S', 'String', 'Usuario', 'Operadores que podem liberar o desconto máximo excedido (baixa de A Receber).'),
  (19,  'USUARIOS_LIBERAM_DEVOL_VENDA_NF',                'S', 'String', 'Usuario', 'Operadores que podem liberar a devolução de venda na NF.'),
  (701, 'USUARIOS_ZERAM_INVENTARIO_ROTATIVO',            'S', 'String', 'Usuario', 'Operadores que podem zerar o inventário rotativo.')
ON CONFLICT (id) DO NOTHING;

-- RBAC: gerir os grants (conceder/revogar quem-libera-o-quê).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMLIBERACOES', 'BTNPERMISSOES', 7, 1), ('FRMLIBERACOES', 'BTNPERMISSOES', 7, 2)
ON CONFLICT DO NOTHING;
