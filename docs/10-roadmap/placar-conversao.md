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
| **Data** | 2026-08-18 |
| **Commit de referência** | `9031ec7` (`main`, tudo verde) |
| **Estado de build** | api tsc 0 · api test 183 · smoke 972/0 · web tsc 0 · web test 37 · build ok |
| **Migrations aplicadas** | até `158` |
| **Features no `apps/web`** | 41 |
| **Schemas em `packages/shared`** | 42 |
| **Dossiês na retaguarda** | 33 |

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
| **Pedido de Devolução de Compras** (`FRMCADPEDIDODEVOLUCAOCOMPRAS`) | 1.753 | 15 | 545 pedidos + **3.809 itens** | **out/2025** | **próximo** — complementa a Devolução de Compra já migrada |
| Fechamento diário (`FRMFECHAMENTODIARIO` + `UfinalizaFechamento`) | 389 | 8 | 3.439 fechamentos · 172.164 lançamentos · 876.927 docs | abr/2026 | forte candidato seguinte (mas ~3.500 linhas de fonte) |
| Consulta histórico de vendas (`FRMCONSHISTVENDAS`) | 841 | 25 | leitura | — | leve; entra junto de outro corte |
| Adiantamento a fornecedor (`FRMADIANTAMENTOFORNECEDOR`) | 699 | 11 | 563 adiantamentos | mar/2025 | fila |
| Fechamento/sangria (`FRMFECHAMENTOSANGRIA`) | 3.339 | 20 | — | — | **é do PDV** (não existe fonte na retaguarda) ⇒ bloqueado pela decisão do usuário |
| Devolução de vendas (`FRMDEVOLUCAOVENDAS`) | 2.412 | 26 | 2.286 | — | bloqueado: acoplado ao PDV |
| `FRMSALDOEMPRESA` | 563 | 6 | — | — | bloqueado com prova (fonte viva inexistente) |

Correção que saiu dessa rodada: o plano de carga registrava `PEDIDO_DEVOLUCAO_COMPRA_I` como "conferir se
existe"; o nome real é **`PEDIDO_DEVOLUCAO_COMPRA_ITENS`** e a tela é viva (corrigido no plano).

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
