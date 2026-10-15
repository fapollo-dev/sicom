# CADASTRO DE OPERADORAS DE CARTÃO (`FRMCADOPERADORAS`, `UcadOperadoras.pas` 516 linhas + `uRDMCadOperadoras`)

325 acessos (MENUEXPRESS). Permissões na produção: FRMCADOPERADORAS / BTNADICIONARREGISTRO / BTNEDITAR / BTNGRAVAR = 86 cada,
BTNEXCLUIR = 63. Cadastro (TfrmCadMaster). Apollo: `apps/web/src/features/cartao/OperadorasPage.tsx` + `cadastro/operadoras`
(`operadoras.aggregate.ts`, mestre-detalhe com OPERADORAS_TAXA) + `cadastro/operadoras/:id/filhas`.

## Auditoria controle a controle (15/10/2026) — `UcadOperadoras.dfm` × Apollo

A tela do Apollo tinha só nome, taxa, dias, tipo e a taxa por loja (empresa, taxa, dia). Agora:

- **Aba Operadoras** — Nome, Dias para Compensação, Taxa Administrativa, Tipo (combo A/C/D/G/O/P/R; o valor fora do combo — 'I' em 2
  operadoras da produção — é preservado e mostrado), Taxa de Gestão, Taxa de Anuidade, Dia Fechamento (texto de 5), Banco, Parceiro
  (grava **CODADM**, Pesquisa GET_PARCEIROS com `FRN = 'S'`), Empresas, Desabilitado, Observações. ❌→✅
- **Grupo TEF** — Operadora PDV, Tipo (TIPOCARTAO 0/1/2/3/5/98/99), Rede (Pesquisa `GET_REDE` — criada, mig 431), Bandeira, Operadora
  Base (Pesquisa GET_OPERADORAS), POS. ❌→✅ (o "Validar NSU" vem da coluna FLG_VALIDAR_NSU do binário novo.)
- **Obrigatórias do `btnGravarClick`**: "Operadora PDV é um campo obrigatório.", "TIPO TEF é um campo obrigatório.", "REDE TEF é um campo
  obrigatório.". O teste do legado é `not Campo.AsInteger > 0` — em Delphi o `not` é bit a bit e tem precedência sobre o `>`, então
  na prática **só barra o vazio** (o 0 do cheque passa). Assim no Apollo. Na alteração, valida só o que veio no corpo. ❌→✅
- **`edtOperadoraExit`**: a Operadora PDV vazia herda o nome da operadora ao sair do campo. ❌→✅
- **`btnAdicionarRegistroClick`**: EMPRESAS nasce do `GetMultiEmpresa` (o seletor; sem escolha, a loja logada; formato "1,2"). No
  Apollo nasce com a loja da sessão e é editável no mesmo formato.
- **Aba Taxas** (OPERADORAS_TAXA) — empresa, dia de fechamento, taxa administrativa, **gestão, anuidade e antecipação** (as três
  faltavam). "Selecione uma empresa antes de gravar uma taxa." e "Empresa já cadastrada para essa operadora." (o dicionário
  `vCodEmpresasTaxas`). ❌→✅
- **Aba Operadoras Assossiadas** — a grade do `qryOperadorasFilhas` (`CODOPERADORABASE = :CODOPERADORABASE`), com as colunas do .dfm.
  Em uso: 13 operadoras da produção têm base. ❌→✅ (`GET cadastro/operadoras/:id/filhas`)

## Desvios deliberados (o legado erra; documentado, não copiado)

- **Editar taxa**: o dicionário de empresas contém a própria empresa da linha em edição, então o "Editar" (btnCancelarTaxaEmpresa) sempre
  esbarrava em "Empresa já cadastrada para essa operadora." — só dava para excluir e reinserir. No Apollo a linha em edição se substitui.
- **`dbedtCodOperadorBaseExit`**: com a Operadora Base vazia, limpa **a Operadora PDV** (`dbedtOPERADORA_PDV.Field := ''`) — cópia de
  código (o par da base é OPERADORA_BASE). Efeito no legado: passar pelo campo vazio apaga a Operadora PDV e o Gravar barra. Não portado.
- **Banco**: o combo do legado lista as CONTAS bancárias (TITULAR de GET_CONTAS_BANCARIAS) mas grava CODIGO_BANCO = CONTAS_BANCARIAS.CODBCO,
  o código do **banco** (várias contas com o mesmo banco ficam indistinguíveis ao reabrir). O Apollo usa a Pesquisa de bancos — mesmo
  domínio gravado (CODBANCO; 3 operadoras da produção usam, banco 518).

## Morto (com prova)

- `BtnImprimir` (aba Taxas, "Impressão" com hint de mala-direta): sem OnClick, sem DropDownMenu no .dfm e posicionado fora do painel
  (Left 560 + Width 110 num painel de 567). Não há ação a portar.
- A OPERADORAS da produção não tem INDR (o Excluir apaga): a filha excluída no Apollo (soft-delete) sai da aba, como no legado.

Prova: smoke 47c.1b (todos os campos, as três obrigatórias, a taxa com gestão/anuidade/antecipação, as filhas e a excluída) +
`apps/web/test/operadorasPage.spec.tsx` (3).
