/**
 * Parser mínimo de OFX (extrato bancário) — corte-2 da Conciliação Bancária. Substitui a lib externa do legado
 * (Classes.ImportadorOFX). Suporta OFX 1.x (SGML — tags sem fechamento, valor até o próximo '<'/quebra de linha) e
 * OFX 2.x (XML). Extrai cada bloco <STMTTRN> em uma linha do extrato: DTPOSTED→data, TRNAMT→valor(+sinal→C/D),
 * FITID→transacao_id, CHECKNUM→check_num, MEMO|NAME→descrição. Não valida SGML formalmente (bancos variam) —
 * é tolerante a espaços/quebras e a maiúsculas/minúsculas das tags.
 */
export interface OfxTransacao {
  data: string; // 'YYYY-MM-DD'
  valor: number; // sempre positivo (magnitude)
  credito_debito: 'C' | 'D';
  descricao?: string;
  transacao_id?: string;
  check_num?: string;
}

/** decodifica as 5 entidades XML padrão (SGML/XML do OFX escapa '&' como '&amp;' etc. em MEMO/NAME). */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'").replace(/&amp;/gi, '&'); // &amp; por último (senão '&lt;' viraria '<' 2×)
}

/** valor de um campo-folha dentro de um bloco: `<TAG>valor` (SGML) ou `<TAG>valor</TAG>` (XML). */
function campo(bloco: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}>\\s*([^<\\r\\n]+)`, 'i').exec(bloco);
  return m ? m[1].trim() : undefined;
}

/** 'YYYYMMDD...' (DTPOSTED do OFX) → 'YYYY-MM-DD'. Valida o domínio (mês 1-12, dia 1-31) — senão retorna undefined
 *  e a linha é pulada, em vez de deixar 'YYYY-13-01' estourar o INSERT em timestamptz e derrubar o lote inteiro. */
function dataOfx(raw: string | undefined): string | undefined {
  const d = (raw ?? '').replace(/[^0-9]/g, '');
  if (d.length < 8) return undefined;
  const mes = Number(d.slice(4, 6));
  const dd = Number(d.slice(6, 8));
  if (mes < 1 || mes > 12 || dd < 1 || dd > 31) return undefined;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** parseia o TRNAMT (padrão OFX = ponto-decimal, sem separador de milhar) tolerando também extratos BR fora do padrão
 *  (`1.234,56` ou `1234,56`). Regra: o separador MAIS À DIREITA (. ou ,) é o decimal; o outro é milhar e some. */
function valorOfx(raw: string): number {
  let s = String(raw).replace(/[^\d.,-]/g, '');
  const ultPonto = s.lastIndexOf('.');
  const ultVirg = s.lastIndexOf(',');
  if (ultPonto >= 0 && ultVirg >= 0) {
    // ambos presentes → o da direita é decimal, o da esquerda é milhar.
    const dec = Math.max(ultPonto, ultVirg);
    s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1).replace(/[.,]/g, '');
  } else if (ultVirg >= 0) {
    // só vírgula → decimal BR.
    s = s.replace(',', '.');
  }
  // só ponto (ou nenhum) → já é o padrão OFX; não mexer.
  return Number(s);
}

/** parseia o texto OFX em linhas de extrato. Ignora blocos sem data/valor válidos. */
export function parseOfx(texto: string): OfxTransacao[] {
  const out: OfxTransacao[] = [];
  // isola cada transação: de <STMTTRN> até </STMTTRN> OU o próximo <STMTTRN> OU o fim.
  const re = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const bloco = m[1];
    const data = dataOfx(campo(bloco, 'DTPOSTED') ?? campo(bloco, 'DTUSER'));
    const trnamtRaw = campo(bloco, 'TRNAMT');
    if (!data || trnamtRaw == null) continue;
    const amt = valorOfx(trnamtRaw);
    // pula NaN e as linhas informativas de valor 0 (não são movimento de caixa — nunca conciliam; o schema
    // corte-1 exige valor>0, então zero também mantém os dois caminhos de ingestão consistentes).
    if (!Number.isFinite(amt) || amt === 0) continue;
    const trnType = (campo(bloco, 'TRNTYPE') ?? '').toUpperCase();
    // o sinal do TRNAMT manda (o padrão OFX assina o valor); TRNTYPE='DEBIT' é só fallback p/ extrato que manda a
    // magnitude sem sinal. NÃO expandir p/ FEE/XFER/PAYMENT: num arquivo assinado, um FEE positivo é estorno (crédito)
    // — deixar o sinal decidir evita inverter esse caso.
    const cd: 'C' | 'D' = amt < 0 || trnType === 'DEBIT' ? 'D' : 'C';
    const memo = campo(bloco, 'MEMO') ?? campo(bloco, 'NAME');
    out.push({
      data,
      valor: Math.abs(amt),
      credito_debito: cd,
      descricao: memo ? unescapeXml(memo).slice(0, 250) : undefined,
      transacao_id: campo(bloco, 'FITID')?.slice(0, 255),
      check_num: campo(bloco, 'CHECKNUM')?.slice(0, 20),
    });
  }
  return out;
}
