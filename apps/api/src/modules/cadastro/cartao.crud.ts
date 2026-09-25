import { cartaoSchema, atualizarCartaoSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';
import { sql } from 'kysely';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { SenhaOperacaoService } from './senha-operacao.service';
import { currentTenant } from '../../shared/tenant/tenant-context';

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
/** o `FormatFloat('0,00', …)` do Delphi em pt-BR: inteiro arredondado, no mínimo 3 dígitos, milhar com ponto ("014", "1.235") */
const fmt000 = (v: unknown) => String(Math.round(num(v))).padStart(3, '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** o `DateTimeToStr` pt-BR no fuso da loja */
const dataHora = (v: unknown) => {
  if (v == null || v === '') return '';
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}:${g('second')}`;
};

/**
 * O HISTORICO da alteração do cartão (`SetaHistorico('CARTAO', 'CODVENDCARTAO', 'UPDATE', …)`, UcadCartao.pas:360 → udmPrincipal.pas:3038):
 * uma linha por campo do `cdsCartao` que mudou, na ordem do dataset (UDMcadCartao.dfm), "ALTERACAO DO CAMPO X DE: a PARA: b" — inteiro
 * como inteiro, VALOR no `FormatFloat('0,00')`, DTVENDA no `DateTimeToStr` e as descrições das pesquisas (OPERADORA, MODALIDADE) também,
 * como a produção (660 CODOPERADORA e 659 OPERADORA em 2025-26). CODDOC = o cartão, DATA = o dia, sem hora. O Apollo gravava o
 * HISTORICO_DINAMICO, que o legado não grava para o cartão (0 linhas).
 */
async function historicoDaAlteracao(trx: any, id: number, dto: Record<string, unknown>): Promise<void> {
  const antes = (await sql<Record<string, unknown>>`SELECT c.*, o.operadora AS operadora, f.modalidade AS modalidade_desc
      FROM cartao c LEFT JOIN operadoras o ON o.codoperadoras = c.codoperadora LEFT JOIN formas_pgto f ON f.idpgto = c.idpgto
     WHERE c.codvendcartao = ${id}`.execute(trx)).rows[0];
  if (!antes) return;
  const depois: Record<string, unknown> = { ...antes };
  for (const [k, v] of Object.entries(dto)) if (v !== undefined) depois[k] = v;
  depois.consiliado = 'S';
  if (num(depois.codoperadora) !== num(antes.codoperadora)) {
    depois.operadora = (await sql<{ d: string | null }>`SELECT operadora AS d FROM operadoras WHERE codoperadoras = ${num(depois.codoperadora)}`.execute(trx)).rows[0]?.d ?? '';
  }
  if (num(depois.idpgto) !== num(antes.idpgto)) {
    depois.modalidade_desc = (await sql<{ d: string | null }>`SELECT modalidade AS d FROM formas_pgto WHERE idpgto = ${num(depois.idpgto)}`.execute(trx)).rows[0]?.d ?? '';
  }
  const t = (v: unknown) => (v == null ? '' : String(v));
  const i = (v: unknown) => String(Math.trunc(num(v)));
  const campos: Array<[string, (r: Record<string, unknown>) => string]> = [
    ['NROCUPOM', (r) => t(r.nrocupom)], ['VALOR', (r) => fmt000(r.valor)], ['DTVENDA', (r) => dataHora(r.dtvenda)], ['NROPEDIDO', (r) => t(r.nropedido)],
    ['CODOPERADORA', (r) => i(r.codoperadora)], ['OBS', (r) => t(r.obs)], ['OPERADORA', (r) => t(r.operadora)], ['NROPARCELA', (r) => i(r.nroparcela)],
    ['IDPGTO', (r) => i(r.idpgto)], ['MODALIDADE', (r) => t(r.modalidade_desc)], ['CONSILIADO', (r) => t(r.consiliado)], ['CODPDV', (r) => i(r.codpdv)],
    ['NSU', (r) => t(r.nsu)], ['NSUHOST', (r) => t(r.nsuhost)], ['AUTORIZACAO', (r) => t(r.autorizacao)], ['CODREDE', (r) => i(r.codrede)],
  ];
  const { operadorId, empresaId } = currentTenant();
  for (const [campo, f] of campos) {
    const a = f(antes);
    const b = f(depois);
    if (a === b) continue;
    await sql`INSERT INTO historico (coddoc, tabela, historico, data, codoperador, codempresa)
        VALUES (${String(id)}, 'CARTAO', ${`ALTERACAO DO CAMPO ${campo} DE: ${a} PARA: ${b}`.slice(0, 600)}, current_date, ${operadorId ?? null}, ${empresaId ?? null})`.execute(trx);
  }
}

/**
 * CARTÃO (FRMCADCARTAO) — recebível de cartão, corte-1: cadastro/consulta (SEM baixa). CRUD de linha única lendo a
 * view `get_cartao` (que COMPUTA o líquido = bruto − bruto×txadm/100 e o vencimento = dtvenda + diascomp×parcela,
 * pulando fim de semana — espelha o GET_CARTAO do legado). O front filtra por LIBERADO (aberto/baixado). No corte-1
 * o recebível nasce sempre LIBERADO='N' (o default do banco) — a baixa (LIBERADO='S') é o corte-2. empresaScoped.
 * Exclusão física (o legado não tem INDR no cartão). Travas de "não editar baixado" ficam p/ o corte da baixa.
 */
export const cartaoCrudConfig: CrudConfig = {
  tabela: 'cartao',
  pk: 'codvendcartao',
  pkGerada: true,
  view: 'get_cartao',
  rbacForm: 'FRMCADCARTAO',
  // a LOG do form-base (uCadMaster.pas:485): o título da tela como a produção grava — o "Registro de log" a mostra
  log: { formulario: 'Lançamento de Cartões' },
  // o legado grava o HISTORICO em texto (SetaHistorico), não o HISTORICO_DINAMICO — ver `historicoDaAlteracao`
  historico: false,
  empresaScoped: true,
  // NSUHOST e CODREDE: os campos da conciliação (445 e 178 alterações no HISTORICO de 2025-26); CONSILIADO vai 'S' em toda
  // gravação (UcadCartao.pas:366-367 — 94% dos cartões de 2026 conciliados)
  colunas: ['dtvenda', 'valor', 'codoperadora', 'idpgto', 'nrocupom', 'nropedido', 'codpdv', 'nroparcela', 'qtde_parcelas', 'tipocartao', 'codbandeira', 'nsu', 'autorizacao', 'nrocartao', 'obs', 'nsuhost', 'codrede', 'consiliado'],
  derivar: () => ({ consiliado: 'S' }),
  // "Documento ja consiliado na tesouraria, não é possivel alteração de valores!" (btnEditarClick :283-290): o VALOR e a
  // PARCELA do cartão conciliado não mudam
  validarTrx: async ({ trx, id, dto }) => {
    if (id == null) return;
    const c = (await sql<{ consiliado: string | null; valor: unknown; nroparcela: unknown }>`
      SELECT consiliado, valor, nroparcela FROM cartao WHERE codvendcartao = ${id}`.execute(trx)).rows[0];
    if (c && String(c.consiliado ?? '') === 'S') {
      const mudou = (novo: unknown, atual: unknown) => novo !== undefined && Number(novo ?? 0) !== Number(atual ?? 0);
      if (mudou(dto.valor, c.valor) || mudou(dto.nroparcela, c.nroparcela)) throw new BusinessRuleError('CARTAO_CONCILIADO_VALOR', { codvendcartao: id });
    }
    if (c) await historicoDaAlteracao(trx, id, dto);
  },
  // "Documento ja conciliado na tesouraria, não é possivel excluí-lo!" — só com a senha administrativa (btnExcluirClick :293-300)
  validarRemocaoTrx: async ({ trx, id, senhaAdmin, dbp }) => {
    const c = (await sql<{ consiliado: string | null; nropedido: unknown; valor: unknown }>`SELECT consiliado, nropedido, valor FROM cartao WHERE codvendcartao = ${id}`.execute(trx)).rows[0];
    if (!c) return;
    if (String(c.consiliado ?? '') === 'S') {
      if (!senhaAdmin) throw new BusinessRuleError('CARTAO_CONCILIADO_EXCLUSAO', { codvendcartao: id });
      const { ok } = await new SenhaOperacaoService(dbp).verificar('admin', senhaAdmin);
      if (!ok) throw new BusinessRuleError('SENHA_ADM_INVALIDA');
    }
    // "EXCLUSAO DO REGISTRO , NROPEDIDO: x, VALOR: 014" (UcadCartao.pas:302-305 → SetaHistorico 'DELETE'; 152 exclusões em 2025-26)
    const { operadorId, empresaId } = currentTenant();
    await sql`INSERT INTO historico (coddoc, tabela, historico, data, codoperador, codempresa)
        VALUES (${String(id)}, 'CARTAO', ${`EXCLUSAO DO REGISTRO , NROPEDIDO: ${c.nropedido ?? ''}, VALOR: ${fmt000(c.valor)}`}, current_date, ${operadorId ?? null}, ${empresaId ?? null})`.execute(trx);
  },
  colunasPesquisa: ['codvendcartao', 'dtvenda', 'operadora', 'liberado', 'nrocupom', 'nropedido', 'valor'],
};

export const CartaoCrudController = createCrudController({
  path: 'cadastro/cartao',
  config: cartaoCrudConfig,
  schema: cartaoSchema,
  updateSchema: atualizarCartaoSchema,
});
