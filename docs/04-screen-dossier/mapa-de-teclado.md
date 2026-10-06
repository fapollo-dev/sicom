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

⏳ Corte 2 (em andamento): as 48 telas com F-keys próprias no legado e tela no Apollo. A lista com o comando de cada tecla está em
`tools/teclado/mapa-teclado.json`.

## Ver também

- [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md)
- [dossier-process.md](dossier-process.md) — o dossiê de cada tela captura o mapa de teclado
