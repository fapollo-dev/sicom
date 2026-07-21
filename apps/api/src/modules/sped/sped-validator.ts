/**
 * VALIDADOR ESTRUTURAL do SPED EFD-Contribuições (regras do PVA, sem o PVA). Roda sobre o texto gerado e
 * confere o que a Receita valida na importação: formato dos registros, totalizador do bloco 9, presença de
 * abertura/fechamento por bloco, hierarquia pai→filho e as DERIVAÇÕES ARITMÉTICAS dos registros de apuração
 * (M100/M200, coerência C100↔C175). Devolve a lista de erros (vazia = arquivo estruturalmente válido).
 * NÃO substitui o PVA oficial — codifica as checagens de maior valor p/ pegar regressões cedo (ex.: o campo
 * VL_TOT_CONT_NC_DEV do M200 tem de bater com VL_TOT_CONT_NC_PER − créditos).
 */
const EPS = 0.011; // tolerância de 1 centavo nas conferências de valor

/** '30064,90' → 30064.90 ; '' → 0 (decimal SPED = vírgula, sem separador de milhar). */
function num(s: string | undefined): number {
  if (s == null || s === '') return 0;
  const n = Number(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

interface Registro {
  reg: string;
  campos: string[]; // valores entre o REG e o pipe final (índice 0 = 1º campo após o REG)
  linha: number;
}

export interface ResultadoValidacao {
  ok: boolean;
  erros: string[];
  registros: number;
}

/** contagem esperada de campos (após o REG) dos registros que emitimos — pega troca de ordem/campo faltando. */
const CAMPOS_ESPERADOS: Record<string, number> = {
  '0000': 13, '0001': 1, '0110': 4, '0140': 8, '0150': 12, '0190': 2, '0200': 12, '0990': 1,
  C001: 1, C010: 2, C100: 28, C170: 37, C175: 17, C990: 1,
  M001: 1, M100: 14, M105: 9, M200: 12, M205: 3, M210: 15, M500: 14, M505: 9, M600: 12, M605: 3, M610: 15, M990: 1,
  '9001': 1, '9900': 2, '9990': 1, '9999': 1,
};

export function validarSped(arquivo: string): ResultadoValidacao {
  const erros: string[] = [];
  const linhas = arquivo.split('\r\n').filter((l) => l !== '');
  const regs: Registro[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l.startsWith('|') || !l.endsWith('|')) {
      erros.push(`linha ${i + 1}: registro fora do formato |REG|...|`);
      continue;
    }
    const partes = l.split('|');
    // partes[0]='' , partes[1]=REG , partes[2..n-2]=campos , partes[n-1]=''
    regs.push({ reg: partes[1], campos: partes.slice(2, partes.length - 1), linha: i + 1 });
  }

  // 1) CONTAGEM DE CAMPOS por registro (só os conhecidos; desconhecido = aviso implícito, não erra).
  for (const r of regs) {
    const esp = CAMPOS_ESPERADOS[r.reg];
    if (esp != null && r.campos.length !== esp) {
      erros.push(`linha ${r.linha}: ${r.reg} com ${r.campos.length} campos (esperado ${esp})`);
    }
  }

  // 2) TOTALIZADOR bloco 9: 9900 por REG = ocorrências reais; 9990 = linhas do bloco 9; 9999 = total de linhas.
  const contagem = new Map<string, number>();
  for (const r of regs) contagem.set(r.reg, (contagem.get(r.reg) ?? 0) + 1);
  for (const r of regs.filter((x) => x.reg === '9900')) {
    const [reg, qtd] = r.campos;
    const real = contagem.get(reg) ?? 0;
    if (Number(qtd) !== real) erros.push(`9900 (linha ${r.linha}): REG ${reg} declara ${qtd}, arquivo tem ${real}`);
  }
  // 9990 conta as linhas do bloco 9 (9001 + 9900s + 9990) — o 9999 é encerramento do ARQUIVO, não do bloco.
  const linhasBloco9 = regs.filter((x) => x.reg.startsWith('9') && x.reg !== '9999').length;
  const r9990 = regs.find((x) => x.reg === '9990');
  if (r9990 && Number(r9990.campos[0]) !== linhasBloco9) erros.push(`9990 declara ${r9990.campos[0]}, bloco 9 tem ${linhasBloco9} linhas`);
  const r9999 = regs.find((x) => x.reg === '9999');
  if (r9999 && Number(r9999.campos[0]) !== regs.length) erros.push(`9999 declara ${r9999.campos[0]}, arquivo tem ${regs.length} linhas`);

  // 3) ABERTURA/FECHAMENTO de bloco: se há registro do bloco, tem de ter X001 e X990 (uma vez cada).
  for (const b of ['0', 'C', 'M', '9']) {
    const abertura = `${b === '9' ? '9' : b}001`;
    const fechamento = `${b === '0' ? '0990' : b === '9' ? '9990' : `${b}990`}`;
    const temBloco = regs.some((x) => x.reg.startsWith(b) && x.reg !== abertura && x.reg !== fechamento);
    if (temBloco || b === '0' || b === '9') {
      if ((contagem.get(abertura) ?? 0) !== 1) erros.push(`bloco ${b}: abertura ${abertura} deveria aparecer 1x (achou ${contagem.get(abertura) ?? 0})`);
      if ((contagem.get(fechamento) ?? 0) !== 1) erros.push(`bloco ${b}: fechamento ${fechamento} deveria aparecer 1x (achou ${contagem.get(fechamento) ?? 0})`);
    }
  }

  // 4) DERIVAÇÕES do bloco M (PIS M100/M200 e COFINS M500/M600). Pega o bug clássico do campo derivado errado.
  for (const r of regs.filter((x) => x.reg === 'M100' || x.reg === 'M500')) {
    const disp = num(r.campos[10]); // VL_CRED_DISP
    const desc = num(r.campos[12]); // VL_CRED_DESC
    const sld = num(r.campos[13]); // SLD_CRED
    if (Math.abs(sld - (disp - desc)) > EPS) erros.push(`${r.reg} (linha ${r.linha}): SLD_CRED ${sld} ≠ VL_CRED_DISP−VL_CRED_DESC (${disp}−${desc})`);
  }
  for (const r of regs.filter((x) => x.reg === 'M200' || x.reg === 'M600')) {
    const f = r.campos.map(num);
    // VL_TOT_CONT_NC_DEV(3) = NC_PER(0) − CRED_DESC(1) − CRED_DESC_ANT(2)
    if (Math.abs(f[3] - (f[0] - f[1] - f[2])) > EPS) erros.push(`${r.reg} (linha ${r.linha}): VL_TOT_CONT_NC_DEV ${f[3]} ≠ ${f[0]}−${f[1]}−${f[2]}`);
    // VL_CONT_NC_REC(6) = NC_DEV(3) − RET_NC(4) − OUT_DED_NC(5)
    if (Math.abs(f[6] - (f[3] - f[4] - f[5])) > EPS) erros.push(`${r.reg} (linha ${r.linha}): VL_CONT_NC_REC ${f[6]} ≠ ${f[3]}−${f[4]}−${f[5]}`);
    // VL_TOT_CONT_REC(11) = NC_REC(6) + CUM_REC(10)
    if (Math.abs(f[11] - (f[6] + f[10])) > EPS) erros.push(`${r.reg} (linha ${r.linha}): VL_TOT_CONT_REC ${f[11]} ≠ ${f[6]}+${f[10]}`);
  }
  // M205/M605: Σ VL_DEBITO deve casar com o VL_CONT_NC_REC do M200/M600 do mesmo imposto.
  for (const [m200reg, m205reg] of [['M200', 'M205'], ['M600', 'M605']] as const) {
    const m200 = regs.find((x) => x.reg === m200reg);
    if (!m200) continue;
    const rec = num(m200.campos[6]);
    const somaM205 = regs.filter((x) => x.reg === m205reg).reduce((s, x) => s + num(x.campos[2]), 0);
    if (rec > EPS && Math.abs(somaM205 - rec) > EPS) erros.push(`${m205reg}: Σ VL_DEBITO ${somaM205} ≠ ${m200reg}.VL_CONT_NC_REC ${rec}`);
  }

  // 5) COERÊNCIA C100↔C175 (saída NFC-e): por documento, Σ dos C175 = VL_PIS/VL_COFINS do C100.
  for (let i = 0; i < regs.length; i++) {
    const r = regs[i];
    if (r.reg !== 'C100' || r.campos[0] !== '1') continue; // só C100 de SAÍDA (IND_OPER=1)
    if (r.campos[4] === '02') continue; // cancelado: sem C175
    let sPis = 0;
    let sCof = 0;
    for (let j = i + 1; j < regs.length && regs[j].reg === 'C175'; j++) {
      sPis += num(regs[j].campos[8]); // VL_PIS do C175
      sCof += num(regs[j].campos[14]); // VL_COFINS do C175
    }
    const vPis = num(r.campos[24]); // VL_PIS do C100
    const vCof = num(r.campos[25]); // VL_COFINS do C100
    if (Math.abs(sPis - vPis) > EPS) erros.push(`C100 saída (linha ${r.linha}): VL_PIS ${vPis} ≠ Σ C175 ${sPis}`);
    if (Math.abs(sCof - vCof) > EPS) erros.push(`C100 saída (linha ${r.linha}): VL_COFINS ${vCof} ≠ Σ C175 ${sCof}`);
  }

  return { ok: erros.length === 0, erros, registros: regs.length };
}
