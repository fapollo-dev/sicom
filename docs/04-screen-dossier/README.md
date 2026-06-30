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
| [UCadProduto.md](dossiers/retaguarda/UCadProduto.md) | **Produto** (hub do ERP) | em-revisão | 213 col / 43k linhas / 40 tabelas FK. **F1–F4b verdes**: núcleo+cód.aux+lookups+fiscal+EAN; **MULTI_PRECO** (preço/empresa, reusa `precificacao`); **ESTOQUE** (saldo read-only, edita mín/máx/local); **kit/BOM** (composição/decomposição/receita — decomp 100%, flags derivadas, bloqueio desativar componente); **nutricional+logística** (campos do master). Tela NÃO calcula. F5 movimentação+replicação+golden pendentes |
| [uCadClientes.md](dossiers/retaguarda/uCadClientes.md) | **Parceiros (Cliente/Fornecedor/…)** | em-revisão | tela unificada multi-papel. **F1+F2+F3 verdes**: núcleo+endereços+papéis+CEP+dup-CNPJ+multi-tenant; sub-recursos+abas por papel; **config fiscal completa (retenções/alíquotas/contrib.ICMS/classfiscal) + validador de IE por UF (27)**. Adiado (doc c/ SQL): travas NF/Indexador, Receita/SINTEGRA, config-flags, cálculo de imposto (vive em NF/financeiro) |
| [uNF.md](dossiers/retaguarda/uNF.md) | **Nota Fiscal** (tela-coroa) | **F1+F2+F3+F4+F5+F6 verdes** | **A maior tela do ERP** (uNF.pas 18.262 linhas; NF 209 col/NF_PROD 193 col/~40 tabelas). Recon (5+2+2+2+2+4 inspeções) + 10 auditorias adversariais + code-review sênior. **F1** cadastro (SEM efeitos); **F2** fiscal por item (ICMS/ST/IPI reusando `precificacao`, puro — corrigiu dupla-redução); **F3** processamento (`processar`/`reverter` movem `ESTOQUE.QTDE` atômico, negativo bloqueia, kardex; risco lost-update RESOLVIDO via engine `preservar`/`chaveNatural`); **F4** faturamento (`faturar`/`estornar` geram títulos `ARECEBER`/`APAGAR` por IDNF em **transação atômica**, rateio em centavos Σ=total, idempotente CAS, estorno bloqueado por título quitado; aparecem no Lote); **F5** contábil (rateio `CODCONTABILNF` por centro de custo **PLC** como detalhe do agregado — config armazenada, SEM efeito; situação/CC obrigatórios + par único = HARD, **soma=TOTALNF = ADVISORY** fiel ao legado — 172/22.014 NFs reais desbalanceadas; DIÁRIO/partida-dobrada adiado); **F6** NFe mod.55 atrás da **porta SEFAZ** (transmitir/cancelar/CCe: máquina de estados ''/P/C/D, chave de acesso 44+DV mód 11, eventos 110111/110110 — cancel ≥15 SEM reverter estoque/financeiro, CCe ≥15/máx-20/nSeqEvento; `nfe_evento`/`nfe_xml`/`historico_envio_nfe`; transmissão real adiada atrás da porta, corte 1 = `SimuladorSefazProvider` homologação/`simulado='S'`/gated). Verde: shared 68, API 123, web 25, **smoke 126/0**. **Code-review sênior (5 agentes, legado→migrado):** efeitos = cópia fiel (0 gaps); reforçados locks de edição/exclusão (NF processada/faturada/cancelada não edita/exclui — sem órfãos) + validações F1 (devolução-sem-ref, CFOP item×nota, M55); todos os demais (C) registrados no §10 com procedência. Status = **paridade-verde de resultado** (golden runtime pendente). F6b = transmissão real/DANFE/e-mail/NFC-e/inutilização. Adiado/relaxado documentado com procedência |

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
