import { sql, type Kysely } from 'kysely';
import { BusinessRuleError } from '../errors/app-error';

type AnyDB = Kysely<any>;

/** o .fr3 como a RELATORIOS guarda: base64 no CLOB do binário novo; arquivo que já é XML passa direto */
export function decodificarFr3(bruto: string | null | undefined): string {
  const s = String(bruto ?? '').trim();
  return s.startsWith('<') ? s : Buffer.from(s, 'base64').toString('utf8').replace(/^﻿/, '');
}

/**
 * O arquivo de relatório que o legado carrega com `frxReport.LoadFromFile(DirAplicacao + '\Relatorios\<arquivo>')`: o binário
 * novo guarda os arquivos na RELATORIOS e o PERSONALIZADO do cliente vence o DEFAULT da Apollo com o mesmo nome.
 */
export async function modeloFr3(db: AnyDB, arquivo: string): Promise<string> {
  const r = (await sql<{ arquivo: string | null }>`
    SELECT arquivo FROM relatorios
     WHERE lower(nome_relatorio) = lower(${arquivo}) AND coalesce(indr, 'I') <> 'E'
     ORDER BY CASE WHEN upper(tipo) = 'PERSONALIZADO' THEN 0 ELSE 1 END, codrelatorio DESC
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
