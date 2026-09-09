import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

export interface FiltroLancamentos {
  dataIni: string; dataFim: string;
  codorigem?: number | null;
  conta?: number | null;          // débito OU crédito
  codoperacao?: number | null;    // a situação
  documento?: string | null;
  /** só as linhas de um lado só — o formato que a integração contábil gera em algumas origens. */
  somenteSingle?: boolean;
}

/**
 * LANÇAMENTOS CONTÁBEIS (`FRMRELLANCAMENTOSCONTABEIS`, `UFrmRelLancamentosContabeis.pas`).
 * Dossiê: `uRelLancamentosContabeis.md`. 377 acessos, 19 operadores.
 *
 * É o razão **por lançamento**, não por conta: cada linha do `DIARIO` com as duas contas (reduzida e
 * expandida, do plano), o histórico, o documento e — o que importa — **a origem pelo nome**
 * (`ORIGEM_CONTABIL`, que a mig 209 trouxe): "INTEGRAÇÃO DE BAIXA DE CARTÕES" em vez de "51".
 *
 * ⚠️ não confundir com o **Livro Razão** (`FRMRELRAZAOCONTABIL`, já migrado): aquele é por conta, com saldo
 * acumulado; este é a lista dos lançamentos, com filtro por origem e a ponte para o documento que os gerou.
 *
 * **A ponte para a origem** (`BtnDetalharDiarioClick`, `:422-437`) é o que faz o contador usar a tela: dado um
 * lançamento, achar o documento. O legado resolve dois casos (`ARECEBER_BX` → `CODRCB`, `APAGAR_BX` →
 * `CODAPG`); aqui a resolução cobre as origens que o Apollo hoje grava, e as demais devolvem o `IDORIGEM` cru
 * em vez de inventar um destino.
 */
@Injectable()
export class LancamentosContabeisService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** as origens que aparecem no razão da empresa — é o combo de filtro da tela (`:376`). */
  async origens(): Promise<Array<{ codorigem: number; descorigem: string; lancamentos: number }>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    return (await sql<Record<string, unknown>>`
      SELECT o.codorigem, o.descorigem, count(d.coddiario)::int AS lancamentos
        FROM origem_contabil o
        LEFT JOIN diario d ON d.codorigem = o.codorigem AND d.codempresa = ${emp}
       GROUP BY o.codorigem, o.descorigem
       ORDER BY o.codorigem
    `.execute(db)).rows as never;
  }

  async listar(f: FiltroLancamentos): Promise<{
    linhas: Array<Record<string, unknown>>;
    totais: { linhas: number; debito: number; credito: number; diferenca: number };
    porOrigem: Array<{ codorigem: number; origem: string; linhas: number; valor: number }>;
    truncado: boolean;
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const LIMITE = 10000;

    const onde = [
      sql`d.codempresa = ${emp}`,
      sql`d.datalan BETWEEN ${f.dataIni}::date AND ${f.dataFim}::date`,
    ];
    if (f.codorigem) onde.push(sql`d.codorigem = ${f.codorigem}`);
    if (f.codoperacao) onde.push(sql`d.codoperacao = ${f.codoperacao}`);
    if (f.documento) onde.push(sql`d.documento ILIKE ${`%${f.documento}%`}`);
    // a conta procura dos DOIS lados — é como o contador procura
    if (f.conta) onde.push(sql`(d.contadebito = ${f.conta} OR d.contacredito = ${f.conta})`);
    if (f.somenteSingle) onde.push(sql`(d.contadebito IS NULL OR d.contacredito IS NULL)`);

    const linhas = (await sql<Record<string, unknown>>`
      SELECT d.coddiario, to_char(d.datalan, 'YYYY-MM-DD') AS datalan,
             d.contadebito, pc.codireduzido AS reduzido_debito, pc.codiexpandido AS expandido_debito,
             pc.descricao AS desc_debito,
             d.contacredito, p.codireduzido AS reduzido_credito, p.codiexpandido AS expandido_credito,
             p.descricao AS desc_credito,
             d.valor, d.documento, d.tipodoc, d.codhist, d.deschist, d.complemento,
             d.codorigem, o.descorigem AS origem, d.idorigem, d.codoperacao, d.codlote
        FROM diario d
        LEFT JOIN plano_contas pc     ON pc.codplanocontas = d.contadebito
        LEFT JOIN plano_contas p      ON p.codplanocontas  = d.contacredito
        LEFT JOIN origem_contabil o   ON o.codorigem = d.codorigem
       WHERE ${sql.join(onde, sql` AND `)}
       ORDER BY d.datalan, d.coddiario
       LIMIT ${LIMITE + 1}
    `.execute(db)).rows;

    const truncado = linhas.length > LIMITE;
    if (truncado) linhas.length = LIMITE;

    const n = (v: unknown) => Number(v ?? 0);
    const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
    // débito e crédito somam SEPARADO porque parte das origens grava linha de um lado só (a integração
    // contábil: 893, 2004, 2009, 910). A diferença entre os dois é a medida de quanto está partido.
    const debito = r2(linhas.filter((l) => l.contadebito != null).reduce((s, l) => s + n(l.valor), 0));
    const credito = r2(linhas.filter((l) => l.contacredito != null).reduce((s, l) => s + n(l.valor), 0));

    const porOrigemMap = new Map<number, { codorigem: number; origem: string; linhas: number; valor: number }>();
    for (const l of linhas) {
      const cod = Number(l.codorigem ?? 0);
      const a = porOrigemMap.get(cod) ?? { codorigem: cod, origem: (l.origem as string) ?? `origem ${cod}`, linhas: 0, valor: 0 };
      a.linhas += 1; a.valor = r2(a.valor + n(l.valor)); porOrigemMap.set(cod, a);
    }

    return {
      linhas,
      totais: { linhas: linhas.length, debito, credito, diferenca: r2(debito - credito) },
      porOrigem: Array.from(porOrigemMap.values()).sort((a, b) => b.valor - a.valor),
      truncado,
    };
  }

  /**
   * A ponte do lançamento para o documento que o gerou. O legado resolve dois casos; aqui estão os que o
   * Apollo grava hoje — e o que não tem ponte devolve `documento: null` com o `idorigem` cru, em vez de
   * apontar para o lugar errado.
   */
  async origemDoLancamento(coddiario: number): Promise<{
    coddiario: number; codorigem: number; origem: string | null; idorigem: number | null;
    tipo: string | null; documento: number | null; rota: string | null;
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const d = (await sql<Record<string, unknown>>`
      SELECT d.coddiario, d.codorigem, d.idorigem, o.descorigem
        FROM diario d LEFT JOIN origem_contabil o ON o.codorigem = d.codorigem
       WHERE d.coddiario = ${coddiario} AND d.codempresa = ${emp}
    `.execute(db)).rows[0];
    if (!d) throw new BusinessRuleError('LANCAMENTO_NAO_ENCONTRADO', { coddiario });

    const cod = Number(d.codorigem);
    const id = d.idorigem == null ? null : Number(d.idorigem);
    const base = {
      coddiario, codorigem: cod, origem: (d.descorigem as string) ?? null, idorigem: id,
      tipo: null as string | null, documento: null as number | null, rota: null as string | null,
    };
    if (id == null) return base;

    // 16 = baixa de A RECEBER → o título; 15 = baixa de A PAGAR → o título (`:422`/`:435`)
    if (cod === 16) {
      const r = (await sql<{ codrcb: number }>`
        SELECT codrcb FROM areceber_bx WHERE codrcbbx = ${id} AND coalesce(indr,'I') = 'I'
      `.execute(db)).rows[0];
      if (r) return { ...base, tipo: 'ARECEBER', documento: Number(r.codrcb), rota: `/cadastro/areceber/${r.codrcb}` };
    }
    if (cod === 15) {
      const r = (await sql<{ codapg: number }>`SELECT codapg FROM apagar_bx WHERE codapgbx = ${id}`.execute(db)).rows[0];
      if (r) return { ...base, tipo: 'APAGAR', documento: Number(r.codapg), rota: `/cadastro/apagar/${r.codapg}` };
    }
    // as origens em que o IDORIGEM JÁ é o documento
    if (cod === 12) return { ...base, tipo: 'NF', documento: id, rota: `/cadastro/nf/${id}` };
    if (cod === 13) return { ...base, tipo: 'APAGAR', documento: id, rota: `/cadastro/apagar/${id}` };
    if (cod === 14) return { ...base, tipo: 'ARECEBER', documento: id, rota: `/cadastro/areceber/${id}` };
    if (cod === 64) return { ...base, tipo: 'CAIXA', documento: id, rota: null };
    if ([51, 61, 62].includes(cod)) return { ...base, tipo: 'CARTAO', documento: id, rota: null };
    return base;
  }
}
