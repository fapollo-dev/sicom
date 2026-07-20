-- 103 — CONFIG do PLANO DE CONTAS (uCadConfPlanoContas): a MÁSCARA por nível que dirige o auto-código.
-- Legado: CONFIG_PLANO_CONTAS com NDIG_1..NDIG_n (nº de dígitos por nível) por TIPO de plano. Aqui a
-- máscara é guardada como CSV das larguras (NDIG_1..n → '1,1,2,2,4'), que reproduz o codiexpandido real do
-- PINHEIRAO ('1.1.03.01.0002' → larguras 1,1,2,2,4). Corte-2 usa isto p/ SUGERIR o próximo código (não é
-- validação rígida — o dado real tem exceções, ex.: '2.1.01.01.14822' com 5 dígitos no último nível).
CREATE TABLE IF NOT EXISTS config_plano_contas (
  tipo      char(1) PRIMARY KEY,     -- 'E' empresarial / 'R' referencial (o retaguarda usa 'E')
  mascara   varchar(50) NOT NULL,    -- larguras por nível, CSV: '1,1,2,2,4'
  descricao varchar(60)
);
INSERT INTO config_plano_contas (tipo, mascara, descricao) VALUES
  ('E', '1,1,2,2,4', 'Plano de contas empresarial')
ON CONFLICT (tipo) DO NOTHING;
