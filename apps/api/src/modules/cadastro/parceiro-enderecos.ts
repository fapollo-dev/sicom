import { sql } from 'kysely';
import { BusinessRuleError } from '../../shared/errors/app-error';

type AnyDB = any;
const txt = (v: unknown) => (v == null ? '' : String(v).trim());

/**
 * `CNPJLiberadoParaEdicao` (uCadClientes.pas:4707): o endereço está TRAVADO quando há NF emitida para ele, NFC-e para ele, ou
 * indexador tributário do CNPJ num parceiro com endereço ativo (`UNION` de três COUNTs; basta um > 0). A NFC é do PDV e não
 * migra: o endereço dela vem derivado na carga em `vendas.codparceiro_end_nfc` (a ligação da mig 299 — pedido + loja + série
 * + dia; 749 endereços na produção, 672 travados só por ela).
 */
export async function enderecoTravado(db: AnyDB, codend: number | null, cnpj: string): Promise<boolean> {
  const r = (await sql<{ t: boolean }>`
    SELECT (${codend ?? -1}::int > 0 AND EXISTS (SELECT 1 FROM nf WHERE codparceiro_end = ${codend ?? -1}))
        OR (${codend ?? -1}::int > 0 AND EXISTS (SELECT 1 FROM vendas WHERE codparceiro_end_nfc = ${codend ?? -1}))
        OR (${cnpj} <> '' AND EXISTS (SELECT 1 FROM indexador_tributario i JOIN parceiros_end e ON e.codparceiro = i.codparceiro
                                       WHERE i.cnpj_cpf = ${cnpj} AND e.ativado = 'S')) AS t`.execute(db)).rows[0];
  return !!r?.t;
}

/**
 * As regras do legado sobre os ENDEREÇOS na gravação do parceiro (uCadClientes):
 *  - `btnDelEndClick` :1115 — endereço travado não se exclui ("…existem Notas Fiscais ou Indexador Tributário emitidas para este
 *    CNPJ. Deseja desativá-lo?" — a saída é desativar: ATIVADO='N', ENDERECO_PADRAO='N');
 *  - `btnSaveEndClick` :1342 — endereço travado não troca o CPF/CNPJ nem a UF (o teste do indexador usa o documento NOVO — o
 *    `AsString` do campo em edição);
 *  - `edtCNPJ_CPFExit` :2946 — documento em endereço ATIVO de qualquer parceiro (o próprio incluso), quando o endereço é novo ou
 *    o documento mudou: com BLOQUEAR_CADASTRAR_PARCEIRO_CPF_EXISTENTE='S' recusa; senão pergunta "Deseja continuar?" — aqui,
 *    `confirmarDocumentoRepetido` no corpo. (O índice único parcial da mig 178 barrava o que o legado deixa confirmar.)
 * Os endereços do corpo casam com os gravados como o motor casa (`pkEstavel`): pelo CODEND enviado, depois pelo tipo de endereço.
 */
export async function validarEnderecosDoParceiro(
  db: AnyDB,
  id: number | null | undefined,
  dto: Record<string, unknown>,
  bloquearRepetido: boolean,
): Promise<void> {
  const itens = dto.enderecos as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(itens)) return;
  const antigos = id != null
    ? ((await db.selectFrom('parceiros_end').select(['codend', 'cnpj_cpf', 'uf', 'tipo_endereco']).where('codparceiro', '=', id).orderBy('codend').execute()) as Array<Record<string, unknown>>)
    : [];

  // o casamento do motor: CODEND primeiro, depois a n-ésima ocorrência do mesmo tipo de endereço
  const porPk = new Map(antigos.map((a) => [String(a.codend), a]));
  const usados = new Set<Record<string, unknown>>();
  const par: Array<Record<string, unknown> | undefined> = itens.map((i) => {
    const a = i.codend != null ? porPk.get(String(i.codend)) : undefined;
    if (a && !usados.has(a)) { usados.add(a); return a; }
    return undefined;
  });
  const fila = new Map<string, Array<Record<string, unknown>>>();
  for (const a of antigos) fila.set(txt(a.tipo_endereco), [...(fila.get(txt(a.tipo_endereco)) ?? []), a]);
  itens.forEach((i, ix) => {
    if (par[ix]) return;
    const q = fila.get(txt(i.tipo_endereco)) ?? [];
    while (q.length && usados.has(q[0])) q.shift();
    const a = q.shift();
    if (a) { usados.add(a); par[ix] = a; }
  });

  // excluídos: o que estava gravado e não voltou
  for (const a of antigos) {
    if (usados.has(a)) continue;
    if (await enderecoTravado(db, Number(a.codend), txt(a.cnpj_cpf))) {
      throw new BusinessRuleError('ENDERECO_COM_DOCUMENTOS', { codend: Number(a.codend) });
    }
  }
  for (let ix = 0; ix < itens.length; ix++) {
    const i = itens[ix];
    const a = par[ix];
    const docNovo = i.cnpj_cpf !== undefined ? txt(i.cnpj_cpf) : txt(a?.cnpj_cpf);
    const ufNova = i.uf !== undefined ? txt(i.uf) : txt(a?.uf);
    if (a) {
      const mudouDoc = docNovo !== txt(a.cnpj_cpf);
      const mudouUf = ufNova.toUpperCase() !== txt(a.uf).toUpperCase();
      if ((mudouDoc || mudouUf) && (await enderecoTravado(db, Number(a.codend), docNovo))) {
        throw new BusinessRuleError('ENDERECO_DOCUMENTO_TRAVADO', { codend: Number(a.codend) });
      }
      if (!mudouDoc) continue;
    }
    if (!docNovo) continue;
    const outro = (await sql<{ razao: string | null }>`
      SELECT p.razao FROM parceiros_end e LEFT JOIN parceiros p ON p.codparceiro = e.codparceiro
       WHERE e.cnpj_cpf = ${docNovo} AND e.ativado = 'S' ORDER BY e.codend LIMIT 1`.execute(db)).rows[0];
    if (!outro) continue;
    const tipo = docNovo.replace(/\D/g, '').length > 11 ? 'CNPJ' : 'CPF';
    if (bloquearRepetido) throw new BusinessRuleError('PARCEIRO_DOCUMENTO_BLOQUEADO', { documento: docNovo, tipo });
    if (dto.confirmarDocumentoRepetido !== true) {
      // `confirmar`: o campo que a tela manda em true para seguir (o "Deseja continuar?" — CadMaster.tsx)
      throw new BusinessRuleError('PARCEIRO_DOCUMENTO_EXISTENTE', { documento: docNovo, tipo, razao: outro.razao ?? '', confirmar: 'confirmarDocumentoRepetido' },
        `O parceiro "${outro.razao ?? ''}" já foi cadastrado com o ${tipo} informado. Deseja continuar?`);
    }
  }
}
