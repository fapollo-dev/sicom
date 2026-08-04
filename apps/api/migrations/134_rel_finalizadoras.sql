-- 134 — VENDAS E FINALIZADORAS (FRMRELFINALIZADORAS) — 3º relatório migrado.
-- 7.897 acessos / 9 operadores. **Nenhuma coluna nova**: tudo que o relatório lê já está migrado
-- (VENDAS mig 105, CX_VENDAS mig 106, FORMAS_PGTO mig 052). Este arquivo é só o RBAC.
--
-- As duas tabelas que o legado também toca e que NÃO existem aqui são MORTAS no golden, então o relatório não
-- perde nada — cópia-fiel-negativa registrada:
--   CHEQUE        12 linhas (última 2024-10-15) — a perna de cheque do legado é decorativa;
--   AGRUPARECEBER  0 linhas — o `NOT EXISTS(... AGRUPARECEBER ...)` do legado é um no-op.
--
-- RBAC: as 2 opções reais do Oracle p/ este form — a TELA (10 grants) e o botão CONSULTA (13 grants).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMRELFINALIZADORAS', 'FRMRELFINALIZADORAS', 7, 1),
  ('FRMRELFINALIZADORAS', 'FRMRELFINALIZADORAS', 7, 2),
  ('FRMRELFINALIZADORAS', 'BTNCONSULTA',         7, 1),
  ('FRMRELFINALIZADORAS', 'BTNCONSULTA',         7, 2)
ON CONFLICT DO NOTHING;

-- SEM índice novo (fold da auditoria): a mig 106 já tem `ix_cx_vendas_empresa_data (idempresa, data)`, que serve
-- este predicado. Acrescentar `operacao` no fim não tornaria a varredura index-only (valor/troco vêm do heap) nem
-- ajudaria o hash aggregate (a chave é `to_char(data)`, que o planner não trata como ordenada por data) — só
-- custaria escrita a mais na tabela de inserção mais quente do PDV.
