import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * os rótulos que o CASE do legado mapeia. Fora do mapa (CFN — 7 linhas no golden — e status 'E' — 1.239) o CASE
 * do legado devolve NULL: aqui também (fold auditoria [BAIXA]; era fallback p/ o código cru, o que o legado não
 * faz). Quem exibe decide o texto — a tela cai no código cru p/ não mostrar célula vazia.
 */
const TIPO_STR: Record<string, string> = {
  APN: 'Análise de pedido x Nota fiscal',
  RPN: 'Realizar nova análise de pedido x Nota fiscal',
};
const STATUS_STR: Record<string, string> = { A: 'Aberta', F: 'Finalizada' };

/**
 * PENDÊNCIAS DO OPERADOR (FRMPENDENCIASOPERADOR) — corte 1: a FILA; corte 2a: a ANÁLISE vinculada.
 * Procedência: UFrmPendenciasOperador.pas + UDMPendenciasOperador (a query do .dfm).
 * A tela do legado lista as pendências do OPERADOR LOGADO; aqui o filtro de operador é explícito
 * (default: o logado) e as ações de fila são finalizar (com observação) e reabrir.
 *
 * CORTE-2a (fiel ao QryPendencias):
 *  · FORNECEDOR = MIN(PAR.FANTASIA) da análise vinculada (PO_COMPLEMENTO = APN_ID → ANALISE_PEDIDO_NF_PEDIDO
 *    → PEDIDOCOMPRA → PARCEIROS), SÓ para APN/RPN — os demais tipos saem com '' (o ELSE do CASE). O
 *    stand-in do corte-1 (complemento=codnf → NF) foi removido: a convenção do complemento é a do legado.
 *  · VISIBILIDADE = as MINHAS pendências ∪ as APN/RPN DE OUTROS quando o operador LOGADO é supervisor do E8
 *    (USUARIOS_PERMITIDOS_LIBERAR_PEDIDO_COMPRA em configuracoes_especificas) — o UNION do .dfm, onde o
 *    :CODOPERADOR é sempre o operador da sessão. **O `codoperador` do filtro NÃO é identidade** (fold auditoria
 *    [ALTA]: usá-lo no teste do E8 deixaria um não-supervisor "emprestar" o grant de um supervisor e ler a fila
 *    inteira) — ele só REFINA, quando informado, dentro do que a sessão já pode ver.
 *  · ABRIR a análise (`analise()`) exige que a sessão VEJA uma pendência APN/RPN apontando aquele APN_ID — no
 *    legado o AbreAnalise só é alcançável pela linha visível do grid (fold auditoria: IDOR).
 *
 * DIVERGÊNCIAS DELIBERADAS (documentadas):
 *  1) o legado NÃO filtra empresa (a fila é cross-empresa e o grid tem coluna "Empresa"); aqui o escopo de
 *     tenant é lei do novo — `codempresa = tenant` na fila e na análise. Golden: 6.159/6.159 na empresa 1.
 *  2) `PRODUTOS` é INNER JOIN como no legado (linhas com produto inexistente — 5 no golden — não aparecem).
 *
 * CORTE-2b (declarado, fora daqui): o motor `NovaAnalise`/`ProcessarAnalise` (escrita) e o fluxo RPN
 * (`GeraNovaAnalise`: cria análise NOVA a partir dos pedidos/notas da antiga e finaliza a pendência);
 * "Liberar análise" (que finaliza a pendência via SetStatus e grava ANALISE_PEDIDO_NF_CR), "Excluir análise",
 * "Editar pedidos" (→ GeraPendenciaAnalista/GeraPendenciaComprador), a aba "Análise do produto" (botão Detalhar
 * → itens da NF do manifesto por produto, com FATOREMBAL/QUANTIDADE editáveis) e a impressão.
 */
@Injectable()
export class PendenciaOperadorService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** o operador da SESSÃO — a identidade do `:CODOPERADOR` do legado (nunca o do body). */
  private logado(): number | null {
    return currentTenant().operadorId ?? null;
  }

  /** SQL do E8: a sessão é supervisora que pode liberar pedido de compra (o IN (SELECT CE.CHAVE …) do .dfm). */
  private supervisorSql(op: number) {
    // o param do legado é ftInteger ⇒ o Oracle compara CE.CHAVE como NÚMERO ('07' casaria); replicado com o
    // guard de dígitos (chave é texto livre no cadastro de grants).
    return sql<boolean>`exists (select 1 from configuracoes c
                                join configuracoes_especificas ce on ce.id = c.id
                                where c.codigo = 'USUARIOS_PERMITIDOS_LIBERAR_PEDIDO_COMPRA'
                                  and ce.tipo = 'Usuario' and ce.valor = 'S'
                                  and ce.chave ~ '^[0-9]{1,9}$' and ce.chave::int = ${op})`;
  }

  async listar(f: { codoperador?: number; status?: string; tipo?: string }) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const op = this.logado();
    let q = db.selectFrom('pendencia_operador as p')
      .leftJoin('operadores as o', 'o.codoperador', 'p.codoperador')
      .leftJoin('operadores as oo', 'oo.codoperador', 'p.codoperador_origem')
      .select([
        'p.po_id', 'p.codoperador', sql`o.nome`.as('nome'),
        'p.po_tipo_pendencia_operador', 'p.po_status', 'p.po_complemento',
        'p.po_observacao', 'p.po_data', 'p.codempresa',
        sql`oo.nome`.as('nome_origem'),
        // CASE do QryPendencias: fornecedor via análise→pedido→parceiro, SÓ p/ APN/RPN (ELSE '').
        // Guard `{1,9}` (fold auditoria [ALTA]): sem o teto de dígitos um complemento numérico grande
        // (chave NFe de 44 dígitos, p.ex.) estoura o int4 e o erro derruba a LISTAGEM INTEIRA — a fila
        // ficaria inacessível justamente p/ apagar a linha. Fantasia pura como no legado (não coalesce).
        sql`case
              when p.po_tipo_pendencia_operador in ('APN','RPN') and p.po_complemento ~ '^[0-9]{1,9}$'
              then (select min(par.fantasia)
                    from analise_pedido_nf a
                    join analise_pedido_nf_pedido apnp on apnp.apn_id = a.apn_id
                    join pedidocompra pc on pc.codpedcomp = apnp.codpedcomp
                    join parceiros par on par.codparceiro = pc.codparceiro
                    where a.apn_id = p.po_complemento::int)
              else ''
            end`.as('fornecedor'),
      ])
      .where('p.codempresa', '=', emp);
    // visibilidade fiel (o UNION do .dfm), SEMPRE ancorada na SESSÃO: minhas ∪ APN/RPN de terceiros quando
    // a sessão é supervisora do E8. O f.codoperador só refina DEPOIS (nunca amplia).
    if (op != null) {
      q = q.where(sql<boolean>`(
        p.codoperador = ${op}
        or (p.po_tipo_pendencia_operador in ('APN','RPN') and ${this.supervisorSql(op)})
      )`);
    }
    if (f.codoperador != null) q = q.where('p.codoperador', '=', Number(f.codoperador));
    if (f.status) q = q.where('p.po_status', '=', f.status);
    if (f.tipo) q = q.where('p.po_tipo_pendencia_operador', '=', f.tipo);
    const rows = (await q.orderBy(sql`p.po_status`).orderBy(sql`p.po_data desc`).limit(1001).execute()) as Record<string, unknown>[];
    const truncado = rows.length > 1000;
    const linhas: Record<string, unknown>[] = (truncado ? rows.slice(0, 1000) : rows).map((r) => ({
      ...r,
      // fiel: o CASE do legado só rotula APN/RPN e A/F — fora do mapa devolve NULL (quem exibe decide)
      tipo_str: TIPO_STR[String(r.po_tipo_pendencia_operador)] ?? null,
      status_str: STATUS_STR[String(r.po_status)] ?? null,
    }));
    // a coluna "Operador" do grid legado só aparece p/ supervisor (UFrmPendenciasOperador.pas:154-162) —
    // agora que a fila traz linhas de terceiros, a tela precisa saber de quem é cada pendência.
    const supervisor = op == null ? false : Boolean(
      (await db.selectNoFrom([this.supervisorSql(op).as('ok')]).executeTakeFirst() as { ok?: boolean } | undefined)?.ok,
    );
    return {
      linhas,
      totais: {
        linhas: linhas.length,
        abertas: linhas.filter((l) => l.po_status === 'A').length,
      },
      filtro: { ...f, codoperador: f.codoperador ?? null, operador_sessao: op, supervisor, empresa: emp, truncado, max_linhas: 1000 },
    };
  }

  /**
   * ABRE a análise vinculada de uma pendência APN/RPN (corte-2a — o AbreAnalise do form, leitura).
   * Devolve o agregado persistido: cabeçalho + pedidos (c/ fornecedor) + notas (a referência é a fila do
   * manifesto — APNN_TABELA='NFE_NAO_CADASTRADAS' em 100% do golden) + divergências + itens fora do pedido
   * (ine_nf) e fora da NF (ine_pc). O motor que CRIA análises (NovaAnalise/ProcessarAnalise + RPN) é o corte-2b.
   *
   * GATE (fold auditoria — IDOR): o legado só chega aqui pela LINHA VISÍVEL do grid, então exigimos que a
   * SESSÃO veja uma pendência APN/RPN apontando este APN_ID (dela ou, se supervisora do E8, de terceiros).
   * Sem isso qualquer operador com a tela varreria os ids e leria toda divergência de preço de compra da casa.
   * Invisível e inexistente devolvem o MESMO erro (não vaza existência).
   */
  async analise(apnId: number) {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const op = this.logado();
    if (op != null) {
      const visivel = await db.selectFrom('pendencia_operador as p')
        .select('p.po_id')
        .where('p.codempresa', '=', emp)
        .where('p.po_tipo_pendencia_operador', 'in', ['APN', 'RPN'])
        .where(sql<boolean>`p.po_complemento ~ '^[0-9]{1,9}$' and p.po_complemento::int = ${apnId}`)
        .where(sql<boolean>`(p.codoperador = ${op} or ${this.supervisorSql(op)})`)
        .executeTakeFirst();
      if (!visivel) throw new BusinessRuleError('ANALISE_NAO_ENCONTRADA', { apn_id: apnId });
    }
    const cab = (await db.selectFrom('analise_pedido_nf as a')
      .leftJoin('operadores as o', 'o.codoperador', 'a.codoperador')
      .leftJoin('operadores as ofim', 'ofim.codoperador', 'a.codoperador_finalizado')
      .select([
        'a.apn_id', 'a.apn_data_analise', 'a.apn_status', 'a.apn_total_parcial',
        'a.apn_diferenca_valor', 'a.apn_status_finalizacao', 'a.codoperador',
        sql`o.nome`.as('operador'), sql`ofim.nome`.as('operador_finalizado'),
      ])
      .where('a.apn_id', '=', apnId).where('a.codempresa', '=', emp)
      .executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!cab) throw new BusinessRuleError('ANALISE_NAO_ENCONTRADA', { apn_id: apnId });

    const pedidos = (await db.selectFrom('analise_pedido_nf_pedido as ap')
      .leftJoin('pedidocompra as pc', 'pc.codpedcomp', 'ap.codpedcomp')
      .leftJoin('parceiros as par', 'par.codparceiro', 'pc.codparceiro')
      // fantasia PURA (como o QryAnalise e o MIN(FANTASIA) da fila — sem coalesce p/ razao, senão as duas
      // telas mostrariam nomes diferentes p/ o mesmo parceiro sem fantasia)
      .select(['ap.codpedcomp', sql`par.fantasia`.as('fornecedor'), sql`pc.data`.as('data')])
      .where('ap.apn_id', '=', apnId).orderBy('ap.codpedcomp').execute()) as Record<string, unknown>[];

    const notas = (await db.selectFrom('analise_pedido_nf_nf as an')
      .leftJoin('nfe_nao_cadastradas as nn', 'nn.codnfe_naocad', 'an.apnn_ref_nf')
      .select([
        'an.apnn_ref_nf', 'an.apnn_tabela',
        sql`nn.nronf`.as('nronf'), sql`nn.razao`.as('razao'),
        sql`nn.totalnf`.as('totalnf'), sql`nn.dtemissao`.as('dtemissao'), sql`nn.chavenfe`.as('chavenfe'),
      ])
      .where('an.apn_id', '=', apnId).orderBy('an.apnn_ref_nf').execute()) as Record<string, unknown>[];

    // as 3 grades de produto: PRODUTOS é INNER como nas queries do legado (QryProdutosDivergentes /
    // QryInexistentesNF / QryInexistentesPedidos) — linha com produto inexistente NÃO aparece (5 no golden:
    // idproduto 837017), e o grid exibe CODBARRA + DESCRICAO + UNIDADE (fold auditoria [MÉDIA]).
    const divergencias = (await db.selectFrom('analise_pedido_nf_diverg as d')
      .innerJoin('produtos as pr', 'pr.idproduto', 'd.idproduto')
      .select([
        'd.idproduto', sql`pr.codbarra`.as('codbarra'), sql`pr.descricao`.as('descricao'), sql`pr.unidade`.as('unidade'),
        'd.apnd_quantidade_nf', 'd.apnd_quantidade_pc', 'd.apnd_valor_nf', 'd.apnd_valor_pc',
        'd.status', 'd.nronf', 'd.chavenfe',
      ])
      .where('d.apn_id', '=', apnId).orderBy(sql`pr.descricao`).execute()) as Record<string, unknown>[];

    const ineNf = (await db.selectFrom('analise_pedido_nf_ine_nf as i')
      .innerJoin('produtos as pr', 'pr.idproduto', 'i.idproduto')
      .select(['i.idproduto', sql`pr.codbarra`.as('codbarra'), sql`pr.descricao`.as('descricao'), sql`pr.unidade`.as('unidade'), 'i.apnin_quantidade', 'i.apnin_valor'])
      .where('i.apn_id', '=', apnId).orderBy(sql`pr.descricao`).execute()) as Record<string, unknown>[];

    const inePc = (await db.selectFrom('analise_pedido_nf_ine_pc as i')
      .innerJoin('produtos as pr', 'pr.idproduto', 'i.idproduto')
      .select(['i.idproduto', sql`pr.codbarra`.as('codbarra'), sql`pr.descricao`.as('descricao'), sql`pr.unidade`.as('unidade'), 'i.apnip_quantidade', 'i.apnip_valor'])
      .where('i.apn_id', '=', apnId).orderBy(sql`pr.descricao`).execute()) as Record<string, unknown>[];

    return { cabecalho: cab, pedidos, notas, divergencias, inexistentes_nf: ineNf, inexistentes_pc: inePc };
  }

  /** cria uma pendência (o caminho que o Manifesto/Conferência usam no legado). */
  async criar(dto: { codoperador: number; tipo: string; complemento?: string; observacao?: string }) {
    const emp = this.emp();
    const origem = currentTenant().operadorId ?? null;
    if (!['APN', 'RPN', 'CFN'].includes(dto.tipo)) throw new BusinessRuleError('TIPO_INVALIDO', { tipo: dto.tipo });
    const db = this.dbp.forTenant() as AnyDB;
    const r = await db.insertInto('pendencia_operador').values({
      codoperador: dto.codoperador,
      po_tipo_pendencia_operador: dto.tipo,
      po_status: 'A',
      po_complemento: dto.complemento ?? null,
      po_observacao: dto.observacao ?? null,
      codempresa: emp,
      codoperador_origem: origem,
    }).returning('po_id').executeTakeFirst();
    return { ok: true, po_id: r?.po_id };
  }

  /** finaliza (com observação opcional) ou reabre uma pendência do escopo da empresa. */
  async status(poId: number, finalizar: boolean, observacao?: string) {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx) => {
      const p = await trx.selectFrom('pendencia_operador').select(['po_id', 'po_status'])
        .where('po_id', '=', poId).where('codempresa', '=', emp).forUpdate().executeTakeFirst();
      if (!p) throw new BusinessRuleError('PENDENCIA_NAO_ENCONTRADA');
      if (finalizar && p.po_status === 'F') throw new BusinessRuleError('PENDENCIA_JA_FINALIZADA');
      await trx.updateTable('pendencia_operador')
        .set({
          po_status: finalizar ? 'F' : 'A',
          ...(observacao != null ? { po_observacao: observacao.slice(0, 1000) } : {}),
        })
        .where('po_id', '=', poId).where('codempresa', '=', emp).execute();
      return { ok: true, po_id: poId, po_status: finalizar ? 'F' : 'A' };
    });
  }
}
