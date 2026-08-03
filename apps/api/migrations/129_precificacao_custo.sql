-- 129 — PRECIFICAÇÃO DE MERCADORIAS (FRMPRIFICACAOCUSTO — UPrificacaoCusto, caption "Precificação de Mercadorias").
-- RECON DERRUBOU A PREMISSA: NÃO é tela de reprecificação em massa — é o **editor de preço por PRODUTO × EMPRESA**
-- (um produto por vez; a tela de massa por filtro é outra unit, uPrecificacaoProdutos). O conteúdo real é o PAINEL
-- DE DERIVAÇÃO: componentes de custo → 3 BASES de custo → PMZ + preço SUGERIDO → escada de margem.
-- 3 BASES (CalcValorCusto, UPrificacaoCusto.pas:1426-1458):
--   VRCUSTOREAL = custo − PIS/COFINS-crédito − ICMS-crédito + ICMST + FCPST + IPI + FRETE + SEGURO + DESPAC
--                 + custo×FRETE2% + AJUSTE            (custo LÍQUIDO: créditos DEDUZEM)
--   VRCUSTOREP  = custo + (IPI+FRETE+SEGURO+DESPAC+ICMST+FCPST+custo×FRETE2%+AJUSTE) − BONIFICAÇÃO  (reposição)
--   VRCUSTOCSI  = VRCUSTOREP − ICMS-crédito − PIS/COFINS-crédito   ← BASE do markup/PMZ no modo 'P'
-- SEMÂNTICA (fold do recon): ICME/IPI/FRETE/SEGURO/FRETE2 são **%** do VRCUSTO; ICMST/FCPST/DESPAC/AJUSTE/
-- BONIFICAÇÃO são **VALORES**. Créditos só p/ Lucro Real (CLASSFISCAL='LR') e ICMS só se ALIQUOTA começa com 'T'.
-- O preço SUGERIDO usa o motor fiscal já migrado (preco-fiscal.precoAtual, TIPO_PRECIFICACAO='P' + margem 'F' com
-- IRPJ/CSLL — valores VIVOS do tenant); PMZ e a escada reusam pmz()/margemLiquida(). Guardas do legado: NÃO existe
-- trava preço<custo nem preço<PMZ (não inventar). ADIADO: atacarejo (6 linhas no tenant, máx 1 tier) · sinc-custo-
-- na-venda (reescreve VENDAS histórico) · modo '2 CLIQUES' + MARKUPFIXO/senha-ADM (vêm do ConfigDB.xml da estação,
-- ausente) · tela de sincronização campo-a-campo (config 'N' = cópia-fiel-negativa) · preço-filho (golden-vazio).

-- PRECONF da empresa ('L' = a tela abre em modo LOTE; 'O' = on-line — valor VIVO nas 4 empresas do tenant).
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS preconf char(1) DEFAULT 'O';

-- componentes de custo (% ou valor) + derivados + escada de margem, por (produto, empresa).
ALTER TABLE multi_preco
  ADD COLUMN IF NOT EXISTS vrcustoreal      numeric(15,4),  -- custo líquido (créditos deduzidos)
  ADD COLUMN IF NOT EXISTS vrcustocsi       numeric(15,4),  -- base do markup/PMZ (REP − créditos)
  ADD COLUMN IF NOT EXISTS vrvendasug       numeric(15,4),  -- preço SUGERIDO (motor fiscal) — sugestão, não aplica
  ADD COLUMN IF NOT EXISTS pmz              numeric(15,4),  -- preço de margem zero
  ADD COLUMN IF NOT EXISTS markupfixo       numeric(15,4),  -- teto (só usado pelo bloqueio do ConfigDB.xml, adiado)
  ADD COLUMN IF NOT EXISTS icme             numeric(13,4),  -- % crédito de ICMS na entrada
  ADD COLUMN IF NOT EXISTS ipi              numeric(13,4),  -- %
  ADD COLUMN IF NOT EXISTS frete            numeric(13,4),  -- %
  ADD COLUMN IF NOT EXISTS frete2           numeric(13,4),  -- %
  ADD COLUMN IF NOT EXISTS seguro           numeric(13,4),  -- %
  ADD COLUMN IF NOT EXISTS icmst            numeric(15,4),  -- VALOR
  ADD COLUMN IF NOT EXISTS vrfcpst          numeric(15,4),  -- VALOR
  ADD COLUMN IF NOT EXISTS despacessorio    numeric(15,4),  -- VALOR
  ADD COLUMN IF NOT EXISTS vrcustoajuste    numeric(15,4),  -- VALOR
  ADD COLUMN IF NOT EXISTS bonificacao      numeric(15,4),  -- VALOR (só deduz do REP)
  ADD COLUMN IF NOT EXISTS fcp_saida        numeric(13,4),  -- % FCP de SAÍDA (fold auditoria): entra no PMZ e no
                                                            -- débito de ICMS da escada, mas NÃO no preço sugerido
                                                            -- (o legado chama CalculaValorVenda sem o FCP, :1479)
  ADD COLUMN IF NOT EXISTS creditoicm       numeric(15,4),
  ADD COLUMN IF NOT EXISTS creditopiscofins numeric(15,4),
  ADD COLUMN IF NOT EXISTS debitoicm        numeric(15,4),
  ADD COLUMN IF NOT EXISTS debitopiscofins  numeric(15,4),
  ADD COLUMN IF NOT EXISTS vendaliq         numeric(15,4),
  ADD COLUMN IF NOT EXISTS lucrobrutov      numeric(15,4),
  ADD COLUMN IF NOT EXISTS lucrobrutop      numeric(13,4),
  ADD COLUMN IF NOT EXISTS despopv          numeric(15,4),
  ADD COLUMN IF NOT EXISTS lucroliqv        numeric(15,4),
  ADD COLUMN IF NOT EXISTS lucroliqp        numeric(13,4),
  ADD COLUMN IF NOT EXISTS imprend          numeric(15,4),
  ADD COLUMN IF NOT EXISTS contsocial       numeric(15,4),
  ADD COLUMN IF NOT EXISTS margeml2         numeric(13,4),
  ADD COLUMN IF NOT EXISTS margeml2v        numeric(15,4);

-- config do modo de precificação (TIPO_PRECIFICACAO / MARGEM_PRECO_FINAL_OU_LIQUIDO) — valores VIVOS do tenant
-- (overrides Modulo/Retaguarda no Oracle: 'P' e 'F'). 'P' = gross-up fiscal (o ramo else de TMargemPreco).
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (901, 'TIPO_PRECIFICACAO', 'P', 'D/M/P', 'Modulo;Empresa', 'Modo do cálculo do preço sugerido: D = custo+custo×margem; M = (custo/(100−margem))×100; P/outro = gross-up FISCAL (TMargemPreco ramo else). Golden: P.'),
  (902, 'MARGEM_PRECO_FINAL_OU_LIQUIDO', 'F', 'F/L', 'Modulo;Empresa', 'No gross-up fiscal: F = margem sobre o preço FINAL (embute IRPJ/CSLL, uMargemPreco.pas:151); L = líquido. Golden: F.')
ON CONFLICT (id) DO NOTHING;

-- RBAC por-controle (o legado usa PossuiAcessoForm(form, controle) — 7 opções reais no Oracle).
INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMPRIFICACAOCUSTO', 'BTNGRAVAR',   7, 1),
  ('FRMPRIFICACAOCUSTO', 'BTNGRAVAR',   7, 2),
  ('FRMPRIFICACAOCUSTO', 'EDTVRVENDA',  7, 1),
  ('FRMPRIFICACAOCUSTO', 'EDTVRVENDA',  7, 2),
  ('FRMPRIFICACAOCUSTO', 'CHATIVO',     7, 1)
ON CONFLICT DO NOTHING;
