# Dossiê de Tela — DRE Contábil (relatório) — `UFrmRelDREContabil` + `UConfigDREContabil`

## 0. Cabeçalho (ADR-012)

| Campo | Valor |
|---|---|
| **Status** | corte-1 (relatório DRE calculado, estrutura semeada) ENTREGUE e verde, 2026-07-02. Recon 3 agentes; auditoria adversarial. Verde: api tsc 0 · api test 123 · smoke 250/0 · web tsc 0 · web test 25 · web build. |
| **Autor** | Claude (agente de migração) |
| **Fontes legadas** | `UFrmRelDREContabil.pas` (676, relatório) · `UConfigDREContabil.pas` (644) + `UFrmCadConfigDREContabil.pas` (756, editor da estrutura) · `UFrmRelLancamentosContabeis.pas` (1416, razão) |
| **Golden** | Oracle PINHEIRAO: CONFIG_DRE_CONTABIL 92 · VINCULO_PLC_CFG_DRE 10.430 · DIARIO 888.243 |

## 1. Modelo (Oracle real)
- **`CONFIG_DRE_CONTABIL`** (92 linhas, árvore por `CFGDRE_CODPAI`/`CFGDRE_CODEXPANDIDO`): `CFGDRE_CODIGO` (PK), `CFGDRE_CODEXPANDIDO` (máscara ex. `04.002.1201`), `CFGDRE_DESCRICAO`, **`CFGDRE_TIPO_CALCULO`** (`P`=por contas vinculadas 72 · `F`=soma das filhas 19 · `E`=expressão 1), **`CFGDRE_CLASSE`** (`A`=analítica recebe vínculo · `S`=sintética agrega), `CFGDRE_EXPRESSAO`, `CFGDRE_NIVEL` (1/2/3), `CFGDRE_ATIVO`. Raízes nível-1: `01` RECEITA LÍQUIDA, `03` CMV, `04` DESPESAS OP, `08` LUCRO BRUTO (E `<01>+<03>+<04>`), `10` OUTROS, `20` ATIVO/PASSIVO.
- **`VINCULO_PLC_CFG_DRE`** (10.430): `CODPLANOCONTAS` → `CFGDRE_CODIGO` (mapeamento **por conta individual**; 1 conta → 1 linha; a linha 49 tem 10.338 contas de fornecedores). Só linhas `P` (analíticas) têm vínculo.
- **Cálculo** (verbatim `UFrmRelDREContabil.pas:AntesImprimir`):
  - **P** = Σ dos lançamentos do DIÁRIO das contas vinculadas, sinal **crédito +1 / débito −1** (`:106`). Não há coluna de sinal.
  - **F/S** = Σ das filhas, propagado bottom-up (`for nivel := max−1 downto 1`, `:301`).
  - **E** = avalia `CFGDRE_EXPRESSAO`, substituindo `<codexpandido>` pelo total da raiz nível-1 (`:211`); erro → 0.
- **Período** = `TRUNC(DATALAN) BETWEEN :ini AND :fim` (**`DIARIO.CODPERIODO` é 100% NULL** — não usar). **Empresa** = `DIARIO.CODEMPRESA` (config é global, sem empresa). Sem exercício/saldo de abertura/comparativo.
- **Núcleo SQL (confirmado no golden):**
  ```sql
  with mov as (
    select contacredito conta,  sum(valor) v from diario where codempresa=:emp and datalan between :ini and :fim group by contacredito
    union all
    select contadebito  conta, -sum(valor) v from diario where codempresa=:emp and datalan between :ini and :fim group by contadebito
  ), saldo as (select conta, sum(v) saldo from mov group by conta)
  -- join dre_estrutura + dre_conta → soma por linha (P), depois roll-up (F) e fórmula (E).
  ```
  Validado 2022/emp1: Receita 15.370.178,47 · CMV −12.685.367,74 · Despesas −3.062.645,05 · Lucro Bruto (`<01>+<03>+<04>`) −377.834,32.

## 2. Monorepo
`diario` (035) + `plano_contas` com `natureza` (046) existem; §29 gera lançamentos reais (mas quase todos estornados no smoke → o DRE-smoke semeia `diario` direto). **Não há** tabelas de estrutura do DRE. Molde de relatório = controller vertical read-only (como `plano-contas.controller`) + agregação Kysely/`sql` (como `nf-contabilizacao`). Front = `DataTable` com árvore (`getTreeDataPath`, igual ao Plano de Contas) + totais (`showTotalizers`/`aggregate:'sum'`). ⚠️ `diario` não está no `TenantDB` → uso `any` (como o serviço de contabilização) ou registro.

## 3. Plano de cortes
- **Corte-1 (ESTE) — relatório DRE calculado:** migration cria `dre_estrutura` (espelha CONFIG_DRE_CONTABIL: codigo/codexpandido/descricao/tipo_calculo P/F/E/classe A/S/expressao/nivel/codpai self-FK/ativo) + `dre_conta` (codplanocontas→codestrutura) + view `get_dre_estrutura` + **seed de uma estrutura mínima FIEL** (01 Receita Líquida[F] {124 receita, 127 dedução} · 03 CMV[F] {134} · 08 Lucro Bruto[E]=`<01>+<03>`) + RBAC FRMDRE. **Motor** `dre.service` (`GET cadastro/dre?dataInicio&dataFim`): agrega o DIÁRIO (Σ crédito−débito por conta, tenant+período) → linhas **P** → roll-up **F** → fórmula **E** (avaliador aritmético seguro, sem eval). Front `DreRelatorio` (filtro período + DataTable árvore + totais).
- **Corte-2 (adiado/registrado):** **editor da estrutura** (CRUD árvore config + vínculo conta→linha, molde do Plano de Contas) + **relatório de Lançamentos/Razão** (extrato do DIÁRIO por período/empresa + totais D/C, filtros data/empresa/origem) + máscara configurável do DRE + importação da config real (92 linhas/10.430 vínculos) + filtro por PLC + guia "contas sem vínculo".

## 3b. Auditoria do corte-1 (2026-07-02)
Veredito: seguro; núcleo fiel (sinal crédito+/débito−, ordem P→F→E, avaliador **sem eval**, SQL **parametrizado** pelo Kysely, tenant fail-closed). **2 MÉDIA corrigidas:**
- **Validação de período** — passou a exigir as duas datas (`DRE_PERIODO_OBRIGATORIO`) e rejeitar início>fim (`DRE_PERIODO_INVALIDO`), fiel ao legado.
- **Roll-up F recursivo/topológico** — não depende mais de `nivel` (era latente p/ 3+ níveis); agora soma recursivamente as filhas (F-filha-de-F), cycle-safe + memoizado. Seed ganhou ramo de 3 níveis (04→04.001→04.001.001) e a fórmula de 3 termos `<01>+<03>+<04>` do golden; smoke §35 cobre (Lucro Bruto=100).
- Aprovado sem achado: injeção (nenhuma), multi-tenant, regressão (047 só cria; DIÁRIO/nf-contabilizacao intactos). Adiados confirmados (contas sem vínculo alerta/bloqueio; conta em >1 linha) → corte-2.

## 4. Riscos
Sinal só por natureza do lançamento (crédito+/débito−) — replicar exato; período por DATALAN (não CODPERIODO); config global vs agregação por empresa; expressão `E` só referencia raízes nível-1 (`<cod>`), erro→0; conta vinculada a >1 linha somaria em ambas (validar no editor, corte-2); escala (10.430 vínculos) — corte-1 semeia subset.
