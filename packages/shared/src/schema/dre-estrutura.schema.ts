import { z } from 'zod';

/**
 * CONFIGURADOR DO DRE CONTÁBIL (`FRMCONFIGDRECONTABIL`, `UFrmCadConfigDREContabil.pas`).
 *
 * O editor da árvore que a migration 047 deixou declarado como corte-2: *"o editor da estrutura é corte-2
 * (aqui a estrutura é semeada, fiel ao modelo)"*.
 *
 * Cada linha do DRE é um nó com **código expandido** (`01`, `01.001`, `01.001.0001`), um **tipo de cálculo**
 * e uma **classe**. No cliente são 98 linhas em 3 níveis, todas ativas.
 */

/** `P` soma as contas vinculadas · `F` soma as filhas · `E` avalia a expressão. */
export const TIPOS_CALCULO_DRE = [
  { value: 'P', label: 'Soma as contas vinculadas', classe: 'A' },
  { value: 'F', label: 'Soma as linhas filhas', classe: 'S' },
  { value: 'E', label: 'Expressão', classe: 'S' },
] as const;

/** `A` analítica (recebe vínculo de conta) · `S` sintética (agrega). */
export const CLASSES_DRE = ['A', 'S'] as const;

export const dreEstruturaSchema = z.object({
  /** a máscara hierárquica; é ela que o operador lê e a expressão referencia. */
  codexpandido: z.string().trim().min(1).max(30).regex(/^[0-9.]+$/, 'só números e pontos'),
  descricao: z.string().trim().min(1).max(150),
  tipo_calculo: z.enum(['P', 'F', 'E']),
  classe: z.enum(CLASSES_DRE),
  expressao: z.string().trim().max(200).nullish(),
  nivel: z.coerce.number().int().min(1).max(9),
  codpai: z.coerce.number().int().positive().nullish(),
  ativo: z.enum(['S', 'N']).default('S'),
})
  // ⚠️ no cliente a correlação é PERFEITA: as 78 linhas `P` são todas classe `A` e as 20 sintéticas
  // (19 `F` + 1 `E`) são todas `S`. Deixar escolher livre criaria uma linha analítica que nunca recebe conta.
  .refine((l) => l.classe === TIPOS_CALCULO_DRE.find((t) => t.value === l.tipo_calculo)!.classe, {
    message: 'P é sempre analítica (A); F e E são sintéticas (S)', path: ['classe'],
  })
  // a expressão é do tipo `E` — 1 de 1 no cliente a tem, e as outras 97 estão nulas
  .refine((l) => (l.tipo_calculo === 'E' ? !!l.expressao : !l.expressao), {
    message: 'a expressão é do tipo E', path: ['expressao'],
  })
  // nível 1 é raiz: as 6 do cliente não têm pai, e as 92 dos níveis 2 e 3 têm todas
  .refine((l) => (l.nivel === 1 ? !l.codpai : !!l.codpai), {
    message: 'nível 1 é raiz e não tem pai; os demais precisam de um', path: ['codpai'],
  });

export const dreContaVinculoSchema = z.object({
  codestrutura: z.coerce.number().int().positive(),
  codplanocontas: z.array(z.coerce.number().int().positive()).min(1).max(20000),
});

export type DreEstruturaDto = z.infer<typeof dreEstruturaSchema>;
export type DreContaVinculoDto = z.infer<typeof dreContaVinculoSchema>;

/** as referências `<nn>` de uma expressão — `'<01>+<03>+<04>'` devolve `['01','03','04']`. */
export function referenciasDaExpressao(expr: string | null | undefined): string[] {
  if (!expr) return [];
  return [...expr.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim()).filter(Boolean);
}
