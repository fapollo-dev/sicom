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
última nessa data). ✅ A "conferência de preço simples" (o botão "Conf. Preço" da grade, `conf - conferencia de preco simples nf.fr3`, só na nota cadastrada) entrou em 30/09/2026 com as impressões da NF (`uNF-impressoes.md`). Colunas ALERTA/DESCRICAO_ALERTA são campos
do dataset do binário novo (alerta fiscal), fora da view.

## A impressão da análise dos itens no layout do cliente (05/10/2026)

O menu "Imprimir" da análise dos itens (`TFrmAnalisaItensNfManifesto.ImprimirRelatorioProdManifesto`, uAnalisaItensNfManifesto.pas:1050 —
"Imprimir todos", "…produtos cadastrados", "…produtos não cadastrados") sai no `Manifesto_Destinatario_Itens.fr3` da RELATORIOS:
`GET compras/manifesto-dfe/itens/:chave/impressao?filtro=todos|cadastrados|nao-cadastrados`. `frxDBDatasetProdManifesto` = os itens da
NFE_NAO_CADASTRADAS_ITENS na ordem do NROITEM (o filtro `ProdutoCadastrado = 'S'` / `'N' or NULL`), `frxDBDatasetDadosNota` = a linha da
nota na grade (GET_NF_MANIFESTO: CHAVE, CNPJ_CPF, DATA_EMISSAO, NUMERO_NF, RAZAO, TOTAL_NF), `frxDBDatasetDadosEmpresa` = a empresa do
login. Sem item: "Não existem produtos listados para construir o relatório.". O HTML próprio saiu. A conferência de preço da grade já usava
o `conf - conferencia de preco simples nf.fr3`; o DANFE_ManifestoDest.fr3 é do ACBr (SEFAZ) e fica fora.

## A auditoria controle a controle (14/10/2026)

`UManifestoDFe.pas` (3.187 linhas) + `.dfm` revistos contra a tela do Apollo. Convertido agora:

| Controle do legado | Apollo |
|---|---|
| **[F5] - Buscar últimas NF's** (`btnPesquisarUltimas` → `PesquisarNotasFiscais` sem filtro, FormKeyDown :1630) | F5 e o botão: limpa os filtros e lista a loja na janela do manifesto |
| **[F2]** com "Consultar nota fiscal pela chave de acesso" (`BuscarNotaPorChave` :1161-1229 — `DistribuicaoDFePorChaveNFe`) | "Consultar pela chave (SEFAZ)": `POST sincronizar-chave` — o distDFeInt com `<consChNFe>`, sem mexer no cursor; a grade fica só com a chave |
| **Realizar consulta forçada de NF-e (selecionadas)** (:1481-1490 → `RealizaDownloadArquivosViaConsChave` :1375-1480) | "Consulta forçada (marcadas)": `POST consulta-forcada` — a consulta por chave das marcadas, pulando a que já tem o XML em NFE_XML; o erro de uma no Log, as outras seguem; "Selecione pelo menos uma nota fiscal para realizar a consulta." |
| **Importar NF-e (XML)** (`TFrmImportaNfeManifesto` → `ImportarNFEParaManifesto`, uDMManifestoDFe.pas:503-660) | o botão abre os arquivos .xml; `POST importar-xml` com as regras do legado por arquivo: estrutura que não é NF-e; emitente/destinatário ≠ CNPJ da loja ("não pertence a empresa…"); a que já é NF ("consta no sistema como Importada"); a que já está na fila ("consta no sistema como manifestada…") — as duas últimas entram na lista para carregar, como lá. A nova vira a linha da fila com IMPORTACAO_MANUAL 'S', o nome do arquivo, o TIPO invertido pelo tpNF, e o XML em NFE_XML. Depois, "Deseja carregar as notas fiscais importadas?" → a grade pelas chaves (`chaves` no listar) |
| **Exportar Arquivos .XML** (`btnExportarXML` → `SalvarXMLNosDiretorios(true)` :2859-3048) | "Exportar XML (marcadas)": `POST xml-lote` — um `<chave>-nfe.xml` por nota num .zip (o legado grava nos diretórios da estação; o "Diretório .XML de NF-e" é o Explorer dela) |
| **Imprimir DANFE** (`ImprimirDANFE1Click` :1901-1928) | a linha "DANFE": a nota cadastrada sai no DANFE da NF do Apollo (`/fiscal/nf/:id/danfe`); sem o XML, tenta a SEFAZ pela chave e avisa como o legado — "Realize a ciência da operação para imprimir o DANFE." (sem ciência nem confirmação) ou "…ainda não foi liberado pela SEFAZ". ⛔ O DANFE do XML de uma nota **ainda não importada** é do ACBr (`DANFE_ManifestoDest.fr3` não está na RELATORIOS): fica o aviso para baixar o XML ou importar |
| **Abrir** (`Abrir1Click` :2806-2836 — a `TfrmNF` da chave, 35/36 pelo tipo) | a linha "abrir": a tela de notas de entrada/saída com `?codigo=` |
| **Consultar NF-e pelo site** (`TfrmRecuperarXML`, uRecuperarXML.pas:264 — o portal nacional num TWebBrowser com automação do captcha) | a linha "site": o portal (consulta completa, o mesmo `tipoConteudo`) numa aba, com a chave na área de transferência |
| **&Exportar Grid [F9]** (`ExportarGridF101Click` :1552-1585 — xlsx/xml/txt/html) | F9 e o botão: a grade em CSV |

Com prova, sem código:
- **Empresa** (`edtCODEMPRESA`, "A empresa selecionada será a destinatária dos eventos"): o Apollo usa a loja da sessão — trocar de loja é o Ctrl+E.
- **`VerificarNF`** (:3130-3187, o gate das ações da linha): `QTD_DIAS_LIMITE_NF_ENTRADA/SAIDA` = 0 na base e **365** no override Módulo/Retaguarda; com 365 a
  consulta exige a nota com mais de 365 dias **e** emitida nos últimos 90 — nunca há linha. O gate não bloqueia nada na produção.
- **`FILTRO_PREVIO_MANIFESTO` = 'S'**: o legado abre com a janela de fornecedor/chave antes de listar (para não carregar as ~1.400 linhas); o Apollo
  abre com os filtros vazios e lista no Pesquisar — o mesmo efeito.
- **Pesquisa avançada [F3]** (:572-718): a Pesquisa genérica da GET_NF_MANIFESTO com a legenda de cores, em multisseleção, transferindo as marcadas
  para a grade — o Apollo tem os mesmos filtros na própria tela (F3 pesquisa).
- Aba **Retorno Webservice** (o XML cru da SEFAZ) e "Salvar/Carregar configurações do grid": fora; "Análise pedidos x lote NF": morta desde 09/01/2025 (§ acima).
- A LOG da produção não registra nada do manifesto em 2026 (0 linhas): o uso de cada ação não é mensurável por ela.

Smoke §47ap.2/§47ap.3; jsdom `manifestoDfe.spec.tsx`.

