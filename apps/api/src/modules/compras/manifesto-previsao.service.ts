import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { configNaTrx } from './pedido-heranca';
import { parseNfeXml } from './nfe-xml.parser';
import { novoGrupo } from '../cobranca/apagar-caixa';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + (n >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;

export interface ParcelaPrevisao { nrparcela: string; valor: number; dtvenc: string | null }
export type FonteParcelas = 'FINANCEIRO' | 'XML' | 'TOTAL';

/** o texto do título (6.622 de 6.622 na geração): o nº da nota sem os zeros à esquerda */
export const OBS_PREVISAO = 'PREVISÃO GERADA A PARTIR DO MANIFESTO AO IMPORTAR A NF NO SISTEMA, DA NOTA FISCAL N:';

/**
 * A PREVISÃO DE A PAGAR DO MANIFESTO (o binário novo; o fonte de 2020 não a tem). Reconstruída da produção em 24/09/2026:
 * 6.632 previsões desde 18/03/2025 (3.601 em 2026), 100% gravadas pelo Retaguarda numa ação do operador, uma nota por vez,
 * quase sempre ANTES de a nota existir (89,6%: previsão → confirmação → importação). Não há critério automático no dado —
 * é escolha do usuário por nota (loja 1 47%, loja 2 85%) —, então aqui é uma ação da fila do manifesto, como lá.
 *  - As parcelas: a grade financeira da nota (`NFE_FINANCEIRO_MANIFESTO`) se o usuário a preencheu; senão o `<dup>` do XML
 *    (83,6% exatos); sem `<dup>`, uma parcela com o total da nota e o vencimento digitado.
 *  - Um título por parcela (`GeraApagar`): TIPODOC 'PREVISÃO', DTCOMPRA = DTVENC, DUPLICATA = o próprio código, NRODUP 1 e
 *    parcela "1/1" em todas, um CODGRUPO por título, a situação `SITUACAO_GERACAO_PREVISAO_APAGAR_MANIFESTO` (3540), a CHAVENFE,
 *    IDNF nulo, GERADO 'SISTEMA'; o rateio no CC `CC_GERACAO_PREVISAO_APAGAR_MANIFESTO` (3721, "compras provisionadas"). Sem CAIXA:
 *    ela nasce quando a nota é faturada e a previsão é convertida (`nf-faturamento.service.ts`).
 *  - Não gera de novo enquanto houver previsão da chave ainda não convertida.
 */
@Injectable()
export class ManifestoPrevisaoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private async cfg(db: AnyDB, codigo: string, emp: number): Promise<string | null> {
    return configNaTrx(db, codigo, { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' });
  }

  private async fila(db: AnyDB, cod: number, emp: number, travar = false): Promise<Record<string, unknown>> {
    const f = (await sql<Record<string, unknown>>`SELECT * FROM nfe_nao_cadastradas WHERE codnfe_naocad = ${cod} AND idempresa = ${emp}
        ${travar ? sql`FOR UPDATE` : sql``}`.execute(db)).rows[0];
    if (!f) throw new BusinessRuleError('NOTA_NAO_ENCONTRADA', { cod });
    if (!f.chavenfe) throw new BusinessRuleError('NFE_XML_NAO_ENCONTRADO', { cod });
    return f;
  }

  private async xml(db: AnyDB, chave: string) {
    const x = (await sql<{ xml: string | null }>`SELECT xml FROM nfe_xml WHERE chavenfe = ${chave} AND xml IS NOT NULL ORDER BY codnfexml DESC LIMIT 1`.execute(db)).rows[0]?.xml;
    if (!x) return null;
    try { return parseNfeXml(x); } catch { return null; }
  }

  /** as parcelas, na ordem de prioridade do legado: a grade financeira, o `<dup>` do XML, o total da nota */
  private async parcelas(db: AnyDB, f: Record<string, unknown>): Promise<{ parcelas: ParcelaPrevisao[]; fonte: FonteParcelas; nNF: string }> {
    const chave = String(f.chavenfe);
    const nfe = await this.xml(db, chave);
    const nNF = String(f.nronf ?? nfe?.nNF ?? '').replace(/^0+(?=\d)/, '');
    const fm = (await sql<{ nrparcela: string | null; data: string | null; valor: string | null }>`
        SELECT nrparcela, to_char(data, 'YYYY-MM-DD') AS data, valor FROM nfe_financeiro_manifesto WHERE chavenfe = ${chave}
         ORDER BY nrparcela, id_fm`.execute(db)).rows;
    if (fm.length) return { fonte: 'FINANCEIRO', nNF, parcelas: fm.map((r, i) => ({ nrparcela: r.nrparcela ?? String(i + 1).padStart(3, '0'), valor: r2(num(r.valor)), dtvenc: r.data })) };
    if (nfe?.duplicatas.length) return { fonte: 'XML', nNF, parcelas: nfe.duplicatas.map((d, i) => ({ nrparcela: d.nDup || String(i + 1).padStart(3, '0'), valor: r2(num(d.vDup)), dtvenc: d.dVenc || null })) };
    return { fonte: 'TOTAL', nNF, parcelas: [{ nrparcela: '001', valor: r2(num(f.totalnf) || num(nfe?.total.vNF)), dtvenc: null }] };
  }

  private async fornecedor(db: AnyDB, cnpj: unknown): Promise<{ codparceiro: number; razao: string } | undefined> {
    const doc = String(cnpj ?? '').replace(/\D/g, '');
    if (!doc) return undefined;
    return (await sql<{ codparceiro: number; razao: string }>`SELECT p.codparceiro, p.razao FROM parceiros p JOIN parceiros_end e ON e.codparceiro = p.codparceiro
        WHERE regexp_replace(e.cnpj_cpf, '[^0-9]', '', 'g') = ${doc} ORDER BY (p.frn = 'S') DESC, p.codparceiro LIMIT 1`.execute(db)).rows[0];
  }

  private async abertas(db: AnyDB, chave: string, emp: number): Promise<number> {
    return num((await sql<{ n: number }>`SELECT count(*)::int AS n FROM apagar WHERE chavenfe = ${chave} AND codempresa = ${emp}
        AND tipodoc = 'PREVISÃO' AND idnf IS NULL`.execute(db)).rows[0]?.n);
  }

  /** a sugestão que a tela mostra antes de gerar */
  async sugestao(cod: number) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const f = await this.fila(db, cod, emp);
    const { parcelas, fonte, nNF } = await this.parcelas(db, f);
    const forn = await this.fornecedor(db, f.cnpj);
    const configurado = num(await this.cfg(db, 'SITUACAO_GERACAO_PREVISAO_APAGAR_MANIFESTO', emp)) > 0
      && num(await this.cfg(db, 'CC_GERACAO_PREVISAO_APAGAR_MANIFESTO', emp)) > 0;
    return {
      chavenfe: f.chavenfe, nronf: nNF, razao: f.razao ?? null, totalnf: num(f.totalnf), parcelas, fonte, configurado,
      codparceiro: forn?.codparceiro ?? null, fornecedor: forn?.razao ?? null, jaGerada: (await this.abertas(db, String(f.chavenfe), emp)) > 0,
    };
  }

  /**
   * GERAR — com parcelas no corpo, elas são a grade financeira da nota (gravadas em NFE_FINANCEIRO_MANIFESTO, como a tela do
   * legado grava antes de gerar); sem, valem as que já estão lá, o XML ou o total.
   */
  async gerar(cod: number, dto: { parcelas?: Array<{ nrparcela?: string; valor: number; dtvenc: string }> }) {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const f = await this.fila(trx, cod, emp, true);
      const chave = String(f.chavenfe);
      const situacao = num(await this.cfg(trx, 'SITUACAO_GERACAO_PREVISAO_APAGAR_MANIFESTO', emp));
      const cc = num(await this.cfg(trx, 'CC_GERACAO_PREVISAO_APAGAR_MANIFESTO', emp));
      if (!(situacao > 0) || !(cc > 0)) throw new BusinessRuleError('PREVISAO_MANIFESTO_NAO_CONFIGURADA');
      if ((await this.abertas(trx, chave, emp)) > 0) throw new BusinessRuleError('PREVISAO_MANIFESTO_JA_GERADA', { chavenfe: chave });
      const forn = await this.fornecedor(trx, f.cnpj);
      if (!forn) throw new BusinessRuleError('NFE_FORNECEDOR_NAO_ENCONTRADO', { cnpj: f.cnpj });

      if (dto.parcelas?.length) {
        await sql`DELETE FROM nfe_financeiro_manifesto WHERE chavenfe = ${chave}`.execute(trx);
        for (let i = 0; i < dto.parcelas.length; i++) {
          const p = dto.parcelas[i];
          await sql`INSERT INTO nfe_financeiro_manifesto (nrparcela, chavenfe, data, valor)
              VALUES (${(p.nrparcela ?? String(i + 1).padStart(3, '0')).slice(0, 20)}, ${chave}, ${p.dtvenc}::date, ${r2(num(p.valor))})`.execute(trx);
        }
      }
      const { parcelas, fonte, nNF } = await this.parcelas(trx, f);
      for (const p of parcelas) {
        if (!(p.valor > 0)) throw new BusinessRuleError('PREVISAO_MANIFESTO_PARCELA_INVALIDA', { parcela: p.nrparcela });
        if (!p.dtvenc) throw new BusinessRuleError('PREVISAO_MANIFESTO_SEM_VENCIMENTO', { parcela: p.nrparcela });
      }
      const tz = (await this.cfg(trx, 'FUSO_HORARIO_ACESSO', emp)) ?? 'America/Sao_Paulo';
      const titulos: number[] = [];
      for (const p of parcelas) {
        const codgrupo = await novoGrupo(trx);
        const dia = sql`((${p.dtvenc}::date)::timestamp AT TIME ZONE ${tz})`;
        const t = (await sql<{ codapg: number }>`
          INSERT INTO apagar (codparceiro, codempresa, codoperador, dtvenda, dtcompra, dtvenc, valor, obs, tipodoc, quitada, agrupado,
                              nrodup, nrparcela, codgrupo, idsituacao_nf, chavenfe, gerado, txjuros, desconto, vendor,
                              convenio, operacao_convenio_funcionario, geradocartaoproprio, dtcadastro)
          VALUES (${forn.codparceiro}, ${emp}, ${op}, ${dia}, ${p.dtvenc}::date, ${dia}, ${p.valor}, ${`${OBS_PREVISAO}${nNF}`}, 'PREVISÃO', 'N', 'N',
                  1, '1/1', ${codgrupo}, ${situacao}, ${chave}, 'SISTEMA', 0, 0, 0, 'N', 'D', 'N', now())
          RETURNING codapg`.execute(trx)).rows[0];
        await sql`UPDATE apagar SET duplicata = ${String(t.codapg)} WHERE codapg = ${t.codapg}`.execute(trx);
        await sql`INSERT INTO cx_apagar (codapg, codcc, valor, codgrupo, tipo, idsituacao_nf, dtultimalteracao)
            VALUES (${t.codapg}, ${cc}, ${p.valor}, ${codgrupo}, 'V', ${situacao}, now())`.execute(trx);
        titulos.push(num(t.codapg));
      }
      return { chavenfe: chave, fonte, titulos, total: r2(parcelas.reduce((s, p) => s + p.valor, 0)) };
    });
  }
}
