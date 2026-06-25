# Plano de Fase 0→1 informado pelo recon

> Ponte entre o roadmap canônico ([../../10-roadmap/phases.md](../../10-roadmap/phases.md)) e os achados do reconhecimento. **Não substitui** o roadmap (as fases 0→6 e seus critérios de saída são canônicos) — aterra a Fase 0/1 nos **fatos concretos** que o recon levantou, propõe a **ordem real de entidades** da Fase 2 com base nas dependências do banco, e **sinaliza** onde o recon refina premissas do roadmap (disciplina de [how-agents-work](../../00-orientation/how-agents-work.md): externar achado, não rediscutir ADR em silêncio).

## Pré-requisitos de leitura

- [../../10-roadmap/phases.md](../../10-roadmap/phases.md) — as fases canônicas (este doc é complemento).
- [mapa-reconhecimento.md](mapa-reconhecimento.md) · [form-base-cadmaster.md](form-base-cadmaster.md) · [pdv-architecture.md](pdv-architecture.md) · [entity-parceiros.md](entity-parceiros.md) — os achados aterrados aqui.

---

## 1. O que o recon entrega para a **Fase 0 (Fundação)**

O roadmap pede, na Fase 0, fundações genéricas. O recon já define **o que elas precisam conter** para ter paridade:

| Item da Fase 0 | O que o recon revelou que ele precisa | Fonte |
|---|---|---|
| **`shared/ui` (engine CRUD)** | Replicar o contrato do **`TfrmCadMaster`**: ciclo gravar (RBAC→obrigatórios→apply→histórico→carimbo→log→hook), excluir (soft/hard por `INDR`), pesquisa sobre view `GET_<TABELA>`, **mestre-detalhe** (header+itens atômicos), palette de campos (texto/número/combo/data/check/memo/grid). É o alvo direto do `/ds-create-crud`. | [form-base-cadmaster.md](form-base-cadmaster.md) |
| **`shared/keyboard`** | Mapa já extraído: Alt+G/E/X/A/S/O nos botões, **F6**=filtro ativo, **setas**=navegação de registro, **Enter**=carrega por código, **Esc** protegida em edição, código só-dígitos. | [form-base-cadmaster.md §4](form-base-cadmaster.md) |
| **Roteamento de tenant** | Origem é **schema-per-tenant** num Oracle; alvo é **db-per-tenant**. A fundação precisa do mapeamento schema→db e de **~25–35 tenants ativos** reais (não 900) para a primeira leva. | [mapa-reconhecimento.md §E](mapa-reconhecimento.md) |
| **SPIKE fiscal** | Pilha fiscal é **ACBr** (NFe/NFCe/SAT/PosPrinter/BAL/PAF). O SPIKE deve provar o equivalente alvo de uma emissão ACBr + contingência. | [mapa-reconhecimento.md §F](mapa-reconhecimento.md) |
| **SPIKE Oracle→Postgres** | Carga real por schema: ~830 tabelas, **507 sequences**, ~92 triggers (boa parte **replicação `REM_*`**), 369 views (`GET_*`), **0 packages / 21 procs / 9 funcs** (lógica está no Delphi, não no banco → conversão de PL/SQL é leve; o peso é sequences+triggers+views+tipos). | [mapa-reconhecimento.md §D/§E](mapa-reconhecimento.md) |
| **Sync (radar p/ Fase 4)** | O sync legado é **CDC por trigger→outbox `REMESSA_SERVER`** (por terminal, idempotente por `CHAVE`) + PDV com **DB local embarcado**. A fundação deve prever o **outbox explícito** desde cedo (toda gravação de cadastro gera evento de sync). | [pdv-architecture.md](pdv-architecture.md), [mapa-reconhecimento.md §D](mapa-reconhecimento.md) |

---

## 2. **Fase 1 (piloto)** — concreto

- **Piloto travado: `uCadBancos`** (CRUD tabela única, `BANCOS`, PK manual). Dossiê em [../../04-screen-dossier/dossiers/retaguarda/uCadBancos.md](../../04-screen-dossier/dossiers/retaguarda/uCadBancos.md) — análise estática fechada; falta só **runtime** (captura de SQL/golden).
- **Gate único:** rodar o legado para capturar os golden ([runtime-capture-uCadBancos.md](runtime-capture-uCadBancos.md)). Depende do ambiente Windows/ERP ou do **Oracle XE-sombra** (em preparação).
- **Valor do piloto:** prova **toda** a fundação da Fase 0 num risco mínimo — engine CRUD, conexão por tenant, teclado, **e** o evento de replicação (a linha em `REMESSA_SERVER`). Ao terminar, mede o ciclo dossiê→paridade (base de estimativa).

> Nota: o roadmap sugere "fornecedor ou unidade de medida" como exemplo de piloto; **fornecedor é mestre-detalhe e central (PARCEIROS)** — risco alto demais para o primeiro. `uCadBancos` é a escolha mais segura e já validamos que o contrato do form-base generaliza (2ª tela: `uCadOperacoesConta`).

---

## 3. **Fase 2 (retaguarda)** — ordem de entidades aterrada nas dependências reais

O roadmap dá a ordem de **módulos** (cadastros→compras→estoque→preço→financeiro→fiscal). O recon refina a ordem **dentro de cadastros**, pela centralidade (FKs):

1. **Cadastros-folha de baixo acoplamento primeiro** (poucas FKs de entrada, tabela única): bancos (piloto), formas de pagamento, operações de conta, alíquotas, famílias/seções de produto. Cada um ≈ o piloto, ritmo acelerado.
2. **`PARCEIROS` cedo como entidade compartilhada** — é **referenciada por 31 tabelas** (cliente/fornecedor/funcionário/transportadora num só party de 169 colunas + mestre-detalhe). Não é "folha", mas **tudo depende dela** (venda, NF, financeiro, compra). Modelar logo após o piloto provar o engine, **antes** dos módulos que a consomem. Decisão de modelagem (party único vs especializado) em [entity-parceiros.md §6](entity-parceiros.md) — escalar ao orquestrador.
3. **`PRODUTOS`** (≈139k linhas, núcleo de estoque/venda/fiscal) — a outra entidade-âncora; exige NCM/CEST/tributação (vêm de `METADADOSSICOM`).
4. Depois os **fluxos** que consomem 1–3: compras/NF-e entrada, estoque, preço/promoção, financeiro (com replicação ativa — `ARECEBER`/`PARCEIROS` são as que mais geram remessa), e por fim fiscal central/SPED.

> Princípio: **entidades-âncora (PARCEIROS, PRODUTOS) antes dos fluxos que as referenciam** — senão os fluxos migram contra um alvo que ainda não existe.

---

## 4. Onde o recon **refina premissas** do roadmap (a sinalizar ao orquestrador)

Nada aqui rediscute ADR — são fatos a incorporar:

1. **"Substituir o Horse" (Fase 4)** vs o que o recon achou: o sync **operacional** do legado é **trigger→outbox `REMESSA_SERVER`** + DB local do PDV, **não** (só) um microframework REST. O "Horse" pode ser a camada de **integração com terceiros** (API), separada do sync interno. **Confirmar**: o sync interno (CDC por trigger) e o Horse (API de terceiros) são duas coisas — a Fase 4 trata das duas? ([pdv-architecture.md](pdv-architecture.md))
2. **"900 clientes"** é escala-meta, não atual: o banco hoje tem **~25–35 tenants ativos** (o resto é cópia/DEMO/SPED/dormente). A "fábrica de cutover em massa" da Fase 5 e o "provisionamento 900+" são reais como **meta**, mas a Fase 5 inicial lida com **dezenas**. ([mapa-reconhecimento.md §E](mapa-reconhecimento.md))
3. **Offline tem precedente** (Fase 3): o PDV legado **já** roda contra DB local embarcado + central Oracle. A Fase 3 deve **extrair a semântica de conciliação existente** (carga inicial `CargaCliente`, remessa), não projetar do zero. ([pdv-architecture.md](pdv-architecture.md))
4. **Conversão Oracle→PG — nuance** (ADR-011): **0 packages**, poucos procs/funcs (24/12) → PL/SQL "clássico" é leve. **MAS** há **~81 triggers de lógica/auditoria por schema** (`ATUALIZA_*`/`AUDIT_*`, além dos 35 `REM_*` de replicação) que **carregam regra** e precisam ser extraídos como o `.pas` (regra→service, com paridade). O peso é **estrutural** (522 sequences, 436 views, tipos `NUMBER` int/decimal) **+ esses triggers** — não os subestimar. Detalhe em [oracle-to-postgres-recon.md](oracle-to-postgres-recon.md).

---

## 5. Próximos passos concretos (ordem)

1. **(usuário)** Subir o **Oracle XE-sombra** com uma base de cliente + (ideal) o ERP Windows apontado a ele.
2. **(agente)** Com o sombra no ar: validar as SQLs reconstruídas do piloto (Q1/Q2/DML) e, com o app, **capturar os golden** ([runtime-capture-uCadBancos.md](runtime-capture-uCadBancos.md)) → fechar o dossiê de `uCadBancos`.
3. **(conjunto)** Decidir o arranque da **Fase 0** (fundação: engine CRUD + teclado + tenant + SPIKE fiscal) — é onde o contrato do form-base vira código compartilhado.
4. **(agente)** Em paralelo, dossiê da 2ª tela (outra folha simples) para validar o ritmo, e o **mapeamento de modelagem de `PARCEIROS`** (party) para a Fase 2.

## Ver também

- [../../10-roadmap/phases.md](../../10-roadmap/phases.md) · [../../10-roadmap/blind-spots.md](../../10-roadmap/blind-spots.md)
- [mapa-reconhecimento.md](mapa-reconhecimento.md) · [form-base-cadmaster.md](form-base-cadmaster.md) · [pdv-architecture.md](pdv-architecture.md) · [entity-parceiros.md](entity-parceiros.md)
- [runtime-capture-uCadBancos.md](runtime-capture-uCadBancos.md) — o gate para fechar a Fase 1.
