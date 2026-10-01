import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { configNaTrx } from '../compras/pedido-heranca';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { colunasNumericas, empresaParaRelatorio, registroFr3 } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000; // numeric(13,3)

/**
 * SCRAP / PERDAS — ações verticais de BAIXA de estoque (molde ajuste-estoque). O documento (cabeçalho+itens) é
 * criado pelo agregado (scrap.aggregate); aqui aplica-se/estorna-se o efeito no estoque, decoplado como no
 * Inventário. `aplicar`: por item, DECREMENTA `estoque.qtde` em `qtde` (movimento RELATIVO — a perda tira do saldo)
 * e grava o KARDEX (`historico_prod`, origem='SCRAP'); marca `scrap.mov_estoque='S'`. `estornar`: reverte com
 * movimento relativo oposto (+qtde) e limpa `mov_estoque`. Movimento RELATIVO (não restaura saldo absoluto) →
 * compõe corretamente mesmo com movimento posterior de outra origem. qtde é SIGNED (fiel ao golden): qtde<0 num
 * item inverte o sentido naturalmente. Tenant por `idempresa` fail-closed; operador obrigatório.
 *
 * A baixa NO PRÓPRIO SCRAP só existe com `BAIXAR_ESTOQUE_NO_SCRAP='S'` ("define se o estoque será baixado na criação
 * do scrap", config do binário novo). Na produção ela é 'N' e nenhum scrap tem `MOV_ESTOQUE='S'`: quem baixa o
 * estoque é o processamento da NF DE PERDA em que o scrap é importado (`nf-scrap.service.ts`) — aplicar aqui e
 * processar a NF baixaria duas vezes.
 */
@Injectable()
export class ScrapService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private op(): number {
    const o = currentTenant().operadorId ?? null;
    if (o == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return o;
  }

  /**
   * o apoio da tela (uCadSCRAP.pas): as situações de SCRAP (TIPO_OPERACAO 'E02', `InformaSituacaoDocumento` :1625), os centros de
   * custo de perda (GET_PLC com PERDA='S' e o comprimento da máscara, `btnBuscaPLCClick`; a lista da situação vem em
   * `situacao_nf_plc`), os setores (FAMILIAS_PROD TIPO 'E' — o 'SETOR' do GET_FAMILIAS_PROD — ativos, :455), o parceiro da empresa e as três configurações.
   */
  async apoio(): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const ctx = { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' };
    const cfg = async (c: string, def: string) => String((await configNaTrx(db, c, ctx)) ?? def).toUpperCase() === 'S';
    const situacoes = (await sql<Record<string, unknown>>`SELECT idsituacao_nf, descricao FROM situacao_nf WHERE tipo_operacao = 'E02' ORDER BY idsituacao_nf`.execute(db)).rows;
    const permitidos = (await sql<{ s: number; p: number }>`SELECT idsituacao_nf AS s, codplc AS p FROM situacao_nf_plc WHERE idsituacao_nf IN (SELECT idsituacao_nf FROM situacao_nf WHERE tipo_operacao = 'E02')`.execute(db)).rows;
    const mascara = (await sql<{ m: string | null }>`SELECT mascaraplc AS m FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0]?.m ?? null;
    const centros = (await sql<Record<string, unknown>>`
      SELECT codplc, desccodplc, descricao, coalesce(flg_uso_setor, 'N') AS uso_setor, coalesce(plc_obriga_motivo_perda, 'N') AS obriga_motivo
        FROM plc WHERE coalesce(flg_perda, 'N') = 'S'
         AND (${mascara}::text IS NULL OR char_length(coalesce(desccodplc, '')) = char_length(${mascara}::text))
       ORDER BY desccodplc, codplc`.execute(db)).rows;
    const setores = (await sql<Record<string, unknown>>`SELECT codfamilia AS codsetor, descricao AS nome FROM familias_prod WHERE tipo = 'E' AND coalesce(ativo, 'S') = 'S' ORDER BY descricao`.execute(db)).rows;
    const parc = (await sql<{ codparceiro: number | null; razao: string | null }>`
      SELECT e.codparceiro, p.razao FROM empresas e LEFT JOIN parceiros p ON p.codparceiro = e.codparceiro WHERE e.idempresa = ${emp} LIMIT 1`.execute(db)).rows[0];
    return {
      situacoes, centros,
      centrosDaSituacao: permitidos.reduce<Record<number, number[]>>((acc, r) => ((acc[Number(r.s)] ??= []).push(Number(r.p)), acc), {}),
      setores, parceiro: parc ?? null,
      informaSituacao: await cfg('INFORMA_SITUACAO_DOCUMENTO_SCRAP', 'N'),
      informaMotivo: await cfg('INFORMA_MOTIVO_PERDA_SCRAP', 'N'),
      baixarEstoque: await cfg('BAIXAR_ESTOQUE_NO_SCRAP', 'N'),
    };
  }

  /** sem `BAIXAR_ESTOQUE_NO_SCRAP='S'` a baixa é da NF de perda — aplicar/estornar aqui recusa */
  private async exigirBaixaNoScrap(trx: AnyDB, emp: number): Promise<void> {
    const v = await configNaTrx(trx, 'BAIXAR_ESTOQUE_NO_SCRAP', { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' });
    if (String(v ?? 'N').toUpperCase() !== 'S') throw new BusinessRuleError('SCRAP_BAIXA_PELA_NF');
  }

  /** aplica a baixa de estoque de TODOS os itens do scrap (idempotente pela guarda mov_estoque). */
  async aplicar(codscrap: number): Promise<{ codscrap: number; mov_estoque: 'S'; itens: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.exigirBaixaNoScrap(trx, emp);
      const s = await trx
        .selectFrom('scrap').select(['codscrap', 'mov_estoque', 'importado'])
        .where('codscrap', '=', codscrap).where('idempresa', '=', emp)
        .forUpdate().executeTakeFirst();
      if (!s) throw new BusinessRuleError('SCRAP_NAO_ENCONTRADO', { codscrap });
      if ((s as any).mov_estoque === 'S') throw new BusinessRuleError('SCRAP_ESTOQUE_JA_APLICADO', { codscrap });
      if ((s as any).importado === 'S') throw new BusinessRuleError('SCRAP_JA_FATURADO', { codscrap });

      const itens = (await trx.selectFrom('scrap_item').select(['idproduto', 'qtde']).where('codscrap', '=', codscrap).execute()) as Array<{ idproduto: number; qtde: unknown }>;
      for (const it of itens) {
        await this.moverEstoque(trx, emp, Number(it.idproduto), -r3(num(it.qtde)), op, `Baixa de estoque via SCRAP cod ${codscrap}`);
      }
      await trx.updateTable('scrap').set({ mov_estoque: 'S', usultalteracao: op, dtultimalteracao: sql`now()` }).where('codscrap', '=', codscrap).where('idempresa', '=', emp).execute();
      return { codscrap, mov_estoque: 'S' as const, itens: itens.length };
    });
  }

  /** estorna a baixa (reverte o saldo com movimento relativo oposto) e limpa mov_estoque. */
  async estornar(codscrap: number): Promise<{ codscrap: number; mov_estoque: null; itens: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await this.exigirBaixaNoScrap(trx, emp);
      const s = await trx
        .selectFrom('scrap').select(['codscrap', 'mov_estoque', 'importado'])
        .where('codscrap', '=', codscrap).where('idempresa', '=', emp)
        .forUpdate().executeTakeFirst();
      if (!s) throw new BusinessRuleError('SCRAP_NAO_ENCONTRADO', { codscrap });
      if ((s as any).mov_estoque !== 'S') throw new BusinessRuleError('SCRAP_ESTOQUE_NAO_APLICADO', { codscrap });
      if ((s as any).importado === 'S') throw new BusinessRuleError('SCRAP_JA_FATURADO', { codscrap });

      const itens = (await trx.selectFrom('scrap_item').select(['idproduto', 'qtde']).where('codscrap', '=', codscrap).execute()) as Array<{ idproduto: number; qtde: unknown }>;
      for (const it of itens) {
        await this.moverEstoque(trx, emp, Number(it.idproduto), r3(num(it.qtde)), op, `Estorno de estoque via SCRAP cod ${codscrap}`);
      }
      await trx.updateTable('scrap').set({ mov_estoque: null, usultalteracao: op, dtultimalteracao: sql`now()` }).where('codscrap', '=', codscrap).where('idempresa', '=', emp).execute();
      return { codscrap, mov_estoque: null, itens: itens.length };
    });
  }

  /** movimento RELATIVO do saldo (delta<0 baixa / delta>0 estorno) + 1 linha de KARDEX (historico_prod, origem='SCRAP'). */
  private async moverEstoque(trx: AnyDB, emp: number, idproduto: number, delta: number, op: number, historico: string) {
    const est = await trx
      .selectFrom('estoque').select(['id_estoque', 'qtde'])
      .where('idproduto', '=', idproduto).where('idempresa', '=', emp)
      .forUpdate().executeTakeFirst();
    const saldoAnt = r3(num((est as any)?.qtde));
    const saldoNovo = r3(saldoAnt + delta);
    if (est) {
      await trx.updateTable('estoque').set({ qtde: saldoNovo }).where('id_estoque', '=', (est as any).id_estoque).execute();
    } else {
      try {
        await trx.insertInto('estoque').values({ idproduto, idempresa: emp, qtde: saldoNovo }).execute();
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') throw new BusinessRuleError('SCRAP_ESTOQUE_CONCORRENTE', { idproduto });
        throw e;
      }
    }
    await trx.insertInto('historico_prod').values({
      idproduto, idempresa: emp, tipo: delta >= 0 ? 'E' : 'S', qtde: Math.abs(delta),
      saldo_anterior: saldoAnt, saldo_novo: saldoNovo, origem: 'SCRAP', codnf: null,
      historico, data: sql`now()`, codoperador: op,
    }).execute();
  }

  /**
   * "Imprimir Scrap" (`ImprimirScrap1Click`, uCadSCRAP.pas:1600): o `extr - Scrap.fr3` da RELATORIOS com o scrap da tela
   * (frxDBScrap = `sqqSCRAP`), os itens dele (frxDBScrapitem = `sqqSCRAP_Item`: o TOTAL é a quantidade × o custo ATUAL da loja no
   * MULTI_PRECO, não o custo gravado no item — fiel) e a empresa logada (frxDBEmpresa). O menu não tem Tag: vale o acesso à tela.
   */
  async impressao(codscrap: number) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const scrap = (await sql<Record<string, unknown>>`
      SELECT a.codscrap, a.dt_cadastro, a.codplc, p.desccodplc, a.obs, p.descricao, a.idempresa, a.codparceiro, pa.razao, a.idsituacao_nf,
             e.razao_social AS razaosocial, s.descricao AS situacao_descricao
        FROM scrap a
        LEFT JOIN plc p          ON p.codplc = a.codplc
        LEFT JOIN parceiros pa   ON pa.codparceiro = a.codparceiro
        LEFT JOIN empresas e     ON e.idempresa = a.idempresa
        LEFT JOIN situacao_nf s  ON s.idsituacao_nf = a.idsituacao_nf
       WHERE a.codscrap = ${codscrap} AND a.idempresa = ${emp}`.execute(db)).rows[0];
    if (!scrap) throw new BusinessRuleError('SCRAP_NAO_ENCONTRADO', { codscrap }, 'Scrap não encontrado.');
    const itens = (await sql<Record<string, unknown>>`
      SELECT a.codscrapitem, a.codscrap, a.idproduto, a.qtde, a.origem, a.motivo, a.faturado, a.vr_custo,
             CASE WHEN a.idproduto_filho IS NULL OR a.idproduto_filho = 0 THEN b.descricao
                  ELSE (SELECT pf.descricao FROM produtos pf WHERE pf.idproduto = a.idproduto_filho) END AS descricao,
             b.codbarra, m.vrcusto, a.vrcustorep, m.idempresa, a.qtde * m.vrcusto AS total, d.descricao AS depto, a.idproduto_filho,
             a.imp_vendas, a.origem_perda, a.codsetor, st.descricao AS setor, a.codmotivoop, o.descricao AS motivo_perda, a.codfor,
             f.razao AS fornecedor
        FROM scrap_item a
        LEFT JOIN produtos b          ON b.idproduto = a.idproduto
        LEFT JOIN parceiros f         ON f.codparceiro = a.codfor
        LEFT JOIN familias_prod d     ON d.codfamilia = b.coddpto AND d.tipo = 'D'
        LEFT JOIN familias_prod st    ON st.codfamilia = a.codsetor AND st.tipo = 'S'
        LEFT JOIN motivos_operacao o  ON o.codmotivoop = a.codmotivoop AND o.tipo_operacao = 'PERDA'
        LEFT JOIN multi_preco m       ON m.idproduto = a.idproduto AND m.idempresa = ${emp}
       WHERE a.codscrap = ${codscrap}
       ORDER BY a.codscrapitem`.execute(db)).rows;
    const nums = await colunasNumericas(db, ['scrap', 'scrap_item'], ['vrcusto', 'total']);
    return {
      titulo: `Scrap ${codscrap}`,
      modelo: await modeloFr3(db, 'extr - Scrap.fr3'),
      datasets: { frxDBScrap: [registroFr3(scrap, nums)], frxDBScrapitem: itens.map((r) => registroFr3(r, nums)), frxDBEmpresa: [await empresaParaRelatorio(db, emp)] },
    };
  }
}
