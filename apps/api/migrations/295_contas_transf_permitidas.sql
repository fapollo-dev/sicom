-- 295 — TRANSFERÊNCIAS PERMITIDAS ENTRE CONTAS (`CONTAS_BANC_TRANSF_PERM`): de qual conta para qual se pode
-- transferir. Tabela criada no legado em jun/2026 (19 pares, os últimos em 11/08/2026), achada no inventário
-- completo de tabelas fora do plano. Não há fonte: o repositório é de mai/2020 e a tabela é de 2026. A regra
-- abaixo saiu do DADO (Oracle de produção, só leitura, 23/09/2026).
--
-- ── A regra, medida ──────────────────────────────────────────────────────────────────────────────────
-- Transferências (`MOV_CONTAS_BANCARIAS` com `CODCONTA_DESTINO`, perna D) desde jun/2025:
--
--                          dentro da matriz   fora dela
--   antes de 12/06/2026          106              65      ← antes da matriz, 38% dos pares hoje não permitidos
--   12/06 a 10/08/2026            31               4
--   desde 11/08/2026              21               2
--
-- E as 6 transferências "fora" depois da matriz são TODAS da conta 201 → 42 — e a 201 **não aparece como
-- origem** na matriz. Nenhuma transferência saiu de uma conta que está na matriz para um destino que não está.
-- Então: **se a conta de origem tem linhas ATIVAS na matriz, só os destinos listados valem; conta de origem
-- sem linhas fica livre.** É a leitura que o dado sustenta sem exceção; a matriz não é uma lista global.
--
-- ⚠️ Decisão sem prova, registrada: origem com linhas só inativas (`ATIVO='N'`) é tratada como sem matriz
-- (livre). Os 19 pares da produção estão todos em `S`, então o dado não decide esse caso.
--
-- Sem empresa, como no legado (as contas já são da empresa). Sem FK para `contas_bancarias` pela ordem de
-- carga — o serviço valida que as duas contas existem.

CREATE SEQUENCE IF NOT EXISTS seq_contas_banc_transf_perm;
CREATE TABLE IF NOT EXISTS contas_banc_transf_perm (
  codtransfperm     integer PRIMARY KEY DEFAULT nextval('seq_contas_banc_transf_perm'),
  codconta_origem   integer NOT NULL,
  codconta_destino  integer NOT NULL,
  ativo             char(1) NOT NULL DEFAULT 'S',
  dtcadastro        timestamptz DEFAULT now(),
  usultalteracao    integer,
  dtultimalteracao  timestamptz,
  CONSTRAINT ck_contas_transf_perm_ativo CHECK (ativo IN ('S', 'N'))
);
ALTER SEQUENCE seq_contas_banc_transf_perm OWNED BY contas_banc_transf_perm.codtransfperm;
-- o par é a chave do legado
CREATE UNIQUE INDEX IF NOT EXISTS ux_contas_transf_perm ON contas_banc_transf_perm (codconta_origem, codconta_destino);
