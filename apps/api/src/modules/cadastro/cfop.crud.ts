import { sql } from 'kysely';
import { cfopSchema, atualizarCfopSchema } from '@apollo/shared';
import { createCrudController } from '../../shared/crud/crud.controller.factory';
import type { CrudConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';

const ENTRADAS = ['situacao_icms_entradas_nf', 'situacao_pis_entradas_nf', 'situacao_cofins_entradas_nf'];
const SAIDAS = ['situacao_icms_saidas_nf', 'situacao_pis_saidas_nf', 'situacao_cofins_saidas_nf'];
/** os códigos escolhidos numa lista: '' = limpar */
const LIMPAVEIS = [...ENTRADAS, ...SAIDAS, 'idsituacao_nf_saida', 'cfop_devolucao', 'codplanocontas', 'aliquota', 'cod_bc_credito', 'idpiscofins', 'codclass_trib', 'tipo_cfop'];

/** 1-3 entrada, 5-7 saída (a numeração do CFOP) */
function tipoPeloCodigo(cod: unknown): 'E' | 'S' | null {
  const d = String(cod ?? '').trim()[0];
  return d === '1' || d === '2' || d === '3' ? 'E' : d === '5' || d === '6' || d === '7' ? 'S' : null;
}

/**
 * CFOP (UCadCFOP) — o cadastro inteiro: as 45 colunas da tabela do legado (a tela editava 11 até a mig 346). Chave natural
 * (codcfop char(4)), hard-delete. As regras da tela:
 *  - `btnGravarClick`: sem PROCESSA FINANCEIRO ('N' ou vazio) o GERA_FINANCEIRO_AUTO vira 'N';
 *  - `SetTipoCFOP`: o TIPO habilita um lado da aba "Situação do documento" e LIMPA o outro ao editar (na produção nenhum CFOP de
 *    entrada tem situação de saída, e vice-versa — 398 de 398);
 *  - `segCFOP`: o CFOP de devolução tem de ser um CFOP DEVOLUCAO='S' do mesmo destino ("Não foi encontrado nenhum CFOP de devolução
 *    para o mesmo destino com o código digitado!" — 23 de 23 na produção);
 *  - a alíquota de saída é uma da DET_ALIQUOTA da UF da empresa (`SetAliquota`);
 *  - a conta contábil existe no plano (o filtro "analítica" do fonte de 2020 não vale: a conta de 395 CFOPs é a 173, sintética);
 *  - CODCONTABIL fica só de leitura: a validação é contra a tabela CODCONTABIL, vazia na produção.
 * Os carimbos (DTCADASTRO/DTULTIMALTERACAO/USULTALTERACAO) são os do form-base — 83 CFOPs alterados os têm.
 */
export const cfopCrudConfig: CrudConfig = {
  tabela: 'cfop',
  pk: 'codcfop',
  pkGerada: false,
  view: 'get_cfop',
  colunas: [
    'descricao', 'tipo', 'tipoestado',
    ...ENTRADAS, ...SAIDAS, 'idsituacao_nf_saida',
    'cfop_devolucao', 'codplanocontas', 'aliquota', 'cod_bc_credito', 'idpiscofins', 'codclass_trib', 'tipo_cfop',
    'proc_qtde', 'proc_financeiro', 'proc_transf', 'proc_cupom', 'gera_financeiro_auto', 'altera_custo_nf', 'atualiza_venda_nf',
    'preco_custo', 'devolucao', 'sintegra', 'nao_gera_sped', 'nao_gera_sped_contribuicao', 'nao_gera_apuracao_icms', 'naoalimentadre',
    'dispensado_coleta', 'dispensado_pedido_compra', 'informaiest', 'nao_atualiza_forn_prod', 'abater_cfop', 'filtro_prec_nf',
    'compra', 'venda', 'transferencia', 'calcula_pauta_st',
  ],
  rbacForm: 'FRMCADCFOP',
  // a LOG do form-base (uCadMaster.pas:485): o título da tela como a produção grava — o "Registro de log" a mostra
  log: { formulario: 'Cadastro de CFOP' },
  replica: false,
  historico: false,
  colunasPesquisa: ['codcfop', 'descricao'],
  // o estado que as regras precisam (o TIPO, o destino e o PROCESSA FINANCEIRO do registro, quando a gravação não os traz) e as
  // validações de cada código escolhido
  validarTrx: async ({ trx, id, dto }) => {
    const atual = id != null
      ? ((await trx.selectFrom('cfop').select(['tipo', 'tipoestado', 'proc_financeiro']).where('codcfop', '=', String(id)).executeTakeFirst()) as
          { tipo?: string | null; tipoestado?: string | null; proc_financeiro?: string | null } | undefined)
      : undefined;
    if (dto.tipo === undefined) {
      const t = atual?.tipo ?? tipoPeloCodigo(dto.codcfop ?? id);
      if (!t) throw new BusinessRuleError('CFOP_TIPO_OBRIGATORIO', { codcfop: dto.codcfop ?? id });
      dto.tipo = t;
    }
    if (dto.proc_financeiro === undefined) dto.proc_financeiro = atual?.proc_financeiro ?? null;
    const destino = dto.tipoestado !== undefined ? dto.tipoestado : atual?.tipoestado ?? null;
    const dev = typeof dto.cfop_devolucao === 'string' ? dto.cfop_devolucao.trim() : '';
    if (dev) {
      const ok = await trx.selectFrom('cfop').select('codcfop').where('codcfop', '=', dev).where(sql`coalesce(devolucao,'N')`, '=', 'S')
        .where(sql`coalesce(tipoestado,'')`, '=', String(destino ?? '')).executeTakeFirst();
      if (!ok) throw new BusinessRuleError('CFOP_DEVOLUCAO_INVALIDO', { cfop_devolucao: dev, tipoestado: destino });
    }
    if (typeof dto.codplanocontas === 'number') {
      const ok = await trx.selectFrom('plano_contas').select('codplanocontas').where('codplanocontas', '=', dto.codplanocontas).executeTakeFirst();
      if (!ok) throw new BusinessRuleError('CFOP_CONTA_INVALIDA', { codplanocontas: dto.codplanocontas });
    }
    const aliq = typeof dto.aliquota === 'string' ? dto.aliquota.trim() : '';
    if (aliq) {
      const emp = currentTenant().empresaId ?? null;
      const ok = await trx.selectFrom('det_aliquota as d').select('d.aliquota')
        .where('d.aliquota', '=', aliq)
        .where('d.uf', '=', (qb: any) => qb.selectFrom('empresas').select('uf').where('idempresa', '=', emp))
        .executeTakeFirst();
      if (!ok) throw new BusinessRuleError('CFOP_ALIQUOTA_INVALIDA', { aliquota: aliq });
    }
    if (typeof dto.idpiscofins === 'number') {
      const ok = await trx.selectFrom('piscofins').select('idpiscofins').where('idpiscofins', '=', dto.idpiscofins).executeTakeFirst();
      if (!ok) throw new BusinessRuleError('CFOP_PISCOFINS_INVALIDO', { idpiscofins: dto.idpiscofins });
    }
    if (typeof dto.codclass_trib === 'number') {
      const ok = await trx.selectFrom('class_trib').select('codclass_trib').where('codclass_trib', '=', dto.codclass_trib).executeTakeFirst();
      if (!ok) throw new BusinessRuleError('CFOP_CLASS_TRIB_INVALIDA', { codclass_trib: dto.codclass_trib });
    }
  },
  derivar: (dto) => {
    const out: Record<string, unknown> = {};
    for (const k of LIMPAVEIS) if (dto[k] === '') out[k] = null;
    // SetTipoCFOP: o lado que o TIPO desabilita sai limpo
    if (dto.tipo === 'E') for (const k of SAIDAS) out[k] = null;
    if (dto.tipo === 'S') for (const k of ENTRADAS) out[k] = null;
    // btnGravarClick: sem processar o financeiro não há financeiro automático
    if (String(dto.proc_financeiro ?? 'N') !== 'S') out.gera_financeiro_auto = 'N';
    return out;
  },
};

export const CfopCrudController = createCrudController({
  path: 'cadastro/cfops',
  config: cfopCrudConfig,
  schema: cfopSchema,
  updateSchema: atualizarCfopSchema,
});
