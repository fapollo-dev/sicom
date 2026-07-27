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
| **Data** | 2026-07-27 |
| **Commit de referência** | `9c3a8fa` (`main`, tudo verde) |
| **Estado de build** | api tsc 0 · api test 162 · smoke 761/0 · web tsc 0 · web test 32 · build ok |
| **Migrations aplicadas** | até `113` |
| **Features no `apps/web`** | 33 |
| **Schemas em `packages/shared`** | 35 |
| **Dossiês na retaguarda** | 28 |

---

## Headline — os três números

| Eixo | % | Leitura |
|------|---:|---------|
| **Por contagem de telas de negócio** | **~20%** | ~34 telas de ~165 no universo (retaguarda + PDV). |
| **Por peso/complexidade** | **~35–40%** | Quase todos os *forms mais pesados* do legado já estão convertidos e certificados (motor fiscal NF, financeiro, compras, promoções). |
| **Por avanço do programa (fases)** | **~30%** | Fases 0–1 fechadas, Fase 2 ~55%, Fases 3–6 (PDV/fiscal/sync/cutover/IA) ~0–5%. |

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
| **Fiscal — apuração/SPED** | NF (uNF, o maior form do ERP) ✅ + SPED EFD-Contribuições PIS/COFINS ✅. Falta NFC-e, SAT, CTe, NF-e de **entrada** (XML), Redução Z, SEFAZ real/DANFE. | **~45%** |
| **Financeiro / Contábil** | A Receber ✅, A Pagar ✅, Caixa ✅ (+conferência PDV), Plano de Contas ✅, DRE ✅, Livro Razão ✅, Contas Bancárias ✅, Lote de Cobrança ✅. Falta CNAB/boletos completo, conciliação bancária. | **~75%** |
| **Compras** | Pedido de Compra ✅ (+recebimento parcial 1:N +precificação +PIS/COFINS), Devolução de Compra ✅, Cotação/RFQ ✅. | **~80%** |
| **Preço & Promoções** | Preços ✅, Tabela de Preço ✅, Agenda de Promoção ✅, Gestão de Promoções ✅ (11/11 mecânicas). | **~85%** |
| **Cadastros (~101 telas)** | ~23 entregues (Parceiros, Produtos, Bancos, Cidades, Bairros, Marcas, NCM, Operações Conta, Motivos, Empresas, Configurações, Formas/Condições Pgto, De-Para…). Resto é a cauda longa. | **~23%** |
| **Estoque** | Ajuste de Estoque ✅, Inventário ✅. Falta multi-depósito/multi-bucket, transferência entre lojas, kardex pleno. | **~35%** |
| **Segurança / Plataforma** | Operadores ✅, Perfis & Permissões ✅, Auth (refresh token, lockout, restrição de horário, cutover de 157 senhas) ✅, multi-tenant ✅. | **~80%** |
| **Vendas / PDV** | Só modelagem + débito SPED (mig105/106). App offline, devices, fiscal no PDV, TEF/PIX = pendentes. | **~5%** |
| **Relatórios (~1.018 frx)** | Só DRE/Razão determinísticos. | **~1%** |

---

## Por fase do roadmap

| Fase | Nome | Estado | ~% |
|------|------|--------|---:|
| **0** | Fundação | infra, teclado, tenant, auth, SPIKE fiscal | ✅ **~100%** |
| **1** | Tela-piloto | loop provado ponta a ponta | ✅ **100%** |
| **2** | Retaguarda | cadastros grandes + compras + estoque + financeiro + fiscal central/SPED + preço/promoções entregues; falta NF-e de entrada, CNAB completo, CTe, cauda de cadastros | 🟡 **~55%** |
| **3** | PDV (offline/devices/fiscal) | só modelagem/débito SPED — o risco-coroa | ⬜ **~5%** |
| **4** | Edge + Sync (substituir o Horse) | — | ⬜ **0%** |
| **5** | Cutover por cliente | De-Para/grade feito; ETL Oracle→PG parcial | ⬜ **~5%** |
| **6** | DS / IA | — | ⬜ **0%** |

---

## Telas convertidas e verdes (numerador)

Fiscal/Financeiro/Contábil: **NF** (uNF) · **SPED EFD-Contribuições** · A Receber · A Pagar · Caixa · Plano de Contas · DRE · Livro Razão · Contas Bancárias · Lote de Cobrança.

Compras/Estoque: **Pedido de Compra** · Devolução de Compra · Cotação/RFQ · Ajuste de Estoque · Inventário.

Preço/Promoção: Preços · Tabela de Preço · Agenda de Promoção · **Gestão de Promoções** (11/11 abas).

Cadastros/Plataforma: Parceiros · Produtos · Bancos · Cidades · Bairros · Marcas · NCM · Operações de Conta · Motivos de Operação · Empresas · Configurações · Formas de Pagamento · Condições de Pagamento · De-Para · Operadores · Perfis & Permissões · Auth/multi-tenant.

Parcial: **PDV/Vendas** (modelo + débito SPED; ETL real e fluxo de venda pendentes).

---

## O que ainda pesa (heavies pendentes)

- **PDV inteiro** — app offline-first, devices (impressora fiscal, balança, gaveta, pinpad), fiscal no PDV (NFC-e/SAT + contingência), TEF/PIX. É a Fase 3, risco máximo.
- **NF-e de entrada** (importação XML, manifestação do destinatário) e **CTe** (uCadCte, ~6,5k linhas).
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
