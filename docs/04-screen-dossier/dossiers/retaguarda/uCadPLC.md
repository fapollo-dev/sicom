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
- As flags de setor/perda só habilitam no último nível (`ControlaCheckVinculadoAoUltimoNivel`) — regra de tela; o servidor não barra.
