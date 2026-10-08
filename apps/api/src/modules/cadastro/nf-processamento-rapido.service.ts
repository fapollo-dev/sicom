import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant, runWithTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { todasAsEmpresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { configNaTrx } from '../compras/pedido-heranca';
import { NfProcessamentoService } from './nf-processamento.service';
import { preencherRateioContabil } from './nf-rateio';
import { fotoDaNf, logDaDiferencaNf } from './nf-log';
import type { OpcoesProcessarEntrada } from './nf-produtos-processar';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** o título da janela, que o TLog grava como FORMULARIO (157 notas na LOG da produção, 2024-2026) */
export const FORM_PROCESSAMENTO_RAPIDO = 'Processamento rápido de nota fiscal';

export interface PendenciaRapida { ordem: number; atalho: string; descricao: string; realizado: 'R' | 'P' }

/**
 * PROCESSAMENTO RÁPIDO DE NOTA FISCAL (`TFrmProcessaNotaFiscal`, uProcessaNotaFiscal.pas) — a janela que o legado abre logo depois de
 * gerar a nota de transferência entre lojas ("Deseja processar esta nota fiscal?", uNF.pas:7591-7600), sobre a ENTRADA que nasceu na
 * loja de destino, sem sair da sessão da loja de origem. Na produção TODAS as entradas de transferência passam por ela (40, 79 e 38 notas
 * em 2024, 2025 e 2026 — CFOP 1152, "PROC N → S" na LOG com o título da janela), por operadores que têm acesso à loja de destino: o
 * Apollo exige esse acesso (RELACAO_OPERADOR_EMPRESA) e processa no contexto da loja da nota — estoque, preço e configurações de lá.
 *
 * A janela: os dados da nota (QryNotaInfo), as 7 pendências (`CarregaPendencias`, :1136-1300 — R realizada, P pendente) e as ações que
 * as resolvem — F4 a situação de documento (só as de transferência, `VincularSituacaoDeDocumento` :1636), F6 os lançamentos contábeis
 * (o rateio da situação, `InserirCentroDeCustosDefinidos` da tela de lançamentos) — e o Processar (`ProcessarNotaFiscal` :1038): as
 * travas desta janela que o processamento da NF não tem (a situação obrigatória, o pedido não liberado, os lançamentos contábeis da
 * integração SICOM) e depois o processamento de sempre (o TfrmEstoqueNF), com a LOG no título desta janela.
 */
@Injectable()
export class NfProcessamentoRapidoService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly proc: NfProcessamentoService,
  ) {}

  /** a nota, de qualquer loja do operador (a de destino da transferência) — fora delas, não existe para ele */
  private async nota(db: AnyDB, codnf: number): Promise<Record<string, any>> {
    const n = (await sql<Record<string, any>>`
      SELECT n.codnf, n.nronf, n.serie, n.dtemissao, n.chavenfe, p.razao, e.cnpj_cpf, n.totalnf, n.idsituacao_nf, s.descricao AS desc_situacao,
             n.cfop, coalesce(n.proc, 'N') AS proc, n.tipo, n.idempresa, emp.fantasia, emp.figurafiscal, n.tipoemissao, p.retira_fornindex,
             n.nf_importacao_nfe, n.finalidade, n.libera_nf_indexador, s.exige_pedido_compra, n.codpedcomp, n.status_pedcomp
        FROM nf n
        LEFT JOIN parceiros p     ON p.codparceiro = n.codparceiro
        LEFT JOIN parceiros_end e ON e.codend = n.codparceiro_end
        LEFT JOIN situacao_nf s   ON s.idsituacao_nf = n.idsituacao_nf
        LEFT JOIN empresas emp    ON emp.idempresa = n.idempresa
       WHERE n.codnf = ${codnf}`.execute(db)).rows[0];
    if (!n || !(await todasAsEmpresasDoOperador(db)).includes(Number(n.idempresa))) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
    return n;
  }

  /** roda na loja da nota (o processamento, o rateio e a LOG são de lá) */
  private naLojaDaNota<T>(idempresa: number, fn: () => Promise<T>): Promise<T> {
    const t = currentTenant();
    return runWithTenant({ ...t, empresaId: idempresa }, fn);
  }

  /** a CFOP está na situação? (`VerificaCfopComSituacaoNF`, :1772 — o ISITUACAO_NF da situação) */
  private async cfopNaSituacao(db: AnyDB, idsituacao: unknown, cfop: unknown): Promise<boolean> {
    if (!(num(idsituacao) > 0)) return false;
    return (await sql`SELECT 1 FROM isituacao_nf WHERE idsituacao_nf = ${num(idsituacao)} AND codcfop = ${num(cfop)} LIMIT 1`.execute(db)).rows.length > 0;
  }

  /** a janela: os dados da nota e as pendências */
  async ler(codnf: number): Promise<{ nota: Record<string, unknown>; pendencias: PendenciaRapida[] }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const n = await this.nota(db, codnf);
    const op = currentTenant().operadorId ?? null;
    const entrada = String(n.tipo) === 'E';
    const comSituacao = n.idsituacao_nf != null;
    const itens = (await db.selectFrom('nf_prod').select(['cfop', 'idsituacao_nf', 'indexadortrib', 'repassado']).where('codnf', '=', codnf)
      .orderBy('codnfprod').execute()) as Array<Record<string, unknown>>;

    // 1. F4 — a situação de documento gravada na nota
    const situacao: 'R' | 'P' = num(n.idsituacao_nf) > 0 ? 'R' : 'P';
    // 2. F5 — o pedido de compra só pende com o CONFERIR PEDIDO COMPRA NA NF DE ENTRADA = 'SIM' (CONFIGURA): a produção não tem a linha
    //    (o padrão do DmConfigura é 'NÃO'), então fica realizado; o pedido NÃO LIBERADO é trava do Processar
    const pedido: 'R' | 'P' = 'R';
    // 3. F6 — os lançamentos contábeis da integração: a soma tem de ser o total da nota
    const integra = String((await configNaTrx(db, 'UTILIZA_INTEGRACAO_CONTABIL', { empresaId: Number(n.idempresa), operadorId: op, modulo: 'Retaguarda' })) ?? '').toUpperCase() === 'S';
    let contabil: 'R' | 'P' = 'R';
    if (integra) {
      const tot = (await sql<{ n: number; total: unknown }>`SELECT count(*)::int AS n, sum(valor) AS total FROM nf_contabil WHERE codnf = ${codnf}`.execute(db)).rows[0];
      contabil = num(tot?.n) > 0 && r2(num(tot.total)) === r2(num(n.totalnf)) ? 'R' : 'P';
    }
    // 4. F7 — a CFOP de cada item na situação do item; 5. F8 — a da nota na situação da nota (só na entrada com situação)
    let cfopItem: 'R' | 'P' = 'R';
    let cfopNota: 'R' | 'P' = 'R';
    if (entrada && comSituacao) {
      for (const it of itens) if (!(await this.cfopNaSituacao(db, it.idsituacao_nf, it.cfop))) { cfopItem = 'P'; break; }
      if (!(await this.cfopNaSituacao(db, n.idsituacao_nf, n.cfop))) cfopNota = 'P';
    }
    // 6. F9 — os indexadores (a loja 'O', emissão de terceiros, fornecedor que não retira o indexador, fora das CFOPs isentas, nota do XML)
    const figura = String(n.figurafiscal ?? 'D').trim().toUpperCase();
    const terceiros = String(n.tipoemissao ?? '').trim() === '1';
    const importacao = String(n.nf_importacao_nfe ?? '').trim().toUpperCase();
    let indexadores: 'R' | 'P' = 'R';
    if (figura === 'O' && entrada && terceiros && String(n.retira_fornindex ?? '') !== 'S' && String(n.libera_nf_indexador ?? '') !== 'S'
      && ![1152, 1409, 2401].includes(num(n.cfop)) && importacao === 'S' && itens.some((i) => !(num(i.indexadortrib) > 0))) indexadores = 'P';
    // 7. F10 — os itens não repassados (ValidaItensRepassadosNoIndex / ComIndex: fora da devolução e da transferência)
    const foraDaIsencao = String(n.finalidade ?? '').trim() !== '4' && importacao !== 'T';
    const repasse: 'R' | 'P' = entrada && foraDaIsencao && (figura !== 'D' || terceiros) && itens.some((i) => String(i.repassado ?? '') === 'N') ? 'P' : 'R';

    return {
      nota: {
        codnf: Number(n.codnf), nronf: n.nronf, serie: n.serie, dtemissao: n.dtemissao, chavenfe: n.chavenfe, razao: n.razao, cnpj_cpf: n.cnpj_cpf,
        totalnf: r2(num(n.totalnf)), idsituacao_nf: n.idsituacao_nf == null ? null : Number(n.idsituacao_nf), desc_situacao: n.desc_situacao,
        cfop: n.cfop == null ? null : Number(n.cfop), proc: n.proc, tipo: n.tipo, idempresa: Number(n.idempresa), fantasia: n.fantasia,
      },
      pendencias: [
        { ordem: 1, atalho: 'F4', descricao: 'Situação de documento', realizado: situacao },
        { ordem: 2, atalho: 'F5', descricao: 'Pedido de Compra', realizado: pedido },
        { ordem: 3, atalho: 'F6', descricao: 'Lançamentos contábeis', realizado: contabil },
        { ordem: 4, atalho: 'F7', descricao: 'Itens da Nota fiscal (CFOP)', realizado: cfopItem },
        { ordem: 5, atalho: 'F8', descricao: 'Itens da Nota fiscal (Situação Doc.)', realizado: cfopNota },
        { ordem: 6, atalho: 'F9', descricao: 'Itens da Nota fiscal (Indexadores)', realizado: indexadores },
        { ordem: 7, atalho: 'F10', descricao: 'Itens da Nota fiscal (Repasse)', realizado: repasse },
      ],
    };
  }

  /**
   * F4 — as situações que a janela oferece (`VincularSituacaoDeDocumento`, :1636-1660): as do TIPO da nota que têm alguma CFOP de
   * transferência (CFOP.PROC_TRANSF = 'S'), com a lista das CFOPs, como a consulta de situação de documento mostra
   */
  async situacoes(codnf: number): Promise<Array<{ idsituacao_nf: number; descricao: string | null; cfops: string }>> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const n = await this.nota(db, codnf);
    return (await sql<{ idsituacao_nf: number; descricao: string | null; cfops: string }>`
      SELECT s.idsituacao_nf, s.descricao, string_agg(i.codcfop::text, ',' ORDER BY i.codcfop) AS cfops
        FROM situacao_nf s JOIN isituacao_nf i ON i.idsituacao_nf = s.idsituacao_nf
       WHERE s.tipo = ${String(n.tipo)}
         AND s.idsituacao_nf IN (SELECT ist.idsituacao_nf FROM isituacao_nf ist JOIN cfop c ON trim(c.codcfop::text) = ist.codcfop::text WHERE coalesce(c.proc_transf, 'N') = 'S')
       GROUP BY s.idsituacao_nf, s.descricao
       ORDER BY s.idsituacao_nf`.execute(db)).rows.map((r) => ({ ...r, idsituacao_nf: Number(r.idsituacao_nf) }));
  }

  /** F4 — grava a situação na nota e em todos os itens (o legado aplica nos dois e dá ApplyUpdates), com a LOG da janela */
  async vincularSituacao(codnf: number, idsituacao: number): Promise<{ codnf: number; idsituacao_nf: number }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const n = await this.nota(db, codnf);
    if (String(n.proc) === 'S') throw new BusinessRuleError('NF_PROCESSADA', { codnf });
    // "Situação de documento não definida!" — só as de transferência do tipo da nota
    if (!(await this.situacoes(codnf)).some((s) => s.idsituacao_nf === idsituacao)) throw new BusinessRuleError('NF_RAPIDO_SITUACAO_INVALIDA', { codnf, idsituacao });
    const op = currentTenant().operadorId ?? null;
    await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const foto = await fotoDaNf(trx, codnf);
      await trx.updateTable('nf').set({ idsituacao_nf: idsituacao, usultalteracao: op, dtultimalteracao: sql`now()` }).where('codnf', '=', codnf).execute();
      await trx.updateTable('nf_prod').set({ idsituacao_nf: idsituacao }).where('codnf', '=', codnf).execute();
      await logDaDiferencaNf(trx, codnf, foto, FORM_PROCESSAMENTO_RAPIDO);
    });
    return { codnf, idsituacao_nf: idsituacao };
  }

  /** F6 — os lançamentos contábeis da nota (a grade da tela de lançamentos), com o centro de custo e a situação */
  async lancamentos(codnf: number): Promise<{ linhas: Array<Record<string, unknown>>; total: number; totalnf: number }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const n = await this.nota(db, codnf);
    const linhas = (await sql<Record<string, unknown>>`
      SELECT c.codcontabilnf, c.idsituacao_nf, s.descricao AS situacao, c.codcc, p.descricao AS centro_custo, p.desccodplc AS codigo_extenso, c.valor, c.tipovalor
        FROM nf_contabil c
        LEFT JOIN situacao_nf s ON s.idsituacao_nf = c.idsituacao_nf
        LEFT JOIN plc p         ON p.codplc = c.codcc
       WHERE c.codnf = ${codnf}
       ORDER BY c.codcontabilnf`.execute(db)).rows.map((l) => ({ ...l, valor: r2(num(l.valor)) }));
    return { linhas, total: r2(linhas.reduce((s, l) => s + num(l.valor), 0)), totalnf: r2(num(n.totalnf)) };
  }

  /**
   * F6 — os lançamentos pelos centros de custo da situação (o `InserirCentroDeCustosDefinidos` da tela de lançamentos, o mesmo rateio que a
   * NF grava ao salvar): a transferência da produção usa a situação 15 "TRANSFERENCIAS - ENTRADAS", com um centro de custo — as 117
   * entradas processadas de 2025-26 têm uma linha com o total da nota
   */
  async preencherLancamentos(codnf: number): Promise<{ linhas: Array<Record<string, unknown>>; total: number; totalnf: number }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const n = await this.nota(db, codnf);
    if (String(n.proc) === 'S') throw new BusinessRuleError('NF_PROCESSADA', { codnf });
    await this.naLojaDaNota(Number(n.idempresa), () => (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      await preencherRateioContabil(trx, codnf, Number(n.idempresa));
    }));
    return this.lancamentos(codnf);
  }

  /** as opções da tela de processar (o TfrmEstoqueNF) da nota, na loja dela */
  async opcoes(codnf: number): Promise<Record<string, unknown>> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const n = await this.nota(db, codnf);
    return this.naLojaDaNota(Number(n.idempresa), () => this.proc.opcoesDoProcessar(codnf));
  }

  /**
   * PROCESSAR (`ProcessarNotaFiscal`, :1038-1112): "A nota selecionada já processada!"; as travas desta janela — a situação obrigatória
   * (`VerificaSituacaoDeDoc` :166, quando há situação cadastrada), o pedido NÃO LIBERADO (`VerificaPedidoCompra` :188) e os lançamentos
   * contábeis da integração (`ValidaLancContabeisSicom` :858) — e o processamento da NF (as demais travas, o estoque, o preço, o
   * faturamento) na loja da nota, com a LOG no título da janela
   */
  async processar(codnf: number, opcoes: OpcoesProcessarEntrada = {}): Promise<{ codnf: number; proc: 'S' }> {
    const db = this.dbp.forTenantRead() as AnyDB;
    const n = await this.nota(db, codnf);
    if (String(n.proc) === 'S') throw new BusinessRuleError('NF_JA_PROCESSADA', { codnf });
    if (!(num(n.idsituacao_nf) > 0) && (await sql`SELECT 1 FROM situacao_nf LIMIT 1`.execute(db)).rows.length) {
      throw new BusinessRuleError('NF_RAPIDO_SEM_SITUACAO', { codnf });
    }
    if (num(n.codpedcomp) > 0 && String(n.status_pedcomp ?? '') === 'NAO LIBERADO') {
      throw new BusinessRuleError('NF_RAPIDO_PEDIDO_NAO_LIBERADO', { codpedcomp: Number(n.codpedcomp) },
        `A nota não será processada, pois o pedido nro. ${Number(n.codpedcomp)} não foi liberado. Verifique antes de prosseguir.`);
    }
    await this.validarLancamentosContabeis(db, n);
    await this.naLojaDaNota(Number(n.idempresa), () => this.proc.processar(codnf, { ...opcoes, formularioLog: FORM_PROCESSAMENTO_RAPIDO }));
    return { codnf, proc: 'S' };
  }

  /** `ValidaLancContabeisSicom` (:858-945): com a integração, lançamentos sem valor zerado, somando o total, e cobrindo a situação de cada item */
  private async validarLancamentosContabeis(db: AnyDB, n: Record<string, any>): Promise<void> {
    const op = currentTenant().operadorId ?? null;
    const integra = String((await configNaTrx(db, 'UTILIZA_INTEGRACAO_CONTABIL', { empresaId: Number(n.idempresa), operadorId: op, modulo: 'Retaguarda' })) ?? '').toUpperCase() === 'S';
    if (!integra) return;
    const linhas = (await db.selectFrom('nf_contabil').select(['valor', 'idsituacao_nf']).where('codnf', '=', Number(n.codnf)).execute()) as Array<{ valor: unknown; idsituacao_nf: unknown }>;
    if (!linhas.length) throw new BusinessRuleError('NF_RAPIDO_SEM_LANCAMENTOS', { codnf: Number(n.codnf) });
    if (linhas.some((l) => num(l.valor) === 0)) throw new BusinessRuleError('NF_RAPIDO_LANCAMENTO_ZERADO', { codnf: Number(n.codnf) });
    const total = r2(linhas.reduce((s, l) => s + num(l.valor), 0));
    if (total !== r2(num(n.totalnf))) throw new BusinessRuleError('NF_RAPIDO_LANCAMENTOS_DIFEREM', { total, totalnf: r2(num(n.totalnf)) });
    const situacoes = new Set(linhas.map((l) => num(l.idsituacao_nf)));
    const item = (await db.selectFrom('nf_prod').select(['nroitem', 'codproduto', 'descricao', 'idsituacao_nf']).where('codnf', '=', Number(n.codnf))
      .orderBy('codnfprod').execute() as Array<Record<string, unknown>>).find((i) => !situacoes.has(num(i.idsituacao_nf)));
    if (item) {
      const prod = `${String(item.nroitem ?? '')} - ${String(item.codproduto ?? '')} ${String(item.descricao ?? '').slice(0, 20)}`;
      throw new BusinessRuleError('NF_RAPIDO_ITEM_SEM_LANCAMENTO', { item: prod },
        `O produto [${prod}] possui situação de NF não informado nos lançamentos contábeis. Verifique.`);
    }
  }
}
