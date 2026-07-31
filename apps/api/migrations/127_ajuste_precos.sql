-- 127 — AJUSTE DE PREÇOS - LOTE (FRMAJUSTEPRECOS — uAjustePrecos): o PROCESSADOR da fila LOTEPRECO. As telas de
-- origem (cadastro do produto, pedido de compra p/ outras empresas, precificação de NF, preço-filho) PROPÕEM o
-- preço (INSERT com PROCESSADO='N'); esta tela lista os pendentes e «Processar» APLICA no MULTI_PRECO — por
-- empresa do lote, com PROPAGAÇÃO por GRUPO DE PREÇO (CODGRUPOPRECO — viva: 8.968 produtos no golden) + log em
-- HISTORICO_DINAMICO + marca do lote. NENHUM cálculo aqui (sem % em massa, sem arredondamento .X9, sem trava
-- preço<custo — NÃO existem no legado; o VRVENDA chega pronto). Golden: 66.409 lotes (46k pedido/16k cadastro/3k
-- NF), 1.471 pendentes, vivo até 2026-05. ADIADO: braço ATACAREJO (1+6 linhas = morto), motor preço-FILHO
-- (DIF_PRECO: 0 configurados), tabela de preço PRECO (2 linhas, tela própria), botão Etiquetas (corte-2 integra o
-- módulo etiqueta), relatório preços-alterados, emissão de lote nas origens (corte-2).
-- DIVERGÊNCIAS CONSCIENTES (medidas no Oracle): (a) propagação exige CODGRUPOPRECO>0 — no legado o guard é
-- Trim()<>'' e um grupo "0" propagaria; em PINHEIRAO **não existe codgrupopreco=0** (0 de 8.968) → inerte aqui,
-- mas noutros tenants (ZAGO 68/68 em 0) o legado propagaria e o novo não: o lado CONSERVADOR (nunca
-- super-propagar preço) é o escolhido. (b) a fila é por-empresa do login; a fila real do golden abrange 4 empresas
-- (emp2=813, emp51=235, emp1=197, emp50=150 pendentes) → cada sessão vê a sua fatia (revisitar no corte de emissão).

CREATE SEQUENCE IF NOT EXISTS seq_lote_preco;
CREATE TABLE IF NOT EXISTS lote_preco (
  codlotepreco        bigint PRIMARY KEY DEFAULT nextval('seq_lote_preco'),
  idproduto           integer NOT NULL REFERENCES produtos(idproduto),
  codempresa          integer NOT NULL,               -- empresa ALVO do lote (o UPDATE respeita IDEMPRESA=CODEMPRESA)
  vrvenda             numeric(15,4),                  -- preço NOVO proposto (aplica só se > 0, fiel)
  markup              numeric(15,4),                  -- aplica só se > 0 (fiel)
  promocao            char(1),                        -- proposta de promo (aplica só se ALTEROUPROMOCAO='S')
  vrpromo             numeric(15,4),
  alteroupromocao     char(1) DEFAULT 'N',
  datalote            timestamptz DEFAULT now(),
  obs                 varchar(300),                   -- origem textual (REFERENTE AO AJUSTE NO CADASTRO... / AO PEDIDO...)
  origem              varchar(50),
  codoperador         integer,
  processado          char(1) DEFAULT 'N',
  processado_data     timestamptz,
  processado_operador integer,
  processado_manual   char(1),
  indr                char(1),                        -- 'E' = excluído (soft, fiel ao btnExcluir)
  indr_usuario        integer,
  indr_data           timestamptz,
  dtcadastro          timestamptz DEFAULT now()
);
ALTER SEQUENCE seq_lote_preco OWNED BY lote_preco.codlotepreco;
CREATE INDEX IF NOT EXISTS ix_lote_preco_fila ON lote_preco (codempresa, processado, datalote);
-- índice da PROPAGAÇÃO por grupo de preço (fold auditoria: a query do grupo fazia seq-scan em produtos por lote).
CREATE INDEX IF NOT EXISTS ix_produtos_codgrupopreco ON produtos (codgrupopreco) WHERE codgrupopreco IS NOT NULL;

-- TRIGGER fiel ao ATUALIZAPROD do Oracle (BEFORE UPDATE ON MULTI_PRECO): preço/promo mudou → carimba
-- DTULTPRECOALTERADO e RESETA ETQ_IMPRESSA='N' (a etiqueta precisa ser reimpressa). Único trigger do schema:
-- justificado porque O PRÓPRIO legado implementa esta regra como trigger. UPDATE que não toca preço (ex.: etiqueta
-- marcando etq_impressa='S') NÃO dispara o reset (IS DISTINCT FROM).
-- ESCOPO REAL (fold auditoria — a claim anterior de "cobre TODOS os writers" era FALSA): cobre os writers que fazem
-- UPDATE (ajuste-lote, pedido-compra, agenda-promoção/scheduler). NÃO cobre o agregado de PRODUTO, que substitui o
-- detalhe multi_preco por DELETE+INSERT — lá a preservação de etq_impressa/dtultprecoalterado/codagenda é feita via
-- `preservar` na config do agregado (produto.aggregate). DELTAS vs o Oracle (documentados): (a) sem ATACAREJO_ATIVO
-- (coluna inexistente; braço atacarejo morto: 1+6 linhas); (b) o legado não seta DTULTIMALTERACAO aqui porque
-- multi_preco no app novo não tem essa coluna; (c) o Oracle usa `<>` (NULL ⇒ resultado NULL ⇒ NÃO reseta quando um
-- dos lados é NULL); aqui `IS DISTINCT FROM` reseta também nesse caso — divergência CONSCIENTE e mais segura
-- (preço que sai de/para NULL é mudança de preço e a etiqueta deve ser reimpressa).
CREATE OR REPLACE FUNCTION fn_multi_preco_preco_alterado() RETURNS trigger AS $$
BEGIN
  IF (NEW.vrvenda IS DISTINCT FROM OLD.vrvenda)
     OR (NEW.vrpromo IS DISTINCT FROM OLD.vrpromo)
     OR (NEW.promocao IS DISTINCT FROM OLD.promocao) THEN
    NEW.dtultprecoalterado := now();
    NEW.etq_impressa := 'N';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_multi_preco_preco_alterado ON multi_preco;
CREATE TRIGGER trg_multi_preco_preco_alterado BEFORE UPDATE ON multi_preco
  FOR EACH ROW EXECUTE FUNCTION fn_multi_preco_preco_alterado();

-- RBAC (operador 7, empresas 1+2).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMAJUSTEPRECOS', 'BTNGRAVAR',  7, 1),
  ('FRMAJUSTEPRECOS', 'BTNGRAVAR',  7, 2),
  ('FRMAJUSTEPRECOS', 'BTNEXCLUIR', 7, 1),
  ('FRMAJUSTEPRECOS', 'BTNEXCLUIR', 7, 2)
ON CONFLICT DO NOTHING;
