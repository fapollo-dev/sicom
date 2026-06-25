import { SetMetadata } from '@nestjs/common';

export const REQUER_ACESSO = 'requer_acesso';

/** Marca uma rota com (form, opção) exigidos — checados pelo AcessoGuard (RBAC). */
export const RequerAcesso = (form: string, opcao: string) =>
  SetMetadata(REQUER_ACESSO, { form, opcao });
