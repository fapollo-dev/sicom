-- 149 — MANIFESTO DO DFe corte 2: a integração SEFAZ (distribuição DF-e + manifestação do destinatário).
--
-- 1) EMPRESAS.ULTIMO_NSU — o cursor da distribuição DF-e. No legado vive EXATAMENTE aqui
--    (GetUltimoNSU lê EMPRESAS.ULTIMO_NSU); a cada lote processado o serviço grava o maior NSU devolvido.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ultimo_nsu varchar(20);

-- 2) Certificado digital A1 — no legado o certificado vem do repositório do Windows (WinCrypt, por CNPJ);
--    aqui é ARQUIVO + SENHA por empresa, via a camada de configurações chave-valor:
--    · .pfx  → suficiente p/ a DISTRIBUIÇÃO (TLS mútuo — o Node aceita pfx nativo);
--    · .pem  → NECESSÁRIO p/ MANIFESTAR (a assinatura XML usa a chave privada; converter uma vez com
--      `openssl pkcs12 -in cert.pfx -out cert.pem -nodes`). O serviço aceita os dois e explica o que falta.
--    O AMBIENTE (1=produção/2=homologação) já existe: EMPRESAS.AMBIENTE (mig 032).
INSERT INTO configuracoes (id, codigo, valor, tipovalor, config_especificas_permitidas, descricao) VALUES
  (905, 'CERTIFICADO_A1_ARQUIVO', '', 'TEXTO', 'Empresa', 'Caminho do certificado digital A1 no servidor (.pfx para a distribuição DF-e; .pem — chave+cert — para assinar a manifestação). Por empresa.'),
  (906, 'CERTIFICADO_A1_SENHA',   '', 'TEXTO', 'Empresa', 'Senha do certificado A1 (.pfx). Por empresa.')
ON CONFLICT (id) DO NOTHING;
