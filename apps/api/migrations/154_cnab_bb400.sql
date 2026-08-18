-- 154 — CNAB de cobrança corte-2a: layout BANCO DO BRASIL 400 (detalhe `7` + complemento `5`).
-- Mesmo método do corte-1: layout reconstruído BYTE A BYTE contra o golden (os .REM do Oracle, decodificados do
-- Base64). Estatística dos 1.343 detalhes `7`: convênio 3500121 (100%) · nosso número = convênio + CODRCB(10)
-- em 17 posições (100%) · variação '019' (1.342) · carteira '17' (1.342) · ocorrência '01' (100%) · banco
-- cobrador '001' (100%) · espécie '01' e aceite 'N' (100%) · nome do sacado com o prefixo `CODPARCEIRO - `
-- (1.343/1.343 — a mesma regra que o corte-1 do Itaú) · registro `5` CONSTANTE ('5'+'999'+18 zeros) nos 1.343.
-- O sequencial de 7 dígitos do header (101-107) é o REMESSAS_BOLETOS.CODREMESSABANCO: no golden CB010302.REM
-- traz '0000704' e o log tem codremessabanco=704. Cada banco tem seu contador próprio.
CREATE SEQUENCE IF NOT EXISTS seq_remessa_banco_bb START 705; -- o golden do BB para em 704
