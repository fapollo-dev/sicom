import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AcessoService } from './acesso.service';
import { AcessoGuard } from './acesso.guard';

/**
 * As permissões de CONTROLE do operador numa tela (`uMaster.SetStateOfControlsMaster`): o componente com Tag 1/13 cujo nome é
 * uma OPÇÃO de PERMISSOES só fica habilitado (Tag 1) ou visível (Tag 13) para quem a tem. A tela pede a lista e aplica; a regra
 * de negócio (o campo que não pode mudar) é conferida de novo no servidor, na gravação.
 */
// sob `cadastro/` para passar pelo TenantMiddleware (a identidade do operador); só autenticação — é a lista do próprio operador
@Controller('cadastro/acesso')
@UseGuards(AcessoGuard)
export class AcessoController {
  constructor(private readonly svc: AcessoService) {}

  @Get('opcoes/:form')
  async opcoes(@Param('form') form: string) {
    const f = String(form ?? '').trim().toUpperCase();
    return { form: f, opcoes: /^[A-Z0-9_]{1,60}$/.test(f) ? await this.svc.opcoesDoForm(f) : [] };
  }
}
