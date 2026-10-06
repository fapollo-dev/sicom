import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MODULOS, ROTA_MODULO, contextosDoMenu, moduloDaRota } from '../src/app/modulos';

/** As rotas do menu lateral e as do router, lidas do fonte (fonte única: AppLayout/router). */
function rotasDe(arquivo: string, regex: RegExp) {
  const src = readFileSync(new URL(arquivo, import.meta.url), 'utf-8');
  return [...src.matchAll(regex)].map((m) => m[1]);
}
const telasDoMenu = rotasDe('../src/app/AppLayout.tsx', /\{ href: '([^']+)', name: '[^']+'/g);
const rotasDoRouter = new Set(rotasDe('../src/app/router.tsx', /path: '([^']+)'/g));

describe('módulos do menu (os do legado — ver modulos.ts)', () => {
  it('toda tela do menu cai num módulo, e cada módulo do rail tem tela', () => {
    for (const href of telasDoMenu) expect(MODULOS.map((m) => m.id)).toContain(moduloDaRota(href));
    const telas = telasDoMenu.map((href) => ({ href, name: href, icon: undefined as never }));
    const contextos = contextosDoMenu(telas);
    expect(contextos.every((c) => c.items.length > 0)).toBe(true);
    // nenhuma tela se perde nem aparece duas vezes
    const naArvore = contextos.flatMap((c) => c.items.flatMap((i) => (i.subitems ? i.subitems : [i])));
    expect(naArvore.map((i) => i.href).sort()).toEqual([...telasDoMenu].sort());
  });

  it('não sobra rota morta no mapa (toda chave existe no router)', () => {
    const mortas = Object.keys(ROTA_MODULO).filter((r) => !rotasDoRouter.has(r));
    expect(mortas).toEqual([]);
  });
});
