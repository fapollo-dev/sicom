# Port do DataScience/IA — surfar a onda da IA com os dados do cliente (ADR-013)

> O DataScience/IA da Apollo é **portado** (não reescrito do zero) para o cliente "surfar a onda da IA" com **os dados deles** — que têm muito valor de varejo. **Strip de TODO vínculo Apollo** (links, dados, segredos, tenants, prompts, knowledge) e **adaptação ao domínio de supermercado**. É **FASE POSTERIOR** (Fase 6 do roadmap): só depois do core migrado e dos relatórios/BI baseline no ar. Não é prioridade inicial.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-013** (DataScience é fork limpo, sem vínculo Apollo).
- [design-system-rebrand.md](design-system-rebrand.md) — a **mesma disciplina de strip** (aqui aplicada a dados/segredos/prompts, não a cor).
- [../10-roadmap/phases.md](../10-roadmap/phases.md) — por que isto é **Fase 6** (última), depois do core e do BI baseline.
- [../10-roadmap/blind-spots.md](../10-roadmap/blind-spots.md) — "Relatórios/BI baseline ANTES da camada de IA" (pré-requisito de valor).
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — o risco-coroa é o fiscal; IA não disputa prioridade com paridade.

---

## 1) FASE POSTERIOR — leia isto antes de qualquer coisa

> **IA é Fase 6.** Não comece o port enquanto o core não estiver migrado e os **relatórios/BI baseline (DRE, margem, ruptura, curva ABC)** não estiverem no ar e confiáveis. IA sobre dado errado é **dano amplificado, não valor**.

Motivos da ordem:

- **Sem dado limpo não há IA útil.** Previsão de demanda, ruptura e ABC dependem de estoque, vendas e cadastro **migrados e reconciliados** (Fases 1–5). Modelo bom em cima de saldo errado mente com confiança.
- **Prioridade é paridade e fiscal.** O risco-coroa é o motor fiscal ([../10-roadmap/blind-spots.md](../10-roadmap/blind-spots.md)); IA não disputa esse foco. Investir em IA antes do core é otimizar o que não está pronto.
- **BI baseline é pré-requisito.** O cliente precisa de **relatórios determinísticos** (DRE, margem, ruptura) **antes** da camada probabilística. O baseline também vira o **conjunto de avaliação** (golden) contra o qual a IA é medida.
- **Custo.** IA é caro por tenant/dia pesado (FinOps — ver [../10-roadmap/blind-spots.md](../10-roadmap/blind-spots.md)); ligar cedo queima orçamento sem retorno enquanto o core ainda mexe.

Quando entrar (Fase 6): o port reaproveita o **motor semântico** já provado (busca híbrida, classificador, few-shots, provenance/anti-fake) — mas **strip total** + **re-domínio** para varejo.

---

## 2) Proposta de valor — IA com os dados de supermercado

O dado de varejo do cliente é o ativo. Casos de uso de alto valor, todos ancorados em dado que o ERP **já** terá após o core migrado:

| Caso de uso | O que entrega | Dado-fonte (já no core pós-migração) |
|-------------|---------------|--------------------------------------|
| **Previsão de demanda** | quanto comprar/repor por SKU/loja, sazonalidade, feriado, clima | histórico de vendas por item/loja, calendário, promoções |
| **Ruptura (out-of-stock)** | alerta de item zerando em gôndola antes de zerar | estoque + giro + curva de venda + lead time fornecedor |
| **Curva ABC / mix** | classificação A/B/C, itens cauda-longa, candidatos a delist | margem × giro × ocupação de gôndola |
| **Precificação** | sugestão de preço por elasticidade, alinhamento regional, regra de margem | histórico preço×volume, custo, concorrência, preço por loja |
| **Perdas / validade** | priorizar venda de perecível perto do vencimento; markdown dinâmico | validade por lote, giro, perdas registradas |
| **Cesta de compras (market-basket)** | combos, "quem leva X leva Y", layout de gôndola, cross-sell no PDV | cupons/itens por venda (associação) |
| **Antifraude / quebra** | padrões anômalos de cancelamento, desconto, sangria no PDV | trilha de auditoria do PDV (RBAC + audit log) |

> A IA é uma **camada sobre o BI baseline**: o relatório determinístico responde "o que aconteceu"; a IA responde "o que vai acontecer / o que fazer". Ordem importa — baseline primeiro (ver [../10-roadmap/blind-spots.md](../10-roadmap/blind-spots.md)).

---

## 3) O que se reaproveita do motor (e o que NÃO se reaproveita)

O **motor** (infra de RAG/semântica) é genérico e portável. O **conteúdo** (dados, prompts, knowledge, tenants, segredos) é **100% Apollo** e **não** vai junto.

| Camada | Reaproveita? | Observação |
|--------|--------------|------------|
| Busca híbrida (pgvector/HNSW + RRF) | **Sim** (motor) | re-treina/re-indexa com dados do cliente |
| Classificador de intenção (LLM) | **Sim** (estrutura) | **prompts reescritos** para domínio supermercado |
| Few-shots / exemplos | **NÃO** | são casos Apollo reais — reconstruir com casos do cliente |
| Knowledge base / regras | **NÃO** | conhecimento Apollo (comissão, bônus, rede) — irrelevante e vazante |
| Prompts / system prompts | **NÃO** | persona, tenant, domínio Apollo embutidos — reescrever |
| Tenants / IDs / dados | **NÃO** | dado de produção Apollo — **proibido** sair |
| Tokens / segredos / DSN | **NÃO** | credenciais — rotacionar e usar as do cliente |
| Provenance / anti-fake / coverage | **Sim** (mecanismo) | mantém o anti-alucinação; alimentado por knowledge do cliente |

> **Regra:** porta-se o **encanamento**, não a **água**. Tudo que carrega dado, conhecimento, identidade ou segredo Apollo fica para trás.

---

## 4) CHECKLIST de strip Apollo (DataScience)

Mesma severidade de gate de release que o DS visual ([design-system-rebrand.md](design-system-rebrand.md)), aqui focado em **dados, prompts, knowledge e segredos** — onde o vazamento é mais grave (PII de terceiro, segredo, conhecimento proprietário).

### 4.1 Dados e datasets

- [ ] **Nenhum dump/seed/fixture** com dados de produção Apollo (clientes, consultores, vendas, comissão).
- [ ] **Embeddings/índices vetoriais** reconstruídos do zero — não importar índice Apollo (carrega o conteúdo original).
- [ ] **Tabelas de exemplo / golden datasets** trocadas por casos do cliente.
- [ ] **PII** de qualquer pessoa Apollo (nomes, telefones, e-mails, IDs) zerada — LGPD se aplica a dado de terceiro também.

### 4.2 Prompts, knowledge e few-shots

- [ ] **System prompts** reescritos para domínio supermercado; sem persona/tenant/marca Apollo.
- [ ] **Knowledge rules** Apollo (comissão, bônus, rede, saldo, devolutiva) **removidas** — reescrever com regras de varejo do cliente.
- [ ] **Few-shots** reconstruídos com perguntas/respostas do domínio do cliente.
- [ ] **Exemplos de SQL / esquema** apontando para o schema do cliente, não para `APOLLO`/`APOLLO_HUB`.
- [ ] **Glossário/sinônimos** de domínio: trocar energia/telecom/seguros por mercearia/perecível/FLV/açougue.

### 4.3 Conexões, segredos e tenants

- [ ] **Tokens/credenciais** Apollo (ex.: tokens `ign_live_*`, DS_AUTH, Knowledge secret) **removidos e rotacionados**.
- [ ] **DSN / connection strings** apontando para bancos Apollo (`162.x`, `APOLLO`, `APOLLO_HUB`).
- [ ] **Refs de tenant / IDs de conexão** (WABA, phone IDs, tenant maps) Apollo apagados.
- [ ] **Endpoints** (DS API base, Hub, Knowledge dashboard) trocados pelos do cliente.
- [ ] **Webhooks / callbacks** com domínio Apollo.

### 4.4 Código, config e histórico

- [ ] **Comentários/TODO/nomes de módulo** referenciando produtos Apollo.
- [ ] **Variáveis de ambiente** (`.env*`) sem chave Apollo, mesmo "de exemplo".
- [ ] **Histórico git** limpo (`--orphan`/export sem `.git`) — não carregar o log do repo Apollo.
- [ ] **CI/CD secrets e workflows** desvinculados da org Apollo.
- [ ] **Logs/telemetria** (Sentry/PostHog) apontando para projeto do cliente.

### 4.5 Verificação automatizável

```bash
#!/usr/bin/env bash
# scripts/check-no-apollo-ds.sh — gate de CI para o port de DataScience
set -euo pipefail
# marca, domínios, knowledge Apollo, tokens, bancos
PATTERNS='apollo|apolloenergy|ign_live_|APOLLO_HUB|\bAPOLLO\b|knw_|comiss|bonus|consultor|licenciado|hub\.apollo|162\.141\.111\.96|V_EXTRATOBONUS|GET_DESCENDANTS'
HITS=$(grep -rniE "$PATTERNS" src/ prompts/ knowledge/ config/ .env* || true)
if [ -n "$HITS" ]; then
  echo "❌ STRIP APOLLO (DS) FALHOU:"; echo "$HITS"; exit 1
fi
echo "✅ strip Apollo (DataScience) OK"
```

> **Mais grave que o DS visual:** aqui o vazamento é **dado/segredo/conhecimento de terceiro**, não só cor. Trate como incidente de segurança se algo escapar. Use as `seções` de provenance/anti-fake do motor para garantir que a IA do cliente **não cite nem invente** dado Apollo residual.

---

## 5) Adaptação ao domínio de supermercado

Re-domínio é mais que strip — é trocar a **ontologia**. O motor que entendia "rede de consultores / comissão / bônus" passa a entender "loja / SKU / categoria / fornecedor / gôndola". Pontos concretos:

- **Entidades:** consultor→loja/operador; cliente-final→consumidor; produto-energia→SKU; rede→multi-loja; comissão→margem.
- **Métricas:** bônus/saldo→giro, ruptura, margem, perda, validade, ABC, elasticidade.
- **Intenções do classificador:** "ranking de rede"→"ranking de SKU/loja"; "saque/saldo"→"sugestão de compra/preço"; "extrato"→"DRE/margem".
- **Fontes:** trocar matviews/queries Apollo pelas do schema de varejo (vendas, estoque, NF-e entrada, validade).
- **Guardrails:** o anti-fake continua — mas as regras agora protegem **número de margem/estoque**, não de comissão. Reescrever as knowledge rules críticas para o varejo.

> A IA do cliente deve consultar o **dado do cliente** sempre (provenance), nunca responder de memória — exatamente como o anti-alucinação do motor original, mas alimentado pelo knowledge de varejo.

---

## 6) Pré-requisitos de entrada na Fase 6

A IA só liga quando isto estiver pronto (critério de entrada — ver [../10-roadmap/phases.md](../10-roadmap/phases.md)):

- [ ] Core migrado e reconciliado (Fases 1–5) — dado confiável.
- [ ] **BI baseline determinístico** no ar (DRE, margem, ruptura, ABC) e validado contra o legado.
- [ ] Strip Apollo do DataScience completo (seção 4) + CI gate verde.
- [ ] Re-domínio (seção 5) com knowledge/prompts de varejo do cliente.
- [ ] FinOps definido: custo por tenant/dia pesado orçado (ver [../10-roadmap/blind-spots.md](../10-roadmap/blind-spots.md)).

---

## Ver também

- [design-system-rebrand.md](design-system-rebrand.md) — o outro fork (DS visual): mesma disciplina de strip Apollo.
- [README.md](README.md) — índice da seção 09.
- [../10-roadmap/phases.md](../10-roadmap/phases.md) — Fase 6 (IA/DS) é a última; por quê.
- [../10-roadmap/blind-spots.md](../10-roadmap/blind-spots.md) — BI baseline antes de IA; FinOps; LGPD.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-013**.
