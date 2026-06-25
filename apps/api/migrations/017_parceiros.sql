-- PARCEIROS — tela UNIFICADA (Cliente/Fornecedor/Funcionário/Transportador/Convênio).
-- As tabelas parceiros/parceiros_end + seed são CANÔNICAS em 014 (criadas antes, pois Lotes
-- também as usa). Aqui ficam só os artefatos da TELA de Parceiros: a view de listagem, o
-- índice de duplicidade de documento, e o RBAC. Fase 1 = núcleo fiel.
-- Doc: docs/04-screen-dossier/dossiers/retaguarda/uCadClientes.md

-- Duplicidade de documento (legado VerificarCPF_CNPJExistente, caminho BLOQUEAR='S'):
-- dois endereços não podem ter o mesmo CNPJ/CPF. Gera 409 DUPLICADO (ADR-015).
-- (O caminho "aviso + senha ADM" configurável fica para fase futura.)
CREATE UNIQUE INDEX IF NOT EXISTS ux_parceiros_end_doc
  ON parceiros_end (cnpj_cpf) WHERE cnpj_cpf IS NOT NULL;

-- View de pesquisa/listagem: decode TIPOFJ + flags de papel + documento/cidade/UF do
-- ENDEREÇO PADRÃO (LATERAL: o padrão 'S', senão o 1º). Expõe idempresa p/ o filtro multi-tenant.
CREATE OR REPLACE VIEW get_parceiros AS
SELECT
  p.codparceiro AS codigo,
  p.codparceiro,
  p.idempresa,
  p.razao,
  p.fantasia,
  CASE p.tipofj
    WHEN 'F' THEN 'FISICA'
    WHEN 'J' THEN 'JURIDICA'
    WHEN 'R' THEN 'RURAL'
    WHEN 'G' THEN 'GOVERNAMENTAL'
    WHEN 'E' THEN 'ENTIDADE'
    ELSE p.tipofj
  END AS tipo_pessoa,
  p.tipofj,
  p.cli, p.frn, p.fun, p.tra, p.con,
  p.ativado, p.bloqued,
  e.cnpj_cpf,
  e.cidade,
  e.uf
FROM parceiros p
LEFT JOIN LATERAL (
  SELECT pe.cnpj_cpf, pe.cidade, pe.uf
  FROM parceiros_end pe
  WHERE pe.codparceiro = p.codparceiro
  ORDER BY (pe.endereco_padrao = 'S') DESC, pe.codend
  LIMIT 1
) e ON true;

-- RBAC: a tela unificada usa o form FRMCADCLIENTES (a tela viva do legado).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADCLIENTES', 'BTNGRAVAR',            7, 1),
  ('FRMCADCLIENTES', 'BTNEXCLUIR',           7, 1),
  ('FRMCADCLIENTES', 'BTNADICIONARREGISTRO', 7, 1),
  ('FRMCADCLIENTES', 'BTNEDITAR',            7, 1);
