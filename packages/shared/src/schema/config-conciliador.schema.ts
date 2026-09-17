import { z } from 'zod';

/**
 * CONFIGURADOR DE CONCILIAÇÃO DE CARTÕES (`FRMCADCONFIGCONCILIADOR`).
 *
 * O layout com que se lê a planilha de cada operadora. ⚠️ a tela não veio no fonte clonado; os domínios
 * abaixo saíram dos 7 layouts e 40 itens da produção — ver a migration 230.
 */

/** os campos de `ITENS_MANCARTAO` que um layout pode alimentar. Os 8 usados no cliente vêm primeiro. */
export const CAMPOS_CONCILIADOR = [
  'DTVENDA', 'DTCREDITO', 'VRBRUTO', 'VRLIQUIDO', 'NSU', 'AUTORIZACAO', 'CODESTABELECIMENTO', 'NUMEROCARTAO',
  'BANDEIRA', 'PARCELAS', 'NROPARCELA', 'VRCOMISSAO', 'TXSERVICO', 'CUPOMFISCAL', 'NOMELOJA', 'RESUMO',
] as const;

/** `Texto` (23 itens) · `Data` (9) · `Valor` (5) · `Fixo` (3) — a contagem é a da produção. */
export const TIPOS_CAMPO_CONCILIADOR = ['Texto', 'Data', 'Valor', 'Fixo'] as const;

export const TIPOS_IMPORTACAO_CONCILIADOR = ['EXCEL', 'TEXTO'] as const;
export const SEPARACOES_CONCILIADOR = ['COLUNAS EXCEL', 'POSICAO FIXA', 'DELIMITADO'] as const;

const simNao = z.enum(['S', 'N']);

export const configConciliadorItemSchema = z.object({
  cici_campo_tabela: z.enum(CAMPOS_CONCILIADOR),
  cici_tipo_campo: z.enum(TIPOS_CAMPO_CONCILIADOR),
  /** só em `Data`; no cliente é sempre `dd/MM/yyyy`. */
  cici_formato_campo: z.string().max(30).nullish(),
  /** a coluna da planilha — letras, como o Excel mostra. Nula, e só nula, quando o tipo é `Fixo`. */
  cici_posicao: z.string().regex(/^[A-Za-z]{1,3}$/, 'a coluna é uma letra (A, H, AB…)').nullish(),
  cici_tamanho: z.coerce.number().int().positive().max(4000).nullish(),
  cici_casas_decimais: z.coerce.number().int().min(0).max(6).nullish(),
  cici_valor_fixo: z.string().max(100).nullish(),
})
  // ⚠️ a regra que o dado prova: 3 de 3 itens `Fixo` têm valor e nenhuma coluna; 37 de 37 dos outros
  // tipos têm coluna e nenhum valor fixo.
  .refine((i) => (i.cici_tipo_campo === 'Fixo' ? !i.cici_posicao : !!i.cici_posicao), {
    message: 'item Fixo não tem coluna; item de coluna precisa dela', path: ['cici_posicao'],
  })
  .refine((i) => (i.cici_tipo_campo === 'Fixo' ? !!i.cici_valor_fixo : !i.cici_valor_fixo), {
    message: 'só item Fixo tem valor fixo', path: ['cici_valor_fixo'],
  })
  // `dd/MM/yyyy` só aparece em item `Data`; os outros 31 têm formato nulo.
  .refine((i) => (i.cici_tipo_campo === 'Data' ? !!i.cici_formato_campo : !i.cici_formato_campo), {
    message: 'o formato é do item Data', path: ['cici_formato_campo'],
  });

/** os quatro campos que os 7 layouts do cliente têm sem exceção — sem eles a conciliação não casa nada. */
export const CAMPOS_OBRIGATORIOS_CONCILIADOR = ['DTVENDA', 'VRBRUTO', 'AUTORIZACAO', 'CODESTABELECIMENTO'] as const;

export const configConciliadorSchema = z.object({
  cic_descricao: z.string().trim().min(1).max(100),
  cic_tipo_importacao: z.enum(TIPOS_IMPORTACAO_CONCILIADOR).default('EXCEL'),
  cic_linha_inicio_importacao: z.coerce.number().int().min(1).max(9999).default(1),
  cic_tipo_separacao_campos: z.enum(SEPARACOES_CONCILIADOR).default('COLUNAS EXCEL'),
  buscadataempvlr: simNao.default('N'),
  buscadatavlrcartao: simNao.default('N'),
  buscansu: simNao.default('N'),
  buscaautorizacao: simNao.default('N'),
  itens: z.array(configConciliadorItemSchema).min(1),
})
  // sem chave de casamento o arquivo entra e nada concilia — os 7 do cliente têm pelo menos uma ligada.
  .refine((c) => [c.buscadataempvlr, c.buscadatavlrcartao, c.buscansu, c.buscaautorizacao].includes('S'), {
    message: 'escolha ao menos uma chave de casamento', path: ['buscaautorizacao'],
  })
  .refine((c) => {
    const campos = c.itens.map((i) => i.cici_campo_tabela);
    return CAMPOS_OBRIGATORIOS_CONCILIADOR.every((f) => campos.includes(f));
  }, { message: 'faltam campos obrigatórios (data da venda, valor bruto, autorização, estabelecimento)', path: ['itens'] })
  .refine((c) => new Set(c.itens.map((i) => i.cici_campo_tabela)).size === c.itens.length, {
    message: 'um campo não pode aparecer duas vezes no layout', path: ['itens'],
  })
  .refine((c) => {
    const pos = c.itens.map((i) => i.cici_posicao?.toUpperCase()).filter(Boolean);
    return new Set(pos).size === pos.length;
  }, { message: 'uma coluna não pode alimentar dois campos', path: ['itens'] });

export type ConfigConciliadorDto = z.infer<typeof configConciliadorSchema>;
export type ConfigConciliadorItemDto = z.infer<typeof configConciliadorItemSchema>;
