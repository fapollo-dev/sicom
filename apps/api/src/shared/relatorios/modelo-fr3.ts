import { sql, type Kysely } from 'kysely';
import { BusinessRuleError } from '../errors/app-error';

type AnyDB = Kysely<any>;

/**
 * UTF-8 com os bytes soltos em latin1: os .fr3 antigos (FastReport 4) têm texto do designer gravado em ANSI no meio do XML UTF-8 (o
 * "Layout de impressão" do diálogo do recibopagar.fr3) — a sequência inválida vira o caractere latin1 dela, o resto segue UTF-8.
 */
export function utf8ComLatin1(b: Buffer): string {
  let out = '';
  let i = 0;
  while (i < b.length) {
    const c = b[i];
    const n = c < 0x80 ? 1 : (c & 0xe0) === 0xc0 ? 2 : (c & 0xf0) === 0xe0 ? 3 : (c & 0xf8) === 0xf0 ? 4 : 0;
    let ok = n > 0 && i + n <= b.length;
    for (let k = 1; ok && k < n; k++) ok = (b[i + k] & 0xc0) === 0x80;
    if (ok && n > 1) { out += b.subarray(i, i + n).toString('utf8'); i += n; } else { out += String.fromCharCode(c); i += 1; }
  }
  return out;
}

/** o .fr3 como a RELATORIOS guarda: base64 no CLOB do binário novo; arquivo que já é XML passa direto */
export function decodificarFr3(bruto: string | null | undefined): string {
  const s = String(bruto ?? '').trim();
  return s.startsWith('<') ? s : utf8ComLatin1(Buffer.from(s, 'base64')).replace(/^\ufeff/, '');
}

/**
 * O arquivo de relatório que o legado carrega com `frxReport.LoadFromFile(DirAplicacao + '\Relatorios\<arquivo>')`: o binário
 * novo guarda os arquivos na RELATORIOS e o PERSONALIZADO do cliente vence o DEFAULT da Apollo com o mesmo nome.
 */
export async function modeloFr3(db: AnyDB, arquivo: string, opcoes: { pasta?: 'Config' } = {}): Promise<string> {
  // a RELATORIOS mistura as pastas do legado: os carregados de `Config\` (recibo, recibopagar, PedidoRetaguarda, HistoricoFinanceiro,
  // duplicatas…) vieram no primeiro lote de PERSONALIZADO (códigos 580-619 na produção) e alguns nomes se repetem no lote de `Relatorios\`
  // — o de Config é o de código menor
  const config = opcoes.pasta === 'Config';
  const r = (await sql<{ arquivo: string | null }>`
    SELECT arquivo FROM relatorios
     WHERE lower(nome_relatorio) = lower(${arquivo}) AND coalesce(indr, 'I') <> 'E'
     ORDER BY CASE WHEN upper(tipo) = 'PERSONALIZADO' THEN 0 ELSE 1 END, ${config ? sql`codrelatorio` : sql`codrelatorio DESC`}
     LIMIT 1`.execute(db)).rows[0];
  if (!r?.arquivo) throw new BusinessRuleError('RELATORIO_MODELO_NAO_ENCONTRADO', { arquivo }, `O modelo de relatório "${arquivo}" não está cadastrado.`);
  return decodificarFr3(r.arquivo);
}

/**
 * Os arquivos de um prefixo (o `GetFileList('Relatorios\ven2_*.*')` do hub de vendas): um por nome, o PERSONALIZADO antes do DEFAULT,
 * na ordem do nome (a do diretório do Windows).
 */
export async function modelosDoPrefixo(db: AnyDB, prefixo: string): Promise<Array<{ arquivo: string; xml: string }>> {
  const rows = (await sql<{ nome_relatorio: string; arquivo: string | null }>`
    SELECT nome_relatorio, arquivo FROM relatorios
     WHERE lower(nome_relatorio) LIKE ${`${prefixo.toLowerCase()}%`} AND lower(nome_relatorio) LIKE '%.fr3' AND coalesce(indr, 'I') <> 'E'
     ORDER BY CASE WHEN upper(tipo) = 'PERSONALIZADO' THEN 0 ELSE 1 END, codrelatorio DESC`.execute(db)).rows;
  const vistos = new Map<string, { arquivo: string; xml: string }>();
  for (const r of rows) {
    const k = r.nome_relatorio.toLowerCase();
    if (!vistos.has(k) && r.arquivo) vistos.set(k, { arquivo: r.nome_relatorio, xml: decodificarFr3(r.arquivo) });
  }
  return [...vistos.values()].sort((a, b) => a.arquivo.toUpperCase().localeCompare(b.arquivo.toUpperCase()));
}
