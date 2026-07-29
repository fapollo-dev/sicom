/**
 * VALIDADOR ESTRUTURAL do SPED FISCAL (EFD ICMS/IPI) — regras do PVA-EFD, sem o PVA. Distinto do validador do
 * EFD-Contribuições porque os LEIAUTES divergem (ex.: 0000 tem 14 campos aqui vs 13 lá; registros C190/E110/0005
 * não existem no outro). Confere: formato |REG|…|, contagem de campos por registro, totalizador do bloco 9,
 * abertura/fechamento por bloco, domínios de campo de maior risco (o que o PVA rejeita) e a aritmética do E110.
 */
const EPS = 0.011;

function num(s: string | undefined): number {
  if (s == null || s === '') return 0;
  const n = Number(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

export interface ResultadoValidacao {
  ok: boolean;
  erros: string[];
  registros: number;
}

/** contagem esperada de campos (após o REG) dos registros do EFD ICMS/IPI que emitimos. */
const CAMPOS_ESPERADOS: Record<string, number> = {
  '0000': 14, '0001': 1, '0005': 9, '0150': 12, '0190': 2, '0200': 12, '0990': 1,
  C001: 1, C100: 28, C170: 37, C190: 11, C500: 26, C590: 10, C990: 1,
  E001: 1, E100: 2, E110: 14, E116: 9, E990: 1,
  '9001': 1, '9900': 2, '9990': 1, '9999': 1,
};

export function validarSpedFiscal(arquivo: string): ResultadoValidacao {
  const erros: string[] = [];
  const linhas = arquivo.split('\r\n').filter((l) => l !== '');
  const regs: Array<{ reg: string; campos: string[]; linha: number }> = [];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l.startsWith('|') || !l.endsWith('|')) { erros.push(`linha ${i + 1}: registro fora do formato |REG|...|`); continue; }
    const partes = l.split('|');
    regs.push({ reg: partes[1], campos: partes.slice(2, partes.length - 1), linha: i + 1 });
  }

  // 1) contagem de campos
  for (const r of regs) {
    const esp = CAMPOS_ESPERADOS[r.reg];
    if (esp != null && r.campos.length !== esp) erros.push(`linha ${r.linha}: ${r.reg} com ${r.campos.length} campos (esperado ${esp})`);
  }

  // 2) totalizador bloco 9
  const contagem = new Map<string, number>();
  for (const r of regs) contagem.set(r.reg, (contagem.get(r.reg) ?? 0) + 1);
  for (const r of regs.filter((x) => x.reg === '9900')) {
    const [reg, qtd] = r.campos;
    const real = contagem.get(reg) ?? 0;
    if (Number(qtd) !== real) erros.push(`9900 (linha ${r.linha}): REG ${reg} declara ${qtd}, arquivo tem ${real}`);
  }
  const linhasBloco9 = regs.filter((x) => x.reg.startsWith('9') && x.reg !== '9999').length;
  const r9990 = regs.find((x) => x.reg === '9990');
  if (r9990 && Number(r9990.campos[0]) !== linhasBloco9) erros.push(`9990 declara ${r9990.campos[0]}, bloco 9 tem ${linhasBloco9} linhas`);
  const r9999 = regs.find((x) => x.reg === '9999');
  if (r9999 && Number(r9999.campos[0]) !== regs.length) erros.push(`9999 declara ${r9999.campos[0]}, arquivo tem ${regs.length} linhas`);

  // 3) abertura/fechamento por bloco (0/C/E/9)
  for (const [b, ab, fe] of [['0', '0001', '0990'], ['C', 'C001', 'C990'], ['E', 'E001', 'E990'], ['9', '9001', '9990']] as const) {
    const temBloco = regs.some((x) => x.reg.startsWith(b) && x.reg !== ab && x.reg !== fe);
    if (temBloco || b === '0' || b === '9' || b === 'E') {
      if ((contagem.get(ab) ?? 0) !== 1) erros.push(`bloco ${b}: abertura ${ab} deveria aparecer 1x (achou ${contagem.get(ab) ?? 0})`);
      if ((contagem.get(fe) ?? 0) !== 1) erros.push(`bloco ${b}: fechamento ${fe} deveria aparecer 1x (achou ${contagem.get(fe) ?? 0})`);
    }
  }

  // 4) DOMÍNIOS de maior risco (o que o PVA rejeita)
  const emDom = (v: string | undefined, dom: string[]) => v != null && dom.includes(v);
  for (const r of regs.filter((x) => x.reg === '0000')) {
    if (!emDom(r.campos[1], ['0', '1'])) erros.push(`0000 (linha ${r.linha}): COD_FIN '${r.campos[1]}' fora do domínio {0,1}`);
    if (!emDom(r.campos[12], ['A', 'B', 'C'])) erros.push(`0000 (linha ${r.linha}): IND_PERFIL '${r.campos[12]}' fora do domínio {A,B,C}`);
    if (!emDom(r.campos[13], ['0', '1'])) erros.push(`0000 (linha ${r.linha}): IND_ATIV '${r.campos[13]}' fora do domínio {0,1}`);
  }
  for (const r of regs.filter((x) => x.reg === 'C100')) {
    if (!emDom(r.campos[0], ['0', '1'])) erros.push(`C100 (linha ${r.linha}): IND_OPER '${r.campos[0]}' fora do domínio {0,1}`);
    if ((r.campos[4] ?? '') === '') erros.push(`C100 (linha ${r.linha}): COD_SIT vazio`);
  }
  for (const r of regs.filter((x) => x.reg === 'C190')) {
    if ((r.campos[0] ?? '') === '') erros.push(`C190 (linha ${r.linha}): CST_ICMS vazio (obrigatório)`);
    if ((r.campos[1] ?? '') === '') erros.push(`C190 (linha ${r.linha}): CFOP vazio (obrigatório)`);
  }
  for (const r of regs.filter((x) => x.reg === 'C500')) {
    if (!emDom(r.campos[0], ['0', '1'])) erros.push(`C500 (linha ${r.linha}): IND_OPER '${r.campos[0]}' fora do domínio {0,1}`);
    if (!emDom(r.campos[1], ['0', '1'])) erros.push(`C500 (linha ${r.linha}): IND_EMIT '${r.campos[1]}' fora do domínio {0,1}`);
    if ((r.campos[3] ?? '') === '') erros.push(`C500 (linha ${r.linha}): COD_MOD vazio`);
    if ((r.campos[4] ?? '') === '') erros.push(`C500 (linha ${r.linha}): COD_SIT vazio`);
  }
  for (const r of regs.filter((x) => x.reg === 'C590')) {
    if ((r.campos[0] ?? '') === '') erros.push(`C590 (linha ${r.linha}): CST_ICMS vazio (obrigatório)`);
    if ((r.campos[1] ?? '') === '') erros.push(`C590 (linha ${r.linha}): CFOP vazio (obrigatório)`);
  }

  // 5) ARITMÉTICA do E110: VL_SLD_APURADO = (DEB + AJ_DEB + ESTORNO_CRED) − (CRED + AJ_CRED + ESTORNO_DEB + SLD_CREDOR_ANT),
  //    clampado a ≥0; o excedente credor vai p/ VL_SLD_CREDOR_TRANSPORTAR. VL_ICMS_RECOLHER = SLD_APURADO − DED.
  for (const r of regs.filter((x) => x.reg === 'E110')) {
    const f = r.campos.map(num);
    // devedor = (DEB + AJ_DEB + TOT_AJ_DEB + ESTORNO_CRED) − (CRED + AJ_CRED + TOT_AJ_CRED + ESTORNO_DEB + SLD_CREDOR_ANT)
    const devedor = f[0] + f[1] + f[2] + f[3] - (f[4] + f[5] + f[6] + f[7] + f[8]);
    const apurado = Math.max(0, devedor);
    const credor = Math.max(0, -devedor);
    if (Math.abs(f[9] - apurado) > EPS) erros.push(`E110 (linha ${r.linha}): VL_SLD_APURADO ${f[9]} ≠ max(0, débitos−créditos) ${apurado}`);
    if (Math.abs(f[12] - credor) > EPS) erros.push(`E110 (linha ${r.linha}): VL_SLD_CREDOR_TRANSPORTAR ${f[12]} ≠ saldo credor ${credor}`);
    // coerência com E116: Σ VL_OR dos E116 = VL_ICMS_RECOLHER do E110 (o PVA rejeita se não bater).
    const somaE116 = regs.filter((x) => x.reg === 'E116').reduce((s, x) => s + num(x.campos[1]), 0);
    if (f[11] > EPS && Math.abs(somaE116 - f[11]) > EPS) erros.push(`E116: Σ VL_OR ${somaE116} ≠ E110.VL_ICMS_RECOLHER ${f[11]}`);
  }

  return { ok: erros.length === 0, erros, registros: regs.length };
}
