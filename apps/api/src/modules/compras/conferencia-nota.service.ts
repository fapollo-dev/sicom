import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { LiberacaoService } from '../auth/liberacao.service';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/** status que o coletor/retaguarda grava em nf_prod.produc_status (domínio observado no golden). */
export const STATUS_CONFERENCIA = ['CONFERENCIA OK', 'APROVADO', 'LIBERADO', 'BLOQUEADO', 'PARCIAL', 'QUANTIDADE INVALIDA'] as const;

/**
 * CONFERÊNCIA DE NOTA FISCAL (FRMCONFERENCIANOTA) — corte-1: APROVAR / CANCELAR.
 * Procedência: `uConferenciaNota.pas` — `btnAprovarClick` :366-437 · `btnCancelarClick` :440-512 ·
 * `UsuarioLiberadoParaAprovacao` :~1050 · `CarregaNF` :621.
 *
 * A conferência FÍSICA é do COLETOR — ele grava `quantidade_coleta` (a quantidade CONTADA), `usuario_coleta`,
 * `tentativas_coleta`, `data_coleta` e `fatorembal_coleta`. Esta tela é a retaguarda: mostra o que foi contado e
 * o supervisor **aprova** ou **cancela**. Daí o corte-1 ser só as duas ações.
 *
 * O NÚMERO QUE DECIDE é `quantidade_coleta` contra `quantidade × fatorembal` — o legado pinta a linha de VERMELHO
 * quando divergem (dbgridDrawColumnCell:748) e é ela que a trava de processamento da NF lê (uNF.pas:17346), não o
 * `produc_status`. 45.550 das 252.468 linhas divergem, então esconder isso do supervisor seria pedir aprovação no
 * escuro (foi fold da auditoria).
 *
 * APROVAR (fiel): para cada item SELECIONADO → `produc_status='APROVADO'`, `codoperador_aprova_coleta` = o
 * **AUTORIZADOR** da liberação (não o operador da sessão — é o `fOperadorAprova` do legado) e a data de aprovação
 * (correlação 1:1 no golden: 18.077 de 18.077 itens 'APROVADO' têm `data_aprovacao_conf`). Tudo numa transação,
 * como o `StartTransaction/Commit` do legado.
 *
 * CANCELAR: o legado grava `PRODUC_STATUS := ''` e `CODOPERADOR := 0`, mas no Oracle **string vazia É NULL** —
 * e o golden confirma (a linha cancelada lá tem status NULL). Gravamos NULL: é o fiel ao DADO, e `''` criaria um
 * valor que o golden nunca contém, fazendo todo predicado natural de pendência (`IS NULL`) perder a linha.
 * Cancelar NÃO pede liberação (o legado também não) — qualquer operador com acesso à tela pode desaprovar.
 *
 * GATE: `USUARIOS_APROVAM_CONFERENCIA_NOTA` via LiberacaoService (E8) — o autorizador precisa estar na lista E
 * digitar a senha. A LISTA são os grants por-usuário em `configuracoes_especificas`, **não** o valor da config
 * (que é 'N'): no golden há 3 autorizadores (operadores 1, 4 e 59) e a aprovação é VIVA — 18.077 aprovações.
 *
 * APROVAR ITEM NÃO CONTADO é PERMITIDO, e isso é fiel: a grade do legado não filtra por coleta, o botão não tem
 * gate, e 16.152 dos 18.077 itens 'APROVADO' do golden não têm `data_coleta`. Não bloqueamos — mostramos.
 *
 * ADIADO: modo "por LOTE de notas" (`tcPorLoteNotasFiscais`) — `produc_lote` tem 0 linhas no golden, morto ·
 * foto da conferência (`FOTO_CONFERENCIA_NOTA_FISCAL`='N') · registro em `NF_STATUS_PROCESSO`
 * (`RegistrarProcessoNotaFiscal`/`Desregistrar`) — tabela ainda não migrada (205.902 linhas; é um corte próprio) ·
 * a coleta em si (é o coletor/mobile).
 */
@Injectable()
export class ConferenciaNotaService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly liberacao: LiberacaoService,
  ) {}

  private ctx(): { emp: number; op: number } {
    const t = currentTenant();
    if (t.empresaId == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return { emp: t.empresaId, op: t.operadorId ?? 0 };
  }

  /** itens da NF com o que o coletor conferiu (fiel ao CarregaNF: 1 linha por item da nota). */
  async listar(codnf: number): Promise<{ nf: Record<string, unknown> | null; itens: Record<string, unknown>[]; totais: Record<string, number> }> {
    const { emp } = this.ctx();
    const db = this.dbp.forTenantRead() as AnyDB;

    const nf = (await db
      .selectFrom('nf as n')
      .leftJoin('parceiros as pa', 'pa.codparceiro', 'n.codparceiro')
      .select([
        'n.codnf', 'n.nronf', 'n.serie', 'n.tipo', 'n.proc', 'n.cancelada', 'n.dtemissao', 'n.dtcontabil',
        'n.codparceiro', sql`pa.razao`.as('fornecedor'), 'n.chavenfe', 'n.totalnf',
      ])
      .where('n.codnf', '=', Number(codnf))
      .where('n.idempresa', '=', emp)   // escopo do tenant: NF de outra empresa não abre
      .where(sql`upper(n.tipo)`, '=', 'E')   // conferência é de ENTRADA (o picker do legado só oferece TIPO='E')
      .executeTakeFirst()) as Record<string, unknown> | undefined;
    if (!nf) return { nf: null, itens: [], totais: { itens: 0, aprovados: 0, pendentes: 0, conferidos: 0, divergentes: 0 } };

    const itens = (await db
      .selectFrom('nf_prod as np')
      .leftJoin('produtos as p', 'p.idproduto', 'np.codproduto')
      .leftJoin('operadores as o', 'o.codoperador', 'np.codoperador_aprova_coleta')
      .leftJoin('operadores as oc', 'oc.codoperador', 'np.usuario_coleta')
      .select([
        'np.codnfprod', 'np.codproduto', 'np.codprodnota',
        // a descrição da NOTA é a que a grade do legado mostra; a do cadastro é só fallback (item cujo de-para
        // não resolveu o codproduto tem cadastro vazio e o supervisor ficaria sem saber o que é a linha).
        sql`coalesce(nullif(np.descricao,''), p.descricao)`.as('descricao'),
        sql`p.codbarra`.as('codbarra'), sql`coalesce(np.unidade, p.unidade)`.as('unidade'),
        'np.quantidade', 'np.fatorembal', 'np.vrcusto', 'np.vl_custo',
        // QTDE DA NOTA = quantidade × fatorembal (é o que o legado rotula "Qtd. nota"; fatorembal ≠ 0/1 em
        // 85.974 das 252.468 linhas, então mostrar `quantidade` cru daria outro número).
        sql`round((coalesce(np.quantidade,0) * (case when coalesce(np.fatorembal,0) = 0 then 1 else np.fatorembal end))::numeric, 3)`.as('qtde_nota'),
        'np.quantidade_coleta', 'np.tentativas_coleta',
        'np.usuario_coleta', sql`oc.nome`.as('operador_coleta'),
        'np.produc_status', 'np.data_coleta', 'np.fatorembal_coleta',
        'np.codoperador_aprova_coleta', sql`o.nome`.as('operador_aprovacao'), 'np.data_aprovacao_conf',
      ])
      .where('np.codnf', '=', Number(codnf))
      .orderBy('np.codnfprod')   // fiel: ORDER BY CODNFPROD — a ordem do papel/coletor, não alfabética
      .execute()) as Record<string, unknown>[];

    // "pendente" = o que o legado trata como não-aprovado: status vazio/nulo OU qualquer status != APROVADO
    const aprovado = (r: Record<string, unknown>) => String(r.produc_status ?? '').trim().toUpperCase() === 'APROVADO';
    // DIVERGENTE: o legado pinta a linha de VERMELHO quando o contado ≠ o da nota e o contado não é zero
    // (dbgridDrawColumnCell:748). É o sinal que faz o supervisor NÃO aprovar.
    const linhas = itens.map((r) => {
      const contado = r.quantidade_coleta == null ? null : num(r.quantidade_coleta);
      return {
        ...r,
        qtde_coletada: contado,
        divergente: contado != null && contado !== 0 && contado !== num(r.qtde_nota),
      };
    });
    // CONFERIDO é ter QUANTIDADE COLETADA — não a data: no golden 2026 há 24 itens com quantidade_coleta e só 1
    // com data_coleta, então contar pela data reportaria "0 conferidos" com o pedido inteiro contado.
    const totais = {
      itens: linhas.length,
      aprovados: linhas.filter(aprovado).length,
      pendentes: linhas.filter((r) => !aprovado(r)).length,
      conferidos: linhas.filter((r) => r.qtde_coletada != null).length,
      divergentes: linhas.filter((r) => r.divergente).length,
    };
    return { nf, itens: linhas, totais };
  }

  /**
   * APROVAR os itens selecionados. Exige liberação: o autorizador precisa estar em
   * USUARIOS_APROVAM_CONFERENCIA_NOTA e digitar a senha; o código DELE é o que fica gravado.
   */
  async aprovar(dto: { codnf: number; itens: number[]; login: string; senha: string; computador?: string | null }): Promise<{ aprovados: number; codoperador_aprova: number }> {
    const { emp } = this.ctx();
    if (!dto.itens?.length) throw new BusinessRuleError('CONFERENCIA_SEM_ITENS');

    const lib = await this.liberacao.validar({
      codigo: 'USUARIOS_APROVAM_CONFERENCIA_NOTA',
      login: dto.login,
      senha: dto.senha,
      liberacao: `APROVAR CONFERENCIA NF ${dto.codnf}`,
      computador: dto.computador ?? null,
    });
    if (!lib.liberado) throw new BusinessRuleError('CONFERENCIA_APROVACAO_NAO_LIBERADA', { login: dto.login });
    const autorizador = Number(lib.codOperador);

    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      await this.assertNfDaEmpresa(trx, dto.codnf, emp);
      const r = await trx
        .updateTable('nf_prod')
        .set({
          produc_status: 'APROVADO',
          codoperador_aprova_coleta: autorizador,
          data_aprovacao_conf: sql`now()`,
        })
        .where('codnf', '=', Number(dto.codnf))
        .where('codnfprod', 'in', dto.itens.map(Number))
        .executeTakeFirst();
      return { aprovados: Number(r?.numUpdatedRows ?? 0), codoperador_aprova: autorizador };
    });
  }

  /**
   * CANCELAR a aprovação: volta ao "pendente". O legado faz `PRODUC_STATUS := ''` e `CODOPERADOR := 0`, mas no
   * Oracle **string vazia É NULL** — o golden confirma (a linha cancelada lá tem status NULL e operador 0). Então
   * o fiel ao DADO é gravar NULL no status (e 0 no operador, que é número e fica zero mesmo). Gravar `''` criaria
   * um valor que o golden nunca contém e faria todo predicado natural de pendência (`IS NULL`) perder a linha.
   */
  async cancelar(dto: { codnf: number; itens: number[] }): Promise<{ cancelados: number }> {
    const { emp } = this.ctx();
    if (!dto.itens?.length) throw new BusinessRuleError('CONFERENCIA_SEM_ITENS');
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      await this.assertNfDaEmpresa(trx, dto.codnf, emp);
      const r = await trx
        .updateTable('nf_prod')
        .set({ produc_status: null, codoperador_aprova_coleta: 0, data_aprovacao_conf: null })
        .where('codnf', '=', Number(dto.codnf))
        .where('codnfprod', 'in', dto.itens.map(Number))
        .executeTakeFirst();
      return { cancelados: Number(r?.numUpdatedRows ?? 0) };
    });
  }

  /**
   * nf_prod não tem idempresa: o escopo vem da NF pai — sem isto um codnf de outra empresa seria aprovável.
   * `FOR UPDATE` (fold da auditoria): a checagem estava DENTRO da transação mas sem lock, então um cancelamento
   * de NF que commitasse entre o SELECT e o UPDATE ficava invisível e os itens de uma nota recém-cancelada
   * saíam 'APROVADO' — estado que o golden nunca contém (as 109.719 linhas com status estão todas em
   * cancelada='N'). Mesma correção do motor de agregados (LIÇÃO 11 / `be20271`).
   * `tipo='E'`: conferência é de ENTRADA. No golden 100% das 109.719 linhas de status e das 94.873 de coleta
   * estão em NF de entrada; o picker do legado só oferece `TIPO = 'E'` (CarregaNF:631) e o coletor recusa o
   * resto explicitamente. Sem isto uma NF de SAÍDA podia ser "conferida" e ficava marcada para sempre.
   */
  private async assertNfDaEmpresa(trx: AnyDB, codnf: number, emp: number): Promise<void> {
    const nf = (await trx
      .selectFrom('nf')
      .select(['codnf', 'idempresa', 'cancelada', 'tipo'])
      .where('codnf', '=', Number(codnf))
      .forUpdate()
      .executeTakeFirst()) as { idempresa?: number; cancelada?: string; tipo?: string } | undefined;
    if (!nf || num(nf.idempresa) !== emp) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
    if (String(nf.cancelada ?? 'N').toUpperCase() === 'S') throw new BusinessRuleError('NF_CANCELADA', { codnf });
    if (String(nf.tipo ?? '').toUpperCase() !== 'E') throw new BusinessRuleError('NF_NAO_ENTRADA', { codnf, tipo: nf.tipo });
  }
}
