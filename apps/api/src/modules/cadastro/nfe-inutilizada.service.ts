import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { NfeInutilizadaConsultaDto, NfeInutilizadaDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * NF-e / NFC-e INUTILIZADAS (`FRMNFE_INUTILIZADA`). **2 acessos no menu — 187.138 registros na tabela.**
 * Dossiê: `uNFE_Inutilizada.md`. Migration 271.
 *
 * O livro das numerações queimadas: quando um número de NFC-e se perde (queda de energia, travamento do
 * PDV, contingência), a SEFAZ autoriza a inutilização e devolve um protocolo — e esse registro é o que
 * explica o buraco na numeração para o fisco. Quem grava é o processo de emissão; a tela consulta e
 * corrige.
 *
 * No cliente: 187.138 registros, **todos de um número só** (`numeracao_ini = numeracao_fim`), 131.333 na
 * loja 1 e 54.904 na 2, até hoje (18/09/2026) — ~78 por dia em 2026. E `NF.STATUSNFE='I'` tem **0 linhas**:
 * a inutilização não deixa rastro na NF, vive só aqui.
 */
@Injectable()
export class NfeInutilizadaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op() { return currentTenant().operadorId ?? null; }

  private linha(r: Record<string, unknown>) {
    return {
      codinutilizacao: Number(r.codinutilizacao), codempresa: Number(r.codempresa),
      data: r.data, tiponf: r.tiponf, serie: r.serie ?? null,
      numeracaoIni: Number(r.numeracao_ini), numeracaoFim: Number(r.numeracao_fim),
      numeros: Number(r.numeracao_fim) - Number(r.numeracao_ini) + 1,
      protocolo: r.protocolo ?? null, temXml: r.arquivo_xml != null,
    };
  }

  async consultar(q: NfeInutilizadaConsultaDto) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const tipo = q.tiponf ?? null;
    const serie = q.serie?.trim() || null;
    const numero = q.numero ?? null;
    const filtro = sql`
       WHERE codempresa = ${emp}
         AND data::date BETWEEN ${q.dataIni}::date AND ${q.dataFim}::date
         AND (${tipo}::text IS NULL OR tiponf = ${tipo}::text)
         AND (${serie}::text IS NULL OR trim(coalesce(serie, '')) = ${serie}::text)
         AND (${numero}::integer IS NULL OR (${numero}::integer BETWEEN numeracao_ini AND numeracao_fim))`;
    const rows = (await sql<Record<string, unknown>>`
      SELECT codinutilizacao, codempresa, data, tiponf, serie, numeracao_ini, numeracao_fim, protocolo, arquivo_xml
        FROM nfe_inutilizada ${filtro}
       ORDER BY data DESC, numeracao_ini DESC
       LIMIT ${q.limite}`.execute(db)).rows;
    const tot = (await sql<Record<string, unknown>>`
      SELECT count(*)::int AS registros,
             coalesce(sum(numeracao_fim - numeracao_ini + 1), 0)::int AS numeros,
             count(*) FILTER (WHERE protocolo IS NULL OR trim(protocolo) = '')::int AS sem_protocolo,
             count(DISTINCT trim(coalesce(serie, '')))::int AS series
        FROM nfe_inutilizada ${filtro}`.execute(db)).rows[0] ?? {};
    return {
      itens: rows.map((r) => this.linha(r)),
      truncado: rows.length >= q.limite,
      totais: {
        registros: Number(tot.registros ?? 0), numeros: Number(tot.numeros ?? 0),
        semProtocolo: Number(tot.sem_protocolo ?? 0), series: Number(tot.series ?? 0),
      },
    };
  }

  async obter(id: number) {
    const emp = this.emp();
    const r = (await sql<Record<string, unknown>>`
      SELECT * FROM nfe_inutilizada WHERE codinutilizacao = ${id} AND codempresa = ${emp}`.execute(this.dbp.forTenantRead() as AnyDB)).rows[0];
    if (!r) throw new BusinessRuleError('INUTILIZACAO_NAO_ENCONTRADA', { codinutilizacao: id });
    return { ...this.linha(r), arquivoXml: r.arquivo_xml ?? null };
  }

  /** a faixa não pode se sobrepor a outra já inutilizada da mesma série — o legado não travava. */
  private async recusarSobreposicao(db: AnyDB, emp: number, b: NfeInutilizadaDto, ignorar: number | null) {
    const s = (b.serie ?? '').trim();
    const r = (await sql<Record<string, unknown>>`
      SELECT codinutilizacao, numeracao_ini, numeracao_fim FROM nfe_inutilizada
       WHERE codempresa = ${emp} AND tiponf = ${b.tiponf} AND trim(coalesce(serie, '')) = ${s}
         AND numeracao_ini <= ${b.numeracaoFim} AND numeracao_fim >= ${b.numeracaoIni}
         AND (${ignorar}::integer IS NULL OR codinutilizacao <> ${ignorar}::integer)
       LIMIT 1`.execute(db)).rows[0];
    if (r) {
      throw new BusinessRuleError('FAIXA_JA_INUTILIZADA', {
        codinutilizacao: Number(r.codinutilizacao), numeracaoIni: Number(r.numeracao_ini), numeracaoFim: Number(r.numeracao_fim),
      });
    }
  }

  /** a numeração não pode pertencer a uma nota que existe — isso seria inutilizar nota emitida. */
  private async recusarNotaExistente(db: AnyDB, emp: number, b: NfeInutilizadaDto) {
    const modelo = b.tiponf === 'NFCE' ? 65 : 55;
    const s = (b.serie ?? '').trim();
    const r = (await sql<Record<string, unknown>>`
      SELECT codnf, nronf FROM nf
       WHERE idempresa = ${emp} AND modelo = ${modelo} AND trim(coalesce(serie, '')) = ${s}
         AND nronf ~ '^[0-9]+$' AND nronf::bigint BETWEEN ${b.numeracaoIni} AND ${b.numeracaoFim}
         AND coalesce(cancelada, 'N') = 'N'
       LIMIT 1`.execute(db)).rows[0];
    if (r) throw new BusinessRuleError('NUMERACAO_EM_USO', { codnf: Number(r.codnf), nronf: r.nronf });
  }

  async criar(b: NfeInutilizadaDto) {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    await this.recusarSobreposicao(db, emp, b, null);
    await this.recusarNotaExistente(db, emp, b);
    const r = (await sql<{ codinutilizacao: unknown }>`
      INSERT INTO nfe_inutilizada (codempresa, data, tiponf, serie, numeracao_ini, numeracao_fim, protocolo, usultalteracao, dtultimalteracao)
      VALUES (${emp}, ${b.data}::date, ${b.tiponf}, ${b.serie ?? null}, ${b.numeracaoIni}, ${b.numeracaoFim}, ${b.protocolo ?? null}, ${this.op()}, now())
      RETURNING codinutilizacao`.execute(db)).rows[0];
    return this.obter(Number(r.codinutilizacao));
  }

  async atualizar(id: number, b: NfeInutilizadaDto) {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    await this.obter(id);
    await this.recusarSobreposicao(db, emp, b, id);
    await sql`UPDATE nfe_inutilizada
                 SET data = ${b.data}::date, tiponf = ${b.tiponf}, serie = ${b.serie ?? null},
                     numeracao_ini = ${b.numeracaoIni}, numeracao_fim = ${b.numeracaoFim}, protocolo = ${b.protocolo ?? null},
                     usultalteracao = ${this.op()}, dtultimalteracao = now()
               WHERE codinutilizacao = ${id} AND codempresa = ${emp}`.execute(db);
    return this.obter(id);
  }

  /** apagar registro COM protocolo é recusado: o protocolo é da SEFAZ e o buraco da numeração ficaria sem explicação. */
  async excluir(id: number) {
    const emp = this.emp();
    const r = await this.obter(id);
    if (r.protocolo != null && String(r.protocolo).trim() !== '') {
      throw new BusinessRuleError('INUTILIZACAO_COM_PROTOCOLO', { codinutilizacao: id, protocolo: r.protocolo });
    }
    await sql`DELETE FROM nfe_inutilizada WHERE codinutilizacao = ${id} AND codempresa = ${emp}`.execute(this.dbp.forTenant() as AnyDB);
    return { codinutilizacao: id, excluido: true };
  }

  /** os buracos da numeração que NÃO têm inutilização registrada — o que o fisco pergunta. */
  async buracos(tiponf: 'NFCE' | 'NFE', serie: string, dataIni: string, dataFim: string) {
    const emp = this.emp();
    const modelo = tiponf === 'NFCE' ? 65 : 55;
    const db = this.dbp.forTenantRead() as AnyDB;
    const rows = (await sql<Record<string, unknown>>`
      WITH emitidas AS (
        SELECT nronf::bigint AS n FROM nf
         WHERE idempresa = ${emp} AND modelo = ${modelo} AND trim(coalesce(serie, '')) = ${serie.trim()}
           AND nronf ~ '^[0-9]+$' AND dtemissao BETWEEN ${dataIni}::date AND ${dataFim}::date
      ), faixa AS (SELECT min(n) AS ini, max(n) AS fim FROM emitidas)
      SELECT g.n AS numero
        FROM faixa f, generate_series(f.ini, f.fim) AS g(n)
       WHERE NOT EXISTS (SELECT 1 FROM emitidas e WHERE e.n = g.n)
         AND NOT EXISTS (SELECT 1 FROM nfe_inutilizada i
                          WHERE i.codempresa = ${emp} AND i.tiponf = ${tiponf}
                            AND trim(coalesce(i.serie, '')) = ${serie.trim()}
                            AND g.n BETWEEN i.numeracao_ini AND i.numeracao_fim)
       ORDER BY g.n
       LIMIT 5000`.execute(db)).rows;
    return { tiponf, serie, periodo: { de: dataIni, ate: dataFim }, numeros: rows.map((r) => Number(r.numero)), total: rows.length };
  }
}
