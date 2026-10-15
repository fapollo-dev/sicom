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

## Falta auditar (próximo corte desta tela)

As 11 abas, controle a controle contra o .dfm — cada uma tem a sua grade (Desconto Fixo/Variável/Adicional/Preço Fixo/Produto Grátis/
Leve Pague com "Lim. Venda", "Lim. Promoção", "Código Promocional", "Vr. Com/Sem Desc."), os botões Adicionar/Editar/Excluir/Gravar por
aba, a aba **Perfil de Cliente** (destino P), a aba **Log**, as validações por aba (`ValidacaoOutraPromocao`: "Este registro foi
encontrado em outra promoção (N)…", "Apenas um registro do tipo Fornecedor ou Marca…") e a clonagem.

Prova: smoke §91.27b + `apps/web/test/promocaoCadMaster.spec.tsx` (2).
