# PENDÊNCIAS DO OPERADOR (`FRMPENDENCIASOPERADOR`, `UFrmPendenciasOperador.pas` + `UDMPendenciasOperador`) — auditoria controle a controle (15/10/2026)

| | |
|---|---|
| **Tela** | `/compras/pendencias` (`PendenciasPage`) · API `compras/pendencias` (`pendencia-operador.service.ts`, motor `analise-motor.service.ts`) |
| **Uso** | 3.665 acessos (MENUEXPRESS) |
| **Produção** | PENDENCIA_OPERADOR: APN A 540 (última 08/10/2026) · APN E 11 · APN F 1 (2024) · **CFN A 321 (última 14/10/2026; do binário novo — "Finalize na tela de Conferência da nota Fiscal", complemento = CODNF, loja 2)** · RPN 0 |
| **Já convertido** | a fila (o UNION do `QryPendencias`: as minhas ∪ APN/RPN de terceiros para quem está em USUARIOS_PERMITIDOS_LIBERAR_PEDIDO_COMPRA, com a coluna Operador), o fornecedor da análise, abrir a análise (APN), o motor (criar/processar/liberar/refazer/dossiê/excluir conferência) — smoke PENDÊNCIAS corte-2a/2b/2c/pontas |

Os controles do dfm contra a tela:

| Controle do legado | Apollo |
|---|---|
| `QryPendencias` **sem filtro de loja** (a grade tem a coluna "Empresa") | ✅ a fila deixou de filtrar a loja da sessão (o operador da loja 1 não via as CFN da loja 2); a coluna Empresa; a análise abre pela pendência visível, sem amarrar à loja |
| `FormShow` → `DM.AbrePendenciasOperador` (abre carregada) · `BtnAtualizar` | ✅ carrega ao abrir; Atualizar |
| Colunas: Empresa, Operador (só supervisor), Tipo de pendência, Data/Hora, Observação, Ações, Fornecedor, Operador que gerou pendência (Código e Complemento ocultos) | ✅ (Data/Hora com a hora; o status e o filtro de status/tipo são do Apollo — o legado lista todas; o padrão agora é "Todas") |
| "Ações" → "Análise": APN `AbreAnalise`; RPN `GeraNovaAnalise` (nova análise com os mesmos pedidos/notas, finaliza a pendência, abre a nova) | ✅ APN abre; RPN chama `analise/refazer` e abre a nova (o motor já existia; a tela não o chamava) |
| CFN (binário novo, sem fonte) | ✅ atalho "Conferência" → `/compras/conferencia-nota?codnf=` (o que a observação manda fazer) |
| Popup "Salvar/Restaurar configuração da grade" (`StoreToIniFile` por operador) | ✗ a grade é uma tabela simples (sem layout salvo) — documentado |
| — | ⚠️ "finalizar/reabrir" manual por linha é do Apollo (o legado só finaliza pela análise/RPN); mantido e documentado |

Smoke §321; web `pendenciasOperador.spec.tsx`.
