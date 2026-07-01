# Validação cross-cutting — 2026-06-30

> Varredura adversarial de **invariantes que atravessam telas** (não cobertos por auditoria por-tela): isolamento multi-tenant, disparo/atomicidade dos hooks do engine declarativo, e coerência end-to-end da cadeia fiscal da NF. 3 auditores isolados + confronto no fonte legado (`/Library/SicomGit/retaguarda-master/fonte`) e no Oracle real (PINHEIRAO, read-only). Baseline no início e no fim: **shared build · api tsc 0 · web tsc 0 · api test 123/123 · web test 25/25 · smoke 148/0**.

## Corrigido (verde + regressão no smoke)

### [ALTA] IDOR / perda-de-dados cross-empresa no WRITE-PATH do engine — CORRIGIDO
Dois auditores independentes convergiram e confirmei no código: `read`/`list` filtram por `idempresa` quando `empresaScoped`, mas `update`/`remove` (crud-engine) e `updateAggregate`/`removeAggregate` (aggregate-engine) casavam **só pela PK**. Como o silo forte é por **tenant** (banco `apollo_tenant_*`) e várias **empresas** coabitam o mesmo banco (coluna `idempresa`), um operador da empresa A podia `PUT`/`DELETE` uma linha `empresaScoped` da empresa B (PKs são sequences globais dentro do tenant → enumeráveis). No agregado era pior: a cascata deleta detalhes por `fk=masterId` sem `idempresa`.
- **Dormente hoje** (seed = 1 empresa/tenant), **ativo** assim que qualquer tenant tiver 2+ empresas — o que a arquitetura inteira pressupõe.
- **Correção:** helper `pertenceAEmpresa(trx, cfg, id)` no engine base (herdado pelo aggregate) + guarda **fail-closed** no topo de `update`/`remove`/`updateAggregate`/`removeAggregate`: em tabela `empresaScoped`, só escreve/exclui se a linha for da empresa do contexto; senão no-op (espelha o silêncio de `read`/`list`). `crud-engine.service.ts`, `aggregate-engine.service.ts`.
- **Regressão:** smoke §26 — empresa 1 NÃO altera nem exclui a conta bancária da empresa 2 (título/ativo intactos, conta persiste); a **dona** (empresa 2) altera e exclui normalmente (controle positivo). RBAC é por empresa, então o teste concede grant nas duas empresas para exercitar a guarda do **engine**, não o RBAC.

### [MÉDIA] lookups de cobrador sem escopo de empresa — CORRIGIDO
`assertCobradorValido`/`listCobradores` liam `parceiros` (empresaScoped) sem `idempresa` → listavam/aceitavam cobrador de outra empresa. Adicionado `where('idempresa','=', empresaId)` fail-closed (espelha `listAreceber`). `lote-cobranca.repository.ts`.

### Golden do catálogo de config (fecha a ressalva do auditor de paridade)
Confronto no PINHEIRAO das chaves de gate. **Confirmado EXATO** o seed mantido: `APROVEITAMENTO_CREDITO_ICMSST_NF` (id 290, 'N', wl `Modulo;Empresa`) e `AMBIENTE_NF` (id 48, 'P', wl `Empresa`, override real emp.1='H'). **Validou remover os seeds especulativos:** 3 de 4 ids chutados estavam errados. Ids/defaults reais registrados em `033_configuracoes.sql` para o wire futuro:

| chave | id | default | whitelist | fase |
|---|---|---|---|---|
| ESTORNA_FINANCEIRO_NF | 4 | N | Modulo;Empresa;Grupo;Usuario | F4b |
| PERMITE_PROC_NF_ESTOQUE_NEG | 84 | **S** | Modulo;Empresa;Grupo;Usuario | F3b |
| UTILIZA_INTEGRACAO_CONTABIL | 100 | N (+Modulo/Retaguarda='S') | Modulo;Empresa | F5b |
| CALCULA_ICMSST_EMISSAOPROPRIA_NF_SEM_INDEX | 291 | N | Modulo;Empresa | F2b |

> **Achado de negócio → RESOLVIDO (wire F3b):** `PERMITE_PROC_NF_ESTOQUE_NEG` default legado = **'S'** (o legado permite estoque negativo). O corte-1 da F3 bloqueava por padrão — **agora wired e fiel**: `nf-processamento` resolve a config (`ligado`, default 'S') e só bloqueia quando **'N'**; seed id 84 em `033`. Legado: `udmNF.pas:11643` (gate) / `11659` (override por senha — adiado). Smoke §18.5 prova 'N'→bloqueia (rollback), default 'S'→permite, reverter restaura. O escopo `Grupo` do whitelist e o override por senha ficam adiados.

## Confirmado FIEL / limpo (sem ação)
- **ConfigService**: limpo em todos os casos-borda (whitelist vazio não gera `['']`; precedência Usuario>Empresa>Modulo>default correta; chave numérica→string; código inexistente→null→`ligado`=false; parametrizado, sem injeção).
- **Hooks do engine** (`derivar`/`validar`/`validarRemocao`/`preservar`+`chaveNatural`): disparam **no ponto certo** do ciclo de vida (derivar no create E no update, persistido; validar antes de insert e update; validarRemocao no início do remove). O problema não era o *momento*, era o *escopo de empresa* (corrigido) e a *atomicidade* (abaixo).
- **Serviços fiscais stateful** (nf-processamento/faturamento/nfe): fail-closed exemplar, filtram tudo por idempresa/codempresa com forUpdate+CAS.
- **Cadeia fiscal — composição algébrica** (recalc→total→duplicata→rateio), **estoque no cancelamento** (estorna só se proc='S', sem dupla-baixa, CAS idempotente), **txjuros de empresas**, **guardas de edição/exclusão** (todos os terminais): COERENTES. Todas as fases leem a **mesma** empresa.

## Dívida registrada (com procedência) — decisão/fase futura, fora do corte-1

### Fiscal — cancelamento e estados SEFAZ
- **Cancelar NÃO estorna financeiro/contábil** — **NÃO é bug do corte-1.** O botão real da retaguarda `TfrmNF.CancelarNFE` (`uNF.pas:6773`) chama `CancelaFaturamento` (`uNF.pas:6668`), mas o estorno é **gated por `ESTORNA_FINANCEIRO_NF`** (`uNF.pas:6678`), cujo default real é **'N'** → por padrão o legado **também** NÃO deleta os títulos, só adiciona uma *pendência* (`AdicionaPendenciaFinanceiro`, L6725). O migrado (cancelar estorna só estoque) **espelha o default**. Deferido com procedência: (a) wire de `ESTORNA_FINANCEIRO_NF`='S' → deletar títulos com a guarda `VerificaExisteBaixas` (= a trava de título quitado que `estornarFaturamento` já tem) — **F4b**; (b) `AdicionaPendenciaFinanceiro` (flag de pendência) — mecanismo a modelar; (c) estorno contábil `TIntegracaoContabil.Estornar` se `CONTABILIZADO='S'` e `INTEGRACAO='AUTOMATICA'` (`uNF.pas:6808-6822`) — **F5b**.
- **Denegada (`statusnfe='D'`) encalha estoque** — **inalcançável no corte-1** (o `SimuladorSefazProvider` só retorna sucesso→'P'). Requisito **F6b** (provider SEFAZ real): caminho de estorno de estoque quando a nota é denegada (`reverter` bloqueia em D; `cancelar` exige P). No legado a reversão dispara com `STATUSNFE→'D'` (dossiê uNF §fluxo).
- **Denegada pode ser faturada** (`faturar` não checa `statusnfe`) — **moot no corte-1** (D inalcançável). Guarda defensiva a adicionar junto do provider real (**F6b**).
- **`faturar` não exige `proc='S'`** (assimétrico com `transmitir`, que exige) — no legado o financeiro nasce após o commit do estoque. Decisão de corte (faturar virou ação explícita); avaliar exigir `proc='S'` na **F4b**.
- **Sem gate de reconciliação no `processar`** — `recalcular` é puro (não grava); nada garante server-side que `totalnf`/itens gravados reflitam o último recalc. O legado revalida no processar ("Valor informado no total da NF não confere"). Gate a adicionar (recomputar e comparar ±0,01) — **F3b**.

### Multi-tenant — resíduos
- **Detalhes por-empresa de Produto** (`multi_preco`/`estoque`) num master **global**: o substitute deleta por `fk=idproduto` (todas as empresas) e reinsere com `idempresa` do cliente; `readAggregate` expõe todas as empresas. **Consistente com um design de catálogo multi-empresa central** (o form faz round-trip do grid inteiro; `preservar` protege o saldo). Risco só com payload **parcial**. **Decisão de UX/paridade** (grid multi-empresa central vs. escopo por empresa) + endurecer contra payload parcial. `produto.aggregate.ts`, `aggregate-engine.service.ts`.
- **`lote_cobranca`/`itens_lotecob` sem coluna `idempresa` → DECIDIDO: manter FIEL (sem coluna).** Recon no Oracle real: a `LOTE_COBRANCA` legada tem **6 colunas** (CODLOTECOB, CODPARCEIRO, DATA, auditoria) — **nenhuma de empresa**; `ITENS_LOTECOB` idem. O schema migrado (sem `idempresa`) **já é fiel**. O isolamento por empresa é **transitivo via ARECEBER**: o picker `listAreceber` já filtra por `codempresa`, então um lote só contém itens da empresa do contexto. A visibilidade da LISTA de lotes não é filtrada por empresa (o legado também não tem como, sem a coluna) — endurecer isso (join a `itens_lotecob→areceber.codempresa` ou adicionar coluna) seria uma **divergência consciente** do legado, deixada para decisão futura, não feita agora por fidelidade. `005_lote_cobranca.sql`.
- **`nf-fiscal.resolverUf`** lê `parceiros`/`parceiros_end` por `codparceiro`/`codend` sem `idempresa` (só entrada de cálculo puro, não escrita) — **BAIXA**. Filtrar por consistência.

### Engine — atomicidade (MÉDIA, narrow)
- `validar`/`validarRemocao` rodam **fora** da transação de escrita (`forTenantRead`), TOCTOU entre o check e o insert/delete. Mitigado por constraints onde há UNIQUE (dup-key fiscal da NF). Ideal: passar `trx` e rodar dentro da transação.
- Detalhe `estoque` usa delete+insert → **rotaciona a PK surrogate** `id_estoque` a cada save (kardex referencia idproduto+idempresa, não quebra FK). Trocar por upsert resolve isto e a janela de lost-update de linha recém-criada por NF concorrente.
