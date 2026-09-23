import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { AcessoService } from '../../shared/acesso/acesso.service';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError, ForbiddenActionError } from '../../shared/errors/app-error';

type AnyDB = any;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * REGISTROS DE LOG (`frmRegistrosLog`, uRegistrosLog.pas) — o visualizador que 21 telas abrem pelo "Registro de log"
 * (ChamaTelaRegistrosLog). A consulta é a do legado (uRegistrosLog.dfm:272):
 *   WHERE CHAVE LIKE :CHAVE AND ((VALOR = :VALOR) OR (:VALOR IS NULL)) AND TRUNC(DATAHORA) BETWEEN :DT1 AND :DT2
 *     AND ((ACAO = :ACAO) OR (:ACAO IS NULL)) ORDER BY IDLOG
 * com o período padrão dos últimos 30 dias (FormShow). Valor 0 = todos os registros da chave (a agenda de promoção e a
 * promoção acumulativa abrem assim). O menu não tem permissão própria: quem abre a tela vê o log dela — aqui, o gate da
 * tela que pediu (`form`).
 */
@Injectable()
export class RegistrosLogService {
  constructor(private readonly dbp: DatabaseProvider, private readonly acesso: AcessoService) {}

  async listar(q: { form?: string; chave?: string; valor?: string; dtini?: string; dtfim?: string; acao?: string }) {
    if (currentTenant().operadorId == null) throw new ForbiddenActionError('SEM_PERMISSAO');
    const form = String(q.form ?? '').trim().toUpperCase();
    const chave = String(q.chave ?? '').trim().toUpperCase();
    if (!form || !chave) throw new BusinessRuleError('LOG_PARAMETROS', { motivo: 'informe a tela (form) e a chave' });
    if (!(await this.acesso.possuiAcesso(form, form))) throw new ForbiddenActionError('SEM_PERMISSAO', { form, opcao: form });

    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const d30 = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() - 30 * 86400000));
    const dtini = q.dtini && DATA.test(q.dtini) ? q.dtini : d30;
    const dtfim = q.dtfim && DATA.test(q.dtfim) ? q.dtfim : hoje;
    if (dtini > dtfim) throw new BusinessRuleError('LOG_PERIODO_INVALIDO', { dtini, dtfim });
    const valor = q.valor != null && q.valor !== '' && Number(q.valor) !== 0 ? Number(q.valor) : null;
    const acao = q.acao && ['Inseriu', 'Alterou', 'Excluiu'].includes(q.acao) ? q.acao : null;

    let consulta = (this.dbp.forTenantRead() as AnyDB)
      .selectFrom('log')
      .select([
        'idlog', 'acao', 'formulario', 'tabela', 'chave', 'valor', 'codusuario', 'usuario',
        sql`to_char(datahora AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS')`.as('datahora'),
        'historico', 'idempresa',
      ])
      .where(sql`trim(chave)`, '=', chave)
      .where(sql<boolean>`(datahora AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ${dtini}::date AND ${dtfim}::date`);
    if (valor != null) consulta = consulta.where('valor', '=', valor);
    if (acao) consulta = consulta.where('acao', '=', acao);
    const linhas = await consulta.orderBy('idlog').limit(5000).execute();
    return { chave, valor, dtini, dtfim, acao, linhas };
  }
}
