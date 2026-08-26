-- 178 — CNPJ/CPF do endereço: unicidade PARCIAL, mesmo padrão do login (mig 173).
--
-- A mig 177 removeu `ux_parceiros_end_doc` porque o dado do cliente o viola (1.042 dos 1.048 grupos são
-- parceiros DIFERENTES com o mesmo documento) — mas o índice era também o que produzia o 409 DUPLICADO no
-- cadastro, e isso é regra útil que o smoke cobre. A saída é a mesma do login: o histórico entra como está e a
-- unicidade vale para o que NASCE no Apollo.
ALTER TABLE parceiros_end ADD COLUMN IF NOT EXISTS origem_legado char(1);
COMMENT ON COLUMN parceiros_end.origem_legado IS 'S = veio da carga do Oracle (aceita documento repetido do histórico)';
CREATE UNIQUE INDEX IF NOT EXISTS ux_parceiros_end_doc_novo
  ON parceiros_end (cnpj_cpf)
  WHERE cnpj_cpf IS NOT NULL AND coalesce(origem_legado, 'N') <> 'S';
