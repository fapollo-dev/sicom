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
 * - validar: período dtfim>dtini (schema); o item NOVO ou REATIVADO tem de ser produto ATIVO e não pode estar em outra
 *   agenda aberta/executando da mesma loja com período sobreposto (uCadAgendaPromocao:1616) — o que já estava gravado não
 *   se revalida (o legado só checa ao incluir/ativar o item); produto repetido novo sai em silêncio.
 * - validarRemocao: agenda EXECUTANDO não se exclui (:1212).
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

/**
 * A GERAÇÃO POR GRUPO DE PREÇO (`AtualizaGrupoPreco`, uCadAgendaPromocao.pas:286-417), no gravar:
 *  - o item MESTRE ('M', o "Atualizar Grupo" marcado) puxa todos os produtos do seu grupo de preço: o que não está na lista
 *    entra como irmão ('S', CODGRUPO do grupo, as lojas e as opções do mestre); o que está tem o VLRPROMOCAO sobrescrito
 *    (inclusive o próprio mestre) — com o % do cabeçalho, VRVENDA − VRVENDA × %/100; sem ele, o preço promocional do mestre;
 *  - o mestre DESMARCADO ('M' → 'N') tira os irmãos 'S' do grupo (o `AtualizaAtivo(False)` + `Delete`); o preço que eles
 *    ligaram sai no aposGravar (a reversão do item removido).
 * Produção 2025-26: 520 mestres, 3.465 irmãos (230 agendas); a 31185 de 24/09 tem 8 por grupo.
 */
async function gerarGrupoDePreco(trx: any, lista: Array<Record<string, unknown>>, antes: Map<number, Record<string, unknown>> | undefined, header: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  const pct = Number(header.percentualDesconto ?? 0) || 0;
  const grupoDe = async (idproduto: number): Promise<number | null> => {
    const r = (await sql<{ g: number | null }>`SELECT codgrupopreco AS g FROM produtos WHERE idproduto = ${idproduto}`.execute(trx)).rows[0];
    return r?.g != null && Number(r.g) > 0 ? Number(r.g) : null;
  };
  // os desmarcados: os irmãos do grupo saem da lista
  for (const it of [...lista]) {
    const eraMestre = String(antes?.get(Number(it.idproduto))?.atualizacao_grupo ?? '') === 'M';
    if (!eraMestre || it.atualizacao_grupo !== 'N') continue;
    const g = await grupoDe(Number(it.idproduto));
    if (g == null) continue;
    const irmaos = new Set(((await sql<{ p: number }>`SELECT idproduto AS p FROM produtos WHERE codgrupopreco = ${g} AND idproduto <> ${Number(it.idproduto)}`.execute(trx)).rows).map((r) => Number(r.p)));
    lista = lista.filter((x) => !(x.atualizacao_grupo === 'S' && irmaos.has(Number(x.idproduto))));
  }
  // os mestres: puxam o grupo
  for (const mestre of lista.filter((x) => x.atualizacao_grupo === 'M')) {
    const g = await grupoDe(Number(mestre.idproduto));
    if (g == null) continue;
    const lojas = lojasDoCsv(mestre.empresas as string | null, []);
    const doGrupo = (await sql<{ p: number; v: unknown }>`
      SELECT p.idproduto AS p, (SELECT m.vrvenda FROM multi_preco m WHERE m.idproduto = p.idproduto AND m.idempresa = ANY(${lojas}::int[]) ORDER BY m.idempresa LIMIT 1) AS v
        FROM produtos p WHERE p.codgrupopreco = ${g} ORDER BY p.idproduto`.execute(trx)).rows;
    for (const r of doGrupo) {
      const vrvenda = Number(r.v ?? 0);
      const vlr = pct > 0 ? Math.round((vrvenda - (vrvenda * pct) / 100) * 100) / 100 : Number(mestre.vlrpromocao ?? 0);
      const ja = lista.find((x) => Number(x.idproduto) === Number(r.p));
      if (ja) { ja.vlrpromocao = vlr; continue; }
      lista.push({
        idproduto: Number(r.p), vlrpromocao: vlr, vrvenda: r.v != null ? vrvenda : null, empresas: mestre.empresas, codgrupo: g,
        atualizacao_grupo: 'S', opcoes: header.opcoes != null ? String(header.opcoes) : mestre.opcoes ?? null, ativo: null, dtativo: null,
        tv: 'F', radio: 'F', tabloide: 'F', interno: 'F',
      });
    }
  }
  return lista;
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
  // os itens ficam com o cabeçalho excluído (INDR='E'), como no legado
  manterDetalhesNaExclusao: true,
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
        // a geração por grupo de preço (M = mestre, S = irmão gerado) — gerenciadas aqui desde a auditoria de esqueletos §4.4
        'atualizacao_grupo', 'codgrupo', 'opcoes', 'descricao_promocao',
      ],
      // a lista de lojas de cada item ANTES do delete: um PUT com itens e sem `empresas` mantém a de cada produto
      antesDeSubstituirTrx: async ({ trx, masterId }) => {
        const r = (await trx.selectFrom('agenda_promocao_itens').select(['idproduto', 'empresas', 'atualizacao_grupo', 'codgrupo', 'opcoes', 'descricao_promocao'])
          .where('codagenda', '=', masterId).execute()) as Array<{ idproduto: number; empresas: string | null; atualizacao_grupo: string | null; codgrupo: unknown; opcoes: string | null; descricao_promocao: string | null }>;
        return {
          porProduto: new Map(r.map((x) => [Number(x.idproduto), x.empresas])),
          grupoPorProduto: new Map(r.map((x) => [Number(x.idproduto), { atualizacao_grupo: x.atualizacao_grupo, codgrupo: x.codgrupo, opcoes: x.opcoes, descricao_promocao: x.descricao_promocao }])),
          lojas: await lojasDaAgenda(trx, masterId),
        };
      },
      // ATIVO default 'S'; NROITEM sequencial; DTATIVO=now nos ativos (fiel ao legado, DTATIVO gravado ao ativar).
      // EMPRESAS: a lista selecionada vale para todos os itens (btnGravar:703-708); sem lista no dto, cada produto fica
      // com a sua e o produto novo leva a da agenda.
      derivarItensTrx: async (itens, trx, emp, header, _masterId, snapshot) => {
        const snap = snapshot as { porProduto?: Map<number, string | null>; grupoPorProduto?: Map<number, Record<string, unknown>>; lojas?: number[] } | undefined;
        const doDto = Array.isArray(header?.empresas) ? csvLojas(header!.empresas as number[]) : null;
        const daAgenda = csvLojas(snap?.lojas?.length ? snap.lojas : emp != null ? [emp] : []);
        let lista = itens.map((it, i) => {
          const antes = snap?.porProduto?.get(Number(it.idproduto));
          const g = snap?.grupoPorProduto?.get(Number(it.idproduto));
          const grupo = String(it.atualizacao_grupo ?? g?.atualizacao_grupo ?? 'N');
          // o irmão gerado nasce sem ATIVO (a produção: ATIVO nulo nos 'S'); nulo vale como ativo na aplicação
          const ativo = it.ativo === 'N' ? 'N' : grupo === 'S' && it.ativo == null && g?.atualizacao_grupo === 'S' ? null : 'S';
          return {
            ...it,
            ativo,
            nroitem: it.nroitem != null ? it.nroitem : i + 1,
            dtativo: ativo === 'S' ? sql`now()` : null,
            empresas: doDto ?? (antes ? csvLojas(lojasDoCsv(antes, [])) : daAgenda) ?? null,
            atualizacao_grupo: grupo,
            codgrupo: it.codgrupo ?? g?.codgrupo ?? null,
            opcoes: it.opcoes ?? g?.opcoes ?? null,
            descricao_promocao: it.descricao_promocao ?? g?.descricao_promocao ?? null,
          } as Record<string, unknown>;
        });
        lista = await gerarGrupoDePreco(trx, lista, snap?.grupoPorProduto, header ?? {});
        // VRVENDA = a foto do preço cheio (uCadAgendaPromocao.pas:958 — 100% preenchido no legado); o item sem ela a toma do
        // MULTI_PRECO da primeira loja do item
        for (const it of lista) {
          if (Number(it.vrvenda ?? 0) > 0) continue;
          const loja = lojasDoCsv(it.empresas as string | null, emp != null ? [emp] : [])[0];
          if (loja == null) continue;
          const mp = (await sql<{ v: unknown }>`SELECT vrvenda AS v FROM multi_preco WHERE idproduto = ${Number(it.idproduto)} AND idempresa = ${loja}`.execute(trx)).rows[0];
          if (mp?.v != null) it.vrvenda = Number(mp.v);
        }
        return lista.map((it, i) => ({ ...it, nroitem: it.nroitem != null ? it.nroitem : i + 1 }));
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
      // ⚠️ sem trava de "encerrada": o legado não tem (DTENCERRAMENTO nem aparece no fonte) e a produção alterou agendas depois
      // de encerradas (8941, 10288, 10948 em 2023) — auditoria g2 #4
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
    // os itens GRAVADOS: o legado só checa o produto ao INCLUIR ou ATIVAR o item (CarregarItens :925, marcar ativo :1421) — o
    // Gravar não revalida o que já estava na agenda nem a troca de período (auditoria g2 #1/#3)
    const gravados = id != null
      ? ((await db.selectFrom('agenda_promocao_itens').select(['idproduto', 'ativo']).where('codagenda', '=', id).execute()) as Array<{ idproduto: number; ativo: string | null }>)
      : [];
    const qtdGravada = new Map<number, number>();
    const ativoGravado = new Set<number>();
    for (const g of gravados) {
      qtdGravada.set(Number(g.idproduto), (qtdGravada.get(Number(g.idproduto)) ?? 0) + 1);
      if (String(g.ativo ?? 'S') !== 'N') ativoGravado.add(Number(g.idproduto));
    }
    let itens: Record<string, unknown>[];
    if (Array.isArray(dto.itens)) {
      // o produto repetido NOVO sai em silêncio (o legado não inclui o código que já está na grade — `Locate('CODBARRA')` :950);
      // os repetidos que já estavam gravados ficam (a produção tem 13 grupos assim em 2026 — auditoria g2 #2)
      const vistos = new Map<number, number>();
      itens = (dto.itens as Record<string, unknown>[]).filter((it) => {
        const idp = Number(it.idproduto);
        if (!(idp > 0)) return true;
        const n = (vistos.get(idp) ?? 0) + 1;
        vistos.set(idp, n);
        return n <= Math.max(1, qtdGravada.get(idp) ?? 0);
      });
      dto.itens = itens;
    } else {
      itens = gravados as unknown as Record<string, unknown>[];
    }
    // só o item NOVO ou REATIVADO passa pelas checagens de produto (ativo e sobreposição)
    const idsAtivos = [...new Set(itens.filter((it) => it.ativo !== 'N').map((it) => Number(it.idproduto)))]
      .filter((x) => x > 0 && !ativoGravado.has(x));

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
      .select(['flagpromocao'])
      .where('codagenda', '=', id)
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { flagpromocao?: string | null } | undefined;
    if (!ap) return; // já excluída / not-found → soft-delete idempotente
    // o Excluir fica desabilitado com a agenda EXECUTANDO (`btnExcluir.Enabled := cbbStatus.ItemIndex <> 1`, :1212) — a regra que
    // faltava; a "encerrada" não trava (o legado não tem)
    if (String(ap.flagpromocao ?? 'N') === 'E') throw new BusinessRuleError('PROMOCAO_EXECUTANDO');
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
