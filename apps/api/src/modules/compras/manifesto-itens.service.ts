import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { parseNfeXml, type NfeItemParsed } from './nfe-xml.parser';
import { RecebimentoService } from './recebimento.service';
import { modeloFr3 } from '../../shared/relatorios/modelo-fr3';
import { empresaParaRelatorio, registroFr3 } from '../../shared/relatorios/registro-fr3';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const str = (v: unknown) => (v == null ? '' : String(v));
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export interface ItemAnalisado {
  codnfenaocadit: number; nroitem: number; codprod: string; ean: string; descricao: string; ncm: string; cfop: number | null;
  unidade: string; quantidade: number; fatorembal: number; vrunitario: number; vrtotal: number; vrunitario_trib: number;
  vricmst: number; ipi_nota: number; idproduto: number | null; produto_codbarra: string | null; produto_descricao: string | null;
  produto_cadastrado: 'S' | 'N';
}

/**
 * ANÁLISE DOS ITENS DA NOTA DO MANIFESTO (`TFrmAnalisaItensNfManifesto`, uAnalisaItensNfManifesto.pas — o botão "Itens" da grade,
 * só para ENTRADA). Abrir a análise GRAVA os itens do XML em NFE_NAO_CADASTRADAS_ITENS (o AfterPost do dataset aplica cada
 * linha — uDMManifestoDFe.pas:420) e VINCULA cada um a um produto do cadastro (`CarregaCadastroProduto` :1306), com o fator de
 * embalagem do produto (FATORCX) quando o item ainda não tem; o operador corrige o fator na grade (editável enquanto a nota não
 * está processada) ou manda "fator original" / "fator 1" para todos. A importação da NF usa esse fator
 * (`GetFatorEmbalagemManifesto`, NFe.pas:3092 — o `fatorManifesto` do RecebimentoService). Produção: ~450 notas por mês com
 * itens analisados, 98% dos itens vinculados.
 */
@Injectable()
export class ManifestoItensService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly recebimento: RecebimentoService,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private static chave(c: string): string {
    const ch = str(c).replace(/\D/g, '');
    if (ch.length !== 44) throw new BusinessRuleError('CHAVE_INVALIDA', { chave: c });
    return ch;
  }

  /** o parceiro da nota (CarregaCadastroParceiro :583): PARCEIROS_END pelo CNPJ, o endereço ativo primeiro */
  private async parceiro(db: AnyDB, cnpj: string): Promise<{ codparceiro: number | null; status: 'ATIVO' | 'INATIVO' | 'NAO_CADASTRADO' }> {
    const d = cnpj.replace(/\D/g, '');
    if (!d) return { codparceiro: null, status: 'NAO_CADASTRADO' };
    const r = (await sql<{ codparceiro: number; ativado: string | null }>`
      SELECT e.codparceiro, p.ativado FROM parceiros_end e LEFT JOIN parceiros p ON p.codparceiro = e.codparceiro
       WHERE regexp_replace(coalesce(e.cnpj_cpf, ''), '\\D', '', 'g') = ${d}
       ORDER BY CASE WHEN e.ativado = 'S' THEN 0 ELSE 1 END, e.codend LIMIT 1`.execute(db)).rows[0];
    if (!r) return { codparceiro: null, status: 'NAO_CADASTRADO' };
    return { codparceiro: Number(r.codparceiro), status: str(r.ativado) === 'S' ? 'ATIVO' : 'INATIVO' };
  }

  /** GetProdutoRefFor: a referência do fornecedor (CODREFERENCIA_FOR) — a mais recente */
  private async refFor(db: AnyDB, codigo: string, codfor: number): Promise<number | null> {
    const r = (await sql<{ p: number }>`SELECT idproduto AS p FROM codreferencia_for WHERE codfor = ${codfor} AND codref = ${codigo} ORDER BY codreferencia_for DESC LIMIT 1`.execute(db)).rows[0];
    return r ? Number(r.p) : null;
  }

  /** GetProduto: o código de barras do produto, o código auxiliar (CODAUXILIAR.CODAUXILIAR) e a referência do fornecedor */
  private async produto(db: AnyDB, codigo: string, codfor: number): Promise<number | null> {
    if (!codigo) return null;
    const p = (await sql<{ p: number }>`SELECT min(idproduto) AS p FROM produtos WHERE codbarra = ${codigo}`.execute(db)).rows[0];
    if (p?.p != null) return Number(p.p);
    const a = (await sql<{ p: number }>`SELECT min(idproduto) AS p FROM codauxiliar WHERE codauxiliar = ${codigo}`.execute(db)).rows[0];
    if (a?.p != null) return Number(a.p);
    return this.refFor(db, codigo, codfor);
  }

  /** o vínculo de UM item (CarregaCadastroProduto :1340-1414), na ordem do legado */
  private async vinculo(db: AnyDB, ean: string, codprod: string, codfor: number): Promise<{ idproduto: number | null; ean: string; codprod: string }> {
    let cod: number | null = null;
    let codAux = '';
    let e = ean;
    let c = codprod;
    const truncar = (x: string) => (x.length > 14 || x.length <= 4 ? x.slice(0, 20) : x);
    if (e !== '' && /^\d+$/.test(e.replace(/[^0-9A-Za-z]/g, ''))) {
      e = e.replace(/\./g, '');
      codAux = e.length === 14 && e[0] === '0' ? e.slice(1) : e;
      if (e === c) codAux = c;
    } else if (c !== '') {
      c = c.replace(/\./g, '');
      codAux = truncar(c);
      cod = await this.produto(db, codAux, codfor);
    }
    const codOriginal = cod;
    if (codAux !== '') {
      cod = (await this.refFor(db, codAux, codfor)) ?? codOriginal;
      if (cod == null) {
        if (codAux.length <= 5) codAux = codAux.padStart(5, '0');
        cod = await this.produto(db, codAux, codfor);
        if (cod == null && codAux.length === 13) cod = await this.produto(db, `0${codAux}`, codfor);
      }
    }
    if (cod == null && c !== '') {
      c = c.replace(/\./g, '');
      cod = await this.produto(db, truncar(c), codfor);
    }
    return { idproduto: cod, ean: e, codprod: c };
  }

  private async linhas(db: AnyDB, chave: string): Promise<ItemAnalisado[]> {
    const rows = (await sql<Record<string, unknown>>`
      SELECT i.*, p.codbarra AS produto_codbarra, p.descricao AS produto_descricao
        FROM nfe_nao_cadastradas_itens i LEFT JOIN produtos p ON p.idproduto = i.idproduto
       WHERE i.chavenfe = ${chave} ORDER BY i.nroitem, i.codnfenaocadit`.execute(db)).rows;
    return rows.map((r) => ({
      codnfenaocadit: Number(r.codnfenaocadit), nroitem: Number(r.nroitem), codprod: str(r.codprod), ean: str(r.ean), descricao: str(r.descricao),
      ncm: str(r.ncm), cfop: r.cfop == null ? null : Number(r.cfop), unidade: str(r.unidade), quantidade: num(r.quantidade), fatorembal: num(r.fatorembal),
      vrunitario: num(r.vrunitario), vrtotal: num(r.vrtotal), vrunitario_trib: num(r.vrunitario_trib), vricmst: num(r.vricmst), ipi_nota: num(r.ipi_nota),
      idproduto: r.idproduto == null ? null : Number(r.idproduto), produto_codbarra: r.produto_codbarra == null ? null : str(r.produto_codbarra),
      produto_descricao: r.produto_descricao == null ? null : str(r.produto_descricao),
      produto_cadastrado: r.idproduto != null && Number(r.idproduto) > 0 ? 'S' : 'N',
    }));
  }

  /** a nota na grade do manifesto (tipo, processada) — a análise é das notas da loja */
  private async nota(db: AnyDB, emp: number, chave: string): Promise<{ tipo: string; processada: string; total: number; razao: string; cnpj: string; numero: string }> {
    const r = (await sql<Record<string, unknown>>`
      SELECT tipo, processada, total_nf, razao, cnpj_cpf, numero_nf FROM get_nf_manifesto WHERE idempresa = ${emp} AND chave = ${chave} LIMIT 1`.execute(db)).rows[0];
    if (r) return { tipo: str(r.tipo), processada: str(r.processada), total: num(r.total_nf), razao: str(r.razao), cnpj: str(r.cnpj_cpf), numero: str(r.numero_nf) };
    const q = (await sql<Record<string, unknown>>`SELECT tipo, totalnf, razao, cnpj, nronf FROM nfe_nao_cadastradas WHERE idempresa = ${emp} AND chavenfe = ${chave} LIMIT 1`.execute(db)).rows[0];
    if (!q) throw new BusinessRuleError('NFE_NAO_ENCONTRADA', { chave });
    return { tipo: str(q.tipo) === 'S' ? 'SAIDA' : 'ENTRADA', processada: 'NAO', total: num(q.totalnf), razao: str(q.razao), cnpj: str(q.cnpj), numero: str(q.nronf) };
  }

  /**
   * ABRIR A ANÁLISE (FormShow → CarregarItensNotaFiscal :690 → CarregaCadastroProduto): o XML da chave (sem ele: "Nota fiscal não
   * liberada para visualização dos itens. Realize a ciência da operação."); os itens que ainda não estão na tabela entram
   * (fator 0, sem produto); os que já estão têm a ST e o IPI refeitos do XML enquanto a nota não tem pedido de compra
   * (CODPEDCOMP); depois o vínculo de todos — só com o emitente cadastrado.
   */
  async analisar(chaveEntrada: string) {
    const emp = this.emp();
    const chave = ManifestoItensService.chave(chaveEntrada);
    const dbw = this.dbp.forTenant() as AnyDB;
    const nota = await this.nota(dbw, emp, chave);
    if (nota.tipo !== 'ENTRADA') throw new BusinessRuleError('ANALISE_SO_ENTRADA', {}, 'A análise dos itens é das notas de entrada.');
    const x = (await sql<{ xml: string | null }>`SELECT xml FROM nfe_xml WHERE chavenfe = ${chave} ORDER BY codnfexml DESC LIMIT 1`.execute(dbw)).rows[0];
    if (!x?.xml) throw new BusinessRuleError('XML_ITENS_NAO_LIBERADO', { chave }, 'Nota fiscal não liberada para visualização dos itens. Realize a ciência da operação.');
    const nfe = parseNfeXml(String(x.xml));
    const parceiro = await this.parceiro(dbw, nfe.emitCnpj);
    await dbw.transaction().execute(async (trx: AnyDB) => {
      const existentes = new Map((await sql<{ nroitem: number }>`SELECT nroitem FROM nfe_nao_cadastradas_itens WHERE chavenfe = ${chave}`.execute(trx)).rows.map((r) => [Number(r.nroitem), true]));
      const pedido = (await sql<{ c: unknown }>`SELECT codpedcomp AS c FROM nfe_nao_cadastradas WHERE chavenfe = ${chave} LIMIT 1`.execute(trx)).rows[0];
      const semPedido = pedido?.c == null || str(pedido.c).trim() === '';
      for (const it of nfe.itens) {
        const unitTrib = ManifestoItensService.unitarioComImpostos(it);
        if (!existentes.has(it.nItem)) {
          await trx.insertInto('nfe_nao_cadastradas_itens').values({
            chavenfe: chave, codprod: it.cProd, ean: it.cEAN !== '' ? it.cEAN : it.cProd, descricao: it.xProd.slice(0, 120), nroitem: it.nItem,
            ncm: it.ncm ?? null, cfop: /^\d+$/.test(it.cfopXml) ? Number(it.cfopXml) : null, unidade: it.uCom ?? null, quantidade: it.qCom, fatorembal: 0,
            vrunitario: it.vUnCom, vrtotal: it.vProd, eantrib: it.cEANTrib ?? null, unidadetrib: it.uTrib ?? null, quantidadetrib: it.qTrib ?? null,
            vrunitariotrib: it.vUnTrib ?? null, vrfrete: it.vFrete, vrseg: it.vSeg, vrdesc: it.vDesc, vroutro: it.vOutro,
            indtot: it.indTot != null && /^\d+$/.test(it.indTot) ? Number(it.indTot) : null,
            vrbasest: it.vBCST, vricmst: it.vICMSST, vrfcpst: it.vFCPST, ipi_nota: it.vIPI, vrunitario_trib: unitTrib,
          }).execute();
        } else if (semPedido) {
          await trx.updateTable('nfe_nao_cadastradas_itens')
            .set({ vrbasest: it.vBCST, vricmst: it.vICMSST, ipi_nota: it.vIPI, vrunitario_trib: unitTrib })
            .where('chavenfe', '=', chave).where('nroitem', '=', it.nItem).execute();
        }
      }
      if (parceiro.codparceiro != null) await this.vincularTodos(trx, chave, parceiro.codparceiro);
    });
    return {
      chave, numero: nota.numero, razao: nfe.emitNome ?? nota.razao, cnpj: nfe.emitCnpj, total: nota.total,
      parceiro, editavel: nota.processada !== 'SIM',
      itens: await this.linhas(dbw, chave),
    };
  }

  /**
   * O "Imprimir" da análise dos itens (`ImprimirRelatorioProdManifesto`, uAnalisaItensNfManifesto.pas:1050): `Manifesto_Destinatario_Itens.fr3`
   * com os itens da nota (`frxDBDatasetProdManifesto` = a cópia do cdsNotasNaoImportadasItens, na ordem do NROITEM) — todos, só os
   * cadastrados (`ProdutoCadastrado = 'S'`) ou só os não cadastrados —, a linha da nota na grade (`frxDBDatasetDadosNota` = a
   * GET_NF_MANIFESTO: CHAVE, CNPJ_CPF, DATA_EMISSAO, NUMERO_NF, RAZAO, TOTAL_NF) e a empresa. Sem item: a mensagem do legado.
   */
  async impressaoItens(chaveEntrada: string, filtro: 'todos' | 'cadastrados' | 'nao-cadastrados') {
    const emp = this.emp();
    const chave = ManifestoItensService.chave(chaveEntrada);
    const db = this.dbp.forTenantRead() as AnyDB;
    const itens = (await this.linhas(db, chave)).filter((i) => filtro === 'todos' || (filtro === 'cadastrados' ? i.produto_cadastrado === 'S' : i.produto_cadastrado !== 'S'));
    if (!itens.length) throw new BusinessRuleError('RELATORIO_SEM_REGISTROS', {}, 'Não existem produtos listados para construir o relatório.');
    const nota = (await sql<Record<string, unknown>>`SELECT * FROM get_nf_manifesto WHERE idempresa = ${emp} AND chave = ${chave} LIMIT 1`.execute(db)).rows[0] ?? { chave };
    return {
      titulo: `Produtos da NF ${str(nota.numero_nf ?? '')}`,
      modelo: await modeloFr3(db, 'Manifesto_Destinatario_Itens.fr3'),
      datasets: {
        frxDBDatasetProdManifesto: itens.map((i) => registroFr3({ ...i, produtocadastrado: i.produto_cadastrado })),
        frxDBDatasetDadosNota: [registroFr3(nota, new Set(['total_nf', 'idempresa']))],
        frxDBDatasetDadosEmpresa: [await empresaParaRelatorio(db, emp)],
      },
    };
  }

  /** VRUNITARIO_TRIB = vUnCom + vICMSST/qCom + vIPI/qCom (:829) */
  private static unitarioComImpostos(it: NfeItemParsed): number {
    return r6(it.vUnCom + (it.qCom ? it.vICMSST / it.qCom : 0) + (it.qCom ? it.vIPI / it.qCom : 0));
  }

  private async vincularTodos(trx: AnyDB, chave: string, codfor: number): Promise<void> {
    const itens = (await sql<Record<string, unknown>>`SELECT codnfenaocadit, ean, codprod, fatorembal FROM nfe_nao_cadastradas_itens WHERE chavenfe = ${chave}`.execute(trx)).rows;
    for (const it of itens) {
      const v = await this.vinculo(trx, str(it.ean), str(it.codprod), codfor);
      const set: Record<string, unknown> = { ean: v.ean || null, codprod: v.codprod || null };
      if (v.idproduto != null) {
        set.idproduto = v.idproduto;
        if (num(it.fatorembal) === 0) set.fatorembal = await this.fatorCx(trx, v.idproduto);
      }
      await trx.updateTable('nfe_nao_cadastradas_itens').set(set).where('codnfenaocadit', '=', Number(it.codnfenaocadit)).execute();
    }
  }

  /** GetFatorEmbalagem: o FATORCX do produto; 0 ou sem produto → 1 */
  private async fatorCx(db: AnyDB, idproduto: number | null): Promise<number> {
    if (!idproduto) return 1;
    const r = (await sql<{ f: unknown }>`SELECT fatorcx AS f FROM produtos WHERE idproduto = ${idproduto}`.execute(db)).rows[0];
    const f = num(r?.f);
    return f === 0 ? 1 : f;
  }

  private async exigeEditavel(db: AnyDB, chave: string): Promise<void> {
    const emp = this.emp();
    const nota = await this.nota(db, emp, chave);
    if (nota.processada === 'SIM') throw new BusinessRuleError('ANALISE_NOTA_PROCESSADA', {}, 'A nota já está processada: o fator de embalagem não pode mais ser alterado.');
  }

  /** o fator digitado na grade (a coluna FATOREMBAL, editável com a nota não processada) */
  async gravarFatores(chaveEntrada: string, itens: Array<{ nroitem: number; fatorembal: number }>) {
    const chave = ManifestoItensService.chave(chaveEntrada);
    const db = this.dbp.forTenant() as AnyDB;
    await this.exigeEditavel(db, chave);
    await db.transaction().execute(async (trx: AnyDB) => {
      for (const it of itens) {
        await trx.updateTable('nfe_nao_cadastradas_itens').set({ fatorembal: Math.max(0, num(it.fatorembal)) })
          .where('chavenfe', '=', chave).where('nroitem', '=', Number(it.nroitem)).execute();
      }
    });
    return { itens: await this.linhas(db, chave) };
  }

  /** "Atribuir fator original de todos os itens" (:241 — o FATORCX de cada produto) e "Atribuir fator 1,0 a todos os itens" (:278) */
  async fatorParaTodos(chaveEntrada: string, modo: 'original' | 'unitario') {
    const chave = ManifestoItensService.chave(chaveEntrada);
    const db = this.dbp.forTenant() as AnyDB;
    await this.exigeEditavel(db, chave);
    const itens = (await sql<{ codnfenaocadit: number; idproduto: number | null }>`SELECT codnfenaocadit, idproduto FROM nfe_nao_cadastradas_itens WHERE chavenfe = ${chave}`.execute(db)).rows;
    if (!itens.length) throw new BusinessRuleError('ANALISE_SEM_ITENS', {}, 'Os produtos desta nota fiscal não foram localizados.');
    await db.transaction().execute(async (trx: AnyDB) => {
      for (const it of itens) {
        const f = modo === 'unitario' ? 1 : await this.fatorCx(trx, it.idproduto == null ? null : Number(it.idproduto));
        await trx.updateTable('nfe_nao_cadastradas_itens').set({ fatorembal: f }).where('codnfenaocadit', '=', Number(it.codnfenaocadit)).execute();
      }
    });
    return { itens: await this.linhas(db, chave) };
  }

  /**
   * VINCULAR o item a um produto do cadastro: grava a referência do fornecedor (CODREFERENCIA_FOR — o InsereRefFornecedorXML das
   * opções "anexar" da importação, uNF.pas:12446) com o EAN e o código do item, e refaz o vínculo da nota. É o caminho do
   * legado para o item que o cadastro não reconhece (lá, pelo cadastro do produto ou pela importação).
   */
  async vincular(chaveEntrada: string, nroitem: number, idproduto: number) {
    const chave = ManifestoItensService.chave(chaveEntrada);
    const db = this.dbp.forTenant() as AnyDB;
    const it = (await sql<{ ean: string | null; codprod: string | null }>`SELECT ean, codprod FROM nfe_nao_cadastradas_itens WHERE chavenfe = ${chave} AND nroitem = ${nroitem} LIMIT 1`.execute(db)).rows[0];
    if (!it) throw new BusinessRuleError('ANALISE_SEM_ITENS', {}, 'O item não está na análise desta nota.');
    const x = (await sql<{ xml: string | null }>`SELECT xml FROM nfe_xml WHERE chavenfe = ${chave} ORDER BY codnfexml DESC LIMIT 1`.execute(db)).rows[0];
    const cnpj = x?.xml ? parseNfeXml(String(x.xml)).emitCnpj : '';
    const p = await this.parceiro(db, cnpj);
    if (p.codparceiro == null) throw new BusinessRuleError('ANALISE_PARCEIRO_NAO_CADASTRADO', {}, 'O emitente da nota não está cadastrado: cadastre o fornecedor antes de vincular os produtos.');
    await this.recebimento.vincularProdutos({ codfor: p.codparceiro, vinculos: [{ idproduto: Number(idproduto), cEAN: str(it.ean), cProd: str(it.codprod) }] });
    await db.transaction().execute(async (trx: AnyDB) => this.vincularTodos(trx, chave, p.codparceiro!));
    return { itens: await this.linhas(db, chave) };
  }
}
