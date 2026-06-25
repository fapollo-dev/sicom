# Glossário (cola de alinhamento)

> Vocabulário cruzado Delphi ↔ ERP-fiscal-BR ↔ stack moderna. Use para alinhar termos entre
> agentes e evitar tradução errada de conceito.

## Delphi / VCL

| Termo | O que é | Equivalente/nota no alvo |
|-------|---------|--------------------------|
| `.dpr` | Arquivo de projeto (entry point) | Configuração do app / `main.ts` |
| `.pas` | Unit de código Object Pascal (lógica, eventos) | Service/controller (NestJS) ou componente (React) |
| `.dfm` | Form: árvore de componentes serializada (layout + props + bindings de evento) | JSX + props; **fonte parseável** para scaffold e mnemônicos |
| `.dproj` | Config do projeto (build) | `package.json` / config de build |
| `TForm` | Janela/tela | Página/rota React |
| `TDataModule` | Container não-visual de datasets/conexões **compartilhado entre forms** | **Armadilha de estado global** — ver [../03-legacy-analysis/hidden-coupling-traps.md](../03-legacy-analysis/hidden-coupling-traps.md) |
| `TQuery`/`TFDQuery` | Dataset com SQL (design-time no `.dfm` e/ou runtime no `.pas`) | Repository/query builder (Kysely/Knex/TypeORM) |
| `TDataSource` | Liga dataset a controles (data-binding) | Estado + data-fetching (React Query) |
| `TabOrder` | Ordem de tabulação (propriedade por controle) | Ordem do DOM + `tabindex="0"` + foco programático |
| `KeyPreview`/`OnKeyDown` | Tratamento de tecla no nível do form | Shortcut provider central (seção 02) |
| `TActionList` | Lista de ações com atalhos | Registro central de comandos/atalhos |
| `&` no Caption | Mnemônico (Alt+letra, letra sublinhada) | Camada de teclado própria (não `accesskey`) |
| Horse | Microframework web Delphi (estilo Express) usado no sync do PDV | Será substituído pelo protocolo de sync (seção 05) |
| BDE / FireDAC | Camadas de acesso a dados | Driver Postgres + repository |
| ECF / SAT / NFC-e | Emissão fiscal no PDV | Motor fiscal (risco-coroa) |

## ERP / Fiscal-BR

| Termo | O que é |
|-------|---------|
| **Retaguarda** | Back-office: cadastros, compras, estoque, financeiro, preço, fiscal central |
| **Balcão** | Atendimento/venda assistida |
| **PDV** | Ponto de venda (caixa); offline-first, periféricos |
| **NFC-e** | Nota Fiscal de Consumidor eletrônica (varejo) |
| **NF-e** | Nota Fiscal eletrônica (entre empresas; entrada/saída) |
| **SAT-CF-e** | Sistema Autenticador e Transmissor (cupom fiscal eletrônico, SP) |
| **SPED / EFD** | Escrituração Fiscal Digital; arquivos periódicos ao fisco — **mesmo prazo p/ todos** (dia pesado) |
| **TEF** | Transferência Eletrônica de Fundos (cartão); Sitef/PayGo, pinpad |
| **ICMS ST / DIFAL** | Substituição tributária / diferencial de alíquota — regras **por UF** |
| **Contingência** | Emissão fiscal quando SEFAZ/internet cai; transmite depois (requisito legal) |
| **Certificado A1/A3** | Certificado digital (arquivo A1 / token-cartão A3) p/ assinar documentos fiscais |
| **CNAB** | Layout bancário (boletos, remessa/retorno) |
| **Curva ABC / ruptura** | Análises de varejo (giro de produto / falta em gôndola) |
| **EAN-13 com peso** | Código de barras de produto pesável (balança embute peso/preço) |

## Stack moderna (alvo)

| Termo | Papel no Apollo |
|-------|-----------------|
| **NestJS** | Backend modular (monólito modular; web + worker) |
| **React + Vite + TypeScript** | Frontend; mesma app em browser e Electron |
| **PostgreSQL** | Banco-alvo (db-per-tenant); primário + read replica |
| **Electron** | Casca do PDV e de superfícies teclado-pesado (devices + controle total de teclado) |
| **BullMQ + Redis** | Fila do worker tier (fechamento fiscal, batch, relatório) |
| **Kysely/Knex/TypeORM** | Acesso a dados / query builder (reconstrói a SQL dinâmica do Delphi) |
| **Playwright** | E2E estruturado, inclusive fluxos de teclado |
| **Read replica** | Cópia read-only (replicação automática) p/ leitura pesada |
| **Materialized view / rollup** | Pré-agregação p/ relatório (read model leve) |
| **Expand/contract** | Padrão de migration sem downtime (parallel change) |
| **Strangler** | Estratégia de migração incremental (legado convive e é "estrangulado") |

## Ver também
- [mission-and-principles.md](mission-and-principles.md) · [canonical-decisions.md](canonical-decisions.md)
