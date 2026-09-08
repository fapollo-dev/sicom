-- 198 — FECHAMENTO DIÁRIO (`FRMFECHAMENTODIARIO`). Dossiê: `uFechamentoDiario-impacto.md`.
--
-- Decisão do usuário (08/09): migrar por completo. Antes disso o veredicto era "rebaixado" — errado, e o erro
-- veio de medir na homologação: lá o fechamento parava em fev/2024 porque a CÓPIA parou. Em produção são
-- **3.346 dias fechados**, 271 só em 2026, o último em 31/07, e a tela tem 740 acessos (último em 01/09).
--
-- A tabela é pequena e o legado a trata como marcação por (dia, empresa): sem linha = dia nunca tocado, linha
-- com STATUS nulo = ABERTO, 'F' = FECHADO. O `cmbMesChange` cria as linhas do mês inteiro ao abrir a tela — por
-- isso existem 1.708 linhas em aberto que são só resíduo de navegação, e por isso a nossa listagem também
-- materializa o mês (senão o operador não vê os dias que ainda não têm linha).
CREATE TABLE IF NOT EXISTS fechamento (
  codfechamento integer PRIMARY KEY,
  data          date NOT NULL,
  status        char(1),        -- NULL = aberto · 'F' = fechado (é assim no legado; não inventar 'A')
  idempresa     integer NOT NULL
);
-- (dia, empresa) é a chave real do legado, mas SEM unicidade declarada lá. Em produção não há duplicata; o
-- índice único protege o que o app grava e a carga passa porque o dado está limpo.
CREATE UNIQUE INDEX IF NOT EXISTS ux_fechamento_dia ON fechamento (idempresa, data);
CREATE INDEX IF NOT EXISTS ix_fechamento_status ON fechamento (idempresa, status, data);

-- RBAC: o cliente concede só o gate da tela (`FRMFECHAMENTODIARIO`, 29 operadores) — não há opção por botão.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMFECHAMENTODIARIO', 'FRMFECHAMENTODIARIO', 7, 1)
ON CONFLICT DO NOTHING;
