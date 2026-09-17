-- 241 — EXTRATO DE FORNECEDORES (`FRMEXTRATOFORNECEDORES`). **38 acessos, 4 operadores.**
-- O que se deve a cada fornecedor. Nenhuma coluna nova: sai de `APAGAR`, `APAGAR_BX`, `PARCEIROS` e `NF`.
--
-- O modelo mais valioso é o **saldo numa data passada** (`dtcompra <= d` e não pago NAQUELE dia) — quanto se
-- devia no fechamento do mês. Repare que ele olha a **data do pagamento**, não o flag `QUITADA`: um título
-- pago depois da data ainda contava como dívida naquele dia. É a diferença entre um saldo retroativo correto
-- e um que "conserta o passado" com a informação de hoje.
--
-- ⚠️ **uma coluna com duas semânticas**: `CASE A.quitada WHEN 'S' THEN P.DTPGTO ELSE A.DTVENC END DTVENC` —
-- a coluna "vencimento" mostra a data do **pagamento** quando o título está quitado. É intencional, e foi
-- mantida; a tela nomeia a coluna de acordo em vez de fingir que é só vencimento.
--
-- ⚠️ **o campo Parceiro do legado é injeção de SQL**: sem `%` no texto, ele concatena **direto, sem aspas**
-- (`Filtro + ' AND PA.RAZAO ' + edtParceiro.Text`, `:126`). Digitar `NESTLE` gera `AND PA.RAZAO NESTLE` e
-- quebra a consulta; só funciona se o operador escrever o operador SQL junto (`= 'NESTLE'`). Aqui é um nome.
--
-- ⚠️ o modelo de **cheques próprios** fica de fora: `CHQ_PROPRIO` tem **0 linhas** no cliente.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMEXTRATOFORNECEDORES', 'FRMEXTRATOFORNECEDORES', 7, 1)
ON CONFLICT DO NOTHING;
