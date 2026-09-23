import { Controller, Get, Query } from '@nestjs/common';
import { RegistrosLogService } from './registros-log.service';

/** REGISTROS DE LOG — o visualizador do legado (uRegistrosLog). A permissão é o gate da tela que o abre (`form`). */
@Controller('cadastro/registros-log')
export class RegistrosLogController {
  constructor(private readonly svc: RegistrosLogService) {}

  @Get()
  listar(@Query() q: { form?: string; chave?: string; valor?: string; dtini?: string; dtfim?: string; acao?: string }) {
    return this.svc.listar(q);
  }
}
