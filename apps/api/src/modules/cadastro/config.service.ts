import { Injectable } from '@nestjs/common';
import { DatabaseProvider } from '../../shared/database/database.provider';

type AnyDB = any;

/**
 * Camada de config chave-valor — o `ValorConfiguracao` do legado. Resolve o valor de um CODIGO por
 * PRECEDÊNCIA de escopo: **Usuario > Empresa > Modulo > default global** (o corpo exato do resolver
 * legado vive no submódulo `sicom/util` não clonado; a ordem foi reconstruída de 542 call sites).
 * Só aplica um override cujo TIPO está no whitelist `config_especificas_permitidas` da chave.
 * Sempre devolve STRING (o cast — `==='S'`, `Number(...)` — é do chamador, como no legado).
 */
@Injectable()
export class ConfigService {
  constructor(private readonly dbp: DatabaseProvider) {}

  async resolver(
    codigo: string,
    ctx: { empresaId?: number | null; operadorId?: number | null; modulo?: string } = {},
  ): Promise<string | null> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const cfg = await db
      .selectFrom('configuracoes')
      .select(['id', 'valor', 'config_especificas_permitidas'])
      .where('codigo', '=', codigo)
      .executeTakeFirst();
    if (!cfg) return null;

    const permitidos = String(cfg.config_especificas_permitidas ?? '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);

    // precedência: o mais específico (Usuario) vence; só aplica TIPO no whitelist.
    const escopos: { tipo: string; chave: number | string | null | undefined }[] = [
      { tipo: 'Usuario', chave: ctx.operadorId },
      { tipo: 'Empresa', chave: ctx.empresaId },
      { tipo: 'Modulo', chave: ctx.modulo },
    ];
    for (const e of escopos) {
      if (e.chave == null || !permitidos.includes(e.tipo)) continue;
      const ov = await db
        .selectFrom('configuracoes_especificas')
        .select('valor')
        .where('id', '=', cfg.id)
        .where('tipo', '=', e.tipo)
        .where('chave', '=', String(e.chave))
        .executeTakeFirst();
      if (ov?.valor != null) return String(ov.valor);
    }
    return cfg.valor != null ? String(cfg.valor) : null;
  }

  /** açúcar p/ flags 'S'/'N' (default false se ausente). */
  async ligado(codigo: string, ctx: { empresaId?: number | null; operadorId?: number | null; modulo?: string } = {}): Promise<boolean> {
    return (await this.resolver(codigo, ctx)) === 'S';
  }
}
