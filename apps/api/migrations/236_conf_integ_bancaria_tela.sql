-- 236 — CONFIGURAÇÃO DA INTEGRAÇÃO BANCÁRIA, BOLETO (`FRMCONFINTEGBANCARIA`, `uConfIntegBancaria.pas`).
-- **50 acessos, 3 operadores.** A tabela e as 20 colunas vieram com o CNAB (migration 153); entra a tela.
--
-- É o que o CNAB de cobrança lê para montar a remessa: banco, conta, layout, convênio e o sequencial do
-- próximo arquivo. No cliente são **3 configurações**, a última alterada em **02/07/2025** — duas no Itaú
-- (`C400`, uma delas com bolecode ligado) e uma no Banco do Brasil com convênio `20279354`.
--
-- ⚠️ **`SEQUENCIAREMESSA` é ESTADO, não configuração.** O `cnab-remessa.service` o incrementa a cada remessa,
-- sob lock. O legado deixa editar pela tela e nós mantemos (cópia fiel), mas baixar o número faz o banco
-- receber dois arquivos com o mesmo sequencial e rejeitar a remessa. A tela avisa em vez de esconder.
--
-- ⚠️ **`CODBCO` é o código INTERNO** (`BANCOS.CODBCO` — 526 é o Itaú aqui) e **`CODFORNBCO` é o FEBRABAN**
-- ('341', '001'). Dois números diferentes para o mesmo banco; trocá-los gera remessa que o banco não lê.
--
-- ⚠️ o `OBS_BOLETO` do cliente traz **placeholders**: `$(Multa)` e `$(Juros)`, que o gerador substitui —
-- o mesmo padrão do histórico contábil (migration 229), em outro canto do sistema.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCONFINTEGBANCARIA', 'FRMCONFINTEGBANCARIA', 7, 1),
  ('FRMCONFINTEGBANCARIA', 'BTNGRAVAR',            7, 1),
  ('FRMCONFINTEGBANCARIA', 'BTNEXCLUIR',           7, 1)
ON CONFLICT DO NOTHING;
