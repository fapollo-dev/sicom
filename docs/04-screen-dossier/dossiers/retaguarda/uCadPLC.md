# uCadPLC — Cadastro do Centro de Custos (FRMCADPLC)

Convertida em 25/09/2026: a web não tinha a tela e a API gerenciava 2 das 20 colunas (código digitado, sem sequência). Smoke §233.

## Regras (servidor, `plc.crud.ts`)
- Código gerado (`GetID('CODPLC')`) — mig 349 cria `seq_plc`; o `pos-carga.sql` a reposiciona depois da carga.
- Código da conta único entre as não excluídas (`CDS.Locate('DESCCODPLC')`, :607).
- Conta raiz (sem conta retrocedente): código de até 2 dígitos (:626), NIVELCONTA 1. Derivada: o código começa pelo do pai (:368) e o
  NIVELCONTA é o do pai + 1 (:376).
- Lançamento contábil: a conta do plano (CODCONTABIL) e a descrição dela em DESCPLCCONTABIL (`edtLancContabilExit`, :521).
- Excluir: recusado com conta filha (:231) ou com o centro de custo em uso — CAIXA, ARECEBER, CX_APAGAR, FORMAS_PGTO.PLCCOFRE, as 13
  colunas de centro de custo de EMPRESAS, CONTACORRENTE, CONTAS_BANCARIAS.CODLANCCONTABIL, as baixas de AP/AR (:262-285); senão lógico (INDR).
- Tipo (TPCONTA): o combo do legado grava 0/1/2 para receita/despesa/neutra.

## Fora, com prova
- Motivos de operação (PLC_MOTIVO_OPERACAO): 0 linhas na produção.

## Auditoria controle a controle (15/10/2026) — `uCadPLC.dfm` × Apollo

| controle | regra | Apollo |
|---|---|---|
| `edtCodConta` | só na inclusão (`dsPLCDataChange` :539 — `Enabled := State = dsInsert`); a conta derivada nasce com o código do pai (`ContaDerivada1Click`) | ❌→✅ era editável na alteração; agora trava (e o servidor recusa — PLC_CODIGO_NAO_ALTERAVEL) e o pai preenche o código na inclusão |
| `edtLancContabil` / `edtDescConta` / `btnBuscaConta` | `Visible = False` no .dfm; o `FormShow` (:708) mostra só com LANCAMENTO_CONTABIL_NO_CENTRO_CUSTO = 'S' (**'N' na produção**) | ❌→✅ aparecia sempre; agora pela config (`GET cadastro/plc-tela`) |
| `CkbApenasProprietarios` | visível só para o PRO (`VerificaCheckProprietarios` :926) e habilitado só na conta raiz (CODPAI = 0) | ❌→✅ qualquer operador marcava; agora a tela e o servidor (PLC_APENAS_PROPRIETARIO_PRO / _RAIZ). O nome "ACESSO DE PROGRAMADOR" (login ADMIN, SUP na produção) que o legado também libera é backdoor — não vale |
| uso de setor / perda / obriga motivo / não mostrar scrap | só no último nível (`ControlaCheckVinculadoAoUltimoNivel` :491; `PLCEstaUltimoNivel` uRdmPLC.pas:202 = tem pai e nenhuma filha) | ❌→✅ a tela e o servidor (PLC_MARCACAO_ULTIMO_NIVEL); só a MUDANÇA é recusada — o dado da carga fica |
| aba "Motivo de operação" | só com "Obriga motivo da perda" (`ControlaAbas`) — PLC_MOTIVO_OPERACAO com 0 linhas | fora (prova) |
| árvore (`tvPLC`) + Localizar | a estrutura em árvore | a Pesquisa ordenada pelo código extenso (Conta/Descrição/Nível) |

Prova: smoke §233.3, `plcCampos.spec.tsx`.
