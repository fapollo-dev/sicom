import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from './config.service';

type AnyDB = Kysely<any>;
export type EscopoTipo = 'Empresa' | 'Usuario' | 'Modulo';

/**
 * GESTÃO da camada de config chave-valor (tela UConfigura do legado). NÃO é o resolver (esse é o
 * `ConfigService`, consumido pela NF) — aqui o operador VÊ o catálogo e grava OVERRIDES por escopo
 * (CONFIGURACOES_ESPECIFICAS: Empresa/Usuario/Modulo), além do default global (CONFIGURACOES.VALOR).
 * O valor EFETIVO exibido é resolvido pelo próprio `ConfigService.resolver` (mesma precedência que a NF vê).
 * Módulo VERTICAL (tenant por header; RBAC FRMCONFIGURA nas escritas).
 */
@Injectable()
export class ConfiguracoesAdminService {
  constructor(private readonly dbp: DatabaseProvider, private readonly config: ConfigService) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** 'S;N|Sim;Não' → [{valor:'S',label:'Sim'},{valor:'N',label:'Não'}]. null se a chave é texto livre. */
  private parseValoresPossiveis(vp: unknown): { valor: string; label: string }[] | null {
    const s = String(vp ?? '').trim();
    if (!s) return null;
    const [vals, labels = ''] = s.split('|');
    const vArr = vals.split(';').map((x) => x.trim()).filter(Boolean);
    if (!vArr.length) return null;
    const lArr = labels.split(';').map((x) => x.trim());
    return vArr.map((v, i) => ({ valor: v, label: lArr[i] || v }));
  }

  private escopos(wl: unknown): string[] {
    return String(wl ?? '').split(';').map((s) => s.trim()).filter(Boolean);
  }

  /** LISTA o catálogo não-obsoleto com o valor EFETIVO (empresa corrente) + o override de Empresa dela. */
  async listar(): Promise<Record<string, unknown>[]> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const cat = await db
      .selectFrom('configuracoes')
      .select(['id', 'codigo', 'categorias', 'descricaopequena', 'descricao', 'valor', 'tipovalor', 'valorespossiveis', 'config_especificas_permitidas', 'obsoleto'])
      .where(sql`coalesce(obsoleto,'N')`, '=', 'N')
      .orderBy(sql`coalesce(categorias,'')`)
      .orderBy('codigo')
      .execute();
    const ids = cat.map((c: any) => c.id);
    const ovEmp = ids.length
      ? await db.selectFrom('configuracoes_especificas').select(['id', 'valor']).where('tipo', '=', 'Empresa').where('chave', '=', String(emp)).where('id', 'in', ids).execute()
      : [];
    const ovMap = new Map(ovEmp.map((o: any) => [o.id, o.valor]));
    const out: Record<string, unknown>[] = [];
    for (const c of cat as any[]) {
      // valor efetivo NO ESCOPO DA EMPRESA (override de Empresa ?? default) — resolvido pelo MESMO resolver, mas
      // SEM operadorId/modulo: é o que esta tela gerencia (escopo Empresa). Overrides por Usuario/Módulo (quando a
      // chave os permite) são geridos em telas dedicadas e NÃO entram neste "efetivo" para não enganar o operador.
      const efetivo = await this.config.resolver(c.codigo, { empresaId: emp });
      out.push({
        ...c,
        opcoes: this.parseValoresPossiveis(c.valorespossiveis),
        escoposPermitidos: this.escopos(c.config_especificas_permitidas),
        valorEfetivo: efetivo,
        overrideEmpresa: ovMap.get(c.id) ?? null,
      });
    }
    return out;
  }

  private async chaveCfg(codigo: string): Promise<{ id: number; valorespossiveis: unknown; tipovalor: unknown; config_especificas_permitidas: unknown }> {
    const cfg = (await (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('configuracoes')
      .select(['id', 'valorespossiveis', 'tipovalor', 'config_especificas_permitidas'])
      .where('codigo', '=', codigo)
      .executeTakeFirst()) as any;
    if (!cfg) throw new BusinessRuleError('CONFIG_NAO_ENCONTRADA', { codigo });
    return cfg;
  }

  /** valor precisa pertencer a VALORESPOSSIVEIS (enum); senão, se numérico (Integer/Float), tem de ser número. */
  private validarValor(cfg: { valorespossiveis: unknown; tipovalor?: unknown }, valor: string): void {
    const ops = this.parseValoresPossiveis(cfg.valorespossiveis);
    if (ops) {
      if (!ops.some((o) => o.valor === valor))
        throw new BusinessRuleError('CONFIG_VALOR_INVALIDO', { valor, permitidos: ops.map((o) => o.valor) });
      return;
    }
    const tv = String(cfg.tipovalor ?? '').toLowerCase();
    if (tv === 'integer' && !/^-?\d+$/.test(valor.trim()))
      throw new BusinessRuleError('CONFIG_VALOR_INVALIDO', { valor, tipo: 'Integer' });
    if (tv === 'float' && !/^-?\d+([.,]\d+)?$/.test(valor.trim()))
      throw new BusinessRuleError('CONFIG_VALOR_INVALIDO', { valor, tipo: 'Float' });
  }

  /** lista todos os overrides de uma chave (qualquer escopo) — para a tela de detalhe. */
  async overrides(codigo: string): Promise<Record<string, unknown>[]> {
    const cfg = await this.chaveCfg(codigo);
    return (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('configuracoes_especificas')
      .select(['tipo', 'chave', 'valor'])
      .where('id', '=', cfg.id)
      .orderBy('tipo')
      .orderBy('chave')
      .execute();
  }

  /**
   * ESCOPO desta tela = EMPRESA da sessão. Barra escrita fora do escopo Empresa (Usuario/Módulo são geridos em
   * telas dedicadas — ex.: liberação por supervisor via FRMLIBERACOES) e barra escrita para OUTRA empresa: o
   * RBAC vale para a empresa corrente, então gravar `chave` de uma empresa irmã seria burlar a autorização.
   */
  private assertEscopoEmpresa(tipo: EscopoTipo, chave: string): number {
    const emp = this.emp();
    if (tipo !== 'Empresa') throw new BusinessRuleError('CONFIG_ESCOPO_NAO_PERMITIDO', { tipo, permitidos: ['Empresa'] });
    if (String(chave) !== String(emp)) throw new BusinessRuleError('CONFIG_EMPRESA_INVALIDA', { chave, empresa: emp });
    return emp;
  }

  /** grava/atualiza o override da EMPRESA corrente (só se a chave permite escopo Empresa; valor válido). */
  async setOverride(codigo: string, dto: { tipo: EscopoTipo; chave: string; valor: string }): Promise<Record<string, unknown>> {
    const emp = this.assertEscopoEmpresa(dto.tipo, dto.chave);
    const cfg = await this.chaveCfg(codigo);
    const permitidos = this.escopos(cfg.config_especificas_permitidas);
    if (!permitidos.includes('Empresa'))
      throw new BusinessRuleError('CONFIG_ESCOPO_NAO_PERMITIDO', { tipo: 'Empresa', permitidos });
    this.validarValor(cfg, dto.valor);
    await (this.dbp.forTenant() as AnyDB)
      .insertInto('configuracoes_especificas')
      .values({ id: cfg.id, tipo: 'Empresa', chave: String(emp), valor: dto.valor })
      .onConflict((oc: any) => oc.columns(['id', 'tipo', 'chave']).doUpdateSet({ valor: dto.valor }))
      .execute();
    return { codigo, tipo: 'Empresa', chave: String(emp), valor: dto.valor };
  }

  /** remove o override da EMPRESA corrente (volta ao default). */
  async removerOverride(codigo: string, tipo: EscopoTipo, chave: string): Promise<void> {
    const emp = this.assertEscopoEmpresa(tipo, chave);
    const cfg = await this.chaveCfg(codigo);
    await (this.dbp.forTenant() as AnyDB)
      .deleteFrom('configuracoes_especificas')
      .where('id', '=', cfg.id)
      .where('tipo', '=', 'Empresa')
      .where('chave', '=', String(emp))
      .execute();
  }

  /** altera o DEFAULT global da chave (CONFIGURACOES.VALOR) — per-tenant. */
  async setDefault(codigo: string, valor: string): Promise<Record<string, unknown>> {
    const cfg = await this.chaveCfg(codigo);
    this.validarValor(cfg, valor);
    await (this.dbp.forTenant() as AnyDB)
      .updateTable('configuracoes')
      .set({ valor })
      .where('id', '=', cfg.id)
      .execute();
    return { codigo, valor };
  }
}
