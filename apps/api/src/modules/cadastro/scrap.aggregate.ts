import { scrapSchema, atualizarScrapSchema } from '@apollo/shared';
import { opcoesConcedidas } from '../../shared/acesso/acesso.service';
import { conferirDetalhe } from '../../shared/acesso/controles';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { assertCentroCustoDaSituacao } from '../shared/situacao-restricoes';
import { lancarCaixaDoScrap } from './scrap-caixa';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { sql } from 'kysely';
import { configNaTrx } from '../compras/pedido-heranca';

/**
 * SCRAP / PERDAS (FRMCADSCRAP — uCadSCRAP) — corte-1: NÚCLEO do documento (agregado mestre-detalhe `scrap` +
 * itens `scrap_item`). FIEL: o operador informa idproduto + qtde + motivo; o custo (vr_custo/vrcustorep) é SNAPSHOT
 * server-authoritative de MULTI_PRECO (igual ao Inventário — GetCustoProduto). Valor = qtde × vr_custo. A BAIXA de
 * estoque NÃO acontece aqui — é o passo `aplicar` (scrap.service), como o Inventário decopla a efetivação.
 * empresaScoped; exclusão FÍSICA (sem INDR). validarRemocao trava excluir doc já aplicado (mov_estoque='S') ou
 * faturado (importado='S').
 */

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/**
 * As travas do gravar (`btnGravarClick`, uCadSCRAP.pas:603-700; `BtnAdicionarItemClick` :306-335; udmCadSCRAP.pas):
 * - "Obrigatório informar um item. Verifique!" e "Informe o centro de custo e tente novamente!" (623 de 623 com CC);
 * - "Quantidade não pode ser MENOR QUE ZERO" (`cdsSCRAP_ItemBeforePost`; 0 negativos em 28.532 itens de 2025-26);
 * - a SITUAÇÃO do documento, de TIPO_OPERACAO 'E02', com INFORMA_SITUACAO_DOCUMENTO_SCRAP (override "Modulo Retaguarda" = S
 *   no cliente — 621 de 623 com situação);
 * - o centro de custo com FLG_USO_SETOR obriga o setor de consumo, e INFORMA_MOTIVO_PERDA_SCRAP ou o PLC_OBRIGA_MOTIVO_PERDA
 *   do centro de custo obrigam o motivo — cobrados, como no legado, nos itens INCLUÍDOS (o item antigo não é revalidado).
 */
async function validarDocumento(db: any, dto: Record<string, unknown>, id: number | null, antes: { codplc?: unknown; idsituacao_nf?: unknown }): Promise<void> {
  const itens = Array.isArray(dto.itens) ? (dto.itens as Array<Record<string, unknown>>) : null;
  if (itens && itens.some((i) => num(i.qtde) < 0)) throw new BusinessRuleError('SCRAP_QTDE_NEGATIVA');
  if ((id == null || itens) && !(itens ?? []).some((i) => num(i.qtde) !== 0)) throw new BusinessRuleError('SCRAP_ITEM_OBRIGATORIO');
  const codplc = dto.codplc !== undefined ? dto.codplc : antes.codplc;
  if (!(num(codplc) > 0)) throw new BusinessRuleError('SCRAP_SEM_CENTRO_CUSTO');
  const ctx = { empresaId: currentTenant().empresaId ?? null, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' };
  const sit = dto.idsituacao_nf !== undefined ? dto.idsituacao_nf : antes.idsituacao_nf;
  if (id == null && String((await configNaTrx(db, 'INFORMA_SITUACAO_DOCUMENTO_SCRAP', ctx)) ?? 'N') === 'S' && !(num(sit) > 0)) {
    throw new BusinessRuleError('SCRAP_SEM_SITUACAO');
  }
  if (num(sit) > 0 && (dto.idsituacao_nf !== undefined || id == null)) {
    const s = (await sql<{ t: string | null }>`SELECT tipo_operacao AS t FROM situacao_nf WHERE idsituacao_nf = ${num(sit)}`.execute(db)).rows[0];
    if (!s || String(s.t ?? '') !== 'E02') throw new BusinessRuleError('SCRAP_SITUACAO_INVALIDA', { idsituacao_nf: num(sit) });
  }
  const plc = (await sql<{ setor: string | null; motivo: string | null }>`
    SELECT flg_uso_setor AS setor, plc_obriga_motivo_perda AS motivo FROM plc WHERE codplc = ${num(codplc)}`.execute(db)).rows[0];
  if (!plc) throw new BusinessRuleError('CENTRO_CUSTO_NAO_ENCONTRADO', { codplc: num(codplc) });
  if (!itens) return;
  const existentes = id == null ? new Set<number>() : new Set(((await db.selectFrom('scrap_item').select('idproduto').where('codscrap', '=', id).execute()) as Array<{ idproduto: number }>).map((r) => Number(r.idproduto)));
  const novos = itens.filter((i) => num(i.qtde) !== 0 && !existentes.has(num(i.idproduto)));
  if (String(plc.setor ?? '') === 'S') {
    const sem = novos.find((i) => !(num(i.codsetor) > 0));
    if (sem) throw new BusinessRuleError('SCRAP_SETOR_OBRIGATORIO', { idproduto: num(sem.idproduto) });
  }
  const obrigaMotivo = String(plc.motivo ?? '') === 'S' || String((await configNaTrx(db, 'INFORMA_MOTIVO_PERDA_SCRAP', ctx)) ?? 'N') === 'S';
  if (obrigaMotivo) {
    const sem = novos.find((i) => !(num(i.codmotivoop) > 0));
    if (sem) throw new BusinessRuleError('SCRAP_MOTIVO_OBRIGATORIO', { idproduto: num(sem.idproduto) });
  }
}

export const scrapAggregateConfig: AggregateConfig = {
  tabela: 'scrap',
  pk: 'codscrap',
  view: 'get_scrap',
  rbacForm: 'FRMCADSCRAP',
  // a LOG do form-base (uCadMaster.pas:485): o título da tela como a produção grava — o "Registro de log" a mostra
  log: { formulario: 'SCRAP - PERDAS' },
  empresaScoped: true,
  softDelete: false, // legado: exclusão física (hard delete + cascata de itens)
  colunas: ['dt_cadastro', 'codplc', 'codparceiro', 'idsituacao_nf', 'obs'],
  colunasPesquisa: ['codscrap', 'dt_cadastro', 'parceiro', 'qtde_itens', 'valor_total'],
  detalhes: [
    {
      tabela: 'scrap_item',
      pk: 'codscrapitem',
      fk: 'codscrap',
      chave: 'itens',
      chaveNatural: ['idproduto'],
      // idem (lição 124)
      preservarNaoGerenciadas: true,
      colunas: ['idempresa', 'idproduto', 'idproduto_filho', 'qtde', 'vr_custo', 'vrcustorep', 'codmotivoop', 'codsetor', 'codfor', 'origem', 'motivo', 'origem_estoque', 'faturado', 'obs', 'usucadastro'],
      // SNAPSHOT server-authoritative do custo: o operador fornece produto/qtde/motivo; vr_custo/vrcustorep vêm de
      // MULTI_PRECO (por empresa) — fiel a SetaOutrasInformacoesItemScrap. origem/motivo/faturado = defaults do legado.
      derivarItensTrx: async (itens, trx, emp) => {
        const out: Record<string, unknown>[] = [];
        for (const it of itens) {
          // "Existem produtos com quantidade zerada que serão excluídos da lista do scrap ao gravar." (uCadSCRAP.pas:640-665)
          if (num(it.qtde) === 0) continue;
          const pid = Number(it.idproduto);
          const mp = (await trx
            .selectFrom('multi_preco')
            .select(['vrcusto', 'vrcustorep'])
            .where('idproduto', '=', pid)
            .where('idempresa', '=', emp)
            .executeTakeFirst()) as { vrcusto?: unknown; vrcustorep?: unknown } | undefined;
          out.push({
            ...it,
            idempresa: emp, // o engine não carimba idempresa no detalhe → deriva aqui
            idproduto: pid,
            qtde: num(it.qtde), // SIGNED (fiel ao golden)
            // custo SERVER-AUTHORITATIVE de MULTI_PRECO (o operador NÃO digita o custo — fold auditoria [MÉDIA]:
            // não confiar em vr_custo do cliente, senão o valor da perda seria forjável). Igual à carga do legado.
            vr_custo: num(mp?.vrcusto),
            vrcustorep: num(mp?.vrcustorep),
            codmotivoop: it.codmotivoop != null ? Number(it.codmotivoop) : null,
            codsetor: it.codsetor != null ? Number(it.codsetor) : null,
            codfor: it.codfor != null ? Number(it.codfor) : null,
            idproduto_filho: it.idproduto_filho != null ? Number(it.idproduto_filho) : null,
            origem: 'ESTOQUE',
            motivo: 'LIXO/PERDA',
            faturado: 'N',
            origem_estoque: it.origem_estoque ?? 'E', // default do golden (LOJA); single-bucket ignora o balde
            obs: it.obs ?? null,
            // quem incluiu o item (28.527 de 28.531 preenchidos no legado); o item que já existia mantém o seu (preservarNaoGerenciadas)
            usucadastro: it.usucadastro ?? currentTenant().operadorId ?? null,
          });
        }
        return out;
      },
    },
  ],
  derivarTrx: async ({ dto, trx, emp }) => {
    const out: Record<string, unknown> = { usucadastro: currentTenant().operadorId ?? null, usultalteracao: currentTenant().operadorId ?? null };
    // o fornecedor do documento é o PARCEIRO DA EMPRESA (`cdsSCRAPNewRecord`, udmCadSCRAP.pas:208-214) — 623 de 623 no cliente
    if (dto.codparceiro == null && emp != null) {
      const e = (await sql<{ p: number | null }>`SELECT codparceiro AS p FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0];
      if (num(e?.p) > 0) out.codparceiro = Number(e?.p);
    }
    return out;
  },
  validar: async ({ dto, id, db }) => {
    // fold auditoria [ALTA]: editar (PUT) um scrap com baixa APLICADA (mov_estoque='S') ou já FATURADO
    // (importado='S') dessincronizaria a baixa do conjunto de itens (o estornar usa os itens ATUAIS). Trava aqui —
    // espelha o validarRemocao. (leitura fora da txn de escrita, como o validarRemocao; janela TOCTOU mínima.)
    let antes: { codplc?: unknown; idsituacao_nf?: unknown } = {};
    if (id != null) {
      const s = (await db.selectFrom('scrap').select(['mov_estoque', 'importado', 'codplc', 'idsituacao_nf']).where('codscrap', '=', id).executeTakeFirst()) as { mov_estoque?: string; importado?: string; codplc?: unknown; idsituacao_nf?: unknown } | undefined;
      if (s?.mov_estoque === 'S') throw new BusinessRuleError('SCRAP_ESTOQUE_APLICADO', { codscrap: id });
      if (s?.importado === 'S') throw new BusinessRuleError('SCRAP_JA_FATURADO', { codscrap: id });
      antes = s ?? {};
    }
    await validarDocumento(db, dto, id ?? null, antes);
    // as PERMISSÕES DE CONTROLE da grade (uMaster.SetStateOfControlsMaster sobre o uCadSCRAP.dfm): "Adicionar item"
    // (btnAdicionarItem), "Excluir" (btnExcluirI) e "Limpar" (btnLimparI) desabilitados para quem não tem a opção — produção
    // 27/09/2026: de 51 operador×loja com acesso, 9 não excluem e 6 não limpam. Sem operador no contexto, sem controle.
    if (Array.isArray(dto.itens) && currentTenant().operadorId != null) {
      const tem = await opcoesConcedidas(db, 'FRMCADSCRAP');
      const antigos = id != null
        ? ((await db.selectFrom('scrap_item').select('idproduto').where('codscrap', '=', id).execute()) as Array<{ idproduto: number }>).map((r) => Number(r.idproduto))
        : [];
      conferirDetalhe(tem, 'FRMCADSCRAP', antigos, (dto.itens as Array<Record<string, unknown>>).map((i) => Number(i.idproduto)),
        { adicionar: 'BTNADICIONARITEM', excluir: 'BTNEXCLUIRI', limpar: 'BTNLIMPARI', no: 'no lançamento de perda', do: 'do lançamento de perda' });
    }
    // o centro de custo da situação do documento (edtCodPLCExit, uCadSCRAP.pas:1311; UCadSituacaoNF.md C5) — cobrado
    // quando a situação ou o centro de custo é informado/alterado
    const mudou = (c: 'codplc' | 'idsituacao_nf') => dto[c] !== undefined && Number(dto[c] ?? 0) !== Number(antes[c] ?? 0);
    if (mudou('codplc') || mudou('idsituacao_nf')) {
      await assertCentroCustoDaSituacao(db, dto.idsituacao_nf !== undefined ? dto.idsituacao_nf : antes.idsituacao_nf, dto.codplc !== undefined ? dto.codplc : antes.codplc);
    }
    const itens = Array.isArray(dto.itens) ? (dto.itens as Array<Record<string, unknown>>) : null;
    if (!itens || !itens.length) return;
    // produto de cada item tem de existir (erro claro em vez de 23503 cru).
    const ids = Array.from(new Set(itens.map((i) => Number(i.idproduto)).filter((n) => Number.isInteger(n) && n > 0)));
    if (ids.length) {
      const existentes = new Set(
        ((await db.selectFrom('produtos').select('idproduto').where('idproduto', 'in', ids).execute()) as Array<{ idproduto: number }>).map((r) => Number(r.idproduto)),
      );
      for (const id of ids) if (!existentes.has(id)) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { idproduto: id });
    }
    // motivo (quando informado, >0) tem de existir e ser de PERDA — tolera null/0 (fiel ao golden: 31k linhas sem motivo).
    const motivos = Array.from(new Set(itens.map((i) => Number(i.codmotivoop)).filter((n) => Number.isInteger(n) && n > 0)));
    if (motivos.length) {
      const validos = new Set(
        ((await db.selectFrom('motivos_operacao').select('codmotivoop').where('codmotivoop', 'in', motivos).where('tipo_operacao', '=', 'PERDA').execute()) as Array<{ codmotivoop: number }>).map((r) => Number(r.codmotivoop)),
      );
      for (const m of motivos) if (!validos.has(m)) throw new BusinessRuleError('MOTIVO_NAO_ENCONTRADO', { codmotivoop: m });
    }
  },
  validarRemocao: async ({ id, db }) => {
    const s = (await db.selectFrom('scrap').select(['mov_estoque', 'importado']).where('codscrap', '=', id).executeTakeFirst()) as { mov_estoque?: string; importado?: string } | undefined;
    if (s?.mov_estoque === 'S') throw new BusinessRuleError('SCRAP_ESTOQUE_APLICADO', { codscrap: id }); // estornar antes
    if (s?.importado === 'S') throw new BusinessRuleError('SCRAP_JA_FATURADO', { codscrap: id });
  },
  // a perda na CAIXA gerencial: a diferença a cada gravação (uCadSCRAP.pas:716; scrap-caixa.ts)
  aposGravarTrx: async ({ trx, id, emp }) => {
    await lancarCaixaDoScrap(trx, id, emp ?? null);
  },
  // e a exclusão leva a CAIXA junto (FK_CAIXA_SCRAP ON DELETE CASCADE no Oracle)
  aoRemover: async ({ id, db }) => {
    await db.deleteFrom('caixa').where('codscrap', '=', id).execute();
  },
};

export const ScrapAggregateController = createAggregateController({
  path: 'cadastro/scrap',
  config: scrapAggregateConfig,
  schema: scrapSchema,
  updateSchema: atualizarScrapSchema,
});
