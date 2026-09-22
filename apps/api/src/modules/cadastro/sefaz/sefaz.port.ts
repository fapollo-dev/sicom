/**
 * PORTA SEFAZ (F6) — a fronteira entre o app e a transmissão fiscal eletrônica.
 *
 * Tudo que é GENUINAMENTE EXTERNO (SOAP à SEFAZ no layout ve400, geração + assinatura do XML
 * com certificado A1/A3, validação XSD) fica atrás desta interface. O app NÃO fala SEFAZ direto
 * (decisão de arquitetura — dossiê uNF.md §8); ele chama a porta. No corte 1 da F6 a única
 * implementação é o `SimuladorSefazProvider` (homologação); o provider REAL (ACBrLibNFe / lib
 * NFe Node / microserviço dedicado) pluga nesta mesma interface depois, sem tocar no service.
 *
 * Espelha o padrão de reuso da F2 (a NF chama o motor de `precificacao` a jusante, não o reimplementa).
 */

/** token de injeção da porta (DI). */
export const SEFAZ_PORT = 'SEFAZ_PORT';

/** entrada da transmissão de uma NFe (dados já lidos da NF + empresa_fiscal). */
export interface TransmitirReq {
  codnf: number;
  idempresa: number;
  modelo: number; // 55
  serie: string | number;
  numero: string | number; // nNF (NRONF)
  dtemissao: Date | string;
  cnpj: string;
  cuf: number; // IBGE da UF do emitente
  ambiente: string; // '1' produção / '2' homologação
  tpEmis: number; // 1 normal
  /**
   * ⚠️ OS GRUPOS DA REFORMA (IBS/CBS/IS) — obrigatórios no leiaute da NF-e desde a fase-teste de 2026.
   *
   * O Apollo **não monta o XML** (decisão de arquitetura, dossiê `uNF.md` §8: geração, assinatura e envio
   * ficam atrás desta porta). Mas quem monta precisa receber os grupos, e até aqui o contrato não os
   * levava: o cálculo dos cortes 2 a 4 gravava em `nf_prod_ibscbs`/`nf_ibscbs` e parava ali. Sem este
   * campo, o provider real emitiria a nota **sem os grupos** e a SEFAZ rejeitaria — uma lacuna que só
   * apareceria na primeira transmissão real.
   *
   * Vem opcional porque nota calculada antes dos cortes da reforma não tem grupo, e nesse caso o provider
   * emite como emitia. Quando vem, é o que foi calculado e gravado, não um recálculo na hora de transmitir.
   */
  ibscbs?: {
    total: {
      vbcibscbs: number; vibsuf: number; vibsmun: number; vibs: number; vcbs: number; vis: number;
    };
    /** um por item da nota, na ordem de `nroitem` */
    itens: Array<{
      nroitem: number | null;
      cst: string | null;
      cclasstrib: string | null;
      vbc: number;
      /** alíquota e valor por tributo; as efetivas já trazem a redução aplicada */
      pibsuf: number; paliqefet_ibsuf: number; vibsuf: number;
      pibsmun: number; paliqefet_ibsmun: number; vibsmun: number;
      pcbs: number; paliqefet_cbs: number; vcbs: number;
      /** o seletivo, que INTEGRA a base acima (art. 12 §1º) */
      vis: number; pis_seletivo: number;
      /** por que o item ficou assim: calculado | nao_tributado | monofasico */
      tratamento: string;
    }>;
  };
}

/** resultado da transmissão (mapeado pela porta a partir do cStat da SEFAZ). */
export interface TransmitirRes {
  chave: string; // 44 dígitos
  protocolo: string;
  cstat: number; // 100 autorizada / 110,301,302 denegada / ...
  xMotivo: string;
  status: 'P' | 'D'; // P autorizada / D denegada (GetStatusNFE do legado)
  xml: string;
  ambiente: string;
  simulado: boolean;
}

/** entrada de um evento (cancelamento/CCe). */
export interface EventoReq {
  codnf: number;
  chavenfe: string;
  cnpj: string;
  ambiente: string;
  texto: string; // xJust (cancel) ou xCorrecao (CCe)
  seq: number; // nSeqEvento
  protocoloNfe?: string; // protocolo da NFe (cancelamento referencia nProt)
}

/** resultado de um evento. */
export interface EventoRes {
  protocolo: string;
  cstat: number; // 135/136 sucesso
  xMotivo: string;
  verAplic?: string;
  xml: string;
  simulado: boolean;
}

export interface SefazPort {
  /** transmite a NFe (monta/assina/valida/envia) e devolve chave+protocolo+status. */
  transmitir(req: TransmitirReq): Promise<TransmitirRes>;
  /** evento de cancelamento (teCancelamento). */
  cancelar(req: EventoReq): Promise<EventoRes>;
  /** evento de carta de correção (teCCe). */
  cartaCorrecao(req: EventoReq): Promise<EventoRes>;
}
