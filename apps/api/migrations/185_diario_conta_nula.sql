-- 185 — `diario.contacredito`/`contadebito` NOT NULL: o legado permite lançamento sem uma das pernas.
-- Medido: de 888.243 linhas, 26.946 não têm contacredito e 29.475 não têm contadebito (≈3%). São lançamentos
-- reais do razão — não dá para inventar conta contábil nem para descartar 3% do diário. O NOT NULL era nosso.
ALTER TABLE diario ALTER COLUMN contacredito DROP NOT NULL;
ALTER TABLE diario ALTER COLUMN contadebito  DROP NOT NULL;
