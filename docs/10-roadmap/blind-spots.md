# Pontos Cegos — o que o cliente ainda não enxergou

> Arquivo de **alto valor**: os riscos que afundam migrações de ERP de varejo e que o cliente **tende a não ver** quando olha só a tela. Organizado por **tema** e por **severidade**; cada item traz o risco em 1–2 linhas + **ponteiro de mitigação** (link para a seção relevante quando existe). Materializa a tese da missão: *não migre o que você vê, migre o que o sistema faz.*

## Pré-requisitos de leitura

- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — o risco-coroa fiscal e os anti-objetivos.
- [phases.md](phases.md) — onde cada risco é mitigado no tempo (SPIKE cedo, entrega na fase certa).
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — os ADRs que muitos destes pontos forçam.

---

## Legenda de severidade

| Nível | Significado |
|-------|-------------|
| 🔴 **Crown** | Risco-coroa: erra aqui e o projeto/loja **para** (legal/operacional). Trilha dedicada desde a Fase 0. |
| 🟠 **Alto** | Pode atrasar fases inteiras ou quebrar go-live; precisa de plano explícito cedo. |
| 🟡 **Médio** | Dói, mas é gerenciável com disciplina e o ADR certo. |

> Regra de ouro deste arquivo: **um risco sem dono e sem fase é um risco invisível.** Cada item abaixo aponta a fase/seção onde vira trabalho.

---

## TEMA A — Fiscal & Pagamentos (o risco-coroa)

### A1 — Motor fiscal 🔴 Crown
NFC-e/NF-e/SAT-CF-e/SPED/EFD com **legislação que muda por lei várias vezes/ano**: regra hardcoded vira dívida fiscal a cada mudança, e SPED tem **mesmo prazo para todos** (dia pesado). Sem parametrização por UF/município e atualização sem redeploy, cada alteração legal é um incêndio.
→ **Mitigação:** regras fiscais **parametrizáveis por UF/município**, **atualizáveis sem redeploy geral**, módulo fiscal **pinável** (ADR-010); SPIKE na Fase 0, entrega na Fase 3. Ver [phases.md](phases.md) e [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md). Worker tier para SPED/EFD ([../01-architecture/workload-tiers.md](../01-architecture/workload-tiers.md)).

### A2 — Contingência fiscal offline (legal) 🔴 Crown
Quando SEFAZ/internet cai, o PDV **tem que** emitir em contingência e transmitir depois — **requisito legal**, não feature opcional. Isso **molda a arquitetura do PDV** (offline-first), não é um patch.
→ **Mitigação:** ancora o ADR-001/008 (edge + PDV offline). Fluxo de contingência + transmissão posterior provado no SPIKE da Fase 0. Ver [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md).

### A3 — Certificado digital A1/A3 🔴 Crown
Assinatura fiscal depende de certificado: **A1** (arquivo, expira, precisa rotação) ou **A3** (token/cartão físico, difícil em nuvem/edge). Vencimento silencioso = PDV para de emitir.
→ **Mitigação:** cofre de certificados por tenant, alerta de expiração na observabilidade de frota (ver M2), decisão A1×A3 por topologia (edge vs nuvem). Provar A1 no SPIKE Fase 0.

### A4 — TEF / pagamentos 🟠 Alto
Sitef/PayGo, bandeiras, pinpad e **PIX no PDV** exigem **certificação com adquirentes** — processo externo, com fila e homologação que **não** se acelera com código. Subestimar o calendário de certificação atrasa a Fase 3.
→ **Mitigação:** abrir certificação cedo (SPIKE Fase 0); camada de drivers no Electron (ADR-008). Ver [phases.md](phases.md) Fase 3.

### A5 — Regionalização tributária (ICMS ST / DIFAL) 🟠 Alto
**ICMS ST**, **DIFAL** e benefícios variam **por UF e até município/produto**. Um cliente multi-loja cruza fronteiras estaduais; regra fixa erra imposto e gera passivo.
→ **Mitigação:** mesma engine parametrizável do A1 (tabelas por UF/município/NCM, versionadas). Não tratar como "configuração do produto", e sim como dado fiscal pinável.

---

## TEMA B — PDV, Devices & Offline

### B1 — Periféricos / camada de drivers 🟠 Alto
Impressora fiscal, **balança (EAN-13 com peso/preço embutido)**, gaveta, pinpad, leitor — cada um com protocolo serial/USB próprio. O browser não acessa device; sem camada de drivers, o PDV não funciona.
→ **Mitigação:** **camada de drivers no Electron** (ADR-008); a balança exige parser de **EAN-13 pesável** (prefixo + peso/preço no código). Ver glossário e [phases.md](phases.md) Fase 3.

### B2 — Semântica de conflito offline 🟠 Alto
Dois PDVs/edges offline alteram o "mesmo" dado (estoque, preço, numeração de cupom) e reconectam. Resolver isso como **conflito técnico** (last-write-wins) **quebra regra de negócio** (estoque negativo, cupom duplicado).
→ **Mitigação:** semântica de conflito **de negócio**, não só técnica — definida por entidade. Ver [../05-migration-engineering/sync-protocol.md](../05-migration-engineering/sync-protocol.md) e [phases.md](phases.md) Fase 4.

### B3 — Segurança do PDV fisicamente exposto 🟠 Alto
O PDV roda numa máquina **fisicamente acessível** (caixa do mercado): banco local com dados/preços/segredos, certificado, chaves de sync. Roubo/tamper expõe tudo.
→ **Mitigação:** **criptografia do banco local**, segredos no edge protegidos, detecção de tamper, escopo mínimo de credencial no PDV. Ver [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md).

---

## TEMA C — Dados, Migração & Cutover

### C1 — Cutover / migração de dados por cliente 🔴 Crown
O **dia mais arriscado** do projeto. Virar 20 anos de dados de um cliente para o novo sistema sem **dual-run, reconciliação, rollback, janela e treinamento** é apostar o negócio do cliente num único evento.
→ **Mitigação:** cutover **por cliente** como evento controlado (Fase 5): dual-run, reconciliação de saldos (caixa/estoque/fiscal), rollback ensaiado, treinamento. Ver [phases.md](phases.md) Fase 5.

### C2 — Oracle → PostgreSQL 🟠 Alto
ADR-011: PL/SQL, packages, tipos e dialeto Oracle não migram sozinhos. Descobrir isso tarde trava todas as fases que tocam banco.
→ **Mitigação:** SPIKE no radar **na Fase 0**; executa por módulo. Ver [../05-migration-engineering/oracle-to-postgres.md](../05-migration-engineering/oracle-to-postgres.md).

### C3 — Trilha de auditoria / rastreabilidade imutável 🟠 Alto
Fiscal e financeiro exigem **trilha imutável**: quem alterou preço, cancelou venda, deu desconto, fez sangria. Sem isso não há defesa em fiscalização nem investigação de fraude.
→ **Mitigação:** audit log append-only por tenant, ligado nos módulos sensíveis na Fase 2; alimenta antifraude da IA na Fase 6. Ver [phases.md](phases.md) Fase 2.

### C4 — Backup/DR + RPO/RTO + retenção fiscal 5 anos 🟠 Alto
db-per-tenant (ADR-003) multiplica a operação de backup por ~900. **Retenção fiscal legal de 5 anos**, RPO/RTO definidos por tenant, restore testado. Backup que nunca foi restaurado não é backup.
→ **Mitigação:** estratégia de backup/restore por tenant, retenção fiscal 5 anos, ensaio de restore. Ver [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md).

### C5 — Onboarding/provisionamento de tenant em escala 900+ 🟠 Alto
Subir um tenant novo (banco, seed, config fiscal, certificado, conexões) **na mão** não escala para 900+. Sem automação, o cutover em massa (Fase 5) emperra.
→ **Mitigação:** provisionamento automatizado (criar banco, seed, config por UF, instalar certificado) antes do cutover em massa. Ver [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md) e [phases.md](phases.md) Fase 5.

---

## TEMA D — Domínio de Varejo (regras escondidas)

### D1 — Motor de preço e promoções 🟠 Alto
Tabelas de preço, promoções, **"leve 3 pague 2"**, combos, preço **por loja/região**, vigência, prioridade entre promoções. É lógica densa e cheia de exceção — e **etiqueta eletrônica de gôndola (ESL)** precisa receber o preço em tempo real.
→ **Mitigação:** dossiê detalhado do motor de preço (Fase 2); integração ESL no roadmap de devices; preço por loja respeita o multi-loja do mesmo tenant (ADR-003). Ver [phases.md](phases.md) Fase 2.

### D2 — Estoque / inventário 🟠 Alto
Balanço, inventário, **perdas**, **validade**, **curva ABC**, **ruptura**, **transferência entre lojas** e, crítico, **NF-e de entrada** (importação XML do fornecedor / **manifestação do destinatário**). Errar entrada de NF-e desalinha estoque e crédito de imposto.
→ **Mitigação:** módulo de estoque com NF-e de entrada na Fase 2; perdas/validade alimentam a IA na Fase 6 (ver [../09-design-system-and-ai/datascience-port.md](../09-design-system-and-ai/datascience-port.md)).

### D3 — Ecossistema de integrações 🟡 Médio
**NF-e de entrada**, **CNAB bancário (boletos)**, contabilidade, marketplaces, **apps de delivery**, fidelidade. Cada integração é um contrato externo que o legado já tem e o novo precisa honrar.
→ **Mitigação:** mapear integrações ativas no dossiê; CNAB no financeiro (Fase 2); contrato de API estável (ver E1). Ver [phases.md](phases.md) Fase 2.

### D4 — Relatórios/BI baseline ANTES da IA 🟠 Alto
DRE, margem, ruptura, ABC **determinísticos** precisam existir e bater com o legado **antes** da camada de IA. IA sobre dado não reconciliado é dano amplificado.
→ **Mitigação:** BI baseline é **critério de saída da Fase 2** e **pré-requisito da Fase 6**. Ver [phases.md](phases.md) e [../09-design-system-and-ai/datascience-port.md](../09-design-system-and-ai/datascience-port.md).

---

## TEMA E — Integração, Plataforma & Operação

### E1 — Contrato de API para terceiros 🟠 Alto
Hoje sistemas de terceiros batem na **API Horse antiga**. Trocar o Horse (Fase 4) sem um contrato estável e **backward-compatible** quebra integrações que nem são do cliente.
→ **Mitigação:** contrato versionado com janela N/N-1 (ADR-009); inventário de quem consome o Horse. Ver [../05-migration-engineering/versioning-and-compatibility.md](../05-migration-engineering/versioning-and-compatibility.md) e [phases.md](phases.md) Fase 4.

### E2 — Observabilidade de frota 🟠 Alto
Com ~900 tenants e edges no campo, "está tudo bem?" não se responde no olho: **saúde por tenant**, **sync lag**, **transmissão fiscal** (notas presas), certificado a vencer (A3), PDV offline há tempo demais.
→ **Mitigação:** observabilidade de frota com métricas por tenant; obrigatória **antes da Fase 5**. Ver [../07-devops-infra/observability.md](../07-devops-infra/observability.md).

### E3 — Feature flags / rollout por tenant 🟡 Médio
Sem flags por tenant, não há como virar um módulo gradualmente nem testar com um cliente piloto. Strangler exige rollout seletivo.
→ **Mitigação:** flags por tenant desde a Fase 0 (fundação); habilitam o cutover gradual da Fase 5. Ver [phases.md](phases.md) Fases 0 e 5.

### E4 — FinOps / custo por tenant e por dia pesado 🟡 Médio
db-per-tenant + dias pesados (SPED, fechamento) podem disparar custo. Sem **custo por tenant/dia**, não há como precificar SaaS nem detectar tenant deficitário.
→ **Mitigação:** medir custo por tenant e por janela pesada; alimenta o billing (F1). Ver [../01-architecture/heavy-days-thundering-herd.md](../01-architecture/heavy-days-thundering-herd.md) e [../01-architecture/workload-tiers.md](../01-architecture/workload-tiers.md).

---

## TEMA F — Negócio, Pessoas & Contrato

### F1 — Mudança de modelo comercial (licença → SaaS) 🟠 Alto
Sair de **licença+manutenção** para **SaaS/assinatura** não é só preço: exige **metering**, **billing**, **cobrança/inadimplência (dunning)**, suspensão por não-pagamento. Software técnico pronto sem isso não fatura.
→ **Mitigação:** metering plugado no FinOps (E4); billing/dunning como trilha paralela que afeta o cutover (Fase 5). Ver [phases.md](phases.md).

### F2 — Time / skills e transferência de conhecimento 🟠 Alto
Devs **Delphi** aprendendo NestJS/React/TS é curva real; e o **bus-factor** do único que conhece o legado é risco existencial — se ele sai, o contexto vai junto.
→ **Mitigação:** o **dossiê** (ADR-012) é o antídoto ao bus-factor — externaliza o conhecimento do legado em artefato. Pareamento e revisão (loop Fazer→Revisar). Ver [../04-screen-dossier/dossier-process.md](../04-screen-dossier/dossier-process.md) e [../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md).

### F3 — RBAC / permissões complexas 🟠 Alto
Varejo tem permissão granular e operacional: **quem dá desconto, cancela venda, troca preço, faz sangria, abre/fecha caixa**. Subestimar vira buraco de fraude e de compliance.
→ **Mitigação:** **matriz de permissão** por papel × ação, implementada na Fase 2 (retaguarda) e estendida ao PDV (Fase 3); liga na trilha de auditoria (C3). Ver [phases.md](phases.md).

### F4 — LGPD em 900 clientes 🟠 Alto
PII de consumidores (CPF na nota, fidelidade, delivery): **consentimento, retenção, direito ao esquecimento** — multiplicado por ~900 tenants e cruzando com a **retenção fiscal de 5 anos** (que pode conflitar com o "esquecimento").
→ **Mitigação:** mapa de PII por tenant, política de retenção que **concilia LGPD × retenção fiscal**, fluxo de esquecimento. Liga com C4 (retenção) e C3 (auditoria).

### F5 — Contratual / SLA / exportação na saída do cliente 🟡 Médio
SaaS precisa de **SLA** definido e, na **saída do cliente**, **exportação de dados** (portabilidade) — exigência contratual e de LGPD. Sem isso, o cliente fica refém (e o fornecedor, exposto).
→ **Mitigação:** db-per-tenant (ADR-003) facilita export/portabilidade por cliente; SLA por tier (SaaS/dedicado/on-prem) — ver [../01-architecture/deployment-topologies.md](../01-architecture/deployment-topologies.md).

---

## Mapa rápido (tema × severidade × fase de mitigação)

| # | Ponto cego | Sev. | Mitiga na fase |
|---|------------|------|----------------|
| A1 | Motor fiscal (legislação muta) | 🔴 | SPIKE F0 → F3 |
| A2 | Contingência fiscal offline | 🔴 | F0 (molda) → F3 |
| A3 | Certificado A1/A3 | 🔴 | F0 → frota |
| A4 | TEF / PIX / certificação | 🟠 | F0 (abrir) → F3 |
| A5 | ICMS ST / DIFAL por UF | 🟠 | F2/F3 (engine) |
| B1 | Periféricos / drivers | 🟠 | F3 |
| B2 | Conflito offline (negócio) | 🟠 | F4 |
| B3 | PDV exposto / cripto local | 🟠 | F3 |
| C1 | Cutover por cliente | 🔴 | F5 |
| C2 | Oracle→Postgres | 🟠 | F0 → F2–5 |
| C3 | Auditoria imutável | 🟠 | F2 |
| C4 | Backup/DR + retenção 5 anos | 🟠 | F2 → frota |
| C5 | Onboarding tenant 900+ | 🟠 | antes da F5 |
| D1 | Preço & promoções + ESL | 🟠 | F2 |
| D2 | Estoque + NF-e entrada | 🟠 | F2 |
| D3 | Integrações (CNAB, delivery…) | 🟡 | F2 |
| D4 | BI baseline antes da IA | 🟠 | F2 → pré-F6 |
| E1 | Contrato API (ex-Horse) | 🟠 | F4 |
| E2 | Observabilidade de frota | 🟠 | antes da F5 |
| E3 | Feature flags por tenant | 🟡 | F0 → F5 |
| E4 | FinOps custo/tenant | 🟡 | contínuo |
| F1 | Modelo SaaS (billing/dunning) | 🟠 | paralelo → F5 |
| F2 | Skills / bus-factor | 🟠 | contínuo (dossiê) |
| F3 | RBAC granular | 🟠 | F2 → F3 |
| F4 | LGPD em 900 tenants | 🟠 | F2 (liga C3/C4) |
| F5 | SLA / exportação na saída | 🟡 | contratual |

---

## Ver também

- [phases.md](phases.md) — onde cada risco vira trabalho (SPIKE cedo, entrega na fase).
- [README.md](README.md) — índice da seção 10.
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — o risco-coroa fiscal e os anti-objetivos.
- [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md) — PDV offline + contingência + conflito.
- [../07-devops-infra/observability.md](../07-devops-infra/observability.md) — observabilidade de frota.
- [../07-devops-infra/database-ops.md](../07-devops-infra/database-ops.md) — backup/DR, retenção, provisionamento.
- [../09-design-system-and-ai/datascience-port.md](../09-design-system-and-ai/datascience-port.md) — BI baseline antes da IA (Fase 6).
