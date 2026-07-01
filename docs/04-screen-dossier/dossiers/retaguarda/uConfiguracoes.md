# Dossiê — CAMADA DE CONFIG chave-valor (`ValorConfiguracao`) · subsistema

> **Status:** `corte-1 verde` (backend: tabelas + resolver + seed + 1 wire fiscal). Subsistema genérico de parametrização por empresa/usuário/módulo — onde vivem os **gates fiscais** que a NF consulta. Corte-1 entrega o resolver e wire o gate real `APROVEITAMENTO_CREDITO_ICMSST_NF`. Verde: **API 123, smoke 143/0**.

## 0. Recorte
Não é uma "tela" — é o `ValorConfiguracao` do legado: um catálogo global de configs (`CONFIGURACOES`, 843 linhas) + overrides por escopo (`CONFIGURACOES_ESPECIFICAS`, 330 linhas, TIPO Empresa/Usuario/Modulo). Muitos gates das fases da NF (F2/F3/F4/F5) apontam para chaves daqui. Corte-1: o **backend** (tabelas + resolver + seed das chaves fiscais) + **1 wire** (o gate de crédito de ST da F2). UI de gestão e os demais wires = fase-2.

## 1. Identidade / herança
- Legado: `Sessao.ValorConfiguracao('CODIGO')` (método de `TSessao`, `dmPrincipal.Sessao`). **O corpo do resolver está no submódulo `sicom/util` (`USessao.pas`) NÃO clonado** → a precedência foi **reconstruída** de 542 call sites: **Usuario > Empresa > Modulo > default global**, respeitando o whitelist `CONFIGESPECIFICASPERMITIDAS` por chave. Sempre retorna string (o cast é do chamador).
- Migrado: `config.service.ts` (`ConfigService.resolver(codigo, {empresaId, operadorId, modulo})` / `ligado(...)`), read-only. Tabelas `configuracoes` + `configuracoes_especificas` (migration 033).

## 2. Dados
- **`configuracoes`** (PK `id` = CONFIGURACOES.ID legado; UNIQUE `codigo`): `valor` (default), `tipovalor`, `descricao`, `valorespossiveis`, **`config_especificas_permitidas`** (whitelist ';'-sep de TIPOs), `obsoleto`.
- **`configuracoes_especificas`** (PK `(id,tipo,chave)`; FK id→configuracoes): `tipo` (Empresa/Usuario/Modulo), `chave` (CODEMPRESA/CODOPERADOR/nome-do-módulo), `valor`.
- Seed (só chaves com procedência forte no Oracle): `APROVEITAMENTO_CREDITO_ICMSST_NF` (290, 'N', whitelist Modulo;Empresa) — **wired**; `AMBIENTE_NF` (48, 'P') — **órfão** (ver §5). As demais chaves de gate (`CALCULA_ICMSST_EMISSAOPROPRIA_NF_SEM_INDEX`, `PERMITE_PROC_NF_ESTOQUE_NEG`, `ESTORNA_FINANCEIRO_NF`, `UTILIZA_INTEGRACAO_CONTABIL`) **não são seedadas às cegas** — entram com `id`/default confirmados no Oracle no momento de cada wire (F2b/F3b/F4b/F5b). O resolver e o whitelist já as suportam.

## 3. Resolver (precedência)
`resolver(codigo, ctx)`: busca a config por `codigo`; percorre escopos na ordem **Usuario → Empresa → Modulo** e retorna o 1º override cujo TIPO está no whitelist E tem `chave` no ctx; senão o `valor` default. `ligado(codigo, ctx)` = `=== 'S'`.

## 4. Wire ENTREGUE
- **`APROVEITAMENTO_CREDITO_ICMSST_NF`** (`udmNF.pas:4231/4470`) no `nf-fiscal.service`: o zeramento de crédito de ST só ocorre quando `!aproveitaCreditoSt && zeraCreditoIcms(...)`. Default 'N' → aproveita=false → zera (comportamento anterior preservado, **backward-compat**). Override Empresa='S' → APROVEITA (não zera). Smoke seção 25 prova os dois + a remoção do override.

## 5. Achado crítico — `AMBIENTE_NF` NÃO wired
O ambiente de emissão NFe **NÃO vem de `AMBIENTE_NF`** no retaguarda — vem da tabela `NFE.TIPONFE` (`udmNF.pas:6063`: 'D'→homologação). A config `AMBIENTE_NF` existe (override emp.1='H') mas é **órfã** no código local. → NÃO fizemos wire cego; o `empresas.ambiente` (coluna, F6/EMPRESAS) segue como a fonte do ambiente do corte-1. Seedada só como catálogo, documentada como órfã.

## 10. Adiado
- **UI de gestão** (tela de configs + overrides por empresa/usuário/módulo).
- **Demais wires** (chaves a seedar no wire, com id/default confirmados no Oracle): PERMITE_PROC_NF_ESTOQUE_NEG (F3b), ESTORNA_FINANCEIRO_NF (F4b), UTILIZA_INTEGRACAO_CONTABIL (F5b), CALCULA_ICMSST_EMISSAOPROPRIA_NF_SEM_INDEX (F2b) — o resolver já as suporta; falta só o seed verificado.
- **Escopos Usuario/Modulo** (implementados no resolver, mas sem consumidor no corte-1).
- **Precedência exata** — reconstruída (submódulo `sicom/util` não clonado); confirmar ao clonar.
- Chaves que NÃO são config (não migrar): `CONSIDERAR_DESCONTO_CALC_ST` (é coluna da figura fiscal/indexador), `NOTA_FISCAL_DESCONTO_ABATER_BASE_ICME` (0 refs).

## Riscos / notas
- Precedência reconstruída (não cravada no fonte). `AMBIENTE_NF` órfão — não confiar como fonte de ambiente.
- Oracle read-only; nenhuma DML em homolog.
