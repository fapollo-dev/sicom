# Permissões de controle (campo e botão) — o `SetStateOfControlsMaster` do legado

Além do acesso à TELA (opção = nome do form) e às ações de gravação (`BTNGRAVAR`, `BTNEXCLUIR`…), o legado tem uma camada de
permissão por CONTROLE: `uMaster.SetStateOfControlsMaster` percorre os componentes do form e, para os que têm **Tag 1 ou 13** e cujo
**nome é uma OPÇÃO de PERMISSOES**, aplica:

| tela | classe do componente | sem a opção |
|---|---|---|
| todas (`TfrmMaster.SetStateOfControlsMaster`, ao abrir) | botão (TBitBtn, TButton, TJvArrowButton, TcxButton), calc-edit, checkbox, item de menu | **Tag 1: desabilitado** · Tag 13: oculto |
| todas | edit comum (TDBEdit, TEdit, memo, combo) | perde o Tab |
| **cadastro** (`TfrmCadMaster.SetStateOfControlsCadMaster`, a cada mudança de estado) | qualquer componente com Tag 1 | **desabilitado — inclusive o edit comum** |

Duas consequências: no cadastro (produto, clientes, CFOP…) o edit com Tag 1 TRAVA; nas telas `TfrmMaster` a permissão só é aplicada ao
abrir, e o código que religa o botão depois (ex.: `btnExcluirDoc.Enabled := True` ao carregar os documentos do agrupamento) a anula.

O Apollo só tinha as duas primeiras camadas. A terceira entrou em 27/09/2026:
- `GET cadastro/acesso/opcoes/:form` — as opções do FORM concedidas ao operador (modo usuário/perfil/ambos, como `PossuiAcessoForm`);
- `useOpcoesDoForm(form)` na tela — desabilita o controle que o operador não tem;
- a gravação confere de novo o que muda o dado (quem burlasse a tela não passaria) — ex.: `produto-permissoes.ts`.

## A fila (telas convertidas, opções com efeito real — produção 27/09/2026)

Gerada cruzando PERMISSOES (operadores ativos) × os `.dfm` (classe, Tag, campo) × o que o Apollo já exige. "com/total" = operadores
com a opção / com acesso à tela: quando é igual, hoje ninguém é restringido, mas a regra vale para o próximo operador cadastrado.
Das 150 opções sem equivalente no Apollo, as que ficam fora da tabela não têm efeito (componente com Tag 0, edit comum em tela `TfrmMaster`, ou componente que o binário novo criou). A classificação vem do `.dfm` (classe, Tag) e do `.pas` (classe da tela e se o código religa o controle).

| tela (acessos) | opção | componente | tipo de tela | efeito no legado | com/total | Apollo |
|---|---|---|---|---|---:|---|
| FRMETIQUETA (2.418.712) | `BTNIMPORT` | TBitBtn | TfrmMaster | DESABILITA — mas o código religa | 53/53 | 🪦 o código religa |
| FRMMANIFESTODFE (67.138) | `BTNPESQUISAAVANCADA` | TBitBtn | TfrmMaster | DESABILITA | 50/50 | ✅ a lista com filtro de fornecedor/chave |
| FRMMANIFESTODFE (67.138) | `BTNPESQUISARULTIMAS` | TBitBtn | TfrmMaster | DESABILITA | 50/50 | ✅ a lista (o Apollo pedia BTNBUSCARNOTAS, que é a consulta à SEFAZ) |
| FRMNF (56.567) | `BTNIMPRIMIRNFE` | TBitBtn | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 51/52 | a impressão do DANFE não existe no Apollo (infra externa) |
| FRMNF (56.567) | `BTNINUTILIZARNFE` | TBitBtn | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 51/52 | a inutilização é a tela própria (FRMNFEINUTILIZADA), com o gate dela |
| FRMNF (56.567) | `CANCELARNFEPELOXML1` | TMenuItem | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 51/52 | a ação não existe no Apollo (consulta de status / cancelamento pelo XML) |
| FRMNF (56.567) | `GERARNFE1` | TMenuItem | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 51/52 | ✅ transmitir e cancelar (submenus de "NF-e") |
| FRMNF (56.567) | `IMPRIMIRDANFE1` | TMenuItem | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 51/52 | a impressão do DANFE não existe no Apollo (infra externa) |
| FRMNF (56.567) | `STATUSNFE2` | TMenuItem | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 51/52 | a ação não existe no Apollo (consulta de status / cancelamento pelo XML) |
| FRMNF (56.567) | `STATUSNFEPELOXML1` | TMenuItem | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 51/52 | a ação não existe no Apollo (consulta de status / cancelamento pelo XML) |
| FRMNF (56.567) | `STATUSSERVIO1` | TMenuItem | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 51/52 | a ação não existe no Apollo (consulta de status / cancelamento pelo XML) |
| FRMCADSCRAP (54.015) | `BTNADICIONARITEM` | TBitBtn | TfrmCadMasterDet | DESABILITA (CadMaster: edits também) | 51/51 | ✅ |
| FRMCADSCRAP (54.015) | `BTNEXCLUIRI` | TBitBtn | TfrmCadMasterDet | DESABILITA (CadMaster: edits também) | 42/51 | ✅ |
| FRMCADSCRAP (54.015) | `BTNLIMPARI` | TBitBtn | TfrmCadMasterDet | DESABILITA (CadMaster: edits também) | 45/51 | ✅ |
| FRMAPAGAR (38.546) | `CLETOTALNF` | TJvCalcEdit | TfrmMaster | DESABILITA — mas o código religa | 47/47 | 🪦 o código religa |
| FRMAPAGAR (38.546) | `EDTPAGO` | TJvCalcEdit | TfrmMaster | DESABILITA | 47/47 | 🪦 campo só de leitura (ReadOnly no .dfm) — a permissão não muda nada |
| FRMAPAGAR (38.546) | `EDTVALOR` | TJvDBCalcEdit → VALOR | TfrmMaster | DESABILITA — mas o código religa | 47/47 | 🪦 o código religa |
| FRMCADPRODUTO (38.185) | `BITBTN1` | TBitBtn | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 17/51 | "Buscar figura fiscal" — o campo já trava por `EDTCODFIGFISCAL` |
| FRMCADPRODUTO (38.185) | `BITBTN2` | TBitBtn | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 40/51 | "Alt. estoque": a ação não existe na tela do Apollo |
| FRMCADPRODUTO (38.185) | `BTNADDDESCOMP` | TBitBtn | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 44/51 | ✅ |
| FRMCADPRODUTO (38.185) | `BTNADDITEM` | TBitBtn | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 44/51 | ✅ |
| FRMCADPRODUTO (38.185) | `BTNDELITEM` | TBitBtn | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 45/51 | ✅ |
| FRMCADPRODUTO (38.185) | `BTNEXCLUIDECOMP` | TBitBtn | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 45/51 | ✅ |
| FRMCADPRODUTO (38.185) | `BTNLIMPADECOMP` | TBitBtn | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 47/51 | ✅ |
| FRMCADPRODUTO (38.185) | `BTNLIMPARCOMPOSICAO` | TBitBtn | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 47/51 | ✅ |
| FRMCADPRODUTO (38.185) | `BTNPRECIFICACAO` | TBitBtn | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 27/51 | ✅ |
| FRMCADPRODUTO (38.185) | `CHBATIVO` | TJvDBCheckBox → ATIVO | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 51/51 | ✅ |
| FRMCADPRODUTO (38.185) | `CHBATIVOCOMPRA` | TJvDBCheckBox → ATIVO_COMPRA | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 51/51 | ✅ |
| FRMCADPRODUTO (38.185) | `EDTCODFIGFISCAL` | TDBEdit → CODFIGURAFISCAL | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 49/51 | ✅ |
| FRMCADPRODUTO (38.185) | `EDTCUSTO` | TJvDBCalcEdit → VRCUSTO | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 46/51 | ✅ |
| FRMCADPRODUTO (38.185) | `EDTCUSTOREP` | TJvDBCalcEdit → VRCUSTOREP | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 46/51 | ✅ |
| FRMCADPRODUTO (38.185) | `EDTNCMSH` | TDBEdit → NCMSH | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 47/51 | ✅ |
| FRMCADPRODUTO (38.185) | `EDTVRVENDA` | TJvDBCalcEdit → VRVENDA | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 49/51 | ✅ |
| FRMCADPRODUTO (38.185) | `MNIDUPLICARPRODUTO` | TMenuItem | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 47/51 | "Duplicar produto": a ação não existe na tela do Apollo |
| FRMCADPRODUTO (38.185) | `PRECIFICAODOCUSTO1` | TMenuItem | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 46/51 | abre a Precificação pelo custo. que tem o gate próprio |
| FRMEXPORTABALANCA (28.674) | `BTNCONFIGURABAL` | TBitBtn | TfrmMaster | DESABILITA | 45/44 | 🪦 marginal: a configuração da balança mudou pela última vez em 24/05/2024 (LOG); o Apollo não tem a tela de configuração |
| FRMEXPORTABALANCA (28.674) | `BTNEXPORTAR` | TBitBtn | TfrmMaster | DESABILITA — mas o código religa | 48/44 | 🪦 o código religa |
| FRMPEDIDOCOMPRA (26.385) | `BTNADDBONI` | TBitBtn | TfrmCadMasterDet | DESABILITA (CadMaster: edits também) | 28/34 | coberto pela grade única de itens (os mesmos 6 operadores não têm BTNADICIONARI) |
| FRMPEDIDOCOMPRA (26.385) | `BTNADICIONARI` | TBitBtn | TfrmCadMasterDet | DESABILITA (CadMaster: edits também) | 28/34 | ✅ |
| FRMPEDIDOCOMPRA (26.385) | `BTNBAIXAR` | TButton | TfrmCadMasterDet | DESABILITA (CadMaster: edits também) | 28/34 | "Baixar pedidos em lote" não existe no Apollo |
| FRMPEDIDOCOMPRA (26.385) | `BTNEXCLUIRBONI` | TBitBtn | TfrmCadMasterDet | DESABILITA (CadMaster: edits também) | 28/34 | idem (BTNEXCLUIRI) |
| FRMPEDIDOCOMPRA (26.385) | `BTNEXCLUIRI` | TBitBtn | TfrmCadMasterDet | DESABILITA (CadMaster: edits também) | 28/34 | ✅ |
| FRMPEDIDOCOMPRA (26.385) | `BTNLIMPARI` | TBitBtn | TfrmCadMasterDet | DESABILITA (CadMaster: edits também) | 28/34 | ✅ |
| FRMPEDIDOCOMPRA (26.385) | `MNIATUALIZARTABELAFORNECEDOR` | TMenuItem | TfrmCadMasterDet | DESABILITA (CadMaster: edits também) | 6/34 | a tabela do fornecedor não existe no Apollo (desligada no cliente) |
| FRMCADCLIENTES (21.288) | `BTNSALVARNOVOFLEX` | TBitBtn | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 47/49 | 🪦 HISTORICO_FLEX vazia na produção — o saldo flex nunca foi usado |
| FRMCADCLIENTES (21.288) | `CCDCREDITO` | TJvDBCalcEdit → CREDITO | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 47/49 | ✅ |
| FRMCADCLIENTES (21.288) | `CHBCLIENTE` | TJvDBCheckBox → CLI | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 49/49 | ✅ |
| FRMCADCLIENTES (21.288) | `CHBCONVENIO` | TJvDBCheckBox → CON | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 47/49 | ✅ |
| FRMCADCLIENTES (21.288) | `CHBFORNECEDOR` | TJvDBCheckBox → FRN | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 47/49 | ✅ |
| FRMCADCLIENTES (21.288) | `CHBFUNCIONARIO` | TJvDBCheckBox → FUN | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 49/49 | ✅ |
| FRMCADCLIENTES (21.288) | `CHBTRANSPORTADORA` | TJvDBCheckBox → TRA | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 47/49 | ✅ |
| FRMCADCLIENTES (21.288) | `DBLIVREINDEXADOR` | TJvDBCheckBox → RETIRA_FORNINDEX | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 44/49 | ✅ |
| FRMCADCLIENTES (21.288) | `JVDBCHECKBOX1` | TJvDBCheckBox → REALIZA_TROCA | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 44/49 | ✅ |
| FRMCADCLIENTES (21.288) | `VISUALIZARSENHADADOSFINANCEIROS1` | TMenuItem | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 47/49 | o Apollo não mostra a senha: SENHA_AUTPDV não sai mais na leitura (§271) |
| FRMCADCLIENTES (21.288) | `VISUALIZARSENHARALACIONAMENTOS1` | TMenuItem | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 47/49 | idem (a do relacionamento nunca saiu: fora das colunas do detalhe) |
| FRMBAIXAAPAGAR (8.512) | `BTNADDRECURSO` | TBitBtn | TfrmMaster | DESABILITA | 36/36 | 🪦 o código religa (`btnDelRecurso.Enabled := not status`, UBaixaApagar.pas:215 / UBaixaAreceber.pas:2893) — a permissão não vale |
| FRMBAIXAAPAGAR (8.512) | `BTNCONSULTA` | TBitBtn | TfrmMaster | DESABILITA — mas o código religa | 36/36 | 🪦 o código religa |
| FRMBAIXAAPAGAR (8.512) | `BTNDELRECURSO` | TBitBtn | TfrmMaster | DESABILITA | 29/36 | 🪦 o código religa (`btnDelRecurso.Enabled := not status`, UBaixaApagar.pas:215 / UBaixaAreceber.pas:2893) — a permissão não vale |
| FRMBAIXAAPAGAR (8.512) | `BTNPOSTRECURSO` | TBitBtn | TfrmMaster | DESABILITA | 36/36 | 🪦 o código religa (`btnDelRecurso.Enabled := not status`, UBaixaApagar.pas:215 / UBaixaAreceber.pas:2893) — a permissão não vale |
| FRMCONTROLECONTASBANCARIAS (7.617) | `BTNTROCAVALORES` | TBitBtn | TfrmMaster | DESABILITA | 35/35 | 🪦 TROCA_VALORES vazia na produção — a troca de valores nunca foi usada |
| FRMBAIXACARTAO (7.589) | `BTNCONSULTA` | TBitBtn | TCollection | DESABILITA — mas o código religa | 27/27 | 🪦 o código religa |
| FRMPRIFICACAOCUSTO (3.346) | `BTNSINCCUSTONAVENDA` | TBitBtn | TfrmMaster | DESABILITA | 28/28 | o campo/ação não existe na tela do Apollo (lacuna de funcionalidade) |
| FRMPRIFICACAOCUSTO (3.346) | `CHATIVO` | TJvDBCheckBox → ATIVO | TfrmMaster | DESABILITA | 28/28 | o campo/ação não existe na tela do Apollo (lacuna de funcionalidade) |
| FRMPRIFICACAOCUSTO (3.346) | `CHATIVOCOMPRA` | TJvDBCheckBox → ATIVO_COMPRA | TfrmMaster | DESABILITA | 28/28 | o campo/ação não existe na tela do Apollo (lacuna de funcionalidade) |
| FRMPRIFICACAOCUSTO (3.346) | `EDTMARKUPFIXO` | TJvDBCalcEdit → MARKUPFIXO | TfrmMaster | DESABILITA | 28/28 | o campo/ação não existe na tela do Apollo (lacuna de funcionalidade) |
| FRMPRIFICACAOCUSTO (3.346) | `EDTVRVENDA` | TJvDBCalcEdit → VRVENDA | TfrmMaster | DESABILITA | 28/28 | ✅ |
| FRMBAIXAARECEBER (3.197) | `BTNADDRECURSO` | TBitBtn | TfrmMaster | DESABILITA | 30/30 | 🪦 o código religa (`btnDelRecurso.Enabled := not status`, UBaixaApagar.pas:215 / UBaixaAreceber.pas:2893) — a permissão não vale |
| FRMBAIXAARECEBER (3.197) | `BTNCONSULTA` | TBitBtn | TfrmMaster | DESABILITA — mas o código religa | 30/30 | 🪦 o código religa |
| FRMBAIXAARECEBER (3.197) | `BTNDELRECURSO` | TBitBtn | TfrmMaster | DESABILITA | 29/30 | 🪦 o código religa (`btnDelRecurso.Enabled := not status`, UBaixaApagar.pas:215 / UBaixaAreceber.pas:2893) — a permissão não vale |
| FRMBAIXAARECEBER (3.197) | `BTNPOSTRECURSO` | TBitBtn | TfrmMaster | DESABILITA | 30/30 | 🪦 o código religa (`btnDelRecurso.Enabled := not status`, UBaixaApagar.pas:215 / UBaixaAreceber.pas:2893) — a permissão não vale |
| FRMAGRUPACONTASARECEBER (2.789) | `BTNEXCLUIRDOC` | TBitBtn | TfrmMaster | DESABILITA — mas o código religa | 9/35 | 🪦 o código religa o botão ao carregar os documentos (uAgrupaContasAReceber.pas:486) — a permissão não vale |
| FRMCADPEDIDODEVOLUCAOCOMPRAS (2.527) | `BTNEXCLUIRITEM` | TBitBtn | TRelDevolucaoCompras | DESABILITA | 36/41 | ✅ |
| FRMCADUSUARIOS (1.807) | `EDTSENHARETAGUARDA` | TDBEdit → SENHARETAGUARDA | TfrmCadMasterDetalhe | DESABILITA (CadMaster: edits também) | 28/37 | ✅ |
| FRMRELATORIO (1.295) | `BTNEXCLUIMODELO` | TBitBtn | TfrmMaster | DESABILITA | 24/24 | ✅ |
| FRMRELATORIO (1.295) | `BTNNOVORELATORIO` | TBitBtn | TfrmMaster | DESABILITA | 24/24 | ✅ (criar no construtor) |
| FRMAGRUPACONTASAPAGAR (467) | `BTNEXCLUIRDOC` | TBitBtn | TfrmMaster | DESABILITA — mas o código religa | 9/33 | 🪦 idem (o código religa) |
| FRMCADPLC (444) | `BTNADICIONARMOTOP` | TBitBtn | TfrmCadMaster | DESABILITA (CadMaster: edits também) | 30/30 | 🪦 PLC_MOTIVO_OPERACAO vazia na produção |
| FRMCADPLC (444) | `BTNEXCLUIRMOTOP` | TBitBtn | TfrmCadMaster | DESABILITA (CadMaster: edits também) | 25/30 | 🪦 idem |
| FRMCADPLC (444) | `BTNLIMPARMOTOP` | TBitBtn | TfrmCadMaster | DESABILITA (CadMaster: edits também) | 30/30 | 🪦 idem |
| FRMCADCOTACAO (363) | `BTNENVIAREMAIL` | TBitBtn | TfrmCadMasterDet | DESABILITA (CadMaster: edits também) | 23/23 | envio de e-mail ainda não existe no Apollo |
| FRMCADCFOP (349) | `CMBALIQUOTA` | TDBLookupComboBox → ALIQUOTA | TfrmCadMaster | DESABILITA (CadMaster: edits também) | 21/21 | ✅ |
| FRMRENTABILIDADECATEGORIAS (275) | `BTNCONSULTA` | TBitBtn | TfrmMaster | DESABILITA | 23/23 | ✅ |
| FRMDESCONTOTITULO (68) | `BTNCONSULTA` | TBitBtn | TfrmMaster | DESABILITA | 27/27 | ✅ |
| FRMCONSCLIRCB (64) | `EDTJURO` | TJvCalcEdit | TfrmMaster | DESABILITA | 27/27 | a consulta do Apollo não tem a taxa editável |
| FRMMULTATUALIZACAO (63) | `BTNDESFAZER` | TBitBtn | TfrmMaster | DESABILITA | 23/17 | a ação não existe no Apollo |
| FRMMULTATUALIZACAO (63) | `BTNPROCESSAR` | TBitBtn | TfrmMaster | DESABILITA | 23/17 | ✅ aplicar e PIS/COFINS |
| FRMCONSPROD (25) | `BTNCADASTRO` | TBitBtn | TfrmMaster | DESABILITA | 23/23 | ✅ é o "Análise geral do Produto" (legenda na produção: "Analisar Produto") — abre a posição do produto |
| FRMCADLOTECOBRANCA (20) | `BTNADDITEN` | TBitBtn | TfrmCadMasterDet | DESABILITA (CadMaster: edits também) | 23/23 | ✅ |
| FRMCADLOTECOBRANCA (20) | `BTNEXCLUIRITEM` | TBitBtn | TfrmCadMasterDet | DESABILITA (CadMaster: edits também) | 18/23 | ✅ |
| FRMCADUNIDADE (5) | `CHBATIVO` | TJvDBCheckBox → ATIVO | TfrmCadMaster | DESABILITA (CadMaster: edits também) | 19/19 | ✅ |

## O que a prova da produção já disse

- **Excluir código auxiliar** (`FRMCADPRODUTO.BTNEXCLUIRCODAUXILIAR`): nenhum operador tem a opção, mas a LOG mostra 19 exclusões de
  código auxiliar pelo cadastro desde 2025 — o binário novo exclui por outro caminho. **Não trava** (a opção ficou fora da fila).
- **Preço e custo no produto**: os 6 e 8 operadores sem a opção não gravaram nada no cadastro desde 2025 (evidência neutra); o fonte
  aplica e as permissões são mantidas — aplicado.
- **Lote 2 (27/09/2026)**: NCM e figura fiscal do produto (edit com Tag 1 em tela de cadastro), a grade do SCRAP e do pedido de compra,
  papéis/crédito/indexador/troca do cliente (papéis só na alteração — a tela aberta traz o seu na inclusão), ativo da unidade,
  alíquota do CFOP, itens do lote de cobrança e da devolução, e a senha no cadastro de usuários (9 de 37 sem). Smoke §269.
- **Segredos na leitura (27/09/2026)** — achado ao conferir o "Visualizar senha" do cliente: o `GET` do cadastro devolvia as senhas que
  a carga traz — operador (SENHA/SENHAPDV/SENHARETAGUARDA/LOGIN_SENHA, codificação reversível: 286/93/45/286 na produção), parceiro
  (SENHA 57, SENHA_AUTPDV 203), empresa (as senhas de operação do legado e os hashes, o certificado) e pedido de compra
  (SENHA_NOVO_LIMITE 597). Agora ficam em `colunasOcultasLeitura` (as views de listagem já não as traziam). Smoke §271.


## Atos sem opção própria no legado — o gate da tela (27/09/2026)

Cruzando o que o Apollo exige × a PERMISSOES da produção, **46 atos** pediam uma opção que o Apollo inventou (`BTNESTORNAR`,
`BTNPROCESSAR`, `BTNREABRIR`, `BTNVISUALIZAR`…) e que nenhum operador tem — depois da carga, ninguém faria. A PERMISSOES traz o
`CAPTION` do componente, e o `.dfm` diz se ele tem Tag 1. A regra aplicada (mig 382, smoke §272):

- o ato **não tem** componente com Tag 1 → vale o **gate da tela** (o legado libera para quem abre o form);
- **tem** → a opção do componente (o nome dele na PERMISSOES);
- a gravação em tela de cadastro → `BTNGRAVAR`: o `TfrmCadMaster` confere por **código** `PossuiAcessoForm(Self.Name,'BTNGRAVAR')`
  (e `BTNEDITAR`/`BTNEXCLUIR`) — não é componente, é checagem no `btnGravarClick`.

| tela | ato no Apollo | exige agora | prova |
|---|---|---|---|
| FRMETIQUETA | fila do coletor | `BTNCONSULTAPRECO` | "Consulta Preço" (BitBtn1, Tag 1; na produção "Adicionar registro de etiquetas enviadas pelo coletor") |
| FRMETIQUETA | pesquisa por ETQ_IMPRESSA | `BTNADICIONARREGISTRO` | "Adicionar Itens" (Tag 1) abre essa pesquisa |
| FRMETIQUETA | imprimir, tirar da lista, lotes, buscar produto | gate | sem Tag 1 |
| FRMEXPORTABALANCA | gerar arquivos | `BTNEXPORTAR` | "Exportar" (Tag 1) |
| FRMCADAGENDAPROMOCAO | encerrar / reabrir | `ENCERRARPROMOCAO` | "Encerrar Promoção" (binário novo) |
| FRMCADAGENDAPROMOCAO | aplicar preço, vigência | gate | sem componente |
| FRMBAIXACARTAO | estornar lote | `BTNCONSULTA` | o estorno está no frmConsCRTbx (btnReverterBaixa sem Tag), que só abre por "Consulta baixa" (Tag 1) |
| FRMDESCONTOTITULO | executar / reverter | `BTNADICIONARREGISTRO` / `BTNCONSULTA` | "Iniciar baixa" (Tag 1); a reversão abre pelo `btnConsultaClick` (Tag 1) |
| FRMCADPERFILOPERADOR | vínculo perfil×operador | ler: gate · mudar: `BTNGRAVAR` | detalhe do cadastro, persiste no Gravar |
| FRMCADCOTACAO | lançar preços | `BTNGRAVAR` | digitação na matriz do cadastro, persiste no Gravar |
| FRMCADCOTACAO | fechar, reabrir, processar | gate | mniFechar/Reabrir/ProcessarCotacao com Tag 0 |
| FRMCADEMPRESA | senha de operação | `BTNGRAVAR` | campos do cadastro da empresa |
| FRMNF | contabilizar / estornar | `BTNGRAVAR` | o contábil é detalhe da nota (dsContabilNF), persiste no Gravar |
| FRMNF | processar / reverter | gate | `mniProcessarNota` (Tag 0), habilitado pelo estado |
| FRMPEDIDOCOMPRA | reabrir, gerar NF, saldo, importar XML, de-para, liberar conferência | gate | `mniReabrirPedido` Tag 0 (quem reabre é USUARIOS_REABREM_PEDIDO_COMPRA); `LIBERAVALORMAX` fica (supervisor) |
| FRMCADPEDIDODEVOLUCAOCOMPRAS | finalizar, reabrir, cancelar, faturar, gerar NF | gate | só `btnExcluirItem` tem Tag 1 |
| FRMAJUSTEESTOQUE, FRMANALISECOMPORTAMENTO, FRMAPURACAOPISCOFINS, FRMCADCLASSTRIBIBSCBS, FRMCONCILIACAOBANCARIA, FRMCONFBOLETO, FRMCONFIGINTEGRACAOCONTABIL, FRMCONGELAESTOQUE, FRMCONSRCBBX, FRMDEVOLUCAOVENDAS, FRMPRECIFICACAONF, FRMRELDRECONTABIL, FRMRELRAZAOCONTABIL, FRMGERARFINANCEIROLOTE | estornar/gravar/excluir/importar/gerar/visualizar | gate | todas `TfrmMaster` (sem checagem por código) e o ato sem Tag 1 |

**Excluir movimentação OFX** (`FRMCONCILIACAOBANCARIA.BTNPERMISSAOEXCLUIROFX`, 27 operadores) — a lacuna desta auditoria —
convertida em seguida (mig 384, smoke §274): ver o dossiê da conciliação bancária.

## Telas sem grant nenhum, telas abertas por outras e a tela de configurações (27/09/2026, parte 2)

**Sem grant nenhum na produção** (FRMCADCONFPLANOCONTAS, FRMCADPRODUCAO, FRMPRECIFICACAONFBRUTA, FRMPENDENCIASOPERADOR,
FRMTROCAMERCADORIAFOR, FRMRELANALISECOMPORTAMENTOPERIODO, FRMFLUXOCARTOES, FRMRELANALISEITENSNF, FRMANALISECOMPRAVENDACASACARNE,
FRMCADCONFIGCONCILIADOR…): o Apollo usa o mesmo nome da classe do legado, e o menu (`TfrmMenuSuperior.CreateForm`) confere
`PossuiAcessoForm(FormName, FormName)` antes de abrir — **fiel, sem remapear**. O MENUEXPRESS mostra que essas 25 telas foram
usadas até 12/05–25/06/2026 (a coluna DATAACESSO só existe desde mai/2026) e pararam: os grants saíram. Os "candidatos" que o
script de equivalência sugeria (FRMCADPLANOCONTAS, FRMLOTEPRODUCAO, FRMLIBERACAOPEDIDO, FRMCADOPERADORAS, FRMRELTROCAMERCADORIAFOR…)
são **classes próprias** no fonte — outras telas, não renomeação.

**Abertas de dentro de outras** (`TfrmX.Create(Self)`, sem o gate do menu) → `@RequerAcessoDeAlgum` (basta um dos pares):

| tela | abre por | exige (qualquer um) |
|---|---|---|
| análise geral do produto (FRMPOSICAOPRODUTO) + kardex | cadastro de produto (F7, Tag 0) · consulta de produto ("Análise geral", Tag 1) · cotação (F6, Tag 0) · análise de concorrentes (F6, Tag 0) | FRMCADPRODUTO · FRMCONSPROD.`BTNCADASTRO` · FRMCADCOTACAO · FRMCADANALISECONCORRENTES |
| conferência da nota (FRMCONFERENCIANOTA) | botão da grade do manifesto (UManifestoDFe:812) · menu | FRMMANIFESTODFE · FRMCONFERENCIANOTA |
| esteira da nota (NF_STATUS_PROCESSO) | clique no status da nota (uNF:9253) · duplo-clique no processo do manifesto (UManifestoDFe:932) | FRMNF · FRMMANIFESTODFE |
| histórico de processamento da NF | **sem prova** (a tabela é posterior ao fonte e nenhuma tela com grant a mostra) — quem vê a nota ou o produto | FRMNF · FRMCADPRODUTO |

Outros: o **clube de desconto** é detalhe da promoção (`CLUBE_DESCONTO.IDPROMOCAO`) → FRMCADPROMOCAO; **estornar movimento de
caixa** é excluir no FRMMOVCAIXA (cadastro → `BTNEXCLUIR` por código); **contabilizar a quebra** não tem botão (a integração
contabiliza) → gate de FRMFECHAMENTOCAIXA. O **log de liberações** (LOG_LIBERACOES) é tela nossa: fica com a opção própria
`FRMLIBERACOES.BTNCONSULTAR`, que o admin concede.

**A tela de configurações não é de PERMISSOES.** `TfrmMenuSuperior.Configuraes1Click` barra `DESABILITA_OPERACOES_BASICAS='S'` e
`TdmPrincipal.TelaConfiguracao` pede `SenhaAdministrativa('ADM')` (uSenhaAdmin.pas). O Apollo exigia FRMCONFIGURA/`BTNGRAVAR`, que
ninguém tem. Agora `@RequerSenhaAdministrativa` (header `x-senha-administrativa`) no catálogo, nos overrides e no default, e também
na gestão das listas `USUARIOS_*` de liberação (moram nas CONFIGURACOES). Aceita a senha ADM da empresa (pelo `SenhaOperacaoService`,
com lockout, como a meta diária do pedido e as parcelas da NF). O legado aceita também a SENHARETAGUARDA de **qualquer** operador e
`SYSAPOLLO<dia><mês>` — as senhas-mestras que o Apollo já tinha decidido não reimplementar (shared/auth/crypto.ts). Smoke §273.
