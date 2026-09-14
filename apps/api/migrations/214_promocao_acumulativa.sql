-- 214 — PROMOÇÃO ACUMULATIVA (`FRMCADPROMOCAOACUMULATIVA`). 199 acessos, **26 operadores** — o maior número
-- de operadores do que restava na fila.
--
-- "Leve N, pague menos": o cliente acumula QTDE unidades do produto no cupom e o preço cai DESCONTO. A tela
-- é o cadastro dessas regras; quem as aplica é o PDV, que está fora de escopo.
--
-- ⚠️ **`IDEMPRESA` é uma LISTA, não um inteiro.** É `VARCHAR2(30)` no legado, no formato `;1;2;` — com
-- ponto-e-vírgula na frente e atrás, normalizado pelo próprio `ValidaEmpresas:485`. Uma promoção vale para
-- várias lojas ao mesmo tempo, e as validações de sobreposição comparam empresa a empresa procurando
-- `;n;` dentro da string. Copiado como está: transformar em tabela-filha agora quebraria a carga e a
-- comparação que o PDV faz.
--
-- Uso real medido na produção em 14/09/2026: **6 promoções em toda a história**, de 03/10/2020 a 18/09/2024,
-- 1 delas por grupo de preço e 1 marcada como atacarejo. A tela é muito mais consultada que alimentada — os
-- 199 acessos são gente abrindo para conferir, não para cadastrar.
CREATE TABLE IF NOT EXISTS promocao_acumulativa (
  idproacumulativa  integer PRIMARY KEY,
  idproduto         integer REFERENCES produtos (idproduto),
  qtde              numeric(13,4),
  desconto          numeric(15,4),
  -- a lista de lojas, no formato `;1;2;`
  idempresa         varchar(30),
  dtini             timestamp,
  dtfim             timestamp,
  atacarejo         char(1) DEFAULT 'N',
  codgrupopreco     integer,
  -- auditoria: o legado grava USUINCLUSAO num UPDATE separado, logo após o insert (`InserirUsuario:181`)
  usuinclusao       integer,
  usultalteracao    integer,
  dtcadastro        timestamp DEFAULT now(),
  dtultimalteracao  timestamp
);

CREATE INDEX IF NOT EXISTS ix_promo_acum_produto ON promocao_acumulativa (idproduto);
CREATE INDEX IF NOT EXISTS ix_promo_acum_periodo ON promocao_acumulativa (dtini, dtfim);
CREATE INDEX IF NOT EXISTS ix_promo_acum_grupopreco ON promocao_acumulativa (codgrupopreco)
  WHERE codgrupopreco IS NOT NULL AND codgrupopreco <> 0;

-- RBAC: o legado concede só o gate da tela; a exclusão é botão próprio no form, sem permissão separada.
INSERT INTO permissoes (form, opcao, codoperador, codempresa)
VALUES ('FRMCADPROMOCAOACUMULATIVA', 'FRMCADPROMOCAOACUMULATIVA', 7, 1)
ON CONFLICT DO NOTHING;
