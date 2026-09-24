<!-- Recon do corte 4 (acessórios) do fechamento de caixa, 24/09/2026 — produção somente leitura + fonte de mai/2020. -->

# Fechamento de caixa, corte 4: especificação dos acessórios

Tudo abaixo é só leitura. Li o fonte de mai/2020 e medi na produção Oracle (`SET TRANSACTION READ ONLY`, só SELECT). Nada foi alterado em /Library/Apollo. Os scripts estão em `/private/tmp/claude-501/-Library-Apollo/6bf25248-8079-4341-a66c-543c7c137e42/scratchpad/c4/` (a sessão reiniciou uma vez e perdeu os primeiros arquivos; os números abaixo são das consultas refeitas).

## Correções de premissa, antes de tudo

- **F5 e F6 não ficam na tela principal.**
  - Na tela principal, F5 abre "Caixas em aberto" (`uFechamentoCaixa.pas` `FormKeyDown`).
  - F5 = observação (CAIXA_OBS) e F6 = transferência ficam **dentro do diálogo Caixas em aberto** (`Ucxaberto.pas` `FormKeyDown`).
  - Na finalização, F5 põe o foco em Cancelamentos e F6 abre "Vendas com descontos" (`UfinalizaFechamento.pas:1430`).
- **Configurações que o binário novo migrou do XML da estação para CONFIGURACOES:**
  - `DELETAR_DOCUMENTO_FCX` (id 541): 'S' no Módulo Retaguarda, na Empresa 1 e para os usuários 59, 102, 762 e 1802.
  - `NAO_ALTERAR_DOC_FECHAMENTO_CAIXA` (542): 'S' no Módulo, na Empresa 1 e para os usuários 59, 102, 504, 762 e 1802, desde 28/04/2025.
  - `DATA_PROMISSORIA_AVULSA` (540): nulo.
  - No fonte de 2020 eram as chaves XML 'DELETAR DOCUMENTO FCX' e 'NAO ALTERAR DOC FECHAMENTO CAIXA'.
- **RBAC.** Só a FRMFECHAMENTOCAIXA tem componentes: BTNABRIR, BTNCXABERTO, BTNFECHA e FECHAMENTOCAIXA1 (item de menu "Fechamento de caixa", Tag=1) com 170 linhas / 68 operadores; BTNLANCPROV e BTNREABRIR com 117 / 44. O diálogo de documentos, a observação e as impressões não têm RBAC; o controle é por configuração e por liberação de supervisor.
- **Não existe log de impressão.** Não há LOG_IMPRESSAO (só LOG_IMPRESSAO_ETIQUETA), e LOG_SISTEMA e MENUEXPRESS não registram as impressões. Por isso o uso das impressões é **sem substrato** para medir.

---

## 1. Documentos manuais no diálogo de documentos (UConsDocs) — **VIVO, é o acessório mais usado**

### Habilitação (`UConsDocs.pas` FormShow :1200-1245)

1. **Padrão por conjunto de documentos:**
   - Recarga: sem edição e sem marcação.
   - Correspondente e voucher: nada.
   - Sangria/suprimento: sem edição e sem marcação; inserção só em "sangria em dinheiro" e "suprimentos" (cheque e outras: não).
   - Troco solidário: sem edição e sem marcação.
   - A Receber, cheque, cartão, ticket e devolução: tudo.
   - Modo consulta: tudo desligado.
2. **Depois disso**, para tudo que não é sangria/suprimento: se `ValorConfiguracao('USUARIOS_PERMITIDOS_EXCLUIR_DOCUMENTOS_FECHAMENTO') = 'S'` (**o global de produção é 'S'**):
   - com `ControleManutencao='P'`: só edição (inclusive em consulta);
   - senão: edição, inserção, exclusão e marcação (**inclusive em consulta**).
3. **`ControleManutencao`** vem do duplo clique no diálogo Caixas em aberto:
   - 'P' = turno com STATUS F/S **e** fechado no PDV (`CAIXA_PDV.HORASAIDA > 0`);
   - senão 'T'.
4. **Rodapé de atalhos:** `[F2] ou [ENTER] Editar - [INSERT] Inserir - [DEL] Deletar - [T] Marcar/Desmarcar Todos - [ESC] Confirmar`, cada item só quando habilitado.

### Editar (F2/Enter) — `AlteraDocs :2349`

- **Mensagens e travas:**
  - Grade vazia: "Não existem documentos para editar."
  - Com `NAO_ALTERAR_DOC_FECHAMENTO_CAIXA='SIM'`, o fonte pede `SenhaAdministrativa('ADM')`.
  - **O dado desmente essa trava na produção.** Com 'S' desde 28/04/2025, as edições de cartão continuaram no mesmo ritmo (2–4 mil por mês, 24 usuários comuns). Portanto, no binário, 'S' é "permitido", como diz a descrição ("Permissão para alterar registros…"). **Não pedir senha.**
  - Sangria/suprimento: `UsuarioPermitido('USUARIOS_PERMITIDOS_ALTERAR_SUP_SAN_FECHAMENTO', 'Usuário não permitido a editar registros.')` (inalcançável, porque a edição é desligada ali).
- **Cartão.** A tela é escolhida por `TELA_LANCTO_CARTAO_DOCTO_FINALIZADORAS`:
  - na Empresa 1 = 'C', que não está na lista do fonte, logo vale "completa";
  - no global = 'Ambas', aparece a pergunta "Qual tela será aberta?" com "Cadastro completo de cartões;Cadastro básico" e padrão `OPCAO_PADRAO_INSERIR_FIN_CARTAO`=0 (completa).
- **Tela completa: TFrmCadCartao em `maFechamentoCaixa`** (`UcadCartao.pas`):
  - empresa, modalidade e data de venda bloqueadas;
  - com 'P', `AjustarComponentesAcesso`: **só a operadora é editável**;
  - validações ao gravar: "Informe o valor do cartão.", "O número de parcelas deve ser menor que 200.", "Informe a operadora do cartão.";
  - grava LOG "Lançamento de Cartões"/Alterou e depois `DTULTIMALTERACAO=now` e `USULTALTERACAO=usuário`.
- **Tela básica (`frmManipulaFin`, página 2):**
  - campos: valor, operadora/rede, NSU, autorização e nº de parcelas; com 'P', valor, data e parcela ficam desabilitados;
  - com n parcelas: a linha atual fica com `round(total/n,2)` e as parcelas 2..n são criadas com o resto na última (NROPARCELA i+1, LIBERADO 'N', CHAVE).
- **Colunas gravadas (só as do `sqqDocsCRT`):** VALOR, CODOPERADORA, NSU, NSUHOST, AUTORIZACAO, CODREDE, NROPARCELA, OBS, DTULTIMALTERACAO, USULTALTERACAO.
  - `CARTAO.OPERADORA` (texto) **não é atualizado**: o join traz `o.operadora`. Isso é coerente com o dado: 237 mil de 318 mil cartões de 2026 têm o texto diferente do cadastro. Quem lê deve fazer join em OPERADORAS.
- **A Receber:** campos valor, DTVENC, parceiro (obrigatório: "Obrigatorio a informação do cliente!") e OBS.
- **Cheque:** valor, BOMPARA, parceiro, titular, banco e nº do cheque.
- **Devolução:** nº do documento, valor e tipo V/D.
- **Rastro de cada edição:**
  - HISTORICO (TABELA = tabela, CODDOC = valor de NROCUPOM/NROCHEQUE/CODHISTDEVOLUCAO, DATA = só a data): `ALTERACAO DO DOCUMENTO <chave>, VALOR: DE <ant> PARA <novo>, NO DIA dd/mm/aaaa DA ECF: <pdv>, FEITO PELO OPERADOR: <cod> <nome>`;
  - a chave vazia vira '0'.

### Inserir (Insert) — `KeyDown :1854-2210`

A data usada é a data do caixa. Todo documento leva CHAVE do turno, CODOPERADOR = operador do caixa e CODPDV.

- **A Receber (RCB).**
  - Diálogo "Contas a receber"; parceiro padrão 0 "AO CONSUMIDOR"; DTVENC = data da linha + `DATA_PROMISSORIA_AVULSA` dias.
  - Grava ARECEBER: CODRCB seq, VALOR, DTVENC, DTVENDA = data do caixa, CODPARCEIRO, CODOPERADOR, CODPDV, CODEMPRESA, IDPGTO = a forma, QUITADA 'N', TXJUROS = `EMPRESAS.TXJUROPADRAO`, **ORIGEM 'F'**, OBS, CHAVE; depois NROCUPOM = '0'.
  - Validação: "O valor deve ser maior que zero."
- **Cartão.**
  - Tela completa: CODVENDCARTAO seq, DTVENDA = data do caixa, CODOPERADOR, CODPDV, IDEMPRESA, IDPGTO, NROPARCELA 1, LIBERADO 'N', CHAVE, **DTCADASTRO=now**; a tela completa aceita NROCUPOM e NROPEDIDO (vazio vira '0').
  - Tela básica: n linhas com `round(total/n,2)` **sem ajustar o resto**, mais CODOPERADORA, CODREDE, NSU e AUTORIZACAO.
  - Na tela básica, a operadora é obrigatória ("Informe a operadora do cartão.").
- **Cheque:** CODCHQ, VALOR, BOMPARA, DTEMISSAO, parceiro, CODBCO, TITULAR, NROCHEQUE, IDPGTO, BAIXADO 'N', SANGRIA 'N', IDENTIFICADOR = GUID e CHAVE.
- **Devolução:** HIST_DEVOLUCAO com CODCAIXA = `CAIXA_PDV.CODCAIXA`, NRODOCUMENTO, VALOR e TIPO_DEVOLUCAO V/D.
- **Recarga:** HIST_RECARGA com DATA, VL_RECARGA, OP_TELEFONIA, NSU, NSUHOST e CODCAIXA.
- **Rastro de toda inserção (menos sangria):**
  - LOG (`TLog`, com FORMULARIO = "Contas a receber" / "Cartões" / "Cheque pré" / "Devolução" / "Recarga"; a tela completa grava o seu próprio "Lançamento de Cartões");
  - HISTORICO `INCLUSAO DE DOCUMENTO , VALOR: x, NO DIA d DA ECF: p, FEITO PELO OPERADOR: …`.
- **Sangria em dinheiro e suprimento:**
  1. Liberação: `UsuarioPermitido('USUARIOS_PERMITIDOS_ALTERAR_SUP_SAN_FECHAMENTO', 'Usuário não permitido a inserir registros.')`. São 13 usuários na produção, e **sempre pede o login do supervisor** quando a lista não é vazia; sem lista, pede qualquer login.
  2. Com `ENVIA_SANGRIA_SUPRIMENTO_CONTA_FISCAL='S'` (**Módulo Retaguarda = 'S'**): conta fiscal = `PARCEIROS.CODCONTA` do liberador. Sem ela: "A conta corrente do fiscal de caixa não foi informada ou o parceiro não foi definido no cadastro de operadores."
  3. Diálogo `frmManipulaFin`, página 4:
     - forma: rádio com as formas `PERMITE_SANGRIA_PDV='S'` e DESTINO CXA; sem nenhuma: "Nenhuma forma de pagamento foi definida para realizar a sangria. Verifique o cadastro de formas de pagamento.";
     - "Informe a forma da sangria."; valor > 0; cheque: seleção de cheques ("O valor informado difere da soma dos cheques selecionados. Deseja atualizar para a soma dos cheques?"); descrição.
  4. MOV_CONTAS_BANCARIAS: `ID_CODMOVCONTA.NEXTVAL`, CODCONTA = conta fiscal, DTEMISSAO/DTVENC/DTLIBERACAO = data do caixa, LIBERADO 'S', CODOPCONTA 0, CODDESTINO 0, CONTABILIZADO 'N', CHAVE, IDENTIFICADOR = GUID.
     - Sangria: VALOR +v, TIPOMOVIMENTO 'C', IDPGTO = a forma.
     - Suprimento: VALOR −v, 'D', IDPGTO = forma DINHEIRO.
     - HISTORICO da MCB: `Sangria realizada no caixa <pdv>, no dia dd/mm/aaaa através do fechamento de caixa` (ou "Suprimento realizado"; com cheque: `, cheque nº N`).
  5. HIST_SANGRIA_SUPRIMENTO:
     - CODHISTSANGRIA seq, IDEMPRESA, DATA = data do caixa, IDPGTO (**0 no suprimento**), CODPDV, DESCRICAO, NRODOCUMENTO (nº do cheque), VALOR, CHAVE;
     - CODOPERADOR = operador do caixa, RESPONSAVEL = liberador, CODOPERADOR_CADASTRO = logado;
     - IDENTIFICADOR (do cheque), IDENTIFICADOR_MOVCB, TIPO 'SAN'/'SUP';
     - depois, tudo marcado. **Não grava HISTORICO nem LOG de inclusão.**

### Excluir (Del) — `TeclaDelete :1639`

1. Com `DELETAR_DOCUMENTO_FCX` 'N'/vazio: "Você não tem permissões para excluir documentos. Verifique." Na produção vale 'S'.
2. Sem registros: "Não existem documentos para excluir."
3. Confirmação: "Deseja realmente excluir o registro?"
4. Liberação:
   - sangria/suprimento: `USUARIOS_PERMITIDOS_ALTERAR_SUP_SAN_FECHAMENTO` ("Usuário não permitido a excluir registros.");
   - demais: os usuários 'S' em `USUARIOS_PERMITIDOS_EXCLUIR_DOCUMENTOS_FECHAMENTO` (1, 59, 701) com `ChamaLiberacaoLogin` ("O usuário informado não tem permissão para excluir documentos."). No LOG_LIBERACOES isso aparece como LIBERACAO 'EXCLUIR DOCUMENTOS'.
5. HISTORICO: `EXCLUSAO DO REGISTRO <campo>: <doc>, VALOR: v, NO DIA <data> DA ECF: <pdv>, FEITO PELO OPERADOR: <cod> <nome>`, com AUXILIAR = chave e DATA = now com hora.
6. DELETE físico (CARTAO, ARECEBER, CHEQUE, TICKET, HIST_*); sangria também faz `DELETE MOV_CONTAS_BANCARIAS WHERE IDENTIFICADOR = IDENTIFICADOR_MOVCB`.

### Uso em produção (HISTORICO + LOG_LIBERACOES + AUDIT_CARTAO + dado; 2025 / 2026)

| operação | 2025 | 2026 (até 24/09) | último |
|---|---:|---:|---|
| **CARTAO editar** (HISTORICO "ALTERACAO DO DOCUMENTO") | 29.127 | **15.673** | 22/09/2026 |
| ↳ o que se edita (AUDIT_CARTAO, Retaguarda, 2026) | | **15.354 reclassificações CODOPERADORA 144 "CARTAO A CLASSIFICAR" → bandeira real + NSU preenchido** (POS ids 6/208, PIX POS 101); 96% antes do efetivar, 621 (4%) depois, em consulta | |
| ARECEBER inserir (ORIGEM 'F') | 1.295 | **631** (626 DEVOLUCAO + 5 CONVENIO, 609 conciliados) | 23/09/2026 |
| ARECEBER editar / excluir | 155 / 9 | 173 / 14 | 21/09/2026 |
| CARTAO inserir (tela completa, NROCUPOM digitado ou '0') | 365 | **459** | 23/09/2026 |
| CARTAO excluir | 37 | 100 | 04/08/2026 |
| Sangria/suprimento inserir | — | **133 SAN + 24 SUP** (2025–26: 284 + 25; MCB 310, R$ 62.568,70; 243 liberações) | 22/09/2026 |
| Sangria/suprimento excluir | 62 | 62 | 22/09/2026 |
| TICKET excluir | 4 | 0 | 05/09/2025 |
| CHEQUE, DEVOLUÇÃO, RECARGA (qualquer operação) | 0 | 0 | **morto** (HIST_DEVOLUCAO/RECARGA com 0 linhas) |

---

## 2. Recarga, voucher, troco solidário e correspondente — **MORTOS, com uma exceção residual**

- **Abertura dos diálogos.** Enter nos campos da finalização abre o UConsDocs com `cdsRecarga` (HIST_RECARGA), `cdsCorrespondente` (HIST_CORRESPONDENTE.VL_LANCAMENTO), `CDSVoucher` (HIST_VOUCHER) ou `cdsTrocoSolidario` (HIST_TROCO_SOLIDARIO).
  - Filtros: empresa, PDV, operador, chave, data.
  - SEL é campo calculado sempre True: tudo conta.
- **Só a recarga devolve o total ao campo** (`edtRecarga.Value := TotalDocts`); os outros só abrem a lista.
- **O que dá para editar pelo retaguarda:**
  - Inserir: só recarga (acima).
  - Excluir: todos (HISTORICO + DELETE), porque a configuração global 'S' religa tudo.
  - Voucher, correspondente e troco não têm ramo de inserção nem de edição.
- **Produção:** HIST_RECARGA, HIST_CORRESPONDENTE e HIST_VOUCHER com 0 linhas. HIST_TROCO_SOLIDARIO tem 11.134 linhas, mas só 15 em 2025 e 11 em 2026 (última em 15/08/2026). Nenhum HISTORICO de exclusão dessas tabelas desde 2025.
- **Veredito:** recarga, voucher e correspondente estão **mortos (tabela vazia)**. O troco solidário é **residual**: a lista já existe no corte 1; basta leitura, sem inserir nem excluir.

---

## 3. Lançamento provisório (UlancProv, BTNLANCPROV) — **VIVO, mas só como ferramenta de suporte**

- **Onde fica:** botão "&Lançamento provisório", visível só no modo PDV e com a permissão BTNLANCPROV. Usa PDV/CODPDV/data da tela principal e a chave do turno.
- **Cabeçalho (DADOSCX, chave data + CODPDV + operador):**
  - Campos: fiscal de caixa (pesquisa `TIPOOP='Supervisor(a)'`), GT inicial, GT final, venda bruta (= GT final − GT inicial), cancelamentos, descontos, venda líquida (= bruta − desconto − cancelamento).
  - Gravado ao fechar a janela (Post + ApplyUpdates).
- **Por modalidade (ao sair do campo):**
  - Valor ≠ 0: insere CX_VENDAS (CODCXVENDAS seq, DATA = data do caixa, NROPDV, CODOPERADORA = operador, **CODFISCALCAIXA**, NROPEDIDO '00000', OPERACAO = modalidade, 'C', VALOR, CHAVE, COO 0, GNF 0, e pelo `OnNewRecord` IDEMPRESA, **LANC_PROVISORIO 'S', LANC_PROVISORIO_DATA=now, LANC_PROVISORIO_USUARIO=logado**).
  - Sangria > 0: pede a conta destino (a conta tem de ser caixa: "Este conta corrente é conta bancária, não permite operações de caixa!"; vazia: "É necessário informar a conta corrente!"). `ValidaSaldoAnterior` lança MCB e insere CX_VENDAS OPERACAO 'SANGRIA' 'D'.
  - Suprimento > 0 com DINHEIRO: pede a conta origem, `ValidaSaldoAnterior` com verificação de saldo, e insere 'SUPRIMENTO' 'C'.
  - Del na grade: "Deseja remover está modalidade?" e DELETE.
- **Botão "Efetivar lançamento"** só valida: Σ(VALOR + SANGRIAS − SUPRIMENTOS) das linhas abertas do turno ≠ venda líquida dá "Venda liquida diverge do total informado!". Senão: "Registros gravados com sucesso!". As linhas **já foram gravadas** em cada saída de campo.
- **Produção:**
  - DADOSCX tem 133 linhas desde 2020 (13 em 2025, 2 em 2026, a última em 14/08/2026), todas com GT/venda nulos: só o fiscal é gravado.
  - CX_VENDAS provisórias com valor ou fiscal: 14 em 2025 e 1 em 2026 (21/08/2026), **todas pelo usuário 1** (suporte), são ajustes entre modalidades (ex.: DINHEIRO −68,23 / CARTOES +68,23).
  - Os ramos de sangria e suprimento: 0 uso.
- **Veredito:** vivo só para o suporte (cerca de 1 por mês). Implementar só o ramo de modalidade mais DADOSCX; sangria e suprimento estão mortos.
- Lembrete: as linhas '00000' com `LANC_PROVISORIO='S'` zeradas vêm do completar automático (`CX_abertos`), que já está implementado.

---

## 4. F5 observação e F6 transferência (diálogo Caixas em aberto)

### F5 — Observação de divergência (`uObsDivergenciaCx`, CAIXA_OBS) — **quase morto**

- **Precondição:** a grade não pode estar vazia.
- **Chave de leitura:** `NROPDV AND CODOPERADOR AND TRUNC(DATA) = data do filtro`. Não usa CHAVE nem empresa, então vários turnos no mesmo dia dividem uma observação.
- **Gravação:** se existe, edita; senão insere NROPDV, CODEMPRESA = logada, CODOPERADOR, DATA = data do filtro (00:00) e OBS (memo). OK = Post + ApplyUpdates; Sair ou Esc = cancela. A tabela não tem PK.
- **Onde aparece:** coluna "Obs. de divergência" (`CX_OBS`) do relatório FechamentoCaixa.fr3 (`sqqDoc LEFT JOIN CAIXA_OBS`).
- **Produção:** 21 linhas ao todo; 3 em 2025 (14–16/08/2025, empresa 2, PDVs 52/53, ex.: "QUEBRA DE CAIXA -LAYS VITORIA- VALOR-48,88"); **0 em 2026**.

### F6 — Transferência de espécie (`Utransferencia`) — **função viva, atalho sem substrato**

- **O que é:** a mesma tela do Controle de Contas Bancárias.
  - Validações: "Informe a conta de origem!", "Informe a conta de destino!", "Valor de transferência deve ser maior que zero!", "A conta de destino deve ser diferente da conta de origem.", DTCHAVEAMENTO ("Caixa FECHADO não é permitida alteração dos documentos!"), "Saldo insuficiente!" (conta caixa).
  - Grava 2 MCB 'TRANSFERENCIA' com IDLOTE, integra contábil se AUTOMATICA e oferece recibo TransferenciaEspecie.fr3.
- **Defeito do legado:** a tela depende de `DmControleContasBancarias`, que só a FRMCONTROLECONTASBANCARIAS cria. Pelo F6 dá AV se aquela tela não estiver aberta.
- **Produção:** 1.096 MCB em 2025 e 451 em 2026 (787 lotes), mas não dá para separar a origem.
- **Apollo:** a transferência já existe (`cadastro/controle-contas` `POST transferir`). Basta o atalho.

---

## 5. CARTAO criado na refechada (`ReabriuCaixa`) — **regra viva e defeituosa; a causa foi provada**

### Regra exata do fonte

- **Quando `ReabriuCaixa` vale True** (`uFechamentoCaixa.pas:405-415` e `:1073-1076`):
  - no reabrir guarda `Operador:=IntToStr(operador)`, `nroPDV`, `DtInicial`;
  - no próximo "Fechar" com o mesmo operador, PDV e data da tela, passa True e zera (vale uma vez por sessão da tela).
- **Em `RealizaConf`** (`UfinalizaFechamento.pas:2440-2485`), só para forma **DESTINO='CRT'** (não TEF) e só em modo fechamento, ao abrir os documentos da modalidade:
  - para cada linha de CX_VENDAS do turno com `OPERACAO = modalidade` (inclusive a '00000' zerada), se a lista de cartões não conciliados (PDV, operador, chave, `IDPGTO = forma OR modalidade DINHEIRO`) não tem `Locate('NROPEDIDO;VALOR', [cx.NROPEDIDO, cx.VALOR.AsString])`, insere CARTAO;
  - colunas: CODVENDCARTAO seq, DTVENDA = data do caixa, VALOR = cx.VALOR, CODOPERADOR, **CODOPERADORA 0**, CODPDV, NROPEDIDO, IDEMPRESA, IDPGTO, LIBERADO 'N', CHAVE = cx.CHAVE, NROCUPOM nulo;
  - `ApplyUpdates` imediato: fica gravado mesmo se o usuário cancelar.

### Causa das duplicatas (medida)

A causa é **comparação em ponto flutuante**. O VALOR da CX_VENDAS vem por BCD→double (mantissa × 0,01) e o do CARTAO pelo double mais próximo. Valores como 19,99, 23,99, 26,58, 47,98 e 21,40 nunca casam; 5,99, 27,88 e 81,26 casam.

- Nas 24 chaves afetadas desde 2025, a separação é total: 160 linhas "divergentes em float" com gêmeo viraram duplicata; 422 linhas sem divergência em float e com gêmeo não geraram nada.
- Cada reabertura do diálogo na mesma sessão **duplica de novo**, porque o mesmo erro de float acontece contra as próprias linhas criadas. Daí os pares, como os 16 NROPEDIDOs × 2 da chave 02010426104654.

Linhas criadas (CODOPERADORA=0 e NROCUPOM nulo):

| | 2025 | 2026 |
|---|---:|---:|
| duplicata de cartão do PDV (causa float) | 44 | **145** |
| duplicata de linha já criada | 0 | 1 |
| pedido com cartão de outro valor (criação "legítima") | 3 | 4 |
| sem cartão algum (legítima) | 0 | 3 |
| VALOR 0 (a linha '00000') | 1 | 1 |
| **total** | 48 (R$ 1.603,14) | **154 (R$ 4.990,70)** |

- **Nenhuma** das 202 foi selecionada (CONSILIADO nulo em 100%), baixada ou conciliada. Estão como **recebível de cartão aberto e fantasma** na base, inclusive a que vai ser migrada. Não apaguei nada; **é decisão do usuário** o que fazer com elas na carga.
- A regra começa em 03/2024 (zero antes disso), só em POS.

### Comparação certa para o Apollo

1. Considerar só as linhas de CX_VENDAS com `NROPEDIDO <> '00000'` e `VALOR <> 0`.
2. Casar **como multiconjunto** pela chave `(NROPEDIDO, round(VALOR,2))`, em centavos inteiros: criar só a falta = nº de linhas CX com a chave − nº de CARTAO (não excluídos, do turno/forma) com a chave, **contando também os já criados**. Isso é idempotente e reabrir não duplica.
3. **Gatilho:** "turno reaberto e ainda não refechado". No web não há sessão de tela: marcar na reabertura do corte 3 (HISTORICO "Reabertura do caixa…" com a chave, posterior ao último efetivar) e aplicar ao listar os documentos CRT.
4. **Resultado esperado em 2026:** 7 cartões legítimos em vez de 154.

---

## 6. Impressões — **todas sem substrato de uso (não há log)**

Todas carregam o .fr3 de `Relatorios\` (fonte de 14/05/2020).

| # | onde / gatilho | dataset / SQL | campos | mensagens |
|---|---|---|---|---|
| a | Principal › Imprimir (Alt+I) › "Relatório de caixa" | abre **FRMRELATORIOCAIXA** (Caixa – Demonstrativo de resultados, `uRelatorioCaixa`), já migrado como `rel-caixa-dre`; 620 acessos de menu, último 08/09/2026 | — | só um link |
| b | › "Comprovante de quebra de caixa" (linha corrente da grade + chave) | `FDQSaldoOperador`: `SALDO_OPERADOR S JOIN OPERADORES` com CODOPERADOR, DATAFECHAMENTO = data, CODPDV, `COALESCE(EXCLUIDO,'N')='N'`, `COALESCE(GERA_SALDO,'S')='S'`, `CHAVE = :chave` (ou nula com chave vazia); **não filtra SALDO<0**, então imprime também sobra | "Eu, [NOME], reconheço a quebra de caixa do PDV [CODPDV], no dia [DATAFECHAMENTO], no valor de [SALDO×−1] reais." + assinatura [NOME] | "Não foram encontradas quebras de caixa no dia dd/mm/aaaa."; erro: "Não foi possível imprimir a quebra de caixa do operador." |
| c | › "Histórico" | `sqqHistorico`: `HISTORICO S JOIN OPERADORES` com `CODEMPRESA` e `AUXILIAR = :chave` (com chave vazia pega **todo HISTORICO de AUXILIAR nulo**: defeito, filtrar por data), ordem CODHIST; Rel_Historico_Finalizadoras.fr3 "Histórico de alterações do fechamento de caixa" | Data, Histórico, Usuário | "Não foram encontrados dados." |
| d | › "Relatório de análise" (Totalizado/Descritivo) | ProcessaSQL (cdsCX_Vendas) ordenado por OPERACAO;DATA;CODOPERADORA;NROPDV; `fec_Fechamento_Caixa_{Totalizado,Descritivo}_Vendas.fr3` | data, PDV, operador, operação, valor + totais por operador/PDV | "Não foi possivel encontrar Vendas com os Filtros informados, Verifique" |
| e | › "Fechamento de caixa" (RBAC FECHAMENTOCAIXA1) e Caixas em aberto › Relatório/T/espaço + Imprimir (vários turnos) | `MontaRel`: sqqDoc (CX_VENDAS líquido por recurso + CAIXA_PDV recarga/correspondente/voucher + CAIXA_OBS), sqqCaixaRel (CAIXA com `plc.tpconta=0` × CX_VENDAS = divergência), sqqTesourariaRel (**TESOURARIA 0 linhas: morto**), QryDescontos (VENDAS DESC<0), QryCancelamentos (CAIXA_PDV.CANCELAMENTOS); linha "DEVOLUÇÃO EM DINHEIRO" (HIST_DEVOLUCAO: morta) | por PDV/operador/chave: Recurso, Vendas, Caixa, "Divergência Vendas p/ Caixa", Sangria, Suprimento, Desconto, Cancelamentos, Obs. de divergência; Totais por recurso | "Informe o operador." / "Informe o número do PDV."; no multi: "O PDV %d não foi cadastrado para a empresa %d." |
| f | diálogo de documentos › Imprimir | a grade corrente; `fec_fechamento_de_caixa_doc_fin_{crb,dev,car,chq,tkt,recarga,corresp,voucher,sangria,suprimento}.fr3`; variáveis DtInicial, DtFinal, Empresa | as colunas da grade (ex. cartão: CV, cupom, pedido, data, valor, operadora, parcela, liberado, conciliado, cadastro, última alteração, usuário, chave) | "Não existem dados para gerar e imprimir o relatório." |
| g | F6 › recibo | TransferenciaEspecie.fr3 (contas, nomes, valor) | — | "Transferência realizada com sucesso. Deseja imprimir recibo?" |

---

## 7. Outros itens fora da lista já implementada

- **Finalização F5 / Enter em "Cancelamentos"** — somente leitura, não implementado. Lista de cupons cancelados:
  - `sqqCupomT`: VENDAS `CANCELADO='S' AND TIPOCANC='C'`, PDV, operador, data/chave (com chave: `COALESCE(CHAVE_CANCELAMENTO, CHAVE)`); mostra motivo e responsável do HISTORICO_PDV `CANC_V`;
  - itens cancelados `QryItensCancelados`: `TIPOCANC='I'`, com produto, total e motivo/responsável.
  - Hoje o Apollo só mostra o valor.
- **Finalização F6 / Enter em "Descontos"** — somente leitura, não implementado. "Vendas com descontos" (`URelVendasComDescontos`): cupom, código de barras, descrição, desconto, responsável e motivo (HISTORICO_PDV DESC_I/DESC_V/DESC_C). Se zero: "Não foram encontrados descontos nas vendas."
- **Clique no rótulo da chave:** copia a chave para a área de transferência ("Chave copiada!"). Trivial.
- **Duplo clique na grade principal:** abre a Consulta de histórico de vendas (FRMCONSHISTVENDAS) pelo COO/pedido. Já existe dossiê `uConsHistVendas`; é só link.
- **`OBRIGA_FECHAR_CAIXA_PDV`** (vivo como configuração):
  - com 'S' e `CAIXA_PDV.HORASAIDA` vazio, aparece "O caixa selecionado ainda não foi fechado no PDV.", abre mas **desabilita o Efetivar**;
  - produção: Módulo = 'N' desde 09/07/2026 (esteve 'S' de 07/05 a 09/07/2026) e Empresa 1 = 'N', então hoje não tem efeito;
  - **não está no Apollo.** Regra pequena.
- **"Abrir Caixa" manual** (UabertCaixa, BTNABRIR): **morto**.
  - Insere 'SALDO ANTERIOR' e a linha de fundo (SUPRIMENTOS) + MCB.
  - Produção: 2 linhas desde 2020 (2021 e 2023); 'SALDO ANTERIOR' nunca.
- **Modos Balcão/OS** (cmbOpcao 1/2): **mortos**. CX_PEDIDOS tem 28 linhas, nenhuma fechada (STATUS nulo); CX_OS 0.
- **`FECHAMENTOSANGRIA_EXIGE_AUTENTICACAO`** ('S' nas empresas 1 e 50 desde 2021, sem fonte): **sem efeito observável no fechamento**. Em 2026 há sangrias não autenticadas em turnos fechados (ex.: abr/2026 com 246), então não implementar bloqueio.
- **`FECHAMENTO_CAIXA_DATA_MOVIMENTO`='A'**: sem efeito. Em 2026, 14.204 de 14.234 CAIXA do fechamento têm a data do caixa, como o corte 2 já faz.

---

## Ordem recomendada de implementação

1. ✅ (4.1, 24/09) **Edição de cartão no diálogo** (operadora/NSU/autorização/rede; valor e parcelas só fora do modo 'P'), inclusive em consulta de turno fechado. Cerca de 15 mil por ano. Reusar `cadastro/cartao` e gravar HISTORICO + LOG como o legado.
2. ✅ (4.2, 24/09) **A Receber manual** (inserir ORIGEM 'F', editar, excluir): 631 + 173 + 14 em 2026.
3. ✅ (4.2, 24/09; a tela básica fica de fora) **Cartão manual** (tela completa; a básica é opcional e rara): 459 em 2026. Mais a exclusão com liberação `USUARIOS_PERMITIDOS_EXCLUIR_DOCUMENTOS_FECHAMENTO` (reusar `LiberacaoService` / LOG_LIBERACOES 'EXCLUIR DOCUMENTOS') e `DELETAR_DOCUMENTO_FCX`.
4. ✅ (4.3, 24/09) **Sangria/suprimento manual** com liberação (`USUARIOS_PERMITIDOS_ALTERAR_SUP_SAN_FECHAMENTO`), MCB na conta fiscal, IDENTIFICADOR_MOVCB, e a exclusão levando a MCB.
5. ✅ (4.4, 24/09) **CARTAO da refechada** com o casamento por multiconjunto em centavos e o gatilho de reaberto. Levar ao usuário a decisão sobre as 202 linhas fantasma (R$ 6.593,84) na carga.
6. **Impressões**, nesta ordem: Fechamento de caixa (e multi, pelos caixas abertos), comprovante de quebra, histórico (com o filtro corrigido), listas dos documentos, relatório de análise, link do Relatório de caixa.
7. **Diálogos de leitura de cancelamentos (F5) e descontos (F6)**, cópia da chave e link ao histórico de vendas.
8. **`OBRIGA_FECHAR_CAIXA_PDV`** e o atalho de transferência (F6 dos caixas abertos → tela existente).
9. **Lançamento provisório** (só modalidade + DADOSCX) e **CAIXA_OBS** (upsert + coluna no relatório): baixo uso.
10. **Não implementar** (mortos, com prova): cheque, devolução e recarga manuais, correspondente e voucher, colunas de tesouraria, sangria/suprimento do lançamento provisório, Abrir Caixa manual, Balcão/OS. O troco solidário fica só como lista.
