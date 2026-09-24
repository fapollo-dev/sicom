import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { duasCasas } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { configNaTrx } from '../compras/pedido-heranca';
import { SenhaOperacaoService } from './senha-operacao.service';
import { NfFiscalService } from './nf-fiscal.service';
import { TributacaoRepository } from '../precificacao/tributacao.repository';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const FUSO = 'America/Sao_Paulo';

/**
 * A NF DE CUPOM — importar VENDAS na NF de saída (`btnAddPedidoClick` opção 1, `ImportaVenda`, uNF.pas:13201;
 * dossiê uNF-importar-vendas.md). Viva e crescendo: 170 NFs em 2024, 337 em 2025, 375 em 2026 (situação 9).
 *  - a pesquisa `GET_VENDAS`: um cupom por linha (o CODVENDAS do legado — `codvendas_legado` aqui; o nosso `codvendas`
 *    é o id da linha), com total, cliente, operador e se já foi importado;
 *  - a prévia: cupom NFC-e só entra com a NFC-e autorizada (`NFCProcessada`); o já importado pede a senha ADM; o
 *    cliente é o do cupom; CFOP 5929/6929; cada item da venda vira linha (`IncluiProd`) com o valor da venda, o
 *    arredondar do IAT, os descontos em dinheiro e a alíquota da venda; `AGRUPA_PRODUTO_IMPORT_VENDA` agrupa por
 *    produto e ajusta o valor unitário até o total bater com os cupons (`RealizaAjusteDeValores`);
 *    `ZERAR_ICMS_IMPORTACAO_CUPOM` zera o ICMS com o CST medido na produção; a NFC-e vira referência (modelo 65, pela
 *    chave); o cupom ECF vai na OBS;
 *  - o vínculo no GRAVAR: `VENDAS.IMPORTADO='S'` (e o CODPARCEIRO do cupom), PEDIDO_NF 'V' do cupom ECF, e com
 *    `SUBSTITUI_FINANCEIRO_GERAR_NF` o contas a receber do cupom sai;
 *  - o estorno (`AtualizaStatusCupomFiscal`, udmNF.pas): excluir/cancelar a NF devolve os cupons a "não importado".
 */
@Injectable()
export class NfVendasService {
  constructor(
    private readonly dbp: DatabaseProvider,
    private readonly senhaOp: SenhaOperacaoService,
    private readonly fiscal: NfFiscalService,
    private readonly trib: TributacaoRepository,
  ) {}

  private emp(): number {
    const e = currentTenant().empresaId;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  private cfg(db: AnyDB, codigo: string, emp: number) {
    return configNaTrx(db, codigo, { empresaId: emp, operadorId: currentTenant().operadorId ?? null, modulo: 'Retaguarda' });
  }

  /** a pesquisa `GET_VENDAS`: os cupons não cancelados da empresa, no período (a VENDAS é grande — o período é obrigatório) */
  async disponiveis(f: { data_ini: string; data_fim: string; nrocupom?: number; codparceiro?: number }): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    return (await sql<Record<string, unknown>>`
      SELECT coalesce(v.codvendas_legado, v.codvendas) AS codvendas, max(v.nropedido) AS nropedido, max(v.nrocupom) AS nrocupom,
             (max(v.dtvenda) AT TIME ZONE ${FUSO})::date AS dtvenda, max(v.codparceiro) AS codparceiro, max(p.razao) AS razao,
             max(o.nome) AS operador,
             round(sum(CASE WHEN v.iat = 'A' THEN round(v.qtde * v.vrvenda, 2) ELSE trunc(v.qtde * v.vrvenda, 2) END), 2) AS total,
             round(sum(coalesce(v.desc_acre_medio, 0) + coalesce(v.desc_acre_item, 0) - coalesce(v.desc_departamento, 0) - coalesce(v.desc_promocao, 0)), 4) AS desc_acre,
             coalesce(max(v.importado), 'N') AS importado, coalesce(max(v.venda_nfc), 'N') AS venda_nfc,
             max(v.statusnfe) AS statusnfe, max(v.chavenfe) AS chavenfe
        FROM vendas v
        LEFT JOIN parceiros p ON p.codparceiro = v.codparceiro
        LEFT JOIN operadores o ON o.codoperador = v.operador
       WHERE v.idempresa = ${emp} AND coalesce(v.cancelado, 'N') = 'N'
         AND v.dtvenda >= (${f.data_ini}::date::timestamp AT TIME ZONE ${FUSO})
         AND v.dtvenda < ((${f.data_fim}::date + 1)::timestamp AT TIME ZONE ${FUSO})
         ${f.nrocupom ? sql`AND v.nrocupom = ${f.nrocupom}` : sql``}
         ${f.codparceiro ? sql`AND v.codparceiro = ${f.codparceiro}` : sql``}
       GROUP BY coalesce(v.codvendas_legado, v.codvendas)
       ORDER BY max(v.dtvenda) DESC, coalesce(v.codvendas_legado, v.codvendas) DESC
       LIMIT 500`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
  }

  /** a reimportação: cupom já importado (e que não é desta NF) só com a senha ADM (`SenhaAdministrativa('ADM')`) */
  private async liberarReimportacao(cupons: number[], senhaAdm: string | undefined): Promise<void> {
    if (!senhaAdm) throw new BusinessRuleError('VENDA_JA_IMPORTADA', { cupons });
    const { ok } = await this.senhaOp.verificar('admin', senhaAdm);
    if (!ok) throw new BusinessRuleError('SENHA_ADM_INVALIDA', { tipo: 'admin' });
  }

  /** o CST da NF de cupom com o ICMS zerado — medido na produção (MG, 2026), o fonte de 2020 dizia outra coisa */
  private cstZerado(doc: 'CPF' | 'CNPJ' | null, contribuinte: string, icmsCstVenda: string, ufEmpresa: string, cstAliquota: number): number {
    if (ufEmpresa !== 'MG') return cstAliquota; // o fonte: fora de MG, o CST da alíquota
    if (doc === 'CPF') return 41; // pessoa física: 857 de 863
    if (doc === 'CNPJ') {
      if (icmsCstVenda === '60') return 60; // venda com ST retida: 743 de 743
      if (contribuinte === '9' && icmsCstVenda === '40') return 40; // não contribuinte, venda isenta: 505 de 527
      return 90; // demais: 476 de 530
    }
    return cstAliquota;
  }

  async previa(dto: { codvendas: number[]; senhaAdm?: string }): Promise<Record<string, unknown>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const codigos = [...new Set(dto.codvendas.map(Number))];
    const linhas = (await sql<Record<string, unknown>>`
      SELECT coalesce(v.codvendas_legado, v.codvendas) AS codvendas, v.nropedido, v.nrocupom, v.codproduto, v.descricao, v.unidade, v.qtde, v.vrvenda, v.iat, v.aliquota,
             v.nroitem, coalesce(v.desc_acre_medio, 0) AS desc_acre_medio, coalesce(v.desc_acre_item, 0) AS desc_acre_item,
             coalesce(v.desc_departamento, 0) AS desc_departamento, coalesce(v.desc_promocao, 0) AS desc_promocao,
             v.icms_cst, coalesce(v.venda_nfc, 'N') AS venda_nfc, v.statusnfe, v.chavenfe, v.codnfc, v.codparceiro,
             coalesce(v.importado, 'N') AS importado, p.codbarra, p.ncmsh, p.cest
        FROM vendas v LEFT JOIN produtos p ON p.idproduto = v.codproduto
       WHERE coalesce(v.codvendas_legado, v.codvendas) IN (${sql.join(codigos)}) AND v.idempresa = ${emp} AND coalesce(v.cancelado, 'N') = 'N'
       ORDER BY coalesce(v.codvendas_legado, v.codvendas), v.nroitem`.execute(db)).rows;
    if (!linhas.length) throw new BusinessRuleError('VENDA_NAO_ENCONTRADA', { codvendas: codigos });

    // NFC-e não autorizada não entra (`NFCProcessada` + o SetaPedido que só acha a NFC-e com STATUSNFE='P')
    const naoProcessados = [...new Set(linhas.filter((l) => l.venda_nfc === 'S' && String(l.statusnfe ?? '') !== 'P').map((l) => num(l.codvendas)))];
    const aceitas = linhas.filter((l) => !naoProcessados.includes(num(l.codvendas)));
    if (!aceitas.length) throw new BusinessRuleError('VENDA_NFC_NAO_PROCESSADA', { codvendas: naoProcessados });
    const reimportados = [...new Set(aceitas.filter((l) => l.importado === 'S').map((l) => num(l.codvendas)))];
    if (reimportados.length) await this.liberarReimportacao(reimportados, dto.senhaAdm);

    // o cliente é o do primeiro cupom; a UF dele decide 5929 × 6929
    const codcli = num(aceitas[0].codparceiro);
    const cli = codcli > 0
      ? ((await sql<{ codparceiro: number; codend: number | null; uf: string | null; cnpj_cpf: string | null; contribuinte_icms: string | null }>`
          SELECT p.codparceiro, p.codend, e.uf, e.cnpj_cpf, p.contribuinte_icms FROM parceiros p LEFT JOIN parceiros_end e ON e.codend = p.codend
           WHERE p.codparceiro = ${codcli}`.execute(db)).rows[0])
      : undefined;
    const empresa = (await db.selectFrom('empresas').select(['uf']).where('idempresa', '=', emp).executeTakeFirst()) as { uf?: string } | undefined;
    const ufEmp = String(empresa?.uf ?? '').trim();
    const cfop = cli?.uf && String(cli.uf).trim() !== ufEmp ? '6929' : '5929';
    const digitos = String(cli?.cnpj_cpf ?? '').replace(/\D/g, '');
    const doc: 'CPF' | 'CNPJ' | null = digitos.length === 11 ? 'CPF' : digitos.length === 14 ? 'CNPJ' : null;

    const agrupa = String((await this.cfg(db, 'AGRUPA_PRODUTO_IMPORT_VENDA', emp)) ?? 'N').toUpperCase() === 'S';
    const zeraIcms = String((await this.cfg(db, 'ZERAR_ICMS_IMPORTACAO_CUPOM', emp)) ?? 'N').toUpperCase() === 'S';

    type Item = Record<string, unknown> & { _total: number; _alvo: number; _icmsCst: string };
    const itens: Item[] = [];
    for (const l of aceitas) {
      const q = num(l.qtde);
      const vr = num(l.vrvenda);
      const arr = String(l.iat ?? '') === 'A' ? 'S' : 'N';
      const medio = num(l.desc_acre_medio);
      const itemAcr = num(l.desc_acre_item);
      const desconto = num(l.desc_promocao) + num(l.desc_departamento) + (medio < 0 ? -medio : 0) + (itemAcr < 0 ? -itemAcr : 0);
      const acrescimo = (medio > 0 ? medio : 0) + (itemAcr > 0 ? itemAcr : 0);
      const alvo = duasCasas(q * vr, arr === 'S' ? 'A' : 'T'); // a linha do cupom (GET_VENDAS / RealizaAjusteDeValores)
      const existente = agrupa ? itens.find((i) => num(i.codproduto) === num(l.codproduto)) : undefined;
      if (existente) {
        const qtd = num(existente.quantidade) + q;
        existente._total += q * vr;
        existente._alvo += alvo;
        existente.quantidade = Math.round(qtd * 1000) / 1000;
        existente.vrcusto = existente._total / qtd;
        existente.vrvenda = existente._total / qtd;
        existente.arredonda = arr; // o legado sobrescreve pelo IAT do último item
        existente.vrdescprod = num(existente.vrdescprod) + desconto;
        existente.depsacess = num(existente.depsacess) + acrescimo;
        continue;
      }
      itens.push({
        codproduto: num(l.codproduto), codprodnota: (l.codbarra as string) ?? undefined, nroitem_venda: num(l.nroitem),
        quantidade: q, fatorembal: 1, unidade: l.unidade ? String(l.unidade).slice(0, 2) : undefined,
        vrcusto: vr, vrvenda: vr, arredonda: arr, vrdescprod: desconto, depsacess: acrescimo,
        aliquota: String(l.aliquota ?? '').trim() || undefined, // "vem do PDV" — a alíquota da venda
        cfop, ncm: (l.ncmsh as string) ?? undefined, cest: (l.cest as string) ?? undefined, importado_de: 'VENDAS',
        _total: q * vr, _alvo: alvo, _icmsCst: String(l.icms_cst ?? '').trim(),
      });
    }
    // o AJUSTE de valores do agrupado: o unitário anda de 0,0001 até o total da linha bater com a soma dos cupons,
    // quando a diferença é de até R$ 0,09 (RealizaAjusteDeValores, uNF.pas:13066)
    if (agrupa) {
      for (const it of itens) {
        const modo = it.arredonda === 'S' ? 'A' : 'T';
        const q = num(it.quantidade);
        let vc = Math.round(num(it.vrcusto) * 10000) / 10000;
        const alvo = duasCasas(it._alvo, 'A');
        const dif = Math.abs(duasCasas(q * vc, modo) - alvo);
        if (dif > 0 && dif <= 0.09 + 1e-9) {
          const passo = duasCasas(q * vc, modo) > alvo ? -0.0001 : 0.0001;
          for (let n = 0; n < 100000 && Math.abs(duasCasas(q * vc, modo) - alvo) > 1e-9; n++) vc = Math.round((vc + passo) * 10000) / 10000;
          it.vrcusto = vc;
        }
      }
    }

    // referências: a NFC-e pela chave (modelo 65); o cupom ECF vai na OBS
    const referencias: Array<Record<string, unknown>> = [];
    const ecf: number[] = [];
    for (const cod of [...new Set(aceitas.map((l) => num(l.codvendas)))]) {
      const l = aceitas.find((x) => num(x.codvendas) === cod)!;
      if (l.venda_nfc === 'S') {
        if (!referencias.some((r) => r.chavenfe === l.chavenfe)) referencias.push({ modelo: 65, chavenfe: l.chavenfe ?? undefined, codnf_ref: l.codnfc ?? undefined });
      } else if (!ecf.includes(num(l.nrocupom))) ecf.push(num(l.nrocupom));
    }
    const obs = ecf.length ? `Nota Fiscal Referente ao(s) Cupom(ns): ${ecf.join(',')}. ` : '';

    const cabecalho = { tipo: 'S', cfop, codparceiro: cli?.codparceiro ?? null, codparceiro_end: cli?.codend ?? null };
    let saida: Array<Record<string, unknown>> = itens.map(({ _total, _alvo, _icmsCst, ...i }) => i);
    if (zeraIcms) {
      // ZERAR_ICMS_IMPORTACAO_CUPOM: sem ICMS e o CST pelo destinatário (IncluiProd, uNF.pas:13762)
      saida = await Promise.all(itens.map(async ({ _total, _alvo, _icmsCst, ...i }) => {
        const a = i.aliquota ? await this.trib.resolverAtual(String(i.aliquota), ufEmp).catch(() => null) : null;
        return {
          ...i, icms: 0, icme: 0, vrbasecalculo: 0, vricm: 0, bcr: a?.base ?? undefined,
          cst: this.cstZerado(doc, String(cli?.contribuinte_icms ?? ''), _icmsCst, ufEmp, num(a?.cst)),
        };
      }));
    } else if (cabecalho.codparceiro) {
      saida = ((await this.fiscal.recalcular({ ...cabecalho, itens: saida })).itens ?? saida) as Array<Record<string, unknown>>;
    }
    return { ...cabecalho, cupons: [...new Set(aceitas.map((l) => num(l.codvendas)))], naoProcessados, reimportados, referencias, obs, itens: saida };
  }

  /** o VÍNCULO ao gravar a NF (uNF.pas:5236): VENDAS.IMPORTADO + CODPARCEIRO do cupom, PEDIDO_NF 'V' do ECF, e o AR sai com a config */
  async vincular(codnf: number, dto: { codvendas: number[]; senhaAdm?: string }): Promise<{ codnf: number; vinculados: number[] }> {
    const emp = this.emp();
    const codigos = [...new Set(dto.codvendas.map(Number))];
    const ro = this.dbp.forTenantRead() as AnyDB;
    const cupons = (await sql<{ codvendas: number; nropedido: string; codparceiro: number | null; venda_nfc: string; importado: string }>`
      SELECT coalesce(v.codvendas_legado, v.codvendas) AS codvendas, max(v.nropedido) AS nropedido, max(v.codparceiro) AS codparceiro, coalesce(max(v.venda_nfc), 'N') AS venda_nfc,
             coalesce(max(v.importado), 'N') AS importado
        FROM vendas v WHERE coalesce(v.codvendas_legado, v.codvendas) IN (${sql.join(codigos)}) AND v.idempresa = ${emp} GROUP BY coalesce(v.codvendas_legado, v.codvendas)`.execute(ro)).rows;
    const achados = new Set(cupons.map((c) => num(c.codvendas)));
    const faltam = codigos.filter((c) => !achados.has(c));
    if (faltam.length) throw new BusinessRuleError('VENDA_NAO_ENCONTRADA', { codvendas: faltam });
    const jaDesta = new Set((await sql<{ codvendas: number }>`
      SELECT DISTINCT coalesce(v.codvendas_legado, v.codvendas) AS codvendas FROM vendas v
       WHERE coalesce(v.codvendas_legado, v.codvendas) IN (${sql.join(codigos)})
         AND (coalesce(v.codvendas_legado, v.codvendas) IN (SELECT pn.codpedido FROM pedido_nf pn WHERE pn.tipo = 'V' AND pn.codnf = ${codnf})
              OR v.chavenfe IN (SELECT r.chavenfe FROM nf_referencia r WHERE r.codnf = ${codnf} AND r.modelo = 65 AND r.chavenfe IS NOT NULL))`.execute(ro)).rows.map((r) => num(r.codvendas)));
    const reimp = cupons.filter((c) => c.importado === 'S' && !jaDesta.has(num(c.codvendas))).map((c) => num(c.codvendas));
    if (reimp.length) await this.liberarReimportacao(reimp, dto.senhaAdm);
    const substitui = String((await this.cfg(ro, 'SUBSTITUI_FINANCEIRO_GERAR_NF', emp)) ?? 'N').toUpperCase() === 'S';

    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const nf = (await trx.selectFrom('nf').select(['tipo', 'cancelada']).where('codnf', '=', codnf).where('idempresa', '=', emp).forUpdate().executeTakeFirst()) as { tipo?: string; cancelada?: string } | undefined;
      if (!nf) throw new BusinessRuleError('NF_NAO_ENCONTRADA', { codnf });
      if (nf.cancelada === 'S') throw new BusinessRuleError('NF_CANCELADA', { codnf });
      if (nf.tipo !== 'S') throw new BusinessRuleError('NF_TIPO_INCOMPATIVEL', { codnf, tipo: nf.tipo, esperado: 'S' });
      for (const c of cupons) {
        // o cupom ECF liga pela PEDIDO_NF 'V'; a NFC-e liga pela referência (já gravada na NF)
        if (c.venda_nfc !== 'S' && !jaDesta.has(num(c.codvendas))) {
          await trx.insertInto('pedido_nf').values({ codpedido: num(c.codvendas), codnf, tipo: 'V' }).execute();
        }
        await trx.updateTable('vendas').set({ importado: 'S', codparceiro: num(c.codparceiro) })
          .where('nropedido', '=', c.nropedido).where('idempresa', '=', emp).execute();
        if (substitui) {
          await trx.deleteFrom('areceber').where('nropedido', '=', c.nropedido).where('codempresa', '=', emp).where('quitada', '=', 'N').execute();
        }
      }
      return { codnf, vinculados: codigos };
    });
  }
}

/**
 * ESTORNO dos cupons (`AtualizaStatusCupomFiscal`, udmNF.pas — `taExcluir, taCancelar`, só nota de SAÍDA): o cupom ECF
 * (PEDIDO_NF 'V') e o NFC-e (referência modelo 65) desta NF que não estão em outra voltam a IMPORTADO='N'.
 */
export async function estornarVinculoVendas(trx: AnyDB, codnf: number, tipoNf: string | null): Promise<void> {
  if (tipoNf !== 'S') return;
  await sql`
    UPDATE vendas SET importado = 'N'
     WHERE coalesce(codvendas_legado, codvendas) IN (SELECT pn.codpedido FROM pedido_nf pn WHERE pn.tipo = 'V' AND pn.codnf = ${codnf})
       AND coalesce(codvendas_legado, codvendas) NOT IN (SELECT pn.codpedido FROM pedido_nf pn WHERE pn.tipo = 'V' AND pn.codnf <> ${codnf} AND pn.codpedido IS NOT NULL)`.execute(trx);
  await sql`
    UPDATE vendas SET importado = 'N'
     WHERE chavenfe IN (SELECT r.chavenfe FROM nf_referencia r WHERE r.codnf = ${codnf} AND r.modelo = 65 AND r.chavenfe IS NOT NULL)
       AND chavenfe NOT IN (SELECT r.chavenfe FROM nf_referencia r WHERE r.codnf <> ${codnf} AND r.modelo = 65 AND r.chavenfe IS NOT NULL)`.execute(trx);
}
