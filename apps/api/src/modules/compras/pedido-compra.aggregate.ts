import { sql } from 'kysely';
import { pedidoCompraSchema, atualizarPedidoCompraSchema, CAMPOS_HERDADOS_ITEM } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { derivarPisCofinsRentabPedido } from '../shared/piscofins-rentab';
import { estadoFechamento, formatarEmpresas, lojaFechada, lojaRecebeu, lojasDoPedido, quantidadesPorLoja } from './pedido-lojas';
import { configNaTrx, herdarDoCatalogo } from './pedido-heranca';

/**
 * PEDIDO DE COMPRA (FRMPEDIDOCOMPRA) — a MAIOR tela do legado. Corte-1: NÚCLEO cadastro, agregado
 * mestre-detalhe via AggregateEngineService: master `pedidocompra` (empresaScoped) + detalhe
 * `pedidocompra_i` (itens). Documento de INTENÇÃO de compra (previsão). ARMAZENA cabeçalho + itens.
 *
 * **NÃO dispara efeito algum** (estoque/financeiro/fiscal): no legado o pedido é TRANSACIONAL PURO
 * (nenhum trigger no cabeçalho; o único trigger é auditoria no item). O FATO (fiscal definitivo,
 * movimento de estoque, títulos A Pagar) nasce na NF de ENTRADA que referencia o pedido — corte futuro.
 *
 * - `empresaScoped`: pedido por empresa (IDEMPRESA carimbado/filtrado pelo engine). O 1-para-N-lojas
 *   do legado (EMPRESAS CSV, COMPRA_1_PARA_N_LOJAS) é feature ADIADA.
 * - `derivarItensTrx` (por item): VLREMBALAGEM = FATOREMBALAGEM × VRCUSTO (custo estendido) — server-
 *   authoritative (não confia no cliente). Total do pedido = Σ VLREMBALAGEM (calculado na view; o
 *   cabeçalho NÃO persiste total — fiel ao legado).
 * - `derivarTrx` (master, só no create): CODOPERADOR = operador do contexto (o comprador que criou).
 * - `validar`: fornecedor tem de ser FRN='S'; pedido FECHADO não pode ser alterado (o fechar/reabrir
 *   é o vertical `PedidoCompraController`).
 * - `validarRemocao`: pedido FECHADO não pode ser excluído (reabra antes). Vínculo com NF de entrada
 *   ainda não existe no schema (NF.CODPEDCOMP não migrado) → guarda adiada.
 */

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000; // numeric(14,4)

/** resolve uma config (base + override por Empresa) com o handle de db do validar — espelha ConfigService.
 *  (o validar do agregado é um objeto declarativo, sem injeção — helper local documentado.) */
async function cfgValor(db: any, codigo: string, emp: number | null): Promise<string | null> {
  const c = await db
    .selectFrom('configuracoes')
    .select(['id', 'valor', 'config_especificas_permitidas'])
    .where('codigo', '=', codigo)
    .executeTakeFirst();
  if (!c) return null;
  const permitidos = String(c.config_especificas_permitidas ?? '').split(';').map((s: string) => s.trim());
  if (emp != null && permitidos.includes('Empresa')) {
    const ov = await db
      .selectFrom('configuracoes_especificas')
      .select('valor')
      .where('id', '=', c.id)
      .where('tipo', '=', 'Empresa')
      .where('chave', '=', String(emp))
      .executeTakeFirst();
    if (ov?.valor != null) return String(ov.valor);
  }
  return c.valor != null ? String(c.valor) : null;
}

const CD_COLS = ['cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8'] as const;

export const pedidoCompraAggregateConfig: AggregateConfig = {
  tabela: 'pedidocompra',
  pk: 'codpedcomp',
  view: 'get_pedidocompra',
  rbacForm: 'FRMPEDIDOCOMPRA',
  empresaScoped: true,
  softDelete: true,
  // CODOPERADOR (server-set via derivarTrx) e FECHADO (state-controlled) NÃO entram nas colunas editáveis.
  colunas: [
    'codparceiro', 'data', 'dt_vencimento', 'codconpagto',
    // corte-2: DATA_FATURAMENTO = data-base do vencimento das parcelas (legado DTFATURAMENTO input, separado
    // do marcador "recebido" do recebimento). CD1..CD8 = override local dos prazos (dias) da condição.
    'data_faturamento', 'cd1', 'cd2', 'cd3', 'cd4', 'cd5', 'cd6', 'cd7', 'cd8',
    // corte-final: situação-NF (classificação; gerar-NF a carrega à NF de entrada). BONIFICACAO (header) e
    // OPERADOR_ULT_LIB_VALOR_MAX são server-controlled (gerar-bonificado / liberar-limite) — fora do allowlist.
    'idsituacao_nf',
    'pc_tipo_frete', 'pc_valor_frete', 'pc_nronf_cruzamento', 'obs',
    // mig 303: as LOJAS PARTICIPANTES, no CSV do legado ('1, 2'). O pedido é visto e trabalhado por elas.
    'empresas',
  ],
  // a loja que está no CSV também enxerga o pedido (PedidoPertenceEmpresaSelecionada, uPedidoCompra.pas:3766)
  empresasColuna: 'empresas',
  // o CSV sai sempre no formato do legado ('1, 2'), ordenado e sem repetição
  derivar: (dto) => (dto.empresas === undefined || dto.empresas === null || dto.empresas === ''
    ? {} : { empresas: formatarEmpresas(lojasDoPedido(dto.empresas)) }),
  colunasPesquisa: ['codpedcomp', 'codparceiro', 'fornecedor', 'data', 'fechado', 'total', 'empresas'],
  detalhes: [
    {
      tabela: 'pedidocompra_i',
      pk: 'codpedcompi',
      fk: 'codpedcomp',
      chave: 'itens',
      colunas: [
        // FLIP do modelo (078): QTDE = nº de embalagens (comprador digita CAIXAS); FATOREMBALAGEM = fator (FATORCX).
        'idproduto', 'qtde', 'fatorembalagem', 'vrcusto', 'vlrembalagem', 'qtdtotal', 'totalcusto', 'desconto', 'descontop', 'obs',
        // corte precificação do item: markup→venda + margem líquida (L2) + custo líquido + PMZ (reuso do motor
        // /precificacao/produto; o comprador forma o preço). vrvenda (praticado) ≠ vrvendasug (sugerido pelo
        // motor). Nomes fiéis ao legado (MARGEML2/MARGEML2V). Analítica armazenada; sem propagação ao MULTI_PRECO.
        'vrcustoliquido', 'markup', 'vrvenda', 'vrvendasug', 'margeml2', 'margeml2v', 'pmz',
        // Wave 5: PIS/COFINS de RENTABILIDADE (débito projetado de saída + crédito de entrada) — server-authoritative
        // via catálogo (produto.idpiscofins) + regime da empresa. Snapshot de margem (fiel PEDIDOCOMPRA_I).
        'debitopiscofins', 'creditopiscofins',
        // corte-final: % bonificado do item (100 no pedido-espelho gerado por gerar-bonificado).
        'bonificacao',
        // mig 305: situação da NF do item (uPedidoCompra.pas:5183); sem ela, herda a do cabeçalho (:7349)
        'idsituacao_nf',
        // mig 307: o que o item herda do catálogo e o modal de preço edita. ⚠️ o motor regrava os itens a cada
        // salvamento — coluna fora desta lista é APAGADA no primeiro save (era o caso de vendaliq/vrcustob, que a
        // carga já trazia)
        ...CAMPOS_HERDADOS_ITEM,
      ],
      // Derivação server-authoritative (078, uPedidoCompra.pas:1971-1972): VLREMBALAGEM = FATOREMBALAGEM×VRCUSTO
      // (custo por caixa); QTDTOTAL = QTDE×FATOREMBALAGEM (unidades); TOTALCUSTO = QTDE×VLREMBALAGEM (total da linha).
      // QTDE default 1 (behavior-preserving: TOTALCUSTO≡VLREMBALAGEM). O cliente não é fonte da verdade dos derivados.
      derivarItensTrx: async (itensDto, trx, emp, header, masterId, snapshot) => {
        // mig 307: a HERANÇA (CarregarItens, uPedidoCompra.pas:7241). Campo ausente no payload: o item que já existia
        // guarda o que tinha (a foto da compra não muda porque o pedido foi salvo de novo — o motor regrava os itens);
        // o produto novo herda do catálogo da loja. Presente, é o que o comprador negociou.
        const anteriores = ((snapshot as { anteriores?: Map<number, Record<string, unknown>> } | undefined)?.anteriores) ?? new Map();
        const herdaveis = [...CAMPOS_HERDADOS_ITEM, 'markup', 'vrvenda', 'margeml2', 'margeml2v'] as const;
        let cfg: { custoRep: boolean; fatorRef: boolean } | null = null;
        const codparceiro = header?.codparceiro != null ? Number(header.codparceiro)
          : masterId != null ? Number(((await trx.selectFrom('pedidocompra').select('codparceiro').where('codpedcomp', '=', masterId).executeTakeFirst()) as any)?.codparceiro ?? 0) : 0;
        const itens: Record<string, unknown>[] = [];
        for (const it of itensDto) {
          if (!herdaveis.some((c) => it[c] === undefined)) { itens.push(it); continue; }
          let base: Record<string, unknown> | null = anteriores.get(Number(it.idproduto)) ?? null;
          if (!base && emp != null) {
            cfg ??= {
              custoRep: (await configNaTrx(trx, 'CUSTO_REP_PC', { empresaId: emp })) === 'S',
              fatorRef: (await configNaTrx(trx, 'USAR_FATOR_EMBALAGEM_REFERENCIA_FORNECEDOR', { empresaId: emp })) === 'S',
            };
            base = (await herdarDoCatalogo(trx, { emp, idproduto: Number(it.idproduto), codparceiro, custoRep: cfg.custoRep, fatorRefFornecedor: cfg.fatorRef })) as Record<string, unknown> | null;
          }
          const novo = { ...it };
          if (base) for (const c of herdaveis) if (novo[c] === undefined && base[c] != null) novo[c] = base[c];
          itens.push(novo);
        }
        // Wave 5: PIS/COFINS de rentabilidade resolvido do catálogo (produto.idpiscofins) + regime da empresa.
        const rentab = await derivarPisCofinsRentabPedido(trx, emp, itens);
        const lojasPed = await lojasDoMaster(trx, header, masterId, emp);
        return itens.map((it, idx) => {
          const vlrembalagem = r4(num(it.fatorembalagem) * num(it.vrcusto));
          // mig 303: a quantidade é POR LOJA (`PEDIDO_COMPRA_QTDE`) e a do item é a SOMA — como a carga já faz.
          // Sem `lojas` no item, é o pedido de uma loja só: a quantidade inteira vai para a primeira loja do pedido
          // (default 1, o comportamento de antes). Loja com zero é legítima (o legado cria a linha zerada).
          const lojas = normalizarLojasItem(it.lojas, lojasPed, num(it.qtde) > 0 ? num(it.qtde) : 1);
          const qtde = r4(lojas.reduce((a, l) => a + l.qtde, 0));
          return {
            ...it,
            lojas,
            qtde,
            // item sem situação herda a do cabeçalho, quando há (uPedidoCompra.pas:7349)
            idsituacao_nf: it.idsituacao_nf != null ? Number(it.idsituacao_nf)
              : num(header?.idsituacao_nf) > 0 ? Number(header?.idsituacao_nf) : null,
            vlrembalagem,
            qtdtotal: r4(qtde * num(it.fatorembalagem)),
            totalcusto: Math.round((qtde * vlrembalagem + Number.EPSILON) * 100) / 100,
            debitopiscofins: rentab[idx].debitopiscofins,
            creditopiscofins: rentab[idx].creditopiscofins,
          };
        });
      },
      // ⚠️ o neto `pedido_compra_qtde` (a quantidade de cada loja) vai junto com o item no delete+insert do motor: o
      // FECHAMENTO de cada loja é lido antes e reaplicado às linhas novas — fechar é por loja (uPedidoCompra.pas:7780)
      antesDeSubstituirTrx: async ({ trx, masterId }) => {
        // mig 307: a foto herdada de cada produto, antes do delete — é o que o item regravado mantém
        const anteriores = new Map<number, Record<string, unknown>>();
        for (const r of (await trx.selectFrom('pedidocompra_i')
          .select(['idproduto', 'markup', 'vrvenda', 'margeml2', 'margeml2v', ...CAMPOS_HERDADOS_ITEM])
          .where('codpedcomp', '=', masterId).orderBy('codpedcompi').execute()) as Array<Record<string, unknown>>) {
          if (!anteriores.has(Number(r.idproduto))) anteriores.set(Number(r.idproduto), r);
        }
        return { fechadas: (await estadoFechamento(trx, masterId)).lojas.filter((l) => l.fechado), anteriores };
      },
      aposInserirItensTrx: async ({ trx, itens, snapshot }) => {
        const fechadas = new Map((((snapshot as { fechadas?: Array<{ idempresa: number; data_fechamento: unknown; codoperador: number | null }> } | undefined)?.fechadas) ?? [])
          .map((l) => [l.idempresa, l]));
        const linhas: Record<string, unknown>[] = [];
        for (const it of itens) {
          for (const l of (it.lojas as Array<{ idempresa: number; qtde: number }>) ?? []) {
            const f = fechadas.get(l.idempresa);
            linhas.push({
              codpedcompi: it.codpedcompi, idempresa: l.idempresa, qtde: l.qtde,
              qtdtotal: r4(l.qtde * num(it.fatorembalagem)),
              totalcusto: Math.round((l.qtde * num(it.vlrembalagem) + Number.EPSILON) * 100) / 100,
              fechado: f ? 'S' : null, data_fechamento: f ? f.data_fechamento : null, codoperador: f ? f.codoperador : null,
              digitacao_fechada: 'N',
            });
          }
        }
        if (linhas.length) await trx.insertInto('pedido_compra_qtde').values(linhas).execute();
      },
      // a leitura traz a quantidade de cada loja em cada item
      anexarLeitura: async ({ db, itens }) => {
        const ids = itens.map((i) => Number(i.codpedcompi)).filter(Boolean);
        if (!ids.length) return itens;
        const rows = (await db.selectFrom('pedido_compra_qtde')
          .select(['codpedcompi', 'idempresa', 'qtde', 'qtdtotal', 'totalcusto', 'fechado'])
          .where('codpedcompi', 'in', ids).orderBy('idempresa').execute()) as Array<Record<string, unknown>>;
        return itens.map((i) => ({
          ...i,
          lojas: rows.filter((r) => Number(r.codpedcompi) === Number(i.codpedcompi)).map((r) => ({
            idempresa: Number(r.idempresa), qtde: Number(r.qtde ?? 0), qtdtotal: Number(r.qtdtotal ?? 0),
            totalcusto: Number(r.totalcusto ?? 0), fechado: r.fechado === 'S',
          })),
        }));
      },
    },
    {
      // corte-2: PARCELAS (2º detalhe). Editáveis (o legado permite ajustar); geradas pelo `gerar-parcelas`
      // (RatearTotalNasParcelas). Substituídas no PUT só quando a chave `parcelas` vier no dto. mig 303: cada loja
      // tem as suas (`IDEMPRESA;PARCELA`) — a loja da parcela é mantida se for do pedido; sem loja, a logada.
      tabela: 'pedidocompra_parcelas',
      pk: 'codpedcompparcelas',
      fk: 'codpedcomp',
      chave: 'parcelas',
      colunas: ['idempresa', 'parcela', 'data', 'valor', 'qtdediasaposfaturamento'],
      derivarItensTrx: async (parcelas, trx, emp, header, masterId) => {
        let empresas = header?.empresas;
        if (empresas == null && masterId != null) {
          const m = (await trx.selectFrom('pedidocompra').select(['empresas', 'idempresa'])
            .where('codpedcomp', '=', masterId).executeTakeFirst()) as { empresas?: string; idempresa?: number } | undefined;
          empresas = m?.empresas ?? m?.idempresa;
        }
        const lojas = lojasDoPedido(empresas, emp);
        for (const p of parcelas) {
          if (p.idempresa != null && !lojas.includes(Number(p.idempresa))) {
            throw new BusinessRuleError('PEDIDO_LOJA_FORA_DO_PEDIDO', { idempresa: Number(p.idempresa), parcela: p.parcela });
          }
        }
        return parcelas.map((p) => ({ ...p, idempresa: p.idempresa != null ? Number(p.idempresa) : (emp ?? currentTenant().empresaId ?? null) }));
      },
    },
  ],
  // CODOPERADOR = comprador (operador do contexto). Só no create (derivarTrx não roda no update) → imutável.
  // mig 303: sem lojas informadas, o pedido é da loja que o cria (como o legado, que abre com a empresa logada).
  derivarTrx: async ({ dto, emp }) => ({
    codoperador: currentTenant().operadorId ?? null,
    ...(dto.empresas ? {} : { empresas: emp != null ? String(emp) : null }),
  }),
  // o estado de fechamento de cada loja vai junto na leitura: é o que a tela precisa para saber o que pode fazer
  anexarLeitura: async ({ db, id, registro, emp }) => {
    const estado = await estadoFechamento(db, id, registro.fechado as string | null);
    const lojas = lojasDoPedido(registro.empresas, registro.idempresa as number);
    return {
      ...registro,
      lojas: lojas.map((l) => ({ idempresa: l, fechado: lojaFechada(estado, l) })),
      fechamento: estado.tipo,
      loja_logada_participa: emp != null && lojas.includes(emp),
      loja_logada_fechada: emp != null && lojaFechada(estado, emp),
    };
  },
  // Regras cross-row do btnGravar (consultam o banco antes de gravar).
  validar: async ({ dto, id, db }) => {
    const emp = currentTenant().empresaId ?? null;
    // `_sistema`: geração PROGRAMÁTICA (ex.: GerarPedido da COTAÇÃO) insere o pedido DIRETO, sem os gates
    // INTERATIVOS do btnGravar (condição-obrigatória / prazo-máximo / pendências-fornecedor) — fiel ao legado,
    // que grava o pedido em lote fora do formulário. As travas de integridade (FRN, estado FECHADO/FATURADO) FICAM.
    const interativo = (dto as Record<string, unknown>)._sistema !== true;

    // travas de edição por estado (update). Pedido excluído (soft-delete INDR='E') é INEXISTENTE — não
    // se edita um documento morto. FATURADO (dtfaturamento, via NF de entrada = corte futuro) é read-only
    // — no golden 1.804 pedidos já foram faturados com FECHADO='N', então a trava é por dtfaturamento,
    // não só por FECHADO. FECHADO='S' é read-only (o fechar/reabrir é o vertical).
    let atual:
      | ({ fechado?: string; dtfaturamento?: unknown; codparceiro?: number; codconpagto?: number; idempresa?: number; empresas?: string } & Record<string, unknown>)
      | undefined;
    if (id != null) {
      atual = (await db
        .selectFrom('pedidocompra')
        .select(['fechado', 'dtfaturamento', 'codparceiro', 'codconpagto', 'idempresa', 'empresas', ...CD_COLS])
        .where('codpedcomp', '=', id)
        .where(participa(emp))
        .where(sql`coalesce(indr,'I')`, '<>', 'E')
        .executeTakeFirst()) as typeof atual;
      if (!atual) throw new BusinessRuleError('PEDIDO_NAO_ENCONTRADO', { codpedcomp: id });
      // RECEBIDO trava a edição. No pedido de uma loja só é o marcador de antes (dtfaturamento); no multi-loja a nota
      // é POR LOJA — a loja 1 ter recebido não trava a loja 2, que ainda está aberta (mig 303)
      const multi = lojasDoPedido(atual.empresas, atual.idempresa).length > 1;
      if (multi ? (emp != null && (await lojaRecebeu(db, id, emp))) : atual.dtfaturamento != null) {
        throw new BusinessRuleError('PEDIDO_FATURADO');
      }
      await validarFechamentoPorLoja(db, id, atual, dto, emp);
    }
    // o fornecedor e as configs são os da loja DONA do pedido (parceiros é por empresa no Apollo)
    const empDono = atual?.idempresa != null ? Number(atual.idempresa) : emp;
    // as lojas do pedido existem, e cada item só leva quantidade para loja do pedido
    const lojasPed = lojasDoPedido(dto.empresas !== undefined ? dto.empresas : atual?.empresas, empDono);
    if (dto.empresas !== undefined && lojasPed.length) {
      const existem = (await db.selectFrom('empresas').select('idempresa').where('idempresa', 'in', lojasPed).execute()) as Array<{ idempresa: number }>;
      const faltam = lojasPed.filter((l) => !existem.some((e) => Number(e.idempresa) === l));
      if (faltam.length) throw new BusinessRuleError('PEDIDO_LOJA_INEXISTENTE', { lojas: faltam });
    }
    for (const it of (Array.isArray(dto.itens) ? dto.itens : []) as Array<Record<string, unknown>>) {
      for (const l of (Array.isArray(it.lojas) ? it.lojas : []) as Array<Record<string, unknown>>) {
        if (!lojasPed.includes(Number(l.idempresa))) {
          throw new BusinessRuleError('PEDIDO_LOJA_FORA_DO_PEDIDO', { idempresa: Number(l.idempresa), idproduto: it.idproduto ?? null, lojas: lojasPed });
        }
      }
    }

    // fornecedor tem de existir e ser fornecedor (FRN='S') — SegFornecedor do legado. O filtro por
    // idempresa segue o padrão do monorepo: PARCEIROS é empresaScoped aqui (parceiro.aggregate.ts) e o
    // Lote de Cobrança já valida o cobrador assim (lote-cobranca.repository.assertCobradorValido) —
    // divergência CONSCIENTE do legado (lá PARCEIROS é global), mas UNIFORME em todas as telas migradas.
    const cod = dto.codparceiro != null ? Number(dto.codparceiro) : null;
    if (cod != null) {
      const forn = (await db
        .selectFrom('parceiros')
        .select(['codparceiro', 'frn'])
        .where('codparceiro', '=', cod)
        .where('idempresa', '=', empDono)
        .executeTakeFirst()) as { frn?: string } | undefined;
      if (!forn || forn.frn !== 'S') throw new BusinessRuleError('PEDIDO_FORNECEDOR_INVALIDO', { codparceiro: cod });
    }

    // ── gates do btnGravar (corte-final; valores EFETIVOS = dto ?? linha atual) ──
    const efetivo = (campo: string): unknown => (dto[campo] !== undefined ? dto[campo] : atual?.[campo]);
    const cdsEfetivos = CD_COLS.map((c) => efetivo(c)).filter((v) => v != null && v !== '').map((v) => Number(v));
    const conpagtoEf = efetivo('codconpagto') != null ? Number(efetivo('codconpagto')) : null;
    const fornEf = cod ?? (atual?.codparceiro != null ? Number(atual.codparceiro) : null);

    // (1) OBRIGA_INFORMAR_CONDICOES_PAGAMENTO='S' (uPedidoCompra.pas:6831): exige condição (CD ou lookup).
    if (interativo && cdsEfetivos.length === 0 && conpagtoEf == null) {
      if ((await cfgValor(db, 'OBRIGA_INFORMAR_CONDICOES_PAGAMENTO', emp)) === 'S') {
        throw new BusinessRuleError('PEDIDO_SEM_CONDICAO_OBRIGATORIA');
      }
    }

    // (2) prazo máximo por fornecedor (PARCEIROS.QTDE_DIAS_MAXIMO_FP_PC; VerificaFP, uPedidoCompra.pas:6792):
    // nenhum CD do pedido (ou da condição, quando o pedido não sobrepõe) pode exceder o máximo do fornecedor.
    if (interativo && fornEf != null) {
      const fp = (await db
        .selectFrom('parceiros')
        .select('qtde_dias_maximo_fp_pc')
        .where('codparceiro', '=', fornEf)
        .where('idempresa', '=', empDono)
        .executeTakeFirst()) as { qtde_dias_maximo_fp_pc?: number } | undefined;
      const max = fp?.qtde_dias_maximo_fp_pc != null ? Number(fp.qtde_dias_maximo_fp_pc) : 0;
      if (max > 0) {
        let cds = cdsEfetivos;
        if (cds.length === 0 && conpagtoEf != null) {
          const cond = (await db
            .selectFrom('condicoes_pagto')
            .select([...CD_COLS])
            .where('codconpagto', '=', conpagtoEf)
            .executeTakeFirst()) as Record<string, unknown> | undefined;
          if (cond) cds = CD_COLS.map((c) => cond[c]).filter((v) => v != null).map((v) => Number(v));
        }
        const estourado = cds.find((d) => d > max);
        if (estourado != null) throw new BusinessRuleError('PEDIDO_PRAZO_EXCEDE_FORNECEDOR', { prazo: estourado, maximo: max });
      }
    }

    // (3) pendências financeiras do fornecedor (AVISA_PENDENCIAS_FORNECEDOR='B' bloqueia; 'S' é aviso de UI):
    // A Receber NÃO QUITADO do fornecedor (VerificaPendencias, uPedidoCompra.pas:4255). Só ao DEFINIR (create)
    // ou TROCAR o fornecedor — M3: o legado só chama VerificaPendencias na seleção do fornecedor (:6516/6614),
    // não a cada gravar; um PUT de formulário completo reenvia o mesmo codparceiro e não deve re-travar.
    const trocouFornecedor = cod != null && (atual == null || cod !== Number(atual.codparceiro));
    if (interativo && trocouFornecedor && (await cfgValor(db, 'AVISA_PENDENCIAS_FORNECEDOR', emp)) === 'B') {
      const pend = await db
        .selectFrom('areceber')
        .select('codrcb')
        .where('codparceiro', '=', cod)
        .where('codempresa', '=', emp)
        .where('quitada', '=', 'N')
        .executeTakeFirst();
      if (pend) throw new BusinessRuleError('PEDIDO_FORNECEDOR_PENDENCIAS', { codparceiro: cod });
    }
  },
  // Guarda de EXCLUSÃO (btnExcluir): não apagar pedido com efeitos. FATURADO (dtfaturamento) e FECHADO='S'
  // são bloqueados (reabra/estorne antes). O vínculo com a NF de entrada (NF.CODPEDCOMP) ainda não existe
  // no schema migrado → a guarda de "pedido com NF" entra junto com o recebimento (corte futuro).
  validarRemocao: async ({ id, db }) => {
    const emp = currentTenant().empresaId ?? null;
    const pc = (await db
      .selectFrom('pedidocompra')
      .select(['fechado', 'dtfaturamento'])
      .where('codpedcomp', '=', id)
      .where(participa(emp))
      .where(sql`coalesce(indr,'I')`, '<>', 'E')
      .executeTakeFirst()) as { fechado?: string; dtfaturamento?: unknown } | undefined;
    if (!pc) return; // já excluído / not-found → fluxo normal (soft-delete idempotente)
    if (pc.dtfaturamento != null) throw new BusinessRuleError('PEDIDO_FATURADO');
    // excluir o pedido bloqueia se QUALQUER loja fechou — parcial ou total (btnExcluirClick, uPedidoCompra.pas:6664)
    const estado = await estadoFechamento(db, id, pc.fechado);
    if (estado.tipo !== 'nenhum') throw new BusinessRuleError('PEDIDO_FECHADO', { fechamento: estado.tipo });
  },
};

/** a loja do contexto participa do pedido: é a dona ou está no CSV das lojas (mig 303). */
function participa(emp: number | null) {
  return sql<boolean>`(idempresa = ${emp} OR ${String(emp)} = ANY(string_to_array(replace(coalesce(empresas, ''), ' ', ''), ',')))`;
}

/** as lojas do pedido para os itens: do dto do cabeçalho, ou do banco (update parcial), ou a loja do contexto. */
async function lojasDoMaster(trx: any, header: Record<string, unknown> | undefined, masterId: number | undefined, emp: number | null): Promise<number[]> {
  if (header?.empresas) return lojasDoPedido(header.empresas);
  if (masterId != null) {
    const r = (await trx.selectFrom('pedidocompra').select(['empresas', 'idempresa']).where('codpedcomp', '=', masterId)
      .executeTakeFirst()) as { empresas?: string; idempresa?: number } | undefined;
    if (r) return lojasDoPedido(r.empresas, r.idempresa);
  }
  return emp != null ? [emp] : [];
}

/** as quantidades de um item por loja: as que vieram (somando repetições), ou tudo na primeira loja do pedido. */
function normalizarLojasItem(bruto: unknown, lojasPed: number[], qtdeItem: number): Array<{ idempresa: number; qtde: number }> {
  if (Array.isArray(bruto) && bruto.length) {
    const soma = new Map<number, number>();
    for (const l of bruto as Array<Record<string, unknown>>) {
      const loja = Number(l.idempresa);
      soma.set(loja, r4((soma.get(loja) ?? 0) + Math.max(0, num(l.qtde))));
    }
    return [...soma.entries()].sort((a, b) => a[0] - b[0]).map(([idempresa, qtde]) => ({ idempresa, qtde }));
  }
  return lojasPed.length ? [{ idempresa: lojasPed[0], qtde: qtdeItem }] : [];
}

/**
 * As travas de edição POR LOJA do legado (mig 303), no lugar do "cabeçalho fechado":
 *   editar o pedido ...................... TODAS as lojas fechadas, ou a LOJA LOGADA fechada (btnEditarClick, :6610)
 *   tirar item ........................... QUALQUER loja fechada (btnExcluirIClick/btnLimparIClick, :6709/:7090)
 *   quantidade de uma loja fechada ....... não muda (edição da célula, :2002) — nem tirando a loja do pedido
 * Para o pedido de uma loja só isto é exatamente a trava de antes.
 */
async function validarFechamentoPorLoja(
  db: any, id: number, atual: { fechado?: string; empresas?: string; idempresa?: number },
  dto: Record<string, unknown>, emp: number | null,
): Promise<void> {
  const estado = await estadoFechamento(db, id, atual.fechado);
  if (estado.tipo === 'nenhum') return;
  if (estado.tipo === 'total') throw new BusinessRuleError('PEDIDO_FECHADO');
  if (emp != null && lojaFechada(estado, emp)) throw new BusinessRuleError('PEDIDO_FECHADO_NA_EMPRESA', { idempresa: emp });
  const fechadas = estado.lojas.filter((l) => l.fechado).map((l) => l.idempresa);
  if (dto.empresas !== undefined) {
    const novas = lojasDoPedido(dto.empresas);
    const saiu = fechadas.find((l) => !novas.includes(l));
    if (saiu != null) throw new BusinessRuleError('PEDIDO_LOJA_FECHADA', { idempresa: saiu });
  }
  if (!Array.isArray(dto.itens)) return;
  const antes = await quantidadesPorLoja(db, id);
  const produtosAntes = new Set([...antes.keys()].map((k) => k.split('|')[0]));
  const lojasPed = lojasDoPedido(dto.empresas !== undefined ? dto.empresas : atual.empresas, atual.idempresa);
  const depois = new Map<string, number>();
  const produtosDepois = new Set<string>();
  for (const it of dto.itens as Array<Record<string, unknown>>) {
    produtosDepois.add(String(it.idproduto));
    for (const l of normalizarLojasItem(it.lojas, lojasPed, num(it.qtde) > 0 ? num(it.qtde) : 1)) {
      const k = `${it.idproduto}|${l.idempresa}`;
      depois.set(k, r4((depois.get(k) ?? 0) + l.qtde));
    }
  }
  // com loja fechada não se tira item — o legado bloqueia excluir/limpar item no parcial
  const saiuProduto = [...produtosAntes].find((p) => !produtosDepois.has(p));
  if (saiuProduto != null) throw new BusinessRuleError('PEDIDO_FECHADO_PARCIAL', { idproduto: Number(saiuProduto) });
  for (const loja of fechadas) {
    const chaves = new Set([...antes.keys(), ...depois.keys()].filter((k) => k.endsWith(`|${loja}`)));
    for (const k of chaves) {
      if (r4(antes.get(k) ?? 0) !== r4(depois.get(k) ?? 0)) {
        throw new BusinessRuleError('PEDIDO_LOJA_FECHADA', { idempresa: loja, idproduto: Number(k.split('|')[0]) });
      }
    }
  }
}

export const PedidoCompraAggregateController = createAggregateController({
  path: 'compras/pedidos',
  config: pedidoCompraAggregateConfig,
  schema: pedidoCompraSchema,
  updateSchema: atualizarPedidoCompraSchema,
});
