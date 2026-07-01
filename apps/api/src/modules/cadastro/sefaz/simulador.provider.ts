import { Injectable } from '@nestjs/common';
import { montarChaveNfe, statusFromCstat } from '@apollo/shared';
import type { EventoReq, EventoRes, SefazPort, TransmitirReq, TransmitirRes } from './sefaz.port';

/**
 * ⚠️ SIMULADOR DE SEFAZ — HOMOLOGAÇÃO/DESENVOLVIMENTO. NÃO TRANSMITE NADA DE VERDADE. ⚠️
 *
 * Implementação da `SefazPort` para o corte 1 da F6: devolve cStat de SUCESSO de forma
 * determinística (sem rede, sem certificado, sem XSD) para exercitar PONTA-A-PONTA a máquina
 * de estados, a geração da chave de acesso, a persistência e a auditoria. TODO retorno é
 * marcado `simulado: true` e o ambiente vem da `empresa_fiscal` (homologação por padrão).
 *
 * PRODUÇÃO EXIGE O PROVIDER REAL (ACBrLibNFe / lib NFe Node / microserviço SEFAZ) implementando
 * a mesma interface — selecionado por env `SEFAZ_PROVIDER` no `cadastro.module.ts` (o factory
 * PROÍBE este simulador quando `NODE_ENV='production'`). Enquanto só houver simulador, nenhuma
 * NFe é de fato autorizada na Receita; os registros servem a homologação e demonstração.
 */
@Injectable()
export class SimuladorSefazProvider implements SefazPort {
  /** protocolo sintético de 15 dígitos (prefixo '999' = ambiente de simulação). */
  private protocoloSimulado(): string {
    const t = Date.now() % 1_000_000_000; // 9 díg de tempo
    const r = Math.floor(Math.random() * 1000); // 3 díg aleatórios
    return '999' + String(t).padStart(9, '0') + String(r).padStart(3, '0');
  }

  /** AAMM a partir da data de emissão. */
  private aamm(d: Date | string): string {
    const dt = typeof d === 'string' ? new Date(d) : d;
    const aa = String(dt.getUTCFullYear()).slice(-2);
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    return aa + mm;
  }

  async transmitir(req: TransmitirReq): Promise<TransmitirRes> {
    // código numérico (cNF) aleatório de 8 díg, diferente do nNF (regra SEFAZ).
    let cnf = Math.floor(Math.random() * 100_000_000);
    if (cnf === Number(req.numero)) cnf = (cnf + 1) % 100_000_000;
    const chave = montarChaveNfe({
      cuf: req.cuf,
      aamm: this.aamm(req.dtemissao),
      cnpj: req.cnpj,
      modelo: req.modelo,
      serie: req.serie,
      numero: req.numero,
      tpEmis: req.tpEmis || 1,
      cnf,
    });
    const protocolo = this.protocoloSimulado();
    // MODO de teste (homolog/dev): SEFAZ_SIM_CSTAT força o cStat de retorno (default 100=autorizada),
    // permitindo exercitar o ramo DENEGADA (110/301/302/303) e rejeição PONTA-A-PONTA sem SEFAZ real.
    // O factory já PROÍBE o simulador em produção; SEFAZ_SIM_CSTAT nunca deve ser ligado lá.
    const cstat = Number(process.env.SEFAZ_SIM_CSTAT ?? 100) || 100;
    const status = statusFromCstat(cstat) as 'P' | 'D'; // mapeamento puro (= GetStatusNFE): 100→P, 110/301/302/303→D
    const xMotivo =
      cstat === 100
        ? 'Autorizado o uso da NF-e (SIMULADO)'
        : status === 'D'
          ? `Nota fiscal DENEGADA (SIMULADO cStat ${cstat})`
          : `Retorno SIMULADO cStat ${cstat}`;
    const xml =
      `<!-- SIMULADO homologacao (NAO transmitido a SEFAZ) -->` +
      `<nfeSimulada chave="${chave}" protocolo="${protocolo}" cStat="${cstat}" tpAmb="${req.ambiente}"/>`;
    return {
      chave,
      protocolo,
      cstat,
      xMotivo,
      status,
      xml,
      ambiente: req.ambiente,
      simulado: true,
    };
  }

  async cancelar(req: EventoReq): Promise<EventoRes> {
    return this.evento(req, 'Cancelamento');
  }

  async cartaCorrecao(req: EventoReq): Promise<EventoRes> {
    return this.evento(req, 'Carta de Correcao');
  }

  private evento(req: EventoReq, desc: string): EventoRes {
    const protocolo = this.protocoloSimulado();
    const xml =
      `<!-- SIMULADO homologacao (evento NAO transmitido) -->` +
      `<procEventoSimulado chave="${req.chavenfe}" tipo="${desc}" seq="${req.seq}" protocolo="${protocolo}"/>`;
    return {
      protocolo,
      cstat: 135, // evento registrado e vinculado à NF-e
      xMotivo: `Evento registrado e vinculado a NF-e (SIMULADO: ${desc})`,
      verAplic: 'SIMULADOR-HOMOLOG',
      xml,
      simulado: true,
    };
  }
}
