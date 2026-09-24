# Spec de conversão — `FRMCONTROLECONTASBANCARIAS` (Controle de contas correntes)

| Campo | Valor |
|---|---|
| **Acessos** | 7.615 (`MENUEXPRESS`, `docs/05-migration-engineering/auditoria-travas/usage.txt:19`). Os forms filhos (detalhamento, lançamento, transferência) não passam pelo menu e não têm contagem própria |
| **Família** | `uControleContasBancarias.pas/.dfm` · `udmControleContasBancarias.pas/.dfm` (a versão de `Units\`, que é a do `Retaguarda.dpr:54-57`; a de `DmOld\` não entra no build) · `UconsMovBancaria.pas/.dfm` (detalhamento da conta) · `UlancamentoSaldo.pas/.dfm` · `uCadMovContasBancarias.pas/.dfm` + `udmCadMovContasBancarias` · `Utransferencia.pas/.dfm` · `UFrmTrocaValores`/`UDMTrocaValores` · `UFrmConciliacaoBancaria` (botão na grade) · `URelCaixa` (Imprimir) · relatório `Relatorios/extr - extrato conta corrente.fr3` |
| **Fonte** | `/Library/SicomGit/retaguarda-master/fonte/` (snapshot mai/2020, `Aplicações/Retaguarda_Versão.txt` vai até 13/05/2020) |
| **Dado** | Oracle de PRODUÇÃO, só leitura, 24/09/2026. `AUDIT_MOV_CONTAS_BANCARIAS` (trigger `AFTER INSERT OR UPDATE OR DELETE`, 644.209 linhas desde 21/08/2020) é a prova de uso das ações de escrita |
| **Regra de leitura** | O fonte é de 2020 e a produção roda binário mais novo. Onde os dois discordam, **vale o dado**, e isso vem marcado como **[binário novo]** |
| **Web atual** | `apps/api/src/modules/cadastro/controle-contas.service.ts` (+ `.controller.ts`), `apps/web/src/features/controle-contas/` (corte-1) |
| **Fora deste spec** | a transferência (`Utransferencia`) e o "Remover transferência" estão sendo refeitos em paralelo; aqui só um resumo (§5) |

---

## 0. Resumo em 12 linhas

1. A tela é **uma lista de contas + um painel de saldo + botões**. O extrato fica num form filho, o "Detalhamento da conta", aberto com duplo clique ou Enter na conta.
2. O saldo do legado é **Σ VALOR com sinal**. "Saldo atual" soma só `LIBERADO='S'`. "Total a prazo" soma o resto. "Saldo futuro" = atual + a prazo. Entradas e Saídas somam **tudo**, liberado ou não.
3. A escrita **mais usada** é a **liberação de movimentos a prazo**: 3.655 linhas N→S em 2025+ (1.648 eventos, 4 contas, tudo DINHEIRO, última em 23/09/2026). **A web não tem.** A mig 297 diz que essa rotina "mora em `FuncoesApollo`, que não veio no fonte". Está errado: ela está em `uControleContasBancarias.pas:197-278` e `UconsMovBancaria.pas:769-861`.
4. **"Adiciona Lançamentos" (`uCadMovContasBancarias`) está morto em produção.** `EMPRESAS.LCTO_FINANCEIRO` é nulo nas 5 empresas, então o botão fica desabilitado. `CODOPCONTA>0` tem **0 linhas** em toda a história (MOV e AUDIT), e `OPERACOES_CONTA` só tem a linha `0=TRANSFERENCIA`.
5. ⚠️ Por isso **o "lançamento manual por operação" da web não funciona com o dado real**: ele exige `codopconta>0`, e o catálogo migrado está vazio. O lançamento que o cliente usa é o **Lançamento de saldo**: modalidade, valor com sinal, histórico, e no binário novo também data e flag `LANCAMENTO_SALDO`. Foram 26 lançamentos em 2025+, com valores de até R$ 1.000.000.
6. ⚠️ **A web usa `data_fechamento` como data do extrato.** Essa coluna só vem preenchida nas linhas de fechamento de caixa (`ORIGEM='FCP'`). Está nula em **208.618 das 292.388 linhas (71%)**. A data do legado é `DTEMISSAO`, com a opção de filtrar por `DTVENC` ou `DTLIBERACAO`.
7. Uso das outras escritas em 2025+: "Remover transferência" 117 linhas / 76 lotes · "Mudar data de liberação" ~13 · exclusão de lançamento de saldo 4 **[binário novo]** · Chavear fech. caixa ≈ 0 (só 2 das 36 contas têm `DTCHAVEAMENTO`: 1899 e 2021) · Troca de valores **0 em toda a história** · cheques próprios **0 em toda a história**.

---

## 1. Tela principal — `uControleContasBancarias`

### 1.1 Lista de contas (grade `cxgridContasBancarias`)

SQL: `udmControleContasBancarias.dfm:669-683`.

```sql
SELECT CON.CODCONTA, CON.CODBCO, BCO.BANCO, CON.TITULAR, CON.NROCONTA, CON.GERENTE, CON.DTABERTURA, CON.FONE1,
       CON.OBS, CON.DTCHAVEAMENTO, CON.CODOPERADORCHAVEAMENTO, OP.NOME AS OPERADORCHAVEAMENTO
FROM CONTAS_BANCARIAS CON
LEFT JOIN CONTAS_BANCARIAS_OP O ON O.CODCONTA = CON.CODCONTA
LEFT JOIN BANCOS BCO ON BCO.CODBCO = CON.CODBCO
LEFT JOIN OPERADORES OP ON OP.CODOPERADOR = CON.CODOPERADORCHAVEAMENTO
WHERE O.CODOPERADOR = :CODOPERADOR AND COALESCE(CON.ATIVO,'S') = 'S'
ORDER BY CON.TITULAR
```

- **Filtro por operador:** só aparecem as contas ligadas ao operador logado em `CONTAS_BANCARIAS_OP`, com qualquer flag. É o `LEFT JOIN` + `WHERE`, que na prática funciona como INNER. Em produção **4 das 36 contas** não têm operador nenhum e ficam invisíveis na tela.
- **Filtro por empresa:** **não existe no fonte de 2020.** A conta de qualquer loja aparece se o operador estiver ligado a ela. Em produção, 15 operadores veem contas de mais de uma empresa. **[binário novo]** Existe `CONTAS_BANCARIAS_EMPRESAS` (35 linhas, com muitos vínculos cruzados: a empresa 51 tem 7 contas vinculadas e só 2 são dela). Isso sugere que o binário novo escopa a lista pela loja através dessa tabela. Não há fonte que prove. Decidir com o dado: listar a conta se `idempresa = loja` OU se existir vínculo em `CONTAS_BANCARIAS_EMPRESAS`.
- **Filtro de ativa:** `ATIVO` nulo conta como ativa (versão 23/03/2020, `Retaguarda_Versão.txt:365-372`). Em produção as 36 contas estão `ATIVO='S'`.
- **Colunas** (`uControleContasBancarias.dfm:773-828`): Conta (`CODCONTA`) · Nº Conta · Titular · Banco (`BANCOS.BANCO`) · Dt. Chaveamento · Usuário Chaveamento · **Conciliação OFX** (coluna-botão que abre `TFrmConciliacaoBancaria` para a conta, `.pas:306-322`).
- **Cabeçalho** (`pnlCabecalho`, DBEdits só leitura): Banco (código + nome) · Titular · Nº Conta · Gerente · Abertura · Fone.
- **Ordenação:** `TITULAR`. O cxGrid deixa o usuário reordenar pelas colunas (versão 19/12/2017, `Retaguarda_Versão.txt:9065-9069`).
- **Abertura:** timer de 1 ms, com "Carregando dados..." (`.pas:417-433`).
- **Navegação:** duplo clique ou Enter abre o Detalhamento (`.pas:324-366`). **Quirk:** se a conta não tem movimento, `TOTALATUAL` é nulo e o duplo clique **não faz nada** (`.pas:330-331`).
- **[binário novo] Permissões por operador × conta:** `CONTAS_BANCARIAS_OP` tem 8 flags que o fonte de 2020 não lê: `VISUALIZAR_SALDOS`, `HABILITAR_TRANFER`, `HABILTIAR_LIBE_MOVIMENT`, `HABILTIAR_LANCA_SALDO`, `HABILTIAR_CHAVEAR_FEC_CXA`, `HABILTIAR_TROCA_VALORES`, `HABILTIAR_DETALHAR_CONTA`, `HABILTIAR_CONCI_OFX`. A grafia `HABILTIAR` é a do banco. Os nomes batem 1:1 com os botões. Em produção são **225 linhas (35 operadores × 33 contas) e as 8 flags valem 'S' em 100%**, então hoje não bloqueiam nada. Elas precisam existir e ser respeitadas: habilitar ou desabilitar cada botão pela flag da conta selecionada. `CBO_BAIXA_CR`/`CBO_BAIXA_CP` (217/225 e 225/225) são das baixas e não desta tela.

### 1.2 Painel "Saldo" (`gpbSaldo`)

SQL `sqqSaldo`: `udmControleContasBancarias.dfm:759-777`.

```sql
SELECT MODALIDADE, IDPGTO, SUM(ENTRADAS) ENTRADAS, SUM(SAIDAS) SAIDAS, SUM(SALDO) SALDO_ATUAL, SUM(TOTAL_PRAZO) TOTAL_PRAZO FROM (
  SELECT F.MODALIDADE, M.IDPGTO,
         CASE WHEN M.VALOR > 0 THEN M.VALOR ELSE 0 END ENTRADAS,
         CASE WHEN M.VALOR < 0 THEN M.VALOR ELSE 0 END SAIDAS,
         CASE WHEN M.LIBERADO = 'S' THEN M.VALOR ELSE 0 END SALDO,
         CASE WHEN (M.LIBERADO IS NULL) OR (M.LIBERADO <> 'S') THEN M.VALOR ELSE 0 END TOTAL_PRAZO
  FROM MOV_CONTAS_BANCARIAS M INNER JOIN FORMAS_PGTO F ON F.IDPGTO = M.IDPGTO
  WHERE /*DATA*/ M.CODCONTA = :CODCONTA)
GROUP BY MODALIDADE, IDPGTO ORDER BY IDPGTO
```

O dataset sai por modalidade. **A tela mostra só os agregados** (`TAggregateField`, `udmControleContasBancarias.dfm:51-84`). Os 5 campos, na ordem visual da esquerda para a direita (`uControleContasBancarias.dfm:669-723`):

| Rótulo | Campo | Fórmula |
|---|---|---|
| Entradas | `TOTALENTRADA` | Σ VALOR>0, **liberado ou não** |
| Saídas | `TOTALSAIDA` | Σ VALOR<0 (negativo), **liberado ou não** |
| Total a Prazo | `TOTALPRAZO` | Σ VALOR onde `LIBERADO` ≠ 'S' ou nulo |
| Saldo Futuro | `TOTAFUTURO` | Σ(SALDO_ATUAL + TOTAL_PRAZO) (calc `udm...pas:318-323`) = Σ de tudo |
| Saldo Atual | `TOTALATUAL` | Σ VALOR onde `LIBERADO='S'` |

- **Sinal:** o legado grava `VALOR` já com sinal. O Apollo guarda o valor absoluto com `tipomovimento` (extrator `tools/cutover/etl/extrair.py:212-221`, mig 297). Na web, a fórmula equivalente é `valor_com_sinal = CASE tipomovimento WHEN 'D' THEN -valor ELSE valor END`.
- **INNER JOIN FORMAS_PGTO:** o movimento sem `IDPGTO` válido **não entra no painel** (no detalhamento entra, porque lá o JOIN é LEFT). Em produção é 1 linha, R$ −6.720,11 na conta 182. Reproduzir ou documentar a divergência.
- **"Posicionar saldo nesta data"** (`CheckBox1` + `JvDateEdit1`, `.pas:402-415`): ao sair do campo de data, se o check estiver marcado, injeta `M.DTEMISSAO <= 'data'` no `/*DATA*/`. **Quirks:**
  - `DTEMISSAO` é TIMESTAMP e 60% das linhas têm hora. A comparação com a data à meia-noite **exclui os movimentos do próprio dia que têm hora**.
  - Desmarcar o check só tem efeito depois de sair da data de novo.
  - A troca de conta reabre com o SQL que estiver valendo (`.pas:368-375`).
- **Botões do rodapé** (`uControleContasBancarias.dfm:44-380`): Transferência (`btnFecha`) · Liberar Movimentações · Lançamento de saldo · Chavear Fech. Caixa (`BitBtn2`) · Troca de valores · Imprimir · Sair. Os cinco primeiros têm `Tag=1` e estão sob `PERMISSOES` (§6).

---

## 2. Detalhamento da conta — `UconsMovBancaria` (form `FRMCONSMOVBANCARIAS`)

### 2.1 Filtros (`Panel1`, `UconsMovBancaria.dfm:545-717`)

- **Período** `edtDtIni` a `edtDtFim`, **padrão hoje a hoje** (`DefaultToday`). A tela **abre vazia**: só busca com "[ENTER] - Pesquisar" (o botão tem o nome enganoso `btnAddChequeTer`) ou com Enter nas datas ou no combo.
- **Movimentos** (`cmbMovimentos`): `TODOS` (padrão) · `LIBERADOS` (`LIBERADO='S'`) · `NÃO LIBERADOS` (`LIBERADO='N' OR NULL`) (`.pas:204-217`).
- **"Filtrar movimentações pela data de"** (`rgFiltro`): **Emissão** (padrão, `DTEMISSAO`) · Vencimento (`DTVENC`) · Liberação (`DTLIBERACAO`). É `TRUNC(data) BETWEEN ini AND fim` (`.pas:198-217`).
- **"Ordernar por histórico"** (`CheckBox1`, grafia do legado): só afeta a impressão (índice `data;HISTORICO` em vez de `data;CODMOVCONTA`, `.pas:572-582`).
- **"Imprimir Estilo Caixa"** (`cbxImprimeCaixa`): **muda também a grade**, não só a impressão. Com o check, a pesquisa troca o SQL por uma UNION que abre cada lote de baixa em uma linha por título (`.pas:219-377`):
  - sem lote: a linha como está;
  - `APAGAR_BX`: `-A.VALOR`, com `HISTORICO = P.RAZAO`;
  - `ARECEBER_BX`: `A.VALOR`;
  - reversões por `IDLOTE_REVERSAO`.
  - **Quirk:** o valor usado é o **valor do título** (`A.VALOR`), não o valor pago.
- **Filtro por documento (F3)** (versão 25/11/2019): F3 mostra ou esconde `panelFiltro`. Enter aplica `NRODOCUMENTO LIKE '%texto%'` no dataset em memória. O botão X limpa (`.pas:650-664, 738-758, 164-170`). A legenda "(F3) - Filtrar por cheque" só aparece se houver documento `Cheque%` no resultado (`.pas:492-497`). Em produção 2025+ não existe nenhum.

### 2.2 Grade de movimentos (`cxgridRecursos`, `UconsMovBancaria.dfm:813-876`)

SQL base: `UconsMovBancaria.pas:381-407`.

```sql
SELECT MOV.CODMOVCONTA, MOV.CODCONTA, MOV.VALOR, TRUNC(MOV.DTEMISSAO) DTEMISSAO, TRUNC(MOV.DTVENC) DTVENC, MOV.NRODOCUMENTO,
       TRUNC(MOV.DTLIBERACAO) DTLIBERACAO, MOV.LIBERADO, MOV.TIPOMOVIMENTO, MOV.HISTORICO, MOV.CODOPCONTA, MOV.IDLOTE, MOV.IDPGTO,
       F.MODALIDADE, OP.DESCRICAO, MOV.CONTABILIZADO, MOV.CODOPERADOR, O.NOME OPERADOR, MOV.IDLOTE_REVERSAO, MOV.REVERTIDO
FROM MOV_CONTAS_BANCARIAS MOV
LEFT JOIN OPERACOES_CONTA OP ON OP.CODOPCONTA = MOV.CODOPCONTA
LEFT JOIN FORMAS_PGTO F ON F.IDPGTO = MOV.IDPGTO
LEFT JOIN OPERADORES O ON O.CODOPERADOR = MOV.CODOPERADOR
WHERE MOV.CODCONTA = :conta <filtro de data/liberado>
ORDER BY MOV.DTEMISSAO, MOV.CODMOVCONTA
```

- **Colunas, na ordem:** Lote (`IDLOTE`) · Documento · Valor (**com sinal**) · Dt. Emissão · Dt. Vencimento · Dt. Liberação · Liberado (S/N) · C/D (`TIPOMOVIMENTO`) · Historico · Cod. Operador · Operador · Modalidade · Operação (`OPERACOES_CONTA.DESCRICAO`).
- **Ordem:** `DTEMISSAO` **com a hora**, depois `CODMOVCONTA`. Continua sendo `DTEMISSAO` mesmo quando o filtro é por vencimento ou liberação.
- **A grade não tem coluna de saldo corrente.** O saldo linha a linha só existe no relatório (§2.5).
- **Sem limite de linhas.** A web corta em 5.000.
- **Painel "Cheques próprios"** (`panelCheque` / `dbgChqProprios`): detalhe de `RELACAO_CHQ_PROP` → `CHQ_PROPRIO` do movimento corrente (`udm...dfm:1129-1134`), com a coluna "Fornecedores" (calc `udm...pas:266-309`, duplo clique lista os fornecedores). Em produção **`RELACAO_CHQ_PROP` tem 0 linhas e `CHQ_PROPRIO` 0 linhas desde 2020**. O painel está sempre vazio.

### 2.3 Rodapé de totais (`panelRodape`, `cdsSaldoDet`, `.pas:418-489`)

É uma linha por conta, com a mesma data (`DataFiltro`) e o mesmo filtro de liberado da grade:

| Rótulo | Fórmula |
|---|---|
| Saldo Anterior | Σ VALOR `LIBERADO='S'` com data de `MIN(TRUNC(DTEMISSAO))` da conta até `ini−1` (AVG de 1 linha) |
| Entradas | Σ VALOR>0 no período |
| Saídas | Σ VALOR<0 no período |
| Saldo Período | Σ VALOR `LIBERADO='S'` no período |
| Total a Prazo | Σ VALOR não liberado no período |
| Saldo Futuro | Saldo Período + Total a Prazo (calc `udm...pas:325-329`, **sem** o anterior) |
| Saldo Atual | **Saldo Período + Saldo Anterior** |

**Quirks:**
- Com o período sem movimento, o `WHERE` principal devolve 0 linhas e **todo o rodapé fica vazio, inclusive o Saldo Anterior**.
- Com "NÃO LIBERADOS", Saldo Período e Saldo Anterior dão sempre 0 (`LIBERADO='S' AND COALESCE(LIBERADO,'N')='N'`).
- O início do Saldo Anterior é `MIN(DTEMISSAO)` mesmo quando o filtro é por vencimento ou liberação.

### 2.4 Menu de contexto da grade (`PopupMenu1`, `UconsMovBancaria.dfm` fim)

| Item | Código | O que faz | Uso 2025+ |
|---|---|---|---|
| **Visualizar títulos** (e duplo clique/Enter na linha, `.pas:623-641`) | `.pas:863-868, 986-1061` | Se `IDLOTE_REVERSAO>0`, abre o lote de reversão como revertido; senão abre o `IDLOTE` com `REVERTIDO='S'`. Procura em `ARECEBER_BX` → consulta de baixa a receber (`TfrmConsRCBbx`), senão em `APAGAR_BX` → consulta a pagar (`TfrmConsAPGbx`), senão (não revertido) em `GET_CARTAOBX.LOTE` → consulta de baixa de cartão (`TfrmConsCRTbx`). Todas abrem **sem** os botões Reverter/Manutenção | só leitura, sem prova no AUDIT. 4.766 movimentos 2025+ são reversão (`IDLOTE_REVERSAO`/`REVERTIDO`) |
| **Mudar data de liberação** | `.pas:870-922` | Exige `DTLIBERACAO` não nula. Pede a data (`TfrmRetornaInfo`) e faz `UPDATE MOV_CONTAS_BANCARIAS SET DTLIBERACAO = :data WHERE CODMOVCONTA = :id`. **Não mexe em `LIBERADO`, não testa chaveamento nem contabilizado.** Pesquisa de novo e mantém a linha | **~13** (UPDATE S→S com `DTLIBERACAO` trocada para outro dia 00:00). Mais 15 com hora, que podem vir de outro fluxo |
| **Liberar Movimento** | `.pas:769-861` | Liberação de **uma linha** (§3.2) | incluso nos 3.655 |
| **Remover transferência** | `.pas:924-967` | §5 | 117 linhas / 76 lotes |

"Cheques de terceiros" e "Visualizar cartões" **não são itens de menu**. O cartão aparece só dentro de "Visualizar títulos". O botão `btnAddChequeTer` é o Pesquisar. Na consulta de cartão, `btnAddChequeTer.Visible := False` esconde o botão de pesquisa daquela tela.

### 2.5 Botões do rodapé

- **Imprimir** (`.pas:506-604`, habilitado só depois de pesquisar): carrega `Relatorios\extr - extrato conta corrente.fr3`.
  - Página 1 "EXTRATO - BOLETIM DE CONTA CORRENTE": Emissão · Liberação · Histórico · Entradas · Saídas · **Saldo**, sendo `SALDOATU = SALDOINICIAL + Σ VALOR das linhas LIBERADO='S'` na ordem do índice (script do .fr3). Linhas não liberadas aparecem, mas não mexem no saldo.
  - Página 2: totais (Saldo Anterior, Movimento (+)(−), Saldo Atual).
  - Página 3: cheques (se "Imprimir os Cheques").
  - Página 4 "finalizadoras": resumo por modalidade de **todo o histórico liberado** da conta (`cdsResumoPgto`, `udm...dfm:930-945`, **ignora o período**). Só imprime com `EXTRATO_CC_FINALIZADORAS='S'`, **valor em produção = 'S'**.
  - Opções: "Imprimir Documentos" (detalhe `sqqDoctos`: títulos AP/AR do lote), "Imprimir os Cheques" (A4 paisagem + coluna Parceiro), "Imprimir Estilo Caixa". Logo em `images\logorel<empresa>.jpg`.
- **Adiciona Lançamentos** (`btnLancMov`, `.pas:606-613`): abre `uCadMovContasBancarias`. **Habilitado só com `EMPRESAS.LCTO_FINANCEIRO='S'`** (`.pas:760-767`). Produção: nulo nas 5 empresas, e nenhuma linha em `PERMISSOES` para esse botão (`Tag=1`). **Morto** (§3.4).
- **Sair.**

---

## 3. Ações de escrita

### 3.1 Liberar Movimentações — botão da tela principal (`uControleContasBancarias.pas:197-278`) · **a mais usada**

1. Abre a pesquisa `GET_MOV_CONTAS_BANCARIAS` com **multisseleção** e filtro fixo `(LIBERADO <> 'SIM') AND (CODIGO_CONTA = conta)` (`.pas:211-215`). Colunas da view em produção: `DATA_EMISSAO, DATA_VENCIMENTO, NRO_CHEQUE, VALOR_CHEQUE, NRO_DOCUMENTO, VALOR, LIBERADO (SIM/NAO), HISTORICO, TITULAR, DEBITO_CREDITO, NRO_CONTA, CODIGO, CODIGO_CONTA, TIPO (ANTECIPACAO/CONSIGNACAO), CODCHQPROPRIO, IDLOTE, CODCONTABIL, DATA_LIBERACAO`. O fonte faz `SetDefault('TIPO_MOVIMENTO')`, coluna que a view de produção não tem **[binário novo alterou]**.
2. Pede **uma data** (`TfrmRetornaInfo`). Se cancelar, nada acontece.
3. Para cada linha selecionada:
   - se tem cheque próprio: `UPDATE CHQ_PROPRIO SET BAIXADO='S', DTBAIXA=data` (em transação própria);
   - no movimento: `LIBERADO='S'`, `DTLIBERACAO=data`;
   - se `MUDAR_EMISSAO_LIBERACAO_MOV='S'`, também `DTEMISSAO=DTVENC=data`. **Produção = 'N'**, então só `LIBERADO` e `DTLIBERACAO` mudam. O AUDIT confirma: nenhuma liberação trocou `DTEMISSAO`.
   - O `ApplyUpdates` é linha a linha, **sem transação global**.
4. Mensagem `'Alterações Realizadas com Sucesso'` (tmAlerta) se pelo menos uma gravou. Recarrega a lista.

**Sem trava** de chaveamento, contabilizado ou permissão por conta no fonte de 2020. **[binário novo]** Flag `HABILTIAR_LIBE_MOVIMENT` (hoje 'S' para todos).

### 3.2 Liberar Movimento — menu do detalhamento (`UconsMovBancaria.pas:769-861`)

É a mesma coisa para **uma linha** (a linha corrente):
- data (`TfrmRetornaInfo`); se cancelar, `'Operação cancelada pelo usuário.'`;
- baixa os cheques próprios do detalhe;
- `MUDAR_EMISSAO_LIBERACAO_MOV='S'` → `UPDATE ... SET LIBERADO='S', DTLIBERACAO, DTEMISSAO, DTVENC = data`, senão só `LIBERADO` e `DTLIBERACAO` (`.pas:784-804`);
- atualiza a linha na grade sem pesquisar de novo (versão 04/10/2019).

**Defeitos do legado (não copiar):**
- **não testa se a linha já está liberada**, então re-liberar sobrescreve `DTLIBERACAO`;
- o laço de cheques (`.pas:820-828`) só avança dentro do `if`: com `CODCHQPROPRIO` vazio, **laço infinito**. É inócuo porque não há cheque próprio em produção.

**Uso (AUDIT, UPDATE com `LIBERADO` anterior ≠ 'S' → 'S'):**

| Ano | Linhas | Contas | Última |
|---|---|---|---|
| 2025 | 1.978 | 4 | 24/12/2025 |
| 2026 | 1.677 | 4 | 23/09/2026 |

- 100% `Retaguarda.exe`, 100% modalidade DINHEIRO, 100% com `DTLIBERACAO` **anterior** ao dia do ato (liberação retroativa).
- Por minuto × conta: 938 eventos de 1 linha (menu ou botão com 1 seleção) · 609 de 2-5 · 98 de 6-20 · 3 acima de 20 (461 linhas). O botão multisseleção é o caminho principal.
- No fonte de 2020, **só estas duas rotinas** fazem N→S na `MOV_CONTAS_BANCARIAS`. `UConciliadorCartao.pas:61` libera `CARTAO`, não o movimento.
- Estoque a prazo hoje (emissão 2025+): PIX POS 6.996 (R$ 166.907,50) · DINHEIRO 790 (R$ 822.561,75) · IFOOD 2 66 · BOLETO 61. Mais 22 com `LIBERADO` nulo.

### 3.3 Lançamento de saldo (`uControleContasBancarias.pas:181-195` → `UlancamentoSaldo.pas`)

- **Senha ADM antes de abrir** (`dmPrincipal.SenhaAdministrativa('ADM')`). `uSenhaAdmin.pas:43-93` aceita qualquer uma destas:
  - `EMPRESAS.SENHAADMIN` decifrada;
  - a senha do dia `SYSAPOLLO`+dia+mês(2 dígitos);
  - **a `SENHARETAGUARDA` de qualquer operador**.
  - Mensagens: `'Favor informar a senha.'` e `'SENHA INCORRETA, VERIFIQUE!'`.
  - No Apollo já existe `modules/cadastro/senha-operacao.service.ts`. Reusar.
- **Campos (fonte 2020):**
  - "Valor a transferir" (`edtValor`, **com sinal**: positivo = crédito, negativo = débito);
  - "Modalidade" (`IDPGTO` da empresa, F3 → `GET_FORMAS_PGTO`; vazio → `'Informe a modalidade!'`; inexistente → `'Modalidade não encontrada!'`);
  - "Histórico" (`edtTexto`, **padrão `'SALDO INICIAL'`**).
  - Botão "&Efetuar".
- **Gravação** (`dmPrincipal.ValidaSaldoAnterior(conta, nomeModalidade, valor×−1, LancaMov=true, VerifSaldo=false, historico)`, `udmPrincipal.pas:2131-2250`):
  - trava: `data (hoje) <= CONTAS_BANCARIAS.DTCHAVEAMENTO` → `'Caixa FECHADO não é permitida alteração dos documentos!'` (`:2196`);
  - sem formas de pagamento na empresa → `'Não a formas de pagamento configuradas para empresa!'` (`:2213`);
  - **`VerifSaldo=false`: não testa saldo**;
  - insere 1 linha: `CODMOVCONTA=GetID`, `VALOR` = valor digitado (com sinal), `DTEMISSAO=DTLIBERACAO=DTVENC=hoje 00:00`, `NRODOCUMENTO=''`, `LIBERADO='S'`, `IDLOTE` nulo, `TIPOMOVIMENTO` = 'C' se valor>0 senão 'D', `HISTORICO`, `CODOPCONTA=0`, `IDPGTO` = a modalidade escolhida (localizada **pelo nome**), `CODOPERADOR` = operador (`:2140-2183`).
  - Depois, `ApplyUpdates` e `'Transação efetuada com sucesso!'`.
  - **Defeito:** `UlancamentoSaldo.pas:54-62` **ignora o retorno** de `ValidaSaldoAnterior`. Com o caixa chaveado, a mensagem de sucesso sai mesmo sem gravar.
- **[binário novo] provado pelo dado:**
  - **`LANCAMENTO_SALDO` (S/N) e `USUCAD_LANCAMENTO_SALDO`** (operador). São 100 linhas desde out/2022: S=20, N=80. Em 2025+: **26** (24 N + 2 S).
  - **`N` = lançamento financeiro, que CONTABILIZA** (integração automática). 78 das 80 linhas estão `CONTABILIZADO='S'`, e o AUDIT mostra o `CONTABILIZADO→S` no mesmo segundo do INSERT.
  - **`S` = ajuste/saldo inicial, que NÃO contabiliza** (0 das 20). Os históricos confirmam: `N` = "CONSORCIO", "EMPRESTIMO 4192915793" (R$ 1.000.000), "LIBERAÇÃO DE EMPRESTIMO…" (R$ 311.268,72); `S` = "SALDO INICIAL", "AJUSTE DE SALDO", "REND PAGO APLIC AUT MAIS".
  - **Data escolhida:** `DTEMISSAO=DTLIBERACAO=DTVENC` = data informada, retroativa em até ~2 meses (ex.: ato em 12/08/2025, emissão 15/07/2025). O fonte de 2020 usa hoje.
  - **Edição e exclusão existem:** 4 lançamentos de saldo excluídos em 2025+ (ex.: 1176200, apagado 43 s depois de um duplicado; 1219827 R$ 682.318, apagado em 28/08/2026) e 1 com a data corrigida (1182090: emissão 19/11/2026 → 19/11/2025, com estorno e reintegração contábil). **Não se sabe qual tela do binário novo faz isso.** No fonte de 2020, só o `uCadMovContasBancarias` (desabilitado) excluiria.
  - `IDPGTO` em produção: 1 ou 204 (as duas "DINHEIRO"). `CODOPCONTA=0`, `IDLOTE` nulo, `NRODOCUMENTO` nulo, `ORIGEM` nula.

### 3.4 Cadastro de movimentação — `uCadMovContasBancarias` ("Movimentação de Contas Correntes") · **MORTO**

É `TfrmCadMaster`, com a pesquisa `GET_MOV_CONTAS_BANCARIAS` travada em `CODIGO_CONTA = conta` (`.pas:196-217`).
- **Campos:**
  - Conta (só leitura);
  - Valor;
  - Emissão;
  - Vencimento;
  - Nº Documento (30);
  - Histórico (memo, 300);
  - Operação (`CODOPCONTA`, **obrigatório**, F3 `GET_OPERACOES_CONTA`, preenche `TIPOMOVIMENTO` com `OPERACOES_CONTA.TIPO`; inexistente → `'Operação de Conta não encontrado com o Código Informado. Verifique!'`);
  - "Recurso utilizado" (`IDPGTO` da empresa, `'Modalidade não encontrada!'`);
  - botão para cadastrar operações.
- **Gravar** (`.pas:116-132`): se `CODOPCONTA>0` → `LIBERADO='S'`, `DTLIBERACAO=DTEMISSAO`, VALOR = +|v| se 'C' e −|v| se 'D'. Com `CODOPCONTA=0` grava o que foi digitado, sem forçar `LIBERADO`. Depois vêm as mensagens genéricas do `uCadMaster` (permissões `BTNGRAVAR/BTNEDITAR/BTNEXCLUIR`, obrigatórios, `'Alterações gravadas com sucesso!'`).
- **Excluir** (`.pas:106-114`): com `IDLOTE>0` → `'Esse documento não pode ser excluido, pois contém referencia de Lote. Verifique!'`. Senão, `'Confirma a exclusão do registro?'`.
- **Prova de morte:**
  - `EMPRESAS.LCTO_FINANCEIRO` nulo nas 5 empresas, o que desabilita o botão;
  - `PERMISSOES` sem `FRMCONSMOVBANCARIAS`;
  - `OPERACOES_CONTA` = 1 linha (`0 TRANSFERENCIA C`);
  - `CODOPCONTA>0`: **0 linhas** em `MOV_CONTAS_BANCARIAS` e **0** no AUDIT desde 21/08/2020.
- **Recomendação:** não converter como tela. Ver §7 para o que fazer com o "lançamento manual" da web.

### 3.5 Chavear Fech. Caixa (`BitBtn2`, `uControleContasBancarias.pas:117-135`)

- Pede uma data (`TfrmRetornaInfo`) e grava na conta `DTCHAVEAMENTO=data`, `CODOPERADORCHAVEAMENTO`=operador (e mostra o nome). Não pede senha nem confirmação e não valida data.
- Efeito: todo `ValidaSaldoAnterior` (lançamento de saldo, baixas, abertura de caixa, sangria, haver) e a transferência (`Utransferencia.pas:156-181`) recusam data `<= DTCHAVEAMENTO` com `'Caixa FECHADO não é permitida alteração dos documentos!'`. A liberação, o "Mudar data de liberação" e o "Remover transferência" **não testam**.
- **Uso:** 2 das 36 contas têm valor (1899-01-01 e 2021-01-01). A trava **nunca dispara** para datas de 2025+. Não há AUDIT de `CONTAS_BANCARIAS`.

### 3.6 Troca de valores (`UFrmTrocaValores` / `UDMTrocaValores.pas:253-344`)

- Entrada (cheque/cartão/TEF) × saída (dinheiro) × taxa → 2-3 linhas na MOV com lote (históricos "Entrada em … referente a troca de valores.", "Saída em …", "Taxa referente a troca de valores."), mais `CAIXA` e `TROCA_VALORES`, em uma transação.
- **Uso: 0 em toda a história** (`TROCA_VALORES` vazia, nenhum histórico). `TROCA_VALORES` **não existe** no schema destino (vazia, então a carga não perde nada). Recomendação: fora, registrado como não usado.

### 3.7 Imprimir (tela principal, `.pas:156-179`)

- Pede o período (`TFrmPeriodo`) e imprime `URelCaixa` tipo 2 com `SomenteResumoCC=True`: só a página "Resumo das contas correntes" do `Caixa3 - Apuração do caixa.fr3` (versão, `Retaguarda_Versão.txt:7797`).
- SQL: `UCaixa.pas:370-431` `GetResumoCC(operador)`. Por conta **do operador** (`JOIN CONTAS_BANCARIAS_OP`): Titular, Nº Conta, Entradas, Saídas, Saldo Período (liberado), Saldo Período Pendente (a prazo), Saldo Anterior (liberado até ini−1).
- Sem prova de uso (só leitura). O Apollo tem `rel-caixa`, mas **sem o resumo de contas correntes** (grep "resumo" vazio em `rel-caixa.service.ts`).

---

## 4. Mensagens (textuais) e condições

| Mensagem | Condição | Onde |
|---|---|---|
| `Alterações Realizadas com Sucesso` | liberação em lote com pelo menos 1 gravação | `uControleContasBancarias.pas:273` |
| `Alteração não realizada, Erro do Banco:` + msg | erro no `ApplyUpdates` da conta (chaveamento) | `udmControleContasBancarias.pas:315` |
| `Favor informar a senha.` / `SENHA INCORRETA, VERIFIQUE!` | senha ADM do lançamento de saldo | `uSenhaAdmin.pas:46/89` |
| `Informe a modalidade!` | sair do campo modalidade vazio (lançamento de saldo) | `UlancamentoSaldo.pas:71` |
| `Modalidade não encontrada!` | `IDPGTO` inexistente para a empresa | `UlancamentoSaldo.dfm:296`, `uCadMovContasBancarias.dfm:640` |
| `Caixa FECHADO não é permitida alteração dos documentos!` | data do movimento `<= CONTAS_BANCARIAS.DTCHAVEAMENTO` | `udmPrincipal.pas:2196`, `Utransferencia.pas:163/178` |
| `Não a formas de pagamento configuradas para empresa!` | `FORMAS_PGTO` vazia para a empresa | `udmPrincipal.pas:2213` |
| `Transação efetuada com sucesso!` | depois do lançamento de saldo (**mesmo se a validação falhou**) | `UlancamentoSaldo.pas:62` |
| `Não é possivel alterar a data de documentos não liberados!` | "Mudar data de liberação" com `DTLIBERACAO` nula | `UconsMovBancaria.pas:888` |
| `Operação cancelada pelo usuário.` | cancelar a data (Liberar Movimento / Mudar data) | `UconsMovBancaria.pas:814/899` |
| `Deseja remover registro?` | Remover transferência (não contabilizada, ou contabilizada com integração AUTOMATICA) | `UconsMovBancaria.pas:936/957` |
| `A transferência já foi contabilizada.` | `CONTABILIZADO='S'` e `EMPRESAS.INTEGRACAO` ≠ 'AUTOMATICA' | `UconsMovBancaria.pas:952` |
| `Este registro não pode ser excluido pois não é transferência.` | `NRODOCUMENTO` ≠ 'TRANSFERENCIA' | `UconsMovBancaria.pas:966` |
| msg do estorno contábil | `TIntegracaoContabil.Estornar` ≠ ok (aborta) | `UconsMovBancaria.pas:944-948` |
| `Movimentação não possui lançamento de baixa a receber, a pagar ou cartão.` | Visualizar títulos sem lote correspondente | `UconsMovBancaria.pas:1016` |
| `Não é possível detalhar uma movimentação de cartão/cheque que foi revertida.` | revertido e não achado em AR/AP | `UconsMovBancaria.pas:1019` |
| `Vários fornecedores, clique duas vezes para ampliar` | cheque próprio com mais de um fornecedor | `udmControleContasBancarias.pas:306` |
| `Esse documento não pode ser excluido, pois contém referencia de Lote. Verifique!` | excluir movimento com `IDLOTE>0` (cadastro, morto) | `uCadMovContasBancarias.pas:110` |
| `Operação de Conta não encontrado com o Código Informado. Verifique!` | `CODOPCONTA` inexistente (cadastro, morto) | `uCadMovContasBancarias.dfm:599` |
| `Usuário não possui permissão para editar/excluir/gravar registros.` · `Confirma a exclusão do registro?` · `Registro excluído com sucesso!` · `Alterações gravadas com sucesso!` · `Ocorreram erros ao gravar alterações!` · `Campo com preenchimento obrigatório "X". Verifique!` | form-base do cadastro (morto) | `uCadMaster.pas:350/394/401/409/462/495/1731` |

`EMPRESAS.LCTO_FINANCEIRO` não gera mensagem: só habilita ou desabilita "Adiciona Lançamentos" (`UconsMovBancaria.pas:764-766`).

---

## 5. Transferência e "Remover transferência" (resumo; refeitos em paralelo)

- `Utransferencia`: origem fixa = conta selecionada (`uControleContasBancarias.pas:137-154`); 2 pernas com `NRODOCUMENTO='TRANSFERENCIA'` e o mesmo `IDLOTE` (`Utransferencia.pas:197, 258-279`); históricos `TRANSF. CONTA DESTINO: [ContaDestino]` / `TRANSF. CONTA ORIGEM: [ContaOrigem]`; `DTCHAVEAMENTO` das duas contas; saldo só se a origem tem `CODBCO=0` (contra o `TOTALATUAL` do painel, que pode estar "posicionado na data"); integração contábil.
- **[binário novo] configs, sem fonte (criadas em `AUDIT_CONFIGURACOES` em 08/05/2026 e 09/06/2026):**
  - `DIAS_RETROATIVOS_TRANSF_CONTAS_CORRENTES`: 30 no global e **90** em `CONFIGURACOES_ESPECIFICAS` (Modulo Retaguarda, empresas 1 e 2);
  - `DIAS_FUTUROS_TRANSF_CONTAS_CORRENTES`: 30;
  - `INFORMAR_CONTAS_TRANSFERENCIA_BANCARIA`: N no global e **S no Modulo Retaguarda**, o que liga a matriz `CONTAS_BANC_TRANSF_PERM` (19 linhas ativas);
  - `NAO_PERMITIDO_ALTERAR_DATA_TRANSF_MOV_CONTAS_BANCARIAS`: N (está no fonte, `Utransferencia.pas:431-437`).
- Uso 2025+ (INSERT no AUDIT): 512 linhas / 256 lotes pela tela, mais 1.152 / 576 lotes com `ORIGEM='OFX'` (lançamento automático da conciliação).
- Remover transferência (`UconsMovBancaria.pas:924-967`): `DELETE FROM MOV_CONTAS_BANCARIAS WHERE IDLOTE = :lote`. Uso 2025+: 117 linhas / 76 lotes, 81 linhas de origem OFX.

---

## 6. Permissões (`PERMISSOES`, `FORM='FRMCONTROLECONTASBANCARIAS'`)

- **OPCAOs** (43 operadores, 2 perfis): `FRMCONTROLECONTASBANCARIAS` (acessar) · `BTNFECHA` (Transferência) · `BTNLIBERAR` · `BTNLANCSALDO` · `BITBTN2` (Chavear) · `BTNTROCAVALORES`. O `uMaster.pas:616-700` desabilita os componentes com `Tag=1` que o operador não tem.
- A web usa `BTNGRAVAR`/`BTNEXCLUIR`, que **não existem** para esse form (há um mapeamento em `tools/cutover/rbac-equivalencias.md:41-42`). O certo é: leitura = `FRMCONTROLECONTASBANCARIAS`; liberar = `BTNLIBERAR`; lançamento de saldo = `BTNLANCSALDO`; transferência e remover = `BTNFECHA`; chavear = `BITBTN2`.
- Mais, **por conta**: as 8 flags de `CONTAS_BANCARIAS_OP` (§1.1) **[binário novo]**.

---

## 7. Schema: origem × destino

`ALL_TAB_COLUMNS` (owner PINHEIRAO) × `tools/cutover/schema-destino.json`:

| Tabela | Oracle | Destino | Diferenças |
|---|---|---|---|
| `MOV_CONTAS_BANCARIAS` | 37 colunas | 40 (+`idempresa`, `indr`, `dtcadastro`) | Todas presentes. ⚠️ **`DTEMISSAO` e `DTVENC` são TIMESTAMP no Oracle e `date` no destino**: 176.195 linhas (60%) têm hora em `DTEMISSAO` e 168.067 em `DTVENC`. Perde a ordem dentro do dia, que o legado usa (`ORDER BY MOV.DTEMISSAO`). Passar para `timestamp`. `CODOPCONTA` NOT NULL lá, nullable aqui. `ORIGEM` char(3) → varchar(10) (ok) |
| `CONTAS_BANCARIAS` | 28 | 28 | ok (`DTABERTURA` timestamp → date, sem uso de hora) |
| `OPERACOES_CONTA` | 6 | 6 | ok |
| `CONTAS_BANCARIAS_OP` | 12 | 13 (+`codrelacao`) | ok; o CRUD de contas preserva as 8 flags (`contas-bancarias.crud.ts:36`, mig 310) |
| `CONTAS_BANC_TRANSF_PERM` | 6 | 7 (+`codtransfperm`) | ok |
| `CONTAS_BANCARIAS_EMPRESAS` | 2 | 2 | ok (escopo da lista, §1.1) |
| `RELACAO_CHQ_PROP` | 3 (`CODRELACAOCHQ, CODMOVCONTA, CODCHQPROPRIO`) | **ausente** | vazia em produção (0 linhas). Pela regra "todos os campos", criar (é barato) |
| `AUDIT_MOV_CONTAS_BANCARIAS` | 36 | ausente | trilha do legado. Decisão de carga à parte (644k linhas) |
| `TROCA_VALORES` | — | ausente | vazia (§3.6) |
| `CONTAS_BANCARIAS_INT_SOMAASSET` | — | ? | fora desta tela |

`DATA_FECHAMENTO` (Oracle): preenchida **só** em `ORIGEM='FCP'` (83.770 linhas). Nula em 180.049 (sem origem) + 28.569 (OFX). Não serve como data do razão.

---

## 8. Gaps da web atual (corte-1) × legado

| # | Gap | Gravidade |
|---|---|---|
| G1 | **Data errada no extrato e no saldo "até a data":** `saldoDe`/`extrato` filtram e ordenam por `data_fechamento` (nula em 71%), e os gravadores `lancar`/`transferir` gravam `data_fechamento` em vez de `dtemissao/dtvenc/dtliberacao`. Consequências: o extrato com período some com 71% do movimento; a coluna "Data" mostra "—"; e o movimento novo do Apollo não aparece no filtro por emissão do legado | **alta** |
| G2 | **Liberação ausente** (botão com multisseleção + menu por linha, data informada, `LIBERADO/DTLIBERACAO`, `MUDAR_EMISSAO_LIBERACAO_MOV`, baixa do cheque próprio). É a escrita mais usada (3.655 linhas 2025+) | **alta** |
| G3 | **"Lançamento manual por operação" não corresponde a nada em produção.** Exige `codopconta>0`, e `OPERACOES_CONTA` migrada só tem a 0. Deve virar o **Lançamento de saldo**: senha ADM · modalidade (`IDPGTO`) · valor com sinal · histórico (padrão "SALDO INICIAL") · data · `LANCAMENTO_SALDO` S/N + `USUCAD_LANCAMENTO_SALDO` · `CODOPCONTA=0`, `LIBERADO='S'`, `DTEMISSAO=DTVENC=DTLIBERACAO=data` · contabiliza se N (integração AUTOMATICA) · trava `DTCHAVEAMENTO` | **alta** |
| G4 | `SALDO_INSUFICIENTE` no lançamento em conta caixa: sem âncora (`VerifSaldo=false`). Remover (já apontado em `g3-financeiro.md` #1) | média |
| G5 | **Painel de saldo incompleto:** a web mostra só "Saldo atual". Faltam Entradas, Saídas (**de tudo**, não só liberado, ao contrário do endpoint `saldo`, `controle-contas.service.ts:69-81`), Total a Prazo, Saldo Futuro e "Posicionar saldo nesta data". O endpoint `saldo` nem é chamado pela página | média |
| G6 | **Detalhamento incompleto:** faltam o filtro por Emissão/Vencimento/Liberação, o combo Todos/Liberados/Não liberados, o período padrão hoje-hoje, as 13 colunas (Lote, Documento, Dt. Emissão/Venc./Liberação, Liberado, C/D, Operador, Modalidade, Operação), o rodapé de 7 totais com Saldo Anterior, o filtro de documento (F3) e o limite (web 5.000, legado sem limite). O saldo corrente por linha da web não existe na grade do legado; ele é o `SALDOATU` do relatório (só liberados, a partir do Saldo Anterior). Pode ficar, mas ancorado como o relatório | média |
| G7 | **Lista de contas:** a web usa um select com todas as contas da empresa. O legado filtra por `CONTAS_BANCARIAS_OP` do operador + ativa, **sem** filtro de empresa (fonte 2020) ou com `CONTAS_BANCARIAS_EMPRESAS` (binário novo). O `conta()` da web recusa conta de outra loja (`idempresa = tenant`), o que barra os 15 operadores multi-loja. Faltam as colunas Dt./Usuário Chaveamento, o cabeçalho e o botão Conciliação OFX | média |
| G8 | **Visualizar títulos:** abrir a consulta de baixa AP/AR/cartão do `IDLOTE` (ou `IDLOTE_REVERSAO` como revertido). As telas `cons-apg-bx`/`cons-rcb-bx` já existem e precisam aceitar `lote` por parâmetro. A de cartão não | média |
| G9 | Mudar data de liberação (~13/ano) | baixa |
| G10 | Estorno: a web só apaga `origem IN ('MANUAL','TRANSF')`, e nenhuma linha migrada tem essas origens. O legado exclui transferência por `NRODOCUMENTO='TRANSFERENCIA'` (paralelo) e, no binário novo, o lançamento de saldo sem lote (4 em 2025+). O critério tem de ser "sem `IDLOTE`, `CODOPCONTA=0`, `ORIGEM` nula, não FCP", contabilizado → estornar a integração | média |
| G11 | Chavear Fech. Caixa (`DTCHAVEAMENTO` + operador) e a trava `'Caixa FECHADO…'` no lançamento e na transferência. Uso ≈ 0, mas a coluna existe e é lida por 6 fluxos | baixa |
| G12 | Impressões: extrato `.fr3` (4 páginas, com a página de finalizadoras ligada em produção) e resumo de contas correntes do Imprimir principal | baixa |
| G13 | RBAC: trocar `BTNGRAVAR/BTNEXCLUIR` pelos OPCAOs reais (§6) e respeitar as 8 flags por conta | média |
| G14 | Schema: `dtemissao`/`dtvenc` para timestamp; criar `relacao_chq_prop` | média |
| G15 | Movimento criado pelo Apollo (`lancar`/`transferir`) não preenche `nrodocumento`, `idlote`, `dtemissao`, `dtvenc`, `dtliberacao`, `liberado` explícito, `lancamento_saldo`. A transferência usa `origem='TRANSF'`/`idorigem`, e o legado usa `NRODOCUMENTO='TRANSFERENCIA'`/`IDLOTE` (paralelo) | alta (transferência no paralelo) |

---

## 9. Plano de cortes (por uso)

| Corte | Conteúdo | Prova de uso |
|---|---|---|
| **A — Razão certo + tela principal** | G1 (data = `DTEMISSAO` em todo leitor e gravador; migrar `dtemissao`/`dtvenc` para timestamp, G14) · lista de contas por operador + ativa + escopo de empresa (G7) · painel de 5 números com a fórmula exata e "posicionar na data" (G5) · RBAC por OPCAO + flags por conta (G13) | 7.615 acessos; dos 98.801 movimentos 2025+, 72.414 (os que não são FCP) hoje sairiam sem data |
| **B — Detalhamento** | filtros (data de / liberado / período), 13 colunas, ordem `DTEMISSAO,CODMOVCONTA`, rodapé de 7 totais com Saldo Anterior, filtro de documento, Visualizar títulos (G6, G8) | a porta de entrada de todas as ações por linha |
| **C — Liberação** | botão com multisseleção + menu por linha, data informada, `MUDAR_EMISSAO_LIBERACAO_MOV`, cheque próprio (inerte) + Mudar data de liberação (G2, G9) | **3.655 linhas / 1.648 eventos** em 2025+, ~13 mudanças de data |
| **D — Lançamento de saldo** | substituir o "lançamento por operação" (G3, G4): senha ADM, modalidade, valor com sinal, data, `LANCAMENTO_SALDO` S/N (contabiliza em N), `DTCHAVEAMENTO`; mais editar/excluir sem lote com estorno contábil (G10) | 26 lançamentos 2025+ (até R$ 1 mi) + 4 exclusões + 1 edição |
| **E — Chaveamento + impressões** | Chavear Fech. Caixa (G11) · extrato `.fr3` com a página de finalizadoras · resumo de contas correntes (G12) | chaveamento ≈ 0; impressão sem prova (só leitura) |
| **Fora (registrado)** | Adiciona Lançamentos / `uCadMovContasBancarias` (0 linhas `CODOPCONTA>0` na história) · Troca de valores (0 na história) · cheques próprios (0 linhas) | — |
| **Paralelo** | Transferência + Remover transferência (§5) | 256 lotes pela tela + 576 OFX; 76 lotes removidos |

---

## 10. Surpresas

1. **A mig 297 afirma que a liberação N→S "mora em `FuncoesApollo`, que não veio no fonte".** Está no fonte, em dois lugares (`uControleContasBancarias.pas:197-278`, `UconsMovBancaria.pas:769-861`), e é a escrita mais usada da tela.
2. **O lançamento manual da web é inutilizável com o dado real.** O catálogo de operações migrado tem só a `0=TRANSFERENCIA`, que a web exclui (`codopconta > 0`).
3. **O extrato da web está ancorado numa coluna que só o fechamento de caixa preenche** (`data_fechamento`, nula em 71%).
4. **O binário novo transformou o Lançamento de saldo** em "lançamento financeiro que contabiliza" (`LANCAMENTO_SALDO='N'`) × "ajuste que não contabiliza" (`'S'`), com data retroativa, edição e exclusão. É usado para empréstimos e consórcios de valor alto.
5. **8 permissões por operador × conta** em `CONTAS_BANCARIAS_OP` que o fonte não conhece. Hoje estão todas 'S'.
6. **A senha ADM do legado aceita a `SENHARETAGUARDA` de qualquer operador** (`uSenhaAdmin.pas:77-85`).
7. **Troca de valores, cheques próprios e cadastro de movimentação têm uso zero** em toda a história de produção.
8. Os DELETEs do AUDIT 2025+ vêm quase todos de outros fluxos: 811 reabertura de caixa (FCP), **770 via `SQLToolsU.exe`** (manutenção direta no banco) e 114 com `IDLOTE=0`. Os desta tela são só os 117 de transferência e os 4 de lançamento de saldo.

---

## 11. Conversão — corte A (24/09/2026)

- **Mig 335:** `mov_contas_bancarias.dtemissao`/`dtvenc` → `timestamptz` (a hora do legado; a grade ordena por ela) e
  `relacao_chq_prop` criada (G14). A integração de transferência compara pelo dia no fuso da loja.
- **Mig 336 + controller:** RBAC pelas opções reais — a tela (leitura), `BTNFECHA` (transferir/remover), `BTNLANCSALDO`
  (lançamento); `BTNLIBERAR`/`BITBTN2` semeados para os próximos cortes (G13).
- **Lista** `GET contas`: as contas do operador (`CONTAS_BANCARIAS_OP`) e ativas, **sem filtro de loja** (o fonte de 2020; a
  hipótese do `CONTAS_BANCARIAS_EMPRESAS` não tem prova), com o chaveamento e as 8 permissões por conta. Toda ação exige o vínculo
  e a flag da ação (saldo → `VISUALIZAR_SALDOS`, extrato → `HABILTIAR_DETALHAR_CONTA`, transferir → `HABILITAR_TRANFER`,
  lançar → `HABILTIAR_LANCA_SALDO`) (G7).
- **Painel** `GET saldo`: os 5 números do `sqqSaldo` com o `INNER JOIN FORMAS_PGTO` (Entradas e Saídas de tudo, a prazo,
  futuro, atual) e "posicionar na data" — o dia inteiro (o legado corta à meia-noite; divergência consciente) (G5). O saldo é da
  conta, sem filtro de empresa na movimentação (G1). O lançamento grava a forma DINHEIRO quando não vem outra.
- Destinos da transferência: qualquer conta ativa (`GET destinos`). Smoke §198 (4 casos) + §47h/§160/§161 ajustados.

Próximos: B (detalhamento), C (liberação — a escrita mais usada), D (lançamento de saldo no lugar do lançamento por operação).

## 12. Conversão — corte C, liberação (24/09/2026)

`GET a-liberar` (a pesquisa do botão: não liberados da conta), `POST liberar` (multisseleção ou uma linha; a data vira
`DTLIBERACAO` à meia-noite e `LIBERADO='S'`; `MUDAR_EMISSAO_LIBERACAO_MOV='S'` muda também emissão/vencimento; baixa o cheque
próprio da RELACAO_CHQ_PROP; numa transação; a linha já liberada é ignorada — o menu do legado re-liberava e sobrescrevia a
data) e `POST :id/data-liberacao` ("Mudar data de liberação": só a data do já liberado; "Não é possivel alterar a data de
documentos não liberados!"). RBAC `BTNLIBERAR` + flag `HABILTIAR_LIBE_MOVIMENT`. Tela: botão "Liberar movimentações" com a
lista e a data; no extrato, Liberar / Mudar data / Remover por linha. Smoke §199 (3 casos).
