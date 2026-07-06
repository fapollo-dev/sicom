-- 058 — AR/AP contábil-2: recurso BANCO na baixa. Quando o título é baixado/pago por DEPÓSITO BANCÁRIO
-- (recurso='BANCO' + codconta), o contábil usa a conta contábil do banco (contas_bancarias.codlanccontabil)
-- como perna de dinheiro, em vez da 183 CAIXA: AR → D <banco> / C cliente; AP → D fornecedor / C <banco>
-- (mesma situação 2009/2004, CODORIGEM 16/15). Confirmado no Oracle: os débitos da baixa AR se distribuem
-- por recurso (186 BANCO ITAÚ / 190 CEF / 195 BB / 213 cartões) = contas_bancarias.codlanccontabil.
-- (Juros/desconto separados = INÓCUO neste tenant — o cliente é creditado o valorpg cheio. Cheque/cartão =
-- adiado, dependem de tabelas CHEQUE/CARTAO ausentes.)

-- conta contábil do banco (destino do depósito). O seed de contas_bancarias (004) não preenche codlanccontabil.
-- tipo='E' (padrão do plano_contas, alinhado a 053/057/046; o discriminador analítica/sintética é `classe`).
-- Seed minimal (como 183/541/190): classe/natureza/máscara ficam NULL — coerente com as demais contas downstream.
INSERT INTO plano_contas (codplanocontas, descricao, tipo, status) VALUES
  (186, 'BANCO ITAU S/A', 'E', 'A')
ON CONFLICT (codplanocontas) DO NOTHING;

-- vincula a 1ª conta bancária do seed (codconta=1, CONTA MOVIMENTO PRINCIPAL) à conta contábil 186.
UPDATE contas_bancarias SET codlanccontabil = '186' WHERE codconta = 1 AND codlanccontabil IS NULL;
