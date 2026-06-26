# 04 — Dossiê de Tela

> O **dossiê de tela** é a unidade de trabalho do Apollo (ADR-012): nenhuma tela vira código sem dossiê completo, revisão independente e paridade verde contra o legado. Esta seção tem o **template** preenchível e o **processo** que o move pelo loop fazer→revisar→legado×novo.

## Pré-requisitos de leitura

- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — a tese "contexto é tudo"; o dossiê é sua materialização.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-012** (dossiê = unidade de trabalho e contrato de refatoração).
- [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md) — o loop de trabalho e "uma tela = uma unidade".

## Arquivos da seção

| Arquivo | Para quê |
|---------|----------|
| [dossier-template.md](dossier-template.md) | **Arquivo-coroa.** O template preenchível, seções 1–10: Identidade, UI (`.dfm`→React + reflow), Eventos, **Dados** (toda SQL estática+dinâmica com todos os caminhos), Regras de negócio (o *porquê*), Efeitos colaterais + estado externo (a armadilha de acoplamento), Dependências, TabOrder + mnemônicos, Casos golden, Alvo (NestJS + React + offline). Com exemplos de campo preenchido. |
| [dossier-process.md](dossier-process.md) | O processo: quem faz o quê, o loop por tela, quando uma tela está "concluída" (dossiê + revisão + paridade verde), como o dossiê alimenta backend/frontend/testes, versionar dossiê com o código, e a regra "verde só conta se exercita o caminho real". |

## Ordem de leitura sugerida

1. [dossier-template.md](dossier-template.md) — entenda **o que** um dossiê captura e a profundidade exigida.
2. [dossier-process.md](dossier-process.md) — entenda **como** ele é construído, revisado e fechado.

## Dossiês construídos (`dossiers/retaguarda/`)

> Um por tela migrada. Status: `rascunho` → `em-revisão` → `paridade-verde` → `concluído`. Hoje a paridade é de **resultado** (testes/integração/smoke verdes no novo); o **golden RUNTIME do legado** (captura V$SQL) é a pendência comum para fechar em `concluído`.

| Dossiê | Tela | Status | Notas |
|---|---|---|---|
| [uCadBancos.md](dossiers/retaguarda/uCadBancos.md) | Bancos (piloto) | implementado + revisado | golden capturado; fan-out de replicação = Fase 4 |
| [uCadOperacoesConta.md](dossiers/retaguarda/uCadOperacoesConta.md) | Operações de Conta | em-revisão | paridade OK (default tipo='D', sem uppercase) |
| [uCadMarcas.md](dossiers/retaguarda/uCadMarcas.md) | Marcas | em-revisão | soft-delete; filtro de read corrigido no engine |
| [uCadNCM.md](dossiers/retaguarda/uCadNCM.md) | NCM | em-revisão | NCMSH derivado; +CATEGORIA/UN_TRIBUTADA |
| [uCadCidades.md](dossiers/retaguarda/uCadCidades.md) | Cidades | em-revisão | FK UF (IDUF=IBGE confirmado) |
| [uCadBairros.md](dossiers/retaguarda/uCadBairros.md) | Bairros | em-revisão | tela NOVA sobre tabela real (sem form legado) |
| [UCadTabelaPreco.md](dossiers/retaguarda/UCadTabelaPreco.md) | Tabela de Preço | em-revisão | VALOR_REAJUSTE percentual; CkbReajuste |
| [UCadContasBancarias.md](dossiers/retaguarda/UCadContasBancarias.md) | Contas Bancárias | em-revisão | completa; FK Plano de Contas + Operadores deferidos |
| [UCadLoteCobranca.md](dossiers/retaguarda/UCadLoteCobranca.md) | Lote de Cobrança | em-revisão | master-detail; ARECEBER/PARCEIROS migradas; juros |
| [uCadClientes.md](dossiers/retaguarda/uCadClientes.md) | **Parceiros (Cliente/Fornecedor/…)** | em-revisão | tela unificada multi-papel (CLI/FRN/FUN/TRA/CON). **F1+F2 verdes**: master+endereços+papéis+CEP+dup-CNPJ+multi-tenant; sub-recursos (bancos/pgto/relacionamentos/vendedores) + abas condicionais por papel + fiscal essencial. F3–F4 (fiscal completo/retenções+Receita/SINTEGRA; replicação+golden+cutover) pendentes |

## O que esta seção exige (resumo)

- **Toda** SQL reconstruída — estática e dinâmica, com **todos** os caminhos condicionais, confirmada em **runtime**.
- **Toda** regra de negócio com o *porquê* e procedência (`.pas`/`.dfm`/runtime/datamodule).
- **Todo** efeito colateral em estado externo mapeado — datamodules globais, triggers, escritas-fantasma.
- **Mapa de teclado** extraído do `.dfm` (taborder + mnemônicos + F-keys).
- **Golden** capturados do legado cobrindo cada condicional e regra.
- **Revisão** independente + **paridade verde** que exercita o caminho real.

## Ver também

- [../03-legacy-analysis/](../03-legacy-analysis/) — de onde vem o conteúdo do dossiê (anatomia Delphi, SQL dinâmica, regra de negócio, acoplamento oculto).
- [../02-stack-and-standards/keyboard-ux-layer.md](../02-stack-and-standards/keyboard-ux-layer.md) — o mapa de teclado do `.dfm` (seção 8 do dossiê).
- [../06-testing-quality/](../06-testing-quality/) — onde os golden viram teste de paridade e Playwright.
- [../08-agents/roster.md](../08-agents/roster.md) — os papéis que executam o processo.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-012.
