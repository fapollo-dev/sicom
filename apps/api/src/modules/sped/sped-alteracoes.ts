/**
 * AS ALTERAÇÕES DE CADASTRO DO SPED (`TB_SPEED_AUX`; mig 324). Captura (`udmPrincipal.RegistroSPEED`, :3760-3800;
 * `SpeedAux.pas:98-150`) e a consulta da emissão (`UdmSpedFiscal.dfm:7705`, `sqqSpeedAux`).
 *  - 0205 — produto: DESCRICAO e CODBARRA; DT_INI = a última alteração ANTERIOR do produto (≤ 2000 → 01/01/2000), DT_FIM
 *    = hoje. 0175 — participante: RAZAO (campo 03), CNPJ_CPF (05 se jurídica, 06 se física), IDCIDADE (08), ENDERECO (10),
 *    NUMERO (11), COMPLEMENTO (12), BAIRRO (13) do 0150; valor anterior vazio vira 'SEM INFORMACAO'; DT_INI = a última
 *    alteração anterior, DT_FIM = a desta gravação (hoje).
 *  - `GravaRegistro`: se já há um pendente (REG_INFORMADO 'N') do mesmo registro, tipo e campo, ele é ATUALIZADO (valor
 *    anterior, atual e DT_FIM — o legado sobrescreve também o anterior); senão, insere com REG_INFORMADO 'N'.
 */
import { sql } from 'kysely';

type AnyDB = any;
const FUSO = 'America/Sao_Paulo';

export interface AlteracaoSped { campo: string; anterior: unknown; atual: unknown }

const txt = (v: unknown) => (v == null ? '' : String(v));
const dia = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(d);
};

/** grava as alterações de um registro (produto 0205 / parceiro 0175), no padrão `GravaRegistro` do legado */
export async function registrarAlteracoesSped(
  trx: AnyDB, tipo: '0205' | '0175', codigo: number, alteracoes: AlteracaoSped[], ultimaAlteracaoAnterior: unknown,
): Promise<number> {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date());
  const ant = dia(ultimaAlteracaoAnterior);
  const dtIni = !ant || ant <= '2000-01-01' ? '2000-01-01' : ant;
  let n = 0;
  for (const a of alteracoes) {
    const anterior = txt(a.anterior);
    const atual = txt(a.atual);
    if (anterior === atual) continue;
    const vlAnt = (tipo === '0175' && anterior === '' ? 'SEM INFORMACAO' : anterior).slice(0, 100);
    const pendente = (await sql<{ cod: string }>`
      SELECT cod_speed_aux AS cod FROM tb_speed_aux
       WHERE codigo_registro = ${codigo} AND tipo_registro = ${tipo} AND reg_informado = 'N' AND campo = ${a.campo}
       ORDER BY cod_speed_aux LIMIT 1`.execute(trx)).rows[0];
    if (pendente) {
      await sql`UPDATE tb_speed_aux SET vl_anterior = ${vlAnt}, vl_atual = ${atual.slice(0, 100)},
                  dt_fim = (${hoje}::date)::timestamp AT TIME ZONE ${FUSO}
                WHERE cod_speed_aux = ${Number(pendente.cod)}`.execute(trx);
    } else {
      await sql`INSERT INTO tb_speed_aux (tipo_registro, codigo_registro, vl_anterior, vl_atual, campo, dt_ini, dt_fim, reg_informado)
                VALUES (${tipo}, ${codigo}, ${vlAnt}, ${atual.slice(0, 100)}, ${a.campo},
                        (${dtIni}::date)::timestamp AT TIME ZONE ${FUSO}, (${hoje}::date)::timestamp AT TIME ZONE ${FUSO}, 'N')`.execute(trx);
    }
    n++;
  }
  return n;
}

/** o que muda no produto para o 0205 — só os campos que vieram no PUT */
export async function capturarAlteracaoProduto(trx: AnyDB, idproduto: number, dto: Record<string, unknown>): Promise<void> {
  if (!('descricao' in dto) && !('codbarra' in dto)) return;
  const p = (await sql<Record<string, unknown>>`SELECT descricao, codbarra, dtultimalteracao FROM produtos WHERE idproduto = ${idproduto}`.execute(trx)).rows[0];
  if (!p) return;
  const alt: AlteracaoSped[] = [];
  if ('descricao' in dto) alt.push({ campo: 'DESCRICAO', anterior: p.descricao, atual: dto.descricao });
  if ('codbarra' in dto) alt.push({ campo: 'CODBARRA', anterior: p.codbarra, atual: dto.codbarra });
  await registrarAlteracoesSped(trx, '0205', idproduto, alt, p.dtultimalteracao);
}

/** o que muda no participante para o 0175 — o nome e o endereço padrão (o do 0150) */
export async function capturarAlteracaoParceiro(trx: AnyDB, codparceiro: number, dto: Record<string, unknown>): Promise<void> {
  const p = (await sql<Record<string, unknown>>`SELECT razao, tipofj, dtultimalteracao FROM parceiros WHERE codparceiro = ${codparceiro}`.execute(trx)).rows[0];
  if (!p) return;
  const alt: AlteracaoSped[] = [];
  if ('razao' in dto) alt.push({ campo: '03', anterior: p.razao, atual: dto.razao });
  const enderecos = dto.enderecos as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(enderecos) && enderecos.length) {
    const e = (await sql<Record<string, unknown>>`
      SELECT tipo_endereco, cnpj_cpf, idcidade, endereco, numero, complemento, bairro FROM parceiros_end
       WHERE codparceiro = ${codparceiro} ORDER BY (endereco_padrao = 'S') DESC, codend LIMIT 1`.execute(trx)).rows[0];
    if (e) {
      const novo = enderecos.find((x) => txt(x.tipo_endereco) === txt(e.tipo_endereco)) ?? enderecos.find((x) => x.endereco_padrao === 'S') ?? enderecos[0];
      const tipofj = txt(dto.tipofj ?? p.tipofj);
      const campos: Array<[string, string]> = [
        ...(tipofj === 'J' ? [['05', 'cnpj_cpf'] as [string, string]] : tipofj === 'F' ? [['06', 'cnpj_cpf'] as [string, string]] : []),
        ['08', 'idcidade'], ['10', 'endereco'], ['11', 'numero'], ['12', 'complemento'], ['13', 'bairro'],
      ];
      for (const [nr, col] of campos) if (col in novo) alt.push({ campo: nr, anterior: e[col], atual: novo[col] });
    }
  }
  if (alt.length) await registrarAlteracoesSped(trx, '0175', codparceiro, alt, p.dtultimalteracao);
}

/**
 * os registros a emitir no SPED do período para um conjunto de produtos (0205) ou participantes (0175) — a consulta
 * `sqqSpeedAux`: os pendentes com DT_FIM até o fim do período (0175) ou antes dele (0205), mais os já informados com
 * DT_FIM dentro do período (regerar o mesmo mês dá o mesmo arquivo). O município (08) só entra se a UF não mudou.
 */
export async function alteracoesParaSped(db: AnyDB, tipo: '0205' | '0175', codigos: number[], dtini: string, dtfim: string): Promise<Array<Record<string, unknown>>> {
  if (!codigos.length) return [];
  const fimCond = tipo === '0175' ? sql`(dt_fim AT TIME ZONE ${FUSO})::date <= ${dtfim}::date` : sql`(dt_fim AT TIME ZONE ${FUSO})::date < ${dtfim}::date`;
  return (await sql<Record<string, unknown>>`
    SELECT cod_speed_aux, codigo_registro, vl_anterior, vl_atual, campo, reg_informado,
           to_char(dt_ini AT TIME ZONE ${FUSO}, 'YYYY-MM-DD') AS dt_ini, to_char(dt_fim AT TIME ZONE ${FUSO}, 'YYYY-MM-DD') AS dt_fim
      FROM tb_speed_aux
     WHERE tipo_registro = ${tipo} AND codigo_registro = ANY(${codigos}::bigint[]) AND ${fimCond}
       AND (reg_informado = 'N' OR (reg_informado = 'S' AND (dt_fim AT TIME ZONE ${FUSO})::date >= ${dtini}::date))
       AND NOT (campo = '08' AND vl_anterior = 'SEM INFORMACAO')
       AND NOT (campo = '08' AND substr(vl_anterior, 1, 1) <> substr(vl_atual, 1, 1))
     ORDER BY codigo_registro, campo, dt_fim, cod_speed_aux`.execute(db)).rows;
}
