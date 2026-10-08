import { sql } from 'kysely';
import { currentTenant } from '../../shared/tenant/tenant-context';

type AnyDB = any;

/** a tabela do vínculo operador × perfil pelo TIPO do perfil (`GetCdsRelacao`, uRdmCadUsuarios.pas:235; o PARCEIRO não tem) */
export const TABELA_DO_TIPO: Record<string, string> = {
  ACESSO: 'relacao_operador_perfil',
  COMPRA: 'relacao_operador_perfil_compra',
};

/**
 * aplica a lista desejada aos vínculos ATIVOS de um lado (o operador, na tela de usuários; o perfil, na tela de perfil), como o
 * legado grava: o vínculo novo é uma linha 'I' (`InserirRelacaoOperadorPerfil`) e o retirado vira 'E' com INDR_USUARIO/INDR_DATA
 * (`ExcluirRelacaoOperadorPerfil`, uRdmCadUsuarios.pas:343-364; udmCadPerfilOperador) — nada é apagado, e repor é linha nova.
 * `validarNovos` confere os que entram (lança para barrar) antes de qualquer escrita.
 */
export async function sincronizarVinculos(
  trx: AnyDB,
  tabela: string,
  fixo: { coluna: 'codoperador' | 'codperfil'; valor: number },
  quer: number[],
  validarNovos: (novos: number[]) => Promise<void>,
): Promise<void> {
  const outra = fixo.coluna === 'codoperador' ? 'codperfil' : 'codoperador';
  const ativos = ((await trx.selectFrom(tabela).select(outra).where(fixo.coluna, '=', fixo.valor)
    .where(sql`coalesce(indr,'I')`, '<>', 'E').forUpdate().execute()) as Array<Record<string, unknown>>).map((r) => Number(r[outra]));
  const desejados = [...new Set(quer.map(Number))];
  const novos = desejados.filter((c) => !ativos.includes(c));
  const saem = ativos.filter((c) => !desejados.includes(c));
  if (novos.length) {
    await validarNovos(novos);
    await trx.insertInto(tabela).values(novos.map((c) => ({ [fixo.coluna]: fixo.valor, [outra]: c, indr: 'I', dtcadastro: sql`now()` }))).execute();
  }
  if (saem.length) {
    await trx.updateTable(tabela).set({ indr: 'E', indr_usuario: currentTenant().operadorId ?? null, indr_data: sql`now()` })
      .where(fixo.coluna, '=', fixo.valor).where(outra, 'in', saem).where(sql`coalesce(indr,'I')`, '<>', 'E').execute();
  }
}
