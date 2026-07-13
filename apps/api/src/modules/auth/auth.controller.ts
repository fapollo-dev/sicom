import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { loginSchema, trocarSenhaSchema, type LoginDto, type TrocarSenhaDto } from '@apollo/shared';
import { AuthService, type AcessoMeta } from './auth.service';
import { ZodValidationPipe } from '../../shared/zod-validation.pipe';

/**
 * AUTH (OPERADORES corte-3a). Rotas PÚBLICAS quanto a RBAC (sem @RequerAcesso) — a autorização É o login.
 * O tenant vem do header `x-tenant-id` (o TenantMiddleware roda em 'auth' e coloca o tenantId no contexto).
 * `login` não exige identidade; `trocar-senha`/`me`/`logout` exigem um JWT válido (o middleware extrai o
 * operador do Bearer). Sem @UseGuards(AcessoGuard) aqui: nenhuma ação depende de grant de PERMISSOES.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly svc: AuthService) {}

  private meta(req: Request): AcessoMeta {
    return {
      ip: (req.headers['x-forwarded-for'] as string) ?? req.ip ?? null,
      versao: (req.headers['user-agent'] as string) ?? null,
      nomecomputador: (req.headers['x-nome-computador'] as string) ?? null,
    };
  }

  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto, @Req() req: Request) {
    return this.svc.login(dto, this.meta(req));
  }

  @Post('trocar-senha')
  @HttpCode(200)
  trocarSenha(@Body(new ZodValidationPipe(trocarSenhaSchema)) dto: TrocarSenhaDto) {
    return this.svc.trocarSenha(dto);
  }

  @Get('me')
  me() {
    return this.svc.me();
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Req() req: Request) {
    return this.svc.logout(this.meta(req));
  }
}
