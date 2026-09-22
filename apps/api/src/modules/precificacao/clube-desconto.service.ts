import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ClubeDescontoConsultaDto, ClubeDescontoDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * CLUBE DE DESCONTO — o cadastro das regras. Migration 285. Dossiê `uClubeDesconto.md`.
 *
 * Sem tela e sem fonte: não há formulário do clube no `MENUEXPRESS`, e no fonte de mai/2020 há só o rastro
 * (`ckbPublicidadeClubeFidelidade`, `VRCLUBE_FIDELIDADE`). As tabelas começam em jul/2020 — posteriores ao
 * snapshot. Convertido pelo dado, e o dado é grande: **3.118.725 movimentos, 824.491 só em 2026**.
 *
 * ⚠️ A regra central: o `valor` muda de unidade conforme a operação e o `tipo`. Em `PRECO` (2.970 das
 * 3.111 regras) ele é o **preço em reais** e vai de 0,99 a 419,40; em `VARIAVEL` é **percentual** e fica
 * entre 6 e 20. Tratar tudo como percentual daria 419% de desconto; tudo como preço venderia a R$ 6,00 o
 * que deveria ter 6% de desconto.
 */
@Injectable()
export class ClubeDescontoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op() { return currentTenant().operadorId ?? null; }

  /**
   * O preço efetivo que a regra produz sobre um preço normal.
   *
   * É UMA função, e existe justamente para que a interpretação do par `valor`/`tipo` não se espalhe: quem
   * precisar do efeito da regra chama isto, em vez de reimplementar a leitura do valor e errar a unidade.
   */
  precoEfetivo(regra: { operacao: string; valor: number | null; tipo: string | null }, precoNormal: number) {
    const v = num(regra.valor);
    if (regra.operacao === 'PRECO') return r2(v);                       // o valor É o preço
    if (regra.tipo === '%') return r2(precoNormal * (1 - v / 100));     // percentual de desconto
    if (regra.tipo === '$') return r2(Math.max(0, precoNormal - v));    // desconto em reais
    return r2(precoNormal);                                             // sem efeito de preço
  }

  private linha(r: Record<string, unknown>) {
    const valor = r.valor == null ? null : Number(r.valor);
    const tipo = (r.tipo as string | null) ?? null;
    const precoNormal = r.preco_normal == null ? null : Number(r.preco_normal);
    return {
      ...r,
      valor, quantidade: r.quantidade == null ? null : Number(r.quantidade),
      quantidade_paga: r.quantidade_paga == null ? null : Number(r.quantidade_paga),
      minimo: r.minimo == null ? null : Number(r.minimo),
      maximo: r.maximo == null ? null : Number(r.maximo),
      preco_normal: precoNormal,
      // o efeito da regra, já resolvido — para que a tela não precise saber ler o par valor/tipo
      preco_clube: precoNormal == null ? null
        : this.precoEfetivo({ operacao: String(r.operacao), valor, tipo }, precoNormal),
      // como ler o `valor` desta linha, em uma palavra
      unidade_valor: String(r.operacao) === 'PRECO' ? 'preço em R$'
        : tipo === '%' ? 'percentual' : tipo === '$' ? 'desconto em R$' : '—',
    };
  }

  async buscar(q: ClubeDescontoConsultaDto) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const termo = (q.q ?? '').trim().toUpperCase();
    const rows = (await sql<Record<string, unknown>>`
        SELECT c.*, p.descricao AS produto,
               (SELECT m.vrvenda FROM multi_preco m
                 WHERE m.idproduto = p.idproduto AND m.idempresa = c.idempresa
                 LIMIT 1) AS preco_normal
          FROM clube_desconto c
          LEFT JOIN produtos p ON p.codbarra = c.barras
         WHERE c.idempresa = ${this.emp()}
           AND (${termo}::text = '' OR c.barras LIKE ${termo + '%'}
                OR upper(coalesce(c.descricao, '')) LIKE ${'%' + termo + '%'}
                OR upper(coalesce(p.descricao, '')) LIKE ${'%' + termo + '%'})
           AND (${q.operacao ?? ''}::text = '' OR c.operacao = ${q.operacao ?? ''})
           AND (NOT ${q.vigentes}::boolean
                OR (c.ativo = 'S' AND c.encerrada = 'F'
                    AND now() BETWEEN c.data_inicio AND c.data_fim))
           AND (${q.incluir_estornadas}::boolean OR coalesce(c.indr, 'I') <> 'E')
         ORDER BY c.data_fim DESC, c.idclubedesconto DESC
         LIMIT ${q.limite}`.execute(db)).rows;
    return { itens: rows.map((r) => this.linha(r)), total: rows.length };
  }

  async obter(id: number) {
    const db = this.dbp.forTenantRead() as AnyDB;
    const r = (await sql<Record<string, unknown>>`
        SELECT c.*, p.descricao AS produto FROM clube_desconto c
          LEFT JOIN produtos p ON p.codbarra = c.barras
         WHERE c.idclubedesconto = ${id} AND c.idempresa = ${this.emp()}`.execute(db)).rows[0];
    if (!r) throw new BusinessRuleError('CLUBE_DESCONTO_NAO_ENCONTRADO', { idclubedesconto: id });
    const ext = (await sql<Record<string, unknown>>`
        SELECT * FROM clube_desconto_ext
         WHERE idempresa = ${this.emp()} AND idpromocao = ${r.idpromocao ?? 0}`.execute(db)).rows;
    return { ...this.linha(r), extras: ext };
  }

  /**
   * Grava a regra. A validação por operação está no schema (shared), porque o erro precisa chegar ao
   * operador com o nome do campo. Aqui fica o que depende do BANCO: o produto tem de existir, e não se
   * sobrepõem duas regras do mesmo tipo para o mesmo produto na mesma janela.
   */
  async gravar(d: ClubeDescontoDto, id?: number) {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;

    return db.transaction().execute(async (trx: AnyDB) => {
      if (d.barras) {
        const p = (await sql<{ idproduto: number }>`
            SELECT idproduto FROM produtos WHERE codbarra = ${d.barras}`.execute(trx)).rows[0];
        if (!p) throw new BusinessRuleError('PRODUTO_NAO_ENCONTRADO', { barras: d.barras });
      }

      // ⚠️ duas regras da MESMA operação sobre o MESMO produto na mesma janela deixam o PDV sem critério
      // de desempate — qual preço vale? O legado não trava isso; aqui trava, porque o resultado seria
      // indeterminado e mudaria conforme a ordem de leitura.
      const conflito = (await sql<{ idclubedesconto: number }>`
          SELECT idclubedesconto FROM clube_desconto
           WHERE idempresa = ${emp} AND operacao = ${d.operacao}
             AND coalesce(indr, 'I') <> 'E' AND ativo = 'S' AND encerrada = 'F'
             AND barras IS NOT DISTINCT FROM ${d.barras ?? null}
             AND pdv IS NOT DISTINCT FROM ${d.pdv ?? null}
             AND (data_inicio, data_fim) OVERLAPS (${d.data_inicio}::timestamptz, ${d.data_fim}::timestamptz)
             AND (${id ?? 0}::int = 0 OR idclubedesconto <> ${id ?? 0})
           LIMIT 1`.execute(trx)).rows[0];
      if (conflito)
        throw new BusinessRuleError('CLUBE_DESCONTO_SOBREPOSTO', {
          operacao: d.operacao, barras: d.barras ?? null,
          conflita_com: Number(conflito.idclubedesconto),
        });

      const campos = {
        idpromocao: d.idpromocao ?? null, loja: d.loja, operacao: d.operacao, ativo: d.ativo,
        encerrada: d.encerrada, origem: d.origem, barras: d.barras ?? null, grupo: d.grupo ?? null,
        valor: d.valor ?? null, tipo: d.tipo ?? null, quantidade: d.quantidade ?? null,
        quantidade_paga: d.quantidade_paga ?? null, minimo: d.minimo ?? null, maximo: d.maximo ?? null,
        valor_minimo_compra: d.valor_minimo_compra ?? null, pdv: d.pdv ?? null,
        codigo_promocional: d.codigo_promocional ?? null, id_formas_pgto: d.id_formas_pgto ?? null,
        codperfil_parceiro: d.codperfil_parceiro ?? null, codparceiro: d.codparceiro ?? null,
        descricao: d.descricao ?? null,
      };

      if (id) {
        const r = (await sql<{ idclubedesconto: number }>`
          UPDATE clube_desconto SET
            idpromocao = ${campos.idpromocao}, loja = ${campos.loja}, operacao = ${campos.operacao},
            ativo = ${campos.ativo}, encerrada = ${campos.encerrada}, origem = ${campos.origem},
            barras = ${campos.barras}, grupo = ${campos.grupo}, valor = ${campos.valor},
            tipo = ${campos.tipo}, quantidade = ${campos.quantidade},
            quantidade_paga = ${campos.quantidade_paga}, minimo = ${campos.minimo},
            maximo = ${campos.maximo}, valor_minimo_compra = ${campos.valor_minimo_compra},
            data_inicio = ${d.data_inicio}::timestamptz, data_fim = ${d.data_fim}::timestamptz,
            pdv = ${campos.pdv}, codigo_promocional = ${campos.codigo_promocional},
            id_formas_pgto = ${campos.id_formas_pgto}, codperfil_parceiro = ${campos.codperfil_parceiro},
            codparceiro = ${campos.codparceiro}, descricao = ${campos.descricao},
            usultalteracao = ${this.op()}, dtultimalteracao = now(), dtalteracao = now()
          WHERE idclubedesconto = ${id} AND idempresa = ${emp} AND coalesce(indr, 'I') <> 'E'
          RETURNING idclubedesconto`.execute(trx)).rows[0];
        if (!r) throw new BusinessRuleError('CLUBE_DESCONTO_NAO_ENCONTRADO', { idclubedesconto: id });
        return { idclubedesconto: Number(r.idclubedesconto) };
      }

      const r = (await sql<{ idclubedesconto: number }>`
        INSERT INTO clube_desconto (idempresa, idpromocao, loja, operacao, ativo, encerrada, origem,
              barras, grupo, valor, tipo, quantidade, quantidade_paga, minimo, maximo,
              valor_minimo_compra, data_inicio, data_fim, pdv, codigo_promocional, id_formas_pgto,
              codperfil_parceiro, codparceiro, descricao, usucadastro)
        VALUES (${emp}, ${campos.idpromocao}, ${campos.loja}, ${campos.operacao}, ${campos.ativo},
                ${campos.encerrada}, ${campos.origem}, ${campos.barras}, ${campos.grupo},
                ${campos.valor}, ${campos.tipo}, ${campos.quantidade}, ${campos.quantidade_paga},
                ${campos.minimo}, ${campos.maximo}, ${campos.valor_minimo_compra},
                ${d.data_inicio}::timestamptz, ${d.data_fim}::timestamptz, ${campos.pdv},
                ${campos.codigo_promocional}, ${campos.id_formas_pgto}, ${campos.codperfil_parceiro},
                ${campos.codparceiro}, ${campos.descricao}, ${this.op()})
        RETURNING idclubedesconto`.execute(trx)).rows[0];
      return { idclubedesconto: Number(r.idclubedesconto) };
    });
  }

  /** Estorno lógico — a regra já foi usada no PDV e o histórico do movimento aponta para ela. */
  async excluir(id: number) {
    const db = this.dbp.forTenant() as AnyDB;
    const r = (await sql<{ idclubedesconto: number }>`
        UPDATE clube_desconto SET indr = 'E', indr_usuario = ${this.op()}, indr_data = now()
         WHERE idclubedesconto = ${id} AND idempresa = ${this.emp()} AND coalesce(indr, 'I') <> 'E'
         RETURNING idclubedesconto`.execute(db)).rows[0];
    if (!r) throw new BusinessRuleError('CLUBE_DESCONTO_NAO_ENCONTRADO', { idclubedesconto: id });
    return { idclubedesconto: Number(r.idclubedesconto) };
  }
}
