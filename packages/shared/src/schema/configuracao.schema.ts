import { z } from 'zod';

/**
 * CONFIGURAÇÕES — gestão da camada chave-valor (tela UConfigura). O operador grava OVERRIDES por escopo
 * (CONFIGURACOES_ESPECIFICAS: Empresa/Usuario/Modulo) e/ou o default global (CONFIGURACOES.VALOR). O valor
 * é sempre STRING (o cast — ==='S', Number(...) — é do consumidor, como no legado).
 */
export const ESCOPO_CONFIG = ['Empresa', 'Usuario', 'Modulo'] as const;
export type EscopoConfig = (typeof ESCOPO_CONFIG)[number];

/** grava/atualiza um override de escopo. `chave` = CODEMPRESA (Empresa) / CODOPERADOR (Usuario) / módulo (Modulo). */
export const configOverrideSchema = z.object({
  tipo: z.enum(ESCOPO_CONFIG),
  chave: z.union([z.string(), z.number()]).transform((v) => String(v)).pipe(z.string().min(1).max(30)),
  valor: z.string().min(1, 'Informe o valor.').max(250),
});
export type ConfigOverrideDto = z.infer<typeof configOverrideSchema>;

/** altera o default global da chave. */
export const configDefaultSchema = z.object({
  valor: z.string().min(1, 'Informe o valor.').max(250),
});
export type ConfigDefaultDto = z.infer<typeof configDefaultSchema>;
