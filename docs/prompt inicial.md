# ════════════════════════════════════════════════════════════════
# CONTEXTO DO AMBIENTE — PREENCHER ANTES DE ENVIAR
# ════════════════════════════════════════════════════════════════
# - Playbook Apollo (docs):/Library/Apollo

# - Código-fonte legado (Delphi): /Library/SicomGit 

# - Banco de dados legado (Oracle):host: 192.168.1.230 /port: 1521/SID: apollo/user :metadadossicom / password:apollo

# - (opcional) Repo do Design System: https://github.com/fapollo-dev/Apollo-design-system.git
# ════════════════════════════════════════════════════════════════

Você está entrando no projeto **Apollo** — a migração de um ERP de supermercados escrito em
**Delphi** (client-server: retaguarda, balcão, PDV) para uma plataforma web moderna
(**NestJS + React/Vite + TypeScript + PostgreSQL**, PDV offline em **Electron**). Atende de
pequenos mercados a redes multi-loja de altíssimo volume.

Existe um **playbook completo** que é a fonte de verdade do projeto (arquitetura, padrões,
processo, decisões travadas). Sua sessão começa lendo ele. **Não invente nada que o playbook
ou o código já decidem.**

## 1) PREFLIGHT (confirme antes de começar)
Verifique que você tem acesso a, e liste o que encontrou em uma linha cada:
- O diretório do **playbook Apollo** (deve conter `README.md` e a pasta `00-orientation/`).
- O diretório do **código legado Delphi** (deve conter `.dpr`, `.pas`, `.dfm`).
- O **banco legado** (via MCP de banco / conexão fornecida) — confirme que consegue listar tabelas.
Se algum dos três faltar, **pare e avise** — não prossiga no escuro.

## 2) PRIMEIRA AÇÃO OBRIGATÓRIA — LER A CANON (nesta ordem)
No diretório do playbook:
1. `README.md` — a diretriz primária e o índice.
2. `00-orientation/mission-and-principles.md` — a tese "contexto é tudo", os 3 hábitos, o risco-coroa (fiscal).
3. `00-orientation/canonical-decisions.md` — as **decisões travadas (ADRs)**. NÃO rediscuta; obedeça.
4. `00-orientation/how-agents-work.md` — disciplina de contexto, o loop fazer→revisar→legado×novo, uso de MCP.
5. `03-legacy-analysis/` (a seção inteira) — anatomia Delphi, extração de SQL dinâmica, regra de negócio, acoplamento oculto. **É a seção da sua tarefa de hoje.**
Depois disso, carregue **só** as seções que a tarefa pedir (o playbook é grande — não leia tudo).

## 3) SUA TAREFA NESTA SESSÃO: RECONHECIMENTO (entender, NÃO migrar)
O objetivo é **mapear o terreno**, não escrever código de migração. Você vai produzir um
**Mapa de Reconhecimento do Legado**. Trabalhe por amostragem inteligente — se houver
centenas de forms, mapeie a estrutura e amostre os representativos; não tente ler todos.

Faça duas frentes:

**A. Código legado** (lendo `.pas`/`.dfm`, não presumindo):
- Versão do Delphi, suítes de componentes de terceiros (DevExpress/TMS/etc.), camada de acesso a dados (BDE/FireDAC/ADO).
- Contagem e mapa: quantos `.dpr` (módulos/executáveis), `.pas`, `.dfm`, datamodules.
- **Mapa de módulos**: quais units/forms pertencem a **retaguarda**, **balcão**, **PDV** — e tamanho relativo de cada.
- **Datamodules e estado global compartilhado** (a armadilha de acoplamento de `03-legacy-analysis/hidden-coupling-traps.md`).
- **Camada de dados**: a SQL é montada no `.dfm` (design-time), no `.pas` (runtime), ou muta sob condicional? Uso de stored procedures/triggers? (ver `dynamic-sql-extraction.md`).
- **Pontos do risco-coroa**: onde vive o fiscal (NFC-e/SAT/SPED), TEF, periféricos (impressora fiscal/balança).

**B. Banco de dados** (via MCP de banco — `EXPLAIN`/inspeção, nunca decidir no escuro):
- Visão geral do schema: nº de tabelas, principais entidades, as **maiores tabelas por volume**.
- Onde está o dado quente (vendas/itens) vs cadastros.

## 4) ENTREGÁVEL
Escreva o **Mapa de Reconhecimento do Legado** em:
`<playbook>/03-legacy-analysis/recon/mapa-reconhecimento.md`
com as seções: (A) Inventário técnico · (B) Mapa de módulos · (C) Datamodules / estado global ·
(D) Camada de dados (como a SQL é montada) · (E) Banco (schema/volume) · (F) Risco-coroa
(fiscal/TEF/periféricos) · (G) **2–3 candidatos a tela-piloto** de baixo risco para a Fase 1
(um cadastro simples de retaguarda), com justificativa · (H) Lacunas e perguntas (o que NÃO dá
pra inferir do código — decisões de produto).
Siga as convenções de output do playbook (`00-orientation/how-agents-work.md`).

## 5) COMO TRABALHAR
- **Leia a camada de baixo** (`.pas`/`.dfm`/schema), nunca a superfície. Sem presumir.
- **Disciplina de contexto**: carregue só a seção/arquivo relevante; amostre, não exausta.
- **Use o MCP de banco** para qualquer afirmação sobre volume/estrutura.
- Trabalhe **read-only** nesta sessão: você está entendendo, não alterando o legado.

## 6) O QUE NÃO FAZER
- ❌ NÃO comece a migrar/escrever código de aplicação ainda. (Recon primeiro.)
- ❌ NÃO rediscuta decisões já travadas nos ADRs (arquitetura, tenancy, stack, etc.).
- ❌ NÃO altere o código legado nem o banco.
- ❌ NÃO leia o código todo de uma vez — amostre e mapeie.

## 7) QUANDO TERMINAR
Entregue o Mapa de Reconhecimento e um **resumo de 10 linhas**: o que é o sistema, tamanho,
maiores riscos, e qual tela-piloto você recomenda para a Fase 1 e por quê. **Pergunte antes de
avançar** para qualquer implementação — a escolha do piloto e o arranque da Fase 1 são decisão
conjunta.