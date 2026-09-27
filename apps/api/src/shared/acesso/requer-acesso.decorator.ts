import { SetMetadata } from '@nestjs/common';

export const REQUER_ACESSO = 'requer_acesso';

/** Marca uma rota com (form, opção) exigidos — checados pelo AcessoGuard (RBAC). */
export const RequerAcesso = (form: string, opcao: string) =>
  SetMetadata(REQUER_ACESSO, { form, opcao });

export const REQUER_CONTROLE = 'requer_controle';

/**
 * A PERMISSÃO DE CONTROLE do botão/menu que dispara a rota (uMaster.SetStateOfControlsMaster — o componente com Tag 1 fica
 * desabilitado sem a opção), exigida ALÉM do gate da rota (`@RequerAcesso`). Várias podem ser pedidas (todas valem).
 * docs/05-migration-engineering/permissoes-de-controle.md
 */
export const RequerControle = (form: string, ...opcoes: string[]) =>
  SetMetadata(REQUER_CONTROLE, opcoes.map((opcao) => ({ form, opcao })));

export const REQUER_ACESSO_ALGUM = 'requer_acesso_algum';

/**
 * Tela que o legado abre DE DENTRO de outras telas (sem gate próprio — `TfrmX.Create(Self)` não passa pelo
 * `PossuiAcessoForm` do menu): basta um dos pares, o da tela/botão por onde o operador chega. Ex.: a análise geral
 * do produto abre pelo cadastro de produto, pela consulta ("Análise geral", Tag 1), pela cotação e pela análise de
 * concorrentes. docs/05-migration-engineering/permissoes-de-controle.md
 */
export const RequerAcessoDeAlgum = (...pares: Array<[form: string, opcao: string]>) =>
  SetMetadata(REQUER_ACESSO_ALGUM, pares.map(([form, opcao]) => ({ form, opcao })));

export const REQUER_SENHA_ADM = 'requer_senha_adm';

/**
 * A tela de configurações do legado não usa PERMISSOES: `TfrmMenuSuperior.Configuraes1Click` barra o operador com
 * DESABILITA_OPERACOES_BASICAS e `TdmPrincipal.TelaConfiguracao` pede `SenhaAdministrativa('ADM')` (uSenhaAdmin.pas):
 * a senha ADM da empresa (as senhas-mestras do legado ficam de fora — AcessoService.senhaAdministrativa). A senha vem
 * no header `x-senha-administrativa`.
 */
export const RequerSenhaAdministrativa = () => SetMetadata(REQUER_SENHA_ADM, true);
