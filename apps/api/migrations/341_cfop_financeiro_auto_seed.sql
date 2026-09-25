-- 341 — o SEED da mig 064 ligava CFOP.GERA_FINANCEIRO_AUTO no 1102 ("no golden só o 1102", lido na homologação). Na PRODUÇÃO nenhum
-- CFOP tem 'S' (N=25, nulo=373 em 24/09/2026) e o financeiro automático do legado (`GerarFinanceiroAutomaticamente`, udmNF.pas:8112)
-- roda no PROCESSAR da nota — que, desde o corte B do faturamento, é onde o Apollo o roda também. Com o seed, toda entrada 1102 da base de
-- desenvolvimento seria faturada sozinha no processar. O dado de produção entra pela carga (esta migration roda antes dela).
UPDATE cfop SET gera_financeiro_auto = 'N' WHERE codcfop = '1102' AND gera_financeiro_auto = 'S';

-- as configurações do FATURAMENTO que o Apollo passa a ler (valores e textos da produção, 25/09/2026); a carga as substitui pelas do
-- cliente. O ID é o da produção quando está livre na base.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 153) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 153 END,
       'BONIFICACAO_FATURAMENTO_NF', 'S', 'String', 'Em Movimentação financeira, na funcionalidade de Faturamento será habilitado ou não um botão para permitir a bonificação da fatura.', 'S;N|Sim;Nao', 'Modulo;Empresa;Grupo;Usuario', 'Nota Fiscal', 'Utilizar bonificação no faturamento de nota fiscal'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'BONIFICACAO_FATURAMENTO_NF');
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 196) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 196 END,
       'FINANCEIRO_BONIFICACAO_ACORDO', 'N', 'String', 'Para notas de bonificação oriundas de acordo comercial, será permitido ao usuário, através deste configurador, gerar financeiro destas notas fiscais.', 'S;N|Sim;Não', 'Modulo;Empresa;Grupo;Usuario', 'Nota Fiscal', 'Gerar financeiro para notas fiscais de bonificação provenientes de acordo comercial.'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'FINANCEIRO_BONIFICACAO_ACORDO');
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 258) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 258 END,
       'PERMITE_EXCLUIR_FINANCEIRO_DA_NF', 'S', 'String', 'Define se o sistema irá permitir ao usuário excluir documentos financeiros a partir da tela de nota fiscal. Apenas documentos financeiros em aberto.', 'S;N|Sim;Não', 'Modulo;Empresa;Grupo;Usuario', 'Nota Fiscal', 'Permite excluir documentos financeiros a partir da tela de nota fiscal'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'PERMITE_EXCLUIR_FINANCEIRO_DA_NF');
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 22) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 22 END,
       'ESTORNA_FINANCEIRO', 'N', 'String', 'Define se o sistema irá exibir mensagem de confirmação no estorno automático do financeiro. Reversão de processo, cancelamento e notas de devolução.', 'S;N|Sim;Não', 'Empresa;Grupo;Usuario', 'Nota Fiscal', 'Mensagem de confirmação no estorno automático do financeiro de nf'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'ESTORNA_FINANCEIRO');
