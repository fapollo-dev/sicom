import { z } from 'zod';

/**
 * PRODUÇÃO (FRMCADPRODUCAO — uCadProducao "Requisição de produção") — corte-1: manufatura açougue/padaria como
 * documento MESTRE-DETALHE (cabeçalho `producao` + itens de SAÍDA `itens_producao` = produtos ACABADOS a produzir).
 * O operador informa produto acabado + quantidade; o custo/venda (vrcusto/vrvenda) é SNAPSHOT server-authoritative
 * de MULTI_PRECO (o operador não digita custo). A ficha técnica (receita_prod) é explodida no PROCESSAR pelo serviço
 * (não entra no input). Cada acabado tem de possuir receita (validado no aggregate). status 'A'/'P'; editar/excluir
 * travado quando 'P'. empresaScoped; exclusão física (sem INDR).
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

/** Item de saída: produto ACABADO + quantidade a produzir (+ unidade/obs). vrcusto/vrvenda vêm do servidor. */
export const producaoItemSchema = z.object({
  idprodutos: z.coerce.number().int().positive({ message: 'Informe o produto acabado.' }),
  qtde: z.coerce.number().positive({ message: 'A quantidade a produzir deve ser maior que zero.' }),
  unidade: opcional(z.string().max(5)),
  // vrcusto/vrvenda NÃO entram no input: SNAPSHOT server-authoritative de MULTI_PRECO.
  observacao: opcional(z.string().max(1000)),
});
export type ProducaoItemDto = z.infer<typeof producaoItemSchema>;

export const producaoSchema = z.object({
  data: opcional(z.string()), // ISO; default = agora no service
  // codempresa_producao NÃO entra no input (fold auditoria [CRÍTICO]): o estoque move SEMPRE na empresa do tenant
  // (emp) — se o cliente pudesse escolher a empresa produtora, moveria o estoque de OUTRA empresa (write cross-tenant).
  // O servidor carimba codempresa_producao = emp (fiel: sempre 1→1 no tenant).
  codparceiro: dec(z.number().int()),
  codplc: dec(z.number().int()), // centro de custo (PLC)
  itens: z.array(producaoItemSchema).max(1000).optional(),
});
export type ProducaoDto = z.infer<typeof producaoSchema>;
export const atualizarProducaoSchema = producaoSchema.partial();
export type AtualizarProducaoDto = z.infer<typeof atualizarProducaoSchema>;
