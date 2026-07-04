-- 055 — AR/AP corte-3b: CONTÁBIL da BAIXA/pagamento. Ao baixar um título com recurso DINHEIRO (auto-disparo
-- best-effort, gate EMPRESAS.INTEGRACAO='AUTOMATICA'), lança 1 partida balanceada no DIÁRIO:
--   A RECEBER  (CODORIGEM=16, situação 2009): D 183 CAIXA CENTRAL / C cliente     (PARCEIROS.CODCONTABIL)
--   A PAGAR    (CODORIGEM=15, situação 2004): D fornecedor (PARCEIROS.CODCONTABIL_FOR) / C 183 CAIXA CENTRAL
-- Confirmado no Oracle: CONFIG_BAIXA_RCB=2009, CONFIG_BAIXA_APG=2004; CODORIGEM 16(AR)/15(AP); 13.893/19.832
-- linhas reais. No legado AS DUAS pernas são TIPO='A' (perna de dinheiro por RECURSO + perna do parceiro);
-- o corte-1 só faz DINHEIRO → a perna de dinheiro é seedada TIPO='F' 183 (divergência CONSCIENTE; recurso
-- banco/cartão/cheque = corte-2). codhistorico reais: 92/93 (AR), 91/221 (AP).
-- COBERTURA (achado de auditoria): DINHEIRO é minoria das baixas reais (~1139/13893 AR, ~913/19832 AP; o
-- resto é cartão 213 / bancos 186/190/195) → o corte-1 contabiliza ~8% AR / ~5% AP; a perna por RECURSO
-- (corte-2) fecha o razão. O serviço exige EXATAMENTE 1 perna 'F' (guarda: se esta IIC for reimportada
-- com os 2 lados 'A', o ON CONFLICT abaixo vira no-op e o código PULA em vez de gerar D=cliente/C=cliente).
INSERT INTO itens_integracao_contabil (codoperacao, natureza, tipo, codconta_contabil, codhistorico) VALUES
  (2009, 'D', 'F', 183,  92),   -- AR baixa: débito 183 CAIXA CENTRAL (recurso DINHEIRO)
  (2009, 'C', 'A', NULL, 93),   -- AR baixa: crédito cliente (PARCEIROS.CODCONTABIL)
  (2004, 'D', 'A', NULL, 91),   -- AP pagamento: débito fornecedor (PARCEIROS.CODCONTABIL_FOR)
  (2004, 'C', 'F', 183,  221)   -- AP pagamento: crédito 183 CAIXA CENTRAL (recurso DINHEIRO)
ON CONFLICT DO NOTHING;

-- 211 CLIENTES DIVERSOS / 11141 FORNECEDORES já existem (035/046); 183 CAIXA CENTRAL veio da 053.
-- O parceiro do smoke A Receber (codparceiro=20) ganha conta contábil de CLIENTE (o 22 já tem, do 036).
UPDATE parceiros SET codcontabil = '211' WHERE codparceiro = 20 AND codcontabil IS NULL;
