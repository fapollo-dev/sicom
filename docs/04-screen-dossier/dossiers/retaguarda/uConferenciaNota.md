# CONFERÊNCIA DE NOTA FISCAL (`FRMCONFERENCIANOTA`, `uConferenciaNota.pas`) — auditoria controle a controle (14/10/2026)

| | |
|---|---|
| **Tela** | `/compras/conferencia-nota` (`ConferenciaNotaPage`) · API `compras/conferencia-nota` (`conferencia-nota.service.ts`) |
| **Uso** | 5.695 acessos (MENUEXPRESS; também aberta pelo Manifesto) |
| **Produção 2026** | NF_PROD.PRODUC_STATUS: CONFERENCIA OK 7.334 (do coletor), BLOQUEADO 3, LIBERADO 4; nenhuma aprovação (CODOPERADOR_APROVA_COLETA) em 2026 |
| **Já convertido** | abrir pelo código / pelo Manifesto (`?codnf=`), T/D marca e desmarca (FormKeyPress), Aprovar com liberação `USUARIOS_APROVAM_CONFERENCIA_NOTA` (o código do autorizador fica gravado) + `NF_STATUS_PROCESSO` stConferencia, Cancelar, Análise produto (LIBERADO + desregistra coleta/conferência), Lista de conferência / de usuários, Relatório de diferenças (fornecedor × produto, período com hora, filtros) — smoke (CONFERÊNCIA …, §107, [imprimir]) |

Os 41 controles do dfm contra a tela:

| Controle do legado | Produção | Apollo |
|---|---|---|
| `btnPesquisa` (`CarregaNF` :621 — a Pesquisa da `GET_NF` só `TIPO = 'E'`) | — | ✅ "Pesquisar nota" (`fiscal/nf` tipo E) |
| `LblStatusLote` "Status: …" (`PreencheStatusLote` :1094 — Σ coletado × Σ da nota: Não/Parcialmente/Totalmente coletado) | — | ✅ `statusDaConferencia` ao lado da nota |
| `dbgridDrawColumnCell` :745 — divergente/BLOQUEADO vermelho, APROVADO verde, LIBERADO azul, selecionado em negrito | — | ✅ as cores do status (o divergente já era vermelho) |
| `edtCodBarra` "Pesquisa Cod. Barras" (`edtCodBarraKeyDown` :810 — só dígitos; Enter localiza e filtra; "Código de barras não encontrado.") | — | ✅ o Localizar filtra; o Enter com um código que não está na nota avisa |
| `RgpTipoConferencia` "Por lote de notas fiscais" + `BtnNovoLoteNF`/`BtnVisualizarLote` (`TFrmLoteConferenciaNF`, `LOTE_CONFERENCIA_NF[_REL]`, `GET_LOTE_CONFERENCIA_NF`) | **morto**: 4 lotes (BRF/ARCOM/"TESTE AGUA BRANCA"/AGUA), todos de 2021-22, 6 vínculos | ✗ fora (documentado) |
| `btnAprovar` / `btnAnaliseProduto` "Liberar" / `btnCancelar` / `BtnSair` · menu Relatório / Lista de Conferência / … Usuários · painel do relatório (período, hora, fornecedor, departamento, grupo, produto, Imprimir, Sair) · `[T]`/`[D]` | — | ✅ já havia |
| "A nota selecionada não pertence a empresa logada." / "A nota não foi encontrada." | — | ✅ (a leitura é da loja da sessão: "Nota fiscal não encontrada nesta empresa.") |

Sem permissões de controle (nenhum controle com Tag 1 — a produção não tem linha de FRMCONFERENCIANOTA em PERMISSOES). Web `conferenciaNotaPage.spec.tsx`.
