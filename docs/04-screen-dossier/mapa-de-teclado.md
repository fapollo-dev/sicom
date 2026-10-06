# Mapa de teclado do legado → Apollo

> As teclas de cada tela, extraídas do `.pas`/`.dfm` (ADR-010: "replicar o mapa exato, não modernizar") e o estado no Apollo.

Pré-requisitos: [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) (a camada) ·
[../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) (ADR-010).

## A extração

`tools/teclado/extrair-mapa-teclado.py` lê as units do `Retaguarda.dpr` (as cópias `_Old` ficam fora) e grava
`tools/teclado/mapa-teclado.json`: por formulário, a classe-base, as teclas tratadas no `FormKeyDown`/`FormKeyUp`/`FormKeyPress` (com
o comando de cada uma, inclusive `case Key of` aninhado), os `ShortCut` de `TAction`/`TMenuItem` e os botões `Default`/`Cancel`.
06/10/2026: 858 formulários; 175 com teclas próprias; 48 deles com tela no Apollo.

## As teclas que toda tela herda

| base | tecla | o legado | no Apollo |
|---|---|---|---|
| `TfrmMaster` (364 telas + todas as bases) | Esc | `Self.Close` | volta ao **Início** (o menu sem tela aberta); com janela/menu aberto por cima, o Esc é dela |
| | Enter | vira Tab fora das grades (`Keybd_event(VK_TAB)` no `FormKeyPress`) | Enter-avança no conteúdo da tela (`useEnterAdvances`); não avança em grade (`role="grid"`) nem em campo `data-enter="nativo"` |
| | Alt+← | `Perform(WM_NEXTDLGCTL, 1, 0)` — controle anterior | `focarAnterior` |
| | Ctrl+E | `dmPrincipal.TrocarEmpresa(True)` — as lojas do operador por fantasia, troca sem novo login (não com o pedido de compra aberto) | janela "Empresas" + `POST /auth/trocar-empresa` (token novo com a empresa); a tela recarrega |
| | Ctrl+Shift+S / D | salva/apaga o "status da tela" (`TStatusTela`, tabela `CONFIG_STATUS_TELA`) nas telas liberadas | ⏳ na produção só a Pesquisa usa (26 registros); a tabela não está no destino — corte próprio |
| `TfrmCadMaster` | F3 | Pesquisa, fora de inclusão/edição (`FormKeyUp`) | `CadMaster` |
| | F6 | cicla o `rdgAtivo` "Ati&vo [F6]" Sim → Não → Todos (o filtro com que a Pesquisa abre) | `CadMaster` mostra "Ativo [F6]" e a Pesquisa abre com a situação; dentro da Pesquisa o F6 é dela |
| | Esc | em inclusão/edição não fecha (`Exit`) | `CadMaster` segura o Esc fora de consulta |
| | Alt+O | menu Outros | mnemônico do botão `&Outros` |
| `TfrmConsMaster` | F10 / F11 | consulta / imprime | as duas herdeiras (consulta de NF e de vendas) não têm tela no Apollo |
| `TFrmRelMaster`, vários | F10 | `CopyQuery` — copia o SQL (ferramenta de desenvolvedor) | fora (não é operação) |

**Teclas que o navegador reserva** (F11, F5, Ctrl+N/T/W): o Apollo registra os atalhos do legado mesmo assim; numa aba comum o
navegador pode ficar com a tecla — na casca Electron (ADR-008) elas chegam à tela.

## As teclas próprias de cada tela

Corte 2 (06/10/2026): as telas com F-keys próprias no legado e tela no Apollo, pelo `FormKeyDown`/`FormKeyUp`/`ShortCut` de cada
form (o comando de cada tecla está em `tools/teclado/mapa-teclado.json`). **Lacuna** = a ação que a tecla chama não existe na tela do
Apollo (a tecla entra quando a ação entrar); **dev** = ferramenta de desenvolvedor (`CopyQuery`), fora.

| form | tela | no Apollo | lacuna (por quê) |
|---|---|---|---|
| `FRMNF` | Nota fiscal | F7 lançamentos contábeis · F9 financeiro › cobrança ("Selecione uma nota fiscal!" sem nota) · no código de barras do boleto, Enter vai à próxima parcela e Tab não sai (o `FormShortCut`) | F1 Calcular e F4/F5/F6 (os totais são calculados no servidor, só leitura) · F11 formas de pagamento (aba futura) · Ctrl+D decomposição da linha corrente |
| `FRMPEDIDOCOMPRA` | Pedido de compra | F7 adicionar item (com a permissão `BTNADICIONARI`) | F2/F12/Ctrl+F1 tipo de busca · F4/F5 abas · F6 análise · F8 coletor · F9 limpar · F10 excluir item corrente · F11 "compra para" |
| `FRMMANIFESTODFE` | Manifesto DF-e | F2 consulta na SEFAZ · F3 pesquisa · T marca/desmarca | F5 últimas NF's (90 dias) |
| `FRMFATURAMENTO2` | Faturamento | F2 processar · F4 bonificar | — |
| `FRMEXPORTANFE` · `FRMNFANALISE` · `FRMRELPEDIDOCOMPRA` | Exporta NF-e · Análise de NF · Pedidos | F3 busca · F11 imprime · F10 gera / F11 imprime | T e F5 da exportação (sem seleção / linha corrente) |
| `FRMCONFERENCIANOTA` · `FRMCONFERENCIANFINDEXADOR` | Conferências | T/D marca/desmarca · F2 busca / F10 exporta | F3 Pesquisa de NF · F8/F9 layout da grade em .ini (no Apollo é o layout salvo da grade) |
| `FRMPRECIFICACAONF` | Precificação da NF | F2 produto · F4 precificação por custo · F5 nota · F6 financeiro · T na grade | — |
| `FRMCADCOTACAOFORN` · `FRMTROCAMERCADORIAFOR` | | — | F2/F4 da troca (linha corrente, PLU×barras) |
| `FRMPESQUISA` | Pesquisa | F3 limpa e foca o filtro · F5 limpa busca e filtros · F6 situação (escopo próprio: com ela aberta, as teclas são dela) | F7 sub-select · F4 salvar layout · Alt+H ordenar pela coluna focada · Ins/F2 abrir o cadastro da view · atalhos de detalhe |
| `FRMCADPRODUTO` | Produto | F5 foca o fator caixa | F7 análise do produto · F12 preço no PDV · F2 PLU×barras · F4 ir para a NF de decomposição · F5 da receita · Ctrl+A locate do estoque · F10 estoque por empresa |
| `FRMCADAGENDAPROMOCAO` | Agenda de promoção | F2 limpa e foca o produto do adder | F3 opções abertas/fechadas + Pesquisa |
| `FRMCADPROMOCAOACUMULATIVA` | Promoção acumulativa | F3 foca a situação do filtro (o `ChamaTelaOpcoes`) | — (a condição "foco no código" não existe: a tela não tem o campo) |
| `FRMAJUSTEPRECOS` | Ajuste de preços | T marca/desmarca todos (fora de campo de digitação) | — |
| `FRMMULTATUALIZACAO` | Mult atualização | F3 busca | F4 salvar configuração · Alt+H |
| `FRMETIQUETA` | Etiqueta | F2 imprime (toda a tela) | — |
| `FRMCADPRODUCAO` · `FRMCADSCRAP` · `FRMPRECIFICACAONFBRUTA` · `FRMDIGITACAOPEDIDOS` · `FRMPOSICAOPRODUTO` | | — | as teclas abrem ações que as telas não têm (abas, linha corrente, troca de produto, importação de perdas, digitação de pedido, multiempresa) |
| `FRMBAIXAARECEBER` | Baixa a receber | F9 foco no "Adicionar recurso" | F8 taxa de juros (o campo não existe) |
| `FRMCONSAPGBX` · `FRMCONSRCBBX` | Consultas de baixa AP/AR | F3 recarrega o lote (aberta com lote) ou busca os lotes | — |
| `FRMCONSCLIRCB` | A receber do cliente | F8 foco nos juros (depois da consulta) | F6 situação da pesquisa de cliente |
| `FRMRELFINANCEIRO` | Relatório financeiro | F9 consulta | F10 dev |
| `FRMFLUXOCARTOES` | Fluxo de cartões | F3 gera · Ctrl+A exporta | — |
| `FRMRELENTRADAS_FINAN` | Entradas × financeiro | F9 consulta · F11 imprime (com o Enabled do botão) | — |
| `FRMCADARECEBER` · `FRMCADCLIENTES` · `FRMDESCONTOTITULO` · `FRMCADCARTAO` · `FRMSALDOEMPRESA` | | — | Alt+F4/Esc do modo faturamento · filtro e opções do F3 · Ctrl+N/Ctrl+A das abas do cliente · F2 log local · F3 Pesquisa do cartão · Alt+I menu Outros |
| `FRMCONFIGDRECONTABIL` | Configurador do DRE | **sem as teclas da base** (`inherited` comentado) | F3 Pesquisa |
| `FRMCADPLANOCONTAS` | Plano de contas | **sem as teclas da base** · F3 foca a busca da árvore | — |
| `FRMCADPLC` | Centro de custo | Ctrl+Ins conta raiz (o Adicionar) | Shift+Ins conta derivada · Ctrl+I composição |
| `FRMRELLANCAMENTOSCONTABEIS` | Lançamentos contábeis | Ctrl+A exporta a grade · Ctrl+B CSV | Ctrl+X TXT · F10 dev |
| `FRMFECHAMENTOCAIXA` | Fechamento de caixa | F5 caixas do dia | Alt+I menu do Imprimir |
| `FRMFECHAMENTODIARIO` | Fechamento diário | F8 fecha tudo · F9 reabre tudo | F6/F7 dia sob o cursor · F11 apaga a trava `RES_ALIQ_60D` |
| `FRMRELFINALIZADORAS` | Finalizadoras | F10 consulta · F11 imprime | — |
| `FRMRENTABILIDADECATEGORIAS` | Rentabilidade | F9 gera — **com a permissão do botão** (no legado o F9 chama o click direto e passa por cima do Tag) | — |
| `FRMRELATORIOCAIXA` · `FRMRELATORIO` · `FRMCADUSUARIOS` · `FRMCONSULTORIAATM` | | — | F1 caminho do arquivo · Enter na grade de campos · F2 perfil por cima · (Esc da base, F10 dev) |

Corte 3 (06/10/2026): as janelas chamadas por outra tela (0 acesso no `MENUEXPRESS`) cuja página no Apollo citava a unit, não o form.
Cada uma registra as teclas num filho do `Modal` (o escopo da janela). Teste: `apps/web/test/teclasJanelasNf.spec.tsx`.

| form | no Apollo | teclas | lacuna (por quê) |
|---|---|---|---|
| `FRMITENSNF` | item da NF (`NfItemModal`) | Esc = Cancelar · F6 fator de embalagem · F9 abre a lista do CFOP · **sem `inherited`**: Ctrl+E e Alt+← não passam da janela · letras &Ok/&Cancelar | F2 cadastro do produto por cima (aqui é tela: sair dela perderia a nota) · F5 indexador do item · F7 PLU × EAN · F8 situação do item · F10 estoque por empresa · F11 declaração de importação |
| `FRMESTOQUENF` | processar a nota (`NfProcessarModal`) | F7 preço / F8 custo de todos pelo item corrente invertido (era ouvinte cru) · &Processar/&Cancelar | F4/F5/F6 estoque depósito/loja/produção · F9 valor a pagar · F10 código de barras · Alt+D formas de pagamento (o faturamento não está na janela) |
| `FRMFINANCEIRONOTAFISCAL` | parcelas da nota processada (aba Financeiro) | F9 código de barras da 1ª parcela (com a cobrança aberta; fora dela o F9 é o da nota, que a abre) · Enter/Tab do código de barras (o `FormShortCut`, o mesmo do uNF) | F8 valor a faturar (a base vem do servidor) |
| `FRMPRECIFICACAOPRODUTO` | item do pedido de compra (`PedidoCompraItemModal`) | F3 quantidade (1ª loja aberta) · F5 desconto R$ · F9 confirma · F11 sugerida → praticada + margem · letras [F9] - &Confirma/&Sair | F2 "Custo Embalagem" (aqui o custo é unitário) |
| `FRMCONSMOVBANCARIAS` | detalhamento do controle de contas | F3 foca o filtro do documento (o "Filtro por Cheque" fica sempre à vista) | — |
| `FRMLANCAMENTOCONTABILNF` · `FRMSINCRONIZACFOPNOTAFISCAL` | aba Lançamentos contábeis · sincronizar CFOP | só o Enter na grade (o Apollo não avança em grade) · letras do .dfm | — |
| `FRMCONSULTASITUACAODOCUMENTO` · `FRMANALISAITEMNF` · `FRMCONFIGURA` | | — | as janelas não existem (a situação é uma lista; a análise é um botão da nota); F5 da grade do ConfigDB.xml |
| `FRMNFCE` | | — | é a Consulta NFC-e (⛔ PDV na fila), não o Fechamento de Sangria (`FRMFECHAMENTOSANGRIA`, sem unit no `Retaguarda.dpr`) |

**Menu "Outros" fora.** Os `ShortCut` dos itens do `ppmBotaoOutros` (Ctrl+L clonar, Ctrl+E etiquetas, Ctrl+N espelho… da NF;
Ctrl+I da cotação) não disparam no legado: o menu só é `DropDown` de um `TJvArrowButton` sem foco, e na VCL o atalho de popup só vale
pelo `PopupMenu` do controle focado (`TWinControl.IsMenuKey`). Ligá-los mataria o Ctrl+E da base na NF.

**Telas sem as teclas da base.** Onde o `FormKeyDown`/`FormKeyPress` tem o `inherited` comentado, a tela é envolvida em
`TeclasDaBaseDesligadas` (`shared/keyboard`): Esc, Ctrl+E, Alt+← e Enter-avança não valem, as teclas próprias sim.

**Fora do Apollo.** Das 178 telas com teclas próprias, 118 não têm tela ligada pelo nome do form. Pelo `MENUEXPRESS` da produção:
as de menu com uso (agenda de atendimento, cheques, inventário, controle de funcionários, transferência, apuração ST/CIAP, mapa de
carga…, de 92 acessos para baixo) entram com a conversão de cada uma; as de 0 acesso são janelas chamadas por outra tela — as que
já têm equivalente no Apollo estão no corte 3 (abaixo). Atenção ao contar acesso por form: o `MENUEXPRESS` tem uma linha por
operador e menu — `max(MENU)` num `GROUP BY FORMULARIO` mistura nomes (o FRMNFCE pareceu "Fechamento de Sangria"; é a Consulta NFC-e).

## Mnemônicos (`&`)

`tools/teclado/conferir-mnemonicos.py` compara os rótulos de cada tela com as legendas do `.dfm` do form que ela cita (todo controle
com `Caption`, menos cabeçalho de grade) e grava `tools/teclado/mnemonicos.json`. 06/10/2026: **0 divergências** — saíram 371 `&` que o
legado não tem e entraram/corrigiram-se 40 letras do legado (abas da NF e da apuração de ICMS, &Cancelar da baixa, &Sair dos diálogos…).
Exceções com o porquê ficam em `EXCECOES` no próprio script (ex.: botão repetido por linha de grade não leva letra).

Regras da camada (`shared/keyboard`):
- **Uma tecla, um controle.** Com dois controles na mesma letra, só um aciona (o `CM_DIALOGCHAR` da VCL para no primeiro que aceita):
  no mesmo escopo, o montado por último; desabilitado ou fora da tela passa ao próximo. Antes, Alt+C acionava os dois &Cancelar da baixa.
- **Letra do legado ganha.** Se a letra do `.dfm` colide com a de um rótulo que só existe no Apollo, o do Apollo perde a letra.
- **Janela = escopo próprio.** O `Modal` de `shared/ui` (todas as telas o usam) abre um escopo: com a janela aberta, as letras dela vêm
  antes das da tela, e o `&` dos botões do rodapé vale (o DS desenhava "&Sair" cru). A pergunta inline (o `MessageDlg`) também.
- **Abas.** A legenda da aba com `&` abre a aba (`Tabs`), como o `TTabSheet`.

**Testes.** `apps/web/test/teclasDaBase.spec.tsx` e `pesquisa.spec.tsx` (jsdom) e `apps/web/e2e/teclado.e2e.ts` (Playwright, app real —
[../06-testing-quality/playwright-e2e.md](../06-testing-quality/playwright-e2e.md)).

## Ver também

- [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md)
- [dossier-process.md](dossier-process.md) — o dossiê de cada tela captura o mapa de teclado
