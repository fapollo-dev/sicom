-- 259 — EXPORTAÇÃO DE NF-e (`FRMEXPORTANFE`, `uExportaNFe.pas` 687 linhas). **15 acessos, 2 operadores.**
--
-- Lista as notas fiscais eletrônicas do período e, para as selecionadas, salva o **XML** (`SalvaXMLNFe`, um
-- arquivo `<chave>-NFe.xml` por nota) e/ou o **DANFE em PDF** numa pasta; também reenvia e cancela pela mesma
-- grade. No cliente: **43.185 XMLs** guardados (`NFE_XML`) e 747 NF-e modelo 55 emitidas em 2026 (711 com chave).
--
-- Aqui: a lista das notas eletrônicas do período (com chave, status SEFAZ e se há XML guardado) e o XML de
-- cada nota, lido de `nfe_xml` (o Apollo já o guarda na transmissão e no recebimento). Folds: o DANFE em PDF
-- não existe no Apollo (não há renderizador) — fica de fora; transmitir/cancelar/CC-e já são a `fiscal/nf`.

CREATE INDEX IF NOT EXISTS ix_nf_emp_tipo_emissao ON nf (idempresa, tipo, dtemissao);

INSERT INTO permissoes (form, opcao, codoperador, codempresa) VALUES
  ('FRMEXPORTANFE', 'FRMEXPORTANFE', 7, 1)
ON CONFLICT DO NOTHING;
