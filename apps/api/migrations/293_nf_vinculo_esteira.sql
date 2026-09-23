-- 293 — o vínculo da nota com a ESTEIRA, que ficou para trás esperando a mig 292.
-- Na mig 286 eu deixei `codnfstatuspro` fora da `nf` com a justificativa escrita no conferidor:
-- "FK para NF_STATUS_PROCESSO, que ainda não tem destino — entra com ela". A esteira ganhou destino na
-- mig 292; a promessa vence aqui. Contagens no Oracle de produção (só leitura), 23/09/2026.
--
-- ── O vínculo existe e é íntegro ─────────────────────────────────────────────────────────────────────
--   `NF.CODNFSTATUSPRO`                  42.065 preenchidos, **42.065 casam** com uma linha da esteira
--   `NFE_NAO_CADASTRADAS.CODNFSTATUSPRO` 43.872 preenchidos, **43.872 casam**
--
-- ── ⚠️ Ele NÃO aponta a esteira: aponta UMA ETAPA — é o CURSOR, e o cursor atrasa ────────────────────
-- A coluna guarda o `codnfstatuspro` de uma das dez linhas da esteira da nota. Comparado com a etapa
-- realizada mais alta da própria chave:
--                                       nf        nfe_nao_cadastradas
--   é a etapa realizada mais alta     40.732 (96,8%)   42.592
--   etapa ANTERIOR à mais alta         1.321            1.258   ← o cursor não foi avançado
--   etapa POSTERIOR à mais alta            2               16
--   chave sem etapa realizada              3                0
--   aponta a etapa de OUTRA chave          7                6
--
-- Por isso a tela da esteira (mig 292) calcula "parada em" a partir das DEZ LINHAS, e não deste ponteiro:
-- em 1.321 notas o ponteiro diria que a nota está atrás de onde de fato está. A coluna vem como o legado a
-- gravou — fidelidade do dado —, mas não é a fonte da verdade sobre o estado da nota.
--
-- ── Sem FK, pela ordem de carga ──────────────────────────────────────────────────────────────────────
-- No `plano-tabelas.json`, `nfe_nao_cadastradas` carrega na f0 e a esteira na f2 — uma FK recusaria cada
-- linha por apontar uma etapa que ainda não chegou. `nf` divide a f2 com a esteira; forçar a FK obrigaria a
-- replanejar a carga da nota e de tudo que depende dela, para garantir um vínculo que já está medido acima.
ALTER TABLE nf ADD COLUMN IF NOT EXISTS codnfstatuspro integer;
ALTER TABLE nfe_nao_cadastradas ADD COLUMN IF NOT EXISTS codnfstatuspro integer;
CREATE INDEX IF NOT EXISTS ix_nf_codnfstatuspro ON nf (codnfstatuspro) WHERE codnfstatuspro IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_nfe_nao_cad_codnfstatuspro ON nfe_nao_cadastradas (codnfstatuspro)
  WHERE codnfstatuspro IS NOT NULL;
