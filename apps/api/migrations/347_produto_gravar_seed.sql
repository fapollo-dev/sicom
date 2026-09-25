-- 347 — o gravar do produto passa a validar como o legado (produto-gravar.ts): NCM existente e vigente, PIS/COFINS fora do Simples,
-- custo diferente de 0… Os três produtos que as migrations semearam na base de desenvolvimento não passariam: os NCMs deles não estão na
-- tabela NCM semeada e eles não têm PIS/COFINS. Entram os NCMs e a tabela 9 (ISENTO — alíquotas zero, sem mexer em nenhum valor
-- calculado). A carga traz os do cliente.
INSERT INTO ncm (codigo, ncmsh, descricao, ipi, vigencia_inicio) VALUES
  (17019900, '17019900', 'Outros açúcares de cana ou de beterraba', '0', DATE '2017-01-01'),
  (22021000, '22021000', 'Águas, incluindo as minerais e as gaseificadas, adicionadas de açúcar', '0', DATE '2017-01-01'),
  (4061010, '04061010', 'Queijo muçarela', '0', DATE '2017-01-01')
ON CONFLICT DO NOTHING;
UPDATE produtos SET pis = 'S', idpiscofins = 9 WHERE idproduto IN (1, 2, 3) AND idpiscofins IS NULL;

-- a configuração que o gravar passa a ler, com o valor e os textos da produção (25/09/2026: 'N'). O ID é o da produção quando livre.
INSERT INTO configuracoes (id, codigo, valor, tipovalor, descricao, valorespossiveis, config_especificas_permitidas, categorias, descricaopequena)
SELECT CASE WHEN EXISTS (SELECT 1 FROM configuracoes WHERE id = 149) THEN (SELECT max(id) + 1 FROM configuracoes) ELSE 149 END,
       'BLOQ_VENDA_MAIOR_CUSTO', 'N', 'String', 'Bloqueia gravar produto com Valor de Venda Maior que Valor de Custo', 'S;N|Sim;Não', 'Modulo;Empresa', 'Produtos', 'Bloqueia Valor de Venda Maior que Valor de Custo'
 WHERE NOT EXISTS (SELECT 1 FROM configuracoes WHERE codigo = 'BLOQ_VENDA_MAIOR_CUSTO');
