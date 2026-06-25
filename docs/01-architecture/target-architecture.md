# Arquitetura-Alvo (3 camadas)

> A topologia de referência do Apollo: nuvem central multi-tenant, edge por loja e PDV por caixa — e a costura limpa entre tempo-real e analítico que decide o que roda onde.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-001 (híbrido edge+nuvem por design), ADR-008 (PDV offline-first).
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — o risco-coroa fiscal e a contingência offline como driver.
- [../00-orientation/glossary.md](../00-orientation/glossary.md) — Retaguarda, Balcão, PDV, Horse, contingência.

## A regra que ancora tudo (ADR-001)

O PDV **não pode cair quando a internet cair**. Essa é uma restrição **física**, não uma preferência de design. Dela decorre a separação que estrutura toda a plataforma:

> **Caminho operacional/tempo-real roda no edge/local. Back-office/analítico roda na nuvem.**

A venda, o balcão, a abertura de caixa, a emissão fiscal do cupom — tudo que o operador toca no segundo a segundo — vive perto dele, na loja. A consolidação multi-loja, o cadastro mestre de produto, a apuração de SPED, o BI, o painel do dono da rede — tudo que tolera latência de WAN e quer visão única — vive na nuvem. A latência de uma consulta de margem por seção que demora 800ms na nuvem é **irrelevante**; a mesma latência num item de cupom é **inaceitável**. A arquitetura é o desenho dessa fronteira.

Isto **não é escolha do cliente**. Mesmo o supermercado de uma loja só tem edge — o edge pode ser um container no mesmo PC do balcão, mas existe. A topologia muda (seção [deployment-topologies.md](deployment-topologies.md)); a divisão tempo-real/analítico, não.

## As 3 camadas

```
                          ┌───────────────────────────────────────────────────┐
                          │  CAMADA 1 — NUVEM CENTRAL (multi-tenant)          │
                          │  NestJS (web+worker) · PostgreSQL (db-per-tenant) │
                          │  React (retaguarda/BI no browser)                 │
                          │                                                   │
                          │  retaguarda · cadastros mestre · compras · preço  │
                          │  consolidação multi-loja · BI · fiscal central    │
                          │  (apuração SPED/EFD, NF-e de entrada/saída)       │
                          └───────────────▲───────────────────────────────────┘
                                          │  WAN (internet)
                          sync assíncrono │  contrato backward-compatible
                          (sucessor Horse)│  resiliente a queda de link
              ┌───────────────────────────┴────────────┐   ┌───────────────────────────┐
              │  CAMADA 2 — EDGE DA LOJA A              │   │  CAMADA 2 — EDGE DA LOJA B │
              │  store server containerizado           │   │  (mesma imagem)            │
              │  auto-atualizável · sobrevive a queda   │   │                            │
              │  de WAN · serve os PDVs na LAN          │   │  ...                       │
              │  Postgres/embedded local da loja        │   │                            │
              └───┬───────────────┬───────────────┬─────┘   └────────────────────────────┘
                  │ LAN           │ LAN           │ LAN
        ┌─────────▼───┐   ┌───────▼─────┐   ┌─────▼───────┐
        │ CAMADA 3    │   │ CAMADA 3    │   │ CAMADA 3    │
        │ PDV caixa 1 │   │ PDV caixa 2 │   │ PDV caixa 3 │
        │ Electron    │   │ Electron    │   │ Electron    │
        │ SQLite local│   │ SQLite local│   │ SQLite local│
        │ offline-1st │   │ offline-1st │   │ offline-1st │
        │ periféricos │   │ periféricos │   │ periféricos │
        └─────────────┘   └─────────────┘   └─────────────┘

REGRA DE OURO: PDV → fala com o EDGE. NUNCA direto com a nuvem.
```

### Camada 1 — Nuvem central multi-tenant

O cérebro analítico e de retaguarda. Stack: NestJS (monólito modular deployado em papéis web/worker — ADR-006), PostgreSQL em modelo **db-per-tenant** (ADR-003), React/Vite para as telas de back-office e BI rodando no browser.

Responsabilidades:

- **Retaguarda e cadastros mestre** — produto, fornecedor, cliente, tabelas de preço, estrutura mercadológica. A fonte de verdade do cadastro é central; o edge recebe uma cópia operacional.
- **Compras e suprimentos** — pedido, entrada de NF-e (XML), conferência, custo.
- **Preço e promoção** — formação de preço, vigência, política por loja/rede; **publica** preço para os edges.
- **Consolidação multi-loja** — visão única da rede (todas as filiais do tenant no mesmo banco — ADR-003).
- **BI / analítico** — relatórios, curva ABC, ruptura, painéis. Lê de **read replica + rollups** (ADR-007), nunca degradando o caminho operacional.
- **Fiscal central** — apuração SPED/EFD, NF-e de entrada/saída, escrituração. O *risco-coroa* (ver [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md)); módulo **pinável** independente (ADR-010).

A camada 1 é **stateless no compute** e roteia por tenant (ver [tenancy-and-data.md](tenancy-and-data.md)). Cargas pesadas saem da API e vão para o worker tier (ver [workload-tiers.md](workload-tiers.md)).

### Camada 2 — Edge por loja

O **sucessor conteinerizado** do par "1 servidor de banco + 1 servidor de aplicação" que o Delphi montava em cada loja. No legado, isso era instalado e atualizado à mão, máquina física na sala dos fundos. No Apollo é um **store server containerizado**, **auto-atualizável** e **idêntico em toda loja** (mesma imagem — ADR-002).

Responsabilidades:

- **Servir os PDVs na LAN** — os caixas falam com o edge por rede local, latência de milissegundos, independente da WAN.
- **Sobreviver à queda de WAN** — se a internet da loja cai, a loja continua vendendo. O edge tem o estado operacional necessário (preço vigente, cadastro de produto da loja, saldo de estoque local, sequência fiscal) para operar autônomo.
- **Sincronizar com a nuvem** — quando o link está de pé, o edge é o ponto que **empurra** vendas/movimento para a nuvem e **puxa** cadastro/preço da nuvem. É o ponto de costura do sync.
- **Concentrar a loja** — múltiplos PDVs convergem no edge; o edge é quem fala com a nuvem, não cada PDV individual.

> Conceitualmente, **o edge é o sucessor do sync Horse atual** (o microframework Delphi estilo Express que hoje faz a ponte PDV↔retaguarda). O que o Horse fazia de forma artesanal, o edge faz de forma conteinerizada, versionada e resiliente. O protocolo detalhado de sincronização está em [../05-migration-engineering/sync-protocol.md](../05-migration-engineering/sync-protocol.md).

O edge fica em versões **possivelmente diferentes** da nuvem em campo — por isso o contrato de sync é **backward-compatible** e tolera janela de 1 versão (ADR-009).

### Camada 3 — PDV por caixa

O caixa em si. App **Electron** (ADR-008) com banco **local embedded (SQLite)**, **offline-first**: vende 100% sem rede.

Responsabilidades:

- **Vender offline** — registrar itens, aplicar preço, fechar cupom, emitir documento fiscal — tudo sem depender de WAN nem do edge estar online (degradação graciosa: o PDV prefere o edge, mas tem o mínimo local para não parar).
- **Controlar periféricos** — impressora fiscal, balança (EAN-13 com peso), pinpad/TEF, gaveta, leitor. Electron dá acesso a USB/serial e **controle total do teclado** que o browser não dá (ADR-008, ADR-010).
- **Emitir em contingência fiscal** — quando SEFAZ/internet cai, emite em contingência e transmite depois. Requisito legal que é **driver de arquitetura**, não feature opcional (ver [offline-edge-sync.md](offline-edge-sync.md)).
- **Reconciliar com o edge** — quando o link LAN volta, o PDV envia o que vendeu offline ao edge, de forma idempotente.

## A costura limpa: por que tempo-real ≠ analítico

A decisão de "o que roda onde" não é arbitrária — segue uma propriedade de cada workload:

| Propriedade | Caminho operacional (edge/local) | Back-office/analítico (nuvem) |
|---|---|---|
| Tolerância a latência | Nenhuma — segundos custam fila no caixa | Alta — relatório de mês pode levar minutos |
| Tolerância a queda de WAN | **Zero** — tem de operar offline | Total — espera o link voltar |
| Frescor do dado | Tempo real local | Eventual (sync) é aceitável |
| Volume de leitura | Pequeno e pontual (um cupom) | Pesado e agregado (rede inteira) |
| Onde a verdade nasce | Venda nasce no PDV | Cadastro/preço nasce na retaguarda |

A WAN só dói no caminho onde a latência importa — e esse caminho **não usa WAN**, porque está no edge. No analítico, a latência de WAN é irrelevante. A fronteira é desenhada exatamente nessa indiferença: empurramos para a nuvem tudo que **não se importa** com a rede, e mantemos no edge/local tudo que **morre** sem ela.

## Fluxos canônicos (quem fala com quem)

```
VENDA (nasce no PDV)
  PDV ──(LAN)──> EDGE ──(sync assíncrono, WAN)──> NUVEM
  • PDV grava local primeiro (offline-first), confirma cupom, imprime.
  • EDGE consolida vendas dos caixas, empurra movimento à nuvem quando há link.
  • NUVEN materializa rollups p/ BI e alimenta o fiscal central.

PREÇO/CADASTRO (nasce na retaguarda)
  NUVEM ──(publica, WAN)──> EDGE ──(LAN)──> PDV
  • Retaguarda forma preço, define vigência.
  • EDGE recebe e arma a vigência localmente.
  • PDV lê preço do edge (ou do cache local se edge offline).

NUNCA:
  PDV ──X──> NUVEM   (proibido: PDV jamais fala direto com a camada 1)
```

A regra **PDV → edge, nunca → nuvem** não é só topológica; é o que garante a sobrevivência offline. Se o PDV pudesse depender da nuvem, uma queda de WAN derrubaria o caixa — exatamente o que o ADR-001 proíbe.

## O que isso herda e supera do Delphi

| Delphi (client-server por loja) | Apollo (3 camadas) |
|---|---|
| 1 servidor de banco + 1 de aplicação por loja, físicos, instalados à mão | Edge containerizado, auto-atualizável, mesma imagem em toda loja |
| Sync PDV↔retaguarda via **Horse** (artesanal) | Edge como ponto de sync, protocolo versionado (seção 05) |
| Retaguarda local, sem visão consolidada nativa de rede | Nuvem multi-tenant com consolidação multi-loja nativa |
| Update = trocar exes na loja na mesma janela | Deploy zero-downtime + janela de versão N/N-1 (ADR-009) |
| Fiscal acoplado, atualizado junto | Fiscal central na nuvem + módulo pinável (ADR-010) |

## Ver também

- [tenancy-and-data.md](tenancy-and-data.md) — db-per-tenant, roteamento e isolamento na camada 1.
- [deployment-topologies.md](deployment-topologies.md) — como as 3 camadas se materializam por porte de cliente.
- [workload-tiers.md](workload-tiers.md) — API/Worker/Read-replica dentro da camada 1.
- [offline-edge-sync.md](offline-edge-sync.md) — offline-first, reconciliação e contingência fiscal.
- [../05-migration-engineering/sync-protocol.md](../05-migration-engineering/sync-protocol.md) — o protocolo de sync que sucede o Horse.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-001, ADR-008.
