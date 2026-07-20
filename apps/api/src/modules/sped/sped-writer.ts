/**
 * MOTOR ESCRITOR do SPED (EFD-Contribuições / EFD ICMS-IPI). O legado delega a escrita à lib ACBr (não é um
 * procedure Delphi) — então construímos ao PADRÃO SPED público: linha `|REG|campo1|...|` + CRLF, datas DDMMYYYY,
 * decimais com VÍRGULA e sem separador de milhar, campo nulo/vazio entre pipes (`||`), CNPJ/CPF só dígitos.
 * O bloco 9 (9001/9900/9990/9999) é o TOTALIZADOR auto-referente do SPED — gerado aqui, reutilizável por
 * qualquer arquivo (Contribuições ou Fiscal). Registros ordenados na sequência em que são adicionados.
 */

type Campo = string | null | undefined;

/** data → DDMMYYYY (aceita Date ou 'YYYY-MM-DD' / ISO). Vazio → ''. Date usa componentes LOCAIS (toISOString
 *  deslocaria o dia por fuso — fold auditoria [BAIXA]). */
export function fmtData(d: Date | string | null | undefined): string {
  if (d == null || d === '') return '';
  if (typeof d !== 'string') {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}${mm}${d.getFullYear()}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}${m[2]}${m[1]}` : '';
}

/** número → 'X,YY' (dec casas decimais, vírgula, sem milhar). null/NaN → ''. */
export function fmtNum(n: number | string | null | undefined, dec = 2): string {
  if (n == null || n === '') return '';
  const v = typeof n === 'string' ? Number(n.replace(',', '.')) : n;
  if (!Number.isFinite(v)) return '';
  return v.toFixed(dec).replace('.', ',');
}

/** só dígitos (CNPJ/CPF/CEP). Vazio → ''. */
export function soDigitos(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

export class SpedArquivo {
  private readonly linhas: Array<{ reg: string; texto: string }> = [];

  /** adiciona um registro `|REG|campos|`. Campos null/undefined viram vazio; `|` e quebras de linha no CONTEÚDO
   *  são removidos (fold auditoria [MÉDIA]: o SPED usa `|` como delimitador — um pipe no texto quebraria o
   *  alinhamento e as contagens físicas 9999/9990/990). */
  add(reg: string, campos: Campo[]): void {
    const texto = `|${reg}|${campos.map((c) => (c == null ? '' : String(c).replace(/[|\r\n]+/g, ' '))).join('|')}|`;
    this.linhas.push({ reg, texto });
  }

  /** fecha um BLOCO com o registro totalizador (ex.: '0990','C990','M990'): QTD_LIN = nº de linhas do bloco
   *  (todos os REG que começam com a `letra`) INCLUINDO a própria linha de fechamento. */
  fecharBloco(reg990: string, letra: string): void {
    const qtd = this.linhas.filter((l) => l.reg.startsWith(letra)).length + 1;
    this.add(reg990, [String(qtd)]);
  }

  /** nº de linhas atuais (antes do bloco 9). */
  get total(): number {
    return this.linhas.length;
  }

  /**
   * GERA o texto final: corpo + BLOCO 9 (9001 → 9900 por tipo → 9990) + 9999. O 9900 tem UMA linha por tipo de
   * registro presente no arquivo, INCLUSIVE 9001/9900/9990/9999 (auto-referente); 9990=linhas do bloco 9; 9999=
   * total de linhas do arquivo (inclui a própria 9999). Padrão SPED (o que o ACBr faz no SaveFileTXT).
   */
  gerar(): string {
    const contagem = new Map<string, number>();
    for (const l of this.linhas) contagem.set(l.reg, (contagem.get(l.reg) ?? 0) + 1);
    // tipos distintos no arquivo final = tipos do corpo + os do próprio bloco 9 (9001/9900/9990/9999).
    const distintos = [...new Set([...contagem.keys(), '9001', '9900', '9990', '9999'])].sort();
    const num9900 = distintos.length; // = nº de linhas 9900 (uma por tipo)
    const qtdDe = (reg: string): number =>
      reg === '9900' ? num9900 : reg === '9001' || reg === '9990' || reg === '9999' ? 1 : (contagem.get(reg) ?? 0);

    const bloco9: string[] = ['|9001|0|'];
    for (const reg of distintos) bloco9.push(`|9900|${reg}|${qtdDe(reg)}|`);
    const qtdLin9 = 1 /*9001*/ + num9900 /*9900s*/ + 1 /*9990*/;
    bloco9.push(`|9990|${qtdLin9}|`);

    const corpo = this.linhas.map((l) => l.texto);
    const totalLinhas = corpo.length + qtdLin9 + 1 /*9999*/;
    return [...corpo, ...bloco9, `|9999|${totalLinhas}|`].join('\r\n') + '\r\n';
  }
}
