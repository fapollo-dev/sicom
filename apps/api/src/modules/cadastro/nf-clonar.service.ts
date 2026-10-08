import { Injectable } from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { AggregateEngineService } from '../../shared/crud/aggregate-engine.service';
import { hojeNaLoja } from '../../shared/tempo/hoje';
import { nfAggregateConfig } from './nf.aggregate';

type AnyDB = Kysely<any>;
export type OperacaoClone = 'CLONAR' | 'TRANSFERENCIA';

/** o que é da vida da nota de origem, não da cópia: auditoria, processamento, coleta, exportação, produção e os vínculos */
const NAO_COPIAR_NF = new Set([
  'codnf', 'usucadastro', 'dtcadastro', 'usultalteracao', 'dtultimalteracao', 'dtprocessamento', 'dtimportacao', 'nfe_xml', 'origem_legado',
  'codnfstatuspro', 'produc_status', 'produc_status_receb', 'old_codparceiro', 'old_codparceiro_end', 'ignorar_manifesto', 'ignorar_manifesto_motivo',
  'exportada', 'data_exportacao', 'app_exportacao', 'exportada_integracao', 'data_exportacao_integracao', 'app_exportacao_integracao',
  'exportada_borba', 'data_exportacao_borba', 'app_exportacao_borba', 'conferenciacoletor', 'usuconferenciacoletor', 'dtconferenciacoletor',
  'confcoletorpend', 'recepcionada', 'ult_codnfprod_repasse', 'baixar_estoque_exclusao', 'codoperador_liberacao', 'codoperador_lib_nf_index',
  'libera_nf_indexador', 'cancela_faturamento', 'status_pedcomp', 'status_qtd_pedcomp', 'codcontabil', 'obsnfusuario',
]);
const NAO_COPIAR_ITEM = new Set([
  'codnfprod', 'codnf', 'usucadastro', 'dtcadastro', 'usultalteracao', 'dtultimalteracao', 'quantidade_coleta', 'usuario_coleta', 'tentativas_coleta',
  'data_coleta', 'fatorembal_coleta', 'codoperador_aprova_coleta', 'data_aprovacao_conf', 'quantidade_pre_coleta', 'codscrap', 'codcontabil',
  'produc_status', 'produc_estocagem', 'produc_tara_primaria', 'produc_tara_secundaria', 'produc_tara_balanca', 'produc_dtproducao', 'produc_lote',
  'produc_peso_liq_recebido', 'produc_peso_bruto_recebido', 'produc_dtrecebimento', 'produc_abatido', 'produc_tipo_dev', 'frete2_temp',
  'custo_recalculo_bonif', 'usuario_precifica', 'data_precifica', 'strealnovo',
]);
const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/**
 * CLONAR a nota e gerar a NOTA DE TRANSFERÊNCIA ENTRE LOJAS (`ClonaNF`, uNF.pas:6987; `NotadeTransferencia1Click`, :15216).
 *
 * O legado copia a nota e os itens campo a campo para uma nota nova em inclusão. Aqui a cópia é gravada como NÃO PROCESSADA (a
 * transferência nasce na OUTRA loja, que a sessão não alcança pelo cadastro) e a tela a abre para conferir — a exclusão de uma cópia
 * indesejada é a exclusão normal. Regras do legado em ambos: NRONF '000000' (a transferência mantém o da origem), OBS/confirmação/
 * cupons de devolução vazios, CANCELADA 'N', PROC 'N', CONTABILIZADO 'N', STATUSNFE vazio, chave e protocolo vazios (a transferência
 * os mantém), protocolo de cancelamento vazio, DTCONTABIL e DTHORASAIDA agora, SÉRIE com 3 dígitos, TIPOEMISSAO 0, FINALIDADE '1'
 * (mantém '4'); nos itens, VRVENDA e VRCUSTOREAL = o VRCUSTO da origem.
 *
 * TRANSFERÊNCIA (a saída 5152 de uma loja vira a ENTRADA na loja destinatária): a loja de destino é a EMPRESA com o CNPJ do
 * destinatário da nota; o fornecedor é o parceiro com o CNPJ da loja de origem; tipo 'E', emissão de terceiros (1), STATUSNFE e
 * NF_IMPORTACAO_NFE 'T', VALIDATOTALNF = TOTALNF, CFOP (da nota e dos itens) 1xxx na mesma UF e 2xxx fora, situação vazia (escolhida no processamento rápido que vem em seguida, F4). Travas: destino que não é empresa, origem sem cadastro de parceiro, transferência já gerada
 * (mesma chave, mesmo fornecedor, na loja de destino), destinatário com o CNPJ da própria loja, nota sem número. Produção: 53, 82 e
 * 38 transferências em 2024, 2025 e 2026 — as 38 de 2026 batem nas 5 regras de cabeçalho com a saída (número, total, emissão, CFOP
 * 1152, emissão de terceiros) e os itens têm venda = custo da origem.
 *
 * Os outros modos do legado ficam de fora com prova: devolução de compra por clone (desde 2023, as 180 devoluções 5202/6202 vêm do
 * pedido de devolução — COD_PED_DEV_COMPRA em 100%), entrada de devolução a partir da saída (nenhuma 1202/2202 de finalidade normal
 * em 2026) e transferência para depósito (nenhuma 5905/6905 na história).
 */
@Injectable()
export class NfClonarService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly engine: AggregateEngineService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private async colunas(trx: AnyDB, tabela: string, fora: Set<string>): Promise<string[]> {
    const r = await sql<{ c: string }>`
      SELECT column_name AS c FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = ${tabela} AND coalesce(is_generated, 'NEVER') = 'NEVER'
       ORDER BY ordinal_position`.execute(trx);
    return r.rows.map((x) => x.c).filter((c) => !fora.has(c));
  }

  async gerar(codnf: number, operacao: OperacaoClone): Promise<{ codnf: number; idempresa: number; nronf: string; tipo: string; empresa: string | null }> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const transf = operacao === 'TRANSFERENCIA';
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const src = (await sql<Record<string, unknown>>`
        SELECT n.codnf, n.nronf, n.chavenfe, n.cfop, n.tipo, pe.cnpj_cpf AS titular_cnpj, pe.uf AS titular_uf
          FROM nf n LEFT JOIN parceiros_end pe ON pe.codend = n.codparceiro_end
         WHERE n.codnf = ${codnf} AND n.idempresa = ${emp}`.execute(trx)).rows[0];
      if (!src) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
      const empresa = (await sql<{ cnpj: string | null; uf: string | null }>`SELECT cnpj, uf FROM empresas WHERE idempresa = ${emp}`.execute(trx)).rows[0];
      const mesmaUf = String(src.titular_uf ?? '').trim() === String(empresa?.uf ?? '').trim();

      let destino = emp;
      let fornecedor: { codparceiro: number; codend: number } | null = null;
      if (transf) {
        const cnpjDest = String(src.titular_cnpj ?? '');
        const d = (await sql<{ idempresa: number }>`
          SELECT idempresa FROM empresas WHERE cnpj = ${soDigitos(cnpjDest)} OR cnpj = ${cnpjDest} ORDER BY idempresa LIMIT 1`.execute(trx)).rows[0];
        if (!d || !cnpjDest) throw new BusinessRuleError('NF_TRANSF_DESTINO_NAO_EMPRESA');
        const cnpjOrig = String(empresa?.cnpj ?? '');
        fornecedor = (await sql<{ codparceiro: number; codend: number }>`
          SELECT codparceiro, codend FROM parceiros_end WHERE cnpj_cpf = ${soDigitos(cnpjOrig)} OR cnpj_cpf = ${cnpjOrig}
           ORDER BY codparceiro, codend LIMIT 1`.execute(trx)).rows[0] ?? null;
        if (!fornecedor) throw new BusinessRuleError('NF_TRANSF_ORIGEM_SEM_PARCEIRO');
        const ja = (await sql<{ codnf: number }>`
          SELECT codnf FROM nf WHERE idempresa = ${d.idempresa} AND codparceiro = ${fornecedor.codparceiro} AND chavenfe = ${src.chavenfe ?? null}
             AND tipo = 'E' ORDER BY codnf LIMIT 1`.execute(trx)).rows[0];
        if (ja) {
          throw new BusinessRuleError('NF_TRANSF_JA_EXISTE', { codnf: ja.codnf },
            `Já existe uma nota de entrada de transferência referente a esta saída na empresa de destino selecionada, código: ${ja.codnf}.\nNão será possível gerar outra nota de transferência. Verifique!`);
        }
        if (soDigitos(cnpjDest) !== '' && soDigitos(cnpjDest) === soDigitos(cnpjOrig)) throw new BusinessRuleError('NF_TRANSF_MESMO_CNPJ');
        if (!(Number.parseInt(String(src.nronf ?? '0'), 10) > 0)) throw new BusinessRuleError('NF_TRANSF_SEM_NUMERO');
        destino = d.idempresa;
      }

      const agora = sql`now()`;
      const hoje = hojeNaLoja();
      const cfopConv = (col: string) => sql`(${mesmaUf ? '1' : '2'} || substr(${sql.ref(col)}::text, 2))`;
      // o cabeçalho
      const sobreNf: Record<string, RawBuilder<unknown>> = {
        nronf: transf ? sql`nronf` : sql`'000000'`,
        cupons_ref_devolucao: sql`NULL`, obs: sql`NULL`, confirmada: sql`NULL`, cancelada: sql`'N'`,
        chavenfe: transf ? sql`chavenfe` : sql`NULL`, protocolo_nfe: transf ? sql`protocolo_nfe` : sql`NULL`, protocolo_cancelamento: sql`NULL`,
        dtcontabil: sql`${hoje}::date`, dthorasaida: agora,
        serie: sql`CASE WHEN length(trim(serie)) < 3 THEN lpad(trim(serie), 3, '0') ELSE trim(serie) END`,
        proc: sql`'N'`, contabilizado: sql`'N'`, statusnfe: transf ? sql`'T'` : sql`NULL`, alteraestoquereversao: sql`NULL`,
        tipoemissao: transf ? sql`1` : sql`0`,
        finalidade: transf ? sql`'1'` : sql`CASE WHEN finalidade = '4' THEN '4' ELSE '1' END`,
        usucadastro: sql`${op}`, dtcadastro: agora,
      };
      if (transf) {
        Object.assign(sobreNf, {
          idempresa: sql`${destino}`, nf_importacao_nfe: sql`'T'`, validatotalnf: sql`totalnf`,
          codparceiro: sql`${fornecedor!.codparceiro}`, codparceiro_end: sql`${fornecedor!.codend}`, tipo: sql`'E'`, idsituacao_nf: sql`NULL`,
          cfop: sql`CASE WHEN cfop IS NULL THEN NULL ELSE ${cfopConv('cfop')} END`,
        });
      }
      const colsNf = await this.colunas(trx, 'nf', NAO_COPIAR_NF);
      const alvoNf = [...new Set([...colsNf, ...Object.keys(sobreNf).filter((c) => colsNf.includes(c) || c === 'usucadastro' || c === 'dtcadastro')])];
      const existeNf = new Set(await this.colunas(trx, 'nf', new Set()));
      const colsNfFinal = alvoNf.filter((c) => existeNf.has(c));
      const novo = (await sql<{ codnf: number }>`
        INSERT INTO nf (${sql.join(colsNfFinal.map((c) => sql.ref(c)))})
        SELECT ${sql.join(colsNfFinal.map((c) => sobreNf[c] ?? sql.ref(c)))} FROM nf WHERE codnf = ${codnf}
        RETURNING codnf`.execute(trx)).rows[0];
      const id = Number(novo.codnf);

      // os itens
      const sobreItem: Record<string, RawBuilder<unknown>> = {
        codnf: sql`${id}`, vrvenda: sql`vrcusto`, vrcustoreal: sql`vrcusto`,
      };
      if (transf) Object.assign(sobreItem, { cfop: sql`CASE WHEN cfop IS NULL THEN NULL ELSE ${cfopConv('cfop')} END`, idsituacao_nf: sql`NULL` });
      const colsItem = [...(await this.colunas(trx, 'nf_prod', NAO_COPIAR_ITEM)), 'codnf'];
      await sql`
        INSERT INTO nf_prod (${sql.join(colsItem.map((c) => sql.ref(c)))})
        SELECT ${sql.join(colsItem.map((c) => sobreItem[c] ?? sql.ref(c)))} FROM nf_prod WHERE codnf = ${codnf} ORDER BY codnfprod`.execute(trx);

      await this.engine.registrarInclusao(trx, nfAggregateConfig, id);
      const r = (await sql<{ nronf: string; tipo: string }>`SELECT nronf, tipo FROM nf WHERE codnf = ${id}`.execute(trx)).rows[0];
      // o nome da loja de destino — o "Nota de transferência gerada para a empresa: …" (EmpresaDeTransferencia = o TITULAR_RAZAO da saída, o
      // destinatário, que é a loja de destino: uNF.pas:7366)
      const nomeDestino = ((await sql<{ razao_social: string | null }>`SELECT razao_social FROM empresas WHERE idempresa = ${destino}`.execute(trx)).rows[0])?.razao_social ?? null;
      return { codnf: id, idempresa: destino, nronf: String(r.nronf ?? ''), tipo: String(r.tipo ?? ''), empresa: transf ? nomeDestino : null };
    });
  }
}
