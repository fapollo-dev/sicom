import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import {
  CAMPOS_MULT, type FiltroProdutosMultDto, type PisCofinsMultDto, type SimularMultDto,
} from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const meta = (campo: string) => CAMPOS_MULT.find((c) => c.campo === campo)!;
/** o legado troca ponto por vírgula e volta (`:672-677`); aqui basta aceitar as duas. */
const numBr = (v: string) => Number(String(v).replace(/\./g, '').replace(',', '.'));

export interface LinhaSimulada {
  idproduto: number; codbarra: string | null; descricao: string | null;
  antes: string | null; depois: string | null; mudou: boolean; erro?: string;
}

/**
 * ATUALIZAÇÃO AUTOMÁTICA DE PRODUTOS (`FRMMULTATUALIZACAO`, `uMultAtualizacao.pas`, 1.145 linhas).
 * **60 acessos, 6 operadores.** Dossiê: `uMultAtualizacao.md`. Migration 232.
 *
 * Escolhe produtos, escolhe UM campo, escolhe uma operação, aplica em todos. É a tela que sobe 10% no preço
 * de uma família inteira, troca o subgrupo de duzentos itens ou desativa uma linha de produtos.
 *
 * ── O fluxo do legado, em três tempos ─────────────────────────────────────────────────────────────────
 * 1. **Buscar** (`btnBuscaProduto` :228) enche a grade e guarda um ESPELHO (`cdsEspelho_Produto`).
 * 2. **Alterar** (`btnProcessar` → `EditaDataset` :619) mexe só na MEMÓRIA — nada vai ao banco ainda; e
 *    **Desfazer** (:117) restaura o espelho. É a prévia, e aqui ela virou `simular()`: mesma conta, sem
 *    gravar, devolvendo antes e depois de cada produto.
 * 3. **Gravar** (`btnGravar` :343) percorre os selecionados e, **para CADA EMPRESA**, escreve campo a campo,
 *    só o que mudou.
 *
 * ── As travas, e por que existem ──────────────────────────────────────────────────────────────────────
 * ⚠️ **produto que compõe outro não pode ser desativado** (`ProdutoFazParteDaComposicaoDeOutroProduto`,
 *    :741): desativar a farinha deixaria o pão sem ingrediente, e o legado aborta a alteração INTEIRA.
 * ⚠️ **código de família tem de existir COM O TIPO CERTO** (`RetornarValores('FAMILIAS_PROD'…)` :694): um
 *    subgrupo não serve como grupo. `FAMILIAS_PROD.TIPO` é quem diz.
 * ⚠️ **mexer no subgrupo arrasta grupo, departamento e seção** (`AdicionaComplementoSubGrupo` :127) — a
 *    hierarquia não pode ficar inconsistente, e o legado a recompõe sozinho.
 *
 * ── Divergências conscientes ──────────────────────────────────────────────────────────────────────────
 * ⚠️ **dividir por zero**: `toaDividir` (:687) é `valor / ValorOperacao` sem nenhuma proteção — derruba a
 *    alteração no meio, com parte dos produtos já mexida em memória. Recusado na porta.
 * ⚠️ **os campos de controle saem do combo**: a lista de exclusão do legado esqueceu `IDPRODUTO`, `CAMPO`,
 *    `OPERACAO`, `DTULTIMALTERACAO`, `USULTALTERACAO` e `CODOPERADOR`. Alterar `IDPRODUTO` em massa não tem
 *    leitura nenhuma; identidade e auditoria não são cadastro.
 * ⚠️ **uma transação só**: o legado grava produto a produto e um erro no meio deixa metade aplicada. Aqui é
 *    tudo ou nada — numa alteração em massa, meia alteração é pior que nenhuma.
 * ⚠️ **multi-empresa**: o legado varre `EMPRESAS` e escreve em todas. Somos tenant-scoped em `multi_preco`
 *    (preço é por empresa e a sessão tem uma); os campos de `produtos` são globais e valem para todas.
 */
@Injectable()
export class MultAtualizacaoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** `btnBuscaProdutoClick` :228 — a grade de onde o operador escolhe. */
  async buscar(f: FiltroProdutosMultDto): Promise<Array<Record<string, unknown>>> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const texto = f.texto ? `%${f.texto.toUpperCase()}%` : null;
    return (await sql<Record<string, unknown>>`
      SELECT p.idproduto, p.codbarra, p.descricao, p.unidade, p.ativo, p.ativo_compra,
             p.codgrupo, p.codsubgrupo, p.coddpto, p.codsecao, p.codfor, p.codgrupopreco,
             p.aliquota, p.ncmsh, p.cest, p.balanca, p.codbalanca, p.validade,
             p.fatorkg, p.fatorcx, p.comissao, p.descmax, p.compqtde, p.compfator,
             p.tipopis, p.idpiscofins, p.especificacao, p.composicao, p.codfigurafiscal,
             m.vrcusto, m.vrvenda, m.vrcustorep, m.markup, m.markupfixo,
             g.descricao AS grupo, s.descricao AS subgrupo, d.descricao AS departamento,
             f2.razao AS fornecedor
        FROM produtos p
        LEFT JOIN multi_preco m   ON m.idproduto = p.idproduto AND m.idempresa = ${emp}
        LEFT JOIN familias_prod g ON g.codfamilia = p.codgrupo    AND g.tipo = 'G'
        LEFT JOIN familias_prod s ON s.codfamilia = p.codsubgrupo AND s.tipo = 'S'
        LEFT JOIN familias_prod d ON d.codfamilia = p.coddpto     AND d.tipo = 'D'
        LEFT JOIN parceiros f2    ON f2.codparceiro = p.codfor
       WHERE (${texto}::text IS NULL
              OR upper(p.descricao) LIKE ${texto}::text OR p.codbarra LIKE ${texto}::text)
         AND (${f.codgrupo ?? null}::int    IS NULL OR p.codgrupo    = ${f.codgrupo ?? null}::int)
         AND (${f.codsubgrupo ?? null}::int IS NULL OR p.codsubgrupo = ${f.codsubgrupo ?? null}::int)
         AND (${f.coddpto ?? null}::int     IS NULL OR p.coddpto     = ${f.coddpto ?? null}::int)
         AND (${f.codfor ?? null}::int      IS NULL OR p.codfor      = ${f.codfor ?? null}::int)
         AND (${f.somenteAtivos} = 'T' OR coalesce(p.ativo, 'S') = ${f.somenteAtivos})
       ORDER BY p.descricao
       LIMIT ${f.limite}
    `.execute(db)).rows;
  }

  /** `EditaDataset` :619 — a conta, sem gravar. É o botão "Alterar" do legado, que só mexe na memória. */
  async simular(dto: SimularMultDto): Promise<{ linhas: LinhaSimulada[]; mudam: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    const linhas = await this.calcular(db, emp, dto);
    return { linhas, mudam: linhas.filter((l) => l.mudou && !l.erro).length };
  }

  /** `btnGravarClick` :343 — a gravação, tudo ou nada. */
  async aplicar(dto: SimularMultDto, operador: number | null): Promise<{ produtos: number; erros: LinhaSimulada[] }> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    const m = meta(dto.campo);

    return db.transaction().execute(async (trx: AnyDB) => {
      const linhas = await this.calcular(trx, emp, dto);
      const erros = linhas.filter((l) => l.erro);
      // o legado dá `Abort` no primeiro problema; aqui a transação inteira não passa, e o operador vê TODOS
      if (erros.length) throw new BusinessRuleError('MULT_ATUALIZACAO_BLOQUEADA', { erros: erros.slice(0, 20) });

      const aplicar = linhas.filter((l) => l.mudou);
      for (const l of aplicar) {
        const valor = l.depois;
        if (m.onde === 'produtos' || m.onde === 'ambos') {
          await sql`
            UPDATE produtos SET ${sql.ref(m.coluna)} = ${valor},
                   usultalteracao = ${operador}, dtultimalteracao = now()
             WHERE idproduto = ${l.idproduto}
          `.execute(trx);
        }
        if (m.onde === 'multi_preco' || m.onde === 'ambos') {
          await sql`
            UPDATE multi_preco SET ${sql.ref(m.coluna)} = ${valor}
             WHERE idproduto = ${l.idproduto} AND idempresa = ${emp}
          `.execute(trx);
        }
        // `AdicionaComplementoSubGrupo` :127 — o subgrupo arrasta a hierarquia inteira, e ela mora no
        // próprio registro do subgrupo (505 das 520 famílias tipo 'S' têm grupo e departamento)
        if (dto.campo === 'CODSUBGRUPO') {
          await sql`
            UPDATE produtos p
               SET codgrupo = f.codgrupo, coddpto = f.coddpto, codsecao = f.codsecao
              FROM familias_prod f
             WHERE p.idproduto = ${l.idproduto}
               AND f.codfamilia = ${Number(valor)} AND upper(f.tipo) = 'S'
          `.execute(trx);
        }
        // `FCamposHistorico` :368 — o legado guarda histórico só de VRVENDA e VRCUSTO
        if (dto.campo === 'VR_VENDA' || dto.campo === 'VR_CUSTO') {
          await sql`
            INSERT INTO historico_dinamico (tabela, chave, valor_chave, campo, valor_anterior, valor_atual,
                                            codoperador, codempresa, data, origem)
            VALUES ('MULTI_PRECO', 'IDPRODUTO', ${String(l.idproduto)}, ${m.coluna.toUpperCase()},
                    ${l.antes}, ${l.depois}, ${operador}, ${emp}, now(), 'FRMMULTATUALIZACAO')
          `.execute(trx);
        }
      }
      return { produtos: aplicar.length, erros: [] };
    });
  }

  /**
   * a conta de cada linha — a mesma para simular e para aplicar, para que a prévia não possa mentir.
   * Percentual é do valor ATUAL de cada produto (`:679`), não um percentual fixo sobre o primeiro.
   */
  private async calcular(db: AnyDB, emp: number, dto: SimularMultDto): Promise<LinhaSimulada[]> {
    const m = meta(dto.campo);
    const col = m.onde === 'multi_preco' ? sql`m.${sql.ref(m.coluna)}` : sql`p.${sql.ref(m.coluna)}`;
    const rows = (await sql<Record<string, unknown>>`
      SELECT p.idproduto, p.codbarra, p.descricao, coalesce(p.ativo, 'S') AS ativo,
             ${col} AS atual,
             -- ⚠️ "ProdutoFazParteDaComposicaoDeOutroProduto" (:741): quem compõe outro item não se desativa
             EXISTS (SELECT 1 FROM composicao c WHERE c.idproduto_01 = p.idproduto) AS compoe_outro
        FROM produtos p
        LEFT JOIN multi_preco m ON m.idproduto = p.idproduto AND m.idempresa = ${emp}
       WHERE p.idproduto = ANY(${dto.idprodutos}::int[])
       ORDER BY p.descricao
    `.execute(db)).rows;

    // as famílias válidas para o campo, quando é um código de família
    const tipoFamilia: Record<string, string> = { CODGRUPO: 'G', CODSUBGRUPO: 'S', CODDPTO: 'D', CODSECAO: 'C' };
    let familiaOk = true;
    if (tipoFamilia[dto.campo] && dto.operacao === 'SUBSTITUIR') {
      const cod = Number(numBr(dto.valor));
      const f = (await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM familias_prod
         WHERE codfamilia = ${cod} AND upper(tipo) = ${tipoFamilia[dto.campo]}
      `.execute(db)).rows[0];
      familiaOk = Number(f?.n) > 0;
    }

    return rows.map((r) => {
      const idproduto = Number(r.idproduto);
      const antes = r.atual == null ? null : String(r.atual);
      let depois: string | null = null;
      let erro: string | undefined;

      if (m.tipo === 'numero') {
        const base = num(r.atual);
        const v = numBr(dto.valor);
        // `cbbValor_Porcento` :678-682 — percentual é do valor atual DESTE produto
        const operando = dto.modo === 'PERCENTUAL' ? (base * v) / 100 : v;
        switch (dto.operacao) {
          case 'SUBSTITUIR': depois = String(operando); break;
          case 'SOMAR': depois = String(base + operando); break;
          case 'SUBTRAIR': depois = String(base - operando); break;
          case 'MULTIPLICAR': depois = String(base * operando); break;
          case 'DIVIDIR': depois = operando === 0 ? null : String(base / operando); break;
          default: depois = antes;
        }
        if (depois != null) depois = String(Math.round(Number(depois) * 1e6) / 1e6);
      } else {
        const atual = antes ?? '';
        switch (dto.operacao) {
          case 'SUBSTITUIR': depois = dto.valor; break;
          case 'PREFIXAR': depois = dto.valor + atual; break;
          case 'SUFIXAR': depois = atual + dto.valor; break;
          default: depois = atual;
        }
      }

      if (tipoFamilia[dto.campo] && !familiaOk) {
        erro = `código de ${dto.campo === 'CODSUBGRUPO' ? 'subgrupo' : 'família'} inválido: não existe em FAMILIAS_PROD com o tipo certo`;
      }
      if (dto.campo === 'ATIVO' && depois === 'N' && String(r.ativo) === 'S' && r.compoe_outro === true) {
        erro = `não é permitido desativar: ${String(r.descricao ?? '')} faz parte da composição de outro produto`;
      }

      return {
        idproduto, codbarra: r.codbarra == null ? null : String(r.codbarra),
        descricao: r.descricao == null ? null : String(r.descricao),
        antes, depois, mudou: String(antes ?? '') !== String(depois ?? ''), erro,
      };
    });
  }

  /**
   * `BtnAlterarPCClick` :141 — a aba PIS/COFINS, com as duas travas fiscais próprias.
   *
   * ⚠️ **a natureza só é exigida quando a alíquota é ZERO** (`GetAliquota(...) = 0` :798): num CST com
   * alíquota, a natureza do crédito não se aplica e o campo fica desabilitado. E quando informada, o par
   * (`IDPISCOFINS`, `IDBASECREDITOISENTO`) tem de existir em `PC_TIPOCREDITOISENTO` — é de lá que sai o
   * `IDTABELA` que vai para o produto.
   */
  async aplicarPisCofins(dto: PisCofinsMultDto, operador: number | null): Promise<{ produtos: number }> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;

    return db.transaction().execute(async (trx: AnyDB) => {
      let idtabela: number | null = null;
      if (dto.idpiscofins) {
        const pc = (await sql<{ aliq: number }>`
          SELECT coalesce(aliq_cofins_sai, 0) AS aliq FROM piscofins WHERE idpiscofins = ${dto.idpiscofins}
        `.execute(trx)).rows[0];
        if (!pc) throw new BusinessRuleError('PISCOFINS_NAO_ENCONTRADO', { idpiscofins: dto.idpiscofins });
        const exigeNatureza = num(pc.aliq) === 0;
        if (exigeNatureza && !dto.natureza) {
          throw new BusinessRuleError('NATUREZA_OBRIGATORIA', { idpiscofins: dto.idpiscofins });
        }
      }
      if (dto.natureza) {
        const t = (await sql<{ idtabela: number }>`
          SELECT idtabela FROM pc_tipocreditoisento
           WHERE idpiscofins = ${dto.idpiscofins ?? 0} AND idbasecreditoisento = ${dto.natureza}
        `.execute(trx)).rows[0];
        if (!t) throw new BusinessRuleError('NATUREZA_INVALIDA', { natureza: dto.natureza, idpiscofins: dto.idpiscofins ?? 0 });
        idtabela = Number(t.idtabela);
      }

      const r = await sql`
        UPDATE produtos
           SET idpiscofins = coalesce(${dto.idpiscofins ?? null}::int, idpiscofins),
               tipopis     = coalesce(${dto.tipopis ?? null}::char(1), tipopis),
               idtabela    = coalesce(${idtabela}::int, idtabela),
               usultalteracao = ${operador}, dtultimalteracao = now()
         WHERE idproduto = ANY(${dto.idprodutos}::int[])
      `.execute(trx);
      void emp;
      return { produtos: Number(r.numAffectedRows ?? dto.idprodutos.length) };
    });
  }
}
