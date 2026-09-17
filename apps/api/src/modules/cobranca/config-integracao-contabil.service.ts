import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { CAMPOS_CONFIG_IC, type ConfigIntegracaoContabilDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const CAMPOS = CAMPOS_CONFIG_IC.map((c) => c.campo);

/**
 * CONFIGURAÇÃO DA INTEGRAÇÃO CONTÁBIL (`FRMCONFIGINTEGRACAOCONTABIL`, `UFrmConfigIntegracaoContabil.pas`).
 * **55 acessos, 2 operadores.** Dossiê: `uTron-integracao-contabil.md` §9. Migration 233.
 *
 * O painel que diz, para cada EVENTO do sistema, qual **situação** o razão deve usar. É o que o motor lê em
 * `lancarNoDiario` para achar as duas pernas do lançamento; sem ele, `CONTAS_NAO_INFORMADAS`.
 *
 * A tabela tem **uma linha só** (`ID_CONFIGINTEGCONTABIL`), com 59 apontadores para `SITUACAO_NF` mais o
 * chaveamento de período. No cliente, **27 dos 60 campos estão preenchidos** — o resto são eventos que a loja
 * não contabiliza (cheques, retenções, NFC-e por dentro do fiscal).
 *
 * ⚠️ **cada situação apontada precisa existir em `SITUACAO_NF`** e, para servir de fato, ter as duas pernas em
 * `ITENS_INTEGRACAO_CONTABIL`. A tela avisa quando falta a perna — apontar para uma situação sem contas é
 * exatamente o que faz a integração falhar depois, na hora de contabilizar, longe de quem configurou.
 */
@Injectable()
export class ConfigIntegracaoContabilService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** a configuração e, para cada campo apontado, a situação com o seu estado de prontidão. */
  async obter(): Promise<{
    config: Record<string, unknown>;
    situacoes: Array<Record<string, unknown>>;
    semPernas: string[];
  }> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const config = (await sql<Record<string, unknown>>`
      SELECT * FROM config_integracao_contabil LIMIT 1
    `.execute(db)).rows[0] ?? {};

    const situacoes = (await sql<Record<string, unknown>>`
      SELECT s.idsituacao_nf, s.descricao,
             count(i.codoperacao) FILTER (WHERE i.natureza = 'D')::int AS debito,
             count(i.codoperacao) FILTER (WHERE i.natureza = 'C')::int AS credito
        FROM situacao_nf s
        LEFT JOIN itens_integracao_contabil i ON i.codoperacao = s.idsituacao_nf
       GROUP BY s.idsituacao_nf, s.descricao
       ORDER BY s.descricao
    `.execute(db)).rows;

    // ⚠️ apontar para uma situação sem as duas pernas é o que derruba a contabilização lá na frente
    const prontas = new Set(situacoes.filter((s) => Number(s.debito) > 0 && Number(s.credito) > 0)
      .map((s) => Number(s.idsituacao_nf)));
    const semPernas = CAMPOS.filter((c) => {
      const v = (config as Record<string, unknown>)[c];
      return v != null && !prontas.has(Number(v));
    });

    return { config, situacoes, semPernas };
  }

  /**
   * grava a linha única. Só os campos enviados mudam — a tela do legado é um formulário inteiro, mas mandar
   * o que não se mexeu apagaria configuração alheia num painel com 60 campos.
   */
  async gravar(dto: ConfigIntegracaoContabilDto, operador: number | null): Promise<{ alterados: string[] }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;

    const entradas = Object.entries(dto).filter(([k]) => CAMPOS.includes(k) || k === 'chaveamento_periodo');
    if (!entradas.length) throw new BusinessRuleError('NADA_A_GRAVAR');

    return db.transaction().execute(async (trx: AnyDB) => {
      // as situações apontadas têm de existir; um número digitado errado viraria erro só na contabilização
      const codigos = entradas
        .filter(([k, v]) => k !== 'chaveamento_periodo' && v != null)
        .map(([, v]) => Number(v));
      if (codigos.length) {
        const achadas = (await sql<{ idsituacao_nf: number }>`
          SELECT idsituacao_nf FROM situacao_nf WHERE idsituacao_nf = ANY(${codigos}::int[])
        `.execute(trx)).rows.map((r) => Number(r.idsituacao_nf));
        const faltando = codigos.filter((c) => !achadas.includes(c));
        if (faltando.length) throw new BusinessRuleError('SITUACAO_NAO_ENCONTRADA', { situacoes: [...new Set(faltando)] });
      }

      const existe = (await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM config_integracao_contabil
      `.execute(trx)).rows[0];
      if (!Number(existe?.n)) {
        await sql`INSERT INTO config_integracao_contabil DEFAULT VALUES`.execute(trx);
      }

      for (const [campo, valor] of entradas) {
        if (campo === 'chaveamento_periodo') {
          await sql`UPDATE config_integracao_contabil SET chaveamento_periodo = ${valor as string | null}::date`.execute(trx);
        } else {
          await sql`UPDATE config_integracao_contabil SET ${sql.ref(campo)} = ${valor == null ? null : Number(valor)}`.execute(trx);
        }
      }
      void operador;
      return { alterados: entradas.map(([k]) => k) };
    });
  }
}
