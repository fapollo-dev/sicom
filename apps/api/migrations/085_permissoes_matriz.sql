-- 085 — PERFIS & PERMISSÕES corte-2: grant da matriz de permissões (UCtrlPermissoes) + acesso perfil-aware.
--
-- A matriz (conceder/revogar FORM×OPCAO a um perfil) e o catálogo de ações vivem sob a mesma tela de perfis;
-- grant BTNPERMISSOES. O acesso.service passa a considerar os grants por-perfil quando APP_PERMISSAO_MODO
-- ∈ {perfil, ambos} (default 'usuario' inalterado — sem regressão). Sem DDL: reusa permissoes/perfil/relacao.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCADPERFILOPERADOR', 'BTNPERMISSOES', 7, 1), ('FRMCADPERFILOPERADOR', 'BTNPERMISSOES', 7, 2)
ON CONFLICT DO NOTHING;
