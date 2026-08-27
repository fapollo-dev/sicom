-- 182 — `ux_nf_natural` passa a excluir o histórico carregado (§7b + ensaio da F2).
--
-- Medição: 215 notas do golden compartilham a chave natural (nronf, serie, modelo, idempresa, tipoemissao,
-- codparceiro) com outra — e TODAS estão com `CANCELADA='N'`, ou seja são documentos vivos, não lixo. O índice
-- barraria 215 das 23.420 notas na carga.
--
-- Ele NÃO é usado em ON CONFLICT: serve de backstop transacional contra corrida no import
-- (recebimento.service.ts:627 → 23505 vira NF_DUPLICADA). Então dá para estender o predicado sem tocar no app:
-- a proteção continua inteira para NF nova, e o histórico entra como está.
ALTER TABLE nf ADD COLUMN IF NOT EXISTS origem_legado char(1);
COMMENT ON COLUMN nf.origem_legado IS 'S = veio da carga do Oracle (fora do índice de chave natural)';
DROP INDEX IF EXISTS ux_nf_natural;
CREATE UNIQUE INDEX IF NOT EXISTS ux_nf_natural
  ON nf (nronf, serie, modelo, idempresa, tipoemissao, codparceiro)
  WHERE nronf IS NOT NULL AND nronf <> '' AND coalesce(origem_legado, 'N') <> 'S';
