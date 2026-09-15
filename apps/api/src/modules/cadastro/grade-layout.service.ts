import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/**
 * LAYOUT DA GRADE POR OPERADOR — o "Salvar Configurações do Grid [F8]" do legado, que existe em **16 telas**.
 * Dossiê: `grade-layout.md`.
 *
 * O legado grava um **arquivo `.ini` no disco da estação**, um por operador e por tela
 * (`StoreToIniFile(... 'GridPrecificacaoNF_Operador<N>.ini')`, `uPrecificacaoNF.pas:1113`). Funciona enquanto
 * o operador usa sempre a mesma máquina — e falha em silêncio no dia em que ele senta noutro caixa ou a
 * estação é reinstalada.
 *
 * Aqui o layout vive no banco, **por operador e empresa**, e segue a pessoa. O navegador mantém uma cópia
 * local (o `persistId` do DataTable), de modo que a grade abre com o layout certo antes mesmo de a resposta
 * chegar — e, se o servidor estiver fora, ela ainda abre.
 *
 * ⚠️ **sem RBAC próprio, de propósito**: salvar o layout da própria grade é preferência, não privilégio — o
 * legado também não pede permissão. O escopo é sempre o operador da sessão: este serviço nunca lê nem
 * escreve o layout de outra pessoa.
 */
@Injectable()
export class GradeLayoutService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private ctx(): { op: number; emp: number } {
    const t = currentTenant();
    if (t.empresaId == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    if (t.operadorId == null) throw new BusinessRuleError('OPERADOR_NAO_IDENTIFICADO');
    return { op: t.operadorId, emp: t.empresaId };
  }

  /** as visões da tela para o operador da sessão — mais as públicas de quem quis compartilhar. */
  async listar(tela: string): Promise<Array<Record<string, unknown>>> {
    const { op, emp } = this.ctx();
    return (await sql<Record<string, unknown>>`
      SELECT view_id AS id, nome AS name,
             (publica = 'S') AS "isPublic",
             estado AS state,
             to_char(coalesce(dtcadastro, now()), 'YYYY-MM-DD"T"HH24:MI:SS') AS "createdAt",
             (codoperador = ${op}) AS propria
        FROM grade_layout
       WHERE idempresa = ${emp} AND tela = ${tela}
         AND (codoperador = ${op} OR publica = 'S')
       ORDER BY (codoperador = ${op}) DESC, dtcadastro
    `.execute(this.dbp.forTenantRead() as AnyDB)).rows;
  }

  /** grava (ou substitui) uma visão. `default` é o layout corrente da tela. */
  async salvar(tela: string, view: { id: string; name?: string | null; isPublic?: boolean; state: unknown }): Promise<{ id: string }> {
    const { op, emp } = this.ctx();
    if (!tela.trim()) throw new BusinessRuleError('GRADE_TELA_OBRIGATORIA');
    await sql`
      INSERT INTO grade_layout (codoperador, idempresa, tela, view_id, nome, publica, estado, dtcadastro, dtultimalteracao)
      VALUES (${op}, ${emp}, ${tela}, ${view.id}, ${view.name ?? null},
              ${view.isPublic ? 'S' : 'N'}, ${JSON.stringify(view.state ?? {})}::jsonb, now(), now())
      ON CONFLICT (codoperador, idempresa, tela, view_id)
      DO UPDATE SET nome = EXCLUDED.nome, publica = EXCLUDED.publica,
                    estado = EXCLUDED.estado, dtultimalteracao = now()
    `.execute(this.dbp.forTenant() as AnyDB);
    return { id: view.id };
  }

  /**
   * Apaga uma visão. Com `view_id = 'default'`, é o **"Carregar Configurações Originais da Grid [F9]"** do
   * legado: some o layout salvo e a tela volta a abrir como veio de fábrica.
   */
  async excluir(tela: string, viewId: string): Promise<{ excluida: boolean }> {
    const { op, emp } = this.ctx();
    const r = (await sql<{ id: number }>`
      DELETE FROM grade_layout
       WHERE codoperador = ${op} AND idempresa = ${emp} AND tela = ${tela} AND view_id = ${viewId}
       RETURNING id
    `.execute(this.dbp.forTenant() as AnyDB)).rows[0];
    return { excluida: !!r };
  }
}
