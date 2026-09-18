import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { CandidatosLoteDto, GerarFinanceiroLoteDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** a marca que o legado põe na duplicata de todo título gerado por esta tela. */
const DUPLICATA_LOTE = 'DUP 01/01';

/**
 * GERAR FINANCEIRO EM LOTE (`FRMGERARFINANCEIROLOTE`). **8 acessos, 3 operadores** — e **10.666 títulos
 * gerados em 2026**. Dossiê: `uGerarFinanceiroLote.md`. Migration 266.
 *
 * A cobrança mensal dos clientes de valor fixo: escolhe clientes (`cli='S' AND ativado='S'`), uma data de
 * vencimento e um banco, e gera **um `areceber` por cliente** com `parceiros.fixo`. No cliente são 169
 * clientes com valor fixo, R$ 182.522,81/mês.
 *
 * Regras copiadas do fonte: título nasce `quitada='N'`, `gerado='SISTEMA'`, `nrodup=1`,
 * `duplicata='DUP 01/01'`, `txjuros = empresas.txjuropadrao`, `idpgto` = a forma **DUPLICATA** da empresa
 * (sem ela, a tela recusa); `dtvenda` = hoje, ou o dia `parceiros.venc_prev` do mês corrente quando
 * "Vencimento do Cliente" está marcado; e a **guarda anti-duplicidade** — título do mesmo
 * (parceiro, vencimento, valor, empresa, banco) já existente faz a linha ser DESCARTADA, não duplicada.
 */
@Injectable()
export class GerarFinanceiroLoteService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** os clientes que a tela oferece: ativos, e por padrão só os que têm valor fixo. */
  async candidatos(q: CandidatosLoteDto) {
    const emp = this.emp();
    const termo = (q.q ?? '').trim().toUpperCase();
    const rows = (await sql<Record<string, unknown>>`
      SELECT p.codparceiro, p.razao, p.fantasia, p.fixo, p.venc_prev
        FROM parceiros p
       WHERE coalesce(p.cli, 'N') = 'S' AND coalesce(p.ativado, 'S') = 'S'
         AND (NOT ${q.somenteComFixo}::boolean OR coalesce(p.fixo, 0) > 0)
         AND (${termo}::text = '' OR upper(p.razao) LIKE ${'%' + termo + '%'} OR p.codparceiro::text = ${termo})
       ORDER BY p.razao
       LIMIT ${q.limite}`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
    const itens = rows.map((r) => ({
      codparceiro: Number(r.codparceiro), razao: r.razao, fantasia: r.fantasia ?? null,
      fixo: num(r.fixo), vencPrev: r.venc_prev == null ? null : Number(r.venc_prev),
    }));
    return { itens, total: itens.length, soma: r2(itens.reduce((s, i) => s + i.fixo, 0)), empresa: emp };
  }

  /** o dia `venc_prev` do mês da data de vencimento escolhida (regra do legado, uGerarFinanceiroLote.pas:186). */
  private dataVenda(usar: boolean, vencPrev: number | null, dtvenc: string, hoje: string): string {
    if (!usar || vencPrev == null || vencPrev < 1 || vencPrev > 31) return hoje;
    const dia = String(Math.min(vencPrev, 28)).padStart(2, '0'); // 28 evita mês curto — o legado estoura
    return `${dtvenc.slice(0, 8)}${dia}`;
  }

  async gerar(f: GerarFinanceiroLoteDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenant() as AnyDB;
    const hoje = new Date().toISOString().slice(0, 10);

    return db.transaction().execute(async (trx: AnyDB) => {
      // a forma DUPLICATA da empresa — sem ela o legado recusa a tela inteira
      const forma = (await sql<Record<string, unknown>>`
        SELECT idpgto FROM formas_pgto
         WHERE idempresa = ${emp} AND upper(modalidade) = 'DUPLICATA' AND coalesce(inativo, 'N') = 'N'
         ORDER BY idpgto LIMIT 1`.execute(trx)).rows[0];
      if (!forma) throw new BusinessRuleError('FORMA_DUPLICATA_NAO_CADASTRADA', { empresa: emp });

      const txjuros = num((await sql<Record<string, unknown>>`SELECT txjuropadrao FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0]?.txjuropadrao);

      const clientes = (await sql<Record<string, unknown>>`
        SELECT p.codparceiro, p.razao, p.fixo, p.venc_prev
          FROM parceiros p
         WHERE p.codparceiro = ANY(${sql.raw(`ARRAY[${f.clientes.join(',')}]::integer[]`)})
         ORDER BY p.razao`.execute(trx)).rows;

      const gerados: Array<Record<string, unknown>> = [];
      const descartados: Array<Record<string, unknown>> = [];
      for (const c of clientes) {
        const cod = Number(c.codparceiro);
        const valor = num(c.fixo);
        if (valor <= 0) { descartados.push({ codparceiro: cod, razao: c.razao, motivo: 'SEM_VALOR_FIXO' }); continue; }
        // guarda anti-duplicidade do legado: mesmo parceiro + vencimento + valor + empresa + banco
        const jaTem = (await sql<{ codrcb: unknown }>`
          SELECT codrcb FROM areceber
           WHERE codparceiro = ${cod} AND codempresa = ${emp} AND dtvenc::date = ${f.dtvenc}::date
             AND valor = ${valor}::numeric AND coalesce(codbco, 0) = ${f.codbco}
           LIMIT 1`.execute(trx)).rows[0];
        if (jaTem) { descartados.push({ codparceiro: cod, razao: c.razao, motivo: 'JA_EXISTE', codrcb: Number(jaTem.codrcb) }); continue; }

        const dtvenda = this.dataVenda(f.usarVencimentoCliente, c.venc_prev == null ? null : Number(c.venc_prev), f.dtvenc, hoje);
        if (f.simular) { gerados.push({ codparceiro: cod, razao: c.razao, valor, dtvenda, dtvenc: f.dtvenc }); continue; }

        const novo = (await sql<{ codrcb: unknown }>`
          INSERT INTO areceber (codparceiro, codempresa, dtvenda, dtvenc, duplicata, nrodup, valor, quitada, gerado,
                                tipodoc, txjuros, codbco, idpgto, codoperador, usultalteracao, dtultimalteracao, dtcadastro)
          VALUES (${cod}, ${emp}, ${dtvenda}::date, ${f.dtvenc}::date, ${DUPLICATA_LOTE}, 1, ${valor}::numeric, 'N', 'SISTEMA',
                  'DUPLICATA', ${txjuros}::numeric, ${f.codbco}, ${Number(forma.idpgto)}, ${op}, ${op}, now(), now())
          RETURNING codrcb`.execute(trx)).rows[0];
        gerados.push({ codrcb: Number(novo.codrcb), codparceiro: cod, razao: c.razao, valor, dtvenda, dtvenc: f.dtvenc });
      }

      return {
        simulado: f.simular,
        gerados, descartados,
        totais: {
          clientes: clientes.length, gerados: gerados.length, descartados: descartados.length,
          valor: r2(gerados.reduce((s, g) => s + num(g.valor), 0)),
          jaExistiam: descartados.filter((d) => d.motivo === 'JA_EXISTE').length,
          semValorFixo: descartados.filter((d) => d.motivo === 'SEM_VALOR_FIXO').length,
        },
      };
    });
  }
}
