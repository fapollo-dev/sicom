import { BusinessRuleError } from '../errors/app-error';

/**
 * As PERMISSÕES DE CONTROLE na gravação (docs/05-migration-engineering/permissoes-de-controle.md): o que a tela desabilita para
 * quem não tem a opção, a gravação recusa — quem burlasse a tela não passaria. Mensagem: "Você não tem permissão para <ação>."
 */
export function exigirOpcao(tem: Set<string>, form: string, opcao: string, acao: string): void {
  if (!tem.has(opcao.toUpperCase())) {
    throw new BusinessRuleError('SEM_PERMISSAO_CONTROLE', { form, opcao }, `Você não tem permissão para ${acao}.`);
  }
}

/**
 * Os botões de um detalhe (grade de itens): "Adicionar", "Excluir" (um) e "Limpar" (todos), conferidos pelo que o dto traz contra o
 * gravado — por uma chave do item (repetições contam: o 2º item do mesmo produto é outro item). Tirar TODOS passa com "Limpar" ou
 * "Excluir"; tirar parte, só com "Excluir".
 */
export function conferirDetalhe(
  tem: Set<string>, form: string, antigos: Array<string | number>, novos: Array<string | number>,
  op: { adicionar?: string; excluir?: string; limpar?: string; /** 'na composição', 'no documento' */ no: string; /** 'da composição', 'do documento' */ do: string },
): void {
  const conta = (xs: Array<string | number>) => xs.reduce((m, x) => m.set(String(x), (m.get(String(x)) ?? 0) + 1), new Map<string, number>());
  const a = conta(antigos), n = conta(novos);
  const incluiu = [...n].some(([k, q]) => q > (a.get(k) ?? 0));
  const excluiu = [...a].some(([k, q]) => q > (n.get(k) ?? 0));
  if (incluiu && op.adicionar) exigirOpcao(tem, form, op.adicionar, `incluir item ${op.no}`);
  if (!excluiu) return;
  if (novos.length === 0 && op.limpar && tem.has(op.limpar.toUpperCase())) return;
  if (op.excluir) exigirOpcao(tem, form, op.excluir, `excluir item ${op.do}`);
  else if (novos.length === 0 && op.limpar) exigirOpcao(tem, form, op.limpar, `limpar os itens ${op.do}`);
}

/**
 * Os CAMPOS travados por opção (calc-edit, checkbox, e no form de cadastro também o edit): só recusa o que MUDA — gravar o registro com
 * o valor igual passa. `antes` = a linha gravada (vazia na inclusão: aí conta como mudança o valor diferente do `padrao`).
 */
export function conferirCampos(
  tem: Set<string>, form: string, dto: Record<string, unknown>, antes: Record<string, unknown> | undefined,
  campos: Array<{ campo: string; opcao: string; acao: string; padrao?: unknown; numero?: boolean }>,
): void {
  for (const c of campos) {
    if (dto[c.campo] === undefined) continue;
    // na inclusão sem `padrao` o campo não é conferido (a própria tela o preenche — ex.: o papel do parceiro pela tela aberta)
    if (!antes && c.padrao === undefined) continue;
    const velho = antes ? antes[c.campo] : c.padrao;
    const mudou = c.numero
      ? Math.abs(Number(dto[c.campo] ?? 0) - Number(velho ?? 0)) > 0.000001
      : String(dto[c.campo] ?? '').trim() !== String(velho ?? '').trim();
    if (mudou) exigirOpcao(tem, form, c.opcao, c.acao);
  }
}
