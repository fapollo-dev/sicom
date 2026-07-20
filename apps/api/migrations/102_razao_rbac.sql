-- 102 — LIVRO RAZÃO contábil (relatório, uRelRazaoContabil). Leitura pura sobre DIARIO (nada de tabela nova).
-- Só o RBAC da tela. Espelha o DRE (FRMDRE/BTNVISUALIZAR). Empresa 1 (smoke) + 2 (teste de tenant).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELRAZAOCONTABIL', 'BTNVISUALIZAR', 7, 1),
  ('FRMRELRAZAOCONTABIL', 'BTNVISUALIZAR', 7, 2);
