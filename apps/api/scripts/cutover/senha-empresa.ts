/**
 * CUTOVER das SENHAS DE OPERAÇÃO da EMPRESA (EMPRESAS.SENHAADMIN/DESC/CANCEL/GAVETA → empresas.senha_*_hash)
 * — MOTOR (função "quase pura": só o `hash` injetável tem entropia). Espelha o motor do de-para (dedup-codref):
 * o extrator Python (READ-ONLY) despeja as colunas cruas, este motor decide O QUE migra, o loader aplica.
 *
 * FIDELIDADE. O legado guarda a senha cifrada com César +13 (TJvCaesarCipher, key-engodo → StrToIntDef=13) e
 * SEMPRE decoda com shift FIXO 13 (udmPrincipal.encSenha, o mesmo componente que o uSenhaAdmin usa p/ verificar).
 * Portanto a "senha que o operador digita" = decodeSenhaLegado(cifrada) com shift 13 — é isto que o motor migra.
 *
 * ACHADO (recon READ-ONLY PINHEIRAO, 4 empresas): os bytes cifrados têm DIFERENÇAS idênticas entre empresas →
 * mesmo plaintext ("081223" em homolog), mas SHIFTS distintos, todos MÚLTIPLOS DE 13 (emp50=13×1, emp51=13×5,
 * emp1=13×9, emp2=13×10). É a assinatura de um RE-ENCODE CUMULATIVO no legado (udmCadEmpresa GetText/SetText
 * re-encoda +13 a cada gravação). Como o app decoda com shift FIXO 13, só a senha salva 1× (emp50) é verificável;
 * as demais já estão QUEBRADAS no próprio legado (só os backdoors mestres — já eliminados — as liberavam).
 *
 * Por isso o motor CLASSIFICA cada senha: `limpa` (decode-13 sem bytes de controle → plausivelmente uma senha real
 * → MIGRA) vs `suspeita` (decode-13 com bytes de controle 0–31/127–159 → decodou p/ lixo indigitável = corrompida
 * pelo re-encode cumulativo → NÃO migra; o admin redefine via `PUT cadastro/senha-operacao`). O sinal "controle"
 * pega os casos claramente inutilizáveis; não garante detectar todo lixo-imprimível (ver dossiê §7 — remédio geral
 * é a redefinição pelo admin). A senha EM CLARO nunca sai do motor: hash imediato (scrypt).
 */
import { decodeSenhaLegado, hashSenha } from '../../src/shared/auth/crypto';

export const TIPOS_SENHA_EMPRESA = ['admin', 'desc', 'cancel', 'gaveta'] as const;
export type TipoSenhaEmpresa = (typeof TIPOS_SENHA_EMPRESA)[number];

/** linha crua do Oracle (EMPRESAS) — só o que o cutover precisa; senhas RTRIM'adas pelo extrator. */
export interface RawEmpresaSenha {
  codempresa: number;
  senhaadmin?: string | null;
  senhadesc?: string | null;
  senhacancel?: string | null;
  senhagaveta?: string | null;
}

/** senha limpa a migrar: empresa × tipo × hash forte (senha em claro NÃO viaja). */
export interface SenhaMigrada {
  idempresa: number;
  tipo: TipoSenhaEmpresa;
  hash: string;
}

export interface SenhaSuspeita {
  codempresa: number;
  tipo: TipoSenhaEmpresa;
  motivo: string;
}

export interface CutoverSenhaReport {
  origem: number; // linhas de empresa lidas
  empresas: number; // empresas com codempresa válido
  migradas: number; // senhas limpas migradas (= migrar.length)
  vazias: number; // senhas em branco (não configuradas — decodam p/ vazio)
  suspeitas: SenhaSuspeita[]; // corrompidas (decode com controle) → admin redefine
  invalidas: Array<{ codempresa: unknown; motivo: string }>; // linha com codempresa inválido
}

const COL: Record<TipoSenhaEmpresa, keyof RawEmpresaSenha> = {
  admin: 'senhaadmin',
  desc: 'senhadesc',
  cancel: 'senhacancel',
  gaveta: 'senhagaveta',
};

/**
 * Classifica o plaintext do decode-13. `limpa` = TODO byte é ASCII imprimível (32–126) → plausivelmente uma senha
 * digitável → migra. `controle` = há byte 0–31/127–159 (lixo indigitável). `latin1` = há byte ≥160 (¥, ç
 * acentuado etc.). Ambos os últimos são SUSPEITA e NÃO migram: com o re-encode cumulativo (shift 13×N) o decode-13
 * cai fora do ASCII na maioria dos N>1, então tratamos "fora do ASCII" como provável corrupção. Falso-positivo
 * possível: senha legítima com acento (rara em senha de operação) → flag conservador, admin redefine (fold da
 * auditoria — antes migrava esse lixo em silêncio). Só emp50-style (salva 1×, shift 13) resulta em ASCII limpo.
 */
function classificar(s: string): 'limpa' | 'controle' | 'latin1' {
  let latin1 = false;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c < 32 || (c >= 127 && c < 160)) return 'controle'; // controle domina (mais claramente corrompido)
    if (c >= 160) latin1 = true;
  }
  return latin1 ? 'latin1' : 'limpa';
}

export function cutoverSenhasEmpresa(
  rows: RawEmpresaSenha[],
  hash: (senhaPlana: string) => string = hashSenha,
): { migrar: SenhaMigrada[]; report: CutoverSenhaReport } {
  const migrar: SenhaMigrada[] = [];
  const suspeitas: SenhaSuspeita[] = [];
  const invalidas: Array<{ codempresa: unknown; motivo: string }> = [];
  let vazias = 0;
  let empresas = 0;

  for (const r of rows) {
    const idempresa = Number(r.codempresa);
    if (!Number.isInteger(idempresa) || idempresa <= 0) {
      invalidas.push({ codempresa: r.codempresa, motivo: 'codempresa inválido' });
      continue;
    }
    empresas++;
    for (const tipo of TIPOS_SENHA_EMPRESA) {
      const cifrada = r[COL[tipo]] as string | null | undefined;
      const ct = cifrada == null ? '' : String(cifrada);
      if (ct === '') {
        vazias++;
        continue;
      }
      const plana = decodeSenhaLegado(ct); // shift 13 FIXO — exatamente o que o app faz p/ verificar
      if (plana.trim() === '') {
        vazias++; // decodou p/ branco → tratada como não-configurada
        continue;
      }
      const classe = classificar(plana);
      if (classe !== 'limpa') {
        suspeitas.push({
          codempresa: idempresa,
          tipo,
          motivo:
            classe === 'controle'
              ? 'decode-13 com caracteres de controle — re-encode cumulativo (udmCadEmpresa), corrompida no legado'
              : 'decode-13 fora do ASCII imprimível (byte ≥160) — provável re-encode cumulativo; admin redefine',
        });
        continue;
      }
      migrar.push({ idempresa, tipo, hash: hash(plana) });
    }
  }

  return {
    migrar,
    report: { origem: rows.length, empresas, migradas: migrar.length, vazias, suspeitas, invalidas },
  };
}
