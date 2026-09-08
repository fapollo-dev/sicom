import { Injectable, Logger } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DatabaseProvider } from '../../shared/database/database.provider';
import { currentTenant } from '../../shared/tenant/tenant-context';
import { BusinessRuleError } from '../../shared/errors/app-error';
import type { Definicao, ColunaDef, CondicaoDef } from './relatorio-construtor.service';

type AnyDB = Kysely<any>;

/** `OPERACAO` do `cdsWhere` → o operador do nosso modelo. As seis que o cliente usa, nas 96 condições dele. */
const OPERACAO: Record<string, string> = {
  'IGUAL A': '=',
  'DIFERENTE DE': '<>',
  'MAIOR QUE': '>',
  'MENOR QUE': '<',
  'ENTRE': 'entre',
  'EM QUALQUER LUGAR': 'contem',
  'COMECA COM': 'comeca',
  'COMEÇA COM': 'comeca',
};

export interface ResultadoImport {
  lidos: number; importados: number; jaExistiam: number;
  pendentes: Array<{ nome: string; motivo: string }>;
}

/**
 * IMPORTADOR dos relatórios que o cliente montou no legado — corte-3 do construtor.
 * Dossiê: `uRelatorio-construtor.md`.
 *
 * A carga traz `RELATORIOS_CUSTOMIZADOS` como está: **109 linhas / 95 nomes distintos**, cada uma um XML
 * DATAPACKET do Delphi (às vezes em base64) com a definição que o cliente montou. Este serviço lê aquilo e
 * grava no nosso modelo, marcando `origem = 'LEGADO'`.
 *
 * O XML tem quatro conjuntos de linhas, e os quatro foram mapeados:
 *  · `cdsConfiguracoes`   → título, paisagem, agrupamento, quebra de página;
 *  · `cdsCamposAImprimir` → uma coluna cada (`CAMPO`, `TITULO`, `TAMANHO`, `POSICAO`, `CAMPOCALC`);
 *  · `cdsCamposCalculados`→ a conta das colunas com `CAMPOCALC="TRUE"` (`FORMULA`/`FORMULALBL`, `TOTALIZAR`);
 *  · `cdsWhere`           → as condições (`CAMPO`, `OPERACAO`, `VALOR_CAMPO`).
 *
 * Medido nos 109 arquivos do cliente antes de escrever isto: **96 condições em 6 operações**, todas mapeadas,
 * e **3 colunas calculadas, as 3 no formato `A operação B`** — que é exatamente o que o nosso modelo aceita.
 * Não há fórmula livre a interpretar, e é bom que não haja: aceitar SQL do arquivo reabriria a porta que o
 * construtor fecha.
 *
 * O que **não** dá para importar é registrado e devolvido, nunca adivinhado: fonte que o Apollo ainda não
 * tem, campo que não existe na fonte, fórmula fora do formato. Cada um vira uma linha em `pendentes`.
 */
@Injectable()
export class RelatorioImportadorService {
  private readonly logger = new Logger(RelatorioImportadorService.name);
  constructor(private readonly dbp: DatabaseProvider) {}

  private emp(): number {
    const e = currentTenant().empresaId ?? null;
    if (e == null) throw new BusinessRuleError('TENANT_FORBIDDEN');
    return e;
  }

  /**
   * Lê `relatorios_customizados` e grava o que der em `relatorio_definicao`. Idempotente: o que já foi
   * importado (mesmo nome) é contado e pulado, então rodar de novo depois de portar uma view nova só traz
   * o que passou a ser possível.
   */
  async importar(p?: { substituir?: boolean }): Promise<ResultadoImport> {
    const emp = this.emp();
    const op = currentTenant().operadorId ?? null;
    const db = this.dbp.forTenant() as AnyDB;

    const arquivos = (await sql<Record<string, unknown>>`
      SELECT nome_relatorio, arquivo FROM relatorios_customizados
       WHERE idempresa = ${emp} AND arquivo IS NOT NULL
       ORDER BY nome_relatorio
    `.execute(db)).rows;

    const res: ResultadoImport = { lidos: arquivos.length, importados: 0, jaExistiam: 0, pendentes: [] };
    const vistos = new Set<string>();

    for (const a of arquivos) {
      const arquivo = String(a.nome_relatorio);
      const nome = nomeLegivel(arquivo);
      if (vistos.has(nome.toUpperCase())) continue;   // o cliente tem o mesmo relatório repetido
      vistos.add(nome.toUpperCase());
      try {
        const xml = decodificar(String(a.arquivo));
        const fonte = await this.resolverFonte(db, arquivo);
        if (!fonte) { res.pendentes.push({ nome: arquivo, motivo: 'A fonte deste relatório ainda não existe no Apollo.' }); continue; }

        const def = converter(xml);
        if (!def.colunas.length) { res.pendentes.push({ nome: arquivo, motivo: 'O arquivo não tem colunas.' }); continue; }

        const campos = await this.camposDa(db, fonte);
        const faltando = referencias(def).filter((c) => !campos.has(c));
        if (faltando.length) { res.pendentes.push({ nome: arquivo, motivo: `A fonte ${fonte} não tem: ${faltando.join(', ')}.` }); continue; }

        const existe = await db.selectFrom('relatorio_definicao').select('codrelatoriodef')
          .where('idempresa', '=', emp).where(sql`upper(nome)`, '=', nome.toUpperCase()).executeTakeFirst();
        if (existe && !p?.substituir) { res.jaExistiam += 1; continue; }

        if (existe) {
          await db.updateTable('relatorio_definicao')
            .set({ fonte, definicao: JSON.stringify(def), origem: 'LEGADO', usultalteracao: op, dtultimalteracao: sql`now()` })
            .where('codrelatoriodef', '=', (existe as { codrelatoriodef: number }).codrelatoriodef).execute();
        } else {
          await db.insertInto('relatorio_definicao')
            .values({ idempresa: emp, nome, fonte, definicao: JSON.stringify(def), origem: 'LEGADO', usucadastro: op }).execute();
        }
        res.importados += 1;
      } catch (e) {
        this.logger.warn(`importação de ${arquivo}: ${(e as Error).message}`);
        res.pendentes.push({ nome: arquivo, motivo: `Não foi possível ler o arquivo: ${(e as Error).message}` });
      }
    }
    return res;
  }

  /**
   * O nome do arquivo é `GET_<VIEW>_<NOME LIVRE>.XML`, e o nome da view tem underscore — então o de-para é por
   * PREFIXO MAIS LONGO contra as fontes que existem, que é como o legado também o resolve na prática.
   */
  private async resolverFonte(db: AnyDB, arquivo: string): Promise<string | null> {
    const alvo = arquivo.toUpperCase();
    const fontes = (await sql<{ fonte: string }>`
      SELECT c.relname AS fonte FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'v' AND n.nspname = 'public' AND obj_description(c.oid, 'pg_class') IS NOT NULL
       ORDER BY length(c.relname) DESC
    `.execute(db)).rows.map((r) => r.fonte);
    return fontes.find((f) => alvo.startsWith(`${f.toUpperCase()}_`) || alvo.startsWith(`${f.toUpperCase()}.`)) ?? null;
  }

  private async camposDa(db: AnyDB, fonte: string): Promise<Set<string>> {
    const rows = (await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${fonte}
    `.execute(db)).rows;
    return new Set(rows.map((r) => r.column_name.toLowerCase()));
  }
}

// ── a leitura do arquivo ───────────────────────────────────────────────────────────────────────────────────

/** o CLOB vem em base64 quando o ETL o converteu; senão é o XML direto. */
function decodificar(bruto: string): string {
  const t = bruto.trim();
  if (t.startsWith('<')) return t;
  const buf = Buffer.from(t, 'base64');
  const s = buf.toString('utf8');
  // o Delphi grava em latin-1; se o utf8 vier com caractere de substituição, relê como latin-1.
  return s.includes('�') ? buf.toString('latin1') : s;
}

const atributos = (linha: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of linha.matchAll(/([A-Z_0-9]+)="([^"]*)"/g)) out[m[1]] = desescapar(m[2]);
  return out;
};
const desescapar = (s: string) => s
  .replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const verdade = (v: string | undefined) => String(v ?? '').toUpperCase() === 'TRUE';

/** `A operação B`, que é o formato das 3 fórmulas do cliente. Qualquer outra coisa devolve nulo. */
function lerFormula(f: string): { campo1: string; operacao: '+' | '-' | '*' | '/'; campo2: string } | null {
  const limpa = f.replace(/coalesce\s*\(\s*([A-Za-z_0-9]+)\s*,\s*0\s*\)/gi, '$1').trim();
  const m = /^([A-Za-z_][A-Za-z_0-9]*)\s*([-+*/])\s*([A-Za-z_][A-Za-z_0-9]*)$/.exec(limpa);
  return m ? { campo1: m[1].toLowerCase(), operacao: m[2] as '+' | '-' | '*' | '/', campo2: m[3].toLowerCase() } : null;
}

/** `'01/08/2020' and '30/09/2020'` (o `VALOR_CAMPO` do "Entre") → os dois valores em ISO. */
function lerValor(valor: string, operador: string): unknown {
  const partes = valor.split(/\s+and\s+/i).map((s) => s.trim().replace(/^'|'$/g, ''));
  const iso = (s: string) => (/^\d{2}\/\d{2}\/\d{4}$/.test(s) ? s.split('/').reverse().join('-') : s);
  return operador === 'entre' ? partes.slice(0, 2).map(iso) : iso(partes[0] ?? '');
}

/** o XML DATAPACKET do Delphi → a nossa definição. */
export function converter(xml: string): Definicao {
  const linhas = xml.match(/<ROW\b[^>]*\/>/g) ?? [];
  const def: Definicao = { colunas: [], condicoes: [] };
  const calculos = new Map<string, { titulo?: string; formula?: string; totalizar?: boolean }>();
  const brutas: Array<Record<string, string>> = [];

  for (const l of linhas) {
    const a = atributos(l);
    switch (a.DATASET) {
      case 'cdsConfiguracoes':
        if (a.TITULO_REL) def.titulo = a.TITULO_REL;
        def.paisagem = verdade(a.IMPRIMIR_EM_PAISAGEM);
        def.somenteAgrupamento = verdade(a.MOSTRA_SOMENTE_AGRUPAMENTO);
        def.quebraPagina = verdade(a.SALTAR_PG_GRUPO);
        break;
      case 'cdsCamposAImprimir': brutas.push(a); break;
      case 'cdsCamposCalculados':
        calculos.set(a.CAMPO, { titulo: a.TITULO_CALC, formula: a.FORMULA ?? a.FORMULALBL, totalizar: verdade(a.TOTALIZAR) });
        break;
      case 'cdsWhere': {
        const operador = OPERACAO[String(a.OPERACAO ?? '').toUpperCase()];
        if (!operador || !a.CAMPO) break;
        def.condicoes!.push({ campo: a.CAMPO.toLowerCase(), operador, valor: lerValor(a.VALOR_CAMPO ?? '', operador) } as CondicaoDef);
        break;
      }
      default: break;
    }
  }

  brutas
    .sort((x, y) => Number(x.POSICAO ?? 0) - Number(y.POSICAO ?? 0))
    .forEach((a, i) => {
      const largura = Number(a.TAMANHO ?? 0) || undefined;
      const base: ColunaDef = { titulo: a.TITULO || a.CAMPO, largura, posicao: i + 1 };
      if (verdade(a.CAMPOCALC)) {
        const c = calculos.get(a.CAMPO);
        const conta = c?.formula ? lerFormula(c.formula) : null;
        // sem conta legível a coluna é DESCARTADA e o relatório inteiro cai em `pendentes` — nunca se
        // inventa uma fórmula, e nunca se injeta o texto do arquivo na consulta.
        if (!conta) { def.colunas.push({ ...base, campo: `__formula_nao_lida__${a.CAMPO}` }); return; }
        def.colunas.push({ ...base, calculado: conta, titulo: c?.titulo || base.titulo, totalizar: c?.totalizar, formato: 'numero' });
      } else {
        def.colunas.push({ ...base, campo: String(a.CAMPO).toLowerCase() });
      }
    });

  return def;
}

/** todo nome de campo que a definição cita — é o que se confere contra a fonte antes de gravar. */
export function referencias(def: Definicao): string[] {
  const fora: string[] = [];
  for (const c of def.colunas) {
    if (c.calculado) { fora.push(c.calculado.campo1, c.calculado.campo2); }
    else if (c.campo) fora.push(c.campo);
  }
  for (const c of def.condicoes ?? []) fora.push(c.campo);
  return Array.from(new Set(fora));
}

/** `GET_APAGAR_AGRUPAR TIPO DE DOCUMENTO.XML` → `AGRUPAR TIPO DE DOCUMENTO`. */
export function nomeLegivel(arquivo: string): string {
  const sem = arquivo.replace(/\.xml$/i, '');
  const partes = sem.split('_');
  const idx = partes.findIndex((p, i) => i > 0 && /\s/.test(p));
  const nome = idx > 0 ? partes.slice(idx).join('_') : partes.slice(2).join('_') || sem;
  return (nome || sem).trim().slice(0, 120);
}
