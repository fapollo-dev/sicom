import { sql } from 'kysely';
import { agendaPromocaoSchema, atualizarAgendaPromocaoSchema } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { csvLojas, lojasDaAgenda, lojasDoCsv } from './agenda-promocao-lojas';

/**
 * ⚠️ mig 312 (multi-loja + ciclo do status): a agenda é da REDE — a pesquisa do legado (`GET_AGENDA_PROMOCAO`) não filtra
 * loja; a dona (`idempresa` = CODEMPRESA) é só quem criou. As lojas em que o preço entra estão em cada item
 * (`empresas`, '1, 2'). O status é N=ABERTA → E=EXECUTANDO → J=FECHADA (cbbStatus). Ver agenda-promocao-lojas.ts.
 *
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
  rbacForm: 'FRMCADAGENDAPROMOCAO',
  // a LOG do form-base (uCadMaster.pas:485): o título da tela como a produção grava — o "Registro de log" a mostra
  log: { formulario: 'Agenda de Promoção' },
  // a agenda é da REDE (a view de pesquisa do legado não filtra loja); a loja logada só carimba a dona ao criar
  empresaScoped: false,
  softDelete: true,
  // CODEMPRESA = a loja logada (udmCadAgendaPromocao.pas:360); agenda nova nasce ABERTA ('N', :359) — o combo de status
  // fica desabilitado enquanto ABERTA (uCadAgendaPromocao.pas:517), então o create não escolhe status
  derivarTrx: async ({ emp }) => {
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return { idempresa: emp, flagpromocao: 'N' };
  },
  // DTENCERRAMENTO/CODOPERADORENC são workflow-controlled (vertical encerrar/reabrir) — fora do allowlist.
  colunas: ['nomepromo', 'dtiniciopromocao', 'dtfimpromocao', 'flagpromocao', 'opcoes', 'obs'],
  colunasPesquisa: ['codagenda', 'nomepromo', 'dtiniciopromocao', 'dtfimpromocao', 'situacao'],
  detalhes: [
    {
      tabela: 'agenda_promocao_itens',
      pk: 'codagendaitem',
      fk: 'codagenda',
      chaveNatural: ['idproduto'],
      // "todos os campos" (mig 310): o que o cadastro não gerencia sobrevive ao save (lição 124)
      preservarNaoGerenciadas: true,
      chave: 'itens',
      colunas: [
        'nroitem', 'idproduto', 'vlrpromocao', 'vrvenda', 'ativo', 'dtativo',
        'vrclube_fidelidade', 'maximo', 'vlr_min_compra', 'tv', 'radio', 'tabloide', 'interno',
        // as lojas do item ('1, 2') — onde o preço entra (mig 312)
        'empresas',
      ],
      // a lista de lojas de cada item ANTES do delete: um PUT com itens e sem `empresas` mantém a de cada produto
      antesDeSubstituirTrx: async ({ trx, masterId }) => {
        const r = (await trx.selectFrom('agenda_promocao_itens').select(['idproduto', 'empresas'])
          .where('codagenda', '=', masterId).execute()) as Array<{ idproduto: number; empresas: string | null }>;
        return { porProduto: new Map(r.map((x) => [Number(x.idproduto), x.empresas])), lojas: await lojasDaAgenda(trx, masterId) };
      },
      // ATIVO default 'S'; NROITEM sequencial; DTATIVO=now nos ativos (fiel ao legado, DTATIVO gravado ao ativar).
      // EMPRESAS: a lista selecionada vale para todos os itens (btnGravar:703-708); sem lista no dto, cada produto fica
      // com a sua e o produto novo leva a da agenda.
      derivarItensTrx: async (itens, _trx, emp, header, _masterId, snapshot) => {
        const snap = snapshot as { porProduto?: Map<number, string | null>; lojas?: number[] } | undefined;
        const doDto = Array.isArray(header?.empresas) ? csvLojas(header!.empresas as number[]) : null;
        const daAgenda = csvLojas(snap?.lojas?.length ? snap.lojas : emp != null ? [emp] : []);
        return itens.map((it, i) => {
          const ativo = it.ativo === 'N' ? 'N' : 'S';
          const antes = snap?.porProduto?.get(Number(it.idproduto));
          return {
            ...it,
            ativo,
            nroitem: it.nroitem != null ? it.nroitem : i + 1,
            dtativo: ativo === 'S' ? sql`now()` : null,
            empresas: doDto ?? (antes ? csvLojas(lojasDoCsv(antes, [])) : daAgenda) ?? null,
          };
        });
      },
    },
  ],
  validar: async ({ dto, id, db }) => {
    const emp = currentTenant().empresaId ?? null;

    // trava de estado + fallback do PUT parcial (fold ALTA): carrega o PERÍODO persistido p/ o OVERLAPS quando
    // o PUT omite dtinicio/dtfim (senão a anti-sobreposição fica burlável mudando só o período OU só os itens).
    let atual: { dtencerramento?: unknown; dtiniciopromocao?: unknown; dtfimpromocao?: unknown; flagpromocao?: string | null } | undefined;
    if (id != null) {
      atual = (await db
        .selectFrom('agenda_promocao')
        .select(['dtencerramento', 'dtiniciopromocao', 'dtfimpromocao', 'flagpromocao'])
        .where('codagenda', '=', id)
        .where(sql`coalesce(indr,'I')`, '<>', 'E')
        .executeTakeFirst()) as typeof atual;
      if (!atual) throw new BusinessRuleError('PROMOCAO_NAO_ENCONTRADA', { codagenda: id });
      if (atual.dtencerramento != null) throw new BusinessRuleError('PROMOCAO_ENCERRADA');
      // o STATUS à mão (cbbStatus): desabilitado enquanto ABERTA (:517); de EXECUTANDO não vai para FECHADA nem de
      // FECHADA para EXECUTANDO (cbbStatusExit:1088) — sobra voltar para ABERTA
      const de = String(atual.flagpromocao ?? 'N');
      const para = dto.flagpromocao as string | undefined;
      if (para !== undefined && para !== de) {
        if (de === 'N') throw new BusinessRuleError('PROMOCAO_STATUS_INVALIDO', { de, para, motivo: 'agenda ABERTA não muda de status à mão' });
        if (para !== 'N') {
          throw new BusinessRuleError('PROMOCAO_STATUS_INVALIDO', {
            de, para,
            motivo: de === 'E' ? 'Não é possível mudar o Status da Agenda de Executando para Fechada.' : 'Não é possível mudar o Status da Agenda de Fechada para Executando.',
          });
        }
      }
    }

    // as lojas: cada uma tem de existir; sem lista no dto, valem as gravadas
    let lojas: number[] = [];
    if (Array.isArray(dto.empresas)) {
      lojas = [...new Set((dto.empresas as unknown[]).map(Number))];
      const achadas = (await db.selectFrom('empresas').select('idempresa').where('idempresa', 'in', lojas).execute()) as Array<{ idempresa: number }>;
      const ok = new Set(achadas.map((e) => Number(e.idempresa)));
      const falta = lojas.filter((l) => !ok.has(l));
      if (falta.length) throw new BusinessRuleError('PROMOCAO_LOJA_INVALIDA', { lojas: falta });
    } else if (id != null) {
      lojas = await lojasDaAgenda(db, id);
    } else if (emp != null) {
      lojas = [emp];
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
      // por LOJA (ProdutoOutraPromocao:1586 percorre as empresas da agenda e compara com a lista do item da outra agenda)
      // e só contra agenda ABERTA ou EXECUTANDO (`FLAGPROMOCAO IN ('N','E')`, :1615) — a FECHADA não conflita.
      // ⚠️ o legado compara com `EMPRESAS LIKE '%n%'` (a loja 1 casaria com a 51); aqui a comparação é loja a loja.
      const lojasTxt = lojas.map(String);
      const conflito = (await db
        .selectFrom('agenda_promocao_itens as i')
        .innerJoin('agenda_promocao as a', 'a.codagenda', 'i.codagenda')
        .select(['i.idproduto as idproduto', 'a.codagenda as codagenda'])
        .where('a.codagenda', '<>', id ?? -1)
        .where(sql`coalesce(a.indr,'I')`, '<>', 'E')
        .where('a.dtencerramento', 'is', null)
        .where(sql<boolean>`coalesce(a.flagpromocao, 'N') IN ('N', 'E')`)
        .where(sql<boolean>`EXISTS (SELECT 1 FROM unnest(string_to_array(replace(coalesce(i.empresas, a.idempresa::text), ' ', ''), ',')) x
                                     WHERE x = ANY(${lojasTxt}::text[]))`)
        .where(sql`coalesce(i.ativo, 'S')`, '=', 'S')
        .where('i.idproduto', 'in', idsAtivos)
        .where(sql`(a.dtiniciopromocao, a.dtfimpromocao) OVERLAPS (${ini}::timestamptz, ${fim}::timestamptz)`)
        .executeTakeFirst()) as { idproduto?: number } | undefined;
      if (conflito) throw new BusinessRuleError('PROMOCAO_PRODUTO_SOBREPOSTO', { idproduto: Number(conflito.idproduto), codagenda: Number((conflito as { codagenda?: number }).codagenda) });
    }
  },
  validarRemocao: async ({ id, db }) => {
    const ap = (await db
      .selectFrom('agenda_promocao')
      .select(['dtencerramento'])
      .where('codagenda', '=', id)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { dtencerramento?: unknown } | undefined;
    if (!ap) return; // já excluída / not-found → soft-delete idempotente
    if (ap.dtencerramento != null) throw new BusinessRuleError('PROMOCAO_ENCERRADA');
  },
  // o que o btnGravar faz além de gravar (uCadAgendaPromocao.pas:703-770)
  aposGravarTrx: async ({ trx, id, dto, criado }) => {
    if (Array.isArray(dto.empresas)) {
      const lojas = [...new Set((dto.empresas as unknown[]).map(Number))].sort((a, b) => a - b);
      // a lista do app de gestão (AGENDA_PROMOCAO_EMPRESA)
      await trx.deleteFrom('agenda_promocao_empresa').where('codagenda', '=', id).execute();
      await trx.insertInto('agenda_promocao_empresa').values(lojas.map((l) => ({ codagenda: id, codempresa: l }))).execute();
      // lista trocada sem regravar os itens: todos os itens levam a lista nova (:703-708)
      if (dto.itens === undefined) {
        await trx.updateTable('agenda_promocao_itens').set({ empresas: csvLojas(lojas) }).where('codagenda', '=', id).execute();
      }
    }
    if (criado) return;
    // gravar uma agenda EXECUTANDO a devolve para ABERTA (:757) — quem liga o preço de novo é a vigência
    await trx.updateTable('agenda_promocao').set({ flagpromocao: 'N' }).where('codagenda', '=', id).where('flagpromocao', '=', 'E').execute();
    // a loja que saiu da lista, o item removido e o item desativado perdem o preço desta agenda (:750; trigger
    // CONTROLADELETEAGENDA no delete do item; AtualizaAtivo(False) no item desativado)
    await sql`
      UPDATE multi_preco m SET promocao = 'N', vrpromo = NULL, codagenda = NULL, dtultprecoalterado = now()
       WHERE m.codagenda = ${id}
         AND NOT EXISTS (
           SELECT 1 FROM agenda_promocao_itens i JOIN agenda_promocao a ON a.codagenda = i.codagenda
            WHERE i.codagenda = ${id} AND i.idproduto = m.idproduto AND coalesce(i.ativo, 'S') = 'S'
              AND m.idempresa::text = ANY(string_to_array(replace(coalesce(i.empresas, a.idempresa::text), ' ', ''), ',')))`
      .execute(trx);
  },
  // a leitura traz a lista de lojas (o form a mostra e a devolve ao gravar)
  anexarLeitura: async ({ db, id, registro }) => ({ ...registro, empresas: await lojasDaAgenda(db, id) }),
};

export const AgendaPromocaoAggregateController = createAggregateController({
  path: 'cadastro/agenda-promocao',
  config: agendaPromocaoAggregateConfig,
  schema: agendaPromocaoSchema,
  updateSchema: atualizarAgendaPromocaoSchema,
});
