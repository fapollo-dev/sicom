-- 113 — PRODUTO aba "Outros" (tshOutros do UCadProduto): flags S/N de comportamento do produto. São CHAR(1)
-- nulos no legado (sem default; golden: NULL/'S'/'N'). Superficiados no cadastro; consumidos por PDV/site/cotação/
-- balança conforme o legado. NÃO inclui: CODFCP (já existe, aba Fiscal) ·
-- FCP_SAIDA/DESC_FCP (derivados de lookup FCP inexistente) · IPPT (inexistente no golden) · TARA_ID (precisa de
-- lookup de tara — adiado). (SERVICO é produto-nível aqui — NÃO confundir com receita_prod.servico da mig 023.)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS servico                  char(1);  -- Item de serviço
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS servicoatende            char(1);  -- Serviço Integração Atende
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS item_cozinha             char(1);  -- Item produzido na cozinha
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS impressora_terminal      char(1);  -- Imprime próximo do terminal
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS retirapromo              char(1);  -- Ignorar na promoção
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS realizatroca             char(1);  -- Troca
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS imobilizado              char(1);  -- Imobilizado
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS atacado                  char(1);  -- Atacado
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS exibesicomanda           char(1);  -- Exibe no SICOMANDA
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS vende_site               char(1);  -- Vende no site
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS altera_descricao_cotacao char(1);  -- Altera a descrição na cotação
-- 3 flags do MESMO tshOutros, com DADO real no golden (achado de paridade — antes dropadas):
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS prod_sem_gtin            char(1);  -- Este produto não possui GTIN
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS vasilhame                char(1);  -- Vasilhame
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cotacao                  char(1);  -- Participa de cotação
