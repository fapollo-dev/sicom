# Missão & Princípios

## Missão

Migrar um ERP de supermercados em **Delphi** (client-server: retaguarda, balcão, PDV) para uma
plataforma **web moderna multi-tenant** (NestJS + React/Vite + TypeScript + PostgreSQL), com
**PDV offline em Electron**, atendendo de pequenos mercados a redes multi-loja de altíssimo
volume — **sem perder nenhuma regra de negócio e sem perder o usuário** que opera no teclado.

## A tese central: contexto é tudo

Toda falha previsível desta migração tem a mesma raiz — **alguém olhou a superfície e não mergulhou
na camada de baixo.** Um ERP de 20+ anos não é o que a tela mostra; é o que o `.pas` faz, a SQL que
muta sob condicional, o `TDataModule` que outra tela deixou em certo estado, a regra fiscal que mudou
por lei três vezes no ano passado.

> **Não migre o que você vê. Migre o que o sistema faz.**

A vantagem do legado Delphi é que ele é **procedural** — está tudo ali, na ordem, legível de cima a
baixo. A obrigação é **ler e mergulhar em cada camada**, nunca presumir. O artefato que materializa
esse mergulho é o **dossiê de tela** (seção 04).

## Os 3 hábitos inegociáveis

1. **Fazer** — nenhuma tela vira código sem **dossiê** (regra extraída, SQL reconstruída, casos de teste capturados).
2. **Revisar** — todo artefato (dossiê, código, migration) passa por um **agente revisor** independente.
3. **Revisar legado × novo** — provar com **teste de paridade** que o novo produz *exatamente* o resultado do velho. Verde no eval só conta se exercita o caminho real (ver anti-objetivos).

Esse loop está detalhado em [how-agents-work.md](how-agents-work.md) e [../08-agents/review-loop.md](../08-agents/review-loop.md).

## Critérios de sucesso

- **Paridade comportamental provada** por tela (não "parece igual" — *é* igual, com golden tests).
- **Zero perda de regra de negócio**: toda condicional, validação e cálculo do legado mapeados e testados.
- **UX de teclado preservada**: taborder, Enter-avança-campo, F-keys e mnemônicos `&` idênticos (seção 02).
- **PDV opera 100% offline** e reconcilia sem perda nem duplicidade.
- **Deploy sem downtime** e **migration por tenant** sem travar os 900 clientes.
- **Cutover por cliente** com plano de rollback e reconciliação — go-live é evento controlado, não torcida.

## Anti-objetivos (o que NÃO fazer)

- ❌ **Microserviços no início.** Monólito modular primeiro; serviço só quando um módulo provar necessidade (ADR-006).
- ❌ **CQRS pesado / event-sourcing** sem necessidade. Read replica + rollups resolvem (ADR-007).
- ❌ **Big-bang.** Strangler, módulo a módulo, com legado convivendo (seção 10).
- ❌ **"Modernizar" atalhos e fluxos de teclado.** Replicar o mapa exato; a memória muscular do operador é o critério de aceite.
- ❌ **Confiar em eval verde que não exercita o caminho real.** Verde que não toca a SQL/condicional real é falsa confiança — exija que o teste de paridade rode o caminho que produção roda.
- ❌ **Tratar o fiscal como "mais um módulo".** É o risco-coroa (abaixo).

## O risco-coroa: o motor fiscal

O subsistema mais perigoso desta migração **não é a UI** — é o **fiscal/tributário brasileiro**:
NFC-e, NF-e, SAT-CF-e, SPED/EFD, TEF, certificado A1/A3, **contingência offline** e — o pior —
**legislação que muda por lei várias vezes por ano**. Implicações que atravessam todo o playbook:

- O motor fiscal precisa de **regras parametrizáveis por UF/município** e **atualizáveis sem redeploy geral**.
- A versão fiscal certificada às vezes é **pinada** — o update geral não pode arrastar o fiscal junto (ADR-010).
- **Contingência**: quando SEFAZ/internet cai, o PDV emite em contingência e transmite depois — requisito legal que molda a arquitetura offline (seção 01).
- TEF, impressora fiscal, balança e pinpad exigem **camada de drivers no Electron** + certificação com adquirentes.

Trate fiscal, TEF e periféricos como **trilha de risco dedicada desde a fase 0** — ver [../10-roadmap/blind-spots.md](../10-roadmap/blind-spots.md).

## Ver também

- [canonical-decisions.md](canonical-decisions.md) — as decisões que materializam estes princípios.
- [../10-roadmap/blind-spots.md](../10-roadmap/blind-spots.md) — riscos e pontos cegos.
