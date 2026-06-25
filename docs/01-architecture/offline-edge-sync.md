# Offline, Edge & Sync (offline-first)

> Como o PDV vende sem internet, como o edge reconcilia quando o link volta, e por que a contingência fiscal não é uma feature — é um driver de arquitetura.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-008 (PDV offline-first em Electron), ADR-001 (edge+nuvem por design), ADR-009 (contrato de sync backward-compatible).
- [target-architecture.md](target-architecture.md) — as 3 camadas e a regra "PDV fala com o edge".
- [../00-orientation/glossary.md](../00-orientation/glossary.md) — contingência, Horse, NFC-e/SAT.

## O princípio (ADR-008)

> **O PDV é Electron com banco local (SQLite/embedded) e opera 100% offline para vender.** Sincroniza com o **edge da loja** quando o link volta. O PDV fala com o edge, **nunca** direto com a nuvem (ADR-001).

Offline-first não é "modo degradado" — é o **modo normal**. O PDV grava local primeiro, confirma o cupom, imprime, controla periféricos, **sem** assumir rede. Se há link com o edge, melhor (preço fresco, sync rápido); se não há, o caixa não para. Essa é a tradução direta da restrição física do ADR-001 para o caixa.

```
  NORMAL (link LAN ok)              QUEDA DE LAN/edge                 QUEDA DE WAN (edge isolado)
  PDV ──LAN──> EDGE ──WAN──> NUVEM  PDV (sozinho, cache local)        PDV ──LAN──> EDGE (autônomo)
  vende, sync rápido               vende offline, fila local         vende; edge acumula p/ nuvem
                                   reconcilia quando edge volta      empurra à nuvem quando WAN volta
```

## O que o PDV precisa ter local (carga inicial)

Para vender autônomo, o PDV recebe do edge uma **carga inicial** e a mantém atualizada por sync incremental:

- **Cadastro de produto da loja** — descrição, EAN(s), unidade, dados fiscais (NCM, CST/CSOSN, alíquotas) — porque a tributação do item é calculada no cupom, offline.
- **Preço vigente** — preço e promoção com vigência armada, para aplicar sem consultar ninguém.
- **Parâmetros fiscais** — série/numeração do documento, certificado, regras de UF, modo de contingência.
- **Sequências locais** — numeração de cupom reservada para aquele caixa, para não colidir offline.

A carga inicial é grande e idempotente: pode ser re-aplicada (ex.: PDV reinstalado) sem efeito colateral. O **delta** (mudou um preço, entrou um produto) vem como sync incremental do edge.

## O que substitui o Horse

No legado, o microframework **Horse** (Delphi estilo Express) fazia a ponte PDV↔retaguarda de forma artesanal. No Apollo, **o edge é o sucessor do Horse** (ver [target-architecture.md](target-architecture.md)): conteinerizado, versionado, resiliente. A diferença não é só de tecnologia — é de **contrato**:

- O sync vira um **protocolo explícito, versionado e backward-compatible** (ADR-009), porque edge e PDV ficam offline/pinados em versões diferentes da nuvem ao mesmo tempo. Não existe mais "trocar todos os exes na mesma janela".
- O detalhe do protocolo — envelope de mensagem, ordering, watermark, batch, ack — está em [../05-migration-engineering/sync-protocol.md](../05-migration-engineering/sync-protocol.md). Aqui tratamos do **arquitetural**: direção do fluxo, reconciliação, idempotência e contingência.

## Direção do fluxo (quem é dono de quê)

A reconciliação só é tratável se cada dado tiver **um dono claro**:

| Dado | Nasce em | Direção | Quem vence em conflito |
|---|---|---|---|
| **Venda / cupom** | PDV | PDV → edge → nuvem (push) | PDV (a venda aconteceu; é fato consumado) |
| **Preço / promoção** | Retaguarda (nuvem) | nuvem → edge → PDV (pull/publish) | Central (a retaguarda é dona do preço) |
| **Cadastro de produto** | Retaguarda (nuvem) | nuvem → edge → PDV | Central |
| **Estoque** | Misto (venda baixa local; entrada na retaguarda) | bidirecional, conciliado | Regra de negócio (não "último a escrever") |

A venda é **append-only** vindo do PDV — fato que já ocorreu, nunca "perde" para a central. Preço/cadastro são **publicados** pela central — a loja consome. Essa assimetria é o que torna a reconciliação determinística.

## Reconciliação quando o link volta

Quando a conectividade retorna (LAN PDV↔edge, ou WAN edge↔nuvem), reconcilia-se em **uma direção por vez**, governado por idempotência:

```
  RECONCILIAÇÃO (link volta)
  1. PDV envia ao edge o batch de vendas offline (cada cupom com client-generated id estável).
  2. EDGE aplica idempotente: id já visto → ignora (não duplica); id novo → persiste + ack.
  3. EDGE empurra à nuvem o consolidado (mesma garantia de idempotência).
  4. EDGE puxa da nuvem os deltas de preço/cadastro acumulados e re-publica aos PDVs.
  5. Watermark avança: cada lado sabe "até onde" já sincronizou (resume sem reenviar tudo).
```

### Idempotência (a espinha dorsal)

Sem idempotência, toda reconexão é um risco de **duplicar venda** (ou perder, se o ack se perde e ninguém re-tenta). Regras:

- **Identidade estável gerada na origem.** O cupom recebe um id no PDV (ex.: `pdvId + sequencialLocal`, ou ULID) **antes** de ir à rede. Reenviar o mesmo cupom não cria outro — o edge reconhece o id.
- **Upsert por chave natural, não insert cego.** O edge faz `INSERT ... ON CONFLICT DO NOTHING/UPDATE` sobre a identidade do cupom.
- **Ack + retry com a mesma identidade.** Se o ack se perde, o PDV re-tenta o **mesmo** id; o edge, idempotente, não duplica.
- **Watermark/cursor.** Cada lado guarda "sincronizei até X", para retomar sem reenviar histórico inteiro.

```sql
-- edge: ingestão idempotente de venda vinda do PDV
INSERT INTO venda (cupom_uid, pdv_id, store_id, emitido_em, total, payload)
VALUES (:cupomUid, :pdvId, :storeId, :emitidoEm, :total, :payload)
ON CONFLICT (cupom_uid) DO NOTHING;  -- reenvio não duplica
```

## Contingência fiscal offline (driver de arquitetura)

Este é o ponto onde "offline" deixa de ser preferência de engenharia e vira **requisito legal**. No varejo brasileiro, quando **SEFAZ ou a internet caem**, a venda **não pode parar** — a lei prevê **emissão em contingência**: o PDV emite o documento fiscal localmente, autorizado mais tarde, e **transmite quando o serviço volta**. Implicações que moldam a arquitetura (e são parte do risco-coroa — ver [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md)):

- **O PDV precisa decidir e emitir sozinho.** Detecta indisponibilidade (SEFAZ fora, sem WAN), entra em contingência, gera o documento com a marcação correta, imprime, e **enfileira para transmissão posterior**. Isso só é possível porque a tributação e a numeração estão **locais** (carga inicial acima).
- **Numeração e séries reservadas.** Documentos de contingência consomem numeração/série específicas; o controle é local e reconciliado depois — não pode colidir nem furar sequência.
- **Transmissão diferida idempotente.** Quando SEFAZ volta, o backlog de documentos em contingência é transmitido — com a **mesma identidade**, para não autorizar em duplicidade.
- **A janela de offline é indeterminada.** Pode ser minutos ou horas. O PDV/edge têm de aguentar acumular sem perder, o que reforça banco local robusto e watermark.

> A contingência é a razão de a arquitetura ser offline-first **por design**, não por conveniência. Um desenho que assumisse "sempre online" seria **ilegal** de operar num apagão de SEFAZ. O fiscal é tratado como trilha de risco dedicada desde a fase 0 ([../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md), ADR-010); o detalhe de modos de contingência (SVC, offline NFC-e, FS-DA) vive na trilha fiscal e no [../05-migration-engineering/sync-protocol.md](../05-migration-engineering/sync-protocol.md).

## Resolução de conflito é regra de negócio, não "último a escrever"

O cenário clássico: **a central mudou o preço de um item enquanto o PDV vendeu offline** com o preço antigo. "Last-write-wins" técnico está **errado** aqui — quem decide é a **regra de negócio**:

- A **venda já ocorrida** ao preço antigo é **fato consumado** — não se reescreve uma nota fiscal emitida. O cupom vale com o preço praticado no ato.
- O **novo preço** vale para vendas **a partir** do momento em que o PDV recebeu a vigência. A central é dona do preço **futuro**, não do passado já vendido.
- O efeito (diferença de margem, eventual ajuste) é **registrado e reconciliado** como dado de negócio, não silenciado por um merge automático.

Generalizando: conflitos de sync **não** se resolvem com timestamp técnico; resolvem-se com a **semântica do dado** (venda = imutável; preço = vigência; estoque = regra de baixa/entrada). Cada tipo de dado declara sua política de conflito explicitamente. Essas políticas são extraídas do legado via **dossiê** (a regra real do Delphi) e formalizadas no protocolo de sync.

## Ver também

- [target-architecture.md](target-architecture.md) — as 3 camadas e a regra PDV→edge.
- [heavy-days-thundering-herd.md](heavy-days-thundering-herd.md) — picos previsíveis (SPED) e capacidade.
- [../05-migration-engineering/sync-protocol.md](../05-migration-engineering/sync-protocol.md) — o protocolo de sync detalhado (sucessor do Horse).
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — o risco-coroa fiscal e a contingência.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-008, ADR-001, ADR-009.
