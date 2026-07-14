-- 074 — DEVOLUÇÃO DE COMPRA corte-3: fidelidade fiscal/financeira.
-- (a) config do vencimento do A Receber da devolução (golden PINHEIRAO: id 215 = 15 dias, global).
-- (b) RBAC do "Faturar" (gera o A Receber contra o fornecedor com o vencimento default DTEMISSAO + N dias).
-- O ParceiroZera (PARCEIROS.DEVOLUCAO_ZERA_IMPOSTO_ICMSST, migration 019) e o espelho PIS/COFINS são lógica
-- no gerarNf (sem schema novo). Situações 825/826/827 = apuração fiscal/SPED (camada ausente no monorepo) → ADIADO.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (330, 'QUANTIDADE_DIAS_GERAR_BOLETO_DEVOLUCAO', '15', 'numero', 'Modulo;Empresa', 'Dias somados à emissão para o vencimento do boleto (A Receber) da devolução de compra.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMDEVOLUCAOCOMPRA', 'BTNFATURAR', 7, 1), ('FRMDEVOLUCAOCOMPRA', 'BTNFATURAR', 7, 2)
ON CONFLICT DO NOTHING;
