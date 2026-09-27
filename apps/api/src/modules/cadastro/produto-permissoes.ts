import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { opcoesConcedidas } from '../../shared/acesso/acesso.service';

type AnyDB = any;
const FORM = 'FRMCADPRODUTO';
const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const mudou = (a: unknown, b: unknown) => Math.abs(n(a) - n(b)) > 0.000001;

/**
 * AS PERMISSÕES DE CONTROLE do cadastro de produto (`uMaster.SetStateOfControlsMaster` sobre o UCadProduto.dfm): o componente com
 * Tag 1 cujo nome é uma opção de PERMISSOES fica DESABILITADO para quem não a tem — não dá para mudar o valor nem clicar o botão.
 * A tela desabilita; aqui a gravação confere o mesmo (quem burlasse a tela não passaria). Os que valem, com o dado da produção
 * (27/09/2026; 134 operador×loja com acesso à tela):
 *  - preço de venda `edtVRVENDA` (6 sem), custo `edtCusto` e custo de reposição `edtCustoRep` (8 sem) — da linha de preço da loja;
 *  - ativo p/ venda `chbATIVO` e p/ compra `chbAtivoCompra` — do produto (hoje todos têm);
 *  - composição: adicionar `btnAddItem` (12 sem), excluir `btnDelItem` (19), limpar `btnLimparComposicao` (6);
 *  - decomposição: adicionar `btnAddDescomp` (12), excluir `btnExcluiDecomp`, limpar `btnLimpaDecomp`.
 * O NCM e a figura fiscal também têm opção, mas são TDBEdit: o legado só lhes tira o Tab (continuam editáveis) — não travam.
 * O "excluir código auxiliar" (`btnExcluirCodAuxiliar`) NÃO trava: ninguém tem a opção e a produção excluiu 19 códigos auxiliares
 * pelo cadastro desde 2025 — o binário novo exclui por outro caminho.
 */
export async function validarPermissoesDoProduto(dto: Record<string, unknown>, id: number | undefined, db: AnyDB): Promise<void> {
  // controle de TELA: sem operador no contexto (rotina do sistema, importação) não há tela nem controle — como no legado
  if (currentTenant().operadorId == null) return;
  const tem = await opcoesConcedidas(db, FORM);
  const negar = (opcao: string, rotulo: string) => {
    if (!tem.has(opcao)) throw new BusinessRuleError('SEM_PERMISSAO_CONTROLE', { form: FORM, opcao }, `Você não tem permissão para ${rotulo}.`);
  };
  const emp = currentTenant().empresaId ?? null;

  // a linha de preço da loja da sessão (a que a tela edita — dtsMulti_Preco)
  const precos = Array.isArray(dto.precos) ? (dto.precos as Array<Record<string, unknown>>) : null;
  const veio = precos?.find((p) => Number(p.idempresa) === emp);
  if (veio) {
    const gravada = id != null && emp != null
      ? ((await db.selectFrom('multi_preco').select(['vrvenda', 'vrcusto', 'vrcustorep']).where('idproduto', '=', id).where('idempresa', '=', emp)
        .executeTakeFirst()) as Record<string, unknown> | undefined)
      : undefined;
    const base = gravada ?? { vrvenda: 0, vrcusto: 0, vrcustorep: 0 };
    if (veio.vrvenda !== undefined && mudou(veio.vrvenda, base.vrvenda)) negar('EDTVRVENDA', 'alterar o preço de venda');
    if (veio.vrcusto !== undefined && mudou(veio.vrcusto, base.vrcusto)) negar('EDTCUSTO', 'alterar o custo');
    if (veio.vrcustorep !== undefined && mudou(veio.vrcustorep, base.vrcustorep)) negar('EDTCUSTOREP', 'alterar o custo de reposição');
  }

  // o ativo do produto (dtsPrincipal)
  if (dto.ativo !== undefined || dto.ativo_compra !== undefined) {
    const atual = id != null
      ? ((await db.selectFrom('produtos').select(['ativo', 'ativo_compra']).where('idproduto', '=', id).executeTakeFirst()) as Record<string, unknown> | undefined)
      : undefined;
    const antes = (c: 'ativo' | 'ativo_compra') => String(atual?.[c] ?? 'S');
    if (dto.ativo !== undefined && String(dto.ativo ?? 'S') !== antes('ativo')) negar('CHBATIVO', 'alterar o ativo p/ venda');
    if (dto.ativo_compra !== undefined && String(dto.ativo_compra ?? 'S') !== antes('ativo_compra')) negar('CHBATIVOCOMPRA', 'alterar o ativo p/ compra');
  }

  // composição e decomposição: incluir, excluir um, limpar todos (o que o dto traz contra o gravado)
  const detalhe = async (chave: string, tabela: string, add: string, del: string, limpar: string, nome: string) => {
    if (!Array.isArray(dto[chave])) return;
    const novos = new Set((dto[chave] as Array<Record<string, unknown>>).map((i) => Number(i.idproduto_01)));
    const antigos = id != null
      ? new Set(((await db.selectFrom(tabela).select('idproduto_01').where('idproduto', '=', id).execute()) as Array<{ idproduto_01: number }>).map((r) => Number(r.idproduto_01)))
      : new Set<number>();
    if ([...novos].some((p) => !antigos.has(p))) negar(add, `incluir item na ${nome}`);
    const removidos = [...antigos].filter((p) => !novos.has(p));
    if (!removidos.length) return;
    // tudo fora: basta "Limpar" ou "Excluir"; parte: só "Excluir"
    if (novos.size === 0 && tem.has(limpar)) return;
    negar(del, `excluir item da ${nome}`);
  };
  await detalhe('composicoes', 'composicao', 'BTNADDITEM', 'BTNDELITEM', 'BTNLIMPARCOMPOSICAO', 'composição');
  await detalhe('decomposicoes', 'decomposicao', 'BTNADDDESCOMP', 'BTNEXCLUIDECOMP', 'BTNLIMPADECOMP', 'decomposição');
}
