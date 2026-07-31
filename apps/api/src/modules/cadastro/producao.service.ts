import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000; // numeric(13,3) — estoque/kardex/consumo
// consumo quantizado a 3 casas (precisão do estoque) → baixa e re-adição usam o MESMO valor → reversível bit-a-bit.

/**
 * PRODUÇÃO — ações verticais de PROCESSAMENTO (molde scrap/ajuste). O documento (cabeçalho+itens de saída) é criado
 * pelo agregado (producao.aggregate); aqui `processar` explode a ficha técnica (receita_prod) de cada acabado
 * (quantidade × receita.qtde / produtos.receitafator), grava o snapshot do consumo (itens_producao_receita), BAIXA
 * os ingredientes de `estoque.qtde` e ENTRA o acabado — ambos com kardex `historico_prod` origem='PRODUCAO'; marca
 * status='P' + dtprocessamento. `reverter` lê o snapshot e reverte EXATAMENTE o que foi consumido (re-adiciona
 * ingredientes, remove o acabado), apaga o snapshot e volta a status='A'. Movimento RELATIVO (compõe com movimento
 * posterior de outra origem). Balde ÚNICO `estoque.qtde` (o ESTOQUE_PROD + Transferência do legado netam a zero no
 * balde real — colapsados). Linhas de SERVIÇO da receita (servico='S') não movem estoque. Tenant fail-closed: o
 * estoque move SEMPRE na empresa do operador (emp), nunca numa empresa vinda do dado (fold auditoria [CRÍTICO]).
 * TOCTOU FECHADO no motor: o `updateAggregate`/`removeAggregate` agora travam o master FOR UPDATE e rodam o
 * `validar`/`validarRemocao` DENTRO da txn (após o lock), serializando contra este `processar` (que também trava o
 * master) — um PUT que corra com o processamento vê o status='P' e é barrado, sem apagar o snapshot por cascata.
 */
@Injectable()
export class ProducaoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op(): number {
    const o = currentTenant().operadorId ?? null;
    if (o == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return o;
  }

  /** PROCESSA: explode a receita, baixa ingredientes, entra o acabado, grava snapshot + kardex. status 'A'→'P'. */
  async processar(codproducao: number): Promise<{ codproducao: number; status: 'P'; acabados: number; ingredientes: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const p = (await trx.selectFrom('producao').select(['codproducao', 'status']).where('codproducao', '=', codproducao).where('idempresa', '=', emp).forUpdate().executeTakeFirst()) as { status?: string } | undefined;
      if (!p) throw new BusinessRuleError('PRODUCAO_NAO_ENCONTRADA', { codproducao });
      if (p.status === 'P') throw new BusinessRuleError('PRODUCAO_JA_PROCESSADA', { codproducao });
      // o estoque move SEMPRE na empresa do tenant (fold [CRÍTICO]) — nunca numa empresa vinda do dado, senão um
      // operador de emp moveria o estoque de outra empresa. codempresa_producao é só registro (= emp por derivarTrx).
      const empProd = emp;

      const itens = (await trx.selectFrom('itens_producao').select(['coditenprod', 'idprodutos', 'qtde', 'unidade']).where('codproducao', '=', codproducao).execute()) as Array<{ coditenprod: number; idprodutos: number; qtde: unknown; unidade?: string }>;
      if (!itens.length) throw new BusinessRuleError('PRODUCAO_SEM_ITENS', { codproducao });

      let ingredientes = 0;
      for (const it of itens) {
        const acabado = Number(it.idprodutos);
        const qtdeProduzir = r3(num(it.qtde));
        // rendimento da receita-base (PRODUTOS.RECEITAFATOR); null/0 → 1 (evita div/0; trata receita como "por unidade").
        const prod = (await trx.selectFrom('produtos').select(['receitafator']).where('idproduto', '=', acabado).executeTakeFirst()) as { receitafator?: unknown } | undefined;
        const fator = num(prod?.receitafator) > 0 ? num(prod?.receitafator) : 1;
        // a receita + o flag SERVIÇO do PRODUTO ingrediente (fiel: no legado o SERVICO vem de PRODUTOS —
        // COALESCE(L.SERVICO,'N') — além do flag da própria linha da receita).
        const receita = (await trx
          .selectFrom('receita_prod as rp')
          .leftJoin('produtos as pr', 'pr.idproduto', 'rp.idproduto_receita')
          .select(['rp.codreceita', 'rp.idproduto_receita', 'rp.qtde', 'rp.unidade', 'rp.servico', 'pr.servico as prod_servico', 'pr.unidade as prod_unidade'])
          .where('rp.idproduto', '=', acabado)
          .execute()) as Array<{ codreceita: number; idproduto_receita: number; qtde: unknown; unidade?: string; servico?: string; prod_servico?: string; prod_unidade?: string }>;
        if (!receita.length) throw new BusinessRuleError('PRODUTO_SEM_RECEITA', { idproduto: acabado });

        for (const r of receita) {
          if ((r.servico ?? 'N') === 'S' || (r.prod_servico ?? 'N') === 'S') continue; // linha/produto de serviço não move estoque
          const ingrediente = Number(r.idproduto_receita);
          // GUARDA de conversão (fold paridade [#2]): quando a unidade da receita é KG/LT e difere da unidade de
          // estoque do produto, o legado converte a qtde retirada da loja por uma tabela FATOR_CONVERSAO (÷fator).
          // No dado real esse caso é MORTO (só o acabado 301084, nunca produzido); as demais unidades caem no ramo-caixa
          // com FATORCXPROD=1 → sem conversão (QUANTIDADE_COM=QUANTIDADE). Em vez de consumir a qtde ERRADA, falha alto
          // (fiel ao ValidarFatorDeConversaoDosItens). Migrar FATOR_CONVERSAO + conversor genérico = corte-2.
          const recUn = String(r.unidade ?? '').trim().toUpperCase();
          const prodUn = String(r.prod_unidade ?? '').trim().toUpperCase();
          if ((recUn === 'KG' || recUn === 'LT') && prodUn && recUn !== prodUn) {
            throw new BusinessRuleError('PRODUCAO_CONVERSAO_NAO_SUPORTADA', { idproduto: ingrediente, receita_unidade: recUn, produto_unidade: prodUn });
          }
          // explosão proporcional ao rendimento (fiel a QuantidadeProporcional = qtd × ingrediente / RECEITAFATOR),
          // quantizada a 3 casas (precisão do estoque) p/ ser exatamente reversível.
          const qtdeConsumida = r3((qtdeProduzir * num(r.qtde)) / fator);
          const mp = (await trx.selectFrom('multi_preco').select(['vrcusto']).where('idproduto', '=', ingrediente).where('idempresa', '=', empProd).executeTakeFirst()) as { vrcusto?: unknown } | undefined;
          // snapshot do consumo (o reverter reverte ESTE valor exato).
          await trx.insertInto('itens_producao_receita').values({
            coditenprod: it.coditenprod, codproduto: ingrediente, quantidade: qtdeConsumida, unidade: r.unidade ?? null,
            vrcusto: num(mp?.vrcusto), codreceita: r.codreceita, troca: 'N', dtcadastro: sql`now()`,
          }).execute();
          // BAIXA do ingrediente pelo MESMO valor gravado no snapshot (reversível bit-a-bit).
          await this.moverEstoque(trx, empProd, ingrediente, -qtdeConsumida, op, `Baixa de estoque via PRODUÇÃO cod ${codproducao}`);
          ingredientes++;
        }
        // ENTRADA do acabado.
        await this.moverEstoque(trx, empProd, acabado, qtdeProduzir, op, `Entrada de produto acabado via PRODUÇÃO cod ${codproducao}`);
      }

      await trx.updateTable('producao').set({ status: 'P', dtprocessamento: sql`now()`, usultalteracao: op, dtultimalteracao: sql`now()` }).where('codproducao', '=', codproducao).where('idempresa', '=', emp).execute();
      return { codproducao, status: 'P' as const, acabados: itens.length, ingredientes };
    });
  }

  /** REVERTE: reverte exatamente o consumo do snapshot (re-adiciona ingredientes, remove o acabado), apaga o
   *  snapshot e volta status 'P'→'A'. */
  async reverter(codproducao: number): Promise<{ codproducao: number; status: 'A'; acabados: number; ingredientes: number }> {
    const emp = this.emp();
    const op = this.op();
    return (this.dbp.forTenant() as AnyDB).transaction().execute(async (trx: AnyDB) => {
      const p = (await trx.selectFrom('producao').select(['codproducao', 'status']).where('codproducao', '=', codproducao).where('idempresa', '=', emp).forUpdate().executeTakeFirst()) as { status?: string } | undefined;
      if (!p) throw new BusinessRuleError('PRODUCAO_NAO_ENCONTRADA', { codproducao });
      if (p.status !== 'P') throw new BusinessRuleError('PRODUCAO_NAO_PROCESSADA', { codproducao });
      const empProd = emp; // estorno reverte no MESMO balde do processamento (a empresa do tenant). Ver fold [CRÍTICO].

      const itens = (await trx.selectFrom('itens_producao').select(['coditenprod', 'idprodutos', 'qtde']).where('codproducao', '=', codproducao).execute()) as Array<{ coditenprod: number; idprodutos: number; qtde: unknown }>;
      let ingredientes = 0;
      for (const it of itens) {
        const consumo = (await trx.selectFrom('itens_producao_receita').select(['codproduto', 'quantidade']).where('coditenprod', '=', it.coditenprod).execute()) as Array<{ codproduto: number; quantidade: unknown }>;
        for (const c of consumo) {
          // re-adiciona o ingrediente pelo MESMO valor consumido (reverte a baixa).
          await this.moverEstoque(trx, empProd, Number(c.codproduto), r3(num(c.quantidade)), op, `Estorno de produção cod ${codproducao}`);
          ingredientes++;
        }
        // remove o acabado que havia entrado.
        await this.moverEstoque(trx, empProd, Number(it.idprodutos), -r3(num(it.qtde)), op, `Estorno de produto acabado via PRODUÇÃO cod ${codproducao}`);
        await trx.deleteFrom('itens_producao_receita').where('coditenprod', '=', it.coditenprod).execute();
      }

      await trx.updateTable('producao').set({ status: 'A', dtprocessamento: null, usultalteracao: op, dtultimalteracao: sql`now()` }).where('codproducao', '=', codproducao).where('idempresa', '=', emp).execute();
      return { codproducao, status: 'A' as const, acabados: itens.length, ingredientes };
    });
  }

  /** movimento RELATIVO do saldo (delta<0 baixa / delta>0 entrada) + 1 linha de KARDEX (historico_prod, origem='PRODUCAO'). */
  private async moverEstoque(trx: AnyDB, emp: number, idproduto: number, delta: number, op: number, historico: string) {
    const est = await trx.selectFrom('estoque').select(['id_estoque', 'qtde']).where('idproduto', '=', idproduto).where('idempresa', '=', emp).forUpdate().executeTakeFirst();
    const saldoAnt = r3(num((est as any)?.qtde));
    const saldoNovo = r3(saldoAnt + delta);
    if (est) {
      await trx.updateTable('estoque').set({ qtde: saldoNovo }).where('id_estoque', '=', (est as any).id_estoque).execute();
    } else {
      try {
        await trx.insertInto('estoque').values({ idproduto, idempresa: emp, qtde: saldoNovo }).execute();
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') throw new BusinessRuleError('PRODUCAO_ESTOQUE_CONCORRENTE', { idproduto });
        throw e;
      }
    }
    await trx.insertInto('historico_prod').values({
      idproduto, idempresa: emp, tipo: delta >= 0 ? 'E' : 'S', qtde: Math.abs(r3(delta)),
      saldo_anterior: saldoAnt, saldo_novo: saldoNovo, origem: 'PRODUCAO', codnf: null,
      historico, data: sql`now()`, codoperador: op,
    }).execute();
  }
}
