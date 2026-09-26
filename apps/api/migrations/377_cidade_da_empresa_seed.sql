-- 377 — a cidade da empresa do seed na tabela do IBGE.
-- O gravar do cadastro de empresas confere CIDADE + UF contra CIDADES (UCadEmpresa.pas:1324-1332, "Cidade e UF informados para
-- empresa não conferem com  a tabela do IBGE. Verifique"). A empresa 1 do seed (mig 032) é de UBERLANDIA/MG (IBGE 3170206), mas o
-- seed de CIDADES (mig 013) só trazia 4 capitais/cidades — a empresa do seed ficaria impossível de regravar. Na produção a carga traz
-- as CIDADES inteiras (UBERLANDIA/MG existe: conferido em 25/09/2026, só leitura).
INSERT INTO cidades (idcidade, iduf, cidade) VALUES (3170206, 31, 'UBERLANDIA') ON CONFLICT (idcidade) DO NOTHING;
