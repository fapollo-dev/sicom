import { z } from 'zod';

/**
 * Validadores brasileiros reutilizáveis (zod) com mensagens em PORTUGUÊS — fonte
 * única back↔front (ADR-015). Campos conhecidos (CPF, CNPJ, celular, e-mail, CEP)
 * validam formato + dígito verificador e NORMALIZAM (removem máscara) no parse.
 */

/** remove tudo que não é dígito */
export const soDigitos = (s: string): string => (s ?? '').replace(/\D/g, '');

/** valida CPF (11 dígitos + 2 verificadores). */
export function cpfValido(valor: string): boolean {
  const cpf = soDigitos(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (base: string, pesoIni: number): number => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoIni - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(cpf.slice(0, 9), 10);
  const d2 = dv(cpf.slice(0, 10), 11);
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
}

/** valida CNPJ (14 dígitos + 2 verificadores). */
export function cnpjValido(valor: string): boolean {
  const cnpj = soDigitos(valor);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const dv = (base: string): number => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(cnpj.slice(0, 12));
  const d2 = dv(cnpj.slice(0, 13));
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

/** CPF — normaliza p/ 11 dígitos; mensagem PT. */
export const zCpf = z
  .string()
  .transform(soDigitos)
  .refine((v) => cpfValido(v), { message: 'CPF inválido' });

/** CNPJ — normaliza p/ 14 dígitos; mensagem PT. */
export const zCnpj = z
  .string()
  .transform(soDigitos)
  .refine((v) => cnpjValido(v), { message: 'CNPJ inválido' });

/** CPF ou CNPJ (pessoa física ou jurídica). */
export const zCpfCnpj = z
  .string()
  .transform(soDigitos)
  .refine((v) => cpfValido(v) || cnpjValido(v), { message: 'CPF/CNPJ inválido' });

/** Celular/telefone BR — 10 (fixo) ou 11 (celular) dígitos; normaliza. */
export const zCelular = z
  .string()
  .transform(soDigitos)
  .refine((v) => /^\d{10,11}$/.test(v), { message: 'Telefone/celular inválido (use DDD + número)' });

/** E-mail — mensagem PT. */
export const zEmail = z.string().trim().toLowerCase().email('E-mail inválido');

/** CEP — 8 dígitos; normaliza. */
export const zCep = z
  .string()
  .transform(soDigitos)
  .refine((v) => /^\d{8}$/.test(v), { message: 'CEP inválido' });

/** UF — 2 letras (sigla de estado). */
export const zUf = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => /^[A-Z]{2}$/.test(v), { message: 'UF inválida (use a sigla de 2 letras)' });
