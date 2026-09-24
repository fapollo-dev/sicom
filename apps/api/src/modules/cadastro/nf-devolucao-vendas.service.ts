import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { ImportarDevolucaoVendasNfDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { LiberacaoService } from '../auth/liberacao.service';
import { ConfigService } from './config.service';
import { NfFiscalService } from './nf-fiscal.service';
import { configNaTrx } from '../compras/pedido-heranca';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const FUSO = 'America/Sao_Paulo';
const CUPOM = sql`coalesce(v.codvendas_legado, v.codvendas)`;

/**
 * NF DE ENTRADA DE DEVOLUÇÃO DE VENDAS — importar os itens devolvidos dos cupons (`IniciarImportacaoEntrada(1)`,
 * uNF.pas:5900-6140; `IncluiProdDevoucaoVendas` :13816), disparada pela situação 2 (IMPORTACAO_AUTO_NF='DE'). Viva: uma NF
 * por ano. O cupom é o CODVENDAS do legado (`vendas.codvendas_legado`; o nosso `codvendas` é o id da linha).
 *  - a pesquisa `GET_DEVOLUCAO_VENDAS`: um item devolvido por cupom × produto (VENDAS.DEVOLUCAO='D'), com "importado" e
 *    "NF-e enviada";
 *  - a prévia: parceiro = o da empresa (EMITIR_DEVOL_VENDA_PARCEIRO_EMP) ou o do cupom; CFOP 1202/2202 pela UF; os itens
 *    com a quantidade e o valor devolvidos, o desconto/acréscimo rateado, a alíquota da venda e o CFOP 1411/2411 para o
 *    produto em substituição tributária (STB); agrupados por produto; `DESTACA_ICMS_DEVOLUCAO_VENDA` ≠ 'S' zera o ICMS
 *    (CST 41; 90 em GO); a NFC-e vira referência modelo 65; a OBS lista os cupons; o já importado pede a liberação de
 *    USUARIOS_LIBERAM_DEVOL_VENDA_NF;
 *  - o vínculo no GRAVAR (`InsereRefCuponsDevolucao`): NF_CUPONS_REFERENCIA, VENDAS.IMPORTADO_DEVOLUCAO + CODNF_DEVOLUCAO,
 *    NF.CUPONS_REF_DEVOLUCAO; o parceiro vira fornecedor (FRN='S');
 *  - o estorno ao excluir a NF (`RemoveRefCuponsDevolucao`).
 */
@Injectable()
export class NfDevolucaoVendasService {
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

  private cfg(db: AnyDB, codigo: string, emp: number) {
    return configNaTrx(db, codigo, { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' });
  }

  /** a pesquisa `GET_DEVOLUCAO_VENDAS` (período da venda — a VENDAS é grande) */
  async disponiveis(f: { data_ini: string; data_fim: string; nrocupom?: number }): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    return (await sql<Record<string, unknown>>`
      SELECT ${CUPOM} AS codvendas, v.nropedido, v.nrocupom, v.codproduto, max(pr.descricao) AS produto, max(p.razao) AS cliente,
             (min(v.dtvenda) AT TIME ZONE ${FUSO})::date AS dtvenda, max(v.codparceiro) AS codparceiro,
             coalesce(max(v.importado_devolucao), 'N') AS importado, max(v.codnf_devolucao) AS codnf,
             CASE WHEN max(nf.statusnfe) = 'P' AND max(nf.chavenfe) IS NOT NULL THEN 'S' ELSE 'N' END AS nfe_enviada,
             (max(d.datadevolucao) AT TIME ZONE ${FUSO})::date AS datadevolucao,
             sum(v.qtde) AS qtde, sum(v.qtde_devolvido) AS qtde_devolvido, sum(v.total_item_devolvido) AS total_item_devolvido,
             coalesce(max(v.venda_nfc), 'N') AS venda_nfc
        FROM vendas v
        LEFT JOIN devolucao_vendas d ON d.codvendas = ${CUPOM} AND d.codproduto = v.codproduto AND d.nroitem = v.nroitem
        LEFT JOIN parceiros p ON p.codparceiro = v.codparceiro
        LEFT JOIN produtos pr ON pr.idproduto = v.codproduto
        LEFT JOIN nf ON nf.codnf = v.codnf_devolucao
       WHERE v.idempresa = ${emp} AND v.devolucao = 'D'
         AND v.dtvenda >= (${f.data_ini}::date::timestamp AT TIME ZONE ${FUSO})
         AND v.dtvenda < ((${f.data_fim}::date + 1)::timestamp AT TIME ZONE ${FUSO})
         ${f.nrocupom ? sql`AND v.nrocupom = ${f.nrocupom}` : sql``}
       GROUP BY ${CUPOM}, v.nropedido, v.nrocupom, v.codproduto
       ORDER BY ${CUPOM}
       LIMIT 1000`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
  }

  /** a reimportação: devolução já importada (em outra NF) só com a liberação de USUARIOS_LIBERAM_DEVOL_VENDA_NF */
  private async liberarReimportacao(cupons: number[], cred: { login?: string; senha?: string }): Promise<void> {
    const permitidos = await this.config.usuariosPermitidos('USUARIOS_LIBERAM_DEVOL_VENDA_NF');
    if (!permitidos.length) throw new BusinessRuleError('DEVOLUCAO_VENDA_SEM_LIBERADOR', { cupons });
    if (!cred.login || !cred.senha) throw new BusinessRuleError('DEVOLUCAO_VENDA_JA_IMPORTADA', { cupons });
    const lib = await this.liberacao.validar({
      codigo: 'USUARIOS_LIBERAM_DEVOL_VENDA_NF', login: cred.login, senha: cred.senha,
      liberacao: `REIMPORTACAO DE DEVOLUCAO DE VENDAS NA NOTA FISCAL: ${cupons.join(', ')}`,
    });
    if (!lib.liberado) throw new BusinessRuleError('LIBERACAO_NAO_AUTORIZADA', { codigo: 'USUARIOS_LIBERAM_DEVOL_VENDA_NF' });
  }

  /** os itens escolhidos (cupom × produto) com a devolução, na ordem da pesquisa */
  private async lerSelecao(db: AnyDB, emp: number, itens: Array<{ codvendas: number; codproduto: number }>) {
    const pares = itens.map((i) => sql`(${Number(i.codvendas)}::bigint, ${Number(i.codproduto)}::bigint)`);
    const rows = (await sql<Record<string, unknown>>`
      SELECT ${CUPOM} AS codvendas, v.codproduto, max(v.nropedido) AS nropedido, max(v.nrocupom) AS nrocupom,
             (min(v.dtvenda) AT TIME ZONE ${FUSO})::date AS dtvenda, max(v.codparceiro) AS codparceiro,
             coalesce(max(v.importado_devolucao), 'N') AS importado, coalesce(max(v.venda_nfc), 'N') AS venda_nfc,
             max(v.chavenfe) AS chavenfe, max(v.codnfc) AS codnfc
        FROM vendas v
       WHERE v.idempresa = ${emp} AND v.devolucao = 'D' AND coalesce(v.qtde_devolvido, 0) > 0
         AND (${CUPOM}, v.codproduto) IN (${sql.join(pares)})
       GROUP BY ${CUPOM}, v.codproduto
       ORDER BY ${CUPOM}, v.codproduto`.execute(db)).rows;
    const achados = new Set(rows.map((r) => `${num(r.codvendas)}|${num(r.codproduto)}`));
    const faltam = itens.filter((i) => !achados.has(`${Number(i.codvendas)}|${Number(i.codproduto)}`));
    if (faltam.length) throw new BusinessRuleError('DEVOLUCAO_VENDA_NAO_ENCONTRADA', { itens: faltam });
    return rows;
  }

  async previa(dto: ImportarDevolucaoVendasNfDto): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const sel = await this.lerSelecao(db, emp, dto.itens);
    const reimportados = [...new Set(sel.filter((s) => s.importado === 'S').map((s) => num(s.nrocupom)))];
    if (reimportados.length) await this.liberarReimportacao(reimportados, dto);

    // o parceiro: o da empresa (EMITIR_DEVOL_VENDA_PARCEIRO_EMP) ou o do cupom; sem nenhum, a tela pede o cliente
    const empresa = (await sql<{ uf: string | null; codparceiro: number | null; fantasia: string | null }>`
      SELECT uf, codparceiro, fantasia FROM empresas WHERE idempresa = ${emp}`.execute(db)).rows[0];
    let codparceiro: number | null = null;
    if (String((await this.cfg(db, 'EMITIR_DEVOL_VENDA_PARCEIRO_EMP', emp)) ?? 'N') === 'S') {
      if (!num(empresa?.codparceiro)) throw new BusinessRuleError('DEVOLUCAO_VENDA_SEM_PARCEIRO_EMPRESA', { empresa: emp });
      codparceiro = num(empresa?.codparceiro);
    } else if (num(sel[0].codparceiro) > 0) codparceiro = num(sel[0].codparceiro);
    const cli = codparceiro
      ? (await sql<{ codend: number | null; uf: string | null }>`SELECT p.codend, e.uf FROM parceiros p LEFT JOIN parceiros_end e ON e.codend = p.codend WHERE p.codparceiro = ${codparceiro}`.execute(db)).rows[0]
      : undefined;
    const ufEmp = String(empresa?.uf ?? '').trim();
    const dentro = !cli?.uf || String(cli.uf).trim() === ufEmp;
    const cfop = dentro ? '1202' : '2202';

    // os itens devolvidos (fdqDevolucao_Vendas, uNF.pas:6093-6118): por cupom × produto × valor × item
    type Item = Record<string, unknown> & { _total: number };
    const itens: Item[] = [];
    for (const s of sel) {
      const grupos = (await sql<Record<string, unknown>>`
        SELECT v.codproduto, max(pr.codbarra) AS codbarra, max(pr.descricao) AS descricao, max(pr.unidade) AS unidade, v.aliquota,
               max(pr.aliquota) AS aliquota_produto, max(pr.ncmsh) AS ncmsh,
               ((sum(((coalesce(v.desc_promocao, 0) + coalesce(v.desc_departamento, 0)) * -1) + coalesce(v.desc_acre_medio, 0) + coalesce(v.desc_acre_item, 0))
                 / nullif(sum(v.qtde), 0)) * sum(v.qtde_devolvido)) AS desc_acre,
               v.vrvenda, sum(v.qtde_devolvido) AS qtde_devolvido, a.nroitem
          FROM vendas v
          LEFT JOIN devolucao_vendas a ON a.codvendas = ${CUPOM} AND a.codproduto = v.codproduto AND a.nroitem = v.nroitem
          LEFT JOIN produtos pr ON pr.idproduto = v.codproduto
         WHERE ${CUPOM} = ${num(s.codvendas)} AND v.codproduto = ${num(s.codproduto)} AND v.idempresa = ${emp}
           AND coalesce(v.qtde_devolvido, 0) > 0
         GROUP BY v.vrvenda, v.codproduto, v.aliquota, a.nroitem
         ORDER BY v.codproduto`.execute(db)).rows;
      for (const g of grupos) {
        const q = num(g.qtde_devolvido);
        const vr = num(g.vrvenda);
        const da = num(g.desc_acre);
        const existente = itens.find((i) => num(i.codproduto) === num(g.codproduto));
        if (existente) {
          // o mesmo produto de outro cupom: soma a quantidade e o total, e o unitário vira a média (UsaLocate)
          const qtd = num(existente.quantidade) + q;
          existente._total += vr * q;
          existente.quantidade = Math.round(qtd * 1000) / 1000;
          existente.vrcusto = existente._total / qtd;
          existente.vrvenda = existente._total / qtd;
          if (da < 0) existente.vrdescprod = num(existente.vrdescprod) + -da; else existente.depsacess = num(existente.depsacess) + da;
          continue;
        }
        // o CFOP do item pela alíquota do PRODUTO: ST (STB) → 1411/2411; senão 1202/2202. O fonte põe 1202 também fora do
        // estado, o que o próprio legado recusa ao gravar ("o início do CFOP dos itens deve ser igual ao da nota")
        const st = String(g.aliquota_produto ?? '').trim() === 'STB';
        itens.push({
          codproduto: num(g.codproduto), codprodnota: (g.codbarra as string) ?? undefined, nroitem_venda: g.nroitem == null ? undefined : num(g.nroitem),
          quantidade: q, fatorembal: 1, unidade: g.unidade ? String(g.unidade).slice(0, 2) : undefined,
          vrcusto: vr, vrvenda: vr, arredonda: 'N', vrdescprod: da < 0 ? -da : 0, depsacess: da > 0 ? da : 0,
          aliquota: String(g.aliquota ?? '').trim() || undefined, // "não muda a alíquota, pois vem do PDV"
          cfop: st ? (dentro ? '1411' : '2411') : (dentro ? '1202' : '2202'), ncm: (g.ncmsh as string) ?? undefined, importado_de: 'DEVOLUCAO_VENDAS',
          _total: vr * q,
        });
      }
    }

    // a NFC-e vira referência modelo 65 (SetaPedido com VendaNFC); a OBS lista os cupons
    const referencias: Array<Record<string, unknown>> = [];
    for (const s of sel) {
      if (s.venda_nfc === 'S' && s.chavenfe && !referencias.some((r) => r.chavenfe === s.chavenfe)) {
        referencias.push({ modelo: 65, chavenfe: s.chavenfe, codnf_ref: s.codnfc ?? undefined });
      }
    }
    const cuponsObs = [...new Set(sel.map((s) => num(s.nrocupom)))];
    const obs = `Nota Fiscal Referente ao(s) Cupom(ns): ${cuponsObs.join(',')}`;

    const cabecalho = { tipo: 'E', cfop, codparceiro, codparceiro_end: cli?.codend ?? null };
    let saida: Array<Record<string, unknown>> = itens.map(({ _total, ...i }) => i);
    if (String((await this.cfg(db, 'DESTACA_ICMS_DEVOLUCAO_VENDA', emp)) ?? 'N') !== 'S') {
      // sem destaque: ICMS zerado, CST 41 (90 em GO)
      saida = saida.map((i) => ({ ...i, icms: 0, icme: 0, bcr: 0, vrbasecalculo: 0, vricm: 0, icms_nota_valor: 0, icms_nota_bc: 0, cst: ufEmp === 'GO' ? 90 : 41 }));
    } else if (codparceiro) {
      saida = ((await this.fiscal.recalcular({ ...cabecalho, itens: saida })).itens ?? saida) as Array<Record<string, unknown>>;
    }
    return {
      ...cabecalho, semParceiro: !codparceiro, reimportados, referencias, obs,
      itensSelecionados: sel.map((s) => ({ codvendas: num(s.codvendas), codproduto: num(s.codproduto), nrocupom: num(s.nrocupom) })),
      itens: saida,
    };
  }

  /** o vínculo ao GRAVAR a NF (uNF.pas:5211-5234 → `InsereRefCuponsDevolucao`, udmNF.pas:10907) */
  async vincular(codnf: number, dto: ImportarDevolucaoVendasNfDto): Promise<{ codnf: number; cupons: number[] }> {
    const emp = this.emp();
    const ro = this.dbp.forTenantRead() as AnyDB;
    const sel = await this.lerSelecao(ro, emp, dto.itens);
    const jaDesta = new Set((await sql<{ nrocupom: number }>`SELECT nrocupom FROM nf_cupons_referencia WHERE codnf = ${codnf} AND finalidade = 'D'`.execute(ro)).rows.map((r) => num(r.nrocupom)));
    const reimp = [...new Set(sel.filter((s) => s.importado === 'S' && !jaDesta.has(num(s.nrocupom))).map((s) => num(s.nrocupom)))];
    if (reimp.length) await this.liberarReimportacao(reimp, dto);
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = (await trx.selectFrom('nf').select(['tipo', 'cancelada', 'codparceiro']).where('codnf', '=', codnf).where('idempresa', '=', emp).forUpdate().executeTakeFirst()) as { tipo?: string; cancelada?: string; codparceiro?: number } | undefined;
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
      if (nf.cancelada === 'S') throw new BusinessRuleError('NF_CANCELADA', { codnf });
      if (nf.tipo !== 'E') throw new BusinessRuleError('NF_TIPO_INCOMPATIVEL', { codnf, tipo: nf.tipo, esperado: 'E' });
      const lista: number[] = [];
      for (const s of sel) {
        const nroecf = Number(String(s.nropedido ?? '').slice(0, 2)) || 0;
        await sql`INSERT INTO nf_cupons_referencia (codnf, codvendas, nropedido, nrocupom, dtvenda, nroecf, finalidade, venda_nfc)
                  VALUES (${codnf}, ${num(s.codvendas)}, ${String(s.nropedido ?? '')}, ${num(s.nrocupom)}, ${s.dtvenda}, ${nroecf}, 'D', ${String(s.venda_nfc ?? 'N')})
                  ON CONFLICT (codnf, nrocupom, dtvenda, nroecf) DO NOTHING`.execute(trx);
        // o legado só marca o produto que criou a referência (o 2º produto do mesmo cupom ficava sem marca) — aqui, todos
        await sql`UPDATE vendas v SET importado_devolucao = 'S', codnf_devolucao = ${codnf}
                  WHERE ${CUPOM} = ${num(s.codvendas)} AND v.codproduto = ${num(s.codproduto)} AND v.idempresa = ${emp}`.execute(trx);
        lista.push(num(s.nrocupom));
      }
      await trx.updateTable('nf').set({ cupons_ref_devolucao: lista.join(',').slice(0, 4000) }).where('codnf', '=', codnf).execute();
      // o parceiro da devolução vira fornecedor (uNF.pas:5944-5961)
      if (nf.codparceiro) await sql`UPDATE parceiros SET frn = 'S' WHERE codparceiro = ${nf.codparceiro} AND coalesce(frn, 'N') <> 'S'`.execute(trx);
      return { codnf, cupons: lista };
    });
  }
}

/**
 * ESTORNO ao excluir a NF (`RemoveRefCuponsDevolucao`, udmNF.pas:10945; chamada em uNF.pas:4287): o cupom desta NF que não
 * está em outra volta a "não importado"; as referências da NF saem com ela.
 */
export async function estornarDevolucaoVendas(trx: AnyDB, codnf: number, emp: number | null): Promise<void> {
  const refs = (await sql<Record<string, unknown>>`SELECT codvendas, nropedido, nrocupom, dtvenda, nroecf FROM nf_cupons_referencia WHERE codnf = ${codnf} AND finalidade = 'D'`.execute(trx)).rows;
  for (const r of refs) {
    const outra = (await sql`SELECT 1 FROM nf_cupons_referencia WHERE codvendas = ${r.codvendas} AND nropedido = ${r.nropedido} AND nrocupom = ${r.nrocupom}
        AND dtvenda = ${r.dtvenda} AND nroecf = ${r.nroecf} AND finalidade = 'D' AND codnf <> ${codnf} LIMIT 1`.execute(trx)).rows.length > 0;
    if (outra) continue;
    await sql`UPDATE vendas v SET importado_devolucao = 'N', codnf_devolucao = NULL
              WHERE ${CUPOM} = ${r.codvendas} AND v.nropedido = ${r.nropedido} AND v.nrocupom = ${r.nrocupom} AND v.devolucao = 'D'
                ${emp != null ? sql`AND v.idempresa = ${emp}` : sql``}`.execute(trx);
  }
  await sql`DELETE FROM nf_cupons_referencia WHERE codnf = ${codnf}`.execute(trx);
}
