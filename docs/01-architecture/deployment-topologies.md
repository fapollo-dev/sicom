# Topologias de Deploy (um código, vários alvos)

> Por que o mesmo artefato roda de SaaS puro a on-prem no datacenter do cliente — e por que fork "versão cloud" vs "versão on-prem" é proibido.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-002 (um código, múltiplas topologias), ADR-003/004 (db-per-tenant viabiliza mobilidade).
- [target-architecture.md](target-architecture.md) — as 3 camadas que toda topologia instancia.
- [tenancy-and-data.md](tenancy-and-data.md) — por que mover um tenant é operação de ops, não de código.

## A regra (ADR-002)

> **Mesmo artefato (containers) roda na nuvem OU on-prem no cliente grande. Proibido fork "versão cloud" vs "versão on-prem".**

Dois produtos são duas vezes o custo de manutenção, dois caminhos de bug, duas trilhas de teste, dois alvos de migração — e na prática um dos dois apodrece. O legado Delphi já viveu isso: cada cliente grande virava um "sabor" da instalação. No Apollo, a **diferença é o alvo de deploy, não o código**. O que muda entre topologias:

- **Onde** a camada 1 (nuvem) roda — infra da Apollo, nuvem dedicada, ou rack do cliente.
- **Quem** opera essa camada — nós ou o time de TI do cliente grande.

O que **nunca** muda:

- A imagem dos containers (mesma build, mesma tag por release).
- A divisão de 3 camadas — **sempre** há edge + PDV local (ADR-001). On-prem não significa "sem edge"; significa "a camada 1 está dentro de casa".
- O modelo db-per-tenant (ADR-003) — é o que torna o tenant **portátil**.

## Topologia × porte

| Porte | Camada 1 (nuvem) | Camada 2 (edge) | Camada 3 (PDV) | Quem hospeda a camada 1 |
|---|---|---|---|---|
| **Pequeno** (1 loja, ~5GB) | **SaaS puro** — pool compartilhado da Apollo, banco empacotado com outros pequenos | Edge containerizado na loja (pode ser o próprio PC do balcão) | Electron por caixa | **Apollo** |
| **Médio** (3-10 lojas) | Nuvem da Apollo (pool compartilhado ou instância própria do tenant) | Edge por loja | Electron por caixa | **Apollo** |
| **Grande** (alto volume, ~1TB) | **Nuvem dedicada** (instância/cluster do tenant + read replica) **OU** **on-prem** no datacenter do cliente | Edge por loja | Electron por caixa | **Apollo (dedicada)** ou **cliente (on-prem)** |

Repare: **todas as linhas têm edge + PDV local**. A coluna que varia é a camada 1. O pequeno é "SaaS puro" porque a camada 1 dele divide instância com outros pequenos e ele nem percebe que existem três camadas — o edge é leve e a nuvem é nossa. O grande pode exigir on-prem por **soberania de dado, política de TI ou rede privada**, e o ADR-002 garante que atendemos isso **sem fork**.

```
  PEQUENO (SaaS puro)              MÉDIO (nuvem + edge)            GRANDE (dedicada OU on-prem)
  ┌───────────────────┐           ┌───────────────────┐          ┌─────────────────────────────┐
  │ Camada 1 da Apollo│           │ Camada 1 da Apollo│          │ Camada 1                    │
  │ (pool, multi-pequeno)         │ (instância do tenant)        │  • nuvem dedicada Apollo     │
  └─────────▲─────────┘           └─────────▲─────────┘          │   OU                         │
            │ WAN                           │ WAN                │  • on-prem no rack do cliente│
  ┌─────────┴─────────┐           ┌─────────┴─────────┐          └─────────────▲───────────────┘
  │ Edge (na loja)    │           │ Edge por loja     │                        │ WAN / LAN
  │ + PDVs Electron   │           │ + PDVs Electron   │          ┌─────────────┴───────────────┐
  └───────────────────┘           └───────────────────┘          │ Edge por loja + PDVs Electron│
                                                                 └─────────────────────────────┘
  Mesma imagem de container em TODAS as caixas. Só o alvo de deploy muda.
```

## Como um código serve todas (mecanismos)

O que permite "build uma vez, deploy em qualquer alvo":

1. **Containers como unidade de entrega.** API, worker e edge são imagens. O alvo (Kubernetes gerenciado da Apollo, ou um Docker/k3s no rack do cliente) recebe a **mesma imagem**. Diferenças são **configuração** (env, secrets, endpoints), não código.
2. **Configuração externalizada.** Tudo que muda por ambiente (endpoint do banco, credencial, URL da nuvem central, certificado) entra por env/secret, nunca hardcoded. On-prem só troca os valores de config.
3. **Camada 1 stateless (ADR-004).** Como o compute não guarda estado, levantar a camada 1 em outro lugar é subir réplicas e apontar para o registry de tenants daquele ambiente.
4. **db-per-tenant (ADR-003).** O tenant é um banco isolado. Mover um cliente grande para on-prem = **mover o banco dele** + apontar a camada 1 local para esse banco. Nenhum outro tenant é afetado, nenhum código é alterado.

### Mover um tenant para on-prem (sem fork, sem rebuild)

```
  1. Provisiona camada 1 no datacenter do cliente: mesma imagem de container,
     config apontando para o banco local e o registry local.
  2. Migra o banco do tenant (dump/restore ou réplica lógica) para a instância on-prem.
  3. Aponta o registry on-prem: tenantId → banco local.
  4. Re-credencia os edges das lojas para falarem com a camada 1 on-prem (troca de endpoint).
  5. Cutover por cliente, com rollback (ver seção 10/roadmap de cutover).
```

Nada disso toca o código-fonte. É **deploy + dado + config**. Essa é a razão de o db-per-tenant valer a pena: ele transforma "portar para on-prem" — que no legado era um projeto — em uma operação de ops repetível.

## O que continua proibido

- ❌ **Branch/repo "on-prem".** Se aparecer um `if (onPrem)` espalhado na lógica de domínio, é o fork voltando pela porta dos fundos. Diferença de ambiente é **config**, não ramo de código.
- ❌ **Feature que só existe num alvo.** Funcionalidade é igual em todo lugar; o que muda é onde roda. (Exceções de **infra** — ex.: backup gerenciado só faz sentido na nuvem da Apollo — são operacionais, não de produto.)
- ❌ **"Edge opcional" no on-prem.** On-prem **não** elimina o edge. A camada 1 estar dentro de casa não muda o ADR-001: o PDV ainda fala com o edge, nunca direto com a camada 1, porque a LAN da loja pode cair independente do datacenter.

## Ver também

- [target-architecture.md](target-architecture.md) — as 3 camadas instanciadas por cada topologia.
- [tenancy-and-data.md](tenancy-and-data.md) — mobilidade de tenant via db-per-tenant.
- [workload-tiers.md](workload-tiers.md) — os mesmos tiers existem em qualquer alvo.
- [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md) — operação de mover/empacotar bancos.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-002.
