# GESTÃO DE PROMOÇÕES (`FRMCADPROMOCAO`, `UCadPromocao.pas` 4.005 + `.dfm` 6.725)

194 acessos (MENUEXPRESS). Apollo: `apps/web/src/features/promocao/PromocaoCadMaster.tsx` + `cadastro/promocao` (`promocao.aggregate.ts`:
PROMOCAO + detalhe CLUBE_DESCONTO). Smoke §91 (as 11 mecânicas, cortes 1-5).

Uso real (produção, 15/10/2026): **25 promoções em toda a história**, a última de abr/2024 — TIPO G (Produto Grátis) 11, D (Desconto
Adicional) 8, T 5, R 1; OPCAO "Outras" 24, "Rebaixa por vencimento" 1.

## Auditoria do cabeçalho (15/10/2026) — `UCadPromocao.dfm` × Apollo

- **Abrir / alterar**: o legado é um cadastro (pesquisa, abre, altera). A tela do Apollo só **criava** e **excluía** — uma promoção
  gravada não abria. ❌→✅ ("Abrir" na lista: cabeçalho, a aba do TIPO e os itens; o rótulo do produto vem da DESCRICAO do item; Gravar
  = PUT.)
- **Opção** (`CbbOpcoes` → OPCAO): o motivo — Rebaixa por vencimento / por excesso / avariada / sem giro / inativo / Outras (V/E/A/S/I/O).
  O `Validado` exige: "Informe uma opção para a promoção.". O Apollo não tinha o campo (toda promoção criada por ele saía com OPCAO
  nula). ❌→✅
- **Destino** (`CbbDestinoPromocao`): Clientes, Clientes IZIO, Clube Fidelidade, Funcionários, Perfil de Cliente, Todos — a ordem e os
  rótulos do legado. Na **Bonificação** some e fica 'T' (`VerificaTipoPromocao`). ❌→✅
- **Travamento** (`VerificaTravamentoComponentes`): com itens em qualquer aba, datas, horas, tipo e destino ficam desabilitados. ❌→✅
- **Validado** (o gravar), na ordem e com as mensagens do legado: "Informe a data inicial da promoção.", "Informe a data final da
  promoção.", "A data inicial deve ser menor que a data final.", "Informe a descrição da promoção.", "Informe uma opção para a
  promoção.", "Informe o tipo da promoção.", "Informe o destino da promoção." (se visível), e no Combo "Informe o tipo da operação." /
  "Informe o valor da operação.". Com itens, o fim tem de ser depois do início ("Hora fim não pode ser MENOR ou IGUAL hora início.",
  `DataFinalMenorDataInicio` do `AdicionarProduto`). ❌→✅ (tela; a API mantém fim ≤ início → 400.)
- **O tipo 'T'** — fora do combo do fonte de 2020, gravado pelo binário novo: 5 promoções "COMPRA PREMIADA" de ago/2023 com itens
  `OPERACAO = 'DESCONTO_POR_PDV'` (PDV, hora, mínimo, máximo, %). Sem o .dfm dele não há tela a portar; o enum do Apollo recusava o 'T'
  (a promoção nem regravava) e, se aceitasse, a tela mandava `itens: []` e o DELETE+INSERT do detalhe **apagaria os itens**. Agora o 'T'
  abre, o cabeçalho se regrava e a mecânica sem tela **não manda a chave de itens** (o engine deixa o detalhe como está). ❌→✅

## As grades das abas de produto (15/10/2026, corte 2 da auditoria)

As grades `cxgDesconto*Dados` (Desconto Fixo, Variável, Preço Fixo, Leve Pague, Produto Grátis e Desconto Adicional — com os Grupos B)
eram, no Apollo, "Produto + valor/quantidade". Agora são as do legado:

- **Colunas, na ordem e com os rótulos do .dfm**: Ativo, Grupo, Código, Cod.Barra, Descrição, Vr. Sem Desc. (o VRVENDA da loja —
  `JOIN MULTI_PRECO M ON M.IDEMPRESA = C.LOJA`), os derivados da aba, Quantidade (Qtde. Leve/Pague no Leve Pague), % Desconto no Grupo B do
  Adicional, Lim. Venda (MAXIMO), Lim. Promoção (MAXIMO_ESTOQUE) e Código Promocional (fora dos Grupos B). ❌→✅
  (`GET cadastro/promocao-produtos?ids=` traz código de barras, descrição, grupo de preço e VRVENDA.)
- **Os derivados** (o SQL das `Qry*` do UDMCadPromocao) e **o que o VALOR significa em cada aba**: no Desconto Fixo o VALOR é o desconto
  **total** da quantidade (unitário = VALOR/qtde, "Vr. Com Desc." = venda − unitário, a coluna VALOR chama "Desc. Total"); no Variável é o
  **%** (unitário = % × venda / 100); no Preço Fixo é o **total** (preço fixo = VALOR/qtde, coluna "Vr. Total"); no Leve Pague o unitário é
  (leve − pague) × venda / leve. Editar "Vr. Com Desc."/"Desc. Unitário"/"Preço Fixo" grava o VALOR pelas contas do `DataChange`
  (e a quantidade, no Fixo e no Preço Fixo, refaz o total). ❌→✅
  ⚠️ O legado se contradiz no Preço Fixo: o SQL mostra no "Desc. Unitário" o próprio preço (VALOR/qtde) e o `DataChange` usa venda −
  preço; o Apollo usa o do `DataChange` (o desconto de fato).
- **Os aplicadores em lote** de cada grade (os campos de cima, `edt*KeyDown` → `setQuantidade`/`setLimiteVenda`/`setEstoque`/
  `setCodigoPromocional`/`setDescontoUnitario`): Enter aplica o valor (> 0) em todas as linhas da grade; o "% Desconto Un" do Fixo e do
  Preço Fixo vira desconto unitário = % × venda. ❌→✅
- **Grupo de preço** (a coluna "Grupo", PRECO_GRUPO): o Apollo recusava 'S' em qualquer aba (feature adiada) — e a produção tem 1 item
  assim, que não regravaria. Agora vale nas grades que têm a coluna, com o `GrupoPrecoValidada`: o item marcado não pode ter outro produto
  do mesmo grupo de preço na mesma grade ("Os Produtos X e Y são do mesmo grupo de preço") nem na outra ("O Produto do grupo A X e Y do
  Grupo B são do mesmo grupo de preço"); no Combo/Atacarejo/Bonificação/Categoria (sem a coluna) segue recusado. ❌→✅
  ⚠️ O legado testa `DataSetFilho.IsEmpty` (o dataset sem filtro): com o Grupo B preenchido, qualquer "Grupo" no A seria barrado. O Apollo
  aplica a regra que a mensagem descreve.

## A validação entre promoções (15/10/2026)

`ValidacaoOutraPromocao` / `RegistroEmOutraPromocao` (pas:3276-3515), chamada pelas validações de Categoria, Combo, Atacarejo e
Bonificação: o mesmo alvo numa **outra** promoção ativa, com período sobreposto (`DATA_INICIO >= ini AND < fim` OU `DATA_FIM > ini AND <
fim` OU contém o período), mesma origem e destino — o 'T' cruza com 'C' e 'F', e estes com 'T' —, numa das lojas da promoção (e, no Combo,
Atacarejo e Bonificação, a mesma QUANTIDADE) → "Este registro foi encontrado em outra promoção (N).". No destino **cruzado** do Atacarejo
e da Categoria o legado pergunta "…Deseja continuar?" (o Apollo: 422 `PROMOCAO_OUTRA_PROMOCAO_CONFIRMAR`, a tela confirma e reenvia com
`confirmado`). Categoria Fornecedor × Marca: "Apenas um registro do tipo "Fornecedor" ou "Marca" podem ser informados em promoções
simultâneas (N).". O Apollo não validava nada disso. ❌→✅
⚠️ Na Categoria o `RegistroEmOutraPromocao(…, False)` não compara o SUBTIPO — a Seção 5 colidiria com o Produto 5. O Apollo compara o
subtipo (o alvo de verdade), documentado.

## A aba Perfil de Cliente (15/10/2026)

`TbsPerfilCliente` (só com o destino "Perfil de Cliente" — `VerificaDestinoPromocao`): Adicionar = a Pesquisa da GET_PERFIL com
`ATIVO = 'S' AND TIPO = 'PARCEIRO'` em multisseleção; Excluir marca o perfil com INDR 'E' (`btnExcluirPerfilClienteClick`); no gravar
(`AtualizaPerfilCliente`) cada item leva CODPERFIL_PARCEIRO = a lista "I<cod>,E<cod>," — o excluído **continua** na lista, com 'E'. Faltava.
❌→✅ (Pesquisa `promocao/perfis` com o filtro no servidor.) 0 itens com perfil na produção.

## A clonagem (15/10/2026)

`MniClonarRegistroClick`: o período novo (`TFrmPeriodo`), o cabeçalho e os itens copiados numa promoção **nova** (a gravar); cada item
passa pela validação com `Clonando` — o que esbarra noutra promoção simultânea entra **inativo** (ATIVO='N') e a aba **Log** (`TbsLogs`,
o `MemLog`) recebe "Erro ao clonar o produto X, será cadastrado como inativo." + "Este registro foi encontrado em outra promoção (N)."
(ou a linha de Fornecedor/Marca); com log, "Ocorreram erros durante a clonagem, verifique a guia logs.". Faltava. ❌→✅
(Ação "Clonar" na lista; `POST cadastro/promocao-produtos/clonagem` aponta os conflitos sem barrar.)

## Falta auditar (próximo corte desta tela)

Categoria, Combo, Atacarejo, Bonificação e Código Promocional controle a controle; os botões Adicionar/Editar/Excluir/Gravar por aba;
a **Relação** (`MniRelacaoClick` → `GeraRelatorio` de cada tipo).

Prova: smoke §91.13, §91.13b, §91.27b, §91.41, §91.41b + `apps/web/test/promocaoCadMaster.spec.tsx` (5) + `promocaoLote.spec.tsx`.
