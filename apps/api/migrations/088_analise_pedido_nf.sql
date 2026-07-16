-- ANÁLISE PEDIDO × NF (Wave 4, corte-2) — cruzamento/divergências + liberação por supervisor.
--
-- O corte-1 destravou o 1:N + saldo. Este corte-2 traz a ANÁLISE (UanalisaPedComp_NF): compara a NF de entrada
-- vinculada com o pedido e detecta DIVERGÊNCIAS de PREÇO (custo NF vs custo pedido, tolerância
-- VARIACAO_CUSTO_PEDIDO_NF%) e itens da NF fora do pedido (INE_PEDIDO); a liberação (LIBERADO SEM/COM DIVERGENCIA)
-- exige um SUPERVISOR (ChamaLiberacaoLogin) quando há divergência — reusa o E8 (USUARIOS_PERMITIDOS_LIBERAR_PEDIDO_
-- COMPRA, id 26, já semeado na 083).

-- Configs da análise (ids/valores reais do Oracle PINHEIRAO). Idempotente (não sobrescreve se já existir).
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (2,  'VARIACAO_CUSTO_PEDIDO_NF',     '0', 'Float',  'Modulo;Empresa;Grupo;Usuario', 'Tolerância (%) da divergência de custo entre a NF de entrada e o pedido de compra (0 = qualquer diferença é divergência).'),
  (39, 'VERIFICA_VR_UN_OU_EMBALAGEM',  'E', 'String', 'Modulo;Empresa;Grupo;Usuario', 'Base da comparação de custo pedido×NF: U (valor unitário) ou E (valor da embalagem).')
ON CONFLICT (id) DO NOTHING;

-- RBAC: liberar a conferência de pedido×NF (opção própria em FRMPEDIDOCOMPRA). Seed p/ o operador 7 (smoke).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMPEDIDOCOMPRA', 'BTNLIBERARCONFERENCIA', 7, 1), ('FRMPEDIDOCOMPRA', 'BTNLIBERARCONFERENCIA', 7, 2)
ON CONFLICT DO NOTHING;
