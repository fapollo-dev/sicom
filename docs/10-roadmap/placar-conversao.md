# Placar de Conversão — quanto do legado já virou plataforma nova

> Resposta rastreável (não estimativa de cabeça) para **"quanto já convertemos do sistema legado?"**. Cruza o **inventário do legado** (universo de telas de negócio) com o que está **entregue e verde** no app novo. Dois eixos, porque a resposta muda com o denominador: **contagem de telas** (largura) e **peso/complexidade** (valor de negócio migrado). O placar é front-loaded de propósito — os módulos mais pesados vieram primeiro.

## Pré-requisitos de leitura

- [phases.md](phases.md) — as 7 fases strangler; este placar mapeia o progresso contra elas.
- [../03-legacy-analysis/recon/mapa-reconhecimento.md](../03-legacy-analysis/recon/mapa-reconhecimento.md) — de onde sai o denominador (universo do legado).
- [../04-screen-dossier/dossiers/retaguarda/](../04-screen-dossier/dossiers/retaguarda/) — os dossiês por tela (a unidade de conversão).

---

## Snapshot

| Campo | Valor |
|-------|-------|
| **Data** | 2026-08-19 |
| **Commit de referência** | `af37ca9` (`main`, tudo verde) |
| **Estado de build** | api tsc 0 · api test 183 · **smoke 1004/0** · web tsc 0 · web test 37 · build ok |
| **Migrations aplicadas** | até `165` |
| **Features no `apps/web`** | 43 |
| **Schemas em `packages/shared`** | 44 |
| **Dossiês na retaguarda** | 37 |

### O que entrou desde o snapshot anterior (30/07 → 18/08)

Hub dos relatórios de venda (50 modelos numa tela) · Manifesto DF-e completo (fila + SEFAZ + importação) ·
Pendências do Operador **inteiro** (fila, análise, motor de divergências, liberar com financeiro, refazer) ·
SPED EFD-Contribuições corte-2 (natureza real da receita não-tributada) · Prévia do Fornecedor fechada ·
impressão global (substituto do FastReport) · **cobrança bancária completa**: remessa CNAB (Itaú 400 e BB 400,
envio/cancelamento/alteração de vencimento), retorno do banco e boleto (código de barras, linha digitável,
instruções e ficha imprimível) · plano de carga do cutover.

---

## Reordenação da fila por DADO (2026-08-18)

Depois de fechar a cobrança e as pendências, a fila foi reavaliada cruzando **uso real** (`MENUEXPRESS`:
acessos e nº de operadores), **tamanho do fonte** e **liveness/recência no Oracle** — não por adjacência:

| candidato | acessos | operadores | dados no Oracle | recência | veredicto |
|---|---:|---:|---|---|---|
| ~~Pedido de Devolução de Compras~~ (`FRMCADPEDIDODEVOLUCAOCOMPRAS`) | 1.753 | 15 | 545 pedidos + 3.809 itens | out/2025 | ⚠️ **JÁ MIGRADO** (migs 072-074 + `devolucao-compra.*`) — o épico "Devolução de Compra" **é** este form, com saldo por item, espelho fiscal rateado e a regra de ICMS-ST do fornecedor. Entrou nesta lista por engano (ver §Erro de leitura abaixo). |
| ~~Finalização do fechamento de caixa~~ (`UfinalizaFechamento`, aberta pelo `FRMFECHAMENTOCAIXA`) | — | 35 (do form que a chama) | **172.164** linhas + **876.927** documentos | set/2025 | ⛔ **DESCARTADO** — a consolidação é **por PDV**, e a orientação vigente é não mexer em nada do PDV. O recon fica no repositório (`uFechamentoCaixa-finalizacao.md`) para quando o PDV entrar. |
| Fechamento diário (`FRMFECHAMENTODIARIO`) | 389 | 8 | 3.439 (tabela `FECHAMENTO`) | linha até **abr/2026**, mas último **fechamento** em **fev/2024** | **REBAIXADO por recon** (`uFechamentoDiario.md`): a linha aberta é resíduo de navegação (a tela cria os dias do mês ao abrir), o fechamento parou há 2 anos, e o único gate duro (`uTron.PeriodoFechado`) protege uma rotina que lê `REDUCAOZ` — **vazia** neste tenant. Épico barato, dormente: entra quando TRON/Sintegra precisarem do gate |
| ~~Consulta histórico de vendas~~ (`FRMCONSHISTVENDAS`) | 841 | 25 | leitura | — | ✅ **corte-1 ENTREGUE** (`55686d7`, mig 160): a consulta de um cupom (itens com IAT/descontos, rodapé, finalizadores e as duas portas de entrada). **corte-2 também ENTREGUE** (`8f860dd`, mig 161): a LISTA/pesquisa (view `get_hist_vendas` com os dois níveis de agregação do legado). A "consulta de PEDIDOS" saiu de cena: é **resíduo morto no fonte** (o dataset nunca é aberto) — a tabela é viva, a porta morreu. A linha aparecia duplicada nesta tabela — consolidada aqui |
| ~~Adiantamento a fornecedor~~ (`FRMADIANTAMENTOFORNECEDOR`) | 699 | 11 | 563 adiantamentos | mar/2025 | ✅ **ENTREGUE** (mig 159 + `adiantamento-forn.*` + tela): os dois fatos (movimento na conta corrente + título a receber/a pagar), gates de saldo/chaveamento/quitada/contabilizado/período e a quitação pelas baixas |
| Fechamento/sangria (`FRMFECHAMENTOSANGRIA`) | 3.339 | 20 | — | — | **é do PDV** (não existe fonte na retaguarda) ⇒ bloqueado pela decisão do usuário |
| Devolução de vendas (`FRMDEVOLUCAOVENDAS`) | 2.412 | 26 | 2.286 | — | bloqueado: acoplado ao PDV |
| `FRMSALDOEMPRESA` | 563 | 6 | — | — | bloqueado com prova (fonte viva inexistente) |

### Varredura por TABELA (2026-08-19): o que tem dado e não tem código

Com os épicos grandes fechados, a fila passou a ser levantada **por dado**, não por tela: das 841 tabelas do
tenant, 213 têm mais de 500 linhas; cruzando os nomes com todo o `apps/api` (migrations + código), **112 não têm
nenhuma referência**. Tirando backup/temporária/auditoria (`W_*`, `Z_TEMP_*`, `AUDIT_*`, `LOG_*`…), sobra isto:

| tabela | linhas | período | fonte no legado | veredicto |
|---|---:|---|---|---|
| ~~`ANALISE_COMP_DIA_PROD`~~ | 2.850.037 | 2018-01 → fev/2024 (depois, ruído) | `URelAnaliseComportamentoPeriodo.pas` | ⛔ **NÃO MIGRA — cache derivável** (dossiê `uAnaliseComportamento-giros.md`): acumulador do batch externo **Giros**, com roll-up redundante em `ANALISE_COMPORTAMENTO_DIARIO` (totais anuais idênticos) e staging de impressão em `REL_ANALISE_COPORTAMENTO(_GRID)` |
| ~~`MOVIMENTACAO_DIARIA`~~ | 2.338.168 | 2019-01 → fev/2024 (depois, ruído) | `uVendas.pas`, `uPedidoCompra.pas`, `uProdutosRel.pas`, `uDDE.pas` | ⛔ **NÃO MIGRA — derivável, provado pela procedure do banco**: `GERA_MOVIMENTACAO_DIARIA` é `DELETE` do período + `INSERT` de `VENDAS` (não cancelada) ∪ `NF/NF_PROD` (`TIPO='S'`, `PROC='S'`, CFOP de venda). Os 5 consumidores só leem; o Apollo já deriva a mesma regra em `rel-sem-movimento` e `previa-fornecedor` |
| ~~`APURACAO_ICMS_DETALHES`~~ | 1.155.893 | — | `uRelRegistros_ES.pas` + `uDMRelRegistros_ES.pas` | ✅ **ENTREGUE** (`2e47bae` mig 164 · folds `612021a` mig 165 · tela `701e4bf`): o processo que produz o E110, com as três pernas (notas de saída, **cupons** e notas de entrada), resumo por CFOP e a tela dos três quadros. A auditoria achou 6 ALTA no detalhe — todos corrigidos |
| `BALANCOITENS` | 980.574 | (sem data) | — | conferir contra o épico Inventário antes de qualquer coisa |
| `IMOV_ANALISE_CONCORRENTE` | 227.914 | 2023-07 → **04/02/2026** | **nenhuma** | ⛔ bloqueada (lição 35): pesquisa de concorrência sem fonte no repo clonado |
| `CARTAO_SELECAO` | 116.415 | 2024-03 → **04/03/2026** | **nenhuma** | ⛔ bloqueada pelo mesmo motivo (satélite do épico Cartões) |
| `NFE_INUTILIZADA` | 44.758 | 2020-08 → **28/05/2026** (a mais recente de todas) | `UNFE_Inutilizada.pas` + `uDMNFE_INUTILIZADA.pas` + `NFe.pas` | ⚠️ **PDV-adjacente**: **44.757 das 44.758** são `TIPONF='NFCE'` (só 1 é NFE) e a faixa é sempre de UM número — é numeração de cupom eletrônico pulada no PDV. A tela é da retaguarda, o dado é do PDV ⇒ fora da regra vigente ("nada do PDV") |
| `NF_PROD_LOTE` | 56.521 | datas de validade com lixo (0202, 4790) | — | rastreabilidade de lote/validade por item de NF; conferir fonte antes |

Duas coisas que a varredura ensinou e valem para as próximas: **tabela grande sem código pode ser acumulador de
relatório** (derivável, não migrável) e **tabela viva sem fonte no repo clonado é bloqueio, não pendência** — o
mesmo veredicto do `FRMSALDOEMPRESA`.

**As duas maiores da fila caíram por prova (2026-08-19).** `MOVIMENTACAO_DIARIA` + `ANALISE_COMP_DIA_PROD` +
`ANALISE_COMPORTAMENTO_DIARIO` + `REL_ANALISE_COPORTAMENTO(_GRID)` = **5,2 milhões de linhas de cache** escritas
por um batch externo (o app **Giros**, `uAnaliseComportamento.pas:214-217`; `PROCESSOS.NOMEPROCESSO='GIROS'`,
última execução 04/12/2025 às 09:55, 22 s, manual) cuja rotina diária **parou em fev/2024** — e sem fonte em
`/Library/SicomGit`. Nenhuma delas se migra: a regra é derivável de `VENDAS` ∪ `NF/NF_PROD` e o Apollo **já a
aplica** (`rel-sem-movimento.service.ts` deriva o movimento das duas pernas; `previa-fornecedor.service.ts` tem
`somenteComGiro`/`dias_com_movimento`). Lição prática: **antes de olhar volume, procure o escritor** — quando ele
é uma procedure de `DELETE`+`INSERT` ou um app externo, a tabela é cache, e o veredicto vale mais que um corte.
O que sobrou de real é um **épico de tela sem tabela**: `FRMANALISECOMPORTAMENTO` (BI mensal — 9 indicadores ×
semanas 1-5 + comparativo mês/ano anterior, permissão 34/15) e `FRMRELANALISECOMPORTAMENTOPERIODO` (período de
referência × 2 comparações, 34/15). Dossiê: `docs/04-screen-dossier/dossiers/retaguarda/uAnaliseComportamento-giros.md`.

### O alvo do PDV caiu — e o que entrou no lugar (2026-08-19)

A finalização do fechamento de caixa (o item "próximo" da tabela) **saiu da fila por decisão explícita**: a
consolidação do `FINALIZA_FECHAMENTO` é **por PDV**, e a orientação vigente é não tocar em nada do PDV enquanto a
retaguarda não estiver fechada. O dossiê do recon fica no repositório para quando o PDV entrar.

No lugar entrou o melhor candidato de **retaguarda pura**: **Adiantamento a Fornecedor/Parceiro**
(`FRMADIANTAMENTOFORNECEDOR`, 699 acessos/11 operadores, 563 adiantamentos e R$ 844 mil no golden). A ausência no
código foi provada antes de eleger (a lição da rodada anterior), e o corte entregou o que a tela realmente faz:
**dois fatos por registro** — o movimento na conta corrente e o título gerado (a receber quando o dinheiro sai, a
pagar quando entra) — mais os gates (saldo só no débito e só em conta caixa, chaveamento do caixa, quitado,
contabilizado, período contábil) e a **quitação pelas baixas** de A Receber/A Pagar, com a reabertura no estorno.
Dossiê: `docs/04-screen-dossier/dossiers/retaguarda/uCadAdiantamentoFornecedor.md`.

Achado colateral que vale para o cutover: o legado grava `MOV_CONTAS_BANCARIAS.VALOR` **com sinal** (crédito
positivo em 101.911 linhas, débito negativo em 42.527), enquanto o app novo grava **magnitude** e tira o sinal do
`tipomovimento`. Na carga, o `VALOR` do legado tem de entrar como `abs(VALOR)` — anotado no dossiê.

### Segundo erro de leitura, e o que ele revelou (2026-08-19)

A tabela acima foi montada a partir de um levantamento do `MENUEXPRESS` cuja saída foi **truncada por um `tail`**:
as 15 primeiras linhas — os forms MAIS usados — nunca apareceram. Refeito sem truncar, o topo real é
`FRMETIQUETA` (512.456 acessos), **`FRMFECHAMENTOCAIXA` (41.215, 35 operadores)**, `FRMCADSCRAP` (40.741),
`FRMNF`, `FRMCADPRODUTO`, `FRMMANIFESTODFE`, `FRMCADAGENDAPROMOCAO`, `FRMPEDIDOCOMPRA`, `FRMAPAGAR`,
`FRMRELVENDAS`, `FRMRELFINALIZADORAS` — e **todos os 11 estão cobertos no código** (verificado por busca).

Isso confirma a leitura do placar ("o mais pesado veio primeiro") e mudou o próximo alvo: em vez de uma tela
nova de uso baixo, o melhor retorno está numa **etapa que falta dentro do 2º form mais usado** —
`FINALIZA_FECHAMENTO` (172.164 linhas) + `DOC_FECHAMENTO` (876.927), a consolidação do fechamento de caixa por
PDV e operação, que **não tem nenhuma referência no código novo**. Dossiê:
`docs/04-screen-dossier/dossiers/retaguarda/uFechamentoCaixa-finalizacao.md`.

Lição operacional: **nunca cortar a saída de um levantamento de priorização** — `head` no que interessa, nunca
`tail` numa lista ordenada por relevância.

### Erro de leitura da rodada anterior (registrado de propósito)

A primeira versão desta tabela elegeu o **Pedido de Devolução de Compras** como próximo épico. Estava errado: o
form **já estava migrado** desde as migs 072-074 — o épico que o repositório chama de "Devolução de Compra" **é**
essa tela (o pedido que depois emite a NF), incluindo saldo por item, espelho fiscal rateado e a regra de
ICMS-ST do fornecedor. O erro veio de cruzar o `MENUEXPRESS` com a **memória** do que já foi feito em vez de
cruzar com o **código**. O trabalho começado foi revertido antes de qualquer commit, e a regra virou permanente:

> **antes de eleger um épico, provar a ausência no código** — `grep` pela tabela, pela rota e pelo nome do form
> em `apps/api/src`, `apps/api/migrations` e `apps/web/src`. Uso alto no menu diz que a tela importa, não que
> ela falta.

Os candidatos que sobraram foram verificados assim: Fechamento diário e Consulta de histórico de vendas **não
têm nenhuma referência** no código novo. Correção paralela: no plano de carga, `pedido_devolucao_compra_i` é
tabela nossa (mig 072) que carrega de `PEDIDO_DEVOLUCAO_COMPRA_ITENS` — o mapeamento de colunas ficou anotado.

---

## Headline — os três números

| Eixo | % | Leitura |
|------|---:|---------|
| **Por contagem de telas de negócio** | **~24%** | ~40 telas de ~165 no universo (retaguarda + PDV). |
| **Por peso/complexidade** | **~40–45%** | Quase todos os *forms mais pesados* do legado já estão convertidos e certificados (motor fiscal NF, **as duas obrigações de SPED**, financeiro, compras, promoções). |
| **Por avanço do programa (fases)** | **~32%** | Fases 0–1 fechadas, Fase 2 ~60%, Fases 3–6 (PDV/fiscal/sync/cutover/IA) ~0–5%. |

> **Por que os três divergem:** o legado tem ~101 cadastros repetitivos (o padrão `TfrmCadMaster`) que pesam pouco cada, e um **segundo app inteiro (PDV, ~60 forms)** que é o risco-coroa e ainda não foi atacado. Contar telas subestima o valor já migrado; contar peso mostra que o difícil já está de pé; contar fases lembra que o mais arriscado ainda está pela frente.

---

## Metodologia

**Denominador (universo do legado)** — de [mapa-reconhecimento.md](../03-legacy-analysis/recon/mapa-reconhecimento.md):

- **Retaguarda:** ~101 telas de cadastro (`UCad*` sobre `TfrmCadMaster`) + ~44 telas transacionais/fiscais/relatórios substantivas ≈ **~145 telas de negócio**.
- **PDV/Vendas:** app separado (`Pdv.exe`/`ApPDV.exe`), ~60 forms → **~20 fluxos de negócio reais**.
- **Total ≈ ~165 telas de negócio.** Ficam **fora** do denominador: ~323 datamodules, bibliotecas gráficas (ex.: `uGifImage`), e a cauda de ~1.018 relatórios FastReport (contados à parte como long-tail).

**Estados de uma tela:**

| Estado | Significado |
|--------|-------------|
| ✅ **Verde** | Entregue no app novo, CI verde, paridade/auditoria feita. |
| 🟡 **Em revisão** | Construída, auditada, aguardando fold/merge final. |
| 📝 **Rascunho** | Só recon (`.pas`/`.dfm` + Oracle) — **não** conta como convertida. |
| ⬜ **Não iniciada** | Sem trabalho. |

Só **✅ Verde** entra no numerador.

---

## Por área funcional

| Área | Estado | ~% |
|------|--------|---:|
| **Fiscal — apuração/SPED** | NF (uNF, o maior form do ERP) ✅ + **as duas obrigações acessórias**: SPED EFD-Contribuições PIS/COFINS ✅ e SPED EFD ICMS/IPI ✅ (materialmente completo p/ este tenant; Bloco D = cópia-fiel-negativa provada). Falta o **cutover com golden real do PVA**, NFC-e, SAT, CTe, NF-e de **entrada** via SEFAZ, Redução Z, SEFAZ real/DANFE, conteúdo dos blocos G/K/1. | **~60%** |
| **Financeiro / Contábil** | A Receber ✅, A Pagar ✅, Caixa ✅ (+conferência PDV), Plano de Contas ✅, DRE ✅, Livro Razão ✅, Contas Bancárias ✅, Lote de Cobrança ✅, **Cartões/Recebíveis ✅** (baixa = corte-2). Falta CNAB/boletos completo, conciliação bancária, conciliação de extrato de cartão. | **~80%** |
| **Compras** | Pedido de Compra ✅ (+recebimento parcial 1:N +precificação +PIS/COFINS), Devolução de Compra ✅, Cotação/RFQ ✅. | **~80%** |
| **Preço & Promoções** | Preços ✅, Tabela de Preço ✅, Agenda de Promoção ✅, Gestão de Promoções ✅ (11/11 mecânicas). | **~85%** |
| **Cadastros (~101 telas)** | ~25 entregues (Parceiros, Produtos, Bancos, Cidades, Bairros, Marcas, NCM, Operações Conta, Motivos, Empresas, Configurações, Formas/Condições Pgto, De-Para, **CFOP × Situação**, **Operadoras/Bandeira**…). Resto é a cauda longa. | **~25%** |
| **Estoque** | Ajuste de Estoque ✅, Inventário ✅, **Scrap/Perdas ✅**, **Troca com Fornecedor ✅**, **Posição de Estoque + Kardex ✅** (aba do Produto). Falta multi-depósito/multi-bucket (dormente neste tenant), transferência entre lojas, produção açougue/padaria. | **~45%** |
| **Segurança / Plataforma** | Operadores ✅, Perfis & Permissões ✅, Auth (refresh token, lockout, restrição de horário, cutover de 157 senhas) ✅, multi-tenant ✅. | **~80%** |
| **Vendas / PDV** | Só modelagem + débito SPED (mig105/106). App offline, devices, fiscal no PDV, TEF/PIX = pendentes. | **~5%** |
| **Relatórios (~1.018 frx)** | Só DRE/Razão determinísticos. | **~1%** |

---

## Por fase do roadmap

| Fase | Nome | Estado | ~% |
|------|------|--------|---:|
| **0** | Fundação | infra, teclado, tenant, auth, SPIKE fiscal | ✅ **~100%** |
| **1** | Tela-piloto | loop provado ponta a ponta | ✅ **100%** |
| **2** | Retaguarda | cadastros grandes + compras + estoque + financeiro + fiscal central + **as 2 obrigações de SPED** + preço/promoções entregues; falta NF-e de entrada via SEFAZ, CNAB completo, CTe, cauda de cadastros | 🟡 **~60%** |
| **3** | PDV (offline/devices/fiscal) | só modelagem/débito SPED — o risco-coroa | ⬜ **~5%** |
| **4** | Edge + Sync (substituir o Horse) | — | ⬜ **0%** |
| **5** | Cutover por cliente | De-Para/grade feito; ETL Oracle→PG parcial | ⬜ **~5%** |
| **6** | DS / IA | — | ⬜ **0%** |

---

## Telas convertidas e verdes (numerador)

Fiscal/Financeiro/Contábil: **NF** (uNF) · **SPED EFD-Contribuições** · **SPED EFD ICMS/IPI** · A Receber · A Pagar · Caixa · **Cartões/Recebíveis** · Plano de Contas · DRE · Livro Razão · Contas Bancárias · Lote de Cobrança.

Compras/Estoque: **Pedido de Compra** (+recebimento/import XML/1:N) · Devolução de Compra · Cotação/RFQ · Ajuste de Estoque · Inventário · **Scrap/Perdas** · **Troca com Fornecedor**.

Preço/Promoção: Preços · Tabela de Preço · Agenda de Promoção · **Gestão de Promoções** (11/11 abas).

Cadastros/Plataforma: Parceiros · Produtos · Bancos · Cidades · Bairros · Marcas · NCM · Operações de Conta · Motivos de Operação · Empresas · Configurações · Formas de Pagamento · Condições de Pagamento · De-Para · **CFOP × Situação** · **Operadoras/Bandeira** · Operadores · Perfis & Permissões · Auth/multi-tenant.

Parcial: **PDV/Vendas** (modelo + débito SPED; ETL real e fluxo de venda pendentes).

---

## O que ainda pesa (heavies pendentes)

- **PDV inteiro** — app offline-first, devices (impressora fiscal, balança, gaveta, pinpad), fiscal no PDV (NFC-e/SAT + contingência), TEF/PIX. É a Fase 3, risco máximo. Também é o que destrava: contábil por modalidade (situação 2010), tesouraria multi-forma, geração automática de recebível de cartão e **devolução de vendas**.
- **Cutover do SPED com golden real do PVA** — certificar `C500/C590/H005/H010` campo-a-campo contra um `.txt` de produção. A estrutura está completa; a prova final não.
- **NF-e de entrada via SEFAZ** (manifestação do destinatário) e **CTe** (uCadCte, ~6,5k linhas). O import de XML **a partir de arquivo fornecido** já está entregue no recebimento.
- **Edge + Sync** (substituir o Horse) — Fase 4.
- **Cutover por cliente** (dual-run, reconciliação, rollback, ETL Oracle→Postgres em escala) — Fase 5.
- **Cauda de ~78 cadastros** restantes + **~1.018 relatórios FastReport**.
- **DS/IA** — Fase 6.

---

## Como recalcular

1. `ls apps/web/src/features/ | wc -l` — features no app novo.
2. `ls apps/api/migrations/ | wc -l` — migrations aplicadas.
3. Marcar cada tela nova como ✅/🟡/📝 conforme o dossiê em [../04-screen-dossier/dossiers/retaguarda/](../04-screen-dossier/dossiers/retaguarda/) e o último verde de CI.
4. Numerador = contagem de ✅; denominador = ~165 (fixo até o recon do legado mudar).
5. Atualizar o **Snapshot** (data + commit) e os três **headline**.

> **Atualize este arquivo a cada corte que fecha uma tela nova.** É a fonte única do "% convertido" — para não depender de estimativa de memória.

---

## Ver também

- [phases.md](phases.md) — as fases e seus critérios de saída.
- [blind-spots.md](blind-spots.md) — o que ainda não foi enxergado (pesa no denominador real).
- [../03-legacy-analysis/recon/mapa-reconhecimento.md](../03-legacy-analysis/recon/mapa-reconhecimento.md) — o universo do legado.
- [../06-testing-quality/parity-harness.md](../06-testing-quality/parity-harness.md) — o verde que libera cada tela.
