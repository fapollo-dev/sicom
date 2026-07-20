-- 101 — CONFIGURAÇÕES (admin/gestão da camada chave-valor). A mig 033 criou as tabelas + o resolver e
-- seedou 4 chaves com metadados MÍNIMOS (tipovalor 'S/N'/'lista', sem valorespossiveis/categoria). Para a
-- TELA de gestão (UConfigura) precisamos do metadado FIEL ao Oracle: `tipovalor` é sempre 'String'/'Integer'/
-- 'Float' (o S/N é derivado de VALORESPOSSIVEIS 'S;N|Sim;Não'), + CATEGORIAS (agrupador) + DESCRICAOPEQUENA
-- (rótulo curto). Confrontado no PINHEIRAO (golden 2026-07). Também seeda as 2 chaves documentadas mas ainda
-- não catalogadas (100/291) e os 2 overrides REAIS dessas chaves, para a tela abrir com o estado do legado.

ALTER TABLE configuracoes ADD COLUMN IF NOT EXISTS categorias       varchar(250);
ALTER TABLE configuracoes ADD COLUMN IF NOT EXISTS descricaopequena varchar(250);

-- corrige o metadado das 4 chaves já seedadas (tipovalor real='String'; popula valorespossiveis/categoria/rótulo).
UPDATE configuracoes SET tipovalor='String', categorias='Nota Fiscal',
  descricaopequena='Realiza aproveitamento de crédito/débito de ICMS ST na nota fiscal.',
  valorespossiveis='S;N|Sim;Não' WHERE codigo='APROVEITAMENTO_CREDITO_ICMSST_NF';
UPDATE configuracoes SET tipovalor='String', categorias='Nota Fiscal',
  descricaopequena='Processar e reverter processamento de notas fiscais com produtos com quantidade negativa em estoque',
  valorespossiveis='S;N|Sim;Não' WHERE codigo='PERMITE_PROC_NF_ESTOQUE_NEG';
UPDATE configuracoes SET tipovalor='String', categorias='Nota Fiscal',
  descricaopequena='Estorna financeiro automaticamente',
  valorespossiveis='S;N|Sim;Não' WHERE codigo='ESTORNA_FINANCEIRO_NF';
UPDATE configuracoes SET tipovalor='String', categorias='Nota Fiscal',
  descricaopequena='Ambiente de envio de nota fiscal',
  valorespossiveis='P;H|Produção;Homologação' WHERE codigo='AMBIENTE_NF';

-- seed das 2 chaves confirmadas no Oracle mas ainda fora do catálogo migrado (para gestão/visibilidade;
-- UTILIZA_INTEGRACAO_CONTABIL não é consumida pelo código — a integração usa EMPRESAS.INTEGRACAO='AUTOMATICA' —
-- e CALCULA_ICMSST_..._SEM_INDEX não tem caminho migrado; catalogadas p/ paridade e futura fiação).
INSERT INTO configuracoes (id, codigo, valor, tipovalor, categorias, descricaopequena, valorespossiveis, config_especificas_permitidas, obsoleto) VALUES
  (100, 'UTILIZA_INTEGRACAO_CONTABIL', 'N', 'String', 'Contábil', 'Utilizar integração contábil', 'S;N|Sim;Não', 'Modulo;Empresa', 'N'),
  (291, 'CALCULA_ICMSST_EMISSAOPROPRIA_NF_SEM_INDEX', 'N', 'String', 'Nota Fiscal', 'Calcula ICMS ST para notas de entrada emissão própria para empresas com figura fiscal dispensada', 'S;N|Sim;Não', 'Modulo;Empresa', 'N')
ON CONFLICT (id) DO NOTHING;

-- overrides REAIS do PINHEIRAO dessas chaves (golden): AMBIENTE_NF Empresa 1 → 'H' (órfão, display); e a
-- integração contábil ligada no módulo Retaguarda (não consumida pelo resolver hoje — display/paridade).
INSERT INTO configuracoes_especificas (id, tipo, chave, valor)
  SELECT 48, 'Empresa', '1', 'H' WHERE EXISTS (SELECT 1 FROM configuracoes WHERE id=48)
ON CONFLICT (id, tipo, chave) DO NOTHING;
INSERT INTO configuracoes_especificas (id, tipo, chave, valor)
  SELECT 100, 'Modulo', 'Retaguarda', 'S' WHERE EXISTS (SELECT 1 FROM configuracoes WHERE id=100)
ON CONFLICT (id, tipo, chave) DO NOTHING;

-- RBAC da tela de gestão (FRMCONFIGURA). Empresa 1 (smoke) + 2 (teste de tenant). Escrita = BTNGRAVAR.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCONFIGURA', 'BTNGRAVAR', 7, 1),
  ('FRMCONFIGURA', 'BTNGRAVAR', 7, 2);
