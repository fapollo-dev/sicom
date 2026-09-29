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

**Fora, com prova:** "Análise de pedido de compra" da linha — a análise pedido×NF parou em 09/01/2025 (9.030 análises, a
última nessa data). A análise dos itens do XML (`uAnalisaItensNfManifesto`, 1.439 linhas) e a "conferência de preço simples"
(relatório `conf - conferencia de preco simples nf.fr3`) são os próximos cortes. Colunas ALERTA/DESCRICAO_ALERTA são campos
do dataset do binário novo (alerta fiscal), fora da view.
