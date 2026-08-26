-- 171 — INVENTÁRIO ROTATIVO corte-2: **ZERAR ESTOQUE** pela grade do rotativo
-- (`BtnZerarEstoqueClick` + `ZeraEstoque`, uInvRotativoGrid.pas:146-446). É a parte de DINHEIRO do épico: zera o
-- saldo e deixa rastro em DOIS lugares (a coleta no `inventario_rotativo` e o ajuste em `ajuste_estoque`).
--
-- ⚠️ ACHADO DE CUTOVER: o legado grava `CODMOTIVO = 999` nesses ajustes e **o motivo 999 NÃO EXISTE em
-- `MOTIVOS_OPERACAO`** no golden — mesmo assim **2.638 ajustes** o usam (1.312 deles com `ORIGEM='I'`). No Oracle
-- não há FK que barre; no Apollo `ajuste_estoque.codmotivo` é NOT NULL REFERENCES motivos_operacao, então a carga
-- desses 2.638 quebraria. Criamos a linha 999 para a FK se sustentar, com o nome explicando a origem.
INSERT INTO motivos_operacao (codmotivoop, descricao)
SELECT 999, 'AJUSTE DE INVENTARIO (codigo 999 do legado)'
WHERE NOT EXISTS (SELECT 1 FROM motivos_operacao WHERE codmotivoop = 999);

-- quem liberou o zeramento (o legado grava `CODOPERADOR_LIBERACAO` no ajuste; a nossa tabela não tinha)
ALTER TABLE ajuste_estoque ADD COLUMN IF NOT EXISTS codoperador_liberacao integer;

-- a config de LIBERAÇÃO que o grid consulta (`GetUsuariosPermitidos('USUARIOS_ZERAM_ESTOQUE_INVENTARIO', True)` +
-- `ChamaLiberacaoLogin`): id 46 do golden, valor 'N', whitelist só 'Usuario'. ⚠️ no golden a lista de usuários
-- está **VAZIA** (zero linhas em CONFIGURACOES_ESPECIFICAS) ⇒ hoje NINGUÉM pode zerar, e é assim que o Apollo se
-- comporta: sem grant, recusa. O grant do operador 7 abaixo é seed de smoke, como nas demais migrations.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, obsoleto)
VALUES (46, 'USUARIOS_ZERAM_ESTOQUE_INVENTARIO', 'N', 'String',
        'Define os usuários permitidos a zerar o estoque no inventário rotativo', 'S;N|Sim;Não', 'Usuario', 'F')
ON CONFLICT (id) DO NOTHING;
INSERT INTO configuracoes_especificas (id, tipo, chave, valor)
SELECT 46, 'Usuario', '7', 'S'
WHERE NOT EXISTS (SELECT 1 FROM configuracoes_especificas WHERE id = 46 AND tipo = 'Usuario' AND chave = '7');
