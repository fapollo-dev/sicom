import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⚠️ CRASE DENTRO DE `sql` QUEBRA O TEMPLATE LITERAL — e quebrou o build quatro vezes.
 *
 * Escrevemos comentários densos dentro do SQL, e o reflexo de citar identificadores com crase (` `coluna` `)
 * vem junto. Dentro de um template literal `sql`...`` a crase **fecha a string**, e o erro que o TypeScript
 * devolve aponta para uma propriedade inexistente algumas linhas adiante — nada que faça pensar em crase.
 *
 * Este teste é a trava: varre os serviços, acha os blocos `sql`...`` e falha se houver crase num comentário
 * `--` dentro deles, dizendo o arquivo e a linha.
 */
function arquivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivosTs(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

describe('SQL sem crase em comentário', () => {
  it('nenhum comentário -- dentro de sql`...` contém crase', () => {
    const raiz = join(__dirname, '..', 'src');
    const ofensas: string[] = [];

    for (const arq of arquivosTs(raiz)) {
      const linhas = readFileSync(arq, 'utf8').split('\n');
      let dentro = false;
      linhas.forEach((ln, i) => {
        // entra num bloco SQL ao ver `sql<...>` ou sql` abrindo
        if (/\bsql(<[^>]*>)?`/.test(ln)) dentro = true;
        if (dentro) {
          // só comentário SQL: `// ----` é comentário de TypeScript e pode ter crase à vontade
          const ts = ln.indexOf('//');
          const idx = ln.indexOf('--');
          const ehSql = idx >= 0 && (ts < 0 || idx < ts);
          if (ehSql && ln.slice(idx).includes('`')) {
            ofensas.push(`${arq.replace(raiz, 'src')}:${i + 1}  ${ln.trim().slice(0, 90)}`);
          }
          // fecha quando a linha termina o template
          if (/`\s*\.execute\(|`\s*;|`\s*\)/.test(ln)) dentro = false;
        }
      });
    }

    expect(ofensas, `crase em comentário dentro de sql\`...\`:\n${ofensas.join('\n')}`).toEqual([]);
  });
});
