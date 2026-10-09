# Precificação de Mercadorias — `FRMPRIFICACAOCUSTO` (`UPrificacaoCusto.pas`)

> Fonte: `UPrificacaoCusto.pas` (2.509 linhas) + `.dfm`, `udmCadProduto` (cdsMultiPreco/cdsEmpresa/`SetaMulti_Preco`), `uMargemPreco`,
> `UAtualizacaoPrecoFilho`. Produção (só leitura, 09/10/2026): 3.346 acessos; em 2025-26 o HISTORICO_DINAMICO da tela mostra o que ela
> muda — VRVENDASUG 7.118, VRCUSTOCSI 6.987, VRVENDA 4.438 (+1.574 com o título da tela), VRCUSTOAJUSTE 1.299, ICMST 764,
> **ATACAREJO_ATIVO 400**, DESPACESSORIO 374, VRCUSTO 314, ICME 187, MARKUP 184, IPI 171, **ATIVO 152, ATIVO_COMPRA 107**, VRFCPST 91,
> FRETE/SEGURO/FRETE2/BONIFICACAO, PROMOCAO 23, **MARKUPFIXO 6**, VRPROMO 3. Apollo: `precificacao/custo`, tela `/precificacao/custo`,
> smoke §47l, §218.1, §301; jsdom `precificacaoCusto.spec.tsx`.

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

## Fica para o corte 3 (com prova de uso a medir)

- A busca do produto (F3 → GET_PRODUTOS com o filtro "Ativo venda/compra" e o inativo em vermelho) e o código de barras no campo.
- "Sinc. Custo na venda" (Tag 1): `UPDATE VENDAS SET VRCUSTO` no período, na loja da linha.
- Outros → "Multi-Preço" (o histórico dinâmico do produto) e "Atacarejo".
- Loja sem MULTI_PRECO: o legado inclui a linha ao gravar; o Apollo recusa (a loja 50 tem 12.875 linhas contra 47.815 das outras).
- Filhos: o legado chama `AtualizaPrecoFilho` também no lote e quando só o custo muda.
- Venda do pai ↔ do filho por FATOR_FILHO; a margem pela venda nos modos D/M (a produção é 'P').
- A propagação da PROMOCAO ao grupo de preço (efeito do `SetaHistorico_Dinamico`) — a promoção está travada na produção.
- 🪦 As faixas do atacarejo (MULTI_PRECO_ATACAREJO: 3 linhas, uma vazia; LOTEPRECOATACAREJO: 1) — só a flag ATACAREJO_ATIVO é usada.
