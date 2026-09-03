# RUNBOOK DA VIRADA — do legado Delphi/Oracle para o Apollo

Este documento é para ser **executado**, não lido: cada passo tem comando, o que conferir e o que fazer se falhar.
Os números vêm das medições contra **produção** (`hiperpinheirao.ddns.com.br`), não da homologação — a diferença
é grande (2,16× em volume) e está registrada no §7s do `PLANO-DE-CARGA-CUTOVER.md`.

> Estado: **rascunho em construção** (2026-09-02). Os tempos da fase f0 completa e da carga total ainda estão
> sendo medidos; onde faltar número está marcado `[medir]`. Nada aqui foi executado numa virada real.

---

## 0. Antes do dia (semanas antes)

| # | O quê | Por quê |
|---|---|---|
| 0.1 | Rodar `plano-universo.py` contra produção e conferir o diff de tabelas | tabela nova no legado desde a última rodada aparece aqui, não na madrugada |
| 0.2 | `varre-unicidade.py` e `mapa-colunas.py` contra produção | unicidade violada e coluna que não cabe são as duas causas de carga rejeitada |
| 0.3 | Ensaio completo (extração + carga + reconciliação + operação) | o ensaio é o que dá o tempo real da janela |
| 0.4 | Fechar com o cliente o **relatório de órfãos e perdas declaradas** | são decisões de negócio, não técnicas — ver §5 |
| 0.5 | Definir o **ponto de não-retorno** e quem decide | ver §4 |
| 0.6 | Provisionar o Postgres de destino com as migrations aplicadas e conferir `schema-destino.json` re-dumpado | o mapa da carga é feito contra esse retrato |

## 1. Congelamento do legado (início da janela)

**O legado tem de parar de escrever.** Não é preciosismo: a extração de produção com a loja aberta deu
**ORA-01555 (snapshot too old)** depois de 78 minutos lendo `vendas` — o UNDO é reciclado debaixo da leitura — e
as contagens mudam entre uma tabela e outra (`historico_dinamico` cresceu 337 linhas em duas horas), o que
produz órfãos falsos entre pai e filho extraídos em momentos diferentes.

- [ ] 1.1 Fechar o retaguarda e os PDVs; confirmar com `select count(*) from vendas` duas vezes com 5 min de
      intervalo — **o número não pode mudar**.
- [ ] 1.2 Anotar as contagens-âncora: `vendas`, `nf`, `areceber`, `apagar`, `historico_prod`, `estoque`.
      São elas que fecham a reconciliação no fim.
- [ ] 1.3 Backup do Oracle (responsabilidade do cliente) — o plano de volta atrás depende dele.

## 2. Extração (Oracle → CSV)

```bash
export ORACLE_HOST=<host de produção>
for f in f0 f1 f2 f3 f4; do
  python3 tools/cutover/etl/extrair.py $f          # grava em tools/cutover/staging/<fase>/
done
```

- A sessão abre **somente-leitura** e é reaberta a cada tabela; as sete maiores são lidas **ano a ano**
  (`FATIAR` no extrator). Com o legado congelado o ORA-01555 não deve ocorrer; se ocorrer, é sinal de que
  **alguém ainda está escrevendo**.
- Tempo medido com a loja ABERTA: **f0 88 min** (73 tabelas, 40,1M linhas — é a fase com `vendas` 18,9M,
  `cx_vendas`, `cartao`, `diario`) · f1 11 min (42 tabelas, 7,6M) · f2 1 min · f3 6 min · f4 1 min.
  **Total ≈ 1h47 para 49.651.289 linhas / 9 GB de CSV**, pela internet. Com o legado congelado deve cair
  (sem concorrência de escrita), mas planeje a janela com este número.
- [ ] 2.1 Conferir que **cada fase escreveu o `_manifesto.json`** (a extração só grava o manifesto no fim; se a
      fase morreu no meio, o manifesto é o da rodada anterior — foi assim que a f0 falhou sem alarde).
- [ ] 2.2 Conferir no manifesto que nenhuma tabela saiu com `"pulada"`.

## 3. Carga (CSV → Postgres)

```bash
pnpm --filter @apollo/api exec ts-node --transpile-only scripts/carregar-cutover.ts todas
```

O carregador faz, em ordem: lista as tabelas **pelo manifesto**, ordena por dependência de FK, `TRUNCATE`,
suspende gatilhos, insere em lotes de 500, religa os gatilhos, reconcilia **contagem e somas**, aplica
`tools/cutover/pos-carga.sql`, reposiciona **todas as sequências** no `max(id)` e confere órfãos (recriando como
`NOT VALID` a FK que o legado não respeita).

- Taxa medida: **~65 mil linhas/s** (as 70 tabelas novas, 4,3M linhas, em 1,1 min). Para 49,5M: `[medir]`.
- [ ] 3.1 Ler o relatório final: **toda tabela tem de sair `✅`**. `⚠️` só é aceitável para os casos já
      declarados no §5; `⛔` é parada.
- [ ] 3.2 Conferir a linha `[sequências] N reposicionada(s)` — sem ela, o primeiro INSERT do app colide.
- [ ] 3.3 Conferir a linha `[pós-carga] … aplicado`.

## 4. Verificação e go/no-go

- [ ] 4.1 As contagens-âncora do §1.2 batem com o Postgres.
- [ ] 4.2 `tools/cutover/ensaio-operacao.sh` contra a API apontada para o banco novo: nenhum 4xx/5xx, e nenhum
      relatório acima do tempo combinado com o cliente.
- [ ] 4.3 Conferência dirigida pelo cliente: abrir 5 notas conhecidas, 3 títulos a receber, o estoque de 10
      produtos, a apuração do último mês fechado — e comparar com o legado, na tela.
- [ ] 4.4 **Decisão go/no-go** (quem: `[definir]`). Depois deste ponto, o retorno custa o backup do §1.3.

## 5. Perdas e órfãos declarados (fechar com o cliente ANTES)

Nada disto é erro de carga: é o dado do legado que não passa pelas regras do sistema novo. A decisão de aceitar,
limpar ou corrigir é do dono do dado.

| caso | volume | o que acontece |
|---|---|---|
| `clube_desconto.idpromocao` | 3.022 de 3.069 | apontam para promoções que não existem em `PROMOCAO` nem em `AGENDA_PROMOCAO`; a FK entra `NOT VALID` |
| `agenda_promocao_itens` · `scrap_item` · `contas_bancarias_op` | 9 · 7 · 2 linhas | sem produto/operador no legado; descartadas na extração |
| `cotacao_forn_itens` | 20 linhas | 5 pares repetidos com valores diferentes; fica a última |
| `clube_desconto.idempresa` | 4 linhas | lista `'1,2'` no legado; fica a primeira empresa |
| `operadoras` | 1 linha | operadora ativa sem nome; entra como `(SEM NOME NO LEGADO)` |
| órfãos de FK do ensaio anterior | `parceiros` 7/11 · `apagar_bx` 370 · `cx_apagar` 712 · `inventario` 13.611 | confirmados como órfãos reais no Oracle |

## 6. Depois da virada

- [ ] 6.1 Manter o Oracle **de pé e somente-leitura** por N dias (`[definir]`) — é a fonte de conferência.
- [ ] 6.2 Backup do Postgres novo antes do primeiro dia de operação.
- [ ] 6.3 Acompanhar o primeiro fechamento de caixa e a primeira emissão de NF-e de perto.

## 7. Volta atrás

Enquanto o §4.4 não for dado: descartar o Postgres novo e reabrir o legado — custo é o tempo da janela.
Depois do §4.4, com o legado já reaberto para escrita, voltar significa restaurar o backup do §1.3 e **perder o
que foi digitado no Apollo**. Por isso o go/no-go é explícito e tem dono.
