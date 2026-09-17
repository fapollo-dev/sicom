import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { referenciasDaExpressao, type DreContaVinculoDto, type DreEstruturaDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * CONFIGURADOR DO DRE CONTÁBIL (`FRMCONFIGDRECONTABIL`, `UFrmCadConfigDREContabil.pas`).
 * **51 acessos, 3 operadores.** Migration 234. Dossiê: `uConfigDreContabil.md`.
 *
 * O editor da árvore que a migration 047 deixou declarado: *"o editor da estrutura é corte-2 (aqui a
 * estrutura é semeada, fiel ao modelo)"*. É o que define **como o DRE é somado** — mexer aqui muda todo
 * relatório de resultado que o contador lê.
 *
 * No cliente: **98 linhas em 3 níveis** (6 raízes, 14 no nível 2, 78 no nível 3), todas ativas, e **10.439
 * vínculos** conta→linha em `VINCULO_PLC_CFG_DRE`.
 *
 * Três tipos de linha, e o dado mostra que a classe é consequência do tipo — a correlação é perfeita:
 * as **78** linhas `P` são todas `A` (analíticas, recebem conta) e as **20** sintéticas (19 `F` + 1 `E`) são
 * todas `S`. Uma única expressão existe: `<01>+<03>+<04>` no LUCRO BRUTO COMERCIAL.
 *
 * ── As travas ─────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ **não se apaga linha com filha nem com conta vinculada** — o roll-up do `dre.service` some com o ramo
 *    inteiro sem avisar, e o DRE passa a fechar num número menor sem nada indicando o porquê.
 * ⚠️ **a expressão só pode referenciar código que existe**, e **não pode referenciar a si mesma nem fechar
 *    ciclo**: `<01>` dentro da linha `01` faria o avaliador recursivo do `dre.service` girar sem parar.
 * ⚠️ **só linha analítica recebe conta** — vincular a uma sintética duplicaria o valor, porque ela já soma
 *    as filhas.
 */
@Injectable()
export class DreEstruturaService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /** a árvore inteira, com quantas contas cada linha tem e quantas filhas — é a tela. */
  async arvore(): Promise<Array<Record<string, unknown>>> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    return (await sql<Record<string, unknown>>`
      SELECT e.codestrutura, e.codexpandido, e.descricao, e.tipo_calculo, e.classe, e.expressao,
             e.nivel, e.codpai, e.ativo,
             (SELECT count(*) FROM dre_conta c WHERE c.codestrutura = e.codestrutura)::int AS contas,
             (SELECT count(*) FROM dre_estrutura f WHERE f.codpai = e.codestrutura)::int AS filhas
        FROM dre_estrutura e
       ORDER BY e.codexpandido
    `.execute(db)).rows;
  }

  /** as contas vinculadas a uma linha, com a descrição do plano. */
  async contas(codestrutura: number): Promise<Array<Record<string, unknown>>> {
    this.emp();
    const db = this.dbp.forTenantRead() as AnyDB;
    return (await sql<Record<string, unknown>>`
      SELECT c.codplanocontas, p.descricao, p.tipo, p.classe
        FROM dre_conta c
        LEFT JOIN plano_contas p ON p.codplanocontas = c.codplanocontas
       WHERE c.codestrutura = ${codestrutura}
       ORDER BY c.codplanocontas
    `.execute(db)).rows;
  }

  async criar(dto: DreEstruturaDto, operador: number | null): Promise<{ codestrutura: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      await this.validar(trx, dto, null);
      const r = (await sql<{ codestrutura: number }>`
        INSERT INTO dre_estrutura (codexpandido, descricao, tipo_calculo, classe, expressao, nivel, codpai,
                                   ativo, usultalteracao, dtultimalteracao, dtcadastro)
        VALUES (${dto.codexpandido}, ${dto.descricao}, ${dto.tipo_calculo}, ${dto.classe},
                ${dto.expressao ?? null}, ${dto.nivel}, ${dto.codpai ?? null}, ${dto.ativo},
                ${operador}, now(), now())
        RETURNING codestrutura
      `.execute(trx)).rows[0];
      return { codestrutura: Number(r.codestrutura) };
    });
  }

  async atualizar(cod: number, dto: DreEstruturaDto, operador: number | null): Promise<{ codestrutura: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      await this.validar(trx, dto, cod);
      const r = await sql`
        UPDATE dre_estrutura
           SET codexpandido = ${dto.codexpandido}, descricao = ${dto.descricao},
               tipo_calculo = ${dto.tipo_calculo}, classe = ${dto.classe},
               expressao = ${dto.expressao ?? null}, nivel = ${dto.nivel}, codpai = ${dto.codpai ?? null},
               ativo = ${dto.ativo}, usultalteracao = ${operador}, dtultimalteracao = now()
         WHERE codestrutura = ${cod}
      `.execute(trx);
      if (!Number(r.numAffectedRows ?? 0)) throw new BusinessRuleError('DRE_LINHA_NAO_ENCONTRADA', { cod });
      // ⚠️ trocar o tipo para sintético deixaria contas penduradas numa linha que já soma as filhas
      if (dto.tipo_calculo !== 'P') {
        await sql`DELETE FROM dre_conta WHERE codestrutura = ${cod}`.execute(trx);
      }
      return { codestrutura: cod };
    });
  }

  async excluir(cod: number): Promise<{ codestrutura: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    const info = (await sql<{ filhas: number; contas: number; codexpandido: string }>`
      SELECT (SELECT count(*) FROM dre_estrutura f WHERE f.codpai = e.codestrutura)::int AS filhas,
             (SELECT count(*) FROM dre_conta c WHERE c.codestrutura = e.codestrutura)::int AS contas,
             e.codexpandido
        FROM dre_estrutura e WHERE e.codestrutura = ${cod}
    `.execute(db)).rows[0];
    if (!info) throw new BusinessRuleError('DRE_LINHA_NAO_ENCONTRADA', { cod });
    if (Number(info.filhas) > 0) throw new BusinessRuleError('DRE_LINHA_COM_FILHAS', { cod, filhas: Number(info.filhas) });
    if (Number(info.contas) > 0) throw new BusinessRuleError('DRE_LINHA_COM_CONTAS', { cod, contas: Number(info.contas) });
    // e ninguém pode estar referenciando este código numa expressão
    const refs = (await sql<{ codexpandido: string }>`
      SELECT codexpandido FROM dre_estrutura
       WHERE expressao IS NOT NULL AND position(${`<${info.codexpandido}>`} in expressao) > 0
    `.execute(db)).rows;
    if (refs.length) throw new BusinessRuleError('DRE_LINHA_REFERENCIADA', { cod, por: refs.map((r) => r.codexpandido) });
    await sql`DELETE FROM dre_estrutura WHERE codestrutura = ${cod}`.execute(db);
    return { codestrutura: cod };
  }

  /** substitui o conjunto de contas de uma linha analítica. */
  async vincularContas(dto: DreContaVinculoDto): Promise<{ vinculadas: number }> {
    this.emp();
    const db = this.dbp.forTenant() as AnyDB;
    return db.transaction().execute(async (trx: AnyDB) => {
      const linha = (await sql<{ tipo_calculo: string }>`
        SELECT tipo_calculo FROM dre_estrutura WHERE codestrutura = ${dto.codestrutura}
      `.execute(trx)).rows[0];
      if (!linha) throw new BusinessRuleError('DRE_LINHA_NAO_ENCONTRADA', { cod: dto.codestrutura });
      // ⚠️ vincular conta a uma sintética duplicaria o valor: ela já soma as filhas
      if (linha.tipo_calculo !== 'P') {
        throw new BusinessRuleError('DRE_LINHA_NAO_ANALITICA', { cod: dto.codestrutura, tipo: linha.tipo_calculo });
      }
      const existem = (await sql<{ codplanocontas: number }>`
        SELECT codplanocontas FROM plano_contas WHERE codplanocontas = ANY(${dto.codplanocontas}::int[])
      `.execute(trx)).rows.map((r) => Number(r.codplanocontas));
      const faltam = dto.codplanocontas.filter((c) => !existem.includes(Number(c)));
      if (faltam.length) throw new BusinessRuleError('CONTA_NAO_ENCONTRADA', { contas: faltam.slice(0, 20) });

      // ⚠️ uma conta em duas linhas analíticas seria contada duas vezes no DRE
      const jaEm = (await sql<{ codplanocontas: number; codestrutura: number }>`
        SELECT codplanocontas, codestrutura FROM dre_conta
         WHERE codplanocontas = ANY(${dto.codplanocontas}::int[]) AND codestrutura <> ${dto.codestrutura}
      `.execute(trx)).rows;
      if (jaEm.length) {
        throw new BusinessRuleError('CONTA_JA_VINCULADA', {
          contas: jaEm.slice(0, 20).map((r) => ({ conta: Number(r.codplanocontas), linha: Number(r.codestrutura) })),
        });
      }

      await sql`DELETE FROM dre_conta WHERE codestrutura = ${dto.codestrutura}`.execute(trx);
      for (const c of dto.codplanocontas) {
        await sql`INSERT INTO dre_conta (codplanocontas, codestrutura) VALUES (${c}, ${dto.codestrutura})`.execute(trx);
      }
      return { vinculadas: dto.codplanocontas.length };
    });
  }

  private async validar(trx: AnyDB, dto: DreEstruturaDto, cod: number | null): Promise<void> {
    const dup = (await sql<{ codestrutura: number }>`
      SELECT codestrutura FROM dre_estrutura
       WHERE codexpandido = ${dto.codexpandido} AND (${cod}::int IS NULL OR codestrutura <> ${cod}::int)
    `.execute(trx)).rows[0];
    if (dup) throw new BusinessRuleError('DRE_CODIGO_DUPLICADO', { codexpandido: dto.codexpandido });

    if (dto.codpai != null) {
      const pai = (await sql<{ nivel: number; codexpandido: string }>`
        SELECT nivel, codexpandido FROM dre_estrutura WHERE codestrutura = ${dto.codpai}
      `.execute(trx)).rows[0];
      if (!pai) throw new BusinessRuleError('DRE_PAI_NAO_ENCONTRADO', { codpai: dto.codpai });
      // o filho é sempre um nível abaixo do pai — é o que faz o roll-up recursivo terminar
      if (Number(pai.nivel) + 1 !== dto.nivel) {
        throw new BusinessRuleError('DRE_NIVEL_INCOERENTE', { nivelPai: Number(pai.nivel), nivel: dto.nivel });
      }
      if (cod != null && Number(dto.codpai) === cod) throw new BusinessRuleError('DRE_PAI_DE_SI_MESMO', { cod });
    }

    // as referências da expressão têm de existir, e a linha não pode referenciar a si mesma
    const refs = referenciasDaExpressao(dto.expressao);
    if (refs.length) {
      if (refs.includes(dto.codexpandido)) {
        throw new BusinessRuleError('DRE_EXPRESSAO_CIRCULAR', { codexpandido: dto.codexpandido });
      }
      const achadas = (await sql<{ codexpandido: string }>`
        SELECT codexpandido FROM dre_estrutura WHERE codexpandido = ANY(${refs}::text[])
      `.execute(trx)).rows.map((r) => String(r.codexpandido));
      const faltam = refs.filter((r) => !achadas.includes(r));
      if (faltam.length) throw new BusinessRuleError('DRE_REFERENCIA_INEXISTENTE', { referencias: faltam });
    }
  }
}
