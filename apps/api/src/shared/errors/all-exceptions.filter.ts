import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from './app-error';
import { tenantStore } from '../tenant/tenant-context';

/** Mapeia AppError/HttpException → resposta HTTP única, sem vazar detalhe interno. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (err instanceof AppError) {
      return res
        .status(err.httpStatus)
        .json({ code: err.code, message: err.message, details: err.details });
    }
    if (err instanceof HttpException) {
      return res
        .status(err.getStatus())
        .json({ code: 'HTTP', message: err.message });
    }

    const tenantId = tenantStore.getStore()?.tenantId;
    console.error('[unhandled]', { tenantId, err });
    return res.status(500).json({ code: 'INTERNAL', message: 'Erro interno' });
  }
}
