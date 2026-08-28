-- 184 — CAPACIDADE (F3): o legado guarda PALAVRA onde o nosso schema assumiu flag de 1 caractere.
--
-- Medido no golden: `caixa.tiporecurso` tem 'DINHEIRO' (55.559), 'BOLETO' (15.000), 'CARTOES', 'POS',
-- 'CONVENIO' — e a coluna aqui é char(1). Idem `gerado` ('SISTEMA', 100.494 linhas) e `origem`
-- ('FECHAMENTO', 'TRIGGER CAIXA_PAGAR', 'BAIXA CARTAO'…). Nenhuma delas tem lógica no app (a mig 136 as
-- declara como descritivas e só o smoke as escreve), então alargar preserva o significado do dado; truncar
-- para a inicial inventaria um vocabulário que não existe em lugar nenhum.
ALTER TABLE caixa ALTER COLUMN tiporecurso TYPE varchar(20);
ALTER TABLE caixa ALTER COLUMN gerado      TYPE varchar(20);
ALTER TABLE caixa ALTER COLUMN origem      TYPE varchar(30);
ALTER TABLE caixa ALTER COLUMN obs         TYPE varchar(300);
ALTER TABLE mov_contas_bancarias ALTER COLUMN historico TYPE varchar(300);
