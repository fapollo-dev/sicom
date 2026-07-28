import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type StatusHist = 'abertos' | 'liquidados' | 'todos';
const STATUS_VALIDOS: readonly StatusHist[] = ['abertos', 'liquidados', 'todos'];

interface LinhaSQL {
  tipo: string;
  dtvenda_compra: string | null;
  dtvenc: string | null;
  nrocupom: string | null;
  valor: string | number | null; // pg numeric → string
  txjuros: string | number | null;
  duplicata: string | null;
  datapgto: string | null;
  atraso: number | null;
  tolerancia: number | null;
  total_com_juros: string | number | null;
  devolvido: string | null;
  agrupamento: number | null;
}

/**
 * HISTÓRICO FINANCEIRO do parceiro (aba tsSaldoParceiros do uCadClientes) — RELATÓRIO READ-ONLY.
 * Extrato UNION de CONTAS A RECEBER (+) e A PAGAR (−) do parceiro, com atraso/juros/saldo corrente,
 * espelhando o btnVisualizarSaldoParceirosClick (uCadClientes.pas:2438-2682) e a SQL base
 * (udmParceiros.dfm:2810-2964). Fiel ao MODO SIMPLES de juros (o TOTAL_COM_JUROS calculado na própria
 * SQL: juros/dia = TXJUROS-mensal/30 × dias-de-atraso, sobre o valor ORIGINAL, só quando atraso > tolerância
 * do parceiro). Saldo corrente e somatórios reproduzidos no laço em TS (linha a linha, na ordem da SQL).
 *
 * ADIADO (procedência): (a) CHEQUE — tabela não migrada; (b) AGRUPARECEBER / "conveniados" — golden vazio;
 * (c) MODO COMPOSTO (Configuracoes.JuroComposto='SIM', pas:2585-2634) — depende do subsistema de config
 * chave-valor (épico próprio; o mapeamento JuroComposto→chave vive no DmConfigura, fora do fonte; o tenant
 * tem JURO_COMPOSTO_BX_RECEBER='S' mas isso é da BAIXA, não desta tela); (d) multi-empresa (o legado soma
 * várias empresas selecionadas E os somatórios não são empresa-gated, só o grid é — aqui o escopo é a
 * empresa do tenant, então grid e somatórios coincidem; p/ parceiro cross-empresa o resumo do legado
 * excederia o nosso); (e) CONSILIADO='S' no ramo ARECEBER de "abertos" quando a empresa tem
 * FECHAMENTO_CAIXA='S' (pas:2472) — depende de config; nenhuma empresa do golden tem FECHAMENTO_CAIXA='S';
 * (f) gate de config PERMITIR_HISTORICO='S' + senha (config/RBAC — a aba fica sempre visível no web).
 * QUIRK FIEL: o LEFT JOIN às baixas (INDR='I') faz FAN-OUT (1 linha por baixa); TOTAL_COM_JUROS usa o
 * valor ORIGINAL em cada linha fanada, então `receber_com_juros` conta o total 1× por baixa — idêntico ao
 * laço do legado (não é bug; é paridade). "todos" no APAGAR inclui quitada NULL (legado usa LIKE '%%' que
 * exclui NULL) — imaterial: quitada tem DEFAULT 'N', nunca nula no monorepo.
 */
@Injectable()
export class ParceiroHistoricoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN'); // fail-closed (títulos são por empresa)
    return e;
  }

  async historico(codparceiro: number, statusRaw: string | undefined) {
    const status: StatusHist = (STATUS_VALIDOS as readonly string[]).includes(statusRaw ?? '')
      ? (statusRaw as StatusHist)
      : 'todos';
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;

    // Fragmentos de status por origem (fiéis às substituições de /*QUITADOA*/ /*QUITADO*/ /*AGRUPADO*/).
    // Origem A (ARECEBER) e P (APAGAR) têm regras ligeiramente distintas no legado.
    const arStatus =
      status === 'abertos'
        ? sql`AND a.quitada LIKE '%N%' AND COALESCE(a.agrupado,'N')='N'`
        : status === 'liquidados'
          ? sql`AND (a.quitada LIKE '%S%' OR (COALESCE(a.agrupado,'N')='S' AND COALESCE(a.codgrupo_agrupamento_rcb,0)>0))`
          : sql``;
    const apStatus =
      status === 'abertos'
        ? sql`AND c.quitada LIKE '%N%' AND COALESCE(c.agrupado,'N')='N'`
        : status === 'liquidados'
          ? sql`AND c.quitada LIKE '%S%'`
          : sql``;

    // Diferença de dias (atraso) e TOTAL_COM_JUROS (modo simples) calculados na SQL, como no legado.
    // ATRASO = max(0, hoje - dtvenc); juros só quando (hoje - dtvenc) > tolerância do parceiro; base = valor ORIGINAL.
    const q = sql<LinhaSQL>`
      SELECT * FROM (
        SELECT
          'ARECEBER'::varchar AS tipo,
          a.dtvenda AS dtvenda_compra,
          a.dtvenc AS dtvenc,
          a.nrocupom AS nrocupom,
          CASE WHEN COALESCE(bx.valorpg,0)=0 THEN a.valor ELSE bx.valorpg END AS valor,
          COALESCE(a.txjuros,0) AS txjuros,
          a.duplicata AS duplicata,
          bx.dtpgto::date AS datapgto,
          GREATEST(0, (CURRENT_DATE - a.dtvenc::date)) AS atraso,
          COALESCE(p.tolerancia,0) AS tolerancia,
          CASE WHEN (CURRENT_DATE - a.dtvenc::date) < COALESCE(p.tolerancia,0) THEN a.valor
               ELSE a.valor + (COALESCE(a.txjuros,0)/30.0) * GREATEST(0,(CURRENT_DATE - a.dtvenc::date)) * a.valor / 100 END AS total_com_juros,
          'N'::varchar AS devolvido,
          COALESCE(a.codgrupo_agrupamento_rcb,0) AS agrupamento,
          p.razao AS razao
        FROM areceber a
        LEFT JOIN parceiros p ON p.codparceiro = a.codparceiro
        LEFT JOIN areceber_bx bx ON bx.codrcb = a.codrcb AND COALESCE(bx.indr,'I')='I'
        WHERE a.codparceiro = ${codparceiro} AND a.codempresa = ${emp} AND a.valor > 0 ${arStatus}
        UNION ALL
        SELECT
          'APAGAR'::varchar AS tipo,
          c.dtvenda AS dtvenda_compra,
          c.dtvenc AS dtvenc,
          NULL AS nrocupom,
          CASE WHEN COALESCE(bz.valorpg,0)=0 THEN c.valor * -1 ELSE bz.valorpg * -1 END AS valor,
          COALESCE(c.txjuros,0) AS txjuros,
          c.duplicata AS duplicata,
          bz.dtpgto::date AS datapgto,
          GREATEST(0, (CURRENT_DATE - c.dtvenc::date)) AS atraso,
          COALESCE(d.tolerancia,0) AS tolerancia,
          0 AS total_com_juros,
          'N'::varchar AS devolvido,
          0 AS agrupamento,
          d.razao AS razao
        FROM apagar c
        LEFT JOIN parceiros d ON d.codparceiro = c.codparceiro
        LEFT JOIN apagar_bx bz ON bz.codapg = c.codapg AND COALESCE(bz.indr,'I')='I'
        WHERE c.codparceiro = ${codparceiro} AND c.codempresa = ${emp} AND c.valor > 0 ${apStatus}
      ) hist
      ORDER BY dtvenda_compra, dtvenc, razao, total_com_juros
    `;
    const { rows } = await q.execute(db);

    // Laço linha-a-linha (ordem da SQL) — saldo corrente + somatórios (fiel ao modo SIMPLES, pas:2636-2664).
    let saldo = 0;
    let saldoComJuro = 0;
    let receber = 0;
    let pagar = 0;
    let receberComJuros = 0; // SomaValorComJuro
    const linhas = rows.map((r) => {
      const valor = Number(r.valor ?? 0);
      const totalComJuros = Number(r.total_com_juros ?? 0);
      // VALOR_COM_JURO (coluna) = TOTAL_COM_JUROS (0 no APAGAR); SALDO_COM_JURO corrente usa TOTAL>0 senão VALOR.
      const valorComJuro = totalComJuros; // GetValor(TOTAL_COM_JUROS)
      saldo = r2(saldo + valor);
      saldoComJuro = r2(saldoComJuro + (totalComJuros > 0 ? totalComJuros : valor));
      if (r.tipo === 'ARECEBER' || r.tipo === 'CHEQUE') receber = r2(receber + valor);
      else if (r.tipo === 'APAGAR') pagar = r2(pagar + valor); // valor já negativo
      receberComJuros = r2(receberComJuros + valorComJuro);
      return {
        tipo: r.tipo,
        dtvenda_compra: r.dtvenda_compra,
        dtvenc: r.dtvenc,
        nrocupom: r.nrocupom,
        valor: r2(valor),
        saldo,
        txjuros: Number(r.txjuros ?? 0),
        valor_com_juro: r2(valorComJuro),
        saldo_com_juro: saldoComJuro,
        duplicata: r.duplicata,
        datapgto: r.datapgto,
        agrupamento: r.agrupamento || null,
        devolvido: r.devolvido, // 'N' (CHEQUE devolvido adiado); marca a linha em vermelho no legado
      };
    });

    // Crédito do parceiro (campo master, exibido direto) + Restante = (Pagar + Crédito) − Receber.
    // parceiros é empresaScoped por IDEMPRESA — filtrar por empresa TAMBÉM aqui (senão vaza o crédito de
    // um parceiro de outra empresa; as demais leituras de parceiros escopam por idempresa).
    const p = await db
      .selectFrom('parceiros')
      .select(['credito'])
      .where('codparceiro', '=', codparceiro)
      .where('idempresa', '=', emp)
      .executeTakeFirst();
    const credito = Number((p as { credito?: unknown } | undefined)?.credito ?? 0);
    const restante = r2(pagar + credito - receber);

    return {
      status,
      juros_modo: 'simples' as const, // composto adiado (depende de Configuracoes.JuroComposto)
      linhas,
      resumo: {
        receber: r2(receber),
        pagar: r2(pagar), // negativo
        receber_com_juros: r2(receberComJuros),
        credito: r2(credito),
        restante,
      },
    };
  }
}
