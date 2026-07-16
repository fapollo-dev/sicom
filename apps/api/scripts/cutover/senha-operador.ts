/**
 * CUTOVER das 157 senhas de OPERADOR (OPERADORES.SENHA → operadores.senha_hash) — MOTOR. Fecha a decisão do épico
 * de AUTH (dossiê uCadUsuarios §5): a senha do legado é a cifra REVERSÍVEL César +13; o cutover DECODA (shift 13,
 * fiel ao app) → re-HASHA (scrypt) → o loader marca `solicitar_alteracao_senha='S'` (a senha atual entra 1×, depois
 * troca obrigatória). Espelha o motor da EMPRESA (senha-empresa.ts); reusa `classificar` (limpa/controle/latin1).
 *
 * ACHADO (recon READ-ONLY PINHEIRAO, 155 senhas não-vazias de 157 operadores): **100% decodam com shift FIXO 13 →
 * ASCII imprimível** — OPERADORES.SENHA NÃO sofre o re-encode cumulativo que corrompeu a EMPRESAS (aquele era
 * específico do udmCadEmpresa GetText/SetText). Então o cutover dos operadores é LIMPO (todas as 155 migram). A
 * classificação `controle`/`latin1` (→ suspeita) fica como guarda defensiva (nenhuma senha real cai nela hoje).
 */
import { decodeSenhaLegado, hashSenha } from '../../src/shared/auth/crypto';
import { classificar } from './senha-empresa';

/** linha crua do Oracle (OPERADORES) — senha RTRIM'ada pelo extrator (RAWTOHEX → latin-1). */
export interface RawOperadorSenha {
  codoperador: number;
  senha?: string | null;
}

/** senha migrada: operador × hash forte (senha em claro NÃO viaja; o loader força a troca no 1º acesso). */
export interface SenhaOperadorMigrada {
  codoperador: number;
  hash: string;
}

export interface SenhaOperadorSuspeita {
  codoperador: number;
  motivo: string;
}

export interface CutoverOperadorReport {
  origem: number; // linhas de operador lidas
  operadores: number; // com codoperador válido
  migradas: number; // senhas limpas migradas
  vazias: number; // sem senha (não configurada — decoda p/ vazio)
  suspeitas: SenhaOperadorSuspeita[]; // decode fora do ASCII → não migra
  invalidas: Array<{ codoperador: unknown; motivo: string }>;
}

export function cutoverSenhasOperador(
  rows: RawOperadorSenha[],
  hash: (senhaPlana: string) => string = hashSenha,
): { migrar: SenhaOperadorMigrada[]; report: CutoverOperadorReport } {
  const migrar: SenhaOperadorMigrada[] = [];
  const suspeitas: SenhaOperadorSuspeita[] = [];
  const invalidas: Array<{ codoperador: unknown; motivo: string }> = [];
  let vazias = 0;
  let operadores = 0;

  for (const r of rows) {
    const codoperador = Number(r.codoperador);
    if (!Number.isInteger(codoperador) || codoperador <= 0) {
      invalidas.push({ codoperador: r.codoperador, motivo: 'codoperador inválido' });
      continue;
    }
    operadores++;
    const ct = r.senha == null ? '' : String(r.senha);
    if (ct === '') {
      vazias++;
      continue;
    }
    const plana = decodeSenhaLegado(ct); // shift 13 FIXO — exatamente o que o app faz
    if (plana.trim() === '') {
      vazias++;
      continue;
    }
    const classe = classificar(plana);
    if (classe !== 'limpa') {
      suspeitas.push({
        codoperador,
        motivo: classe === 'controle' ? 'decode-13 com caracteres de controle — senha corrompida no legado' : 'decode-13 fora do ASCII imprimível (byte ≥160) — revisar',
      });
      continue;
    }
    migrar.push({ codoperador, hash: hash(plana) });
  }

  return {
    migrar,
    report: { origem: rows.length, operadores, migradas: migrar.length, vazias, suspeitas, invalidas },
  };
}
