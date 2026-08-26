-- 177 — FOLDS da F1 (1º ensaio, §7h): duas afirmações nossas que o dado do cliente derruba.
--
-- 1) `ux_parceiros_end_doc` — UNIQUE global do CNPJ/CPF em parceiros_end. A §7b já tinha o veredicto e a medição:
--    **1.042 dos 1.048 grupos são parceiros DIFERENTES com o mesmo documento** (só 6 são o mesmo parceiro com
--    dois endereços). O ensaio da F1 confirmou na prática — 18.261 endereços não entraram. Sai; duplicidade de
--    cadastro vira aviso de tela, não bloqueio de carga.
DROP INDEX IF EXISTS ux_parceiros_end_doc;
CREATE INDEX IF NOT EXISTS ix_parceiros_end_doc ON parceiros_end (cnpj_cpf);

-- 2) `codreferencia_for.codfor` NOT NULL — a ORIGEM PERMITE NULL (o de-para de fornecedor tem linhas sem
--    fornecedor: são referências por produto). Classe nova de achado: NOT NULL nosso que o dado viola.
ALTER TABLE codreferencia_for ALTER COLUMN codfor DROP NOT NULL;
