# Protocolo de Sync (sucessor do Horse)

> O arquivo-coroa do edge↔nuvem. O protocolo explícito, versionado e backward-compatible que **substitui o Horse** (ADR-008): carga inicial (bootstrap do edge/PDV), sync incremental por watermark/changelog, **resolução de conflito como regra de negócio** (não last-write-wins), **idempotência** (chaves de idempotência, dedup, `ON CONFLICT`), ordenação, fila offline no PDV, reconciliação e **transmissão de contingência fiscal**. Com payloads JSON e fluxos concretos.

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-008** (PDV offline-first, edge sucede o Horse), **ADR-001** (PDV fala com o edge, nunca com a nuvem), **ADR-009** (contrato backward-compatible).
- [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md) — a face arquitetural: direção do fluxo, dono do dado, contingência como driver. **Leia primeiro** — esta página é o detalhe do protocolo que aquela referencia.
- [versioning-and-compatibility.md](versioning-and-compatibility.md) — negociação de versão e regra "só aditivo" do envelope.
- [../00-orientation/glossary.md](../00-orientation/glossary.md) — Horse, contingência, NFC-e/SAT, watermark.

## O que o protocolo substitui (e por que é contrato, não só código)

No legado, o **Horse** (microframework Delphi estilo Express) fazia a ponte PDV↔retaguarda de forma artesanal: endpoints ad-hoc, sem versão, sem garantia de idempotência, "funciona porque sempre funcionou". O Apollo troca isso por um **protocolo de primeira classe** (ADR-008), porque o mundo mudou: edge e PDV ficam offline ou pinados em versões diferentes da nuvem por dias ([versioning-and-compatibility.md](versioning-and-compatibility.md)). A diferença não é a tecnologia — é o **contrato**: envelope versionado, ordering, watermark, idempotência e ack explícitos.

Os três pontos de sync (lembrando ADR-001 — o PDV **nunca** fala direto com a nuvem):

```
  PDV  ──LAN──>  EDGE  ──WAN──>  NUVEM
  (Electron,     (sucessor do    (multi-tenant,
   SQLite)        Horse)          db-per-tenant)
```

Cada hop (PDV↔edge e edge↔nuvem) usa o **mesmo protocolo**, com a mesma garantia de idempotência e watermark — é o que torna a reconciliação encadeada determinística.

## O envelope (versionado, aditivo)

Toda mensagem de sync viaja num envelope comum. Ele carrega a versão de protocolo (negociada — [versioning-and-compatibility.md](versioning-and-compatibility.md)), a identidade de origem, o watermark e o lote.

```jsonc
// envelope de PUSH (PDV/edge -> cima): vendas, documentos, eventos
{
  "protocol": 8,                          // versão negociada no handshake
  "source": { "kind": "pdv", "deviceId": "pdv-04-caixa-02",
              "tenantId": "xpto", "storeId": 4 },
  "batchId": "01HZ...ULID",               // id do lote (idempotência de lote)
  "sinceWatermark": "0/1A2B3C",           // de onde este lado parou de enviar
  "items": [ /* changes, cada um com sua idempotencyKey (abaixo) */ ],
  "sentAt": "2026-06-23T14:35:07Z"
}
```

```jsonc
// envelope de ACK (cima -> baixo): confirma o que foi aplicado
{
  "protocol": 8,
  "batchId": "01HZ...ULID",
  "applied":   ["cup_xpto_4_2_000812", "cup_xpto_4_2_000813"],  // ids aceitos
  "duplicates":["cup_xpto_4_2_000811"],                          // já vistos, ignorados (idempotente)
  "rejected":  [ { "id": "cup_xpto_4_2_000814", "reason": "schema", "detail": "..." } ],
  "newWatermark": "0/1A2C10"              // avança o cursor do remetente
}
```

Regra do envelope (ADR-009): **só aditivo**. Campos novos são opcionais; nenhum campo existente é removido/renomeado/re-tipado — porque o PDV pinado ainda fala a forma antiga. Campos desconhecidos são ignorados pelo receptor tolerante.

## Carga inicial (bootstrap do edge/PDV)

Antes de sincronizar deltas, um PDV (ou edge) novo/reinstalado precisa do **estado completo** para operar autônomo (a lista de "o que o PDV precisa ter local" está em [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md)): cadastro de produto, preço vigente, parâmetros fiscais, sequências reservadas.

Propriedades do bootstrap:

- **Idempotente / re-aplicável** — um PDV reinstalado roda o bootstrap de novo sem efeito colateral (upsert, não insert cego).
- **Paginado / retomável** — a carga é grande; vem em páginas com cursor, e uma queda no meio retoma da última página, não do zero.
- **Termina num watermark** — ao fim do bootstrap, o cliente recebe o watermark "você está consistente até aqui"; dali em diante é só **incremental**.

```jsonc
// pedido de bootstrap do PDV (após handshake/negociação de versão)
{ "protocol": 8, "op": "bootstrap.request",
  "source": { "kind": "pdv", "deviceId": "pdv-04-caixa-02", "tenantId": "xpto", "storeId": 4 },
  "datasets": ["produto", "preco_vigente", "param_fiscal", "sequencia_local"],
  "cursor": null }              // null = começo; senão, retoma da página

// resposta paginada
{ "protocol": 8, "op": "bootstrap.page",
  "dataset": "produto",
  "rows": [ { "id": 1001, "ean": ["7891000100103"], "desc": "ARROZ TIPO1 5KG",
              "ncm": "10063021", "cst": "00", "aliq_icms": 18.0 } /* ... */ ],
  "nextCursor": "produto:1001",   // passa de volta para a próxima página
  "done": false }

// última página de tudo -> entrega o watermark inicial
{ "protocol": 8, "op": "bootstrap.complete", "watermark": "0/19FF00" }
```

A partir de `bootstrap.complete`, o cliente só pede **deltas desde o watermark**.

## Sync incremental (watermark / changelog)

O coração do sync contínuo. Cada lado mantém um **changelog** (o que mudou) e um **watermark** (até onde o outro lado já consumiu). Em vez de comparar estados inteiros, transmite-se **só o delta** desde o watermark.

### O changelog (origem da verdade do delta)

Cada mudança publicável vira uma linha num changelog **ordenado e monotônico** (uma sequência por origem). No Postgres da nuvem/edge, a fonte natural é uma tabela de outbox/changelog alimentada por trigger ou pela própria escrita de domínio:

```sql
-- changelog de publicação (nuvem->edge->PDV): preço/cadastro que a central muda
CREATE TABLE changelog (
  seq         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,  -- ordem monotônica
  entity      text   NOT NULL,        -- 'produto' | 'preco_vigente' | 'param_fiscal'
  entity_id   text   NOT NULL,
  op          text   NOT NULL,        -- 'upsert' | 'delete'
  payload     jsonb  NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- o consumidor (edge) pede tudo com seq > watermark, em ordem
SELECT seq, entity, entity_id, op, payload
FROM   changelog
WHERE  seq > :watermark
ORDER  BY seq
LIMIT  :pageSize;
```

```jsonc
// PULL incremental: o edge pede deltas desde o watermark que guardou
{ "protocol": 8, "op": "pull.request", "sinceWatermark": "0/19FF00",
  "source": { "kind": "edge", "tenantId": "xpto", "storeId": 4 } }

// resposta: delta ordenado + novo watermark
{ "protocol": 8, "op": "pull.page",
  "changes": [
    { "seq": 6610001, "entity": "preco_vigente", "id": "1001",
      "op": "upsert", "payload": { "produto_id": 1001, "preco": 24.90,
                                   "vigencia_inicio": "2026-06-23T00:00:00Z" } }
  ],
  "newWatermark": "0/19FF40", "done": true }
```

O watermark é **opaco para o cliente** (ele só guarda e devolve) e **monotônico no servidor**. Avançar o watermark é o que permite **retomar sem reenviar o histórico** — exatamente o ponto 5 da reconciliação em [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md).

### Ordenação

A ordem importa onde há dependência causal (o `delete` de um preço tem de vir depois do `upsert` que o criou; uma devolução depois da venda). Garantias:

- **Por origem, ordenado por `seq`** monotônico — dentro de um stream, a ordem é a do changelog.
- **Idempotência cobre o resto** — se duas entidades independentes chegam fora de ordem, não há problema porque cada uma é um upsert idempotente por chave.
- **Operações causalmente dependentes compartilham o stream/chave** para herdar a ordem (ex.: tudo de um cupom — venda, itens, pagamento — num envelope coeso).

## Idempotência (a espinha dorsal)

Sem idempotência, **toda reconexão arrisca duplicar** (ou perder, se o ack se perde e ninguém re-tenta). Esta é a garantia mais importante do protocolo. Mecânica:

1. **Identidade estável gerada na origem.** O cupom recebe um id no PDV **antes** de ir à rede — `tenant + store + pdv + sequencialLocal`, ou um ULID. Reenviar o mesmo cupom **não** cria outro.
2. **Idempotency key por mudança** + **batchId por lote.** A key dedup no nível do item; o batchId permite o servidor reconhecer "este lote inteiro eu já processei" e devolver o mesmo ack.
3. **Upsert por chave natural, não insert cego** — `ON CONFLICT DO NOTHING/UPDATE` sobre a identidade.
4. **Ack + retry com a MESMA identidade** — ack perdido ⇒ o PDV re-tenta o **mesmo** id ⇒ o servidor, idempotente, não duplica e devolve o id em `duplicates`.

```jsonc
// item de PUSH com chave de idempotência estável (gerada no PDV, offline)
{ "idempotencyKey": "cup_xpto_4_2_000812",   // tenant_store_pdv_seqLocal
  "entity": "venda",
  "op": "create",
  "payload": {
    "cupomUid": "cup_xpto_4_2_000812",
    "emitidoEm": "2026-06-23T14:35:07Z",
    "storeId": 4, "pdvId": 2,
    "itens": [ { "produtoId": 1001, "qtd": 2, "precoUnit": 24.90, "total": 49.80 } ],
    "pagamentos": [ { "tipo": "dinheiro", "valor": 49.80 } ],
    "total": 49.80
  } }
```

```sql
-- ingestão idempotente no edge/nuvem: reenvio do MESMO cupom não duplica
INSERT INTO venda (cupom_uid, tenant_id, store_id, pdv_id, emitido_em, total, payload)
VALUES (:cupomUid, :tenantId, :storeId, :pdvId, :emitidoEm, :total, :payload)
ON CONFLICT (cupom_uid) DO NOTHING;          -- já existe -> ignora, vira 'duplicate' no ack

-- dedup de lote: registra batch processado para devolver o mesmo ack se reenviado
INSERT INTO sync_batch (batch_id, source_device, processed_at)
VALUES (:batchId, :deviceId, now())
ON CONFLICT (batch_id) DO NOTHING;
```

> Idempotência é o que permite **retry agressivo** sem medo. O PDV pode reenviar o lote quantas vezes precisar (link instável) — o pior que acontece é o servidor responder "já vi, ignorei". Nunca duplica venda, nunca duplica documento fiscal.

## Fila offline no PDV

O PDV grava local primeiro (SQLite) e **enfileira** o que precisa subir; um worker drena a fila quando há link. A fila é durável (sobrevive a reboot do caixa) e ordenada.

```sql
-- SQLite local do PDV: outbox durável das mudanças a sincronizar
CREATE TABLE outbox (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,   -- ordem local
  idempotency_key TEXT NOT NULL UNIQUE,               -- estável, gerada aqui
  entity         TEXT NOT NULL,
  payload        TEXT NOT NULL,                        -- json
  status         TEXT NOT NULL DEFAULT 'pending',      -- pending|sent|acked
  attempts       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
```

```ts
// drain da outbox (PDV): roda quando há link com o edge; idempotente + retry/backoff
async function drainOutbox(edge: EdgeClient, db: SqliteDb) {
  const pending = db.all(`SELECT * FROM outbox WHERE status IN ('pending','sent') ORDER BY seq LIMIT 200`);
  if (pending.length === 0) return;

  const batchId = ulid();
  const ack = await edge.push({                       // retry/backoff é do EdgeClient
    protocol: NEGOTIATED, batchId,
    sinceWatermark: db.get('watermark'),
    items: pending.map(toItem),
  });
  // ack aplicado E duplicados ambos viram 'acked' (idempotente: duplicado = já estava lá)
  const done = new Set([...ack.applied, ...ack.duplicates]);
  for (const row of pending) {
    if (done.has(row.idempotency_key)) db.run(`UPDATE outbox SET status='acked' WHERE seq=?`, row.seq);
    else db.run(`UPDATE outbox SET status='sent', attempts=attempts+1 WHERE seq=?`, row.seq);
  }
  db.set('watermark', ack.newWatermark);
}
```

A venda **nunca** depende do sucesso do sync: ela é confirmada e impressa local; o sync é assíncrono e tolerante a falha. Isso é a tradução direta do offline-first (ADR-008).

## Resolução de conflito: regra de negócio, não last-write-wins

O cenário-âncora (de [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md)): **a central mudou o preço enquanto o PDV vendeu offline com o preço antigo.** "Last-write-wins" técnico está **errado** — quem decide é a **semântica do dado**. Cada entidade declara sua política:

| Entidade | Política de conflito | Por quê |
|---|---|---|
| **Venda / cupom / documento fiscal** | **Imutável (append-only).** A venda do PDV **sempre** entra; nunca "perde" para a central. | A venda **aconteceu**; não se reescreve nota fiscal emitida. Fato consumado. |
| **Preço / promoção** | **Vigência.** O preço da central vale **a partir** da vigência que o PDV recebeu; o passado já vendido fica com o preço praticado. | A central é dona do preço **futuro**, não do passado. |
| **Cadastro de produto** | **Central vence** (publish). | A retaguarda é a fonte; a loja consome. |
| **Estoque** | **Regra de baixa/entrada** (não timestamp). Venda baixa local; entrada na retaguarda; concilia. | Quantidade é resultado de eventos, não de "quem escreveu por último". |

```jsonc
// declaração de política por entidade (o servidor aplica na ingestão)
{
  "venda":         { "conflict": "immutable_append" },     // PDV sempre entra
  "preco_vigente": { "conflict": "validity_window", "field": "vigencia_inicio" },
  "produto":       { "conflict": "central_wins" },
  "estoque":       { "conflict": "business_rule", "rule": "movimento" }
}
```

O caso preço, resolvido: o cupom que vendeu a R$ 22,90 **fica** a R$ 22,90 (immutable_append — venda é imutável); o preço novo R$ 24,90 vale para vendas **após** sua vigência (validity_window). A diferença de margem é **registrada e reconciliada** como dado de negócio, **não** silenciada por um merge automático. Essas políticas são **extraídas do legado via dossiê** (a regra real do Delphi) e formalizadas aqui — não inventadas.

## Reconciliação

Quando o link volta, reconcilia-se **uma direção por vez**, governado por idempotência e watermark (o passo a passo está em [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md)). O protocolo materializa cada passo:

```
  1. PDV  --push-->  EDGE   (outbox drena; batchId + idempotencyKey; ack idempotente)
  2. EDGE  upsert ON CONFLICT  (id já visto -> 'duplicate'; novo -> persiste + ack)
  3. EDGE --push-->  NUVEM   (mesmo protocolo, mesma idempotência, encadeado)
  4. EDGE --pull-->  NUVEM   (deltas de preço/cadastro desde watermark) --publish--> PDVs
  5. watermarks avançam dos dois lados (resume sem reenviar histórico)
```

Além do fluxo, uma **reconciliação de controle** periódica detecta divergência sem reenviar tudo: comparar **contagens e checksums** por janela (ex.: total de cupons e soma de valores do dia por loja, PDV vs edge vs nuvem). Diverge ⇒ investiga ⇒ reenvia só a janela divergente. É o mesmo princípio da reconciliação de migração ([oracle-to-postgres.md](oracle-to-postgres.md)), aplicado ao fluxo contínuo.

```jsonc
// checagem de reconciliação (barata, ordem-independente)
{ "op": "reconcile.check", "window": "2026-06-23", "storeId": 4,
  "counts": { "venda": 812 }, "sums": { "venda_total": "41250.70" },
  "hash": "md5:9f2c..." }     // diverge do lado de cima -> reenvia só esta janela
```

## Transmissão de contingência fiscal

O ponto onde o protocolo encontra o **risco-coroa** e onde "offline" vira **requisito legal**. Quando SEFAZ/internet caem, o PDV emite o documento fiscal **em contingência** local, autorizado depois, e **transmite quando o serviço volta** (detalhe arquitetural em [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md)). O sync trata isso como um stream **especial e prioritário**:

- **Documento gerado e marcado offline.** O PDV gera o documento com a marcação de contingência, **número/série reservados localmente** (não pode colidir nem furar sequência), imprime, e enfileira para **transmissão posterior** — distinto da venda comum, porque carrega obrigação fiscal.
- **Transmissão diferida idempotente.** Quando SEFAZ volta, o backlog é transmitido com a **mesma identidade** (chave do documento), para **não autorizar em duplicidade** — uma NFC-e autorizada duas vezes é um problema fiscal grave. A idempotência aqui não é conforto: é conformidade.
- **Prioridade e estado.** Documentos fiscais em contingência têm prioridade na fila e um **estado de transmissão** rastreável (`pendente → transmitido → autorizado → rejeitado`), porque o fisco cobra a transmissão dentro de prazo.
- **Rejeição é tratada, não engolida.** Se a SEFAZ rejeita um documento na transmissão diferida, isso vira um evento de negócio (corrigir/reemitir), não um silêncio.

```jsonc
// item de contingência na fila de transmissão (sobe e transmite depois)
{ "idempotencyKey": "nfce_xpto_4_serie9_000455",   // chave do doc fiscal, estável
  "entity": "documento_fiscal",
  "op": "transmit",
  "priority": "high",
  "payload": {
    "modelo": "NFC-e", "serie": 9, "numero": 455,
    "contingencia": { "tipo": "offline", "emitidoEm": "2026-06-23T14:35:07Z",
                      "motivo": "SEFAZ indisponível" },
    "chaveAcesso": "3526...0455", "xmlAssinado": "<base64...>"
  } }
```

```sql
-- transmissão diferida idempotente: o MESMO documento nunca autoriza 2x
INSERT INTO transmissao_fiscal (chave_acesso, tenant_id, store_id, status, payload)
VALUES (:chave, :tenantId, :storeId, 'pendente', :payload)
ON CONFLICT (chave_acesso) DO NOTHING;   -- reenvio do backlog não re-autoriza
```

> O detalhe dos **modos** de contingência (SVC, offline NFC-e, FS-DA) vive na trilha fiscal dedicada (risco-coroa, [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md)). Aqui o que importa é que o protocolo **carrega** esses documentos com prioridade, identidade estável e estado — e que a idempotência impede a dupla autorização.

## Versão do protocolo (handshake)

Todo o acima roda sob a **negociação de versão** de [versioning-and-compatibility.md](versioning-and-compatibility.md): o cliente declara `protocol` no handshake, o servidor responde dentro da janela (N e N-1), e o envelope é **só aditivo** — porque o PDV pinado no campo ainda fala a forma antiga. Mudar o nome de um campo no fio é o **contract** do parallel change, feito só depois que todos os PDVs subiram. Schema interno (Postgres) e contrato de fio evoluem em ritmos diferentes (o exemplo do rename está em [migrations-expand-contract.md](migrations-expand-contract.md)).

## Ver também

- [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md) — a face arquitetural: 3 camadas, dono do dado, reconciliação, contingência como driver.
- [versioning-and-compatibility.md](versioning-and-compatibility.md) — negociação de versão e a regra "só aditivo" do envelope.
- [migrations-expand-contract.md](migrations-expand-contract.md) — schema vs contrato de fio; o rename de coluna que o PDV ainda usa.
- [oracle-to-postgres.md](oracle-to-postgres.md) — a reconciliação por contagem/checksum (mesmo princípio do reconcile.check).
- [../06-testing-quality/testing-strategy.md](../06-testing-quality/testing-strategy.md) — testes de offline/sync: idempotência, watermark, conflito = regra de negócio.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-008, ADR-001, ADR-009.
