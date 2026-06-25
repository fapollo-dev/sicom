# Versionamento & Compatibilidade

> Por que o contrato de API e de sync tem de ser **backward-compatible para sempre** (só aditivo, nunca quebrar campo, depreciar devagar) — porque PDV e edge ficam offline ou pinados em versões diferentes por dias ou semanas. A negociação de versão, o **módulo fiscal pinável independente** (ADR-010), as feature flags por tenant e o rollout canário. E a mudança cultural mais dura: acabou o "trocar todos os exes na mesma janela".

## Pré-requisitos de leitura

- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — **ADR-009** (contrato backward-compatible, janela de versão), **ADR-010** (fiscal pinável), ADR-008 (PDV offline/pinado), ADR-003 (db-per-tenant).
- [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md) — por que o PDV opera dias sem subir de versão.
- [migrations-expand-contract.md](migrations-expand-contract.md) — a face "interna" (schema) do mesmo princípio; esta é a face "externa" (contrato).

## O fato que comanda tudo: o campo não atualiza junto

No Delphi client-server, a compatibilidade era trivial: numa madrugada, trocavam-se **todos** os executáveis e o schema, e na manhã seguinte tudo falava a mesma língua. **Esse mundo acabou.** No Apollo:

- O **PDV** é Electron, offline-first (ADR-008). Ele pode passar **dias** sem ver a nuvem (loja com link ruim, caixa que só liga em horário de pico, contingência fiscal de SEFAZ). Quando reconecta, ainda está na versão de duas semanas atrás.
- O **edge** da loja também atrasa updates — não se reinicia o edge no meio do movimento.
- Os **900 tenants** migram cada um no seu tempo (ADR-003). A nuvem que atende o tenant A já está na vN+1 enquanto o PDV do tenant A ainda fala vN.

> **Consequência:** em qualquer instante, a nuvem está conversando com PDVs e edges de **várias versões ao mesmo tempo**. O contrato entre eles tem de absorver isso. Quem garante a compatibilidade é **o lado novo** (a nuvem), não o lado velho (o PDV no campo, que não pode ser obrigado a subir).

## A regra: só aditivo, nunca quebrar campo

Backward-compatibility se reduz a uma disciplina mecânica no contrato (payload de sync, resposta de API):

| Permitido (não quebra o velho) | Proibido (quebra o velho) |
|---|---|
| **Adicionar** campo **opcional** novo | **Remover** um campo que o velho lê |
| **Adicionar** endpoint/mensagem nova | **Renomear** um campo (= remover + adicionar) |
| **Adicionar** valor novo num enum **tolerante** | **Mudar o tipo** de um campo (string→number) |
| **Relaxar** uma validação (aceitar mais) | **Apertar** uma validação (rejeitar o que antes passava) |
| **Tornar opcional** um campo antes obrigatório | **Tornar obrigatório** um campo antes opcional |
| Deixar de **enviar** um campo opcional | Mudar o **significado** de um campo (semântica) |

O cliente velho ignora o que não conhece (campos a mais) e continua achando o que conhece (campos que nunca somem). É o **mesmo princípio do expand/contract** do schema ([migrations-expand-contract.md](migrations-expand-contract.md)), aplicado ao **fio** em vez do **banco**: nunca se renomeia/dropa no contrato; adiciona-se o novo, deprecia-se o velho devagar, e só se remove o velho quando **todos** subiram.

### Tolerância no parsing (robustez de campo)

Compatibilidade não é só do servidor — o **cliente** tem de ser tolerante: ignorar campos desconhecidos, não estourar com um enum novo, ter default para campo ausente. Um cliente que dá erro ao ver um campo a mais quebra a regra na prática.

```ts
// PDV/edge: schema TOLERANTE (Zod). campos desconhecidos são ignorados,
// campo novo é opcional, enum desconhecido cai num default seguro.
const ProdutoSync = z.object({
  id: z.number(),
  preco: z.number(),
  // campo introduzido na v38: o PDV v37 nem tem essa linha; o v38 trata como opcional
  origem_preco: z.enum(['central', 'promocao', 'loja']).catch('central').optional(),
}).passthrough();   // <- NÃO rejeita chaves extras que o futuro mandar
```

```ts
// servidor (nuvem): NUNCA deixa de mandar o campo antigo enquanto há cliente velho.
// adiciona o novo ao lado. depreciar != remover.
function toProdutoPayload(p: Produto, clientVersion: number) {
  const base = { id: p.id, preco: p.preco };       // contrato v1, sempre presente
  if (clientVersion >= 38) {
    return { ...base, origem_preco: p.origemPreco }; // aditivo p/ quem entende
  }
  return base;                                       // v37 recebe o que sempre recebeu
}
```

## Negociação de versão

Para o servidor saber **com quem** está falando (e enviar a forma compatível), o cliente declara sua versão de protocolo no handshake/sync. O servidor responde dentro da **janela suportada** (N e N-1; ver abaixo) ou recusa educadamente quem está fora dela, pedindo update.

```jsonc
// handshake de sync: o edge/PDV declara o que fala
{
  "client": { "kind": "pdv", "appVersion": "2026.5.3", "protocol": 7 },
  "tenantId": "xpto",
  "storeId": 4,
  "deviceId": "pdv-04-caixa-02"
}
```

```jsonc
// resposta do servidor: confirma a versão efetiva e sinaliza depreciação
{
  "protocol": 7,                       // efetiva (o servidor fala 7 e 8)
  "minSupported": 7,                   // janela: N-1
  "current": 8,                        // janela: N
  "deprecations": [
    { "field": "preco_venda", "since": 8, "removeAtProtocol": 9,
      "note": "use preco_unitario; renomeado no schema, mantido no fio até protocol 9" }
  ],
  "updateRecommended": true
}
```

A negociação dá três coisas: (1) o servidor **molda o payload** para a versão do cliente; (2) o cliente fica sabendo o que está **depreciado** e tem tempo de migrar; (3) o servidor consegue **medir** quantos clientes ainda estão no velho — dado que governa quando o contract é seguro.

## Depreciar devagar (não é remover; é avisar e esperar)

Depreciação é um **processo**, não um delete:

1. **Anunciar** — o campo/endpoint velho continua funcionando, mas a resposta marca `deprecated` e aponta o substituto (como no `deprecations` acima). O novo já existe (aditivo).
2. **Migrar os clientes** — durante semanas, os PDVs/edges sobem de versão e passam a usar o novo. A telemetria conta quantos ainda usam o velho.
3. **Aposentar** — quando o uso do velho **zera** (ou cai sob um limiar aceitável e os retardatários foram forçados a atualizar), aí — e só aí — o campo velho sai do contrato. Esse é o **contract** do parallel change, do lado do fio.

> A **janela de 1 versão (N e N-1)** vale também aqui (ADR-009). O servidor garante falar com a versão atual e a imediatamente anterior — **não** com todas as versões da história. Manter compat com v3, v4, v5… para sempre é o caminho do código impossível de manter. Por isso o passo de **aposentar é ativo e agendado**, e retardatários muito atrasados são forçados a atualizar (com aviso). "Backward-compatible para sempre" significa "nunca quebrar **dentro da janela**", não "carregar todo o passado eternamente".

## O módulo fiscal é pinável independente (ADR-010)

Este é o ponto onde versionamento encontra o risco-coroa. O motor fiscal tem uma propriedade única: a **versão certificada às vezes é obrigatória por lei**, e a legislação muda várias vezes por ano. Daí a decisão:

> **O módulo fiscal é versionável e pinável independentemente do resto da aplicação. O update geral NÃO arrasta o fiscal junto, e o fiscal pode ser atualizado SEM redeploy geral.**

Implicações concretas:

- **Pin separado.** Um tenant (ou uma UF) pode ficar **pinado** numa versão fiscal certificada (`fiscal-engine 4.2.1`) enquanto o resto da app evolui livremente para a `2026.6`. O inverso também: uma correção fiscal urgente (mudou uma alíquota por lei) sobe **sozinha**, sem esperar o trem de release geral.
- **Contrato estável entre app e fiscal.** O resto da aplicação fala com o motor fiscal por uma **interface versionada** (calcular tributos, emitir documento, transmitir). Essa interface é backward-compatible pela mesma regra acima, para que app `2026.6` e `fiscal 4.2` (pinado) conversem.
- **Parametrização sem redeploy.** Regras por UF/município são **dados parametrizáveis** (carregados/atualizáveis), não código que exige build — ver risco-coroa em [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md). Trocar uma alíquota é dado, não deploy.
- **Pin no PDV também.** O PDV no campo precisa da versão fiscal certificada para emitir em contingência (ADR-008); o update do resto do PDV não pode forçar uma versão fiscal não-certificada. O fiscal é uma dependência **pinável** dentro do PDV.

```jsonc
// manifesto de versão de um tenant: fiscal PINADO, resto livre
{
  "tenantId": "xpto",
  "app": "2026.6.0",
  "fiscalEngine": "4.2.1",            // PIN: versão certificada; não sobe com o app
  "fiscalRules": { "version": "2026-06-01", "ufs": ["SP", "AM", "MG"] }, // dado, sem redeploy
  "protocolSync": 8
}
```

Tratar o fiscal como "mais um módulo que sobe junto" é o anti-objetivo da canon ([../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md)). Versionamento independente é o que permite (a) atender obrigação legal de versão certificada e (b) reagir rápido a mudança de lei sem arrastar risco para o resto.

## Feature flags por tenant + rollout canário

Compatibilidade resolve "não quebrar o velho"; **flags e canário** resolvem "ligar o novo com segurança". Como cada cliente é um tenant isolado (ADR-003), o rollout é naturalmente **por tenant**:

- **Feature flag por tenant.** Uma capability nova (tela nova, regra nova, otimização) liga primeiro para um tenant piloto, depois para um grupo, depois geral. A flag mora no registry/config do tenant, lida pela app stateless.
- **Canário.** O deploy de código (rolling/blue-green, [../07-devops-infra/ci-cd-zero-downtime.md](../07-devops-infra/ci-cd-zero-downtime.md)) sobe para uma fração da frota e/ou um conjunto de tenants de baixo risco; observa-se métrica/erro; só então expande. É o mesmo espírito do **migration runner** em lote ([migrations-expand-contract.md](migrations-expand-contract.md)): canário → expande → completa.
- **Kill switch.** Toda feature arriscada tem desligamento por tenant sem redeploy — paridade com a operação real (se o novo diverge do legado num cliente, desliga **só** aquele).

```ts
// flag por tenant: o novo caminho só liga para quem está habilitado
async function precoVigente(tenant: TenantContext, produtoId: number) {
  const db = await tenant.db();
  if (await flags.enabled('novo_motor_preco', tenant.tenantId)) {
    return novoMotorPreco(db, produtoId);    // caminho novo, canário por tenant
  }
  return motorPrecoLegado(db, produtoId);    // caminho provado, default
}
```

> Flag e canário **não substituem** o teste de paridade — eles **limitam o raio de dano** enquanto a paridade é confirmada em produção real. Verde no eval só conta se exercita o caminho real ([../00-orientation/how-agents-work.md](../00-orientation/how-agents-work.md)); a flag deixa rodar o caminho real num tenant controlado.

## A mudança cultural: acabou o "trocar todos os exes na mesma janela"

Vale nomear o que muda na cabeça da equipe, porque é a fonte da maioria dos erros de quem vem do Delphi:

| Mundo Delphi (antes) | Mundo Apollo (agora) |
|---|---|
| Schema e exes trocam **juntos**, numa madrugada | Schema migra por tenant; código sobe rolling; **versões coexistem** |
| "A versão" é única e global | Versão é **por tenant**, **por edge**, **por PDV**, **por fiscal** |
| Mudança destrutiva é OK (todo mundo subiu junto) | Mudança destrutiva é **proibida no lugar**; vira expand/contract |
| Quebrar contrato é só recompilar o cliente | Cliente no campo está offline; **o servidor** garante compat |
| Fiscal sobe com o resto | Fiscal é **pinável**, sobe (ou não) independente |
| "Deu erro? Reinstala o exe" | "Deu erro? **kill switch** por tenant, sem redeploy" |

Internalizar isto é o pré-requisito de tudo nesta seção. Quem ainda pensa "vou só renomear o campo e atualizar o cliente" vai derrubar produção — não porque errou o código, mas porque assumiu um mundo que não existe mais.

## Ver também

- [migrations-expand-contract.md](migrations-expand-contract.md) — a face interna (schema) do mesmo princípio; o exemplo do rename de coluna ponta a ponta.
- [sync-protocol.md](sync-protocol.md) — onde a negociação de versão e o envelope versionado vivem em detalhe.
- [../01-architecture/offline-edge-sync.md](../01-architecture/offline-edge-sync.md) — por que o PDV fica pinado/offline (a origem da exigência).
- [../07-devops-infra/ci-cd-zero-downtime.md](../07-devops-infra/ci-cd-zero-downtime.md) — rolling/blue-green, canário, flags na esteira.
- [../00-orientation/mission-and-principles.md](../00-orientation/mission-and-principles.md) — o risco-coroa fiscal e a parametrização sem redeploy.
- [../00-orientation/canonical-decisions.md](../00-orientation/canonical-decisions.md) — ADR-009, ADR-010, ADR-008.
