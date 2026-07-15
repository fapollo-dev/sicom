import { sql } from 'kysely';
import { agendaPromocaoSchema, atualizarAgendaPromocaoSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';

/**
 * AGENDA DE PROMOÇÃO (uCadAgendaPromocao) — corte-1 NÚCLEO. Agregado mestre-detalhe: `agenda_promocao`
 * (empresaScoped) + `agenda_promocao_itens`. Campanha nomeada com PERÍODO (data+hora) e N itens (produto +
 * preço promocional). **SEM efeito** no corte-1 (o UPDATE MULTI_PRECO da ativação é o corte-2).
 *
 * - derivarItensTrx: ATIVO default 'S'; NROITEM sequencial; DTATIVO=now p/ itens ativos (fiel ao legado).
 * - validar: agenda ENCERRADA (dtencerramento) é read-only; período dtfim>dtini (schema); cada produto existe
 *   e está ATIVO; ANTI-SOBREPOSIÇÃO — nenhum produto ativo pode estar em OUTRA agenda não-encerrada da mesma
 *   empresa com período sobreposto (uCadAgendaPromocao:1616).
 * - validarRemocao: agenda ENCERRADA não pode ser excluída (reabra antes).
 */

/** resolve config (base + override por Empresa) com o handle do validar — espelha ConfigService (helper local). */
async function cfgValor(db: any, codigo: string, emp: number | null): Promise<string | null> {
  const c = await db.selectFrom('configuracoes').select(['id', 'valor', 'config_especificas_permitidas']).where('codigo', '=', codigo).executeTakeFirst();
  if (!c) return null;
  const permitidos = String(c.config_especificas_permitidas ?? '').split(';').map((s: string) => s.trim());
  if (emp != null && permitidos.includes('Empresa')) {
    const ov = await db.selectFrom('configuracoes_especificas').select('valor').where('id', '=', c.id).where('tipo', '=', 'Empresa').where('chave', '=', String(emp)).executeTakeFirst();
    if (ov?.valor != null) return String(ov.valor);
  }
  return c.valor != null ? String(c.valor) : null;
}

export const agendaPromocaoAggregateConfig: AggregateConfig = {
  tabela: 'agenda_promocao',
  pk: 'codagenda',
  view: 'get_agenda_promocao',
  rbacForm: 'FRMAGENDAPROMOCAO',
  empresaScoped: true,
  softDelete: true,
  // DTENCERRAMENTO/CODOPERADORENC são workflow-controlled (vertical encerrar/reabrir) — fora do allowlist.
  colunas: ['nomepromo', 'dtiniciopromocao', 'dtfimpromocao', 'flagpromocao', 'opcoes', 'obs'],
  colunasPesquisa: ['codagenda', 'nomepromo', 'dtiniciopromocao', 'dtfimpromocao', 'situacao'],
  detalhes: [
    {
      tabela: 'agenda_promocao_itens',
      pk: 'codagendaitem',
      fk: 'codagenda',
      chave: 'itens',
      colunas: [
        'nroitem', 'idproduto', 'vlrpromocao', 'vrvenda', 'ativo', 'dtativo',
        'vrclube_fidelidade', 'maximo', 'vlr_min_compra', 'tv', 'radio', 'tabloide', 'interno',
      ],
      // ATIVO default 'S'; NROITEM sequencial; DTATIVO=now nos ativos (fiel ao legado, DTATIVO gravado ao ativar).
      derivarItensTrx: async (itens) =>
        itens.map((it, i) => {
          const ativo = it.ativo === 'N' ? 'N' : 'S';
          return {
            ...it,
            ativo,
            nroitem: it.nroitem != null ? it.nroitem : i + 1,
            dtativo: ativo === 'S' ? sql`now()` : null,
          };
        }),
    },
  ],
  validar: async ({ dto, id, db }) => {
    const emp = currentTenant().empresaId ?? null;

    // trava de estado + fallback do PUT parcial (fold ALTA): carrega o PERÍODO persistido p/ o OVERLAPS quando
    // o PUT omite dtinicio/dtfim (senão a anti-sobreposição fica burlável mudando só o período OU só os itens).
    let atual: { dtencerramento?: unknown; dtiniciopromocao?: unknown; dtfimpromocao?: unknown } | undefined;
    if (id != null) {
      atual = (await db
        .selectFrom('agenda_promocao')
        .select(['dtencerramento', 'dtiniciopromocao', 'dtfimpromocao'])
        .where('codagenda', '=', id)
        .where('idempresa', '=', emp)
        .where(sql`coalesce(indr,'I')`, '<>', 'E')
        .executeTakeFirst()) as typeof atual;
      if (!atual) throw new BusinessRuleError('PROMOCAO_NAO_ENCONTRADA', { codagenda: id });
      if (atual.dtencerramento != null) throw new BusinessRuleError('PROMOCAO_ENCERRADA');
    }

    // itens EFETIVOS: se o dto traz `itens` (substituição), valida esses; senão (PUT que não mexe em itens)
    // valida os PERSISTIDOS contra o (possivelmente novo) período — fecha o bypass do fold ALTA.
    let itens: Record<string, unknown>[];
    if (Array.isArray(dto.itens)) {
      itens = dto.itens as Record<string, unknown>[];
      // dedup dentro da MESMA agenda (fold BAIXA; o legado dedup por CODBARRA no CarregarItens): produto repetido → erro.
      const vistos = new Set<number>();
      for (const it of itens) {
        const idp = Number(it.idproduto);
        if (idp > 0 && vistos.has(idp)) throw new BusinessRuleError('PROMOCAO_PRODUTO_DUPLICADO', { idproduto: idp });
        vistos.add(idp);
      }
    } else if (id != null) {
      itens = (await db.selectFrom('agenda_promocao_itens').select(['idproduto', 'ativo']).where('codagenda', '=', id).execute()) as Record<string, unknown>[];
    } else {
      itens = [];
    }
    const idsAtivos = [...new Set(itens.filter((it) => it.ativo !== 'N').map((it) => Number(it.idproduto)))].filter((x) => x > 0);

    // cada produto tem de existir e estar ATIVO (SegProduto do legado). FK garante existência no insert;
    // aqui checamos o ATIVO='S' (produto morto não entra em promoção).
    if (idsAtivos.length) {
      const prods = (await db
        .selectFrom('produtos')
        .select(['idproduto', 'ativo'])
        .where('idproduto', 'in', idsAtivos)
        .execute()) as Array<{ idproduto: number; ativo?: string }>;
      const mapa = new Map(prods.map((p) => [Number(p.idproduto), p.ativo]));
      for (const idp of idsAtivos) {
        if (!mapa.has(idp)) throw new BusinessRuleError('PROMOCAO_PRODUTO_INVALIDO', { idproduto: idp });
        if (String(mapa.get(idp) ?? 'S') === 'N') throw new BusinessRuleError('PROMOCAO_PRODUTO_INATIVO', { idproduto: idp });
      }
    }

    // ANTI-SOBREPOSIÇÃO (uCadAgendaPromocao:1616), GATE por config (fold MÉDIA): o legado só (semi)bloqueia com
    // PERMITE_PRODUTO_MAIS_UMA_AGENDA='N' (default permissivo = confirm-and-continue, que no web = permitir). Período
    // efetivo = dto ?? persistido (fold ALTA: PUT só-itens ainda valida contra o período gravado).
    const ini = (dto.dtiniciopromocao ?? atual?.dtiniciopromocao) as string | Date | undefined;
    const fim = (dto.dtfimpromocao ?? atual?.dtfimpromocao) as string | Date | undefined;
    const bloqueiaSobreposicao = (await cfgValor(db, 'PERMITE_PRODUTO_MAIS_UMA_AGENDA', emp)) === 'N';
    if (bloqueiaSobreposicao && idsAtivos.length && ini && fim) {
      const conflito = (await db
        .selectFrom('agenda_promocao_itens as i')
        .innerJoin('agenda_promocao as a', 'a.codagenda', 'i.codagenda')
        .select(['i.idproduto as idproduto'])
        .where('a.idempresa', '=', emp)
        .where('a.codagenda', '<>', id ?? -1)
        .where(sql`coalesce(a.indr,'I')`, '<>', 'E')
        .where('a.dtencerramento', 'is', null)
        .where('i.ativo', '=', 'S')
        .where('i.idproduto', 'in', idsAtivos)
        .where(sql`(a.dtiniciopromocao, a.dtfimpromocao) OVERLAPS (${ini}::timestamptz, ${fim}::timestamptz)`)
        .executeTakeFirst()) as { idproduto?: number } | undefined;
      if (conflito) throw new BusinessRuleError('PROMOCAO_PRODUTO_SOBREPOSTO', { idproduto: Number(conflito.idproduto) });
    }
  },
  validarRemocao: async ({ id, db }) => {
    const emp = currentTenant().empresaId ?? null;
    const ap = (await db
      .selectFrom('agenda_promocao')
      .select(['dtencerramento'])
      .where('codagenda', '=', id)
      .where('idempresa', '=', emp)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { dtencerramento?: unknown } | undefined;
    if (!ap) return; // já excluída / not-found → soft-delete idempotente
    if (ap.dtencerramento != null) throw new BusinessRuleError('PROMOCAO_ENCERRADA');
  },
};

export const AgendaPromocaoAggregateController = createAggregateController({
  path: 'cadastro/agenda-promocao',
  config: agendaPromocaoAggregateConfig,
  schema: agendaPromocaoSchema,
  updateSchema: atualizarAgendaPromocaoSchema,
});
