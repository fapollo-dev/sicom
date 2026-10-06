-- 412 — "tem que ter todos os campos": CONFIG_STATUS_TELA (26 linhas na produção, a última de 10/01/2026). É o "status da tela"
-- do `TfrmMaster` (Ctrl+Shift+S salva / Ctrl+Shift+D apaga, uMaster.pas `FormKeyDown` → `fStatusTela`): por operador, o estado
-- dos controles de um formulário liberado, em JSON (`{"listHelper":[n],"items":[{"controle","classe","valor","valorAuxiliar",
-- "visivel","habilitado","leitura","frame"}…]}`). Na produção só a Pesquisa usa — o campo (`cbbCampos`) e a operação
-- (`cbbOperacao`) com que ela abre, por FORMULARIO_PAI + VIEW_PESQ + RETORNO1_PESQ (uPesquisa.pas `FormShow` → `RecuperarStatus`).
-- Estava fora do plano como "AUX" sem ordem do usuário; entra no schema e na carga. A tecla volta com a paridade da Pesquisa
-- (docs/04-screen-dossier/mapa-de-teclado.md). Tipos do ALL_TAB_COLUMNS; PK_CONFIG_STATUS_TELA; a sequência é a ID_CODCONFIGTELA.
CREATE TABLE IF NOT EXISTS config_status_tela (
  codconfigtela    bigint PRIMARY KEY,
  idoperador       bigint NOT NULL,
  idgrupo          bigint,
  formulario       varchar(255) NOT NULL,
  configuracao     text,
  usultalteracao   bigint,
  dtultimalteracao timestamptz,
  formulario_pai   varchar(150),
  view_pesq        varchar(255),
  retorno1_pesq    varchar(150)
);
CREATE SEQUENCE IF NOT EXISTS id_codconfigtela;
