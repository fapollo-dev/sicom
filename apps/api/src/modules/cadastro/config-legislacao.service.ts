import { Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { ConfigLegislacaoDto, ResolveLegislacaoDto } from '@apollo/shared';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = Kysely<any>;

/** o que denuncia dado estragado: expressão Delphi colada no texto, e mojibake de acentuação. */
const CODIGO_VAZADO = /\+\s*sLineBreak\s*\+|QuotedStr\(/;
const MOJIBAKE = /Ã[-¿]|Â[-¿]/;

/**
 * CONFIGURAÇÃO DE LEGISLAÇÃO DA NF-e (`FRMCONFIGLEGISLACAONFE`). **5 acessos, 2 operadores.**
 * Dossiê: `uConfigLegislacaoNFe.md`. Migration 268.
 *
 * As mensagens legais que o legado escreve nas observações da NF-e e na informação adicional do item,
 * endereçadas por empresa e, opcionalmente, UF, CFOP, produto e parceiro.
 *
 * ── A resolução do legado nunca acha nada ─────────────────────────────────────────────────────────────
 * `GetConfigLegislacao` (udmNF.pas:9628) exige `CODCFOP = <n>` no WHERE e as 18 linhas do cliente têm
 * CODCFOP nulo — nenhuma NF-e jamais recebeu mensagem por esse caminho. Pior: `if RecordCount = 1`
 * devolve vazio em silêncio quando duas linhas casam. Aqui `resolver()` escolhe por especificidade
 * (produto > parceiro > UF > CFOP) e devolve todas as candidatas com a escolhida marcada, para o fiscal
 * ver por que aquela mensagem saiu.
 */
@Injectable()
export class ConfigLegislacaoService {
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }
  private op() { return currentTenant().operadorId ?? null; }

  private linha(r: Record<string, unknown>) {
    const texto = (r.observacoes as string | null) ?? '';
    return {
      codconfiglegislacao: Number(r.codconfiglegislacao), codempresa: Number(r.codempresa),
      descricao: r.descricao ?? null, observacoes: r.observacoes ?? null,
      uf: r.uf ?? null, codcfop: r.codcfop == null ? null : Number(r.codcfop),
      codproduto: r.codproduto == null ? null : Number(r.codproduto),
      codparceiro: r.codparceiro == null ? null : Number(r.codparceiro),
      tipo: r.tipo ?? null, indr: r.indr ?? 'I',
      // os avisos que a tela do legado não dava
      alertas: {
        codigoVazado: CODIGO_VAZADO.test(texto),
        mojibake: MOJIBAKE.test(texto),
        semTexto: texto.trim() === '',
        // sem CFOP a regra é invisível para a resolução do legado (o WHERE exige CODCFOP = n)
        invisivelNoLegado: r.codcfop == null,
        placeholders: [...new Set([...texto.matchAll(/%[A-Z_]+%|\$\([A-Z_]+\)/g)].map((m) => m[0]))],
      },
    };
  }

  async listar(incluirExcluidas = false) {
    const emp = this.emp();
    const rows = (await sql<Record<string, unknown>>`
      SELECT * FROM config_legislacao
       WHERE codempresa = ${emp} AND (${incluirExcluidas}::boolean OR coalesce(indr, 'I') <> 'E')
       ORDER BY descricao, uf NULLS FIRST, codconfiglegislacao`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
    const itens = rows.map((r) => this.linha(r));
    return {
      itens,
      totais: {
        regras: itens.length,
        semCfop: itens.filter((i) => i.alertas.invisivelNoLegado).length,
        comCodigoVazado: itens.filter((i) => i.alertas.codigoVazado).length,
        comMojibake: itens.filter((i) => i.alertas.mojibake).length,
        semTexto: itens.filter((i) => i.alertas.semTexto).length,
      },
    };
  }

  async obter(id: number) {
    const emp = this.emp();
    const r = (await sql<Record<string, unknown>>`SELECT * FROM config_legislacao WHERE codconfiglegislacao = ${id} AND codempresa = ${emp}`
      .execute(this.dbp.forTenantRead() as AnyDB)).rows[0];
    if (!r) throw new BusinessRuleError('LEGISLACAO_NAO_ENCONTRADA', { codconfiglegislacao: id });
    return this.linha(r);
  }

  async criar(b: ConfigLegislacaoDto) {
    const emp = this.emp();
    const r = (await sql<{ codconfiglegislacao: unknown }>`
      INSERT INTO config_legislacao (codempresa, descricao, observacoes, uf, codcfop, codproduto, codparceiro, tipo, codoperador, usultalteracao, dtultimalteracao)
      VALUES (${emp}, ${b.descricao ?? null}, ${b.observacoes ?? null}, ${b.uf ?? null}, ${b.codcfop ?? null}, ${b.codproduto ?? null}, ${b.codparceiro ?? null}, ${b.tipo ?? null}, ${this.op()}, ${this.op()}, now())
      RETURNING codconfiglegislacao`.execute(this.dbp.forTenant() as AnyDB)).rows[0];
    return this.obter(Number(r.codconfiglegislacao));
  }

  async atualizar(id: number, b: ConfigLegislacaoDto) {
    const emp = this.emp();
    await this.obter(id);
    await sql`UPDATE config_legislacao
                 SET descricao = ${b.descricao ?? null}, observacoes = ${b.observacoes ?? null}, uf = ${b.uf ?? null},
                     codcfop = ${b.codcfop ?? null}, codproduto = ${b.codproduto ?? null}, codparceiro = ${b.codparceiro ?? null},
                     tipo = ${b.tipo ?? null}, usultalteracao = ${this.op()}, dtultimalteracao = now()
               WHERE codconfiglegislacao = ${id} AND codempresa = ${emp}`.execute(this.dbp.forTenant() as AnyDB);
    return this.obter(id);
  }

  /** exclusão lógica, como o legado (`INDR='E'` — há uma linha assim no cliente). */
  async excluir(id: number) {
    const emp = this.emp();
    await this.obter(id);
    await sql`UPDATE config_legislacao SET indr = 'E', indr_usuario = ${this.op()}, indr_data = now()
               WHERE codconfiglegislacao = ${id} AND codempresa = ${emp}`.execute(this.dbp.forTenant() as AnyDB);
    return { codconfiglegislacao: id, indr: 'E' };
  }

  /** a resolução da mensagem para uma nota — por especificidade, não por igualdade exata. */
  async resolver(q: ResolveLegislacaoDto) {
    const emp = this.emp();
    const uf = q.uf ?? null;
    const cfop = q.codcfop ?? null;
    const prod = q.codproduto ?? null;
    const parc = q.codparceiro ?? null;
    const rows = (await sql<Record<string, unknown>>`
      SELECT *,
             (CASE WHEN codproduto IS NOT NULL THEN 8 ELSE 0 END)
           + (CASE WHEN codparceiro IS NOT NULL THEN 4 ELSE 0 END)
           + (CASE WHEN uf IS NOT NULL THEN 2 ELSE 0 END)
           + (CASE WHEN codcfop IS NOT NULL THEN 1 ELSE 0 END) AS especificidade
        FROM config_legislacao
       WHERE codempresa = ${emp} AND coalesce(indr, 'I') <> 'E'
         AND (codproduto  IS NULL OR codproduto  = ${prod}::integer)
         AND (codparceiro IS NULL OR codparceiro = ${parc}::integer)
         AND (uf          IS NULL OR uf          = ${uf}::text)
         AND (codcfop     IS NULL OR codcfop     = ${cfop}::integer)
       ORDER BY especificidade DESC, codconfiglegislacao`.execute(this.dbp.forTenantRead() as AnyDB)).rows;
    const candidatas = rows.map((r) => ({ ...this.linha(r), especificidade: Number(r.especificidade) }));
    const escolhida = candidatas[0] ?? null;
    return {
      escolhida, candidatas,
      // o legado exige CODCFOP no WHERE: com as regras atuais ele devolveria isto (nada, no cliente)
      resolucaoDoLegado: cfop == null ? null : candidatas.find((c) => c.codcfop === cfop) ?? null,
    };
  }
}
