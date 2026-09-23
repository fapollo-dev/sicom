/**
 * AS RESTRIÇÕES DA SITUAÇÃO DO DOCUMENTO fora da NF (UCadSituacaoNF.md C5): a situação lista os PARCEIROS
 * (SITUACAO_NF_PARCEIROS) e os CENTROS DE CUSTO (SITUACAO_NF_PLC) que aceita — lista vazia é sem restrição. O legado
 * confere no Exit do campo, com a mensagem literal de cada tela (uAPagar.pas:3559/3671, uCadAReceber.pas:1728/2009,
 * uMovCaixa.pas:503/544, uCadSCRAP.pas:1311); aqui a cobrança é na gravação, quando o campo é informado ou alterado
 * (o registro antigo que já estava fora — 1 título de 613 no contas a pagar — continua gravando se ninguém o mexer).
 */
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = any;
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));

export type PapelParceiro = 'fornecedor' | 'cliente' | 'parceiro';
const CODIGO_PARCEIRO: Record<PapelParceiro, string> = {
  fornecedor: 'SITUACAO_FORNECEDOR_NAO_PERMITIDO',
  cliente: 'SITUACAO_CLIENTE_NAO_PERMITIDO',
  parceiro: 'SITUACAO_PARCEIRO_NAO_PERMITIDO',
};

/** o parceiro tem de estar na lista da situação (se a situação tiver lista) */
export async function assertParceiroDaSituacao(db: AnyDB, idsituacao_nf: unknown, codparceiro: unknown, papel: PapelParceiro): Promise<void> {
  const sit = num(idsituacao_nf);
  const par = num(codparceiro);
  if (!(sit > 0) || !(par > 0)) return;
  const lista = (await db.selectFrom('situacao_nf_parceiros').select('codparceiro').where('idsituacao_nf', '=', sit).execute()) as Array<{ codparceiro: unknown }>;
  if (lista.length && !lista.some((l) => num(l.codparceiro) === par)) {
    throw new BusinessRuleError(CODIGO_PARCEIRO[papel], { codparceiro: par, idsituacao_nf: sit });
  }
}

/** o centro de custo tem de estar na lista da situação (se a situação tiver lista) */
export async function assertCentroCustoDaSituacao(db: AnyDB, idsituacao_nf: unknown, codcc: unknown): Promise<void> {
  const sit = num(idsituacao_nf);
  const cc = num(codcc);
  if (!(sit > 0) || !(cc > 0)) return;
  const lista = (await db.selectFrom('situacao_nf_plc').select('codplc').where('idsituacao_nf', '=', sit).execute()) as Array<{ codplc: unknown }>;
  if (lista.length && !lista.some((l) => num(l.codplc) === cc)) {
    throw new BusinessRuleError('SITUACAO_CC_NAO_PERMITIDO', { codplc: cc, idsituacao_nf: sit });
  }
}

/**
 * a gravação de um documento com situação, parceiro e centro de custo: cobra o que o dto INFORMA ou MUDA (o Exit do
 * legado só roda no campo visitado). `antes` é o registro gravado (vazio no criar).
 */
export async function assertRestricoesSituacao(
  db: AnyDB,
  dto: Record<string, unknown>,
  antes: Record<string, unknown>,
  cfg: { papel: PapelParceiro; parceiro?: string; cc?: string },
): Promise<void> {
  const colPar = cfg.parceiro ?? 'codparceiro';
  const colCc = cfg.cc ?? 'codplc';
  const mudou = (c: string) => dto[c] !== undefined && num(dto[c]) !== num(antes[c]);
  const sit = dto.idsituacao_nf !== undefined ? dto.idsituacao_nf : antes.idsituacao_nf;
  const sitMudou = mudou('idsituacao_nf');
  if (sitMudou || mudou(colPar)) await assertParceiroDaSituacao(db, sit, dto[colPar] !== undefined ? dto[colPar] : antes[colPar], cfg.papel);
  if (sitMudou || mudou(colCc)) await assertCentroCustoDaSituacao(db, sit, dto[colCc] !== undefined ? dto[colCc] : antes[colCc]);
}
