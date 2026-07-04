-- 053 — CAIXA corte-2d (contábil da quebra/sobra do fechamento). Reusa o motor contábil (diario/IIC/
-- lote_contabil, molde nf-contabilizacao) para lançar a DIVERGÊNCIA do fechamento no DIÁRIO:
--   SOBRA (diferença>0)            → situação 2019: D 183 CAIXA CENTRAL / C 541 SOBRA DE CAIXA
--   QUEBRA-sem-título (dif<0, s/ codrcb_quebra) → situação 2002: D 148 / C 183 CAIXA CENTRAL
-- (contas FIXAS 'F', golden Oracle CONFIG_SOBRACAIXA=2019 / CONFIG_FALTACAIXA=2002). CODORIGEM=17
-- (tocFechamentoCaixa), IDORIGEM=codcaixa. Gate EMPRESAS.INTEGRACAO='AUTOMATICA'; idempotente
-- (caixa_sessao.contabilizado) e reversível (estorno na reabertura).
-- ADIADOS (bloqueados por dependência ausente): fechamento-por-modalidade (2010, D=cofre/C=200 VENDAS
-- TRANSITORIAS — a transitória é alimentada pelo PDV, fora do escopo retaguarda) e quebra-COM-título
-- (785, D211/C200 — delega ao contábil de A Receber, que ainda não existe no monorepo).

-- contas contábeis faltantes (padrão minimal do 035/036; 148/200/211 já existem do 046/035).
INSERT INTO plano_contas (codplanocontas, descricao, tipo, status) VALUES
  (183, 'CAIXA CENTRAL',  'E', 'A'),
  (541, 'SOBRA DE CAIXA', 'E', 'A')
ON CONFLICT (codplanocontas) DO NOTHING;

-- IIC (itens_integracao_contabil): 1 linha 'D' + 1 'C' por situação (TIPO='F' conta fixa), golden Oracle.
INSERT INTO itens_integracao_contabil (codoperacao, natureza, tipo, codconta_contabil) VALUES
  (2019, 'D', 'F', 183),  -- SOBRA: débito CAIXA CENTRAL
  (2019, 'C', 'F', 541),  -- SOBRA: crédito SOBRA DE CAIXA (receita)
  (2002, 'D', 'F', 148),  -- QUEBRA-sem-título: débito (despesa)
  (2002, 'C', 'F', 183);  -- QUEBRA-sem-título: crédito CAIXA CENTRAL

-- idempotência do contábil do fechamento.
ALTER TABLE caixa_sessao ADD COLUMN IF NOT EXISTS contabilizado char(1);

-- republica a view com `contabilizado` (APENDADO no fim — CREATE OR REPLACE não reordena).
CREATE OR REPLACE VIEW get_caixa_sessao AS
SELECT
  s.codcaixa, s.codempresa, s.codoperador, s.dtabertura, s.dtfechamento,
  s.saldo_inicial, s.saldo_final, s.status, s.obs,
  CAST(s.saldo_inicial + COALESCE((
    SELECT SUM(CASE WHEN m.tipo = 'E' THEN m.valor ELSE -m.valor END)
    FROM caixa_mov m
    WHERE m.codcaixa = s.codcaixa AND COALESCE(m.indr, 'I') = 'I'
  ), 0) AS numeric(13,2)) AS saldo_corrente,
  s.valor_contado, s.diferenca, s.codrcb_quebra, s.contabilizado
FROM caixa_sessao s;

-- RBAC das ações contábeis do caixa.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCAIXA', 'BTNCONTABILIZAR',      7, 1),
  ('FRMCAIXA', 'BTNESTORNARCONTABIL',  7, 1),
  ('FRMCAIXA', 'BTNCONTABILIZAR',      7, 2),
  ('FRMCAIXA', 'BTNESTORNARCONTABIL',  7, 2);
