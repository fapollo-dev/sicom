# Recon — Tesouraria: autenticar e fechar sangrias (lote + contagem de cédulas)

Data: 25/09/2026. Somente leitura.
- Produção Oracle: só SELECT, dentro de `SET TRANSACTION READ ONLY`, pelo `q.py` do scratchpad.
- Fonte Delphi: `/Library/SicomGit/retaguarda-master/fonte/Units` (mai/2020). PDV: `/Library/SicomGit/vendas/fonte`.
- População padrão: `HIST_SANGRIA_SUPRIMENTO.DATA >= 01/01/2026`, lojas 1, 2, 50, 51 e 52. Quando uso outra, digo qual.
- "Com descrição" = `DESCRICAO IS NOT NULL` (na prática, despesa paga no caixa: VT, dobra, diária, pintor…).

Regra de sempre: **fonte e dado vivo discordando, o dado decide**. Aqui o fonte nem tem a funcionalidade: tudo abaixo vem do dado.

---

## 0. Resumo

**O processo.** O PDV grava a sangria (`HIST_SANGRIA_SUPRIMENTO`, TIPO `SAN`). Depois, no retaguarda, há dois passos:
1. **Autenticar** — carimba a sangria: `AUTENTICADO='S'`, quem, quando e um **número próprio por sangria** (`LOTE_AUTENTICADO`).
2. **Fechar** — junta sangrias num **lote** (`LOTE_FECHADO`), carimba quem e quando, e grava **uma** linha em `CONTAGEM_CEDULAS` com o total do lote.

Não existe no fonte de 2020 (retaguarda nem PDV). Não existe em PL/SQL: `USER_SOURCE` tem 0 linhas com LOTE_FECHADO, LOTE_AUTENTICADO, CONTAGEM_CEDULAS ou HIST_SANGRIA. O único trigger das 3 tabelas é `AUDIT_MOV_CONTAS_BANCARIAS`, que não cita essas colunas. É do binário novo (Retaguarda 4.25.x/4.26.x).

**Números de 2026 (por DATA da sangria).**

| | Loja 1 | Loja 2 | Total |
|---|---:|---:|---:|
| Sangrias (SAN) | 4.714 | 4.319 | 9.033 |
| Suprimentos (SUP) | 1.128 | 0 | 1.128 |
| SAN autenticadas | 3.985 | 3.146 | 7.131 |
| SAN fechadas (em lote) | 583 | 1.218 | 1.801 |
| Lotes fechados em 2026 | — | — | 187 |
| Contagens em 2026 | 70 | 117 | 187 |

Lojas 50, 51 e 52 não têm sangria em 2026. A 51 teve 506 (2023-2025): 354 autenticadas, **0 fechadas**.

**Regras que o dado confirma:**

1. **Só sangria entra.** Suprimento (`SUP`) nunca é autenticado nem fechado: **2.763 de 2.763** em toda a história.
2. **Os campos andam juntos.** `AUTENTICADO='S'` ⇔ operador + data + lote de autenticação preenchidos. Idem para FECHADO. **0 estados parciais** em 71.577 linhas. Os únicos valores são `'S'` e NULL.
3. **`LOTE_AUTENTICADO` é um número por sangria, não um lote.** 51.241 linhas, **51.241 valores distintos**. Vem da sequência `ID_LOTE_AUTENTICADO_SANGRIA` (last_number 66.197 ≥ máx 66.177). Uma autenticação em bloco gera números consecutivos (ex.: 8 sangrias às 09:13:09 de 28/08 → 64437…64444).
4. **Lote = uma loja + um operador.** 0 lotes com mais de uma loja (toda a história). Em 2026: 187 de 187 lotes com um único operador e **um único dia** de sangria. 165 de 187 misturam PDVs. A sequência é `ID_LOTE_FECHADO_SANGRIA` (7.801 ≥ máx 7.788).
5. **Um lote, uma contagem.** Desde 27/07/2021, **512 de 512** lotes têm exatamente 1 linha em `CONTAGEM_CEDULAS`. Sem exceção.
6. **Ordem: autentica, fecha, conta.** Em 2026, autenticação ≤ fechamento em **1.789 de 1.789** linhas com os dois. A contagem entra **3 a 24 s** depois do fechamento (`CONTAGEM.DATA` − `DATA_FECHADO`).
7. **Exigir autenticação para fechar é configuração por loja.** `CONFIGURACOES` id 392 `FECHAMENTOSANGRIA_EXIGE_AUTENTICACAO`: global `N`; `CONFIGURACOES_ESPECIFICAS` Empresa 1 = `S`, Empresa 50 = `S`.
   - Loja 1: **0** sangrias fechadas sem autenticação desde 2022 (28.849 fechadas).
   - Loja 2 (config N): 12 em 2026, 1 em 2025, 259 em 2024.
8. **Contagem.VALOR = Σ VALOR das sangrias do lote** — na maioria. Em 2026: **154 de 187**. As 33 que não batem são **todas da operadora 3442** (23 exatamente 2×; 10 com outro fator). Ver §5.2.
9. **Cédulas: `Cx` são centavos, `Rx` são reais.** Confirmado: C1=0,01 · C5=0,05 · C10=0,10 · C50=0,50 · R1…R200 = face em reais. Desde 22/08/2025 **nenhuma** contagem tem cédulas (282 linhas, todas zeradas).
10. **Estorno existe.** A contagem estornada fica com `INDR='E'` (+ `INDR_USUARIO`, `INDR_DATA`) e as sangrias do lote voltam a ficar abertas. 3 casos (§7).
11. **Em 2026 o fechamento não gera movimento bancário.** Nenhuma linha em `MOV_CONTAS_BANCARIAS` nos minutos dos fechamentos de 25/09 e 23/09. `CODCONTAGEM_CEDULAS` só foi usado de **17/08/2021 a 07/02/2023** (2.613 linhas, §6).

---

## 1. Linha do tempo (quem fechava e como)

| Período (DATA_FECHADO) | Operador | Forma do lote | Contagem |
|---|---|---|---|
| 25/01/2021 – mar/2021 | 3 JFG | lotes grandes, data sem hora | não |
| mar/2021 – jul/2021 | 3 JFG | **1 sangria por lote** (abr: 585 lotes / 585 linhas) | não |
| 27/07/2021 – 21/08/2025 | 3 JFG (+1, 62, 21 às vezes) | **semanal**: 70+50+24 de 204 lotes cobrem 7-9 dias | sim, com cédulas |
| ago/2025 – 17/10/2025 | 21 LETICIA O. FREIRE (3 JFG até 21/08) | **diário por loja** | sim, cédulas até 21/08/2025 |
| 17/10/2025 – 17/06/2026 | ninguém | — | — |
| 17/06/2026 – hoje | 102 FLAVIA, 3442 DUDA BORGES | **diário por loja** | sim, sem cédulas |

Operadores de fechamento (toda a história): 3 = 35.700 sangrias/2.723 lotes · 21 = 1.230/91 · 102 = 1.315/135 · 3442 = 486/52 · 62 = 314/4 · 1 = 258/4.

**A pausa.** Último fechamento em 17/10/2025 18:55; o seguinte em 17/06/2026 09:02. As sangrias de 08/10/2025 a 12/06/2026 **nunca foram fechadas**:
- Loja 1: 4.878 SAN, R$ 2.258.393,30 (3.839 autenticadas).
- Loja 2: 4.094 SAN, R$ 1.410.053,25 (2.912 autenticadas).

A autenticação continuou na pausa (é por isso que nov/2025–mai/2026 têm AUTENTICADO e 0 LOTE_FECHADO).

---

## 2. Passo 1 — AUTENTICAR

**Quem e quando (2026).** São dois modos, um por loja:

| Loja | Quem autentica | Atraso p25 / p50 / p75 | Autenticador = RESPONSAVEL | Mesmo dia |
|---|---|---|---|---:|
| 1 | retaguarda: 59 LARISSA FREITAS (jan-mai, 2.111), 102 FLAVIA (abr+, 1.687), 3442 DUDA BORGES (ago+, 186) | 2,1 d / 3,9 d / 6,0 d | 51 de 3.985 | 23 |
| 2 | fiscais de caixa: 2661 LOURANA (902), 1602 NEUSA (847), 1561 GUSTAVO (839), 2542 VANDSON (295), 85 ANTONIO (165) | 5 min / 47 min / 6,2 h | **2.362 de 3.146** | 2.435 |

- Loja 2: o fiscal que autorizou a sangria no PDV (`RESPONSAVEL`) autentica logo depois. Ex.: 2661 = responsável em 824 de 902.
- Loja 1: a tesouraria autentica dias depois, quase sempre junto com o fechamento. Em set/2026, 3442 autentica e fecha na mesma sessão (5-20 s entre um e outro).
- `DATA_AUTENTICADO < DATA` em 164 linhas (145 em 2021), por segundos ou minutos. É relógio do PDV × relógio do servidor, não regra.
- Autenticar **não** cria movimento: cada sangria tem 1 só mov em `MOV_CONTAS_BANCARIAS` (o do PDV, ligado por `IDENTIFICADOR_MOVCB = MOV.IDENTIFICADOR`), com data da própria sangria. Conferido nos 18 itens dos lotes 7584/7585 e no padrão de todas as sangrias de 2026.

**O que é autenticado.** Em 2026, sangria sem descrição quase sempre; com descrição (despesa), pouco:
- Loja 2: com descrição (fora as manuais), 16 de 1.166 autenticadas.
- Loja 1: com descrição (fora as manuais), 751 de 1.187 — quase todas por 59 LARISSA em jan-mai. Nos dias fechados desde jun/2026, 74 de 76 despesas ficaram sem autenticação.

**Operadores (OPERADORES).** Nenhum tem TIPOOP de tesouraria: 102 e 3442 têm TIPOOP NULL. 3442 tem uma conta corrente com o nome dela (`CONTAS_BANCARIAS` 681 DUDA BORGES), que recebe sangrias (conta do fiscal, config 81).

---

## 3. Passo 2 — FECHAR (o lote)

**Composição (lotes fechados em 2026, 187):**

| Critério | Resultado |
|---|---|
| Mesma loja | 187 de 187 (toda a história: 3.009 de 3.009) |
| Mesmo operador de fechamento | 187 de 187 |
| Mesmo dia de sangria | 187 de 187 |
| Mesmo PDV | 22 de 187 (165 misturam) |
| Mesmo DATA_FECHADO | 184 de 187 (3 com 2 carimbos a 1 ms: 7274, 7283, 7284 — mesma operação) |
| Dia dividido em 2+ lotes | loja 1: 10 de 60 dias; loja 2: 17 de 99 dias |

**Quais sangrias do dia entram (dias fechados desde jun/2026):**

| Loja | Tipo de sangria | Autenticada | No lote | Aberta |
|---|---|---|---:|---:|
| 1 | sem descrição | S | 564 | 0 |
| 1 | sem descrição | — | 0 | 3 |
| 1 | despesa (com descrição) | — / S | 2 | 74 |
| 1 | "moedas"/"troco" | S | 4 | 0 |
| 1 | manual/correção ("SANGRIA MANUAL…", "CORREÇÃO SANGRIA…") | S | 13 | 0 |
| 2 | sem descrição | S | 1.200 | 2 |
| 2 | sem descrição | — | 9 | 0 |
| 2 | despesa (com descrição) | — | 2 | 430 |
| 2 | "moedas"/"troco" | S | 3 | 0 |
| 2 | manual/correção | S / — | 4 | 2 |

Leitura: **na prática** o lote leva o dinheiro que vai para a tesouraria e deixa a despesa de fora.

- Antes era diferente: em 2024, loja 1, 70,1% das despesas (PGTO RICK, DOBRA, VT…) entravam no lote semanal.
- Se a tela filtra a despesa ou o operador a desmarca, **não está determinado** (§11).

**Carimbos.** `CODOPERADOR_FECHADO` = quem fecha; `DATA_FECHADO` = agora (com ms); `LOTE_FECHADO` = número novo da sequência.

**Buracos na sequência.** Em 2026: 187 lotes em 7221…7788. Numa sessão contínua (28/08, 09:33-10:00) faltam 7583 e 7592, e as contagens dessa sessão são consecutivas (4381…4395). Leitura: o número é tirado antes da contagem; fechamento cancelado perde o número. Não há contagem órfã em 2026.

---

## 4. CONTAGEM_CEDULAS — colunas e fórmula

515 linhas, de 27/07/2021 a 25/09/2026. Sequência `ID_CODCONTAGEM_CEDULAS` (4.601 ≥ máx 4.588).

- `DATA = DTCADASTRO` em 515 de 515.
- `IDEMPRESA` = loja do lote em 100%.
- `CODOPERADOR` = operador do fechamento em 512 de 512 (as 3 que não batem são as estornadas, sem sangria).

**Fórmula das cédulas** (provada por linhas que fecham com VALOR):

`Σ = C1×0,01 + C5×0,05 + C10×0,10 + C25×0,25 + C50×0,50 + R1×1 + R2×2 + R5×5 + R10×10 + R20×20 + R50×50 + R100×100 + R200×200`

| Prova | Linha |
|---|---|
| C1=0,01, C10=0,10, C50=0,50 | 1: notas 75.760 + (2×0,01 + 2×0,10 + 1×0,50) = 75.760,72 = VALOR |
| C5=0,05 | 21: 32.556 + (0,01 + 0,05 + 0,50) = 32.556,56 = VALOR |
| R* em reais | 3902: 2×2 + 1×10 + 1×20 + 81×100 = 8.134 = VALOR |
| C25=0,25 | **não provado** por linha que feche (só por analogia do nome) |

Quem manda é o VALOR, não as cédulas:
- 233 contagens têm cédulas (a última em 21/08/2025): **40** fecham com VALOR, **188** ficam abaixo (contam só os maços de 100), 5 ficam acima.
- 282 contagens (desde 22/08/2025) têm todas as cédulas = 0. Todas as de 2026.

---

## 5. CONTAGEM.VALOR × Σ das sangrias do lote

### 5.1 Quadro

| Período | Contagens | Sem sangria | = Σ | = 2×Σ | Outro |
|---|---:|---:|---:|---:|---:|
| < 2025 | 205 | 2 | 193 | 0 | 10 |
| 2025 | 123 | 1 | 106 | 1 | 15 |
| 2026 | 187 | 0 | 154 | 23 | 10 |

- < 2025: as 10 diferenças são pequenas (+1,25 a +1.590) e todas da operadora 3.
- 2025: 14 das 15 são de 21 LETICIA em out/2025 (fatores 1,16 a 2,23), no fechamento atrasado de set/2025.

### 5.2 O "2×" de 2026

Todas as 33 divergências são de **3442 DUDA BORGES**. A 102 FLAVIA nunca diverge (135 de 135).

| Operadora 3442 | Iguais | 2× exato | Outro fator |
|---|---:|---:|---:|
| Loja 1, 28/08 | 0 | 4 | 2 |
| Loja 1, set/2026 | 15 | 0 | 0 |
| Loja 2, ago-set/2026 | 4 | 19 | 8 |

**Não é versão do binário.** 102 e 3442 usam o mesmo executável, na mesma máquina (`OPERADORES_ACESSOS`: `Retaguarda.exe` 4.26.8.4 em ago e 4.26.9.1 em set, `SRV-SICOM`).

**Cada sangria entra k vezes.** Nos casos "outro fator", o VALOR é soma de sangrias com multiplicidade 1, 2 ou 3:

| Lote | Sangrias | Σ | VALOR | Decomposição exata |
|---|---:|---:|---:|---|
| 7582 | 2 | 1.036,00 | 1.572,00 | 500×**1** + 536×**2** |
| 7585 | 10 | 5.868,85 | 11.037,70 | 700 (98907)×**1** + demais 5.168,85×**2** |
| 7584 | 8 | 6.078,00 | 12.956,00 | 800 (98945)×**3** + demais 5.278×**2** |

- As sangrias têm 1 só mov e 0 linhas em `CAIXA.CODHISTSANGRIA`: a duplicação não vem de join com essas tabelas.
- O padrão parece de tela que soma a cada clique/leitura. A causa **não está determinada** (§11).
- Consequência: **o VALOR gravado é um retrato do que a tela mostrou**, não um valor recalculável. Na carga, copiar como está.

---

## 6. MOV_CONTAS_BANCARIAS.CODCONTAGEM_CEDULAS (só 2021-2023)

**Colunas da tabela (37):** CODMOVCONTA, CODCONTA, VALOR, DTEMISSAO, DTVENC, NRODOCUMENTO, LIBERADO, TIPOMOVIMENTO, HISTORICO, IDLOTE, CODOPCONTA, TIPO, IDPGTO, CODADIANTAMENTO, DTLIBERACAO, CODDESTINO, CONTABILIZADO, CHAVE, BKPIDPGTO, BKPIDPGTO2, IDENTIFICADOR, NROPDV_FECHAMENTO, CODOPERADOR, IDEMPRESA_FECHAMENTO, DATA_FECHAMENTO, DTPGTOBX, ORIGEM, IDORIGEM, IDLOTE_REVERSAO, REVERTIDO, MOV_CONCILIADO, CODCONTAGEM_CEDULAS, USUCAD_LANCAMENTO_SALDO, LANCAMENTO_SALDO, CODCONTA_DESTINO, RECURSO, CLAO_ID.

**O nome engana: a coluna guarda o LOTE_FECHADO, não o código da contagem.**
- 71 de 71 valores batem com `CONTAGEM_CEDULAS.LOTE_FECHADO` e com `HIST_SANGRIA_SUPRIMENTO.LOTE_FECHADO`.
- Só 50 batem por acaso com um CODCONTAGEM_CEDULAS. Ex.: o valor 4421 existe como contagem de 02/09/2026 — impossível para um mov de 2021-2023.
- As datas conferem: os movs de cada lote caem entre o fechamento anterior e o atual. `DTLIBERACAO ≤ CONTAGEM.DATA` em 2.613 de 2.613.

**O que são as 2.613 linhas (17/08/2021 – 07/02/2023):**

| Coluna | Valor |
|---|---|
| CODCONTA | **161** em 100% — "CONTA DE PAGAMENTOS INTERNOS - MARTINS", obs "CONTA PARA PAGAMENTO EM DINHEIRO"; é `EMPRESAS.CODCONTA_PAGAMENTO` da loja 1 |
| TIPOMOVIMENTO | `D` em 100%; VALOR negativo; Σ = −R$ 565.347,82 |
| LIBERADO | `S` em 100% |
| CODOPCONTA / IDPGTO | 0 / 1 em 100% |
| TIPO, ORIGEM, IDORIGEM, IDENTIFICADOR, CHAVE, NROPDV_FECHAMENTO, CODCONTA_DESTINO, RECURSO | vazios em 100% |
| IDLOTE | 2.313 (lote da baixa/lançamento, não o da tesouraria) |
| CODOPERADOR | 300 linhas (294 são os adiantamentos; 85 ANTONIO nos exemplos) |
| DTVENC | 429 linhas: 294 adiantamentos, 118 baixas de AP, 17 outras |
| CONTABILIZADO | `S` em 2.601 |

**HISTORICO (padrões):** despesas diversas 1.969 ("50,00 REF ABASTECIMENTO CARRO ENTREGA", "9,00 REF VT …", "DOBRA …"); "ADIANT P/ …" 294 (com CODADIANTAMENTO); "VT …" 191; baixa de AP 118 ("… REFERENTE A BAIXA DO LOTE: n - Baixa das contas a pagar realizada pelo(a) usuário(a) ANTONIO."); "REFERENTE A …" 41.

**Leitura.** O fechamento daquela época **marcava as despesas pagas em dinheiro pela conta 161** com o número do lote:
- 1 lote : N movs (6 a 88 por lote); 71 das 78 contagens do período têm mov.
- Cobre 2.613 dos 2.870 débitos da conta 161 no período (91%).
- **Não entra no VALOR.** Ex.: lote 2849 → contagem 83 = R$ 83.522,90 = Σ das 182 sangrias. Os 63 movs (−R$ 9.582,10) ficaram fora.
- Não gera contrapartida: 1 linha por despesa, nenhuma de crédito.

**Morreu em fev/2023.** A conta 161 não tem nenhum débito depois de 2023. Nenhum mov com CODCONTAGEM_CEDULAS depois de 07/02/2023. Em 2026 a despesa é paga no PDV, como sangria com descrição.

---

## 7. Estorno, reabertura e consistência

**Estorno do fechamento (provado, 3 casos):**

| Contagem | Data | Operador | Lote | VALOR | Marca |
|---|---|---|---|---:|---|
| 81 | 20/08/2021 14:38 | 1 ADMIN | 2843 | 554,00 | `INDR='E'` 20 s depois |
| 82 | 20/08/2021 14:39 | 1 ADMIN | 2844 | 554,00 | `INDR='E'` 35 s depois |
| 3281 | 04/02/2025 10:51 | 701 FERNANDO | 6341 | 9,00 | `INDR='E'` 64 s depois |

- Os 3 lotes não têm mais nenhuma sangria. A contagem fica (soft delete) e ganha `USULTALTERACAO`/`DTULTIMALTERACAO` no mesmo instante.
- As sangrias voltam a abertas e podem ir para outro lote. Provável caso: o lote 6341 (R$ 9,00, 04/02/2025) foi estornado, e as sangrias de R$ 9,00 de 29/01 a 04/02 estão no lote 6363, fechado em 05/02. Qual delas estava no 6341 não dá para saber.
- `INDR` é o marcador genérico do legado (em OPERADORES: 'I' 236, 'E' 8, NULL 48).

**Outras edições.** Contagens 181 e 861 têm `USULTALTERACAO` 2-3 min depois de criadas. O que mudou não é visível.

**Desautenticar.** Nenhuma evidência: 0 resíduo de autenticação sem `AUTENTICADO`. Sem LOG, não dá para provar que nunca acontece.

**LOG.** A tabela `LOG` não tem nada destas tabelas. `LOG_SISTEMA` não registra a tela nos horários dos fechamentos (25/09 10:20-10:50). O menu (`CONFIGURACAO_MENU`) não tem entrada com SANGRIA/CEDULA/TESOUR.

**Autenticado depois de fechado.** 71 casos, todos antigos: 70 em 2024 (loja 1, autenticadora 504, mediana 35 min depois) e 1 em 2023. Em 2026, 0.

---

## 8. Configurações ligadas

| Id | Código | Global | Específica | Efeito visto no dado |
|---|---|---|---|---|
| 392 | `FECHAMENTOSANGRIA_EXIGE_AUTENTICACAO` | N | Empresa 1 = S; Empresa 50 = S (permite Empresa;Usuario) | loja 1 nunca fecha sem autenticar (desde 2022) |
| 81 | `ENVIA_SANGRIA_SUPRIMENTO_CONTA_FISCAL` | N | Módulo Retaguarda = S | a sangria cai na conta corrente do fiscal (ex.: 681 DUDA BORGES) |
| 283 | `USUARIOS_PERMITIDOS_ALTERAR_SUP_SAN_FECHAMENTO` | S | 15 usuários, entre eles 102 e 3442 | inserir/excluir sangria no fechamento de caixa (existe no fonte de 2020, `UConsDocs.pas:1656/2027/2494`) |

Nenhuma configuração com CEDULA, TESOUR, COFRE ou AUTENTIC além destas. `CONFIGURA` não tem nada. As tabelas de configuração não têm data, então não explicam a pausa.

---

## 9. Outras tabelas

| Tabela | Situação |
|---|---|
| `BKP_HIST_SANGRIA_SUPRIMENTO` | 30 sangrias de 28/01/2025 (lojas 1 e 2), sem autenticação e sem fechamento, **que não existem mais** na tabela principal. É cópia manual antes de apagar, não parte do processo |
| `HIST_SANGRIA`, `TESOURARIA` | 0 linhas (a `TESOURARIA` é da tela antiga `Utesouraria.pas`) |
| `REPOSICAO.LOTE_FECHADO` | outro assunto (reposição de produto); 1 linha, lote NULL |
| `EMPRESAS.CONTACOFRE`, `CCTESOURARIA` | NULL nas 5 lojas |
| `CAIXA.CODHISTSANGRIA` | 0 linhas desde jun/2025 |

---

## 10. Coluna a coluna

### 10.1 HIST_SANGRIA_SUPRIMENTO — as 8 colunas do processo

| Coluna | Gravada por | Conteúdo | Prova |
|---|---|---|---|
| AUTENTICADO | Autenticar | `'S'` ou NULL | 0 outros valores |
| CODOPERADOR_AUTENTICADO | Autenticar | operador logado (loja 2: em 75% o próprio RESPONSAVEL) | §2 |
| DATA_AUTENTICADO | Autenticar | agora, com ms (relógio do servidor) | 164 < DATA por relógio |
| LOTE_AUTENTICADO | Autenticar | `ID_LOTE_AUTENTICADO_SANGRIA.NEXTVAL` **por sangria** | 51.241 = 51.241 distintos |
| FECHADO | Fechar | `'S'` ou NULL | idem |
| CODOPERADOR_FECHADO | Fechar | operador logado; único por lote | 187/187 |
| DATA_FECHADO | Fechar | agora, com ms; único por lote (±1 ms) | 184/187 |
| LOTE_FECHADO | Fechar | `ID_LOTE_FECHADO_SANGRIA.NEXTVAL` por lote | 1 loja por lote em 3.009/3.009 |

No estorno, as 4 colunas de fechamento voltam a NULL (§7).

### 10.2 CONTAGEM_CEDULAS — uma linha por fechamento

| Coluna | Conteúdo |
|---|---|
| CODCONTAGEM_CEDULAS | `ID_CODCONTAGEM_CEDULAS.NEXTVAL` |
| IDEMPRESA | loja do lote |
| DATA | agora (3-24 s após DATA_FECHADO); = DTCADASTRO |
| VALOR | total mostrado na tela; = Σ do lote em 154/187 (2026). **Copiar, não recalcular** |
| CODOPERADOR | operador do fechamento |
| LOTE_FECHADO | o lote (1:1 desde 27/07/2021) |
| C1, C5, C10, C25, C50 | quantidade de moedas (0,01 … 0,50); 0 desde 22/08/2025 |
| R1 … R200 | quantidade de notas (R$ 1 … R$ 200); 0 desde 22/08/2025 |
| DTCADASTRO | = DATA |
| USULTALTERACAO, DTULTIMALTERACAO | só em edição/estorno (5 linhas) |
| INDR, INDR_USUARIO, INDR_DATA | `'E'` = estornada (3 linhas); NULL no resto |

### 10.3 MOV_CONTAS_BANCARIAS — o que o fechamento gerava

- **2026:** nada.
- **2021-08 a 2023-02:** nenhuma linha nova. Só um UPDATE nos débitos já existentes da conta 161: `CODCONTAGEM_CEDULAS := LOTE_FECHADO` (§6).

---

## 11. Exemplos reais

**A. Lote 7781 — loja 1, dia 21/09/2026 (autentica e fecha junto; VALOR = Σ).**
- 3442 autentica 11 sangrias em 25/09 10:33:50 (LOTE_AUTENTICADO 66097…66107).
- Fecha às 10:34:06.160 (lote 7781).
- Contagem 4581 às 10:34:15: VALOR 5.790,95 = Σ das 11 (30 + 800,95 + 796 + 483,45 + 500 + 1.121,55 + 144,80 + 600 + 571,20 + 733 + 10).
- Ficaram abertas as 3 despesas do dia: BALANCA 280, TORNO 100, HOSP CANCER 200 (Σ 580).
- A de R$ 10 (101371) é "SANGRIA MANUAL - FISCAL LUCIANA", lançada por 3423 com DATA 00:00.

**B. Lote 7788 — loja 2, dia 22/09/2026 (fiscais autenticam no dia; VALOR = 2×).**
- 9 sangrias autenticadas em 22/09 por 1602 NEUSA (15:50) e 1561 GUSTAVO (19:48-20:40).
- 2 sem autenticação: 101394 R$ 104 e 101396 R$ 579 (a loja 2 tem config 392 = N).
- Fechadas por 3442 em 25/09 10:47:41. Σ = 3.882,00.
- Contagem 4588 às 10:47:51: VALOR **7.764,00 = 2 × 3.882**.
- Abertas no dia: MADEIRA 160 e DOBRA LILIA 80.

**C. Lote 2849 — loja 1, 17 a 23/08/2021 (semanal, com despesas marcadas).**
- 182 sangrias. Fechado por 3 JFG em 24/08/2021 10:50:38.
- Contagem 83 às 10:51:20: VALOR 83.522,90 = Σ. As cédulas foram preenchidas.
- 63 débitos da conta 161 (VT, adiantamentos, rescisões, abastecimento; −9.582,10) receberam `CODCONTAGEM_CEDULAS = 2849`.

---

## 12. O fonte de 2020

**O que já existe em 2020:**
- `HIST_SANGRIA_SUPRIMENTO` com as 15 colunas base (até TIPO, IDENTIFICADOR, IDENTIFICADOR_MOVCB, CODOPERADOR_CADASTRO).
- Leitura e inserção no fechamento de caixa: `UfinalizaFechamento.pas:1468-1516` (totais por tipo×destino) e `:1838-1874` (INSERT, DESCRICAO "Inserido automaticamente pelo fechamento de caixa").
- Consulta de documentos: `UConsDocs.pas:1771`, `:2040-2065` (inserir/excluir sangria; config 81 e 283).
- Relatório de sangrias: `uVendas.pas:5604-5690`.
- Cheque × sangria por IDENTIFICADOR: `UManipulaFin.pas:506`, `UConsDocs.dfm:561`.
- PDV: `vendas/fonte/VO/VO.HistSangriaSuprimento.pas` grava as colunas base com RESPONSAVEL (o fiscal).
- A tela antiga `Utesouraria.pas` (tabela TESOURARIA, hoje vazia).

**O que é novo (não aparece em nenhum arquivo do fonte, nem do PDV):** as 8 colunas de autenticação/fechamento, `CONTAGEM_CEDULAS`, `MOV_CONTAS_BANCARIAS.CODCONTAGEM_CEDULAS`, as sequências `ID_LOTE_AUTENTICADO_SANGRIA`, `ID_LOTE_FECHADO_SANGRIA` e `ID_CODCONTAGEM_CEDULAS`, e a config 392. O dado mostra fechamento desde 25/01/2021, autenticação desde 18/03/2021 e contagem desde 27/07/2021.

---

## 13. O que o Apollo já tem

| Item | Apollo |
|---|---|
| Colunas de fechamento/autenticação em `hist_sangria_suprimento` | sim: mig 142 (`fechado`, `autenticado`) + mig 322 (as 6 de operador/data/lote + identificador, identificador_movcb, codoperador_cadastro) |
| Tabela `contagem_cedulas` | sim: mig 311 (25 colunas, PK) |
| `mov_contas_bancarias.codcontagem_cedulas` | sim: mig 310 |
| Carga | ambas no plano (`plano-tabelas.json`: 71.539 e 507 linhas na última medição) |
| Sequências de lote/autenticação/contagem | **não** (só `seq_hist_sangria`) |
| Serviço que lê/grava autenticação, lote ou contagem | **nenhum**. `fechamento-caixa.service.ts` só usa as colunas base; `conciliacao-bancaria.service.ts` preserva a coluna na lista |
| Tela | **nenhuma** |

---

## 14. NÃO determinado

1. **Por que a 3442 grava VALOR 2× (ou k×).** Mesmo binário e mesma máquina da 102. Hipótese: a tela soma a cada clique ou leitura. Só se resolve vendo a tela. Aconteceu também com 21 em out/2025 (14 lotes).
2. **Se a tela exclui a despesa (sangria com descrição) ou se é o operador.** Em 2026 fica fora 504 de 508 vezes; em 2024 entrava 70%.
3. **Por que parou de fechar de 17/10/2025 a 17/06/2026.** Nenhuma configuração com data explica.
4. **Nome da tela e do menu** do binário novo. Não aparece em LOG, LOG_SISTEMA nem CONFIGURACAO_MENU.
5. **Se existe desautenticar.** Nenhuma evidência a favor; sem LOG, nenhuma prova contra.
6. **Para que servia marcar as despesas da conta 161 (2021-2023).** Não entrava no VALOR. Talvez exibição de saldo líquido.
7. **O que mudou nas contagens 181 e 861** (editadas minutos depois).
8. **C25 = 0,25** não tem linha que prove. Só o nome.
9. **Por que a loja 51 autenticou 354 e nunca fechou.**
10. **Por que 30 sangrias de 28/01/2025 foram apagadas** (restam no BKP).

---

## 15. Cortes de conversão propostos (menor risco primeiro)

| Corte | Escopo | Regras | Risco |
|---|---|---|---|
| ✅ **C0 — dado** | conferir a carga: 8 colunas + `contagem_cedulas` (inclui `INDR='E'`) + `codcontagem_cedulas`; criar as 3 sequências com `setval(máx+1)` | copiar VALOR como está; não recalcular | nulo |
| ✅ **C1 — consulta** | tela somente leitura "Tesouraria — sangrias": por loja e dia, status aberta/autenticada/fechada, lote, contagem, divergência VALOR × Σ | filtro só `TIPO='SAN'`; lote = 1 loja; contagem com `INDR='E'` fora | baixo |
| ✅ **C2 — autenticar** | marcar sangrias: `AUTENTICADO='S'`, operador, agora, 1 número de sequência **por sangria** | SUP nunca; sem movimento bancário; sem desfazer (não provado) | baixo |
| ✅ **C3 — fechar + contagem** | gerar lote de uma loja com as sangrias escolhidas; gravar 1 `CONTAGEM_CEDULAS` (VALOR = Σ das sangrias distintas; cédulas opcionais, 0 por padrão) | config 392 por Empresa/Usuário (exige autenticação); lote de 1 loja e 1 operador; sem MOV | médio |
| ✅ **C4 — estorno** | desfazer um lote: `INDR='E'` + usuário/data na contagem; zerar as 4 colunas de fechamento das sangrias | 3 casos provados | médio |
| **C5 — marcar despesas da conta de pagamento** | só se o usuário mandar: regra morta desde 07/02/2023 | levar ao usuário antes (regra viva não se desliga em silêncio; esta está parada há 3 anos e meio) | — |

**Divergência consciente a registrar no C3:** o Apollo grava VALOR = Σ das sangrias distintas. O legado da 3442 grava 2×/k× (33 lotes em 2026). Levar ao usuário antes de fechar o corte.

---

## Estado da conversão (25/09/2026)

C0-C4 ✅: mig 362 (as 3 sequências continuando do maior valor carregado, a config 392 com as específicas da produção e as permissões
do legado — FRMFECHAMENTOSANGRIA/BTNPROCESSO), `cobranca/fechamento-sangria.service.ts` + controller (GET período, POST autenticar,
POST fechar com as cédulas opcionais, POST lotes/:codcontagem/estornar), web `FechamentoSangriaPage` (a despesa vem desmarcada) e
smoke §258.1-3. O VALOR da contagem é a Σ das sangrias distintas — a divergência consciente com os 33 lotes de 2026 em que a tela da
operadora 3442 somou cada sangria 2 ou 3 vezes. C5 (marcar as despesas da conta de pagamento) segue parado, como no legado desde 2023.
