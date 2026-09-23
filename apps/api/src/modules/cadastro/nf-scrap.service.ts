import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { LiberacaoService } from '../auth/liberacao.service';
import { ConfigService } from './config.service';
import { NfFiscalService } from './nf-fiscal.service';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/**
 * IMPORTAR SCRAP NA NF DE SAÍDA — a opção 3 do `btnAddPedidoClick` (uNF.pas:1880-2070), a origem viva da importação
 * da NF: 199 scraps viraram 131 NFs de perda em 2026 (situações 20/1137/90), todas processadas e autorizadas. Na
 * produção o scrap NÃO baixa o estoque (`BAIXAR_ESTOQUE_NO_SCRAP='N'`, `MOV_ESTOQUE` nunca 'S') — quem baixa é o
 * processamento desta NF.
 *
 *  - lista (`GET_SCRAP`): os scraps da empresa, com o status da NF-e em que entraram;
 *  - prévia: o destinatário é a PRÓPRIA empresa (o parceiro cujo endereço tem o CNPJ dela; o endereço padrão
 *    primeiro), CFOP 5927 na UF e 6927 fora; os itens agrupados por produto e filho (`IncluiProdSCRAP` com Locate): quantidade somada, valor unitário
 *    = custo do MULTI_PRECO (`qrySCRAP`, udmNF.dfm:9138) ponderado; motivo 'USO INTERNO' vira 5949 (item e nota);
 *  - vínculo ao GRAVAR (uNF.pas:5251): `PEDIDO_NF` tipo 'S' e `SCRAP.IMPORTADO='S'`;
 *  - scrap já importado só entra com a liberação de `USUARIOS_LIBERAM_SCRAP_NF` (uNF.pas:1994-2020), conferida na
 *    prévia E no vínculo (o vínculo é o que grava);
 *  - estorno na exclusão e no cancelamento da NF (`AtualizaStatusScrap`, udmNF.pas:3217).
 *
 * Decisão (sem caso na produção): scrap com `MOV_ESTOQUE='S'` (baixa feita no próprio scrap) não entra na NF — a NF
 * baixaria o estoque de novo.
 */
@Injectable()
export class NfScrapService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly liberacao: LiberacaoService,
    private readonly config: ConfigService,
    private readonly fiscal: NfFiscalService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** a pesquisa `GET_SCRAP` (view da produção): o scrap, o valor, se já foi importado e em que NF */
  async disponiveis(): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    return (await sql<Record<string, unknown>>`
      SELECT s.codscrap, s.dt_cadastro::date AS dt_cadastro, s.codparceiro, p.razao, s.codplc, c.desccodplc, c.descricao,
             s.obs, coalesce(s.importado, 'N') AS importado, coalesce(s.mov_estoque, 'N') AS mov_estoque,
             (SELECT round(sum(i.qtde * i.vr_custo), 2) FROM scrap_item i WHERE i.codscrap = s.codscrap) AS valor,
             (SELECT count(*) FROM scrap_item i WHERE i.codscrap = s.codscrap AND coalesce(i.faturado, 'N') = 'N')::int AS itens,
             nf.codnf, nf.nronf,
             CASE WHEN nf.statusnfe = 'P' AND nf.tpemissao IN ('6', '7') THEN 'NFE ENVIADA EM CONTINGENCIA'
                  WHEN nf.statusnfe = 'P' THEN 'NFE ENVIADA A RECEITA'
                  WHEN nf.statusnfe = 'C' AND nf.tpemissao IN ('6', '7') THEN 'NFE CANCELADA EM CONTINGENCIA'
                  WHEN nf.statusnfe = 'C' THEN 'NFE CANCELADA NA RECEITA'
                  WHEN nf.statusnfe = 'D' THEN 'NFE DENEGADA NA RECEITA'
                  ELSE nf.statusnfe END AS status_nfe
        FROM scrap s
        LEFT JOIN parceiros p ON p.codparceiro = s.codparceiro
        LEFT JOIN plc c ON c.codplc = s.codplc
        LEFT JOIN nf ON nf.codnf = (SELECT max(pn.codnf) FROM pedido_nf pn WHERE pn.tipo = 'S' AND pn.codpedido = s.codscrap)
       WHERE s.idempresa = ${emp}
       ORDER BY s.codscrap DESC
       LIMIT 2000`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
  }

  /**
   * a reimportação: scrap já importado (e que não é desta NF) exige a liberação por login — o legado pergunta, lista
   * os usuários permitidos e chama `ChamaLiberacaoLogin`; sem ninguém permitido, recusa.
   */
  private async liberarReimportacao(codigos: number[], cred: { login?: string; senha?: string }): Promise<void> {
    const permitidos = await this.config.usuariosPermitidos('USUARIOS_LIBERAM_SCRAP_NF');
    if (!permitidos.length) throw new BusinessRuleError('SCRAP_SEM_LIBERADOR', { scraps: codigos });
    if (!cred.login || !cred.senha) throw new BusinessRuleError('SCRAP_JA_IMPORTADO', { scraps: codigos });
    const lib = await this.liberacao.validar({
      codigo: 'USUARIOS_LIBERAM_SCRAP_NF', login: cred.login, senha: cred.senha,
      liberacao: `REIMPORTACAO DE SCRAP NA NOTA FISCAL: ${codigos.join(', ')}`,
    });
    if (!lib.liberado) throw new BusinessRuleError('LIBERACAO_NAO_AUTORIZADA', { codigo: 'USUARIOS_LIBERAM_SCRAP_NF' });
  }

  /** os scraps pedidos, da empresa; recusa o inexistente e o que já baixou estoque no próprio scrap */
  private async lerScraps(db: AnyDB, emp: number, codigos: number[], travar = false): Promise<Array<{ codscrap: number; importado: string; mov_estoque: string }>> {
    let q = db.selectFrom('scrap').select(['codscrap', 'importado', 'mov_estoque']).where('idempresa', '=', emp).where('codscrap', 'in', codigos);
    if (travar) q = q.forUpdate();
    const rows = (await q.execute()) as Array<{ codscrap: unknown; importado: unknown; mov_estoque: unknown }>;
    const achados = new Set(rows.map((r) => Number(r.codscrap)));
    const faltam = codigos.filter((c) => !achados.has(c));
    if (faltam.length) throw new BusinessRuleError('SCRAP_NAO_ENCONTRADO', { scraps: faltam });
    const baixados = rows.filter((r) => String(r.mov_estoque ?? 'N') === 'S').map((r) => Number(r.codscrap));
    if (baixados.length) throw new BusinessRuleError('SCRAP_ESTOQUE_JA_BAIXADO', { scraps: baixados });
    return rows.map((r) => ({ codscrap: Number(r.codscrap), importado: String(r.importado ?? 'N'), mov_estoque: String(r.mov_estoque ?? 'N') }));
  }

  /** a PRÉVIA: cabeçalho sugerido e itens agrupados, com os impostos do motor fiscal — não grava nada */
  async previa(dto: { codscraps: number[]; login?: string; senha?: string }): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const codigos = [...new Set(dto.codscraps.map(Number))];
    const scraps = await this.lerScraps(db, emp, codigos);
    const ja = scraps.filter((s) => s.importado === 'S').map((s) => s.codscrap);
    if (ja.length) await this.liberarReimportacao(ja, dto);

    // o destinatário: a própria empresa (PARCEIROS_END com o CNPJ dela — uNF.pas:1889)
    const empresa = (await db.selectFrom('empresas').select(['cnpj', 'uf']).where('idempresa', '=', emp).executeTakeFirst()) as { cnpj?: string; uf?: string } | undefined;
    const cnpj = String(empresa?.cnpj ?? '').replace(/\D/g, '');
    const dest = cnpj
      ? ((await sql<{ codparceiro: number; codend: number; uf: string | null }>`
          SELECT e.codparceiro, e.codend, e.uf FROM parceiros_end e
           WHERE regexp_replace(coalesce(e.cnpj_cpf, ''), '\\D', '', 'g') = ${cnpj}
           ORDER BY (e.endereco_padrao = 'S') DESC NULLS LAST, e.codend LIMIT 1`.execute(db)).rows[0])
      : undefined;
    // sem o parceiro da empresa o legado seguia com parceiro 0 e a nota não gravava; aqui a recusa diz o que falta
    if (!dest) throw new BusinessRuleError('SCRAP_SEM_PARCEIRO_EMPRESA', { cnpj });
    const ufEmp = String(empresa?.uf ?? '').trim();
    const dentro = !dest.uf || String(dest.uf).trim() === ufEmp;

    // os itens (`qrySCRAP`): só os não faturados, valor = custo do MULTI_PRECO da empresa do scrap
    const linhas = (await sql<Record<string, unknown>>`
      SELECT i.idproduto, i.idproduto_filho, i.qtde, i.motivo, coalesce(m.vrcusto, 0) AS vrcusto,
             p.codbarra, p.unidade, p.aliquota, p.ncmsh, p.cest
        FROM scrap s
        JOIN scrap_item i ON i.codscrap = s.codscrap
        LEFT JOIN produtos p ON p.idproduto = i.idproduto
        LEFT JOIN multi_preco m ON m.idproduto = i.idproduto AND m.idempresa = s.idempresa
       WHERE s.codscrap IN (${sql.join(codigos)}) AND s.idempresa = ${emp} AND coalesce(i.faturado, 'N') = 'N'
       ORDER BY s.codscrap, i.codscrapitem`.execute(db)).rows;
    if (!linhas.length) throw new BusinessRuleError('SCRAP_SEM_ITENS', { scraps: codigos });

    let cfopNota = dentro ? '5927' : '6927';
    const grupos = new Map<string, Record<string, unknown> & { _qtde: number; _total: number }>();
    for (const l of linhas) {
      const chave = `${l.idproduto}|${l.idproduto_filho ?? ''}`;
      const usoInterno = String(l.motivo ?? '').trim().toUpperCase() === 'USO INTERNO';
      if (usoInterno) cfopNota = '5949'; // o legado troca o CFOP da nota também (uNF.pas:13990)
      const g = grupos.get(chave) ?? {
        codproduto: Number(l.idproduto),
        idproduto_filho: l.idproduto_filho != null ? Number(l.idproduto_filho) : undefined,
        codprodnota: (l.codbarra as string) ?? undefined,
        unidade: l.unidade ? String(l.unidade).slice(0, 2) : undefined,
        ncm: (l.ncmsh as string) ?? undefined,
        cest: (l.cest as string) ?? undefined,
        aliquota: String(l.aliquota ?? '').trim() || '0',
        fatorembal: 1,
        // o legado põe 5927 no item sempre (IncluiProdSCRAP); fora da UF o item acompanha o 6927 da nota — o Apollo
        // exige o mesmo 1º dígito no item e na nota (e a produção não tem nenhuma NF de scrap interestadual)
        cfop: usoInterno ? '5949' : dentro ? '5927' : '6927',
        importado_de: 'SCRAP',
        _qtde: 0,
        _total: 0,
      };
      g._qtde += num(l.qtde);
      g._total += num(l.vrcusto) * num(l.qtde);
      grupos.set(chave, g);
    }
    const itens = [...grupos.values()].map(({ _qtde, _total, ...it }) => ({
      ...it,
      quantidade: Math.round(_qtde * 1000) / 1000,
      vrcusto: _qtde > 0 ? _total / _qtde : 0, // o custo ponderado (VRCUSTO = TOTAL_PROD / QUANTIDADE)
    }));
    const cabecalho = { tipo: 'S', cfop: cfopNota, codparceiro: Number(dest.codparceiro), codparceiro_end: Number(dest.codend) };
    // os impostos (CalcValorNota): o mesmo motor do "Recalcular impostos" da tela
    const calc = await this.fiscal.recalcular({ ...cabecalho, itens });
    return { ...cabecalho, scraps: codigos, reimportados: ja, itens: calc.itens };
  }

  /** o VÍNCULO ao gravar a NF: PEDIDO_NF tipo 'S' + SCRAP.IMPORTADO='S', com a trava de reimportação de novo */
  async vincular(codnf: number, dto: { codscraps: number[]; login?: string; senha?: string }): Promise<{ codnf: number; vinculados: number[] }> {
    const emp = this.emp();
    const codigos = [...new Set(dto.codscraps.map(Number))];
    // a liberação grava o LOG_LIBERACOES na sua própria conexão — decide ANTES da transação do vínculo
    const pre = await this.lerScraps(this.dbp.forTenantRead() as AnyDB, emp, codigos);
    const jaLigados = new Set(((await (this.dbp.forTenantRead() as AnyDB).selectFrom('pedido_nf').select('codpedido')
      .where('tipo', '=', 'S').where('codnf', '=', codnf).execute()) as Array<{ codpedido: unknown }>).map((r) => Number(r.codpedido)));
    const reimp = pre.filter((s) => s.importado === 'S' && !jaLigados.has(s.codscrap)).map((s) => s.codscrap);
    if (reimp.length) await this.liberarReimportacao(reimp, dto);

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = (await trx.selectFrom('nf').select(['codnf', 'tipo', 'cancelada']).where('codnf', '=', codnf).where('idempresa', '=', emp)
        .forUpdate().executeTakeFirst()) as { tipo?: string; cancelada?: string } | undefined;
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
      if (nf.cancelada === 'S') throw new BusinessRuleError('NF_CANCELADA', { codnf });
      if (nf.tipo !== 'S') throw new BusinessRuleError('NF_TIPO_INCOMPATIVEL', { codnf, tipo: nf.tipo, esperado: 'S' });
      await this.lerScraps(trx, emp, codigos, true);
      for (const c of codigos) {
        if (!jaLigados.has(c)) await trx.insertInto('pedido_nf').values({ codpedido: c, codnf, tipo: 'S' }).execute();
      }
      await trx.updateTable('scrap').set({ importado: 'S' }).where('idempresa', '=', emp).where('codscrap', 'in', codigos).execute();
      return { codnf, vinculados: codigos };
    });
  }
}

/**
 * ESTORNO do vínculo com o scrap (`AtualizaStatusScrap`, udmNF.pas:3217 — `taExcluir, taCancelar`, só nota de SAÍDA):
 * volta para "não importado" o scrap desta NF que não está em outra; na EXCLUSÃO o legado também apaga a PEDIDO_NF da
 * nota (uNF.pas:4216). Dois chamadores (a exclusão do agregado e o cancelamento da NF-e), na transação deles.
 */
export async function estornarVinculoScrap(trx: AnyDB, codnf: number, tipoNf: string | null, excluir: boolean): Promise<void> {
  if (tipoNf === 'S') {
    await sql`
      UPDATE scrap SET importado = 'N'
       WHERE codscrap IN (SELECT pn.codpedido FROM pedido_nf pn WHERE pn.tipo = 'S' AND pn.codnf = ${codnf})
         AND codscrap NOT IN (SELECT pn.codpedido FROM pedido_nf pn WHERE pn.tipo = 'S' AND pn.codnf <> ${codnf} AND pn.codpedido IS NOT NULL)`.execute(trx);
  }
  if (excluir) await trx.deleteFrom('pedido_nf').where('codnf', '=', codnf).execute();
}
