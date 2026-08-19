# FECHAMENTO DIÁRIO — `uFechamentoDiario` / `FRMFECHAMENTODIARIO`

Recon de 2026-08-19 (autônomo). **389 acessos, 8 operadores.** Menu **fiscal**, retaguarda (nada de PDV).

**Ausência provada no código** (lição 80), por nome E por conceito:
`grep -rln "FRMFECHAMENTODIARIO\|fechamento_diario\|fecha_dia\|FechaDia"` e
`grep -rln "fechar.*dia\|dia_fechado\|reabrir.*dia"` em `apps/api/src`, `apps/api/migrations`, `apps/web/src`
→ **zero**; e não existe tabela nossa com `fech` no nome. O que existe é o **`periodo_contabil`** (migs 038/100),
que bloqueia por **mês/competência** — outro nível.

## 1. O que a tela faz

Um calendário do mês onde **cada dia é uma linha** que pode estar fechada (`STATUS='F'`) ou aberta (`STATUS` nulo),
com três grades de conferência (notas de entrada `cdsNF`, de saída `cdsNFS` e cupons `cdsEcf`) para o operador
olhar antes de travar o dia. Botões: fechar o dia (`btnOkClick`), reabrir (`AbreDia`), **fechar o mês inteiro**
(`btnFechaTotalClick`) e **abrir o mês inteiro** (`btnAberturaTotalClick`).

`FECHAMENTO` é minúscula — **4 colunas**: `CODFECHAMENTO` (PK), `DATA`, `STATUS`, `IDEMPRESA`. Sem triggers.

## 2. Estado no Oracle (liveness — e é aqui que a leitura muda)

**3.439 linhas · 4 empresas · 2019-08 → 2026-04 · `STATUS='F'` em 1.997, nulo em 1.442** — e
`(IDEMPRESA, DATA)` é **único** (3.439 de 3.439 distintos ⇒ chave natural).

| empresa | fechados (`F`) | último `F` | linhas abertas | última linha |
|---|---:|---|---:|---|
| 1 | 932 | **2024-02-29** | 1.168 | 2026-04-30 |
| 2 | 61 | 2024-01-31 | 60 | 2024-02-29 |
| 50 | 881 | 2023-07-31 | 184 | 2024-01-31 |
| 51 | 123 | 2023-08-31 | 30 | 2023-09-30 |

Dois fatos que só o fonte explica:

1. **A linha existe mesmo sem ninguém fechar nada.** `cmbMesChange` (linha 220) percorre todos os dias do mês
   escolhido e **insere a linha que faltar**, com `STATUS` nulo. Ou seja: os 30 dias de abr/2026 com 0 fechados
   significam apenas que **alguém abriu a tela naquele mês** — a linha aberta é resíduo de navegação, não trabalho.
   (Lição: contar linhas dessa tabela mediria uso da tela, não fechamento.)
2. **O fechamento parou há ~2 anos** em todas as 4 empresas (último `F`: fev/2024), enquanto as linhas continuam
   nascendo até abr/2026.

## 3. As duas regras com dentes

**`FechaDia`** (linha 315): `STATUS := 'F'` → `ApplyUpdates` → **`VerificaNFs`**.

**`VerificaNFs`** (linha 770) é a regra que mexe em dado de terceiro:
1. acha o **próximo dia ainda não fechado** do mês (`STATUS<>'F' AND DATA > diaAtual`);
2. lista as NFs do dia com `PROC='N'` (não processadas) da empresa;
3. `UPDATE NF SET DTCONTABIL = <próximo dia aberto> WHERE trunc(DTCONTABIL) = <dia fechado> AND PROC='N' AND
   IDEMPRESA in (…)` — **empurra a data contábil das notas não processadas para o próximo dia aberto**.

Tem material para isso no golden: `NF` com `PROC='N'` — **230 em 2025 e 82 em 2026**.

> ⚠️ **Bug do legado que NÃO deve ser copiado:** no caminho "fechar o mês inteiro" (`AFechaTotal=True`) o bloco que
> calcula `DiaProximo` é **pulado** (linha 778), então a variável local fica **não inicializada** e o `UPDATE`
> gravaria `DTCONTABIL` = data 0 (30/12/1899). Prova de que nunca foi exercido: das **23.420** NFs do golden,
> **0** têm `DTCONTABIL < 1990` (a mínima é 2020-08-11). Registrar e implementar o fecha-mês reaproveitando o mesmo
> cálculo do dia (ou barrando quando não houver próximo dia aberto).

**`AbreDia`** (linha 122): `STATUS := null` (reabrir é voltar ao nulo, não gravar 'A').

## 4. Quem CONSOME o dia fechado (e por que isso rebaixa a prioridade)

Dois consumidores no fonte:

- **`uTron.pas:1129/1311`** — a integração com o **TRON** (sistema do contador) começa com
  `if not PeriodoFechado(vMensagem) then Exit`, e essa função exige que **todo dia do período** tenha linha com
  `STATUS='F'` para as empresas selecionadas, com a mensagem *"O dia dd/mm/yyyy ainda não foi fechado na loja X.
  Acesse a tela «Fechamento diário» através do menu fiscal."* — gate duro, sem config.
- **`UdmSintegra.pas:512`** (`GetSQLFechamentoDiario`) — o Sintegra lê a tabela do período.

**Mas:** a rotina do TRON protegida por esse gate consulta `REDUCAOZ` (`R.CODREDUCAO`, `R.NROTERMINAL`,
`R.VENDALIQ`) — e no golden **`REDUCAOZ` tem 0 linhas**, assim como **`RES_ALIQ_60D`** (o resumo 60D que esta
própria tela apaga/gera, `ApagaRegistrosTabelaRES_ALIQ_60D`/`RateiroGeral`). Uso no menu:
`FRMTRON` 510 acessos/6 operadores (último acesso **2026-06-24** — vivo), `FRMSINTEGRA` 13/2, `FRMCADREDUCAOZ` 2/1.

Leitura honesta: **o gate existe e é duro no código, mas a rotina que ele protege lê tabela vazia neste tenant**
(sem ECF/Redução Z), e as outras rotinas do TRON usam outro gate — `TIntegracaoContabil.PeriodoFechado`
(`CHAVEAMENTO_PERIODO`), que o recon do Adiantamento já provou **NULL = morto**. Isso explica a contradição de o
TRON ser usado em jun/2026 enquanto ninguém fecha dia desde fev/2024.

## 5. Veredicto e corte proposto

O épico é **barato** (4 colunas, 2 verbos, 1 efeito colateral real) e **de valor baixo hoje**: nenhum consumidor
vivo depende dele neste tenant. Não é morto — é **dormente com gate real**, e volta a importar quando
TRON/Sintegra/SPED entrarem de fato com Redução Z. Recomendação: **não furar a fila por ele**; entra como corte
pequeno quando o próximo épico fiscal precisar do gate, ou como tapa-buraco de ciclo curto.

Se/quando entrar, o corte-1 é:

1. `fechamento` (`codfechamento` PK, `data`, `status`, `idempresa`) + **unique `(idempresa, data)`** (chave natural
   provada pelo golden) — e a materialização dos dias do mês na leitura, como o `cmbMesChange` faz.
2. `fechar(dia)` / `reabrir(dia)` / `fechar(mês)` / `reabrir(mês)`, com o `VerificaNFs` fiel (empurra `DTCONTABIL`
   das NFs `PROC='N'` para o próximo dia aberto) **sem** o bug do `DiaProximo` no fecha-mês.
3. As três grades de conferência (entradas, saídas, cupons do dia) — leitura das tabelas já migradas.
4. Um helper `assertDiaNaoFechado(data, empresa)` para os épicos fiscais chamarem (o papel do
   `uTron.PeriodoFechado`), convivendo com o `periodo_contabil` **por mês** — são níveis diferentes e não se
   substituem: o mês bloqueia contabilização/baixa; o dia é pré-requisito da exportação fiscal.
