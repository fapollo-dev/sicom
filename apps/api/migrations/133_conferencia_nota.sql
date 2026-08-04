-- 133 — CONFERÊNCIA DE NOTA FISCAL (FRMCONFERENCIANOTA) — corte-1: APROVAR / CANCELAR a conferência.
-- 5.662 acessos / 12 operadores, VIVA em uso diário (última DATA_COLETA no golden é de hoje) e com 18.077
-- aprovações registradas (operadores 4: 15.185 · 243: 2.318 · 1: 505 · 59: 69).
--
-- O QUE A TELA É (e o que ela NÃO é): a conferência física — bipar o produto e contar — é feita no COLETOR (é
-- ele que grava QUANTIDADE_COLETA/DATA_COLETA/USUARIO_COLETA/TENTATIVAS_COLETA). Esta tela é o lado da
-- retaguarda: o supervisor vê o que o coletor contou e **APROVA** ou **CANCELA**. Daí o corte-1 ser as duas ações.
--
-- COLUNAS (nenhuma existia aqui) — todas VIVAS no golden de 252.468 itens de NF:
--   quantidade_coleta    94.896  — **a quantidade CONTADA**. É a coluna que define "conferido": o legado pinta a
--                                  linha de VERMELHO quando divergente da nota (dbgridDrawColumnCell:748) e é ela
--                                  que a trava de processamento da NF lê (uNF.pas:17346), não o produc_status.
--                                  45.550 linhas divergem da quantidade da nota — não é caso de borda.
--   usuario_coleta       94.901  — quem contou · tentativas_coleta 9.009 — nº de tentativas de coleta
--   data_coleta          94.873  — quando contou
--   fatorembal_coleta    94.901  — fator de embalagem lido na coleta
--   produc_status       109.719  — 'CONFERENCIA OK' 89.640 · 'APROVADO' 18.077 · 'LIBERADO' 1.948
--                                  · 'BLOQUEADO' 46 · 'PARCIAL' 6 · 'QUANTIDADE INVALIDA' 2
--   codoperador_aprova_coleta 18.258 — o SUPERVISOR que aprovou (não o operador da sessão)
--   data_aprovacao_conf  18.243  — quem escreve NÃO é o form legado (o dataset dele nem seleciona a coluna, e
--                                  NF_PROD não tem trigger): é um escritor de fora do fonte. Nós gravamos aqui,
--                                  o que reproduz o golden (18.077 de 18.077 itens 'APROVADO' têm a data).
-- NÃO criada: produc_lote (0 linhas) → o modo "conferência POR LOTE de notas" está MORTO; corte-1 é por NF.
ALTER TABLE nf_prod
  -- a descrição que o FORNECEDOR imprimiu na nota (Oracle VARCHAR2(150), **100% populada**: 252.468/252.468).
  -- A grade do legado mostra ESTA, não a do cadastro — num item cujo de-para ainda não resolveu o codproduto, a
  -- do cadastro vem vazia e o supervisor perde a única pista de o que é a linha.
  ADD COLUMN IF NOT EXISTS descricao                 varchar(150),
  ADD COLUMN IF NOT EXISTS produc_status             varchar(50),    -- = VARCHAR2(50) do Oracle (não estreitar: ETL 22001)
  ADD COLUMN IF NOT EXISTS quantidade_coleta         numeric(13,3),  -- quantidade CONTADA pelo coletor (em unidades)
  ADD COLUMN IF NOT EXISTS usuario_coleta            integer,        -- operador que contou
  ADD COLUMN IF NOT EXISTS tentativas_coleta         integer,        -- nº de tentativas de coleta
  ADD COLUMN IF NOT EXISTS data_coleta               timestamptz,    -- quando o coletor contou
  ADD COLUMN IF NOT EXISTS fatorembal_coleta         numeric(13,3),  -- fator de embalagem lido na coleta
  ADD COLUMN IF NOT EXISTS codoperador_aprova_coleta integer,        -- SUPERVISOR que aprovou (via liberação)
  ADD COLUMN IF NOT EXISTS data_aprovacao_conf       timestamptz;    -- quando aprovou

-- a tela abre por NF (índice de codnf já existe). Este é p/ a consulta "o que falta aprovar".
CREATE INDEX IF NOT EXISTS ix_nf_prod_produc_status ON nf_prod (produc_status) WHERE produc_status IS NOT NULL;

-- GATE de aprovação: `UsuarioLiberadoParaAprovacao` (uConferenciaNota.pas:1275) exige que o autorizador esteja na
-- lista de permitidos E digite a senha — e o código que vai para CODOPERADOR_APROVA_COLETA é o DELE, não o da
-- sessão. Reusa o LiberacaoService (E8).
-- ⚠️ A LISTA **não** é o valor da config (que é 'N'): são overrides por-usuário em CONFIGURACOES_ESPECIFICAS,
-- exatamente como 083_liberacao_grants.sql já registrou p/ as outras chaves. Identidade preservada do legado:
-- id 287, tipovalor 'String', escopo permitido 'Usuario' (o gate LÊ tipo='Usuario' — declarar 'Modulo;Empresa'
-- faria a tela de Configurações dizer que a chave não pode ser por usuário, contradizendo o próprio gate).
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (287, 'USUARIOS_APROVAM_CONFERENCIA_NOTA', 'N', 'String', 'Usuario', 'Quem pode APROVAR a conferência de nota fiscal. A lista são os grants por-usuário em configuracoes_especificas (tipo=Usuario, valor=S) — o valor global "N" NÃO é a lista. Golden: 3 autorizadores (operadores 1, 4 e 59).')
ON CONFLICT (id) DO NOTHING;

-- os 3 autorizadores do golden. Sem FK p/ operadores nesta tabela (é chave-valor), então o seed é inócuo se o
-- operador ainda não existir no destino; o cutover de operadores o materializa.
INSERT INTO configuracoes_especificas (id, tipo, chave, valor)
  SELECT 287, 'Usuario', ch, 'S' FROM (VALUES ('1'), ('4'), ('59')) AS v(ch)
ON CONFLICT DO NOTHING;

-- RBAC: gate de tela.
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMCONFERENCIANOTA', 'FRMCONFERENCIANOTA', 7, 1),
  ('FRMCONFERENCIANOTA', 'FRMCONFERENCIANOTA', 7, 2)
ON CONFLICT DO NOTHING;
