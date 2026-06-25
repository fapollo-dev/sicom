# Roteiro de captura de runtime — piloto `frmCadBancos`

> O passo-a-passo da **Frente B** ([dynamic-sql-extraction.md](../dynamic-sql-extraction.md)) para o piloto: ligar a captura de SQL no legado **em execução**, exercitar cada caminho da tela de Cadastro de Bancos e gravar as fixtures `input → SQL real → resultado → efeito de replicação`. Fecha as pendências do dossiê ([uCadBancos.md](../../04-screen-dossier/dossiers/retaguarda/uCadBancos.md)) e tira a tela de `rascunho`. **Requer o legado rodando** (estação Windows com o ERP **ou** um schema-cópia não-produtivo) — é o gate que não dá para fazer só lendo código. O método é **reutilizável** para qualquer herdeira de `TfrmCadMaster` ([form-base-cadmaster.md](form-base-cadmaster.md)).

## Pré-requisitos de leitura

- [../dynamic-sql-extraction.md](../dynamic-sql-extraction.md) — a teoria das duas frentes; este é o "como" do piloto.
- [form-base-cadmaster.md](form-base-cadmaster.md) — o ciclo de vida que dispara as queries; vale para todos os cadastros.
- [../../04-screen-dossier/dossiers/retaguarda/uCadBancos.md](../../04-screen-dossier/dossiers/retaguarda/uCadBancos.md) — o que precisa ser confirmado.

> ⚠️ **Use um ambiente não-produtivo.** Exercitar a tela grava/exclui dados e enfileira replicação. Use um **schema-cópia** (ex.: um `*_DEMO`) ou uma instância de teste — nunca produção. O legado é **Oracle**, então a captura é Oracle (não Postgres como no exemplo genérico do playbook).

---

## 1. Ligar a captura (3 opções, da melhor para a pior)

### Opção A — FireDAC Monitor (preferida; não precisa de privilégio no banco)
O legado usa FireDAC (`FireDAC.Phys.Oracle`). O **FDMonitor** loga **cada** comando que o driver envia, com SQL e parâmetros resolvidos, exatamente como o app emite.
- No ambiente de teste, habilitar o monitor: adicionar um `TFDMoniFlatFileClientLink` (ou `TFDMoniRemoteClientLink` + FDMonitor.exe) e setar `Connection.Params` com `MonitorBy=FlatFile` (ou `Remote`). Há `FireDAC.Moni.FlatFile` já no `uses` do form-base — o app **já tem** o monitor disponível.
- Saída: um arquivo de log por sessão com cada `SELECT/INSERT/UPDATE/DELETE` + bind values. Filtrar pelas linhas da janela de teste.

### Opção B — Oracle SQL trace (precisa de privilégio)
- Na sessão do app de teste: `ALTER SESSION SET SQL_TRACE = TRUE;` ou `DBMS_MONITOR.SESSION_TRACE_ENABLE(waits=>true, binds=>true);`
- Gera trace em `user_dump_dest`; processar com `tkprof`. Captura binds com `binds=>true`.

### Opção C — Polling de `V$SQL` / dicionário (read-only, parcial)
- Após exercitar, ler `V$SQL`/`V$SQLAREA` filtrando por `PARSING_SCHEMA_NAME` e `SQL_TEXT LIKE '%BANCOS%'`. Pega o **texto** mas não os binds com facilidade. Bom como conferência.

> Para o **lado da replicação** (efeito-fantasma), **não precisa** de trace: basta ler `REMESSA_SERVER` antes/depois de cada ação (passo 3) — já validável via `python-oracledb` read-only ([[oracle-db-access]] em memória).

---

## 2. Matriz de exercício (os caminhos a acionar na tela)

Abrir o **Cadastro de Bancos** no ERP de teste e executar, anotando para cada um a SQL capturada (passo 1) e o efeito no outbox (passo 3):

| Caso | Ação na tela | O que confirma |
|---|---|---|
| **G-01** | Digitar um `CODBCO` existente em `edtCodigo` + Enter | Q1 leitura: `select * from BANCOS B where B.CODBCO = :Codigo` |
| **G-02** | `&Adicionar` → preencher BANCO+CIDADE (mín.) → `&Gravar` | **INSERT real** gerado pelo provider (colunas/ordem) + 1 linha `REMESSA_SERVER` TIPO=INSERT |
| **G-03** | Abrir registro → `&Editar` → alterar CIDADE → `&Gravar` | **UPDATE real** (só colunas alteradas? WHERE por CODBCO) + carimbo `USULTALTERACAO`/`DTULTIMALTERACAO` + REMESSA_SERVER UPDATE |
| **G-04** | Abrir registro → `E&xcluir` → confirmar | **DELETE físico** (BANCOS sem `INDR`) + REMESSA_SERVER DELETE |
| **G-05** | `&Adicionar` → deixar BANCO vazio → `&Gravar` | Validação de obrigatório (abort, nada gravado) |
| **G-06** | Logar com usuário **sem** permissão de gravar → `&Gravar` | RBAC `PossuiAcessoForm('frmCadBancos','BTNGRAVAR')` bloqueia |
| **G-07** | Digitar nome em minúsculas → `&Gravar` | `CharCase=ecUpperCase` → persiste MAIÚSCULO |
| **G-08** | `&Pesquisa` (lupa) → buscar por nome | Q2: `SELECT ... FROM GET_BANCOS [where/order]` — capturar colunas e ordenação default |

> Cobertura mínima = 1 caso por caminho de SQL (§4 do dossiê) e por regra (§5). Confirmar também `FPreencheEmpresa/Operador` (se o INSERT/UPDATE inclui `CODEMPRESA/CODOPERADOR` — provavelmente **não** em BANCOS).

---

## 3. Verificar a escrita-fantasma de replicação (`REMESSA_SERVER`)

Antes e depois de cada G-02/03/04, rodar (read-only, via `python-oracledb`):

```sql
SELECT ID, TIPO, TABELA, CHAVE, CAMPOCHAVE, CODTERMINAL, REPLICA, INSTRUCAO
FROM <schema>.REMESSA_SERVER
WHERE TABELA = 'BANCOS'
ORDER BY ID DESC FETCH FIRST 5 ROWS ONLY;
```

**Formato esperado (confirmado em dados reais do outbox — exemplo de `PARCEIROS`):**
```
TIPO=UPDATE  TABELA=PARCEIROS  CHAVE=14838  CODTERMINAL=1001  REPLICA=(null = pendente)
INSTRUCAO: SELECT * FROM PARCEIROS WHERE CODPARCEIRO =14838
```
- **INSERT/UPDATE** → `INSTRUCAO` é um `SELECT * FROM BANCOS WHERE CODBCO=<chave>` (o consumidor re-busca a linha e faz upsert do outro lado).
- **DELETE** → `INSTRUCAO` é um `DELETE FROM BANCOS WHERE CODBCO=<chave>`.
- `CODTERMINAL` = terminal/loja de origem; `REPLICA` nulo = pendente, preenchido = já replicado.

> Paridade: salvar um banco no **alvo** tem de gerar o **equivalente** desse evento de sync (outbox/event, por terminal, idempotente por `CHAVE`) na **mesma transação** do write — senão a loja para de replicar bancos. Ver [form-base-cadmaster.md §5](form-base-cadmaster.md) e [ADR-008](../../00-orientation/canonical-decisions.md).

---

## 4. Formato da fixture (a golden do legado)

Uma por caso, em `fixtures/cad-bancos/<caso>.json`:

```jsonc
{
  "screen": "frmCadBancos",
  "case": "G-03",
  "input": { "codbco": 77, "campo": "CIDADE", "de": "SANTOS", "para": "GUARUJA" },
  "capturedSql": "UPDATE BANCOS SET CIDADE = :p1 WHERE CODBCO = :p2",
  "params": { "p1": "GUARUJA", "p2": 77 },
  "stamps": { "USULTALTERACAO": "<operador>", "DTULTIMALTERACAO": "<ts capturado>" },
  "replication": { "tabela": "BANCOS", "tipo": "UPDATE", "chave": 77, "codterminal": 1001 },
  "rowAfter": { "CODBCO": 77, "BANCO": "...", "CIDADE": "GUARUJA", ... }
}
```

Estas fixtures **são** os golden do harness de paridade ([../../06-testing-quality/parity-harness.md](../../06-testing-quality/parity-harness.md)): mesmo input no alvo deve produzir SQL equivalente, o mesmo resultado e o mesmo evento de replicação.

---

## 5. Checklist de saída de `rascunho`

- [ ] Captura ligada (FDMonitor ou trace) num ambiente **não-produtivo**.
- [ ] G-01..G-08 exercitados; SQL real de cada caminho registrada.
- [ ] INSERT/UPDATE/DELETE do provider confirmados (colunas, WHERE, carimbos).
- [ ] Q2 (`GET_BANCOS`) com colunas e ordenação default capturadas.
- [ ] `REMESSA_SERVER` conferido antes/depois de cada escrita (a linha-fantasma).
- [ ] `FPreencheEmpresa/Operador` confirmado para BANCOS.
- [ ] Fixtures G-01..G-08 gravadas e no harness.
- [ ] Dossiê atualizado `rascunho → paridade-verde` e **revisado** ([../../08-agents/review-loop.md](../../08-agents/review-loop.md)).

## Ver também

- [../dynamic-sql-extraction.md](../dynamic-sql-extraction.md) · [form-base-cadmaster.md](form-base-cadmaster.md)
- [../../04-screen-dossier/dossiers/retaguarda/uCadBancos.md](../../04-screen-dossier/dossiers/retaguarda/uCadBancos.md) — o dossiê que isto fecha.
- [../../06-testing-quality/parity-harness.md](../../06-testing-quality/parity-harness.md) — onde as fixtures viram teste de paridade.
