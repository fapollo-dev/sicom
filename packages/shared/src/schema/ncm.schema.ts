import { z } from 'zod';

/**
 * Cadastro de NCM (legado `NCM`) — completa o PALETTE (data + memo) e prova a
 * CHAVE NATURAL: `codigo` é DIGITADO pelo usuário (não sequence). Datas como ISO
 * 'YYYY-MM-DD' (DateField); descricao/categoria/observacao são memos (TextArea, CLOB
 * no legado).
 */

/**
 * Unidade tributada (combo cbbUnidadeTributada, uCadNCM.dfm ~199-234).
 * Pares label→value EXATOS do .dfm (Items.Strings → Values.Strings, mesma ordem).
 */
export const UN_TRIBUTADA = [
  { value: 'UN', label: 'UNIDADE' },
  { value: 'DUZIA', label: 'DUZIA' },
  { value: 'TON', label: 'TONEL METR LIQUIDA' },
  { value: 'M2', label: 'METRO QUADRADO' },
  { value: 'QUILAT', label: 'QUILATE' },
  { value: 'LT', label: 'LITRO' },
  { value: 'METRO', label: 'METRO' },
  { value: 'G', label: 'GRAMA' },
  { value: 'M3', label: 'METRO CUBICO' },
  { value: 'KG', label: 'QUILOGRAMA' },
  { value: '1000UN', label: 'MIL UNIDADES' },
  { value: 'PARES', label: 'PARES' },
  { value: 'MWHORA', label: 'MEGAWATT HORA' },
] as const;

const UN_TRIBUTADA_VALUES = UN_TRIBUTADA.map((u) => u.value) as [string, ...string[]];

export const ncmSchema = z
  .object({
    // chave natural: obrigatória no insert (o usuário digita o código NCM)
    codigo: z.number().int('Código NCM inválido').positive('Código NCM inválido'),
    // NCMSH é DERIVADO no service (ConcatenaLeft(CODIGO,8,'0')) e read-only na tela —
    // não é entrada do usuário; o servidor sobrepõe sempre.
    ncmsh: z.string().trim().max(20).optional(),
    // DESCRICAO é NOT NULL + obrigatória no legado (btnGravarClick).
    descricao: z.string().trim().min(1, 'Informe a descrição do NCM!').max(500),
    // IPI existe na tabela p/ data load, mas NÃO é editado por esta tela (sem controle no .dfm).
    ipi: z.string().trim().max(3).optional(),
    categoria: z.string().trim().optional(),
    un_tributada: z.enum(UN_TRIBUTADA_VALUES, { message: 'Unidade tributada inválida' }).optional(),
    un_tributada_descricao: z.string().trim().max(50).optional(),
    vigencia_inicio: z.string().optional(), // ISO date 'YYYY-MM-DD'
    vigencia_fim: z.string().optional(),
    observacao: z.string().trim().optional(),
  })
  // coerência de vigência (btnGravarClick): fim não pode ser menor que início.
  .refine((d) => !d.vigencia_fim || !d.vigencia_inicio || d.vigencia_inicio <= d.vigencia_fim, {
    message: 'A data fim da vigência não pode ser menor que a data de início da vigência!',
    path: ['vigencia_fim'],
  });

export type CriarNcmDto = z.infer<typeof ncmSchema>;

// no update a PK não muda → parcial e sem exigir codigo. O refine de vigência é
// reaplicado (z.partial não preserva refines de objeto refinado).
export const atualizarNcmSchema = z
  .object({
    codigo: z.number().int('Código NCM inválido').positive('Código NCM inválido').optional(),
    ncmsh: z.string().trim().max(20).optional(),
    descricao: z.string().trim().min(1, 'Informe a descrição do NCM!').max(500).optional(),
    ipi: z.string().trim().max(3).optional(),
    categoria: z.string().trim().optional(),
    un_tributada: z.enum(UN_TRIBUTADA_VALUES, { message: 'Unidade tributada inválida' }).optional(),
    un_tributada_descricao: z.string().trim().max(50).optional(),
    vigencia_inicio: z.string().optional(),
    vigencia_fim: z.string().optional(),
    observacao: z.string().trim().optional(),
  })
  .refine((d) => !d.vigencia_fim || !d.vigencia_inicio || d.vigencia_inicio <= d.vigencia_fim, {
    message: 'A data fim da vigência não pode ser menor que a data de início da vigência!',
    path: ['vigencia_fim'],
  });
export type AtualizarNcmDto = z.infer<typeof atualizarNcmSchema>;

export interface Ncm extends CriarNcmDto {
  codigo: number;
}
