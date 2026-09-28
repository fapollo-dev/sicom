import { sql } from 'kysely';
import { BusinessRuleError } from '../../shared/errors/app-error';
import { UFS } from '@apollo/shared';

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
export interface RegrasEndereco {
  /** BLOQUEAR_CADASTRAR_PARCEIRO_CPF_EXISTENTE = 'S' */
  bloquearRepetido: boolean;
  /** VALIDA_CPF_CNPJ_VAZIO: N / C (CPF) / J (CNPJ) / A (ambos) — sem a config, nada é exigido (o ValorConfiguracao devolve '') */
  validaCpfCnpj: string;
  /** o TIPOFJ e o ESTRANGEIRO efetivos (do corpo, senão os gravados) */
  tipofj: string;
  estrangeiro: boolean;
  /** criando o parceiro (não há endereço gravado) */
  criando: boolean;
}

/** o BRASIL da PAIS do legado (CODPAI 33, CODPAIS_SEFAZ 1058): é o que o `cmbUFExit` grava (UF.CODPAI) em toda UF brasileira */
export const CODPAIS_BRASIL = 33;
const COLS_ENDERECO = ['endereco', 'numero', 'complemento', 'bairro', 'cidade', 'idcidade', 'uf', 'cep', 'cnpj_cpf', 'rg_insc', 'codpais', 'ativado', 'tipo_endereco'];

export async function validarEnderecosDoParceiro(
  db: AnyDB,
  id: number | null | undefined,
  dto: Record<string, unknown>,
  regras: RegrasEndereco,
): Promise<void> {
  const bloquearRepetido = regras.bloquearRepetido;
  const itens = dto.enderecos as Array<Record<string, unknown>> | undefined;
  const entidade = regras.tipofj === 'E';
  // "Preenchimento dos dados de endereço obrigatórios" (btnGravarClick :2013): sem endereço só a ENTIDADE grava — conferido depois
  // das travas (no legado o excluir do endereço, com a trava dele, acontece antes do Gravar)
  if (!Array.isArray(itens)) {
    if (!entidade && regras.criando) throw new BusinessRuleError('PARCEIRO_ENDERECO_OBRIGATORIO');
    return;
  }
  const antigos = id != null
    ? ((await db.selectFrom('parceiros_end').select(['codend', ...COLS_ENDERECO]).where('codparceiro', '=', id).orderBy('codend').execute()) as Array<Record<string, unknown>>)
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
  if (!entidade && itens.length === 0) throw new BusinessRuleError('PARCEIRO_ENDERECO_OBRIGATORIO');
  // os DADOS do endereço (DadosEnderecoPreenchidos :4942 e a conferência do IBGE :2041) — no legado, do endereço corrente na
  // gravação; aqui, de cada endereço novo ou alterado (os gravados que não mudaram ficam como vieram, inclusive os da carga)
  if (entidade) return;
  for (let ix = 0; ix < itens.length; ix++) {
    const i = itens[ix];
    const a = par[ix];
    const val = (c: string) => (i[c] !== undefined ? i[c] : a?.[c]);
    if (a && COLS_ENDERECO.every((c) => txt(val(c)).toUpperCase() === txt(a[c]).toUpperCase())) continue;
    await conferirDadosDoEndereco(db, val, regras);
  }
}

const faltou = (campo: string, msg: string) => new BusinessRuleError('PARCEIRO_ENDERECO_INCOMPLETO', { campo }, msg);

async function conferirDadosDoEndereco(db: AnyDB, val: (c: string) => unknown, regras: RegrasEndereco): Promise<void> {
  const doc = txt(val('cnpj_cpf'));
  const codpais = Number(val('codpais') ?? 0);
  const ufSigla = txt(val('uf')).toUpperCase();
  const uf = UFS.find((u) => u.sigla === ufSigla);
  if (regras.estrangeiro) {
    if (!txt(val('cidade'))) throw faltou('cidade', 'Necessário informar a cidade.');
    if (!(codpais > 0)) throw faltou('codpais', 'Necessário informar o País.');
    if (codpais === CODPAIS_BRASIL) throw new BusinessRuleError('PARCEIRO_ESTRANGEIRO_BRASIL');
    if (!doc && regras.validaCpfCnpj !== 'N') throw faltou('cnpj_cpf', 'Necessário informar o registro de estrangeiro.');
  } else {
    if (!txt(val('endereco'))) throw faltou('endereco', 'Necessário informar o logradouro.');
    if (!txt(val('bairro'))) throw faltou('bairro', 'Necessário informar o bairro.');
    if (!txt(val('cep'))) throw faltou('cep', 'Necessário informar o CEP.');
    if (!txt(val('cidade'))) throw faltou('cidade', 'Necessário informar a cidade.');
    if (!ufSigla) throw faltou('uf', 'Necessário informar a UF.');
    // o país vem da UF (cmbUFExit → UF.CODPAI): UF brasileira sem país recebe o BRASIL na gravação (derivarItensTrx)
    if (!(codpais > 0) && !uf) throw faltou('codpais', 'Necessário informar o País.');
    if (!doc) {
      const v = regras.validaCpfCnpj;
      if ((v === 'C' || v === 'A') && (regras.tipofj === 'F' || regras.tipofj === 'R')) throw faltou('cnpj_cpf', 'Necessário informar o CPF.');
      if ((v === 'J' || v === 'A') && (regras.tipofj === 'J' || regras.tipofj === 'G')) throw faltou('cnpj_cpf', 'Necessário informar o CNPJ.');
    }
  }
  // "Cidade e UF não conferem com a tabela do IBGE" (:2041): com a UF conhecida, a cidade (IDCIDADE) tem de ser dela
  if (uf) {
    const idcidade = Number(val('idcidade') ?? 0);
    const achou = idcidade > 0
      ? await db.selectFrom('cidades').select('idcidade').where('idcidade', '=', idcidade).where('iduf', '=', uf.iduf).executeTakeFirst()
      : undefined;
    if (!achou) throw new BusinessRuleError('PARCEIRO_CIDADE_IBGE', { idcidade: idcidade || null, uf: uf.sigla });
  }
}
