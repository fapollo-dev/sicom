import { sql } from 'kysely';
import { situacaoNfSchema, atualizarSituacaoNfSchema, regraTipoOperacao } from '@apollo/shared';
import { createAggregateController } from '../../shared/crud/aggregate.controller.factory';
import type { AggregateConfig } from '../../shared/crud/crud-config';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';

/**
 * SITUAÇÃO DO DOCUMENTO (`FRMCADSITUACAONF`, UCadSituacaoNF — `TfrmCadMasterDet`; dossiê UCadSituacaoNF.md, C1, mig 317).
 * Mestre `situacao_nf` (27 campos) + 4 detalhes: CFOPs permitidos (ISITUACAO_NF), centros de custo (SITUACAO_NF_PLC),
 * parceiros (SITUACAO_NF_PARCEIROS) e a integração contábil (ITENS_INTEGRACAO_CONTABIL, `codoperacao` = a situação).
 *
 * - o TIPO DE OPERAÇÃO força o tipo E/S e a conta Fixa (`SetTipoOperacao`, :1445) — `regraTipoOperacao` do shared;
 * - contas: nenhuma ou uma crédito e uma débito (`ValidaInformacoes`, :1568); a conta é obrigatória salvo Automática, e o
 *   histórico sempre (:614-653);
 * - CFOP: existe, do mesmo tipo da situação e sem repetir (:693-738) — o tipo só é cobrado na linha NOVA: 4 linhas da
 *   produção quebram a regra e têm de continuar gravando;
 * - excluir: recusado se a situação está no DIÁRIO, em NF, AR, AP ou SCRAP (`VinculadoDiario`, :1668); exclusão física.
 */
const MSG_EM_USO = 'A situação do documento está em uso e não pode ser excluída.';

export const situacaoNfAggregateConfig: AggregateConfig = {
  tabela: 'situacao_nf',
  pk: 'idsituacao_nf',
  view: 'get_situacao_nf',
  rbacForm: 'FRMCADSITUACAONF',
  // a LOG do form-base (uCadMaster.pas:485): o título da tela como a produção grava
  log: { formulario: 'Cadastro de Situação do Documento' },
  colunas: [
    'descricao', 'tipo', 'tipo_operacao', 'nao_realiza_integracao', 'exige_pedido_compra', 'valida_estoque_disponivel',
    'transferencia_mercadorias', 'permite_basecalc_maior100', 'idpgto_nfe', 'codoperadoras_nfe', 'importacao_auto_nf',
    'codplanocontas_deb_baixa_cp', 'codplanocontas_cred_baixa_cr', 'idsituacao_nf_financeiro', 'gerar_contas_receber',
    'dias_prazo', 'estoque', 'exige_mapa_carga', 'exige_scrap', 'exige_cheque', 'valida_conteudo_emb', 'codclass_trib', 'ativo',
  ],
  colunasPesquisa: ['idsituacao_nf', 'descricao', 'tipo', 'tipo_operacao', 'ativo', 'qtde_cfop'],
  replica: false,
  // o tipo que a operação força (SetTipoOperacao :1522-1532); a nova nasce TIPO 'E' e integração 'N' (UdmCadSituacaoNF:183)
  derivar: (dto, id) => {
    const out: Record<string, unknown> = {};
    const r = dto.tipo_operacao != null ? regraTipoOperacao(String(dto.tipo_operacao)) : null;
    if (r?.tipoForcado) out.tipo = r.tipoForcado;
    else if (id == null && (dto.tipo == null || dto.tipo === '')) out.tipo = 'E';
    if (id == null && (dto.nao_realiza_integracao == null || dto.nao_realiza_integracao === '')) out.nao_realiza_integracao = 'N';
    return out;
  },
  detalhes: [
    {
      tabela: 'isituacao_nf', pk: 'idisituacao_nf', fk: 'idsituacao_nf', chave: 'cfops',
      chaveNatural: ['codcfop'], preservarNaoGerenciadas: true, colunas: ['codcfop'],
    },
    {
      // PK composta (situação, CC) no legado; o motor só usa a pk para saber o que ele gerencia
      tabela: 'situacao_nf_plc', pk: 'codplc', fk: 'idsituacao_nf', chave: 'centros_custo',
      chaveNatural: ['codplc'], preservarNaoGerenciadas: true, colunas: ['codplc', 'dtcadastro', 'codoperador'],
      // DTCADASTRO/CODOPERADOR carimbados na inclusão (UdmCadSituacaoNF.pas:187-217); a linha que já existia mantém os seus
      derivarItensTrx: async (itens) => itens.map((it) => ({
        ...it,
        dtcadastro: it.dtcadastro ?? sql`now()`,
        codoperador: it.codoperador ?? currentTenant().operadorId ?? null,
      })),
    },
    {
      tabela: 'situacao_nf_parceiros', pk: 'codparceiro', fk: 'idsituacao_nf', chave: 'parceiros',
      chaveNatural: ['codparceiro'], preservarNaoGerenciadas: true, colunas: ['codparceiro', 'dtcadastro', 'codoperador'],
      derivarItensTrx: async (itens) => itens.map((it) => ({
        ...it,
        dtcadastro: it.dtcadastro ?? sql`now()`,
        codoperador: it.codoperador ?? currentTenant().operadorId ?? null,
      })),
    },
    {
      // a grade "Plano de contas" da aba Principal: a integração contábil da situação
      tabela: 'itens_integracao_contabil', pk: 'coditemoperacao', fk: 'codoperacao', chave: 'contas',
      chaveNatural: ['natureza'], preservarNaoGerenciadas: true, colunas: ['natureza', 'tipo', 'codconta_contabil', 'codhistorico'],
      // operação de conta fixa força TIPO 'F' (SetTipoOperacao :1503-1510)
      derivarItensTrx: async (itens, _trx, _emp, header) => {
        const fixa = header?.tipo_operacao != null && regraTipoOperacao(String(header.tipo_operacao)).contaFixa;
        return itens.map((it) => (fixa ? { ...it, tipo: 'F' } : it));
      },
    },
  ],
  validar: async ({ dto, id, db }) => {
    // o tipo efetivo (o forçado pela operação, o do dto ou o gravado)
    let tipoGravado: string | null = null;
    let operacaoGravada: string | null = null;
    if (id != null) {
      const s = (await db.selectFrom('situacao_nf').select(['tipo', 'tipo_operacao']).where('idsituacao_nf', '=', id)
        .executeTakeFirst()) as { tipo?: string | null; tipo_operacao?: string | null } | undefined;
      if (!s) throw new BusinessRuleError('SITUACAO_NAO_ENCONTRADA', { idsituacao_nf: id });
      tipoGravado = s.tipo ?? null;
      operacaoGravada = s.tipo_operacao ?? null;
    }
    const operacao = (dto.tipo_operacao as string | undefined) ?? operacaoGravada;
    const forcado = regraTipoOperacao(operacao).tipoForcado;
    const tipo = forcado ?? (dto.tipo as string | undefined) ?? tipoGravado ?? 'E';

    // contas (:614-653): conta obrigatória salvo Automática; histórico obrigatório
    if (Array.isArray(dto.contas)) {
      const fixa = regraTipoOperacao(operacao).contaFixa;
      for (const c of dto.contas as Array<Record<string, unknown>>) {
        const t = fixa ? 'F' : String(c.tipo ?? '');
        if (t !== 'A' && (c.codconta_contabil == null || c.codconta_contabil === '')) {
          throw new BusinessRuleError('SITUACAO_CONTA_OBRIGATORIA', { natureza: c.natureza });
        }
        if (c.codhistorico == null || c.codhistorico === '') throw new BusinessRuleError('SITUACAO_HISTORICO_OBRIGATORIO', { natureza: c.natureza });
      }
    }

    // CFOPs (:693-738, :1630-1666): existe, sem repetir, e — na linha NOVA — do tipo da situação
    if (Array.isArray(dto.cfops)) {
      const cods = (dto.cfops as Array<{ codcfop: number }>).map((c) => Number(c.codcfop));
      const dup = cods.find((c, i) => cods.indexOf(c) !== i);
      if (dup != null) throw new BusinessRuleError('SITUACAO_CFOP_DUPLICADO', { codcfop: dup });
      const existentes = new Set<number>(id == null ? [] : ((await db.selectFrom('isituacao_nf').select('codcfop')
        .where('idsituacao_nf', '=', id).execute()) as Array<{ codcfop: unknown }>).map((r) => Number(r.codcfop)));
      if (cods.length) {
        const cad = (await db.selectFrom('cfop').select(['codcfop', 'tipo'])
          .where(sql`codcfop::text`, 'in', cods.map(String)).execute()) as Array<{ codcfop: string; tipo: string | null }>;
        const porCod = new Map(cad.map((c) => [Number(c.codcfop), c.tipo]));
        for (const c of cods) {
          if (!porCod.has(c)) throw new BusinessRuleError('SITUACAO_CFOP_INEXISTENTE', { codcfop: c });
          const tc = porCod.get(c);
          if (!existentes.has(c) && tc != null && tc !== '' && tipo !== 'T' && tc !== tipo) {
            throw new BusinessRuleError('SITUACAO_CFOP_TIPO_DIFERENTE', { codcfop: c, tipo_cfop: tc, tipo_situacao: tipo });
          }
        }
      }
    }

    // centros de custo e parceiros existem
    if (Array.isArray(dto.centros_custo) && dto.centros_custo.length) {
      const cods = [...new Set((dto.centros_custo as Array<{ codplc: number }>).map((c) => Number(c.codplc)))];
      const achados = (await db.selectFrom('plc').select('codplc').where('codplc', 'in', cods).execute()) as Array<{ codplc: number }>;
      const ok = new Set(achados.map((a) => Number(a.codplc)));
      const falta = cods.find((c) => !ok.has(c));
      if (falta != null) throw new BusinessRuleError('SITUACAO_CC_INEXISTENTE', { codplc: falta });
    }
    if (Array.isArray(dto.parceiros) && dto.parceiros.length) {
      const cods = [...new Set((dto.parceiros as Array<{ codparceiro: number }>).map((c) => Number(c.codparceiro)))];
      const achados = (await db.selectFrom('parceiros').select('codparceiro').where('codparceiro', 'in', cods).execute()) as Array<{ codparceiro: number }>;
      const ok = new Set(achados.map((a) => Number(a.codparceiro)));
      const falta = cods.find((c) => !ok.has(c));
      if (falta != null) throw new BusinessRuleError('SITUACAO_PARCEIRO_INEXISTENTE', { codparceiro: falta });
    }
  },
  // `VinculadoDiario` (:1668-1692): em uso no DIÁRIO (a operação contábil), em NF, AR, AP ou SCRAP → não exclui
  validarRemocao: async ({ id, db }) => {
    const usos: Array<[string, string]> = [['diario', 'codoperacao'], ['nf', 'idsituacao_nf'], ['areceber', 'idsituacao_nf'], ['apagar', 'idsituacao_nf'], ['scrap', 'idsituacao_nf']];
    for (const [tabela, coluna] of usos) {
      const r = await db.selectFrom(tabela).select(sql`1`.as('x')).where(coluna, '=', id).limit(1).executeTakeFirst();
      if (r) throw new BusinessRuleError('SITUACAO_EM_USO', { tabela, mensagem: MSG_EM_USO });
    }
  },
};

export const SituacaoNfAggregateController = createAggregateController({
  path: 'cadastro/situacoes-nf',
  config: situacaoNfAggregateConfig,
  schema: situacaoNfSchema,
  updateSchema: atualizarSituacaoNfSchema,
});
