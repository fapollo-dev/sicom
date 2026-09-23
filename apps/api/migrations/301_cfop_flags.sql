-- 301 — AS FLAGS DO CFOP que o conferidor não enxergava (só olha chave/número, e flag fica de fora por desenho).
-- Triagem das 18 colunas do `CFOP` do legado ausentes no destino. Oracle de produção (só leitura), 23/09/2026.
--
-- ── Regra VIVA, ligada aqui ──────────────────────────────────────────────────────────────────────────
--   NAO_GERA_SPED  1 CFOP (2949 — outra entrada não especificada). O SPED do legado só aceita item e cabeçalho
--                  com `COALESCE(C.NAO_GERA_SPED,'N') = 'N'` (`UdmSpedFiscal.dfm:2658`, `:4017`, `:4154`). ~10
--                  notas por ano (R$ 14.862,53 em 2026) entrariam no SPED do Apollo. Filtro aplicado em
--                  `sped-efd-icms-ipi.service.ts`, nos dois níveis.
--
-- ── Carregadas, com o veredito de cada uma ──────────────────────────────────────────────────────────
--   COD_BC_CREDITO   17 CFOPs — a base de crédito do EFD-Contribuições (1102→1 revenda, 1101→2 insumo, 1253→4
--                    energia, 1353→7 frete, 1202/1411→12 devolução). ⚠️ A apuração de PIS/COFINS do Apollo grava
--                    base 1 FIXA; a do legado varia (0, 1, 2, 4, 6, 7). Pelo CFOP reproduz-se só parte (bases 1 e 2,
--                    aproximadas); as 4/6/7 vêm de outras fontes que o fonte de 2020 não mostra. Fica como corte
--                    próprio do épico SPED PIS/COFINS, com os números no dossiê.
--   NAOALIMENTADRE   4 CFOPs (5152, 5557, 5929, 6929 — transferências e lançamento de cupom) fora da DRE. Sem
--                    fonte (a coluna é de depois de 2020). Nenhuma perna das DREs do Apollo lê nota de SAÍDA —
--                    a contábil sai do razão, a de caixa do custo das vendas e do crédito das entradas —, então
--                    não há perna afetada hoje.
--   PRECO_CUSTO      5 CFOPs. Só age ao gerar nota a partir de PEDIDO DE VENDA tipo 7 (`uNF.pas:1616`: item a
--                    custo em vez de venda) — fluxo morto com prova (digitação de pedidos parou em fev/2025).
--   DISPENSADO_COLETA 4 CFOPs (consumo, uso, serviços) dispensados da conferência de COLETA — etapa do app de
--                    conferência (mobile), fora do escopo desta conversão.
--   COMPRA / VENDA   1 CFOP cada (1102 / 5102); TIPOESTADO (DENTRO/FORA, derivável do 1º dígito); TIPO_CFOP (182
--                    em 10 CFOPs de compra); SINTEGRA (S em 376 — o SINTEGRA está bloqueado pela DLL ausente);
--                    CODCONTABIL (2 CFOPs). Classificação sem consumidor no Apollo; carregadas.
--
-- ── Sem efeito, com prova ────────────────────────────────────────────────────────────────────────────
--   CALCULA_PAUTA_ST, DISPENSADO_PEDIDO_COMPRA, ATUALIZA_VENDA_NF, INFORMAIEST, NAO_ATUALIZA_FORN_PROD,
--   FILTRO_PREC_NF, TRANSFERENCIA: 'N' em todos os 398 CFOPs — o comportamento padrão. Não entram.
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS nao_gera_sped     char(1);
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS cod_bc_credito    integer;
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS naoalimentadre    char(1);
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS preco_custo       char(1);
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS dispensado_coleta char(1);
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS compra            char(1);
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS venda             char(1);
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS tipoestado        varchar(10);
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS tipo_cfop         integer;
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS sintegra          char(1);
ALTER TABLE cfop ADD COLUMN IF NOT EXISTS codcontabil       integer;
