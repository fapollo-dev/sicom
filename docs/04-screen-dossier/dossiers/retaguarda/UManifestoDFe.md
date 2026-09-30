# Manifesto do Destinatário (FRMMANIFESTODFE, `UManifestoDFe.pas`) — 99.776 acessos

Código no Apollo: `compras/manifesto-dfe.service.ts` + `sefaz-dfe.service.ts` + `apps/web/src/features/manifesto-dfe`. Migs 148,
149, 400. Cortes 1-3 (local, SEFAZ, importar) na certificação; previsão de A Pagar em `previsao-apagar-manifesto.md`.

## Corte "a grade é a GET_NF_MANIFESTO e a manifestação das marcadas" (29/09/2026)

**Recon:** a grade do legado é `SELECT * FROM GET_NF_MANIFESTO /*FILTRO*/ ORDER BY DATA_EMISSAO DESC, RAZAO`
(uDMManifestoDFe.dfm) — a UNION das **NF com chave** (entrada e saída: importada, processada, status da NF-e, obs, processo
atual da esteira, contingência, CFOP, série) com a **fila das não cadastradas**, na janela de DIAS_RETROATIVOS_FILTRO_MANIFESTO
(90). Produção, loja 1, últimos 90 dias: **1.316 de 1.408 linhas são NF já cadastradas** (1.189 entradas processadas, 121
saídas); a fila pendente são 92. O Apollo listava só a fila.

- **A grade** (`listar`): a view da loja; filtros do legado — CNPJ do emitente (`CNPJ_CPF = …`) e o **final** da chave
  (`CHAVE LIKE '%…'`, `PesquisarNotasFiscais` :355) —, mais período/razão da pesquisa avançada (BTNPESQUISAAVANCADA) e
  "apenas canceladas / não canceladas" (TTipoFiltro). As colunas do dfm; cores do `CustomDrawCell` (:971): cancelada vermelho
  negrito, não importada negrito, processada verde negrito. A nota com dois vínculos de devolução sai uma vez.
- **Manifestar as marcadas** (`manifestar-lote`, `ManifestacaoDestinatario` :2087): as quatro manifestações — ciência,
  confirmação, **desconhecimento e operação não realizada** (a tela só tinha as duas primeiras) — para as notas marcadas, com a
  confirmação do evento, UMA justificativa para a não realizada, a nota de **mais de 90 dias fora com o aviso do legado** (sem
  ir à SEFAZ), o retorno de cada chave no **Log**, e com uma só nota + confirmação + `ABRIR_NF_APOS_MANIFESTO_CONFIRM='S'` a
  importação em seguida (`fChaveParaImportacao`).
- **dhEvento 3 minutos atrás** (`IncMinute(Now, -3)`, :2421) — o Apollo mandava a hora exata, que a SEFAZ rejeita quando
  passa o relógio dela.
- **Atalhos da linha:** o PROCESSO_ATUAL abre a esteira da chave (duplo clique → TFrmProcessoNotaFiscal); a nota cadastrada
  abre a conferência da nota (cxbtnConfnf → TfrmConferenciaNota com `NFInicial`).

**Fold (mig 400):** a GET_NF_MANIFESTO do Apollo (mig 397) lia os eventos de `nfe_evento` — a tabela da emissão de NF-e do
Apollo (mig 030), que a carga enche com uma cópia do NFE_EVENTOS mas que o manifesto não grava. Depois da virada, a ciência
enviada pelo Apollo (gravada em `nfe_eventos`, como o legado) não apareceria na view. Agora lê NFE_EVENTOS/CHAVE_ACESSO, como
a view da produção.

## Corte "a análise dos itens da nota" (30/09/2026)

`TFrmAnalisaItensNfManifesto` (uAnalisaItensNfManifesto.pas, o botão "Itens" da grade, só ENTRADA). **É viva e pesa no
recebimento:** abrir a análise grava os itens do XML em NFE_NAO_CADASTRADAS_ITENS (o AfterPost do dataset aplica cada linha,
uDMManifestoDFe.pas:420) — ~450 notas por mês na produção, 98% dos itens com produto — e a importação da NF usa o FATOREMBAL
de cada item (`GetFatorEmbalagemManifesto`, NFe.pas:3092). O Apollo já lia esse fator na importação, mas nada o gravava: depois
da virada, o fator da caixa corrigido pelo operador deixaria de existir.

- `GET itens/:chave` (FormShow → `CarregarItensNotaFiscal` :690 → `CarregaCadastroProduto` :1306): exige o XML ("Nota fiscal não
  liberada para visualização dos itens. Realize a ciência da operação."); insere os itens que faltam (fator 0), refaz ST/IPI dos
  que já estão enquanto a nota não tem pedido; vincula cada item na ordem do legado — EAN (GTIN-14 sem o zero) ou código do
  fornecedor → referência do fornecedor → código de barras / código auxiliar (com o zero à esquerda até 5 dígitos e o '0'+EAN
  de 13) → código do fornecedor —, só com o emitente cadastrado (PARCEIROS_END pelo CNPJ: ATIVO / INATIVO / NÃO CAD.), e põe
  o FATORCX do produto (0 → 1) no item que ainda não tem fator. VRUNITARIO_TRIB = vUnCom + ST/qCom + IPI/qCom.
- Fator editável na grade enquanto a nota não está processada; "Atribuir fator original de todos" (FATORCX) e "fator 1,0 a
  todos"; imprimir a grade (todos / cadastrados / não cadastrados — ImprimirRelatorioProdManifesto).
- **Vincular** o item não reconhecido a um produto: grava a referência do fornecedor (o InsereRefFornecedorXML das opções
  "anexar" da importação) e refaz o vínculo.

**Fora, com prova:** a aba Financeiro da análise gravava FATURAMENTO_MANIFESTO, tabela que **não existe** na produção (o binário
novo trocou pela previsão de A Pagar — `previsao-apagar-manifesto.md`); "Verificar nota fiscal com pedido de compra" é a análise
pedido×NF (parada desde 09/01/2025); o cadastro de produto/parceiro a partir do XML (F2/F7) fica no cadastro.

**Fora, com prova:** "Análise de pedido de compra" da linha — a análise pedido×NF parou em 09/01/2025 (9.030 análises, a
última nessa data). A "conferência de preço simples" (relatório `conf - conferencia de preco simples nf.fr3`) é o próximo corte. Colunas ALERTA/DESCRICAO_ALERTA são campos
do dataset do binário novo (alerta fiscal), fora da view.
