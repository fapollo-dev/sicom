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
