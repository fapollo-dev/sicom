import { z } from 'zod';

/**
 * AGENDA DE PROMOÇÃO (uCadAgendaPromocao) — corte-1 núcleo. Campanha nomeada com PERÍODO (data+hora) e N itens
 * (produto + preço promocional + ativo + preço-clube + qtd-máx + flags de mídia). Mensagens PT (ADR-015).
 * empresaScoped (IDEMPRESA pelo engine). A APLICAÇÃO ao multi_preco é o corte-2; efeito-PDV adiado.
 */

const opcional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());

const dec = (inner: z.ZodNumber = z.number()) =>
  z.preprocess((v) => {
    if (v === '' || v == null) return undefined;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return v;
  }, inner.optional());

const sn = () => z.enum(['S', 'N']);
/** flag de mídia do item: 'T'/'F' no legado (dmCadAgendaPromocao.pas:350; 15.865 de 15.865 itens desde 2025 = 'F').
 *  Aceita o 'S'/'N' que o Apollo gravava antes da mig 312 e normaliza. */
const tf = () =>
  z.preprocess((v) => (v === '' || v == null ? undefined : v === 'S' ? 'T' : v === 'N' ? 'F' : v), z.enum(['T', 'F']).optional());

/** o STATUS da agenda (`FLAGPROMOCAO`, combo cbbStatus do form): N = ABERTA · E = EXECUTANDO · J = FECHADA. */
export const STATUS_AGENDA_PROMOCAO = { N: 'ABERTA', E: 'EXECUTANDO', J: 'FECHADA' } as const;

/** as lojas da agenda: o legado abre a seleção de empresas ao incluir (cdsAgendaPromocaoBeforeInsert) e grava a
 *  lista em cada item ('1, 2'); sem loja não grava ("Selecione as Empresas participantes", uCadAgendaPromocao:491). */
const lojas = () =>
  z.array(z.coerce.number().int().positive('Loja inválida.'), { message: 'Selecione as empresas participantes.' })
    .min(1, 'Selecione as empresas participantes.');

/** Item da agenda: produto + preço promocional. Regra do legado (uCadAgendaPromocao:651, Locate [0,0]): NÃO
 *  ambos zero — aceita vlrpromocao=0 se vrclube_fidelidade>0 (promoção só no clube). VRVENDA/derivados p/ round-trip. */
export const agendaPromocaoItemSchema = z
  .object({
    idproduto: z.coerce.number({ message: 'Produto inválido.' }).int().positive('Informe o produto do item.'),
    vlrpromocao: z.coerce
      .number({ message: 'Preço promocional inválido.' })
      .nonnegative('Preço promocional inválido.')
      .max(9_999_999, 'Preço promocional acima do limite.'),
    vrvenda: dec(z.number().nonnegative()), // snapshot do preço normal (referência)
    ativo: opcional(sn()), // default 'S' no servidor
    vrclube_fidelidade: dec(z.number().nonnegative()),
    maximo: dec(z.number().nonnegative()),
    vlr_min_compra: dec(z.number().nonnegative()),
    tv: tf(),
    radio: tf(),
    tabloide: tf(),
    interno: tf(),
    nroitem: dec(z.number().int().nonnegative()),
  })
  .superRefine((it, ctx) => {
    // fiel ao legado: rejeita só quando preço promo E preço clube são ambos zero.
    if (!(Number(it.vlrpromocao) > 0) && !(Number(it.vrclube_fidelidade) > 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vlrpromocao'], message: 'Informe o preço promocional ou o preço do clube (maior que zero).' });
    }
  });
export type AgendaPromocaoItemDto = z.infer<typeof agendaPromocaoItemSchema>;

const base = z.object({
  nomepromo: z.string({ message: 'Informe o nome da promoção.' }).trim().min(1, 'Informe o nome da promoção.').max(200),
  // período com data+hora (ISO 'YYYY-MM-DDTHH:mm'); ambos obrigatórios; dtfim > dtini (superRefine).
  dtiniciopromocao: z.string({ message: 'Informe o início da promoção.' }).trim().min(1, 'Informe o início da promoção.'),
  dtfimpromocao: z.string({ message: 'Informe o fim da promoção.' }).trim().min(1, 'Informe o fim da promoção.'),
  flagpromocao: opcional(z.enum(['N', 'E', 'J'], { message: 'Status inválido (ABERTA, EXECUTANDO ou FECHADA).' })),
  opcoes: dec(z.number().int()),
  obs: opcional(z.string().trim().max(4000)),
});

const validaPeriodo = (d: { dtiniciopromocao?: string; dtfimpromocao?: string }, ctx: z.RefinementCtx) => {
  if (d.dtiniciopromocao && d.dtfimpromocao) {
    const ini = new Date(d.dtiniciopromocao).getTime();
    const fim = new Date(d.dtfimpromocao).getTime();
    if (Number.isFinite(ini) && Number.isFinite(fim) && fim <= ini) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dtfimpromocao'], message: 'O fim da promoção deve ser posterior ao início.' });
    }
  }
};

export const agendaPromocaoSchema = base
  .extend({ empresas: lojas(), itens: z.array(agendaPromocaoItemSchema).min(1, 'Informe ao menos um item na promoção.') })
  .superRefine(validaPeriodo);
export type AgendaPromocaoDto = z.infer<typeof agendaPromocaoSchema>;

export const atualizarAgendaPromocaoSchema = base
  .extend({ empresas: lojas().optional(), itens: z.array(agendaPromocaoItemSchema).optional() })
  .partial()
  .superRefine(validaPeriodo);

export interface AgendaPromocao {
  codagenda?: number;
  idempresa?: number;
  nomepromo?: string | null;
  dtiniciopromocao: string;
  dtfimpromocao: string;
  flagpromocao?: string | null;
  opcoes?: number | null;
  obs?: string | null;
  dtencerramento?: string | null;
  situacao?: string | null; // ENCERRADA/AGENDADA/VIGENTE/EXPIRADA (view)
  status?: string | null; // ABERTA/EXECUTANDO/FECHADA (view, do FLAGPROMOCAO)
  dataexecucao?: string | null;
  /** na view: '1, 2'; na leitura por id: a lista de lojas */
  empresas?: string | number[] | null;
  qtde_itens?: number | string | null;
  itens?: AgendaPromocaoItemDto[];
}
