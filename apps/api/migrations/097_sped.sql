-- SPED fiscal — corte-1: EFD-Contribuições SCAFFOLD (motor escritor + bloco 0 + bloco 9). Sem tabelas novas neste
-- corte (o bloco 0/9 vem de EMPRESAS; a apuração/tabelas APURACAO_PC vêm no corte-2 com o bloco M). Só o grant RBAC.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMSPEDPISCOFINS', 'BTNGERAR', 7, 1), ('FRMSPEDPISCOFINS', 'BTNGERAR', 7, 2)
ON CONFLICT DO NOTHING;
