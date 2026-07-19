import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

/**
 * HASH de senha — scrypt do `node:crypto` (zero dependência nativa; decisão do corte OPERADORES corte-3).
 * Formato serializado: `scrypt$<N>$<r>$<p>$<saltHex>$<keyHex>` — auto-descritivo (os parâmetros viajam com
 * o hash, então dá pra endurecer o custo no futuro sem quebrar hashes antigos). Substitui a cifra REVERSÍVEL
 * de César (+13) do legado, que NÃO é hash (uPassword: TJvCaesarCipher, chave-engodo → shift fixo 13).
 */
const N = 16384; // custo memória (2^14) — ~16 MB (mantém memória baixa; anti-DoS no endpoint público)
const R = 8;
const P = 3; // fold B2: p=3 (CPU ~3x) sobe o custo sem estourar memória (OWASP: N=2^14 aceita p>1)
const KEYLEN = 64;
const MAXMEM = 256 * 1024 * 1024; // teto folgado — verify nunca lança por params legítimos (mesmo N maior no futuro)

export function hashSenha(senha: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(senha, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

/**
 * Hash "dummy" válido (gerado no boot) — fold B1: o login roda um verify contra ele quando o operador não
 * existe / não tem hash, equalizando o tempo com o caso "senha errada" (senão o curto-circuito vazaria a
 * EXISTÊNCIA do usuário por timing). Não corresponde a nenhuma senha real.
 */
export const DUMMY_HASH = hashSenha(randomBytes(24).toString('hex'));

/** Verifica a senha contra o hash serializado. Timing-safe. `false` (nunca lança) em hash malformado/ausente. */
export function verificarSenha(senha: string, hashArmazenado: string | null | undefined): boolean {
  if (!hashArmazenado) return false;
  const partes = hashArmazenado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const n = Number(partes[1]);
  const r = Number(partes[2]);
  const p = Number(partes[3]);
  const salt = Buffer.from(partes[4], 'hex');
  const esperado = Buffer.from(partes[5], 'hex');
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p) || salt.length === 0 || esperado.length === 0) {
    return false;
  }
  let calc: Buffer;
  try {
    calc = scryptSync(senha, salt, esperado.length, { N: n, r, p, maxmem: MAXMEM });
  } catch {
    return false;
  }
  return calc.length === esperado.length && timingSafeEqual(calc, esperado);
}

/**
 * REFRESH TOKEN — segredo OPACO de alta entropia (256 bits). Diferente da senha (baixa entropia → scrypt lento):
 * como já é aleatório, um hash RÁPIDO (sha256) basta e é o certo (lookup por índice; sem brute-force viável).
 * Guarda-se só o HASH; o texto claro vai uma vez ao cliente e nunca é persistido.
 */
export function gerarRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * CIFRA LEGADA (César +13) — para o CUTOVER das senhas do Oracle (`OPERADORES.SENHA`). O legado usa
 * `TJvCaesarCipher` cuja chave (`APOLLOSISTEMASDEAUTOMAÇÃO`) é um ENGODO: `StrToIntDef` cai no default 13,
 * então cada byte da senha em claro vira `byte+13 mod 256` (recon Delphi udmPrincipal.dfm:889 + JvCipher.pas).
 * REVERSÍVEL. Cada valor de `SENHA` é tratado como bytes latin-1. Uso no cutover: `hashSenha(decodeSenhaLegado(SENHA))`
 * por operador → re-hash forte + `solicitar_alteracao_senha='S'` (a senha atual entra 1x, depois troca obrigatória).
 * Os backdoors do legado (dev `APOLLOSG`, mestra `SYSAPOLLO<dia><mês>`, `SENHARETAGUARDA` como mestra) NÃO são
 * reimplementados — são vulnerabilidades.
 */
const SHIFT_LEGADO = 13;

export function decodeSenhaLegado(cifrada: string): string {
  return Array.from(cifrada, (ch) => String.fromCharCode((ch.charCodeAt(0) - SHIFT_LEGADO + 256) & 0xff)).join('');
}

/** Inverso do decode (grava no formato do legado). Só para testes de round-trip do cutover. */
export function encodeSenhaLegado(clara: string): string {
  return Array.from(clara, (ch) => String.fromCharCode((ch.charCodeAt(0) + SHIFT_LEGADO) & 0xff)).join('');
}
