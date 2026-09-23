# Dossiê — REGISTROS DE LOG (`TLog.GravaLog` · `frmRegistrosLog`)

| Campo | Valor |
|---|---|
| **Status** | **corte-1 ENTREGUE** (2026-09-23, mig 313): a tabela carregada (mig 311), o Apollo gravando (form-base + controle de permissões) e o visualizador em 13 telas. Aberto pela triagem das tabelas fora do plano (FILA, Achado 20, item 1). |
| **Fontes** | `uLog.pas` (584 linhas: `TLog.GravaLog` ×3, `ChamaTelaRegistrosLog`), `uRegistrosLog.pas/.dfm`, `uCadMaster.pas:485`, `uCtrlPermissoes.pas:897-954`. |
| **Produção** | `LOG` 2.490.647 linhas, viva (23/09/2026). Sequência `ID_IDLOG` em 15.736.322. |

## 1. O que é (e o que não é)

Não é log técnico — o técnico é a `LOG_SISTEMA` (`ErrorLog`/`EventLog`). A **LOG** é o histórico que o usuário vê pelo
**"Registro de log"** de 21 telas: quem inseriu/alterou/excluiu, quando, e o valor anterior e o atual de cada campo.

Quem grava:
- o **form-base** (`uCadMaster.pas:485`) a cada gravação de qualquer cadastro, com o diff do DataSet (`GravaLog` com
  DataSet, uLog.pas:236-330): `Inseriu` = cada campo preenchido; `Alterou` = cada campo que mudou; nada mudou = nada grava;
  campos com SENHA no nome ficam de fora;
- as telas, com textos próprios (113 chamadas em 25 units): NF (18+13), permissões (10), financeiro da NF (9),
  clientes (8), situação da NF (8), redução Z (6)…

Colunas: `IDLOG` · `ACAO` (Inseriu/Alterou/Excluiu) · `FORMULARIO` (título da tela) · `TABELA` · `CHAVE` (coluna-chave) ·
`VALOR` (código do registro) · `CODUSUARIO` · `USUARIO` (nome) · `DATAHORA` · `HISTORICO` (4000) · `IDEMPRESA`.

**Formato real** (a produção, não o fonte de 2020): o HISTORICO sai em **maiúsculas e sem acento** —
`ALTEROU: 23/09/2026 15:55:03 \r\nCAMPO: SEXO    VALOR ANTERIOR:     VALOR ATUAL: F`.

## 2. O visualizador (`frmRegistrosLog`)

`SELECT * FROM LOG WHERE CHAVE LIKE :CHAVE AND ((VALOR = :VALOR) OR (:VALOR IS NULL)) AND TRUNC(DATAHORA) BETWEEN :DT1
AND :DT2 AND ((ACAO = :ACAO) OR (:ACAO IS NULL)) ORDER BY IDLOG` — período padrão dos últimos 30 dias; valor 0 = todos
os registros da chave; opções de mostrar a coluna Empresa e o código do registro. O menu **não tem permissão própria**
(a `BTNREGISTROLOG` da produção é só da exportação para balança): quem abre a tela vê o log dela.

## 3. Corte-1 (mig 313)

- **gravação** `shared/log/registro-log.ts` — `gravarLog` (IDLOG da `seq_log`, operador e nome da sessão, texto normalizado)
  e `historicoDeGravacao` (o diff do form-base, comparando VALOR e não texto: '5.50' do banco = 5,5 do formulário).
- **form-base**: os dois motores (CRUD e agregado) gravam no create/update quando o cadastro declara `log` — 18 cadastros
  com o título que a produção grava (produtos, parceiros, usuários, categorias, empresas `CODEMPRESA`, scrap, pedido de
  compra, cartões, agenda de promoção, devolução de compras, CFOP, situação da NF, contas correntes, formas de pagamento,
  NCM, centro de custos, operadoras, troca).
- **controle de permissões**: os textos de `GetMsgAcaoLog`.
- **visualizador** `GET cadastro/registros-log?form=&chave=&valor=&dtini=&dtfim=&acao=` (gate da tela) + modal na web,
  no menu Outros de 12 cadastros (inclusive contas a pagar/receber e NF, que ainda não gravam mas mostram a história
  carregada) e no botão do controle de permissões.
- **carga**: `seq_log` `OWNED BY log.idlog` — o acerto genérico de sequências da carga a reposiciona (com `::bigint`: a
  coluna é `numeric(10,0)`, o tipo do Oracle, e `setval` não aceita numeric — o mesmo defeito teria parado a carga).

## 4. Pendente (fila)

- os textos próprios das telas verticais: NF (entrada/saída/processamento, `FATURAMENTO`, itens), contas a pagar/receber,
  caixa, cartão (baixa), situação da NF, clientes (endereços), produto (multi-preço, código auxiliar), redução Z,
  indexador tributário, conciliação bancária, relatórios, exportação para balança;
- a exclusão pelo form-base (o legado não loga exclusão genérica; as telas logam as suas).
