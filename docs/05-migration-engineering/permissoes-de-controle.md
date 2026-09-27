# Permissões de controle (campo e botão) — o `SetStateOfControlsMaster` do legado

Além do acesso à TELA (opção = nome do form) e às ações de gravação (`BTNGRAVAR`, `BTNEXCLUIR`…), o legado tem uma camada de
permissão por CONTROLE: `uMaster.SetStateOfControlsMaster` percorre os componentes do form e, para os que têm **Tag 1 ou 13** e cujo
**nome é uma OPÇÃO de PERMISSOES**, aplica:

| classe do componente | tem a opção | não tem a opção |
|---|---|---|
| botão (TBitBtn, TButton, TJvArrowButton, TcxButton), calc-edit (TJvDBCalcEdit, TJvCalcEdit), checkbox (TJvDBCheckBox) | habilitado | **Tag 1: desabilitado** · Tag 13: oculto |
| item de menu (TMenuItem, TMenu) | habilitado | **Tag 1: desabilitado** · Tag 13: oculto |
| edit comum (TDBEdit, TEdit, memo…) | Tab ligado | só perde o Tab — **continua editável** |

O Apollo só tinha as duas primeiras camadas. A terceira entrou em 27/09/2026:
- `GET cadastro/acesso/opcoes/:form` — as opções do FORM concedidas ao operador (modo usuário/perfil/ambos, como `PossuiAcessoForm`);
- `useOpcoesDoForm(form)` na tela — desabilita o controle que o operador não tem;
- a gravação confere de novo o que muda o dado (quem burlasse a tela não passaria) — ex.: `produto-permissoes.ts`.

## A fila (telas convertidas, opções com efeito real — produção 27/09/2026)

Gerada cruzando PERMISSOES (operadores ativos) × os `.dfm` (classe, Tag, campo) × o que o Apollo já exige. "com/total" = operadores
com a opção / com acesso à tela: quando é igual, hoje ninguém é restringido, mas a regra vale para o próximo operador cadastrado.
Das 150 opções sem equivalente no Apollo, 64 não têm efeito (componente com Tag 0, edit comum ou componente que o binário novo criou).

| tela (acessos) | opção | componente | campo | efeito | com/total | Apollo |
|---|---|---|---|---|---:|---|
| FRMETIQUETA (2.418.712) | `BTNIMPORT` | TBitBtn | - | DESABILITA | 53/53 | ⏳ |
| FRMMANIFESTODFE (67.138) | `BTNPESQUISAAVANCADA` | TBitBtn | - | DESABILITA | 50/50 | ⏳ |
| FRMMANIFESTODFE (67.138) | `BTNPESQUISARULTIMAS` | TBitBtn | - | DESABILITA | 50/50 | ⏳ |
| FRMNF (56.567) | `BTNIMPRIMIRNFE` | TBitBtn | - | DESABILITA | 51/52 | ⏳ |
| FRMNF (56.567) | `BTNINUTILIZARNFE` | TBitBtn | - | DESABILITA | 51/52 | ⏳ |
| FRMNF (56.567) | `CANCELARNFEPELOXML1` | TMenuItem | - | DESABILITA | 51/52 | ⏳ |
| FRMNF (56.567) | `GERARNFE1` | TMenuItem | - | DESABILITA | 51/52 | ⏳ |
| FRMNF (56.567) | `IMPRIMIRDANFE1` | TMenuItem | - | DESABILITA | 51/52 | ⏳ |
| FRMNF (56.567) | `STATUSNFE2` | TMenuItem | - | DESABILITA | 51/52 | ⏳ |
| FRMNF (56.567) | `STATUSNFEPELOXML1` | TMenuItem | - | DESABILITA | 51/52 | ⏳ |
| FRMNF (56.567) | `STATUSSERVIO1` | TMenuItem | - | DESABILITA | 51/52 | ⏳ |
| FRMCADSCRAP (54.015) | `BTNADICIONARITEM` | TBitBtn | - | DESABILITA | 51/51 | ⏳ |
| FRMCADSCRAP (54.015) | `BTNEXCLUIRI` | TBitBtn | - | DESABILITA | 42/51 | ⏳ |
| FRMCADSCRAP (54.015) | `BTNLIMPARI` | TBitBtn | - | DESABILITA | 45/51 | ⏳ |
| FRMAPAGAR (38.546) | `CLETOTALNF` | TJvCalcEdit | - | DESABILITA | 47/47 | ⏳ |
| FRMAPAGAR (38.546) | `EDTPAGO` | TJvCalcEdit | - | DESABILITA | 47/47 | ⏳ |
| FRMAPAGAR (38.546) | `EDTVALOR` | TJvDBCalcEdit | VALOR | DESABILITA | 47/47 | ⏳ |
| FRMCADPRODUTO (38.185) | `BITBTN1` | TBitBtn | - | DESABILITA | 17/51 | "Buscar figura fiscal": o campo (TDBEdit) segue digitável no legado — não trava |
| FRMCADPRODUTO (38.185) | `BITBTN2` | TBitBtn | - | DESABILITA | 40/51 | "Alt. estoque": a ação não existe na tela do Apollo |
| FRMCADPRODUTO (38.185) | `BTNADDDESCOMP` | TBitBtn | - | DESABILITA | 44/51 | ✅ |
| FRMCADPRODUTO (38.185) | `BTNADDITEM` | TBitBtn | - | DESABILITA | 44/51 | ✅ |
| FRMCADPRODUTO (38.185) | `BTNDELITEM` | TBitBtn | - | DESABILITA | 45/51 | ✅ |
| FRMCADPRODUTO (38.185) | `BTNEXCLUIDECOMP` | TBitBtn | - | DESABILITA | 45/51 | ✅ |
| FRMCADPRODUTO (38.185) | `BTNLIMPADECOMP` | TBitBtn | - | DESABILITA | 47/51 | ✅ |
| FRMCADPRODUTO (38.185) | `BTNLIMPARCOMPOSICAO` | TBitBtn | - | DESABILITA | 47/51 | ✅ |
| FRMCADPRODUTO (38.185) | `BTNPRECIFICACAO` | TBitBtn | - | DESABILITA | 27/51 | ✅ |
| FRMCADPRODUTO (38.185) | `CHBATIVO` | TJvDBCheckBox | ATIVO | DESABILITA | 51/51 | ✅ |
| FRMCADPRODUTO (38.185) | `CHBATIVOCOMPRA` | TJvDBCheckBox | ATIVO_COMPRA | DESABILITA | 51/51 | ✅ |
| FRMCADPRODUTO (38.185) | `EDTCUSTO` | TJvDBCalcEdit | VRCUSTO | DESABILITA | 46/51 | ✅ |
| FRMCADPRODUTO (38.185) | `EDTCUSTOREP` | TJvDBCalcEdit | VRCUSTOREP | DESABILITA | 46/51 | ✅ |
| FRMCADPRODUTO (38.185) | `EDTVRVENDA` | TJvDBCalcEdit | VRVENDA | DESABILITA | 49/51 | ✅ |
| FRMCADPRODUTO (38.185) | `MNIDUPLICARPRODUTO` | TMenuItem | - | DESABILITA | 47/51 | "Duplicar produto": a ação não existe na tela do Apollo |
| FRMCADPRODUTO (38.185) | `PRECIFICAODOCUSTO1` | TMenuItem | - | DESABILITA | 46/51 | abre a Precificação pelo custo. que tem o gate próprio |
| FRMEXPORTABALANCA (28.674) | `BTNCONFIGURABAL` | TBitBtn | - | DESABILITA | 45/44 | ⏳ |
| FRMEXPORTABALANCA (28.674) | `BTNEXPORTAR` | TBitBtn | - | DESABILITA | 48/44 | ⏳ |
| FRMPEDIDOCOMPRA (26.385) | `BTNADDBONI` | TBitBtn | - | DESABILITA | 28/34 | ⏳ |
| FRMPEDIDOCOMPRA (26.385) | `BTNADICIONARI` | TBitBtn | - | DESABILITA | 28/34 | ⏳ |
| FRMPEDIDOCOMPRA (26.385) | `BTNBAIXAR` | TButton | - | DESABILITA | 28/34 | ⏳ |
| FRMPEDIDOCOMPRA (26.385) | `BTNEXCLUIRBONI` | TBitBtn | - | DESABILITA | 28/34 | ⏳ |
| FRMPEDIDOCOMPRA (26.385) | `BTNEXCLUIRI` | TBitBtn | - | DESABILITA | 28/34 | ⏳ |
| FRMPEDIDOCOMPRA (26.385) | `BTNLIMPARI` | TBitBtn | - | DESABILITA | 28/34 | ⏳ |
| FRMPEDIDOCOMPRA (26.385) | `MNIATUALIZARTABELAFORNECEDOR` | TMenuItem | - | DESABILITA | 6/34 | ⏳ |
| FRMCADCLIENTES (21.288) | `BTNSALVARNOVOFLEX` | TBitBtn | - | DESABILITA | 47/49 | ⏳ |
| FRMCADCLIENTES (21.288) | `CCDCREDITO` | TJvDBCalcEdit | CREDITO | DESABILITA | 47/49 | ⏳ |
| FRMCADCLIENTES (21.288) | `CHBCLIENTE` | TJvDBCheckBox | CLI | DESABILITA | 49/49 | ⏳ |
| FRMCADCLIENTES (21.288) | `CHBCONVENIO` | TJvDBCheckBox | CON | DESABILITA | 47/49 | ⏳ |
| FRMCADCLIENTES (21.288) | `CHBFORNECEDOR` | TJvDBCheckBox | FRN | DESABILITA | 47/49 | ⏳ |
| FRMCADCLIENTES (21.288) | `CHBFUNCIONARIO` | TJvDBCheckBox | FUN | DESABILITA | 49/49 | ⏳ |
| FRMCADCLIENTES (21.288) | `CHBTRANSPORTADORA` | TJvDBCheckBox | TRA | DESABILITA | 47/49 | ⏳ |
| FRMCADCLIENTES (21.288) | `DBLIVREINDEXADOR` | TJvDBCheckBox | RETIRA_FORNINDEX | DESABILITA | 44/49 | ⏳ |
| FRMCADCLIENTES (21.288) | `JVDBCHECKBOX1` | TJvDBCheckBox | REALIZA_TROCA | DESABILITA | 44/49 | ⏳ |
| FRMCADCLIENTES (21.288) | `VISUALIZARSENHADADOSFINANCEIROS1` | TMenuItem | - | DESABILITA | 47/49 | ⏳ |
| FRMCADCLIENTES (21.288) | `VISUALIZARSENHARALACIONAMENTOS1` | TMenuItem | - | DESABILITA | 47/49 | ⏳ |
| FRMBAIXAAPAGAR (8.512) | `BTNADDRECURSO` | TBitBtn | - | DESABILITA | 36/36 | ⏳ |
| FRMBAIXAAPAGAR (8.512) | `BTNCONSULTA` | TBitBtn | - | DESABILITA | 36/36 | ⏳ |
| FRMBAIXAAPAGAR (8.512) | `BTNDELRECURSO` | TBitBtn | - | DESABILITA | 29/36 | ⏳ |
| FRMBAIXAAPAGAR (8.512) | `BTNPOSTRECURSO` | TBitBtn | - | DESABILITA | 36/36 | ⏳ |
| FRMCONTROLECONTASBANCARIAS (7.617) | `BTNTROCAVALORES` | TBitBtn | - | DESABILITA | 35/35 | ⏳ |
| FRMBAIXACARTAO (7.589) | `BTNCONSULTA` | TBitBtn | - | DESABILITA | 27/27 | ⏳ |
| FRMPRIFICACAOCUSTO (3.346) | `BTNSINCCUSTONAVENDA` | TBitBtn | - | DESABILITA | 28/28 | ⏳ |
| FRMPRIFICACAOCUSTO (3.346) | `CHATIVO` | TJvDBCheckBox | ATIVO | DESABILITA | 28/28 | ⏳ |
| FRMPRIFICACAOCUSTO (3.346) | `CHATIVOCOMPRA` | TJvDBCheckBox | ATIVO_COMPRA | DESABILITA | 28/28 | ⏳ |
| FRMPRIFICACAOCUSTO (3.346) | `EDTMARKUPFIXO` | TJvDBCalcEdit | MARKUPFIXO | DESABILITA | 28/28 | ⏳ |
| FRMPRIFICACAOCUSTO (3.346) | `EDTVRVENDA` | TJvDBCalcEdit | VRVENDA | DESABILITA | 28/28 | ✅ já aplicado (precificacao-custo.service.ts) |
| FRMBAIXAARECEBER (3.197) | `BTNADDRECURSO` | TBitBtn | - | DESABILITA | 30/30 | ⏳ |
| FRMBAIXAARECEBER (3.197) | `BTNCONSULTA` | TBitBtn | - | DESABILITA | 30/30 | ⏳ |
| FRMBAIXAARECEBER (3.197) | `BTNDELRECURSO` | TBitBtn | - | DESABILITA | 29/30 | ⏳ |
| FRMBAIXAARECEBER (3.197) | `BTNPOSTRECURSO` | TBitBtn | - | DESABILITA | 30/30 | ⏳ |
| FRMAGRUPACONTASARECEBER (2.789) | `BTNEXCLUIRDOC` | TBitBtn | - | DESABILITA | 9/35 | ⏳ |
| FRMCADPEDIDODEVOLUCAOCOMPRAS (2.527) | `BTNEXCLUIRITEM` | TBitBtn | - | DESABILITA | 36/41 | ⏳ |
| FRMRELATORIO (1.295) | `BTNEXCLUIMODELO` | TBitBtn | - | DESABILITA | 24/24 | ⏳ |
| FRMRELATORIO (1.295) | `BTNNOVORELATORIO` | TBitBtn | - | DESABILITA | 24/24 | ⏳ |
| FRMAGRUPACONTASAPAGAR (467) | `BTNEXCLUIRDOC` | TBitBtn | - | DESABILITA | 9/33 | ⏳ |
| FRMCADPLC (444) | `BTNADICIONARMOTOP` | TBitBtn | - | DESABILITA | 30/30 | ⏳ |
| FRMCADPLC (444) | `BTNEXCLUIRMOTOP` | TBitBtn | - | DESABILITA | 25/30 | ⏳ |
| FRMCADPLC (444) | `BTNLIMPARMOTOP` | TBitBtn | - | DESABILITA | 30/30 | ⏳ |
| FRMCADCOTACAO (363) | `BTNENVIAREMAIL` | TBitBtn | - | DESABILITA | 23/23 | ⏳ |
| FRMRENTABILIDADECATEGORIAS (275) | `BTNCONSULTA` | TBitBtn | - | DESABILITA | 23/23 | ⏳ |
| FRMDESCONTOTITULO (68) | `BTNCONSULTA` | TBitBtn | - | DESABILITA | 27/27 | ⏳ |
| FRMCONSCLIRCB (64) | `EDTJURO` | TJvCalcEdit | - | DESABILITA | 27/27 | ⏳ |
| FRMMULTATUALIZACAO (63) | `BTNDESFAZER` | TBitBtn | - | DESABILITA | 23/17 | ⏳ |
| FRMMULTATUALIZACAO (63) | `BTNPROCESSAR` | TBitBtn | - | DESABILITA | 23/17 | ⏳ |
| FRMCONSPROD (25) | `BTNCADASTRO` | TBitBtn | - | DESABILITA | 23/23 | ⏳ |
| FRMCADLOTECOBRANCA (20) | `BTNADDITEN` | TBitBtn | - | DESABILITA | 23/23 | ⏳ |
| FRMCADLOTECOBRANCA (20) | `BTNEXCLUIRITEM` | TBitBtn | - | DESABILITA | 18/23 | ⏳ |
| FRMCADUNIDADE (5) | `CHBATIVO` | TJvDBCheckBox | ATIVO | DESABILITA | 19/19 | ⏳ |

## O que a prova da produção já disse

- **Excluir código auxiliar** (`FRMCADPRODUTO.BTNEXCLUIRCODAUXILIAR`): nenhum operador tem a opção, mas a LOG mostra 19 exclusões de
  código auxiliar pelo cadastro desde 2025 — o binário novo exclui por outro caminho. **Não trava** (a opção ficou fora da fila).
- **Preço e custo no produto**: os 6 e 8 operadores sem a opção não gravaram nada no cadastro desde 2025 (evidência neutra); o fonte
  aplica e as permissões são mantidas — aplicado.
