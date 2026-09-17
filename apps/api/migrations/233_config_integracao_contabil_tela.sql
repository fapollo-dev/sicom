-- 233 — CONFIGURAÇÃO DA INTEGRAÇÃO CONTÁBIL (`FRMCONFIGINTEGRACAOCONTABIL`). 55 acessos, 2 operadores.
--
-- A tabela e as **60 colunas** já vieram com o épico da integração (migrations 199-201) — o motor as lê para
-- achar as duas pernas de cada lançamento. Faltava a TELA que as edita, e é só isso que entra aqui.
--
-- É o painel que diz, para cada EVENTO do sistema, qual situação o razão deve usar. No cliente, **27 dos 60
-- campos estão preenchidos**: o resto são eventos que a loja não contabiliza (cheques, boa parte das
-- retenções, o fiscal por dentro da NFC-e).
--
-- ⚠️ apontar para uma situação que não tem as DUAS pernas em `ITENS_INTEGRACAO_CONTABIL` é o erro que só
-- aparece muito depois, na hora de contabilizar, longe de quem configurou. A tela mostra o estado de cada
-- situação e avisa quais apontadores estão pendurados em situação incompleta.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCONFIGINTEGRACAOCONTABIL', 'FRMCONFIGINTEGRACAOCONTABIL', 7, 1),
  ('FRMCONFIGINTEGRACAOCONTABIL', 'BTNGRAVAR',                   7, 1)
ON CONFLICT DO NOTHING;
