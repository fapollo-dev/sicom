-- 424 — a auditoria do Ajuste de preços - lote (uAjustePrecos): a configuração que o botão "Etiquetas" lê e o destino não tinha, com o
-- valor da produção em 15/10/2026 (S, sem específica): DESCONSIDERAR_GRUPO_PREÇO_AJUSTE_PREÇOS_LOTE — no fonte de 2020 era o
-- `DmConfigura.Configuracoes.DesconsideraGrupoPrecoNaTelaAjustesDePrecosLote` (udmConfigura.pas:462, o ConfigDB.xml da estação); o
-- binário da produção lê do banco. Ligada, as etiquetas dos lotes não puxam o grupo de preço (o processar continua propagando: 646 de
-- 757 irmãos com o preço do último lote no mesmo minuto desde mar/2026). E o acesso à tela para o operador de teste (o Pesquisar e o
-- Processar não têm Tag 1: valem com o acesso; o Excluir exige BTNEXCLUIR).
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao)
SELECT 539, 'DESCONSIDERAR_GRUPO_PREÇO_AJUSTE_PREÇOS_LOTE', 'S', 'String', 'Modulo;Empresa;Grupo;Usuario',
       'No ajuste de preço desconsiderar o grupo de preço do produto (as etiquetas do Ajuste de preços - lote).'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes c WHERE c.codigo = 'DESCONSIDERAR_GRUPO_PREÇO_AJUSTE_PREÇOS_LOTE' OR c.id = 539);
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
SELECT 'FRMAJUSTEPRECOS', 'FRMAJUSTEPRECOS', 7, e.e FROM (VALUES (1), (2)) AS e(e)
 WHERE NOT EXISTS (SELECT 1 FROM permissoes p WHERE p.form = 'FRMAJUSTEPRECOS' AND p.opcao = 'FRMAJUSTEPRECOS' AND p.codoperador = 7 AND p.codempresa = e.e);
