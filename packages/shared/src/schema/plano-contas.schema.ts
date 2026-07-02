import { z } from 'zod';

/**
 * PLANO DE CONTAS (contábil) — uCadPlanoContas. Cadastro em ÁRVORE (CODPAI). O código de negócio é
 * a MÁSCARA `codiexpandido` (ex.: '1.1.03.01.0002'). `classe` T=sintética (agrupadora) / A=analítica
 * (folha lançável). `natureza` = grupo do balanço/DRE (1 Ativo/2 Passivo/3 PL/4 Resultado/5 Comp/9 Outras)
 * — NÃO é débito/credora. Global por schema (sem empresa). Mensagens PT (ADR-015). Máscara-config
 * e auto-código são corte-2; aqui o `codiexpandido` é digitado e validado (único + prefixo-do-pai).
 */

const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());

export const PC_CLASSE_OPCOES = [
  { value: 'A', label: 'Analítica (recebe lançamento)' },
  { value: 'T', label: 'Sintética (agrupadora)' },
] as const;

export const PC_NATUREZA_OPCOES = [
  { value: 1, label: '1 - Ativo' },
  { value: 2, label: '2 - Passivo' },
  { value: 3, label: '3 - Patrimônio Líquido' },
  { value: 4, label: '4 - Resultado (DRE)' },
  { value: 5, label: '5 - Compensação' },
  { value: 9, label: '9 - Outras' },
] as const;

const NATUREZAS = [1, 2, 3, 4, 5, 9] as const;

const planoContasBase = z.object({
  codiexpandido: z
    .string({ message: 'Informe o código da conta.' })
    .min(1, 'Informe o código da conta.')
    .max(30)
    .regex(/^[0-9.]+$/, 'O código deve conter apenas números e pontos (ex.: 1.1.03.01.0002).'),
  descricao: z.string({ message: 'Informe a descrição da conta.' }).min(1, 'Informe a descrição da conta.').max(120),
  classe: z.enum(['A', 'T'], { message: "Classe deve ser 'A' (analítica) ou 'T' (sintética)." }),
  natureza: z
    .number({ message: 'Informe a natureza da conta.' })
    .refine((n) => (NATUREZAS as readonly number[]).includes(n), 'Natureza inválida.'),
  codpai: opcional(z.number().int()),
  codireduzido: opcional(z.string().max(15)),
});

export const planoContasSchema = planoContasBase;
export const atualizarPlanoContasSchema = planoContasBase.partial();

export type CriarPlanoContasDto = z.infer<typeof planoContasBase>;

export interface PlanoConta {
  codplanocontas: number;
  codiexpandido?: string;
  codireduzido?: string;
  descricao: string;
  descricao_completa?: string;
  classe?: string; // T/A
  natureza?: number;
  nivel?: number;
  codpai?: number;
  tipo?: string;
  status?: string;
}
