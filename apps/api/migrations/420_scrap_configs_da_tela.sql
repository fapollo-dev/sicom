-- 420 — as configurações que a tela de SCRAP (uCadSCRAP) lê e que o destino não tinha: ids, defaults e whitelist = CONFIGURACOES
-- da produção em 14/10/2026. Os overrides são os da produção (CONFIGURACOES_ESPECIFICAS): o módulo Retaguarda NÃO bloqueia produto
-- repetido nem estoque negativo; pede senha para excluir item de scrap (e o usuário 1 é quem libera); edita o scrap fora do mês;
-- a empresa 1 exibe o produto pai.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (20,  'EXIBE_CAMPO_PRODUTO_PAI', 'N', 'S/N', 'Empresa;Grupo;Usuario', 'Define se exibirá o campo "Produto pai" (a coluna Cod.Prod Filho da grade do scrap).'),
  (86,  'PEDE_SENHA_EXCLUIR_ITEM_SCRAP', 'S', 'S/N', 'Modulo;Empresa;Grupo;Usuario', 'Pede senha ao excluir item Scrap (PermiteExcluir, uCadSCRAP.pas:1749 — libera quem tem a config em N).'),
  (93,  'BLOQUEIA_PRODUTO_DUPLICADO_SCRAP', 'S', 'S/N', 'Modulo;Empresa;Grupo;Usuario', 'Bloqueia o lançamento de produtos repetidos no mesmo scrap (GetProduto, udmCadSCRAP.pas:382).'),
  (158, 'IMPEDIR_MOVIMENTO_ESTOQUE_NEGATIVO', 'N', 'S/N', 'Modulo;Empresa;Grupo;Usuario', 'Impedir Scrap, Digitação de pedidos, Transferência, Uso e Consumo com estoque negativo (o produto só entra com QTDE_ESTOQUE > 0).'),
  (227, 'INFORMA_MOTIVO_PERDA_SCRAP', 'N', 'S/N', 'Modulo;Empresa;Grupo;Usuario', 'Obriga informar o motivo da perda ao cadastrar um SCRAP.'),
  (277, 'DIAS_PERMITIDO_LANCTO_RETROATIVO_SCRAP', '0', 'Integer', 'Modulo', 'Define número de dias permitido para lançar scrap retroativo (edtDataExit, uCadSCRAP.pas:1373).'),
  (463, 'EDICAO_SCRAP_FORA_DO_MES', 'N', 'S/N', 'Modulo;Empresa;Grupo;Usuario', 'Permissão para edição do scrap fora do mês de cadastro do scrap.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO configuracoes_especificas (id, tipo, chave, valor) VALUES
  (93,  'Modulo',  'Retaguarda', 'N'),
  (158, 'Modulo',  'Retaguarda', 'N'),
  (86,  'Modulo',  'Retaguarda', 'S'),
  (86,  'Usuario', '1',          'N'),
  (463, 'Modulo',  'Retaguarda', 'S'),
  (463, 'Empresa', '1',          'S'),
  (463, 'Usuario', '1',          'S'),
  (20,  'Empresa', '1',          'S')
ON CONFLICT DO NOTHING;
