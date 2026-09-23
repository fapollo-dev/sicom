-- 298 — AS REGRAS DO EXTRATO (OFX): o que não se importa, e o que se lança sozinho.
-- Adiado na mig 120 ("CONFIG_LANCAMENTO_AUTO_OFX (auto-lançamento)"), achado no inventário completo de tabelas
-- fora do plano. As duas tabelas são de depois do fonte (mai/2020); as regras abaixo saíram do DADO.
-- Oracle de produção (só leitura), 23/09/2026. A importação de OFX está viva: 11.599 linhas em 2026.
--
-- ── 1. `CFG_DESCRICAO_NAO_IMPORTAR_OFX`: descrições que a importação IGNORA ─────────────────────────────
-- 3 linhas, todas da conta 42: 'APL APLIC AUT MAIS', 'RES APLIC AUT MAIS', 'SALDO APLIC AUT MAIS' — a aplicação
-- automática do banco, que entra e sai todo dia e não é movimento da loja. O filtro está ATIVO e é por
-- DESCRIÇÃO EXATA: 'APL'/'RES APLIC AUT MAIS' param de entrar em 30/11/2022 (última importação 03/01/2023) e
-- 'SALDO' em abr/2021, enquanto 'REND PAGO APLIC AUT MAIS' — que CONTÉM o mesmo texto e não está na lista —
-- segue entrando até 2026. "Contém" teria barrado o rendimento; o dado diz igualdade.
--
-- ── 2. `CONFIG_LANCAMENTO_AUTO_OFX`: a linha do extrato que se lança sozinha ──────────────────────────
-- 5.311 regras (conta + descrição). Duas famílias, e só uma com prova de uso:
--   · 'N' (lançamento): 57 regras, 33 ativas — descrição → situação de NF + conta gerencial. **Os 17
--     movimentos carimbados com a regra (`MOV_CONTAS_BANCARIAS.CLAO_ID`), todos de ago/2026, são destas**, e
--     mostram o mecanismo inteiro: cada linha do extrato que casa vira um LOTE com uma linha em `CAIXA` (data da
--     linha, valor com sinal, conta gerencial e situação da regra, obs 'Gerado pela conciliação bancária.',
--     recurso DINHEIRO, cadastrado manualmente) e uma em `MOV_CONTAS_BANCARIAS` (histórico = a descrição,
--     origem 'OFX', CLAO_ID), já CONCILIADA com a linha do extrato; a contabilização da origem 64 pega a CAIXA
--     pela situação. As 9 regras usadas são todas `TIPO_DESCRICAO='1'` e casam por descrição idêntica.
--   · 'T' (transferência): 5.254 regras, quase todas descrições únicas memorizadas ('PIX TRANSF ANA PAU28/11').
--     **Nenhum movimento do cliente foi carimbado por elas** — sem prova do efeito, não se aplicam aqui; ficam
--     carregadas, visíveis, e documentadas como adiadas.
--   `INDR='E'` marca regra excluída (53). `TIPO_DESCRICAO='3'` existe em 2 regras 'T' e nunca foi aplicado.

CREATE TABLE IF NOT EXISTS cfg_descricao_nao_importar_ofx (
  codconta   integer NOT NULL,
  -- ⚠️ igualdade exata (trim, sem distinção de caixa): "contém" barraria o rendimento, que o legado importa
  descricao  varchar(250) NOT NULL,
  PRIMARY KEY (codconta, descricao)
);

CREATE SEQUENCE IF NOT EXISTS seq_config_lancamento_auto_ofx START 10000;
CREATE TABLE IF NOT EXISTS config_lancamento_auto_ofx (
  clao_id                 integer PRIMARY KEY DEFAULT nextval('seq_config_lancamento_auto_ofx'),
  codconta                integer NOT NULL,
  codconta_transferencia  integer,
  clao_descricao          varchar(250) NOT NULL,
  -- N = lançamento (situação + conta gerencial) · T = transferência (sem efeito provado — ver acima)
  clao_tipo               char(1),
  idsituacao_nf           integer,
  codplc                  integer,
  -- 1 = descrição idêntica (as 9 usadas) · nulo = idem, regras antigas · 3 = nunca aplicado
  tipo_descricao          char(1),
  indr                    char(1),
  indr_data               timestamptz,
  indr_usuario            integer
);
ALTER SEQUENCE seq_config_lancamento_auto_ofx OWNED BY config_lancamento_auto_ofx.clao_id;
CREATE INDEX IF NOT EXISTS ix_clao_conta ON config_lancamento_auto_ofx (codconta) WHERE coalesce(indr, ' ') <> 'E';

-- a regra que gerou o movimento (os 17 de ago/2026 vêm com ela)
ALTER TABLE mov_contas_bancarias ADD COLUMN IF NOT EXISTS clao_id integer;

-- `caixa.codcx` não tinha gerador: nenhum fluxo do Apollo gravava na CAIXA até o lançamento automático. A
-- sequência é DONA da coluna para o carregador reposicioná-la no max(codcx) depois da carga
-- (`carregar-cutover.ts`, pg_get_serial_sequence); o START alto só protege o banco antes da primeira carga.
CREATE SEQUENCE IF NOT EXISTS seq_caixa_codcx START 1000000;
ALTER SEQUENCE seq_caixa_codcx OWNED BY caixa.codcx;
ALTER TABLE caixa ALTER COLUMN codcx SET DEFAULT nextval('seq_caixa_codcx');
