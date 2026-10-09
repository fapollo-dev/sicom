# Precificação de Mercadorias — `FRMPRIFICACAOCUSTO` (`UPrificacaoCusto.pas`)

> Fonte: `UPrificacaoCusto.pas` (2.509 linhas) + `.dfm`, `udmCadProduto` (cdsMultiPreco/cdsEmpresa/`SetaMulti_Preco`), `uMargemPreco`,
> `UAtualizacaoPrecoFilho`. Produção (só leitura, 09/10/2026): 3.346 acessos; em 2025-26 o HISTORICO_DINAMICO da tela mostra o que ela
> muda — VRVENDASUG 7.118, VRCUSTOCSI 6.987, VRVENDA 4.438 (+1.574 com o título da tela), VRCUSTOAJUSTE 1.299, ICMST 764,
> **ATACAREJO_ATIVO 400**, DESPACESSORIO 374, VRCUSTO 314, ICME 187, MARKUP 184, IPI 171, **ATIVO 152, ATIVO_COMPRA 107**, VRFCPST 91,
> FRETE/SEGURO/FRETE2/BONIFICACAO, PROMOCAO 23, **MARKUPFIXO 6**, VRPROMO 3. Apollo: `precificacao/custo`, tela `/precificacao/custo`,
> smoke §47l, §218.1, §301, §302, §303; jsdom `precificacaoCusto.spec.tsx`, `cadMasterHistorico.spec.tsx`.

Inventário completo do legado × Apollo feito em 09/10/2026 (campo a campo, botão a botão, com as linhas do fonte). Abaixo, o que o
corte 2 fez e o que fica.

## O que a tela faz

A linha de preço (MULTI_PRECO) de um produto numa loja: os componentes do custo (custo, IPI/frete/seguro/frete não incluso em %,
ICMS-ST/FCP-ST/desp. acessórias/ajuste em R$, bonificação), os impostos de entrada (crédito de ICMS; crédito de PIS/COFINS **só do
Lucro Real**, :1401 — corrigido; latente aqui, porque o destino só aceita LR e SN no CLASSFISCAL) e de saída (ICMS efetivo + FCP de saída **só com alíquota tributada**; PIS/COFINS só com PIS de saída), as bases
(reposição, C.S.I, P.M.Z), a margem e a venda sugerida (gross-up pelo TIPO_PRECIFICACAO), a venda praticada, a escada até o lucro final
(com os % da empresa ao lado) e os campos da linha.

## Corte 2 (09/10/2026)

- ⛔→✅ **O FCP de saída era zerado a cada Salvar** (o campo não estava no schema nem na tela, e o servidor gravava 0): 29 preços da loja
  1 têm FCP. Agora é campo da tela, entra no PMZ e no débito de ICMS e, se não vier, o da linha fica.
- **Individual × Sincronizar empresas marcadas** (rgopcao, o padrão é Individual): Individual grava só a loja da linha; Sincronizar, a
  editada + as marcadas (SINCRONIZA_PRECIFICACAO_EMPRESAS = 'S' força e esconde a marca). Antes o Apollo gravava sempre em todas as
  marcadas — e abria todas marcadas. Produção 2026: 364 gravações numa loja, 1.545 em duas, 209 em três ou mais.
- **A loja editada** é a linha da grade (dtsEmpresaDataChange): clicar reabre a linha de preço daquela loja.
- **Os campos da linha**: ATIVO / ATIVO_COMPRA (Tag 1 — CHATIVO/CHATIVOCOMPRA pela permissão da sessão; desativar o componente de
  um kit: "Não é permitido desativar o produto!! O produto faz parte da composição do item : CODBARRA - DESCRICAO."; com
  ATIVA_PRODUTO_EMPRESA_ATUAL o ativo de cada loja fica; com SINCRONIZA_ATIVO_TODAS_EMPRESAS vai a todas), MARKUPFIXO (Tag 1 —
  EDTMARKUPFIXO; o rótulo muda com o TIPO_PRECIFICACAO), a promoção (só com PERMITE_ALTERAR_VALOR_PROMO — **'N' no Retaguarda da
  produção**; "Valor promoção não poder ser Zero."), ATACAREJO_ATIVO (só com HABILITA_ATACAREJO — 'S' no Retaguarda), margem de
  comissão, comissão (até 100%), usa flex, exibe no força de vendas, frete não incluso e FCP-ST editáveis.
- O histórico com os **23** campos do `FCamposHistorico` (faltavam ATACAREJO_ATIVO e MARGEM_COMISSAO); os S/N como texto.
- Na sincronização a margem zerada não passa às outras lojas (o clone desconsidera MARKUP = 0).
- Ver não exige o Gravar: abrir e calcular pedem o gate da tela; o Gravar pede BTNGRAVAR (era o contrário).
- Margem + Enter calcula a venda sobre o custo real (`edtMARKUPKeyDown`: VRCUSTOREAL × (1 + margem%)) — o modo "2 CLIQUES" e o piso do
  markup fixo (BloquearPrecificacao) são da configuração da ESTAÇÃO (ConfigDB.xml de cada máquina, fora do banco); vale o padrão
  (Enter, sem piso).
- A mensagem do Gravar é a do legado ("Alterações realizadas com sucesso.") e diz quando o preço não foi aplicado numa loja (lote,
  promoção acumulativa, sem permissão) — antes dizia "Preço aplicado" mesmo sem aplicar.
- O "Usar sugerido" e o "Custo real" da tela do Apollo saíram (o legado não tem).

## Corte 3 (09/10/2026)

- ⛔→✅ **O campo do produto é o CÓDIGO DE BARRAS**, não o código interno: `AbreProduto` chama `GetProduto(edtCodProd.Text, 0, …)`, que no
  binário da produção (V$SQL `az81rkt8m2tc8`) procura `PRODUTOS.CODBARRA` e, sem ele, `CODAUXILIAR.CODAUXILIAR` (→ o produto pelo
  CODBARRA do auxiliar); com fornecedor 0 a referência do fornecedor não entra. O Apollo tratava o texto como IDPRODUTO — digitar o
  código de barras não achava nada e digitar um número abria o produto errado. `GET precificacao/custo/produto/:codigo`; não achou →
  "Produto não encontrado. Verifique!".
- **F3** (`btnBuscaProdutoClick`): a GET_PRODUTOS da loja com o " Ati&vo venda / compra" da TELA (Sim — o padrão —, Não, Todos) como
  `((ATIVO = v) OR (ATIVO_COMPRA = v))`, aberta na descrição em qualquer lugar, o inativo em vermelho ("Produto Inativo"); o código de
  barras volta ao campo. Pesquisa `precificacao/produtos` (gate da tela).
- **A promoção acumulativa na abertura** (`edtCodProdExit`, :1852-1853): vigente na loja do LOGIN, a venda trava e aparece "Produto em
  promoção acumulativa" (antes só o Gravar sabia, depois de gravar).
- **Outros → Multi-Preço** (`MultiPreo1Click`): o histórico dinâmico do MULTI_PRECO do produto na loja da linha, aberto no VRVENDA, item
  "código de barras-descrição" — o visualizador genérico `uHistoricoDinamico` (`GET cadastro/historico-dinamico/:tabela/:valor`, o
  combo dos campos com histórico de qualquer loja, as linhas do campo NA LOJA com o nome do operador, na ordem do CODHISTORICO). O
  mesmo visualizador é o "Histórico" do cadastro de produto (o `FGravaHistorico` do form-base: Outros → Histórico, aberto no VRVENDA,
  item "código-descrição", na loja do login). Produção: 323.793 linhas de MULTI_PRECO em 2025-26 (226.601 sem origem, 94.792 da NF,
  2.086 do cadastro, 314 desta tela).
- 🪦 **Outros → Atacarejo** (o histórico do MULTI_PRECO_ATACAREJO): **1 linha** em toda a HISTORICO_DINAMICO da produção (08/06/2024).

## Corte 4 (09/10/2026)

- ✅ **"Sinc. Custo na venda"** (Tag 1 — BTNSINCCUSTONAVENDA): "Informe a data" (inicial e final) → "Deseja retroagir o custo atual até
  a data de: dd/mm/aa" → `POST precificacao/custo/sinc-custo-venda` grava o custo DA TELA nas vendas do produto na loja da LINHA, no
  período pelo dia da loja (o TRUNC do Oracle; a venda das 23h30 entra no dia dela). Loja sem a tela → recusa; período invertido →
  "A data inicial é maior que a data final." (o legado não atualizava nada). Diferença consciente: a LOG guarda o custo, o período e
  quantas vendas mudaram (o legado não deixa rastro). Smoke §304.

- ⛔→✅ **A loja sem linha de preço** abre vazia (`dtsEmpresaDataChange`, :1774-1779 — o Append com IDPRODUTO/IDEMPRESA) e o Gravar a
  inclui; antes o Apollo recusava a abertura (PRECO_NAO_ENCONTRADO) — a loja 50 da produção tem 12.875 linhas contra 47.815 das outras.
  Na sincronização a marcada sem linha fica de fora (o SetaMulti_Preco localiza a linha da loja). Smoke §305.
- ⛔→✅ **Os filhos acompanham o pai em TODA gravação** (`AtualizaPrecoFilho`, :1176-1186 — chamado depois de gravar, sem condição de
  modo nem de venda, quando o produto da tela não é filho): o Apollo só sincronizava no on-line e quando a venda mudava; no lote, ou
  mudando só o custo, o filho ficava com o custo velho. Dormente na produção (nenhum filho com diferença configurada), como no legado.
  Smoke §305.1.
- **A promoção acumulativa é a da loja da LINHA** (o `dtsEmpresaDataChange` reavalia ao trocar de linha; na abertura a linha é a do login).

## Prova de uso do Sinc. Custo

- "Sinc. Custo na venda" (Tag 1 — concedido aos 31 operadores da tela): `UPDATE VENDAS SET VRCUSTO = <custo da tela>` no período, no
  produto e na loja da linha, depois do "Deseja retroagir o custo atual até a data de: …". Não deixa rastro (nem LOG nem histórico);
  nem o V$SQL nem o AWR têm o UPDATE literal hoje. **É usado — prova pelo dado**: é o único escritor de VENDAS.VRCUSTO fora da venda
  (fonte + USER_SOURCE), e há vendas ANTERIORES à troca de custo da precificação já com o custo NOVO, em bloco contíguo até a troca:
  produto 846728 em 02/10/2026 (2,15 → 51,48: as 64 vendas desde 18/09 com 51,48), 846238 em 04/09/2026 (2,90 → 2,21: 123 vendas
  desde 01/09) e em 20/07/2026 (2,15 → 2,26: 363 desde 17/07).

## Fica (a medir ou dormente na produção)

- O "Venda do pai" (edtVrVendaPai = venda × FATOR_FILHO, só para filho): 202 filhos na produção e **nenhum** com FATOR_FILHO fora de
  0/1 — o campo repetiria a venda (ou 0). A margem pela venda nos modos D/M (a produção é 'P').
- A propagação da PROMOCAO ao grupo de preço (efeito do `SetaHistorico_Dinamico`) — a promoção está travada na produção.
- 🪦 As faixas do atacarejo (MULTI_PRECO_ATACAREJO: 3 linhas, uma vazia; LOTEPRECOATACAREJO: 1) — só a flag ATACAREJO_ATIVO é usada.
