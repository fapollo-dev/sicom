import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { configNaTrx } from '../compras/pedido-heranca';
import { LiberacaoService } from '../auth/liberacao.service';
import { AggregateEngineService } from '../../shared/crud/aggregate-engine.service';
import { scrapAggregateConfig } from './scrap.aggregate';
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
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly liberacao: LiberacaoService,
    private readonly engine: AggregateEngineService,
  ) {}

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
      // a auditoria do uCadSCRAP.dfm (14/10/2026): a coluna "Cod.Prod Filho" (FormShow), a senha para excluir (PermiteExcluir), o produto
      // repetido (GetProduto) e os dias do lançamento retroativo (edtDataExit)
      exibeProdutoPai: await cfg('EXIBE_CAMPO_PRODUTO_PAI', 'N'),
      pedeSenhaExcluir: await cfg('PEDE_SENHA_EXCLUIR_ITEM_SCRAP', 'N'),
      bloqueiaDuplicado: await cfg('BLOQUEIA_PRODUTO_DUPLICADO_SCRAP', 'N'),
      diasRetroativo: ((v) => (v == null ? null : Number(v) || 0))(await configNaTrx(db, 'DIAS_PERMITIDO_LANCTO_RETROATIVO_SCRAP', ctx)),
    };
  }

  /**
   * O produto do item pelo código de barras (ou código auxiliar) — ou pelo código do produto com "Buscar por PLU (F2)" — como o
   * `GetProduto`/`GetProdutoFilho` (udmCadSCRAP.pas:382/332): o produto FILHO leva ao pai (IDPRODUTO_PAI) e fica no IDPRODUTO_FILHO; o
   * custo é o MULTI_PRECO da loja; com IMPEDIR_MOVIMENTO_ESTOQUE_NEGATIVO só entra com estoque; o fornecedor é o da última entrada
   * (ESTOQUE.IDORIGEM_ENT → NF, senão o PRODUTOS.CODFOR — `SetaOutrasInformacoesItemScrap` :441).
   */
  async produto(codigo: string, plu: boolean): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const ctx = { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' };
    const cod = String(codigo ?? '').trim();
    if (!cod) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { codigo: cod });
    const achado = plu
      ? (Number.isInteger(Number(cod)) ? (await sql<Record<string, unknown>>`SELECT p.idproduto, p.idproduto_pai FROM produtos p WHERE p.idproduto = ${Number(cod)} LIMIT 1`.execute(db)).rows[0] : undefined)
      : (await sql<Record<string, unknown>>`
          SELECT p.idproduto, p.idproduto_pai FROM produtos p LEFT JOIN codauxiliar ax ON ax.idproduto = p.idproduto
           WHERE p.codbarra = ${cod} OR ax.codauxiliar = ${cod} ORDER BY p.idproduto LIMIT 1`.execute(db)).rows[0];
    if (!achado) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { codigo: cod });
    const pai = Number(achado.idproduto_pai) > 0 ? Number(achado.idproduto_pai) : Number(achado.idproduto);
    const filho = Number(achado.idproduto_pai) > 0 ? Number(achado.idproduto) : 0;
    const impedirNegativo = String((await configNaTrx(db, 'IMPEDIR_MOVIMENTO_ESTOQUE_NEGATIVO', ctx)) ?? 'N').toUpperCase() === 'S';
    const r = (await sql<Record<string, unknown>>`
      SELECT pro.idproduto, pro.codbarra, pro.unidade, coalesce(nullif(prof.descricao, ''), pro.descricao) AS descricao, prof.codbarra AS codbarra_filho,
             pr.vrcusto, pr.vrcustorep, coalesce(e.qtde, 0) AS qtde_estoque
        FROM produtos pro
        LEFT JOIN produtos prof ON prof.idproduto = ${filho}
        LEFT JOIN multi_preco pr ON pr.idproduto = pro.idproduto AND pr.idempresa = ${emp}
        LEFT JOIN estoque e ON e.idproduto = pro.idproduto AND e.idempresa = ${emp}
       WHERE pro.idproduto = ${pai}`.execute(db)).rows[0];
    if (!r || (impedirNegativo && !(Number(r.qtde_estoque) > 0))) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { codigo: cod });
    const ultFor = (await sql<Record<string, unknown>>`
      SELECT f.codparceiro, f.razao FROM estoque e
        LEFT JOIN nf n ON n.codnf = e.idorigem_ent
        LEFT JOIN produtos p ON p.idproduto = e.idproduto
        LEFT JOIN parceiros f ON f.codparceiro = coalesce(n.codparceiro, p.codfor)
       WHERE e.idempresa = ${emp} AND e.idproduto = ${pai} LIMIT 1`.execute(db)).rows[0];
    return {
      idproduto: pai, idproduto_filho: filho > 0 ? filho : null, codbarra: filho > 0 ? r.codbarra_filho ?? r.codbarra : r.codbarra, descricao: r.descricao,
      unidade: r.unidade, vrcusto: Number(r.vrcusto ?? 0), vrcustorep: Number(r.vrcustorep ?? 0), qtde_estoque: Number(r.qtde_estoque ?? 0),
      codfor: Number(ultFor?.codparceiro ?? 0) > 0 ? Number(ultFor?.codparceiro) : null, fornecedor: ultFor?.razao ?? null,
    };
  }

  /**
   * PEDE_SENHA_EXCLUIR_ITEM_SCRAP ('S' na produção): excluir item gravado ou o scrap pede a liberação por login de quem tem a
   * config em 'N' (o usuário 1 na produção) — `PermiteExcluir` (uCadSCRAP.pas:1749) via `ChamaLiberacaoLogin`.
   */
  private async liberarExclusao(db: AnyDB, cred: { login?: string; senha?: string }, item: boolean, texto: string): Promise<void> {
    const emp = this.emp();
    const ctx = { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' };
    if (String((await configNaTrx(db, 'PEDE_SENHA_EXCLUIR_ITEM_SCRAP', ctx)) ?? 'N').toUpperCase() !== 'S') return;
    if (!cred.login || !cred.senha) throw new BusinessRuleError('SCRAP_EXCLUSAO_PEDE_LIBERACAO');
    const sup = (await db.selectFrom('operadores').select(['codoperador']).where(sql`upper(login)`, '=', String(cred.login).toUpperCase())
      .where(sql`coalesce(indr,'I')`, '<>', 'E').executeTakeFirst()) as { codoperador: number } | undefined;
    const libera = !!sup && String((await configNaTrx(db, 'PEDE_SENHA_EXCLUIR_ITEM_SCRAP', { empresaId: emp, operadorId: Number(sup.codoperador), modulo: 'Retaguarda' })) ?? 'N').toUpperCase() !== 'S';
    const r = await this.liberacao.validar({ codigo: 'PEDE_SENHA_EXCLUIR_ITEM_SCRAP', login: cred.login, senha: cred.senha, liberacao: texto, permitidos: libera && sup ? [Number(sup.codoperador)] : [] });
    if (!r.liberado) throw new BusinessRuleError(item ? 'SCRAP_EXCLUSAO_ITEM_NAO_LIBERADA' : 'SCRAP_EXCLUSAO_NAO_LIBERADA');
  }

  /** "Excluir" da grade sobre o item GRAVADO (btnExcluirIClick, :535): a liberação e o gravar com os itens que ficam (o motor confere BTNEXCLUIRI e loga) */
  async excluirItens(codscrap: number, dto: { codscrapitens?: number[]; login?: string; senha?: string }) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const atual = await this.engine.readAggregate(scrapAggregateConfig, codscrap) as Record<string, unknown> | undefined;
    if (!atual) throw new BusinessRuleError('SCRAP_NAO_ENCONTRADO', { codscrap });
    const itens = (atual.itens as Array<Record<string, unknown>>) ?? [];
    const sair = new Set((dto.codscrapitens ?? []).map(Number));
    if (!sair.size) throw new BusinessRuleError('SCRAP_ITEM_NAO_ENCONTRADO', { codscrap });
    for (const c of sair) if (!itens.some((i) => Number(i.codscrapitem) === c)) throw new BusinessRuleError('SCRAP_ITEM_NAO_ENCONTRADO', { codscrap, codscrapitem: c });
    await this.liberarExclusao(db, dto, true, `EXCLUSAO DE ITEM DO SCRAP ${codscrap}: ${[...sair].join(', ')}`);
    const ficam = itens.filter((i) => !sair.has(Number(i.codscrapitem))).map((i) => ({
      idproduto: Number(i.idproduto), qtde: Number(i.qtde), codmotivoop: i.codmotivoop ?? null, codsetor: i.codsetor ?? null, codfor: i.codfor ?? null,
      idproduto_filho: i.idproduto_filho ?? null, origem_estoque: i.origem_estoque ?? null, obs: i.obs ?? null,
    }));
    await this.engine.updateAggregate(scrapAggregateConfig, codscrap, { itens: ficam });
    return this.engine.readAggregate(scrapAggregateConfig, codscrap);
  }

  /** "Excluir" do documento (btnExcluirClick, :510): a liberação e a exclusão do motor (com as travas do validarRemocao) */
  async excluirComLiberacao(codscrap: number, dto: { login?: string; senha?: string }) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const s = (await db.selectFrom('scrap').select(['codscrap']).where('codscrap', '=', codscrap).executeTakeFirst()) as { codscrap: number } | undefined;
    if (!s) throw new BusinessRuleError('SCRAP_NAO_ENCONTRADO', { codscrap });
    await this.liberarExclusao(db, dto, false, `EXCLUSAO DO SCRAP ${codscrap}`);
    await this.engine.removeAggregate(scrapAggregateConfig, codscrap);
    return { codscrap };
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
