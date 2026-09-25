import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { dataHoraLegado, gravarLog } from '../../shared/log/registro-log';
import { SEFAZ_PORT, type SefazPort } from './sefaz/sefaz.port';
import { NfProcessamentoService } from './nf-processamento.service';
import { NfFaturamentoService } from './nf-faturamento.service';
import { NfContabilizacaoService } from './nf-contabilizacao.service';
import { ConfigService } from './config.service';
import { InventarioRotativoService } from './inventario-rotativo.service';
import { estornarVinculoScrap } from './nf-scrap.service';
import { estornarVinculoVendas } from './nf-vendas.service';

type AnyDB = any;
const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/**
 * NF — Fase 6: NFe modelo 55 (transmissão / cancelamento / carta de correção).
 *
 * Reusa o padrão stateful das F3/F4 (transação + forUpdate + compare-and-set + currentTenant +
 * BusinessRuleError→422), porém a parte EXTERNA (falar com a SEFAZ) é delegada à `SefazPort`
 * (no corte 1 = `SimuladorSefazProvider`, homologação). Aqui vivem a máquina de estados
 * (STATUSNFE ''→P / P→C), a persistência da chave/protocolo, e a auditoria (nfe_xml/nfe_evento/
 * historico_envio_nfe). Doc: dossiê uNF.md §3/§8.
 *
 * Fidelidade ao legado (NFe.pas):
 *  - estados ''(rascunho)/P(autorizada)/C(cancelada)/D(denegada); mapeamento cStat→status na porta.
 *  - cancelamento exige NFe autorizada e justificativa ≥15 (schema); grava STATUSNFE='C' +
 *    PROTOCOLO_CANCELAMENTO + CANCELADA='S' + XJUST. Efeitos do botão real da retaguarda
 *    (TfrmNF.CancelarNFE, uNF.pas:6773), na MESMA transação: ESTOQUE estornado se proc='S'
 *    (golden, net-0 no kardex); FINANCEIRO via CancelaFaturamento (uNF:6668) GATED por
 *    ESTORNA_FINANCEIRO_NF (default 'N' NÃO deleta — fiel; 'S' exclui títulos, best-effort se
 *    quitado). CONTÁBIL: se CONTABILIZADO='S', estorna o DIÁRIO (F5b, TIntegracaoContabil.Estornar,
 *    uNF:6808) na mesma transação.
 *  - CCe exige NFe autorizada, texto ≥15 (schema), MÁX 20/nota (NFe.pas:332), nSeqEvento=MAX+1.
 *
 * Idempotência: o flip de STATUSNFE usa CAS (`WHERE statusnfe IS NULL` / `='P'`) → transmitir/
 * cancelar 2× não duplica nem corrompe o estado.
 */
@Injectable()
export class NfNfeService {
  constructor(
    private readonly dbp: DatabaseProvider,
    @Inject(SEFAZ_PORT) private readonly sefaz: SefazPort,
    private readonly proc: NfProcessamentoService,
    private readonly fat: NfFaturamentoService,
    private readonly contab: NfContabilizacaoService,
    private readonly config: ConfigService,
    private readonly invRotativo: InventarioRotativoService,
  ) {}

  /** transmite a NFe (mod.55) à SEFAZ (via porta) e persiste chave/protocolo/status. */
  /**
   * o código numérico da chave (cNF, NF.CODNOTAFISCAL) — `EnviarNFe`, NFe.pas:810-846: a nota que ainda não tem ganha um aleatório
   * `random(99999999)` que não seja uma das sequências proibidas (00000000, 11111111 … 99999999, 12345678, 23456789 … 01234567), nem o
   * nNF, nem o código de outra nota de emissão própria; e ele é gravado ANTES do envio — a nota que não chegou a ser autorizada guarda o
   * seu (19 das 38 sem chave em 2026) e a retransmissão sai com a mesma chave. Na produção, 747 de 747 chaves têm o CODNOTAFISCAL nas
   * posições 36-43.
   */
  private async codigoNumericoDaChave(codnf: number, emp: number): Promise<number | undefined> {
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = (await trx.selectFrom('nf').select(['codnotafiscal', 'nronf', 'modelo', 'tipoemissao', 'proc', 'statusnfe', 'cancelada']).where('codnf', '=', codnf)
        .where('idempresa', '=', emp).forUpdate().executeTakeFirst()) as Record<string, unknown> | undefined;
      // só a nota que vai de fato ao envio (as pré-condições do transmitir, que recusa as outras com o erro dele)
      if (!nf || Number(nf.modelo) !== 55 || String(nf.tipoemissao) === '1' || nf.proc !== 'S' || nf.cancelada === 'S' || ['P', 'D', 'C'].includes(String(nf.statusnfe ?? ''))) {
        return undefined;
      }
      if (num(nf.codnotafiscal) > 0) return num(nf.codnotafiscal);
      const proibidos = new Set([0, 11111111, 22222222, 33333333, 44444444, 55555555, 66666666, 77777777, 88888888, 99999999, 12345678, 23456789,
        34567890, 45678901, 56789012, 67890123, 78901234, 89012345, 90123456, 1234567]);
      const nnf = Number(String(nf.nronf ?? '').replace(/\D/g, '')) || -1;
      for (;;) {
        const c = Math.floor(Math.random() * 99999999);
        if (proibidos.has(c) || c === nnf) continue;
        const existe = await trx.selectFrom('nf').select('codnf').where('codnotafiscal', '=', c).where('tipoemissao', '=', '0').executeTakeFirst();
        if (existe) continue;
        await trx.updateTable('nf').set({ codnotafiscal: c }).where('codnf', '=', codnf).execute();
        return c;
      }
    });
  }

  async transmitir(codnf: number) {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    const cnf = await this.codigoNumericoDaChave(codnf, emp);

    const resultado = await (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = await trx
        .selectFrom('nf')
        .select(['codnf', 'tipo', 'tipoemissao', 'modelo', 'nronf', 'serie', 'dtemissao', 'codparceiro', 'totalnf', 'proc', 'statusnfe', 'cancelada', 'tpemissao', 'obs', 'finalidade'])
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });

      // pré-condições (fiéis ao legado).
      if (Number(nf.modelo) !== 55) throw new BusinessRuleError('NF_MODELO_INVALIDO_PARA_TRANSMISSAO', { codnf });
      // terceiros (TIPOEMISSAO='1') não podem ser transmitidos — uNF.pas:10761 (EnviarNFE aborta).
      if (String(nf.tipoemissao) === '1') throw new BusinessRuleError('NF_TERCEIROS_NAO_TRANSMITE', { codnf });
      if (nf.cancelada === 'S' || nf.statusnfe === 'C') throw new BusinessRuleError('NF_CANCELADA', { codnf });
      if (nf.statusnfe === 'P') throw new BusinessRuleError('NF_JA_TRANSMITIDA', { codnf });
      if (nf.statusnfe === 'D') throw new BusinessRuleError('NF_DENEGADA', { codnf });
      // o botão Transmitir do legado só habilita com a nota PROCESSADA (uNF.pas:8273: PROC='S').
      if (nf.proc !== 'S') throw new BusinessRuleError('NF_NAO_PROCESSADA', { codnf });
      if (nf.nronf == null || String(nf.nronf).trim() === '') throw new BusinessRuleError('NF_SEM_NUMERO', { codnf });
      // nNF entra na chave com 9 dígitos: número maior não cabe (evita chave truncada silenciosa).
      if (String(nf.nronf).replace(/\D/g, '').length > 9) throw new BusinessRuleError('NF_CHAVE_INVALIDA', { codnf, nronf: nf.nronf });
      if (nf.codparceiro == null) throw new BusinessRuleError('NF_SEM_DESTINATARIO', { codnf });
      if (num(nf.totalnf) <= 0) throw new BusinessRuleError('NF_SEM_VALOR', { codnf });

      const itens = await trx.selectFrom('nf_prod').select('codnfprod').where('codnf', '=', codnf).limit(1).execute();
      if (itens.length === 0) throw new BusinessRuleError('NF_SEM_ITENS', { codnf });

      const ef = await trx
        .selectFrom('empresas')
        .select(['cnpj', 'uf', 'cuf', 'serie_nfe', 'ambiente'])
        .where('idempresa', '=', emp)
        .executeTakeFirst();
      if (!ef || !ef.cnpj || ef.cuf == null) throw new BusinessRuleError('EMPRESA_FISCAL_NAO_CONFIGURADA', { idempresa: emp });

      // ⚠️ os grupos da reforma vão JUNTO com a transmissão (mig 283). Sem isto o provider real emitiria a
      // nota sem IBS/CBS/IS e a SEFAZ rejeitaria — o cálculo dos cortes 2-4 parava no banco.
      const grupoCab = (await sql<Record<string, unknown>>`
          SELECT vbcibscbs, vibsuf, vibsmun, vibs, vcbs, vis FROM nf_ibscbs
           WHERE codnf = ${codnf} AND idempresa = ${emp}`.execute(trx)).rows[0];
      const grupoItens = grupoCab
        ? (await sql<Record<string, unknown>>`
            SELECT p.nroitem, g.cst, g.cclasstrib, g.vbc,
                   g.pibsuf, g.paliqefet_ibsuf, g.vibsuf,
                   g.pibsmun, g.paliqefet_ibsmun, g.vibsmun,
                   g.pcbs, g.paliqefet_cbs, g.vcbs,
                   g.vis, g.pis_seletivo, g.tratamento
              FROM nf_prod_ibscbs g
              LEFT JOIN nf_prod p ON p.codnfprod = g.codnfprod
             WHERE g.codnf = ${codnf} AND g.idempresa = ${emp}
             ORDER BY p.nroitem, g.codnfprod`.execute(trx)).rows
        : [];

      // os documentos REFERENCIADOS vão na observação (NFe.pas:960-990): as chaves de NF-e/NFC-e/CT-e (modelos 55/65/57)
      // entram como "Notas Fiscais Ref.: <chaves>. " se ainda não estiverem lá — é o que a NF de cupom da produção
      // mostra (355 de 423 notas autorizadas com referência em 2026). A referência por número (modelo 1/produtor) não
      // tem uso desde 2024 e não é montada aqui.
      const refs = (await sql<{ chave: string | null; modelo: number | null }>`
          SELECT coalesce(r.chavenfe, r.chave_ref) AS chave,
                 coalesce(r.modelo, CASE WHEN length(coalesce(r.chavenfe, r.chave_ref)) = 44 THEN 55 END) AS modelo
            FROM nf_referencia r WHERE r.codnf = ${codnf} ORDER BY r.codnfreferencia`.execute(trx)).rows;
      const chavesRef = refs.filter((r) => r.chave && [55, 57, 65].includes(Number(r.modelo))).map((r) => String(r.chave).trim());
      if (chavesRef.length) {
        const texto = chavesRef.join(',');
        const obsAtual = String(nf.obs ?? '');
        if (!obsAtual.includes(texto)) {
          await trx.updateTable('nf').set({ obs: `${obsAtual}${obsAtual !== '' ? ' ' : ''}Notas Fiscais Ref.: ${texto}. ` })
            .where('codnf', '=', codnf).where('idempresa', '=', emp).execute();
        }
      }

      const res = await this.sefaz.transmitir({
        codnf,
        idempresa: emp,
        modelo: 55,
        serie: nf.serie ?? ef.serie_nfe ?? '1',
        numero: nf.nronf,
        dtemissao: nf.dtemissao,
        cnpj: ef.cnpj,
        cuf: Number(ef.cuf),
        ambiente: ef.ambiente ?? '2',
        tpEmis: num(nf.tpemissao) || 1,
        ...(cnf ? { cnf } : {}),
        ...(grupoCab ? {
          ibscbs: {
            total: {
              vbcibscbs: num(grupoCab.vbcibscbs), vibsuf: num(grupoCab.vibsuf),
              vibsmun: num(grupoCab.vibsmun), vibs: num(grupoCab.vibs),
              vcbs: num(grupoCab.vcbs), vis: num(grupoCab.vis),
            },
            itens: grupoItens.map((g) => ({
              nroitem: g.nroitem == null ? null : Number(g.nroitem),
              cst: (g.cst as string | null) ?? null, cclasstrib: (g.cclasstrib as string | null) ?? null,
              vbc: num(g.vbc),
              pibsuf: num(g.pibsuf), paliqefet_ibsuf: num(g.paliqefet_ibsuf), vibsuf: num(g.vibsuf),
              pibsmun: num(g.pibsmun), paliqefet_ibsmun: num(g.paliqefet_ibsmun), vibsmun: num(g.vibsmun),
              pcbs: num(g.pcbs), paliqefet_cbs: num(g.paliqefet_cbs), vcbs: num(g.vcbs),
              vis: num(g.vis), pis_seletivo: num(g.pis_seletivo),
              tratamento: String(g.tratamento ?? 'calculado'),
            })),
          },
        } : {}),
      });
      // só persiste se a SEFAZ autorizou (P) ou denegou (D) — qualquer outro cStat é rejeição:
      // não flipa o estado (espelha o legado, que só grava em retorno válido). O provider real
      // deve mapear o cStat via statusFromCstat; o Simulador sempre devolve 100→P.
      if (res.status !== 'P' && res.status !== 'D') throw new BusinessRuleError('NF_SEFAZ_ERRO', { codnf, cstat: res.cstat });

      // flip de estado com compare-and-set (idempotente: só transmite se ainda não enviada).
      const r = await trx
        .updateTable('nf')
        .set({
          chavenfe: res.chave,
          protocolo_nfe: res.protocolo,
          statusnfe: res.status, // 'P' autorizada / 'D' denegada
          confirmada: res.status === 'P' ? 'S' : 'N',
          tpemissao: num(nf.tpemissao) || 1,
          sequencia_nfe: 'S', // a flag do legado: numerada na sequência da NF-e (uNF.pas:10863; mig 320)
          usultalteracao: op,
          dtultimalteracao: sql`now()`,
        })
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        // CAS: só transmite se nunca enviada. Tolera '' (cliente pode injetar string vazia no create,
        // pois statusnfe é coluna gravável) além de NULL — ambos = rascunho.
        .where((eb: AnyDB) => eb.or([eb('statusnfe', 'is', null), eb('statusnfe', '=', '')]))
        .executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('NF_JA_TRANSMITIDA', { codnf });
      // denegada: `CancelaFaturamento(…, 'N')` (uNF.pas:16458); a devolução (finalidade 4) autorizada põe os títulos das notas
      // REFERENCIADAS em pendência 'D' (`CancelaFaturamentoNFDevolucao`, uNF.pas:6735-6768 — sempre na tabela A PAGAR)
      if (res.status === 'D') await this.fat.cancelaFaturamentoNaTrx(trx, codnf, String(nf.tipo), 'N', emp, op);
      if (res.status === 'P' && res.protocolo && String(nf.finalidade ?? '') === '4') {
        const refs = (await sql<{ codnf_ref: number }>`SELECT codnf_ref FROM nf_referencia WHERE codnf = ${codnf} AND codnf_ref IS NOT NULL`.execute(trx)).rows;
        for (const r0 of refs) await this.fat.adicionaPendenciaNaTrx(trx, Number(r0.codnf_ref), 'E', 'D');
      }
      // o número da nota nas parcelas e nos títulos dela (`TNFe.UpdateNFE`, NFe.pas:4666-4667 — ExecSQL, sem LOG)
      await sql`UPDATE faturamento SET nronf = ${String(nf.nronf)} WHERE idnf = ${codnf}`.execute(trx);
      await sql`UPDATE apagar SET duplicata = ${String(nf.nronf)} WHERE idnf = ${codnf}`.execute(trx);

      // XML autorizado + auditoria do envio (mesma transação).
      await trx
        .insertInto('nfe_xml')
        .values({
          codnf,
          idempresa: emp,
          chavenfe: res.chave,
          modelo: 55,
          ambiente: res.ambiente,
          xml: res.xml,
          simulado: res.simulado ? 'S' : 'N',
          dtcadastro: sql`now()`,
        })
        .execute();
      await trx
        .insertInto('historico_envio_nfe')
        .values({
          codnf,
          nronf: String(nf.nronf),
          nrolote: null,
          idempresa: emp,
          tipo: res.status === 'P' ? 'S' : 'E',
          chavenfe: res.chave,
          cstat: res.cstat,
          mensagem: res.xMotivo?.slice(0, 255) ?? null, // mensagem é varchar(255) — não estourar
          dtenvio: sql`now()`,
        })
        .execute();

      return {
        codnf,
        chave: res.chave,
        statusnfe: res.status,
        protocolo: res.protocolo,
        cstat: res.cstat,
        ambiente: res.ambiente,
        simulado: res.simulado,
      };
    });

    // AUTO-DISPARO contábil (F5b-fase3): a saída autorizada (statusnfe='P') integra no ENVIO
    // (uNF.pas:10946). Best-effort (fora da transação, como o legado). Entrada já integrou no processar.
    if (resultado.statusnfe === 'P') await this.contab.tentarContabilizar(codnf);
    return resultado;
  }

  /** cancela a NFe autorizada (evento teCancelamento). NÃO toca estoque/financeiro/contábil. */
  async cancelar(codnf: number, xjust: string) {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = await trx
        .selectFrom('nf')
        .select(['codnf', 'tipo', 'chavenfe', 'protocolo_nfe', 'statusnfe', 'cancelada', 'proc', 'contabilizado'])
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
      if (nf.cancelada === 'S' || nf.statusnfe === 'C') throw new BusinessRuleError('NF_CANCELADA', { codnf });
      if (nf.statusnfe !== 'P') throw new BusinessRuleError('NF_NAO_AUTORIZADA', { codnf });

      // fail-closed igual ao transmitir: o evento precisa do CNPJ/ambiente reais (não montar
      // com CNPJ vazio / ambiente assumido — fatal com o provider real).
      const ef = await trx.selectFrom('empresas').select(['cnpj', 'ambiente']).where('idempresa', '=', emp).executeTakeFirst();
      if (!ef?.cnpj) throw new BusinessRuleError('EMPRESA_FISCAL_NAO_CONFIGURADA', { idempresa: emp });

      const res = await this.sefaz.cancelar({
        codnf,
        chavenfe: nf.chavenfe,
        cnpj: ef.cnpj,
        ambiente: ef.ambiente ?? '2',
        texto: xjust,
        seq: 1,
        protocoloNfe: nf.protocolo_nfe ?? undefined,
      });
      // evento só é válido com cStat de sucesso (135 vinculado / 136 registrado) — legado NFe.pas:383.
      if (![135, 136].includes(res.cstat)) throw new BusinessRuleError('NF_SEFAZ_ERRO', { codnf, cstat: res.cstat });

      // flip P→C com CAS (idempotente).
      const r = await trx
        .updateTable('nf')
        .set({
          statusnfe: 'C',
          cancelada: 'S',
          protocolo_cancelamento: res.protocolo,
          xjust,
          usultalteracao: op,
          dtultimalteracao: sql`now()`,
        })
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .where('statusnfe', '=', 'P')
        .executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BusinessRuleError('NF_NAO_AUTORIZADA', { codnf });

      // a LOG do cancelamento (binário novo — fora do fonte de 2020; 39 de 39 notas canceladas em 2025-26 a têm): formulário
      // "Notas fiscais", o NOME do operador, a justificativa no `UpperCase` do Delphi (só a-z: "NãO SERIA ESSE CUPOM"), o " ,em"
      // do legado, texto sem normalizar e sem empresa
      const nomeOp = op != null ? ((await trx.selectFrom('operadores').select('nome').where('codoperador', '=', op).executeTakeFirst()) as { nome?: string } | undefined)?.nome ?? '' : '';
      await gravarLog(trx, {
        acao: 'Alterou', formulario: 'Notas fiscais', tabela: 'NF', chave: 'CODNF', valor: codnf, normalizar: false,
        historico: `Nota fiscal cancelada pelo usuário: ${nomeOp}, com a justificativa: ${xjust.replace(/[a-z]/g, (c) => c.toUpperCase())} ,em ${dataHoraLegado()}`,
      });

      // ESTORNO das pontes do inventário rotativo: cancelar a nota devolve o lote para "não importado"
      // (udmNF.pas:3406-3463 — o legado faz isso no excluir E no cancelar, escolhendo o lado pelo TIPO da
      // nota). Dentro da transação do cancelamento, senão um rollback deixaria o lote solto.
      await this.invRotativo.estornarVinculo(trx, codnf, nf.tipo ?? null, emp);
      // o scrap importado volta a "não importado" (AtualizaStatusScrap taCancelar, udmNF.pas:3217); a PEDIDO_NF fica
      await estornarVinculoScrap(trx, codnf, nf.tipo ?? null, false);
      await estornarVinculoVendas(trx, codnf, nf.tipo ?? null); // os cupons voltam a "não importado" (AtualizaStatusCupomFiscal)

      await trx
        .insertInto('nfe_evento')
        .values({
          codnf,
          idempresa: emp,
          chavenfe: nf.chavenfe,
          tipo_evento: 110111, // cancelamento
          seq_evento: 1,
          // como o legado grava o evento (740 de 740 cancelamentos): o órgão é o UF da chave e o Id é o do leiaute do evento
          // ("ID" + tipo + chave + sequência — o Oracle corta em 17 caracteres, VARCHAR2(17); o destino guarda inteiro)
          orgao_recepcao: nf.chavenfe ? String(nf.chavenfe).slice(0, 2) : null,
          id_evento: nf.chavenfe ? `ID110111${nf.chavenfe}01` : null,
          ambiente: ef.ambiente ?? '2',
          descricao: 'Cancelamento',
          texto: xjust,
          protocolo_autorizacao: res.protocolo,
          ver_aplic: res.verAplic ?? null,
          cstat: res.cstat,
          data_evento: sql`now()`,
          data_autorizacao: sql`now()`,
          xml: res.xml,
          simulado: res.simulado ? 'S' : 'N',
          codoperador: op,
        })
        .execute();

      // golden: cancelar uma NF PROCESSADA estorna o estoque (movimento compensatório, net-0 no
      // kardex). Como o `reverter` é bloqueado em nota enviada à SEFAZ, o estorno do estoque só
      // pode vir daqui. Na MESMA transação do cancelamento (atômico).
      if (nf.proc === 'S') {
        await this.proc.estornarEstoquePorCancelamento(trx, codnf, String(nf.tipo), op, emp);
      }

      // financeiro: `CancelaFaturamento(…, 'C')` (uNF.pas:6802) — sem título nada; com ESTORNA_FINANCEIRO_NF 'N' (a produção) os títulos
      // ficam com a pendência 'C'; com 'S' saem (salvo baixados, que ficam). Mesma transação do cancelamento.
      const financeiro = await this.fat.cancelaFaturamentoNaTrx(trx, codnf, String(nf.tipo), 'C', emp, op);

      // contábil (F5b): cancelar estorna o DIÁRIO se contabilizada (TIntegracaoContabil.Estornar,
      // uNF.pas:6808). Na MESMA transação. Inerte se a NF não foi contabilizada.
      const contabil = nf.contabilizado === 'S';
      if (contabil) await this.contab.estornarNoTrx(trx, codnf, emp, op);

      return { codnf, statusnfe: 'C', protocolo: res.protocolo, cstat: res.cstat, simulado: res.simulado, financeiro, contabil };
    });
  }

  /** carta de correção (evento teCCe): texto ≥15 (schema), máx 20/nota, nSeqEvento=MAX+1. */
  async cartaCorrecao(codnf: number, correcao: string) {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = await trx
        .selectFrom('nf')
        .select(['codnf', 'chavenfe', 'statusnfe', 'cancelada'])
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
      if (nf.cancelada === 'S' || nf.statusnfe === 'C') throw new BusinessRuleError('NF_CANCELADA', { codnf });
      if (nf.statusnfe !== 'P') throw new BusinessRuleError('NF_NAO_AUTORIZADA', { codnf });

      // máx 20 CCe por nota (NFe.pas:332) + nSeqEvento = MAX(seq)+1.
      const ag = await trx
        .selectFrom('nfe_evento')
        .select([sql<number>`count(*)`.as('qtd'), sql<number>`coalesce(max(seq_evento),0)`.as('maxseq')])
        .where('codnf', '=', codnf)
        .where('tipo_evento', '=', 110110)
        .executeTakeFirst();
      if (num(ag?.qtd) >= 20) throw new BusinessRuleError('NF_CCE_LIMITE', { codnf });
      const seq = num(ag?.maxseq) + 1;

      const ef = await trx.selectFrom('empresas').select(['cnpj', 'ambiente']).where('idempresa', '=', emp).executeTakeFirst();
      if (!ef?.cnpj) throw new BusinessRuleError('EMPRESA_FISCAL_NAO_CONFIGURADA', { idempresa: emp });

      const res = await this.sefaz.cartaCorrecao({
        codnf,
        chavenfe: nf.chavenfe,
        cnpj: ef.cnpj,
        ambiente: ef.ambiente ?? '2',
        texto: correcao,
        seq,
      });
      // evento só é válido com cStat de sucesso (135/136) — legado NFe.pas:383.
      if (![135, 136].includes(res.cstat)) throw new BusinessRuleError('NF_SEFAZ_ERRO', { codnf, cstat: res.cstat });

      await trx
        .insertInto('nfe_evento')
        .values({
          codnf,
          idempresa: emp,
          chavenfe: nf.chavenfe,
          tipo_evento: 110110, // carta de correção
          seq_evento: seq,
          orgao_recepcao: nf.chavenfe ? String(nf.chavenfe).slice(0, 2) : null, // (117 de 117 no legado)
          id_evento: nf.chavenfe ? `ID110110${nf.chavenfe}${String(seq).padStart(2, '0')}` : null,
          ambiente: ef.ambiente ?? '2',
          descricao: 'Carta de Correcao',
          texto: correcao,
          protocolo_autorizacao: res.protocolo,
          ver_aplic: res.verAplic ?? null,
          cstat: res.cstat,
          data_evento: sql`now()`,
          data_autorizacao: sql`now()`,
          xml: res.xml,
          simulado: res.simulado ? 'S' : 'N',
          codoperador: op,
        })
        .execute();

      return { codnf, seq, protocolo: res.protocolo, cstat: res.cstat, simulado: res.simulado };
    });
  }
}
