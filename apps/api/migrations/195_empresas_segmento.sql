-- 195 — `empresas.segmento`: a coluna que decide se "marcar todos" concede as telas de INDÚSTRIA.
--
-- `uCtrlPermissoes.pas:478-493` (btnMarcarTodosFormClick) lê `EMPRESAS.SEGMENTO` e, quando a empresa **não** é
-- `'INDUSTRIA'`, filtra fora os formulários filhos do menu "INDÚSTRIA" antes de marcar tudo — ou seja, marcar
-- todos nunca dá as telas industriais a um supermercado. A coluna existe no legado e não existia aqui, então a
-- regra não tinha como ser copiada (e a carga descartaria o valor).
--
-- Sem default: quem manda é o dado do cliente. Ausente ⇒ tratado como NÃO industrial, que é o caso do varejo.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS segmento varchar(20);
