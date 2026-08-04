-- 132 — PRODUTO: PROPAGAÇÃO PAI → FILHOS (port do trigger Oracle UPDATE_PRODUTOS_FILHOS, ENABLED).
-- FECHA o último comportamento ATIVO do legado que o cadastro de produto não reproduzia: alterar o produto PAI
-- reescreve nos FILHOS a classificação fiscal e de compra. Sem isso o filho fica com NCM/CEST/alíquota/PIS-COFINS
-- VELHOS e passa a gerar imposto errado na venda e na NF — divergência SILENCIOSA, a pior categoria.
-- Volume no golden: 189 filhos / 85 pais (0,44% de 43.116). Baixo em uso, alto em consequência (é fiscal).
--
-- ESTRUTURA DO TRIGGER LEGADO: `BEFORE UPDATE ON PRODUTOS FOR EACH ROW` com guarda de 25 campos (se NENHUM mudou,
-- não faz nada) e, para cada filho (`IDPRODUTO_PAI = :NEW.IDPRODUTO AND IDPRODUTO <> :NEW.IDPRODUTO`), UM de dois
-- UPDATEs que diferem em EXATAMENTE UM campo:
--   · `DIF_PRECO_PROD_FILHO_X_PAI <> 0` → propaga 24 campos e **PRESERVA o CODGRUPOPRECO do filho** (ele tem
--     preço próprio de propósito, então não pode herdar o grupo de preço do pai);
--   · `= 0` (ou nulo) → propaga os mesmos 24 **+ CODGRUPOPRECO**.
-- É a sutileza que se perde em reimplementação, e é o motivo de `dif_preco_prod_filho_x_pai` ser criada abaixo
-- mesmo estando MORTA no golden (0 de 189): sem o discriminador, um filho com preço próprio teria o grupo de
-- preço sobrescrito em silêncio no dia em que alguém usar o campo.
--
-- COLUNAS: das 25 da guarda, 8 não existiam aqui. Criadas só as VIVAS (disciplina de sempre):
--   aliqope_interna 38.481/43.116 (89%) · coberturamaxima 42.446 (98%) · idtabela 33.132 (77%)
--   codireduzido 36.293 (84%) — populada, mas com UM ÚNICO valor distinto: hoje não carrega informação; entra
--   porque está na propagação e a ausência dela fazia o trigger estourar em runtime (record "new" has no field).
--   + dif_preco_prod_filho_x_pai (0, mas é o discriminador da regra — ver acima).
-- NÃO criadas, mortas no golden → não entram na guarda nem na propagação (cópia-fiel-negativa registrada):
--   codpromotor (3 linhas = 0,007%) · codigo_anp (0) · registro_agrodefesa (0) · precopadraorebaixa (0).
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS aliqope_interna             numeric(13,2),  -- alíquota de operação interna (fiscal)
  ADD COLUMN IF NOT EXISTS coberturamaxima             integer,        -- cobertura máxima de estoque (dias)
  ADD COLUMN IF NOT EXISTS idtabela                    integer,        -- tabela de preço/classificação
  ADD COLUMN IF NOT EXISTS codireduzido                integer,        -- código de imposto reduzido (84%, 1 valor)
  ADD COLUMN IF NOT EXISTS dif_preco_prod_filho_x_pai  numeric(13,2);  -- discriminador dos 2 ramos (morto: 0/189)

-- o cursor do legado varre PRODUTOS por IDPRODUTO_PAI; sem índice isso é seq scan em 43k linhas por save de pai.
CREATE INDEX IF NOT EXISTS ix_produtos_pai ON produtos (idproduto_pai) WHERE idproduto_pai IS NOT NULL;

-- '0', 'N', NULL e qualquer sujeira significam a MESMA coisa numa flag S/N do legado: "não". Sem isso a
-- normalização que o app faz na gravação viraria "mudança" para a guarda (ver o fold [ALTA] abaixo).
CREATE OR REPLACE FUNCTION flag_sn(v text) RETURNS text AS $$
  SELECT CASE WHEN upper(coalesce(v, 'N')) = 'S' THEN 'S' ELSE 'N' END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION fn_produtos_propaga_filhos() RETURNS trigger AS $$
BEGIN
  -- Defensivo: o legado só protege contra AUTO-pai (IDPRODUTO <> :NEW.IDPRODUTO) e não contra CICLO. No golden não
  -- há cadeia nem ciclo (filho-que-é-pai = 0, ciclos = 0, auto-pai = 0), e a guarda de igualdade já faria a
  -- recursão convergir (o 2º passe não encontra diferença); o teto de profundidade é cinto de segurança.
  -- FOLD DA AUDITORIA: o teto era um NO-OP SILENCIOSO — a partir da 6ª geração o filho ficaria com NCM/CEST
  -- velhos sem erro nenhum. Em campo fiscal, truncar calado é o pior resultado: agora estoura.
  IF pg_trigger_depth() > 5 THEN
    RAISE EXCEPTION 'propagação pai→filho: cadeia de produtos com mais de 5 níveis (possível ciclo em idproduto_pai)';
  END IF;

  -- GUARDA — os 25 campos do legado, menos os 4 que não existem aqui por estarem mortos.
  -- DIVERGÊNCIA DELIBERADA E CONSISTENTE: o Oracle usa `<>`, que é NULL (⇒ falso) quando um dos lados é nulo —
  -- logo PREENCHER um NCM antes vazio no pai NÃO propagaria. Aqui é `IS DISTINCT FROM`, então propaga. Mesma
  -- escolha já feita no port de ATUALIZAPROD (trg_multi_preco_preco_alterado, mig 127): num campo FISCAL, deixar
  -- o filho com o valor velho é o pior dos dois resultados.
  -- FOLD DA AUDITORIA [ALTA] — as 5 flags S/N entram na guarda NORMALIZADAS. Motivo: `PRODUTOS.SERVICO` no golden
  -- é **'0' em 33.936 das 43.116 linhas** (e 'N' em 7.415, NULL em 1.753, 'S' em só 12), e o `snFlag()` do schema
  -- coage todo não-'S' para 'N'. Logo o PRIMEIRO save de qualquer produto reescreve servico '0'→'N', a guarda crua
  -- veria mudança e propagaria com ZERO alteração fiscal — 50 dos 85 pais do golden têm SERVICO='0', e 9 filhos
  -- seriam RECLASSIFICADOS em silêncio (um deles de alíquota T03 tributada para IST isenta). O legado não pode
  -- fazer isso: o delta do ClientDataSet só carrega campo alterado e nada em uCadProduto reescreve SERVICO.
  -- Normalizar na GUARDA (e não um backfill na migration) porque a migration roda ANTES da carga de dados no
  -- cutover — um UPDATE aqui seria no-op e a armadilha continuaria de pé.
  IF NOT (
       flag_sn(NEW.servico)          IS DISTINCT FROM flag_sn(OLD.servico)
    OR flag_sn(NEW.servicoatende)    IS DISTINCT FROM flag_sn(OLD.servicoatende)
    OR flag_sn(NEW.imobilizado)      IS DISTINCT FROM flag_sn(OLD.imobilizado)
    OR flag_sn(NEW.realizatroca)     IS DISTINCT FROM flag_sn(OLD.realizatroca)
    OR flag_sn(NEW.cest_obrigatorio) IS DISTINCT FROM flag_sn(OLD.cest_obrigatorio)
    OR NEW.codunidade       IS DISTINCT FROM OLD.codunidade
    OR NEW.ncmsh            IS DISTINCT FROM OLD.ncmsh
    OR NEW.cest             IS DISTINCT FROM OLD.cest
    OR NEW.codfor           IS DISTINCT FROM OLD.codfor
    OR NEW.fatorkg          IS DISTINCT FROM OLD.fatorkg
    OR NEW.fatorcx          IS DISTINCT FROM OLD.fatorcx
    OR NEW.aliquota         IS DISTINCT FROM OLD.aliquota
    OR NEW.codfigurafiscal  IS DISTINCT FROM OLD.codfigurafiscal
    OR NEW.codgrupopreco    IS DISTINCT FROM OLD.codgrupopreco
    OR NEW.aliqope_interna  IS DISTINCT FROM OLD.aliqope_interna
    OR NEW.mva              IS DISTINCT FROM OLD.mva
    OR NEW.codireduzido     IS DISTINCT FROM OLD.codireduzido
    OR NEW.codfcp           IS DISTINCT FROM OLD.codfcp
    OR NEW.coberturamaxima  IS DISTINCT FROM OLD.coberturamaxima
    OR NEW.idpiscofins      IS DISTINCT FROM OLD.idpiscofins
    OR NEW.idtabela         IS DISTINCT FROM OLD.idtabela
  ) THEN
    RETURN NULL;
  END IF;

  -- RAMO A — filho COM diferença de preço própria: herda tudo MENOS o grupo de preço.
  UPDATE produtos f SET
      -- só CODUNIDADE, como o legado: a coluna `unidade` (sigla denormalizada, 020_produtos.sql:44) NÃO está na
      -- SET list dele. Se o pai trocar de unidade, o filho fica com codunidade novo e sigla velha — divergência
      -- do próprio legado, preservada de propósito (2 dos 189 filhos já divergem em codunidade no golden).
      codunidade       = NEW.codunidade,
      ncmsh            = NEW.ncmsh,
      cest             = NEW.cest,
      cest_obrigatorio = NEW.cest_obrigatorio,
      codfor           = NEW.codfor,
      fatorkg          = NEW.fatorkg,
      fatorcx          = NEW.fatorcx,
      aliquota         = NEW.aliquota,
      codfigurafiscal  = NEW.codfigurafiscal,
      aliqope_interna  = NEW.aliqope_interna,
      mva              = NEW.mva,
      codireduzido     = NEW.codireduzido,
      codfcp           = NEW.codfcp,
      coberturamaxima  = NEW.coberturamaxima,
      servicoatende    = NEW.servicoatende,
      imobilizado      = NEW.imobilizado,
      servico          = NEW.servico,
      realizatroca     = NEW.realizatroca,
      idpiscofins      = NEW.idpiscofins,
      idtabela         = NEW.idtabela
   WHERE f.idproduto_pai = NEW.idproduto
     AND f.idproduto    <> NEW.idproduto              -- fiel: nunca a si mesmo
     AND COALESCE(f.dif_preco_prod_filho_x_pai, 0) <> 0;

  -- RAMO B — filho SEM diferença própria: herda tudo, INCLUSIVE o grupo de preço. (É o único ramo vivo hoje.)
  UPDATE produtos f SET
      codunidade       = NEW.codunidade,
      ncmsh            = NEW.ncmsh,
      cest             = NEW.cest,
      cest_obrigatorio = NEW.cest_obrigatorio,
      codfor           = NEW.codfor,
      fatorkg          = NEW.fatorkg,
      fatorcx          = NEW.fatorcx,
      aliquota         = NEW.aliquota,
      codfigurafiscal  = NEW.codfigurafiscal,
      codgrupopreco    = NEW.codgrupopreco,          -- << a ÚNICA diferença entre os dois ramos
      aliqope_interna  = NEW.aliqope_interna,
      mva              = NEW.mva,
      codireduzido     = NEW.codireduzido,
      codfcp           = NEW.codfcp,
      coberturamaxima  = NEW.coberturamaxima,
      servicoatende    = NEW.servicoatende,
      imobilizado      = NEW.imobilizado,
      servico          = NEW.servico,
      realizatroca     = NEW.realizatroca,
      idpiscofins      = NEW.idpiscofins,
      idtabela         = NEW.idtabela
   WHERE f.idproduto_pai = NEW.idproduto
     AND f.idproduto    <> NEW.idproduto
     AND COALESCE(f.dif_preco_prod_filho_x_pai, 0) = 0;

  -- ⚠️ Em trigger AFTER ROW o PostgreSQL IGNORA o retorno, então este NULL é inerte. NÃO converta esta função
  -- para BEFORE: os RETURN NULL passariam a CANCELAR todo UPDATE em produtos e cada save viraria um no-op mudo.
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- AFTER (não BEFORE como o Oracle): lá o `Pragma Autonomous_Transaction` existe para driblar o ORA-04091
-- (mutating table — trigger de linha em PRODUTOS não pode tocar PRODUTOS), e traz o efeito colateral de os
-- filhos ficarem alterados mesmo se a transação do pai der ROLLBACK. É workaround técnico, não regra de negócio:
-- aqui a propagação roda na MESMA transação do pai, então pai e filhos vivem ou morrem juntos.
DROP TRIGGER IF EXISTS trg_produtos_propaga_filhos ON produtos;
CREATE TRIGGER trg_produtos_propaga_filhos
  AFTER UPDATE ON produtos
  FOR EACH ROW
  EXECUTE FUNCTION fn_produtos_propaga_filhos();
