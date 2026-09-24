<!-- Recon de 24/09/2026 (produção somente leitura + fonte de mai/2020). Base para os cortes A-F do agrupamento. -->

# Agrupamento de Contas a Receber e a Pagar: especificação com prova de produção

## ✅ ENTREGUE (24/09/2026) — cortes A, B (parte) e C, mig 331

- **Modelo do legado** (G1-G3): consolidado AGRUPAMENTO='S' com ORIGEM nula e CODGRUPO novo (a sequência compartilhada);
  membros AGRUPADO='S' com CODGRUPO_AGRUPAMENTO_RCB/APG = o CODGRUPO do consolidado. O dado migrado é reconhecido como está;
  o consolidado criado no Apollo sai da integração do contas a receber/pagar (o duplo contábil acabou); as travas do
  `areceber`/`apagar.service` deixaram de olhar ORIGEM 'A' (que no legado é o acordo comercial).
- **Agrupar como a produção usa** (G4-G7, G16): clientes/fornecedores diversos com o parceiro informado; mínimo 1 título;
  sem as travas de contabilizado/NF; o consolidado AR com os campos do legado (duplicata " - 001/001", forma/banco/cobrador/
  vendedor do último título, juros da empresa, CONSILIADO e CADASTRADO_MANUALMENTE 'S'), o juro das linhas marcadas, o
  desconto e a taxa administrativa; o AP com OBS "Referente Agrupamento" + notas/códigos, BOLETO, juros `TX_JURO_APAGAR`,
  **parcelas** (reparcelamento) e centro de custo opcional (rateio + a CAIXA do grupo, que pela regra medida fecha em zero);
  **adicionar título** no AR; remover sem a trava do último; reverter pelo grupo (todas as parcelas, histórico de exclusão);
  RBAC com os nomes do legado (FRMAGRUPACONTASARECEBER/APAGAR, o menu do contas a receber, FRMAPAGAR.BTNREVERTERAGRUPAMENTO).
- **Cascata da baixa AR** (G13): pagar o consolidado quita os membros; estornar reabre. O AP não tem cascata (0 de 186).
- **TRON convênio** (G15): o valor é Σ do A Pagar; o débito fica com o primeiro recebível e documento vazio, como no razão.
- Integridade mantida (o legado não verificava): baixa ativa e lote de cobrança bloqueiam o reverter; consolidado pago não
  recebe nem perde título.
- **Falta**: os relatórios (corte F). (A tela web saiu depois; ver abaixo.)

## ✅ ENTREGUE (24/09/2026) — corte E: o convênio do mesmo CNPJ

- **Desvio no `POST cadastro/areceber/agrupar`** quando o CNPJ do parceiro (primeiro endereço) é o da empresa logada.
  - A chave do XML da estação ('AGRUPAR BAIXA RECEBER - ATIVA CONVENIO') não existe no banco; aqui vale só o CNPJ.
  - Sem os dados do convênio: 422 `AGRUPAMENTO_CONVENIO_MESMO_CNPJ` com a sugestão (centro de custo da empresa, forma do último título, data, obs padrão), para a tela perguntar.
  - Com eles, na mesma transação:
    - a CAIXA ORIGEM 'CONVENIO PARCEIRO' de −total no centro de custo de DESPESA (`tpconta` 1; `CODPLCFECHAMENTOCONVENIO` quando houver);
    - o A PAGAR já QUITADO para a empresa, com CODCXAGRUPAMENTOCR, AGRUPAMENTO 'S' e grupo novo (todos os campos do §2.3);
    - os membros AGRUPADO e QUITADA 'S' no grupo do A Pagar;
    - com a integração automática, o contábil 65 na hora, num savepoint; a falha não desfaz, como o `except end`.
  - `DocumentosContabilService` ganhou `integrarConvenioNaTrx`/`estornarConvenioNaTrx` por grupo.
- **Reversão pelo A Pagar** (`POST cadastro/apagar/:id/reverter-agrupamento`, o CODCXAGRUPAMENTOCR identifica):
  - Contabilizado, só com integração automática, que estorna o razão do grupo (origem 65, complemento). Senão: "Não é permitido reverter este agrupamento pois já foi contabilizado.".
  - Solta os títulos, apaga a CAIXA e o A Pagar.
  - ⚠️ **Inferido:** a reversão devolve QUITADA 'N' aos membros sem baixa. O fonte de 2020 não mexe, mas também não quitava; a auditoria da produção não guarda AGRUPADO, e não há reversão medível.
- **Smoke §188:** 1525/0.

## ✅ ENTREGUE (24/09/2026) — as telas web de agrupar (`/cobranca/agrupar-receber` e `/cobranca/agrupar-pagar`)

- **Busca** (`GET cadastro/areceber|apagar?paraAgrupar=S`): a regra do GET_RCB / GET_APAGAR_AGRUPAR. Aberto e não agrupado; no A Receber, com o fechamento de caixa da empresa, só o conciliado. Filtros: cliente/fornecedor, vencimento e, no A Receber, venda.
- **Seleção:** marcar um a um ou todos (tecla T). No A Receber, a coluna "Calc. juros" (o juro do dia entra no total).
- **Total do legado** (`SetaTotal`): Σ valor + Σ juro marcado − desconto.
- **Parceiro:** obrigatório com clientes/fornecedores diversos, com as mensagens do legado.
- **A Receber:** forma, data do lançamento, vencimento, desconto, taxa administrativa e obs.
  - O convênio do mesmo CNPJ abre o painel "Convênio parceiro": centro de custo de despesa, forma, vencimento da conta a pagar e obs, com a sugestão do servidor. Gravar: "A conta à pagar nº X foi gerada com sucesso.".
- **A Pagar:** vencimento, obs, centro de custo opcional e N parcelas (valor igual, mensais, o resto na última).
- **Consultar agrupamento** pelo código do consolidado: os títulos, "Reverter agrupamento" ("Deseja realmente reverter o agrupamento?") e, no A Receber, remover título (a confirmação do legado) e incluir os marcados da busca.
- **Falta:** os relatórios (corte F: Agrupamento*.fr3, AgrupamentoCP*.fr3).
- **Smoke §189** (a busca): 1526/0.

**Fontes lidas:** `uAgrupaContasAReceber.pas`, `uAddTituloAgrupamentoAReceber.pas`, `uCadAReceber.pas` (os trechos de agrupamento: 400-1240, 2620-2880, 2985-3200, 3480-4248), `udmCadAReceber.pas/.dfm`, `uAgrupaContasAPagar.pas`, `uAPagar.pas` (reverter, impressão, `AgrupaAPagar`), `udmAPagar.dfm`, `uConvenioParceiro.pas`, `UIntegracaoContabil.pas` (3035-3320 e o filtro do CR), `UBaixaAreceber.pas`, `UReversaoBaixaContasReceber.pas`, `udmConfigura.pas` e `uDescontoTitulo.pas`.

**Oracle de produção:** só SELECT, dentro de `SET TRANSACTION READ ONLY`.

**Sistema novo:** apenas lido; nada foi alterado em /Library/Apollo.

**Scratch perdido:** a pasta `agr/` foi apagada no restart da sessão. Os números abaixo vêm das execuções; o SQL principal está no fim.

**Ressalva sobre a fonte:** o fonte é de mai/2020 e a produção roda um binário mais novo. Onde os dois divergem, digo e fico com o dado.

---

## 0. Os 8 achados que mudam o plano

1. **O vínculo é pelo CODGRUPO, não pelo CODRCB/CODAPG.**
   - O membro guarda `CODGRUPO_AGRUPAMENTO_RCB` (ou `_APG`) igual ao **CODGRUPO do consolidado** (`GetID('CODGRUPO')`, a sequência de grupos compartilhada).
   - Cobertura AR: 45.966 membros em 194 grupos, todos resolvem para um consolidado com AGRUPAMENTO='S' (100%).
   - Cobertura AP: 721 membros em 257 grupos; 256 resolvem para AGRUPAMENTO='S'.
   - **Colisão numérica:** em 35.619 dos 46.129 vínculos AR (77%) o número do grupo também é o CODRCB de algum outro título. No AP são 88 de 257 grupos (34%).
   - Portanto ler o dado migrado com a regra nova (`codgrupo_agrupamento_rcb = codrcb do consolidado`) **liga membros a títulos errados, sem erro nenhum**.
2. **O consolidado é marcado por `AGRUPAMENTO='S'`, com ORIGEM NULL.**
   - AR: ORIGEM NULL em 194/194. AP: ORIGEM NULL em 100% dos consolidados.
   - **ORIGEM='A' já existe no legado e é "Acordo comercial":** 6 títulos AR de 2020-2022 (OBS "Originado do lançamento do acordo comercial de Verba").
   - O novo sistema usa ORIGEM='A' como marca do consolidado. Por isso os 6 acordos migrados seriam tratados como consolidados (valor travado, exclusão recusada).
   - No AP, qualquer ORIGEM não nula liga `origemAutomatica`, que trava 7 campos no consolidado; o legado trava só o VALOR.
3. **Hoje o TRON do novo sistema contabilizaria em dobro os consolidados criados pelo novo sistema.**
   - O legado exclui `AGRUPAMENTO='S'` da integração do CR e do CP (`UIntegracaoContabil` CR: `AND (A.AGRUPAMENTO IS NULL OR A.AGRUPAMENTO='N')`).
   - O TRON novo filtra igual (`documentos-contabil.service.ts:121` e `:209`, `coalesce(agrupamento,'N')='N'`).
   - Mas `areceber-agrupamento.service` e `apagar-agrupamento.service` **não gravam `agrupamento='S'`**, só `origem='A'`. Resultado: o consolidado entra no CR/CP, e os membros já foram contabilizados.
   - Prova do legado: consolidado AR com CONTABILIZADO NULL em 194/194; consolidado AP com CONTABILIZADO=0 em 2024-2026.
4. **O uso principal é o fechamento de convênio com vários clientes; o novo sistema recusa.**
   - AR 2026: 16 de 24 grupos têm clientes diversos (histórico: 131/194 = 67,5%).
   - AP 2026: 33 de 78 grupos têm fornecedores diversos (42%); 2025: 27/86.
   - O legado pede o parceiro do título. O novo lança `AGRUPAMENTO_PARCEIROS_DIVERSOS`.
5. **Pagar o consolidado AR quita os membros; o AP não faz isso.**
   - AR: `UBaixaAreceber.AtualizaAgrupamento` executa `UPDATE ARECEBER SET QUITADA='S' WHERE AGRUPADO='S' AND CODGRUPO_AGRUPAMENTO_RCB = <CODGRUPO>`, sem ARECEBER_BX para os membros. A reversão da baixa volta para 'N'.
   - Prova AR 2026: os 7 consolidados quitados têm 100% dos membros quitados; os 17 abertos têm 0%.
   - Auditoria AR: 152 membros passam de N para S no **mesmo segundo** da baixa do consolidado (07/04/2026 14:52:14).
   - Prova AP: dos 186 consolidados quitados em 2025-26, nenhum tem membro quitado.
   - O `areceber-baixa.service` novo não faz a cascata.
6. **AGRUPARECEBER, AGRUPAPAGAR e AGRUPA_CX_APAGAR têm 0 linhas em produção.**
   - `GeraAgrupamentoCR` existe no fonte mas nunca é chamado; o código do AP está comentado.
   - O snapshot que o novo sistema lista como adiado é **código morto**. Só carregar a tabela vazia, pela regra "todos os campos".
7. **O consolidado AP pode ter N parcelas, e o agrupamento AP também serve para reparcelar.**
   - 2026: 5 de 78 grupos multiparcela; 2025: 8/86.
   - Há casos de 1 título virando 36 ou 70 parcelas ("PARCELA 9 DE 70"): 3 grupos de 1 membro em 2026, mais 1 grupo de 70 parcelas sem membro.
   - O novo sistema exige ao menos 2 membros e grava uma linha só.
8. **O fluxo de convênio com mesmo CNPJ está vivo, mas é raro.**
   - 32 grupos desde 2020: 3, 12, 8 e 7 por ano em 2020-2023; 1 em 2024; 1 em 2026 (R$ 20.051,06, 230 títulos).
   - O binário atual **quita os membros** nesse fluxo, e o fonte não faz isso. Prova: auditoria com 230/230 de N para S no segundo exato de DATA_AGRUPAMENTO (09/03/2026 17:20:56-57).

**Origem dos consolidados de 2026 (evidência forte):** 5 dos 24 consolidados AR (BORBA, parceiro 1459, com COD_DESCONTO_TITULO) e cerca de 6 grupos AP da BORBA foram criados pelo **Desconto de título / encontro de contas (FRMDESCONTOTITULO)**, que pré-agrupa (`uDescontoTitulo.AgrupaTitulosAReceber/Apagar`). Os indícios:
- o último acesso ao menu FRMAGRUPACONTASARECEBER é de 25/08/2026, mas há consolidados de 02/09 e 12/09;
- esses consolidados foram quitados minutos depois de criados.

O `desconto-titulo-exec.service` novo faz só 1 RCB × 1 APG, sem esse pré-agrupamento.

---

## 1. Modelo de dados do legado

### 1.1 AR: o consolidado (grava `frmCadAReceber` com `AgrupamentoReceber=True`)

| Coluna | Regra (fonte) | Produção (194 consolidados; 2026 = 24) |
|---|---|---|
| AGRUPAMENTO | 'S' (`iif(AgrupamentoReceber,'S','N')`) | 194/194 |
| AGRUPADO | 'N' (trigger `TEMP_AGRUPADO` força 'N' se nulo) | 191 'N'; 3 'S' (consolidado agrupado de novo, ver quirks) |
| ORIGEM | não setada | NULL 194/194 |
| CODGRUPO | `GetID('CODGRUPO')` | 1 parcela por grupo em 194/194 |
| VALOR = TOTAL | `edtTotalGeral` = ΣVALOR + ΣJURO das linhas marcadas "Calc. Juros" + taxa ADM − desconto | VALOR = Σ VALOR dos membros em 182/194 (93,8%); 11 maiores (juros/arredondamento); 1 menor; TOTAL = VALOR 194/194 |
| TXADM | `EMPRESAS.TXADM` se o checkbox estiver marcado | >0 em 0/194; EMPRESAS.TXADM NULL nas 5 empresas |
| DTVENDA, DTVENC | now, now (editável no form) | mesmo dia em 176/194 (90,7%) |
| NRODUP / DUPLICATA | 1 / `NumDuplicataUnicaParcela` com NumeNota vazio | NRODUP=1 em 194/194; `' - 001/001'` em 193/194 |
| TIPODOC | não setado | NULL 194/194 |
| IDPGTO, CODBCO, CODCOBRADOR, CODVENDEDOR | do **último** título da grade (cursor em EOF) | IDPGTO ∈ {5, 23, 175, 202, 235, 8}; CODBCO 0 (1 caso 526) |
| TXJUROS | `EmpresaTXJUROPADRAO` | 0 em 194/194 |
| CODPLC | centro de custo desabilitado | NULL 191/194 |
| CONSILIADO / CADASTRADO_MANUALMENTE | 'S' / 'S' | 194/194 |
| GERADO / IDSITUACAO_NF | não setados | NULL 137/194 / NULL 191/194 |
| OBS | fonte: "Notas fiscais: …", "Cupons: …", "Códigos das contas: …" (via `btnAdicionarRegistroClick`) | só em 2020-2022; desde 2023 é NULL ou texto do usuário (2023: 34/40 nulos; 2024: 29/30; 2025: 44/45; 2026: 23/24). O binário atual não preenche mais. |
| CAIXA | não grava (`not AgrupamentoReceber`) | 0/194 com CAIXA |
| Contábil | chama `IntegraReceber(CODGRUPO)` se INTEGRACAO='AUTOMATICA', mas o filtro CR exclui AGRUPAMENTO='S' | CONTABILIZADO NULL 194/194 |

### 1.2 AR: os membros

- Gravação: `AGRUPADO='S'`, `CODGRUPO_AGRUPAMENTO_RCB = CODGRUPO do consolidado`, `DATA_AGRUPAMENTO = CURRENT_TIMESTAMP`.
- Membros por ano: 2025 = 12.871 em 45 grupos; 2026 = 8.171, sendo 7.941 RCB em 24 grupos e 230 APG em 1 grupo.
- DATA_AGRUPAMENTO NULL em 209 membros de 6 grupos (1337, 4916, 25908, 36689, 49302, 50542): são títulos entrados por **Adicionar título**, que não seta a data.
- Os membros **mantêm o CAIXA deles**: 108 dos 8.171 membros de 2026 têm linha no CAIXA (R$ 13.372,88, origens ARECEBER e FECHAMENTO).
- Os membros **mantêm o CONTABILIZADO deles**: 106 dos 8.171 de 2026 estão contabilizados (1,3%). IDNF: 3.
- Perfil dos membros de 2026: ORIGEM NULL 8.062, Q 103, F 6; TIPODOC 'DUPLICATA' 8.055.
- **Lixo existente:**
  - 157 membros com AGRUPADO='S', QUITADA='N' e `CODGRUPO_AGRUPAMENTO_RCB = 0`: todos de 31/01/2023, R$ 7.528,19, 11 clientes. Não existe consolidado; ficam invisíveis como abertos.
  - 6 títulos com `CODGRUPO_AGRUPAMENTO_APG = 0`.
  - O AP tem o trigger `VALIDA_AGRUPAMENTO`, que recusa CODGRUPO=0 ou CODGRUPO_AGRUPAMENTO_APG=0 com ORA-20001 "ERRO: ACIONAR O SUPORTE APOLLO SISTEMAS…". O AR não tem trigger equivalente.

### 1.3 Leitores do vínculo no legado (todos usam a semântica CODGRUPO)

- `QryAgrupados` e `QryCCAgrupados`: `WHERE R.CODGRUPO_AGRUPAMENTO_RCB = :CODGRUPO`, com o parâmetro vindo de `cdsReceberCODGRUPO`.
- Extrato do funcionário: `GetSqlExtratoFuncionario`.
- Rótulo "Agrupado em documento de código:": `SELECT MAX(CODRCB) FROM ARECEBER WHERE CODGRUPO = <CODGRUPO_AGRUPAMENTO_RCB do membro>`; para o fluxo APG, `MAX(CODAPG) FROM APAGAR WHERE CODGRUPO = …`.
- Pesquisa F3 do AR: "Trazer somente abertos;Trazer somente liquidados;Agrupados;Trazer todos".
- **No novo sistema, `rel-caixa-dre.service.ts:153` e `parceiro-historico.service.ts:74` já usam a semântica legada** (`w.codgrupo_agrupamento_apg = g.codgrupo_agrupamento_apg`). Com o dado que o `apagar-agrupamento` novo grava (codapg no lugar do grupo), esse rateio sai errado. É uma inconsistência interna do novo sistema.

---

## 2. O fluxo de convênio (AR → A PAGAR, "adiantamento de parceiro com mesmo CNPJ")

### 2.1 Quando dispara

- A config **`'AGRUPAR BAIXA RECEBER - ATIVA CONVENIO' = 'SIM'`** vem do `ConfigDB.xml` **local de cada estação**, não do banco (`udmConfigura.pas:425`). Não dá para migrar nem ler da produção; o dado mostra que estava ligada em pelo menos uma estação em 09/03/2026.
- Com a config em SIM, sempre se pergunta o parceiro:
  - mais de um cliente: "Foi detectado um fechamento de convênio, informe o parceiro para gerar o titulo.";
  - um cliente com `PARCEIROS.CODCONVENIO <> 0`: a mesma mensagem.
- **O desvio acontece se `ApenasNumero(CNPJ_CPF do parceiro) = ApenasNumero(CNPJ da empresa logada)`**, com a mensagem "Foi detectado que o CNPJ do cliente a receber é igual ao da empresa."
- Em produção esse parceiro é o 87199 JF SUPERMERCADOS LTDA, CNPJ 37.954.975/0001-69 = EMPRESA 1. Os 32 grupos são dele.
- KAMALEOA (95443, CNPJ = EMPRESA 51) e APOLLO GESTÃO (56174, CNPJ = EMPRESA 50) são consolidados AR comuns, feitos todo mês: o teste de CNPJ deu falso para eles.

### 2.2 Tela `frmConvenioParceiro` ("Convênio Parceiro", botão "&Gravar baixa")

- **Centro de custo:** PLC de DESPESA. O padrão vem de `EMPRESAS.CODPLCFECHAMENTOCONVENIO` e trava o campo; em produção é NULL.
- **"Vencimento da conta a pagar"** (`edtDtVenda`): é a data do CAIXA.
  - com vários títulos: DATA_VENDA do último título da grade;
  - com 1 título: now, e a modalidade vem do IDPGTO do título.
- **Valor total:** `edtTotalGeral`.
- **Forma de pagamento:** FORMAS_PGTO com DESTINO='ARECEBER'.
- **Obs padrão:** "Originado do lancamento do adiantamento de parceiro com mesmo CNPJ."
- **Validações:** "O centro de custo é inválido. Verifique!" · "O centro de custo deve ser informado. Verifique!" · "Informe a forma de pagamento."

### 2.3 Gravações, na mesma transação

**CAIXA:**
- CODCX novo; DATA = edtDtVenda; **VALOR = VRTITULO = −total**; OBS; OPERADOR.
- CODPLC = centro de custo; IDEMPRESA; TIPORECURSO = nome da modalidade.
- CODCONTA NULL; CODPARCEIRO 0; NRPARCELA 1; CODGRUPO NULL; DTVENC = DATA.
- GERADO 'SISTEMA'; CODRCB NULL; DTCADASTRO now; **ORIGEM 'CONVENIO PARCEIRO'**.
- Prova: as linhas 154705 (2024) e 252815 (2026) conferem campo a campo (TIPORECURSO 'CONVENIO', CODPLC 3545/3581, operador 21).
- Volume por ano: 2020: 3 · 2021: 12 · 2022: 8 · 2023: 7 · 2024: 1 · 2026: 1. São 32 no total, igual aos 32 APAGAR com `CODCXAGRUPAMENTOCR`, que resolvem 32/32.

**APAGAR (`GeraApagar`):**
- CODAPG novo; CODPARCEIRO = o parceiro, ou seja, a própria empresa; DTCOMPRA = DTVENC = now; VALOR = total; DUPLICATA = CODAPG.
- OBS "Originado do agrupamento de contas à receber."; **QUITADA='S'**; NRODUP 1.
- OPERACAO_CONVENIO_FUNCIONARIO='D'; CONVENIO='N'; TIPODOC 'BOLETO'; TXJUROS 0; GERADO 'SISTEMA'; IDNF 0.
- **CODCXAGRUPAMENTOCR = CODCX; AGRUPAMENTO='S'; CODGRUPO = novo GetID('CODGRUPO')**.
- Prova: os 32 APAGAR conferem todos esses campos.

**Membros:**
- AGRUPADO='S', `CODGRUPO_AGRUPAMENTO_APG = APAGAR.CODGRUPO`, DATA_AGRUPAMENTO = now.
- **QUITADA='S' vem do binário novo.** Prova: auditoria 230/230; 30 dos 32 grupos com 100% dos membros quitados (35316: 625/644; 36457: 63/65).
- Nenhum membro tem ARECEBER_BX (grupo 93439: 0/230).

**Contábil:** se INTEGRACAO='AUTOMATICA' (empresa 1 é), chama `IntegraAgrupamentoConvenio(CodGrupoOut)`. Exceções são engolidas por `except end`.

### 2.4 Depois de gravar

- "A conta à pagar nº X foi gerada com sucesso."
- Escolha de impressão: "Imprimir relatório sintético;Imprimir relatório analítico;Não imprimir". Abre `frmAPagar` com o grid de RCB: `AgrupamentoCPCRAgrupado.fr3` (sintético) ou `AgrupamentoCPCR.fr3` (analítico).
- Erro: "Ocorreu um erro durante o agrupamento e o processo foi cancelado.\nErro original: …"

### 2.5 Reversão do convênio

É feita pelo `frmAPagar.btnReverterAgrupamento` (RBAC `FRMAPAGAR.BTNREVERTERAGRUPAMENTO`: 152 concessões, 56 operadores), com o grid de RCB ativo. Na ordem:
1. CODGRUPO=0: "Contas a pagar não possui grupo."
2. COD_DESCONTO_TITULO: "Não será possível reverter o agrupamento pois existem desconto de titulo vinculado!."
3. Confirmação "Deseja realmente reverter o agrupamento?" (padrão NÃO).
4. Se CONTABILIZADO_AGRUPAMENTO='S':
   - com INTEGRACAO diferente de 'AUTOMATICA': "Não é permitido reverter este agrupamento pois já foi contabilizado.";
   - senão: `TIntegracaoAgrupamentoConvenio.Estornar(CODGRUPO)`.
5. Membros: AGRUPADO='N', CODGRUPO_AGRUPAMENTO_APG NULL, DATA_AGRUPAMENTO NULL. Se nada mudar: "Conta a receber não encontrada para ser excluída." **O fonte não volta QUITADA para 'N'.**
6. `DELETE CAIXA WHERE CODCX = CODCXAGRUPAMENTOCR`.
7. `DELETE APAGAR WHERE CODGRUPO`.
8. "Reversão realizada com sucesso." Em caso de erro: "Um erro ocorreu durante a reversão do agrupamento e o processo foi cancelado.\nErro original: …"

---

## 3. Taxa administrativa e desconto

- **Taxa ADM:**
  - checkbox "Cobrar taxa administrativa";
  - soma um **valor fixo** `EMPRESAS.TXADM` ao total (não é percentual) e grava em `ARECEBER.TXADM` do consolidado;
  - produção: EMPRESAS.TXADM NULL nas 5 empresas e TXADM>0 em 0/194. **Nunca foi usada.**
- **Desconto:**
  - campo "Desconto"; ao sair do campo: `TotalGeral := TotalGeral − Desconto`;
  - validação "Desconto maior que o total!";
  - **não é gravado em lugar nenhum**: só reduz o VALOR do consolidado. Não dá para medir; é candidato a explicar o único caso VALOR < Σ.
- **Juros:**
  - coluna "Calc. Juros" (SELECIONAR); a linha marcada soma o JURO calculado pela view GET_RCB;
  - atalhos: [T] marca todos, Espaço alterna, clique na coluna 1 alterna;
  - explica os 11 casos com VALOR > Σ.
- **Fórmula exata** (`SetaTotal`): `TotalGeral = ΣVALOR(todos) + ΣJURO(marcados) + TXADM`; o desconto é aplicado depois.

---

## 4. Contábil (`TIntegracaoAgrupamentoConvenio`, origem 65)

**Quando é chamado:**
- no agrupamento de convênio, na hora, se INTEGRACAO='AUTOMATICA';
- pelo TRON (por período ou por código);
- o estorno vem da reversão do convênio ou do TRON.

**Leitura:**
- grupos: `SELECT DISTINCT CODGRUPO_AGRUPAMENTO_APG, TRUNC(DATA_AGRUPAMENTO), CODEMPRESA FROM ARECEBER JOIN APAGAR AP ON AP.CODGRUPO = A.CODGRUPO_AGRUPAMENTO_APG WHERE … COALESCE(CONTABILIZADO_AGRUPAMENTO,'N')='N'`;
- `DataSetC` = os RCB do grupo (conta `COALESCE(P.CODCONTABIL, P.CODCONTABIL_FOR)`);
- `DataSetD` = os APG com `CODGRUPO = grupo`.

**Lançamento:**
- situação `SitAgrupamentoConvenio` (910);
- data = DATA_AGRUPAMENTO; complemento = grupo;
- **Valor = Σ VALOR dos APG**; IdOrigem = CODRCB do primeiro membro.

**Prova no razão:**
- 2026: 231 linhas = 1 débito (conta 219, R$ 20.051,06, idorigem 105802, documento vazio) + 230 créditos (conta 211, um por membro, histórico "AGRUPAMENTO CONVENIO .: 000105802  LETICIA…").
- Nos 30 grupos contabilizados, **débito = Σ APG em 30/30**.
- Crédito = Σ RCB atual em 24/30. Os 6 que divergem tiveram membros alterados depois (em 29695 o crédito saiu em dobro).
- Grupos 2230 e 3131 (2020) nunca foram contabilizados.

**Flags:** `CONTABILIZADO_AGRUPAMENTO='S'` nos RCB e nos APG. A auditoria mostra os 230 membros atualizados 31 s depois do agrupamento, e um novo ciclo de estorno e reintegração pelo TRON em 24/04/2026.

**Estorno:** `DELETE DIARIO WHERE COMPLEMENTO = grupo AND CODORIGEM=65`, e limpa as flags por grupo.

**Comparação com o `documentos-contabil.service.ts` (método `convenio`):**
- Divergência real: o novo usa **valor = Σ RCB**; o legado usa **Σ APG**. Os dois só diferem se houver juros, taxa ou desconto no fluxo de convênio. Corrigir para Σ APG.
- O estorno do novo é por data/idorigem. É equivalente, porque as duas pernas têm idorigem = CODRCB no dado.
- Quirk do legado: `if QryRcb.IsEmpty or QryRcb.IsEmpty` testa o RCB duas vezes e nunca o APG. O novo testa os dois; manter o novo.
- **Consolidado não conveniado:** não há contábil próprio (o CR o exclui). Os membros contabilizam normalmente pela DTVENDA deles.

---

## 5. Operações do AR, validações e RBAC

### 5.1 Pesquisar e agrupar (FRMAGRUPACONTASARECEBER, "Agrupar contas a receber")

**Busca:**
- view `GET_RCB`, multisseleção;
- filtro `COALESCE(AGRUPADO,'N')='N' AND QUITADA='N'`, mais `CONSILIADO='S'` se `EMPRESAS.FECHAMENTO_CAIXA='S'` (NULL em produção);
- boleto emitido aparece em roxo ("Boletos Bancários emitidos");
- **não barra** IDNF, CONTABILIZADO, cliente diferente nem consolidado (a busca permite agrupar um consolidado dentro de outro).

**Validações e mensagens:**
- "Nenhum documento foi selecionado para realizar o agrupamento."
- Mais de um cliente com a config fora de SIM: "Mais de um cliente foi selecionado para realizar o agrupamento, informe o parceiro para gerar o título." Abre a pesquisa GET_PARCEIROS **sem filtro**.
- "Necessário selecionar um parceiro para realizar o agrupamento."
- Depois vêm as validações do `frmCadAReceber` ao gravar:
  - "A empresa deve ser informada."
  - "O valor da parcela deve ser maior que zero."
  - "A Forma de pagamento deve ser informada. Verifique!"
  - "A data do vencimento não pode ser menor que a do lançamento."
  - período contábil fechado;
  - "O número de parcelas deve ser menor que 200."
- No consolidado ficam desabilitados VALOR, TOTAL e o centro de custo. O número de parcelas fica habilitado, mas nunca foi usado (1 parcela em 194/194).

**Depois de gravar:**
- "Deseja imprimir o boleto?": boleto do consolidado. Só 1 consolidado com remessa (2024); membros com remessa: 1 de 20.812.
- "Deseja imprimir o relatório do agrupamento?": `Agrupamento.fr3` (0), `Agrupamentototalizado.fr3` (1) ou `Agrupamento_extrato_funcionario.fr3` (2). O desconto de título usa `AgrupamentoAR.fr3`.

### 5.2 Menu "Outros" do Contas a Receber (`pmAgrupamento`)

**Adicionar título ao agrupamento** (`uAddTituloAgrupamentoAReceber`):
- busca GET_RCB com `AGRUPAMENTO<>'S' AND AGRUPADO<>'S' AND QUITADA='N'`;
- para cada título: `UPDATE AGRUPADO='S', CODGRUPO_AGRUPAMENTO_RCB = CODGRUPO do consolidado` (**sem DATA_AGRUPAMENTO**);
- histórico " INCLUSO TÍTULO n° X - cliente : C - NOME ao agrupamento nº <CODRCB>";
- consolidado: `VALOR = VALOR + Σ TOTAL` (juros sempre incluídos, marcado ou não), `TOTAL = VALOR antigo + Σ`;
- histórico " ATUALIZACAO DO VALOR DO AGRUPAMENTO n° …";
- "Título(s) incluído com sucesso!"; se a soma der 0: "Error ao extrair valores de titulos selecinados!";
- **não verifica** se o consolidado está quitado;
- prova: 209 membros sem data em 6 grupos.

**Remover título do agrupamento:**
- "Contas a receber não possui grupo." (CODGRUPO=0 ou sem membros);
- confirmação "Deseja realmente remover o título: Documento [..] Dt. Venc. [..] Valor [R$ ..] Pedido [..] do agrupamento?" (padrão NÃO);
- membro: AGRUPADO='N', CODGRUPO_AGRUPAMENTO_RCB NULL (a data fica);
- consolidado: `VALOR − VALOR do membro` (VALOR, não TOTAL);
- histórico " REMOÇÃO DE TÍTULO n° … do agrupamento nº …"; "Título removido com sucesso!";
- **permite remover o último** e não verifica quitação;
- prova: consolidado 130907 foi de 9.055,12 para 9.042,66 em 25/08/2026.

**Reverter agrupamento:**
1. "Contas a receber não possui grupo."
2. Qualquer linha do grupo quitada: "Não será possível reverter o agrupamento pois existem parcelas quitadas."
3. COD_DESCONTO_TITULO > 0: "Não será possível reverter o agrupamento pois existem desconto de titulo vinculado!."
4. Confirmação "Deseja realmente reverter o agrupamento?" (padrão NÃO).
5. Membros: AGRUPADO='N', CODGRUPO_AGRUPAMENTO_RCB NULL.
6. `DELETE ARECEBER WHERE CODGRUPO = …` (todas as parcelas). Se nada for apagado: "Conta não encontrada para ser excluída."
7. Histórico DELETE " REVERSÃO DE AGRUPAMENTO CLIENTE: …, DOCUMENTO: …, VALOR: …"; "Reversão realizada com sucesso."
8. Em caso de erro: "Erro ao reverter agrupamento.\nErro original: …"

Não verifica CONTABILIZADO nem baixa ativa (só QUITADA).

**Travas do cadastro:**
- excluir consolidado: "Não é possível excluir uma conta gerada de um agrupamento.";
- membro (AGRUPADO='S'): aba de cadastro, Editar e Excluir desabilitados (`VerificaBloqueio`).

### 5.3 RBAC em produção (`PERMISSOES`)

| Form / opção | Concessões | Operadores |
|---|---|---|
| FRMAGRUPACONTASARECEBER (tela) | 116 | 43 |
| FRMAGRUPACONTASARECEBER.BTNEXCLUIRDOC (Tag=1) | 27 | 9 |
| FRMAGRUPACONTASAPAGAR (tela) | 102 | 36 |
| FRMAGRUPACONTASAPAGAR.BTNEXCLUIRDOC | 28 | 9 |
| FRMAPAGAR.BTNREVERTERAGRUPAMENTO | 152 | 56 |

- Reverter, Adicionar e Remover do AR **não têm RBAC** (0 linhas; o `JvOpcoesAgrupamento` não tem Tag): basta acesso ao FRMCADARECEBER.
- O novo sistema criou `FRMAGRUPARECEBER` / `FRMAGRUPAPAGAR` com BTNAGRUPAR e BTNREVERTER (mig 110/111). **Os nomes não batem com o legado**, então as permissões migradas não concedem nada.

---

## 6. Escritas no CAIXA

| Onde | Escrita | Produção |
|---|---|---|
| Consolidado AR | nenhuma | 0/194 |
| Membros AR | não são apagados nem ajustados | 108/8.171 (2026) mantêm CAIXA, R$ 13.372,88 |
| Convênio mesmo CNPJ | 1 CAIXA negativo, ORIGEM 'CONVENIO PARCEIRO' | 32 linhas (2020-2026) |
| Consolidado AP | CX_APAGAR só se o centro de custo for informado | 18/78 grupos de 2026 |
| Membros AP | mantêm CX_APAGAR e CAIXA | 205/216 grupos-membro de 2026 |

O DRE do caixa legado resolve a dupla contagem do AP com a base via `codgrupo_agrupamento_apg`; o `rel-caixa-dre` novo já copia isso.

---

## 7. O gêmeo AP (FRMAGRUPACONTASAPAGAR, "Agrupar contas a pagar")

**Busca e validações:**
- busca `GET_APAGAR_AGRUPAR` com `COALESCE(AGRUPADO,'N')='N'`;
- "Foi detectado mais de um fornecedor, informe o parceiro para gerar o titulo!" abre GET_PARCEIROS;
- "Feche o formulário de contas a pagar antes de continuar.";
- total = **Σ VALOR** (sem juros, taxa ou desconto).

**Consolidado** (gravado pelo `frmAPagar` com `AgrupaAPagar`):
- AGRUPAMENTO='S', AGRUPADO='N', ORIGEM NULL;
- DTVENC = DTCOMPRA = date; TXJUROS = `EmpresaTX_JURO_APAGAR`; NRPARCELA '1/1'; TIPODOC 'BOLETO' (produção também tem RH e CARTÃO PRÓPRIO);
- OBS = obs anterior + "Referente Agrupamento\n" + "Notas fiscais: …" / "Códigos das contas: …". Cobertura: 27/27 (2024), 95/188 (2025), 83/329 (2026); o resto são parcelas de reparcelamento com OBS do usuário;
- a situação do documento é pulada;
- o usuário pode gerar N parcelas;
- `CODGRUPO` volta em `CodGrupoRetorno`.

**Membros:**
- AGRUPADO='S', `CODGRUPO_AGRUPAMENTO_APG = CODGRUPO do consolidado`;
- **o APAGAR do Oracle não tem a coluna DATA_AGRUPAMENTO**; o novo sistema a criou na mig 111, e ela só existe no destino.

**Valores (2026, 79 grupos):**
- Σ parcelas = Σ membros em 62;
- 2 grupos sem membro (93439 é o convênio; 104868 é um reparcelamento);
- 15 com diferença: o fornecedor 1283 tem sobras de R$ 0,10 a 2,99; 100766 tem +768; 104953 tem −16.880,07.

**Baixa:** sem cascata para os membros (0 de 186).

**Reverter** (`btnReverterAgrupamento`, RBAC acima):
1. "Contas a pagar não possui grupo."
2. Desconto de título: a mesma mensagem do AR.
3. Confirmação.
4. `ExisteQuitada` (qualquer parcela do grupo): "Não será possível reverter o agrupamento pois existem parcelas quitadas."
5. Membros: AGRUPADO='N', CODGRUPO_AGRUPAMENTO_APG NULL. Se nada mudar: "Conta a receber não encontrada para ser excluída." (sic)
6. `DELETE APAGAR WHERE CODGRUPO`.
7. Histórico; "Reversão realizada com sucesso."
8. Em caso de erro: "Ocorreu um erro durante a reversão da conta. Erro original:…"

**Outras regras:**
- Não existe adicionar nem remover título no AP.
- Excluir o consolidado dá a mesma mensagem do AR; o VALOR fica desabilitado.
- Impressão: `AgrupamentoCP.fr3` ou `AgrupamentoCPAgrupado.fr3`.
- **Quirk:** o `except Rollback` do agrupar engole o erro sem mensagem.

---

## 8. Divergências: legado × serviços novos

| # | Tema | Legado (prova) | Novo hoje | Ação |
|---|---|---|---|---|
| G1 | Vínculo membro→consolidado | CODGRUPO do consolidado (100%) | codrcb/codapg | **Adotar CODGRUPO.** Remapear é inviável no AP multiparcela e quebra o rel-caixa-dre |
| G2 | Marca do consolidado | AGRUPAMENTO='S', ORIGEM NULL | ORIGEM='A', agrupamento NULL | Gravar AGRUPAMENTO='S' e ORIGEM NULL; tirar `origem==='A'` das travas (colide com acordo comercial) |
| G3 | TRON CR/CP | exclui AGRUPAMENTO='S' | consolidado novo entra → **duplo contábil** | Corrigir junto com G2 (bug atual) |
| G4 | Vários clientes/fornecedores | pede o parceiro (67% AR, 42% AP) | recusa | Aceitar, com parceiro escolhido |
| G5 | Mínimo de títulos | 1 (reparcelamento AP) | 2 | Mínimo 1 |
| G6 | Elegibilidade | só AGRUPADO/QUITADA (+CONSILIADO) | barra CONTABILIZADO e IDNF | Tirar as travas extras (106 membros contabilizados em 2026) |
| G7 | Campos do consolidado AR | tabela 1.1 | TIPODOC 'DUPLICATA', OBS automática, IDPGTO/DUPLICATA/NRODUP nulos, CM 'N', GERADO 'SISTEMA', txjuros = padrão | Replicar os valores do legado; IDPGTO obrigatório |
| G8 | Juros, taxa ADM, desconto | fórmula da seção 3 | só Σ VALOR | Juros por linha e desconto: sim. Taxa ADM: campo previsto, empresa sem valor |
| G9 | Multiparcela | AP: sim (5/78); AR: permitido, nunca usado | 1 linha | Implementar no AP (reusar o gerador de parcelas do AP) |
| G10 | Adicionar título (AR) | existe | não existe | Implementar |
| G11 | Remover título | permite o último; subtrai VALOR; não verifica quitação | recusa o último; exige não baixado | Manter as travas novas como endurecimento consciente, ou replicar (decidir) |
| G12 | Reverter | trava quitada e desconto de título; apaga todas as parcelas do grupo | trava ORIGEM='A' (**um consolidado migrado dá NAO_E_AGRUPAMENTO**), baixa, lote, contabilizado | Reescrever sobre AGRUPAMENTO/CODGRUPO |
| G13 | Cascata da baixa AR | membros QUITADA S/N | ausente | Implementar no `areceber-baixa` (baixa, estorno e baixa parcial) |
| G14 | Convênio mesmo CNPJ | CAIXA + APAGAR quitada + membros quitados + contábil 65 automático + reversão pelo AP | ausente | Corte próprio; config precisa de chave no banco |
| G15 | TRON convênio | débito = Σ APG | Σ RCB | Trocar para Σ APG |
| G16 | RBAC | nomes da tabela 5.3 | FRMAGRUPARECEBER/APAGAR + BTNAGRUPAR/BTNREVERTER | Usar os nomes legados (acesso à tela + BTNEXCLUIRDOC; FRMAPAGAR.BTNREVERTERAGRUPAMENTO) |
| G17 | Impressão | 3 relatórios AR + 4 AP | nenhum | Corte de relatórios |
| G18 | AGRUPARECEBER/AGRUPAPAGAR | mortas (0 linhas) | "adiado" | Tirar do adiado; só carregar vazias |
| G19 | Encontro de contas com pré-agrupamento | FRMDESCONTOTITULO agrupa N títulos | 1×1 | Registrar como dívida do épico Desconto de título |

---

## 9. Plano de cortes (ordem de valor)

1. **Corte A: modelo legado e correção de bug.**
   - Consolidado com AGRUPAMENTO='S' e ORIGEM NULL; vínculo por CODGRUPO.
   - Rever as travas de `areceber.service` e `apagar.service` (tirar `origem==='A'`).
   - TRON sem duplo contábil.
   - Reescrever reverter e remover sobre o grupo.
   - Smoke com o dado migrado real, por exemplo o consolidado 130902 e seus 687 membros, e o 114439 quitado.
2. **Corte B: agrupar como a produção usa.**
   - Clientes diversos com parceiro escolhido; mínimo 1; sem as travas CONTABILIZADO/IDNF.
   - Campos do consolidado conforme 1.1; juros por linha; desconto; taxa ADM (campo).
   - Adicionar título.
   - RBAC com os nomes legados.
3. **Corte C: cascata da baixa AR.** QUITADA dos membros na baixa, no estorno e na baixa parcial.
4. **Corte D: AP completo.** Multiparcela e reparcelamento, centro de custo opcional, OBS "Referente Agrupamento".
5. **Corte E: convênio mesmo CNPJ.**
   - Tela de convênio parceiro, CAIXA 'CONVENIO PARCEIRO', APAGAR quitada, membros quitados.
   - Contábil 65 automático com débito = Σ APG.
   - Reversão pelo AP com estorno.
   - Config no banco em lugar do XML local.
6. **Corte F: relatórios.** Agrupamento, totalizado e extrato do funcionário no AR; CP, CPAgrupado, CPCR e CPCRAgrupado no AP.

---

## 10. Implicação para a virada

- **Carregar como está:** AGRUPAMENTO, AGRUPADO, CODGRUPO, CODGRUPO_AGRUPAMENTO_RCB/APG, DATA_AGRUPAMENTO, CONTABILIZADO_AGRUPAMENTO e CODCXAGRUPAMENTOCR. Os serviços novos precisam reconhecer esse formato (cortes A e B).
- **Com o modelo novo de hoje, sem o corte A, seria preciso remapear**, e isso não se sustenta:
  - consolidados AR para ORIGEM='A' conflitam com os 6 acordos comerciais;
  - membros AR com `codgrupo_agrupamento_rcb := codrcb do consolidado` até funciona (1 parcela por grupo);
  - **no AP o remapeamento é impossível** em 5-8 grupos por ano (N parcelas por grupo), e quebra o `rel-caixa-dre` e o TRON convênio, que leem CODGRUPO.
  - **Recomendação: não remapear; mudar o modelo.**
- **Lixo para levar sem corrigir em silêncio** (reportar ao cliente): os 157 membros AR no grupo 0 (31/01/2023, R$ 7.528,19) e os 6 com APG=0.
- O ConfigDB.xml não vem na carga: decidir o valor padrão da chave "agrupar convênio" no destino.

---

## 11. Quirks: decidir se replica

1. O desconto não é persistido e é subtraído **a cada saída do campo**. Ao remarcar juros ou taxa depois, o `SetaTotal` descarta o desconto. Proposta: gravar o desconto e calcular uma vez.
2. Adicionar título soma o TOTAL com juros mesmo quando o juro não está marcado; remover subtrai só o VALOR (assimetria).
3. `AtualizaValoresAgrupamento` usa `TOTAL = VALOR ± x`. No Oracle o lado direito lê o valor antigo, então o resultado é coerente. No PG também; manter.
4. Adicionar título não grava DATA_AGRUPAMENTO (209 membros NULL) e não verifica se o consolidado está quitado.
5. Remover título permite tirar o último membro e deixa o consolidado órfão.
6. Reverter não estorna contábil nem verifica baixa ativa (só QUITADA). Na reversão AR e AP, DATA_AGRUPAMENTO fica gravada; só a reversão do convênio limpa.
7. O consolidado pode ser agrupado dentro de outro (3 casos; 126704 dentro de 128396 em 2026).
8. IDPGTO, cobrador, vendedor e banco do consolidado vêm do **último** título da grade.
9. A tela de convênio chama de "Vencimento da conta a pagar" a data do CAIXA; o DTVENC do APAGAR é sempre now.
10. O fluxo de convênio quita os membros no binário, mas a reversão (pelo fonte) não os reabre.
11. `IncluirTituloAgrupamento` dá Commit sem StartTransaction.
12. O agrupar do AP engole exceção sem mensagem.
13. No TRON convênio, `QryRcb.IsEmpty or QryRcb.IsEmpty` nunca verifica o APG.
14. A mensagem da reversão AP diz "Conta a receber…" quando o título é a pagar.
15. A OBS automática do AR ("Notas fiscais/Cupons/Códigos") parou de ser gravada desde 2023 (o dado vence o fonte). Proposta: campo livre, pré-preenchido opcionalmente.

---

## Apêndice: SQL principal (todo sob SET TRANSACTION READ ONLY)

```sql
-- consolidados por ano
SELECT EXTRACT(YEAR FROM DTCADASTRO), COUNT(*), COUNT(DISTINCT CODGRUPO),
       SUM(CASE WHEN ORIGEM IS NULL THEN 1 ELSE 0 END)
  FROM ARECEBER WHERE AGRUPAMENTO='S' GROUP BY EXTRACT(YEAR FROM DTCADASTRO);

-- vínculo e colisão
WITH M AS (SELECT CODRCB, CODGRUPO_AGRUPAMENTO_RCB G FROM ARECEBER WHERE CODGRUPO_AGRUPAMENTO_RCB IS NOT NULL),
     C AS (SELECT CODGRUPO, MAX(AGRUPAMENTO) AGR FROM ARECEBER GROUP BY CODGRUPO)
SELECT COUNT(*), COUNT(DISTINCT M.G),
       SUM(CASE WHEN C.AGR='S' THEN 1 ELSE 0 END),
       SUM(CASE WHEN EXISTS (SELECT 1 FROM ARECEBER X WHERE X.CODRCB=M.G) THEN 1 ELSE 0 END)
  FROM M LEFT JOIN C ON C.CODGRUPO=M.G;

-- perfil 2026 consolidado × Σ membros (VALOR, TOTAL, QUITADA dos membros, TIPODOC, IDPGTO, DUPLICATA, ...)
WITH C AS (SELECT * FROM ARECEBER WHERE AGRUPAMENTO='S' AND DTCADASTRO >= DATE '2026-01-01'),
     M AS (SELECT CODGRUPO_AGRUPAMENTO_RCB G, COUNT(*) N, SUM(VALOR) SV, COUNT(DISTINCT CODPARCEIRO) NP,
                  SUM(CASE WHEN QUITADA='S' THEN 1 ELSE 0 END) QUIT
             FROM ARECEBER WHERE CODGRUPO_AGRUPAMENTO_RCB IS NOT NULL GROUP BY CODGRUPO_AGRUPAMENTO_RCB)
SELECT C.CODRCB, C.VALOR, M.SV, C.TXADM, C.TIPODOC, C.IDPGTO, C.DUPLICATA, C.QUITADA, M.QUIT, M.NP
  FROM C LEFT JOIN M ON M.G=C.CODGRUPO;

-- cascata da baixa (auditoria)
SELECT TO_CHAR(DATA,'YYYY-MM-DD HH24:MI:SS'), QUITADA_ANTERIOR, QUITADA, COUNT(*)
  FROM AUDIT_ARECEBER
 WHERE CODRCB IN (SELECT CODRCB FROM ARECEBER WHERE CODGRUPO_AGRUPAMENTO_RCB IN (89745,101027))
   AND TIPO='UPDATE'
 GROUP BY TO_CHAR(DATA,'YYYY-MM-DD HH24:MI:SS'), QUITADA_ANTERIOR, QUITADA;

-- convênio: APAGAR gerados e CAIXA
SELECT A.* FROM APAGAR A
 WHERE A.CODGRUPO IN (SELECT CODGRUPO_AGRUPAMENTO_APG FROM ARECEBER WHERE CODGRUPO_AGRUPAMENTO_APG IS NOT NULL);
SELECT * FROM CAIXA WHERE ORIGEM='CONVENIO PARCEIRO';

-- contábil 65: débito × Σ APG, crédito × Σ RCB
WITH D AS (SELECT COMPLEMENTO G,
                  SUM(CASE WHEN CONTADEBITO IS NOT NULL THEN VALOR ELSE 0 END) DEB,
                  SUM(CASE WHEN CONTACREDITO IS NOT NULL THEN VALOR ELSE 0 END) CRED
             FROM DIARIO WHERE CODORIGEM=65 GROUP BY COMPLEMENTO)
SELECT D.*,
       (SELECT SUM(VALOR) FROM APAGAR WHERE TO_CHAR(CODGRUPO)=D.G),
       (SELECT SUM(VALOR) FROM ARECEBER WHERE TO_CHAR(CODGRUPO_AGRUPAMENTO_APG)=D.G)
  FROM D;

-- AP 2026: grupos, parcelas, membros, CX_APAGAR
WITH C AS (SELECT CODGRUPO, COUNT(*) NPARC, SUM(VALOR) VC FROM APAGAR
            WHERE AGRUPAMENTO='S' AND DTCADASTRO >= DATE '2026-01-01' GROUP BY CODGRUPO),
     M AS (SELECT CODGRUPO_AGRUPAMENTO_APG G, COUNT(*) N, SUM(VALOR) SV, COUNT(DISTINCT CODPARCEIRO) NP
             FROM APAGAR WHERE CODGRUPO_AGRUPAMENTO_APG IS NOT NULL GROUP BY CODGRUPO_AGRUPAMENTO_APG)
SELECT C.*, M.* FROM C LEFT JOIN M ON M.G=C.CODGRUPO;

-- tabelas de snapshot, triggers, RBAC
SELECT COUNT(*) FROM AGRUPARECEBER;  -- também AGRUPAPAGAR e AGRUPA_CX_APAGAR: 0
SELECT trigger_name, trigger_body FROM user_triggers
 WHERE trigger_name IN ('TEMP_AGRUPADO','VALIDA_AGRUPAMENTO','CAIXA_APAGAR','AUDIT_ARECEBER');
SELECT FORM, OPCAO, COUNT(*), COUNT(DISTINCT CODOPERADOR) FROM PERMISSOES
 WHERE FORM LIKE 'FRMAGRUPA%' OR (FORM IN ('FRMCADARECEBER','FRMAPAGAR') AND OPCAO LIKE '%AGRUP%')
 GROUP BY FORM, OPCAO;
```
