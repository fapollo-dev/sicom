import { formaPgtoSchema, atualizarFormaPgtoSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';
import { sql } from 'kysely';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';

/**
 * FORMAS DE PAGAMENTO (uCadFormaPgto) — corte-1, DECLARATIVO. empresaScoped (IDEMPRESA, como
 * contas_bancarias), PK IDPGTO por sequence (pkGerada:true). MODALIDADE/ATALHO únicos por empresa
 * (índices parciais → 409). A regra cross-field DESTINO='QUE'≠PDV vive no zod (superRefine, back+front).
 * Soft-delete = campo `inativo` (o legado usa INATIVO, não INDR) + hard-delete do engine (como
 * contas_bancarias.ativo). Prerequisito do Caixa corte-2d (contábil por modalidade + tesouraria).
 */
export const formasPgtoCrudConfig: CrudConfig = {
  tabela: 'formas_pgto',
  pk: 'idpgto',
  view: 'get_formas_pgto',
  empresaScoped: true, // IDEMPRESA (carimba no create, filtra no read/list)
  colunas: [
    'modalidade', 'atalho', 'destino',
    'plccofre', 'codcontacorrente', 'codplanocontas',
    'recebe_pdv', 'permite_sangria_pdv', 'lanc_movimento_individual', 'tipo', 'inativo', 'data_inativo',
    // o resto da tela (uCadFormaPgto.dfm) e o que o binário novo grava
    'comissao', 'troco_limite', 'acre_desc', 'codcontabil', 'codconpagto', 'valor_minimo_fv', 'cfopdentrodoestado', 'cfopforadoestado',
    'idpgto_pai', 'exige_permissao', 'baixa_documento_automatico',
  ],
  rbacForm: 'FRMCADFORMAPGTO',
  // a LOG do form-base (uCadMaster.pas:485): o título da tela como a produção grava — o "Registro de log" a mostra
  log: { formulario: 'Formas de pagamento' },
  colunasPesquisa: ['idpgto', 'modalidade', 'atalho', 'destino'],
  replica: false,
  // soft-delete legado (INATIVO+DATA_INATIVO): ao inativar, carimba a data; ao reativar, limpa.
  derivar: (dto) => {
    const d: Record<string, unknown> = {};
    if (dto.inativo === 'S') d.data_inativo = new Date();
    if (dto.inativo === 'N') d.data_inativo = null;
    // dtsPrincipalDataChange: o Troco Limite só existe para TEF/CRT — fora deles a tela o zera
    if ('destino' in dto && !['TEF', 'CRT'].includes(String(dto.destino)) && dto.troco_limite != null && Number(dto.troco_limite) !== 0) d.troco_limite = 0;
    return d;
  },
  // a aba "Condições de pagamento" (REL_FORMA_PAGAMENTO_CONDICAO) e as descrições dos códigos sem Pesquisa por código
  aoLer: async ({ db, row }) => {
    const condicoes = (await sql<{ codconpagto: number; condicao_pagamento: string | null }>`
      SELECT r.codconpagto, c.descricao AS condicao_pagamento
        FROM rel_forma_pagamento_condicao r LEFT JOIN condicoes_pagto c ON c.codconpagto = r.codconpagto
       WHERE r.idpgto = ${Number(row.idpgto)} ORDER BY r.codconpagto`.execute(db)).rows;
    const desc = row.codcontabil == null ? null
      : (await sql<{ descricao: string | null }>`SELECT descricao FROM codcontabil WHERE codcontabil::text = ${String(row.codcontabil)}`.execute(db)).rows[0]?.descricao ?? null;
    return { condicoes, desccontabil: desc };
  },
  // ValidaATALHO (btnGravarClick): "Atalho já utilizado para outra Forma de Pagamento, Verifique!" — por loja e por forma pai, como o índice
  // PGTO_IDEMPRESA_ATALHO da produção (o fonte de 2020 não olhava a forma pai; o binário novo a grava)
  validarTrx: async ({ trx, id, dto }) => {
    if (!('atalho' in dto) && !('idpgto_pai' in dto)) return;
    const atual = id == null ? undefined
      : (await sql<{ idempresa: number; atalho: string; idpgto_pai: number | null }>`SELECT idempresa, atalho, idpgto_pai FROM formas_pgto WHERE idpgto = ${id}`.execute(trx)).rows[0];
    const emp = atual?.idempresa ?? currentTenant().empresaId ?? -1;
    const atalho = 'atalho' in dto ? String(dto.atalho ?? '') : String(atual?.atalho ?? '');
    const pai = 'idpgto_pai' in dto ? (dto.idpgto_pai as number | null | undefined) ?? null : atual?.idpgto_pai ?? null;
    const dup = (await sql`
      SELECT 1 FROM formas_pgto
       WHERE idempresa = ${emp} AND upper(atalho) = upper(${atalho}) AND coalesce(idpgto_pai, 0) = coalesce(${pai}::numeric, 0) AND idpgto <> ${id ?? -1}
       LIMIT 1`.execute(trx)).rows.length;
    if (dup) throw new BusinessRuleError('FORMA_PGTO_ATALHO_EM_USO');
  },
  aposGravarTrx: async ({ trx, id, dto }) => {
    if (Array.isArray(dto.condicoes)) {
      await sql`DELETE FROM rel_forma_pagamento_condicao WHERE idpgto = ${id}`.execute(trx);
      for (const c of new Set((dto.condicoes as unknown[]).map(Number))) {
        await sql`INSERT INTO rel_forma_pagamento_condicao (idpgto, codconpagto) VALUES (${id}, ${c})`.execute(trx);
      }
    }
    // btnGravarClick: com Desc/Acres. ≠ 0, `UPDATE FORMAS_PGTO SET ACRE_DESC = x WHERE MODALIDADE LIKE '%<modalidade>%'` — em TODAS as
    // lojas e em toda modalidade que CONTÉM o nome (a de "CARTAO" leva junto "CARTAO CREDITO"). Fiel; documentado no dossiê.
    const linha = (await sql<{ modalidade: string; acre_desc: string | null }>`SELECT modalidade, acre_desc FROM formas_pgto WHERE idpgto = ${id}`.execute(trx)).rows[0];
    const acre = Number(linha?.acre_desc ?? 0);
    if (linha && acre !== 0) {
      await sql`UPDATE formas_pgto SET acre_desc = ${acre} WHERE modalidade LIKE ${'%' + linha.modalidade + '%'}`.execute(trx);
    }
  },
};

export const FormasPgtoCrudController = createCrudController({
  path: 'cadastro/formas-pgto',
  config: formasPgtoCrudConfig,
  schema: formaPgtoSchema,
  updateSchema: atualizarFormaPgtoSchema,
});
