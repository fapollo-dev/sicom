# Dossiê de Tela — CONTAS A RECEBER (`uCadAReceber` + `UBaixaAreceber`)

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | corte-1 (cadastro/gestão) EM ANDAMENTO — recon fechado (3 agentes: Oracle + tela legada + monorepo), 2026-07-02 |
| **Autor** | Claude (agente de migração) |
| **Fontes legadas** | `uCadAReceber.pas/.dfm` (cadastro), `UBaixaAreceber.pas/.dfm` + `UdmbaixaAreceber` (baixa), `UReversaoBaixaContasReceber.pas` (estorno), `udmCadAReceber.pas`, `uFinanceiroNotaFiscal.pas` — em `/Users/apollosistemas/Downloads/retaguarda-master/fonte/Units/` |
| **Golden** | Oracle PINHEIRAO (read-only): ARECEBER 49.584 · ARECEBER_BX 9.411 |

## 1. Descoberta estrutural — são DUAS telas
- **`uCadAReceber`** (`:36`, herda `TfrmCadMaster`) = **cadastro/gestão do título** (grava `ARECEBER`, pk `CODRCB`, view `GET_RCB`). Abas: `Cadastro` / `Histórico` / `Pendências` (`.dfm:127/2023/2361`).
- **`UBaixaAreceber`** (`:27`, herda `TfrmMaster`, janela separada) = **baixa/recebimento** — por LOTE (`IDLOTE`), 10 tipos de recurso, troco, saldo, contábil.

## 2. Modelo de dados (Oracle real)
- **ARECEBER**: 95 colunas, PK `CODRCB`, 49.584 linhas. QUITADA S=28.004/N=21.578; **AGRUPADO S=31.507 (63%)**; só **695 vêm de NF** (`IDNF`) — a maioria é manual/caixa/boleto (`GERADO`: SISTEMA/OPERADOR; `CADASTRADO_MANUALMENTE`). `ORIGEM` A/B/F/Q/O/C. `TIPODOC` DUPLICATA/BOLETO/A VISTA/…
- **ARECEBER_BX** (baixa): PK `CODRCBBX`, FK `CODRCB`, 9.411 linhas. `VALORPG/JUROS/MULTA/ACRE_DESC/DTPGTO/CODOPBX`, **`INDR` I=válida / E=estornada (estorno LÓGICO, não deleta)**, `IDLOTE`, `CONTABILIZADO`, `CODPLC_*`. **1 título → N baixas** (1→8.374, ≥2→485).
- **Config vs calculado:** `TXJUROS`/`TXMULTA` do título = **snapshot** de `EMPRESAS.TXJUROPADRAO/PERCENT_MULTA` (=5,0) na criação. `juro/total` = **calculado live** (fórmula abaixo).
- **Agrupamento** (in-place): `AGRUPADO='S'` + `CODGRUPO_AGRUPAMENTO_RCB` + título "capa" `AGRUPAMENTO='S'` + snapshot `AGRUPARECEBER`. Distinto do **Lote de Cobrança** (`ITENS_LOTECOB`, remessa bancária) já migrado.

### Fórmula de juros/desconto (verbatim, `UBaixaAreceber.pas:2395-2404`)
```
dias_atraso = DataJurosAte − DTVENC
se dias_atraso > dias_tolerancia (tolerância = PARCEIROS.TOLERANCIA):
   JURO = round((TXJUROS/30) * base/100 * dias_atraso, 2)   // base = TOTALCOMJUROS se CALCULAR_DESCONTO_SOBRE_JUROS_BXCR='S', senão VALOR
DescAcre = PERCENTUAL%*VALOR/100 + ACREDESC_VALOR − (VALOR*PARCEIROS.DESCPADRAO/100 se no prazo) + rateio_global
TOTALCOMJUROS = VALOR + ACREDESC + JURO
```
Já transcrita fiel na view `get_areceber` (`015_areceber.sql:63-76`) e `get_itens_lotecob` — **reusar, não duplicar**.

## 3. Estado do monorepo (o que existe)
- `areceber` (`015_areceber.sql` + `028_nf_faturamento.sql`) = **subset de 12 colunas** (codrcb, codparceiro, **codempresa** [≠idempresa], dtvenda, dtvenc, duplicata, valor, txjuros, consiliado, idnf, quitada, nrodup) + view `get_areceber` (juros/total). Sem FKs, sem auditoria, **sem tabela de baixa**.
- Escreve: `nf-faturamento.service.ts` (a NF gera títulos). Lê: Lote de Cobrança (`cobranca/`, picker `get_areceber` + agrupa em `itens_lotecob`).
- **`GET cobranca/areceber` já existe** (picker do Lote) → o CRUD novo usa outro path (`cadastro/areceber`).

## 4. Regras/validações do cadastro (procedência)
| Regra | Proc. `uCadAReceber.pas` | Condição |
|---|---|---|
| Empresa obrigatória | :923 | CODEMPRESA=0 barra (no web = tenant) |
| Máx. 200 parcelas | :930/:2894 | NRODUP>200 barra |
| Valor > 0 | :937/:1009 | VALOR≤0 barra |
| Cliente obrigatório | :944 | vazio barra |
| Forma de pagamento obrigatória | :951 | vazia barra |
| Venc ≥ venda | :958 | DTVENDA>DTVENC barra |
| Período contábil fechado | :965/:3470/:3583 | bloqueia gravar/editar/excluir |
| Σ parcelas = total doc | :998 | (multi-parcela) |
| Centro de custo obrigatório | :4155 | config OBRIGATORIEDADE_CC_CR |
| **Travas de estado (editar/excluir)** | VerificaBloqueio :4166 / VerificaContabilizado :4083 / VerificaCRCadastradaAutomaticamente :4116 | QUITADA='S' ou AGRUPADO='S' → bloqueia; CONTABILIZADO='S' bloqueia; origem ['Q','O','C'] ou IDNF≠0 (auto) → só alguns campos / reverter pela NF; CONSILIADO='S' não-manual bloqueia valores |
| Excluir criada por NF | :3594 | reverter pela NF (não excluir aqui) |

Defaults ao inserir (`udmCadAReceber.pas:409-428`): QUITADA='N', TXJUROS=EmpresaTXJUROPADRAO, CODBCO=0/'[SEM BCO]', CONSILIADO='S', CADASTRADO_MANUALMENTE='S' (tela manual).

## 5. Máquina de estados do título
```
ABERTO (QUITADA=N, AGRUPADO=N)
  → baixa total → QUITADA=S (ARECEBER_BX)      → estorno (INDR='E') volta a N
  → baixa parcial → novo título ORIGEM='B' (saldo) + baixa parcial
  → agrupado → AGRUPADO=S (+CODGRUPO)          → "remover" volta a ABERTO / "reverter" (se nenhum quitado)
  → contabilizado → CONTABILIZADO=S
QUITADA=S / AGRUPADO=S / CONTABILIZADO=S → não edita/exclui
```

## 6. Plano de cortes
- **Corte-1 (cadastro/gestão) — ESTE:** módulo vertical `areceber` (service+controller, contrato REST do CadMaster; tenant por `codempresa`; sem tocar o engine da NF). Migration enriquece `areceber` (colunas de gestão + auditoria + índices) + view. Validações (empresa[tenant]/cliente/valor>0/venc≥venda/máx-200). Travas de estado (quitada/agrupado/contabilizado/idnf-de-NF bloqueiam editar/excluir). Cadastro manual (`cadastrado_manualmente='S'`, `gerado='OPERADOR'`). juros/total via view. Front CadMaster tabulado (Cadastro + Histórico/Pendências inertes). RBAC FRMCADARECEBER.
- **Corte-2 (baixa núcleo):** tabela `areceber_bx` (INDR estorno-lógico) + serviço stateful (baixar: juro/desconto/acréscimo → quita, CAS; estornar: INDR='E' reabre) no molde `nf-faturamento`; juros da fórmula legada; guardas (título em lote `itens_lotecob`/quitado/contabilizado/período). Juros/total reusam a view.
- **Corte-3 (adiado/registrado):** agrupamento in-place (AGRUPARECEBER), 10 recursos de baixa (dinheiro/cheque/cartão/permuta/saldo/troco → dependem de caixa/cheque/cartão não migrados), contábil da baixa, boleto/CNAB, adiantamento, pendências, senha ADM/desconto, geração multi-parcela na tela, A Pagar (gêmea). BUG legado `AtualizaValoresAgrupamento` (TOTAL derivado de VALOR) a decidir no corte-3.

### Travas de estado — status (auditoria corte-1, 2026-07-02)
Entregues no corte-1 (`travarEditavel`, editar E excluir): **quitada** (`TITULO_JA_BAIXADO`), **agrupado** (`TITULO_AGRUPADO`), **contabilizado** (`TITULO_CONTABILIZADO`), **de-NF/idnf** (`TITULO_DE_NF`, uCadAReceber:3594), **origem automática** ['Q','O','C'] (`TITULO_ORIGEM_AUTO`, VerificaCRCadastradaAutomaticamente:4148), **conciliado não-manual** (`TITULO_CONCILIADO`, :3585 — com a exceção fiel `cadastrado_manualmente<>'S'`). Todas com smoke §31.5.
**ADIADO (corte-2, com procedência):** trava de **período contábil fechado** em gravar/editar/excluir (`ValidaPeriodoFechado` uCadAReceber:965 / `PeriodoFechado` :3583) — a infra existe (`PERIODO_FECHADO`, migration 038 `periodo_contabil`), mas a semântica de lock da A Receber (vs `BLOQ_NF` da NF) precisa ser confirmada no Oracle antes de portar; entra junto da baixa (corte-2, que também toca competência).

## 7. Riscos (do recon)
SQL por concatenação no legado (reescrever parametrizado); baixa por LOTE com efeitos amplos (ARECEBER_BX/CAIXA/CHEQUE/CARTAO/PERMUTAS/MOV_CONTAS/APAGAR-saldo/contábil) → estorno atômico; dezenas de configs (catalogar); IDs por `GetID` (migrar p/ sequence); TXJUROS congelada no título; dado sujo (DTPGTO ano 5022, valor 0); encoding ISO-8859.
