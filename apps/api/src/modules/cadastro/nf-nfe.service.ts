import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { SEFAZ_PORT, type SefazPort } from './sefaz/sefaz.port';

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
 *    PROTOCOLO_CANCELAMENTO + CANCELADA='S' + XJUST. **NÃO reverte estoque/financeiro/contábil**
 *    (NFe.pas:254-297 — cancelar é puramente fiscal/SEFAZ). Invariante provada no smoke.
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
  ) {}

  /** transmite a NFe (mod.55) à SEFAZ (via porta) e persiste chave/protocolo/status. */
  async transmitir(codnf: number) {
    const t = currentTenant();
    const emp = t.empresaId ?? null;
    const op = t.operadorId ?? null;
    if (emp == null) throw new BusinessRuleError('TENANT_FORBIDDEN');

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = await trx
        .selectFrom('nf')
        .select(['codnf', 'tipo', 'modelo', 'nronf', 'serie', 'dtemissao', 'codparceiro', 'totalnf', 'proc', 'statusnfe', 'cancelada', 'tpemissao'])
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });

      // pré-condições (fiéis ao legado — não inventar proc='S').
      if (Number(nf.modelo) !== 55) throw new BusinessRuleError('NF_MODELO_INVALIDO_PARA_TRANSMISSAO', { codnf });
      if (nf.cancelada === 'S' || nf.statusnfe === 'C') throw new BusinessRuleError('NF_CANCELADA', { codnf });
      if (nf.statusnfe === 'P') throw new BusinessRuleError('NF_JA_TRANSMITIDA', { codnf });
      if (nf.statusnfe === 'D') throw new BusinessRuleError('NF_DENEGADA', { codnf });
      if (nf.nronf == null || String(nf.nronf).trim() === '') throw new BusinessRuleError('NF_SEM_NUMERO', { codnf });
      // nNF entra na chave com 9 dígitos: número maior não cabe (evita chave truncada silenciosa).
      if (String(nf.nronf).replace(/\D/g, '').length > 9) throw new BusinessRuleError('NF_CHAVE_INVALIDA', { codnf, nronf: nf.nronf });
      if (nf.codparceiro == null) throw new BusinessRuleError('NF_SEM_DESTINATARIO', { codnf });
      if (num(nf.totalnf) <= 0) throw new BusinessRuleError('NF_SEM_VALOR', { codnf });

      const itens = await trx.selectFrom('nf_prod').select('codnfprod').where('codnf', '=', codnf).limit(1).execute();
      if (itens.length === 0) throw new BusinessRuleError('NF_SEM_ITENS', { codnf });

      const ef = await trx
        .selectFrom('empresa_fiscal')
        .select(['cnpj', 'uf', 'cuf', 'serie_nfe', 'ambiente'])
        .where('idempresa', '=', emp)
        .executeTakeFirst();
      if (!ef || !ef.cnpj || ef.cuf == null) throw new BusinessRuleError('EMPRESA_FISCAL_NAO_CONFIGURADA', { idempresa: emp });

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
      });

      // flip de estado com compare-and-set (idempotente: só transmite se ainda não enviada).
      const r = await trx
        .updateTable('nf')
        .set({
          chavenfe: res.chave,
          protocolo_nfe: res.protocolo,
          statusnfe: res.status, // 'P' autorizada / 'D' denegada
          confirmada: res.status === 'P' ? 'S' : 'N',
          tpemissao: num(nf.tpemissao) || 1,
          sequencia_nfe: 1,
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
        .select(['codnf', 'chavenfe', 'protocolo_nfe', 'statusnfe', 'cancelada'])
        .where('codnf', '=', codnf)
        .where('idempresa', '=', emp)
        .forUpdate()
        .executeTakeFirst();
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
      if (nf.cancelada === 'S' || nf.statusnfe === 'C') throw new BusinessRuleError('NF_CANCELADA', { codnf });
      if (nf.statusnfe !== 'P') throw new BusinessRuleError('NF_NAO_AUTORIZADA', { codnf });

      // fail-closed igual ao transmitir: o evento precisa do CNPJ/ambiente reais (não montar
      // com CNPJ vazio / ambiente assumido — fatal com o provider real).
      const ef = await trx.selectFrom('empresa_fiscal').select(['cnpj', 'ambiente']).where('idempresa', '=', emp).executeTakeFirst();
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

      await trx
        .insertInto('nfe_evento')
        .values({
          codnf,
          idempresa: emp,
          chavenfe: nf.chavenfe,
          tipo_evento: 110111, // cancelamento
          seq_evento: 1,
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

      return { codnf, statusnfe: 'C', protocolo: res.protocolo, cstat: res.cstat, simulado: res.simulado };
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

      const ef = await trx.selectFrom('empresa_fiscal').select(['cnpj', 'ambiente']).where('idempresa', '=', emp).executeTakeFirst();
      if (!ef?.cnpj) throw new BusinessRuleError('EMPRESA_FISCAL_NAO_CONFIGURADA', { idempresa: emp });

      const res = await this.sefaz.cartaCorrecao({
        codnf,
        chavenfe: nf.chavenfe,
        cnpj: ef.cnpj,
        ambiente: ef.ambiente ?? '2',
        texto: correcao,
        seq,
      });

      await trx
        .insertInto('nfe_evento')
        .values({
          codnf,
          idempresa: emp,
          chavenfe: nf.chavenfe,
          tipo_evento: 110110, // carta de correção
          seq_evento: seq,
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
