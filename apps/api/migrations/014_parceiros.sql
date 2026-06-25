-- PARCEIROS + PARCEIROS_END (subset legado Oracle homolog).
-- Tabelas TRANSACIONAIS reais necessárias para a tela "Lotes de Cobrança" completa:
--   - PARCEIROS  : o "Cobrador" do lote é um PARCEIRO com FUN='S' (exibido por RAZAO);
--                  também é o Cliente de cada documento (ARECEBER.CODPARCEIRO → RAZAO).
--   - PARCEIROS_END : endereço de cobrança (ENDERECO/BAIRRO/CIDADE/UF/TELEFONE) exibido
--                  no grid de itens, ligado por PARCEIROS.CODEND.
-- Subset de colunas CONFIRMADO no Oracle (não re-consultado): codparceiro, razao, fun,
-- tolerancia (dias de carência p/ juros), codend. Tipos Oracle→PG: NUMBER→integer,
-- VARCHAR2→varchar, CHAR(1)→char(1).
CREATE SEQUENCE IF NOT EXISTS seq_parceiros_codparceiro;
CREATE SEQUENCE IF NOT EXISTS seq_parceiros_end_codend;

CREATE TABLE IF NOT EXISTS parceiros (
  codparceiro integer PRIMARY KEY DEFAULT nextval('seq_parceiros_codparceiro'),
  razao       varchar(150),
  fun         char(1),       -- 'S' = é cobrador/fornecedor (filtro do "Cobrador")
  tolerancia  integer,       -- dias de carência: atraso < tolerancia ⇒ sem juros
  codend      integer        -- FK lógica → parceiros_end.codend
);
ALTER SEQUENCE seq_parceiros_codparceiro OWNED BY parceiros.codparceiro;

CREATE TABLE IF NOT EXISTS parceiros_end (
  codend    integer PRIMARY KEY DEFAULT nextval('seq_parceiros_end_codend'),
  endereco  varchar(150),
  bairro    varchar(50),
  cidade    varchar(60),
  uf        char(2),
  telefone  varchar(20)
);
ALTER SEQUENCE seq_parceiros_end_codend OWNED BY parceiros_end.codend;

-- Seed de endereços de cobrança (codend explícito p/ casar com parceiros.codend).
INSERT INTO parceiros_end (codend, endereco, bairro, cidade, uf, telefone) VALUES
  (1, 'RUA DAS FLORES, 100',   'CENTRO',         'PINHEIRO',     'MA', '(98) 3000-0001'),
  (2, 'AV. BRASIL, 2500',      'JARDIM AMERICA', 'SAO LUIS',     'MA', '(98) 3000-0002'),
  (3, 'TRAVESSA SAO JOAO, 45', 'VILA NOVA',      'IMPERATRIZ',   'MA', '(99) 3000-0003'),
  (4, 'RUA DO COMERCIO, 78',   'SANTA CRUZ',     'CAXIAS',       'MA', '(99) 3000-0004'),
  (5, 'RUA PROJETADA, 9',      'CENTRO',         'BACABAL',      'MA', '(99) 3000-0005')
ON CONFLICT (codend) DO NOTHING;
SELECT setval('seq_parceiros_end_codend', (SELECT COALESCE(MAX(codend), 1) FROM parceiros_end));

-- Seed de parceiros. IMPORTANTE p/ manter smoke/teste GREEN: os codparceiro usados pelos
-- payloads existentes do agregado (1, 2 e 10) DEVEM existir COM FUN='S' (são "cobrador"
-- válido), senão a validação FUN='S' do create/update barraria a criação.
-- codparceiro explícito p/ corresponder aos seeds de ARECEBER (cliente) e aos testes.
INSERT INTO parceiros (codparceiro, razao, fun, tolerancia, codend) VALUES
  (1,  'COBRADOR PADRAO LTDA',          'S', 5, 1),   -- cobrador do smoke (codparceiro=1)
  (2,  'COBRADOR DOIS COMERCIO',        'S', 3, 2),   -- usado por testes (codparceiro=2)
  (10, 'COBRADOR DEZ DISTRIBUIDORA',    'S', 0, 3),   -- usado por testes (codparceiro=10)
  (20, 'CLIENTE ALFA COMERCIO ME',      'N', 5, 4),   -- cliente (NÃO cobrador) p/ ARECEBER
  (21, 'CLIENTE BETA SERVICOS LTDA',    'N', 2, 5),   -- cliente (NÃO cobrador) p/ ARECEBER
  (22, 'CLIENTE GAMA INDUSTRIA SA',     'N', 0, 1)    -- cliente (NÃO cobrador) p/ ARECEBER
ON CONFLICT (codparceiro) DO NOTHING;
SELECT setval('seq_parceiros_codparceiro', (SELECT COALESCE(MAX(codparceiro), 1) FROM parceiros));
