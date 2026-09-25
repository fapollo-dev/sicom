/**
 * O `btnGravarClick` do cadastro de produto (UCadProduto.pas:2608-3070) — as validações e derivações que o legado faz a cada
 * gravação, sobre o registro INTEIRO (o que a tela manda por cima do que está gravado), com a linha de preço da loja da sessão.
 *
 * Só entram as provadas vivas no dado de produção (25/09/2026), porque o fonte é de 2020 e o binário é mais novo:
 *  - NCM obrigatório, de 8 dígitos, existente e vigente — para o produto que não é filho nem uso e consumo (0 de 519 produtos assim
 *    criados em 2026 estão sem NCM);
 *  - CEST de 7 dígitos e existente, e obrigatório no STB — idem (1 de 422 STB sem CEST; no uso e consumo, 4 de 45: não se aplica);
 *  - custo e custo de reposição diferentes de 0 no produto que não é filho (0 de 575);
 *  - PIS/COFINS obrigatório fora do Simples Nacional, para o produto que não é filho nem uso e consumo (0 de 519 sem a tabela);
 *  - BLOQ_VENDA_MAIOR_CUSTO (configuração; 'N' na produção): venda menor que o custo, fora do uso e consumo;
 *  - PREEN_NCM da empresa ('C'/vazio): NCM informado tem 8 dígitos, também no uso e consumo;
 *  - a FIGURA FISCAL do uso e consumo vem da alíquota de saída (STB 6; tributada pelo ICMS efetivo 4/7/12/18/25/30; IST/NTB 5)
 *    — ~96% dos 655 produtos de uso e consumo de 2026 batem;
 *  - CODBALANCA vazio vira 1 (0 de 1.175 vazios).
 * Ficam de fora, com prova de que o binário novo não as aplica: VALOR DE VENDA obrigatório (331 de 575 com venda 0), seção/depto/grupo/
 * subgrupo obrigatórios (1.168 de 1.175 sem seção) e a NATUREZA PIS/COFINS (573 de 1.175 sem ela e sem alíquota de COFINS).
 */
import { BusinessRuleError } from '../../shared/errors/app-error';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { configNaTrx } from '../compras/pedido-heranca';

type AnyDB = any;

const vazio = (v: unknown) => v == null || String(v).trim() === '';
const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

/** a figura fiscal do uso e consumo (UCadProduto.pas:2910-2935) — null quando nenhuma regra casa */
export function figuraDoUsoConsumo(aliquotaSaida: string | null | undefined, icmEfetivo: number | null | undefined): number | null {
  const a = String(aliquotaSaida ?? '').trim().toUpperCase();
  if (a === 'STB') return 6;
  if (a.startsWith('T')) {
    const i = Number(icmEfetivo ?? NaN);
    return [4, 7, 12, 18, 25, 30].includes(i) ? i : null;
  }
  if (a === 'IST' || a === 'NTB') return 5;
  return null;
}

export async function validarGravacaoProduto(dto: Record<string, unknown>, id: number | undefined, db: AnyDB): Promise<void> {
  const t = currentTenant();
  const emp = t.empresaId ?? null;
  const atual = id != null ? ((await db.selectFrom('produtos').selectAll().where('idproduto', '=', id).executeTakeFirst()) as Record<string, unknown> | undefined) ?? {} : {};
  const r: Record<string, unknown> = { ...atual };
  for (const [k, v] of Object.entries(dto)) if (v !== undefined) r[k] = v;
  const filho = n(r.idproduto_pai) !== 0;
  const uso = String(r.uso_consumo ?? 'N') === 'S';
  // a linha de preço da loja da sessão: a gravada, com o que veio por cima (a tela do legado sempre tem a linha inteira)
  const precos = Array.isArray(dto.precos) ? (dto.precos as Array<Record<string, unknown>>) : null;
  const veio = precos?.find((p) => Number(p.idempresa) === emp);
  const gravada = id != null && emp != null
    ? ((await db.selectFrom('multi_preco').selectAll().where('idproduto', '=', id).where('idempresa', '=', emp).executeTakeFirst()) as Record<string, unknown> | undefined)
    : undefined;
  let linha: Record<string, unknown> | undefined = gravada || veio ? { ...(gravada ?? {}) } : undefined;
  if (linha && veio) for (const [k, v] of Object.entries(veio)) if (v !== undefined) linha[k] = v;
  // a alíquota de saída da linha da sessão é a do produto (o combo único do legado; `produto.aggregate.ts` a espelha na gravação)
  if (linha && !vazio(dto.aliquota)) linha.aliquotasaida = dto.aliquota;
  const empresa = emp != null
    ? ((await db.selectFrom('empresas').select(['classfiscal', 'preen_ncm', 'uf']).where('idempresa', '=', emp).executeTakeFirst()) as { classfiscal?: string; preen_ncm?: string; uf?: string } | undefined)
    : undefined;
  const ncm = String(r.ncmsh ?? '').trim();

  if (!filho && !uso) {
    if (!ncm) throw new BusinessRuleError('PRODUTO_NCM_OBRIGATORIO');
    if (ncm.length !== 8) throw new BusinessRuleError('PRODUTO_NCM_8_DIGITOS', { ncmsh: ncm });
    // NCMValido (UCadProduto.pas:7960): existe na tabela NCM e está vigente
    const reg = (await db.selectFrom('ncm').select(['vigencia_inicio', 'vigencia_fim']).where('ncmsh', '=', ncm).executeTakeFirst()) as { vigencia_inicio?: unknown; vigencia_fim?: unknown } | undefined;
    if (!reg) throw new BusinessRuleError('PRODUTO_NCM_NAO_ENCONTRADO', { ncmsh: ncm });
    const hoje = new Date().toISOString().slice(0, 10);
    const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
    if (reg.vigencia_inicio != null && dia(reg.vigencia_inicio) > hoje) throw new BusinessRuleError('PRODUTO_NCM_FORA_DE_VIGENCIA', { ncmsh: ncm });
    if (reg.vigencia_fim != null && dia(reg.vigencia_fim) < hoje) throw new BusinessRuleError('PRODUTO_NCM_VENCIDO', { ncmsh: ncm });

    const cest = String(r.cest ?? '').replace(/\D/g, '');
    if (cest) {
      if (cest.length !== 7) throw new BusinessRuleError('PRODUTO_CEST_7_DIGITOS', { cest });
      const ok = await db.selectFrom('cest').select('cest').where('cest', '=', cest).executeTakeFirst();
      if (!ok) throw new BusinessRuleError('PRODUTO_CEST_NAO_ENCONTRADO', { cest });
    } else if (String(linha?.aliquotasaida ?? '').trim().toUpperCase() === 'STB') {
      throw new BusinessRuleError('PRODUTO_CEST_STB');
    }
  }

  if (!filho) {
    if (n(linha?.vrcusto) === 0) throw new BusinessRuleError('PRODUTO_CUSTO_ZERO');
    if (n(linha?.vrcustorep) === 0) throw new BusinessRuleError('PRODUTO_CUSTO_REP_ZERO');
  }

  if (String(empresa?.classfiscal ?? '') !== 'SN' && !filho && !uso) {
    if (String(r.pis ?? '') !== 'S' || n(r.idpiscofins) === 0) throw new BusinessRuleError('PRODUTO_PISCOFINS_OBRIGATORIO');
  }

  if (!uso) {
    const bloq = await configNaTrx(db, 'BLOQ_VENDA_MAIOR_CUSTO', { empresaId: emp, operadorId: t.operadorId ?? null, modulo: 'Retaguarda' });
    if (String(bloq ?? 'N').toUpperCase() === 'S' && n(linha?.vrvenda) < n(linha?.vrcusto)) throw new BusinessRuleError('PRODUTO_VENDA_MENOR_CUSTO');
  }

  // PREEN_NCM 'C' (ou vazia): o NCM informado tem 8 dígitos — aqui vale também para o uso e consumo
  if (vazio(empresa?.preen_ncm) || String(empresa?.preen_ncm).trim().toUpperCase() === 'C') {
    if (!filho && ncm && ncm.length !== 8) throw new BusinessRuleError('PRODUTO_NCM_8_DIGITOS', { ncmsh: ncm });
  }

  // derivações do gravar
  if (uso) {
    const aliq = String(linha?.aliquotasaida ?? '').trim();
    const icm = aliq && empresa?.uf
      ? ((await db.selectFrom('det_aliquota').select('icm_efetivo').where('aliquota', '=', aliq).where('uf', '=', empresa.uf).executeTakeFirst()) as { icm_efetivo?: unknown } | undefined)?.icm_efetivo
      : null;
    dto.codfigurafiscal = figuraDoUsoConsumo(aliq, icm == null ? null : Number(icm));
  }
  if (vazio(r.codbalanca)) dto.codbalanca = 1;
}
