-- 062 — RECEBIMENTO corte-2: import do XML da NFe do fornecedor → NF de entrada valorada.
-- Reusa o vínculo nf.codpedcomp (061) + a tabela nfe_xml (030, guarda o XML cru) + o catálogo cfop (o import
-- faz upsert dos CFOPs de entrada ajustados que faltarem). Sem novas tabelas no Core — só o grant RBAC da ação.
-- (De-para de fornecedor CODREFERENCIA_FOR, análise Pedido×NF, SEFAZ e duplicatas→A Pagar = adiados.)

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMPEDIDOCOMPRA', 'BTNIMPORTARXML', 7, 1),
  ('FRMPEDIDOCOMPRA', 'BTNIMPORTARXML', 7, 2)
ON CONFLICT DO NOTHING;
