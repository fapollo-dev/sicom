import { z } from 'zod';

/**
 * GESTÃO DE PROMOÇÕES (UCadPromocao) — header PROMOCAO + detalhe CLUBE_DESCONTO (motor por ORIGEM). O seletor
 * TIPO escolhe a mecânica (aba). corte-1: casca + aba Preço Fixo (ORIGEM='P': produto + preço fixo). As colunas
 * de payload das outras mecânicas já existem no item (próximos cortes só as preenchem).
 */
const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());
const dec = (inner: z.ZodNumber = z.number()) =>
  z.preprocess((v) => {
    if (v == null) return undefined;
    if (typeof v === 'string') {
      const t = v.trim();
      if (t === '') return undefined; // trim: string em-branco → undefined (não 0)
      const n = Number(t.replace(',', '.'));
      return Number.isNaN(n) ? v : n;
    }
    return v;
  }, inner.optional());
const sn = () => z.enum(['S', 'N']);

/** mecânica (PROMOCAO.TIPO): C categoria · O combo · A atacarejo · B bonificação · F desc.fixo($) · V desc.var(%)
 *  · D desc.adicional · P preço fixo · G produto grátis · L leve-pague · R código promocional. */
export const PROMO_TIPO = z.enum(['C', 'O', 'A', 'B', 'F', 'V', 'D', 'P', 'G', 'L', 'R']);
/** público (PROMOCAO.DESTINO): C clientes · I izio · U clube · F funcionários · P perfil · T todos. */
export const PROMO_DESTINO = z.enum(['C', 'I', 'U', 'F', 'P', 'T']);

/** item do detalhe (CLUBE_DESCONTO). `origem` = a mecânica da linha (letra); os demais campos são o payload
 *  da mecânica (Preço Fixo usa idorigempromocao=produto + valor=preço). */
export const promocaoItemSchema = z.object({
  origem: z.string().trim().min(1, 'Origem do item obrigatória.').max(2),
  idorigempromocao: opcional(z.coerce.number().int().positive()),
  tipo: opcional(z.enum(['$', '%'])),
  subtipo: opcional(z.string().trim().max(1)),
  destino: opcional(z.string().trim().max(1)),
  valor: dec(z.number().nonnegative()),
  valorcombo: dec(z.number().nonnegative()),
  tipocombo: opcional(z.string().trim().max(1)),
  quantidade: dec(z.number().nonnegative()),
  quantidade_paga: dec(z.number().nonnegative()),
  minimo: dec(z.number().nonnegative()),
  maximo: dec(z.number().nonnegative()),
  maximo_estoque: dec(z.number().nonnegative()),
  preco_grupo: opcional(sn()),
  grupo: opcional(z.coerce.number().int()),
  codigo_promocional: opcional(z.string().trim().max(30)),
  codperfil_parceiro: opcional(z.string().trim().max(255)),
  codparceiro: opcional(z.string().trim().max(255)), // real VARCHAR2(255): CSV I/E-prefixado, não FK inteira
  valor_minimo_compra: dec(z.number().nonnegative()),
  id_formas_pgto: opcional(z.string().trim().max(255)), // real VARCHAR2(255): CSV de formas de pgto
  ativo: opcional(sn()),
});
export type PromocaoItemDto = z.infer<typeof promocaoItemSchema>;

const base = z.object({
  descricao: z.string({ message: 'Informe a descrição da promoção.' }).trim().min(1, 'Informe a descrição da promoção.').max(150),
  tipo: PROMO_TIPO,
  datainicio: opcional(z.string()),
  datafim: opcional(z.string()),
  empresas: opcional(z.string().trim().max(50)),
  opcao: opcional(z.string().trim().max(1)),
  destino: opcional(PROMO_DESTINO),
  valorcombo: dec(z.number().nonnegative()),
  tipocombo: opcional(z.string().trim().max(1)),
  valor_minimo_compra: dec(z.number().nonnegative()),
  itens: z.array(promocaoItemSchema).optional().default([]),
});

const refineDatas = (d: { datainicio?: string; datafim?: string }, ctx: z.RefinementCtx) => {
  // legado: vdDtFim <= vdDtinicio é inválido (UCadPromocao.pas ~908) — o fim tem de ser ESTRITAMENTE após o início.
  if (d.datainicio && d.datafim && d.datafim <= d.datainicio) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['datafim'], message: 'O fim da promoção deve ser posterior ao início.' });
  }
};

export const promocaoSchema = base.superRefine(refineDatas as any);
export const atualizarPromocaoSchema = base.partial().superRefine(refineDatas as any);
export type CriarPromocaoDto = z.infer<typeof base>;

export interface Promocao {
  idpromocao: number;
  idempresa?: number;
  descricao?: string;
  tipo?: string;
  destino?: string;
  opcao?: string;
  datainicio?: string;
  datafim?: string;
  empresas?: string;
  qtde_itens?: number;
  indr?: string | null;
}
