import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { createHash, createSign } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import * as https from 'node:https';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { ConfigService } from '../cadastro/config.service';

type AnyDB = Kysely<any>;

/** eventos de manifestação do destinatário (leiaute nacional) */
export const EVENTOS_MANIFESTO: Record<string, { tipo: number; desc: string; exigeJust: boolean }> = {
  CIENCIA: { tipo: 210210, desc: 'Ciencia da Operacao', exigeJust: false },
  CONFIRMACAO: { tipo: 210200, desc: 'Confirmacao da Operacao', exigeJust: false },
  DESCONHECIMENTO: { tipo: 210220, desc: 'Desconhecimento da Operacao', exigeJust: false },
  OPERACAO_NAO_REALIZADA: { tipo: 210240, desc: 'Operacao nao Realizada', exigeJust: true },
};

/** endpoints do AMBIENTE NACIONAL (a distribuição e a manifestação são sempre no AN, não na SEFAZ da UF) */
const URLS = {
  dist: {
    '1': 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
    '2': 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
  },
  evento: {
    '1': 'https://www1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
    '2': 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  },
};

const tag = (xml: string, nome: string): string | null => {
  const m = xml.match(new RegExp(`<${nome}[^>]*>([\\s\\S]*?)</${nome}>`));
  return m ? m[1].trim() : null;
};

/**
 * MANIFESTO DO DFe — corte 2: a INTEGRAÇÃO SEFAZ que faltava (no legado é o ACBr; aqui é HTTP+XML nativos).
 *
 *  · `sincronizar()` — NFeDistribuicaoDFe no Ambiente Nacional: consulta por ULTIMO_NSU (o cursor vive em
 *    EMPRESAS.ULTIMO_NSU, exatamente como no legado), descompacta os docZip (gzip+base64) e alimenta o
 *    domínio local do corte 1: resNFe/procNFe → nfe_nao_cadastradas (+XML completo em nfe_xml),
 *    resEvento/procEventoNFe → nfe_eventos. A consulta NÃO é assinada — basta o TLS mútuo com o .pfx.
 *  · `manifestar()` — envia o evento (210200/210210/210220/210240) ao NFeRecepcaoEvento4 do AN. O evento
 *    EXIGE assinatura XML-DSig: geramos o XML numa forma já canônica (controlamos cada byte) e assinamos
 *    com a chave do certificado em PEM via crypto nativo (RSA-SHA1, o perfil da NF-e). Autorizado
 *    (cStat 135/136) → grava em NFE_EVENTOS com o protocolo — o que o corte 1 exibe.
 *  · `processarDocs()` é PURA (recebe os XMLs já descompactados) — testada sem rede.
 *
 * O que o OPERADOR precisa configurar (o serviço explica o que falta em vez de falhar mudo):
 *  · CERTIFICADO_A1_ARQUIVO (.pfx p/ sincronizar; .pem p/ manifestar) + CERTIFICADO_A1_SENHA (config 905/906)
 *  · EMPRESAS.AMBIENTE (1=produção/2=homologação — já existia, mig 032)
 */
@Injectable()
export class SefazDfeService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly config: ConfigService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private async credenciais(emp: number, precisaPem: boolean) {
    const arq = String((await this.config.resolver('CERTIFICADO_A1_ARQUIVO', { empresaId: emp })) ?? '').trim();
    const senha = String((await this.config.resolver('CERTIFICADO_A1_SENHA', { empresaId: emp })) ?? '');
    if (!arq) {
      throw new BusinessRuleError('CERTIFICADO_NAO_CONFIGURADO', {
        instrucao: 'Configure CERTIFICADO_A1_ARQUIVO (caminho do .pfx no servidor) e CERTIFICADO_A1_SENHA na tela de Configurações, escopo da empresa.',
      });
    }
    let conteudo: Buffer;
    try { conteudo = readFileSync(arq); } catch {
      throw new BusinessRuleError('CERTIFICADO_ILEGIVEL', { arquivo: arq });
    }
    const ehPem = arq.toLowerCase().endsWith('.pem') || conteudo.subarray(0, 40).toString('utf8').includes('-----BEGIN');
    if (precisaPem && !ehPem) {
      throw new BusinessRuleError('CERTIFICADO_PEM_NECESSARIO', {
        instrucao: 'A manifestação exige a chave em PEM. Converta uma vez: openssl pkcs12 -in certificado.pfx -out certificado.pem -nodes — e aponte CERTIFICADO_A1_ARQUIVO para o .pem.',
      });
    }
    return { conteudo, senha, ehPem };
  }

  private async contexto(emp: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const e = await db.selectFrom('empresas')
      .select(['idempresa', 'cnpj', 'uf', 'ambiente', 'ultimo_nsu'])
      .where('idempresa', '=', emp).executeTakeFirst();
    if (!e) throw new BusinessRuleError('EMPRESA_NAO_ENCONTRADA');
    const amb = String(e.ambiente ?? '2') === '1' ? '1' : '2';
    const cnpj = String(e.cnpj ?? '').replace(/\D/g, '');
    if (cnpj.length !== 14) throw new BusinessRuleError('CNPJ_EMPRESA_INVALIDO', { cnpj: e.cnpj });
    return { ...e, amb, cnpj };
  }

  private agent(cred: { conteudo: Buffer; senha: string; ehPem: boolean }) {
    return cred.ehPem
      ? new https.Agent({ key: cred.conteudo, cert: cred.conteudo })
      : new https.Agent({ pfx: cred.conteudo, passphrase: cred.senha });
  }

  private soap(url: string, action: string, corpo: string, agent: https.Agent): Promise<string> {
    const envelope = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>${corpo}</soap12:Body></soap12:Envelope>`;
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method: 'POST', agent, timeout: 60000,
        headers: { 'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"` },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('SEFAZ_TIMEOUT')); });
      req.end(envelope);
    });
  }

  /**
   * Processa os DOCUMENTOS já descompactados de um lote da distribuição (PURA — o smoke/unit testa isto).
   * schema: resNFe (resumo) · procNFe (nota completa) · resEvento/procEventoNFe (evento).
   */
  async processarDocs(emp: number, docs: { nsu: string; schema: string; xml: string }[]) {
    const db = this.dbp.forTenant() as AnyDB;
    let resumos = 0; let completas = 0; let eventos = 0;
    for (const d of docs) {
      if (d.schema.startsWith('resNFe')) {
        const chave = tag(d.xml, 'chNFe') ?? '';
        if (!chave) continue;
        await db.insertInto('nfe_nao_cadastradas').values({
          // PK do legado é digitado/sequencial no Oracle; aqui derivamos do NSU (estável e único por lote)
          codnfe_naocad: Number(d.nsu) || null,
          chavenfe: chave,
          cnpj: tag(d.xml, 'CNPJ'), razao: tag(d.xml, 'xNome'), ie: tag(d.xml, 'IE'),
          dtemissao: tag(d.xml, 'dhEmi'), totalnf: Number(tag(d.xml, 'vNF') ?? 0),
          situacao: Number(tag(d.xml, 'cSitNFe') ?? 1),
          idempresa: emp, modelo: 55, tipo: 'E',
          dtconsulta: sql`now()`, xml_resumido: d.xml,
          protocolo: tag(d.xml, 'nProt'),
        }).onConflict((oc) => oc.column('chavenfe').doNothing()).execute();
        resumos++;
      } else if (d.schema.startsWith('procNFe')) {
        const chave = tag(d.xml, 'chNFe') ?? (d.xml.match(/Id="NFe(\d{44})"/)?.[1] ?? '');
        if (!chave) continue;
        await db.insertInto('nfe_xml').values({ chavenfe: chave, xml: d.xml, modelo: 55, dtcadastro: sql`now()` }).execute();
        // garante a linha da fila mesmo quando o AN manda a completa sem o resumo antes
        await db.insertInto('nfe_nao_cadastradas').values({
          codnfe_naocad: Number(d.nsu) || null, chavenfe: chave,
          cnpj: tag(d.xml, 'CNPJ'), razao: tag(d.xml, 'xNome'),
          dtemissao: tag(d.xml, 'dhEmi'), totalnf: Number(tag(d.xml, 'vNF') ?? 0),
          situacao: 1, idempresa: emp, modelo: 55, tipo: 'E', dtconsulta: sql`now()`,
          protocolo: tag(d.xml, 'nProt'),
        }).onConflict((oc) => oc.column('chavenfe').doNothing()).execute();
        completas++;
      } else if (d.schema.startsWith('resEvento') || d.schema.startsWith('procEventoNFe')) {
        await db.insertInto('nfe_eventos').values({
          orgao_recepcao: tag(d.xml, 'cOrgao'), ambiente: tag(d.xml, 'tpAmb'),
          chave_acesso: tag(d.xml, 'chNFe'),
          cnpj_cpf_autor_evento: tag(d.xml, 'CNPJ') ?? tag(d.xml, 'CPF'),
          data_evento: tag(d.xml, 'dhEvento'),
          tipo_evento: Number(tag(d.xml, 'tpEvento') ?? 0),
          seq_evento: Number(tag(d.xml, 'nSeqEvento') ?? 1),
          descricao_evento: tag(d.xml, 'xEvento') ?? tag(d.xml, 'descEvento'),
          protocolo_autorizacao: tag(d.xml, 'nProt'),
          data_autorizacao: tag(d.xml, 'dhRecbto'),
          xml: d.xml,
        }).execute();
        eventos++;
      }
    }
    return { resumos, completas, eventos };
  }

  /** distribuição DF-e: consulta por último NSU, processa e avança o cursor. */
  async sincronizar() {
    const emp = this.emp();
    const cred = await this.credenciais(emp, false);
    const ctx = await this.contexto(emp);
    const agent = this.agent(cred);
    const db = this.dbp.forTenant() as AnyDB;
    let ultNsu = String(ctx.ultimo_nsu ?? '0').padStart(15, '0');
    let lotes = 0; const tot = { resumos: 0, completas: 0, eventos: 0 };

    // o AN devolve até 50 docs por lote; segue enquanto houver (ultNSU < maxNSU), com teto de segurança
    while (lotes < 20) {
      const corpo = `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>`
        + `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>${ctx.amb}</tpAmb>`
        + `<cUFAutor>${ctx.uf === 'GO' ? '52' : '31'}</cUFAutor><CNPJ>${ctx.cnpj}</CNPJ>`
        + `<distNSU><ultNSU>${ultNsu}</ultNSU></distNSU></distDFeInt></nfeDadosMsg></nfeDistDFeInteresse>`;
      const resp = await this.soap(URLS.dist[ctx.amb as '1' | '2'], 'nfeDistDFeInteresse', corpo, agent);
      const cStat = tag(resp, 'cStat');
      if (cStat === '137') break; // nenhum documento localizado
      if (cStat !== '138') throw new BusinessRuleError('SEFAZ_REJEITOU', { cStat, xMotivo: tag(resp, 'xMotivo') });
      // extrai os docZip (base64+gzip) com schema e NSU
      const docs: { nsu: string; schema: string; xml: string }[] = [];
      for (const m of resp.matchAll(/<docZip NSU="(\d+)" schema="([^"]+)">([^<]+)<\/docZip>/g)) {
        docs.push({ nsu: m[1], schema: m[2], xml: gunzipSync(Buffer.from(m[3], 'base64')).toString('utf8') });
      }
      const r = await this.processarDocs(emp, docs);
      tot.resumos += r.resumos; tot.completas += r.completas; tot.eventos += r.eventos;
      const novoUlt = tag(resp, 'ultNSU') ?? ultNsu;
      const maxNsu = tag(resp, 'maxNSU') ?? novoUlt;
      await db.updateTable('empresas').set({ ultimo_nsu: novoUlt }).where('idempresa', '=', emp).execute();
      lotes++;
      if (Number(novoUlt) >= Number(maxNsu)) { ultNsu = novoUlt; break; }
      ultNsu = novoUlt;
    }
    return { ok: true, lotes, ...tot, ultimo_nsu: ultNsu };
  }

  /** assinatura XML-DSig enveloped do infEvento (RSA-SHA1, perfil NF-e) — XML gerado já canônico. */
  private assinar(xmlInfEvento: string, id: string, pem: Buffer) {
    const digest = createHash('sha1').update(xmlInfEvento, 'utf8').digest('base64');
    const signedInfo = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">`
      + `<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod>`
      + `<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod>`
      + `<Reference URI="#${id}">`
      + `<Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>`
      + `<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform></Transforms>`
      + `<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod>`
      + `<DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
    const signer = createSign('RSA-SHA1');
    signer.update(signedInfo, 'utf8');
    const assinatura = signer.sign(pem, 'base64');
    const certB64 = pem.toString('utf8').match(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/)?.[1].replace(/\s/g, '') ?? '';
    return `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfo}`
      + `<SignatureValue>${assinatura}</SignatureValue>`
      + `<KeyInfo><X509Data><X509Certificate>${certB64}</X509Certificate></X509Data></KeyInfo></Signature>`;
  }

  /** envia o evento de manifestação ao AN e grava o resultado autorizado em NFE_EVENTOS. */
  async manifestar(chave: string, evento: keyof typeof EVENTOS_MANIFESTO, justificativa?: string) {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const ev = EVENTOS_MANIFESTO[evento];
    if (!ev) throw new BusinessRuleError('EVENTO_INVALIDO', { evento });
    if (ev.exigeJust && !(justificativa ?? '').trim()) throw new BusinessRuleError('JUSTIFICATIVA_OBRIGATORIA');
    const ch = chave.replace(/\D/g, '');
    if (ch.length !== 44) throw new BusinessRuleError('CHAVE_INVALIDA', { chave });
    const cred = await this.credenciais(emp, true);
    const ctx = await this.contexto(emp);
    const db = this.dbp.forTenant() as AnyDB;

    // sequência do evento = quantos do MESMO tipo já existem p/ a chave + 1 (o legado numera assim)
    const seqRow = await db.selectFrom('nfe_eventos')
      .select(sql`coalesce(max(seq_evento),0) + 1`.as('seq'))
      .where('chave_acesso', '=', ch).where('tipo_evento', '=', ev.tipo).executeTakeFirst();
    const seq = Number(seqRow?.seq ?? 1);
    const id = `ID${ev.tipo}${ch}${String(seq).padStart(2, '0')}`;
    const dh = new Date().toISOString().replace(/\.\d{3}Z$/, '-00:00');
    const det = `<detEvento versao="1.00"><descEvento>${ev.desc}</descEvento>`
      + (ev.exigeJust ? `<xJust>${(justificativa ?? '').trim().slice(0, 255)}</xJust>` : '')
      + `</detEvento>`;
    const infEvento = `<infEvento Id="${id}"><cOrgao>91</cOrgao><tpAmb>${ctx.amb}</tpAmb><CNPJ>${ctx.cnpj}</CNPJ>`
      + `<chNFe>${ch}</chNFe><dhEvento>${dh}</dhEvento><tpEvento>${ev.tipo}</tpEvento>`
      + `<nSeqEvento>${seq}</nSeqEvento><verEvento>1.00</verEvento>${det}</infEvento>`;
    // o digest é sobre o infEvento COM o namespace herdado (forma canônica) — geramos exatamente assim
    const infC14n = infEvento.replace('<infEvento ', '<infEvento xmlns="http://www.portalfiscal.inf.br/nfe" ');
    const sig = this.assinar(infC14n, id, cred.conteudo);
    const envEvento = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote>`
      + `<evento versao="1.00">${infEvento}${sig}</evento></envEvento>`;
    const corpo = `<nfeRecepcaoEvento xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><nfeDadosMsg>${envEvento}</nfeDadosMsg></nfeRecepcaoEvento>`;

    const resp = await this.soap(URLS.evento[ctx.amb as '1' | '2'], 'nfeRecepcaoEvento', corpo, this.agent(cred));
    const cStat = tag(resp.match(/<infEvento[\s\S]*?<\/infEvento>/)?.[0] ?? resp, 'cStat') ?? tag(resp, 'cStat');
    if (cStat !== '135' && cStat !== '136') {
      throw new BusinessRuleError('MANIFESTACAO_REJEITADA', { cStat, xMotivo: tag(resp, 'xMotivo') });
    }
    await db.insertInto('nfe_eventos').values({
      orgao_recepcao: '91', ambiente: ctx.amb, chave_acesso: ch, id_evento: id,
      cnpj_cpf_autor_evento: ctx.cnpj, data_evento: dh, tipo_evento: ev.tipo, seq_evento: seq,
      descricao_evento: ev.desc, mensagem_autorizacao: tag(resp, 'xMotivo'),
      protocolo_autorizacao: tag(resp, 'nProt'), data_autorizacao: tag(resp, 'dhRegEvento'),
      codoperador: op, just_op_nao_realizada: ev.exigeJust ? justificativa : null, xml: envEvento,
    }).execute();
    return { ok: true, tipo_evento: ev.tipo, seq_evento: seq, protocolo: tag(resp, 'nProt'), cStat };
  }
}
