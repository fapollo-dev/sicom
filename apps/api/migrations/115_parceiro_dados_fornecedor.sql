-- 115 — PARCEIROS aba "Dados Fornecedor" (tbsDadosFornecedor do uCadClientes): 28 campos FLAT na master
-- `parceiros` (contatos de PAPEL FIXO diretor/gerente/vendedor/financeiro/logístico + config comercial do
-- fornecedor). São data-bound de dtsPrincipal (colunas do próprio parceiro, NÃO grid) — captura pura, sem
-- validação no legado (só máscaras de UI). Todos nullable no golden. Nomes/tipos espelham Oracle PARCEIROS.
-- (A grid repetível de "contatos" já é `parceiros_rel` — mig anterior; estas são os responsáveis de papel fixo.)
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS codcomprador                 integer;
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS diretor_comercial            varchar(150);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS email_diretor_comercial      varchar(150);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS fone_diretor_comercial       varchar(20);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS gerente_comercial            varchar(150);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS email_gerente_comercial      varchar(150);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS fone_gerente_comercial       varchar(20);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS vendedor_representante       varchar(150);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS email_vendedor_representante varchar(150);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS fone_vendedor_representante  varchar(20);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS responsavel_financeiro       varchar(150);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS email_responsavel_financeiro varchar(150);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS fone_responsavel_financeiro  varchar(20);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS responsavel_logistico        varchar(150);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS email_responsavel_logistico  varchar(150);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS fone_responsavel_logistico   varchar(150);  -- 150 no Oracle (não 20)
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS caracteristica_tributaria    varchar(150);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS pronta_entrega               char(1);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS desconto_pedidos             numeric(13,2);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS valor_acres_fin              numeric(13,2);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS numero_contrato              integer;
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS regras_tabela_fornecedor     varchar(150);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS prazo_entrega                integer;
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS prazo_recebimento            integer;
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS prazo_reposicao              integer;
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS tipo_fornecedor              varchar(150);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS retira_fornindex             char(1);
ALTER TABLE parceiros ADD COLUMN IF NOT EXISTS realiza_troca                char(1);
