import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { AcessoService } from '../../shared/acesso/acesso.service';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { todasAsEmpresasDoOperador } from '../../shared/acesso/empresas-do-operador';
import { BusinessRuleError, ForbiddenActionError } from '../../shared/errors/app-error';

type AnyDB = any;

/**
 * As tabelas que o visualizador abre e as telas que o abrem. O legado não dá permissão própria ao `TfrmHistoricoDinamico`: ele é criado
 * por outra tela (`CriadoPorOutraTela`) — aqui, basta o gate de uma delas.
 *  - MULTI_PRECO por IDPRODUTO: o "Histórico" do cadastro de produto (uCadMaster.MenuItemClick, o FGravaHistorico do UCadProduto), o
 *    "Multi-Preço" da precificação (UPrificacaoCusto.MultiPreo1Click) e o do Preço Multi-Loja (Umultipreco.btnHistoricoClick).
 *  Produção 2025-26: 323.793 linhas de MULTI_PRECO; a outra tabela com histórico (NF_STATUS_PROCESSO, 346.482) tem tela própria.
 *  O MULTI_PRECO_ATACAREJO (Atacarejo1Click) fica de fora: as faixas do atacarejo não são usadas (3 linhas, uma vazia).
 */
const ALVOS: Record<string, { chave: string; telas: Array<[form: string, opcao: string]> }> = {
  MULTI_PRECO: { chave: 'IDPRODUTO', telas: [['FRMCADPRODUTO', 'FRMCADPRODUTO'], ['FRMPRIFICACAOCUSTO', 'FRMPRIFICACAOCUSTO']] },
};

/**
 * HISTÓRICO DINÂMICO (`TfrmHistoricoDinamico`, uHistoricoDinamico.pas) — o que mudou, campo a campo, num registro:
 *  - SetaCampos: os campos que têm histórico no registro (`GROUP BY H.CAMPO`, de qualquer loja);
 *  - GetHistorico: as linhas do campo escolhido, NA LOJA (a da linha que a tela passou; 0 = a do login), com o nome do operador,
 *    `ORDER BY codhistorico` (cdsConsHistorico_Dinamico, udmPrincipal.dfm).
 */
@Injectable()
export class HistoricoDinamicoService {
  constructor(private readonly dbp: DatabaseProvider, private readonly acesso: AcessoService) {}

  async consultar(tabelaIn: string, valorIn: string, q: { campo?: string; empresa?: string }) {
    if (currentTenant().operadorId == null) throw new ForbiddenActionError('SEM_PERMISSAO');
    const tabela = String(tabelaIn ?? '').trim().toUpperCase();
    const alvo = ALVOS[tabela];
    if (!alvo) throw new BusinessRuleError('HISTORICO_TABELA_INVALIDA', { tabela });
    let pode = false;
    for (const [form, opcao] of alvo.telas) if (await this.acesso.possuiAcesso(form, opcao)) { pode = true; break; }
    if (!pode) throw new ForbiddenActionError('SEM_PERMISSAO', { pares: alvo.telas.map(([form, opcao]) => ({ form, opcao })) });
    const valor = String(valorIn ?? '').trim();
    if (!valor) throw new BusinessRuleError('HISTORICO_TABELA_INVALIDA', { tabela, valor });

    const db = this.dbp.forTenantRead() as AnyDB;
    // FEmpresa = 0 → a loja do login; a loja pedida tem de ser do operador
    const sessao = Number(currentTenant().empresaId);
    const empresa = q.empresa != null && q.empresa !== '' && Number(q.empresa) !== 0 ? Number(q.empresa) : sessao;
    if (!Number.isInteger(empresa) || !(await todasAsEmpresasDoOperador(db)).includes(empresa)) {
      throw new BusinessRuleError('EMPRESA_FORA_DO_ESCOPO', { empresas: [q.empresa] });
    }

    const campos = ((await db
      .selectFrom('historico_dinamico')
      .select('campo')
      .where('tabela', '=', tabela)
      .where('chave', '=', alvo.chave)
      .where('valor_chave', '=', valor)
      .where('campo', 'is not', null)
      .groupBy('campo')
      .orderBy('campo')
      .execute()) as Array<{ campo: string }>).map((r) => String(r.campo));

    const campo = q.campo != null ? String(q.campo).trim().toUpperCase() : '';
    const linhas = campo
      ? await db
          .selectFrom('historico_dinamico as h')
          .leftJoin('operadores as o', 'o.codoperador', 'h.codoperador')
          .select([
            'h.codhistorico', 'h.campo', 'h.valor_anterior', 'h.valor_atual',
            sql<string>`to_char(h.data AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS')`.as('data'),
            'h.codoperador', 'o.nome', 'h.codempresa', 'h.historico',
          ])
          .where('h.tabela', '=', tabela)
          .where('h.chave', '=', alvo.chave)
          .where('h.valor_chave', '=', valor)
          .where('h.campo', '=', campo)
          .where('h.codempresa', '=', empresa)
          .orderBy('h.codhistorico')
          .execute()
      : [];
    return { tabela, chave: alvo.chave, valor, empresa, campos, campo: campo || null, linhas };
  }
}
