-- 213 — RELATÓRIOS DE COMPRAS (`FRMRELCOMPRAS`): só o gate de tela.
--
-- 204 acessos, 19 operadores, último em 17/08/2026. Três relatórios num combo (por categoria, o mesmo
-- analítico com rateio de decomposição, e compras × vendas por departamento). O legado concede apenas o
-- gate da tela — não há opção por botão (`URelCompras.dfm` não tem `RequerAcesso` por controle).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES ('FRMRELCOMPRAS', 'FRMRELCOMPRAS', 7, 1)
ON CONFLICT DO NOTHING;

-- ── `EMPRESAS.IDSUPORTEBORBA` — a coluna da integração que não vamos migrar ─────────────────────────────
-- A tela `FRMVERIFICACAOTRIBUTARIABORBAFISCAL` (388 acessos, 9 operadores, último em 15/06/2026) é a maior
-- da fila por uso, e **não tem unit no repositório clonado**: nenhum `.pas`, nenhum `.dfm`, nenhuma
-- referência ao nome do form. Sem fonte não há cópia fiel — mesmo caso do `FRMMANCADCARTAOBOAVISTA`.
-- Do mecanismo só existe no fonte o campo abaixo, o identificador do cliente na Borba, editável em
-- `UCadEmpresa.dfm:703` e mapeado no dataset de `uNF.dfm:19071`. Trazemos a coluna para a carga não perder
-- o valor quando a integração for retomada; nenhuma regra depende dela hoje.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS idsuporteborba varchar(30);
