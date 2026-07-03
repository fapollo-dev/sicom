-- 050 — CAIXA corte-2c (reabertura). Só o grant RBAC da nova ação FRMCAIXA/BTNREABRIR (a lógica é
-- toda no caixa.service.reabrir; não há nova coluna/tabela). Reabrir = F→A (espelho do fechar):
-- estorna o título de quebra gerado (DELETE, como uFechamentoCaixa.pas btnReabrirClick) e limpa a
-- conferência; bloqueia se a quebra já foi baixada/agrupada/em-lote, e respeita "1 aberto por operador".
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCAIXA', 'BTNREABRIR', 7, 1),
  ('FRMCAIXA', 'BTNREABRIR', 7, 2);
