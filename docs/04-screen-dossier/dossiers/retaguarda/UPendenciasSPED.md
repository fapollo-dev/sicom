# Pendências SPED — o pré-validador (`TFrmPendenciasSPED`, `UPendenciasSPED.pas`)

> Fonte: `UPendenciasSPED.pas` (1.218 linhas) + `.dfm`; os chamadores `Uspedfiscal.pas:4362` (PreValidador, depois do
> PreProcessamento), `UspedPisCofins.pas:2523` (PreValidadorSPED) e `UCadProduto.pas:7177` ("Verificar NCM dos produtos ativos" →
> `uMenuSuperior.VerificaNCM`). Produção (só leitura, 09/10/2026, set/2026): loja 1 — 2 operadoras de cartão sem administradora
> (VISA VOUCHER e MASTERCARD VOUCH, CODREDE 5), a administradora BANCO BRADESCO SA sem CNPJ, 1 fornecedor de nota com a cidade fora da
> tabela; loja 2 — as mesmas de cartão; 18 produtos ativos com NCM inválido (ATIVO_PELA_MULTIPRECO = 'N' → pelo PRODUTOS.ATIVO).
> Apollo: `POST fiscal/sped/pendencias`, `GET cadastro/produtos/ncm/invalidos`, `PendenciasSpedModal`; smoke §307, jsdom
> `spedFiscal.spec.tsx`.

## O que a tela faz

A grade "Pendências SPED" (Descrição da pendência · Código · Descrição · Complemento só na verificação de NCM), o rodapé
"Quantidade de registros: N", **Corrigir** (ou o duplo clique: abre o cadastro do registro por cima — `AbreTela` — e, corrigido,
refaz a análise; vazia, fecha), **&Exportar** (a grade em planilha) e **&Sair**. Não bloqueia: no SPED o `ShowModal` volta e a
geração segue.

## As análises (`AnalisaPendencias`, :367-390), na loja do login e no período

| Pendência | SPED | Regra | Corrigir |
|---|---|---|---|
| PARCEIRO NÃO VINCULADO NO CADASTRO DO CARTÃO | Fiscal | GET_CARTAO (os cartões ainda não liberados) com CODADM = 0 no período — **sem filtro de loja** (o SQL não usa a empresa) | a operadora |
| CNPJ DO PARCEIRO(ADMINISTRADORA) INVÁLIDO | Fiscal | a administradora dos cartões da loja com endereço sem CNPJ | ⚠️ o legado abria o cadastro de OPERADORAS com o código do PARCEIRO (o registro errado); o Apollo abre o parceiro |
| CFOP não possui a conta contábil informada | PIS/COFINS | o CFOP dos itens e dos cabeçalhos das notas do período e os seis do cupom (5101/5102/5403/5405/5656/5667) sem CODPLANOCONTAS | o CFOP |
| IDPISCOFINS NÃO INFORMADO… / IDBASECREDITOISENTO NÃO VINCULADO AO IDPISCOFINS | PIS/COFINS | o produto vendido (cupom) e faturado (NF de saída) pelas lojas do mesmo CNPJ raiz, CST de PIS de saída 04/05/06/08/09, sem a base de crédito da isenção (a do produto se for da situação dele, senão a 1ª da situação; CST 08 sem nenhuma → 999). Na NF o CST vem do CFOP (5927/5929 → 08; os de venda e os do PC_CONFIG → o da situação; os outros → 08). O "IDPISCOFINS NÃO INFORMADO" é ramo morto (o filtro já exige o CST) | o produto |
| NFE LANÇADA NÃO POSSUI CHAVE DE ACESSO. | os dois | NF-e/CT-e (55/57) processada e numerada sem chave | a nota |
| PARCEIRO COM CNPJ_CPF INVALIDO NO ENDEREÇO REF. NA NFE / …NO ENDEREÇO ATIVO DO PARCEIRO | os dois | o participante sem CNPJ/CPF (menos "AO CONSUMIDOR"): o cliente/fornecedor/transportadora das notas que entram no SPED (o endereço DA NOTA) e a administradora dos cartões da loja (o endereço ATIVO) | o parceiro |
| CÓDIGO DO MUNICIPIO INVÁLIDO | os dois | a cidade do endereço não está na tabela de cidades da UF | o parceiro |
| PARCEIRO SEM ENDEREÇO ATIVO | os dois | a administradora sem endereço ativo | o parceiro |
| (NCM) — o motivo | Verificar NCM | o produto ativo com NCM fora de 8 caracteres, vazio, fora da tabela NCM, vencido ou ainda não vigente; o código é o de barras, o complemento o NCM | o produto |

## Diferenças conscientes

- A NFAUXSPED/VENDASAUXSPED do legado (as cópias que o pré-processamento grava) entra direto na consulta — no SPED PIS/COFINS o
  pré-validador do legado roda ANTES do `PreparaGeracaoSPED` e lê as tabelas auxiliares da geração anterior.
- O ramo das NFC-e dos participantes (`chkGerarNFCParticipante`) fica de fora: a NFC-e é do PDV.
- O "Corrigido?" de cada tipo vira a análise inteira refeita (o do produto sem base de crédito quebrava no legado: concatenava
  `AND CODPRODUTO = …` depois do `ORDER BY`).
- A operadora de cartão (tela que não é cadastro-base) abre em outra aba; o Exportar sai em CSV (o Excel abre).
- 🪦 `AnalisaNCMProdutosDll` (a validação do NCM pela `SIntegra32Dll.DLL`) é do Sintegra, adiado (FILA item 97).
