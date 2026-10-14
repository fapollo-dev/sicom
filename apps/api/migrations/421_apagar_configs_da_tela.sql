-- 421 — a configuração que o Gravar da tela de Contas a Pagar (uAPagar.pas:1866) lê e o destino não tinha: id, default e whitelist
-- = CONFIGURACOES da produção em 14/10/2026 (sem override em CONFIGURACOES_ESPECIFICAS). "Bloquear": o total dos centros de
-- custo tem de bater com o total das parcelas; "Avisar": pergunta "Deseja continuar?"; "Não verificar".
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (59, 'VERIFICA_CC_MAIOR_PARCELAS', 'B', 'String', 'Empresa;Grupo;Usuario', 'Verifica se total do centro de custo é maior que a soma das parcelas (B=Bloquear, A=Avisar, N=Não verificar).')
ON CONFLICT (id) DO NOTHING;
