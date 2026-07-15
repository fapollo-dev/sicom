-- 077 — PEDIDO DE COMPRA M8: TIPO_FLUXO_CAIXA_PC (modo de limite DIÁRIO xor SEMANAL, exclusivo).
--
-- O legado escolhe UM modo de limite via config TIPO_FLUXO_CAIXA_PC: ValidaValorMaximoDia roda só quando
-- ='D' (uPedidoCompra.pas:7966) e ValidaValorMaximoSemana só quando ='S' (:8021) — ambos chamados no gravar
-- (:6866-6873) mas internamente XOR; qualquer outro valor/vazio → NENHUM valida. O corte-final (069:19-21)
-- rodava AMBOS se ambos os limites >0 (mais restritivo; M8 documentado como adiado). Este corte fecha o M8.
--
-- Default = 'S' (o valor EFETIVO da Retaguarda no tenant — só o limite SEMANAL é usado, 270.000). O
-- pedido-compra.service chama o resolver só com {empresaId}, então o default do seed é o comportamento base.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (331, 'TIPO_FLUXO_CAIXA_PC', 'S', 'texto', 'Modulo;Empresa', 'Modo do limite de desembolso do pedido de compra: ''D''=valida SÓ o DIÁRIO, ''S''=valida SÓ o SEMANAL, outro/vazio=não valida (exclusivo, fiel a ValidaValorMaximoDia/Semana).')
ON CONFLICT (id) DO NOTHING;
