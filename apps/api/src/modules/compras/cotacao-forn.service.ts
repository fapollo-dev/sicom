import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { verificarSenha, DUMMY_HASH } from '../../shared/auth/crypto';

type AnyDB = Kysely<any>;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/**
 * PREENCHER COTAÇÃO (`FRMCADCOTACAOFORN`, `uCadCotacaoForn.pas` 694 linhas). Dossiê: `uCadCotacaoForn.md`.
 * **137 acessos, 19 operadores.**
 *
 * O comprador monta a cotação (`cotacao` + `cotacao_prod`, a lista de produtos) e **o fornecedor preenche os
 * preços**. É a única tela do sistema em que quem opera pode ser **de fora da empresa** — e o dado confirma
 * que esse é o caso principal: das 97 cotações-fornecedor em produção, **85 foram preenchidas pelo
 * fornecedor** (`CODOPERADOR = 0`), não por operador da loja.
 *
 * ── ⚠️ A autenticação: dois tipos de gente na mesma porta (`uLoginCotacao.pas:170`) ──────────────────────
 * O legado abre um login próprio com duas opções: **operador da empresa** (`OPERADORES.LOGIN` + `SENHA`) ou
 * **fornecedor** (`PARCEIROS.CODPARCEIRO` + `SENHA`). Quem entrou fica gravado: `CODOPERADOR` recebe o
 * operador, ou **zero** quando foi o fornecedor, e as datas vão em campos separados — `DATAMANOPE` para a
 * mão da loja, `DATAMANPAR` para a mão do fornecedor.
 *
 * ⛔ **a comparação de senha do legado é em TEXTO PURO**, dos dois lados. Não copiamos: aqui o parceiro tem
 * `senha_hash` (o mesmo scrypt dos operadores) e a carga hasheia a senha existente, então o fornecedor entra
 * com a mesma senha de sempre e o Apollo nunca guarda o texto. Ver a migration 218.
 *
 * ⛔ **`FATOREMBALAGEM` nasce sempre 1**: `CarregarItensDaCotacao:166` grava `1` com o valor de origem
 * **comentado** ao lado. É o mesmo padrão do `FATOR_FILHO` da precificação — campo lido, passado e
 * descartado. Copiado como está; o fornecedor informa o fator ao preencher.
 */
@Injectable()
export class CotacaoFornService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /**
   * A porta da tela. Devolve quem entrou — e é esse retorno que decide, no gravar, se a marca vai no campo
   * do operador ou no do fornecedor.
   *
   * Sempre roda um scrypt (`DUMMY_HASH` quando não há cadastro), para não virar oráculo de "este fornecedor
   * existe".
   */
  async autenticar(dto: { comoParceiro: boolean; login?: string | null; codparceiro?: number | null; senha: string }): Promise<{
    validadoPorEmpresa: boolean; codoperador: number | null; codparceiro: number | null; nome: string | null;
  }> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;

    if (!dto.comoParceiro) {
      const op = (await sql<{ codoperador: number; nome: string; senha_hash: string | null }>`
        SELECT codoperador, nome, senha_hash FROM operadores WHERE login = ${dto.login ?? ''}
      `.execute(db)).rows[0];
      const ok = await verificarSenha(dto.senha, op?.senha_hash ?? DUMMY_HASH);
      if (!op || !ok) throw new BusinessRuleError('COTACAO_LOGIN_INVALIDO');
      return { validadoPorEmpresa: true, codoperador: Number(op.codoperador), codparceiro: null, nome: op.nome };
    }

    const pa = (await sql<{ codparceiro: number; razao: string; senha_hash: string | null }>`
      SELECT codparceiro, razao, senha_hash FROM parceiros WHERE codparceiro = ${dto.codparceiro ?? 0}
    `.execute(db)).rows[0];
    const ok = await verificarSenha(dto.senha, pa?.senha_hash ?? DUMMY_HASH);
    if (!pa || !ok) throw new BusinessRuleError('COTACAO_LOGIN_INVALIDO');
    // validadoPorEmpresa = false ⇒ no gravar, CODOPERADOR fica ZERO: foi a mão do fornecedor
    return { validadoPorEmpresa: false, codoperador: null, codparceiro: Number(pa.codparceiro), nome: pa.razao };
  }

  /**
   * Abre a cotação de um fornecedor com os itens. Os itens que ainda não existem são **criados zerados** a
   * partir de `cotacao_prod` (`CarregarItensDaCotacao:103`) — é a lista que o comprador montou, esperando
   * preço. Os que já existem vêm como estão, para o fornecedor continuar de onde parou.
   */
  async abrir(codctcforn: number): Promise<{
    cabecalho: Record<string, unknown>;
    itens: Array<Record<string, unknown>>;
  }> {
    const emp = this.emp();
    const db = this.dbp.forTenant() as AnyDB;

    const cab = (await sql<Record<string, unknown>>`
      SELECT cf.codctcforn, cf.codctc, cf.data, cf.codoperador, cf.codparceiro,
             cf.datamanope, cf.datamanpar, cf.datavalidade, cf.obs, cf.situacao,
             c.descricao, c.data AS data_cotacao, c.situacao AS situacao_cotacao, c.liberada,
             c.dtinicio_preenchimento, c.dtfim_preenchimento,
             o.nome AS operador, p.razao, p.fantasia
        FROM cotacao_forn cf
        LEFT JOIN cotacao c    ON c.codctc = cf.codctc
        LEFT JOIN operadores o ON o.codoperador = cf.codoperador
        LEFT JOIN parceiros p  ON p.codparceiro = cf.codparceiro
       WHERE cf.codctcforn = ${codctcforn} AND coalesce(c.idempresa, ${emp}) = ${emp}
    `.execute(db)).rows[0];
    if (!cab) throw new BusinessRuleError('COTACAO_FORN_NAO_ENCONTRADA', { codctcforn });

    // cria os itens que faltam, zerados, a partir da lista de produtos da cotação
    await sql`
      INSERT INTO cotacao_forn_itens
             (codctcfit, codctcforn, codcpr, valor, datamanut, icms, valorembal, valortotal, fatorembalagem)
      SELECT (SELECT coalesce(max(codctcfit), 0) FROM cotacao_forn_itens)
             + row_number() OVER (ORDER BY cp.codcpr),
             ${codctcforn}, cp.codcpr, 0, now(), 0, 0, 0,
             -- ⛔ sempre 1: o legado grava 1 com o valor de origem comentado ao lado
             1
        FROM cotacao_prod cp
       WHERE cp.codctc = ${cab.codctc}
         AND NOT EXISTS (SELECT 1 FROM cotacao_forn_itens i
                          WHERE i.codctcforn = ${codctcforn} AND i.codcpr = cp.codcpr)
    `.execute(db);

    const itens = (await sql<Record<string, unknown>>`
      SELECT i.codctcfit, i.codcpr, i.valor, i.icms, i.valorembal, i.valortotal,
             i.fatorembalagem, i.definido, i.ganhador, i.verificado, i.marcado, i.ultimo_valor,
             cp.quantidade, coalesce(cp.descricao, pr.descricao) AS descricao,
             pr.codbarra, pr.unidade, cp.idproduto,
             cp.valorcusto, cp.valorvenda
        FROM cotacao_forn_itens i
        JOIN cotacao_prod cp  ON cp.codcpr = i.codcpr
        LEFT JOIN produtos pr ON pr.idproduto = cp.idproduto
       WHERE i.codctcforn = ${codctcforn}
       ORDER BY coalesce(cp.descricao, pr.descricao)
    `.execute(db)).rows;

    return { cabecalho: cab, itens };
  }

  /**
   * GRAVAR os preços. `porEmpresa` diz de quem é a mão: operador carimba `CODOPERADOR` e `DATAMANOPE`;
   * fornecedor deixa `CODOPERADOR = 0` e carimba `DATAMANPAR`.
   *
   * O total do item é `valor × fatorembalagem` quando há fator, senão o próprio valor — o fornecedor cota a
   * embalagem, a loja compara por unidade.
   */
  async preencher(dto: {
    codctcforn: number;
    porEmpresa: boolean;
    codoperador?: number | null;
    itens: Array<{ codctcfit: number; valor: number; icms?: number | null; fatorembalagem?: number | null; valorembal?: number | null }>;
    obs?: string | null;
    datavalidade?: string | null;
  }): Promise<{ itens: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    if (!dto.itens?.length) throw new BusinessRuleError('COTACAO_SEM_ITENS');

    const cab = (await sql<{ codctc: number; liberada: string | null; dtfim: string | null }>`
      SELECT cf.codctc, c.liberada, c.dtfim_preenchimento AS dtfim
        FROM cotacao_forn cf LEFT JOIN cotacao c ON c.codctc = cf.codctc
       WHERE cf.codctcforn = ${dto.codctcforn}
    `.execute(db)).rows[0];
    if (!cab) throw new BusinessRuleError('COTACAO_FORN_NAO_ENCONTRADA', { codctcforn: dto.codctcforn });
    // a janela de preenchimento da cotação-mãe: passou do fim, ninguém preenche mais
    if (cab.dtfim && new Date(cab.dtfim).getTime() < Date.now()) {
      throw new BusinessRuleError('COTACAO_PRAZO_ENCERRADO', { ate: cab.dtfim });
    }

    return db.transaction().execute(async (trx: AnyDB) => {
      let n = 0;
      for (const it of dto.itens) {
        if (num(it.valor) < 0) throw new BusinessRuleError('COTACAO_VALOR_NEGATIVO', { codctcfit: it.codctcfit });
        const fator = num(it.fatorembalagem) > 0 ? num(it.fatorembalagem) : 1;
        const total = r4(num(it.valor) * fator);
        const r = (await sql<{ codctcfit: number }>`
          UPDATE cotacao_forn_itens
             SET ultimo_valor = valor,
                 valorembal_bk = valorembal,
                 valor = ${r4(num(it.valor))},
                 icms = ${r4(num(it.icms))},
                 fatorembalagem = ${fator},
                 valorembal = ${r4(num(it.valorembal))},
                 valortotal = ${total},
                 datamanut = now()
           WHERE codctcfit = ${it.codctcfit} AND codctcforn = ${dto.codctcforn}
           RETURNING codctcfit
        `.execute(trx)).rows[0];
        if (r) n += 1;
      }

      await sql`
        UPDATE cotacao_forn
           SET obs = coalesce(${dto.obs ?? null}, obs),
               datavalidade = coalesce(${dto.datavalidade ?? null}::date, datavalidade),
               ${dto.porEmpresa
                 ? sql`codoperador = ${dto.codoperador ?? null}, datamanope = now(),`
                 : sql`codoperador = 0, datamanpar = now(),`}
               dtultimalteracao = now()
         WHERE codctcforn = ${dto.codctcforn}
      `.execute(trx);

      return { itens: n };
    });
  }

  /**
   * Um fornecedor preenche cada cotação **uma vez** (`VerificarExistenciaFornCotacao:565`). Criar a segunda
   * é recusado — no legado com a mensagem "já foi preenchida pelo fornecedor".
   */
  async criar(dto: { codctc: number; codparceiro: number; datavalidade?: string | null; obs?: string | null }): Promise<{ codctcforn: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    const ja = (await sql<{ codctcforn: number }>`
      SELECT codctcforn FROM cotacao_forn WHERE codctc = ${dto.codctc} AND codparceiro = ${dto.codparceiro}
    `.execute(db)).rows[0];
    if (ja) throw new BusinessRuleError('COTACAO_JA_PREENCHIDA_PELO_FORNECEDOR', { codctcforn: ja.codctcforn });

    const r = (await sql<{ codctcforn: number }>`
      INSERT INTO cotacao_forn (codctcforn, codctc, codparceiro, data, datavalidade, obs, dtcadastro)
      VALUES ((SELECT coalesce(max(codctcforn), 0) + 1 FROM cotacao_forn),
              ${dto.codctc}, ${dto.codparceiro}, current_date,
              ${dto.datavalidade ?? null}::date, ${dto.obs ?? null}, now())
      RETURNING codctcforn
    `.execute(db)).rows[0];
    return { codctcforn: r.codctcforn };
  }
}
